import type { SnapshotData } from './types'

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
