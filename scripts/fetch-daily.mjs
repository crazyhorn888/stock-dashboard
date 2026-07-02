/**
 * 每日增量更新：下載 Firebase 現有快照 → 插入今日資料 → 存出 data/latest.json
 * 不再逐支股票抓歷史（改由 seed-history.mjs 一次性建立），每日只需幾個 TWSE 請求
 * 執行：node scripts/fetch-daily.mjs
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 工具 ────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

function todayTW() {
  // 民國年格式，TWSE OpenAPI Date 欄位用（e.g. "1150623"）
  const d = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '')
  // zh-TW 格式：「2026/06/23」→ 去掉斜線 → "20260623"，需轉成民國年
  const year = parseInt(d.slice(0, 4)) - 1911
  return `${year}${d.slice(4)}`
}

function todayTWDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

/** 民國年日期字串（1150630）→ YYYY-MM-DD */
function rocToISO(rocStr) {
  const s = String(rocStr)
  const year = parseInt(s.slice(0, -4)) + 1911
  const mm = s.slice(-4, -2)
  const dd = s.slice(-2)
  return `${year}-${mm}-${dd}`
}

// TWSE OpenAPI 快取（同 process 內只抓一次）
let _twseAllCache = null
async function fetchTWSEAll() {
  if (_twseAllCache) return _twseAllCache
  const data = await fetchJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL')
  _twseAllCache = Array.isArray(data) ? data : []
  return _twseAllCache
}

// ── Guard 1：今天已上傳 ──────────────────────────────
async function isAlreadyDoneToday() {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET
  if (!bucket) return false
  try {
    const url = `https://storage.googleapis.com/${bucket}/snapshots/latest.json`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return false
    const d = await res.json()
    if (!d?.updatedAt) return false
    const uploaded = new Date(d.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    return uploaded === todayTWDate()
  } catch { return false }
}

// ── Guard 2：確認交易日（用 OpenAPI STOCK_DAY_ALL 的 Date 欄位比對今日）──
async function isTradingDay(dateTW) {
  try {
    const data = await fetchTWSEAll()
    if (!data.length) return false
    return data.some(r => String(r.Date) === dateTW)
  } catch { return false }
}

// ── Guard 3：融資資料是否發布 ────────────────────────
async function isMarginDataReady(date) {
  const url = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date}&selectType=MS`
  try {
    const d = await fetchJSON(url)
    return d?.stat === 'OK' && Array.isArray(d?.data) && d.data.length > 0
  } catch { return false }
}

// ── 下載現有 Firebase 快照 ───────────────────────────
async function downloadSnapshot() {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET
  if (!bucket) throw new Error('FIREBASE_STORAGE_BUCKET 未設定')
  const url = `https://storage.googleapis.com/${bucket}/snapshots/latest.json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`無法下載現有快照：HTTP ${res.status}（請先執行 seed-history.mjs）`)
  return res.json()
}

// ── TWSE 今日股價（全市場，用 OpenAPI，Guard 2 已確認今日資料存在）──────
async function fetchTWSEPrices() {
  const data = await fetchTWSEAll()
  return data
    .filter(r => /^\d{4}$/.test(r.Code) && r.ClosingPrice && parseFloat(r.ClosingPrice) > 0)
    .map(r => {
      const close = parseFloat(r.ClosingPrice)
      const change = parseFloat(r.Change) || 0
      const prevClose = close - change
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0
      return {
        code: r.Code,
        name: r.Name,
        close,
        changePercent: Math.round(changePercent * 100) / 100,
      }
    })
}

// ── TWSE 個股外資買賣超 ────────────────────────────
async function fetchStockForeign(date) {
  const url = `https://www.twse.com.tw/fund/TWT38U?response=json&date=${date}`
  try {
    const d = await fetchJSON(url)
    const map = {}
    for (const r of d?.data ?? []) {
      const code = r[0].trim()
      if (/^\d{4}$/.test(code)) map[code] = (parseFloat(r[10].replace(/,/g, '')) || 0) / 1e8
    }
    return map
  } catch {
    console.warn('[daily] 個股外資抓取失敗，跳過')
    return {}
  }
}

// ── FinMind PE/EPS（一次全市場，選用）─────────────
async function fetchFundamentals(token) {
  if (!token) return {}
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPER&date=${todayTWDate()}&token=${token}`
  try {
    const d = await fetchJSON(url)
    const map = {}
    for (const r of d?.data ?? []) map[r.stock_id] = { pe: r.PER ?? null, eps: r.EPS ?? null }
    return map
  } catch {
    console.warn('[daily] FinMind PER 失敗，保留舊值')
    return {}
  }
}

// ── Main ─────────────────────────────────────────
async function main() {
  const dateTW = todayTW()
  const today = todayTWDate()
  const FINMIND_TOKEN = process.env.FINMIND_TOKEN ?? ''

  console.log(`[daily] 開始，日期：${dateTW}`)

  // Guard 1：今天已上傳
  if (await isAlreadyDoneToday()) {
    console.log('[daily] 今日資料已在 Firebase，跳過，exit 0')
    process.exit(0)
  }

  // Guard 2：非交易日
  if (!(await isTradingDay(dateTW))) {
    console.log('[daily] 非交易日，跳過，exit 0')
    process.exit(0)
  }

  // Guard 3：融資尚未發布
  if (!(await isMarginDataReady(dateTW))) {
    console.log('[daily] 融資資料尚未發布，等下一個排程，exit 0')
    process.exit(0)
  }

  console.log('[daily] 三項確認通過，開始更新')

  // Step 1：下載現有快照
  console.log('[daily] 下載現有快照...')
  const snapshot = await downloadSnapshot()
  const stockMap = Object.fromEntries(snapshot.stocks.map(s => [s.code, s]))
  console.log(`[daily] 快照載入，${snapshot.stocks.length} 支股票`)

  // Step 2：抓今日 TWSE 資料（三個並行，OpenAPI 已快取）
  const [prices, foreignMap, fundamentals] = await Promise.all([
    fetchTWSEPrices(),
    fetchStockForeign(dateTW),
    fetchFundamentals(FINMIND_TOKEN),
  ])
  console.log(`[daily] TWSE 今日資料：${prices.length} 支`)

  // Step 3：更新每支股票
  let newCount = 0
  for (const p of prices) {
    const existing = stockMap[p.code]
    const pe = fundamentals[p.code]?.pe ?? existing?.pe ?? null
    const eps = fundamentals[p.code]?.eps ?? existing?.eps ?? null

    if (existing) {
      const closes = [...existing.closes]
      const dates = [...existing.dates]
      if (dates[0] === today) {
        closes[0] = p.close // 覆蓋同日重複
      } else {
        closes.unshift(p.close)
        dates.unshift(today)
      }
      stockMap[p.code] = {
        ...existing,
        close: p.close,
        changePercent: p.changePercent,
        pe, eps,
        foreignNetBuy: foreignMap[p.code] ?? existing.foreignNetBuy,
        closes: closes.slice(0, 250),
        dates: dates.slice(0, 250),
      }
    } else {
      // 快照中沒有的新股票
      stockMap[p.code] = {
        code: p.code, name: p.name, industry: '—',
        close: p.close, changePercent: p.changePercent,
        pe, eps,
        foreignNetBuy: foreignMap[p.code] ?? 0,
        closes: [p.close], dates: [today],
      }
      newCount++
    }
  }

  const stocks = Object.values(stockMap)
  console.log(`[daily] 更新 ${prices.length} 支，新增 ${newCount} 支，總計 ${stocks.length} 支`)

  const newSnapshot = {
    updatedAt: new Date().toISOString(),
    stocks,
    marketSignals: null,
  }

  const outDir = join(__dirname, '..', 'data')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(newSnapshot))
  console.log(`[daily] 完成，data/latest.json 已更新`)
}

main().catch(e => { console.error(e); process.exit(1) })
