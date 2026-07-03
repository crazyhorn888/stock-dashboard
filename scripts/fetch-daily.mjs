/**
 * 每日增量更新：下載 Firebase 現有快照 → 插入今日資料 → 存出 data/latest.json
 * 不再逐支股票抓歷史（改由 seed-history.mjs 一次性建立），每日只需幾個 TWSE 請求
 * 執行：node scripts/fetch-daily.mjs
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { calcSectors } from './calc-sectors.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 工具 ────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

function todayTW() {
  // 民國年格式，TWSE OpenAPI Date 欄位用（e.g. "1150623"）
  const d = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '')
  // zh-TW 格式：「2026/06/23」→ 去掉斜線 → "20260623"，需轉成民國年
  const year = parseInt(d.slice(0, 4)) - 1911
  return `${year}${d.slice(4)}`
}

function todayTWDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

/** 民國年日期字串（1150630 或 115/06/30）→ YYYY-MM-DD */
function rocToISO(rocStr) {
  const s = String(rocStr).replace(/\//g, '')
  const year = parseInt(s.slice(0, -4)) + 1911
  const mm = s.slice(-4, -2)
  const dd = s.slice(-2)
  return `${year}-${mm}-${dd}`
}

// TWSE OpenAPI 快取（同 process 內只抓一次）
let _twseAllCache = null
async function fetchTWSEAll() {
  if (_twseAllCache) return _twseAllCache
  const data = await fetchJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL')
  _twseAllCache = Array.isArray(data) ? data : []
  return _twseAllCache
}

// ── TWSE 加權指數 OHLC（FMTQIK，傳 YYYYMMDD）────────
async function fetchIndexOHLCForMonth(yyyymmdd) {
  const url = `https://www.twse.com.tw/rwd/zh/historicalData/FMTQIK?response=json&date=${yyyymmdd}`
  try {
    const d = await fetchJSON(url)
    if (d?.stat !== 'OK' || !Array.isArray(d.data)) return []
    return d.data.map(row => ({
      date: rocToISO(row[0]),
      open:   parseFloat(String(row[3]).replace(/,/g, '')) || 0,
      high:   parseFloat(String(row[4]).replace(/,/g, '')) || 0,
      low:    parseFloat(String(row[5]).replace(/,/g, '')) || 0,
      close:  parseFloat(String(row[6]).replace(/,/g, '')) || 0,
      // 成交金額單位為千元，÷1e5 → 億
      volume: Math.round(parseFloat(String(row[2]).replace(/,/g, '')) / 1e5),
    })).filter(r => r.close > 0)
  } catch {
    console.warn(`[daily] FMTQIK ${yyyymmdd} 抓取失敗`)
    return []
  }
}

/** 初始化 indexHistory：回填最近 13 個月，取最新 250 筆，newest first */
async function buildFullIndexHistory(todayISO) {
  console.log('[daily] indexHistory 缺失，初始化 13 個月歷史...')
  const months = []
  const d = new Date(todayISO)
  for (let i = 0; i < 13; i++) {
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`)
    d.setMonth(d.getMonth() - 1)
  }
  const results = await Promise.all(months.map(m => fetchIndexOHLCForMonth(m)))
  const all = results.flat().sort((a, b) => b.date.localeCompare(a.date))
  return all.slice(0, 250)
}

// ── TWSE T86 三大法人（以 stockMap sector 分組，不依賴已消失的「小計」行）────────────
function parseNum(v) {
  return parseFloat(String(v).replace(/,/g, '')) || 0
}

/**
 * T86 欄位（19 欄，已實測）：
 * [0]代號 [1]名稱
 * [2]外陸資買進 [3]外陸資賣出 [4]外陸資淨買（不含外資自營）
 * [5]外資自營買進 [6]外資自營賣出 [7]外資自營淨買
 * [8]投信買進 [9]投信賣出 [10]投信淨買
 * [11]自營合計淨買 [12]自營自行買進 [13]自營自行賣出 [14]自營自行淨買
 * [15]自營避險買進 [16]自營避險賣出 [17]自營避險淨買
 * [18]三大法人合計
 * 所有數值單位：股（shares）→ ÷1000 = 張（lots）
 */
async function fetchT86Sectors(dateYYYYMMDD, stockMap) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateYYYYMMDD}&selectType=ALL`
  try {
    const d = await fetchJSON(url)
    if (d?.stat !== 'OK' || !Array.isArray(d.data)) return null

    const groups = {}  // sectorName → { net, buySell, stocks[] }

    for (const row of d.data) {
      const code = String(row[0]).trim()
      if (!/^\d{4}$/.test(code)) continue   // 跳過 ETF、認購權證等

      const stock = stockMap[code]
      if (!stock?.sector) continue           // 無法對應板塊則跳過

      const foreignNet = Math.round((parseNum(row[4]) + parseNum(row[7])) / 1000)  // 外資（含外資自營）張
      const trustNet   = Math.round(parseNum(row[10]) / 1000)                       // 投信 張
      const dealerNet  = Math.round(parseNum(row[11]) / 1000)                       // 自營合計 張
      const netBuy     = foreignNet + trustNet + dealerNet                           // 三大法人合計 張

      const buyVol  = parseNum(row[2])+parseNum(row[5])+parseNum(row[8])+parseNum(row[12])+parseNum(row[15])
      const sellVol = parseNum(row[3])+parseNum(row[6])+parseNum(row[9])+parseNum(row[13])+parseNum(row[16])
      const buySell = Math.round((buyVol + sellVol) / 1000)   // 買賣合計 張（for bubble size）

      const sectorName = stock.sector
      if (!groups[sectorName]) groups[sectorName] = { net: 0, buySell: 0, stocks: [] }
      groups[sectorName].net     += netBuy
      groups[sectorName].buySell += buySell
      groups[sectorName].stocks.push({ code, name: stock.name, net: netBuy, foreignNet, trustNet, dealerNet })
    }

    const rows = Object.entries(groups).map(([name, v]) => ({
      name,
      net: v.net,
      buySell: v.buySell,
      stocks: v.stocks.sort((a, b) => b.net - a.net),
    }))

    console.log(`[daily] T86 分組：${rows.length} 個板塊，${rows.reduce((s, r) => s + r.stocks.length, 0)} 支個股`)
    return rows.length > 0 ? rows : null
  } catch (e) {
    console.warn('[daily] T86 抓取失敗:', e.message)
    return null
  }
}

// ── Guard 1：今天已上傳 ──────────────────────────────
async function isAlreadyDoneToday() {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return false
  try {
    const url = `${supabaseUrl}/storage/v1/object/public/snapshots/latest.json`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return false
    const d = await res.json()
    if (!d?.updatedAt) return false
    const uploaded = new Date(d.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    return uploaded === todayTWDate()
  } catch { return false }
}

// ── Guard 2：確認交易日（用 OpenAPI STOCK_DAY_ALL 的 Date 欄位比對今日）──
async function isTradingDay(dateTW) {
  try {
    const data = await fetchTWSEAll()
    if (!data.length) return false
    return data.some(r => String(r.Date) === dateTW)
  } catch { return false }
}

// ── Guard 3：融資資料是否發布（YYYYMMDD 格式）────────
async function isMarginDataReady(date) {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${date}&selectType=MS`
  try {
    const d = await fetchJSON(url)
    return d?.stat === 'OK' && Array.isArray(d?.tables?.[0]?.data) && d.tables[0].data.length > 0
  } catch { return false }
}

// ── 下載現有 Supabase 快照 ──────────────────────────
async function downloadSnapshot() {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) throw new Error('SUPABASE_URL 未設定')
  const url = `${supabaseUrl}/storage/v1/object/public/snapshots/latest.json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`無法下載現有快照：HTTP ${res.status}（請先執行 seed-history.mjs → write-firebase.mjs）`)
  return res.json()
}

// ── TWSE 今日股價（全市場，用 OpenAPI，Guard 2 已確認今日資料存在）──────
async function fetchTWSEPrices() {
  const data = await fetchTWSEAll()
  return data
    .filter(r => /^\d{4}$/.test(r.Code) && r.ClosingPrice && parseFloat(r.ClosingPrice) > 0)
    .map(r => {
      const close = parseFloat(r.ClosingPrice)
      const change = parseFloat(r.Change) || 0
      const prevClose = close - change
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0
      return {
        code: r.Code,
        name: r.Name,
        close,
        changePercent: Math.round(changePercent * 100) / 100,
      }
    })
}

// ── TWSE 個股外資買賣超 ────────────────────────────
async function fetchStockForeign(date) {
  const url = `https://www.twse.com.tw/fund/TWT38U?response=json&date=${date}`
  try {
    const d = await fetchJSON(url)
    const map = {}
    for (const r of d?.data ?? []) {
      const code = r[0].trim()
      if (/^\d{4}$/.test(code)) map[code] = (parseFloat(r[10].replace(/,/g, '')) || 0) / 1e8
    }
    return map
  } catch {
    console.warn('[daily] 個股外資抓取失敗，跳過')
    return {}
  }
}

// ── FinMind PE/EPS（一次全市場，選用）─────────────
async function fetchFundamentals(token) {
  if (!token) return {}
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPER&date=${todayTWDate()}&token=${token}`
  try {
    const d = await fetchJSON(url)
    const map = {}
    for (const r of d?.data ?? []) map[r.stock_id] = { pe: r.PER ?? null, eps: r.EPS ?? null }
    return map
  } catch {
    console.warn('[daily] FinMind PER 失敗，保留舊值')
    return {}
  }
}

// ── TPEX 上櫃 ─────────────────────────────────────────
async function fetchTPEXPrices() {
  try {
    const data = await fetchJSON('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
    return data
      .filter(r => /^\d{4}$/.test(r.SecuritiesCompanyCode) && parseFloat(r.Close) > 0)
      .map(r => {
        const close  = parseFloat(r.Close)  || 0
        const change = parseFloat(r.Change) || 0
        const prev   = close - change
        return {
          code:          r.SecuritiesCompanyCode,
          name:          r.CompanyName,
          close,
          changePercent: prev > 0 ? Math.round((change / prev) * 10000) / 100 : 0,
        }
      })
  } catch (e) {
    console.warn('[daily] TPEX 價格抓取失敗:', e.message)
    return []
  }
}

async function fetchTPEXForeignMap() {
  try {
    const data = await fetchJSON('https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading')
    const map = {}
    for (const r of data) {
      if (!/^\d{4}$/.test(r.SecuritiesCompanyCode)) continue
      // 外資含陸資含自營（股）；欄位名含空格為 API 本身問題
      const shares = parseNum(r['ForeignInvestorsInclude MainlandAreaInvestors-Difference'] ?? '0')
      map[r.SecuritiesCompanyCode] = shares
    }
    return map
  } catch (e) {
    console.warn('[daily] TPEX 三大法人抓取失敗:', e.message)
    return {}
  }
}

async function fetchTPEXIndustryMap() {
  try {
    const d = await fetchJSON('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo')
    const map = {}
    for (const r of d?.data ?? []) {
      if (r.type === 'tpex' && /^\d{4}$/.test(r.stock_id)) {
        map[r.stock_id] = r.industry_category || '其他'
      }
    }
    return map
  } catch (e) {
    console.warn('[daily] FinMind TPEX 產業資料失敗:', e.message)
    return {}
  }
}

// ── Main ─────────────────────────────────────────
async function main() {
  const dateTW = todayTW()
  const today = todayTWDate()
  const FINMIND_TOKEN = process.env.FINMIND_TOKEN ?? ''

  console.log(`[daily] 開始，日期：${dateTW}`)

  // Guard 1：今天已上傳
  if (await isAlreadyDoneToday()) {
    console.log('[daily] 今日資料已在 Firebase，跳過，exit 0')
    process.exit(0)
  }

  // Guard 2：非交易日
  if (!(await isTradingDay(dateTW))) {
    console.log('[daily] 非交易日，跳過，exit 0')
    process.exit(0)
  }

  // Guard 3：融資尚未發布（傳 YYYYMMDD 格式）
  if (!(await isMarginDataReady(today.replace(/-/g, '')))) {
    console.log('[daily] 融資資料尚未發布，等下一個排程，exit 0')
    process.exit(0)
  }

  console.log('[daily] 三項確認通過，開始更新')

  // Step 1：下載現有快照
  console.log('[daily] 下載現有快照...')
  const snapshot = await downloadSnapshot()
  const stockMap = Object.fromEntries(snapshot.stocks.map(s => [s.code, s]))
  console.log(`[daily] 快照載入，${snapshot.stocks.length} 支股票`)

  // Step 2：抓今日 TWSE 資料（並行）
  // T86 需要 stockMap 完成後才能執行，所以移到 Step 5 再呼叫
  const todayYYYYMMDD = today.replace(/-/g, '')
  const [prices, foreignMap, fundamentals, todayOHLCMonth, industryList] = await Promise.all([
    fetchTWSEPrices(),
    fetchStockForeign(dateTW),
    fetchFundamentals(FINMIND_TOKEN),
    fetchIndexOHLCForMonth(todayYYYYMMDD),
    // t187ap03_L: 上市公司基本資料，取得個股 → 產業類別（= T86 板塊名）
    fetchJSON('https://openapi.twse.com.tw/v1/opendata/t187ap03_L').catch(() => []),
  ])
  // t187ap03_L 產業別代碼 → T86 板塊名稱對照
  const INDUSTRY_CODE_MAP = {
    '01':'水泥工業','02':'食品工業','03':'塑膠工業','04':'紡織纖維',
    '05':'電機機械','06':'電器電纜','08':'玻璃陶瓷','09':'造紙工業',
    '10':'鋼鐵工業','11':'橡膠工業','12':'汽車工業','14':'建材營造',
    '15':'航運業',  '16':'觀光餐旅','17':'金融保險','18':'貿易百貨',
    '20':'其他',    '21':'化學工業','22':'生技醫療','23':'綜合',
    '24':'半導體業','25':'光電業',  '26':'其他電子業','27':'通信網路業',
    '28':'電子零組件業','29':'電子通路業','30':'資訊服務業','31':'電腦及週邊設備業',
    '35':'油電燃氣','36':'資訊服務業','37':'觀光餐旅','38':'汽車工業','91':'其他',
  }
  // sectorMap: code → 板塊名稱（e.g., "半導體業"）
  const sectorMap = {}
  for (const r of (Array.isArray(industryList) ? industryList : [])) {
    const code    = String(r['公司代號'] ?? '').trim()
    const secCode = String(r['產業別']   ?? '').trim()
    if (/^\d{4}$/.test(code) && INDUSTRY_CODE_MAP[secCode]) {
      sectorMap[code] = INDUSTRY_CODE_MAP[secCode]
    }
  }
  console.log(`[daily] TWSE 今日資料：${prices.length} 支，產業對照：${Object.keys(sectorMap).length} 支`)

  // Step 3：更新每支股票
  let newCount = 0
  for (const p of prices) {
    const existing = stockMap[p.code]
    const pe = fundamentals[p.code]?.pe ?? existing?.pe ?? null
    const eps = fundamentals[p.code]?.eps ?? existing?.eps ?? null

    if (existing) {
      const closes = [...existing.closes]
      const dates = [...existing.dates]
      if (dates[0] === today) {
        closes[0] = p.close // 覆蓋同日重複
      } else {
        closes.unshift(p.close)
        dates.unshift(today)
      }
      stockMap[p.code] = {
        ...existing,
        close: p.close,
        changePercent: p.changePercent,
        pe, eps,
        sector: sectorMap[p.code] ?? existing.sector,
        foreignNetBuy: foreignMap[p.code] ?? existing.foreignNetBuy,
        closes: closes.slice(0, 250),
        dates: dates.slice(0, 250),
      }
    } else {
      // 快照中沒有的新股票
      stockMap[p.code] = {
        code: p.code, name: p.name,
        industry: sectorMap[p.code] ?? '—',
        sector: sectorMap[p.code],
        close: p.close, changePercent: p.changePercent,
        pe, eps,
        foreignNetBuy: foreignMap[p.code] ?? 0,
        closes: [p.close], dates: [today],
      }
      newCount++
    }
  }

  console.log(`[daily] TWSE 更新 ${prices.length} 支，新增 ${newCount} 支`)

  // Step 3b：TPEX 上櫃股票
  const [tpexPrices, tpexForeignMap, tpexIndustryMap] = await Promise.all([
    fetchTPEXPrices(),
    fetchTPEXForeignMap(),
    fetchTPEXIndustryMap(),
  ])
  console.log(`[daily] TPEX 今日資料：${tpexPrices.length} 支`)

  let tpexNewCount = 0
  for (const p of tpexPrices) {
    const existing      = stockMap[p.code]
    const industry      = tpexIndustryMap[p.code] ?? existing?.industry ?? '其他'
    const foreignShares = tpexForeignMap[p.code] ?? 0
    // 億元 = 股數 × 收盤價 / 1e8
    const foreignNetBuy = Math.round(foreignShares * p.close / 1e6) / 100

    if (existing) {
      const closes = [...existing.closes]
      const dates  = [...existing.dates]
      if (dates[0] === today) {
        closes[0] = p.close
      } else {
        closes.unshift(p.close)
        dates.unshift(today)
      }
      stockMap[p.code] = {
        ...existing,
        close:         p.close,
        changePercent: p.changePercent,
        industry,
        foreignNetBuy,
        closes: closes.slice(0, 250),
        dates:  dates.slice(0, 250),
      }
    } else {
      stockMap[p.code] = {
        code:          p.code,
        name:          p.name,
        industry,
        sector:        'OTC',   // 不進入 TWSE T86 泡泡圖
        close:         p.close,
        changePercent: p.changePercent,
        pe:            null,
        eps:           null,
        foreignNetBuy,
        closes:        [p.close],
        dates:         [today],
      }
      tpexNewCount++
    }
  }

  const stocks = Object.values(stockMap)
  console.log(`[daily] TPEX 更新 ${tpexPrices.length} 支，新增 ${tpexNewCount} 支，全市場合計 ${stocks.length} 支`)

  // Step 4：更新 indexHistory
  let indexHistory = snapshot.indexHistory ?? null
  if (!indexHistory || indexHistory.length === 0) {
    indexHistory = await buildFullIndexHistory(today)
  } else {
    const todayOHLC = todayOHLCMonth.find(r => r.date === today)
    if (todayOHLC) {
      const filtered = indexHistory.filter(r => r.date !== today)
      indexHistory = [todayOHLC, ...filtered].slice(0, 250)
      console.log(`[daily] indexHistory 更新今日 ${today}，共 ${indexHistory.length} 筆`)
    } else {
      console.warn('[daily] 今日 FMTQIK 無資料，indexHistory 保留舊值')
    }
  }

  // Step 5：T86（依 stockMap sector 分組）→ sectorHistory → 泡泡圖
  let sectorHistory = snapshot.sectorHistory ?? []
  const t86Rows = await fetchT86Sectors(todayYYYYMMDD, stockMap)
  if (t86Rows && t86Rows.length > 0) {
    const filtered = sectorHistory.filter(d => d.date !== today)
    sectorHistory = [{ date: today, rows: t86Rows }, ...filtered].slice(0, 25)
    console.log(`[daily] sectorHistory 更新今日 ${today}，${t86Rows.length} 類股`)
  } else {
    console.warn('[daily] T86 無資料，sectorHistory 保留舊值')
  }
  const sectors = calcSectors(sectorHistory, stockMap)
  console.log(`[daily] 計算泡泡圖：${sectors.length} 個類股`)

  const newSnapshot = {
    updatedAt: new Date().toISOString(),
    stocks,
    indexHistory,
    sectorHistory,
    sectors,
    marketSignals: snapshot.marketSignals ?? null,
  }

  const outDir = join(__dirname, '..', 'data')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(newSnapshot))
  console.log(`[daily] 完成，data/latest.json 已更新`)
}

main().catch(e => { console.error(e); process.exit(1) })
