'use client'
import { useState, useEffect, useCallback } from 'react'
import type { StockRow } from '@/lib/types'

// F1｜個股選股器（2026-07-16）——localStorage 持久化，個股清單與 SectorPanel 共用同一份設定
// 比照 lib/watchlist.ts 的 CustomEvent 同步模式
const KEY = 'stockFilter'
const EVENT = 'stockFilter-change'

export type FilterId = 'highDrop' | 'changeUp' | 'lowRise' | 'peRange' | 'instTotal'

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

type ConditionDef = ThresholdDef | RangeDef | LowRiseDef

export const CONDITION_DEFS: ConditionDef[] = [
  { id: 'highDrop', label: '距N高', kind: 'lt', field: 'highDropPct', unit: '%', defaultValue: -30 },
  { id: 'changeUp', label: '漲跌', kind: 'gt', field: 'changePercent', unit: '%', defaultValue: 5 },
  { id: 'lowRise', label: '距N低', kind: 'lt', field: 'lowRisePct', unit: '%', defaultValue: 100 },
  { id: 'peRange', label: 'P/E', kind: 'range', field: 'pe', unit: '', defaultMin: 0, defaultMax: 12 },
  { id: 'instTotal', label: '三大法人合計', kind: 'gt', field: 'instTotal', unit: '億', defaultValue: 0 },
]

interface FilterState {
  enabled: Record<FilterId, boolean>
  value: Record<FilterId, number>
  min: Record<FilterId, number>
  max: Record<FilterId, number>
}

function defaultState(): FilterState {
  const enabled = {} as Record<FilterId, boolean>
  const value = {} as Record<FilterId, number>
  const min = {} as Record<FilterId, number>
  const max = {} as Record<FilterId, number>
  for (const def of CONDITION_DEFS) {
    enabled[def.id] = false
    if (def.kind === 'range') { min[def.id] = def.defaultMin; max[def.id] = def.defaultMax }
    else value[def.id] = def.defaultValue
  }
  return { enabled, value, min, max }
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
    }
  } catch {
    return defaultState()
  }
}

function saveState(state: FilterState) {
  window.localStorage.setItem(KEY, JSON.stringify(state))
  window.dispatchEvent(new Event(EVENT))
}

function matches(def: ConditionDef, row: StockRow, state: FilterState): boolean {
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

  const filterRows = useCallback((rows: StockRow[]) => {
    const activeDefs = CONDITION_DEFS.filter(d => state.enabled[d.id])
    if (activeDefs.length === 0) return rows
    return rows.filter(r => activeDefs.every(def => matches(def, r, state)))
  }, [state])

  return { state, defs: CONDITION_DEFS, toggle, setValue, setRange, reset, activeCount, filterRows }
}
