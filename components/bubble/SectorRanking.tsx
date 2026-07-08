'use client'
import { useMemo, useState } from 'react'
import type { SectorBubble, StockData } from '@/lib/types'

interface Props {
  sectors: SectorBubble[]
  allStocks: StockData[]
  onSectorClick: (sector: SectorBubble) => void
}

// 與 BubbleChart / QuadrantSummary 一致的象限語意
function quadrantMeta(x: number, y: number) {
  if (x >= 0 && y >= 0) return { label: '漲潮', dot: 'bg-red-500' }
  if (x >= 0)           return { label: '輪動', dot: 'bg-amber-500' }
  if (y >= 0)           return { label: '觀望', dot: 'bg-slate-400' }
  return                       { label: '退潮', dot: 'bg-green-500' }
}

function numColor(v: number) {
  return v > 0 ? 'text-red-600' : v < 0 ? 'text-green-600' : 'text-slate-400'
}

export default function SectorRanking({ sectors, allStocks, onSectorClick }: Props) {
  const [dir, setDir] = useState<'desc' | 'asc'>('desc')

  const changeIndex = useMemo(
    () => Object.fromEntries(allStocks.map(s => [s.code, s.changePercent])),
    [allStocks],
  )

  const rows = useMemo(() => {
    const list = sectors.map(s => {
      // 板塊當日平均漲跌% = 成分股 changePercent 簡單平均
      const pcts = s.stocks.map(st => changeIndex[st.code]).filter((v): v is number => v != null)
      const avgChange = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null
      return { s, avgChange }
    })
    return list.sort((a, b) => (dir === 'desc' ? b.s.x - a.s.x : a.s.x - b.s.x))
  }, [sectors, changeIndex, dir])

  // 買賣超 bar 的正規化基準
  const maxAbsX = useMemo(() => Math.max(1, ...sectors.map(s => Math.abs(s.x))), [sectors])

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
        <span className="text-[11px] text-slate-400">近 5 日法人平均買賣超（億/日）・點列看個股</span>
        <button
          onClick={() => setDir(d => (d === 'desc' ? 'asc' : 'desc'))}
          className="text-[11px] text-blue-600 font-semibold px-2 py-0.5 rounded hover:bg-blue-50"
        >
          {dir === 'desc' ? '買超 → 賣超 ▼' : '賣超 → 買超 ▲'}
        </button>
      </div>
      <ul className="divide-y divide-slate-50 max-h-[420px] overflow-y-auto">
        {rows.map(({ s, avgChange }) => {
          const q = quadrantMeta(s.x, s.y)
          const barPct = Math.min(100, Math.abs(s.x) / maxAbsX * 100)
          return (
            <li key={s.sectorName}>
              <button
                onClick={() => onSectorClick(s)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-left"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${q.dot}`} />
                <span className="text-xs font-semibold text-slate-700 w-24 truncate shrink-0">{s.sectorName}</span>
                <span className="text-[9px] text-slate-400 w-7 shrink-0">{q.label}</span>
                {/* 買賣超橫條（正右負左的簡化版：以顏色區分方向） */}
                <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${s.x >= 0 ? 'bg-red-400' : 'bg-green-400'}`}
                    style={{ width: `${barPct}%` }}
                  />
                </span>
                <span className={`text-xs font-bold w-16 text-right shrink-0 ${numColor(s.x)}`}>
                  {s.x > 0 ? '+' : ''}{s.x.toFixed(1)}億
                </span>
                <span className={`text-[11px] font-semibold w-14 text-right shrink-0 ${avgChange == null ? 'text-slate-300' : numColor(avgChange)}`}>
                  {avgChange == null ? '—' : `${avgChange > 0 ? '+' : ''}${avgChange.toFixed(1)}%`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
