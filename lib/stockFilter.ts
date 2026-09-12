'use client'
import { useState, useEffect, useCallback } from 'react'
import type { StockRow, OHLCSnapshot, InstCostSnapshot, HoldersSnapshot } from '@/lib/types'
import { holdersOf, isHolderMove, isWideMove, deltaPp } from '@/lib/fetchHolders'
import { matchConsolidation, CONSOLIDATION_DEFAULTS, type ConsolidationParams } from '@/lib/consolidationPattern'
import { costOf, gapToCost, windowForN } from '@/lib/fetchInstCost'

// F1｜個股選股器（2026-07-16）——localStorage 持久化，個股清單與 SectorPanel 共用同一份設定
// 比照 lib/watchlist.ts 的 CustomEvent 同步模式
const KEY = 'stockFilter'
const EVENT = 'stockFilter-change'

export type FilterId = 'highDrop' | 'changeUp' | 'lowRise' | 'peRange' | 'instTotal' | 'volume' | 'consolidation' | 'belowInstCost'
  | 'holderH' | 'holderK' | 'holderMove'

// 需要 K 線/量能資料（ohlc.json）的條件，勾選任一才會 lazy fetch（AC-CS-1、AC-VOL-2）
export const BARS_FILTER_IDS: FilterId[] = ['volume', 'consolidation']

interface ThresholdDef {
  id: FilterId
  label: string
  kind: 'lt' | 'gt'
  field: 'highDropPct' | 'changePercent' | 'instTotal'
  unit: string
  defaultValue: number
}

interface RangeDef {
  id: FilterId
  label: string
  kind: 'range'
  field: 'pe'
  unit: string
  defaultMin: number
  defaultMax: number
}

// lowRise 是 lt 但欄位是 lowRisePct（正值），單獨列避免 union 收斂成 never
interface LowRiseDef {
  id: 'lowRise'
  label: string
  kind: 'lt'
  field: 'lowRisePct'
  unit: string
  defaultValue: number
}

// AC-VOL-1：當日量能（張），資料來自 ohlc.json 不是 StockRow 欄位
interface BarsGtDef {
  id: 'volume'
  label: string
  kind: 'bars-gt'
  unit: string
  defaultValue: number
}

// AC-CS-3：整理平台形態，多參數，判斷邏輯在 lib/consolidationPattern.ts
interface PatternDef {
  id: 'consolidation'
  label: string
  kind: 'pattern'
}

// AC-IC-3（2026-09-08 修訂）：低於法人成本。資料來自 inst-cost.json 不是 StockRow 欄位；
// 窗口跟著頁面 N 走（windowForN）。門檻語意是「折價幅度 ≥ X%」，X 為正值＝比成本便宜幾 %，
// 預設 0 = 只要低於成本。反轉自舊版的「距成本 ≤ X%」——舊版有意義的範圍是 0～−10，
// 但 iOS 的數字鍵盤沒有負號鍵，那在手機上是一條打不出來的條件。
interface InstCostDef {
  id: 'belowInstCost'
  label: string
  kind: 'inst-cost-gte'
  unit: string
  defaultValue: number
}

// AC-HF-1：集保大戶週增加 ≥ X pp。資料來自 holders.json 不是 StockRow 欄位
interface HoldersGteDef {
  id: 'holderH' | 'holderK'
  label: string
  kind: 'holders-gte'
  field: 'dh' | 'dk'
  unit: string
  defaultValue: number
}

// AC-HF-1／AC-HF-4：籌碼異動。value 存的是 Z 門檻（不是比較值），
// 而且這個門檻同時決定清單上的圓點要不要出現——所以沒勾選時也要有值
interface HolderMoveDef {
  id: 'holderMove'
  label: string
  kind: 'holder-move'
  unit: string
  defaultValue: number
  min: number
  max: number
}

type ConditionDef = ThresholdDef | RangeDef | LowRiseDef | BarsGtDef | PatternDef | InstCostDef
  | HoldersGteDef | HolderMoveDef

export const CONDITION_DEFS: ConditionDef[] = [
  { id: 'highDrop', label: '距N高', kind: 'lt', field: 'highDropPct', unit: '%', defaultValue: -30 },
  { id: 'changeUp', label: '漲跌', kind: 'gt', field: 'changePercent', unit: '%', defaultValue: 5 },
  { id: 'lowRise', label: '距N低', kind: 'lt', field: 'lowRisePct', unit: '%', defaultValue: 100 },
  { id: 'peRange', label: 'P/E', kind: 'range', field: 'pe', unit: '', defaultMin: 0, defaultMax: 12 },
  { id: 'instTotal', label: '三大法人合計', kind: 'gt', field: 'instTotal', unit: '億', defaultValue: 0 },
  { id: 'volume', label: '當日量能', kind: 'bars-gt', unit: '張', defaultValue: 1000 },
  { id: 'consolidation', label: '整理平台', kind: 'pattern' },
  { id: 'belowInstCost', label: '低於法人成本', kind: 'inst-cost-gte', unit: '%', defaultValue: 0 },
  { id: 'holderH', label: '百張大戶增加', kind: 'holders-gte', field: 'dh', unit: 'pp', defaultValue: 0.5 },
  { id: 'holderK', label: '千張大戶增加', kind: 'holders-gte', field: 'dk', unit: 'pp', defaultValue: 0.5 },
  { id: 'holderMove', label: '籌碼異動 Z≥', kind: 'holder-move', unit: '', defaultValue: 5, min: 3, max: 8 },
]

// ConsolidationParams 的數字欄位／布林欄位（型別上分開，兩種 UI 控件不共用 setter）
export type ConsolidationNumKey = {
  [K in keyof ConsolidationParams]: ConsolidationParams[K] extends number ? K : never
}[keyof ConsolidationParams]
export type ConsolidationBoolKey = {
  [K in keyof ConsolidationParams]: ConsolidationParams[K] extends boolean ? K : never
}[keyof ConsolidationParams]

// 整理平台的可調參數（基本常駐、進階收合，AC-CS-6）
export const CONSOLIDATION_FIELDS: {
  key: ConsolidationNumKey; label: string; unit: string; advanced: boolean
}[] = [
  { key: 'days',       label: '整理期',        unit: '日', advanced: false },
  { key: 'minVolHigh', label: '≥1000元 均量',  unit: '張', advanced: false },
  { key: 'minVolMid',  label: '100-1000元 均量', unit: '張', advanced: false },
  { key: 'minVolLow',  label: '<100元 均量',   unit: '張', advanced: false },
  { key: 'rangePct',   label: '區間上限',      unit: '%',  advanced: true },
  { key: 'dayPct',     label: '日振幅上限',    unit: '%',  advanced: true },
  { key: 'minCross',   label: '穿越均價',      unit: '次', advanced: true },
  { key: 'volSpike',   label: '期間爆量上限',  unit: '倍', advanced: true },
  { key: 'todayMult',  label: '當日爆量',      unit: '倍', advanced: true },
  { key: 'breakPct',   label: '突破幅度',      unit: '%',  advanced: true },
]

// 勾選型參數（AC-CS-11），與數字欄位分開渲染
export const CONSOLIDATION_FLAGS: {
  key: ConsolidationBoolKey; label: string; hint: string
}[] = [
  { key: 'excludeEtf', label: '排除 ETF', hint: '代號 00 開頭，天生窄幅' },
]

interface FilterState {
  enabled: Record<FilterId, boolean>
  value: Record<FilterId, number>
  min: Record<FilterId, number>
  max: Record<FilterId, number>
  consolidation: ConsolidationParams
  /** AC-IC-3a：belowInstCost 的語意版本。2 = 折價幅度（正值）；缺值或 1 = 舊的距成本（負值） */
  icv: number
  /** AC-HF-1：籌碼異動再收斂成「同週個股期貨也異動」 */
  holderWide: boolean
}

const ICV_CURRENT = 2

function defaultState(): FilterState {
  const enabled = {} as Record<FilterId, boolean>
  const value = {} as Record<FilterId, number>
  const min = {} as Record<FilterId, number>
  const max = {} as Record<FilterId, number>
  for (const def of CONDITION_DEFS) {
    enabled[def.id] = false
    if (def.kind === 'range') { min[def.id] = def.defaultMin; max[def.id] = def.defaultMax }
    else if (def.kind !== 'pattern') value[def.id] = def.defaultValue
  }
  return { enabled, value, min, max, consolidation: { ...CONSOLIDATION_DEFAULTS }, icv: ICV_CURRENT, holderWide: false }
}

function getState(): FilterState {
  if (typeof window === 'undefined') return defaultState()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    const base = defaultState()
    const value = { ...base.value, ...parsed.value }
    // AC-IC-3a：舊版存的是「距成本 ≤ X%」的負值，新版是「折價幅度 ≥ X%」的正值。
    // 取絕對值即為對應的新值（舊 −5 → 新 5）。只轉一次，之後使用者刻意輸入的負值不再被翻。
    if (parsed.icv !== ICV_CURRENT) value.belowInstCost = Math.abs(value.belowInstCost)
    return {
      enabled: { ...base.enabled, ...parsed.enabled },
      value,
      min: { ...base.min, ...parsed.min },
      max: { ...base.max, ...parsed.max },
      consolidation: { ...base.consolidation, ...parsed.consolidation },
      icv: ICV_CURRENT,
      holderWide: !!parsed.holderWide,
    }
  } catch {
    return defaultState()
  }
}

function saveState(state: FilterState) {
  window.localStorage.setItem(KEY, JSON.stringify(state))
  window.dispatchEvent(new Event(EVENT))
}

function matches(
  def: ConditionDef,
  row: StockRow,
  state: FilterState,
  bars?: OHLCSnapshot['bars'],
  instCost?: InstCostSnapshot | null,
  nDays = 100,
  holders?: HoldersSnapshot | null,
): boolean {
  // AC-HF-1：集保大戶週增加 ≥ X pp。股本事件週的 Δ 是 null（AC-HZ-3），
  // 缺值一律不符合，不當 0
  if (def.kind === 'holders-gte') {
    const d = deltaPp(holdersOf(holders ?? null, row.code), def.field)
    return d != null && d >= state.value[def.id]
  }
  // AC-HF-1／AC-HF-4：籌碼異動；勾了 holderWide 就再要求同週期貨也異動
  if (def.kind === 'holder-move') {
    const e = holdersOf(holders ?? null, row.code)
    const th = state.value[def.id]
    return state.holderWide ? isWideMove(e, th) : isHolderMove(e, th)
  }
  // AC-IC-3：折價幅度 ≥ 門檻（折價幅度 ＝ −距成本%，正值代表比成本便宜）。
  // 窗口跟著頁面 N；成本缺值視為不符合，不當 0
  if (def.kind === 'inst-cost-gte') {
    const c = costOf(instCost ?? null, row.code, windowForN(nDays))
    const gap = gapToCost(row.close, c)
    return gap != null && -gap >= state.value[def.id]
  }
  // 需要 K 線的兩個條件：資料沒到齊就視為不符合（缺值不當 0）
  if (def.kind === 'pattern') {
    return !!matchConsolidation(row.code, row.closes, bars?.[row.code], row.close, state.consolidation)
  }
  if (def.kind === 'bars-gt') {
    const todayVol = bars?.[row.code]?.v?.[0]
    return todayVol != null && todayVol > state.value[def.id]
  }

  const v = row[def.field] as number | null | undefined
  if (v == null) return false // 缺值一律視為不符合排除，不當 0
  if (def.kind === 'range') return v >= state.min[def.id] && v <= state.max[def.id]
  if (def.kind === 'lt') return v < state.value[def.id]
  return v > state.value[def.id]
}

export function useStockFilter() {
  const [state, setStateLocal] = useState<FilterState>(defaultState)

  useEffect(() => {
    setStateLocal(getState())
    const onChange = () => setStateLocal(getState())
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const toggle = useCallback((id: FilterId) => {
    const next = getState()
    next.enabled[id] = !next.enabled[id]
    saveState(next)
    setStateLocal(next)
  }, [])

  const setValue = useCallback((id: FilterId, v: number) => {
    const next = getState()
    next.value[id] = v
    saveState(next)
    setStateLocal(next)
  }, [])

  const setRange = useCallback((id: FilterId, min: number, max: number) => {
    const next = getState()
    next.min[id] = min
    next.max[id] = max
    saveState(next)
    setStateLocal(next)
  }, [])

  const toggleHolderWide = useCallback(() => {
    const next = getState()
    next.holderWide = !next.holderWide
    saveState(next)
    setStateLocal(next)
  }, [])

  const reset = useCallback(() => {
    const next = defaultState()
    saveState(next)
    setStateLocal(next)
  }, [])

  const activeCount = CONDITION_DEFS.filter(d => state.enabled[d.id]).length

  const setConsolidationParam = useCallback((key: ConsolidationNumKey, v: number) => {
    const next = getState()
    next.consolidation = { ...next.consolidation, [key]: v }
    saveState(next)
    setStateLocal(next)
  }, [])

  const toggleConsolidationFlag = useCallback((key: ConsolidationBoolKey) => {
    const next = getState()
    next.consolidation = { ...next.consolidation, [key]: !next.consolidation[key] }
    saveState(next)
    setStateLocal(next)
  }, [])

  // 有勾選需要 ohlc.json 的條件 → 外層要先把 bars 抓下來再傳進 filterRows
  const needsBars = BARS_FILTER_IDS.some(id => state.enabled[id])

  const filterRows = useCallback((
    rows: StockRow[],
    bars?: OHLCSnapshot['bars'],
    instCost?: InstCostSnapshot | null,
    nDays = 100,
    holders?: HoldersSnapshot | null,
  ) => {
    const activeDefs = CONDITION_DEFS.filter(d => state.enabled[d.id])
    if (activeDefs.length === 0) return rows
    // AC-CS-1：K 線資料還沒到齊就先不套用，避免整張表瞬間清空
    if (BARS_FILTER_IDS.some(id => state.enabled[id]) && !bars) return rows
    // AC-IC-3：同理，法人成本還沒載入前不套用
    if (state.enabled.belowInstCost && !instCost) return rows
    // 集保三條件同理：holders.json 還沒到齊就先不套用，避免整張表瞬間清空
    if ((state.enabled.holderH || state.enabled.holderK || state.enabled.holderMove) && !holders) return rows
    return rows.filter(r => activeDefs.every(def => matches(def, r, state, bars, instCost, nDays, holders)))
  }, [state])

  return {
    state, defs: CONDITION_DEFS, toggle, setValue, setRange, reset, activeCount,
    filterRows, needsBars, setConsolidationParam, toggleConsolidationFlag, toggleHolderWide,
  }
}
