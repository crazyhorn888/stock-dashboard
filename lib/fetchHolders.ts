import type { HoldersSnapshot, HoldersEntry } from '@/lib/types'

/**
 * 集保大戶籌碼（功能二十四，AC-HU-1/2）。
 *
 * 比照 fetchInstCost.ts：檔案小（全市場約 270KB）而且兩欄是常駐顯示的，
 * 所以個股清單掛載就抓，不做 lazy。抓不到回 null，兩欄顯示「—」，不影響表格其他部分。
 *
 * 資料是「週更」的（TDCC 每週最後營業日結算、週六上架），與日更的股價差最多 5 個交易日，
 * 所以分組表頭一定要標出 dataDate（AC-HU-5）。
 */
let cache: HoldersSnapshot | null = null
let inflight: Promise<HoldersSnapshot | null> | null = null

export async function fetchHolders(): Promise<HoldersSnapshot | null> {
  if (cache) return cache
  if (inflight) return inflight

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
  const url = baseUrl.replace('latest.json', 'holders.json')
  inflight = (async () => {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`holders.json fetch failed: ${res.status}`)
      const data = (await res.json()) as HoldersSnapshot
      cache = data
      return data
    } catch (e) {
      console.warn('[holders] 載入失敗：', (e as Error).message)
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function holdersOf(snap: HoldersSnapshot | null, code: string): HoldersEntry | null {
  return snap?.stocks?.[code] ?? null
}

/**
 * AC-HZ-4／AC-HF-4：籌碼異動判定＝百張的偏離達門檻「且」千張同方向變動。
 * 門檻由使用者調（預設 5），所以判定放前端、後端只給 zh 與 sameDir。
 * 股本事件週不算異動（AC-HZ-3），Z 值還在累積的也不算。
 *
 * 兩個條件缺一不可的理由（2026-09-13 回測定案）：取百張千張最大值等於同一件事問兩次、
 * 命中率灌水；只看千張又會被單一帳戶主導（該級距全市場中位數只有 10~15 人）。
 */
export function isHolderMove(e: HoldersEntry | null, threshold: number): boolean {
  if (!e || e.capitalEvent || e.zh == null || !e.sameDir) return false
  return Math.abs(e.zh) >= threshold
}

/** 顯示用：本週偏離是常態波動的幾倍 */
export function moveMultiple(e: HoldersEntry | null): number | null {
  return e?.zh == null ? null : Math.abs(e.zh)
}

/**
 * 實心點的條件：籌碼異動「且」同週個股期貨也異動（AC-HZ-7）。
 *
 * ⚠️ 語意是「動的範圍更廣」，不是「更可能下跌」。回測顯示兩者同時出現之後四週的報酬
 * 與其餘樣本沒有顯著差異（p=0.43），任何預測性文案都是錯的
 * （見 docs/2026-09-11_集保大戶籌碼_回測報告.md 第六之一節）。
 */
export function isWideMove(e: HoldersEntry | null, threshold: number): boolean {
  return isHolderMove(e, threshold) && !!e?.futMove
}

/** 週變化顯示用：+0.83 / −1.20；缺值與股本事件週都回 null 讓呼叫端顯示「—」 */
export function deltaPp(e: HoldersEntry | null, key: 'dh' | 'dk'): number | null {
  if (!e || e.capitalEvent) return null
  return e[key] ?? null
}
