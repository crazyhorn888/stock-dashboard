import type { SectorBubble, SectorDayData, SectorStock, StockData } from './types'

export function calcSectors(
  sectorHistory: SectorDayData[],
  stocks: StockData[],
  matchFn?: (stock: StockData, name: string) => boolean,
): SectorBubble[] {
  if (!sectorHistory || sectorHistory.length === 0) return []
  matchFn ??= (s, name) => s.sector === name || s.industry === name

  const days20 = sectorHistory.slice(0, Math.min(20, sectorHistory.length))

  const sectorNames = [...new Set(days20.flatMap(d => d.rows.map(r => r.name)))]

  const bubbles: SectorBubble[] = []

  for (const name of sectorNames) {
    const get = (arr: SectorDayData[], field: 'net' | 'buySell') =>
      arr.reduce((s, d) => s + (d.rows.find(r => r.name === name)?.[field] ?? 0), 0)

    // 第 k 天（k=0 今日）往前的滾動視窗座標；P1-3 起 rows 內數值已是億元
    // X＝近5日淨買超總額（億）、Y＝加速度（億/日）＝5日均−20日均、size＝近20日買賣總額（買+賣，億）
    const pointAt = (k: number) => {
      const w5  = sectorHistory.slice(k, k + 5)
      const w20 = sectorHistory.slice(k, k + 20)
      const net5 = get(w5, 'net')
      return {
        x:    net5,
        y:    (net5 / w5.length) - (get(w20, 'net') / w20.length),
        size: get(w20, 'buySell'),
      }
    }

    const { x, y, size } = pointAt(0)

    // 今日 T86 個股 map（只有 frame 0 有意義；歷史 frame 顯示 0）
    const todayRow  = sectorHistory[0]?.rows.find(r => r.name === name)
    const t86Map    = Object.fromEntries((todayRow?.stocks ?? []).map(s => [s.code, s]))

    const allSectorStocks = stocks.filter(
      s => /^\d{4}$/.test(s.code) && matchFn!(s, name),
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

    // 歷史軌跡：最多 5 個往前位置（每個需要 20 天資料），與今日同一組公式
    const trail: { x: number; y: number; size: number }[] = []
    const maxTrail = Math.min(5, sectorHistory.length - 20)
    for (let k = 1; k <= maxTrail; k++) trail.unshift(pointAt(k))

    bubbles.push({ sectorName: name, x, y, size, trail, stocks: finalStocks })
  }

  return bubbles
}

// P2-1：概念泡泡圖，X/Y/size/trail 邏輯與官方分類板塊完全共用，
// 差別只在「股票屬於哪個分組」的判斷改成 conceptMap 的一股多概念查表
export function calcConcepts(
  conceptHistory: SectorDayData[],
  stocks: StockData[],
  conceptMap: Record<string, string[]>,
): SectorBubble[] {
  return calcSectors(
    conceptHistory,
    stocks,
    (s, name) => (conceptMap[s.code] ?? []).includes(name),
  )
}
