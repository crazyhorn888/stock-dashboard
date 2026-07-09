'use client'
import { useState, useEffect, useCallback } from 'react'

const KEY = 'watchlist'
const EVENT = 'watchlist-change'

export function getWatchlist(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function setWatchlist(codes: string[]) {
  window.localStorage.setItem(KEY, JSON.stringify(codes))
  window.dispatchEvent(new Event(EVENT))
}

export function toggleWatchlist(code: string): string[] {
  const list = getWatchlist()
  const next = list.includes(code) ? list.filter(c => c !== code) : [...list, code]
  setWatchlist(next)
  return next
}

// P2-5：觀察清單 hook，localStorage 免登入；同分頁內跨元件（StockTable/StockDetailSheet/page）
// 用 CustomEvent 同步，另分頁改動用瀏覽器內建 storage 事件同步
export function useWatchlist() {
  const [codes, setCodes] = useState<string[]>([])

  useEffect(() => {
    setCodes(getWatchlist())
    const onChange = () => setCodes(getWatchlist())
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const toggle = useCallback((code: string) => setCodes(toggleWatchlist(code)), [])
  const isWatched = useCallback((code: string) => codes.includes(code), [codes])

  return { codes, toggle, isWatched }
}
