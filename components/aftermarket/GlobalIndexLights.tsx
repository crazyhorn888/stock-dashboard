'use client'
import type { GlobalIndexData } from '@/lib/types'
import { calcMA } from '@/lib/calcMA'

interface Props {
  indices?: Record<string, GlobalIndexData>
  onSelect: (key: string) => void
}

// 顯示順序：美股三大指數 → 費半 → 亞股
const ORDER = ['spx', 'dji', 'ndq', 'sox', 'nkx', 'kospi'] as const
const MA_PERIODS = [10, 20, 60, 120] as const
// 貼線緩衝：價格離均線在 0.5% 以內視為「貼線」，不算跌破/站上，
// 避免整理期一天上一天下、燈號天天跳動
const BUFFER = 0.005

export default function GlobalIndexLights({ indices, onSelect }: Props) {
  if (!indices || Object.keys(indices).length === 0) return null

  const rows: { key: string; name: string; date: string; belowPeriod: number | null }[] = []
  for (const key of ORDER) {
    const idx = indices[key]
    if (!idx?.bars?.length) continue
    const close = idx.bars[0].close
    // 找出「價格低於」的最長天期均線（最嚴重的關鍵點位跌破）；全部在均線之上則為 null
    let belowPeriod: number | null = null
    for (const p of [...MA_PERIODS].reverse()) {
      const ma = calcMA(idx.bars, p)[0]
      if (ma != null && close < ma * (1 - BUFFER)) { belowPeriod = p; break }
    }
    rows.push({ key, name: idx.name, date: idx.bars[0].date, belowPeriod })
  }

  if (rows.length === 0) return null
  const allAbove = rows.every(r => r.belowPeriod === null)

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-3 py-2 mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold text-slate-500">全球指數</span>
        {allAbove && (
          <span className="text-[11px] font-semibold text-red-500">🔴 全數站上 120 日線</span>
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
              {r.name} {r.belowPeriod != null ? `${r.belowPeriod} 日線以下` : `站上 ${MA_PERIODS[MA_PERIODS.length - 1]} 日線`}
              <span className="text-slate-300"> ({r.date.slice(5).replace('-', '/')})</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
