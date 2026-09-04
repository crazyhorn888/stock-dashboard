'use client'
import { useState, useEffect, useMemo } from 'react'
import type { StockRow, StockData } from '@/lib/types'
import ConceptTags from '@/components/shared/ConceptTags'
import { useWatchlist } from '@/lib/watchlist'
import { useStockFilter, CONSOLIDATION_FIELDS, BARS_FILTER_IDS, type FilterId } from '@/lib/stockFilter'
import { fetchOHLCSnapshot } from '@/lib/fetchStockOHLC'
import type { OHLCSnapshot } from '@/lib/types'

/**
 * 個股列表共用表格（2026-07-12）——個股清單（StockTable）與泡泡面板（SectorPanel）
 * 共用同一個元件：同欄位、同排序規則、同顯示格式，資料 refer 同一份 StockRow
 * （page.tsx 統一產生，法人欄位來自 day0 T86，見 lib/instNet）。
 *
 * 欄位：⭐ 代號 名稱 收盤 漲跌% 距N高▼% 距N低▲% P/E EPS 外資 投信 自營 合計 產業 概念
 * （2026-09-04 移除「視覺」欄——它只是把「距N高%」再畫一次長條，佔一整欄不划算）
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
  // 分組表頭的資料日期：股價與法人買賣超的發布時間差 4 小時，
  // 14:05~18:00 之間同一列會混到兩天的資料，用分組表頭標清楚（AC-DT-1）
  stocksDate?: string | null
  instNetDate?: string | null
}

function instCell(v: number | undefined | null) {
  if (v == null) return <span className="text-slate-300">—</span>
  return (
    <span className={`font-medium ${v > 0 ? 'text-red-500' : v < 0 ? 'text-green-600' : 'text-slate-400'}`}>
      {v > 0 ? '+' : ''}{v.toFixed(2)}
    </span>
  )
}

const fmtDate = (d: string) => d.slice(5).replace('-', '/').replace(/^0/, '')

export default function StockRowsTable({
  rows, onStockClick, onConceptClick,
  defaultSortKey = 'highDropPct', defaultAsc = true,
  wrapperClassName = 'overflow-x-auto rounded-xl border border-slate-200',
  wrapperStyle, stocksDate, instNetDate,
}: Props) {
  const { isWatched, toggle: toggleWatch } = useWatchlist()
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey)
  const [sortAsc, setSortAsc] = useState(defaultAsc)
  const [filterOpen, setFilterOpen] = useState(false)
  const filter = useStockFilter()

  // AC-CS-1／AC-VOL-2：整理平台與量能條件要吃 ohlc.json（1.4MB），勾選了才抓。
  // 抓失敗就把這兩個條件取消勾選，否則畫面會一直卡在「載入中、不套用」的狀態
  const [bars, setBars] = useState<OHLCSnapshot['bars'] | null>(null)
  const [barsLoading, setBarsLoading] = useState(false)
  const [barsError, setBarsError] = useState<string | null>(null)

  useEffect(() => {
    if (!filter.needsBars || bars || barsLoading) return
    setBarsLoading(true)
    setBarsError(null)
    fetchOHLCSnapshot()
      .then(snap => setBars(snap.bars))
      .catch(e => {
        setBarsError(e.message ?? '載入失敗')
        BARS_FILTER_IDS.forEach(id => { if (filter.state.enabled[id]) filter.toggle(id) })
      })
      .finally(() => setBarsLoading(false))
  }, [filter, bars, barsLoading])

  // 兩組資料日期不一致 = 法人那組還停在前一個交易日
  const stale = !!stocksDate && !!instNetDate && instNetDate < stocksDate
  // 資料格用比標題更淡的琥珀底：捲到下面也看得出這四欄不是今天的數字，但不搶掉數字本身的紅綠
  const instBg = stale ? 'bg-amber-50/40' : ''

  const filteredRows = useMemo(
    () => filter.filterRows(rows, bars ?? undefined),
    [filter, rows, bars],
  )

  const sorted = useMemo(() => {
    const val = (r: StockRow) => {
      const v = (r[sortKey] as number | null | undefined) ?? 0
      return ABS_KEYS.includes(sortKey) ? Math.abs(v) : v
    }
    return [...filteredRows].sort((a, b) => sortAsc ? val(a) - val(b) : val(b) - val(a))
  }, [filteredRows, sortKey, sortAsc])

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
      <StockFilterPanel
        open={filterOpen}
        onToggleOpen={() => setFilterOpen(o => !o)}
        filter={filter}
        matchedCount={filteredRows.length}
        barsLoading={barsLoading}
        barsError={barsError}
      />
      <table className="w-full text-xs border-collapse" style={{ minWidth: 760 }}>
        <thead>
          {/* AC-DT-1 分組表頭：把欄位分成「股價」與「法人買賣超」兩組，各自標資料日期。
              兩者發布時間差約 4 小時（股價 13:57、T86 18:00），下午看盤時同一列必然
              混到兩天的資料——與其每格加日期，不如在組層級標一次 */}
          {(stocksDate || instNetDate) && (
            <tr className="bg-slate-50 sticky top-0 z-10">
              <th colSpan={3} className="border-b border-slate-200" />
              <th colSpan={4} className="px-2 py-1 text-[10px] font-semibold text-slate-500 text-center border-b border-l border-slate-200 bg-blue-50/50">
                股價{stocksDate && <span className="text-slate-400 font-normal">　{fmtDate(stocksDate)}</span>}
              </th>
              <th colSpan={2} className="px-2 py-1 text-[10px] font-semibold text-slate-400 text-center border-b border-l border-slate-200">
                基本面
              </th>
              <th colSpan={4} className={`px-2 py-1 text-[10px] font-semibold text-center border-b border-l border-slate-200 ${
                stale ? 'text-amber-600 bg-amber-50/60' : 'text-slate-500 bg-slate-100/60'
              }`}>
                法人買賣超{instNetDate && <span className={`font-normal ${stale ? 'text-amber-500' : 'text-slate-400'}`}>　{fmtDate(instNetDate)}</span>}
              </th>
              <th colSpan={2} className="border-b border-l border-slate-200" />
            </tr>
          )}
          <tr className="border-b border-slate-200 bg-slate-50 sticky top-0">
            <th className="px-2 py-2 text-left text-xs font-semibold text-slate-400 whitespace-nowrap">⭐</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 whitespace-nowrap">代號</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400">名稱</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400">收盤</th>
            <th className={thCls('changePercent')} onClick={() => handleSort('changePercent')}>漲跌% {arrow('changePercent')}</th>
            <th className={thCls('highDropPct')} onClick={() => handleSort('highDropPct')}>距N高▼% {arrow('highDropPct')}</th>
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
          {rows.length === 0 ? (
            <tr><td colSpan={15} className="py-8 text-center text-slate-400">無個股資料</td></tr>
          ) : sorted.length === 0 ? (
            <tr><td colSpan={15} className="py-8 text-center text-slate-400">無符合條件的個股（{filter.activeCount} 個條件啟用中）</td></tr>
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
                <td className="px-3 py-2 text-red-500 font-medium">+{r.lowRisePct.toFixed(2)}%</td>
                <td className="px-3 py-2 text-slate-600">{r.pe?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.eps?.toFixed(2) ?? '—'}</td>
                <td className={`px-3 py-2 ${instBg}`}>{instCell(r.foreignNetBuy)}</td>
                <td className={`px-3 py-2 ${instBg}`}>{instCell(r.trustNet)}</td>
                <td className={`px-3 py-2 ${instBg}`}>{instCell(r.dealerNet)}</td>
                <td className={`px-3 py-2 ${instBg}`}>{instCell(r.instTotal)}</td>
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

// F1｜個股選股器面板（2026-07-16）——checkbox+數字/範圍輸入，收合展開；chips 在收合時也可見
// state/rows 都由 useStockFilter() 提供，localStorage 持久化＋跨元件同步（見 lib/stockFilter.ts）
interface FilterPanelProps {
  open: boolean
  onToggleOpen: () => void
  filter: ReturnType<typeof useStockFilter>
  matchedCount: number
  barsLoading: boolean
  barsError: string | null
}

function StockFilterPanel({ open, onToggleOpen, filter, matchedCount, barsLoading, barsError }: FilterPanelProps) {
  const { state, defs, toggle, setValue, setRange, reset, activeCount, setConsolidationParam } = filter
  const [advOpen, setAdvOpen] = useState(false)

  function symbol(id: FilterId) {
    const def = defs.find(d => d.id === id)!
    return def.kind === 'lt' ? '<' : def.kind === 'range' ? '~' : '>'
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onToggleOpen}
          className={`font-semibold whitespace-nowrap ${open ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
        >
          ⚙ 選股 {open ? '▲' : '▼'}
        </button>

        {activeCount > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1">
              {defs.filter(d => state.enabled[d.id]).map(d => (
                <span key={d.id} className="bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 text-blue-600 whitespace-nowrap">
                  {d.label}
                  {d.kind === 'pattern'
                    ? `（${state.consolidation.days}日）`
                    : d.kind === 'range'
                      ? `${state.min[d.id]}~${state.max[d.id]}${d.unit}`
                      : `${symbol(d.id)}${state.value[d.id]}${d.unit}`}
                </span>
              ))}
            </div>
            <span className="text-slate-400 whitespace-nowrap">篩選後 {matchedCount} 檔</span>
            {barsLoading && <span className="text-amber-500 whitespace-nowrap">K 線資料載入中…（尚未套用）</span>}
            {barsError && <span className="text-red-500 whitespace-nowrap">K 線資料載入失敗，已取消該條件</span>}
            <button onClick={reset} className="text-slate-400 hover:text-slate-600 underline whitespace-nowrap">一鍵清除</button>
          </>
        )}
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {defs.map(def => def.kind === 'pattern' ? (
            <div key={def.id} className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-slate-600">
                <input type="checkbox" checked={state.enabled[def.id]} onChange={() => toggle(def.id)} />
                <span className="w-24 shrink-0">{def.label}</span>
                <span className="text-[10px] text-slate-400">前幾日窄幅整理、量能平穩，當日放量或連兩日量遞增</span>
              </label>

              {state.enabled[def.id] && (
                <div className="ml-6 flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {CONSOLIDATION_FIELDS.filter(f => !f.advanced).map(f => (
                      <span key={f.key} className="flex items-center gap-1 text-slate-500">
                        <span className="text-[11px]">{f.label}</span>
                        <NumberField
                          value={state.consolidation[f.key]}
                          onCommit={v => setConsolidationParam(f.key, v)}
                        />
                        <span className="text-[11px]">{f.unit}</span>
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => setAdvOpen(o => !o)}
                    className="self-start text-[11px] text-blue-500 hover:text-blue-600"
                  >
                    進階參數 {advOpen ? '▲' : '▼'}
                  </button>
                  {advOpen && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {CONSOLIDATION_FIELDS.filter(f => f.advanced).map(f => (
                        <span key={f.key} className="flex items-center gap-1 text-slate-500">
                          <span className="text-[11px]">{f.label}</span>
                          <NumberField
                            value={state.consolidation[f.key]}
                            onCommit={v => setConsolidationParam(f.key, v)}
                          />
                          <span className="text-[11px]">{f.unit}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <label key={def.id} className="flex items-center gap-2 text-slate-600">
              <input
                type="checkbox"
                checked={state.enabled[def.id]}
                onChange={() => toggle(def.id)}
              />
              <span className="w-24 shrink-0">{def.label}</span>
              {def.kind === 'range' ? (
                <span className="flex items-center gap-1">
                  <NumberField
                    value={state.min[def.id]}
                    onCommit={v => setRange(def.id, v, state.max[def.id])}
                  />
                  <span>~</span>
                  <NumberField
                    value={state.max[def.id]}
                    onCommit={v => setRange(def.id, state.min[def.id], v)}
                  />
                  <span>{def.unit}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <span>{symbol(def.id)}</span>
                  <NumberField
                    value={state.value[def.id]}
                    onCommit={v => setValue(def.id, v)}
                  />
                  <span>{def.unit}</span>
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// 選股面板數字輸入——本地字串暫存，只有打出合法數字才回寫 filter state。
// 直接把 value={數字} 綁在 input 上會有兩個坑：(1) 清空成 "" 時 Number('')=0
// 導致 state 被打回 0；(2) 打 "-" 時 Number('-')=NaN，state 變 NaN 讓瀏覽器把欄位清空，
// 負號打了跟沒打一樣。兩者疊加會讓「刪除重打」跟「輸入負值」都不順。
// 用本地 text 暫存 + 只在合法數字時才 commit，未完成的中間態（"-"、"1."、""）留在畫面上不被打斷。
function NumberField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(() => String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (!/^-?\d*\.?\d*$/.test(raw)) return
    setText(raw)
    if (raw !== '' && raw !== '-' && raw !== '.' && raw !== '-.' && !Number.isNaN(Number(raw))) {
      onCommit(Number(raw))
    }
  }

  function handleBlur() {
    if (text === '' || text === '-' || text === '.' || text === '-.' || Number.isNaN(Number(text))) {
      setText(String(value))
    }
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-16 border border-slate-200 rounded px-1.5 py-0.5"
    />
  )
}
