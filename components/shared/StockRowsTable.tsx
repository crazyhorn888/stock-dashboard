'use client'
import { useState, useMemo } from 'react'
import type { StockRow, StockData } from '@/lib/types'
import ConceptTags from '@/components/shared/ConceptTags'
import { useWatchlist } from '@/lib/watchlist'

/**
 * 個股列表共用表格（2026-07-12）——個股清單（StockTable）與泡泡面板（SectorPanel）
 * 共用同一個元件：同欄位、同排序規則、同顯示格式，資料 refer 同一份 StockRow
 * （page.tsx 統一產生，法人欄位來自 day0 T86，見 lib/instNet）。
 *
 * 欄位：⭐ 代號 名稱 收盤 漲跌% 距N高▼% 視覺 距N低▲% P/E EPS 外資 投信 自營 合計 產業 概念
 * （產業欄 2026-07-12 曾短暫移除後加回——當時整欄「—」是資料 bug 不是欄位沒用，資料修復後保留）
 * 法人四欄（外資/投信/自營/合計）排序用絕對值——大動作在前（2026-07-12 Franky 確認）。
 * 上櫃股無 T86 法人資料 → 投信/自營/合計顯示「—」（外資 fallback TPEX 值）。
 */
type SortKey =
  | 'changePercent' | 'highDropPct' | 'lowRisePct' | 'pe' | 'eps'
  | 'foreignNetBuy' | 'trustNet' | 'dealerNet' | 'instTotal'

const ABS_KEYS: SortKey[] = ['foreignNetBuy', 'trustNet', 'dealerNet', 'instTotal']

interface Props {
  rows: StockRow[]
  onStockClick?: (stock: StockData) => void
  onConceptClick?: (concept: string) => void
  defaultSortKey?: SortKey
  defaultAsc?: boolean
  wrapperClassName?: string
  wrapperStyle?: React.CSSProperties
}

function instCell(v: number | undefined | null) {
  if (v == null) return <span className="text-slate-300">—</span>
  return (
    <span className={`font-medium ${v > 0 ? 'text-red-500' : v < 0 ? 'text-green-600' : 'text-slate-400'}`}>
      {v > 0 ? '+' : ''}{v.toFixed(2)}
    </span>
  )
}

export default function StockRowsTable({
  rows, onStockClick, onConceptClick,
  defaultSortKey = 'highDropPct', defaultAsc = true,
  wrapperClassName = 'overflow-x-auto rounded-xl border border-slate-200',
  wrapperStyle,
}: Props) {
  const { isWatched, toggle: toggleWatch } = useWatchlist()
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey)
  const [sortAsc, setSortAsc] = useState(defaultAsc)

  const sorted = useMemo(() => {
    const val = (r: StockRow) => {
      const v = (r[sortKey] as number | null | undefined) ?? 0
      return ABS_KEYS.includes(sortKey) ? Math.abs(v) : v
    }
    return [...rows].sort((a, b) => sortAsc ? val(a) - val(b) : val(b) - val(a))
  }, [rows, sortKey, sortAsc])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  function thCls(key: SortKey) {
    return `cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold whitespace-nowrap hover:text-slate-600 ${sortKey === key ? 'text-blue-600' : 'text-slate-400'}`
  }
  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? '↑' : '↓') : '↕'

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      <table className="w-full text-xs border-collapse" style={{ minWidth: 760 }}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 sticky top-0">
            <th className="px-2 py-2 text-left text-xs font-semibold text-slate-400 whitespace-nowrap">⭐</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 whitespace-nowrap">代號</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400">名稱</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400">收盤</th>
            <th className={thCls('changePercent')} onClick={() => handleSort('changePercent')}>漲跌% {arrow('changePercent')}</th>
            <th className={thCls('highDropPct')} onClick={() => handleSort('highDropPct')}>距N高▼% {arrow('highDropPct')}</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 whitespace-nowrap">視覺</th>
            <th className={thCls('lowRisePct')} onClick={() => handleSort('lowRisePct')}>距N低▲% {arrow('lowRisePct')}</th>
            <th className={thCls('pe')} onClick={() => handleSort('pe')}>P/E {arrow('pe')}</th>
            <th className={thCls('eps')} onClick={() => handleSort('eps')}>EPS {arrow('eps')}</th>
            <th className={thCls('foreignNetBuy')} onClick={() => handleSort('foreignNetBuy')}>外資(億) {arrow('foreignNetBuy')}</th>
            <th className={thCls('trustNet')} onClick={() => handleSort('trustNet')}>投信(億) {arrow('trustNet')}</th>
            <th className={thCls('dealerNet')} onClick={() => handleSort('dealerNet')}>自營(億) {arrow('dealerNet')}</th>
            <th className={thCls('instTotal')} onClick={() => handleSort('instTotal')}>合計(億) {arrow('instTotal')}</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400">產業</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400">概念</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={16} className="py-8 text-center text-slate-400">無個股資料</td></tr>
          ) : sorted.map(r => {
            const chgUp = r.changePercent >= 0
            const highBad = r.highDropPct <= -15
            const highGood = r.highDropPct >= -5
            return (
              <tr key={r.code}
                className="border-b border-slate-100 hover:bg-blue-50 transition-colors cursor-pointer"
                onClick={() => onStockClick?.(r)}
              >
                <td className="px-2 py-2">
                  <button
                    onClick={e => { e.stopPropagation(); toggleWatch(r.code) }}
                    className={isWatched(r.code) ? 'text-amber-400' : 'text-slate-200 hover:text-slate-300'}
                    title={isWatched(r.code) ? '移除觀察' : '加入觀察'}
                  >
                    ★
                  </button>
                </td>
                <td className="px-3 py-2 font-bold text-blue-600">{r.code}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2 text-slate-700">{r.close.toLocaleString()}</td>
                <td className="px-3 py-2">
                  <span className={chgUp ? 'text-red-500 font-semibold' : 'text-green-600 font-semibold'}>
                    {chgUp ? '▲' : '▼'}{Math.abs(r.changePercent).toFixed(2)}%
                  </span>
                </td>
                <td className={`px-3 py-2 font-medium ${highBad ? 'text-red-500' : highGood ? 'text-slate-400' : 'text-slate-600'}`}>
                  {r.highDropPct.toFixed(2)}%
                </td>
                <td className="px-3 py-2">
                  <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full"
                      style={{ width: `${Math.min(Math.abs(r.highDropPct), 50) * 2}%` }}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-red-500 font-medium">+{r.lowRisePct.toFixed(2)}%</td>
                <td className="px-3 py-2 text-slate-600">{r.pe?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.eps?.toFixed(2) ?? '—'}</td>
                <td className="px-3 py-2">{instCell(r.foreignNetBuy)}</td>
                <td className="px-3 py-2">{instCell(r.trustNet)}</td>
                <td className="px-3 py-2">{instCell(r.dealerNet)}</td>
                <td className="px-3 py-2">{instCell(r.instTotal)}</td>
                <td className="px-3 py-2">
                  <span className="bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-500 text-[10px] whitespace-nowrap">
                    {r.industry}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <ConceptTags concepts={r.concepts} onTagClick={onConceptClick} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
