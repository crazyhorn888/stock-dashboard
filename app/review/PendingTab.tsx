'use client'
import { useState, useEffect, useMemo } from 'react'
import ConceptPicker from '@/components/review/ConceptPicker'

interface PendingItem {
  code: string
  name: string
  activity?: number
  suggestedConcepts: string[]
}
interface PendingBatch {
  id: string
  createdAt: string
  items: PendingItem[]
}

type RowState = { concepts: string; skip: boolean }

export default function PendingTab({ password }: { password: string }) {
  const [batches, setBatches] = useState<PendingBatch[]>([])
  const [allConcepts, setAllConcepts] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})  // key: `${batchId}:${code}`
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [doneMsg, setDoneMsg] = useState<Record<string, string>>({})

  useEffect(() => {
    (async () => {
      const [pendingRes, conceptsRes] = await Promise.all([
        fetch('/api/review/pending', { headers: { 'x-review-password': password } }),
        fetch('/api/review/concepts', { headers: { 'x-review-password': password } }),
      ])
      const pending = await pendingRes.json()
      const concepts = await conceptsRes.json()
      setBatches(pending.batches ?? [])
      setAllConcepts(Object.keys(concepts.concepts ?? {}))
      const initRows: Record<string, RowState> = {}
      for (const b of pending.batches ?? []) {
        for (const it of b.items) {
          initRows[`${b.id}:${it.code}`] = { concepts: it.suggestedConcepts?.[0] ?? '', skip: false }
        }
      }
      setRows(initRows)
      setLoading(false)
    })()
  }, [password])

  const activeBatches = useMemo(() => batches.filter(b => b.items?.length > 0), [batches])

  async function confirmBatch(batch: PendingBatch) {
    setSubmitting(batch.id)
    const items = batch.items
      .map(it => ({ code: it.code, row: rows[`${batch.id}:${it.code}`] }))
      .filter(({ row }) => row && !row.skip && row.concepts.trim())
      .map(({ code, row }) => ({ code, concepts: [row.concepts.trim()] }))

    const res = await fetch('/api/review/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-review-password': password },
      body: JSON.stringify({ items, sourceBatchId: batch.id }),
    })
    const data = await res.json()
    setDoneMsg(m => ({ ...m, [batch.id]: data.ok ? '✅ 已送出，n8n 會在數分鐘內處理並寫入 git' : `❌ ${data.error ?? '失敗'}` }))
    setSubmitting(null)
  }

  if (loading) return <div className="text-xs text-slate-400 py-6 text-center">載入中...</div>
  if (activeBatches.length === 0) {
    return <div className="text-xs text-slate-400 py-10 text-center">目前沒有待審核的批次</div>
  }

  return (
    <div className="space-y-4">
      {activeBatches.map(batch => (
        <div key={batch.id} className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700">批次 {batch.createdAt.slice(0, 10)}</span>
            <span className="text-[10px] text-slate-400">{batch.items.length} 支個股</span>
          </div>
          <div className="space-y-2">
            {batch.items.map(it => {
              const key = `${batch.id}:${it.code}`
              const row = rows[key] ?? { concepts: '', skip: false }
              return (
                <div key={it.code} className="flex items-center gap-2 text-xs">
                  <span className="w-32 flex-shrink-0 text-slate-600">{it.code} {it.name}</span>
                  <ConceptPicker
                    concepts={allConcepts}
                    value={row.concepts}
                    onChange={v => setRows(r => ({ ...r, [key]: { ...row, concepts: v } }))}
                  />
                  <label className="flex items-center gap-1 text-[10px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={row.skip}
                      onChange={e => setRows(r => ({ ...r, [key]: { ...row, skip: e.target.checked } }))}
                    />
                    跳過
                  </label>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => confirmBatch(batch)}
              disabled={submitting === batch.id}
              className="bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {submitting === batch.id ? '送出中...' : '確認並寫入'}
            </button>
            {doneMsg[batch.id] && <span className="text-[11px] text-slate-500">{doneMsg[batch.id]}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
