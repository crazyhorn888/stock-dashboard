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
  // DATE_OVERRIDE=YYYY-MM-DD 可強制指定日期（手動補跑用）
  const d = process.env.DATE_OVERRIDE ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const [yyyy, mm, dd] = d.split('-')
  return `${parseInt(yyyy) - 1911}${mm}${dd}`
}

function todayTWDate() {
  return process.env.DATE_OVERRIDE ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
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
// 帶 module-level 快取：Guard 2 與 Step 4 共用同一次 fetch
// 主端點：historicalData/FMTQIK（完整 OHLC）
// 備用端點：afterTrading/FMTQIK（僅 close+change，以前日收盤推算 open，high/low 取開收盤極值）
let _fmtqikMonthCache = null  // { key: string, rows: [] }
async function fetchIndexOHLCForMonth(yyyymmdd) {
  if (_fmtqikMonthCache?.key === yyyymmdd) return _fmtqikMonthCache.rows

  // 主端點（完整 OHLC）
  try {
    const url = `https://www.twse.com.tw/rwd/zh/historicalData/FMTQIK?response=json&date=${yyyymmdd}`
    const d = await fetchJSON(url)
    if (d?.stat === 'OK' && Array.isArray(d.data) && d.data.length > 0) {
      const rows = d.data.map(row => ({
        date: rocToISO(row[0]),
        open:   parseFloat(String(row[3]).replace(/,/g, '')) || 0,
        high:   parseFloat(String(row[4]).replace(/,/g, '')) || 0,
        low:    parseFloat(String(row[5]).replace(/,/g, '')) || 0,
        close:  parseFloat(String(row[6]).replace(/,/g, '')) || 0,
        volume: Math.round(parseFloat(String(row[2]).replace(/,/g, '')) / 1e5),
      })).filter(r => r.close > 0)
      _fmtqikMonthCache = { key: yyyymmdd, rows }
      return rows
    }
  } catch { /* 繼續嘗試備用端點 */ }

  // 備用端點（afterTrading/FMTQIK）：欄位 [日期,股數,金額,筆數,收盤指數,漲跌點]
  // open = 前日收盤（串接推算），high/low = 開收盤極值（無 intraday 資料）
  console.warn(`[daily] historicalData/FMTQIK 失敗，改用 afterTrading/FMTQIK 備用端點`)
  try {
    const url2 = `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=${yyyymmdd}`
    const d2 = await fetchJSON(url2)
    if (d2?.stat === 'OK' && Array.isArray(d2.data) && d2.data.length > 0) {
      const rows = []
      let prevClose = null
      for (const row of d2.data) {
        const close  = parseFloat(String(row[4]).replace(/,/g, '')) || 0
        if (!close) continue
        const change = parseFloat(String(row[5]).replace(/,/g, '')) || 0
        const open   = prevClose ?? (close - change)
        rows.push({
          date:   rocToISO(row[0]),
          open,
          high:   Math.max(open, close),
          low:    Math.min(open, close),
          close,
          volume: Math.round(parseFloat(String(row[2]).replace(/,/g, '')) / 1e5),
        })
        prevClose = close
      }
      _fmtqikMonthCache = { key: yyyymmdd, rows }
      return rows
    }
  } catch { /* 兩個端點都失敗 */ }

  console.warn(`[daily] FMTQIK 兩個端點均失敗（${yyyymmdd}）`)
  _fmtqikMonthCache = { key: yyyymmdd, rows: [] }
  return []
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
    if (uploaded !== todayTWDate()) return false
    // 若今日已上傳但 STOCK_DAY_ALL 那時還沒就緒（stocksDate 仍是舊日期），
    // 允許 re-run 以便後續 cron 補進股價資料
    return (d.stocksDate ?? null) === todayTWDate()
  } catch { return false }
}

// ── Guard 2：確認 FMTQIK 已含今日 K 棒（約 15:30 後就緒）────────────────────
// 改用 FMTQIK 而非 STOCK_DAY_ALL：STOCK_DAY_ALL 在部分交易日深夜才更新，
// 導致所有 cron（最晚 22:00 TWN）全部錯過窗口。FMTQIK 同為官方 TWSE 資料，
// 且在收盤後 ~15:30 即可取得，不受 STOCK_DAY_ALL 遲到影響。
async function isTradingDay(todayISO) {
  const yyyymmdd = todayISO.replace(/-/g, '')
  const rows = await fetchIndexOHLCForMonth(yyyymmdd)  // 有快取，Step 4 不重複 fetch
  const found = rows.some(r => r.date === todayISO)
  if (!found) {
    console.log(`[daily] FMTQIK 尚無今日（${todayISO}）K 棒（非交易日或 15:30 前）`)
  }
  return found
}

// ── Guard 3：融資資料是否發布（YYYYMMDD 格式）────────
async function isMarginDataReady(date) {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${date}&selectType=MS`
  try {
    const d = await fetchJSON(url)
    return d?.stat === 'OK' && Array.isArray(d?.tables?.[0]?.data) && d.tables[0].data.length > 0
  } catch { return false }
}

// ── 籌碼：讀 Supabase chips/{date}.json（N8N Phase1 寫入）─────────────────
async function fetchChipsFromSupabase(dateYYYYMMDD) {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return null
  try {
    const url = `${supabaseUrl}/storage/v1/object/public/snapshots/chips/${dateYYYYMMDD}.json`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

// ── 籌碼：抓今日融資餘額（仟元 → 億元）─────────────────────────────────
async function fetchMarginAmount(dateYYYYMMDD) {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${dateYYYYMMDD}&selectType=MS`
  try {
    const d = await fetchJSON(url)
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

// ── 籌碼：組裝 ChipsData（Phase1 JSON + 融資） ──────────────────────────
function buildChipsEntry(phase1, marginAmount, prevMarginAmount) {
  // phase1 可為 null（N8N chips 尚未寫入）；只要 marginAmount 有值就允許建立 partial entry
  if (!phase1 && marginAmount == null) return null
  const det = (phase1?.detail) || {}
  return {
    foreign_spot:   phase1?.foreign_spot  ?? null,
    trust_spot:     phase1?.trust_spot    ?? null,
    dealer_self:    phase1?.dealer_self   ?? null,
    dealer_hedge:   phase1?.dealer_hedge  ?? null,
    inst_total:     phase1?.inst_total    ?? null,
    margin_amount:  marginAmount ?? null,
    margin_change:  (marginAmount != null && prevMarginAmount != null)
                      ? Math.round((marginAmount - prevMarginAmount) * 100) / 100
                      : null,
    tx_close:       phase1?.tx_close  ?? null,
    tx_change:      phase1?.tx_change ?? null,
    basis:          phase1?.basis     ?? null,
    fx_tx_oi:       phase1?.fx_tx_oi  ?? null,
    fx_tx_chg:      phase1?.fx_tx_chg ?? null,
    retail_mtx_pct: phase1?.retail_mtx_pct ?? null,
    retail_imf_pct: phase1?.retail_imf_pct ?? null,
    pcr:            phase1.pcr ?? null,
    vix:            phase1.vix ?? null,
    opt_tr:         det.opt_tr_raw ?? null,
    opt_oi:         det.opt_oi_raw ?? null,
  }
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
      const open   = parseFloat(r.OpeningPrice)  || close
      const high   = parseFloat(r.HighestPrice)  || close
      const low    = parseFloat(r.LowestPrice)   || close
      const volume = Math.round(parseFloat(r.TradeVolume || '0') / 1000)  // 張
      return {
        code: r.Code,
        name: r.Name,
        close,
        changePercent: Math.round(changePercent * 100) / 100,
        open, high, low, volume,
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
        const open   = parseFloat(r.Open)  || close
        const high   = parseFloat(r.High)  || close
        const low    = parseFloat(r.Low)   || close
        const volume = Math.round(parseFloat(r.TradingShares || '0') / 1000)  // 張
        return {
          code:          r.SecuritiesCompanyCode,
          name:          r.CompanyName,
          close,
          changePercent: prev > 0 ? Math.round((change / prev) * 10000) / 100 : 0,
          open, high, low, volume,
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

  // Guard 2：FMTQIK 尚無今日 K 棒（非交易日 or 15:30 前）
  if (!(await isTradingDay(today))) {
    console.log('[daily] FMTQIK 無今日資料，跳過，exit 0')
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

  // Step 3 前：確認 STOCK_DAY_ALL 是否已含今日資料
  // STOCK_DAY_ALL 在部分交易日深夜才更新；若仍是舊日期，保留快照股價並繼續更新其他資料
  const sdaIsToday = (_twseAllCache ?? []).some(r => String(r.Date) === dateTW)
  if (!sdaIsToday) {
    const sdaDate = _twseAllCache?.[0]?.Date ?? '未知'
    console.log(`[daily] ⚠️  STOCK_DAY_ALL 仍為 ${sdaDate}（個股股價沿用前日快照），K 線與籌碼繼續更新`)
  }

  // Step 3：更新每支股票（STOCK_DAY_ALL 今日資料就緒才執行，避免插入錯誤日期的收盤價）
  let newCount = 0
  if (sdaIsToday) { for (const p of prices) {
    const existing = stockMap[p.code]
    const pe = fundamentals[p.code]?.pe ?? existing?.pe ?? null
    const eps = fundamentals[p.code]?.eps ?? existing?.eps ?? null

    if (existing) {
      const closes  = [...existing.closes]
      const dates   = [...existing.dates]
      const opens   = [...(existing.opens   ?? [])]
      const highs   = [...(existing.highs   ?? [])]
      const lows    = [...(existing.lows    ?? [])]
      const volumes = [...(existing.volumes ?? [])]
      if (dates[0] === today) {
        closes[0]  = p.close
        opens[0]   = p.open
        highs[0]   = p.high
        lows[0]    = p.low
        volumes[0] = p.volume
      } else {
        closes.unshift(p.close)
        dates.unshift(today)
        opens.unshift(p.open)
        highs.unshift(p.high)
        lows.unshift(p.low)
        volumes.unshift(p.volume)
      }
      stockMap[p.code] = {
        ...existing,
        close: p.close,
        changePercent: p.changePercent,
        pe, eps,
        sector: sectorMap[p.code] ?? existing.sector,
        foreignNetBuy: foreignMap[p.code] ?? existing.foreignNetBuy,
        closes:  closes.slice(0, 250),
        dates:   dates.slice(0, 250),
        opens:   opens.slice(0, 250),
        highs:   highs.slice(0, 250),
        lows:    lows.slice(0, 250),
        volumes: volumes.slice(0, 250),
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
        opens: [p.open], highs: [p.high], lows: [p.low],
        volumes: [p.volume],
      }
      newCount++
    }
  }

  } // end if (sdaIsToday)
  if (sdaIsToday) console.log(`[daily] TWSE 更新 ${prices.length} 支，新增 ${newCount} 支`)
  else console.log('[daily] TWSE 股價跳過（STOCK_DAY_ALL 舊日期），保留快照值')

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
      const closes  = [...existing.closes]
      const dates   = [...existing.dates]
      const opens   = [...(existing.opens   ?? [])]
      const highs   = [...(existing.highs   ?? [])]
      const lows    = [...(existing.lows    ?? [])]
      const volumes = [...(existing.volumes ?? [])]
      if (dates[0] === today) {
        closes[0]  = p.close
        opens[0]   = p.open
        highs[0]   = p.high
        lows[0]    = p.low
        volumes[0] = p.volume
      } else {
        closes.unshift(p.close)
        dates.unshift(today)
        opens.unshift(p.open)
        highs.unshift(p.high)
        lows.unshift(p.low)
        volumes.unshift(p.volume)
      }
      stockMap[p.code] = {
        ...existing,
        close:         p.close,
        changePercent: p.changePercent,
        industry,
        foreignNetBuy,
        closes:  closes.slice(0, 250),
        dates:   dates.slice(0, 250),
        opens:   opens.slice(0, 250),
        highs:   highs.slice(0, 250),
        lows:    lows.slice(0, 250),
        volumes: volumes.slice(0, 250),
      }
    } else {
      stockMap[p.code] = {
        code:          p.code,
        name:          p.name,
        industry,
        sector:        'OTC',
        close:         p.close,
        changePercent: p.changePercent,
        pe:            null,
        eps:           null,
        foreignNetBuy,
        closes:  [p.close],
        dates:   [today],
        opens:   [p.open],
        highs:   [p.high],
        lows:    [p.low],
        volumes: [p.volume],
      }
      tpexNewCount++
    }
  }

  const stocks = Object.values(stockMap)
  console.log(`[daily] TPEX 更新 ${tpexPrices.length} 支，新增 ${tpexNewCount} 支，全市場合計 ${stocks.length} 支`)

  // Step 4：更新 indexHistory（含籌碼資料）
  // 合併策略：補入當月 FMTQIK 中所有快照缺漏的日期（正常每日只有 1 筆，補跑時可能多筆）
  let indexHistory = snapshot.indexHistory ?? null
  if (!indexHistory || indexHistory.length === 0) {
    indexHistory = await buildFullIndexHistory(today)
  } else {
    const existingDates = new Set(indexHistory.map(r => r.date))
    const newEntries = todayOHLCMonth.filter(r => !existingDates.has(r.date))

    if (newEntries.length > 0) {
      // 僅為「目標日期」（today）嘗試讀取籌碼；其他補漏日期不帶籌碼
      const prevMarginAmount = indexHistory[0]?.chips?.margin_amount ?? null
      const [chipsJson, marginAmount] = await Promise.all([
        fetchChipsFromSupabase(todayYYYYMMDD),
        fetchMarginAmount(todayYYYYMMDD),
      ])
      const chips = buildChipsEntry(chipsJson, marginAmount, prevMarginAmount)
      if (chips) console.log('[daily] 籌碼資料已合併')
      else console.log('[daily] 今日籌碼尚未就緒，跳過')

      const mergedNew = newEntries.map(r =>
        r.date === today && chips ? { ...r, chips } : r
      )
      indexHistory = [...mergedNew, ...indexHistory]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 250)
      console.log(`[daily] indexHistory 補入 ${newEntries.length} 筆（${newEntries.map(r => r.date).join(', ')}），共 ${indexHistory.length} 筆`)
    } else {
      console.warn('[daily] 今日 FMTQIK 無新資料，indexHistory 保留舊值')
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
    // stocksDate：紀錄股價資料截至日期。STOCK_DAY_ALL 當日就緒則 = today，
    // 否則保留快照舊值讓前端顯示「待更新」提示，並允許後續 cron 補跑股價。
    stocksDate: sdaIsToday ? today : (snapshot.stocksDate ?? null),
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
