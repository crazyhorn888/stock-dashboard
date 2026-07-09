import type { StockHistoryDay, SectorBubble, StockData } from './types'

// P2-5：自選股泡泡圖，X/Y/size/trail 公式與 calcSectors 完全相同，
// 差別只在「分組」改成單一個股（stockHistory 是扁平的個股清單，不是預先聚合的板塊/概念）
export function calcWatchlistBubbles(
  stockHistory: StockHistoryDay[],
  codes: string[],
  stockMap: Record<string, StockData>,
): SectorBubble[] {
  if (!stockHistory.length || codes.length === 0) return []

  const days5  = stockHistory.slice(0, Math.min(5,  stockHistory.length))
  const days20 = stockHistory.slice(0, Math.min(20, stockHistory.length))

  const bubbles: SectorBubble[] = []

  for (const code of codes) {
    const sd = stockMap[code]

    const get = (arr: StockHistoryDay[], field: 'net' | 'buySell') =>
      arr.reduce((s, d) => s + (d.stocks.find(st => st.code === code)?.[field] ?? 0), 0)

    const net5  = get(days5,  'net')
    const net20 = get(days20, 'net')
    const buy5  = get(days5,  'buySell')

    const avg5  = net5  / days5.length
    const avg20 = net20 / days20.length

    const x    = avg5
    const y    = avg20 !== 0 ? (avg5 / Math.abs(avg20)) - (avg20 > 0 ? 1 : -1) : 0
    const size = Math.abs(buy5 / days5.length)

    const today = stockHistory[0]?.stocks.find(st => st.code === code)

    // 歷史軌跡：最多 5 個往前位置（每個需要 20 天資料），與 calcSectors 同一套算法
    const trail: { x: number; y: number }[] = []
    const maxTrail = Math.min(5, stockHistory.length - 20)
    for (let k = 1; k <= maxTrail; k++) {
      const s5  = stockHistory.slice(k, k + 5)
      const s20 = stockHistory.slice(k, k + 20)
      const n5  = s5.reduce((s, d)  => s + (d.stocks.find(st => st.code === code)?.net ?? 0), 0)
      const n20 = s20.reduce((s, d) => s + (d.stocks.find(st => st.code === code)?.net ?? 0), 0)
      const a5  = n5  / s5.length
      const a20 = n20 / s20.length
      trail.unshift({
        x: a5,
        y: a20 !== 0 ? (a5 / Math.abs(a20)) - (a20 > 0 ? 1 : -1) : 0,
      })
    }

    bubbles.push({
      sectorName: sd?.name ?? code,
      x, y, size, trail,
      stocks: [{
        code,
        name:       sd?.name ?? code,
        industry:   sd?.industry ?? '',
        netBuy:     today?.net        ?? 0,
        foreignNet: today?.foreignNet ?? 0,
        trustNet:   today?.trustNet   ?? 0,
        dealerNet:  today?.dealerNet  ?? 0,
      }],
    })
  }

  return bubbles
}
