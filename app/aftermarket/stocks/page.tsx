'use client'
import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import ParamBar from '@/components/aftermarket/ParamBar'
import StockTable from '@/components/aftermarket/StockTable'
import { calcStockRow } from '@/lib/calcMetrics'
import { MOCK_DATA } from '@/lib/mockData'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import type { SnapshotData } from '@/lib/types'

export default function StocksPage() {
  const [n, setN] = useState(100)
  const [data, setData] = useState<SnapshotData>(MOCK_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSnapshot()
      .then(d => { setData(d); setLoading(false) })
      .catch(e => {
        console.warn('[fetchSnapshot] 使用 Mock 資料：', e.message)
        setError('無法取得即時資料，顯示示範資料')
        setLoading(false)
      })
  }, [])

  const rows = useMemo(
    () => data.stocks.map(s => calcStockRow(s, n)),
    [data.stocks, n]
  )

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      {/* 頁面標題列 */}
      <div className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 shadow-sm">
        <Link href="/aftermarket" className="text-slate-400 hover:text-blue-600 transition-colors text-lg leading-none">‹</Link>
        <span className="font-semibold text-slate-700 text-sm">個股修正幅度</span>
        {!loading && data.updatedAt && (
          <span className="ml-auto text-xs text-amber-600 font-medium">
            更新 {new Date(data.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <main className="max-w-screen-xl mx-auto px-4 py-5">
        {error && (
          <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-700">
            ⚠ {error}
          </div>
        )}

        <ParamBar n={n} onChange={setN} />

        {loading ? (
          <div className="mt-4 space-y-3 animate-pulse">
            <div className="h-8 w-40 rounded-lg bg-slate-200" />
            <div className="h-64 rounded-xl bg-slate-200" />
          </div>
        ) : (
          <StockTable rows={rows} />
        )}
      </main>
    </div>
  )
}
