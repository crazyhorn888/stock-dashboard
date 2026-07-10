'use client'
import type { GlobalIndexData } from '@/lib/types'
import { calcMA } from '@/lib/calcMA'

interface Props {
  indices?: Record<string, GlobalIndexData>
  onSelect: (key: string) => void
}

// 顯示順序：美股三大指數 → 費半 → 亞股
const ORDER = ['spx', 'dji', 'ndq', 'sox', 'nkx', 'kospi'] as const
// 跌破判斷用的均線階梯（不含 MA5——5 日線太貼近股價，拿來當跌破門檻會太容易雜訊翻動）
const BREACH_PERIODS = [10, 20, 60, 120] as const
const ALL_PERIODS = [5, 10, 20, 60, 120] as const
// 貼線緩衝：價格離均線在 0.5% 以內視為「貼線」，不算跌破/站上，
// 避免整理期一天上一天下、燈號天天跳動
const BUFFER = 0.005

type Row = { key: string; name: string; date: string; belowPeriod: number | null; trend: 'bull' | 'lean-bull' | null; nearBelowLongTerm: boolean }

export default function GlobalIndexLights({ indices, onSelect }: Props) {
  if (!indices || Object.keys(indices).length === 0) return null

  const rows: Row[] = []
  for (const key of ORDER) {
    const idx = indices[key]
    if (!idx?.bars?.length) continue
    const close = idx.bars[0].close
    const ma: Record<number, number | null> = {}
    for (const p of ALL_PERIODS) ma[p] = calcMA(idx.bars, p)[0] ?? null

    // 找出「價格低於」的最長天期均線（最嚴重的關鍵點位跌破）；全部在均線之上則為 null
    let belowPeriod: number | null = null
    for (const p of [...BREACH_PERIODS].reverse()) {
      if (ma[p] != null && close < ma[p]! * (1 - BUFFER)) { belowPeriod = p; break }
    }

    // 沒有跌破時才看多頭/偏多：多頭＝站上5/10/20/60/120全部；偏多＝MA5 站上長天期（60、120）均線
    let trend: Row['trend'] = null
    if (belowPeriod === null) {
      const aboveAll = ALL_PERIODS.every(p => ma[p] != null && close > ma[p]! * (1 + BUFFER))
      const ma5AboveLongTerm = ma[5] != null && ma[60] != null && ma[120] != null
        && ma[5]! > ma[60]! * (1 + BUFFER) && ma[5]! > ma[120]! * (1 + BUFFER)
      trend = aboveAll ? 'bull' : ma5AboveLongTerm ? 'lean-bull' : null
    }

    // R10：貼線緩衝製造的灰帶——close 在 ma120 下方 0.5% 以內時 belowPeriod/trend 都不成立，
    // 掉進兜底文字「站上120日線」，但實際上價格是在均線下方，不是站上
    const nearBelowLongTerm = belowPeriod === null && trend === null
      && ma[120] != null && close < ma[120]!

    rows.push({ key, name: idx.name, date: idx.bars[0].date, belowPeriod, trend, nearBelowLongTerm })
  }

  if (rows.length === 0) return null
  const allBull = rows.every(r => r.trend === 'bull')

  const label = (r: Row) => {
    if (r.belowPeriod != null) return `${r.belowPeriod} 日線以下`
    if (r.trend === 'bull') return '多頭'
    if (r.trend === 'lean-bull') return '偏多'
    if (r.nearBelowLongTerm) return `貼近 ${BREACH_PERIODS[BREACH_PERIODS.length - 1]} 日線`
    return `站上 ${BREACH_PERIODS[BREACH_PERIODS.length - 1]} 日線`
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-3 py-2 mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold text-slate-500">全球指數</span>
        {allBull && (
          <span className="text-[11px] font-semibold text-red-500">🔴 全數多頭</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {rows.map(r => (
          <button
            key={r.key}
            onClick={() => onSelect(r.key)}
            className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-blue-600 text-left"
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.belowPeriod != null ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="truncate">
              {r.name} {label(r)}
              <span className="text-slate-300"> ({r.date.slice(5).replace('-', '/')})</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
