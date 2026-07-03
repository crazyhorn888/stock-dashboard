'use client'
import { useState, useMemo } from 'react'
import type { SectorBubble } from '@/lib/types'

interface Props {
  sectors: SectorBubble[]
  onBubbleClick: (sector: SectorBubble) => void
}

const QUADRANTS = [
  { id: 'TL', label: '觀望', xSign: -1, ySign:  1, color: '#64748b', fill: '#f1f5f9', border: '#cbd5e1' },
  { id: 'TR', label: '漲潮', xSign:  1, ySign:  1, color: '#dc2626', fill: '#fff1f2', border: '#fca5a5' },
  { id: 'BL', label: '退潮', xSign: -1, ySign: -1, color: '#16a34a', fill: '#f0fdf4', border: '#86efac' },
  { id: 'BR', label: '輪動', xSign:  1, ySign: -1, color: '#d97706', fill: '#fffbeb', border: '#fcd34d' },
] as const

type QuadrantId = typeof QUADRANTS[number]['id'] | null

const W = 360
const H = 320
const PAD = { top: 28, right: 16, bottom: 28, left: 20 }
const CX = PAD.left + (W - PAD.left - PAD.right) / 2
const CY = PAD.top  + (H - PAD.top  - PAD.bottom) / 2

function quadrantOf(x: number, y: number): typeof QUADRANTS[number]['id'] {
  if (x >= 0 && y >= 0) return 'TR'
  if (x <  0 && y >= 0) return 'TL'
  if (x <  0 && y <  0) return 'BL'
  return 'BR'
}

function bubbleRadius(size: number, maxSize: number): number {
  if (maxSize === 0) return 6
  const minR = 8
  const maxR = 36
  return minR + Math.sqrt(size / maxSize) * (maxR - minR)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function toSVG(
  dx: number, dy: number,
  zoom: QuadrantId,
  xRange: [number, number],
  yRange: [number, number],
): { px: number; py: number } {
  const [xMin, xMax] = xRange
  const [yMin, yMax] = yRange
  const drawW = W - PAD.left - PAD.right
  const drawH = H - PAD.top  - PAD.bottom

  if (zoom) {
    const q = QUADRANTS.find(q => q.id === zoom)!
    const lxMin = q.xSign < 0 ? xMin : 0
    const lxMax = q.xSign < 0 ? 0 : xMax
    const lyMin = q.ySign < 0 ? yMin : 0
    const lyMax = q.ySign < 0 ? 0 : yMax
    const xSpan = (lxMax - lxMin) || 1
    const ySpan = (lyMax - lyMin) || 1
    return {
      px: PAD.left  + ((dx - lxMin) / xSpan) * drawW,
      py: H - PAD.bottom - ((dy - lyMin) / ySpan) * drawH,
    }
  }

  const xSpan = (xMax - xMin) || 1
  const ySpan = (yMax - yMin) || 1
  return {
    px: PAD.left  + ((dx - xMin) / xSpan) * drawW,
    py: H - PAD.bottom - ((dy - yMin) / ySpan) * drawH,
  }
}

export default function BubbleChart({ sectors, onBubbleClick }: Props) {
  const [zoom, setZoom] = useState<QuadrantId>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const maxSize = useMemo(
    () => Math.max(1, ...sectors.map(s => s.size)),
    [sectors],
  )

  const xRange = useMemo<[number, number]>(() => {
    const absMax = Math.max(1, ...sectors.map(s => Math.abs(s.x)))
    return [-absMax * 1.2, absMax * 1.2]
  }, [sectors])

  const yRange = useMemo<[number, number]>(() => {
    const absMax = Math.max(0.01, ...sectors.map(s => Math.abs(s.y)))
    return [-absMax * 1.2, absMax * 1.2]
  }, [sectors])

  const visibleSectors = useMemo(() => {
    if (!zoom) return sectors
    return sectors.filter(s => quadrantOf(s.x, s.y) === zoom)
  }, [sectors, zoom])

  const zeroSVG = toSVG(0, 0, zoom, xRange, yRange)

  return (
    <div className="relative select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex gap-1.5">
          {QUADRANTS.map(q => (
            <button
              key={q.id}
              onClick={() => setZoom(zoom === q.id ? null : q.id)}
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all"
              style={{
                background: zoom === q.id ? q.color : q.fill,
                borderColor: zoom === q.id ? q.color : q.border,
                color: zoom === q.id ? '#fff' : q.color,
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
        {zoom && (
          <button
            onClick={() => setZoom(null)}
            className="text-[10px] text-slate-400 underline"
          >
            全覽
          </button>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ touchAction: 'none' }}>
        {/* Quadrant backgrounds */}
        {!zoom ? QUADRANTS.map(q => {
          const x1 = q.xSign < 0 ? PAD.left : CX
          const y1 = q.ySign > 0 ? PAD.top  : CY
          const w  = (W - PAD.left - PAD.right) / 2
          const h  = (H - PAD.top  - PAD.bottom) / 2
          return (
            <g key={q.id}>
              <rect x={x1} y={y1} width={w} height={h}
                fill={q.fill} className="cursor-pointer"
                onClick={() => setZoom(q.id)} />
              {/* Corner label */}
              <text
                x={x1 + (q.xSign < 0 ? 5 : w - 5)}
                y={y1 + (q.ySign > 0 ? 13 : h - 5)}
                fontSize={9.5} fontWeight="700"
                fill={q.color} opacity="0.6"
                textAnchor={q.xSign < 0 ? 'start' : 'end'}
                className="cursor-pointer pointer-events-none"
              >
                {q.label}
              </text>
            </g>
          )
        }) : (() => {
          const q = QUADRANTS.find(q => q.id === zoom)!
          return <rect x={PAD.left} y={PAD.top}
            width={W - PAD.left - PAD.right}
            height={H - PAD.top - PAD.bottom}
            fill={q.fill} />
        })()}

        {/* Axes */}
        <line
          x1={zoom ? PAD.left : zeroSVG.px} y1={PAD.top}
          x2={zoom ? PAD.left : zeroSVG.px} y2={H - PAD.bottom}
          stroke="#94a3b8" strokeWidth={zoom ? 0 : 0.8} strokeDasharray="0"
        />
        <line
          x1={PAD.left} y1={zoom ? H - PAD.bottom : zeroSVG.py}
          x2={W - PAD.right} y2={zoom ? H - PAD.bottom : zeroSVG.py}
          stroke="#94a3b8" strokeWidth={zoom ? 0 : 0.8}
        />

        {/* Axis labels */}
        <text x={W - PAD.right - 2} y={H - 6}  fontSize={8} fill="#94a3b8" textAnchor="end">買超 →</text>
        <text x={PAD.left + 2}       y={H - 6}  fontSize={8} fill="#94a3b8" textAnchor="start">← 賣超</text>
        <text x={PAD.left - 2}       y={PAD.top + 8} fontSize={8} fill="#94a3b8" textAnchor="middle"
          transform={`rotate(-90 ${PAD.left - 12} ${PAD.top + (H - PAD.top - PAD.bottom) / 2})`}>加速 ↑</text>
        <text x={PAD.left - 2}       y={H - PAD.bottom - 4} fontSize={8} fill="#94a3b8" textAnchor="middle"
          transform={`rotate(-90 ${PAD.left - 12} ${H - PAD.bottom - 40})`}>↓ 放緩</text>

        {/* Bubbles — render from small to large so big ones are on top */}
        {[...visibleSectors]
          .sort((a, b) => a.size - b.size)
          .map(s => {
            const { px, py } = toSVG(s.x, s.y, zoom, xRange, yRange)
            const r = bubbleRadius(s.size, maxSize)
            const spx = clamp(px, PAD.left + r + 1, W - PAD.right - r - 1)
            const spy = clamp(py, PAD.top  + r + 1, H - PAD.bottom - r - 1)
            const q = QUADRANTS.find(q => q.id === quadrantOf(s.x, s.y))!
            const isHovered = hovered === s.sectorName
            const shortName = s.sectorName
              .replace('及週邊設備業', '週邊')
              .replace('工業', '')
              .replace('業', '')

            return (
              <g
                key={s.sectorName}
                onClick={() => onBubbleClick(s)}
                onMouseEnter={() => setHovered(s.sectorName)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Drop shadow circle */}
                <circle cx={spx + 1} cy={spy + 1.5} r={r}
                  fill="#00000018" />
                {/* Main bubble */}
                <circle cx={spx} cy={spy} r={r}
                  fill={isHovered ? q.color : q.fill}
                  stroke={q.color}
                  strokeWidth={isHovered ? 2.5 : 1.8}
                  opacity={isHovered ? 1 : 0.9}
                />
                {/* Label inside bubble (if big enough) */}
                {r >= 16 ? (
                  <text
                    x={spx} y={spy + 3}
                    fontSize={r >= 22 ? 8.5 : 7.5}
                    fill={isHovered ? '#fff' : q.color}
                    textAnchor="middle"
                    fontWeight="700"
                    style={{ pointerEvents: 'none' }}
                  >
                    {shortName}
                  </text>
                ) : (
                  /* Tiny bubbles: label below */
                  <text
                    x={spx} y={spy + r + 9}
                    fontSize={7}
                    fill={q.color}
                    textAnchor="middle"
                    fontWeight="600"
                    opacity="0.85"
                    style={{ pointerEvents: 'none' }}
                  >
                    {shortName}
                  </text>
                )}
              </g>
            )
          })}
      </svg>

      <p className="text-center text-[10px] text-slate-400 pb-2">
        {zoom ? '點擊泡泡查看個股' : '點擊象限或上方按鈕放大 · 點擊泡泡查看個股'}
      </p>
    </div>
  )
}
