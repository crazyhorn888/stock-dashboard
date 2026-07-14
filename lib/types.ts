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
    d0?: string | null    // R15：對齊錨點 = 上傳當下該股 dates[0]，pipeline 回灌時定位用
    o?: (number | null)[] // opens，newest first，最多 120 筆（TPEX 可能缺；R15 對齊補位可能為 null）
    h?: (number | null)[]
    l?: (number | null)[]
    v?: (number | null)[] // 成交量（張），newest first
  }>
}

export interface MarketSignals {
  updatedAt: string
  nDays: number         // 計算基準天數（後端固定，前端可 override）
  todayIndex: number
  todayMargin: number | null   // 億元；找不到任何歷史融資資料時為 null
  todayMarginDate?: string | null  // todayMargin 實際來源日期（今天融資還沒出來時會 fallback 用最近一筆，日期會早於今天）

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

// 期貨單商品表：各身分 [多方, 空方, 淨額]（口）
export interface ChipsFutTable {
  foreign: number[]
  trust:   number[]
  dealer:  number[]
  retail?: number[]   // 僅未平倉有（推導值）
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

  // 期貨 [多方, 空方, 淨額]（口，2026-07-15）——大台/小台/微台。
  // 未平倉含散戶（全市場OI−法人推導）；當日交易僅三大法人（TAIFEX 不公布散戶交易明細）。
  // 舊資料（2026-07-15 前的 chips）無這兩個欄位 → undefined，前端顯示「—」
  fut_oi?: Record<'tx' | 'mtx' | 'imf', ChipsFutTable | null> | null
  fut_tr?: Record<'tx' | 'mtx' | 'imf', ChipsFutTable | null> | null

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

// 台股是否休市（TWSE 官方休市日曆，check-holiday.mjs 產出，永遠執行不受 Guard 限制）
export interface HolidayStatus {
  date: string        // 判斷當下的台北日期 YYYY-MM-DD
  isHoliday: boolean
  name: string | null // 假日名稱（例如「中秋節」），週末固定為「週末」
  checkedAt: string
}

export interface StockRow extends StockData {
  highDropPct: number  // 距 N 日高 ▼%（負值）
  lowRisePct: number   // 距 N 日低 ▲%（正值）
  // 當日三大法人（day0 T86 統一資料源，見 lib/instNet；上櫃股無 T86 → undefined 顯示「—」）
  trustNet?: number    // 投信（億）
  dealerNet?: number   // 自營（億）
  instTotal?: number   // 合計（億）
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
