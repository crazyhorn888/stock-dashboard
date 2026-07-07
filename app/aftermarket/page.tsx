'use client'
import { useState, useMemo, useEffect } from 'react'
import MarketSignalCards from '@/components/aftermarket/MarketSignalCards'
import KlineChart from '@/components/aftermarket/KlineChart'
import StockTable from '@/components/aftermarket/StockTable'
import BubbleChart from '@/components/bubble/BubbleChart'
import SectorPanel from '@/components/bubble/SectorPanel'
import StockDetailSheet from '@/components/stock/StockDetailSheet'
import { calcStockRow } from '@/lib/calcMetrics'
import { MOCK_DATA } from '@/lib/mockData'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import type { SnapshotData, SectorBubble, StockData } from '@/lib/types'

const TABS = ['大盤關鍵資料', '產業板塊', '個股清單', '基本面'] as const
type Tab = typeof TABS[number]
const DISABLED_TABS: Tab[] = ['基本面']

export default function AftermarketPage() {
  const [activeTab, setActiveTab] = useState<Tab>('大盤關鍵資料')
  const [n, setN] = useState(100)
  const [nDraft, setNDraft] = useState('100')
  const [data, setData] = useState<SnapshotData>(MOCK_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSector, setActiveSector] = useState<SectorBubble | null>(null)
  const [activeStock, setActiveStock] = useState<StockData | null>(null)

  useEffect(() => {
    fetchSnapshot()
      .then(d => {
        setData({
          ...d,
          // production 快照可能尚未有這兩個欄位，fallback 到 mock
          indexHistory: d.indexHistory?.length ? d.indexHistory : MOCK_DATA.indexHistory,
          sectors:      d.sectors?.length      ? d.sectors      : MOCK_DATA.sectors,
        })
        setLoading(false)
      })
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

  function commitN(val: string) {
    const v = Math.min(250, Math.max(10, parseInt(val) || 100))
    setNDraft(String(v))
    setN(v)
  }

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-40 bg-white shadow-sm">
        {/* Navbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
          {!loading && data.updatedAt && (() => {
            const klineDate = data.indexHistory?.[0]?.date ?? null
            const stocksPending = klineDate && data.stocksDate && data.stocksDate < klineDate
            return stocksPending ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-amber-600 font-medium">
                  指數更新{' '}
                  {new Date(data.updatedAt).toLocaleString('zh-TW', {
                    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span className="text-[10px] text-slate-400">
                  股價 {data.stocksDate?.slice(5).replace('-', '/')} 待更新中
                </span>
              </div>
            ) : (
              <span className="text-xs text-amber-600 font-medium">
                更新{' '}
                {new Date(data.updatedAt).toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )
          })()}
        </div>

        {/* Tab pills */}
        <div className="flex gap-2 px-3 pt-2 pb-2 border-b border-slate-100 overflow-x-auto scrollbar-none">
          {TABS.map(tab => {
            const disabled = DISABLED_TABS.includes(tab)
            const active   = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => !disabled && setActiveTab(tab)}
                disabled={disabled}
                className={[
                  'px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap transition-colors',
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : disabled
                    ? 'bg-white text-slate-300 border-slate-200 cursor-not-allowed'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600',
                ].join(' ')}
              >
                {tab}
              </button>
            )
          })}
        </div>

        {/* N value bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50">
          <span className="text-xs text-slate-500 font-medium">參考區間 N =</span>
          <input
            type="number"
            value={nDraft}
            onChange={e => setNDraft(e.target.value)}
            onBlur={() => commitN(nDraft)}
            onKeyDown={e => e.key === 'Enter' && commitN(nDraft)}
            className="w-14 text-center font-bold text-sm bg-blue-50 border border-blue-200 rounded-lg px-2 py-0.5 text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <span className="text-xs text-slate-500 font-medium">天</span>
          <span className="text-[10px] text-slate-400 ml-1 hidden sm:block">
            走勢標記與個股清單同步更新
          </span>
        </div>
      </div>

      {/* ── Content ── */}
      <main className="max-w-screen-xl mx-auto px-3 py-4">
        {error && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-700">
            ⚠ {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-36 rounded-xl bg-slate-200" />
            <div className="h-44 rounded-xl bg-slate-200" />
          </div>
        ) : (
          <>
            {activeTab === '大盤關鍵資料' && (
              <>
                <KlineChart data={data.indexHistory ?? []} n={n} />
                <MarketSignalCards signals={data.marketSignals} />
              </>
            )}

            {activeTab === '個股清單' && (
              <StockTable rows={rows} onStockClick={setActiveStock} />
            )}

            {activeTab === '產業板塊' && (
              <div className="rounded-xl bg-white shadow-sm overflow-hidden">
                <BubbleChart
                  sectors={data.sectors ?? []}
                  onBubbleClick={s => setActiveSector(s)}
                />
              </div>
            )}

            {activeTab === '基本面' && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <div className="text-5xl mb-4">📊</div>
                <p className="text-sm font-medium">基本面比較</p>
                <p className="text-xs mt-1">規劃中</p>
              </div>
            )}
          </>
        )}
      </main>
      <SectorPanel
        sector={activeSector}
        onClose={() => setActiveSector(null)}
        allStocks={data.stocks}
        n={n}
        onStockClick={stock => { setActiveSector(null); setActiveStock(stock) }}
      />
      <StockDetailSheet stock={activeStock} n={n} onClose={() => setActiveStock(null)} />
    </div>
  )
}
