/**
 * scan-concept-coverage.mjs
 * 一次性腳本（不進 GitHub Actions pipeline）：找出「T86 近20日活躍但未被 concept-sectors.json 分類」的個股
 *
 * 做法：
 * 1. 從 Supabase 快照的 indexHistory 取近 20 個交易日
 * 2. 逐日呼叫 TWSE T86（間隔 1.5 秒），累加每檔個股的三大法人買賣量（股數，未換算億元）
 * 3. 排除已在 data/concept-sectors.json 的個股，依累計活動量排序
 * 4. 輸出清單供人工/AI 逐批分類
 *
 * 執行：
 *   SUPABASE_URL=... node scripts/scan-concept-coverage.mjs
 */
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseNum(v) {
  return parseFloat(String(v).replace(/,/g, '')) || 0
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

async function fetchT86Activity(dateYYYYMMDD) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateYYYYMMDD}&selectType=ALL`
  try {
    const d = await fetchJSON(url)
    if (d?.stat !== 'OK' || !Array.isArray(d.data)) return []
    return d.data
      .filter(row => /^\d{4}$/.test(String(row[0]).trim()))
      .map(row => {
        const buyVol  = parseNum(row[2]) + parseNum(row[5]) + parseNum(row[8])  + parseNum(row[12]) + parseNum(row[15])
        const sellVol = parseNum(row[3]) + parseNum(row[6]) + parseNum(row[9])  + parseNum(row[13]) + parseNum(row[16])
        return { code: String(row[0]).trim(), name: String(row[1]).trim(), activity: buyVol + sellVol }
      })
  } catch (e) {
    console.warn(`[scan] T86 ${dateYYYYMMDD} 抓取失敗:`, e.message)
    return []
  }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL 未設定')

  console.log('[scan] 下載現有快照取得交易日曆...')
  let indexHistory
  const marketRes = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/market.json`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (marketRes.ok) {
    indexHistory = (await marketRes.json()).indexHistory
  } else {
    console.log('[scan] market.json 尚未產生（pipeline 未跑過），改用 latest.json fallback')
    const latestRes = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!latestRes.ok) throw new Error(`latest.json 下載失敗：${latestRes.status}`)
    indexHistory = (await latestRes.json()).indexHistory
  }

  const dates = (indexHistory ?? []).map(r => r.date).slice(0, 20)
  if (dates.length === 0) throw new Error('indexHistory 為空，無法取得交易日曆')
  console.log(`[scan] 取得 ${dates.length} 個交易日：${dates[dates.length - 1]} ~ ${dates[0]}`)

  const conceptData = JSON.parse(
    await import('fs').then(fs => fs.readFileSync(join(__dirname, '..', 'data', 'concept-sectors.json'), 'utf-8'))
  )
  const covered = new Set(Object.keys(conceptData.stocks))
  console.log(`[scan] 現有已分類：${covered.size} 支`)

  const activityMap = {} // code -> { name, activity }
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]
    if (i > 0) await new Promise(r => setTimeout(r, 1500))
    const rows = await fetchT86Activity(date.replace(/-/g, ''))
    for (const r of rows) {
      if (!activityMap[r.code]) activityMap[r.code] = { name: r.name, activity: 0 }
      activityMap[r.code].activity += r.activity
    }
    console.log(`[scan]   ${date}：${rows.length} 檔有 T86 活動`)
  }

  const isETF = code => code.startsWith('00')
  const ranked = Object.entries(activityMap)
    .filter(([code]) => !isETF(code))
    .map(([code, v]) => ({ code, name: v.name, activity: Math.round(v.activity), covered: covered.has(code) }))
    .sort((a, b) => b.activity - a.activity)

  const top800 = ranked.slice(0, 800)
  const top800CoveredCount = top800.filter(r => r.covered).length
  const uncovered = ranked.filter(r => !r.covered)

  console.log(`[scan] 未分類個股：${uncovered.length} 支（非ETF總活躍 ${ranked.length} 支）`)
  console.log(`[scan] 前800活躍個股覆蓋率：${top800CoveredCount}/800 = ${(top800CoveredCount / 800 * 100).toFixed(1)}%`)

  const outPath = join(__dirname, '..', 'data', 'concept-coverage-scan.json')
  writeFileSync(outPath, JSON.stringify({
    scannedAt: new Date().toISOString(),
    dateRange: [dates[dates.length - 1], dates[0]],
    totalActiveExETF: ranked.length,
    coveredBefore: covered.size,
    top800CoverageRate: top800CoveredCount / 800,
    uncovered,
  }, null, 2))
  console.log(`[scan] 輸出：${outPath}（前 20 檔未分類：）`)
  console.table(uncovered.slice(0, 20))
}

main().catch(e => { console.error(e); process.exit(1) })
