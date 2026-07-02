'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import MarketSignalCards from '@/components/aftermarket/MarketSignalCards'
import { MOCK_DATA } from '@/lib/mockData'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import type { SnapshotData } from '@/lib/types'

const TABS = ['修正幅度表', '籌碼分析', '基本面比較']

export default function AftermarketPage() {
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

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      {/* 頁面標題列 */}
      <div className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm">
        <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
        {!loading && data.updatedAt && (
          <span className="text-xs text-amber-600 font-medium">
            更新 {new Date(data.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <main className="max-w-screen-xl mx-auto px-4 py-5">
        {/* 錯誤提示 */}
        {error && (
          <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-700">
            ⚠ {error}
          </div>
        )}

        {/* 功能分類 tabs */}
        <div className="flex gap-2 mb-5">
          {TABS.map((label, i) => (
            <button
              key={label}
              disabled={i > 0}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                i === 0
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-300 border-slate-200 cursor-not-allowed'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 載入中 skeleton */}
        {loading ? (
          <div className="mt-4 space-y-3 animate-pulse">
            <div className="h-48 rounded-xl bg-slate-200" />
          </div>
        ) : (
          <>
            {/* 大盤融資指標 */}
            <MarketSignalCards signals={data.marketSignals} />

            {/* 個股進入按鈕 */}
            <Link
              href="/aftermarket/stocks"
              className="flex items-center justify-between w-full mt-4 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-colors group"
            >
              <div>
                <div className="text-sm font-semibold text-slate-700 group-hover:text-blue-700">個股修正幅度</div>
                <div className="text-xs text-slate-400">{data.stocks.length} 檔 · 距 N 日高低點修正分析</div>
              </div>
              <span className="text-blue-500 text-lg">›</span>
            </Link>
          </>
        )}
      </main>
    </div>
  )
}
