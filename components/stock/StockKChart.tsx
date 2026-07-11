'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OHLCBar } from '@/lib/fetchStockOHLC'

export type Period = 'D' | 'W' | 'M'

interface Props {
  closes:   number[]
  dates:    string[]
  n:        number
  period:   Period
  ohlcBars: OHLCBar[] | null
}

const W   = 600
const H_K = 210   // K線區高度
const H_V = 52    // 量能區高度
const H   = H_K + H_V + 34  // 總高度（含 x-axis 標籤）
const PAD = { top: 12, right: 40, bottom: 0, left: 50 }
const CW  = W - PAD.left - PAD.right
const CH  = H_K - PAD.top

const MA_CONFIG: Record<Period, { period: number; color: string; label: string }[]> = {
  D: [
    { period: 5,  color: '#f59e0b', label: 'MA5'  },
    { period: 10, color: '#f97316', label: 'MA10' },
    { period: 20, color: '#3b82f6', label: 'MA20' },
    { period: 60, color: '#a855f7', label: 'MA60' },
  ],
  W: [
    { period: 5,  color: '#f59e0b', label: 'MA5'  },
    { period: 10, color: '#f97316', label: 'MA10' },
    { period: 26, color: '#a855f7', label: 'MA26' },
  ],
  M: [
    { period: 3,  color: '#f59e0b', label: 'MA3'  },
    { period: 6,  color: '#3b82f6', label: 'MA6'  },
    { period: 12, color: '#a855f7', label: 'MA12' },
  ],
}

function aggregateBars(closes: number[], dates: string[], period: 'W' | 'M'): OHLCBar[] {
  const dc = closes.slice(0, 250).reverse()
  const dd = dates.slice(0, 250).reverse()
  const groups: { key: string; bars: { c: number; d: string }[] }[] = []
  for (let i = 0; i < dc.length; i++) {
    const date = dd[i]
    const key  = period === 'W' ? isoWeekKey(date) : date.slice(0, 7)
    if (groups.length === 0 || groups[groups.length - 1].key !== key) {
      groups.push({ key, bars: [] })
    }
    groups[groups.length - 1].bars.push({ c: dc[i], d: date })
  }
  return groups
    .filter(g => g.bars.length > 0)
    .map(g => {
      const prices = g.bars.map(b => b.c)
      return {
        date:        g.bars[g.bars.length - 1].d,
        open:        g.bars[0].c,
        high:        Math.max(...prices),
        low:         Math.min(...prices),
        close:       g.bars[g.bars.length - 1].c,
        hasRealOHLC: false,
      }
    })
    .reverse()
}

function isoWeekKey(dateISO: string): string {
  const d = new Date(dateISO)
  const day = d.getDay() || 7
  d.setDate(d.getDate() + 4 - day)
  const year = d.getFullYear()
  const startOfYear = new Date(year, 0, 1)
  const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

function fmtVol(v: number | undefined): string {
  if (v == null) return '—'
  if (v >= 10000) return `${(v / 10000).toFixed(1)} 萬張`
  if (v >= 1000)  return `${(v / 1000).toFixed(2)} 千張`
  return `${v} 張`
}

export default function StockKChart({ closes, dates, n, period, ohlcBars }: Props) {
  const MA_LINES = MA_CONFIG[period]
  const [hoverIdx,      setHoverIdx]      = useState<number | null>(null)
  const [displayCount,  setDisplayCount]  = useState<number | null>(null)
  const pinchRef = useRef<{ startDist: number; startCount: number } | null>(null)

  // 切換週期時重設縮放
  useEffect(() => { setDisplayCount(null) }, [period])

  const bars = useMemo<OHLCBar[]>(() => {
    if (period === 'D') {
      if (ohlcBars && ohlcBars.length > 0) return ohlcBars.slice(0, 120)
      return closes.slice(0, 120).map((c, i) => ({
        date: dates[i] ?? '', open: c, high: c, low: c, close: c, hasRealOHLC: false,
      })).filter(b => b.date)
    }
    if (period === 'W') return aggregateBars(closes, dates, 'W').slice(0, 60)
    return aggregateBars(closes, dates, 'M').slice(0, 36)
  }, [period, ohlcBars, closes, dates])

  const MIN_DISPLAY = 20
  const effectiveBars = useMemo(() => {
    if (displayCount === null) return bars
    return bars.slice(0, Math.max(MIN_DISPLAY, Math.min(displayCount, bars.length)))
  }, [bars, displayCount])

  const chart = useMemo(() => {
    if (effectiveBars.length === 0) return null
    const dc    = [...effectiveBars].reverse()
    const COUNT = dc.length

    const nSlice = closes.slice(0, Math.min(n, closes.length))
    const nHigh  = Math.max(...nSlice)
    const nLow   = Math.min(...nSlice)

    function getMA(i: number, p: number): number | null {
      const barsIdx = COUNT - 1 - i
      const slice   = effectiveBars.slice(barsIdx, barsIdx + p).map(b => b.close)
      if (slice.length < p) return null
      return slice.reduce((s, v) => s + v, 0) / p
    }
    const maValues = MA_LINES.map(({ period: p }) => dc.map((_, i) => getMA(i, p)))

    const allH   = Math.max(...dc.map(b => b.high))
    const allL   = Math.min(...dc.map(b => b.low))
    const maFlat = maValues.flat().filter((v): v is number => v !== null)
    const yMin   = Math.min(allL, ...maFlat, nLow) * 0.995
    const yMax   = Math.max(allH, ...maFlat, nHigh) * 1.005

    // Volume scale
    const vols    = dc.map(b => b.volume ?? 0)
    const maxVol  = Math.max(...vols, 1)

    function px(i: number) { return PAD.left + (i + 0.5) * (CW / COUNT) }
    function py(v: number) { return PAD.top + CH - ((v - yMin) / (yMax - yMin)) * CH }
    function pv(v: number) { return H_K + H_V - (v / maxVol) * (H_V - 4) }  // volume bar bottom

    const barW = Math.max(1.2, (CW / COUNT) * 0.72)

    const maPaths = maValues.map(vals => {
      let d = ''
      vals.forEach((v, i) => {
        if (v === null) return
        d += (d === '' ? 'M' : 'L') + `${px(i).toFixed(1)},${py(v).toFixed(1)}`
      })
      return d
    })

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const v = yMin + (i / 4) * (yMax - yMin)
      return { v, y: py(v) }
    })

    const step   = Math.ceil(COUNT / 5)
    const xTicks = dc.map((_, i) => i)
      .filter(i => i === 0 || (i + 1) % step === 0 || i === COUNT - 1)
      .map(i => ({
        i,
        x: px(i),
        label: period === 'D' ? dc[i].date.slice(5)
             : period === 'W' ? dc[i].date.slice(2, 7)
             : dc[i].date.slice(0, 7),
      }))

    return { dc, COUNT, px, py, pv, barW, maPaths, nHigh, nLow, yTicks, xTicks, vols, maxVol }
  }, [effectiveBars, closes, n, MA_LINES, period])

  const isDoji       = period === 'D' && !(ohlcBars && ohlcBars[0]?.hasRealOHLC)
  const hasVol       = bars.some(b => b.volume != null)
  const periodLabel  = period === 'D' ? `日K 近 ${effectiveBars.length} 天`
                     : period === 'W' ? `週K 近 ${effectiveBars.length} 週`
                     :                  `月K 近 ${effectiveBars.length} 月`

  // 觸控/滑鼠事件 → 更新 hoverIdx
  const handlePointer = useCallback((clientX: number, svgRect: DOMRect) => {
    if (!chart) return
    const svgX = ((clientX - svgRect.left) / svgRect.width) * W
    const raw  = Math.floor((svgX - PAD.left) / (CW / chart.COUNT))
    setHoverIdx(Math.max(0, Math.min(chart.COUNT - 1, raw)))
  }, [chart])

  if (!chart) return (
    <div className="h-40 flex items-center justify-center text-slate-400 text-xs">無資料</div>
  )

  const { dc, COUNT, px, py, pv, barW, maPaths, nHigh, nLow, yTicks, xTicks, vols } = chart
  const hBar = hoverIdx !== null ? dc[hoverIdx] : null

  return (
    <div className="w-full select-none">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1 px-1 items-center">
        {MA_LINES.map(({ label, color }) => (
          <span key={label} className="text-[10px] font-semibold" style={{ color }}>{label}</span>
        ))}
        <span className="text-[10px] text-slate-400 ml-auto">{periodLabel}</span>
        {/* isDoji = 無真實 OHLC（不限上櫃——TWSE 股在 ohlc 累積初期也會如此），文字不能寫死「上櫃」 */}
        {isDoji && (
          <span className="text-[9px] text-amber-500 w-full">日K 資料建置中，顯示收盤走勢</span>
        )}
      </div>

      {/* Hover info bar */}
      <div className={`transition-opacity duration-100 mb-1 px-2 py-1 rounded-lg bg-slate-100 text-[10px] flex flex-wrap gap-x-2.5 gap-y-0.5 ${hBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {hBar && (
          <>
            <span className="font-semibold text-slate-600">{hBar.date}</span>
            {!isDoji && <>
              <span>開 <span className="font-bold text-slate-800">{hBar.open.toFixed(2)}</span></span>
              <span>高 <span className="font-bold text-red-500">{hBar.high.toFixed(2)}</span></span>
              <span>低 <span className="font-bold text-green-600">{hBar.low.toFixed(2)}</span></span>
            </>}
            <span>收 <span className="font-bold text-slate-800">{hBar.close.toFixed(2)}</span></span>
            {hasVol && <span>量 <span className="font-bold text-slate-600">{fmtVol(hBar.volume)}</span></span>}
          </>
        )}
        {!hBar && <span className="text-slate-400 invisible">placeholder</span>}
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ maxHeight: 290 }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          handlePointer(e.clientX, rect)
        }}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={e => {
          if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX
            const dy = e.touches[0].clientY - e.touches[1].clientY
            pinchRef.current = { startDist: Math.hypot(dx, dy), startCount: displayCount ?? bars.length }
            setHoverIdx(null)
          } else {
            const rect = e.currentTarget.getBoundingClientRect()
            handlePointer(e.touches[0].clientX, rect)
          }
        }}
        onTouchMove={e => {
          e.preventDefault()
          if (e.touches.length === 2 && pinchRef.current) {
            const dx      = e.touches[0].clientX - e.touches[1].clientX
            const dy      = e.touches[0].clientY - e.touches[1].clientY
            const newDist = Math.hypot(dx, dy)
            const count   = Math.round(pinchRef.current.startCount * (pinchRef.current.startDist / newDist))
            setDisplayCount(Math.max(MIN_DISPLAY, Math.min(bars.length, count)))
          } else if (e.touches.length === 1) {
            const rect = e.currentTarget.getBoundingClientRect()
            handlePointer(e.touches[0].clientX, rect)
          }
        }}
        onTouchEnd={e => {
          if (e.touches.length === 0) { pinchRef.current = null; setHoverIdx(null) }
        }}
      >
        {/* ── K線區 ── */}
        {/* Y grid + ticks */}
        {yTicks.map(({ v, y }) => (
          <g key={v}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={PAD.left - 4} y={y + 3.5} textAnchor="end" fontSize={9} fill="#94a3b8">
              {v.toFixed(v >= 1000 ? 0 : 1)}
            </text>
          </g>
        ))}

        {/* N-day 高低虛線 */}
        <line x1={PAD.left} y1={py(nHigh)} x2={W - PAD.right} y2={py(nHigh)}
          stroke="#ef4444" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.6} />
        <text x={W - PAD.right + 2} y={py(nHigh) + 3} fontSize={8} fill="#ef4444" opacity={0.7}>
          {nHigh.toFixed(0)}
        </text>
        <line x1={PAD.left} y1={py(nLow)} x2={W - PAD.right} y2={py(nLow)}
          stroke="#22c55e" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.6} />
        <text x={W - PAD.right + 2} y={py(nLow) + 3} fontSize={8} fill="#22c55e" opacity={0.7}>
          {nLow.toFixed(0)}
        </text>

        {/* Candlesticks */}
        {dc.map((bar, i) => {
          const cx      = px(i)
          const isUp    = bar.close >= bar.open
          const color   = isDoji ? '#94a3b8' : isUp ? '#ef4444' : '#22c55e'
          const bodyTop = py(Math.max(bar.open, bar.close))
          const bodyBot = py(Math.min(bar.open, bar.close))
          const bodyH   = Math.max(bodyBot - bodyTop, isDoji ? 0 : 0.8)
          const isLast  = i === COUNT - 1
          const isHover = hoverIdx === i

          return (
            <g key={bar.date}>
              {!isDoji && (
                <line x1={cx} y1={py(bar.high)} x2={cx} y2={py(bar.low)} stroke={color} strokeWidth={0.9} />
              )}
              {isDoji
                ? <circle cx={cx} cy={bodyTop} r={1.2} fill={color} />
                : <rect x={cx - barW / 2} y={bodyTop} width={barW} height={bodyH} fill={color} rx={0.5} />
              }
              {isLast && !isHover && (
                <circle cx={cx} cy={bodyTop} r={Math.max(barW, 3)}
                  fill="none" stroke="#2563eb" strokeWidth={1} strokeDasharray="2,1.5" opacity={0.7} />
              )}
            </g>
          )
        })}

        {/* MA lines */}
        {MA_LINES.map(({ color, label }, idx) =>
          maPaths[idx] ? (
            <path key={label} d={maPaths[idx]} fill="none" stroke={color} strokeWidth={1.1} strokeLinejoin="round" />
          ) : null
        )}

        {/* ── 量能區 ── */}
        {/* 分隔線 */}
        <line x1={PAD.left} y1={H_K} x2={W - PAD.right} y2={H_K} stroke="#e2e8f0" strokeWidth={0.8} />

        {/* 量能 bars */}
        {hasVol && dc.map((bar, i) => {
          const cx    = px(i)
          const vol   = vols[i]
          const isUp  = bar.close >= bar.open
          const color = isDoji ? '#cbd5e1' : isUp ? '#fca5a5' : '#86efac'  // 淺色，不搶 K 線
          const top   = pv(vol)
          const h     = H_K + H_V - top
          return (
            <rect key={bar.date} x={cx - barW / 2} y={top} width={barW} height={Math.max(h, 0.5)}
              fill={color} rx={0.3} opacity={0.8} />
          )
        })}

        {/* ── X 軸標籤 ── */}
        {xTicks.map(({ i, x, label }) => (
          <g key={i}>
            <line x1={x} y1={H_K + H_V} x2={x} y2={H_K + H_V + 4} stroke="#cbd5e1" strokeWidth={0.5} />
            <text x={x} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#94a3b8">{label}</text>
          </g>
        ))}

        {/* ── 十字線（hover 時顯示） ── */}
        {hoverIdx !== null && (() => {
          const cx  = px(hoverIdx)
          const bar = dc[hoverIdx]
          const cy  = py(bar.close)
          return (
            <g>
              {/* 垂直虛線（貫穿整個 chart） */}
              <line x1={cx} y1={PAD.top} x2={cx} y2={H_K + H_V}
                stroke="#64748b" strokeWidth={0.8} strokeDasharray="3,2" opacity={0.6} />
              {/* 水平虛線（在 K 線區收盤位置） */}
              <line x1={PAD.left} y1={cy} x2={W - PAD.right} y2={cy}
                stroke="#64748b" strokeWidth={0.8} strokeDasharray="3,2" opacity={0.4} />
              {/* 收盤價標籤（右軸區 PAD.right 夠寬，不會超出 viewBox） */}
              <rect x={W - PAD.right + 2} y={cy - 6} width={36} height={12} fill="#64748b" rx={2} />
              <text x={W - PAD.right + 20} y={cy + 4} textAnchor="middle" fontSize={8} fill="white" fontWeight="bold">
                {bar.close.toFixed(bar.close >= 100 ? 1 : 2)}
              </text>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
