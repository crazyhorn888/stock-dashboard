/**
 * seed-sectors.mjs
 * 一次性補全快照中所有股票的 sector 欄位
 *
 * 策略：
 * 1. 從快照的 sectorHistory（T86 歷史）建立 code → sectorName 對照
 * 2. 用今日 T86 補充（涵蓋更多最近有活動的股票）
 * 3. 用 t187ap03_L 產業別代碼作為 fallback（已知代碼清單）
 *
 * 執行：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed-sectors.mjs
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// t187ap03_L 產業別代碼 → T86 板塊名稱對照表（實測對照，台積電=24/半導體業、長榮=15/航運業 等）
const INDUSTRY_CODE_MAP = {
  '01': '水泥工業',  '02': '食品工業',   '03': '塑膠工業',   '04': '紡織纖維',
  '05': '電機機械',  '06': '電器電纜',   '08': '玻璃陶瓷',   '09': '造紙工業',
  '10': '鋼鐵工業',  '11': '橡膠工業',   '12': '汽車工業',   '14': '建材營造',
  '15': '航運業',    '16': '觀光餐旅',   '17': '金融保險',   '18': '貿易百貨',
  '20': '其他',      '21': '化學工業',   '22': '生技醫療',   '23': '綜合',
  '24': '半導體業',  '25': '光電業',     '26': '其他電子業', '27': '通信網路業',
  '28': '電子零組件業', '29': '電子通路業', '30': '資訊服務業', '31': '電腦及週邊設備業',
  '35': '油電燃氣',  '36': '資訊服務業', '37': '觀光餐旅',   '38': '汽車工業',
  '91': '其他',
}

function parseNum(v) {
  return parseFloat(String(v).replace(/,/g, '')) || 0
}

function todayTWDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

/** 從 T86 日期取得 code → sectorName 對照（只含當日有法人活動的股票）*/
async function buildSectorMapFromT86(yyyymmdd) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${yyyymmdd}&selectType=ALL`
  const sectorMap = {}
  try {
    const d = await fetchJSON(url)
    if (d?.stat !== 'OK' || !Array.isArray(d.data)) return sectorMap
    let currentSector = ''
    for (const row of d.data) {
      const code = String(row[0]).trim()
      const name = String(row[1]).trim()
      if (name.includes('小計')) {
        currentSector = name.replace(/\s*小計$/, '').trim()
      } else if (/^\d{4}$/.test(code) && currentSector) {
        if (!sectorMap[code]) sectorMap[code] = currentSector
      }
    }
    console.log(`[seed-sectors] T86 對照建立：${Object.keys(sectorMap).length} 支`)
  } catch (e) {
    console.warn('[seed-sectors] T86 抓取失敗:', e.message)
  }
  return sectorMap
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

  // 2. 從 sectorHistory 建立 code → sector 對照（最準確，T86 本身的分組）
  const sectorMapFromHistory = {}
  for (const day of (snapshot.sectorHistory ?? [])) {
    for (const row of day.rows) {
      for (const stock of row.stocks) {
        if (!sectorMapFromHistory[stock.code]) {
          sectorMapFromHistory[stock.code] = row.name
        }
      }
    }
  }
  console.log(`[seed-sectors] sectorHistory 對照：${Object.keys(sectorMapFromHistory).length} 支`)

  // 3. 今日 T86（補充 sectorHistory 沒有的近期股票）
  const today = todayTWDate().replace(/-/g, '')
  const t86Map = await buildSectorMapFromT86(today)

  // 4. t187ap03_L fallback（用數字代碼+對照表 補充仍未分類的股票）
  let listMap = {}
  try {
    const list = await fetchJSON('https://openapi.twse.com.tw/v1/opendata/t187ap03_L')
    for (const r of (Array.isArray(list) ? list : [])) {
      const code = String(r['公司代號'] ?? '').trim()
      const secCode = String(r['產業別'] ?? '').trim()
      if (/^\d{4}$/.test(code) && INDUSTRY_CODE_MAP[secCode]) {
        listMap[code] = INDUSTRY_CODE_MAP[secCode]
      }
    }
    console.log(`[seed-sectors] t187ap03_L fallback：${Object.keys(listMap).length} 支`)
  } catch (e) {
    console.warn('[seed-sectors] t187ap03_L 失敗，跳過:', e.message)
  }

  // 5. 合併（優先順序：sectorHistory > 今日T86 > t187ap03_L）
  const finalMap = { ...listMap, ...t86Map, ...sectorMapFromHistory }
  console.log(`[seed-sectors] 合併後對照：${Object.keys(finalMap).length} 支`)

  // 6. 補全每支股票的 sector 欄位
  let updated = 0
  const stocks = snapshot.stocks.map(s => {
    const sec = finalMap[s.code]
    if (sec && s.sector !== sec) {
      updated++
      return { ...s, sector: sec }
    }
    return s
  })
  console.log(`[seed-sectors] 更新 ${updated} 支股票的 sector`)

  // 7. 存到 data/latest.json
  const newSnapshot = { ...snapshot, stocks }
  const outDir = join(__dirname, '..', 'data')
  mkdirSync(outDir, { recursive: true })
  const raw = JSON.stringify(newSnapshot)
  writeFileSync(join(outDir, 'latest.json'), raw)

  // 8. 上傳 Supabase
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
