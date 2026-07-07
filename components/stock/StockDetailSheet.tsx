'use client'
import { useEffect, useRef, useState } from 'react'
import type { StockData } from '@/lib/types'
import { calcStockRow } from '@/lib/calcMetrics'
import StockKChart from './StockKChart'

interface Props {
  stock: StockData | null
  n: number
  onClose: () => void
}

export default function StockDetailSheet({ stock, n, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null)
  // iOS 15+ Safari compact bottom toolbar (~49px) overlays position:fixed content.
  // visualViewport.height == window.innerHeight on iOS 15+ (toolbar overlays, doesn't shrink).
  // Fix: UA-detect iOS → apply fixed offset to lift sheet above the toolbar.
  const [iosOffset, setIosOffset] = useState(0)

  useEffect(() => {
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      setIosOffset(49)
    }
  }, [])

  useEffect(() => {
    if (!stock) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [stock])

  if (!stock) return null

  const row = calcStockRow(stock, n)
  const chgUp = row.changePercent >= 0
  const clr = chgUp ? 'text-red-500' : 'text-green-600'

  const stats = [
    { label: `距N高`, value: `${row.highDropPct.toFixed(2)}%`,  color: row.highDropPct < -15 ? 'text-red-500' : 'text-slate-700' },
    { label: `距N低`, value: `+${row.lowRisePct.toFixed(2)}%`,  color: row.lowRisePct > 15 ? 'text-red-500' : 'text-slate-700' },
    { label: 'P/E',   value: row.pe?.toFixed(1) ?? '—',         color: 'text-slate-700' },
    { label: 'EPS',   value: row.eps?.toFixed(2) ?? '—',        color: 'text-slate-700' },
    { label: '外資',  value: `${row.foreignNetBuy >= 0 ? '+' : ''}${row.foreignNetBuy.toLocaleString()} 億`, color: row.foreignNetBuy >= 0 ? 'text-red-500' : 'text-green-600' },
    { label: '產業',  value: row.industry,                       color: 'text-slate-500' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Sheet — bottom/maxHeight 由 iosOffset 推高，避開 Safari compact toolbar */}
      <div ref={sheetRef} className="fixed left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col"
        style={{
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${iosOffset}px)`,
          maxHeight: iosOffset ? `calc(88svh - ${iosOffset}px)` : '88svh',
        }}>

        {/* 拖把 handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1 border-b border-slate-100">
          <div className="flex items-baseline gap-2">
            <span className="text-blue-600 font-bold text-base">{stock.code}</span>
            <span className="text-slate-800 font-semibold text-sm">{stock.name}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-slate-800 font-bold text-lg">{stock.close.toLocaleString()}</span>
            <span className={`font-semibold text-sm ${clr}`}>
              {chgUp ? '▲' : '▼'}{Math.abs(row.changePercent).toFixed(2)}%
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg px-1">✕</button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-0 border-b border-slate-100">
          {stats.map(s => (
            <div key={s.label} className="flex flex-col items-center py-2.5 border-r border-slate-100 last:border-0 even:last:border-0">
              <span className="text-[10px] text-slate-400 mb-0.5">{s.label} (N={n})</span>
              <span className={`text-xs font-semibold ${s.color}`}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="overflow-y-auto flex-1 px-3 pt-3"
          style={{ paddingBottom: 'max(40px, env(safe-area-inset-bottom, 0px))' }}>
          {stock.closes.length > 1
            ? <StockKChart closes={stock.closes} dates={stock.dates} n={n} />
            : <div className="flex items-center justify-center py-16 text-slate-400 text-xs">歷史資料累積中</div>
          }
        </div>
      </div>
    </>
  )
}
