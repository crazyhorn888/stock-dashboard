/**
 * backfill-margin-shares.mjs
 * 一次性回補 indexHistory 各日的 chips.margin_share / short_share（融資、融券張數）。
 *
 * 背景：這兩個欄位 2026-09-04 才開始抓（AC-PL-1）。高點反轉的「軋空燃料枯竭」條件
 * 需要券資比的 60 日 Z-Score，等 pipeline 自然累積要三個月，期間該條件永遠不成立。
 * FinMind 的 TaiwanStockTotalMarginPurchaseShortSale 有 2024 年起的全市場資料，
 * 直接回補即可讓條件立刻生效。
 *
 * 執行：SUPABASE_URL=... SUPABASE_SERVICE_KEY=... FINMIND_TOKEN=... node scripts/backfill-margin-shares.mjs
 *      加 --dry-run 只印統計不上傳
 */
const DRY = process.argv.includes('--dry-run')
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const FINMIND_TOKEN = process.env.FINMIND_TOKEN
if (!SUPABASE_URL) throw new Error('SUPABASE_URL 未設定')
if (!FINMIND_TOKEN) throw new Error('FINMIND_TOKEN 未設定')
if (!DRY && !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY 未設定（或加 --dry-run）')

const pub = path => `${SUPABASE_URL}/storage/v1/object/public/snapshots/${path}`

async function main() {
  // 1) FinMind 全市場融資融券（張數）
  const start = '2024-01-01'
  const res = await fetch(
    `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockTotalMarginPurchaseShortSale&start_date=${start}&token=${FINMIND_TOKEN}`
  )
  const fm = await res.json()
  if (fm.msg !== 'success') throw new Error(`FinMind: ${fm.msg}`)

  const shares = {}   // date → { marginShare, shortShare }
  for (const d of fm.data) {
    shares[d.date] ??= {}
    if (d.name === 'MarginPurchase') shares[d.date].marginShare = d.TodayBalance
    if (d.name === 'ShortSale')      shares[d.date].shortShare  = d.TodayBalance
  }
  console.log(`[backfill] FinMind 取得 ${Object.keys(shares).length} 天融資融券張數`)

  // 2) 兩份都要回補：
  //    latest.json —— fetch-daily.mjs 的 downloadSnapshot() 讀這份，不補的話下一輪 pipeline
  //                   會用沒有張數的舊資料重新派生 market.json，回補等於白做
  //    market.json —— 前端實際讀的檔，補了才會立刻生效（不用等下次 pipeline）
  const fill = (hist, tag) => {
    let filled = 0, skipped = 0, missing = 0
    for (const row of hist) {
      if (!row.chips) { skipped++; continue }                       // 該日沒有 chips 就不動
      if (row.chips.margin_share != null && row.chips.short_share != null) { skipped++; continue }
      const s = shares[row.date]
      if (!s?.marginShare || !s?.shortShare) { missing++; continue }
      row.chips.margin_share = s.marginShare
      row.chips.short_share  = s.shortShare
      filled++
    }
    const withRatio = hist.filter(r => r.chips?.margin_share && r.chips?.short_share)
    console.log(`[backfill] ${tag}：回補 ${filled} 天 · 跳過 ${skipped} · FinMind 缺 ${missing} · 券資比可用 ${withRatio.length} 天（條件③需 60）`)
    return { filled, hist }
  }

  const upload = async (name, payload) => {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/${name}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body: JSON.stringify(payload),
    })
    if (!r.ok) throw new Error(`${name} 上傳失敗 HTTP ${r.status}: ${await r.text()}`)
    console.log(`[backfill] ${name} 上傳完成`)
  }

  let total = 0
  for (const name of ['latest.json', 'market.json']) {
    const snap = await (await fetch(pub(name), { cache: 'no-store' })).json()
    const { filled } = fill(snap.indexHistory ?? [], name)
    total += filled
    if (DRY || filled === 0) continue
    await upload(name, snap)
  }

  if (DRY) console.log('[backfill] --dry-run，未上傳')
  else if (total === 0) console.log('[backfill] 無需回補')
}

main().catch(e => { console.error('[backfill] 失敗：', e.message); process.exit(1) })
