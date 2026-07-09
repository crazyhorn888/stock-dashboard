'use client'
import { useMemo, useState } from 'react'
import type { SectorBubble, SectorDayRow } from '@/lib/types'

interface Props {
  sectors: SectorBubble[]
  todayRows?: SectorDayRow[]        // sectorHistory[0].rows（當日板塊淨買賣，億元）
  marketChangePct?: number | null   // 大盤當日漲跌%（逆勢買超判斷用）
  onSectorClick?: (sector: SectorBubble) => void  // 點清單裡的板塊名稱 → 開該板塊的 SectorPanel
}

// 象限判斷需與 BubbleChart 的 QUADRANTS 完全一致
const QUADS = [
  { id: 'TR', label: '漲潮', desc: '資金加速流入', dot: 'bg-red-500',    text: 'text-red-600',    match: (x: number, y: number) => x >= 0 && y >= 0 },
  { id: 'BR', label: '輪動', desc: '流入但放緩',   dot: 'bg-amber-500',  text: 'text-amber-600',  match: (x: number, y: number) => x >= 0 && y < 0 },
  { id: 'TL', label: '觀望', desc: '流出但放緩',   dot: 'bg-slate-400',  text: 'text-slate-500',  match: (x: number, y: number) => x < 0 && y >= 0 },
  { id: 'BL', label: '退潮', desc: '資金流出',     dot: 'bg-green-500',  text: 'text-green-600',  match: (x: number, y: number) => x < 0 && y < 0 },
] as const

export default function QuadrantSummary({ sectors, todayRows, marketChangePct, onSectorClick }: Props) {
  const [showModal, setShowModal] = useState(false)
  const counts = useMemo(
    () => QUADS.map(q => sectors.filter(s => q.match(s.x, s.y)).length),
    [sectors],
  )

  // 逆勢買超：大盤當日下跌，但板塊當日法人淨買超 > 0
  const counterTrendList = useMemo(() => {
    if (marketChangePct == null || marketChangePct >= 0 || !todayRows?.length) return null
    return todayRows.filter(r => r.net > 0).sort((a, b) => b.net - a.net)
  }, [todayRows, marketChangePct])

  function selectSector(name: string) {
    const sector = sectors.find(s => s.sectorName === name)
    if (sector) {
      setShowModal(false)
      onSectorClick?.(sector)
    }
  }

  return (
    <>
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
        {counterTrendList != null && (
          <button
            onClick={() => setShowModal(true)}
            className="flex-1 min-w-[80px] rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-center"
          >
            <div className="flex items-center justify-center gap-1">
              <span className="text-[11px]">⚓</span>
              <span className="text-[11px] font-bold text-blue-600">逆勢買超</span>
              <span className="text-sm font-extrabold text-blue-600">{counterTrendList.length}</span>
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">大盤跌、法人買</div>
          </button>
        )}
      </div>

      {showModal && counterTrendList && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl p-4 shadow-xl max-h-[70vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-slate-700">⚓ 逆勢買超板塊</span>
              <button onClick={() => setShowModal(false)} className="text-slate-400 text-lg leading-none">✕</button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              今日大盤下跌，但這些板塊三大法人仍然淨買超（點板塊看個股明細）
            </p>
            <div className="space-y-1.5">
              {counterTrendList.map(r => (
                <button
                  key={r.name}
                  onClick={() => selectSector(r.name)}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-blue-50 text-left"
                >
                  <span className="text-xs font-medium text-slate-700">{r.name}</span>
                  <span className="text-xs font-bold text-red-500">+{r.net.toFixed(2)} 億</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
