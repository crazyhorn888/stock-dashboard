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
  // Phase1 2026-09-06 新增：金額（千元），市場熱度用。缺漏為 null，不可視為 0。
  // opt_tr 只有 *_amt 四項、opt_oi 只有 *_oi_net_amt 兩項，各自不會同時出現
  bc_amt?: number | null
  sc_amt?: number | null
  bp_amt?: number | null
  sp_amt?: number | null
  call_oi_net_amt?: number | null
  put_oi_net_amt?: number | null
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
  margin_share?: number | null   // 融資張數（MI_MARGN 交易單位），券資比用
  short_share?: number | null    // 融券張數，券資比 = short_share / margin_share
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
  volume: number  // 成交金額（十萬元）——fetch-daily.mjs 由 TWSE 的元除以 1e5
  chips?: ChipsData
  // 市場熱度（AC-HT-C3）：由 scripts/calc-heat.mjs 在 pipeline 端算好寫入，
  // 前端只讀不算。資料不足或 heat-history.json 尚未回補時為 null/undefined
  heat?:  number | null   // 0~100 滾動百分位
  warn?:  number | null   // 0~6 六項條件中成立的數量
  entry?: boolean | null  // 進場訊號
  rev?:   boolean | null  // 外資反轉（AC-HT-E1：押多但現貨倒貨）
}

// ── P2-3：全球指數（Yahoo Finance chart API，各市場自己的交易日曆）───────
export interface GlobalIndexData {
  name: string        // 顯示名稱，e.g. S&P500
  bars: IndexOHLC[]   // newest first，近 250 個交易日（chips 不適用，恆為 undefined）
  /**
   * AC-GL-4：近 14 天內該市場休市的平日（YYYY-MM-DD，市場當地日期）。
   * 由 fetch-global.mjs 從 Yahoo 序列的缺口推出來——不必維護各國假日表。
   * 前端算鮮度時要把這些天扣掉，否則「今天休市、顯示前一交易日」會被誤判成資料落後。
   * 舊快照沒有這個欄位，故為 optional。
   */
  closedDays?: string[]
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
  x: number          // 近5日三大法人淨買超總額（億元，正=買超）
  y: number          // 資金加速度（億元/日）= 近5日均淨買超 − 近20日均淨買超
  size: number       // 近20日三大法人買賣總額（買+賣，億元，滾動視窗），控制泡泡半徑
  // 歷史位置（oldest first），最多5筆；size 逐點重算，回放時泡泡會跟著漲縮
  trail?: { x: number; y: number; size: number }[]
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

// ── AC-IC-1：法人成本（inst-cost.json）────────────────────────────────────
// key 形如 t5/t10/t20/t60/t120（三大法人合計）與 f5/…/f120（外資）。
// 窗口天數不足時該 key 不存在——起步期 60/120 會缺，前端顯示「累積中」。
export interface InstCostSnapshot {
  updatedAt: string
  date: string | null      // 序列最新一天
  days: number             // 序列已累積天數，判斷 60/120 是否還在累積用
  cost: Record<string, Record<string, number>>
}

// ── 功能二十四：集保大戶籌碼（holders.json，calc-holders-z.mjs 產出）──────────
// 週更資料（TDCC 每週最後營業日結算、週六上架），與日更的股價最多差 5 個交易日。
export interface HoldersEntry {
  h: number              // 百張大戶持股比例 %（級距 10~15 加總）
  k: number              // 千張大戶持股比例 %（級距 15）
  prevH: number | null   // 上週值，Modal 的三列表格用
  prevK: number | null
  dh: number | null      // 週變化（百分點）；股本事件週為 null
  dk: number | null
  zh: number | null      // 穩健 Z（中位數/MAD）；累積不足 26 週為 null
  zk: number | null
  sameDir: boolean       // 百張與千張本週同方向變動（AC-HZ-4 判定的第二個條件）
  capitalEvent: boolean  // 該週總股數變動 > 0.5%，數字不可比（AC-HZ-3）
  weeks: number          // 已累積週數，判斷要不要顯示「累積中」
  futMove?: boolean      // 同週個股期貨也異動（AC-HZ-7）；沒有個股期貨的標的為 undefined
}

export interface HoldersSnapshot {
  updatedAt: string
  dataDate: string           // 本週資料日 YYYY-MM-DD
  prevDate: string | null
  threshold: number          // 後端預設門檻（5），前端可由篩選面板覆寫
  window: number             // Z 值滾動窗（週）
  minPeriods: number         // 樣本不足這個數就不給 Z
  stocks: Record<string, HoldersEntry>
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

// ── 功能二十三（AC-OI-A4/A5）：選擇權 OI（options-oi.json）─────────────────
// days[交易日][契約代號] = 該日這檔的 Call/Put 各前三大 OI；[履約價, 口數] 由大到小。
// 契約代號含 W = 週三到期週選、含 F = 週五到期週選、純 6 碼 = 月選（不進日曆，另有區塊）。
export interface OptionsOIContract {
  exp: string                 // 契約到期日 YYYY-MM-DD
  C: [number, number][]       // 買權（壓力 SC）累積 OI 前三大
  P: [number, number][]       // 賣權（支撐 SP）累積 OI 前三大
  // 當日淨增加前三大＝今日 OI − 昨日 OI（只取正值），看「今天押在哪」。
  // 與累積是兩件事：累積是整段佈局，當日是今天的動作，位置常常不同。
  // 掛牌首日沒有昨日資料，此時等同當日 OI 本身；全無增加時欄位不存在。
  dC?: [number, number][]
  dP?: [number, number][]

  // ── AC-PCR（2026-09-09）：PC Ratio 與支撐壓力通道 ──
  /** 該契約 Call／Put 總 OI。PC Ratio = oiP / oiC；全部契約加總等於期交所官方公布值 */
  oiC?: number
  oiP?: number
  /** 現價（期貨收盤）±5% 內的最大 OI 位置 [履約價, 口數]。
   *  不用全域 Top1——它有四分之一的日子落在離現價 20% 以外的深價外保單 */
  nC?: [number, number]
  nP?: [number, number]
  /** ±5% 內的當日淨增加前三大（先框範圍、再排前三大） */
  dnC?: [number, number][]
  dnP?: [number, number][]

  // ── AC-CL-2（2026-09-10）：主力成本推估的當日切片 ──
  /** 只在「尚未結算且 45 天內到期」的契約上出現；已結算者由 pipeline 清除以省體積 */
  ml?: {
    /** 當日建倉明細 [履約價, C|P, 成交量, OI 增量, 收盤價]，只收價內且留倉率 ≥80% */
    e?: [number, 'C' | 'P', number, number, number][]
    /** 追蹤中履約價的當日 OI [履約價, C|P, OI]。OI 為 0 者不寫，前端讀不到即視為 0 */
    o?: [number, 'C' | 'P', number][]
    /** 賣方防線＝價外、±5% 內 OI 最大的履約價 [履約價, OI, 收盤價] */
    sc?: [number, number, number]
    sp?: [number, number, number]
  }
}

export interface OptionsOISnapshot {
  updatedAt: string | null
  days: Record<string, Record<string, OptionsOIContract>>
  /** 各契約的最後結算日與最後結算價（期交所 optIndxFSP） */
  settle: Record<string, { date: string; fsp: number }>
  /** AC-PCR-3：每日期貨近月收盤，用來框 ±5% 範圍；舊快照沒有這個欄位 */
  fut?: Record<string, number>
}
