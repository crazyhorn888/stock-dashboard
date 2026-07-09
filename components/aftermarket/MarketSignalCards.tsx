'use client'
import { useState } from 'react'
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

const fmt = (v: number | null, suffix = '') =>
  v != null ? `${v.toLocaleString()}${suffix}` : '—'
const fmtPct = (v: number | null, prefix = '') =>
  v != null ? `${prefix}${v.toFixed(2)}%` : '—'

export default function MarketSignalCards({ signals: s }: Props) {
  const posTriggered = s.posTriggered
  const negTriggered = s.negTriggered
  const hasMargin    = s.todayMargin != null
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const marginIsStale = hasMargin && !!s.todayMarginDate && s.todayMarginDate !== todayStr
  const n = s.nDays
  const [modal, setModal] = useState<'pos' | 'neg' | null>(null)

  return (
    <>
      {/* 今日快覽 */}
      <div className="grid grid-cols-2 gap-2 mb-3 p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="col-span-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
          今日快覽（N={n} 天）
        </div>
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
        <div className="bg-slate-50 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-400 mb-0.5">
            融資餘額{marginIsStale && s.todayMarginDate ? `（${s.todayMarginDate.slice(5).replace('-', '/')}）` : ''}
          </div>
          {hasMargin ? (
            <>
              <div className="text-base font-extrabold text-slate-800 tabular-nums">
                {s.todayMargin!.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 ml-0.5">億</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                距高點{' '}
                <span className="font-bold text-green-600">
                  {s.marginDropPct != null ? `▼${s.marginDropPct.toFixed(1)}%` : '—'}
                </span>
                {' '}· 距低點{' '}
                <span className="font-bold text-red-500">
                  {s.marginRisePct != null ? `▲${s.marginRisePct.toFixed(1)}%` : '—'}
                </span>
              </div>
            </>
          ) : (
            <div className="text-sm font-bold text-slate-400 mt-1">資料累積中</div>
          )}
        </div>
      </div>

      {/* 訊號條：左右並排 */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {/* 減幅指標 */}
        <button
          onClick={() => setModal('pos')}
          className={`flex flex-col items-start px-3 py-2.5 rounded-xl border text-left transition-colors ${
            posTriggered
              ? 'border-red-300 bg-red-50 hover:bg-red-100'
              : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="text-xs text-slate-500 font-medium">減幅指標</span>
            <span className="text-[10px] text-slate-300">›</span>
          </div>
          <span className={`text-[11px] font-bold leading-snug ${posTriggered ? 'text-red-600' : 'text-slate-400'}`}>
            {!hasMargin ? '融資累積中' : '融資減幅>大盤減幅5%'}
          </span>
        </button>

        {/* 增幅指標 */}
        <button
          onClick={() => setModal('neg')}
          className={`flex flex-col items-start px-3 py-2.5 rounded-xl border text-left transition-colors ${
            negTriggered
              ? 'border-green-300 bg-green-50 hover:bg-green-100'
              : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="text-xs text-slate-500 font-medium">增幅指標</span>
            <span className="text-[10px] text-slate-300">›</span>
          </div>
          <span className={`text-[11px] font-bold leading-snug ${negTriggered ? 'text-green-700' : 'text-slate-400'}`}>
            {!hasMargin ? '融資累積中' : '融資增幅>大盤增幅7%'}
          </span>
        </button>
      </div>

      {/* Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-700">
                {modal === 'pos'
                  ? `減幅指標（過去 ${n} 天，以最高點為基準）`
                  : `增幅指標（過去 ${n} 天，以最低點為基準）`}
              </span>
              <button onClick={() => setModal(null)} className="text-slate-400 text-lg leading-none">✕</button>
            </div>

            {/* Modal detail rows */}
            {modal === 'pos' ? (
              <>
                <Row label="區間最高點" value={`${s.peakIndex.toLocaleString()} 點 (${s.peakDate})`} color="text-blue-600" />
                <Row label="今日大盤" value={`${s.todayIndex.toLocaleString()} 點`} />
                <Row label="大盤減幅" value={`▼ ${s.indexDropPct.toFixed(2)}%`} color="text-green-600" />
                <Row label="最高點融資餘額" value={fmt(s.peakMargin, ' 億')} color={s.peakMargin != null ? 'text-blue-600' : 'text-slate-400'} />
                <Row label={marginIsStale ? `融資餘額（${s.todayMarginDate?.slice(5).replace('-','/')}）` : "今日融資餘額"} value={fmt(s.todayMargin, ' 億')} />
                <Row label="融資減幅" value={s.marginDropPct != null ? `▼ ${fmtPct(s.marginDropPct)}` : '—'} color="text-green-600" />
                {s.posGapPct != null ? (
                  <>
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
                      <span className="text-xs font-bold text-slate-500">融資減幅 − 大盤減幅</span>
                      <span className={`text-sm font-bold ${s.posGapPct >= 0 ? 'text-red-500' : 'text-slate-400'}`}>
                        {s.posGapPct >= 0 ? '+' : ''}{s.posGapPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className={`mt-3 text-xs font-bold rounded px-2 py-1.5 border ${
                      posTriggered
                        ? 'text-red-600 border-red-300 bg-red-50'
                        : 'text-slate-400 border-slate-200'
                    }`}>
                      {posTriggered ? '● 融資減幅 > 大盤減幅 5% ✓ 觸發' : '融資減幅 > 大盤減幅 5% — 未觸發'}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-xs text-amber-600 border border-amber-200 bg-amber-50 rounded px-2 py-1.5">
                    融資資料累積中，觸發判斷暫不可用
                  </div>
                )}
              </>
            ) : (
              <>
                <Row label="區間最低點" value={`${s.troughIndex.toLocaleString()} 點 (${s.troughDate})`} color="text-blue-600" />
                <Row label="今日大盤" value={`${s.todayIndex.toLocaleString()} 點`} />
                <Row label="大盤增幅" value={`▲ ${s.indexRisePct.toFixed(2)}%`} color="text-red-500" />
                <Row label="最低點融資餘額" value={fmt(s.troughMargin, ' 億')} color={s.troughMargin != null ? 'text-blue-600' : 'text-slate-400'} />
                <Row label={marginIsStale ? `融資餘額（${s.todayMarginDate?.slice(5).replace('-','/')}）` : "今日融資餘額"} value={fmt(s.todayMargin, ' 億')} />
                <Row label="融資增幅" value={s.marginRisePct != null ? `▲ ${fmtPct(s.marginRisePct)}` : '—'} color="text-red-500" />
                {s.negGapPct != null ? (
                  <>
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
                      <span className="text-xs font-bold text-slate-500">融資增幅 − 大盤增幅</span>
                      <span className={`text-sm font-bold ${s.negGapPct >= 7 ? 'text-green-600' : 'text-slate-400'}`}>
                        {s.negGapPct >= 0 ? '+' : ''}{s.negGapPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className={`mt-3 text-xs font-bold rounded px-2 py-1.5 border ${
                      negTriggered
                        ? 'text-green-700 border-green-300 bg-green-50'
                        : 'text-slate-400 border-slate-200'
                    }`}>
                      {negTriggered ? '● 融資增幅 > 大盤增幅 7% ✓ 觸發' : '融資增幅 > 大盤增幅 7% — 未觸發'}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-xs text-amber-600 border border-amber-200 bg-amber-50 rounded px-2 py-1.5">
                    融資資料累積中，觸發判斷暫不可用
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
