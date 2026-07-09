'use client'
import { useState, useMemo, useRef, useEffect } from 'react'

interface Props {
  concepts: string[]   // 所有既有概念名稱，供搜尋
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

// P2-6：可搜尋的概念選單。輸入關鍵字過濾既有 100+ 概念；打的字不在清單裡則當作新概念名稱
export default function ConceptPicker({ concepts, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setQuery(value), [value])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const filtered = useMemo(() => {
    if (!query) return concepts.slice(0, 30)
    return concepts.filter(c => c.includes(query)).slice(0, 30)
  }, [concepts, query])

  const isNew = !!query && !concepts.includes(query)

  function select(v: string) {
    onChange(v)
    setQuery(v)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative inline-block">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? '搜尋或輸入新概念'}
        className="border border-slate-300 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:border-blue-400"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-56 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
          {filtered.map(c => (
            <button
              key={c}
              onClick={() => select(c)}
              className="block w-full text-left px-2 py-1 text-xs hover:bg-blue-50 text-slate-700"
            >
              {c}
            </button>
          ))}
          {isNew && (
            <button
              onClick={() => select(query)}
              className="block w-full text-left px-2 py-1 text-xs text-blue-600 border-t border-slate-100"
            >
              ➕ 新增概念「{query}」
            </button>
          )}
          {filtered.length === 0 && !isNew && (
            <div className="px-2 py-1 text-xs text-slate-400">沒有符合的概念</div>
          )}
        </div>
      )}
    </div>
  )
}
