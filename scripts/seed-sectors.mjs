/**
 * seed-sectors.mjs
 * 一次性補全快照中所有股票的 sector 欄位（來自 TWSE t187ap03_L 產業類別）
 * 不需要等每日排程，不受 Guard 限制，執行後立即讓 SectorPanel 顯示全部個股
 *
 * 執行：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed-sectors.mjs
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')

  // 1. 下載現有快照
  console.log('[seed-sectors] 下載現有快照...')
  const snapRes = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!snapRes.ok) throw new Error(`快照下載失敗：${snapRes.status}`)
  const snapshot = await snapRes.json()
  console.log(`[seed-sectors] 快照載入，${snapshot.stocks.length} 支股票`)

  // 2. 取得 t187ap03_L（上市公司基本資料，含產業類別）
  console.log('[seed-sectors] 抓取 t187ap03_L...')
  const list = await fetchJSON('https://openapi.twse.com.tw/v1/opendata/t187ap03_L')
  const sectorMap = {}
  for (const r of (Array.isArray(list) ? list : [])) {
    const code = String(r['公司代號'] ?? r.Code ?? '').trim()
    const sec  = String(r['產業類別'] ?? r.IndustryCategory ?? '').trim()
    if (/^\d{4}$/.test(code) && sec) sectorMap[code] = sec
  }
  console.log(`[seed-sectors] 產業對照：${Object.keys(sectorMap).length} 支`)

  // 3. 補全每支股票的 sector 欄位
  let updated = 0
  const stocks = snapshot.stocks.map(s => {
    const sec = sectorMap[s.code]
    if (sec && s.sector !== sec) { updated++; return { ...s, sector: sec, industry: s.industry === '—' ? sec : s.industry } }
    return s
  })
  console.log(`[seed-sectors] 更新 ${updated} 支股票的 sector`)

  // 4. 存到 data/latest.json
  const newSnapshot = { ...snapshot, stocks }
  const outDir = join(__dirname, '..', 'data')
  mkdirSync(outDir, { recursive: true })
  const raw = JSON.stringify(newSnapshot)
  writeFileSync(join(outDir, 'latest.json'), raw)

  // 5. 上傳 Supabase
  console.log('[seed-sectors] 上傳 Supabase...')
  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/latest.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: raw,
  })
  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    throw new Error(`Supabase 上傳失敗：${uploadRes.status} ${err}`)
  }
  console.log(`[seed-sectors] 完成！${updated} 支股票 sector 已補全並上傳`)
}

main().catch(e => { console.error(e); process.exit(1) })
