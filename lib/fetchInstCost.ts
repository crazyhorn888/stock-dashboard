import type { InstCostSnapshot } from '@/lib/types'

/**
 * 法人成本（AC-IC-1）。
 *
 * 檔案只有 ~12KB（壓縮後），而「法人成本／距成本%」兩欄是常駐顯示的，
 * 所以個股清單掛載時就抓，不做 lazy——不像 ohlc.json 那種 500KB 等級的檔案
 * 需要等使用者勾選條件才下載。
 *
 * 抓不到就回 null，兩欄顯示「—」，不影響表格其他部分。
 */
let cache: InstCostSnapshot | null = null
let inflight: Promise<InstCostSnapshot | null> | null = null

export async function fetchInstCost(): Promise<InstCostSnapshot | null> {
  if (cache) return cache
  if (inflight) return inflight

  // URL 取法比照 fetchStockHistory.ts
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
  const url = baseUrl.replace('latest.json', 'inst-cost.json')
  inflight = (async () => {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`inst-cost.json fetch failed: ${res.status}`)
      const data = (await res.json()) as InstCostSnapshot
      cache = data
      return data
    } catch (e) {
      console.warn('[instCost] 載入失敗：', (e as Error).message)
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 依頁面 N 取最接近的成本窗口——成本只有 5/10/20/60/120 五個檔位 */
export function windowForN(n: number): 5 | 10 | 20 | 60 | 120 {
  if (n <= 7) return 5
  if (n <= 15) return 10
  if (n <= 40) return 20
  if (n <= 90) return 60
  return 120
}

/**
 * 取某檔個股在指定窗口的法人成本。
 * @param party 't' = 三大法人合計、'f' = 外資
 */
export function costOf(
  snap: InstCostSnapshot | null,
  code: string,
  window: number,
  party: 't' | 'f' = 't',
): number | null {
  return snap?.cost?.[code]?.[`${party}${window}`] ?? null
}

/** 距成本 %：正值＝現價高於法人成本（法人有帳面獲利），負值＝低於成本 */
export function gapToCost(close: number, cost: number | null): number | null {
  if (cost == null || cost <= 0) return null
  return ((close - cost) / cost) * 100
}
