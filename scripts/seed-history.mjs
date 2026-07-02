/**
 * 一次性歷史資料種子腳本（只需執行一次，約 2-3 小時）
 * - TWSE OpenAPI：取得所有股票當日資料（1 次請求）
 * - FinMind 逐支股票：取得 12 個月收盤歷史（每股 1 次，共 ~1,400 次）
 * - 速率控制：5 支並行，每批等 32 秒 = 9.4 次/分 ≈ 565 次/小時（安全低於 600）
 * - 進度自動存檔：中斷後可重新執行，從上次進度繼續
 *
 * 執行：FINMIND_TOKEN=xxx node scripts/seed-history.mjs
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const PROGRESS_FILE = join(DATA_DIR, 'seed-progress.json')
const OUTPUT_FILE = join(DATA_DIR, 'latest.json')

const CONCURRENCY = 5       // 每批並行數
const BATCH_WAIT_MS = 32000 // 批次間等待（ms）→ 5/32s = 9.4 req/min

// ── 工具 ────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/** 台北時間今天 YYYY-MM-DD */
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

// ── TWSE OpenAPI：全市場當日資料 ────────────────────
async function fetchTWSEAllStocks() {
  const url = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
  const data = await fetchJSON(url)
  if (!Array.isArray(data)) throw new Error('TWSE OpenAPI 回傳異常')
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
        date: rocToISO(r.Date),
      }
    })
}

// ── TWSE 個股外資 ───────────────────────────────────
async function fetchStockForeign() {
  const today = todayTWDate().replace(/-/g, '')
  const url = `https://www.twse.com.tw/fund/TWT38U?response=json&date=${today}`
  try {
    const d = await fetchJSON(url)
    const map = {}
    for (const r of d?.data ?? []) {
      const code = r[0].trim()
      if (/^\d{4}$/.test(code)) map[code] = (parseFloat(r[10]?.replace(/,/g, '')) || 0) / 1e8
    }
    return map
  } catch { return {} }
}

// ── FinMind PE/EPS（全市場，1 次）─────────────────
async function fetchFundamentals(token) {
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPER&date=${todayTWDate()}&token=${token}`
  try {
    const d = await fetchJSON(url)
    const map = {}
    for (const r of d?.data ?? []) map[r.stock_id] = { pe: r.PER ?? null, eps: r.EPS ?? null }
    console.log(`[seed] FinMind PE/EPS 取得 ${Object.keys(map).length} 支`)
    return map
  } catch {
    console.warn('[seed] FinMind PER 失敗，PE/EPS 留空')
    return {}
  }
}

// ── FinMind 單支股票歷史收盤（1 次請求）───────────
async function fetchStockHistory(code, token) {
  const endDate = todayTWDate()
  const startDate = new Date(Date.now() - 380 * 24 * 3600 * 1000)
    .toISOString().slice(0, 10)
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${code}&start_date=${startDate}&end_date=${endDate}&token=${token}`
  const d = await fetchJSON(url)
  if (!Array.isArray(d?.data)) throw new Error(d?.msg ?? 'FinMind 回傳異常')
  return d.data
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 250)
    .map(r => ({ date: r.date, close: parseFloat(r.close) }))
}

// ── 進度讀寫 ─────────────────────────────────────────
function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return { histMap: {}, done: [] }
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'))
  } catch { return { histMap: {}, done: [] } }
}

function saveProgress(histMap, done) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(PROGRESS_FILE, JSON.stringify({ histMap, done }))
}

// ── Main ─────────────────────────────────────────────
async function main() {
  const FINMIND_TOKEN = process.env.FINMIND_TOKEN ?? ''
  if (!FINMIND_TOKEN) { console.error('[seed] 請設定 FINMIND_TOKEN'); process.exit(1) }

  mkdirSync(DATA_DIR, { recursive: true })

  // Step 1：TWSE 全市場當日資料
  console.log('[seed] 抓取 TWSE 全市場當日資料...')
  const [twseStocks, foreignMap, fundamentals] = await Promise.all([
    fetchTWSEAllStocks(),
    fetchStockForeign(),
    fetchFundamentals(FINMIND_TOKEN),
  ])
  console.log(`[seed] TWSE 取得 ${twseStocks.length} 支股票`)

  const codes = twseStocks.map(s => s.code)

  // Step 2：讀取進度（支援中斷續跑）
  const progress = loadProgress()
  const histMap = progress.histMap
  const done = new Set(progress.done)
  const remaining = codes.filter(c => !done.has(c))

  console.log(`[seed] 歷史資料：已完成 ${done.size}，剩餘 ${remaining.length} 支`)
  if (remaining.length > 0) {
    const estMin = Math.ceil((remaining.length / CONCURRENCY) * (BATCH_WAIT_MS / 1000) / 60)
    console.log(`[seed] 預估需要約 ${estMin} 分鐘（可中斷，下次執行自動續跑）`)
  }

  // Step 3：分批查詢 FinMind（並行 + 速率控制）
  let batchNum = 0
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY)
    batchNum++

    const results = await Promise.allSettled(
      batch.map(code => fetchStockHistory(code, FINMIND_TOKEN))
    )

    for (let j = 0; j < batch.length; j++) {
      const code = batch[j]
      const result = results[j]
      if (result.status === 'fulfilled') {
        histMap[code] = result.value
        done.add(code)
      } else {
        console.warn(`[seed] ${code} 失敗：${result.reason?.message ?? '未知錯誤'}`)
        done.add(code) // 失敗也標記為完成，避免無限重試
      }
    }

    const pct = Math.round((done.size / codes.length) * 100)
    process.stdout.write(`\r[seed] 進度：${done.size}/${codes.length}（${pct}%）批次 ${batchNum}`)

    // 每 50 支存一次進度（以防中斷）
    if (done.size % 50 === 0) saveProgress(histMap, [...done])

    // 最後一批不需要等待
    if (i + CONCURRENCY < remaining.length) await sleep(BATCH_WAIT_MS)
  }

  saveProgress(histMap, [...done])
  console.log('\n[seed] FinMind 歷史資料抓取完成')

  // Step 4：合併組成 snapshot
  const today = todayTWDate()
  const stocks = twseStocks.map(p => {
    const hist = histMap[p.code] ?? []
    let closes = hist.map(h => h.close)
    let dates = hist.map(h => h.date)

    // 確保今日資料在最前面
    if (dates[0] !== today) {
      closes = [p.close, ...closes]
      dates = [today, ...dates]
    } else {
      closes[0] = p.close // 用 TWSE 當日資料覆蓋
    }

    return {
      code: p.code,
      name: p.name,
      industry: '—',
      close: p.close,
      changePercent: p.changePercent,
      pe: fundamentals[p.code]?.pe ?? null,
      eps: fundamentals[p.code]?.eps ?? null,
      foreignNetBuy: foreignMap[p.code] ?? 0,
      closes: closes.slice(0, 250),
      dates: dates.slice(0, 250),
    }
  })

  const snapshot = {
    updatedAt: new Date().toISOString(),
    stocks,
    marketSignals: null,
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(snapshot))

  const avgDays = Math.round(stocks.reduce((s, st) => s + st.closes.length, 0) / stocks.length)
  console.log(`[seed] 完成！${stocks.length} 支股票，平均 ${avgDays} 天歷史`)
  console.log('[seed] 接下來執行：')
  console.log('  node scripts/calc-signals.mjs')
  console.log(`  FIREBASE_SERVICE_ACCOUNT_JSON=$(cat <service-account.json>) FIREBASE_STORAGE_BUCKET=taiwan-stock-dashboard-b6464.firebasestorage.app node scripts/write-firebase.mjs`)
}

main().catch(e => { console.error(e); process.exit(1) })
