/**
 * heat-drift-report.mjs
 *
 * 季度漂移檢查：用最新的 heat-history 重算各分級的歷史機率，跟 lib/marketHeat.ts
 * 裡寫死的 STATS 並列，超過門檻才報警。
 *
 * 為什麼是「報告」而不是「自動更新」：
 *   回測結果需要判斷，不是重算就好。2026-09 那次改動（P80 的方向翻轉、計分≥4 退休、
 *   外資押多那條腿拿掉）每一項都要先判斷是真訊號還是資料問題——當時若有自動更新，
 *   它會把 Phase2 Sheet 的欄位定義 bug 一起吃下去，把錯的機率寫上卡片。
 *   而且 STATS 寫死在 TypeScript，自動改也得走 deploy。
 *
 * 門檻的由來（2026-09-08 實測，資料截止在四個不同時間點重算）：
 *   風險側（20 日跌 5%）四年幾乎不動——強勢區 11/11/10/11%，排序從未翻轉，最大擺幅 8pp；
 *   報酬側（60 日賺 10%）會隨多空循環漂——健康區 21→36%，擺幅 15pp，但基準同步漂
 *   （24→33%），所以「與基準的差距」比絕對值穩定得多。
 *   因此：風險側門檻收緊（6pp），報酬側看「與基準的差距」而不是絕對值。
 *
 * 執行：node scripts/heat-drift-report.mjs
 *   需要 SUPABASE_URL（讀 public bucket，不需要 service key）
 *   --as-of YYYY-MM-DD  只用這天以前的資料重算（驗證警報邏輯、或回看當時的樣子）
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { compute, entrySignal } from './calc-heat.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://bliybylxjwemgzjvazyc.supabase.co'
const FINMIND = 'https://api.finmindtrade.com/api/v4/data'

// 風險側任一格差這麼多就要看：實測四年最大擺幅 8pp，收緊到 6pp
const RISK_TOL = 6
// 報酬側看「與基準的差距」變化，絕對值本身會隨多空循環漂
const EDGE_TOL = 8

const BANDS = [
  ['weak', 0, 30, '弱勢 ≤P30'],
  ['mid', 30, 50, '轉溫 P30-50'],
  ['good', 50, 80, '健康 P50-80'],
  ['strong', 80, 95, '強勢 P80-95'],
  ['hot', 95, 101, '極熱 ≥P95'],
]

async function getJson(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`)
  return res.json()
}

/** 台股大盤收盤價（算未來報酬用）。heat-history 沒有收盤價，得另外抓 */
async function fetchCloses(fromYear, toYear) {
  const out = {}
  for (let y = fromYear; y <= toYear; y++) {
    const j = await getJson(
      `${FINMIND}?dataset=TaiwanStockPrice&data_id=TAIEX&start_date=${y}-01-01&end_date=${y}-12-31`,
      `FinMind ${y}`)
    if (j.status !== 200) throw new Error(`FinMind ${y}: ${j.msg}`)
    for (const r of j.data) out[r.date] = r.close
    await new Promise(r => setTimeout(r, 2500))
  }
  return out
}

/** 從 lib/marketHeat.ts 讀出線上寫死的數字。解析失敗要大聲說，不能默默跟空值比 */
function readShipped() {
  const src = readFileSync(join(__dirname, '..', 'lib', 'marketHeat.ts'), 'utf-8')
  const block = src.slice(src.indexOf('const STATS'), src.indexOf('export const HEAT_BASELINE'))
  const stats = {}
  for (const m of block.matchAll(/(\w+)\s*:\s*\{\s*up:\s*(\d+),\s*down:\s*(\d+),\s*n:\s*(\d+)/g)) {
    stats[m[1]] = { up: +m[2], down: +m[3], n: +m[4] }
  }
  const bl = src.match(/HEAT_BASELINE\s*=\s*\{\s*up:\s*(\d+),\s*down:\s*(\d+),\s*n:\s*(\d+)/)
  if (!Object.keys(stats).length || !bl) {
    throw new Error('無法從 lib/marketHeat.ts 解析出 STATS / HEAT_BASELINE'
      + '——格式可能改過，請同步更新這支腳本的 regex')
  }
  return { stats, baseline: { up: +bl[1], down: +bl[2], n: +bl[3] } }
}

async function main() {
  const shipped = readShipped()
  let history = await getJson(
    `${SUPABASE_URL}/storage/v1/object/public/snapshots/heat-history.json`, 'heat-history')
  const asOfIdx = process.argv.indexOf('--as-of')
  if (asOfIdx > 0) {
    const cut = process.argv[asOfIdx + 1]
    history = Object.fromEntries(Object.entries(history).filter(([d]) => d <= cut))
    console.log(`（--as-of ${cut}：只用這天以前的 ${Object.keys(history).length} 天）`)
  }
  const dates = Object.keys(history).sort()
  const y0 = +dates[0].slice(0, 4), y1 = +dates[dates.length - 1].slice(0, 4)
  const closeBy = await fetchCloses(y0, y1)

  const { dates: ds, heat } = compute(history)
  const C = ds.map(d => closeBy[d])
  const N = ds.length
  const mdd = (i, h) => {
    const w = C.slice(i + 1, i + 1 + h)
    return w.length === h && w.every(v => v != null) ? (Math.min(...w) - C[i]) / C[i] * 100 : null
  }
  const fwd = (i, h) => (i + h < N && C[i + h] != null && C[i] != null)
    ? (C[i + h] - C[i]) / C[i] * 100 : null
  // 要能算 60 日報酬才納入樣本，否則最近兩個月會被算成「沒賺到 10%」
  const V = [...Array(N).keys()].filter(i => heat[i] != null && C[i] != null && i + 62 < N)
  const RISK = i => (mdd(i, 20) ?? 0) <= -5
  const UP = i => (fwd(i, 60) ?? -9) >= 10 && (mdd(i, 20) ?? -9) > -5
  const rate = (g, f) => g.length ? Math.round(100 * g.filter(f).length / g.length) : 0

  const entry = entrySignal(ds, heat, closeBy)
  const now = {}
  for (const [key, lo, hi] of BANDS) {
    const g = V.filter(i => heat[i] >= lo && heat[i] < hi)
    now[key] = { up: rate(g, UP), down: rate(g, RISK), n: g.length }
  }
  const ge = V.filter(i => entry[i])
  now.entry = { up: rate(ge, UP), down: rate(ge, RISK), n: ge.length }
  const base = { up: rate(V, UP), down: rate(V, RISK), n: V.length }

  console.log(`市場熱度 STATS 漂移檢查　${ds[V[0]]} ~ ${ds[V[V.length - 1]]}　樣本 ${V.length} 天`)
  console.log(`（線上校準時是 ${shipped.baseline.n} 天，本次多了 ${V.length - shipped.baseline.n} 天）\n`)

  const alerts = []
  const pad = (s, n) => String(s).padStart(n)
  console.log('  ' + '狀態'.padEnd(13)
    + '線上 跌5%'.padStart(11) + '最新'.padStart(7) + '差'.padStart(7)
    + '　線上 賺10%'.padStart(13) + '最新'.padStart(7) + '差'.padStart(7))
  console.log('  ' + '-'.repeat(70))
  for (const [key, , , label] of [...BANDS, ['entry', 0, 0, '進場訊號']]) {
    const s = shipped.stats[key], c = now[key]
    if (!s || !c) continue
    const dDown = c.down - s.down, dUp = c.up - s.up
    if (Math.abs(dDown) >= RISK_TOL) alerts.push(`${label} 的跌 5% 由 ${s.down}% 變成 ${c.down}%（差 ${dDown > 0 ? '+' : ''}${dDown}pp）`)
    // 報酬側看「與基準的差距」有沒有變
    const edgeOld = s.up - shipped.baseline.up, edgeNew = c.up - base.up
    if (Math.abs(edgeNew - edgeOld) >= EDGE_TOL) {
      alerts.push(`${label} 的「賺 10% 減基準」由 ${edgeOld > 0 ? '+' : ''}${edgeOld}pp 變成 ${edgeNew > 0 ? '+' : ''}${edgeNew}pp`)
    }
    const mark = d => Math.abs(d) >= RISK_TOL ? ' ⚠️' : '  '
    console.log('  ' + label.padEnd(13)
      + pad(s.down + '%', 11) + pad(c.down + '%', 7) + pad((dDown > 0 ? '+' : '') + dDown, 5) + mark(dDown)
      + pad(s.up + '%', 11) + pad(c.up + '%', 7) + pad((dUp > 0 ? '+' : '') + dUp, 5))
  }
  console.log('  ' + '基準'.padEnd(13)
    + pad(shipped.baseline.down + '%', 11) + pad(base.down + '%', 7)
    + pad((base.down - shipped.baseline.down > 0 ? '+' : '') + (base.down - shipped.baseline.down), 5) + '  '
    + pad(shipped.baseline.up + '%', 11) + pad(base.up + '%', 7)
    + pad((base.up - shipped.baseline.up > 0 ? '+' : '') + (base.up - shipped.baseline.up), 5))

  // 風險排序有沒有翻轉——U 型結構是整張卡的立論基礎，翻了就要重新設計而不只是改數字
  const order = BANDS.filter(([k]) => now[k].n >= 30)
    .map(([k, , , label]) => [label, now[k].down]).sort((a, b) => a[1] - b[1])
  console.log(`\n  風險排序（最安全 → 最危險）：${order.map(([l, v]) => `${l.split(' ')[0]}${v}%`).join(' < ')}`)
  if (order[0][0].split(' ')[0] !== '強勢') {
    alerts.push(`風險排序翻轉：最安全的不再是強勢區，而是「${order[0][0]}」`)
  }

  if (alerts.length) {
    console.log(`\n⚠️  ${alerts.length} 項超過門檻，需要人工判斷是不是真的變了：`)
    for (const a of alerts) console.log(`   · ${a}`)
    console.log('\n   下一步：確認不是資料源問題（見 AC-HT-B8 的教訓），')
    console.log('   跑三段外樣本確認不是單一期間的雜訊，再決定要不要改 lib/marketHeat.ts')
    process.exit(1)
  }
  console.log('\n✅ 全部在門檻內，線上的數字還站得住，不需要動 lib/marketHeat.ts')
}

main().catch(e => { console.error('[drift]', e.message); process.exit(1) })
