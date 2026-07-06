export interface StockData {
  code: string
  name: string
  industry: string     // 細項分類（顯示用）
  sector?: string      // TWSE T86 / t187ap03_L 產業類別（對應泡泡圖板塊）
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

// ── 籌碼資料（每日 Phase 1 + MI_MARGN 合併）─────────────────────────────
export interface ChipsOptionParty {
  bc: number   // 買進Call/口
  sc: number   // 賣出Call/口
  bp: number   // 買進Put/口
  sp: number   // 賣出Put/口
}

export interface ChipsRetailNet {
  call_net: number
  put_net: number
}

export interface ChipsData {
  // 三大法人現貨（億元）
  foreign_spot:  number
  trust_spot:    number
  dealer_self:   number
  dealer_hedge:  number
  inst_total:    number

  // 融資（億元）
  margin_amount: number | null
  margin_change: number | null   // 今日 - 昨日

  // 台指期
  tx_close:  number
  tx_change: number
  basis:     number

  // 外資大台期未平倉（口）
  fx_tx_oi:  number
  fx_tx_chg: number

  // 散戶動能（%）
  retail_mtx_pct: number | string
  retail_imf_pct: number | string

  // PCR / VIX
  pcr: number | string | null
  vix: number | string | null

  // 選擇權當日交易（口）
  opt_tr: {
    foreign: ChipsOptionParty
    trust:   ChipsOptionParty
    dealer:  ChipsOptionParty
    retail:  ChipsRetailNet
  } | null

  // 選擇權未平倉（口）
  opt_oi: {
    foreign: ChipsOptionParty
    trust:   ChipsOptionParty
    dealer:  ChipsOptionParty
    retail:  ChipsRetailNet
  } | null
}

export interface IndexOHLC {
  date: string    // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number  // 成交金額（億）
  chips?: ChipsData
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
  industry: string    // 細項分類（from StockData.industry）
  netBuy: number      // 三大法人合計淨買超（張）
  foreignNet: number  // 外資淨買超（張）
  trustNet: number    // 投信淨買超（張）
  dealerNet: number   // 自營淨買超（張）
}

export interface SectorBubble {
  sectorName: string  // 類股名稱（e.g., 電子工業）
  x: number          // 近5日三大法人均淨買超（千張，正=買超）
  y: number          // 加速指標 = (近5日均值/近20日均值) - 1
  size: number       // 近5日買賣均量（千張），控制泡泡半徑
  trail?: { x: number; y: number }[]  // 歷史位置（oldest first），最多5筆
  stocks: SectorStock[]
}

export interface SectorDayRow {
  name: string       // 類股名稱
  net: number        // 三大法人淨買超（張）
  buySell: number    // 三大法人買賣合計（張）
  stocks: {
    code: string; name: string
    net: number
    foreignNet: number  // 外資淨買超（張）
    trustNet: number    // 投信淨買超（張）
    dealerNet: number   // 自營淨買超（張）
  }[]
}

export interface SectorDayData {
  date: string
  rows: SectorDayRow[]
}
