import type { OptionsOISnapshot } from '@/lib/types'

/**
 * 選擇權 OI（AC-OI-A7）。
 *
 * 檔案約 60KB（60 個交易日 × 每天各到期別的前三大），卡片是常駐顯示的，
 * 所以進頁面就抓，比照 fetchInstCost.ts；抓不到回 null，整張卡不顯示，
 * 不影響盤後行情頁的其他區塊。
 */
let cache: OptionsOISnapshot | null = null
let inflight: Promise<OptionsOISnapshot | null> | null = null

export async function fetchOptionsOI(): Promise<OptionsOISnapshot | null> {
  if (cache) return cache
  if (inflight) return inflight

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
  const url = baseUrl.replace('latest.json', 'options-oi.json')
  inflight = (async () => {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`options-oi.json fetch failed: ${res.status}`)
      const data = (await res.json()) as OptionsOISnapshot
      if (!data?.days || !Object.keys(data.days).length) return null
      data.settle ??= {}
      cache = data
      return data
    } catch (e) {
      console.warn('[optionsOI] 載入失敗：', (e as Error).message)
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}
