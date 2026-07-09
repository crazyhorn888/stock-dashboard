'use client'
import { useState, useMemo, useEffect } from 'react'
import MarketSignalCards from '@/components/aftermarket/MarketSignalCards'
import KlineChart from '@/components/aftermarket/KlineChart'
import StockTable from '@/components/aftermarket/StockTable'
import GlobalIndexLights from '@/components/aftermarket/GlobalIndexLights'
import GlobalIndexModal from '@/components/aftermarket/GlobalIndexModal'
import BubbleChart from '@/components/bubble/BubbleChart'
import QuadrantSummary from '@/components/bubble/QuadrantSummary'
import SectorRanking from '@/components/bubble/SectorRanking'
import SectorPanel from '@/components/bubble/SectorPanel'
import StockDetailSheet from '@/components/stock/StockDetailSheet'
import FreshnessBar from '@/components/shared/FreshnessBar'
import { calcStockRow } from '@/lib/calcMetrics'
import { MOCK_DATA } from '@/lib/mockData'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import { fetchStockHistory } from '@/lib/fetchStockHistory'
import { calcWatchlistBubbles, getGhostPeers } from '@/lib/calcWatchlistBubbles'
import { useWatchlist } from '@/lib/watchlist'
import type { SnapshotData, SectorBubble, StockData, MarketSignals, StockHistoryDay } from '@/lib/types'

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
  const [sectorView, setSectorView] = useState<'bubble' | 'ranking'>('bubble')
  const [sectorSource, setSectorSource] = useState<'official' | 'concept' | 'watchlist'>('official')
  const [globalModalKey, setGlobalModalKey] = useState<string | null>(null)
  // P2-5：觀察清單 + 自選股泡泡回放
  const { codes: watchlistCodes } = useWatchlist()
  const [stockHistory, setStockHistory] = useState<StockHistoryDay[]>([])
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false)
  // Ghost：同概念陪跑泡泡。conceptStockMap 是 code -> 概念[] 的靜態資料，動態 import 才不會讓一般使用者也下載到
  const [conceptStockMap, setConceptStockMap] = useState<Record<string, string[]> | null>(null)
  const [focusedWatchlistBubble, setFocusedWatchlistBubble] = useState<SectorBubble | null>(null)

  useEffect(() => {
    fetchSnapshot()
      .then(d => {
        setData({
          ...d,
          // production 快照可能尚未有這兩個欄位，fallback 到 mock
          indexHistory: d.indexHistory?.length ? d.indexHistory : MOCK_DATA.indexHistory,
          sectors:      d.sectors?.length      ? d.sectors      : MOCK_DATA.sectors,
          concepts:     d.concepts?.length      ? d.concepts     : MOCK_DATA.concepts,
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

  // P2-2：點概念 tag → 關閉目前的個股詳情/板塊面板，開啟該概念的 SectorPanel
  function handleConceptClick(name: string) {
    const bubble = data.concepts?.find(c => c.sectorName === name)
    if (!bubble) return
    setActiveStock(null)
    setActiveSector(bubble)
  }

  // P2-5：進入自選股模式才 lazy fetch stock-history.json（module-level cache，之後切換不重抓）
  useEffect(() => {
    if (sectorSource !== 'watchlist' || stockHistory.length > 0 || stockHistoryLoading) return
    setStockHistoryLoading(true)
    fetchStockHistory()
      .then(setStockHistory)
      .catch(e => console.warn('[stockHistory] 載入失敗：', e.message))
      .finally(() => setStockHistoryLoading(false))
  }, [sectorSource, stockHistory.length, stockHistoryLoading])

  const stockIndexByCode = useMemo(
    () => Object.fromEntries(data.stocks.map(s => [s.code, s])),
    [data.stocks],
  )

  const watchlistBubbles = useMemo(
    () => calcWatchlistBubbles(stockHistory, watchlistCodes, stockIndexByCode),
    [stockHistory, watchlistCodes, stockIndexByCode],
  )

  // Ghost：只在自選股模式且已聚焦某泡泡時才需要 concept-sectors.json，動態 import 避免影響一般使用者的 JS bundle
  useEffect(() => {
    if (sectorSource !== 'watchlist' || !focusedWatchlistBubble || conceptStockMap) return
    import('@/data/concept-sectors.json').then(mod => setConceptStockMap((mod.default ?? mod).stocks ?? {}))
  }, [sectorSource, focusedWatchlistBubble, conceptStockMap])

  const ghostBubbles = useMemo(() => {
    if (sectorSource !== 'watchlist' || !focusedWatchlistBubble || !conceptStockMap) return []
    const code = focusedWatchlistBubble.stocks[0]?.code
    if (!code) return []
    const peers = getGhostPeers(code, conceptStockMap, stockHistory, 8)
    return calcWatchlistBubbles(stockHistory, peers, stockIndexByCode)
  }, [sectorSource, focusedWatchlistBubble, conceptStockMap, stockHistory, stockIndexByCode])

  // P2-1/P2-5：產業板塊分類來源切換（官方 sector / 概念股 / 自選股，一股多概念）
  const activeSectors =
    sectorSource === 'official'  ? (data.sectors ?? []) :
    sectorSource === 'concept'   ? (data.concepts ?? []) :
    watchlistBubbles
  const activeSectorHistory =
    sectorSource === 'official'  ? data.sectorHistory :
    sectorSource === 'concept'   ? data.conceptHistory :
    stockHistory
  // QuadrantSummary 的「逆勢買超」概念定義在板塊/概念層級，自選股模式不適用，故只在前兩種模式提供
  const activeTodayRows =
    sectorSource === 'official' ? data.sectorHistory?.[0]?.rows :
    sectorSource === 'concept'  ? data.conceptHistory?.[0]?.rows :
    undefined

  // 聚焦回放的日期標籤：trail 最多 5 點 + 今日 = 6 個日期（newest first）
  const frameDates = useMemo(
    () => (activeSectorHistory ?? []).slice(0, 6).map(d => d.date),
    [activeSectorHistory]
  )

  // 用前端 n 重新計算大盤訊號（後端 marketSignals.nDays 固定為 100，不隨使用者 N 更新）
  const computedSignals = useMemo<MarketSignals>(() => {
    const history = data.indexHistory ?? []
    const slice = history.slice(0, n) // newest first
    if (!slice.length) return data.marketSignals

    const todayBar = slice[0]
    const todayIndex = todayBar.close
    const todayMargin = todayBar.chips?.margin_amount ?? null

    let peakBar = slice[0]
    let troughBar = slice[0]
    for (const d of slice) {
      if (d.close > peakBar.close) peakBar = d
      if (d.close < troughBar.close) troughBar = d
    }

    const peakIndex    = peakBar.close
    const peakMargin   = peakBar.chips?.margin_amount ?? null
    const troughIndex  = troughBar.close
    const troughMargin = troughBar.chips?.margin_amount ?? null

    const indexDropPct  = peakIndex  > 0 ? Math.abs((todayIndex  - peakIndex)  / peakIndex  * 100) : 0
    const marginDropPct = (peakMargin != null && todayMargin != null && peakMargin > 0)
      ? Math.abs((todayMargin - peakMargin) / peakMargin * 100) : null
    const posGapPct = marginDropPct != null ? marginDropPct - indexDropPct : null

    const indexRisePct  = troughIndex  > 0 ? Math.abs((todayIndex  - troughIndex)  / troughIndex  * 100) : 0
    const marginRisePct = (troughMargin != null && todayMargin != null && troughMargin > 0)
      ? Math.abs((todayMargin - troughMargin) / troughMargin * 100) : null
    const negGapPct = marginRisePct != null ? marginRisePct - indexRisePct : null

    return {
      ...data.marketSignals,
      nDays: n,
      todayIndex,
      todayMargin,
      peakDate:    peakBar.date,
      peakIndex,
      peakMargin,
      indexDropPct,
      marginDropPct,
      posGapPct,
      posTriggered: posGapPct != null && posGapPct >= 5,
      troughDate:   troughBar.date,
      troughIndex,
      troughMargin,
      indexRisePct,
      marginRisePct,
      negGapPct,
      negTriggered: negGapPct != null && negGapPct >= 7,
    }
  }, [data.indexHistory, data.marketSignals, n])

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
        {/* Mock 模式全版面浮水印：避免示範資料被誤當真實行情（P1-6） */}
        {error && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center select-none">
            <div className="-rotate-12 text-4xl sm:text-6xl font-black text-red-500/10 whitespace-nowrap">
              示範資料 · 非真實行情
            </div>
          </div>
        )}
        {!loading && !error && <FreshnessBar data={data} />}

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-36 rounded-xl bg-slate-200" />
            <div className="h-44 rounded-xl bg-slate-200" />
          </div>
        ) : (
          <>
            {activeTab === '大盤關鍵資料' && (
              <>
                <GlobalIndexLights indices={data.globalIndices} onSelect={setGlobalModalKey} />
                <KlineChart data={data.indexHistory ?? []} n={n} />
                <MarketSignalCards signals={computedSignals} />
              </>
            )}

            {activeTab === '個股清單' && (
              <StockTable rows={rows} onStockClick={setActiveStock} onConceptClick={handleConceptClick} />
            )}

            {activeTab === '產業板塊' && (
              <div className="rounded-xl bg-white shadow-sm overflow-hidden">
                {/* 四象限統計條（P1-5）：大盤漲跌% 由 indexHistory 前兩根 K 棒推算；自選股模式不適用 */}
                {sectorSource !== 'watchlist' && (
                  <QuadrantSummary
                    sectors={activeSectors}
                    todayRows={activeTodayRows}
                    marketChangePct={(() => {
                      const [t, p] = data.indexHistory ?? []
                      return t && p && p.close > 0 ? ((t.close - p.close) / p.close) * 100 : null
                    })()}
                  />
                )}

                {/* 官方分類 / 概念分類 / 自選股 資料來源切換（P2-1、P2-5） */}
                <div className="flex items-center gap-1.5 px-3 pt-2 flex-wrap">
                  {([['official', '官方分類'], ['concept', '概念分類'], ['watchlist', '⭐ 自選股']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setSectorSource(v)}
                      className={[
                        'px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors',
                        sectorSource === v
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400',
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  ))}
                  {sectorSource === 'concept' && (
                    <span className="text-[10px] text-slate-400 ml-1">一股可能屬於多個概念，資金會重複計算</span>
                  )}
                </div>

                {sectorSource === 'watchlist' ? (
                  watchlistCodes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-1">
                      <div className="text-3xl mb-1">⭐</div>
                      <p className="text-xs font-medium">還沒有觀察清單</p>
                      <p className="text-[10px]">到「個股清單」點股票列最左邊的 ★ 加入觀察</p>
                    </div>
                  ) : stockHistoryLoading ? (
                    <div className="py-14 text-center text-xs text-slate-400">個股歷史資料載入中...</div>
                  ) : (
                    <BubbleChart
                      sectors={activeSectors}
                      onBubbleClick={s => setActiveSector(s)}
                      frameDates={frameDates}
                      onFocusChange={setFocusedWatchlistBubble}
                      ghostBubbles={ghostBubbles}
                    />
                  )
                ) : (
                  <>
                    {/* 泡泡圖 / 排行榜 視圖切換 */}
                    <div className="flex gap-1.5 px-3 py-2">
                      {([['bubble', '🫧 泡泡圖'], ['ranking', '📋 排行榜']] as const).map(([v, label]) => (
                        <button
                          key={v}
                          onClick={() => setSectorView(v)}
                          className={[
                            'px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors',
                            sectorView === v
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300',
                          ].join(' ')}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {sectorView === 'bubble' ? (
                      <BubbleChart
                        sectors={activeSectors}
                        onBubbleClick={s => setActiveSector(s)}
                        frameDates={frameDates}
                      />
                    ) : (
                      <SectorRanking
                        sectors={activeSectors}
                        allStocks={data.stocks}
                        onSectorClick={s => setActiveSector(s)}
                      />
                    )}
                  </>
                )}
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
        onConceptClick={handleConceptClick}
      />
      <StockDetailSheet stock={activeStock} n={n} onClose={() => setActiveStock(null)} onConceptClick={handleConceptClick} />
      <GlobalIndexModal
        data={globalModalKey ? data.globalIndices?.[globalModalKey] ?? null : null}
        onClose={() => setGlobalModalKey(null)}
      />
    </div>
  )
}
