'use client'
import type { MarketSignals } from '@/lib/types'

interface Props {
  signals: MarketSignals
  n: number
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center mb-1.5">
      <span className="text-xs text-[#64748b]">{label}</span>
      <span className={`text-sm font-bold ${color ?? 'text-[#e2e8f0]'}`}>{value}</span>
    </div>
  )
}

export default function MarketSignalCards({ signals: s, n }: Props) {
  const posTriggered = s.posGapPct >= 5
  const negTriggered = s.negGapPct >= 7

  return (
    <div className="grid grid-cols-2 gap-3 mb-4">
      {/* 正向：融資減幅 vs 大盤減幅 */}
      <div className={`rounded-xl p-4 border ${posTriggered ? 'border-red-500 bg-[#1f1215]' : 'border-[#2d3148] bg-[#1e2235]'}`}>
        <div className="text-xs text-[#64748b] font-semibold mb-3">
          大盤融資減幅指標（過去 <span className="text-white">{n}</span> 天，以最高點為基準）
        </div>
        <Row label="📍 區間最高點" value={`${s.peakIndex.toLocaleString()} 點 (${s.peakDate})`} color="text-[#60a5fa]" />
        <Row label="今日大盤" value={`${s.todayIndex.toLocaleString()} 點`} />
        <Row label="大盤減幅" value={`▼ ${s.indexDropPct.toFixed(2)}%`} color="text-red-400" />
        <Row label="最高點當日融資餘額" value={`${s.peakMargin.toLocaleString()} 億`} color="text-[#60a5fa]" />
        <Row label="今日融資餘額" value={`${s.todayMargin.toLocaleString()} 億`} />
        <Row label="融資減幅" value={`▼ ${s.marginDropPct.toFixed(2)}%`} color="text-red-400" />
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#2d1515]">
          <span className="text-xs font-bold text-[#94a3b8]">融資減幅 − 大盤減幅</span>
          <span className={`text-sm font-bold ${s.posGapPct >= 0 ? 'text-red-400' : 'text-[#64748b]'}`}>
            {s.posGapPct >= 0 ? '+' : ''}{s.posGapPct.toFixed(2)}%
          </span>
        </div>
        {posTriggered && (
          <div className="mt-2 text-xs font-bold text-red-400 border border-red-500 bg-[#2d1515] rounded px-2 py-1">
            ● 融資減幅&gt;大盤減幅 5% ✓ 觸發
          </div>
        )}
        {!posTriggered && (
          <div className="mt-2 text-xs text-[#475569] border border-[#2d3148] rounded px-2 py-1">
            融資減幅&gt;大盤減幅 5% — 未觸發
          </div>
        )}
      </div>

      {/* 負向：融資增幅 vs 大盤增幅 */}
      <div className={`rounded-xl p-4 border ${negTriggered ? 'border-green-500 bg-[#131f13]' : 'border-[#2d3148] bg-[#1e2235]'}`}>
        <div className="text-xs text-[#64748b] font-semibold mb-3">
          大盤融資增幅指標（過去 <span className="text-white">{n}</span> 天，以最低點為基準）
        </div>
        <Row label="📍 區間最低點" value={`${s.troughIndex.toLocaleString()} 點 (${s.troughDate})`} color="text-[#60a5fa]" />
        <Row label="今日大盤" value={`${s.todayIndex.toLocaleString()} 點`} />
        <Row label="大盤增幅" value={`▲ ${s.indexRisePct.toFixed(2)}%`} color="text-green-400" />
        <Row label="最低點當日融資餘額" value={`${s.troughMargin.toLocaleString()} 億`} color="text-[#60a5fa]" />
        <Row label="今日融資餘額" value={`${s.todayMargin.toLocaleString()} 億`} />
        <Row label="融資增幅" value={`▲ ${s.marginRisePct.toFixed(2)}%`} color="text-green-400" />
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#2d3148]">
          <span className="text-xs font-bold text-[#94a3b8]">融資增幅 − 大盤增幅</span>
          <span className={`text-sm font-bold ${s.negGapPct >= 7 ? 'text-green-400' : 'text-[#64748b]'}`}>
            {s.negGapPct >= 0 ? '+' : ''}{s.negGapPct.toFixed(2)}%
          </span>
        </div>
        {negTriggered && (
          <div className="mt-2 text-xs font-bold text-green-400 border border-green-500 bg-[#152d15] rounded px-2 py-1">
            ● 融資增幅&gt;大盤增幅 7% ✓ 觸發
          </div>
        )}
        {!negTriggered && (
          <div className="mt-2 text-xs text-[#475569] border border-[#2d3148] rounded px-2 py-1">
            融資增幅&gt;大盤增幅 7% — 未觸發
          </div>
        )}
      </div>
    </div>
  )
}
