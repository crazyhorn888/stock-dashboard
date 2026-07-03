'use client'
import { useState, useMemo } from 'react'
import type { SectorBubble } from '@/lib/types'

interface Props {
  sectors: SectorBubble[]
  onBubbleClick: (sector: SectorBubble) => void
}

// Quadrant config
const QUADRANTS = [
  { id: 'TL', label: '觀望', x: -1, y:  1, color: '#94a3b8', bg: '#f1f5f9' },
  { id: 'TR', label: '漲潮', x:  1, y:  1, color: '#ef4444', bg: '#fef2f2' },
  { id: 'BL', label: '退潮', x: -1, y: -1, color: '#22c55e', bg: '#f0fdf4' },
  { id: 'BR', label: '輪動', x:  1, y: -1, color: '#f59e0b', bg: '#fffbeb' },
] as const

type QuadrantId = typeof QUADRANTS[number]['id'] | null

const W = 360
const H = 300
const PAD = { top: 18, right: 14, bottom: 24, left: 32 }
const CX = PAD.left + (W - PAD.left - PAD.right) / 2
const CY = PAD.top  + (H - PAD.top  - PAD.bottom) / 2

function bubbleRadius(size: number, maxSize: number): number {
  if (maxSize === 0) return 4
  return 4 + (size / maxSize) * 18
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Map data coord (x=buy/sell千張, y=accel) → SVG px, optionally zoom into one quadrant */
function toSVG(
  dx: number, dy: number,
  zoom: QuadrantId,
  xRange: [number, number],
  yRange: [number, number],
): { px: number; py: number } {
  const [xMin, xMax] = xRange
  const [yMin, yMax] = yRange

  let px: number
  let py: number

  if (zoom) {
    const q = QUADRANTS.find(q => q.id === zoom)!
    // Map one quadrant to full canvas area
    const localXMin = q.x < 0 ? xMin : 0
    const localXMax = q.x < 0 ? 0 : xMax
    const localYMin = q.y < 0 ? yMin : 0
    const localYMax = q.y < 0 ? 0 : yMax
    const xSpan = localXMax - localXMin || 1
    const ySpan = localYMax - localYMin || 1
    px = PAD.left  + ((dx - localXMin) / xSpan) * (W - PAD.left - PAD.right)
    py = H - PAD.bottom - ((dy - localYMin) / ySpan) * (H - PAD.top - PAD.bottom)
  } else {
    const xSpan = (xMax - xMin) || 1
    const ySpan = (yMax - yMin) || 1
    px = PAD.left  + ((dx - xMin) / xSpan) * (W - PAD.left - PAD.right)
    py = H - PAD.bottom - ((dy - yMin) / ySpan) * (H - PAD.top - PAD.bottom)
  }

  return { px, py }
}

function quadrantOf(x: number, y: number): QuadrantId {
  if (x >= 0 && y >= 0) return 'TR'
  if (x <  0 && y >= 0) return 'TL'
  if (x <  0 && y <  0) return 'BL'
  return 'BR'
}

export default function BubbleChart({ sectors, onBubbleClick }: Props) {
  const [zoom, setZoom] = useState<QuadrantId>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const maxSize = useMemo(
    () => Math.max(1, ...sectors.map(s => s.size)),
    [sectors],
  )

  const xRange = useMemo<[number, number]>(() => {
    const xs = sectors.map(s => s.x)
    const absMax = Math.max(1, ...xs.map(Math.abs))
    return [-absMax * 1.15, absMax * 1.15]
  }, [sectors])

  const yRange = useMemo<[number, number]>(() => {
    const ys = sectors.map(s => s.y)
    const absMax = Math.max(0.01, ...ys.map(Math.abs))
    return [-absMax * 1.15, absMax * 1.15]
  }, [sectors])

  const visibleSectors = useMemo(() => {
    if (!zoom) return sectors
    return sectors.filter(s => quadrantOf(s.x, s.y) === zoom)
  }, [sectors, zoom])

  const zeroSVG = toSVG(0, 0, zoom, xRange, yRange)

  return (
    <div className="relative select-none">
      {/* Zoom indicator + 全圖 button */}
      {zoom && (
        <div className="flex items-center justify-between px-3 py-1.5 text-xs text-slate-500">
          <span>
            {QUADRANTS.find(q => q.id === zoom)?.label} 象限
          </span>
          <button
            onClick={() => setZoom(null)}
            className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-medium"
          >
            全圖
          </button>
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ touchAction: 'none' }}
      >
        {/* Quadrant backgrounds (overview only) */}
        {!zoom && QUADRANTS.map(q => {
          const x1 = q.x < 0 ? PAD.left : CX
          const y1 = q.y > 0 ? PAD.top  : CY
          const w  = (W - PAD.left - PAD.right) / 2
          const h  = (H - PAD.top  - PAD.bottom) / 2
          return (
            <g key={q.id}>
              <rect
                x={x1} y={y1} width={w} height={h}
                fill={q.bg}
                className="cursor-pointer"
                onClick={() => setZoom(q.id)}
              />
              <text
                x={x1 + (q.x < 0 ? 6 : w - 6)}
                y={y1 + (q.y > 0 ? 12 : h - 5)}
                fontSize={10}
                fill={q.color}
                textAnchor={q.x < 0 ? 'start' : 'end'}
                fontWeight="600"
                className="cursor-pointer"
                onClick={() => setZoom(q.id)}
              >
                {q.label}
              </text>
            </g>
          )
        })}

        {/* Single quadrant bg (zoom mode) */}
        {zoom && (() => {
          const q = QUADRANTS.find(q => q.id === zoom)!
          return (
            <rect
              x={PAD.left} y={PAD.top}
              width={W - PAD.left - PAD.right}
              height={H - PAD.top - PAD.bottom}
              fill={q.bg}
            />
          )
        })()}

        {/* Axes */}
        <line
          x1={zoom ? PAD.left : zeroSVG.px} y1={PAD.top}
          x2={zoom ? PAD.left : zeroSVG.px} y2={H - PAD.bottom}
          stroke="#cbd5e1" strokeWidth={1}
        />
        <line
          x1={PAD.left} y1={zoom ? H - PAD.bottom : zeroSVG.py}
          x2={W - PAD.right} y2={zoom ? H - PAD.bottom : zeroSVG.py}
          stroke="#cbd5e1" strokeWidth={1}
        />

        {/* Axis labels */}
        <text x={W - PAD.right} y={H - PAD.bottom + 14} fontSize={9} fill="#94a3b8" textAnchor="end">買超 →</text>
        <text x={PAD.left}      y={H - PAD.bottom + 14} fontSize={9} fill="#94a3b8" textAnchor="start">← 賣超</text>
        <text x={PAD.left - 4}  y={PAD.top + 2}         fontSize={9} fill="#94a3b8" textAnchor="middle" transform={`rotate(-90, ${PAD.left - 14}, ${PAD.top + (H - PAD.top - PAD.bottom) / 2})`}>加速 ↑</text>
        <text x={PAD.left - 4}  y={H - PAD.bottom - 2}  fontSize={9} fill="#94a3b8" textAnchor="middle" transform={`rotate(-90, ${PAD.left - 14}, ${H - PAD.bottom - 20})`}>↓ 放緩</text>

        {/* Bubbles */}
        {visibleSectors.map(s => {
          const { px, py } = toSVG(s.x, s.y, zoom, xRange, yRange)
          const r = bubbleRadius(s.size, maxSize)
          const spx = clamp(px, PAD.left + r + 1, W - PAD.right - r - 1)
          const spy = clamp(py, PAD.top  + r + 1, H - PAD.bottom - r - 1)
          const q = QUADRANTS.find(q => q.id === quadrantOf(s.x, s.y))!
          const isHovered = hovered === s.sectorName

          return (
            <g
              key={s.sectorName}
              onClick={() => onBubbleClick(s)}
              onMouseEnter={() => setHovered(s.sectorName)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle
                cx={spx} cy={spy} r={r}
                fill={q.color}
                fillOpacity={isHovered ? 0.85 : 0.55}
                stroke={q.color}
                strokeWidth={isHovered ? 1.5 : 0.8}
              />
              {(r >= 8 || isHovered) && (
                <text
                  x={spx} y={spy + 3}
                  fontSize={isHovered ? 8 : 7}
                  fill="#1e293b"
                  textAnchor="middle"
                  fontWeight={isHovered ? '700' : '500'}
                  style={{ pointerEvents: 'none' }}
                >
                  {s.sectorName.replace('工業', '').replace('業', '')}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Overview quadrant tap hint */}
      {!zoom && (
        <p className="text-center text-[10px] text-slate-400 mt-0.5">
          點擊象限放大 · 點擊泡泡查看個股
        </p>
      )}
    </div>
  )
}
