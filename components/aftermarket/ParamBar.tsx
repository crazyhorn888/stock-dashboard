'use client'
import { useState, useEffect } from 'react'

interface Props {
  n: number
  onChange: (n: number) => void
}

export default function ParamBar({ n, onChange }: Props) {
  const [draft, setDraft] = useState(String(n))

  useEffect(() => { setDraft(String(n)) }, [n])

  function commit(val: string) {
    const v = Math.min(250, Math.max(10, parseInt(val) || 100))
    setDraft(String(v))
    onChange(v)
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl mb-4">
      <span className="text-sm font-semibold text-blue-700 whitespace-nowrap">參考區間</span>
      <span className="text-sm text-slate-400">N =</span>
      <input
        type="number"
        min={10}
        max={250}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={e => { if (e.key === 'Enter') commit(draft) }}
        className="w-16 text-center font-bold text-sm bg-white border border-blue-300 rounded-lg px-2 py-1 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <span className="text-sm font-semibold text-blue-700">天</span>
      <span className="text-xs text-slate-400 hidden sm:inline">（影響距高 / 距低計算，範圍 10–250）</span>
    </div>
  )
}
