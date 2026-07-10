/**
 * 每日增量更新：下載 Firebase 現有快照 → 插入今日資料 → 存出 data/latest.json
 * 不再逐支股票抓歷史（改由 seed-history.mjs 一次性建立），每日只需幾個 TWSE 請求
 * 執行：node scripts/fetch-daily.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { calcSectors, calcConcepts } from './calc-sectors.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// P2-1：code -> 概念名稱陣列（一股多概念），靜態資料隨 repo 走
const conceptStockMap = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'concept-sectors.json'), 'utf-8')
).stocks

// ── 工具 ────────────────────────────────────────────
// R6：抓取側原本沒有重試，單次連線逾時/網路錯誤就讓整個 run 失敗
// （實證：2026-07-10 openapi.twse.com.tw ConnectTimeout 直接中止 run）。
// 只對網路層錯誤與 5xx 重試，4xx 視為對方明確拒絕，直接拋錯不重試。
// ⚠️ res.json() 也必須在重試範圍內——body 讀到一半連線被斷（terminated /
// fullyReadBody）發生在 fetch() resolve 之後，只包 fetch() 擋不到（2026-07-10 兩次
// force_run 都死在這，第一版 R6 的缺口）。
async function fetchJSON(url, attempt = 1) {
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (res.ok) return await res.json()
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      return fetchJSON(url, attempt + 1)
    }
    throw e
  }
  if (res.status >= 500 && attempt < 3) {
    await new Promise(r => setTimeout(r, attempt * 2000))
    return fetchJSON(url, attempt + 1)
  }
  throw new Error(`HTTP ${res.status} ${url}`)
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
 * T86 原始數值單位：股（shares）。
 * 2026-07-08 起（P1-3）：全部換算為「億元」＝ 股數 × 該日收盤價 / 1e8。
 * 金額才能跨板塊比較（張數會高估低價股權重）；收盤價從個股歷史陣列按日期查，
 * 查不到才退回最新 close（近似值，僅發生在極少數缺歷史的個股）。
 */
// P2-1：conceptMap 為 code -> 概念名稱陣列（一股多概念），與官方 sector 分組共用同一份 T86 response，
// 不需額外呼叫 TWSE。回傳 { sectorRows, conceptRows, stockRows }，conceptMap 未傳入時 conceptRows 為 []
// P2-5：stockRows 是當日全部 T86 活躍個股的扁平清單（含 buySell），供 stockHistory 累積、watchlist 泡泡回放用
async function fetchT86Sectors(dateYYYYMMDD, dateISO, stockMap, conceptMap = {}) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateYYYYMMDD}&selectType=ALL`
  try {
    const d = await fetchJSON(url)
    if (d?.stat !== 'OK' || !Array.isArray(d.data)) return null

    const groups = {}        // sectorName → { net, buySell, stocks[] }
    const conceptGroups = {} // conceptName → { net, buySell, stocks[] }
    const stockRows = []     // 當日全部 T86 活躍個股（扁平，一股一筆）
    const r2 = v => Math.round(v * 100) / 100

    for (const row of d.data) {
      const code = String(row[0]).trim()
      if (!/^\d{4}$/.test(code)) continue   // 跳過 ETF、認購權證等

      const stock = stockMap[code]
      if (!stock) continue

      // 該日收盤價：從個股歷史找同日期；找不到用最新 close 近似
      const di = stock.dates?.indexOf(dateISO) ?? -1
      const close = (di >= 0 ? stock.closes?.[di] : stock.close) || stock.close
      if (!close) continue
      const toYi = shares => r2(shares * close / 1e8)   // 股 → 億元

      const foreignNet = toYi(parseNum(row[4]) + parseNum(row[7]))  // 外資（含外資自營）億元
      const trustNet   = toYi(parseNum(row[10]))                     // 投信 億元
      const dealerNet  = toYi(parseNum(row[11]))                     // 自營合計 億元
      const netBuy     = r2(foreignNet + trustNet + dealerNet)       // 三大法人合計 億元

      const buyVol  = parseNum(row[2])+parseNum(row[5])+parseNum(row[8])+parseNum(row[12])+parseNum(row[15])
      const sellVol = parseNum(row[3])+parseNum(row[6])+parseNum(row[9])+parseNum(row[13])+parseNum(row[16])
      const buySell = toYi(buyVol + sellVol)   // 買賣合計 億元（for bubble size）

      const stockEntry = { code, name: stock.name, net: netBuy, foreignNet, trustNet, dealerNet }

      if (stock.sector) {
        const sectorName = stock.sector
        if (!groups[sectorName]) groups[sectorName] = { net: 0, buySell: 0, stocks: [] }
        groups[sectorName].net     += netBuy
        groups[sectorName].buySell += buySell
        groups[sectorName].stocks.push(stockEntry)
      }

      for (const conceptName of (conceptMap[code] ?? [])) {
        if (!conceptGroups[conceptName]) conceptGroups[conceptName] = { net: 0, buySell: 0, stocks: [] }
        conceptGroups[conceptName].net     += netBuy
        conceptGroups[conceptName].buySell += buySell
        conceptGroups[conceptName].stocks.push(stockEntry)
      }

      stockRows.push({ ...stockEntry, buySell })
    }

    const toRows = groupMap => Object.entries(groupMap).map(([name, v]) => ({
      name,
      net: r2(v.net),
      buySell: r2(v.buySell),
      stocks: v.stocks.sort((a, b) => b.net - a.net),
    }))

    const sectorRows = toRows(groups)
    const conceptRows = toRows(conceptGroups)
    console.log(`[daily] T86 分組：${sectorRows.length} 個板塊、${conceptRows.length} 個概念，${sectorRows.reduce((s, r) => s + r.stocks.length, 0)} 支個股`)
    return sectorRows.length > 0 ? { sectorRows, conceptRows, stockRows } : null
  } catch (e) {
    console.warn('[daily] T86 抓取失敗:', e.message)
    return null
  }
}

// ── Guard 1：今天已上傳 ──────────────────────────────
// 判斷條件（meta.json 與 latest.json 兩條路徑必須維持一致）：
//   uploaded 日 = 今日 && stocksDate = 今日 && 今日融資已填 && sectorHistory >= 20 天
async function isAlreadyDoneToday() {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return false
  const today = todayTWDate()

  // 路徑 1：輕量 meta.json（~1KB，write-firebase.mjs 產出）
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/public/snapshots/meta.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.ok) {
      const m = await res.json()
      if (!m?.updatedAt) return false
      const uploaded = new Date(m.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
      return uploaded === today
        && (m.stocksDate ?? null) === today
        && (m.marginDate ?? null) === today
        && (m.sectorHistoryLen ?? 0) >= 20
    }
  } catch { /* fallback 到 latest.json */ }

  // 路徑 2：fallback — meta.json 尚不存在（首次部署過渡期），讀 latest.json
  try {
    const url = `${supabaseUrl}/storage/v1/object/public/snapshots/latest.json`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return false
    const d = await res.json()
    if (!d?.updatedAt) return false
    const uploaded = new Date(d.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    if (uploaded !== today) return false
    // 若今日已上傳但 STOCK_DAY_ALL 那時還沒就緒（stocksDate 仍是舊日期），
    // 允許 re-run 以便後續 cron 補進股價資料
    if ((d.stocksDate ?? null) !== today) return false
    // 若今日 chips.margin_amount 尚未填入，允許補跑（融資發布後由後續 cron 補填）
    const todayEntry = d.indexHistory?.find(r => r.date === today)
    if (!todayEntry?.chips?.margin_amount) return false
    // T86 歷史天數不足 20 天 → 泡泡圖回放無法啟動，繼續跑以補齊
    if ((d.sectorHistory?.length ?? 0) < 20) return false
    return true
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
    pcr:            phase1?.pcr ?? null,
    vix:            phase1?.vix ?? null,
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

// P2-5：獨立 lazy-load 檔（不進 market.json，避免首屏變大），只在使用者開「自選股模式」時才被前端下載
async function downloadStockHistory() {
  const supabaseUrl = process.env.SUPABASE_URL
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/public/snapshots/stock-history.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return []
    return (await res.json()).stockHistory ?? []
  } catch {
    return []  // 首次執行，檔案還不存在
  }
}

// R15：下載 ohlc.json 供回灌（latest.json 已被 write-firebase 剝離 o/h/l/v，不回灌的話
// 每次 run 的 ohlc.json 都會被「當次有動到的股票、1 天」整包覆蓋，蠟燭圖永遠只有 1 根）。
// 智慧下載：只在股價資料實際前進的 run 才呼叫（見 hydrateOHLC 呼叫處），不是每個班次都下載
async function downloadOHLCBars() {
  const supabaseUrl = process.env.SUPABASE_URL
  try {
    const data = await fetchJSON(`${supabaseUrl}/storage/v1/object/public/snapshots/ohlc.json`)
    return data?.bars ?? null
  } catch {
    return null  // 404（首次）或重試耗盡——回 null，呼叫端會讓 write-firebase 跳過 ohlc.json 上傳保住舊檔
  }
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
    // TWT38U row layout（外資及陸資買賣超彙總表）:
    //   r[0]=空白, r[1]=代號, r[2]=名稱
    //   r[3]=外資買進, r[4]=外資賣出, r[5]=外資淨買超(股)
    //   r[6]=外資自營買進, r[7]=外資自營賣出, r[8]=外資自營淨買超(股)
    //   r[9]=外資合計買進, r[10]=外資合計賣出, r[11]=外資合計淨買超(股) ← 使用這個
    for (const r of d?.data ?? []) {
      const code = r[1]?.trim() ?? ''   // code 在 r[1]，r[0] 是空白
      if (/^\d{4}$/.test(code)) {
        map[code] = parseFloat(r[11].replace(/,/g, '')) || 0  // 外資合計淨買超（股）
      }
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
// R14：回傳 { dateISO, prices }——TPEX openapi 的資料日期以回應內的 Date 欄位（ROC 格式）為準，
// 不可假設等於執行日。2026-07-10 實證：當晚 22:00 端點仍回 07-09 資料，舊寫法（bar 一律標 today）
// 把 07-09 收盤蓋成假的 07-10 K 棒、且真正的 07-09 bar 從缺（production 873 支中招，已修復）
async function fetchTPEXPrices() {
  try {
    const data = await fetchJSON('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
    const rawDate = data.find(r => r.Date)?.Date ?? null
    const dateISO = rawDate ? rocToISO(rawDate) : null
    const prices = data
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
    return { dateISO, prices }
  } catch (e) {
    console.warn('[daily] TPEX 價格抓取失敗:', e.message)
    return { dateISO: null, prices: [] }
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

  const forceFullRun = process.env.FORCE_FULL_RUN === 'true'
  // R5：02:07/08:07 補課班天天跑（含假日），若當天各資料源都沒有前進，
  // 不應該還是全量下載+全量重新上傳一輪（egress 浪費）。這個旗標追蹤本次
  // run 是否真的有任何實質更新，沒有就在 main() 結尾提早結束、不寫檔。
  // force_run（forceFullRun）不受這個短路影響，永遠正常跑完並上傳。
  let changed = false

  // Guard 1：今天已上傳（R4：force_run 專用，強制執行時跳過——這正是「資料已完整，
  // 但想立刻重新派生 market.json」的使用情境，不能被這關擋掉）
  if (!forceFullRun && await isAlreadyDoneToday()) {
    console.log('[daily] 今日資料已在 Firebase，跳過，exit 0')
    process.exit(0)
  }

  // Guard 2：FMTQIK 尚無今日 K 棒（非交易日 or 15:30 前）
  // 不受開盤限制的補課班次／強制執行（見 guard-check.mjs／daily-fetch.yml）略過這關，
  // 讓深夜／清晨才發布的 STOCK_DAY_ALL、融資資料有機會被追到
  if (!forceFullRun && process.env.FORCE_SKIP_GUARD2 !== 'true' && !(await isTradingDay(today))) {
    console.log('[daily] FMTQIK 無今日資料，跳過，exit 0')
    process.exit(0)
  }

  console.log('[daily] 兩項確認通過，開始更新')

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

  // Step 3 前：確認 STOCK_DAY_ALL 的資料日期
  // 2026-07-09 踩坑：原本要求「STOCK_DAY_ALL 剛好等於今天」才更新股價，但 STOCK_DAY_ALL 通常本來就慢一天
  // （白天多半還在顯示昨天的收盤），只要某一天排程沒抓到「剛好等於今天」的那個時間窗，stocksDate 就會
  // 永遠卡住不動（因為隔天檢查的還是「今天」，跟已經卡住的舊日期一樣對不上）。
  // 改成：只要 STOCK_DAY_ALL 回報的日期比目前快照新，就接受並用「它實際代表的日期」入帳，不強求等於今天，
  // 這樣就算連續好幾天沒抓到，只要 STOCK_DAY_ALL 本身有前進，快照也能跟著往前追
  const sdaDateRaw = _twseAllCache?.[0]?.Date ?? null
  const sdaDateISO = sdaDateRaw ? rocToISO(sdaDateRaw) : null
  const sdaIsToday = !!sdaDateISO && sdaDateISO > (snapshot.stocksDate ?? '')
  if (!sdaIsToday) {
    console.log(`[daily] ⚠️  STOCK_DAY_ALL 仍為 ${sdaDateRaw ?? '未知'}（個股股價沿用前日快照），K 線與籌碼繼續更新`)
  }

  // R15：ohlc.json 回灌。d0 = 該股上傳當下的 dates[0]（對齊錨點）——若中間有 run 跳過
  // ohlc 上傳導致 dates 已前進，用 d0 在現有 dates 找到正確位置、前面補 null 對齊
  // （getStockBars 對 null 有 closes fallback，畫成無影線 bar，不會壞）。無 d0（舊格式）直接捨棄
  let ohlcHydrated = false
  const hydrateOHLC = async () => {
    if (ohlcHydrated) return
    const bars = await downloadOHLCBars()
    if (!bars) {
      console.warn('[daily] ⚠️  ohlc.json 下載失敗或不存在，本次不回灌（ohlc.json 上傳將跳過以保留舊檔）')
      return
    }
    let n = 0
    for (const [code, b] of Object.entries(bars)) {
      const s = stockMap[code]
      if (!s || !b.d0) continue
      const idx = s.dates?.indexOf(b.d0) ?? -1
      if (idx < 0) continue
      const pad = arr => arr?.length ? [...Array(idx).fill(null), ...arr].slice(0, 120) : undefined
      const o = pad(b.o), h = pad(b.h), l = pad(b.l), v = pad(b.v)
      if (o) { s.opens = o; s.highs = h; s.lows = l }
      if (v) { s.volumes = v }
      if (o || v) n++
    }
    ohlcHydrated = true
    console.log(`[daily] ohlc.json 回灌 ${n} 支`)
  }
  if (sdaIsToday) await hydrateOHLC()

  // Step 3：更新每支股票（STOCK_DAY_ALL 有比快照新的資料才執行，避免插入錯誤日期的收盤價）
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
      if (dates[0] === sdaDateISO) {
        closes[0]  = p.close
        opens[0]   = p.open
        highs[0]   = p.high
        lows[0]    = p.low
        volumes[0] = p.volume
      } else {
        closes.unshift(p.close)
        dates.unshift(sdaDateISO)
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
        foreignNetBuy: foreignMap[p.code] !== undefined
          ? Math.round(foreignMap[p.code] * p.close / 1e6) / 100   // shares×price→億元，與 TPEX 一致
          : existing.foreignNetBuy,
        closes:  closes.slice(0, 250),
        dates:   dates.slice(0, 250),
        // R15：o/h/l/v 只保留 120 天（= StockKChart 日線顯示上限，egress 取捨見計劃書 R15）
        opens:   opens.slice(0, 120),
        highs:   highs.slice(0, 120),
        lows:    lows.slice(0, 120),
        volumes: volumes.slice(0, 120),
      }
    } else {
      // 快照中沒有的新股票
      stockMap[p.code] = {
        code: p.code, name: p.name,
        industry: sectorMap[p.code] ?? '—',
        sector: sectorMap[p.code],
        close: p.close, changePercent: p.changePercent,
        pe, eps,
        foreignNetBuy: foreignMap[p.code] !== undefined
          ? Math.round(foreignMap[p.code] * p.close / 1e6) / 100
          : 0,
        closes: [p.close], dates: [sdaDateISO],
        opens: [p.open], highs: [p.high], lows: [p.low],
        volumes: [p.volume],
      }
      newCount++
    }
  }

  } // end if (sdaIsToday)
  if (sdaIsToday) { console.log(`[daily] TWSE 更新 ${prices.length} 支，新增 ${newCount} 支`); changed = true }
  else console.log('[daily] TWSE 股價跳過（STOCK_DAY_ALL 舊日期），保留快照值')

  // Step 3b：TPEX 上櫃股票
  // R14：bar 日期一律用回應內的資料日（tpexDateISO），不用執行日 today——
  // 端點延遲時舊寫法會造出「假今日 K 棒」（見 fetchTPEXPrices 註解與計劃書 R14）
  const [{ dateISO: tpexDateISO, prices: tpexPrices }, tpexForeignMap, tpexIndustryMap] = await Promise.all([
    fetchTPEXPrices(),
    fetchTPEXForeignMap(),
    fetchTPEXIndustryMap(),
  ])
  console.log(`[daily] TPEX 資料：${tpexPrices.length} 支（資料日 ${tpexDateISO ?? '未知'}）`)

  // R15：TPEX 有任何一支會長出新 bar（或新股票）才需要回灌——同日期覆蓋不會改變陣列長度，
  // 未回灌時的 [0] 覆蓋寫進空陣列會產生 1 天孤兒資料，但 write-firebase 會因 ohlcHydrated=false
  // 跳過 ohlc.json 上傳，不會汙染 production
  const tpexAdvanced = !!tpexDateISO && tpexPrices.some(p => {
    const e = stockMap[p.code]
    return !e || (e.dates?.[0] ?? '') < tpexDateISO
  })
  if (tpexAdvanced) await hydrateOHLC()

  let tpexNewCount = 0
  let tpexNewBarCount = 0
  if (tpexPrices.length > 0 && !tpexDateISO) {
    console.warn('[daily] TPEX 回應缺 Date 欄位，無法確定資料日期，本次跳過 TPEX 更新')
  } else for (const p of tpexPrices) {
    const existing      = stockMap[p.code]
    const industry      = tpexIndustryMap[p.code] ?? existing?.industry ?? '其他'
    const foreignShares = tpexForeignMap[p.code] ?? 0
    // 億元 = 股數 × 收盤價 / 1e8
    const foreignNetBuy = Math.round(foreignShares * p.close / 1e6) / 100

    if (existing) {
      const dates0 = existing.dates?.[0] ?? null
      // 快照已有比 TPEX 資料日更新的 bar → 不可用舊資料覆蓋（防禦，正常不會發生）
      if (dates0 && dates0 > tpexDateISO) continue

      const closes  = [...existing.closes]
      const dates   = [...existing.dates]
      const opens   = [...(existing.opens   ?? [])]
      const highs   = [...(existing.highs   ?? [])]
      const lows    = [...(existing.lows    ?? [])]
      const volumes = [...(existing.volumes ?? [])]
      if (dates0 === tpexDateISO) {
        closes[0]  = p.close
        opens[0]   = p.open
        highs[0]   = p.high
        lows[0]    = p.low
        volumes[0] = p.volume
      } else {
        closes.unshift(p.close)
        dates.unshift(tpexDateISO)
        opens.unshift(p.open)
        highs.unshift(p.high)
        lows.unshift(p.low)
        volumes.unshift(p.volume)
        tpexNewBarCount++
      }
      stockMap[p.code] = {
        ...existing,
        close:         p.close,
        changePercent: p.changePercent,
        industry,
        foreignNetBuy,
        closes:  closes.slice(0, 250),
        dates:   dates.slice(0, 250),
        // R15：o/h/l/v 只保留 120 天（= StockKChart 日線顯示上限，egress 取捨見計劃書 R15）
        opens:   opens.slice(0, 120),
        highs:   highs.slice(0, 120),
        lows:    lows.slice(0, 120),
        volumes: volumes.slice(0, 120),
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
        dates:   [tpexDateISO],
        opens:   [p.open],
        highs:   [p.high],
        lows:    [p.low],
        volumes: [p.volume],
      }
      tpexNewCount++
    }
  }
  // R5 補遺：TPEX 有新 bar 也算實質變更（原本漏了，只有 TPEX 前進的 run 會被短路跳過不上傳）
  if (tpexNewBarCount > 0 || tpexNewCount > 0) changed = true

  const stocks = Object.values(stockMap)
  // P2-2：每股附上概念 tags（一股多概念），供個股列表/詳情頁顯示與點擊開啟概念面板
  for (const s of stocks) s.concepts = conceptStockMap[s.code] ?? []
  console.log(`[daily] TPEX 更新 ${tpexPrices.length} 支（新 bar ${tpexNewBarCount}），新增 ${tpexNewCount} 支，全市場合計 ${stocks.length} 支`)

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
      changed = true
    } else {
      console.warn('[daily] 今日 FMTQIK 無新資料，indexHistory 保留舊值')
    }

    // 融資/籌碼補值重試：獨立於上面「有無新 FMTQIK 資料」判斷。
    // 原本融資/籌碼只在今日 K 棒剛新增的那次 run 嘗試抓一次，若當時 MI_MARGN／
    // n8n chips 還沒發布，之後每次 run 因為今日日期已存在（newEntries 不含今天）
    // 就永遠不會再重試——這是融資餘額常常卡在前幾天舊值的根因。改成每次都檢查
    // 今日紀錄缺哪個欄位，缺就重抓，抓到才覆蓋，抓不到保留原樣。
    const todayIdx = indexHistory.findIndex(r => r.date === today)
    if (todayIdx !== -1) {
      const existingChips = indexHistory[todayIdx].chips ?? null
      const needMargin = existingChips?.margin_amount == null
      const needPhase1 = existingChips?.inst_total == null
      if (needMargin || needPhase1) {
        const prevMarginAmount = indexHistory[todayIdx + 1]?.chips?.margin_amount ?? null
        const [chipsJson, marginAmount] = await Promise.all([
          needPhase1 ? fetchChipsFromSupabase(todayYYYYMMDD) : Promise.resolve(null),
          needMargin ? fetchMarginAmount(todayYYYYMMDD) : Promise.resolve(existingChips?.margin_amount ?? null),
        ])
        const fresh = buildChipsEntry(chipsJson, marginAmount, prevMarginAmount)
        if (fresh) {
          const merged = { ...(existingChips ?? {}) }
          for (const k of Object.keys(fresh)) { if (fresh[k] != null) merged[k] = fresh[k] }
          indexHistory[todayIdx] = { ...indexHistory[todayIdx], chips: merged }
          console.log(`[daily] 今日籌碼補值：margin_amount=${merged.margin_amount ?? '—'} inst_total=${merged.inst_total ?? '—'}`)
          changed = true
        } else {
          console.log('[daily] 今日融資/籌碼仍未就緒，保留現狀待下次補值')
        }
      }
    }
  }

  // Step 5：T86（依 stockMap sector 分組 + concept-sectors.json 概念分組）→ sectorHistory/conceptHistory → 泡泡圖
  // P1-3：只保留億元格式（unit='yi'）的歷史；舊「張」格式無法換算（缺當日價格上下文），
  // 直接丟棄，缺的天數由下方 5b 回補機制自動用新單位重抓
  let sectorHistory  = (snapshot.sectorHistory  ?? []).filter(d => d.unit === 'yi')
  let conceptHistory = (snapshot.conceptHistory ?? []).filter(d => d.unit === 'yi')
  // P2-5：stockHistory 獨立存在 stock-history.json（lazy-load），不在 latest.json/snapshot 裡，另外下載
  let stockHistory = (await downloadStockHistory()).filter(d => d.unit === 'yi')

  // 5a. 今日 T86（同一份 response 同時產出官方分組、概念分組、個股扁平清單，不額外呼叫 TWSE）
  const t86Today = await fetchT86Sectors(todayYYYYMMDD, today, stockMap, conceptStockMap)
  if (t86Today) {
    const filtered  = sectorHistory.filter(d => d.date !== today)
    sectorHistory  = [{ date: today, unit: 'yi', rows: t86Today.sectorRows }, ...filtered].slice(0, 25)
    const filteredC = conceptHistory.filter(d => d.date !== today)
    conceptHistory = [{ date: today, unit: 'yi', rows: t86Today.conceptRows }, ...filteredC].slice(0, 25)
    const filteredS = stockHistory.filter(d => d.date !== today)
    stockHistory   = [{ date: today, unit: 'yi', stocks: t86Today.stockRows }, ...filteredS].slice(0, 25)
    console.log(`[daily] sectorHistory/conceptHistory/stockHistory 更新今日 ${today}`)
    changed = true
  } else {
    console.warn('[daily] T86 無資料，sectorHistory/conceptHistory/stockHistory 保留舊值')
  }

  // 5b. 補齊歷史（若 < 20 天）：從 indexHistory 取得過去交易日，逐日補抓 T86
  // ⚠️ 修復：原本只看 sectorHistory.length<20 決定要不要補，但 stockHistory 是 P2-5 後來獨立
  // 加的檔案，sectorHistory 早就有 20+ 天（從 P1-3 延續下來）所以這個條件從來不會為 stockHistory
  // 觸發——導致 stockHistory 實際上永遠停在「只有今天」（2026-07-10 發現，見計劃書執行紀錄）。
  // 改成三者分開判斷各自的缺口，逐日補抓時也各自獨立檢查是否已存在，避免互相干擾造成重複
  // R8：conceptHistory 原本誤用 existingSectorDates 判斷是否要推入（copy-paste bug）——
  // 若某日期存在於 sectorHistory 但缺於 conceptHistory，會永遠補不回來。改成各自用各自的集合。
  const needSectorBackfill  = sectorHistory.length  < 20
  const needConceptBackfill = conceptHistory.length < 20
  const needStockBackfill   = stockHistory.length   < 20
  if ((needSectorBackfill || needConceptBackfill || needStockBackfill) && indexHistory && indexHistory.length > 1) {
    const existingSectorDates  = new Set(sectorHistory.map(d => d.date))
    const existingConceptDates = new Set(conceptHistory.map(d => d.date))
    const existingStockDates   = new Set(stockHistory.map(d => d.date))
    const shortestLen = Math.min(sectorHistory.length, conceptHistory.length, stockHistory.length)
    const missingDates = indexHistory
      .map(r => r.date)
      .filter(d => !existingSectorDates.has(d) || !existingConceptDates.has(d) || !existingStockDates.has(d))
      .slice(0, 25 - shortestLen)

    if (missingDates.length > 0) {
      console.log(`[daily] sectorHistory ${sectorHistory.length} 天／conceptHistory ${conceptHistory.length} 天／stockHistory ${stockHistory.length} 天，補抓 ${missingDates.length} 個歷史交易日...`)
      for (const date of missingDates) {
        await new Promise(r => setTimeout(r, 1500))  // TWSE rate limit 緩衝
        const t86h = await fetchT86Sectors(date.replace(/-/g, ''), date, stockMap, conceptStockMap)
        if (t86h) {
          if (!existingSectorDates.has(date))  sectorHistory.push({ date, unit: 'yi', rows: t86h.sectorRows })
          if (!existingConceptDates.has(date)) conceptHistory.push({ date, unit: 'yi', rows: t86h.conceptRows })
          if (!existingStockDates.has(date))   stockHistory.push({ date, unit: 'yi', stocks: t86h.stockRows })
          console.log(`[daily]   → ${date}：${t86h.sectorRows.length} 板塊、${t86h.conceptRows.length} 概念、${t86h.stockRows.length} 個股`)
          changed = true
        }
      }
      sectorHistory.sort((a, b) => b.date.localeCompare(a.date))
      sectorHistory = sectorHistory.slice(0, 25)
      conceptHistory.sort((a, b) => b.date.localeCompare(a.date))
      conceptHistory = conceptHistory.slice(0, 25)
      stockHistory.sort((a, b) => b.date.localeCompare(a.date))
      stockHistory = stockHistory.slice(0, 25)
      console.log(`[daily] 補齊完成，sectorHistory ${sectorHistory.length} 天／conceptHistory ${conceptHistory.length} 天／stockHistory ${stockHistory.length} 天`)
    }
  }

  // R5：補課班（02:07/08:07）天天跑，若這次 run 各資料源都沒有實質前進，
  // 不要還是全量重新上傳一輪（egress 浪費）。force_run 永遠正常跑完不受影響。
  if (!changed && !forceFullRun) {
    console.log('[daily] 本次無實質變更（股價/K線/融資籌碼/板塊皆無新資料），跳過寫檔與上傳')
    return
  }

  const sectors  = calcSectors(sectorHistory, stockMap)
  const concepts = calcConcepts(conceptHistory, stockMap, conceptStockMap)
  console.log(`[daily] 計算泡泡圖：${sectors.length} 個類股、${concepts.length} 個概念`)

  const newSnapshot = {
    updatedAt: new Date().toISOString(),
    // stocksDate：紀錄股價資料截至日期。STOCK_DAY_ALL 有更新的資料則採用它實際代表的日期（sdaDateISO，
    // 可能是「今天」也可能是「比快照新的前一天」，見上方 2026-07-09 踩坑說明），
    // 否則保留快照舊值讓前端顯示「待更新」提示，並允許後續 cron 補跑股價。
    stocksDate: sdaIsToday ? sdaDateISO : (snapshot.stocksDate ?? null),
    // R15：告訴 write-firebase 這次 run 有沒有回灌 ohlc——false 時跳過 ohlc.json 上傳，
    // 避免用「只有 1 天的孤兒陣列」或「空集合」蓋掉 production 的累積資料
    ohlcHydrated,
    stocks,
    indexHistory,
    sectorHistory,
    sectors,
    conceptHistory,
    stockHistory,
    concepts,
    marketSignals: snapshot.marketSignals ?? null,
  }

  const outDir = join(__dirname, '..', 'data')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(newSnapshot))
  console.log(`[daily] 完成，data/latest.json 已更新`)
}

main().catch(e => { console.error(e); process.exit(1) })
