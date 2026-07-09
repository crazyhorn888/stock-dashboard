'use client'
import { useState } from 'react'
import type { DailyBriefFacts } from '@/lib/types'

interface Props {
  brief?: DailyBriefFacts
}

const QUADRANT_LABEL: [keyof DailyBriefFacts['quadrantCounts'], string][] = [
  ['TR', '漲潮'], ['TL', '觀望'], ['BL', '退潮'], ['BR', '輪動'],
]

// P2-4：盤後總結可折疊卡片。summary 由 n8n 呼叫 OpenAI 寫回，pipeline 剛跑完可能還是 null
// （AC(b) 落地：OpenAI 失敗/尚未產生時，一樣顯示事實統計，不會整塊消失）
export default function DailyBriefCard({ brief }: Props) {
  const [open, setOpen] = useState(true)
  if (!brief) return null

  const hasAnomalies = brief.anomalies.length > 0

  return (
    <div className="bg-white rounded-xl border border-slate-200 mb-3 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2"
      >
        <span className="text-xs font-bold text-slate-700">
          📋 盤後總結{brief.date ? `（${brief.date}）` : ''}
        </span>
        <span className="text-slate-400 text-[10px]">{open ? '收合 ▲' : '展開 ▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-100 pt-2">
          {brief.summary ? (
            <p className="text-xs text-slate-600 leading-relaxed">{brief.summary}</p>
          ) : (
            <p className="text-[11px] text-slate-400">AI 總結尚未產生，以下為事實統計</p>
          )}

          <div className="flex gap-3 text-[10px] text-slate-500 flex-wrap">
            {QUADRANT_LABEL.map(([key, label]) => (
              <span key={key}>{label} {brief.quadrantCounts[key]}</span>
            ))}
          </div>

          {brief.contrarian.length > 0 && (
            <p className="text-[11px] text-red-500">⚓ 逆勢買超：{brief.contrarian.join('、')}</p>
          )}

          {hasAnomalies && (
            <p className="text-[11px] text-slate-500">
              異常個股：{brief.anomalies.slice(0, 5).map(a =>
                `${a.name}（${a.net >= 0 ? '+' : ''}${a.net.toFixed(1)}億）`
              ).join('、')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
