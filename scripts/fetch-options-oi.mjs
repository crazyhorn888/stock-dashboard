/**
 * fetch-options-oi.mjs
 * 功能二十三（AC-OI-A1~A10）：抓期交所台指選擇權（TXO）逐履約價未沖銷量，
 * 每個到期別只留 Call/Put 各前三大，併同各契約最後結算價寫進 Supabase 的 options-oi.json。
 *
 * 零依賴（只用內建 fetch），比照 fetch-global.mjs，不碰 latest.json / 主 pipeline。
 *
 * 執行：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/fetch-options-oi.mjs
 *   OPTIONS_OI_BACKFILL=15 node scripts/fetch-options-oi.mjs   # 一次性回補近 15 個交易日
 *   OPTIONS_OI_DRY_RUN=1 ...                                    # 只抓不寫，先看產出
 *
 * ⚠️ 兩個必須遵守的坑（AC-OI-A2 / A3）：
 *  1. 盤中查當日，未沖銷契約量整欄是空的（2026-09-08 實測 13:07 與 14:33 皆為 0，14:37 才有值）。
 *     必須「出現盤後交易時段成交量欄」且「OI 總量 > 0」才寫入，否則整批不寫、交給後面班次補。
 *     只追加不重算的檔案一旦寫進整排 0，那天就永遠是壞的（2026-09-07 calc-heat 中毒事故同型）。
 *  2. 盤中版表格比收盤版少兩欄成交量，欄位一律用「名稱」比對，不能用位置索引——
 *     本次開發實際踩過：用固定索引在盤中版讀出 195,760 這個看似合理的假數字。
 */

import { pathToFileURL } from 'url'

const REPORT_URL = 'https://www.taifex.com.tw/cht/3/optDailyMarketReport'
const FSP_URL = 'https://www.taifex.com.tw/cht/5/optIndxFSP'
const COMMODITY = 'TXO'
const TOP_N = 3        // AC-OI-A4：每個到期別只留 Call/Put 各前三大
const KEEP_DAYS = 60   // AC-OI-A7：保留 60 個交易日滾動（約 60 KB）

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Content-Type': 'application/x-www-form-urlencoded',
}

// ── 共用小工具 ──────────────────────────────────────────────

/** 台北時間的今天（YYYY-MM-DD）。Actions runner 是 UTC，不能直接用本地日期 */
function todayTPE() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const isWeekend = iso => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}

/** 只對網路層錯誤與 5xx 重試，4xx 直接拋（比照 fetch-global.mjs 的 R6 慣例） */
async function postForm(url, params, referer, attempt = 1) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { ...HEADERS, Referer: referer },
      body: new URLSearchParams(params).toString(),
    })
    if (res.ok) return await res.text()
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      return postForm(url, params, referer, attempt + 1)
    }
    throw e
  }
  if (res.status >= 500 && attempt < 3) {
    await new Promise(r => setTimeout(r, attempt * 2000))
    return postForm(url, params, referer, attempt + 1)
  }
  throw new Error(`HTTP ${res.status}`)
}

const stripTags = html => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, '').trim()

/**
 * 解析期交所的單層表頭表格 → { columns: string[], rows: string[][] }
 * 期交所這兩張表的 thead 都只有一層 <th>（無 colspan），所以不需要處理多層表頭合併。
 */
function parseTable(html) {
  const theadMatch = html.match(/<thead[\s\S]*?<\/thead>/i)
  if (!theadMatch) return null
  const columns = [...theadMatch[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => stripTags(m[1]))
  if (!columns.length) return null

  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/i)
  if (!tbodyMatch) return { columns, rows: [] }
  const rows = [...tbodyMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(tr => [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(td => stripTags(td[1])))
    .filter(cells => cells.length >= columns.length - 2)
  return { columns, rows }
}

/** 依欄位名稱（部分比對）取索引；找不到回 -1。AC-OI-A3：不得用位置索引 */
const colIndex = (columns, ...keywords) =>
  columns.findIndex(c => keywords.every(k => c.includes(k)))

const toNum = s => {
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

// ── 抓取 ────────────────────────────────────────────────────

/**
 * 抓某一交易日的選擇權 OI。
 * 回傳 { [契約代號]: { exp, C:[[履約價,口數]...], P:[...] } }；
 * 未就緒（盤中版或 OI 全 0）一律回 null，呼叫端不得寫入。
 */
export async function fetchOptionsOI(dateISO) {
  const queryDate = dateISO.replace(/-/g, '/')
  const html = await postForm(REPORT_URL, {
    queryDate, commodity_id: COMMODITY, commodity_id2: '',
    queryType: '2', marketCode: '0', MarketCode: '0', dateaddcnt: '',
  }, REPORT_URL)

  const table = parseTable(html)
  if (!table || !table.rows.length) return null

  const { columns, rows } = table

  // AC-OI-A2 第一關：收盤版才有「盤後交易時段成交量」欄，盤中版只有「*成交量」
  if (colIndex(columns, '盤後交易時段', '成交量') === -1) return null

  const iExp = colIndex(columns, '到期月份')
  const iExpDate = colIndex(columns, '契約到期日')
  const iStrike = colIndex(columns, '履約價')
  const iCP = colIndex(columns, '買賣權')
  const iOI = colIndex(columns, '未沖銷')
  if ([iExp, iExpDate, iStrike, iCP, iOI].some(i => i === -1)) {
    throw new Error(`欄位比對失敗：${columns.join('|')}`)
  }

  const byCode = {}
  let totalOI = 0
  for (const cells of rows) {
    const code = cells[iExp]
    const oi = toNum(cells[iOI])
    const strike = toNum(cells[iStrike])
    const cp = cells[iCP]
    if (!code || oi == null || strike == null) continue
    totalOI += oi
    if (oi <= 0) continue

    const rawExp = cells[iExpDate]                       // 20260909
    if (!/^\d{8}$/.test(rawExp)) continue
    const exp = `${rawExp.slice(0, 4)}-${rawExp.slice(4, 6)}-${rawExp.slice(6, 8)}`
    const key = cp === 'Call' ? 'C' : cp === 'Put' ? 'P' : null
    if (!key) continue

    byCode[code] ??= { exp, C: [], P: [] }
    byCode[code][key].push([strike, oi])
  }

  // AC-OI-A2 第二關：OI 全 0 代表資料還沒發布，整批不寫
  if (totalOI <= 0) return null

  for (const rec of Object.values(byCode)) {
    rec.C = rec.C.sort((a, b) => b[1] - a[1]).slice(0, TOP_N)
    rec.P = rec.P.sort((a, b) => b[1] - a[1]).slice(0, TOP_N)
  }
  return Object.keys(byCode).length ? byCode : null
}

/** AC-OI-A5：各契約的最後結算日與最後結算價 */
export async function fetchSettlements(fromISO, toISO) {
  const html = await postForm(FSP_URL, {
    queryStartDate: fromISO.replace(/-/g, '/'), queryEndDate: toISO.replace(/-/g, '/'),
    commodity_id: COMMODITY, queryType: '2', MarketCode: '0',
  }, FSP_URL)
  const table = parseTable(html)
  if (!table) return {}

  const iDate = colIndex(table.columns, '最後', '結算日')
  const iCode = colIndex(table.columns, '契約')
  const iPrice = table.columns.findIndex(c => c.includes('臺指選擇權') || c.includes('TXO'))
  if (iDate === -1 || iCode === -1 || iPrice === -1) return {}

  const out = {}
  for (const cells of table.rows) {
    const date = (cells[iDate] || '').replace(/\//g, '-')
    const code = cells[iCode]
    const fsp = toNum(cells[iPrice])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !code || fsp == null) continue
    out[code] = { date, fsp }
  }
  return out
}

// ── Supabase ────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const OBJECT_PATH = 'options-oi.json'

async function loadExisting() {
  if (!SUPABASE_URL) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/${OBJECT_PATH}`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function upload(payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/${OBJECT_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`上傳失敗 HTTP ${res.status}：${await res.text()}`)
}

// ── 主流程 ──────────────────────────────────────────────────

async function main() {
  const backfill = Number(process.env.OPTIONS_OI_BACKFILL || 0)
  const today = todayTPE()

  const existing = (await loadExisting()) ?? { updatedAt: null, days: {}, settle: {} }
  existing.days ??= {}
  existing.settle ??= {}

  // 要補的日期：回補模式往回掃交易日，平日模式只看今天
  const targets = []
  if (backfill > 0) {
    let cursor = today
    while (targets.length < backfill && cursor > shiftDate(today, -90)) {
      if (!isWeekend(cursor) && !existing.days[cursor]) targets.push(cursor)
      cursor = shiftDate(cursor, -1)
    }
  } else if (existing.days[today]) {
    // AC-OI-A8 早退：當日已有資料，一次 HTTP 判斷後就結束，多排幾班成本趨近 0
    console.log(`[oi] ${today} 已有資料（${Object.keys(existing.days).length} 天在檔），早退`)
    return
  } else if (!isWeekend(today)) {
    targets.push(today)
  } else {
    console.log(`[oi] ${today} 是週末，跳過`)
    return
  }

  let added = 0
  for (const date of targets) {
    let rec
    try {
      rec = await fetchOptionsOI(date)
    } catch (e) {
      console.log(`[oi] ${date} 抓取失敗：${e.message}`)
      continue
    }
    if (!rec) {
      console.log(`[oi] ${date} 尚未就緒（盤中版或 OI 全 0），不寫入`)
      continue
    }
    existing.days[date] = rec
    added++
    console.log(`[oi] ${date} 已記錄 ${Object.keys(rec).length} 個到期別`)
    if (targets.length > 1) await new Promise(r => setTimeout(r, 800))   // 回補時放慢，別敲太兇
  }

  if (!added) {
    console.log('[oi] 本次沒有新增任何交易日，不上傳')
    return
  }

  // 結算價：抓涵蓋現有資料範圍的區間，覆蓋合併
  const dates = Object.keys(existing.days).sort()
  try {
    const settle = await fetchSettlements(shiftDate(dates[0], -20), today)
    existing.settle = { ...existing.settle, ...settle }
  } catch (e) {
    console.log(`[oi] 結算價抓取失敗（不影響主資料）：${e.message}`)
  }

  // AC-OI-A7：只留最近 KEEP_DAYS 個交易日
  if (dates.length > KEEP_DAYS) {
    for (const d of dates.slice(0, dates.length - KEEP_DAYS)) delete existing.days[d]
  }

  existing.updatedAt = new Date().toISOString()
  if (process.env.OPTIONS_OI_DRY_RUN) {
    console.log(`[oi] DRY RUN：不上傳。日期 ${Object.keys(existing.days).sort().join(' ')}`)
    return
  }
  await upload(existing)
  const size = JSON.stringify(existing).length
  console.log(`[oi] 上傳完成：${Object.keys(existing.days).length} 天、${Object.keys(existing.settle).length} 筆結算價、${(size / 1024).toFixed(1)} KB`)
}

// 被 import 當函式庫時不執行 main（測試用）。
// 用 pathToFileURL 而不是字串拼 file://——本機 repo 路徑含空格時 import.meta.url 會編成 %20，
// 直接比對永遠不相等，main() 就靜默不執行（Actions 上路徑無空格，只有本機會踩到）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(`[oi] 失敗：${e.message}`)
    process.exit(1)
  })
}
