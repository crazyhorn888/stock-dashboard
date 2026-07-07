'use client'
import { useMemo } from 'react'

export type Period = 'D' | 'W' | 'M'

interface OHLCBar { date: string; open: number; high: number; low: number; close: number }

interface Props {
  closes:   number[]   // newest first
  dates:    string[]   // YYYY-MM-DD, newest first
  n:        number     // N 天參考區間（距高/距低標記用）
  period:   Period
  ohlcBars: OHLCBar[] | null  // 日K OHLC（newest first），null = 尚未載入或無資料
}

const W = 600
const H = 230
const PAD = { top: 12, right: 14, bottom: 32, left: 50 }
const CW = W - PAD.left - PAD.right
const CH = H - PAD.top  - PAD.bottom

// MA 線設定（不同 period 使用不同週期）
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

// 把 closes/dates（newest first）聚合成週或月 OHLC bars
function aggregateBars(closes: number[], dates: string[], period: 'W' | 'M'): OHLCBar[] {
  // 先轉成 oldest→newest 方便分組
  const dc = closes.slice(0, 250).reverse()
  const dd = dates.slice(0, 250).reverse()

  const groups: { key: string; bars: { c: number; d: string }[] }[] = []

  for (let i = 0; i < dc.length; i++) {
    const date = dd[i]
    const key = period === 'W'
      ? isoWeekKey(date)   // YYYY-Www
      : date.slice(0, 7)   // YYYY-MM

    if (groups.length === 0 || groups[groups.length - 1].key !== key) {
      groups.push({ key, bars: [] })
    }
    groups[groups.length - 1].bars.push({ c: dc[i], d: date })
  }

  // 每個 group → 一根 OHLC
  return groups
    .filter(g => g.bars.length > 0)
    .map(g => {
      const prices = g.bars.map(b => b.c)
      return {
        date:  g.bars[g.bars.length - 1].d,  // 末日日期代表這根棒
        open:  g.bars[0].c,
        high:  Math.max(...prices),
        low:   Math.min(...prices),
        close: g.bars[g.bars.length - 1].c,
      }
    })
    .reverse()  // newest first
}

function isoWeekKey(dateISO: string): string {
  const d = new Date(dateISO)
  const day = d.getDay() || 7  // Mon=1, Sun=7
  d.setDate(d.getDate() + 4 - day)  // nearest Thursday
  const year = d.getFullYear()
  const startOfYear = new Date(year, 0, 1)
  const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

export default function StockKChart({ closes, dates, n, period, ohlcBars }: Props) {
  const MA_LINES = MA_CONFIG[period]

  // 取得用於渲染的 bars
  const bars = useMemo<OHLCBar[]>(() => {
    if (period === 'D') {
      if (ohlcBars && ohlcBars.length > 0) return ohlcBars.slice(0, 120)
      // fallback：無 OHLC 時用收盤價建假 candle（doji）
      return closes.slice(0, 120).map((c, i) => ({
        date: dates[i] ?? '',
        open: c, high: c, low: c, close: c,
      })).filter(b => b.date)
    }
    if (period === 'W') return aggregateBars(closes, dates, 'W').slice(0, 60)
    return aggregateBars(closes, dates, 'M').slice(0, 36)
  }, [period, ohlcBars, closes, dates])

  const chart = useMemo(() => {
    if (bars.length === 0) return null

    const dc = [...bars].reverse()  // oldest → newest (left → right)
    const COUNT = dc.length

    // N-day 高低（用 closes 原始陣列，跟 MarketSignalCards 同一邏輯）
    const nSlice = closes.slice(0, Math.min(n, closes.length))
    const nHigh = Math.max(...nSlice)
    const nLow  = Math.min(...nSlice)

    // MA 計算（對齊 bars 陣列，index i = 對應到 bars[COUNT-1-i]，newest=bars[0]）
    function getMA(i: number, p: number): number | null {
      // bars 是 newest-first，dc 是 oldest-first
      // dc[i] 對應到 bars[COUNT-1-i]
      const barsIdx = COUNT - 1 - i
      const slice = bars.slice(barsIdx, barsIdx + p).map(b => b.close)
      if (slice.length < p) return null
      return slice.reduce((s, v) => s + v, 0) / p
    }
    const maValues = MA_LINES.map(({ period: p }) => dc.map((_, i) => getMA(i, p)))

    // Y range
    const allH = Math.max(...dc.map(b => b.high))
    const allL = Math.min(...dc.map(b => b.low))
    const maFlat = maValues.flat().filter((v): v is number => v !== null)
    const yMin = Math.min(allL, ...maFlat, nLow) * 0.995
    const yMax = Math.max(allH, ...maFlat, nHigh) * 1.005

    function px(i: number) { return PAD.left + (i + 0.5) * (CW / COUNT) }
    function py(v: number) { return PAD.top + CH - ((v - yMin) / (yMax - yMin)) * CH }

    const barW = Math.max(1.2, (CW / COUNT) * 0.72)

    // MA paths
    const maPaths = maValues.map(vals => {
      let d = ''
      vals.forEach((v, i) => {
        if (v === null) return
        d += (d === '' ? 'M' : 'L') + `${px(i).toFixed(1)},${py(v).toFixed(1)}`
      })
      return d
    })

    // Y-axis ticks
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const v = yMin + (i / 4) * (yMax - yMin)
      return { v, y: py(v) }
    })

    // X-axis ticks
    const step = Math.ceil(COUNT / 5)
    const xTicks = dc.map((_, i) => i)
      .filter(i => i === 0 || (i + 1) % step === 0 || i === COUNT - 1)
      .map(i => ({
        i,
        x: px(i),
        label: period === 'D' ? dc[i].date.slice(5)           // MM-DD
             : period === 'W' ? dc[i].date.slice(0, 7).slice(2)  // YY-MM
             : dc[i].date.slice(0, 7),                          // YYYY-MM
      }))

    return { dc, COUNT, px, py, barW, maPaths, nHigh, nLow, yTicks, xTicks, yMin, yMax }
  }, [bars, closes, n, MA_LINES, period])

  const isDoji = period === 'D' && (!ohlcBars || ohlcBars.length === 0)
  const periodLabel = period === 'D' ? `日K 近 ${bars.length} 天` : period === 'W' ? `週K 近 ${bars.length} 週` : `月K 近 ${bars.length} 月`

  if (!chart) return (
    <div className="h-40 flex items-center justify-center text-slate-400 text-xs">無資料</div>
  )

  const { dc, px, py, barW, maPaths, nHigh, nLow, yTicks, xTicks } = chart

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1.5 px-1 items-center">
        {MA_LINES.map(({ label, color }) => (
          <span key={label} className="text-[10px] font-semibold" style={{ color }}>{label}</span>
        ))}
        <span className="text-[10px] text-slate-400 ml-auto">{periodLabel}</span>
        {isDoji && (
          <span className="text-[9px] text-amber-500 w-full">上櫃・日K 資料建置中，顯示收盤走勢</span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 250 }}>
        {/* Y grid + ticks */}
        {yTicks.map(({ v, y }) => (
          <g key={v}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={PAD.left - 4} y={y + 3.5} textAnchor="end" fontSize={9} fill="#94a3b8">
              {v.toFixed(v >= 1000 ? 0 : 1)}
            </text>
          </g>
        ))}

        {/* X-axis ticks */}
        {xTicks.map(({ i, x, label }) => (
          <g key={i}>
            <line x1={x} y1={PAD.top + CH} x2={x} y2={PAD.top + CH + 4} stroke="#cbd5e1" strokeWidth={0.5} />
            <text x={x} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#94a3b8">{label}</text>
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
          const cx     = px(i)
          const isUp   = bar.close >= bar.open
          const color  = isDoji ? '#94a3b8'  // 折線色（無 OHLC 時）
                       : isUp  ? '#ef4444'
                       :         '#22c55e'
          const bodyTop = py(Math.max(bar.open, bar.close))
          const bodyBot = py(Math.min(bar.open, bar.close))
          const bodyH   = Math.max(bodyBot - bodyTop, isDoji ? 0 : 0.8)
          const wickT   = py(bar.high)
          const wickB   = py(bar.low)
          const isLast  = i === dc.length - 1

          return (
            <g key={bar.date}>
              {/* 影線（doji 模式略去上下影線） */}
              {!isDoji && (
                <line x1={cx} y1={wickT} x2={cx} y2={wickB} stroke={color} strokeWidth={0.9} />
              )}
              {/* 實體（doji 模式畫折線點） */}
              {isDoji
                ? <circle cx={cx} cy={bodyTop} r={1.2} fill={color} />
                : <rect x={cx - barW / 2} y={bodyTop} width={barW} height={bodyH} fill={color} rx={0.5} />
              }
              {/* 最新一根標記 */}
              {isLast && (
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
      </svg>
    </div>
  )
}
