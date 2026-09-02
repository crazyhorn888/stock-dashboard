import type { StockHistoryDay, SectorBubble, StockData } from './types'

// P2-5：自選股泡泡圖，X/Y/size/trail 公式與 calcSectors 完全相同，
// 差別只在「分組」改成單一個股（stockHistory 是扁平的個股清單，不是預先聚合的板塊/概念）
export function calcWatchlistBubbles(
  stockHistory: StockHistoryDay[],
  codes: string[],
  stockMap: Record<string, StockData>,
): SectorBubble[] {
  if (!stockHistory.length || codes.length === 0) return []

  const bubbles: SectorBubble[] = []

  for (const code of codes) {
    const sd = stockMap[code]

    const get = (arr: StockHistoryDay[], field: 'net' | 'buySell') =>
      arr.reduce((s, d) => s + (d.stocks.find(st => st.code === code)?.[field] ?? 0), 0)

    // 第 k 天（k=0 今日）往前的滾動視窗座標，公式與 lib/calcSectors.ts 完全一致
    const pointAt = (k: number) => {
      const w5  = stockHistory.slice(k, k + 5)
      const w20 = stockHistory.slice(k, k + 20)
      const net5 = get(w5, 'net')
      return {
        x:    net5,
        y:    (net5 / w5.length) - (get(w20, 'net') / w20.length),
        size: get(w20, 'buySell'),
      }
    }

    const { x, y, size } = pointAt(0)

    const today = stockHistory[0]?.stocks.find(st => st.code === code)

    // 歷史軌跡：最多 5 個往前位置（每個需要 20 天資料），與 calcSectors 同一套算法
    const trail: { x: number; y: number; size: number }[] = []
    const maxTrail = Math.min(5, stockHistory.length - 20)
    for (let k = 1; k <= maxTrail; k++) trail.unshift(pointAt(k))

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

// P2-5 Ghost：找出跟 focusedCode 同概念、資金動能最大的前 N 支個股（不含自己），
// 只用該股「第一個」概念（一股多概念時的簡化取捨，避免陪跑名單受多概念交叉影響）
export function getGhostPeers(
  focusedCode: string,
  conceptStockMap: Record<string, string[]>,
  stockHistory: StockHistoryDay[],
  cap = 8,
): string[] {
  const concepts = conceptStockMap[focusedCode]
  if (!concepts?.length) return []
  const primaryConcept = concepts[0]

  const todayByCode = Object.fromEntries(
    (stockHistory[0]?.stocks ?? []).map(s => [s.code, s]),
  )

  return Object.entries(conceptStockMap)
    .filter(([code, cs]) => code !== focusedCode && cs.includes(primaryConcept))
    .map(([code]) => ({
      code,
      activity: Math.abs(todayByCode[code]?.net ?? 0) + Math.abs(todayByCode[code]?.buySell ?? 0),
    }))
    .sort((a, b) => b.activity - a.activity)
    .slice(0, cap)
    .map(p => p.code)
}
