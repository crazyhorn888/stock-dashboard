import type { IndexOHLC } from '@/lib/types'

/**
 * 低點／高點反轉訊號（AC-RV-1~9）。
 *
 * 設計依據是 647 天回測（2024-01 ~ 2026-09），兩個結論改寫了原始規格：
 *  1. 原規格「四條件全部成立才亮燈」在 647 天內一次都沒觸發 → 改計分制，3 分即亮
 *  2. 「外資賣超 > 100 億」「期貨淨空 > 2 萬口」這類絕對門檻，成立率高達 35%／48%，
 *     且會隨市值膨脹越來越鬆 → 一律改用 Z-Score（成立率自動穩定在 9% 上下）
 *
 * 實測表現（後 5 日超額報酬，基準 +0.75%）：
 *   低點 3 分：10 天 +3.48%   ／ 高點 3 分：21 天 −1.22%、4 分：3 天 −1.43%
 */

export interface ConditionResult {
  label: string
  ok: boolean
  detail: string      // 目前數值，卡片展開時顯示
}

export interface ReversalSignal {
  score: number               // 0~4
  level: 'none' | 'watch' | 'alert'   // 2 分以下 none、3 分 watch、4 分 alert
  conditions: ConditionResult[]
  missing: string[]           // 未成立的條件標籤，卡片顯示「缺：…」
}

const fmtPct = (v: number | null, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`

/** 滾動 Z-Score；樣本不足 window 天回傳 null（AC-RV-6：不足即視為條件不成立） */
export function rollingZScore(values: (number | null)[], window: number): number | null {
  const w = values.slice(0, window).filter((v): v is number => v != null)
  if (w.length < window) return null
  const mu = w.reduce((a, b) => a + b, 0) / w.length
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mu) ** 2, 0) / w.length)
  if (sd === 0) return null
  return (w[0] - mu) / sd
}

/** 由 indexHistory（newest first）算出每日融資變動%、券資比等序列 */
function buildSeries(history: IndexOHLC[]) {
  const marginPct: (number | null)[] = []
  const shortRatio: (number | null)[] = []
  const foreign: (number | null)[] = []
  for (let i = 0; i < history.length; i++) {
    const d = history[i], p = history[i + 1]
    const m = d.chips?.margin_amount, pm = p?.chips?.margin_amount
    marginPct.push((m != null && pm != null && pm > 0) ? ((m - pm) / pm) * 100 : null)
    const ms = d.chips?.margin_share, ss = d.chips?.short_share
    shortRatio.push((ms != null && ss != null && ms > 0) ? (ss / ms) * 100 : null)
    foreign.push(d.chips?.foreign_spot ?? null)
  }
  return { marginPct, shortRatio, foreign }
}

/**
 * 低點反轉（正向）：散戶恐慌殺出、法人低檔接手
 * 最常缺的是條件④——大跌當天法人通常也在賣，要隔 1-2 天才進場承接
 */
export function calcLowReversal(history: IndexOHLC[]): ReversalSignal {
  const today = history[0], prev = history[1]
  const { marginPct, foreign } = buildSeries(history)

  const idxPct = (today && prev && prev.close > 0)
    ? ((today.close - prev.close) / prev.close) * 100 : null
  const mPct = marginPct[0]
  const z = rollingZScore(marginPct, 20)
  const inst = (today?.chips?.foreign_spot ?? null) != null
    ? (today!.chips!.foreign_spot + (today!.chips!.trust_spot ?? 0)) : null

  const elasticity = (mPct != null && idxPct != null && idxPct < 0 && mPct < 0)
    ? Math.abs(mPct) / Math.abs(idxPct) : null

  const conditions: ConditionResult[] = [
    {
      label: '大盤有感下跌',
      ok: idxPct != null && idxPct < -0.5,
      detail: `大盤 ${fmtPct(idxPct)}（需 < -0.5%）`,
    },
    {
      label: '融資恐慌殺出',
      ok: elasticity != null && elasticity > 1.5,
      detail: elasticity != null
        ? `融資跌幅是大盤的 ${elasticity.toFixed(2)} 倍（需 > 1.5）`
        : '融資未減少或大盤未跌',
    },
    {
      label: '統計極端恐慌',
      ok: z != null && z <= -2,
      detail: z != null ? `融資變動 Z = ${z.toFixed(2)}（需 ≤ -2）` : '融資資料不足 20 日',
    },
    {
      label: '法人低檔接手',
      ok: inst != null && inst > 0,
      detail: inst != null ? `外資+投信 ${inst >= 0 ? '+' : ''}${inst.toFixed(0)} 億（需買超）` : '法人資料未到',
    },
  ]
  return summarize(conditions)
}

/**
 * 高點反轉（負向）：融資追價過熱、外資逢高調節
 * 定位是「風險警示」不是「見頂放空」——命中率約 50%，但命中時跌 5~15%、誤報時只少賺 1~4%
 */
export function calcHighReversal(history: IndexOHLC[], nDays = 100): ReversalSignal {
  const today = history[0], prev = history[1]
  const { marginPct, shortRatio, foreign } = buildSeries(history)

  const idxPct = (today && prev && prev.close > 0)
    ? ((today.close - prev.close) / prev.close) * 100 : null
  const mPct = marginPct[0]

  // 條件①：從 N 日低點起算的融資乖離（沿用現有負向卡公式）
  const win = history.slice(0, nDays)
  const trough = win.reduce((m, x) => (x.close < m.close ? x : m), win[0])
  const troughMargin = trough?.chips?.margin_amount ?? null
  const todayMargin = today?.chips?.margin_amount ?? null
  const idxRise = (trough && trough.close > 0 && today)
    ? ((today.close - trough.close) / trough.close) * 100 : null
  const marginRise = (todayMargin != null && troughMargin != null && troughMargin > 0)
    ? ((todayMargin - troughMargin) / troughMargin) * 100 : null
  const negGap = (marginRise != null && idxRise != null) ? marginRise - idxRise : null

  const zRatio = rollingZScore(shortRatio, 60)
  const zForeign = rollingZScore(foreign, 60)

  const conditions: ConditionResult[] = [
    {
      label: '融資追價過頭',
      ok: negGap != null && negGap >= 7,
      detail: negGap != null
        ? `融資增幅超前大盤 ${negGap.toFixed(1)}%（需 ≥ 7%）`
        : '融資或指數資料不足',
    },
    {
      label: '價跌資增背離',
      ok: idxPct != null && mPct != null && idxPct < 0 && mPct > 0,
      detail: (idxPct != null && mPct != null)
        ? `大盤 ${fmtPct(idxPct)}、融資 ${fmtPct(mPct)}`
        : '資料未到',
    },
    {
      label: '軋空燃料枯竭',
      ok: zRatio != null && zRatio <= -1,
      detail: zRatio != null ? `券資比 Z = ${zRatio.toFixed(2)}（需 ≤ -1）` : '券資比資料不足 60 日',
    },
    {
      label: '外資調節出貨',
      ok: zForeign != null && zForeign <= -1.5,
      detail: zForeign != null ? `外資買賣超 Z = ${zForeign.toFixed(2)}（需 ≤ -1.5）` : '外資資料不足 60 日',
    },
  ]
  return summarize(conditions)
}

function summarize(conditions: ConditionResult[]): ReversalSignal {
  const score = conditions.filter(c => c.ok).length
  return {
    score,
    level: score >= 4 ? 'alert' : score === 3 ? 'watch' : 'none',
    conditions,
    missing: conditions.filter(c => !c.ok).map(c => c.label),
  }
}
