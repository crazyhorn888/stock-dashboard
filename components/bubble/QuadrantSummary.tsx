'use client'
import { useMemo } from 'react'
import type { SectorBubble, SectorDayRow } from '@/lib/types'

interface Props {
  sectors: SectorBubble[]
  todayRows?: SectorDayRow[]        // sectorHistory[0].rows（當日板塊淨買賣，億元）
  marketChangePct?: number | null   // 大盤當日漲跌%（逆勢買超判斷用）
}

// 象限判斷需與 BubbleChart 的 QUADRANTS 完全一致
const QUADS = [
  { id: 'TR', label: '漲潮', desc: '資金加速流入', dot: 'bg-red-500',    text: 'text-red-600',    match: (x: number, y: number) => x >= 0 && y >= 0 },
  { id: 'BR', label: '輪動', desc: '流入但放緩',   dot: 'bg-amber-500',  text: 'text-amber-600',  match: (x: number, y: number) => x >= 0 && y < 0 },
  { id: 'TL', label: '觀望', desc: '流出但放緩',   dot: 'bg-slate-400',  text: 'text-slate-500',  match: (x: number, y: number) => x < 0 && y >= 0 },
  { id: 'BL', label: '退潮', desc: '資金流出',     dot: 'bg-green-500',  text: 'text-green-600',  match: (x: number, y: number) => x < 0 && y < 0 },
] as const

export default function QuadrantSummary({ sectors, todayRows, marketChangePct }: Props) {
  const counts = useMemo(
    () => QUADS.map(q => sectors.filter(s => q.match(s.x, s.y)).length),
    [sectors],
  )

  // 逆勢買超：大盤當日下跌，但板塊當日法人淨買超 > 0
  const counterTrend = useMemo(() => {
    if (marketChangePct == null || marketChangePct >= 0 || !todayRows?.length) return null
    return todayRows.filter(r => r.net > 0).length
  }, [todayRows, marketChangePct])

  return (
    <div className="flex items-stretch gap-1.5 px-3 py-2 overflow-x-auto scrollbar-none">
      {QUADS.map((q, i) => (
        <div key={q.id} className="flex-1 min-w-[72px] rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${q.dot}`} />
            <span className={`text-[11px] font-bold ${q.text}`}>{q.label}</span>
            <span className={`text-sm font-extrabold ${q.text}`}>{counts[i]}</span>
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">{q.desc}</div>
        </div>
      ))}
      {counterTrend != null && (
        <div className="flex-1 min-w-[80px] rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1">
            <span className="text-[11px]">⚓</span>
            <span className="text-[11px] font-bold text-blue-600">逆勢買超</span>
            <span className="text-sm font-extrabold text-blue-600">{counterTrend}</span>
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">大盤跌、法人買</div>
        </div>
      )}
    </div>
  )
}
