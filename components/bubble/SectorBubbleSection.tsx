'use client'
import { useState, useMemo, useEffect } from 'react'
import BubbleChart from './BubbleChart'
import QuadrantSummary from './QuadrantSummary'
import SectorRanking from './SectorRanking'
import SectorPanel from './SectorPanel'
import StockDetailSheet from '@/components/stock/StockDetailSheet'
import { calcStockRow } from '@/lib/calcMetrics'
import { calcSectors, calcConcepts } from '@/lib/calcSectors'
import { calcWatchlistBubbles, getGhostPeers } from '@/lib/calcWatchlistBubbles'
import { buildInstNetMap } from '@/lib/instNet'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import { fetchStockHistory } from '@/lib/fetchStockHistory'
import { fetchHolidayStatus } from '@/lib/fetchHolidayStatus'
import { useWatchlist } from '@/lib/watchlist'
import { MOCK_DATA } from '@/lib/mockData'
import type { SnapshotData, SectorBubble, StockData, StockHistoryDay, HolidayStatus } from '@/lib/types'

/**
 * AC-NAV-3：產業板塊泡泡圖整區（原本內嵌在 /aftermarket 的「產業板塊」Tab）。
 * 自足元件——自己載 snapshot、算 rows、管三種資料來源與聚焦面板，
 * 讓 /intraday 可以用滿版容器直接掛上去。
 *
 * 座標一律前端當場算（AC-NAV-6），不吃伺服器寫好的 data.sectors/concepts，
 * 公式改版後不必等 pipeline 重跑就生效。
 */

// rows 的 N 值只影響「距 N 高/低」欄位，泡泡圖本身用不到，固定 100 即可
const ROW_N = 100

interface SectionProps {
  fullHeight?: boolean
  // 把「板塊資料日期／是否落後」往上送，讓頁面 header 右上角統一顯示（比照盤後行情／市場條件）
  onDataStatus?: (status: { date: string | null; stale: boolean; isHoliday: boolean; holidayName?: string | null }) => void
}

export default function SectorBubbleSection({ fullHeight = false, onDataStatus }: SectionProps) {
  const [data, setData] = useState<SnapshotData>(MOCK_DATA)
  const [loading, setLoading] = useState(true)
  const [holidayStatus, setHolidayStatus] = useState<HolidayStatus | null>(null)
  const [sectorView, setSectorView] = useState<'bubble' | 'ranking'>('bubble')
  // 象限篩選：統計卡與泡泡圖共用同一個狀態（統計卡即篩選按鈕）
  const [quadrant, setQuadrant] = useState<'TL' | 'TR' | 'BL' | 'BR' | null>(null)
  const [sectorSource, setSectorSource] = useState<'official' | 'concept' | 'watchlist'>('official')
  const [activeSector, setActiveSector] = useState<SectorBubble | null>(null)
  const [activeStock, setActiveStock] = useState<StockData | null>(null)
  // P2-5：觀察清單 + 自選股泡泡回放
  const { codes: watchlistCodes } = useWatchlist()
  const [stockHistory, setStockHistory] = useState<StockHistoryDay[]>([])
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false)
  const [stockHistoryFetched, setStockHistoryFetched] = useState(false)
  const [conceptStockMap, setConceptStockMap] = useState<Record<string, string[]> | null>(null)
  const [focusedWatchlistBubble, setFocusedWatchlistBubble] = useState<SectorBubble | null>(null)

  useEffect(() => {
    fetchHolidayStatus().then(setHolidayStatus).catch(() => {})
  }, [])

  useEffect(() => {
    fetchSnapshot()
      .then(d => {
        setData({
          ...d,
          indexHistory: d.indexHistory?.length ? d.indexHistory : MOCK_DATA.indexHistory,
          sectors:      d.sectors?.length      ? d.sectors      : MOCK_DATA.sectors,
          concepts:     d.concepts?.length     ? d.concepts     : MOCK_DATA.concepts,
        })
        setLoading(false)
      })
      .catch(e => {
        console.warn('[fetchSnapshot] 使用 Mock 資料：', e.message)
        setLoading(false)
      })
  }, [])

  // P2-5：進入自選股模式才 lazy fetch stock-history.json；fetched 旗標避免失敗後無限重試
  useEffect(() => {
    if (sectorSource !== 'watchlist' || stockHistoryFetched) return
    setStockHistoryFetched(true)
    setStockHistoryLoading(true)
    fetchStockHistory()
      .then(setStockHistory)
      .catch(e => console.warn('[stockHistory] 載入失敗：', e.message))
      .finally(() => setStockHistoryLoading(false))
  }, [sectorSource, stockHistoryFetched])

  // Ghost：只在自選股模式且已聚焦時才需要 concept-sectors.json，動態 import 不進主 bundle
  useEffect(() => {
    if (sectorSource !== 'watchlist' || !focusedWatchlistBubble || conceptStockMap) return
    import('@/data/concept-sectors.json').then(mod => setConceptStockMap((mod.default ?? mod).stocks ?? {}))
  }, [sectorSource, focusedWatchlistBubble, conceptStockMap])

  // 當日三大法人統一資料源（day0 T86）：泡泡面板／個股詳情共用
  const instNetData = useMemo(() => buildInstNetMap(data.sectorHistory), [data.sectorHistory])

  const rowsByCode = useMemo(() => {
    const rows = data.stocks.map(s => {
      const row = calcStockRow(s, ROW_N)
      const t86 = instNetData.map[s.code]
      return t86
        ? { ...row, foreignNetBuy: t86.foreignNet, trustNet: t86.trustNet, dealerNet: t86.dealerNet, instTotal: t86.net }
        : row
    })
    return Object.fromEntries(rows.map(r => [r.code, r]))
  }, [data.stocks, instNetData])

  const stockIndexByCode = useMemo(
    () => Object.fromEntries(data.stocks.map(s => [s.code, s])),
    [data.stocks],
  )

  const conceptMapByCode = useMemo(
    () => Object.fromEntries(data.stocks.map(s => [s.code, s.concepts ?? []])),
    [data.stocks],
  )

  // AC-NAV-6：官方／概念皆前端重算；概念只在切過去時才算（分組成本較高）
  const officialSectors = useMemo(
    () => (data.sectorHistory?.length ? calcSectors(data.sectorHistory, data.stocks) : (data.sectors ?? [])),
    [data.sectorHistory, data.stocks, data.sectors],
  )

  const conceptSectors = useMemo(
    () => (sectorSource === 'concept' && data.conceptHistory?.length
      ? calcConcepts(data.conceptHistory, data.stocks, conceptMapByCode)
      : (data.concepts ?? [])),
    [sectorSource, data.conceptHistory, data.stocks, data.concepts, conceptMapByCode],
  )

  const watchlistBubbles = useMemo(
    () => calcWatchlistBubbles(stockHistory, watchlistCodes, stockIndexByCode),
    [stockHistory, watchlistCodes, stockIndexByCode],
  )

  const ghostBubbles = useMemo(() => {
    if (sectorSource !== 'watchlist' || !focusedWatchlistBubble || !conceptStockMap) return []
    const code = focusedWatchlistBubble.stocks[0]?.code
    if (!code) return []
    const peers = getGhostPeers(code, conceptStockMap, stockHistory, 8)
    return calcWatchlistBubbles(stockHistory, peers, stockIndexByCode)
  }, [sectorSource, focusedWatchlistBubble, conceptStockMap, stockHistory, stockIndexByCode])

  const activeSectors =
    sectorSource === 'official'  ? officialSectors :
    sectorSource === 'concept'   ? conceptSectors :
    watchlistBubbles
  const activeSectorHistory =
    sectorSource === 'official'  ? data.sectorHistory :
    sectorSource === 'concept'   ? data.conceptHistory :
    stockHistory
  const activeTodayRows =
    sectorSource === 'official' ? data.sectorHistory?.[0]?.rows :
    sectorSource === 'concept'  ? data.conceptHistory?.[0]?.rows :
    undefined

  // 板塊資料若非今日（T86 尚未更新），泡泡圖會靜默沿用前一天資料，加日期標示避免誤讀
  const sectorDataDate = (sectorSource === 'official' ? data.sectorHistory : data.conceptHistory)?.[0]?.date ?? null
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const sectorDataIsStale = !!sectorDataDate && sectorDataDate !== todayStr
  const isHolidayToday = holidayStatus?.date === todayStr && holidayStatus.isHoliday

  useEffect(() => {
    onDataStatus?.({
      date: sectorDataDate,
      stale: sectorDataIsStale,
      isHoliday: !!isHolidayToday,
      holidayName: holidayStatus?.name ?? null,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorDataDate, sectorDataIsStale, isHolidayToday])

  // 聚焦回放的日期標籤：trail 最多 5 點 + 今日 = 6 個日期（newest first）
  const frameDates = useMemo(
    () => (activeSectorHistory ?? []).slice(0, 6).map(d => d.date),
    [activeSectorHistory],
  )

  // AC-NAV-4：滿版模式把繪圖高度拉高（viewBox 內部座標，SVG 寬度 100% 時高度按比例放大）
  const chartHeight = fullHeight ? 560 : 320

  return (
    <div className={`rounded-xl bg-white shadow-sm overflow-hidden ${fullHeight ? 'h-full' : ''}`}>
      {sectorSource !== 'watchlist' && (
        <QuadrantSummary
          sectors={activeSectors}
          todayRows={activeTodayRows}
          marketChangePct={(() => {
            const [t, p] = data.indexHistory ?? []
            return t && p && p.close > 0 ? ((t.close - p.close) / p.close) * 100 : null
          })()}
          onSectorClick={s => setActiveSector(s)}
          activeQuadrant={quadrant}
          onQuadrantClick={id => setQuadrant(id as typeof quadrant)}
        />
      )}

      {/* 一列搞定：左＝資料來源，右＝泡泡圖／排行榜圖示切換（原本各佔一列） */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <div className="flex items-center gap-1.5 flex-wrap">
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
        </div>

        {sectorSource !== 'watchlist' && (
          <div className="flex items-center rounded-md border border-slate-200 overflow-hidden shrink-0">
            {([['bubble', '🫧', '泡泡圖'], ['ranking', '📋', '排行榜']] as const).map(([v, icon, title]) => (
              <button
                key={v}
                onClick={() => setSectorView(v)}
                title={title}
                aria-label={title}
                className={`px-2.5 py-1 text-[13px] leading-none transition-colors ${
                  sectorView === v ? 'bg-blue-600' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <span className={sectorView === v ? '' : 'opacity-40'}>{icon}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {sectorSource === 'concept' && (
        <p className="text-[10px] text-slate-400 px-3 pt-1">一股可能屬於多個概念，資金會重複計算</p>
      )}

      {loading ? (
        <div className="py-14 text-center text-xs text-slate-400">資料載入中...</div>
      ) : sectorSource === 'watchlist' ? (
        watchlistCodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-1">
            <div className="text-3xl mb-1">⭐</div>
            <p className="text-xs font-medium">還沒有觀察清單</p>
            <p className="text-[10px]">到「盤後行情 → 個股清單」點股票列最左邊的 ★ 加入觀察</p>
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
            chartHeight={chartHeight}
            zoom={quadrant}
            onZoomChange={q => setQuadrant(q)}
          />
        )
      ) : (
        <>
          {sectorView === 'bubble' ? (
            <BubbleChart
              sectors={activeSectors}
              onBubbleClick={s => setActiveSector(s)}
              frameDates={frameDates}
              chartHeight={chartHeight}
              zoom={quadrant}
              onZoomChange={q => setQuadrant(q)}
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

      <SectorPanel
        sector={activeSector}
        onClose={() => setActiveSector(null)}
        rowsByCode={rowsByCode}
        onStockClick={setActiveStock}
      />

      <StockDetailSheet
        stock={activeStock}
        n={ROW_N}
        onClose={() => setActiveStock(null)}
        instNet={activeStock ? instNetData.map[activeStock.code] ?? null : null}
        instNetDate={instNetData.date}
      />
    </div>
  )
}
