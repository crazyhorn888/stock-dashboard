import type { IndexOHLC, MarketSignals } from '@/lib/types'

/**
 * 用前端的 N 重算大盤訊號（後端 marketSignals.nDays 固定 100，不隨使用者 N 變）。
 * 原本只寫在 /aftermarket 頁內，2026-09-03 抽出來讓 /signals 也能用同一套，
 * 否則兩頁對同一個 N 會給出不同答案。
 *
 * @param history  indexHistory（newest first）
 * @param base     後端算好的 marketSignals，當作缺欄位的底
 * @param n        參考區間天數
 */
export function calcMarketSignals(
  history: IndexOHLC[] | undefined,
  base: MarketSignals,
  n: number,
): MarketSignals {
  const slice = (history ?? []).slice(0, n)
  if (!slice.length) return base

  const todayIndex = slice[0].close
  // 融資通常傍晚後才發布，白天「今天」大多還沒有值——往前找最近一筆有資料的日期當顯示值，
  // todayMarginDate 讓前端能標示這是哪一天的數字，避免誤會成當天數字
  const marginBar = (history ?? []).find(d => d.chips?.margin_amount != null)
  const todayMargin = marginBar?.chips?.margin_amount ?? null
  const todayMarginDate = marginBar?.date ?? null

  let peakBar = slice[0]
  let troughBar = slice[0]
  for (const d of slice) {
    if (d.close > peakBar.close) peakBar = d
    if (d.close < troughBar.close) troughBar = d
  }

  const peakIndex    = peakBar.close
  const peakMargin   = peakBar.chips?.margin_amount ?? null
  const troughIndex  = troughBar.close
  const troughMargin = troughBar.chips?.margin_amount ?? null

  const indexDropPct  = peakIndex > 0 ? Math.abs((todayIndex - peakIndex) / peakIndex * 100) : 0
  const marginDropPct = (peakMargin != null && todayMargin != null && peakMargin > 0)
    ? Math.abs((todayMargin - peakMargin) / peakMargin * 100) : null
  const posGapPct = marginDropPct != null ? marginDropPct - indexDropPct : null

  const indexRisePct  = troughIndex > 0 ? Math.abs((todayIndex - troughIndex) / troughIndex * 100) : 0
  const marginRisePct = (troughMargin != null && todayMargin != null && troughMargin > 0)
    ? Math.abs((todayMargin - troughMargin) / troughMargin * 100) : null
  const negGapPct = marginRisePct != null ? marginRisePct - indexRisePct : null

  return {
    ...base,
    nDays: n,
    todayIndex,
    todayMargin,
    todayMarginDate,
    peakDate:   peakBar.date,
    peakIndex,
    peakMargin,
    indexDropPct,
    marginDropPct,
    posGapPct,
    posTriggered: posGapPct != null && posGapPct >= 5,
    troughDate:  troughBar.date,
    troughIndex,
    troughMargin,
    indexRisePct,
    marginRisePct,
    negGapPct,
    negTriggered: negGapPct != null && negGapPct >= 7,
  }
}
