/**
 * 從現有快照的 closes[] 推算偽 OHLC，上傳至 Supabase Storage ohlc.json
 *
 * 背景：TWSE 的 STOCK_DAY_ALL 歷史端點不支援日期過濾，永遠回傳當日資料，
 * 無法用於批量歷史補抓。改以 snapshot 現有 closes[] 推算：
 *   open  = 前日收盤（closes[i+1]），最舊一筆 open = close
 *   high  = max(open, close)
 *   low   = min(open, close)
 * 蠟燭體方向正確、無上下影線，足以顯示趨勢。
 * Cron 從執行後每日寫入真實 OHLC（open/high/low from STOCK_DAY_ALL），逐漸覆蓋歷史推算值。
 *
 * 用法：
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx SNAPSHOT_URL=xxx node scripts/backfill-ohlc.mjs
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const SNAPSHOT_URL = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL
  ?? `${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('需要設定 SUPABASE_URL 和 SUPABASE_SERVICE_KEY')
  process.exit(1)
}

async function main() {
  console.log('[backfill] 下載 latest.json...')
  const res = await fetch(SNAPSHOT_URL, { cache: 'no-cache', headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`latest.json 下載失敗：${res.status}`)
  const snap = await res.json()
  console.log('[backfill] 股票總數:', snap.stocks.length)

  const bars = {}
  let skipped = 0

  for (const s of snap.stocks) {
    const closes = s.closes
    if (!closes || closes.length < 2) { skipped++; continue }

    const o = [], h = [], l = []
    for (let i = 0; i < closes.length; i++) {
      const close = closes[i]
      const open  = closes[i + 1] ?? close  // 前日收盤；最舊一筆 open = close
      o.push(open)
      h.push(Math.max(open, close))
      l.push(Math.min(open, close))
    }
    bars[s.code] = { o, h, l }
  }

  console.log(`[backfill] 推算完成：${Object.keys(bars).length} 支，跳過 ${skipped} 支（資料不足）`)

  // 上傳 ohlc.json
  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), bars })
  const sizeMB = (payload.length / 1024 / 1024).toFixed(1)
  console.log(`[backfill] 上傳 ohlc.json，大小：${sizeMB} MB`)

  const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/ohlc.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body: payload,
  })
  if (!upRes.ok) {
    console.error('上傳失敗:', upRes.status, await upRes.text())
    process.exit(1)
  }
  console.log(`[backfill] 完成！${SUPABASE_URL}/storage/v1/object/public/snapshots/ohlc.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
