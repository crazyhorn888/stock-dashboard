/**
 * fetch-global.mjs
 * P2-3：獨立輕量腳本，只抓 6 個全球指數，直接寫 Supabase Storage 的 global-indices.json，
 * 不碰 data/latest.json / 主 pipeline（daily-fetch.yml 用專屬的 06:07 班次跑這支，<1分鐘結束）。
 * write-firebase.mjs 之後的每次正常 run 會讀這個檔案，併進 market.json 的 globalIndices 欄位。
 *
 * 資料源：Yahoo Finance 非官方 chart API（免 key）。Stooq 已改用 JS proof-of-work 反爬蟲，
 * 伺服器端腳本無法解，2026-07-09 起改用這個來源（見 plans/2026-07-08-優化修正計劃.md P2-3 紀錄）。
 *
 * 執行：SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/fetch-global.mjs
 */
const SYMBOLS = {
  spx:   { yahoo: '^GSPC', name: 'S&P500' },
  dji:   { yahoo: '^DJI',  name: '道瓊' },
  ndq:   { yahoo: '^IXIC', name: '那斯達克' },
  sox:   { yahoo: '^SOX',  name: '費半' },
  nkx:   { yahoo: '^N225', name: '日經225' },
  kospi: { yahoo: '^KS11', name: 'KOSPI' },
}

// 只留最近 250 筆（比照台股大盤 K 線慣例）；抓 2y 是為了讓 MA120 有足夠回看空間
const KEEP_DAYS = 250

// R6：重試——只對網路層錯誤與 5xx 重試，4xx 直接拋錯不重試
async function fetchYahoo(symbol, attempt = 1) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      return fetchYahoo(symbol, attempt + 1)
    }
    throw e
  }
  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      return fetchYahoo(symbol, attempt + 1)
    }
    throw new Error(`HTTP ${res.status}`)
  }
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error(json?.chart?.error?.description ?? 'no result')

  const { timestamp, indicators } = result
  const quote = indicators.quote[0]
  const tz = result.meta.exchangeTimezoneName ?? result.meta.timezone ?? 'UTC'

  const bars = []
  for (let i = 0; i < timestamp.length; i++) {
    if (quote.close[i] == null) continue  // 該日無資料（假日/停牌）
    bars.push({
      date:  new Date(timestamp[i] * 1000).toLocaleDateString('en-CA', { timeZone: tz }),
      open:  quote.open[i],
      high:  quote.high[i],
      low:   quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i] ?? 0,
    })
  }

  // R11：06:07 台北時段六個市場都休市所以一直是安全的，但 R7 開放手動補跑後，若剛好在
  // 該市場盤中觸發，最後一根 bar 會是未收盤的即時值，不能當日 K 存——盤中就剔除最新那根
  // （bars 此時是舊到新排序，最新的在陣列尾端）
  const period = result.meta?.currentTradingPeriod?.regular
  const nowSec = Math.floor(Date.now() / 1000)
  if (period && nowSec >= period.start && nowSec < period.end && bars.length > 0) {
    console.warn(`[global] ${symbol} 市場盤中，剔除未收盤的最後一根`)
    bars.pop()
  }

  return bars.reverse().slice(0, KEEP_DAYS)  // newest first
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')

  // 讀舊值：單一指數這次抓失敗時保留舊資料，不整份開天窗
  let indices = {}
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/global-indices.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.ok) indices = (await res.json()).indices ?? {}
  } catch { /* 首次執行，無舊值 */ }

  // R7：原本個別失敗只有 console.warn，run 仍是綠的，沒人會發現——
  // 日經/KOSPI 曾經因此靜默落後一整天。收集失敗清單，最後讓 run 標紅。
  const failed = []
  for (const [key, { yahoo, name }] of Object.entries(SYMBOLS)) {
    try {
      const bars = await fetchYahoo(yahoo)
      indices[key] = { name, bars, updatedAt: new Date().toISOString() }
      console.log(`[global] ${name}：${bars.length} 天，最新 ${bars[0]?.date}`)
    } catch (e) {
      console.warn(`[global] ${name} 抓取失敗，保留舊值：`, e.message)
      failed.push(name)
    }
  }

  const body = JSON.stringify({ updatedAt: new Date().toISOString(), indices })
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/snapshots/global-indices.json`
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body,
  })
  if (!res.ok) throw new Error(`Supabase 上傳失敗：${res.status} ${await res.text()}`)
  console.log('[global] global-indices.json 上傳完成（成功的部分已保住）')

  if (failed.length > 0) {
    throw new Error(`以下指數抓取失敗，保留舊值：${failed.join('、')}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
