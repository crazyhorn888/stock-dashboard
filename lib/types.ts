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

export interface IndexOHLC {
  date: string    // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number  // 成交金額（億）
}

export interface SnapshotData {
  updatedAt: string
  stocks: StockData[]
  marketSignals: MarketSignals
  indexHistory: IndexOHLC[]      // 近 250 交易日，index 0 = 最新
  sectorHistory: SectorDayData[] // 近 25 交易日 T86 資料，newest first
  sectors: SectorBubble[]        // 由 calc-sectors 計算的泡泡圖資料
}

export interface StockRow extends StockData {
  highDropPct: number  // 距 N 日高 ▼%（負值）
  lowRisePct: number   // 距 N 日低 ▲%（正值）
}

// ── 產業板塊泡泡圖 ──────────────────────────────────

export interface SectorStock {
  code: string
  name: string
  industry: string   // 細項分類（from StockData.industry）
  netBuy: number     // 三大法人淨買超（張）
}

export interface SectorBubble {
  sectorName: string  // 類股名稱（e.g., 電子工業）
  x: number          // 近5日三大法人均淨買超（千張，正=買超）
  y: number          // 加速指標 = (近5日均值/近20日均值) - 1
  size: number       // 近5日買賣均量（千張），控制泡泡半徑
  stocks: SectorStock[]
}

export interface SectorDayRow {
  name: string       // 類股名稱
  net: number        // 三大法人淨買超（張）
  buySell: number    // 三大法人買賣合計（張）
  stocks: { code: string; name: string; net: number }[]
}

export interface SectorDayData {
  date: string
  rows: SectorDayRow[]
}
