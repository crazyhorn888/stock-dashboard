'use client'
import { useState, useMemo } from 'react'
import type { StockRow, StockData } from '@/lib/types'
import StockRowsTable from '@/components/shared/StockRowsTable'

/**
 * 個股清單 = 篩選列 + 共用表格（StockRowsTable，與泡泡面板同欄位/排序/格式，2026-07-12 統一）。
 * 產業欄與篩選下拉都保留（07-12 曾因整欄「—」誤判沒用要移除，實為資料 bug，修復後 Franky 確認留下）。
 */
interface Props {
  rows: StockRow[]
  onStockClick?: (stock: StockData) => void
  onConceptClick?: (concept: string) => void
}

export default function StockTable({ rows, onStockClick, onConceptClick }: Props) {
  const [query, setQuery] = useState('')
  const [industry, setIndustry] = useState('全部')

  const industries = useMemo(() => {
    const set = new Set(rows.map(r => r.industry))
    return ['全部', ...Array.from(set).sort()]
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(r => r.code.includes(q) || r.name.includes(q))
    }
    if (industry !== '全部') list = list.filter(r => r.industry === industry)
    return list
  }, [rows, query, industry])

  return (
    <div>
      {/* 篩選列 */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-blue-400"
        >
          {industries.map(i => <option key={i}>{i}</option>)}
        </select>
        <input
          type="text"
          placeholder="搜尋代號 / 名稱"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 w-40 focus:outline-none focus:border-blue-400"
        />
        <span className="text-xs text-slate-400">{filtered.length} 檔</span>
      </div>

      <StockRowsTable
        rows={filtered}
        onStockClick={onStockClick}
        onConceptClick={onConceptClick}
        defaultSortKey="highDropPct"
        defaultAsc={true}
      />

      <p className="text-xs text-slate-400 mt-2">
        距N高▼%：修正愈深數值愈負（紅）｜距N低▲%：從低點反彈幅度（紅）｜外資/投信/自營/合計為當日三大法人買賣超（億），排序按絕對值｜欄位標題可排序
      </p>
    </div>
  )
}
