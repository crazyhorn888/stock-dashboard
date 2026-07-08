'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import type { SectorBubble } from '@/lib/types'

interface Props {
  sectors: SectorBubble[]
  onBubbleClick: (sector: SectorBubble) => void
  frames?: SectorBubble[][]   // [today, yesterday, ...] newest first
  frameDates?: string[]       // ISO dates 對應每個 frame
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

// P1-4：X 軸 symlog 轉換（linthresh = 1 億）。
// 板塊資金量級差距上百倍，線性刻度會把小板塊全部擠在原點附近；
// symlog 在 ±1 億內近似線性、之外按 10 倍壓縮，保留正負號與象限語意。
function symX(v: number): number {
  return Math.sign(v) * Math.log10(1 + Math.abs(v))
}

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

// ── Collision resolution ──────────────────────────────────────────────────
function resolveCollisions(
  pts: { px: number; py: number; r: number }[],
  iters = 18,
): { px: number; py: number }[] {
  const p = pts.map(({ px, py, r }) => ({ px, py, r }))
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const dx  = p[j].px - p[i].px
        const dy  = p[j].py - p[i].py
        const d   = Math.hypot(dx, dy) || 0.001
        const min = p[i].r + p[j].r + 2
        if (d < min) {
          const nx = dx / d
          const ny = dy / d
          const push = (min - d) * 0.5
          // Smaller bubble yields more
          const wi = p[j].r / (p[i].r + p[j].r)
          const wj = 1 - wi
          p[i].px -= nx * push * wi * 1.6
          p[i].py -= ny * push * wi * 1.6
          p[j].px += nx * push * wj * 1.6
          p[j].py += ny * push * wj * 1.6
        }
      }
    }
  }
  return p
}

export default function BubbleChart({ sectors, onBubbleClick, frames, frameDates }: Props) {
  const [zoom, setZoom] = useState<QuadrantId>(null)
  const [top15Active, setTop15Active] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [clicked, setClicked] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [vb, setVb] = useState(DEFAULT_VB)
  const [frameIdx, setFrameIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const touchRef = useRef<{
    type: 'pinch' | 'pan'
    dist?: number; cx?: number; cy?: number
    x0?: number; y0?: number
    vb: typeof DEFAULT_VB
  } | null>(null)
  const vbRef = useRef(vb)
  useEffect(() => { vbRef.current = vb }, [vb])
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // 回放自動播放（oldest → today）
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => {
      setFrameIdx(i => {
        if (i <= 0) { setIsPlaying(false); return 0 }
        return i - 1
      })
    }, 800)
    return () => clearInterval(id)
  }, [isPlaying])

  // 切換 zoom 時重置 frameIdx
  useEffect(() => { setFrameIdx(0) }, [zoom])

  function handleBubbleClick(s: SectorBubble) {
    setClicked(s.sectorName)
    setTimeout(() => {
      setClicked(null)
      onBubbleClick(s)
    }, 160)
  }

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

  // 目前顯示的 sectors：回放時用 frames[frameIdx]，否則用 sectors prop
  const hasFrames = frames && frames.length > 1
  const clampedIdx = hasFrames ? Math.min(frameIdx, frames.length - 1) : 0
  const activeSectors = hasFrames ? (frames[clampedIdx] ?? sectors) : sectors

  const maxSize = useMemo(
    () => Math.max(1, ...activeSectors.map(s => s.size)),
    [activeSectors],
  )

  // top15Set / visibleSectors 必須在 xRange/yRange 之前，讓 zoom 模式能以可見 sectors 計算 range
  const top15Set = useMemo(() => {
    const sorted = [...activeSectors].sort((a, b) => b.size - a.size).slice(0, 15)
    return new Set(sorted.map(s => s.sectorName))
  }, [activeSectors])

  const visibleSectors = useMemo(() => {
    let list = top15Active ? activeSectors.filter(s => top15Set.has(s.sectorName)) : activeSectors
    if (zoom) list = list.filter(s => quadrantOf(s.x, s.y) === zoom)
    return list
  }, [activeSectors, zoom, top15Active, top15Set])

  // zoom 模式用可見 sectors 的 range，讓泡泡充分展開；全覽用全部 sectors
  const xRange = useMemo<[number, number]>(() => {
    const src = zoom ? visibleSectors : activeSectors
    // symlog 空間中的對稱範圍（見 symX）
    const absMax = Math.max(0.5, ...src.map(s => Math.abs(symX(s.x))))
    return [-absMax * 1.1, absMax * 1.1]
  }, [activeSectors, visibleSectors, zoom])

  const yRange = useMemo<[number, number]>(() => {
    const src = zoom ? visibleSectors : activeSectors
    const absMax = Math.max(0.01, ...src.map(s => Math.abs(s.y)))
    return [-absMax * 1.2, absMax * 1.2]
  }, [activeSectors, visibleSectors, zoom])

  // 預先計算 SVG 位置並解決重疊；collision 後再次 clamp 避免泡泡溢出 SVG
  const resolvedBubbles = useMemo(() => {
    const sorted = [...visibleSectors].sort((a, b) => a.size - b.size)
    const raw = sorted.map(s => {
      const { px, py } = toSVG(symX(s.x), s.y, zoom, xRange, yRange)
      const r = bubbleRadius(s.size, maxSize)
      return { s, px: clamp(px, PAD.left + r + 1, W - PAD.right - r - 1), py: clamp(py, PAD.top + r + 1, H - PAD.bottom - r - 1), r }
    })
    const resolved = resolveCollisions(raw.map(({ px, py, r }) => ({ px, py, r })))
    return raw.map((item, i) => ({
      ...item,
      rpx: clamp(resolved[i].px, PAD.left + item.r + 1, W - PAD.right - item.r - 1),
      rpy: clamp(resolved[i].py, PAD.top  + item.r + 1, H - PAD.bottom - item.r - 1),
    }))
  }, [visibleSectors, zoom, xRange, yRange, maxSize])

  const zeroSVG = toSVG(0, 0, zoom, xRange, yRange)

  const isHistorical = clampedIdx > 0
  const frameLabel = hasFrames
    ? clampedIdx === 0
      ? '今日'
      : `${frameDates?.[clampedIdx]?.slice(5).replace('-', '/')} (${clampedIdx}天前)`
    : ''

  function handlePlay() {
    if (isPlaying) { setIsPlaying(false); return }
    if (clampedIdx === 0 && hasFrames) setFrameIdx((frames?.length ?? 1) - 1)
    setIsPlaying(true)
  }

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

      {/* 歷史回放列 */}
      {hasFrames && (
        <div className={`flex items-center gap-2 px-3 pb-2 ${isHistorical ? 'bg-amber-50' : ''}`}>
          <button
            onClick={handlePlay}
            title={isPlaying ? '暫停' : '播放歷史回放'}
            className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs border transition-colors ${
              isPlaying ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 text-slate-500 hover:border-amber-400 hover:text-amber-600'
            }`}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={(frames?.length ?? 1) - 1}
            value={(frames?.length ?? 1) - 1 - clampedIdx}
            onChange={e => {
              setIsPlaying(false)
              setFrameIdx((frames?.length ?? 1) - 1 - Number(e.target.value))
            }}
            className="flex-1 accent-amber-500 h-1.5"
          />
          <span className={`text-[10px] font-semibold min-w-[72px] text-right ${isHistorical ? 'text-amber-600' : 'text-blue-500'}`}>
            {frameLabel}
          </span>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="w-full"
        style={{ touchAction: 'none', cursor: isZoomed ? 'grab' : 'default' }}
      >
        <defs>
          <style>{`
            @keyframes bubbleIn {
              from { opacity: 0; }
              55%  { opacity: 0; }
              to   { opacity: 1; }
            }
          `}</style>
          {QUADRANTS.map(q => (
            <marker key={q.id} id={`trailArrow-${q.id}`}
              markerWidth="6" markerHeight="6"
              refX="5" refY="3" orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0,0 L0,6 L6,3 z" fill={q.color} opacity={0.55} />
            </marker>
          ))}
        </defs>

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

        {/* Axes — 延伸至 SVG 邊界，讓泡泡與邊界之間的留白顯示出象限意象 */}
        <line
          x1={zeroSVG.px} y1={0}
          x2={zeroSVG.px} y2={H}
          stroke="#94a3b8" strokeWidth={0.8}
        />
        <line
          x1={0} y1={zeroSVG.py}
          x2={W} y2={zeroSVG.py}
          stroke="#94a3b8" strokeWidth={0.8}
        />

        {/* Axis labels */}
        <text x={W - PAD.right - 2} y={H - 6}  fontSize={8} fill="#94a3b8" textAnchor="end">買超（億/日）→</text>
        <text x={PAD.left + 2}       y={H - 6}  fontSize={8} fill="#94a3b8" textAnchor="start">← 賣超（億/日）</text>
        <text x={PAD.left - 2}       y={PAD.top + 8} fontSize={8} fill="#94a3b8" textAnchor="middle"
          transform={`rotate(-90 ${PAD.left - 12} ${PAD.top + (H - PAD.top - PAD.bottom) / 2})`}>加速 ↑</text>
        <text x={PAD.left - 2}       y={H - PAD.bottom - 4} fontSize={8} fill="#94a3b8" textAnchor="middle"
          transform={`rotate(-90 ${PAD.left - 12} ${H - PAD.bottom - 40})`}>↓ 放緩</text>

        {/* X 軸 symlog 刻度（億/日）：只渲染落在目前範圍內的刻度 */}
        {[-500, -200, -100, -50, -20, -5, 5, 20, 50, 100, 200, 500].map(v => {
          const tx = symX(v)
          if (tx < xRange[0] || tx > xRange[1]) return null
          const { px } = toSVG(tx, 0, zoom, xRange, yRange)
          if (px < PAD.left + 6 || px > W - PAD.right - 6) return null
          return (
            <g key={`xtick-${v}`}>
              <line x1={px} y1={zeroSVG.py - 2} x2={px} y2={zeroSVG.py + 2} stroke="#cbd5e1" strokeWidth={0.6} />
              <text x={px} y={zeroSVG.py + 9} fontSize={6} fill="#b6c2d1" textAnchor="middle">{v > 0 ? `+${v}` : v}</text>
            </g>
          )
        })}

        {/* Bubbles — 小→大渲染；位置已做 collision resolution */}
        {resolvedBubbles.map(({ s, rpx, rpy, r }, index) => {
            const q = QUADRANTS.find(q => q.id === quadrantOf(s.x, s.y))!
            const isHovered = hovered === s.sectorName
            const isClicked = clicked === s.sectorName
            const shortName = s.sectorName
              .replace('及週邊設備業', '週邊')
              .replace('工業', '')
              .replace('業', '')

            // 回放模式不顯示歷史軌跡（每個 frame 本身就是一個時間點）
            const trailPts = isHistorical
              ? []
              : (s.trail ?? []).map(p => toSVG(symX(p.x), p.y, zoom, xRange, yRange))
            const allPts = [...trailPts, { px: rpx, py: rpy }]
            const trailLen = allPts.length

            return (
              <g
                key={s.sectorName}
                onClick={() => handleBubbleClick(s)}
                onMouseEnter={() => setHovered(s.sectorName)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  cursor: 'pointer',
                  transform: isClicked ? 'scale(1.22)' : 'scale(1)',
                  transition: 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transformOrigin: `${rpx}px ${rpy}px`,
                  ...(mounted
                    ? { animation: `bubbleIn 500ms ${index * 18}ms both` }
                    : { opacity: 0 }),
                }}
              >
                {/* 歷史軌跡：漸淡線段 + 箭頭末端 + 漸淡小點 */}
                {trailLen >= 2 && (
                  <g style={{ pointerEvents: 'none' }}>
                    {allPts.slice(0, -1).map((pt, i) => {
                      const next = allPts[i + 1]
                      const ratio = i / Math.max(trailLen - 2, 1)
                      const isLast = i === allPts.slice(0, -1).length - 1
                      return (
                        <line key={i}
                          x1={pt.px} y1={pt.py} x2={next.px} y2={next.py}
                          stroke={q.color} strokeWidth={1.8} strokeLinecap="round"
                          opacity={0.20 + ratio * 0.45}
                          markerEnd={isLast ? `url(#trailArrow-${q.id})` : undefined}
                        />
                      )
                    })}
                    {trailPts.map((pt, i) => {
                      const ratio = i / Math.max(trailLen - 2, 1)
                      return (
                        <circle key={i}
                          cx={pt.px} cy={pt.py} r={1.5 + ratio * 1.4}
                          fill={q.color} opacity={0.25 + ratio * 0.40}
                        />
                      )
                    })}
                  </g>
                )}
                {/* Drop shadow */}
                <circle cx={rpx + 1} cy={rpy + 1.5} r={r}
                  fill={isClicked ? `${q.color}30` : '#00000018'} />
                {/* Main bubble */}
                <circle cx={rpx} cy={rpy} r={r}
                  fill={isHovered || isClicked ? q.color : q.fill}
                  stroke={q.color}
                  strokeWidth={isHovered || isClicked ? 2.5 : 1.8}
                  opacity={isHistorical ? 0.75 : (isHovered || isClicked ? 1 : 0.9)}
                />
                {/* Label */}
                {r >= 16 ? (
                  <text
                    x={rpx} y={rpy + 3}
                    fontSize={r >= 22 ? 8.5 : 7.5}
                    fill={isHovered || isClicked ? '#fff' : q.color}
                    textAnchor="middle"
                    fontWeight="700"
                    style={{ pointerEvents: 'none' }}
                  >
                    {shortName}
                  </text>
                ) : (
                  <text
                    x={rpx} y={rpy + r + 9}
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
