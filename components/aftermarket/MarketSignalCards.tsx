'use client'
import type { MarketSignals } from '@/lib/types'

interface Props {
  signals: MarketSignals
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center mb-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-sm font-bold ${color ?? 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

export default function MarketSignalCards({ signals: s }: Props) {
  const posTriggered = s.posGapPct >= 5
  const negTriggered = s.negGapPct >= 7
  const n = s.nDays

  return (
    <>
      {/* 今日快覽 */}
      <div className="grid grid-cols-2 gap-2 mb-3 p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="col-span-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
          今日快覽（N={n} 天）
        </div>
        {/* 大盤指數 */}
        <div className="bg-slate-50 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-400 mb-0.5">大盤指數</div>
          <div className="text-base font-extrabold text-slate-800 tabular-nums">
            {s.todayIndex.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            距高點{' '}
            <span className="font-bold text-green-600">▼{s.indexDropPct.toFixed(1)}%</span>
            {' '}· 距低點{' '}
            <span className="font-bold text-red-500">▲{s.indexRisePct.toFixed(1)}%</span>
          </div>
        </div>
        {/* 融資餘額 */}
        <div className="bg-slate-50 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-400 mb-0.5">融資餘額</div>
          <div className="text-base font-extrabold text-slate-800 tabular-nums">
            {s.todayMargin.toLocaleString()}
            <span className="text-xs font-normal text-slate-400 ml-0.5">億</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            距高點{' '}
            <span className="font-bold text-green-600">▼{s.marginDropPct.toFixed(1)}%</span>
            {' '}· 距低點{' '}
            <span className="font-bold text-red-500">▲{s.marginRisePct.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* 正/負向訊號卡片 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* 正向：融資減幅 vs 大盤減幅 */}
        <div className={`rounded-xl p-4 border ${posTriggered ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
          <div className="text-xs text-slate-400 font-semibold mb-3">
            減幅指標（過去 <span className="text-slate-700 font-bold">{n}</span> 天，以最高點為基準）
          </div>
          <Row label="區間最高點" value={`${s.peakIndex.toLocaleString()} 點 (${s.peakDate})`} color="text-blue-600" />
          <Row label="今日大盤" value={`${s.todayIndex.toLocaleString()} 點`} />
          <Row label="大盤減幅" value={`▼ ${s.indexDropPct.toFixed(2)}%`} color="text-green-600" />
          <Row label="最高點融資餘額" value={`${s.peakMargin.toLocaleString()} 億`} color="text-blue-600" />
          <Row label="今日融資餘額" value={`${s.todayMargin.toLocaleString()} 億`} />
          <Row label="融資減幅" value={`▼ ${s.marginDropPct.toFixed(2)}%`} color="text-green-600" />
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
            <span className="text-xs font-bold text-slate-500">融資減幅 − 大盤減幅</span>
            <span className={`text-sm font-bold ${s.posGapPct >= 0 ? 'text-red-500' : 'text-slate-400'}`}>
              {s.posGapPct >= 0 ? '+' : ''}{s.posGapPct.toFixed(2)}%
            </span>
          </div>
          {posTriggered ? (
            <div className="mt-2 text-xs font-bold text-red-600 border border-red-300 bg-red-50 rounded px-2 py-1">
              ● 融資減幅 &gt; 大盤減幅 5% ✓ 觸發
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-400 border border-slate-200 rounded px-2 py-1">
              融資減幅 &gt; 大盤減幅 5% — 未觸發
            </div>
          )}
        </div>

        {/* 負向：融資增幅 vs 大盤增幅 */}
        <div className={`rounded-xl p-4 border ${negTriggered ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'}`}>
          <div className="text-xs text-slate-400 font-semibold mb-3">
            增幅指標（過去 <span className="text-slate-700 font-bold">{n}</span> 天，以最低點為基準）
          </div>
          <Row label="區間最低點" value={`${s.troughIndex.toLocaleString()} 點 (${s.troughDate})`} color="text-blue-600" />
          <Row label="今日大盤" value={`${s.todayIndex.toLocaleString()} 點`} />
          <Row label="大盤增幅" value={`▲ ${s.indexRisePct.toFixed(2)}%`} color="text-red-500" />
          <Row label="最低點融資餘額" value={`${s.troughMargin.toLocaleString()} 億`} color="text-blue-600" />
          <Row label="今日融資餘額" value={`${s.todayMargin.toLocaleString()} 億`} />
          <Row label="融資增幅" value={`▲ ${s.marginRisePct.toFixed(2)}%`} color="text-red-500" />
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
            <span className="text-xs font-bold text-slate-500">融資增幅 − 大盤增幅</span>
            <span className={`text-sm font-bold ${s.negGapPct >= 7 ? 'text-green-600' : 'text-slate-400'}`}>
              {s.negGapPct >= 0 ? '+' : ''}{s.negGapPct.toFixed(2)}%
            </span>
          </div>
          {negTriggered ? (
            <div className="mt-2 text-xs font-bold text-green-700 border border-green-300 bg-green-50 rounded px-2 py-1">
              ● 融資增幅 &gt; 大盤增幅 7% ✓ 觸發
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-400 border border-slate-200 rounded px-2 py-1">
              融資增幅 &gt; 大盤增幅 7% — 未觸發
            </div>
          )}
        </div>
      </div>
    </>
  )
}
