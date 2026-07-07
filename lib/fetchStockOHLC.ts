import type { OHLCSnapshot } from './types'

// module-level cache：整個 session 只 fetch 一次
let _cache: OHLCSnapshot | null = null
let _fetchPromise: Promise<OHLCSnapshot> | null = null

/** 從 Supabase Storage 取得 ohlc.json，module-level cache，第一次 fetch 後不再重複請求 */
export async function fetchOHLCSnapshot(): Promise<OHLCSnapshot> {
  if (_cache) return _cache
  if (_fetchPromise) return _fetchPromise

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
  const ohlcUrl = baseUrl.replace('latest.json', 'ohlc.json')

  _fetchPromise = fetch(ohlcUrl, { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`ohlc.json fetch failed: ${res.status}`)
      return res.json() as Promise<OHLCSnapshot>
    })
    .then(data => {
      _cache = data
      _fetchPromise = null
      return data
    })
    .catch(err => {
      _fetchPromise = null
      throw err
    })

  return _fetchPromise
}

/** 從 OHLCSnapshot 取得單支股票的每日 OHLC bars（newest first，與 closes/dates 對齊） */
export function getStockBars(
  snapshot: OHLCSnapshot,
  code: string,
  closes: number[],
  dates: string[],
): { date: string; open: number; high: number; low: number; close: number }[] | null {
  const d = snapshot.bars[code]
  if (!d) return null
  const len = Math.min(closes.length, d.o.length, dates.length)
  return Array.from({ length: len }, (_, i) => ({
    date:  dates[i],
    open:  d.o[i],
    high:  d.h[i],
    low:   d.l[i],
    close: closes[i],
  }))
}
