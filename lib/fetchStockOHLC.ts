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

export interface OHLCBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number   // 張，可能缺（無 v 欄位或 TPEX 歷史舊資料）
  hasRealOHLC: boolean  // false = open/high/low 為 close 推算，非真實 intraday
}

/** 從 OHLCSnapshot 取得單支股票的每日 OHLC bars（newest first，與 closes/dates 對齊） */
export function getStockBars(
  snapshot: OHLCSnapshot,
  code: string,
  closes: number[],
  dates: string[],
): OHLCBar[] | null {
  const d = snapshot.bars[code]
  if (!d) return null
  const hasOHLC = (d.o?.length ?? 0) > 0
  const hasVol  = (d.v?.length ?? 0) > 0
  if (!hasOHLC && !hasVol) return null
  // v.length 故意不參與 len 計算：volumes[] 可能比 OHLC 短（逐日累積），
  // 超出範圍的 d.v?.[i] 自然回傳 undefined，volume bar 不顯示即可
  const len = Math.min(
    closes.length,
    dates.length,
    hasOHLC ? d.o!.length : closes.length,
  )
  return Array.from({ length: len }, (_, i) => ({
    date:        dates[i],
    open:        d.o?.[i] ?? closes[i],
    high:        d.h?.[i] ?? closes[i],
    low:         d.l?.[i] ?? closes[i],
    close:       closes[i],
    volume:      d.v?.[i],
    hasRealOHLC: hasOHLC,
  }))
}
