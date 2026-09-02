// 整理平台形態判斷（AC-CS-2~5）。純函式、無副作用，方便單獨驗證。
// 資料來自 ohlc.json 的 h/l/v（張）+ StockData.closes，皆為 newest first、index 0 = 今日。

export interface ConsolidationParams {
  days: number        // 整理期 N 日（扣除當日）
  rangePct: number    // 期間 (最高−最低)/均價 上限 %
  dayPct: number      // 每日 (高−低)/前收 上限 %
  minCross: number    // 收盤穿越均價的最少次數
  volSpike: number    // 期間單日量 ≤ 均量 × 此倍數（超過視為爆量，不算整理）
  todayMult: number   // 當日量 ≥ 均量 × 此倍數 → 爆量訊號
  minVolHigh: number  // 股價 ≥1000 元的均量門檻（張）
  minVolMid: number   // 股價 100–1000 元
  minVolLow: number   // 股價 <100 元
}

export const CONSOLIDATION_DEFAULTS: ConsolidationParams = {
  days: 10, rangePct: 12, dayPct: 4, minCross: 3, volSpike: 2, todayMult: 1.25,
  minVolHigh: 100, minVolMid: 1000, minVolLow: 3000,
}

export interface StockBars {
  h?: (number | null)[]
  l?: (number | null)[]
  v?: (number | null)[]
}

export interface ConsolidationHit {
  avgVol: number     // 整理期均量（張）
  todayVol: number   // 當日量（張）
  ratio: number      // 當日量 / 均量
  signal: 'burst' | 'rising' | 'both'
}

/**
 * 判斷「整理平台 + 當日放量」。不符合回傳 null，符合回傳命中細節（供 UI 顯示/除錯）。
 * 缺值一律視為不符合（不當 0），與既有篩選器的缺值原則一致。
 */
export function matchConsolidation(
  closes: number[] | undefined,
  bars: StockBars | undefined,
  price: number,
  p: ConsolidationParams,
): ConsolidationHit | null {
  const v = bars?.v ?? [], h = bars?.h ?? [], l = bars?.l ?? [], c = closes ?? []
  const N = p.days
  if (v.length < N + 3 || c.length < N + 2) return null

  // 整理期＝扣除當日往前 N 日
  const win: { v: number; h: number; l: number; c: number; prevC: number }[] = []
  for (let i = 1; i <= N; i++) {
    const vi = v[i], hi = h[i], li = l[i], ci = c[i]
    if (vi == null || hi == null || li == null || ci == null) return null
    win.push({ v: vi, h: hi, l: li, c: ci, prevC: c[i + 1] ?? ci })
  }

  const avgC = win.reduce((s, d) => s + d.c, 0) / N
  const avgV = win.reduce((s, d) => s + d.v, 0) / N
  if (avgC <= 0) return null

  // 前提：股價分段均量門檻
  const minVol = price >= 1000 ? p.minVolHigh : price >= 100 ? p.minVolMid : p.minVolLow
  if (avgV < minVol) return null

  // (a) 區間收斂
  const hi = Math.max(...win.map(d => d.h))
  const lo = Math.min(...win.map(d => d.l))
  if ((hi - lo) / avgC > p.rangePct / 100) return null

  // (b) 每日振幅都要小（漲跌幅變小）
  if (win.some(d => d.prevC > 0 && (d.h - d.l) / d.prevC > p.dayPct / 100)) return null

  // (c) 收盤圍繞均價（帶寬取區間上限的一半）
  if (win.some(d => Math.abs(d.c - avgC) / avgC > p.rangePct / 200)) return null

  // (d) 真的上下震盪，不是單邊緩漲/緩跌
  let cross = 0
  for (let i = 1; i < win.length; i++) if ((win[i - 1].c - avgC) * (win[i].c - avgC) < 0) cross++
  if (cross < p.minCross) return null

  // (e) 期間量能平穩，沒有突然爆大量
  if (win.some(d => d.v > avgV * p.volSpike)) return null

  // 當日訊號：爆量 或 連兩日遞增
  const todayV = v[0]
  if (todayV == null) return null
  const burst  = avgV > 0 && todayV >= avgV * p.todayMult
  const rising = v[2] != null && v[1] != null && v[2]! < v[1]! && v[1]! < todayV
  if (!burst && !rising) return null

  return {
    avgVol: avgV,
    todayVol: todayV,
    ratio: avgV > 0 ? todayV / avgV : 0,
    signal: burst && rising ? 'both' : burst ? 'burst' : 'rising',
  }
}
