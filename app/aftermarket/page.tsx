'use client'
import { useState, useMemo, useEffect } from 'react'
import NavBar from '@/components/shared/NavBar'
import ParamBar from '@/components/aftermarket/ParamBar'
import MarketSignalCards from '@/components/aftermarket/MarketSignalCards'
import StockTable from '@/components/aftermarket/StockTable'
import { calcStockRow } from '@/lib/calcMetrics'
import { MOCK_DATA } from '@/lib/mockData'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import type { SnapshotData } from '@/lib/types'

export default function AftermarketPage() {
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
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0]">
      <NavBar updatedAt={loading ? undefined : data.updatedAt} />
      <main className="max-w-screen-xl mx-auto px-4 py-6">

        {/* 錯誤提示 */}
        {error && (
          <div className="mb-4 px-4 py-2.5 bg-[#1c1a10] border border-yellow-700 rounded-lg text-xs text-yellow-400">
            ⚠ {error}
          </div>
        )}

        {/* 功能切換 tabs */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: '📊 修正幅度表', desc: '距N日最高/最低修正%\n含基本面欄位', active: true },
            { label: '💰 籌碼分析',   desc: '外資/投信/自營買賣超\n連續天數統計', active: false },
            { label: '📈 基本面比較', desc: 'P/E、P/B、EPS TTM\n同產業橫向比較', active: false },
          ].map(t => (
            <div
              key={t.label}
              className={`rounded-xl p-3.5 border-t-[3px] ${
                t.active
                  ? 'bg-[#1e2235] border-t-[#3b82f6]'
                  : 'bg-[#1e2235] border-t-[#475569] opacity-55'
              }`}
            >
              <div className="text-sm font-bold mb-1">{t.label}</div>
              <div className="text-xs text-[#64748b] whitespace-pre-line">{t.desc}</div>
              <div className={`text-xs font-bold mt-2 ${t.active ? 'text-[#3b82f6]' : 'text-[#475569]'}`}>
                {t.active ? '▶ 目前頁面' : '＋ 未來新增'}
              </div>
            </div>
          ))}
        </div>

        {/* N 日設定 */}
        <ParamBar n={n} onChange={setN} />

        {/* 載入中 skeleton */}
        {loading ? (
          <div className="mt-6 space-y-3 animate-pulse">
            <div className="h-24 rounded-xl bg-[#1e2235]" />
            <div className="h-64 rounded-xl bg-[#1e2235]" />
          </div>
        ) : (
          <>
            {/* 大盤融資指標 */}
            <MarketSignalCards signals={data.marketSignals} n={n} />

            {/* 個股表格 */}
            <StockTable
              rows={rows}
              posTriggered={data.marketSignals.posTriggered}
              negTriggered={data.marketSignals.negTriggered}
            />
          </>
        )}
      </main>
    </div>
  )
}
