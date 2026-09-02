'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import MarketSignalCards from '@/components/aftermarket/MarketSignalCards'
import KlineChart from '@/components/aftermarket/KlineChart'
import StockTable from '@/components/aftermarket/StockTable'
import GlobalIndexLights from '@/components/aftermarket/GlobalIndexLights'
import DailyBriefCard from '@/components/aftermarket/DailyBriefCard'
import GlobalIndexModal from '@/components/aftermarket/GlobalIndexModal'
import SectorPanel from '@/components/bubble/SectorPanel'
import StockDetailSheet from '@/components/stock/StockDetailSheet'
import FreshnessBar from '@/components/shared/FreshnessBar'
import { calcStockRow } from '@/lib/calcMetrics'
import { MOCK_DATA } from '@/lib/mockData'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import { fetchHolidayStatus } from '@/lib/fetchHolidayStatus'
import { calcConcepts } from '@/lib/calcSectors'
import { buildInstNetMap } from '@/lib/instNet'
import type { SnapshotData, SectorBubble, StockData, MarketSignals, HolidayStatus } from '@/lib/types'

const TABS = ['大盤關鍵資料', '個股清單', '基本面'] as const
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
  const [globalModalKey, setGlobalModalKey] = useState<string | null>(null)
  // 台股是否休市（TWSE 官方行事曆）：用來把「待更新中」類文字換成「今日休市」說明，避免上午誤讀
  const [holidayStatus, setHolidayStatus] = useState<HolidayStatus | null>(null)
  // /review 待審核數量：>0 時齒輪圖示發亮提醒
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    fetchHolidayStatus().then(setHolidayStatus)
    fetch('/api/review/pending-count').then(r => r.json()).then(d => setPendingCount(d.count ?? 0)).catch(() => {})
  }, [])

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

  // 當日三大法人統一資料源（day0 T86）：泡泡面板／個股清單／詳情頁三處 refer 同一份
  const instNetData = useMemo(() => buildInstNetMap(data.sectorHistory), [data.sectorHistory])

  const rows = useMemo(
    () => data.stocks.map(s => {
      const row = calcStockRow(s, n)
      // 法人欄位改用 day0 T86（與泡泡面板同源）；
      // 上櫃股 T86 不涵蓋 → 外資保留既有 TPEX 值，投信/自營/合計為 undefined（表格顯示「—」）
      const t86 = instNetData.map[s.code]
      return t86
        ? { ...row, foreignNetBuy: t86.foreignNet, trustNet: t86.trustNet, dealerNet: t86.dealerNet, instTotal: t86.net }
        : row
    }),
    [data.stocks, n, instNetData]
  )

  // 泡泡面板（SectorPanel）與個股清單共用同一份 rows——同資料、同欄位、同格式
  const rowsByCode = useMemo(
    () => Object.fromEntries(rows.map(r => [r.code, r])),
    [rows],
  )

  // P2-2：點概念 tag → 關閉目前的個股詳情，開啟該概念的 SectorPanel。
  // 概念泡泡改前端算（AC-NAV-6），分組成本較高 → 點到才算、算完快取，data 換掉時失效
  const conceptBubblesRef = useRef<{ src: SnapshotData; list: SectorBubble[] } | null>(null)
  function handleConceptClick(name: string) {
    if (conceptBubblesRef.current?.src !== data) {
      conceptBubblesRef.current = {
        src: data,
        list: data.conceptHistory?.length
          ? calcConcepts(data.conceptHistory, data.stocks, conceptMapByCode)
          : (data.concepts ?? []),
      }
    }
    const bubble = conceptBubblesRef.current.list.find(c => c.sectorName === name)
    if (!bubble) return
    setActiveStock(null)
    setActiveSector(bubble)
  }

  // 概念分類的分組查表：code → 概念名稱[]（StockData.concepts 由 pipeline 寫入）
  const conceptMapByCode = useMemo(
    () => Object.fromEntries(data.stocks.map(s => [s.code, s.concepts ?? []])),
    [data.stocks],
  )

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  // 休市日不算「尚未更新」，是本來就不會有新資料——文字改成中性說明，不要暗示異常
  const isHolidayToday = holidayStatus?.date === todayStr && holidayStatus.isHoliday

  // 用前端 n 重新計算大盤訊號（後端 marketSignals.nDays 固定為 100，不隨使用者 N 更新）
  const computedSignals = useMemo<MarketSignals>(() => {
    const history = data.indexHistory ?? []
    const slice = history.slice(0, n) // newest first
    if (!slice.length) return data.marketSignals

    const todayBar = slice[0]
    const todayIndex = todayBar.close
    // 融資通常傍晚後才發布，白天使用時「今天」大多還沒有值——往前找最近一筆有資料的日期當作顯示值，
    // 而不是整天顯示「資料累積中」；todayMarginDate 讓前端能標示這是哪一天的數字，避免誤會成當天數字
    const marginBar = history.find(d => d.chips?.margin_amount != null)
    const todayMargin = marginBar?.chips?.margin_amount ?? null
    const todayMarginDate = marginBar?.date ?? null

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
      todayMarginDate,
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
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
            <a
              href="/review"
              className={`relative text-sm ${pendingCount > 0 ? 'text-amber-500 animate-pulse' : 'text-slate-300 hover:text-slate-500'}`}
              title={pendingCount > 0 ? `審核與維護（${pendingCount} 項待處理）` : '審核與維護'}
            >
              ⚙️
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-amber-500" />
              )}
            </a>
          </div>
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
                  {isHolidayToday
                    ? `今日休市${holidayStatus?.name ? `（${holidayStatus.name}）` : ''}，顯示最近交易日資料`
                    : `股價 ${data.stocksDate?.slice(5).replace('-', '/')} 待更新中`}
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
        {!loading && !error && <FreshnessBar data={data} holiday={holidayStatus} />}

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-36 rounded-xl bg-slate-200" />
            <div className="h-44 rounded-xl bg-slate-200" />
          </div>
        ) : (
          <>
            {activeTab === '大盤關鍵資料' && (
              <>
                <DailyBriefCard brief={data.dailyBrief} />
                <KlineChart data={data.indexHistory ?? []} n={n} />
                <MarketSignalCards signals={computedSignals} />
                <GlobalIndexLights indices={data.globalIndices} onSelect={setGlobalModalKey} />
              </>
            )}

            {activeTab === '個股清單' && (
              <StockTable rows={rows} onStockClick={setActiveStock} onConceptClick={handleConceptClick} />
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
        rowsByCode={rowsByCode}
        onStockClick={stock => { setActiveSector(null); setActiveStock(stock) }}
        onConceptClick={handleConceptClick}
      />
      <StockDetailSheet
        stock={activeStock}
        n={n}
        onClose={() => setActiveStock(null)}
        onConceptClick={handleConceptClick}
        instNet={activeStock ? instNetData.map[activeStock.code] ?? null : null}
        instNetDate={instNetData.date}
      />
      <GlobalIndexModal
        data={globalModalKey ? data.globalIndices?.[globalModalKey] ?? null : null}
        onClose={() => setGlobalModalKey(null)}
      />
    </div>
  )
}
