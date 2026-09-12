/**
 * fetch-ssf.mjs
 * 功能二十四（AC-SF-1~4）：抓個股期貨每日行情與大額交易人，維護 250 個交易日滾動序列。
 *
 * 零依賴。執行：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/fetch-ssf.mjs
 *   SSF_DRY_RUN=1 ...    # 只抓不寫
 *
 * 產出 ssf-daily.json（伺服器端用，calc-holders-z.mjs 讀它算 futMove）：
 *   { updatedAt, dates: [舊→新], stocks: { code: { oi: [], vol: [], b10: [] } } }
 *   陣列與 dates 等長，該日無資料補 null（比照 history.json 的共用日曆做法，
 *   比每天存一個物件小很多）。
 *
 * ⚠️ 四個必須遵守的坑：
 *
 *  1. 日期一定要用回應裡的 Date 欄，不能用執行日（R14 教訓：TPEX 會延遲回前一日資料，
 *     用執行日當 bar 日期會把舊資料標成今天）。
 *
 *  2. 盤後時段的列未沖銷量一律是 0（2026-09-10 實測 CDF/QFF 皆然）。
 *     未沖銷量只能取一般時段（兩段都取會重複計），成交量兩段都要加（盤後是真的流量）。
 *
 *  3. 一檔股票可能同時有標準與小型契約（320 契約對應 270 檔股票），口數不能直接相加：
 *     標準 1 口 = 2,000 股、小型 1 口 = 100 股，一律換成股數。小型的判別是
 *     保證金表的 ContractName 以「小型」開頭。
 *
 *  4. 大額交易人的集中度必須固定取同一個契約，否則序列會在「今天哪個契約 OI 比較大」
 *     之間跳來跳去，量到的是契約切換不是籌碼變化——一律優先取標準契約。
 *     它的契約代碼是 2 碼（CD），個股期貨是 3 碼（CDF），去掉結尾的 F 才對得上
 *     （2026-09-11 實測 320/320 全對得上）。
 */

import { pathToFileURL } from 'url'

const FUT_URL = 'https://openapi.taifex.com.tw/v1/DailyMarketReportFut'
const LT_URL = 'https://openapi.taifex.com.tw/v1/OpenInterestOfLargeTradersFutures'
const SSF_LIST_URL = 'https://openapi.taifex.com.tw/v1/SSFLists'
const MARGIN_URL = 'https://openapi.taifex.com.tw/v1/SingleStockFuturesMargining'

const FILE = 'ssf-daily.json'
const KEEP_DAYS = 250
const LOT_STANDARD = 2000
const LOT_MINI = 100
const ALL_MONTHS = '999912'   // 大額交易人的「所有契約」列
const ALL_TRADERS = '0'       // 0 = 全部交易人、1 = 特定法人

const HEADERS = { 'User-Agent': 'Mozilla/5.0' }

// ⚠️ 坑 5（2026-09-11 實測）：期交所 OpenAPI 同一個網址會「隨機」回 JSON 或 CSV，
// 六次請求裡四次是 CSV，跟 Accept 標頭無關（送 application/json 照樣回 CSV）。
// 大額交易人這支最明顯，其他三支目前都是 JSON——但沒有理由相信它們不會哪天也翻臉。
// 所以一律走 getRows()：拿到 JSON 就直接用，拿到 CSV 就用中文表頭對照表轉成同樣的欄位名。
// 不能只靠重試賭下一次回 JSON，萬一某段時間整批節點都吐 CSV，整個班次就掛了。
const LT_CSV_HEADERS = {
  '日期': 'Date',
  '契約': 'Contract',
  '商品名稱(契約名稱)': 'ContractName',
  '到期月份(週別)': 'SettlementMonth',
  '交易人類別': 'TypeOfTraders',
  '前五大交易人買方數量': 'Top5Buy',
  '前五大交易人賣方數量': 'Top5Sell',
  '前十大交易人買方數量': 'Top10Buy',
  '前十大交易人賣方數量': 'Top10Sell',
  '全市場未沖銷部位數': 'OIOfMarket',
}

/** 極簡 CSV 解析：處理雙引號包住的欄位，其餘逗號分隔 */
export function parseCsv(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = []
    let cur = '', quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false
        } else cur += ch
      } else if (ch === '"') quoted = true
      else if (ch === ',') { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    rows.push(cells)
  }
  return rows
}

/** CSV → 物件陣列，欄位名用對照表翻成與 JSON 版一致 */
export function csvToRows(text, headerMap) {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('CSV 沒有資料列')
  const header = rows[0].map(h => h.replace(/^\uFEFF/, '').trim())
  const unknown = header.filter(h => !headerMap[h])
  if (unknown.length) {
    // 欄位名對不上就整批放棄，不要猜位置（2026-09-08 options-oi 用固定索引在盤中版
    // 讀出看似合理的假數字，就是這種猜法造成的）
    throw new Error(`CSV 表頭有未知欄位：${unknown.join('、')}`)
  }
  return rows.slice(1).map(cells => {
    const o = {}
    header.forEach((h, i) => { o[headerMap[h]] = (cells[i] ?? '').trim() })
    return o
  })
}

async function getRows(url, headerMap = null, attempt = 1) {
  try {
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) {
      if (res.status < 500) throw new Error(`HTTP ${res.status}`)
      throw new Error(`HTTP ${res.status}（可重試）`)
    }
    const text = await res.text()   // R6：body 讀取要包在重試範圍內
    const head = text.replace(/^\uFEFF/, '').trimStart()[0]
    if (head === '[' || head === '{') return JSON.parse(text)
    if (headerMap) return csvToRows(text, headerMap)
    throw new Error('回應是 CSV 但沒有提供表頭對照表（可重試，下一次可能回 JSON）')
  } catch (e) {
    if (attempt < 4) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      return getRows(url, headerMap, attempt + 1)
    }
    throw new Error(`${url} 取得失敗：${e.message}`)
  }
}

const num = v => {
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!s || s === '-' || s === '--') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

const isoDate = yyyymmdd =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

/** contract → { code, lot, standard }；小型契約靠保證金表的 ContractName 判別（坑 3） */
export function buildContractMap(ssfList, marginList) {
  const names = new Map(marginList.map(r => [String(r.Contract).trim(), String(r.ContractName ?? '').trim()]))
  const map = new Map()
  for (const r of ssfList) {
    const contract = String(r.Contract).trim()
    const name = names.get(contract) ?? ''
    const mini = name.startsWith('小型')
    map.set(contract, { code: String(r.StockCode).trim(), lot: mini ? LOT_MINI : LOT_STANDARD, standard: !mini })
  }
  return map
}

/** 每日行情 → { date, byStock: { code: { oi, vol } } }（單位：股） */
export function aggregateByStock(futRows, cmap) {
  const byStock = {}
  const dates = new Set()
  for (const r of futRows) {
    const m = cmap.get(String(r.Contract).trim())
    if (!m) continue
    dates.add(String(r.Date).trim())
    const slot = byStock[m.code] ?? (byStock[m.code] = { oi: 0, vol: 0 })
    // 坑 2：未沖銷量只取一般時段，成交量兩段都算
    if (String(r.TradingSession ?? '').trim() === '一般') {
      slot.oi += num(r.OpenInterest) * m.lot
    }
    slot.vol += num(r['Volume']) * m.lot
  }
  if (dates.size !== 1) {
    throw new Error(`期貨行情混到多個日期：${[...dates].join('、')}`)
  }
  return { date: isoDate([...dates][0]), byStock }
}

/** 大額交易人 → { code: { b10, s10 } }（前十大買／賣方佔全市場未沖銷量的 %） */
export function aggregateLargeTraders(ltRows, cmap) {
  // 契約代碼去掉結尾 F 才對得上（坑 4）
  const byShort = new Map()
  for (const [contract, m] of cmap) {
    if (!contract.endsWith('F')) continue
    const short = contract.slice(0, -1)
    const prev = byShort.get(short)
    // 標準契約一律勝出；同級才比先到先得
    if (!prev || (m.standard && !prev.standard)) byShort.set(short, m)
  }

  const out = {}
  for (const r of ltRows) {
    if (String(r.SettlementMonth).trim() !== ALL_MONTHS) continue
    if (String(r.TypeOfTraders).trim() !== ALL_TRADERS) continue
    const m = byShort.get(String(r.Contract).trim())
    if (!m) continue
    const marketOi = num(r.OIOfMarket)
    if (!marketOi) continue
    out[m.code] = {
      b10: Math.round(num(r.Top10Buy) / marketOi * 1000) / 10,
      s10: Math.round(num(r.Top10Sell) / marketOi * 1000) / 10,
    }
  }
  return out
}

/**
 * 把新的一天併進滾動序列。
 * 回傳 { snapshot, skipped }；skipped 有值代表這次不該寫（AC-SF-4）。
 */
export function appendDay(prev, date, byStock, lt) {
  const totalOi = Object.values(byStock).reduce((s, v) => s + v.oi, 0)
  // AC-SF-4：盤中 OI 整欄是 0（期交所 14:37 才放當日 OI），寫進去那天就永遠是壞的
  if (totalOi <= 0) {
    return { snapshot: prev, skipped: `全市場未沖銷量為 0（盤中未就緒），整批不寫` }
  }
  const dates = prev?.dates ?? []
  if (dates.includes(date)) {
    return { snapshot: prev, skipped: `${date} 已經在序列裡，跳過` }
  }

  const nextDates = [...dates, date].sort()
  const cut = Math.max(0, nextDates.length - KEEP_DAYS)
  const keptDates = nextDates.slice(cut)
  const oldIndex = new Map(dates.map((d, i) => [d, i]))

  const codes = new Set([...Object.keys(prev?.stocks ?? {}), ...Object.keys(byStock)])
  const stocks = {}
  for (const code of codes) {
    const old = prev?.stocks?.[code]
    const pick = (arr, d) => {
      const i = oldIndex.get(d)
      return i == null ? null : (arr?.[i] ?? null)
    }
    stocks[code] = {
      oi: keptDates.map(d => d === date ? (byStock[code]?.oi ?? null) : pick(old?.oi, d)),
      vol: keptDates.map(d => d === date ? (byStock[code]?.vol ?? null) : pick(old?.vol, d)),
      b10: keptDates.map(d => d === date ? (lt[code]?.b10 ?? null) : pick(old?.b10, d)),
    }
  }

  return {
    snapshot: { updatedAt: new Date().toISOString(), dates: keptDates, stocks },
    skipped: null,
  }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  const dryRun = process.env.SSF_DRY_RUN === '1'
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL 未設定')

  console.log('[ssf] 抓契約對應表 …')
  const [ssfList, marginList] = await Promise.all([getRows(SSF_LIST_URL), getRows(MARGIN_URL)])
  const cmap = buildContractMap(ssfList, marginList)
  const minis = [...cmap.values()].filter(m => !m.standard).length
  console.log(`[ssf] ${cmap.size} 個契約 → ${new Set([...cmap.values()].map(m => m.code)).size} 檔股票`
    + `（小型契約 ${minis} 個）`)

  console.log('[ssf] 抓每日行情與大額交易人 …')
  const [futRows, ltRows] = await Promise.all([getRows(FUT_URL), getRows(LT_URL, LT_CSV_HEADERS)])
  const { date, byStock } = aggregateByStock(futRows, cmap)
  const lt = aggregateLargeTraders(ltRows, cmap)
  console.log(`[ssf] 資料日 ${date}：${Object.keys(byStock).length} 檔有行情、`
    + `${Object.keys(lt).length} 檔有大額交易人`)

  let prev = null
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/${FILE}`,
      { headers: HEADERS, cache: 'no-cache' })
    if (res.ok) prev = await res.json()
  } catch { /* 首次執行 */ }
  console.log(`[ssf] 既有序列 ${prev?.dates?.length ?? 0} 天`)

  const { snapshot, skipped } = appendDay(prev, date, byStock, lt)
  if (skipped) { console.log(`[ssf] ⏭  ${skipped}`); return }

  const body = JSON.stringify(snapshot)
  console.log(`[ssf] 新序列 ${snapshot.dates.length} 天（${snapshot.dates[0]} ~ `
    + `${snapshot.dates[snapshot.dates.length - 1]}），${(body.length / 1024 / 1024).toFixed(2)} MB`)

  if (dryRun) { console.log('[ssf] DRY RUN：不上傳'); return }
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY 未設定')

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/${FILE}`, {
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
  console.log(`[ssf] ${FILE} 上傳完成`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
