import type { SectorBubble, SectorDayData, SectorStock, StockData } from './types'

export function calcSectors(
  sectorHistory: SectorDayData[],
  stocks: StockData[],
): SectorBubble[] {
  if (!sectorHistory || sectorHistory.length === 0) return []

  const days5  = sectorHistory.slice(0, Math.min(5,  sectorHistory.length))
  const days20 = sectorHistory.slice(0, Math.min(20, sectorHistory.length))

  const sectorNames = [...new Set(days20.flatMap(d => d.rows.map(r => r.name)))]

  const bubbles: SectorBubble[] = []

  for (const name of sectorNames) {
    const get = (arr: SectorDayData[], field: 'net' | 'buySell') =>
      arr.reduce((s, d) => s + (d.rows.find(r => r.name === name)?.[field] ?? 0), 0)

    const net5  = get(days5,  'net')
    const net20 = get(days20, 'net')
    const buy5  = get(days5,  'buySell')

    const avg5  = net5  / days5.length
    const avg20 = net20 / days20.length

    const x    = avg5 / 1000
    const y    = avg20 !== 0 ? (avg5 / Math.abs(avg20)) - (avg20 > 0 ? 1 : -1) : 0
    const size = Math.abs(buy5 / days5.length / 1000)

    // 今日 T86 個股 map（只有 frame 0 有意義；歷史 frame 顯示 0）
    const todayRow  = sectorHistory[0]?.rows.find(r => r.name === name)
    const t86Map    = Object.fromEntries((todayRow?.stocks ?? []).map(s => [s.code, s]))

    const allSectorStocks = stocks.filter(
      s => /^\d{4}$/.test(s.code) && (s.sector === name || s.industry === name),
    )

    const stockList: SectorStock[] = allSectorStocks
      .map(s => {
        const t = t86Map[s.code]
        return {
          code:       s.code,
          name:       s.name,
          industry:   s.industry !== name ? s.industry : (s.sector ?? name),
          netBuy:     t?.net        ?? 0,
          foreignNet: t?.foreignNet ?? 0,
          trustNet:   t?.trustNet   ?? 0,
          dealerNet:  t?.dealerNet  ?? 0,
        }
      })
      .sort((a, b) => {
        if (a.industry !== b.industry) return a.industry.localeCompare(b.industry, 'zh-TW')
        return b.netBuy - a.netBuy
      })

    const finalStocks: SectorStock[] = stockList.length > 0
      ? stockList
      : (todayRow?.stocks ?? [])
          .filter(s => /^\d{4}$/.test(s.code))
          .map(s => ({
            code: s.code, name: s.name, industry: name,
            netBuy: s.net ?? 0, foreignNet: s.foreignNet ?? 0,
            trustNet: s.trustNet ?? 0, dealerNet: s.dealerNet ?? 0,
          }))
          .sort((a, b) => b.netBuy - a.netBuy)

    // 歷史軌跡：最多 5 個往前位置（每個需要 20 天資料）
    const trail: { x: number; y: number }[] = []
    const maxTrail = Math.min(5, sectorHistory.length - 20)
    for (let k = 1; k <= maxTrail; k++) {
      const s5  = sectorHistory.slice(k, k + 5)
      const s20 = sectorHistory.slice(k, k + 20)
      const n5  = s5.reduce((s, d)  => s + (d.rows.find(r => r.name === name)?.net ?? 0), 0)
      const n20 = s20.reduce((s, d) => s + (d.rows.find(r => r.name === name)?.net ?? 0), 0)
      const a5  = n5 / s5.length
      const a20 = n20 / s20.length
      trail.unshift({
        x: a5 / 1000,
        y: a20 !== 0 ? (a5 / Math.abs(a20)) - (a20 > 0 ? 1 : -1) : 0,
      })
    }

    bubbles.push({ sectorName: name, x, y, size, trail, stocks: finalStocks })
  }

  return bubbles
}
