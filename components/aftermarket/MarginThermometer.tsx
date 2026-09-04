'use client'
import type { MarginMaintenance } from '@/lib/marginMaintenance'

/**
 * 融資維持率溫度計（AC-PB-3）。
 * 刻度 145~195%，涵蓋實測範圍（149~197%）；分級門檻 175／165／155。
 */

interface Props {
  data: MarginMaintenance
}

const SCALE_MIN = 145
const SCALE_MAX = 195
const TICKS = [195, 185, 175, 165, 155, 145]

const LEVEL = {
  safe:     { label: '安全',   bar: '#16a34a', text: 'text-green-600',  desc: '融資部位普遍有獲利緩衝' },
  watch:    { label: '注意',   bar: '#eab308', text: 'text-yellow-600', desc: '緩衝變薄，留意追繳賣壓' },
  danger:   { label: '危險',   bar: '#dc2626', text: 'text-red-600',    desc: '不少部位接近成本，易引發斷頭' },
  critical: { label: '極危險', bar: '#991b1b', text: 'text-red-800',    desc: '融資普遍套牢，追繳賣壓沉重' },
} as const

export default function MarginThermometer({ data }: Props) {
  const L = LEVEL[data.level]
  const pct = Math.max(0, Math.min(100,
    ((data.ratio - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100
  ))

  return (
    <div className="flex items-stretch gap-3 px-3 py-2.5 bg-white rounded-xl border border-slate-200 shadow-sm mb-3">
      {/* 溫度計本體 */}
      <div className="relative w-7 shrink-0" style={{ height: 104 }}>
        <div className="absolute left-1/2 -translate-x-1/2 w-2.5 h-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-500"
            style={{ height: `${pct}%`, background: L.bar }}
          />
        </div>
        {/* 目前值的指針 */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full transition-all duration-500"
          style={{ bottom: `calc(${pct}% - 1px)`, background: L.bar }}
        />
      </div>

      {/* 刻度 */}
      <div className="flex flex-col justify-between text-[9px] text-slate-300 shrink-0" style={{ height: 104 }}>
        {TICKS.map(t => <span key={t}>{t}%</span>)}
      </div>

      {/* 數值與說明 */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] text-slate-400">融資維持率</span>
          <span className="text-[9px] text-slate-300">估算</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-xl font-extrabold ${L.text}`}>{data.ratio.toFixed(1)}%</span>
          <span className={`text-[11px] font-bold ${L.text}`}>{L.label}</span>
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{L.desc}</div>
        <div className="text-[10px] text-slate-400 mt-1 leading-snug">
          大盤再跌 <b className="text-slate-600">{data.dropToCall.toFixed(0)}%</b> 觸及追繳線 130%
          <span className="text-slate-300">（{data.lookback} 日成本指數 {data.costIndex.toFixed(0)}）</span>
        </div>
      </div>
    </div>
  )
}
