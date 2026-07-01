export interface StockData {
  code: string
  name: string
  industry: string
  close: number
  changePercent: number
  pe: number | null
  eps: number | null
  foreignNetBuy: number // 億元
  closes: number[]     // 最近 250 個交易日收盤價，index 0 = 最新
  dates: string[]      // 對應日期 YYYY-MM-DD
}

export interface MarketSignals {
  updatedAt: string
  nDays: number         // 計算基準天數（後端固定，前端可 override）
  todayIndex: number
  todayMargin: number   // 億元

  // 正向：從最高點下跌
  peakDate: string
  peakIndex: number
  peakMargin: number
  indexDropPct: number    // 大盤減幅 %
  marginDropPct: number   // 融資減幅 %
  posGapPct: number       // 融資減幅 - 大盤減幅
  posTriggered: boolean   // >= 5%

  // 負向：從最低點反彈
  troughDate: string
  troughIndex: number
  troughMargin: number
  indexRisePct: number    // 大盤增幅 %
  marginRisePct: number   // 融資增幅 %
  negGapPct: number       // 融資增幅 - 大盤增幅
  negTriggered: boolean   // >= 7%
}

export interface SnapshotData {
  updatedAt: string
  stocks: StockData[]
  marketSignals: MarketSignals
}

export interface StockRow extends StockData {
  highDropPct: number  // 距 N 日高 ▼%（負值）
  lowRisePct: number   // 距 N 日低 ▲%（正值）
}
