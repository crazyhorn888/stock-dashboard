import type { StockData, StockRow } from './types'

/** 從 StockData 根據 N 計算距高/距低 */
export function calcStockRow(stock: StockData, n: number): StockRow {
  const window = stock.closes.slice(0, n)
  const high = Math.max(...window)
  const low = Math.min(...window)
  const cur = stock.closes[0]

  const highDropPct = high > 0 ? ((cur - high) / high) * 100 : 0
  const lowRisePct = low > 0 ? ((cur - low) / low) * 100 : 0

  return { ...stock, highDropPct, lowRisePct }
}

/** 格式化百分比 */
export function fmtPct(v: number, decimals = 2): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(decimals)}%`
}

/** 格式化億元 */
export function fmtYi(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 億`
}
