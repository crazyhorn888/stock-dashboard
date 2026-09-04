'use client'
import { useState } from 'react'
import type { MarginMaintenance } from '@/lib/marginMaintenance'

/**
 * 融資維持率溫度計（AC-PB-3）。
 * 刻度 145~195%，涵蓋實測範圍（149~197%）；分級門檻 175／165／155。
 *
 * AC-PB-6：公式與門檻由來收在自己的 modal 裡（原本擠在問號 Modal 中段），
 * 點溫度計即可展開，跟其他四張卡的行為一致。
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
  const [open, setOpen] = useState(false)
  const L = LEVEL[data.level]
  const pct = Math.max(0, Math.min(100,
    ((data.ratio - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100
  ))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-stretch gap-3 px-3 py-2.5 bg-white rounded-xl border border-slate-200 shadow-sm mb-3 text-left transition-colors hover:bg-slate-50"
      >
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
          <div className="flex items-center justify-between">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-slate-400">融資維持率</span>
              <span className="text-[9px] text-slate-300">估算</span>
            </span>
            <span className="text-[10px] text-slate-300">›</span>
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
      </button>

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
                融資維持率　<span className={L.text}>{data.ratio.toFixed(1)}%　{L.label}</span>
              </span>
              <button onClick={() => setOpen(false)} className="text-slate-400 text-lg leading-none px-1">✕</button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
              市場整體融資部位的平均維持率，用公開籌碼推估。
            </p>

            <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2">
              <div className="text-[11px] font-semibold text-slate-600">怎麼推出來的</div>
              <code className="block text-[10px] text-slate-400 mt-1 leading-relaxed whitespace-pre overflow-x-auto">
{`建倉維持率 = 1 ÷ 融資成數 ≈ 166.7%
成本指數 C = Σ(融資淨增加 × 當日指數) ÷ Σ(融資淨增加)
估算維持率 = 166.7% × 今日指數 ÷ C`}
              </code>
              <div className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                成本指數只計「融資淨增加」的交易日——那些天才是新部位建倉，融資減少的日子是平倉，
                不影響剩餘部位的成本。
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2">
              <div className="text-[11px] font-semibold text-slate-600">目前代入的數字</div>
              <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                回看 <b className="text-slate-700">{data.lookback} 日</b>（跟著頁面的 N 走，夾在 20~120）
                <br />
                成本指數 C = <b className="text-slate-700">{data.costIndex.toFixed(0)}</b>
                　今日指數 = <b className="text-slate-700">{data.todayIndex.toLocaleString()}</b>
                <br />
                166.7% × {data.todayIndex.toFixed(0)} ÷ {data.costIndex.toFixed(0)} =
                {' '}<b className={L.text}>{data.ratio.toFixed(1)}%</b>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2">
              <div className="text-[11px] font-semibold text-slate-600">門檻怎麼訂的</div>
              <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                <b>175／165／155</b> 依 130 天實測分布訂定（實測範圍 149~197%、中位 173%）。
                <br />
                個別帳戶的 130%（追繳）、140%（危險）是另一回事——整體加權平均天然落在 155~175%，
                套個別帳戶的門檻會有九成日子都是綠燈，溫度計等於不會動。
              </div>
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              <b className="text-slate-500">這是市場整體的估算，不是券商看到的個人帳戶維持率。</b>
              官方不公布整體維持率（需逐戶計算），所以用「融資部位平均建倉指數」回推。
              卡片上的「大盤再跌 {data.dropToCall.toFixed(0)}%」才是對應到 130% 那條追繳線的講法。
            </p>
          </div>
        </div>
      )}
    </>
  )
}
