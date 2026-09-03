'use client'
import { useState, useEffect, useCallback } from 'react'

// 參考區間 N（天）——盤後行情與市場條件兩頁共用同一個值。
// 2026-09-03 事故：N 原本是 /aftermarket 元件內的 useState，換頁就回到預設 100，
// 市場條件頁永遠用後端固定的 100 天算，改 N 完全不會反映過去。
// 比照 lib/watchlist.ts / lib/stockFilter.ts：localStorage 持久化 + CustomEvent 同分頁同步。
const KEY = 'nDays'
const EVENT = 'nDays-change'

export const N_MIN = 10
export const N_MAX = 250
export const N_DEFAULT = 100

export function clampN(v: number): number {
  if (!Number.isFinite(v)) return N_DEFAULT
  return Math.min(N_MAX, Math.max(N_MIN, Math.round(v)))
}

function readN(): number {
  if (typeof window === 'undefined') return N_DEFAULT
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? clampN(Number(raw)) : N_DEFAULT
  } catch {
    return N_DEFAULT
  }
}

export function useNDays() {
  // SSR/首次渲染一律用預設值，避免 hydration mismatch；掛載後才讀 localStorage
  const [n, setNLocal] = useState(N_DEFAULT)

  useEffect(() => {
    setNLocal(readN())
    const onChange = () => setNLocal(readN())
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const setN = useCallback((v: number) => {
    const next = clampN(v)
    try { window.localStorage.setItem(KEY, String(next)) } catch { /* 私密模式等寫入失敗時只影響持久化 */ }
    window.dispatchEvent(new Event(EVENT))
    setNLocal(next)
    return next
  }, [])

  return { n, setN }
}
