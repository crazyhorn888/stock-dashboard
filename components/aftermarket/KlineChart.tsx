'use client'
import { useState, useMemo } from 'react'
import type { IndexOHLC, ChipsData, ChipsOptionParty } from '@/lib/types'
import { calcMA, resampleWeekly } from '@/lib/calcMA'

interface Props {
  data: IndexOHLC[]  // newest first
  n: number
  title?: string  // P2-3：全球指數 Modal 複用同一顆元件時顯示指數名稱
}

// P2-3：MA 疊線設定；週線資料量不足以支撐 120 週回看，只在日線顯示 MA120
const MA_LINES: { period: number; color: string; dailyOnly?: boolean }[] = [
  { period: 5,   color: '#14b8a6' },
  { period: 10,  color: '#f59e0b' },
  { period: 20,  color: '#a855f7' },
  { period: 60,  color: '#3b82f6' },
  { period: 120, color: '#64748b', dailyOnly: true },
]

// ── 籌碼面板 ──────────────────────────────────────────────────────────────
const PNAME: Record<string, string> = { foreign: '外資', trust: '投信', dealer: '自營', retail: '散戶' }
const PARTIES = ['foreign', 'trust', 'dealer', 'retail'] as const

function sgn(n: number | string | null | undefined): string {
  const v = Number(n)
  if (isNaN(v) || n === '' || n == null) return '—'
  return (v >= 0 ? '+' : '') + Math.round(v).toLocaleString()
}
function abs(n: number | string | null | undefined): string {
  const v = Number(n)
  return isNaN(v) || n === '' || n == null ? '—' : Math.round(Math.abs(v)).toLocaleString()
}
function f1(n: number | string | null | undefined): string {
  const v = Number(n)
  return isNaN(v) || n === '' || n == null ? '—' : v.toFixed(1)
}

// 期貨詳情（2026-07-15）：大台/小台/微台切換；當日交易僅三大法人（TAIFEX 不公布散戶明細），
// 未平倉含散戶（推導值）；Total = 三大法人合計（散戶=市場−法人，計入會失真）
const FUT_PRODUCTS: { key: 'tx' | 'mtx' | 'imf'; label: string }[] = [
  { key: 'tx',  label: '大台' },
  { key: 'mtx', label: '小台' },
  { key: 'imf', label: '微台' },
]

function FutTable({ title, table, withRetail }: {
  title: string
  table: { foreign: number[]; trust: number[]; dealer: number[]; retail?: number[] } | null | undefined
  withRetail: boolean
}) {
  const rows: { label: string; vals: number[] | undefined; bold?: boolean }[] = [
    { label: '外資', vals: table?.foreign },
    { label: '投信', vals: table?.trust },
    { label: '自營', vals: table?.dealer },
  ]
  if (withRetail) rows.push({ label: '散戶', vals: table?.retail })
  const inst = ['foreign', 'trust', 'dealer'] as const
  const total = table
    ? [0, 1, 2].map(i => inst.reduce((s, p) => s + (table[p]?.[i] ?? 0), 0))
    : undefined
  rows.push({ label: 'Total', vals: total, bold: true })

  return (
    <>
      <div className="text-[9px] font-semibold text-slate-400 uppercase mt-1">{title}</div>
      <div className="grid grid-cols-4 gap-0 text-[9px] font-bold text-slate-400 text-center px-0.5">
        <div className="text-left"></div>
        <div>多方</div><div>空方</div><div>淨額</div>
      </div>
      {rows.map(r => (
        <div key={r.label}
          className={`grid grid-cols-4 gap-0 text-[9px] text-center px-0.5 ${r.bold ? 'border-t border-slate-200 pt-0.5' : ''}`}>
          <div className={`text-left font-semibold ${r.bold ? 'text-slate-600' : 'text-slate-500'}`}>{r.label}</div>
          <div className="tabular-nums text-red-500">{abs(r.vals?.[0])}</div>
          <div className="tabular-nums text-green-700">{abs(r.vals?.[1])}</div>
          <div className={`tabular-nums font-semibold ${(r.vals?.[2] ?? 0) >= 0 ? 'text-red-500' : 'text-green-700'}`}>
            {r.vals ? sgn(r.vals[2]) : '—'}
          </div>
        </div>
      ))}
    </>
  )
}

// 選擇權表 Total 列（三大法人 BC/SC/BP/SP 各欄合計）＋散戶淨額行
// 散戶只有推導的淨額（TAIFEX 不公布散戶 BC/SC/BP/SP 明細），另列一行不混入表格
function OptFooter({ tbl }: { tbl: NonNullable<ChipsData['opt_tr']> }) {
  const inst = ['foreign', 'trust', 'dealer'] as const
  const total = (k: 'bc' | 'sc' | 'bp' | 'sp') =>
    inst.reduce((s, p) => s + ((tbl[p] as ChipsOptionParty)?.[k] ?? 0), 0)
  const retail = tbl.retail
  return (
    <>
      <div className="grid grid-cols-5 gap-0 text-[9px] text-center px-0.5 border-t border-slate-200 pt-0.5">
        <div className="text-left text-slate-600 font-semibold">Total</div>
        <div className="tabular-nums text-red-500 font-semibold">{abs(total('bc'))}</div>
        <div className="tabular-nums text-green-700 font-semibold">{abs(total('sc'))}</div>
        <div className="tabular-nums text-red-500 font-semibold">{abs(total('bp'))}</div>
        <div className="tabular-nums text-green-700 font-semibold">{abs(total('sp'))}</div>
      </div>
      {retail && 'call_net' in retail && (
        <div className="text-[9px] text-slate-400 px-0.5">
          散戶淨額（推導）：Call <span className={`tabular-nums font-semibold ${retail.call_net >= 0 ? 'text-red-500' : 'text-green-700'}`}>{sgn(retail.call_net)}</span>
          {' '}· Put <span className={`tabular-nums font-semibold ${retail.put_net >= 0 ? 'text-red-500' : 'text-green-700'}`}>{sgn(retail.put_net)}</span>
        </div>
      )}
    </>
  )
}

function ChipsPanel({ chips }: { chips: ChipsData }) {
  const [showOpt, setShowOpt] = useState(false)
  const [showFut, setShowFut] = useState(false)
  const [futProd, setFutProd] = useState<'tx' | 'mtx' | 'imf'>('tx')

  return (
    <div className="mt-2 pt-2 border-t border-slate-100 space-y-2">
      {/* 三大法人現貨 + 融資 */}
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">籌碼</div>
      <div className="grid grid-cols-2 gap-1">
        <div className="bg-slate-50 rounded p-1.5">
          <div className="text-[9px] text-slate-400 mb-0.5">三大法人現貨（億）</div>
          <div className="space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">外資</span>
              <span className={chips.foreign_spot >= 0 ? 'text-red-500 font-bold' : 'text-green-700 font-bold'}>
                {sgn(chips.foreign_spot)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">投信</span>
              <span className={chips.trust_spot >= 0 ? 'text-red-500 font-bold' : 'text-green-700 font-bold'}>
                {sgn(chips.trust_spot)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">自營</span>
              <span className={(chips.dealer_self + chips.dealer_hedge) >= 0 ? 'text-red-500 font-bold' : 'text-green-700 font-bold'}>
                {sgn(chips.dealer_self + chips.dealer_hedge)}
              </span>
            </div>
            <div className="flex justify-between text-[10px] border-t border-slate-200 pt-0.5 mt-0.5">
              <span className="text-slate-600 font-semibold">合計</span>
              <span className={chips.inst_total >= 0 ? 'text-red-600 font-bold' : 'text-green-700 font-bold'}>
                {sgn(chips.inst_total)}
              </span>
            </div>
          </div>
        </div>
        <div className="bg-slate-50 rounded p-1.5">
          <div className="text-[9px] text-slate-400 mb-0.5">融資（億）</div>
          {chips.margin_amount != null ? (
            <>
              <div className="text-sm font-bold text-slate-700 tabular-nums">
                {chips.margin_amount.toLocaleString()}
              </div>
              {chips.margin_change != null && (
                <div className={`text-[10px] font-bold ${chips.margin_change >= 0 ? 'text-red-500' : 'text-green-700'}`}>
                  {sgn(chips.margin_change)} 億
                </div>
              )}
            </>
          ) : (
            <div className="text-[10px] text-slate-400">—</div>
          )}
          <div className="mt-1 text-[9px] text-slate-400 mb-0.5">台指期</div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">收盤</span>
            <span className="font-bold text-slate-700">{chips.tx_close?.toLocaleString() ?? '—'}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">基差</span>
            <span className={chips.basis >= 0 ? 'text-red-500 font-bold' : 'text-green-700 font-bold'}>
              {chips.basis >= 0 ? '+' : ''}{f1(chips.basis)}
            </span>
          </div>
        </div>
      </div>

      {/* 指標列 */}
      <div className="flex gap-2 text-[10px]">
        <div className="flex-1 bg-slate-50 rounded p-1.5">
          <span className="text-slate-400">PCR </span>
          <span className="font-bold text-slate-700">{f1(chips.pcr)}</span>
        </div>
        <div className="flex-1 bg-slate-50 rounded p-1.5">
          <span className="text-slate-400">VIX </span>
          <span className="font-bold text-slate-700">{f1(chips.vix)}</span>
        </div>
        <div className="flex-1 bg-slate-50 rounded p-1.5">
          <span className="text-slate-400">外資大台 </span>
          <span className={chips.fx_tx_oi >= 0 ? 'text-red-500 font-bold' : 'text-green-700 font-bold'}>
            {sgn(chips.fx_tx_oi)}
          </span>
        </div>
      </div>

      {/* 期貨 — 收合（2026-07-15 新增，位於選擇權上方） */}
      <button
        onClick={() => setShowFut(v => !v)}
        className="w-full text-left text-[10px] text-slate-500 flex items-center gap-1"
      >
        <span className={`transition-transform ${showFut ? 'rotate-90' : ''}`}>›</span>
        期貨詳情 {showFut ? '收合' : '展開'}
      </button>
      {showFut && (
        <div className="space-y-1.5">
          {/* 商品切換 */}
          <div className="flex gap-1">
            {FUT_PRODUCTS.map(p => (
              <button key={p.key}
                onClick={() => setFutProd(p.key)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  futProd === p.key ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {chips.fut_oi?.[futProd] || chips.fut_tr?.[futProd] ? (
            <>
              <FutTable title="當日交易（口）" table={chips.fut_tr?.[futProd]} withRetail={false} />
              <FutTable title="未平倉（口）" table={chips.fut_oi?.[futProd]} withRetail={true} />
              {!chips.fut_tr?.[futProd] && (
                <div className="text-[9px] text-slate-400">當日交易自 2026-07-15 起提供，較早日期無資料</div>
              )}
            </>
          ) : (
            <div className="text-[9px] text-slate-400">此日期無期貨明細（2026-07-15 起提供）</div>
          )}
        </div>
      )}

      {/* 選擇權 — 收合 */}
      <button
        onClick={() => setShowOpt(v => !v)}
        className="w-full text-left text-[10px] text-slate-500 flex items-center gap-1"
      >
        <span className={`transition-transform ${showOpt ? 'rotate-90' : ''}`}>›</span>
        選擇權詳情 {showOpt ? '收合' : '展開'}
      </button>
      {showOpt && chips.opt_tr && chips.opt_oi && (
        <div className="space-y-1.5">
          {/* 當日交易 */}
          <div className="text-[9px] font-semibold text-slate-400 uppercase">當日交易（口）</div>
          <div className="grid grid-cols-5 gap-0 text-[9px] font-bold text-slate-400 text-center px-0.5">
            <div className="text-left"></div>
            <div>BC</div><div>SC</div><div>BP</div><div>SP</div>
          </div>
          {PARTIES.map(p => {
            const row = chips.opt_tr![p]
            if (!row || !('bc' in row)) return null
            const r = row as ChipsOptionParty
            return (
              <div key={p} className="grid grid-cols-5 gap-0 text-[9px] text-center px-0.5">
                <div className="text-left text-slate-500 font-semibold">{PNAME[p]}</div>
                <div className="tabular-nums text-red-500">{abs(r.bc)}</div>
                <div className="tabular-nums text-green-700">{abs(r.sc)}</div>
                <div className="tabular-nums text-red-500">{abs(r.bp)}</div>
                <div className="tabular-nums text-green-700">{abs(r.sp)}</div>
              </div>
            )
          })}
          <OptFooter tbl={chips.opt_tr!} />
          {/* 未平倉 */}
          <div className="text-[9px] font-semibold text-slate-400 uppercase mt-1">未平倉（口）</div>
          <div className="grid grid-cols-5 gap-0 text-[9px] font-bold text-slate-400 text-center px-0.5">
            <div className="text-left"></div>
            <div>BC</div><div>SC</div><div>BP</div><div>SP</div>
          </div>
          {PARTIES.map(p => {
            const row = chips.opt_oi![p]
            if (!row || !('bc' in row)) return null
            const r = row as ChipsOptionParty
            return (
              <div key={p} className="grid grid-cols-5 gap-0 text-[9px] text-center px-0.5">
                <div className="text-left text-slate-500 font-semibold">{PNAME[p]}</div>
                <div className="tabular-nums text-red-500">{abs(r.bc)}</div>
                <div className="tabular-nums text-green-700">{abs(r.sc)}</div>
                <div className="tabular-nums text-red-500">{abs(r.bp)}</div>
                <div className="tabular-nums text-green-700">{abs(r.sp)}</div>
              </div>
            )
          })}
          <OptFooter tbl={chips.opt_oi!} />
        </div>
      )}
    </div>
  )
}

// SVG viewport constants
const VW = 360
const PRICE_TOP = 10
const PRICE_BOT = 118
const VOL_TOP = 124
const VOL_BOT = 168
const VH = 172
const L_PAD = 4
const R_PAD = 36  // space for Y-axis labels on right

export default function KlineChart({ data, n, title = '大盤 K 線走勢' }: Props) {
  const [selected, setSelected] = useState<IndexOHLC | null>(null)
  const [period, setPeriod] = useState<'D' | 'W'>('D')

  // P2-3：週線用 ISO 週重採樣；MA 計算來源（maSource）與顯示切片（bars）用同一顆粒度
  const maSource = useMemo(() => period === 'D' ? data : resampleWeekly(data), [data, period])
  const displayCount = Math.min(n, maSource.length)

  // Take n most-recent days/weeks and reverse so oldest=left, newest=right
  const bars = useMemo(() => maSource.slice(0, displayCount).reverse(), [maSource, displayCount])

  // P2-3：MA10/20/60（週線再加 120 天資料不足，只在日線顯示 MA120），對齊 bars 順序
  const maLines = useMemo(() => (
    MA_LINES
      .filter(l => period === 'D' || !l.dailyOnly)
      .map(l => ({ ...l, values: calcMA(maSource, l.period).slice(0, displayCount).reverse() }))
  ), [maSource, displayCount, period])

  const availW = VW - L_PAD - R_PAD

  // N-day 收盤最高/最低（與 MarketSignalCards 顯示一致，用收盤價）
  const { peakIdx, troughIdx, peakPrice, troughPrice } = useMemo(() => {
    if (!bars.length) return { peakIdx: -1, troughIdx: -1, peakPrice: 0, troughPrice: 0 }
    let pi = 0, ti = 0
    bars.forEach((d, i) => {
      if (d.close > bars[pi].close) pi = i
      if (d.close < bars[ti].close) ti = i
    })
    return { peakIdx: pi, troughIdx: ti, peakPrice: bars[pi].close, troughPrice: bars[ti].close }
  }, [bars])

  // Price axis range（含 MA 線數值，避免均線超出價格軸被裁切）
  const { pMin, pMax } = useMemo(() => {
    if (!bars.length) return { pMin: 0, pMax: 1 }
    const maVals = maLines.flatMap(l => l.values).filter((v): v is number => v != null)
    const allH = Math.max(...bars.map(d => d.high), ...maVals)
    const allL = Math.min(...bars.map(d => d.low), ...maVals)
    const pad = (allH - allL) * 0.08
    return { pMin: allL - pad, pMax: allH + pad }
  }, [bars, maLines])

  const maxVol = useMemo(() => Math.max(...bars.map(d => d.volume), 1), [bars])

  // Helpers
  function xOf(i: number) {
    return L_PAD + (i + 0.5) * (availW / Math.max(bars.length, 1))
  }
  function yOf(price: number) {
    return PRICE_BOT - ((price - pMin) / (pMax - pMin)) * (PRICE_BOT - PRICE_TOP)
  }
  function volH(vol: number) {
    return ((vol / maxVol) * (VOL_BOT - VOL_TOP)) * 0.9
  }

  const barW = Math.max(1.2, (availW / Math.max(bars.length, 1)) * 0.72)

  if (!bars.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400 text-sm mb-4">
        K 線資料載入中...
      </div>
    )
  }

  const todayBar = bars[bars.length - 1]
  const peakY   = yOf(peakPrice)
  const troughY = yOf(troughPrice)

  // Y-axis tick labels
  const yTicks = [0.2, 0.5, 0.8].map(f => ({
    price: pMin + f * (pMax - pMin),
    y: PRICE_BOT - f * (PRICE_BOT - PRICE_TOP),
  }))

  function handleBarClick(d: IndexOHLC) {
    setSelected(prev => prev?.date === d.date ? null : d)
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-700">{title}</span>
          {/* P2-3：日/週切換 */}
          <div className="flex gap-1">
            {(['D', 'W'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={[
                  'px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors',
                  period === p
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300',
                ].join(' ')}
              >
                {p === 'D' ? '日' : '週'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-red-500 mr-0.5 align-middle" />漲</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-green-500 mr-0.5 align-middle" />跌</span>
          <span className="text-red-400">— N 高</span>
          <span className="text-green-500">— N 低</span>
          {maLines.map(l => (
            <span key={l.period} style={{ color: l.color }}>— MA{l.period}</span>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}
        >
          {/* Grid lines */}
          {yTicks.map(({ y, price }) => (
            <g key={price}>
              <line x1={L_PAD} y1={y} x2={VW - R_PAD} y2={y} stroke="#f1f5f9" strokeWidth="1"/>
              <text x={VW - R_PAD + 2} y={y + 3} fontSize="6" fill="#94a3b8">
                {price >= 10000
                  ? (price / 1000).toFixed(0) + 'k'
                  : price.toFixed(0)}
              </text>
            </g>
          ))}

          {/* N-day peak reference line */}
          <line x1={L_PAD} y1={peakY} x2={VW - R_PAD} y2={peakY}
            stroke="#ef4444" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.7"/>
          {/* N-day trough reference line */}
          <line x1={L_PAD} y1={troughY} x2={VW - R_PAD} y2={troughY}
            stroke="#22c55e" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.7"/>

          {/* Volume area separator */}
          <line x1={L_PAD} y1={VOL_TOP - 2} x2={VW - R_PAD} y2={VOL_TOP - 2} stroke="#f1f5f9" strokeWidth="1"/>
          <text x={L_PAD + 2} y={VOL_TOP + 7} fontSize="5.5" fill="#cbd5e1">量</text>

          {/* Candles */}
          {bars.map((d, i) => {
            const cx      = xOf(i)
            const isUp    = d.close >= d.open
            const color   = isUp ? '#ef4444' : '#22c55e'
            const bodyTop = yOf(Math.max(d.open, d.close))
            const bodyBot = yOf(Math.min(d.open, d.close))
            const bodyH   = Math.max(bodyBot - bodyTop, 0.5)
            const wickT   = yOf(d.high)
            const wickB   = yOf(d.low)
            const vH      = volH(d.volume)
            const isSel   = selected?.date === d.date
            const isToday = d === todayBar

            return (
              <g key={d.date} onClick={() => handleBarClick(d)}
                opacity={selected && !isSel ? 0.28 : 1}
                style={{ cursor: 'pointer' }}>
                {/* Selection highlight bg */}
                {isSel && (
                  <>
                    <rect
                      x={cx - (availW / bars.length) / 2} y={0}
                      width={availW / bars.length} height={PRICE_BOT}
                      fill="#fef9c3" opacity="0.55" rx="1"/>
                    <line x1={cx} y1={0} x2={cx} y2={PRICE_BOT}
                      stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="2,2" opacity="0.5"/>
                  </>
                )}
                {/* Wick */}
                <line x1={cx} y1={wickT} x2={cx} y2={wickB} stroke={color} strokeWidth="1"/>
                {/* Body */}
                <rect x={cx - barW / 2} y={bodyTop} width={barW} height={bodyH} fill={color} rx="0.5"/>
                {/* Volume bar */}
                <rect x={cx - barW / 2} y={VOL_BOT - vH} width={barW} height={vH}
                  fill={color} opacity="0.4" rx="0.5"/>
                {/* Today ring */}
                {isToday && (
                  <circle cx={cx} cy={(bodyTop + bodyTop + bodyH) / 2}
                    r={Math.max(barW * 1.6, 3)}
                    fill="none" stroke="#2563eb" strokeWidth="1" strokeDasharray="2,1.5"/>
                )}
              </g>
            )
          })}

          {/* P2-3：MA 疊線 — lookback 不足的點是 null，分段畫、遇 null 就斷開 */}
          {maLines.map(l => {
            const segments: string[] = []
            let current: string[] = []
            l.values.forEach((v, i) => {
              if (v == null) {
                if (current.length > 1) segments.push(current.join(' '))
                current = []
                return
              }
              current.push(`${xOf(i)},${yOf(v)}`)
            })
            if (current.length > 1) segments.push(current.join(' '))
            return (
              <g key={l.period}>
                {segments.map((pts, si) => (
                  <polyline key={si} points={pts} fill="none" stroke={l.color} strokeWidth="1" opacity="0.85"/>
                ))}
              </g>
            )
          })}

          {/* Peak dot + right-side label */}
          {peakIdx >= 0 && (
            <>
              <circle cx={xOf(peakIdx)} cy={peakY} r="2.5" fill="#ef4444" stroke="#fff" strokeWidth="0.8"/>
              <text x={VW - R_PAD + 2} y={peakY + 3} fontSize="6" fill="#ef4444" fontWeight="700">
                {peakPrice >= 1000
                  ? peakPrice.toLocaleString('zh-TW', { maximumFractionDigits: 0 })
                  : peakPrice.toFixed(0)}
              </text>
            </>
          )}
          {/* Trough dot + right-side label */}
          {troughIdx >= 0 && (
            <>
              <circle cx={xOf(troughIdx)} cy={troughY} r="2.5" fill="#22c55e" stroke="#fff" strokeWidth="0.8"/>
              <text x={VW - R_PAD + 2} y={troughY + 3} fontSize="6" fill="#22c55e" fontWeight="700">
                {troughPrice >= 1000
                  ? troughPrice.toLocaleString('zh-TW', { maximumFractionDigits: 0 })
                  : troughPrice.toFixed(0)}
              </text>
            </>
          )}
          {/* Today right-side close label */}
          {todayBar && (() => {
            const ty = yOf(todayBar.close)
            return (
              <text x={VW - R_PAD + 2} y={ty + 3} fontSize="6" fill="#2563eb" fontWeight="700">
                {todayBar.close >= 1000
                  ? todayBar.close.toLocaleString('zh-TW', { maximumFractionDigits: 0 })
                  : todayBar.close.toFixed(0)}
              </text>
            )
          })()}
        </svg>
      </div>

      {/* OHLC Tooltip */}
      {selected && (() => {
        const chgPct = ((selected.close - selected.open) / selected.open) * 100
        const isUp = selected.close >= selected.open
        return (
          <div className="mt-2 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-700">{selected.date}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${isUp ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                {isUp ? '▲' : '▼'} {Math.abs(chgPct).toFixed(2)}%
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
              {([
                { label: '開', value: selected.open,  color: '' },
                { label: '高', value: selected.high,  color: 'text-red-500' },
                { label: '低', value: selected.low,   color: 'text-green-600' },
                { label: '收', value: selected.close, color: isUp ? 'text-red-500' : 'text-green-600' },
              ] as const).map(({ label, value, color }) => (
                <div key={label}>
                  <div className="text-[10px] text-slate-400 mb-0.5">{label}</div>
                  <div className={`text-xs font-bold ${color || 'text-slate-700'}`}>
                    {value.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs">
              <span className="text-slate-400">成交金額</span>
              <span className="font-bold text-slate-700">{selected.volume.toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 億</span>
            </div>
            {selected.chips && <ChipsPanel chips={selected.chips} />}
            <button
              onClick={() => setSelected(null)}
              className="mt-2 w-full text-[10px] text-slate-400 hover:text-slate-600 text-center"
            >
              點擊任意 K 棒或此處關閉
            </button>
          </div>
        )
      })()}
    </div>
  )
}
