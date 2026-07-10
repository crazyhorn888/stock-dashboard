import type { HolidayStatus } from './types'

// 小檔案（~100 bytes），每次頁面載入都直接抓，不用等使用者操作；
// module-level cache 避免同一個 session 內重複 fetch
let _cache: HolidayStatus | null = null
let _fetchPromise: Promise<HolidayStatus | null> | null = null

export async function fetchHolidayStatus(): Promise<HolidayStatus | null> {
  if (_cache) return _cache
  if (_fetchPromise) return _fetchPromise

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
  const url = baseUrl.replace('latest.json', 'holiday-status.json')

  _fetchPromise = fetch(url, { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`holiday-status.json fetch failed: ${res.status}`)
      return res.json()
    })
    .then((data: HolidayStatus) => {
      _cache = data
      _fetchPromise = null
      return data
    })
    .catch(() => {
      _fetchPromise = null
      return null  // 檔案還沒產生或抓取失敗：前端當作「無法判斷」處理，退回原本的時間推斷邏輯
    })

  return _fetchPromise
}
