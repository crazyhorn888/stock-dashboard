import type { SnapshotData, IndexOHLC, SectorBubble } from './types'

/** 產生加權指數 OHLC 歷史（250 交易日），模擬低點→高點→今日的走勢，newest first */
function fakeIndexHistory(): IndexOHLC[] {
  const result: IndexOHLC[] = []
  const d = new Date(today)
  let close = 36296  // 從低點開始
  // 往回 350 天、跳過週末，直到收集滿 250 筆交易日
  for (let daysBack = 350; daysBack >= 0 && result.length < 250; daysBack--) {
    const cur = new Date(d)
    cur.setDate(cur.getDate() - daysBack)
    if (cur.getDay() === 0 || cur.getDay() === 6) continue  // 跳週末
    const progress = (250 - (250 - result.length)) / 249  // 0→1（從最舊到最新）
    // 走勢：trough(36296) → peak(47741) → today(47018)
    let target: number
    if (progress < 0.85) {
      target = 36296 + (47741 - 36296) * (progress / 0.85)
    } else {
      target = 47741 - (47741 - 47018) * ((progress - 0.85) / 0.15)
    }
    const drift = (target - close) * 0.18
    const noise = (Math.random() - 0.48) * 400
    close = Math.max(34000, Math.min(50000, close + drift + noise))
    const open = close * (1 + (Math.random() - 0.5) * 0.008)
    const high = Math.max(open, close) * (1 + Math.random() * 0.004)
    const low  = Math.min(open, close) * (1 - Math.random() * 0.004)
    result.push({
      date: cur.toISOString().slice(0, 10),
      open:   Math.round(open  * 100) / 100,
      high:   Math.round(high  * 100) / 100,
      low:    Math.round(low   * 100) / 100,
      close:  Math.round(close * 100) / 100,
      volume: Math.round(800 + Math.random() * 2500),
    })
  }
  result.reverse()  // newest first
  return result
}

/** 產生隨機收盤價歷史（250 天）供 UI 開發用 */
function fakePriceHistory(base: number): number[] {
  const arr: number[] = [base]
  for (let i = 1; i < 250; i++) {
    const prev = arr[i - 1]
    arr.push(+(prev * (1 + (Math.random() - 0.5) * 0.03)).toFixed(1))
  }
  return arr
}

const today = new Date()
function dateStr(daysAgo: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

const MOCK_SECTORS: SectorBubble[] = [
  { sectorName: '電子工業', x:  12.5, y:  0.28, size: 95, stocks: [
    { code: '2330', name: '台積電',  industry: '半導體',    netBuy:  8230 },
    { code: '2317', name: '鴻海',    industry: '電腦週邊',  netBuy:  3150 },
    { code: '6515', name: '穎崴',    industry: 'AI伺服器', netBuy:   890 },
    { code: '2382', name: '廣達',    industry: '電腦週邊',  netBuy: -1820 },
    { code: '2409', name: '友達',    industry: '光電',      netBuy:  -520 },
    { code: '3481', name: '群創',    industry: '光電',      netBuy:  -310 },
  ]},
  { sectorName: '金融業',   x:   3.2, y:  0.12, size: 42, stocks: [
    { code: '2882', name: '國泰金',  industry: '壽險',      netBuy:  1050 },
    { code: '2886', name: '兆豐金',  industry: '銀行',      netBuy:   420 },
  ]},
  { sectorName: '鋼鐵工業', x:  -5.8, y: -0.15, size: 28, stocks: [
    { code: '2002', name: '中鋼',    industry: '鋼鐵',      netBuy:  -180 },
  ]},
  { sectorName: '生技醫療', x:   1.1, y: -0.08, size: 18, stocks: [] },
  { sectorName: '建材營造', x:  -2.3, y:  0.05, size: 15, stocks: [] },
  { sectorName: '航運業',   x:   7.4, y:  0.33, size: 38, stocks: [] },
  { sectorName: '電機機械', x:  -4.1, y: -0.22, size: 22, stocks: [] },
  { sectorName: '化學工業', x:   0.8, y:  0.02, size: 12, stocks: [] },
  { sectorName: '塑膠工業', x:  -1.5, y: -0.05, size: 17, stocks: [] },
  { sectorName: '食品工業', x:   2.6, y:  0.09, size: 14, stocks: [] },
  { sectorName: '紡織纖維', x:  -0.9, y: -0.18, size: 10, stocks: [] },
  { sectorName: '油電燃氣', x:   4.3, y:  0.21, size: 25, stocks: [] },
  { sectorName: '觀光餐旅', x:  -3.2, y:  0.14, size: 11, stocks: [] },
  { sectorName: '汽車工業', x:   9.1, y:  0.41, size: 31, stocks: [] },
]

export const MOCK_DATA: SnapshotData = {
  updatedAt: today.toISOString(),
  stocks: [
    { code: '2330', name: '台積電',  industry: '半導體', close: 1085, changePercent:  2.1, pe: 25.3, eps: 42.8, foreignNetBuy:  8230, closes: fakePriceHistory(1085), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2317', name: '鴻海',    industry: '電腦週邊', close: 215,  changePercent:  4.2, pe: 12.1, eps: 17.8, foreignNetBuy:  3150, closes: fakePriceHistory(215),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2382', name: '廣達',    industry: '電腦週邊', close: 325,  changePercent: -1.5, pe: 18.5, eps: 17.6, foreignNetBuy: -1820, closes: fakePriceHistory(325),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2409', name: '友達',    industry: '光電',   close: 18.3, changePercent: -0.7, pe:  8.2, eps:  2.2, foreignNetBuy:  -520, closes: fakePriceHistory(18.3), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2882', name: '國泰金',  industry: '金融',   close: 68.2, changePercent:  0.6, pe: 14.3, eps:  4.8, foreignNetBuy:  1050, closes: fakePriceHistory(68.2), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '6515', name: '穎崴',    industry: 'AI伺服器', close: 380,  changePercent:  5.0, pe: 32.1, eps: 11.8, foreignNetBuy:   890, closes: fakePriceHistory(380),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2002', name: '中鋼',    industry: '鋼鐵',   close: 24.5, changePercent: -1.2, pe: 11.2, eps:  2.2, foreignNetBuy:  -180, closes: fakePriceHistory(24.5), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2886', name: '兆豐金',  industry: '金融',   close: 42.5, changePercent:  0.3, pe: 12.8, eps:  3.3, foreignNetBuy:   420, closes: fakePriceHistory(42.5), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '1590', name: '亞德客',  industry: '電動車',  close: 995,  changePercent:  2.3, pe: 22.4, eps: 44.4, foreignNetBuy:   680, closes: fakePriceHistory(995),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '3481', name: '群創',    industry: '光電',   close: 14.1, changePercent: -0.3, pe:  9.5, eps:  1.5, foreignNetBuy:  -310, closes: fakePriceHistory(14.1), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
  ],
  indexHistory: fakeIndexHistory(),
  sectorHistory: [],
  sectors: MOCK_SECTORS,
  marketSignals: {
    updatedAt: today.toISOString(),
    nDays: 100,
    todayIndex: 20981,
    todayMargin: 1986,
    peakDate: '2026-05-08',
    peakIndex: 22634,
    peakMargin: 2418,
    indexDropPct: 7.31,
    marginDropPct: 17.87,
    posGapPct: 10.56,
    posTriggered: true,
    troughDate: '2026-04-07',
    troughIndex: 17208,
    troughMargin: 1842,
    indexRisePct: 21.93,
    marginRisePct: 7.82,
    negGapPct: -14.11,
    negTriggered: false,
  },
}
