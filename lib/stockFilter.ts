'use client'
import { useState, useEffect, useCallback } from 'react'
import type { StockRow, OHLCSnapshot, InstCostSnapshot } from '@/lib/types'
import { matchConsolidation, CONSOLIDATION_DEFAULTS, type ConsolidationParams } from '@/lib/consolidationPattern'
import { costOf, gapToCost, windowForN } from '@/lib/fetchInstCost'

// F1｜個股選股器（2026-07-16）——localStorage 持久化，個股清單與 SectorPanel 共用同一份設定
// 比照 lib/watchlist.ts 的 CustomEvent 同步模式
const KEY = 'stockFilter'
const EVENT = 'stockFilter-change'

export type FilterId = 'highDrop' | 'changeUp' | 'lowRise' | 'peRange' | 'instTotal' | 'volume' | 'consolidation' | 'belowInstCost'

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

// AC-IC-3：低於法人成本。資料來自 inst-cost.json 不是 StockRow 欄位；
// 窗口跟著頁面 N 走（windowForN），門檻是「距成本 ≤ X%」，預設 0 = 只要低於成本
interface InstCostDef {
  id: 'belowInstCost'
  label: string
  kind: 'inst-cost-lt'
  unit: string
  defaultValue: number
}

type ConditionDef = ThresholdDef | RangeDef | LowRiseDef | BarsGtDef | PatternDef | InstCostDef

export const CONDITION_DEFS: ConditionDef[] = [
  { id: 'highDrop', label: '距N高', kind: 'lt', field: 'highDropPct', unit: '%', defaultValue: -30 },
  { id: 'changeUp', label: '漲跌', kind: 'gt', field: 'changePercent', unit: '%', defaultValue: 5 },
  { id: 'lowRise', label: '距N低', kind: 'lt', field: 'lowRisePct', unit: '%', defaultValue: 100 },
  { id: 'peRange', label: 'P/E', kind: 'range', field: 'pe', unit: '', defaultMin: 0, defaultMax: 12 },
  { id: 'instTotal', label: '三大法人合計', kind: 'gt', field: 'instTotal', unit: '億', defaultValue: 0 },
  { id: 'volume', label: '當日量能', kind: 'bars-gt', unit: '張', defaultValue: 1000 },
  { id: 'consolidation', label: '整理平台', kind: 'pattern' },
  { id: 'belowInstCost', label: '低於法人成本', kind: 'inst-cost-lt', unit: '%', defaultValue: 0 },
]

// 整理平台的可調參數（基本常駐、進階收合，AC-CS-6）
export const CONSOLIDATION_FIELDS: {
  key: keyof ConsolidationParams; label: string; unit: string; advanced: boolean
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
]

interface FilterState {
  enabled: Record<FilterId, boolean>
  value: Record<FilterId, number>
  min: Record<FilterId, number>
  max: Record<FilterId, number>
  consolidation: ConsolidationParams
}

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
  return { enabled, value, min, max, consolidation: { ...CONSOLIDATION_DEFAULTS } }
}

function getState(): FilterState {
  if (typeof window === 'undefined') return defaultState()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    const base = defaultState()
    return {
      enabled: { ...base.enabled, ...parsed.enabled },
      value: { ...base.value, ...parsed.value },
      min: { ...base.min, ...parsed.min },
      max: { ...base.max, ...parsed.max },
      consolidation: { ...base.consolidation, ...parsed.consolidation },
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
): boolean {
  // AC-IC-3：距成本 ≤ 門檻。窗口跟著頁面 N；成本缺值視為不符合，不當 0
  if (def.kind === 'inst-cost-lt') {
    const c = costOf(instCost ?? null, row.code, windowForN(nDays))
    const gap = gapToCost(row.close, c)
    return gap != null && gap <= state.value[def.id]
  }
  // 需要 K 線的兩個條件：資料沒到齊就視為不符合（缺值不當 0）
  if (def.kind === 'pattern') {
    return !!matchConsolidation(row.closes, bars?.[row.code], row.close, state.consolidation)
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

  const reset = useCallback(() => {
    const next = defaultState()
    saveState(next)
    setStateLocal(next)
  }, [])

  const activeCount = CONDITION_DEFS.filter(d => state.enabled[d.id]).length

  const setConsolidationParam = useCallback((key: keyof ConsolidationParams, v: number) => {
    const next = getState()
    next.consolidation = { ...next.consolidation, [key]: v }
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
  ) => {
    const activeDefs = CONDITION_DEFS.filter(d => state.enabled[d.id])
    if (activeDefs.length === 0) return rows
    // AC-CS-1：K 線資料還沒到齊就先不套用，避免整張表瞬間清空
    if (BARS_FILTER_IDS.some(id => state.enabled[id]) && !bars) return rows
    // AC-IC-3：同理，法人成本還沒載入前不套用
    if (state.enabled.belowInstCost && !instCost) return rows
    return rows.filter(r => activeDefs.every(def => matches(def, r, state, bars, instCost, nDays)))
  }, [state])

  return {
    state, defs: CONDITION_DEFS, toggle, setValue, setRange, reset, activeCount,
    filterRows, needsBars, setConsolidationParam,
  }
}
