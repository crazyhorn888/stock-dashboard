import type { IndexOHLC } from '@/lib/types'

/**
 * 市場熱度（AC-HT-D1~D8）。
 *
 * heat / warn / entry 三個值由 pipeline 端算好寫進 indexHistory（scripts/calc-heat.mjs），
 * 前端只做「取值 → 判狀態 → 配文案」，不重算統計——因為 Z 值需要 250 日、百分位再 250 日，
 * 瀏覽器手上只有 250 筆快照，算不出來（實測縮短視窗會直接失效：180 日無效果、120 日比基準還差）。
 *
 * 設計依據是 1130 天回測（2022-01-03 ~ 2026-09-03）。兩個結論改寫了原本的直覺：
 *  1. 熱度高不等於危險——過熱後 60 日平均 +12.05%，高於基準 +8.79%。真正弱的是低溫區（+2.82%）
 *  2. 所以熱度是「動能」指標而非「風險」指標，警示要另外用 warn/entry 兩個旗標，
 *     且平常不顯示——紅色一年只亮 36 天才有意義
 *
 * 風險呈 U 型：太冷與太熱都危險，最安全的是 P50–80。
 */

export type HeatLevel = 'weak' | 'mid' | 'good' | 'hot' | 'entry'

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
  /** 頂部風險警示是否成立（AC-HT-D4 / E2） */
  alertTop: boolean
  /** 警示由哪一條觸發（AC-HT-E3）——兩者的提前量與意義不同 */
  alertBy: 'score' | 'reversal' | 'both' | null
}

/** 各狀態的歷史條件機率（1130 天回測；upOdds = 60 日報酬 ≥+10% 且 20 日內未跌破 −5%） */
const STATS: Record<HeatLevel, { up: number; down: number; n: number }> = {
  weak:  { up: 25, down: 24, n: 212 },
  mid:   { up: 34, down: 10, n: 117 },
  good:  { up: 61, down: 8,  n: 213 },
  hot:   { up: 49, down: 26, n: 57  },
  entry: { up: 88, down: 0,  n: 16  },
}

/** 全樣本基準，卡片用來對照 */
export const HEAT_BASELINE = { up: 42, down: 15, n: 770 }

const COPY: Record<HeatLevel, { label: string; advice: string }> = {
  weak:  { label: '弱勢',     advice: '低溫不是便宜。等熱度回到 P50 以上再進場。' },
  mid:   { label: '轉溫',     advice: '方向未明。等待往上進健康區，或往下轉為觀望。' },
  good:  { label: '健康偏強', advice: '風險報酬最佳區間，續抱。' },
  hot:   { label: '極熱',     advice: '續漲仍是主劇本，但尾部變厚。可停利部分、降槓桿。' },
  entry: { label: '洗盤轉強', advice: '跌深轉強，歷史最佳進場點。' },
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
 * 從快照最新一筆取出熱度狀態。
 * pipeline 尚未產出（heat 為 null）時回傳 null，卡片就不顯示——
 * 這會發生在 heat-history.json 還沒回補、或當日籌碼缺選擇權金額欄位時。
 */
export function getHeatState(indexHistory: IndexOHLC[] | undefined): HeatState | null {
  const today = indexHistory?.[0]
  if (!today || today.heat == null) return null

  const heat = today.heat
  const warn = today.warn ?? 0
  const entry = today.entry === true
  const rev = today.rev === true      // AC-HT-E1 外資反轉

  // 進場訊號優先於熱度分級——它本身就落在 P50 以上，但意義完全不同
  const level: HeatLevel =
    entry ? 'entry'
    : heat >= 95 ? 'hot'
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
    // AC-HT-E2：計分 ≥4 或外資反轉，任一成立即亮紅燈
    alertTop: warn >= 4 || rev,
    alertBy: warn >= 4 && rev ? 'both' : warn >= 4 ? 'score' : rev ? 'reversal' : null,
  }
}

/** 溫度條的顏色，與狀態一致 */
export const HEAT_BAR: Record<HeatLevel, string> = {
  weak: '#d97706', mid: '#94a3b8', good: '#16a34a', hot: '#ef4444', entry: '#2563eb',
}

/** 卡片配色（Tailwind class），比照 MarginThermometer 的寫法 */
export const HEAT_TONE: Record<HeatLevel, { pill: string; num: string; msg: string }> = {
  weak:  { pill: 'bg-amber-50 text-amber-700',  num: 'text-amber-600',  msg: 'bg-amber-50 text-amber-800' },
  mid:   { pill: 'bg-slate-100 text-slate-500', num: 'text-slate-700',  msg: 'bg-slate-100 text-slate-600' },
  good:  { pill: 'bg-green-50 text-green-700',  num: 'text-green-600',  msg: 'bg-green-50 text-green-700' },
  hot:   { pill: 'bg-red-50 text-red-700',      num: 'text-red-500',    msg: 'bg-red-50 text-red-700' },
  entry: { pill: 'bg-blue-50 text-blue-700',    num: 'text-blue-600',   msg: 'bg-blue-50 text-blue-700' },
}
