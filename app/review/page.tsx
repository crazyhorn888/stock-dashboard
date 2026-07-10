'use client'
import { useState, useEffect, useCallback } from 'react'
import PendingTab from './PendingTab'
import EditTab from './EditTab'
import DailyBriefCard from '@/components/aftermarket/DailyBriefCard'
import type { DailyBriefFacts } from '@/lib/types'

const STORAGE_KEY = 'review_password'

export default function ReviewPage() {
  const [checking, setChecking] = useState(true)
  const [passwordSet, setPasswordSet] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'pending' | 'edit'>('pending')
  const [brief, setBrief] = useState<DailyBriefFacts | undefined>()
  const [forceRunState, setForceRunState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [forceRunMsg, setForceRunMsg] = useState('')

  const password = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) ?? '' : ''

  const tryAuth = useCallback(async (pw: string) => {
    const res = await fetch('/api/review/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    const data = await res.json()
    return !!data.ok
  }, [])

  useEffect(() => {
    (async () => {
      const setRes = await fetch('/api/review/auth')
      const { passwordSet: ps } = await setRes.json()
      setPasswordSet(ps)
      if (ps && password) {
        const ok = await tryAuth(password)
        setAuthed(ok)
      }
      setChecking(false)
    })()
  }, [password, tryAuth])

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL?.replace('latest.json', 'market.json')
    if (!url) return
    fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(d => setBrief(d?.dailyBrief)).catch(() => {})
  }, [])

  async function handleSetInitial() {
    setError('')
    const res = await fetch('/api/review/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: pwInput }),
    })
    const data = await res.json()
    if (data.ok) {
      localStorage.setItem(STORAGE_KEY, pwInput)
      setPasswordSet(true)
      setAuthed(true)
    } else {
      setError(data.error ?? '設定失敗')
    }
  }

  async function handleForceRun() {
    setForceRunState('loading')
    setForceRunMsg('')
    try {
      const res = await fetch('/api/review/force-run', {
        method: 'POST',
        headers: { 'x-review-password': password },
      })
      const data = await res.json()
      if (data.ok) {
        setForceRunState('ok')
        setForceRunMsg('已觸發，約 1-2 分鐘後可到 GitHub Actions 查看結果')
      } else {
        setForceRunState('error')
        setForceRunMsg(data.error ?? '觸發失敗')
      }
    } catch (e) {
      setForceRunState('error')
      setForceRunMsg(e instanceof Error ? e.message : '觸發失敗')
    }
  }

  async function handleLogin() {
    setError('')
    const ok = await tryAuth(pwInput)
    if (ok) {
      localStorage.setItem(STORAGE_KEY, pwInput)
      setAuthed(true)
    } else {
      setError('密碼錯誤')
    }
  }

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">載入中...</div>
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-xs">
          <h1 className="text-base font-bold text-slate-800 mb-1">
            {passwordSet ? '🔒 輸入密碼' : '🔒 設定密碼（第一次使用）'}
          </h1>
          <p className="text-[11px] text-slate-400 mb-3">
            {passwordSet ? '概念分類審核頁面' : '請設定一組通關密碼，之後每次進來都需要輸入'}
          </p>
          <input
            type="password"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (passwordSet ? handleLogin() : handleSetInitial())}
            placeholder="密碼"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-2"
          />
          {error && <p className="text-[11px] text-red-500 mb-2">{error}</p>}
          <button
            onClick={passwordSet ? handleLogin : handleSetInitial}
            className="w-full bg-blue-600 text-white rounded py-2 text-sm font-semibold"
          >
            {passwordSet ? '進入' : '設定並進入'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="max-w-screen-md mx-auto px-3 py-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-slate-800">📋 審核與維護</h1>
          <button
            onClick={handleForceRun}
            disabled={forceRunState === 'loading'}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-slate-300 text-slate-500 hover:border-slate-400 disabled:opacity-50"
            title="略過開盤限制，立刻觸發一次完整 pipeline（GitHub Actions，不會有本機 iCloud 干擾的風險）"
          >
            {forceRunState === 'loading' ? '觸發中…' : '⚡ 強制執行 Pipeline'}
          </button>
        </div>
        {forceRunMsg && (
          <p className={`text-[11px] mb-3 ${forceRunState === 'ok' ? 'text-blue-600' : 'text-red-500'}`}>
            {forceRunMsg}
          </p>
        )}

        <DailyBriefCard brief={brief} />

        <div className="flex gap-1.5 mb-3">
          {([['pending', '待審核'], ['edit', '瀏覽/編輯既有分類']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={[
                'px-3 py-1.5 rounded-md text-xs font-semibold border',
                tab === v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'pending' ? <PendingTab password={password} /> : <EditTab password={password} />}

        <div className="mt-6 pt-4 border-t border-slate-200">
          <ChangePassword password={password} onChanged={p => localStorage.setItem(STORAGE_KEY, p)} />
        </div>
      </main>
    </div>
  )
}

function ChangePassword({ password, onChanged }: { password: string; onChanged: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [msg, setMsg] = useState('')

  async function submit() {
    setMsg('')
    const res = await fetch('/api/review/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
    })
    const data = await res.json()
    if (data.ok) {
      onChanged(newPw)
      setMsg('✅ 已更新')
      setOldPw(''); setNewPw('')
    } else {
      setMsg(`❌ ${data.error ?? '失敗'}`)
    }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="text-[11px] text-slate-400 underline">更換密碼</button>
  }
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 max-w-xs">
      <input type="password" placeholder="舊密碼" value={oldPw} onChange={e => setOldPw(e.target.value)}
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs mb-2" />
      <input type="password" placeholder="新密碼（至少4碼）" value={newPw} onChange={e => setNewPw(e.target.value)}
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs mb-2" />
      {msg && <p className="text-[11px] mb-2">{msg}</p>}
      <button onClick={submit} className="bg-slate-800 text-white rounded px-3 py-1 text-xs">更新密碼</button>
    </div>
  )
}
