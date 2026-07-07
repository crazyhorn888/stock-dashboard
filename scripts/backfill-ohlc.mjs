/**
 * 一次性：從 TWSE 歷史 STOCK_DAY_ALL 補抓全市場 OHLC，上傳至 Supabase Storage ohlc.json
 *
 * 用法：
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx node scripts/backfill-ohlc.mjs
 *   # 或加 MAX_DAYS=120（預設）控制補抓天數
 *
 * 說明：
 *   - 從 latest.json 的 indexHistory 取得正確交易日曆（避免猜假期）
 *   - 如果 ohlc.json 已存在（部分資料），只補缺漏的日期
 *   - 每次 TWSE 請求間隔 1.5s，避免被封鎖
 *   - 完成後上傳覆蓋 Supabase Storage snapshots/ohlc.json
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const MAX_DAYS = parseInt(process.env.MAX_DAYS ?? '120')

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('需要設定 SUPABASE_URL 和 SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const SNAPSHOT_URL = `${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`
const OHLC_URL = `${SUPABASE_URL}/storage/v1/object/public/snapshots/ohlc.json`

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...opts.headers }, ...opts })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

// TWSE 歷史 STOCK_DAY_ALL 端點（老格式，fields array + data matrix）
// fields: [證券代號, 證券名稱, 成交股數, 成交筆數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌(+/-), 漲跌價差]
async function fetchHistoricalDay(dateISO) {
  const yyyymmdd = dateISO.replace(/-/g, '')
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json&date=${yyyymmdd}`
  try {
    const d = await fetchJSON(url)
    if (d.stat !== 'OK' || !Array.isArray(d.data)) return null

    const map = {}
    for (const row of d.data) {
      const code = String(row[0]).trim()
      if (!/^\d{4}$/.test(code)) continue
      const parseP = v => {
        const n = parseFloat(String(v).replace(/,/g, ''))
        return isNaN(n) || n <= 0 ? null : n
      }
      const open  = parseP(row[5])
      const high  = parseP(row[6])
      const low   = parseP(row[7])
      const close = parseP(row[8])
      if (!close) continue
      map[code] = { o: open ?? close, h: high ?? close, l: low ?? close }
    }
    return map  // { '2330': { o, h, l }, ... }
  } catch (e) {
    console.warn(`  [skip] ${dateISO}: ${e.message}`)
    return null
  }
}

async function uploadOHLC(bars, updatedAt) {
  const payload = JSON.stringify({ updatedAt, bars })
  const url = `${SUPABASE_URL}/storage/v1/object/snapshots/ohlc.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body: payload,
  })
  if (!res.ok) throw new Error(`Supabase 上傳失敗：${res.status} ${await res.text()}`)
  return `${SUPABASE_URL}/storage/v1/object/public/snapshots/ohlc.json`
}

async function main() {
  // 1. 下載 latest.json 取得交易日曆（indexHistory.date）
  console.log('[backfill] 下載 latest.json...')
  const snapshot = await fetchJSON(SNAPSHOT_URL)
  const tradingDates = (snapshot.indexHistory ?? [])
    .map(r => r.date)
    .sort((a, b) => b.localeCompare(a))  // newest first
    .slice(0, MAX_DAYS)

  if (!tradingDates.length) {
    console.error('[backfill] indexHistory 為空，無法取得交易日曆')
    process.exit(1)
  }
  console.log(`[backfill] 交易日曆：${tradingDates.length} 天（${tradingDates.at(-1)} ～ ${tradingDates[0]}）`)

  // 2. 下載現有 ohlc.json（若有），取得已涵蓋的日期集合
  let existingBars = {}
  const existingDates = new Set()
  try {
    const existing = await fetchJSON(OHLC_URL)
    // 從任一股票的 o 陣列長度推算已有幾天，但實際上我們重建整個 bars
    // 若 ohlc.json 已有 updatedAt 即代表有部分資料
    if (existing.bars) {
      existingBars = existing.bars
      console.log(`[backfill] 現有 ohlc.json：${Object.keys(existing.bars).length} 支股票`)
      // 無法從 ohlc.json 直接得知哪些 dates 已填入，故此版本全量重建
    }
  } catch {
    console.log('[backfill] ohlc.json 不存在，全量建立')
  }

  // 3. 逐日抓取 TWSE 歷史資料（oldest → newest，方便 unshift 進陣列）
  // bars 結構：{ code: { o: [...newest first], h: [...], l: [...] } }
  // 我們先用 { code: { o: [oldest...newest], h, l } } 建立，最後 reverse
  const rawBars = {}  // { code: { o: [], h: [], l: [] } } oldest→newest

  const toFetch = [...tradingDates].reverse()  // oldest first
  console.log(`[backfill] 開始補抓 ${toFetch.length} 個交易日...`)

  for (let i = 0; i < toFetch.length; i++) {
    const date = toFetch[i]
    process.stdout.write(`  [${i + 1}/${toFetch.length}] ${date}... `)
    const dayMap = await fetchHistoricalDay(date)

    if (!dayMap) {
      console.log('跳過')
    } else {
      const codes = Object.keys(dayMap)
      for (const code of codes) {
        if (!rawBars[code]) rawBars[code] = { o: [], h: [], l: [] }
        rawBars[code].o.push(dayMap[code].o)
        rawBars[code].h.push(dayMap[code].h)
        rawBars[code].l.push(dayMap[code].l)
      }
      console.log(`${codes.length} 支`)
    }

    if (i < toFetch.length - 1) await sleep(1500)
  }

  // 4. Reverse 成 newest-first（與 closes/dates 相同方向）
  const bars = {}
  for (const [code, v] of Object.entries(rawBars)) {
    bars[code] = {
      o: v.o.reverse().slice(0, 250),
      h: v.h.reverse().slice(0, 250),
      l: v.l.reverse().slice(0, 250),
    }
  }

  const stockCount = Object.keys(bars).length
  console.log(`[backfill] 完成，${stockCount} 支股票`)

  // 5. 上傳 ohlc.json
  const url = await uploadOHLC(bars, new Date().toISOString())
  console.log(`[backfill] 上傳完成：${url}`)
  console.log(`[backfill] ohlc.json 大小：${(JSON.stringify({ updatedAt: '', bars }).length / 1024 / 1024).toFixed(1)} MB（估算）`)
}

main().catch(e => { console.error(e); process.exit(1) })
