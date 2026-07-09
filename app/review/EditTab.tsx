'use client'
import { useState, useEffect, useMemo } from 'react'
import ConceptPicker from '@/components/review/ConceptPicker'

interface ConceptData {
  concepts: Record<string, { desc: string }>
  stocks: Record<string, string[]>
}

export default function EditTab({ password }: { password: string }) {
  const [data, setData] = useState<ConceptData | null>(null)
  const [query, setQuery] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [editConcepts, setEditConcepts] = useState<string[]>([])
  const [addValue, setAddValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/review/concepts', { headers: { 'x-review-password': password } })
      .then(r => r.json())
      .then(setData)
  }, [password])

  const allConcepts = useMemo(() => Object.keys(data?.concepts ?? {}), [data])

  const matches = useMemo(() => {
    if (!data || !query) return []
    const q = query.trim()
    return Object.entries(data.stocks)
      .filter(([code]) => code.includes(q))
      .slice(0, 20)
      .map(([code, concepts]) => ({ code, concepts }))
  }, [data, query])

  function selectStock(code: string, concepts: string[]) {
    setSelectedCode(code)
    setEditConcepts(concepts)
    setMsg('')
  }

  function removeConcept(c: string) {
    setEditConcepts(cs => cs.filter(x => x !== c))
  }

  function addConcept() {
    if (addValue.trim() && !editConcepts.includes(addValue.trim())) {
      setEditConcepts(cs => [...cs, addValue.trim()])
      setAddValue('')
    }
  }

  async function save() {
    if (!selectedCode) return
    setSaving(true)
    const res = await fetch('/api/review/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-review-password': password },
      body: JSON.stringify({ items: [{ code: selectedCode, concepts: editConcepts }] }),
    })
    const d = await res.json()
    setMsg(d.ok ? '✅ 已送出，n8n 會在數分鐘內處理並寫入 git' : `❌ ${d.error ?? '失敗'}`)
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="輸入股票代號搜尋（例如 2330）"
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-2"
      />

      {query && (
        <div className="space-y-1 mb-3">
          {matches.map(m => (
            <button
              key={m.code}
              onClick={() => selectStock(m.code, m.concepts)}
              className="block w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-50 border border-slate-100"
            >
              {m.code}　{m.concepts.join('、') || '（無分類）'}
            </button>
          ))}
          {matches.length === 0 && <p className="text-[11px] text-slate-400">沒有符合的股票代號</p>}
        </div>
      )}

      {selectedCode && (
        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs font-bold text-slate-700 mb-2">{selectedCode} 目前概念：</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {editConcepts.map(c => (
              <span key={c} className="bg-blue-50 border border-blue-200 rounded px-2 py-0.5 text-[11px] text-blue-600">
                {c} <button onClick={() => removeConcept(c)} className="ml-1 text-blue-400">✕</button>
              </span>
            ))}
            {editConcepts.length === 0 && <span className="text-[11px] text-slate-400">（無）</span>}
          </div>
          <div className="flex items-center gap-2 mb-3">
            <ConceptPicker concepts={allConcepts} value={addValue} onChange={setAddValue} placeholder="新增概念" />
            <button onClick={addConcept} className="text-xs bg-slate-100 rounded px-2 py-1">加入</button>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {saving ? '儲存中...' : '儲存變更'}
          </button>
          {msg && <span className="ml-2 text-[11px] text-slate-500">{msg}</span>}
        </div>
      )}
    </div>
  )
}
