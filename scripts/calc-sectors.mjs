/**
 * calc-sectors.mjs
 * 從 sectorHistory（近25日 TWSE T86 三大法人資料）計算各類股泡泡圖座標
 *
 * X = 近5日三大法人均淨買超（千張）
 * Y = 加速指標 = (近5日均值 / 近20日均值) - 1
 *     > 0 = 資金加速（Y 軸上方）
 *     < 0 = 資金放緩（Y 軸下方）
 * size = 近5日買賣均量（千張），控制泡泡半徑
 *
 * @param {import('../lib/types').SectorDayData[]} sectorHistory  newest first
 * @param {Record<string, {industry: string}>} stockMap  code → StockData
 * @returns {import('../lib/types').SectorBubble[]}
 */
export function calcSectors(sectorHistory, stockMap) {
  if (!sectorHistory || sectorHistory.length === 0) return []

  const days5  = sectorHistory.slice(0, Math.min(5,  sectorHistory.length))
  const days20 = sectorHistory.slice(0, Math.min(20, sectorHistory.length))

  // 取所有類股名稱（從 days20 聯集）
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

    const x    = avg5 / 1000                                       // 千張
    const y    = avg20 !== 0 ? (avg5 / Math.abs(avg20)) - (avg20 > 0 ? 1 : -1) : 0
    const size = Math.abs(buy5 / days5.length / 1000)             // 千張，取正值

    // 個股：從最新一天的 T86 取，加上 industry 細項
    const todayRow = sectorHistory[0]?.rows.find(r => r.name === name)
    const stocks = (todayRow?.stocks ?? [])
      .filter(s => /^\d{4}$/.test(s.code))
      .map(s => ({
        code:     s.code,
        name:     s.name,
        industry: stockMap[s.code]?.industry ?? '其他',
        netBuy:   s.net,
      }))
      // 按細項分組後，各組內部按淨買超由大到小
      .sort((a, b) => {
        if (a.industry !== b.industry) return a.industry.localeCompare(b.industry, 'zh-TW')
        return b.netBuy - a.netBuy
      })

    bubbles.push({ sectorName: name, x, y, size, stocks })
  }

  return bubbles
}
