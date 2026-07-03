import type { SnapshotData, IndexOHLC, SectorBubble } from './types'

/** 產生加權指數 OHLC 歷史（250 交易日），模擬低點→高點→今日的走勢，newest first */
function fakeIndexHistory(): IndexOHLC[] {
  const result: IndexOHLC[] = []
  const d = new Date(today)
  let close = 36296  // 從低點開始
  for (let daysBack = 350; daysBack >= 0 && result.length < 250; daysBack--) {
    const cur = new Date(d)
    cur.setDate(cur.getDate() - daysBack)
    if (cur.getDay() === 0 || cur.getDay() === 6) continue
    const progress = (250 - (250 - result.length)) / 249
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
      volume: Math.round(3000 + Math.random() * 6000),
    })
  }
  result.reverse()
  return result
}

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

// 28 個 TWSE 上市產業板塊（對應 T86 小計名稱）
const MOCK_SECTORS: SectorBubble[] = [
  // ── 電子相關 ─────────────────────────────────────
  { sectorName: '半導體業',         x:  15.2, y:  0.32, size: 180, stocks: [
    { code: '2330', name: '台積電',   industry: '半導體業',  netBuy:  8230 },
    { code: '2303', name: '聯電',     industry: '半導體業',  netBuy:  1520 },
    { code: '2344', name: '華邦電',   industry: '半導體業',  netBuy:   -380 },
    { code: '2454', name: '聯發科',   industry: '半導體業',  netBuy:  3120 },
    { code: '3711', name: '日月光投控', industry: '半導體業', netBuy:   890 },
  ]},
  { sectorName: '電腦及週邊設備業', x:   8.4, y:  0.18, size: 95, stocks: [
    { code: '2317', name: '鴻海',     industry: '電腦及週邊設備業', netBuy:  3150 },
    { code: '2382', name: '廣達',     industry: '電腦及週邊設備業', netBuy: -1820 },
    { code: '2353', name: '宏碁',     industry: '電腦及週邊設備業', netBuy:   420 },
    { code: '2356', name: '英業達',   industry: '電腦及週邊設備業', netBuy:   -90 },
    { code: '6515', name: '穎崴',     industry: '電腦及週邊設備業', netBuy:   890 },
  ]},
  { sectorName: '光電業',           x:  -3.2, y: -0.12, size: 42, stocks: [
    { code: '2409', name: '友達',     industry: '光電業',    netBuy:  -520 },
    { code: '3481', name: '群創',     industry: '光電業',    netBuy:  -310 },
    { code: '3008', name: '大立光',   industry: '光電業',    netBuy:   210 },
  ]},
  { sectorName: '通信網路業',       x:   4.1, y:  0.15, size: 38, stocks: [
    { code: '2412', name: '中華電',   industry: '通信網路業', netBuy:   680 },
    { code: '4904', name: '遠傳',     industry: '通信網路業', netBuy:   290 },
  ]},
  { sectorName: '電子零組件業',     x:   6.8, y:  0.22, size: 72, stocks: [
    { code: '2308', name: '台達電',   industry: '電子零組件業', netBuy:  1540 },
    { code: '2379', name: '瑞昱',     industry: '電子零組件業', netBuy:   760 },
    { code: '3034', name: '聯詠',     industry: '電子零組件業', netBuy:   430 },
  ]},
  { sectorName: '電子通路業',       x:   1.8, y:  0.08, size: 22, stocks: [
    { code: '2392', name: '正崴',     industry: '電子通路業', netBuy:   150 },
    { code: '2388', name: '威盛',     industry: '電子通路業', netBuy:    80 },
  ]},
  { sectorName: '資訊服務業',       x:   2.5, y:  0.11, size: 18, stocks: [
    { code: '3673', name: 'TPK-KY',   industry: '資訊服務業', netBuy:   -90 },
  ]},
  { sectorName: '其他電子業',       x:  -1.5, y: -0.05, size: 28, stocks: [
    { code: '2360', name: '致茂',     industry: '其他電子業', netBuy:   120 },
  ]},
  // ── 傳產 ────────────────────────────────────────
  { sectorName: '金融保險',         x:   5.2, y:  0.14, size: 65, stocks: [
    { code: '2882', name: '國泰金',   industry: '金融保險',  netBuy:  1050 },
    { code: '2886', name: '兆豐金',   industry: '金融保險',  netBuy:   420 },
    { code: '2884', name: '玉山金',   industry: '金融保險',  netBuy:   310 },
    { code: '2891', name: '中信金',   industry: '金融保險',  netBuy:   780 },
  ]},
  { sectorName: '鋼鐵工業',         x:  -4.8, y: -0.18, size: 35, stocks: [
    { code: '2002', name: '中鋼',     industry: '鋼鐵工業',  netBuy:  -180 },
    { code: '2006', name: '東和鋼鐵', industry: '鋼鐵工業',  netBuy:   -50 },
  ]},
  { sectorName: '航運業',           x:   9.1, y:  0.41, size: 55, stocks: [
    { code: '2603', name: '長榮',     industry: '航運業',    netBuy:  2840 },
    { code: '2609', name: '陽明',     industry: '航運業',    netBuy:  1650 },
    { code: '2615', name: '萬海',     industry: '航運業',    netBuy:   920 },
    { code: '2610', name: '華航',     industry: '航運業',    netBuy:   380 },
  ]},
  { sectorName: '汽車工業',         x:   7.3, y:  0.29, size: 32, stocks: [
    { code: '2207', name: '和泰車',   industry: '汽車工業',  netBuy:   520 },
    { code: '1590', name: '亞德客',   industry: '汽車工業',  netBuy:   680 },
  ]},
  { sectorName: '生技醫療',         x:   1.2, y: -0.07, size: 25, stocks: [
    { code: '4576', name: '智擎',     industry: '生技醫療',  netBuy:    80 },
    { code: '1786', name: '科妍',     industry: '生技醫療',  netBuy:    30 },
  ]},
  { sectorName: '建材營造',         x:  -2.1, y:  0.06, size: 20, stocks: [
    { code: '5522', name: '遠雄',     industry: '建材營造',  netBuy:  -120 },
  ]},
  { sectorName: '食品工業',         x:   2.8, y:  0.09, size: 18, stocks: [
    { code: '1301', name: '台塑',     industry: '食品工業',  netBuy:   220 },
  ]},
  { sectorName: '塑膠工業',         x:  -1.8, y: -0.08, size: 22, stocks: [
    { code: '1303', name: '南亞',     industry: '塑膠工業',  netBuy:   -90 },
    { code: '1326', name: '台化',     industry: '塑膠工業',  netBuy:   -50 },
  ]},
  { sectorName: '化學工業',         x:   0.9, y:  0.03, size: 15, stocks: [
    { code: '1702', name: '南僑',     industry: '化學工業',  netBuy:    40 },
  ]},
  { sectorName: '紡織纖維',         x:  -0.7, y: -0.14, size: 12, stocks: [
    { code: '1402', name: '遠東新',   industry: '紡織纖維',  netBuy:   -60 },
  ]},
  { sectorName: '電機機械',         x:   3.5, y:  0.17, size: 28, stocks: [
    { code: '1504', name: '東元',     industry: '電機機械',  netBuy:   190 },
    { code: '1605', name: '華新',     industry: '電機機械',  netBuy:   110 },
  ]},
  { sectorName: '電器電纜',         x:  -1.2, y:  0.02, size: 10, stocks: [
    { code: '1603', name: '華電網',   industry: '電器電纜',  netBuy:    20 },
  ]},
  { sectorName: '橡膠工業',         x:  -0.5, y: -0.03, size: 8, stocks: [
    { code: '2105', name: '正新',     industry: '橡膠工業',  netBuy:   -30 },
  ]},
  { sectorName: '玻璃陶瓷',         x:  -0.3, y:  0.01, size: 6, stocks: [
    { code: '1802', name: '台玻',     industry: '玻璃陶瓷',  netBuy:    10 },
  ]},
  { sectorName: '造紙工業',         x:   0.2, y: -0.02, size: 5, stocks: [
    { code: '1902', name: '台紙',     industry: '造紙工業',  netBuy:     5 },
  ]},
  { sectorName: '水泥工業',         x:   1.1, y:  0.05, size: 12, stocks: [
    { code: '1101', name: '台泥',     industry: '水泥工業',  netBuy:   130 },
    { code: '1102', name: '亞泥',     industry: '水泥工業',  netBuy:    70 },
  ]},
  { sectorName: '觀光餐旅',         x:  -2.8, y:  0.12, size: 14, stocks: [
    { code: '2727', name: '王品',     industry: '觀光餐旅',  netBuy:   -80 },
  ]},
  { sectorName: '貿易百貨',         x:   0.6, y:  0.04, size: 10, stocks: [
    { code: '2903', name: '遠百',     industry: '貿易百貨',  netBuy:    25 },
  ]},
  { sectorName: '油電燃氣',         x:   4.5, y:  0.20, size: 30, stocks: [
    { code: '9945', name: '潤泰新',   industry: '油電燃氣',  netBuy:   340 },
  ]},
  { sectorName: '綜合',             x:  -0.8, y: -0.06, size: 8, stocks: [] },
]

export const MOCK_DATA: SnapshotData = {
  updatedAt: today.toISOString(),
  stocks: [
    { code: '2330', name: '台積電',  industry: '半導體業', sector: '半導體業',         close: 1085, changePercent:  2.1, pe: 25.3, eps: 42.8, foreignNetBuy:  8230, closes: fakePriceHistory(1085), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2317', name: '鴻海',    industry: '電腦及週邊設備業', sector: '電腦及週邊設備業', close: 215,  changePercent:  4.2, pe: 12.1, eps: 17.8, foreignNetBuy:  3150, closes: fakePriceHistory(215),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2382', name: '廣達',    industry: '電腦及週邊設備業', sector: '電腦及週邊設備業', close: 325,  changePercent: -1.5, pe: 18.5, eps: 17.6, foreignNetBuy: -1820, closes: fakePriceHistory(325),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2409', name: '友達',    industry: '光電業', sector: '光電業',             close: 18.3, changePercent: -0.7, pe:  8.2, eps:  2.2, foreignNetBuy:  -520, closes: fakePriceHistory(18.3), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2882', name: '國泰金',  industry: '金融保險', sector: '金融保險',          close: 68.2, changePercent:  0.6, pe: 14.3, eps:  4.8, foreignNetBuy:  1050, closes: fakePriceHistory(68.2), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '6515', name: '穎崴',    industry: '電腦及週邊設備業', sector: '電腦及週邊設備業', close: 380,  changePercent:  5.0, pe: 32.1, eps: 11.8, foreignNetBuy:   890, closes: fakePriceHistory(380),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2002', name: '中鋼',    industry: '鋼鐵工業', sector: '鋼鐵工業',          close: 24.5, changePercent: -1.2, pe: 11.2, eps:  2.2, foreignNetBuy:  -180, closes: fakePriceHistory(24.5), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2886', name: '兆豐金',  industry: '金融保險', sector: '金融保險',          close: 42.5, changePercent:  0.3, pe: 12.8, eps:  3.3, foreignNetBuy:   420, closes: fakePriceHistory(42.5), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '1590', name: '亞德客',  industry: '汽車工業', sector: '汽車工業',          close: 995,  changePercent:  2.3, pe: 22.4, eps: 44.4, foreignNetBuy:   680, closes: fakePriceHistory(995),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '3481', name: '群創',    industry: '光電業', sector: '光電業',             close: 14.1, changePercent: -0.3, pe:  9.5, eps:  1.5, foreignNetBuy:  -310, closes: fakePriceHistory(14.1), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2454', name: '聯發科',  industry: '半導體業', sector: '半導體業',         close: 1280, changePercent:  1.8, pe: 20.1, eps: 63.7, foreignNetBuy:  3120, closes: fakePriceHistory(1280), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2603', name: '長榮',    industry: '航運業', sector: '航運業',             close: 278,  changePercent:  3.5, pe: 8.4, eps: 33.1, foreignNetBuy:  2840, closes: fakePriceHistory(278),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2308', name: '台達電',  industry: '電子零組件業', sector: '電子零組件業',  close: 485,  changePercent:  1.2, pe: 24.5, eps: 19.8, foreignNetBuy:  1540, closes: fakePriceHistory(485),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2412', name: '中華電',  industry: '通信網路業', sector: '通信網路業',      close: 128,  changePercent:  0.2, pe: 22.1, eps:  5.8, foreignNetBuy:   680, closes: fakePriceHistory(128),  dates: Array.from({length:250},(_,i)=>dateStr(i)) },
    { code: '2884', name: '玉山金',  industry: '金融保險', sector: '金融保險',          close: 38.5, changePercent:  0.5, pe: 13.2, eps:  2.9, foreignNetBuy:   310, closes: fakePriceHistory(38.5), dates: Array.from({length:250},(_,i)=>dateStr(i)) },
  ],
  indexHistory: fakeIndexHistory(),
  sectorHistory: [],
  sectors: MOCK_SECTORS,
  marketSignals: {
    updatedAt: today.toISOString(),
    nDays: 100,
    todayIndex: 47018,
    todayMargin: 6095,
    peakDate: '2026-05-08',
    peakIndex: 47741,
    peakMargin: 6421,
    indexDropPct: 1.52,
    marginDropPct: 5.08,
    posGapPct: 3.56,
    posTriggered: false,
    troughDate: '2026-04-07',
    troughIndex: 36296,
    troughMargin: 4149,
    indexRisePct: 29.54,
    marginRisePct: 46.88,
    negGapPct: 17.34,
    negTriggered: true,
  },
}
