import type { SectorDayData } from './types'

/**
 * 當日三大法人個股資料的統一來源（2026-07-12）。
 *
 * 泡泡面板（SectorPanel）、個股清單（StockTable）、個股詳情（StockDetailSheet）
 * 三處顯示的法人數字都應該 refer 到同一份資料：sectorHistory day0 的 T86 個股明細。
 * 這份 map 從已載入的 market.json 建立，零額外下載。
 *
 * 注意：T86 只涵蓋上市股。上櫃股不在 map 內（查無 → undefined），
 * 呼叫端顯示「—」或 fallback 各自既有欄位（如 StockData.foreignNetBuy 的 TPEX 外資值）。
 */
export interface InstNet {
  net: number         // 三大法人合計淨買超（億元）
  foreignNet: number  // 外資（億元）
  trustNet: number    // 投信（億元）
  dealerNet: number   // 自營（億元）
}

export function buildInstNetMap(sectorHistory: SectorDayData[] | undefined | null): {
  map: Record<string, InstNet>
  date: string | null
} {
  const day0 = sectorHistory?.[0]
  if (!day0) return { map: {}, date: null }
  const map: Record<string, InstNet> = {}
  for (const row of day0.rows ?? []) {
    for (const s of row.stocks ?? []) {
      map[s.code] = {
        net:        s.net        ?? 0,
        foreignNet: s.foreignNet ?? 0,
        trustNet:   s.trustNet   ?? 0,
        dealerNet:  s.dealerNet  ?? 0,
      }
    }
  }
  return { map, date: day0.date ?? null }
}

/** 與 SectorPanel 表格一致的數字格式：+1.23 / -25.81（億） */
export function fmtInstNet(v: number | undefined | null): string {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`
}

/** 與 SectorPanel 一致的紅漲綠跌配色 */
export function instNetColor(v: number | undefined | null): string {
  if (v == null) return 'text-slate-400'
  return v > 0 ? 'text-red-500' : v < 0 ? 'text-green-600' : 'text-slate-400'
}
