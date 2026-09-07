import type { IndexOHLC } from '@/lib/types'

/**
 * 市場熱度（AC-HT-D1~D8）。
 *
 * heat / warn / entry 三個值由 pipeline 端算好寫進 indexHistory（scripts/calc-heat.mjs），
 * 前端只做「取值 → 判狀態 → 配文案」，不重算統計——因為 Z 值需要 250 日、百分位再 250 日，
 * 瀏覽器手上只有 250 筆快照，算不出來（實測縮短視窗會直接失效：180 日無效果、120 日比基準還差）。
 *
 * 設計依據是 1602 天回測（2019-11-05 ~ 2026-06-09，資料源為期交所官方序列）。
 * 兩個結論改寫了原本的直覺：
 *  1. 熱度高不等於危險——80–95 是整條曲線最安全的一段（跌 5% 僅 11%，基準 20%），
 *     真正危險的是低溫區（24%）與 ≥95 的極熱（28%）
 *  2. 所以熱度是「動能」指標而非「風險」指標，警示要另外用 warn/entry 兩個旗標
 *
 * 風險呈 U 型：太冷與太熱都危險，最安全的是 P80–95。
 *
 * 2026-09-07 重新校準（AC-HT-B8）：先前的機率建在 Phase2 Google Sheet 上，
 * 而該表的選擇權欄位在 2025-05-08 從「未平倉」換成「交易」，dSC 與 fCP 兩項
 * 因此建在錯的量上。改用期交所官方序列後 80–95 從「21% 風險」變成「11%」，
 * 標籤也從「偏熱」改為「強勢」。
 */

export type HeatLevel = 'weak' | 'mid' | 'good' | 'strong' | 'hot' | 'entry'

export interface HeatState {
  /** 0~100 的滾動百分位 */
  heat: number
  /** 六項條件中成立的數量 */
  warn: number
  /** 進場訊號（回落 ≥8% 後熱度自 ≤P30 回升至 ≥P50） */
  entry: boolean
  level: HeatLevel
  label: string
  /** 一句話建議，≤26 字 */
  advice: string
  /** 進場後 60 日賺 10% 且不被套的歷史機率（%） */
  upOdds: number
  /** 20 日內回落 5% 的歷史機率（%） */
  downOdds: number
  /** 該狀態的歷史樣本天數 */
  sample: number
  /** 若該狀態的機率跨期間不穩定，這裡是說明文字（AC-HT-D6） */
  unstable: string | null
  /** 資料尚未更新到最新交易日時的說明（AC-HT-B6），已是最新則為 null */
  stale: { asOf: string; latest: string } | null
  /** 頂部風險警示是否成立（AC-HT-D4 / E2） */
  alertTop: boolean
  /** 警示由哪一條觸發（AC-HT-E3）——兩者的提前量與意義不同 */
  alertBy: 'score' | 'reversal' | 'both' | null
}

/**
 * 各狀態的歷史條件機率。
 * upOdds   = 未來 60 日報酬 ≥ +10% 且 20 日內未跌破 −5%
 * downOdds = 未來 20 日內回落 ≥ 5%
 *
 * 2026-09-07 以期交所官方序列重算，樣本 1602 天。P80 這一刀留著——80–95 的確
 * 是獨立的一段，但方向與先前相反：它是風險最低、勝率最高的區間，三段互不重疊
 * 的期間裡跌 5% 機率都低於 50–80（16/8/9% vs 23/18/10%）。
 */
const STATS: Record<HeatLevel, { up: number; down: number; n: number }> = {
  weak:   { up: 26, down: 24, n: 474 },
  mid:    { up: 32, down: 21, n: 306 },
  good:   { up: 36, down: 18, n: 472 },
  strong: { up: 45, down: 11, n: 231 },
  hot:    { up: 29, down: 28, n: 119 },
  entry:  { up: 56, down: 13, n: 79  },
}

/** 全樣本基準，卡片用來對照 */
export const HEAT_BASELINE = { up: 33, down: 20, n: 1602 }

/**
 * 機率跨期間不穩定的狀態——Modal 要標明可信度低於其他狀態。
 * 弱勢區三段期間的跌 5% 機率是 32% / 4% / 29%（同期基準 26% / 16% / 17%），
 * 中間那段幾乎沒有風險、兩端卻高於基準；強勢區則三段都低於基準（16/8/9%）。
 */
export const UNSTABLE: Partial<Record<HeatLevel, string>> = {
  weak: '此區間的機率跨期間極不穩定（三段期間分別為 32%、4%、29%），可信度低於其他狀態',
}

const COPY: Record<HeatLevel, { label: string; advice: string }> = {
  weak:   { label: '弱勢',     advice: '低溫不是便宜。等熱度回到 P50 以上再進場。' },
  mid:    { label: '轉溫',     advice: '方向未明。等待往上進健康區，或往下轉為觀望。' },
  good:   { label: '健康',     advice: '風險略低於基準，可續抱。' },
  strong: { label: '強勢',     advice: '風險報酬最佳區間，回落機率 11%（基準 20%）。' },
  hot:    { label: '極熱',     advice: '尾部最厚的區間。可停利部分、降槓桿。' },
  entry:  { label: '洗盤轉強', advice: '跌深轉強，歷史最佳進場點。' },
}

/** 六項條件的顯示名稱，順序與 scripts/calc-heat.mjs 的 KEYS 一致 */
export const HEAT_CONDITIONS = [
  '大盤乖離 MA60 偏高',
  '自營不留買權多單',
  '自營大量賣出買權',
  '外資追買權',
  '投信期貨加多單',
  '成交量異常放大',
] as const

/**
 * 從快照取出熱度狀態。
 *
 * AC-HT-B6：熱度的六項條件必須來自同一個交易日的完整籌碼——不能拿今天的
 * 收盤價配昨天的選擇權。所以這裡不會為了「有東西可顯示」而混用兩天的資料，
 * 而是往回找最近一個算得出熱度的交易日，並把落後幾天據實標在卡片上。
 * 整段歷史都沒有熱度（heat-history 還沒回補）才回傳 null、整張卡不顯示。
 */
export function getHeatState(indexHistory: IndexOHLC[] | undefined): HeatState | null {
  const rows = indexHistory ?? []
  const latest = rows[0]
  if (!latest) return null
  // rows 為 newest first，往回找第一個籌碼齊全（heat 算得出來）的交易日
  const src = rows.find(r => r.heat != null)
  if (!src) return null
  const stale = src.date === latest.date
    ? null
    : { asOf: src.date, latest: latest.date }

  const heat = src.heat as number
  const warn = src.warn ?? 0
  const entry = src.entry === true
  const rev = src.rev === true      // AC-HT-E1 外資反轉

  // 進場訊號優先於熱度分級——它本身就落在 P50 以上，但意義完全不同
  // 分界 30 / 50 / 80 / 95，四道刀都在官方資料上重驗過（AC-HT-B8）
  const level: HeatLevel =
    entry ? 'entry'
    : heat >= 95 ? 'hot'
    : heat >= 80 ? 'strong'
    : heat >= 50 ? 'good'
    : heat >= 30 ? 'mid'
    : 'weak'

  const st = STATS[level]
  return {
    heat, warn, entry, level,
    label: COPY[level].label,
    advice: COPY[level].advice,
    upOdds: st.up,
    downOdds: st.down,
    sample: st.n,
    unstable: UNSTABLE[level] ?? null,
    stale,
    // AC-HT-B10：紅燈只由「外資反轉」觸發。原本的「計分 ≥4」在期交所官方序列上
    // 是反指標——64 天、跌 5% 機率 13%，低於 21% 的基準，三段期間都沒贏過
    // （7%/26%、9%/16%、22%/21%），隨機重排 p = 0.92。先前看起來有效（36%、2.1x）
    // 是 Sheet 選擇權欄位定義變更造成的假象。計分改為純資訊，不再亮燈。
    alertTop: rev,
    alertBy: rev ? 'reversal' : null,
  }
}

/** 溫度條的顏色，與狀態一致 */
export const HEAT_BAR: Record<HeatLevel, string> = {
  weak: '#d97706', mid: '#94a3b8', good: '#16a34a',
  strong: '#15803d', hot: '#ef4444', entry: '#2563eb',
}

/** 卡片配色（Tailwind class），比照 MarginThermometer 的寫法 */
export const HEAT_TONE: Record<HeatLevel, { pill: string; num: string; msg: string }> = {
  weak:  { pill: 'bg-amber-50 text-amber-700',  num: 'text-amber-600',  msg: 'bg-amber-50 text-amber-800' },
  mid:   { pill: 'bg-slate-100 text-slate-500', num: 'text-slate-700',  msg: 'bg-slate-100 text-slate-600' },
  good:  { pill: 'bg-green-50 text-green-700',  num: 'text-green-600',  msg: 'bg-green-50 text-green-700' },
  strong: { pill: 'bg-emerald-50 text-emerald-800', num: 'text-emerald-700', msg: 'bg-emerald-50 text-emerald-800' },
  hot:   { pill: 'bg-red-50 text-red-700',      num: 'text-red-500',    msg: 'bg-red-50 text-red-700' },
  entry: { pill: 'bg-blue-50 text-blue-700',    num: 'text-blue-600',   msg: 'bg-blue-50 text-blue-700' },
}
