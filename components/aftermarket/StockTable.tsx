'use client'
import { useState, useMemo } from 'react'
import type { StockRow } from '@/lib/types'

interface Props {
  rows: StockRow[]
  posTriggered: boolean
  negTriggered: boolean
}

type SortKey = 'changePercent' | 'highDropPct' | 'lowRisePct' | 'pe' | 'eps' | 'foreignNetBuy'

export default function StockTable({ rows, posTriggered, negTriggered }: Props) {
  const [query, setQuery] = useState('')
  const [industry, setIndustry] = useState('全部')
  const [sortKey, setSortKey] = useState<SortKey>('highDropPct')
  const [sortAsc, setSortAsc] = useState(true)

  const industries = useMemo(() => {
    const set = new Set(rows.map(r => r.industry))
    return ['全部', ...Array.from(set).sort()]
  }, [rows])

  const sorted = useMemo(() => {
    let list = rows
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(r => r.code.includes(q) || r.name.includes(q))
    }
    if (industry !== '全部') list = list.filter(r => r.industry === industry)
    return [...list].sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })
  }, [rows, query, industry, sortKey, sortAsc])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  function thCls(key: SortKey) {
    return `cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold whitespace-nowrap hover:text-[#94a3b8] ${sortKey === key ? 'text-[#60a5fa]' : 'text-[#64748b]'}`
  }

  return (
    <div>
      {/* 篩選列 */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value)}
          className="bg-[#1e2235] border border-[#2d3148] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] focus:outline-none"
        >
          {industries.map(i => <option key={i}>{i}</option>)}
        </select>
        <input
          type="text"
          placeholder="🔍 搜尋代號 / 名稱"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="bg-[#1e2235] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] w-44 focus:outline-none focus:border-[#3b82f6]"
        />
        <span className="text-xs text-[#475569]">{sorted.length} 檔</span>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-xl border border-[#2d3148]">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#2d3148] bg-[#111320]">
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#64748b] whitespace-nowrap">代號</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#64748b]">名稱</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#64748b]">收盤</th>
              <th className={thCls('changePercent')} onClick={() => handleSort('changePercent')}>
                漲跌% {sortKey === 'changePercent' ? (sortAsc ? '↑' : '↓') : '↕'}
              </th>
              <th className={thCls('highDropPct')} onClick={() => handleSort('highDropPct')}>
                距N日高▼% {sortKey === 'highDropPct' ? (sortAsc ? '↑' : '↓') : '↕'}
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#64748b] whitespace-nowrap">視覺</th>
              <th className={thCls('lowRisePct')} onClick={() => handleSort('lowRisePct')}>
                距N日低▲% {sortKey === 'lowRisePct' ? (sortAsc ? '↑' : '↓') : '↕'}
              </th>
              <th className={thCls('pe')} onClick={() => handleSort('pe')}>
                P/E {sortKey === 'pe' ? (sortAsc ? '↑' : '↓') : '↕'}
              </th>
              <th className={thCls('eps')} onClick={() => handleSort('eps')}>
                EPS {sortKey === 'eps' ? (sortAsc ? '↑' : '↓') : '↕'}
              </th>
              <th className={thCls('foreignNetBuy')} onClick={() => handleSort('foreignNetBuy')}>
                外資億 {sortKey === 'foreignNetBuy' ? (sortAsc ? '↑' : '↓') : '↕'}
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#64748b]">產業</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const chgUp = r.changePercent >= 0
              const highBad = r.highDropPct <= -15
              const highGood = r.highDropPct >= -5
              return (
                <tr key={r.code} className="border-b border-[#1a1d27] hover:bg-[#1e2235] transition-colors">
                  <td className="px-3 py-2 font-bold text-[#60a5fa]">{r.code}</td>
                  <td className="px-3 py-2 text-[#e2e8f0]">{r.name}</td>
                  <td className="px-3 py-2 text-[#e2e8f0]">{r.close.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={chgUp ? 'text-red-400' : 'text-green-400'}>
                      {chgUp ? '▲' : '▼'}{Math.abs(r.changePercent).toFixed(2)}%
                    </span>
                    {posTriggered && <span className="ml-1 text-[10px] text-red-400">融資減幅&gt;大盤5%</span>}
                    {negTriggered && <span className="ml-1 text-[10px] text-green-400">融資增幅&gt;大盤7%</span>}
                  </td>
                  <td className={`px-3 py-2 font-medium ${highBad ? 'text-red-400' : highGood ? 'text-green-400' : 'text-[#e2e8f0]'}`}>
                    {r.highDropPct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-16 h-1.5 bg-[#1e2235] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 rounded-full"
                        style={{ width: `${Math.min(Math.abs(r.highDropPct), 50) * 2}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-green-400 font-medium">+{r.lowRisePct.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-[#e2e8f0]">{r.pe?.toFixed(1) ?? '—'}</td>
                  <td className="px-3 py-2 text-[#e2e8f0]">{r.eps?.toFixed(2) ?? '—'}</td>
                  <td className={`px-3 py-2 font-medium ${r.foreignNetBuy >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {r.foreignNetBuy >= 0 ? '+' : ''}{r.foreignNetBuy.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className="bg-[#1e2235] border border-[#2d3148] rounded px-1.5 py-0.5 text-[#64748b] text-[10px]">
                      {r.industry}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[#475569] mt-2">
        距N日高▼%：修正愈深數值愈負（紅色）｜距N日低▲%：反彈幅度（綠色）｜欄位標題可排序
      </p>
    </div>
  )
}
