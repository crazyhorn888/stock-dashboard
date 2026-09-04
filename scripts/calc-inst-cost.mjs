/**
 * calc-inst-cost.mjs — 法人成本（AC-IC-1）
 *
 * 成本定義（與 lib/marginMaintenance.ts 的成本指數同一套邏輯）：
 *   只計「法人淨買超」的交易日——賣超是減碼，不影響剩餘部位的成本。
 *   買進股數 ≈ 淨買超金額 ÷ 當日收盤價
 *   法人成本 = Σ(淨買超金額) ÷ Σ(淨買超金額 ÷ 當日收盤價)
 * 這是真實的加權均價（調和平均），不是各日收盤價的簡單平均。
 *
 * ⚠️ 用收盤價近似當日買進均價。實際法人成交價散布在全日，這會有誤差，
 *    但 TWSE 不公布法人成交均價，這是唯一可行的推法——前端須標明是估算。
 *
 * 為什麼要獨立的 series 檔：stock-history.json 只留 25 天（2026-09-04 Franky
 * 決定不延長，泡泡圖回放用不到更多），但 60/120 日成本需要更長的序列。
 * series 只存計算必要的三個數字，體積遠小於原始逐日個股資料
 * （~250KB 壓縮 vs 延長 stock-history 的 26MB），而且只有 pipeline 會讀。
 */

export const COST_WINDOWS = [5, 10, 20, 60, 120]
const MAX_DAYS = Math.max(...COST_WINDOWS)

/**
 * 把今日的法人買賣超併進滾動序列。
 * @param prev     既有 series（可為 null，首次執行）
 * @param rows     今日 stockRows（含 code / net / foreignNet / close）
 * @param dateISO  今日日期
 */
export function updateSeries(prev, rows, dateISO) {
  const dates = prev?.dates ?? []
  const stocks = prev?.stocks ?? {}

  // 同日重跑要覆蓋而不是插入第二筆（補跑班次會踩到）
  const already = dates[0] === dateISO
  const nextDates = already ? [...dates] : [dateISO, ...dates].slice(0, MAX_DAYS)

  const next = {}
  const seen = new Set()

  for (const r of rows) {
    if (!r.code || r.close == null || r.close <= 0) continue
    seen.add(r.code)
    const old = stocks[r.code] ?? { n: [], f: [], c: [] }
    const push = (arr, v) => (already ? [v, ...arr.slice(1)] : [v, ...arr]).slice(0, MAX_DAYS)
    next[r.code] = {
      n: push(old.n, r.net ?? null),
      f: push(old.f, r.foreignNet ?? null),
      c: push(old.c, r.close),
    }
  }

  // 今日沒出現的個股（停牌、無 T86）補 null 佔位，否則序列會錯位對到不同日期
  for (const [code, s] of Object.entries(stocks)) {
    if (seen.has(code)) continue
    const push = (arr, v) => (already ? [v, ...arr.slice(1)] : [v, ...arr]).slice(0, MAX_DAYS)
    next[code] = { n: push(s.n, null), f: push(s.f, null), c: push(s.c, null) }
  }

  return { dates: nextDates, stocks: next }
}

/** 單一窗口的加權均價；資料不足該窗口天數回 null */
function costOf(nets, closes, window) {
  if (nets.length < window) return null
  let amount = 0, shares = 0
  for (let i = 0; i < window; i++) {
    const n = nets[i], c = closes[i]
    if (n == null || c == null || c <= 0 || n <= 0) continue   // 只計買超日
    amount += n
    shares += n / c
  }
  if (shares <= 0) return null      // 該窗口內法人只賣不買 → 無從估成本
  return Math.round((amount / shares) * 100) / 100
}

/**
 * 由 series 產出每檔各窗口的成本。
 * 輸出 { code: { t5, t10, …, f5, f10, … } }，t = 三大法人合計、f = 外資。
 * 全部窗口都算不出來的個股直接略過，不佔檔案體積。
 */
export function calcCosts(series) {
  const out = {}
  for (const [code, s] of Object.entries(series?.stocks ?? {})) {
    const entry = {}
    let any = false
    for (const w of COST_WINDOWS) {
      const t = costOf(s.n, s.c, w)
      const f = costOf(s.f, s.c, w)
      if (t != null) { entry[`t${w}`] = t; any = true }
      if (f != null) { entry[`f${w}`] = f; any = true }
    }
    if (any) out[code] = entry
  }
  return out
}

/**
 * 起步回補：用 stock-history.json 既有的 25 天建立初始 series。
 * stockHistory 是新→舊，每天 { date, stocks: [{code, net, foreignNet, …}] }。
 *
 * ⚠️ 舊的 stockHistory 沒有 close 欄位（2026-09-04 才隨 AC-IC-1 加上）。
 *    不補的話這 25 天會整批被跳過，起步只剩今天 1 天，5 日成本要等一週、
 *    20 日要等一個月才會出現。所以呼叫端要傳 priceAt 從個股歷史查當日收盤價。
 *
 * @param priceAt (code, dateISO) => number|null
 */
export function seedFromStockHistory(stockHistory, priceAt = null) {
  let series = null
  // 由舊到新逐日餵入，updateSeries 才會把最新的排在陣列頭部
  for (const day of [...(stockHistory ?? [])].reverse()) {
    const rows = []
    for (const r of (day.stocks ?? [])) {
      const close = r.close ?? (priceAt ? priceAt(r.code, day.date) : null)
      if (close == null || close <= 0) continue
      rows.push({ ...r, close })
    }
    if (!rows.length) continue
    series = updateSeries(series, rows, day.date)
  }
  return series
}
