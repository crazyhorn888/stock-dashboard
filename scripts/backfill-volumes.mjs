/**
 * 補抓今日成交量，寫入 ohlc.json v[] 陣列
 *
 * 來源：
 *   TWSE → STOCK_DAY_ALL（TradeVolume ÷ 1000 = 張）
 *   TPEX → tpex_mainboard_daily_close_quotes（TradingShares ÷ 1000 = 張）
 *
 * 用法：
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx \
 *   NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL=xxx \
 *   node scripts/backfill-volumes.mjs
 */

const SUPABASE_URL      = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const SNAPSHOT_URL      = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL
  ?? `${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`
const OHLC_URL          = SNAPSHOT_URL.replace('latest.json', 'ohlc.json')

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('需要設定 SUPABASE_URL 和 SUPABASE_SERVICE_KEY')
  process.exit(1)
}

async function uploadToSupabase(path, body) {
  const url = `${SUPABASE_URL}/storage/v1/object/snapshots/${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body,
  })
  if (!res.ok) throw new Error(`上傳失敗 (${path})：${res.status} ${await res.text()}`)
}

async function main() {
  // 1. 下載 latest.json（確認 stocksDate）
  console.log('[backfill-volumes] 下載 latest.json...')
  const snapRes = await fetch(SNAPSHOT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!snapRes.ok) throw new Error(`latest.json 下載失敗：${snapRes.status}`)
  const snap = await snapRes.json()
  const stocksDate = snap.stocksDate ?? '(未知)'
  console.log(`[backfill-volumes] stocksDate=${stocksDate}，股票數=${snap.stocks?.length}`)

  // 2. 下載 ohlc.json
  console.log('[backfill-volumes] 下載 ohlc.json...')
  const ohlcRes = await fetch(OHLC_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!ohlcRes.ok) throw new Error(`ohlc.json 下載失敗：${ohlcRes.status}`)
  const ohlc = await ohlcRes.json()
  console.log(`[backfill-volumes] ohlc.json 載入，${Object.keys(ohlc.bars).length} 支`)

  // 3. 抓 TWSE STOCK_DAY_ALL → code: volume
  console.log('[backfill-volumes] 抓 TWSE STOCK_DAY_ALL...')
  const twseData = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => [])
  const twseVol = {}
  for (const r of Array.isArray(twseData) ? twseData : []) {
    if (/^\d{4}$/.test(r.Code) && r.TradeVolume) {
      const vol = Math.round(parseFloat(r.TradeVolume.replace(/,/g, '') || '0') / 1000)
      if (vol > 0) twseVol[r.Code] = vol
    }
  }
  console.log(`[backfill-volumes] TWSE volume：${Object.keys(twseVol).length} 支`)

  // 4. 抓 TPEX → code: volume
  console.log('[backfill-volumes] 抓 TPEX...')
  const tpexData = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => [])
  const tpexVol = {}
  for (const r of Array.isArray(tpexData) ? tpexData : []) {
    if (/^\d{4}$/.test(r.SecuritiesCompanyCode) && r.TradingShares) {
      const vol = Math.round(parseFloat(r.TradingShares.replace(/,/g, '') || '0') / 1000)
      if (vol > 0) tpexVol[r.SecuritiesCompanyCode] = vol
    }
  }
  console.log(`[backfill-volumes] TPEX volume：${Object.keys(tpexVol).length} 支`)

  const allVol = { ...twseVol, ...tpexVol }
  console.log(`[backfill-volumes] 合計 volume：${Object.keys(allVol).length} 支`)

  // 5. 更新 ohlc.bars — 只補尚未有 v[] 的項目
  let updated = 0, skipped = 0, newEntry = 0
  for (const [code, vol] of Object.entries(allVol)) {
    const bar = ohlc.bars[code]
    if (bar) {
      if ((bar.v?.length ?? 0) > 0) { skipped++; continue }
      bar.v = [vol]
      updated++
    } else {
      // 股票不在 ohlc.json → 建立 v-only 新 entry
      ohlc.bars[code] = { v: [vol] }
      newEntry++
    }
  }
  console.log(`[backfill-volumes] 更新=${updated}, 已有v跳過=${skipped}, 新增entry=${newEntry}`)

  // 6. 上傳 ohlc.json
  console.log('[backfill-volumes] 上傳 ohlc.json...')
  ohlc.updatedAt = new Date().toISOString()
  await uploadToSupabase('ohlc.json', JSON.stringify(ohlc))
  console.log('[backfill-volumes] 完成！')
}

main().catch(e => { console.error(e); process.exit(1) })
