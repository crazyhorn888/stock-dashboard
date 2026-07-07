/**
 * 補抓 indexHistory 中缺少 chips.margin_amount 的日期
 * 使用 TWSE MI_MARGN 端點（支援歷史日期查詢）
 *
 * 用法：
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx SNAPSHOT_URL=xxx node scripts/backfill-margin.mjs
 */

const SUPABASE_URL      = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const SNAPSHOT_URL      = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL
  ?? `${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('需要設定 SUPABASE_URL 和 SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchMarginForDate(dateYYYYMMDD) {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${dateYYYYMMDD}&selectType=MS`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const d   = await res.json()
    if (d?.stat !== 'OK') return null
    for (const t of d.tables ?? []) {
      for (const row of t.data ?? []) {
        if (String(row[0]).includes('融資金額')) {
          const val = parseFloat(String(row[5]).replace(/,/g, ''))
          return isNaN(val) ? null : Math.round(val / 100_000 * 100) / 100
        }
      }
    }
    return null
  } catch { return null }
}

async function main() {
  console.log('[backfill-margin] 下載 latest.json...')
  const res  = await fetch(SNAPSHOT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`latest.json 下載失敗：${res.status}`)
  const snap = await res.json()

  const history = snap.indexHistory ?? []
  const missing = history.filter(h => h.chips?.margin_amount == null)
  console.log(`[backfill-margin] 總筆數：${history.length}，缺 margin：${missing.length}`)

  let filled = 0
  for (const h of missing) {
    const dateStr = h.date.replace(/-/g, '')  // YYYY-MM-DD → YYYYMMDD
    const margin  = await fetchMarginForDate(dateStr)
    if (margin != null) {
      if (!h.chips) h.chips = {}
      h.chips.margin_amount = margin
      filled++
      console.log(`  ✅ ${h.date}  margin=${margin} 億`)
    } else {
      console.log(`  ⚠️  ${h.date}  無資料（非交易日或 API 無回傳）`)
    }
    await sleep(300)  // 避免 rate limit
  }

  console.log(`\n[backfill-margin] 補齊 ${filled}/${missing.length} 筆，上傳 latest.json...`)

  const payload  = JSON.stringify(snap)
  const sizeMB   = (payload.length / 1024 / 1024).toFixed(1)
  console.log(`[backfill-margin] 大小：${sizeMB} MB`)

  const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/latest.json`, {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':   'application/json',
      'x-upsert':       'true',
      'cache-control':  'no-cache',
    },
    body: payload,
  })

  if (!upRes.ok) {
    console.error('上傳失敗:', upRes.status, await upRes.text())
    process.exit(1)
  }
  console.log(`[backfill-margin] 完成！`)
}

main().catch(e => { console.error(e); process.exit(1) })
