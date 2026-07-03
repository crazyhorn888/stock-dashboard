'use client'
import { useMemo } from 'react'

interface Props {
  closes: number[]   // newest first, index 0 = today
  dates:  string[]   // YYYY-MM-DD, newest first
  n:      number     // N 天參考區間
}

const W = 600
const H = 220
const PAD = { top: 12, right: 14, bottom: 32, left: 50 }
const CW = W - PAD.left - PAD.right   // 536
const CH = H - PAD.top  - PAD.bottom  // 176

const MA_LINES = [
  { period: 5,   color: '#f59e0b', label: 'MA5'   },
  { period: 10,  color: '#f97316', label: 'MA10'  },
  { period: 20,  color: '#3b82f6', label: 'MA20'  },
  { period: 120, color: '#a855f7', label: 'MA120' },
] as const

export default function StockKChart({ closes, dates, n }: Props) {
  const DISPLAY = Math.min(120, closes.length)

  const chart = useMemo(() => {
    if (closes.length === 0) return null

    // displayCloses[i] = oldest → newest (left → right on chart)
    const dc = closes.slice(0, DISPLAY).reverse()
    const dd = dates.slice(0, DISPLAY).reverse()

    // MA at display index i: look into original closes (newest first)
    // original index of display[i] = DISPLAY - 1 - i
    function getMA(i: number, period: number): number | null {
      const start = DISPLAY - 1 - i
      const slice = closes.slice(start, start + period)
      if (slice.length < period) return null
      return slice.reduce((s, v) => s + v, 0) / period
    }

    const maValues = MA_LINES.map(({ period }) =>
      dc.map((_, i) => getMA(i, period))
    )

    // N-day high/low (from full closes array)
    const nSlice = closes.slice(0, Math.min(n, closes.length))
    const nHigh = Math.max(...nSlice)
    const nLow  = Math.min(...nSlice)

    // Y range: all closes + MAs + N-high/low
    const allVals = [
      ...dc,
      ...maValues.flat().filter((v): v is number => v !== null),
      nHigh, nLow,
    ]
    const yMin = Math.min(...allVals) * 0.995
    const yMax = Math.max(...allVals) * 1.005

    function px(i: number) { return PAD.left + (i / (DISPLAY - 1)) * CW }
    function py(v: number) { return PAD.top + CH - ((v - yMin) / (yMax - yMin)) * CH }

    // Close price polyline
    const closePath = dc.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')

    // MA polylines (skip nulls)
    const maPaths = maValues.map(vals => {
      let d = ''
      vals.forEach((v, i) => {
        if (v === null) return
        d += (d === '' ? 'M' : 'L') + `${px(i).toFixed(1)},${py(v).toFixed(1)}`
      })
      return d
    })

    // Y-axis ticks (5 evenly spaced)
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const v = yMin + (i / 4) * (yMax - yMin)
      return { v, y: py(v) }
    })

    // X-axis ticks (every ~20 days)
    const step = Math.ceil(DISPLAY / 5)
    const xTicks = dc.map((_, i) => i).filter(i => i === 0 || (i + 1) % step === 0 || i === DISPLAY - 1)
      .map(i => ({ i, x: px(i), label: dd[i]?.slice(5) ?? '' }))  // MM-DD

    return { dc, dd, px, py, closePath, maPaths, nHigh, nLow, yTicks, xTicks, yMin, yMax }
  }, [closes, dates, n, DISPLAY])

  if (!chart) return <div className="h-40 flex items-center justify-center text-slate-400 text-xs">無資料</div>

  const { closePath, maPaths, nHigh, nLow, yTicks, xTicks, py, px, dc } = chart

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-2 px-1">
        <span className="text-[10px] text-slate-500">收盤</span>
        {MA_LINES.map(({ label, color }) => (
          <span key={label} className="text-[10px] font-semibold" style={{ color }}>{label}</span>
        ))}
        <span className="text-[10px] text-slate-400 ml-auto">近 {DISPLAY} 日</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
        {/* Y grid + ticks */}
        {yTicks.map(({ v, y }) => (
          <g key={v}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={PAD.left - 4} y={y + 3.5} textAnchor="end" fontSize={9} fill="#94a3b8">
              {v.toFixed(v >= 1000 ? 0 : 1)}
            </text>
          </g>
        ))}

        {/* X axis ticks */}
        {xTicks.map(({ i, x, label }) => (
          <g key={i}>
            <line x1={x} y1={PAD.top + CH} x2={x} y2={PAD.top + CH + 4} stroke="#cbd5e1" strokeWidth={0.5} />
            <text x={x} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#94a3b8">{label}</text>
          </g>
        ))}

        {/* N-day high/low dashed lines */}
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

        {/* Close line */}
        <path d={closePath} fill="none" stroke="#94a3b8" strokeWidth={1.2} strokeLinejoin="round" />

        {/* MA lines */}
        {MA_LINES.map(({ color, label }, idx) => (
          maPaths[idx] ? (
            <path key={label} d={maPaths[idx]} fill="none" stroke={color} strokeWidth={1.1} strokeLinejoin="round" />
          ) : null
        ))}

        {/* Today dot */}
        <circle cx={px(dc.length - 1)} cy={py(dc[dc.length - 1])} r={3}
          fill="#3b82f6" stroke="white" strokeWidth={1.2} />
      </svg>
    </div>
  )
}
