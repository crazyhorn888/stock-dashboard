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
  concepts?: string[]  // P2-2：一股多概念 tags（來自 data/concept-sectors.json）
  closes: number[]     // 最近 250 個交易日收盤價，index 0 = 最新
  dates: string[]      // 對應日期 YYYY-MM-DD
  // OHLC + 成交量（cron 抓取後存入，stripped 後存 ohlc.json）
  opens?: number[]     // 開盤價，newest first，最多 250 筆
  highs?: number[]     // 最高價，newest first，最多 250 筆
  lows?: number[]      // 最低價，newest first，最多 250 筆
  volumes?: number[]   // 成交量（張），newest first，最多 250 筆
}

// ohlc.json（Supabase Storage）的型別，前端 lazy fetch 用
export interface OHLCSnapshot {
  updatedAt: string
  bars: Record<string, {
    o?: number[]  // opens，newest first（TPEX 可能缺）
    h?: number[]
    l?: number[]
    v?: number[]  // 成交量（張），newest first
  }>
}

export interface MarketSignals {
  updatedAt: string
  nDays: number         // 計算基準天數（後端固定，前端可 override）
  todayIndex: number
  todayMargin: number | null   // 億元；indexHistory 缺資料時為 null

  // 正向：從最高點下跌
  peakDate: string
  peakIndex: number
  peakMargin: number | null
  indexDropPct: number
  marginDropPct: number | null  // 無 margin 資料時為 null
  posGapPct: number | null
  posTriggered: boolean

  // 負向：從最低點反彈
  troughDate: string
  troughIndex: number
  troughMargin: number | null
  indexRisePct: number
  marginRisePct: number | null
  negGapPct: number | null
  negTriggered: boolean
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

// ── P2-3：全球指數（Yahoo Finance chart API，各市場自己的交易日曆）───────
export interface GlobalIndexData {
  name: string        // 顯示名稱，e.g. S&P500
  bars: IndexOHLC[]   // newest first，近 250 個交易日（chips 不適用，恆為 undefined）
  updatedAt: string
}

export interface SnapshotData {
  updatedAt: string
  stocksDate?: string | null  // 股價資料截至日期（YYYY-MM-DD）；若 < today 表示 STOCK_DAY_ALL 當日尚未就緒
  // P1-6 資料鮮度戳（market.json 提供；latest.json fallback 時為 undefined）
  indexDate?: string | null   // 大盤 K 線截至日
  marginDate?: string | null  // 融資餘額截至日
  chipsDate?: string | null   // 三大法人/期貨籌碼截至日
  sectorDate?: string | null  // T86 板塊資料截至日
  stocks: StockData[]
  marketSignals: MarketSignals
  indexHistory: IndexOHLC[]      // 近 250 交易日，index 0 = 最新
  sectorHistory: SectorDayData[] // 近 25 交易日 T86 資料，newest first
  sectors: SectorBubble[]        // 由 calc-sectors 計算的泡泡圖資料
  // P2-1：概念股分類（一股多概念），結構與 sectorHistory/sectors 完全對應
  conceptHistory?: SectorDayData[]
  concepts?: SectorBubble[]
  // P2-3：全球指數燈號 + Modal（獨立輕量腳本抓取，market.json 沒有時為 undefined）
  globalIndices?: Record<string, GlobalIndexData>
  // P2-4：AI 盤後總結（summary 由 n8n 呼叫 OpenAI 寫回，pipeline 剛跑完時可能還是 null）
  dailyBrief?: DailyBriefFacts
}

export interface DailyBriefFacts {
  date: string | null
  quadrantCounts: { TR: number; TL: number; BL: number; BR: number }
  marketChangePct: number | null
  contrarian: string[]  // 逆勢買超板塊名稱
  top3Performance: { sector: string; avgChangePct: number | null }[]
  anomalies: { code: string; name: string; net: number }[]  // |淨買超| > 30 億
  summary: string | null  // n8n 呼叫 OpenAI 產生，失敗或尚未產生時為 null
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
  netBuy: number      // 三大法人合計淨買超（億元，P1-3 起）
  foreignNet: number  // 外資淨買超（億元）
  trustNet: number    // 投信淨買超（億元）
  dealerNet: number   // 自營淨買超（億元）
}

export interface SectorBubble {
  sectorName: string  // 類股名稱（e.g., 電子工業）
  x: number          // 近5日三大法人均淨買超（億元/日，正=買超，P1-3 起）
  y: number          // 加速指標 = (近5日均值/近20日均值) - 1
  size: number       // 近5日買賣均金額（億元/日），控制泡泡半徑
  trail?: { x: number; y: number }[]  // 歷史位置（oldest first），最多5筆
  stocks: SectorStock[]
}

export interface SectorDayRow {
  name: string       // 類股名稱
  net: number        // 三大法人淨買超（億元，P1-3 起）
  buySell: number    // 三大法人買賣合計（億元）
  stocks: {
    code: string; name: string
    net: number         // 三大法人淨買超（億元）
    foreignNet: number  // 外資淨買超（億元）
    trustNet: number    // 投信淨買超（億元）
    dealerNet: number   // 自營淨買超（億元）
  }[]
}

export interface SectorDayData {
  date: string
  unit?: 'yi'        // 'yi' = 數值為億元（P1-3 新格式）；缺欄位 = 舊「張」格式，載入時會被丟棄重抓
  rows: SectorDayRow[]
}

// ── P2-5：個股歷史（stock-history.json，lazy-load，不進 market.json）───────
export interface StockHistoryEntry {
  code: string; name: string
  net: number         // 三大法人淨買超（億元）
  foreignNet: number
  trustNet: number
  dealerNet: number
  buySell: number      // 買賣合計（億元），watchlist 泡泡的 size 用
}

export interface StockHistoryDay {
  date: string
  unit?: 'yi'
  stocks: StockHistoryEntry[]  // 當日全部 T86 活躍個股
}
