import type { StockHistoryDay } from './types'

// P2-5：module-level cache，跟 fetchStockOHLC.ts 同一套模式 —— 整個 session 只在
// 使用者實際開「自選股模式」時 fetch 一次，之後重複開關都吃快取，不重新下載
let _cache: StockHistoryDay[] | null = null
let _fetchPromise: Promise<StockHistoryDay[]> | null = null

export async function fetchStockHistory(): Promise<StockHistoryDay[]> {
  if (_cache) return _cache
  if (_fetchPromise) return _fetchPromise

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
  const url = baseUrl.replace('latest.json', 'stock-history.json')

  _fetchPromise = fetch(url, { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`stock-history.json fetch failed: ${res.status}`)
      return res.json()
    })
    .then(data => {
      const stockHistory: StockHistoryDay[] = data.stockHistory ?? []
      _cache = stockHistory
      _fetchPromise = null
      return stockHistory
    })
    .catch(err => {
      _fetchPromise = null
      throw err
    })

  return _fetchPromise
}
