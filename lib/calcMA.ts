import type { IndexOHLC } from './types'

// bars: newest first. 回傳同長度、同順序的 MA 陣列；lookback 天數不足時該點為 null（線圖從該點開始畫）
export function calcMA(bars: IndexOHLC[], period: number): (number | null)[] {
  return bars.map((_, i) => {
    if (i + period > bars.length) return null
    let sum = 0
    for (let k = i; k < i + period; k++) sum += bars[k].close
    return sum / period
  })
}

// bars: newest first → 依 ISO 週（週一為週首）重採樣成週K，回傳 newest first
export function resampleWeekly(bars: IndexOHLC[]): IndexOHLC[] {
  const chronological = [...bars].reverse()
  const weeks: IndexOHLC[] = []

  for (const b of chronological) {
    const d = new Date(b.date + 'T00:00:00Z')
    const dayIdx = (d.getUTCDay() + 6) % 7 // 0=Mon ... 6=Sun
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - dayIdx)
    const key = monday.toISOString().slice(0, 10)

    const last = weeks[weeks.length - 1]
    if (last?.date === key) {
      last.high = Math.max(last.high, b.high)
      last.low = Math.min(last.low, b.low)
      last.close = b.close
      last.volume += b.volume
    } else {
      weeks.push({ date: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })
    }
  }

  return weeks.reverse()
}
