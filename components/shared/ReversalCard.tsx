'use client'
import { useState } from 'react'
import type { ReversalSignal } from '@/lib/reversalSignals'

/**
 * 反轉訊號卡（AC-RV-4）。市場條件頁與盤後行情頁共用同一個元件。
 *
 * 分數規則（AC-RV-3）：四條件各 1 分，3 分黃燈、4 分紅燈、2 分以下不亮。
 * 647 天回測：低點 3 分超額 +3.48%、高點 3 分 −1.22%／4 分 −1.43%。
 */

interface Props {
  kind: 'low' | 'high'
  signal: ReversalSignal
  compact?: boolean   // 盤後行情頁的小方塊版
}

const META = {
  low: {
    title: '低點反轉',
    formula: '4 項條件成立 ≥ 3',
    tone: 'red' as const,
    watch: '融資恐慌殺出，留意落底',
    alert: '恐慌 + 法人接手，反轉訊號',
    idle: '尚無恐慌訊號',
    desc: '散戶融資恐慌殺出、法人低檔接手時亮燈。四項條件成立三項即進入觀察。',
  },
  high: {
    title: '高點反轉',
    formula: '4 項條件成立 ≥ 3',
    tone: 'green' as const,
    // AC-RV-8：定位是風險警示，不是見頂放空——命中率約 50%，但命中時跌 5~15%
    watch: '融資過熱，注意回檔風險',
    alert: '多項警訊同時成立，慎追高',
    idle: '尚無過熱訊號',
    desc: '融資追價過頭、外資同步調節時亮燈。屬風險警示，命中率約五成，但命中時回檔幅度通常不小。',
  },
}

const TONE = {
  red:   { on: 'border-red-300 bg-red-50 hover:bg-red-100',       card: 'border-red-300 bg-red-50',     text: 'text-red-500',   dot: 'bg-red-500' },
  green: { on: 'border-green-300 bg-green-50 hover:bg-green-100', card: 'border-green-300 bg-green-50', text: 'text-green-600', dot: 'bg-green-500' },
}

export default function ReversalCard({ kind, signal, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const m = META[kind]
  const t = TONE[m.tone]
  const lit = signal.level !== 'none'
  const label = signal.level === 'alert' ? m.alert : signal.level === 'watch' ? m.watch : m.idle

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          className={`flex flex-col items-start px-3 py-2.5 rounded-xl border text-left transition-colors w-full ${
            lit ? t.on : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">{m.title}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                lit ? `${t.text} bg-white/70` : 'text-slate-400 bg-slate-100'
              }`}>
                {signal.score}/4
              </span>
              {signal.level === 'alert' && (
                <span className={`w-1.5 h-1.5 rounded-full ${t.dot} animate-pulse`} />
              )}
            </span>
            <span className="text-[10px] text-slate-300">›</span>
          </div>
          <span className={`text-[11px] font-bold leading-snug ${lit ? t.text : 'text-slate-400'}`}>
            {label}
          </span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={`text-left rounded-xl p-4 border transition-all hover:-translate-y-0.5 hover:shadow-md w-full ${
            lit ? t.card : 'border-slate-200 bg-white opacity-70'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm font-bold text-slate-700">{m.title}</span>
            {signal.level === 'alert' && (
              <span className={`w-1.5 h-1.5 rounded-full ${t.dot} animate-pulse`} />
            )}
          </div>
          <div className="text-xs font-mono text-slate-400 mb-3">{m.formula}</div>
          <div className={`text-sm font-bold mb-1 ${t.text}`}>
            {signal.score}/4 項成立
          </div>
          <div className={`text-xs font-bold ${lit ? t.text : 'text-slate-400'}`}>
            {signal.level === 'alert' ? '● 強訊號' : signal.level === 'watch' ? '● 觀察中' : '○ 未觸發'}
          </div>
          <div className="text-[10px] text-slate-400 mt-2">點擊查看計算說明 →</div>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl p-4 shadow-xl max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-slate-700">
                {m.title}　<span className={t.text}>{signal.score}/4 項成立</span>
              </span>
              <button onClick={() => setOpen(false)} className="text-slate-400 text-lg leading-none px-1">✕</button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">{m.desc}</p>

            <div className="space-y-1.5 mb-3">
              {signal.conditions.map(c => (
                <div
                  key={c.label}
                  className={`rounded-lg px-2.5 py-2 border ${
                    c.ok ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">{c.ok ? '✅' : '⬜'}</span>
                    <span className={`text-[11px] font-semibold ${c.ok ? 'text-slate-700' : 'text-slate-400'}`}>
                      {c.label}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 ml-5">{c.detail}</div>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              亮燈規則：3 項成立＝觀察、4 項成立＝強訊號。
              門檻採 Z-Score 等統計相對值，會隨市場規模自動調整，不用絕對金額。
            </p>
          </div>
        </div>
      )}
    </>
  )
}
