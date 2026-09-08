/**
 * backfill-inst-cost.mjs — 法人成本歷史回補（AC-IC-6）
 *
 * 一次性把序列補到 120 個交易日（MAX_DAYS），讓 60/120 日成本立刻可用，
 * 不必等三個月／六個月自然累積。
 *
 * 資料來源（皆已查證可行）：
 *   - TWSE T86 可帶 date 參數逐日抓歷史（2026-06-02 實測 15,625 筆、19 欄位與現行程式一致）
 *   - 當日收盤價從 latest.json 的 stocks[].closes/dates 取（已有 250 天）
 *   - 交易日清單從 latest.json 的 indexHistory 取（那是真實有開盤的日子，不用自己推算假日）
 *
 * 算法與 fetch-daily.mjs 的 fetchT86Sectors 完全一致（股數 × 當日收盤 ÷ 1e8 = 億元），
 * 逐日由舊到新呼叫 updateSeries；停牌／當日無 T86 的個股由 updateSeries 自己補 null 佔位。
 *
 * 執行：SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/backfill-inst-cost.mjs
 *   BACKFILL_DAYS=120   要回補幾個交易日（預設 120）
 *   BACKFILL_DRY_RUN=1  只算不上傳
 */
import { pathToFileURL } from 'url'
import { updateSeries, calcCosts, COST_WINDOWS } from './calc-inst-cost.mjs'

const DAYS = Number(process.env.BACKFILL_DAYS || 120)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

const parseNum = v => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
const r2 = v => Math.round(v * 100) / 100

async function fetchJSON(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      return fetchJSON(url, attempt + 1)
    }
    throw e
  }
}

/** 某一交易日的 T86 → [{ code, net, foreignNet, close }]，單位億元 */
async function fetchT86Rows(dateYYYYMMDD, dateISO, stockMap) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateYYYYMMDD}&selectType=ALL`
  const d = await fetchJSON(url)
  if (d.stat !== 'OK' || !Array.isArray(d.data)) return null

  const rows = []
  for (const row of d.data) {
    const code = String(row[0]).trim()
    if (!/^\d{4}$/.test(code)) continue          // 跳過 ETF、權證
    const stock = stockMap[code]
    if (!stock) continue

    // 該日收盤價：一定要用「當天」的價格，找不到就跳過這檔這天
    //（不可 fallback 到最新價——回補跨越 120 天，用今天的價算三個月前的成本會整個歪掉）
    const di = stock.dates?.indexOf(dateISO) ?? -1
    const close = di >= 0 ? stock.closes?.[di] : null
    if (!close || close <= 0) continue

    const toYi = shares => r2(shares * close / 1e8)
    const foreignNet = toYi(parseNum(row[4]) + parseNum(row[7]))   // 外資（含外資自營）
    const trustNet   = toYi(parseNum(row[10]))
    const dealerNet  = toYi(parseNum(row[11]))
    rows.push({ code, net: r2(foreignNet + trustNet + dealerNet), foreignNet, close })
  }
  return rows
}

async function upload(path, body) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body,
  })
  if (!res.ok) throw new Error(`上傳 ${path} 失敗 HTTP ${res.status}：${await res.text()}`)
}

async function main() {
  console.log(`[backfill] 下載 latest.json…`)
  const snap = await fetchJSON(`${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`)

  const stockMap = {}
  for (const s of snap.stocks ?? []) stockMap[s.code] = s
  console.log(`[backfill] 個股 ${Object.keys(stockMap).length} 檔`)

  // 交易日：用 indexHistory 的日期（真實開盤日），由舊到新取最後 DAYS 天
  const tradingDays = (snap.indexHistory ?? [])
    .map(r => r.date).filter(Boolean).sort().slice(-DAYS)
  console.log(`[backfill] 回補區間 ${tradingDays[0]} ~ ${tradingDays[tradingDays.length - 1]}（${tradingDays.length} 個交易日）`)

  let series = null
  let ok = 0, skip = 0
  for (const dateISO of tradingDays) {
    const ymd = dateISO.replace(/-/g, '')
    let rows
    try {
      rows = await fetchT86Rows(ymd, dateISO, stockMap)
    } catch (e) {
      console.log(`[backfill] ${dateISO} 抓取失敗：${e.message}`)
      skip++
      continue
    }
    if (!rows || !rows.length) {
      console.log(`[backfill] ${dateISO} 無 T86 資料，跳過`)
      skip++
      continue
    }
    series = updateSeries(series, rows, dateISO)
    ok++
    if (ok % 20 === 0) console.log(`[backfill] 已處理 ${ok}/${tradingDays.length}（最新 ${dateISO}，序列 ${series.dates.length} 天）`)
    await new Promise(r => setTimeout(r, 1000))   // 節流，別敲爆 TWSE
  }

  if (!series) throw new Error('沒有任何一天成功，序列是空的')

  const cost = calcCosts(series)
  const cnt = w => Object.values(cost).filter(v => v[`t${w}`] != null).length
  console.log(`[backfill] 完成：成功 ${ok} 天／跳過 ${skip} 天，序列 ${series.dates.length} 天`)
  console.log(`[backfill] 可算出：${COST_WINDOWS.map(w => `${w}日 ${cnt(w)} 檔`).join('／')}`)

  const payload = JSON.stringify({
    updatedAt: new Date().toISOString(),
    date: series.dates[0] ?? null,
    days: series.dates.length,
    cost,
  })
  console.log(`[backfill] 體積：series ${(JSON.stringify(series).length / 1024).toFixed(0)} KB／inst-cost ${(payload.length / 1024).toFixed(0)} KB`)

  if (process.env.BACKFILL_DRY_RUN) {
    console.log('[backfill] DRY RUN：不上傳')
    return
  }
  await upload('inst-cost-series.json', JSON.stringify(series))
  await upload('inst-cost.json', payload)
  console.log('[backfill] 兩個檔案已上傳')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(`[backfill] 失敗：${e.message}`)
    process.exit(1)
  })
}
