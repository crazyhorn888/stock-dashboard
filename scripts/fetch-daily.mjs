/**
 * 每日資料抓取：TWSE 日線 + 外資 + 融資 + FinMind 基本面
 * 執行：node scripts/fetch-daily.mjs
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 工具 ────────────────────────────────────────────
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, ...opts })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

/** 台北時間今天 YYYYMMDD */
function todayTW() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '')
}

/** 台北時間今天 YYYY-MM-DD */
function todayTWDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

// ── Guard 1：今天已經上傳過了 ────────────────────────
/**
 * 查 Firebase Storage 公開 URL 的 latest.json，比對 updatedAt 是否為台北時間今日。
 * 回傳 true = 已上傳，跳過本次 run。
 * FIREBASE_STORAGE_BUCKET 未設定時（本機開發）直接回傳 false。
 */
async function isAlreadyDoneToday() {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET
  if (!bucket) return false
  try {
    const url = `https://storage.googleapis.com/${bucket}/snapshots/latest.json`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return false
    const d = await res.json()
    if (!d?.updatedAt) return false
    const uploadedDate = new Date(d.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    return uploadedDate === todayTWDate()
  } catch {
    return false
  }
}

// ── Guard 2：確認交易日（股價資料是否發布）──────────
/**
 * 股價資料約 14:00 後發布。非交易日（國定假日）TWSE 回傳 stat !== "OK" 或 data9 空。
 * 注意：只確認「是否交易日」，不確認融資是否就緒。
 */
async function isTradingDay(date) {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${date}&type=ALLBUT0999`
  try {
    const d = await fetchJSON(url)
    return d?.stat === 'OK' && Array.isArray(d?.data9) && d.data9.length > 0
  } catch {
    return false
  }
}

// ── Guard 3：融資資料是否已發布 ──────────────────────
/**
 * 融資資料通常 16:30-17:00 才出現，比股價晚 2-3 小時。
 * 回傳 false = 尚未發布，讓下一個排程 retry，不要跑 FinMind（保護額度）。
 */
async function isMarginDataReady(date) {
  const url = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date}&selectType=MS`
  try {
    const d = await fetchJSON(url)
    return d?.stat === 'OK' && Array.isArray(d?.data) && d.data.length > 0
  } catch {
    return false
  }
}

// ── Step 1：抓大盤收盤點數（當日）─────────────────
async function fetchTWSEIndex(date) {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${date}&type=IND`
  const d = await fetchJSON(url)
  const row = d?.data?.find?.(r => r[0] === '發行量加權股價指數')
  if (!row) return null
  return parseFloat(row[4].replace(/,/g, '')) // 收盤
}

// ── Step 2：抓大盤融資餘額────────────────────────
async function fetchTWSEMargin(date) {
  const url = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date}&selectType=MS`
  const d = await fetchJSON(url)
  const row = d?.data?.[0]
  if (!row) return null
  // 融資餘額（千元）→ 億元
  return parseFloat(row[9].replace(/,/g, '')) / 1e5
}

// ── Step 3：抓外資買賣超 by 個股──────────────────
async function fetchTWSEForeign(date) {
  const url = `https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${date}&type=day`
  const d = await fetchJSON(url)
  // BFI82U 返回法人彙總，非個股；個股外資需另一 API
  // 這裡先抓市場合計
  const row = d?.data?.find?.(r => r[0]?.includes('外資及陸資'))
  if (!row) return 0
  return (parseFloat(row[3].replace(/,/g, '')) - parseFloat(row[4].replace(/,/g, ''))) / 1e8
}

// ── Step 4：抓個股收盤價 + 漲跌幅（全部）──────────
async function fetchAllStockPrices(date) {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${date}&type=ALLBUT0999`
  const d = await fetchJSON(url)
  if (!d?.data9) return []
  return d.data9.map(r => ({
    code: r[0].trim(),
    name: r[1].trim(),
    close: parseFloat(r[8].replace(/,/g, '')) || 0,
    changePercent: parseFloat(r[11].replace(/,/g, '')) || 0,
  })).filter(s => /^\d{4}$/.test(s.code) && s.close > 0)
}

// ── Step 5：FinMind 基本面（EPS/PE）──────────────
async function fetchFinMindFundamentals(token = '') {
  // PE ratio from FinMind（批次，一次拿全部）
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPER&date=${new Date().toISOString().slice(0,10)}&token=${token}`
  try {
    const d = await fetchJSON(url)
    if (!d?.data) return {}
    const map = {}
    for (const r of d.data) {
      map[r.stock_id] = { pe: r.PER ?? null, eps: r.EPS ?? null }
    }
    return map
  } catch {
    console.warn('[FinMind] PER 抓取失敗，跳過基本面')
    return {}
  }
}

// ── Step 6：個股外資買賣超（TWSE 個股）────────────
async function fetchStockForeign(date) {
  const url = `https://www.twse.com.tw/fund/TWT38U?response=json&date=${date}`
  try {
    const d = await fetchJSON(url)
    const map = {}
    for (const r of d?.data ?? []) {
      const code = r[0].trim()
      if (/^\d{4}$/.test(code)) {
        // 外資買超（億元）
        map[code] = (parseFloat(r[10].replace(/,/g, '')) || 0) / 1e8
      }
    }
    return map
  } catch {
    console.warn('[TWSE] 個股外資抓取失敗，跳過')
    return {}
  }
}

// ── Step 7：歷史收盤（250天），FinMind 或 TWSE ────
async function fetchHistory(code, token = '') {
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${code}&start_date=${startDate}&end_date=${endDate}&token=${token}`
  try {
    const d = await fetchJSON(url)
    const rows = (d?.data ?? []).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 250)
    return {
      closes: rows.map(r => r.close),
      dates: rows.map(r => r.date),
    }
  } catch {
    return { closes: [], dates: [] }
  }
}

// ── Main ─────────────────────────────────────────
async function main() {
  const dateTW = todayTW()
  const FINMIND_TOKEN = process.env.FINMIND_TOKEN ?? ''
  console.log(`[fetch-daily] 開始，日期：${dateTW}`)

  // Guard 1：今天已上傳 → 直接結束（保護 FinMind 額度，避免 retry 重跑）
  if (await isAlreadyDoneToday()) {
    console.log('[fetch-daily] 今日資料已在 Firebase，跳過，exit 0')
    process.exit(0)
  }

  // Guard 2：非交易日 → 結束（國定假日，全部 retry 都會在這裡停下）
  if (!(await isTradingDay(dateTW))) {
    console.log('[fetch-daily] 非交易日，跳過，exit 0')
    process.exit(0)
  }

  // Guard 3：融資資料尚未發布 → 結束，等下一個排程（通常 16:30 後才有）
  if (!(await isMarginDataReady(dateTW))) {
    console.log('[fetch-daily] 融資資料尚未發布，等下一個排程，exit 0')
    process.exit(0)
  }

  console.log('[fetch-daily] 三項確認通過，開始完整抓取')

  // 大盤
  const [todayIndex, todayMargin] = await Promise.all([
    fetchTWSEIndex(dateTW),
    fetchTWSEMargin(dateTW),
  ])
  console.log(`[fetch-daily] 大盤 ${todayIndex?.toLocaleString()} 點，融資 ${todayMargin?.toFixed(0)} 億`)

  // 全市場個股收盤
  const prices = await fetchAllStockPrices(dateTW)
  console.log(`[fetch-daily] 取得 ${prices.length} 檔個股`)

  // 基本面 + 個股外資
  const [fundamentals, foreignMap] = await Promise.all([
    fetchFinMindFundamentals(FINMIND_TOKEN),
    fetchStockForeign(dateTW),
  ])

  // 歷史收盤（batch，rate limit 約 60/min）
  const stocks = []
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i]
    if (i > 0 && i % 50 === 0) {
      console.log(`[fetch-daily] 歷史收盤 ${i}/${prices.length}，暫停 5s`)
      await new Promise(r => setTimeout(r, 5000))
    }
    const hist = await fetchHistory(p.code, FINMIND_TOKEN)
    // 若 FinMind 沒有歷史，用今日收盤補一筆
    const closes = hist.closes.length > 0 ? hist.closes : [p.close]
    const dates = hist.dates.length > 0 ? hist.dates : [new Date().toISOString().slice(0, 10)]

    stocks.push({
      code: p.code,
      name: p.name,
      industry: '—',   // TODO: 補產業 mapping
      close: p.close,
      changePercent: p.changePercent,
      pe: fundamentals[p.code]?.pe ?? null,
      eps: fundamentals[p.code]?.eps ?? null,
      foreignNetBuy: foreignMap[p.code] ?? 0,
      closes,
      dates,
    })
  }

  const snapshot = {
    updatedAt: new Date().toISOString(),
    stocks,
    // marketSignals 由 calc-signals.mjs 填入
    marketSignals: null,
  }

  const outDir = join(__dirname, '..', 'data')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(snapshot))
  console.log(`[fetch-daily] 完成，${stocks.length} 檔已存入 data/latest.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
