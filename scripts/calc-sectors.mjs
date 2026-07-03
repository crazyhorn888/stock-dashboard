/**
 * calc-sectors.mjs
 * 從 sectorHistory（近25日 TWSE T86 三大法人資料）計算各類股泡泡圖座標
 *
 * X = 近5日三大法人均淨買超（千張）
 * Y = 加速指標 = (近5日均值 / 近20日均值) - 1
 * size = 近5日買賣均量（千張）
 *
 * 個股清單：使用 stockMap 中 sector === sectorName 的全部股票，
 * 今日有 T86 活動的補上淨買超，其餘顯示 0
 *
 * @param {import('../lib/types').SectorDayData[]} sectorHistory  newest first
 * @param {Record<string, {code:string, name:string, industry:string, sector?:string}>} stockMap
 * @returns {import('../lib/types').SectorBubble[]}
 */
export function calcSectors(sectorHistory, stockMap) {
  if (!sectorHistory || sectorHistory.length === 0) return []

  const days5  = sectorHistory.slice(0, Math.min(5,  sectorHistory.length))
  const days20 = sectorHistory.slice(0, Math.min(20, sectorHistory.length))

  const sectorNames = [...new Set(days20.flatMap(d => d.rows.map(r => r.name)))]

  const bubbles = []
  for (const name of sectorNames) {
    const get = (arr, field) =>
      arr.reduce((s, d) => s + (d.rows.find(r => r.name === name)?.[field] ?? 0), 0)

    const net5  = get(days5, 'net')
    const net20 = get(days20, 'net')
    const buy5  = get(days5, 'buySell')

    const avg5  = net5  / days5.length
    const avg20 = net20 / days20.length

    const x    = avg5 / 1000
    const y    = avg20 !== 0 ? (avg5 / Math.abs(avg20)) - (avg20 > 0 ? 1 : -1) : 0
    const size = Math.abs(buy5 / days5.length / 1000)

    // 今日 T86 淨買超 map（只有有活動的股票）
    const todayRow = sectorHistory[0]?.rows.find(r => r.name === name)
    const t86NetMap = Object.fromEntries(
      (todayRow?.stocks ?? []).map(s => [s.code, s.net])
    )

    // 全部屬於此板塊的股票（從 stockMap 取，sector 欄位對應 T86 板塊名）
    const allSectorStocks = Object.values(stockMap).filter(s =>
      /^\d{4}$/.test(s.code) && (s.sector === name || s.industry === name)
    )

    const stocks = allSectorStocks
      .map(s => ({
        code:     s.code,
        name:     s.name,
        industry: s.industry !== name ? s.industry : (s.sector ?? name),
        netBuy:   t86NetMap[s.code] ?? 0,
      }))
      .sort((a, b) => {
        if (a.industry !== b.industry) return a.industry.localeCompare(b.industry, 'zh-TW')
        return b.netBuy - a.netBuy
      })

    // 若 stockMap 沒有對應股票，fallback 用 T86 的列表
    const finalStocks = stocks.length > 0 ? stocks : (todayRow?.stocks ?? [])
      .filter(s => /^\d{4}$/.test(s.code))
      .map(s => ({ code: s.code, name: s.name, industry: name, netBuy: s.net }))
      .sort((a, b) => b.netBuy - a.netBuy)

    bubbles.push({ sectorName: name, x, y, size, stocks: finalStocks })
  }

  return bubbles
}
