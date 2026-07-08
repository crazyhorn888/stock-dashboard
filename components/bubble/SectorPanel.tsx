'use client'
import { useState, useMemo } from 'react'
import type { SectorBubble, StockData } from '@/lib/types'

const QUADRANT_LABEL: Record<string, { label: string; color: string }> = {
  TR: { label: '漲潮', color: 'text-red-500'   },
  TL: { label: '觀望', color: 'text-slate-400' },
  BL: { label: '退潮', color: 'text-green-600' },
  BR: { label: '輪動', color: 'text-amber-500' },
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
  onStockClick?: (stock: StockData) => void
}

type SortKey = 'code' | 'changePercent' | 'highDrop' | 'lowRise' | 'netBuy' | 'foreignNet' | 'trustNet' | 'dealerNet'

type RowData = {
  code: string
  name: string
  industry: string
  changePercent: number
  highDrop: number
  lowRise: number
  netBuy: number
  foreignNet: number
  trustNet: number
  dealerNet: number
  stockData: StockData | undefined
}

const COLS: { key: SortKey | null; label: string; right?: boolean }[] = [
  { key: 'code',          label: '代號'  },
  { key: null,            label: '名稱'  },
  { key: 'changePercent', label: '漲跌%',   right: true },
  { key: 'highDrop',      label: '距高',    right: true },
  { key: 'lowRise',       label: '距低',    right: true },
  { key: 'netBuy',        label: '合計(億)', right: true },
  { key: 'foreignNet',    label: '外資(億)', right: true },
  { key: 'trustNet',      label: '投信(億)', right: true },
  { key: 'dealerNet',     label: '自營(億)', right: true },
]

function sign(v: number) { return v > 0 ? '+' : '' }

function numColor(v: number) {
  return v > 0 ? 'text-red-500' : v < 0 ? 'text-green-600' : 'text-slate-400'
}

export default function SectorPanel({ sector, onClose, allStocks, n, onStockClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('netBuy')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const stockIndex = useMemo(
    () => Object.fromEntries(allStocks.map(s => [s.code, s])),
    [allStocks],
  )

  const rows: RowData[] = useMemo(() => {
    if (!sector) return []
    return sector.stocks.map(s => {
      const sd = stockIndex[s.code]
      const window = sd?.closes?.slice(0, n) ?? []
      const hi  = window.length ? Math.max(...window) : 0
      const lo  = window.length ? Math.min(...window) : 0
      const cur = sd?.close ?? 0
      return {
        code:          s.code,
        name:          s.name,
        industry:      s.industry,
        changePercent: sd?.changePercent ?? 0,
        highDrop:      hi > 0 ? ((cur - hi) / hi) * 100 : 0,
        lowRise:       lo > 0 ? ((cur - lo) / lo) * 100 : 0,
        netBuy:        s.netBuy,
        foreignNet:    s.foreignNet,
        trustNet:      s.trustNet,
        dealerNet:     s.dealerNet,
        stockData:     sd,
      }
    })
  }, [sector, stockIndex, n])

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = sortKey === 'code' ? parseInt(a.code) : (a[sortKey] as number) ?? 0
      const vb = sortKey === 'code' ? parseInt(b.code) : (b[sortKey] as number) ?? 0
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [rows, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function thLabel(col: typeof COLS[number]) {
    if (!col.key) return col.label
    const active = sortKey === col.key
    return col.label + ' ' + (active ? (sortDir === 'asc' ? '↑' : '↓') : '↕')
  }

  if (!sector) return null

  const qId = quadrantOf(sector.x, sector.y)
  const q   = QUADRANT_LABEL[qId]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} />

      {/* Bottom sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl shadow-xl flex flex-col"
        style={{ maxHeight: '82dvh' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-1 pb-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">{sector.sectorName}</h2>
              <span className={`text-xs font-semibold ${q.color}`}>{q.label}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              法人淨買超 {sign(sector.x)}{sector.x.toFixed(1)} 億/日 ·
              加速指標 {sign(sector.y)}{(sector.y * 100).toFixed(1)}%
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-lg leading-none px-1 pt-1">✕</button>
        </div>

        <hr className="border-slate-100" />

        {/* Table — 整體橫向捲動，欄位對齊 */}
        <div className="overflow-x-auto overflow-y-auto flex-1" style={{ minHeight: 0 }}>
          <table className="border-collapse text-xs" style={{ minWidth: 520 }}>
            <thead>
              <tr className="bg-white border-b border-slate-200">
                {COLS.map(col => (
                  <th
                    key={col.label}
                    onClick={() => col.key && handleSort(col.key)}
                    className={[
                      'px-2.5 py-2 font-semibold whitespace-nowrap',
                      col.right ? 'text-right' : 'text-left',
                      col.key
                        ? 'cursor-pointer select-none hover:text-blue-500 ' +
                          (sortKey === col.key ? 'text-blue-600' : 'text-slate-400')
                        : 'text-slate-400 cursor-default',
                    ].join(' ')}
                  >
                    {thLabel(col)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="py-8 text-center text-slate-400">無個股資料</td>
                </tr>
              ) : sorted.map(r => {
                const chgUp = r.changePercent >= 0
                const highCls = r.highDrop >= -5 ? 'text-slate-400' : r.highDrop <= -15 ? 'text-red-500' : 'text-slate-600'
                return (
                  <tr
                    key={r.code}
                    className="border-b border-slate-50 hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => r.stockData && onStockClick?.(r.stockData)}
                  >
                    {/* 代號 */}
                    <td className="px-2.5 py-2 text-blue-500 font-bold whitespace-nowrap">{r.code}</td>
                    {/* 名稱 */}
                    <td className="px-2.5 py-2 text-slate-700 whitespace-nowrap">{r.name}</td>
                    {/* 漲跌% */}
                    <td className={`px-2.5 py-2 text-right font-semibold whitespace-nowrap ${chgUp ? 'text-red-500' : 'text-green-600'}`}>
                      {chgUp ? '▲' : '▼'}{Math.abs(r.changePercent).toFixed(2)}%
                    </td>
                    {/* 距高 */}
                    <td className={`px-2.5 py-2 text-right whitespace-nowrap ${highCls}`}>
                      {r.highDrop.toFixed(1)}%
                    </td>
                    {/* 距低 */}
                    <td className="px-2.5 py-2 text-right text-red-400 whitespace-nowrap">
                      +{r.lowRise.toFixed(1)}%
                    </td>
                    {/* 合計 */}
                    <td className={`px-2.5 py-2 text-right whitespace-nowrap ${numColor(r.netBuy)}`}>
                      {sign(r.netBuy)}{r.netBuy.toFixed(2)}
                    </td>
                    {/* 外資 */}
                    <td className={`px-2.5 py-2 text-right whitespace-nowrap ${numColor(r.foreignNet)}`}>
                      {sign(r.foreignNet)}{r.foreignNet.toFixed(2)}
                    </td>
                    {/* 投信 */}
                    <td className={`px-2.5 py-2 text-right whitespace-nowrap ${numColor(r.trustNet)}`}>
                      {sign(r.trustNet)}{r.trustNet.toFixed(2)}
                    </td>
                    {/* 自營 */}
                    <td className={`px-2.5 py-2 text-right whitespace-nowrap ${numColor(r.dealerNet)}`}>
                      {sign(r.dealerNet)}{r.dealerNet.toFixed(2)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
      </div>
    </>
  )
}
