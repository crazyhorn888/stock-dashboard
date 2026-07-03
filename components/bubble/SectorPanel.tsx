'use client'
import { useMemo } from 'react'
import type { SectorBubble, StockData } from '@/lib/types'

const QUADRANT_LABEL: Record<string, { label: string; color: string }> = {
  TR: { label: '漲潮',  color: 'text-red-500'    },
  TL: { label: '觀望',  color: 'text-slate-400'  },
  BL: { label: '退潮',  color: 'text-green-600'  },
  BR: { label: '輪動',  color: 'text-amber-500'  },
}

function quadrantOf(x: number, y: number) {
  if (x >= 0 && y >= 0) return 'TR'
  if (x <  0 && y >= 0) return 'TL'
  if (x <  0 && y <  0) return 'BL'
  return 'BR'
}

interface Props {
  sector: SectorBubble | null
  onClose: () => void
  allStocks: StockData[]
  n: number
}

function sign(v: number) { return v > 0 ? '+' : '' }

function pct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

interface Chip {
  label: string
  value: string
  colorClass: string
}

function StockRow({ s, stockData, n }: {
  s: SectorBubble['stocks'][number]
  stockData: StockData | undefined
  n: number
}) {
  const changePercent = stockData?.changePercent ?? 0
  const chgUp = changePercent >= 0

  // 距 N 日高/低（用 closes[]）
  const { highDrop, lowRise } = useMemo(() => {
    const closes = stockData?.closes?.slice(0, n) ?? []
    if (!closes.length) return { highDrop: 0, lowRise: 0 }
    const hi = Math.max(...closes)
    const lo = Math.min(...closes)
    const cur = stockData!.close
    return {
      highDrop: hi > 0 ? ((cur - hi) / hi) * 100 : 0,
      lowRise:  lo > 0 ? ((cur - lo) / lo) * 100 : 0,
    }
  }, [stockData, n])

  const chips: Chip[] = [
    { label: '合計', value: `${sign(s.netBuy)}${s.netBuy.toLocaleString()}`, colorClass: 'text-slate-600' },
    { label: '外資', value: `${sign(s.foreignNet)}${s.foreignNet.toLocaleString()}`, colorClass: s.foreignNet >= 0 ? 'text-red-500' : 'text-green-600' },
    { label: '投信', value: `${sign(s.trustNet)}${s.trustNet.toLocaleString()}`,    colorClass: s.trustNet   >= 0 ? 'text-red-500' : 'text-green-600' },
    { label: '自營', value: `${sign(s.dealerNet)}${s.dealerNet.toLocaleString()}`,  colorClass: s.dealerNet  >= 0 ? 'text-red-500' : 'text-green-600' },
    { label: '距高', value: `${highDrop.toFixed(1)}%`,  colorClass: highDrop >= -5 ? 'text-slate-400' : highDrop <= -15 ? 'text-red-500' : 'text-slate-600' },
    { label: '距低', value: `+${lowRise.toFixed(1)}%`,  colorClass: 'text-red-400' },
  ]

  return (
    <div className="border-b border-slate-50 last:border-0">
      {/* 整行可橫向拖曳 */}
      <div
        className="flex items-center gap-2 py-1.5 overflow-x-auto scrollbar-none"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* 代號 */}
        <span className="text-[11px] text-slate-400 shrink-0 w-9">{s.code}</span>
        {/* 名稱 */}
        <span className="text-sm text-slate-700 shrink-0">{s.name}</span>
        {/* 漲跌% */}
        {stockData && (
          <span className={`text-xs font-semibold shrink-0 ${chgUp ? 'text-red-500' : 'text-green-600'}`}>
            {chgUp ? '▲' : '▼'}{Math.abs(changePercent).toFixed(1)}%
          </span>
        )}
        {/* 分隔線 */}
        <span className="text-slate-200 shrink-0 select-none">│</span>
        {/* 三大法人 + 距高低 chips */}
        {chips.map(c => (
          <span
            key={c.label}
            className={`shrink-0 text-[10px] font-medium tabular-nums rounded px-1.5 py-0.5 bg-slate-50 border border-slate-100 ${c.colorClass}`}
          >
            <span className="text-slate-400">{c.label} </span>{c.value}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function SectorPanel({ sector, onClose, allStocks, n }: Props) {
  if (!sector) return null

  const qId = quadrantOf(sector.x, sector.y)
  const q   = QUADRANT_LABEL[qId]

  const stockIndex = useMemo(
    () => Object.fromEntries(allStocks.map(s => [s.code, s])),
    [allStocks],
  )

  // Group stocks by industry
  const grouped = sector.stocks.reduce<Record<string, typeof sector.stocks>>((acc, s) => {
    ;(acc[s.industry] ??= []).push(s)
    return acc
  }, {})

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} />

      {/* Bottom sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl shadow-xl"
        style={{ maxHeight: '80dvh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">{sector.sectorName}</h2>
              <span className={`text-xs font-semibold ${q.color}`}>{q.label}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              法人淨買超 {sign(sector.x)}{sector.x.toFixed(1)} 千張 ·
              加速指標 {sign(sector.y)}{(sector.y * 100).toFixed(1)}%
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-lg leading-none px-1">✕</button>
        </div>

        <hr className="border-slate-100 mx-4" />

        {/* Column header hint */}
        <div className="px-4 py-1.5 flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-[9px] text-slate-300 shrink-0 w-9">代號</span>
          <span className="text-[9px] text-slate-300 shrink-0">名稱</span>
          <span className="text-[9px] text-slate-300 shrink-0">漲跌</span>
          <span className="text-slate-100 shrink-0 text-[9px]">│</span>
          {['合計','外資','投信','自營','距高','距低'].map(l => (
            <span key={l} className="text-[9px] text-slate-300 shrink-0 rounded px-1.5 py-0.5 bg-slate-50">{l}</span>
          ))}
          <span className="text-[9px] text-slate-300 shrink-0 ml-1">← 左右拖曳 →</span>
        </div>

        {/* Stock list */}
        <div className="overflow-y-auto flex-1 px-4 pb-2">
          {sector.stocks.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">無個股資料</p>
          ) : (
            Object.entries(grouped).map(([industry, stocks]) => (
              <div key={industry} className="mb-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-2 mb-1">
                  {industry}
                </p>
                {stocks.map(s => (
                  <StockRow
                    key={s.code}
                    s={s}
                    stockData={stockIndex[s.code]}
                    n={n}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
      </div>
    </>
  )
}
