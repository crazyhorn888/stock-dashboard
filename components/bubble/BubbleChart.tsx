'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
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

const DEFAULT_VB = { x: 0, y: 0, w: W, h: H }

export default function BubbleChart({ sectors, onBubbleClick }: Props) {
  const [zoom, setZoom] = useState<QuadrantId>(null)
  const [top15Active, setTop15Active] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [vb, setVb] = useState(DEFAULT_VB)
  const svgRef = useRef<SVGSVGElement>(null)
  const touchRef = useRef<{
    type: 'pinch' | 'pan'
    dist?: number; cx?: number; cy?: number
    x0?: number; y0?: number
    vb: typeof DEFAULT_VB
  } | null>(null)
  const vbRef = useRef(vb)
  useEffect(() => { vbRef.current = vb }, [vb])

  const isZoomed = vb.w < W - 1 || vb.h < H - 1

  // ── SVG-space helpers for zoom math ─────────────────
  function svgPt(clientX: number, clientY: number, curVb = vbRef.current) {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width)  * curVb.w + curVb.x,
      y: ((clientY - rect.top)  / rect.height) * curVb.h + curVb.y,
    }
  }

  function applyZoom(cx: number, cy: number, factor: number, base = vbRef.current) {
    const nw = Math.max(W * 0.15, Math.min(W, base.w * factor))
    const nh = Math.max(H * 0.15, Math.min(H, base.h * factor))
    return {
      x: Math.max(0, Math.min(W - nw, cx - (cx - base.x) / base.w * nw)),
      y: Math.max(0, Math.min(H - nh, cy - (cy - base.y) / base.h * nh)),
      w: nw, h: nh,
    }
  }

  // ── Wheel (desktop zoom) ─────────────────────────────
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18
      const { x: cx, y: cy } = svgPt(e.clientX, e.clientY)
      setVb(applyZoom(cx, cy, factor))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Touch (mobile pinch + pan) ───────────────────────
  useEffect(() => {
    const el = svgRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1]
        touchRef.current = {
          type: 'pinch',
          dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
          cx: (t0.clientX + t1.clientX) / 2,
          cy: (t0.clientY + t1.clientY) / 2,
          vb: { ...vbRef.current },
        }
      } else if (e.touches.length === 1 && vbRef.current.w < W - 1) {
        touchRef.current = {
          type: 'pan',
          x0: e.touches[0].clientX,
          y0: e.touches[0].clientY,
          vb: { ...vbRef.current },
        }
      }
    }

    const onMove = (e: TouchEvent) => {
      e.preventDefault()
      const t = touchRef.current
      if (!t) return
      const rect = svgRef.current!.getBoundingClientRect()

      if (t.type === 'pinch' && e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1]
        const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
        const factor  = t.dist! / newDist
        const { x: cx, y: cy } = svgPt(t.cx!, t.cy!, t.vb)
        setVb(applyZoom(cx, cy, factor, t.vb))
      } else if (t.type === 'pan' && e.touches.length === 1) {
        const dx = ((e.touches[0].clientX - t.x0!) / rect.width)  * t.vb.w
        const dy = ((e.touches[0].clientY - t.y0!) / rect.height) * t.vb.h
        setVb({
          ...t.vb,
          x: Math.max(0, Math.min(W - t.vb.w, t.vb.x - dx)),
          y: Math.max(0, Math.min(H - t.vb.h, t.vb.y - dy)),
        })
      }
    }

    const onEnd = () => { touchRef.current = null }

    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove',  onMove,  { passive: false })
    el.addEventListener('touchend',   onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove',  onMove)
      el.removeEventListener('touchend',   onEnd)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const top15Set = useMemo(() => {
    const sorted = [...sectors].sort((a, b) => b.size - a.size).slice(0, 15)
    return new Set(sorted.map(s => s.sectorName))
  }, [sectors])

  const visibleSectors = useMemo(() => {
    let list = top15Active ? sectors.filter(s => top15Set.has(s.sectorName)) : sectors
    if (zoom) list = list.filter(s => quadrantOf(s.x, s.y) === zoom)
    return list
  }, [sectors, zoom, top15Active, top15Set])

  const zeroSVG = toSVG(0, 0, zoom, xRange, yRange)

  return (
    <div className="relative select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex gap-1.5 flex-wrap">
          {QUADRANTS.map(q => (
            <button
              key={q.id}
              onClick={() => { setZoom(zoom === q.id ? null : q.id); setVb(DEFAULT_VB) }}
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
          {/* 熱門 15 */}
          <button
            onClick={() => setTop15Active(v => !v)}
            className="px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all"
            style={{
              background: top15Active ? '#f59e0b' : '#fffbeb',
              borderColor: top15Active ? '#f59e0b' : '#fcd34d',
              color: top15Active ? '#fff' : '#d97706',
            }}
          >
            🔥 熱門 15
          </button>
        </div>
        <div className="flex items-center gap-2">
          {isZoomed && (
            <button
              onClick={() => setVb(DEFAULT_VB)}
              className="text-[10px] text-blue-500 font-medium border border-blue-200 rounded-full px-2 py-0.5"
            >
              重置
            </button>
          )}
          {zoom && (
            <button
              onClick={() => { setZoom(null); setVb(DEFAULT_VB) }}
              className="text-[10px] text-slate-400 underline"
            >
              全覽
            </button>
          )}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="w-full"
        style={{ touchAction: 'none', cursor: isZoomed ? 'grab' : 'default' }}
      >
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

            // 歷史軌跡：trail（oldest first）+ 當前位置
            const trailPts = (s.trail ?? []).map(p => toSVG(p.x, p.y, zoom, xRange, yRange))
            const allPts = [...trailPts, { px: spx, py: spy }]
            const trailLen = allPts.length

            return (
              <g
                key={s.sectorName}
                onClick={() => onBubbleClick(s)}
                onMouseEnter={() => setHovered(s.sectorName)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* 歷史軌跡：漸淡線段 + 漸淡小點 */}
                {trailLen >= 2 && (
                  <g style={{ pointerEvents: 'none' }}>
                    {allPts.slice(0, -1).map((pt, i) => {
                      const next = allPts[i + 1]
                      const ratio = i / Math.max(trailLen - 2, 1)
                      return (
                        <line key={i}
                          x1={pt.px} y1={pt.py} x2={next.px} y2={next.py}
                          stroke={q.color} strokeWidth={1.2} strokeLinecap="round"
                          opacity={0.12 + ratio * 0.35}
                        />
                      )
                    })}
                    {trailPts.map((pt, i) => {
                      const ratio = i / Math.max(trailLen - 2, 1)
                      return (
                        <circle key={i}
                          cx={pt.px} cy={pt.py} r={1.5 + ratio * 1.2}
                          fill={q.color} opacity={0.15 + ratio * 0.30}
                        />
                      )
                    })}
                  </g>
                )}
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
