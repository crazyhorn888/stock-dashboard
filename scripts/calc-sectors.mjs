/**
 * calc-sectors.mjs
 * 從 sectorHistory（近25日 TWSE T86 三大法人資料）計算各類股泡泡圖座標
 *
 * X = 近5日三大法人淨買超總額（億元）
 * Y = 資金加速度（億元/日）= 近5日均淨買超 − 近20日均淨買超
 * size = 近20日三大法人買賣總額（買+賣，億元，滾動視窗）
 *
 * 個股清單：使用 stockMap 中 sector === sectorName 的全部股票，
 * 今日有 T86 活動的補上淨買超，其餘顯示 0
 *
 * @param {import('../lib/types').SectorDayData[]} sectorHistory  newest first
 * @param {Record<string, {code:string, name:string, industry:string, sector?:string}>} stockMap
 * @param {(stock: object, name: string) => boolean} [matchFn]  分組判斷，預設用官方 sector/industry
 * @returns {import('../lib/types').SectorBubble[]}
 */
export function calcSectors(sectorHistory, stockMap, matchFn) {
  if (!sectorHistory || sectorHistory.length === 0) return []
  matchFn ??= (s, name) => s.sector === name || s.industry === name

  const days20 = sectorHistory.slice(0, Math.min(20, sectorHistory.length))

  const sectorNames = [...new Set(days20.flatMap(d => d.rows.map(r => r.name)))]

  const bubbles = []
  for (const name of sectorNames) {
    const get = (arr, field) =>
      arr.reduce((s, d) => s + (d.rows.find(r => r.name === name)?.[field] ?? 0), 0)

    // 第 k 天（k=0 今日）往前的滾動視窗座標；P1-3 起 rows 內數值已是億元
    // 公式必須與 lib/calcSectors.ts、lib/calcWatchlistBubbles.ts 完全一致
    const pointAt = (k) => {
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

    // 今日 T86 個股 map（含三大法人明細）
    const todayRow = sectorHistory[0]?.rows.find(r => r.name === name)
    const t86StockMap = Object.fromEntries(
      (todayRow?.stocks ?? []).map(s => [s.code, s])
    )

    // 全部屬於此板塊的股票（從 stockMap 取，sector 欄位對應 T86 板塊名）
    const allSectorStocks = Object.values(stockMap).filter(s =>
      /^\d{4}$/.test(s.code) && matchFn(s, name)
    )

    const stocks = allSectorStocks
      .map(s => {
        const t = t86StockMap[s.code]
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

    // 若 stockMap 沒有對應股票，fallback 用 T86 的列表
    const finalStocks = stocks.length > 0 ? stocks : (todayRow?.stocks ?? [])
      .filter(s => /^\d{4}$/.test(s.code))
      .map(s => ({
        code: s.code, name: s.name, industry: name,
        netBuy: s.net ?? 0, foreignNet: s.foreignNet ?? 0,
        trustNet: s.trustNet ?? 0, dealerNet: s.dealerNet ?? 0,
      }))
      .sort((a, b) => b.netBuy - a.netBuy)

    // 歷史軌跡：往前最多 5 個交易日的座標（每個需要20天資料），與今日同一組公式
    const trail = []
    const maxTrail = Math.min(5, sectorHistory.length - 20)
    for (let k = 1; k <= maxTrail; k++) trail.unshift(pointAt(k))

    bubbles.push({ sectorName: name, x, y, size, trail, stocks: finalStocks })
  }

  return bubbles
}

/**
 * P2-1：概念泡泡圖，X/Y/size/trail 邏輯與官方分類板塊完全共用，
 * 差別只在「股票屬於哪個分組」的判斷改成 conceptMap 的一股多概念查表
 * @param {import('../lib/types').SectorDayData[]} conceptHistory
 * @param {Record<string, object>} stockMap
 * @param {Record<string, string[]>} conceptMap  code -> concept 名稱陣列
 */
export function calcConcepts(conceptHistory, stockMap, conceptMap) {
  return calcSectors(
    conceptHistory,
    stockMap,
    (s, name) => (conceptMap[s.code] ?? []).includes(name),
  )
}
