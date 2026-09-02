'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import type { SectorBubble } from '@/lib/types'
import BubbleHelpModal from './BubbleHelpModal'

interface Props {
  sectors: SectorBubble[]
  onBubbleClick: (sector: SectorBubble) => void
  // 回放日期標籤：sectorHistory 日期（newest first）。path[i] 的日期 = frameDates[trailLen - i]
  frameDates?: string[]
  // P2-5：目前聚焦的泡泡改變時通知外部（watchlist 模式用來算 ghost 陪跑名單）
  onFocusChange?: (sector: SectorBubble | null) => void
  // P2-5 Ghost：回放時跟著聚焦泡泡一起動的半透明陪跑泡泡（同概念股），trail 長度須與 sectors 來源一致
  ghostBubbles?: SectorBubble[]
  // AC-NAV-4：繪圖高度（viewBox 座標），滿版頁傳 560，預設 320
  chartHeight?: number
}

// AC-Q-1：命名對齊 Tide（流入/流出 × 加速/放緩），顏色沿用台股慣例（紅買綠賣）
const QUADRANTS = [
  { id: 'TL', label: '流出放緩', xSign: -1, ySign:  1, color: '#64748b', fill: '#f1f5f9', border: '#cbd5e1' },
  { id: 'TR', label: '流入加速', xSign:  1, ySign:  1, color: '#dc2626', fill: '#fff1f2', border: '#fca5a5' },
  { id: 'BL', label: '流出加速', xSign: -1, ySign: -1, color: '#16a34a', fill: '#f0fdf4', border: '#86efac' },
  { id: 'BR', label: '流入放緩', xSign:  1, ySign: -1, color: '#d97706', fill: '#fffbeb', border: '#fcd34d' },
] as const

type QuadrantId = typeof QUADRANTS[number]['id'] | null

const W = 360
const H_DEFAULT = 320   // AC-NAV-4：滿版頁（/intraday）會傳更高的 chartHeight
const PAD = { top: 28, right: 16, bottom: 28, left: 20 }
const CX = PAD.left + (W - PAD.left - PAD.right) / 2

// P1-4：symlog 轉換（linthresh = 1 億）。X（近5日淨買超總額）與 Y（加速度）共用。
// 板塊資金量級差距上百倍，線性刻度會把小板塊全部擠在原點附近；
// symlog 在 ±1 億內近似線性、之外按 10 倍壓縮，保留正負號與象限語意。
function symlog(v: number): number {
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

function shortName(name: string): string {
  return name.replace('及週邊設備業', '週邊').replace('工業', '').replace('業', '')
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ── 回放彈簧物理（AC-BR-1）────────────────────────────────────────────────
// a = -k(pos - target) - c·vel；k=260、c=14 → 阻尼比 ζ≈0.43，overshoot 約 20%，
// 殘餘振幅降到 1px 以下約 660ms，剛好搭上 650ms 的步進節奏（每步彈完才走下一步）。
// 原本 c=18 只有 4% overshoot，位移小的時候根本看不出彈跳。位置與半徑共用同一組參數。
const SPRING_K = 260
const SPRING_C = 14

function springStep(pos: number, vel: number, target: number, dt: number): [number, number] {
  const v = vel + (-SPRING_K * (pos - target) - SPRING_C * vel) * dt
  const p = pos + v * dt
  // 夠靠近就吸附，避免永遠停不下來的殘餘抖動
  if (Math.abs(p - target) < 0.05 && Math.abs(v) < 0.05) return [target, 0]
  return [p, v]
}

type SpringTarget = { px: number; py: number; r: number }

// 一個泡泡群組裡有陰影圓 + 主體圓，兩顆都要跟著半徑變
function setRadius(g: SVGGElement, r: number) {
  const v = String(Math.max(0.5, r))
  g.querySelectorAll('circle').forEach(c => c.setAttribute('r', v))
}

/**
 * 回放專用彈簧：直接寫 DOM 屬性（transform / r / 尾線終點），不走 React state，
 * 避免 60fps 重繪整張圖（全覽有上百顆泡泡）。目標變動時叫醒迴圈，收斂後自動停止。
 */
function useReplaySpring(targets: Record<string, SpringTarget>, active: boolean) {
  const groups = useRef<Record<string, SVGGElement>>({})
  const lines  = useRef<Record<string, SVGLineElement>>({})
  const states = useRef<Record<string, { px: number; py: number; r: number; vx: number; vy: number; vr: number }>>({})
  const targetRef = useRef(targets)
  targetRef.current = targets
  const rafRef = useRef<number | null>(null)

  // 目標簽名：位置/半徑一變就重新啟動迴圈
  const sig = Object.entries(targets)
    .map(([k, t]) => `${k}:${t.px.toFixed(1)},${t.py.toFixed(1)},${t.r.toFixed(1)}`)
    .join('|')

  // 首次掛載的節點直接就定位（不從 0,0 飛入）；重新掛載時保留現有動畫狀態
  function register(key: string, g: SVGGElement | null) {
    if (!g) { delete groups.current[key]; return }
    groups.current[key] = g
    const t = targetRef.current[key]
    if (!t) return
    // 已在動畫中 → 沿用目前狀態；首次出現 → 直接就定位（不從 0,0 飛入）。
    // 兩種情況都要寫回 DOM：<g>/<circle> 沒有 transform/r prop，重新掛載時屬性是空的
    const s = states.current[key] ?? (states.current[key] = { px: t.px, py: t.py, r: t.r, vx: 0, vy: 0, vr: 0 })
    g.setAttribute('transform', `translate(${s.px} ${s.py})`)
    setRadius(g, s.r)
  }

  // 軌跡最後一段：終點跟著泡泡一起跑（AC-BR-2）
  function registerLine(key: string, line: SVGLineElement | null) {
    if (line) lines.current[key] = line
    else delete lines.current[key]
  }

  useEffect(() => {
    if (!active) { states.current = {}; return }
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000)  // 分頁切回來時 dt 會爆大，夾住避免彈飛
      last = now
      let moving = false
      for (const [key, t] of Object.entries(targetRef.current)) {
        const s = states.current[key] ?? (states.current[key] = { px: t.px, py: t.py, r: t.r, vx: 0, vy: 0, vr: 0 })
        const [px, vx] = springStep(s.px, s.vx, t.px, dt)
        const [py, vy] = springStep(s.py, s.vy, t.py, dt)
        const [r,  vr] = springStep(s.r,  s.vr, t.r,  dt)
        Object.assign(s, { px, py, r, vx, vy, vr })
        if (vx !== 0 || vy !== 0 || vr !== 0) moving = true

        const g = groups.current[key]
        if (g) {
          g.setAttribute('transform', `translate(${px} ${py})`)
          setRadius(g, r)
        }
        const line = lines.current[key]
        if (line) {
          line.setAttribute('x2', String(px))
          line.setAttribute('y2', String(py))
        }
      }
      rafRef.current = moving ? requestAnimationFrame(tick) : null
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [sig, active])

  return { register, registerLine }
}

function toSVG(
  dx: number, dy: number,
  zoom: QuadrantId,
  xRange: [number, number],
  yRange: [number, number],
  H: number,
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

export default function BubbleChart({ sectors, onBubbleClick, frameDates, onFocusChange, ghostBubbles, chartHeight }: Props) {
  // 繪圖高度（viewBox 內部座標）：SVG 寬度固定 100%，H 越大畫面上就越高
  const H = chartHeight ?? H_DEFAULT
  const CY = PAD.top + (H - PAD.top - PAD.bottom) / 2
  const DEFAULT_VB = useMemo(() => ({ x: 0, y: 0, w: W, h: H }), [H])
  const [zoom, setZoom] = useState<QuadrantId>(null)
  const [top15Active, setTop15Active] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [clicked, setClicked] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [vb, setVb] = useState(() => ({ x: 0, y: 0, w: W, h: chartHeight ?? H_DEFAULT }))
  // 聚焦回放（Tide 式）：點泡泡進聚焦模式，按回放才顯示軌跡動畫
  const [focused, setFocused] = useState<string | null>(null)
  // AC-RP2-1：全域回放（所有泡泡一起走），與聚焦回放互斥
  const [globalStep, setGlobalStep] = useState<number | null>(null)
  const [globalPlaying, setGlobalPlaying] = useState(false)
  const [replayStep, setReplayStep] = useState<number | null>(null)
  const [replaying, setReplaying] = useState(false)
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

  function exitFocus() {
    setFocused(null)
    setReplayStep(null)
    setReplaying(false)
  }

  function handleBubbleClick(s: SectorBubble) {
    // AC-RP2-2：兩種回放互斥
    setGlobalPlaying(false)
    setGlobalStep(null)
    setClicked(s.sectorName)
    setTimeout(() => setClicked(null), 160)
    setReplayStep(null)
    setReplaying(false)
    setFocused(f => (f === s.sectorName ? null : s.sectorName))
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
  // AC-FIX-2：只有 Ctrl/⌘ + 滾輪才縮放，一般滾輪放行給頁面捲動——
  // 滿版頁的圖幾乎佔滿視窗，無條件攔截會讓桌機也捲不動（同手機的 touch 問題）
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
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
      const t = touchRef.current
      // 沒進入 pinch/pan 就把手勢還給瀏覽器（單指＝捲頁面）。
      // 2026-09-02 事故：這裡原本無條件 preventDefault，滿版後整頁捲不動
      if (!t) return
      e.preventDefault()
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

  const activeSectors = sectors

  // 全域回放的總步數＝最長的 trail 長度（各泡泡 trail 較短時 clamp 到最舊那點）
  const globalTotalSteps = useMemo(
    () => Math.max(0, ...activeSectors.map(s => (s.trail ?? []).length)),
    [activeSectors],
  )

  // step 0＝最舊、globalTotalSteps＝今日；trail 較短的泡泡停在自己最舊的點
  function frameOf(s: SectorBubble, step: number | null) {
    if (step === null || step >= globalTotalSteps) return { x: s.x, y: s.y, size: s.size }
    const trail = s.trail ?? []
    if (!trail.length) return { x: s.x, y: s.y, size: s.size }
    const idx = clamp(trail.length - (globalTotalSteps - step), 0, trail.length - 1)
    const p = trail[idx]
    return { x: p.x, y: p.y, size: p.size ?? s.size }
  }

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
  // 軸範圍把 trail 的歷史點一起算進去，回放時座標系才不會每幀跳動
  const xRange = useMemo<[number, number]>(() => {
    const src = zoom ? visibleSectors : activeSectors
    const vals = src.flatMap(s => [s.x, ...(s.trail ?? []).map(t => t.x)])
    const absMax = Math.max(0.5, ...vals.map(v => Math.abs(symlog(v))))
    return [-absMax * 1.1, absMax * 1.1]
  }, [activeSectors, visibleSectors, zoom])

  // Y 改為加速度（億/日），量級同樣跨百倍，跟 X 一樣走 symlog
  const yRange = useMemo<[number, number]>(() => {
    const src = zoom ? visibleSectors : activeSectors
    const vals = src.flatMap(s => [s.y, ...(s.trail ?? []).map(t => t.y)])
    const absMax = Math.max(0.3, ...vals.map(v => Math.abs(symlog(v))))
    return [-absMax * 1.15, absMax * 1.15]
  }, [activeSectors, visibleSectors, zoom])

  // 預先計算 SVG 位置並解決重疊；collision 後再次 clamp 避免泡泡溢出 SVG
  const resolvedBubbles = useMemo(() => {
    const sorted = [...visibleSectors].sort((a, b) => a.size - b.size)
    const raw = sorted.map(s => {
      const f = frameOf(s, globalStep)
      const { px, py } = toSVG(symlog(f.x), symlog(f.y), zoom, xRange, yRange, H)
      const r = bubbleRadius(f.size, maxSize)
      return { s, px: clamp(px, PAD.left + r + 1, W - PAD.right - r - 1), py: clamp(py, PAD.top + r + 1, H - PAD.bottom - r - 1), r }
    })
    const resolved = resolveCollisions(raw.map(({ px, py, r }) => ({ px, py, r })))
    return raw.map((item, i) => ({
      ...item,
      rpx: clamp(resolved[i].px, PAD.left + item.r + 1, W - PAD.right - item.r - 1),
      rpy: clamp(resolved[i].py, PAD.top  + item.r + 1, H - PAD.bottom - item.r - 1),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSectors, zoom, xRange, yRange, maxSize, globalStep, globalTotalSteps, H])

  const zeroSVG = toSVG(0, 0, zoom, xRange, yRange, H)

  // AC-BX-4：回放時每一幀的泡泡半徑用該幀的 size（近20日買賣總額是滾動視窗，會漲也會縮）；
  // maxSize 固定用今日全體最大值當基準，不逐幀重新正規化，否則相對大小會失真。
  // fallback：改版前的舊快照 trail 只有 {x,y} 沒有 size，缺值時退回該泡泡今日的 size，
  // 否則 bubbleRadius 會算出 NaN，回放中的泡泡（r="NaN"）會整顆消失
  const frameRadius = (size: number | undefined, fallback: number) =>
    bubbleRadius(Number.isFinite(size) ? (size as number) : fallback, maxSize)

  // ── 聚焦回放 ──────────────────────────────────────────────
  const focusedBubble = focused
    ? resolvedBubbles.find(b => b.s.sectorName === focused) ?? null
    : null

  // P2-5：通知外部目前聚焦的泡泡（watchlist 模式用來算 ghost 陪跑名單）
  useEffect(() => {
    onFocusChange?.(focusedBubble?.s ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused])

  // 回放路徑：trail（oldest first）+ 今日 collision 後位置；每點帶自己的半徑
  const focusedPath = useMemo(() => {
    if (!focusedBubble) return []
    const pts = (focusedBubble.s.trail ?? []).map(p => ({
      ...toSVG(symlog(p.x), symlog(p.y), zoom, xRange, yRange, H),
      r: frameRadius(p.size, focusedBubble.s.size),
    }))
    return [...pts, { px: focusedBubble.rpx, py: focusedBubble.rpy, r: focusedBubble.r }]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedBubble, zoom, xRange, yRange, maxSize])

  const trailLen = focusedPath.length - 1

  // P2-5 Ghost：同概念陪跑泡泡的回放路徑，算法與 focusedPath 相同（trail 長度取決於 stockHistory，跟主角一致）
  const ghostPaths = useMemo(() => {
    if (!ghostBubbles?.length) return []
    return ghostBubbles.map(g => {
      const pts = (g.trail ?? []).map(p => ({
        ...toSVG(symlog(p.x), symlog(p.y), zoom, xRange, yRange, H),
        r: frameRadius(p.size, g.size),
      }))
      const todayPt = {
        ...toSVG(symlog(g.x), symlog(g.y), zoom, xRange, yRange, H),
        r: frameRadius(g.size, g.size),
      }
      return { bubble: g, path: [...pts, todayPt] }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostBubbles, zoom, xRange, yRange, maxSize])

  // 自動步進（oldest → today）
  useEffect(() => {
    if (!replaying) return
    const id = setInterval(() => {
      setReplayStep(s => {
        if (s === null || s >= focusedPath.length - 1) { setReplaying(false); return s }
        return s + 1
      })
    }, 650)
    return () => clearInterval(id)
  }, [replaying, focusedPath.length])

  // 聚焦的板塊被篩掉（象限/熱門15 切換）時退出聚焦
  useEffect(() => {
    if (focused && !visibleSectors.some(s => s.sectorName === focused)) {
      setFocused(null)
      setReplayStep(null)
      setReplaying(false)
    }
  }, [visibleSectors, focused])

  function handleReplay() {
    if (focusedPath.length < 2) return
    if (replaying) { setReplaying(false); return }
    if (replayStep === null || replayStep >= focusedPath.length - 1) setReplayStep(0)
    setReplaying(true)
  }

  // AC-RP2-1：全域回放——所有泡泡沿各自 trail 一起走
  function handleGlobalReplay() {
    if (globalPlaying) { setGlobalPlaying(false); return }
    // 互斥：先退出聚焦回放
    setFocused(null)
    setReplayStep(null)
    setReplaying(false)
    setGlobalStep(st => (st === null || st >= globalTotalSteps) ? 0 : st)
    setGlobalPlaying(true)
  }

  useEffect(() => {
    if (!globalPlaying) return
    const id = setInterval(() => {
      setGlobalStep(st => {
        if (st === null) return 0
        if (st >= globalTotalSteps) { setGlobalPlaying(false); return st }
        return st + 1
      })
    }, 650)
    return () => clearInterval(id)
  }, [globalPlaying, globalTotalSteps])

  // AC-RP2-3：全域回放中顯示該幀日期（frameDates 為 newest first）
  const globalDate = globalStep !== null && frameDates
    ? frameDates[globalTotalSteps - globalStep]?.slice(5).replace('-', '/')
    : null

  // path[i] 的日期：i = trailLen → 今日（frameDates[0]）
  const replayDate = replayStep !== null && frameDates
    ? frameDates[trailLen - replayStep]?.slice(5).replace('-', '/')
    : null

  // 回放中該幀的座標值（資訊卡數字要跟著泡泡位置走，不然會對不上）
  const frameStats = replayStep !== null && focusedBubble && replayStep < trailLen
    ? focusedBubble.s.trail?.[replayStep] ?? focusedBubble.s
    : focusedBubble?.s ?? null

  // 彈簧目標：一般泡泡（常駐）＋ 聚焦回放的主角/ghost。共用同一個 rAF 迴圈
  const springTargets = useMemo(() => {
    const t: Record<string, SpringTarget> = {}
    for (const b of resolvedBubbles) {
      t[`b:${b.s.sectorName}`] = { px: b.rpx, py: b.rpy, r: b.r }
    }
    if (replayStep !== null && focusedBubble && focusedPath.length > 0) {
      t.focus = focusedPath[Math.min(replayStep, focusedPath.length - 1)]
      for (const { bubble, path } of ghostPaths) {
        t[`ghost:${bubble.sectorName}`] = path[Math.min(replayStep, path.length - 1)]
      }
    }
    return t
  }, [resolvedBubbles, replayStep, focusedBubble, focusedPath, ghostPaths])

  const spring = useReplaySpring(springTargets, true)

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
          {/* AC-RP2-1：全域回放 */}
          {globalTotalSteps > 0 && !focused && (
            <>
              {globalDate && (
                <span className="text-[10px] font-semibold text-amber-600 whitespace-nowrap">
                  {globalDate}{globalStep === globalTotalSteps ? '（今日）' : ''}
                </span>
              )}
              <button
                onClick={handleGlobalReplay}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-amber-300 bg-amber-50 text-amber-600 whitespace-nowrap"
              >
                {globalPlaying ? '⏸ 暫停' : '▶ 回放'}
              </button>
            </>
          )}

          {/* AC-HELP-1：說明視窗（不影響聚焦/回放狀態） */}
          <button
            onClick={() => setShowHelp(true)}
            aria-label="圖表說明"
            className="w-6 h-6 flex-shrink-0 rounded-full border border-slate-200 text-slate-400 text-[11px] font-bold leading-none"
          >
            ?
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="w-full"
        style={{
          // 未放大：pan-y 讓單指垂直捲頁面通過（雙指縮放仍由 onMove 處理）
          // 已放大：none，單指要拿來平移圖表
          touchAction: isZoomed ? 'none' : 'pan-y',
          cursor: isZoomed ? 'grab' : 'default',
        }}
      >
        <defs>
          <style>{`
            @keyframes bubbleIn {
              from { opacity: 0; }
              55%  { opacity: 0; }
              to   { opacity: 1; }
            }
          `}</style>
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
                onClick={() => focused ? exitFocus() : setZoom(q.id)} />
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
            fill={q.fill}
            onClick={() => focused && exitFocus()} />
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

        {/* Axis labels：軸的意思＋單位，放在軸兩端對應位置（不用 rotate，避免 pivot 與文字座標不一致跑位） */}
        <text x={W - PAD.right - 2} y={H - 6}  fontSize={8} fill="#94a3b8" textAnchor="end">資金流入（億）→</text>
        <text x={PAD.left + 2}       y={H - 6}  fontSize={8} fill="#94a3b8" textAnchor="start">← 資金流出（億）</text>
        <text x={PAD.left + 2}       y={PAD.top + 8}  fontSize={8} fill="#94a3b8" textAnchor="start">↑ 力道加速（億/天）</text>
        <text x={PAD.left + 2}       y={H - PAD.bottom - 4} fontSize={8} fill="#94a3b8" textAnchor="start">↓ 放緩</text>

        {/* X 軸 symlog 刻度（近5日淨買超總額，億）：只渲染落在目前範圍內的刻度。
            改總額後量級放大 5 倍（2026-09-01 實測半導體業 +322 億），刻度需延伸到 ±500 */}
        {[-500, -200, -100, -50, -20, -5, 5, 20, 50, 100, 200, 500].map(v => {
          const tx = symlog(v)
          if (tx < xRange[0] || tx > xRange[1]) return null
          const { px } = toSVG(tx, 0, zoom, xRange, yRange, H)
          if (px < PAD.left + 6 || px > W - PAD.right - 6) return null
          return (
            <g key={`xtick-${v}`}>
              <line x1={px} y1={zeroSVG.py - 2} x2={px} y2={zeroSVG.py + 2} stroke="#cbd5e1" strokeWidth={0.6} />
              <text x={px} y={zeroSVG.py + 9} fontSize={6} fill="#b6c2d1" textAnchor="middle">{v > 0 ? `+${v}` : v}</text>
            </g>
          )
        })}

        {/* Y 軸 symlog 刻度（加速度，億/天）：只渲染落在目前範圍內的刻度 */}
        {[-50, -20, -5, 5, 20, 50].map(v => {
          const ty = symlog(v)
          if (ty < yRange[0] || ty > yRange[1]) return null
          const { py } = toSVG(0, ty, zoom, xRange, yRange, H)
          if (py < PAD.top + 6 || py > H - PAD.bottom - 6) return null
          return (
            <g key={`ytick-${v}`}>
              <line x1={zeroSVG.px - 2} y1={py} x2={zeroSVG.px + 2} y2={py} stroke="#cbd5e1" strokeWidth={0.6} />
              <text x={zeroSVG.px + 4} y={py + 2} fontSize={6} fill="#b6c2d1" textAnchor="start">{v > 0 ? `+${v}` : v}</text>
            </g>
          )
        })}

        {/* Bubbles — 小→大渲染；位置已做 collision resolution。首頁不畫軌跡（Tide 式：回放才有） */}
        {resolvedBubbles.map(({ s, rpx, rpy, r }, index) => {
            const q = QUADRANTS.find(q => q.id === quadrantOf(s.x, s.y))!
            const isHovered = hovered === s.sectorName
            const isClicked = clicked === s.sectorName
            const isFocused = focused === s.sectorName
            const dimmed = focused !== null && !isFocused

            // 回放時主角改由 overlay 呈現
            if (isFocused && replayStep !== null) return null

            const active = isHovered || isClicked || isFocused

            // AC-BR-3：位置與半徑一律走彈簧（切分類/象限/回放都會 Q 一下）。
            // 外層 <g> 只管互動與淡入淡出，內層 <g> 的 transform 由 rAF 直接寫，
            // 所以 circle 不帶 cx/cy、不帶 r——帶了會在每次 render 把彈簧位置蓋回目標值
            return (
              <g
                key={s.sectorName}
                onClick={() => handleBubbleClick(s)}
                onMouseEnter={() => setHovered(s.sectorName)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  cursor: 'pointer',
                  transition: 'opacity 200ms',
                  ...(dimmed
                    ? { opacity: 0.15 }
                    : mounted
                      ? { animation: `bubbleIn 500ms ${index * 18}ms both` }
                      : { opacity: 0 }),
                }}
              >
                {/* 外層 g 的 transform attribute 由彈簧寫入；點擊縮放必須放在內層，
                    否則 CSS scale 會跟 attribute transform 相乘，把座標一起放大 */}
                <g ref={el => spring.register(`b:${s.sectorName}`, el)}>
                <g
                  style={{
                    transform: isClicked ? 'scale(1.22)' : 'scale(1)',
                    transformOrigin: '0px 0px',
                    transition: 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  {/* Drop shadow（相對座標，跟著群組的 translate 走） */}
                  <circle cx={1} cy={1.5}
                    fill={isClicked ? `${q.color}30` : '#00000018'} />
                  {/* Main bubble */}
                  <circle
                    fill={active ? q.color : q.fill}
                    stroke={q.color}
                    strokeWidth={active ? 2.5 : 1.8}
                    opacity={active ? 1 : 0.9}
                  />
                  {/* Label */}
                  {r >= 16 ? (
                    <text
                      y={3}
                      fontSize={r >= 22 ? 8.5 : 7.5}
                      fill={active ? '#fff' : q.color}
                      textAnchor="middle"
                      fontWeight="700"
                      style={{ pointerEvents: 'none' }}
                    >
                      {shortName(s.sectorName)}
                    </text>
                  ) : (
                    <text
                      y={r + 9}
                      fontSize={7}
                      fill={q.color}
                      textAnchor="middle"
                      fontWeight="600"
                      opacity="0.85"
                      style={{ pointerEvents: 'none' }}
                    >
                      {shortName(s.sectorName)}
                    </text>
                  )}
                </g>
                </g>
              </g>
            )
          })}

        {/* P2-5 Ghost：同概念陪跑泡泡，半透明、不可互動，同步 replayStep 一起動 */}
        {focusedBubble && replayStep !== null && ghostPaths.map(({ bubble: g, path }) => {
          const step = Math.min(replayStep, path.length - 1)
          const gr  = path[step].r
          const key = `ghost:${g.sectorName}`
          const lastSeg = Math.max(replayStep, 0) - 1   // 最後一段終點交給彈簧跟著泡泡跑
          return (
            <g key={g.sectorName} style={{ pointerEvents: 'none' }} opacity={0.35}>
              {path.slice(0, Math.max(replayStep, 0)).map((pt, i) => {
                const next = path[i + 1]
                return (
                  <line key={i}
                    ref={i === lastSeg ? el => spring.registerLine(key, el) : undefined}
                    x1={pt.px} y1={pt.py} x2={next.px} y2={next.py}
                    stroke="#94a3b8" strokeWidth={1} strokeLinecap="round" opacity={0.5}
                  />
                )
              })}
              <g ref={el => spring.register(key, el)}>
                <circle fill="#94a3b8" stroke="#94a3b8" strokeWidth={1} opacity={0.5} />
                {gr >= 14 && (
                  <text y={3} fontSize={7} fill="#475569" textAnchor="middle" fontWeight="600">
                    {shortName(g.sectorName)}
                  </text>
                )}
              </g>
            </g>
          )
        })}

        {/* 聚焦回放 overlay：軌跡漸進繪出 + 主角泡泡沿路徑移動 */}
        {focusedBubble && replayStep !== null && (() => {
          const fb = focusedBubble
          const q = QUADRANTS.find(q => q.id === quadrantOf(fb.s.x, fb.s.y))!
          const stepR = focusedPath[Math.min(replayStep, focusedPath.length - 1)].r
          const lastSeg = Math.max(replayStep, 0) - 1   // 最後一段終點交給彈簧跟著泡泡跑
          return (
            <g style={{ pointerEvents: 'none' }}>
              {focusedPath.slice(0, Math.max(replayStep, 0)).map((pt, i) => {
                const next = focusedPath[i + 1]
                const ratio = trailLen > 1 ? i / (trailLen - 1) : 1
                return (
                  <g key={i}>
                    <line
                      ref={i === lastSeg ? el => spring.registerLine('focus', el) : undefined}
                      x1={pt.px} y1={pt.py} x2={next.px} y2={next.py}
                      stroke={q.color} strokeWidth={1.8} strokeLinecap="round"
                      opacity={0.25 + ratio * 0.45}
                    />
                    <circle cx={pt.px} cy={pt.py} r={2} fill={q.color} opacity={0.35 + ratio * 0.35} />
                  </g>
                )
              })}
              <g ref={el => spring.register('focus', el)}>
                <circle fill={q.color} stroke={q.color} strokeWidth={2.5} opacity={0.95} />
                {stepR >= 16 && (
                  <text y={3} fontSize={stepR >= 22 ? 8.5 : 7.5} fill="#fff" textAnchor="middle" fontWeight="700">
                    {shortName(fb.s.sectorName)}
                  </text>
                )}
              </g>
            </g>
          )
        })()}
      </svg>

      {/* 聚焦資訊卡 */}
      {focusedBubble && (() => {
        const fb = focusedBubble
        const q = QUADRANTS.find(q => q.id === quadrantOf(fb.s.x, fb.s.y))!
        return (
          <div className="absolute bottom-7 left-1/2 -translate-x-1/2 z-10 max-w-[94%] bg-white/95 backdrop-blur rounded-xl shadow-lg border border-slate-200 px-3 py-2 flex items-center gap-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-xs font-bold text-slate-800">{fb.s.sectorName}</span>
                <span className="text-[10px] font-semibold" style={{ color: q.color }}>{q.label}</span>
                {replayDate && (
                  <span className="text-[10px] font-semibold text-amber-600">
                    {replayDate}{replayStep === trailLen ? '（今日）' : ''}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 whitespace-nowrap">
                近5日法人淨買超 {(frameStats?.x ?? 0) >= 0 ? '+' : ''}{(frameStats?.x ?? 0).toFixed(1)} 億
                {' · '}加速 {(frameStats?.y ?? 0) >= 0 ? '+' : ''}{(frameStats?.y ?? 0).toFixed(1)} 億/天
                {' · '}20日買賣 {(Number.isFinite(frameStats?.size) ? frameStats!.size : fb.s.size).toFixed(0)} 億
              </p>
            </div>
            <button
              onClick={handleReplay}
              disabled={focusedPath.length < 2}
              title={focusedPath.length < 2 ? '無歷史軌跡資料' : undefined}
              className="flex-shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold bg-amber-500 text-white disabled:opacity-40"
            >
              {replaying ? '⏸ 暫停' : '▶ 回放'}
            </button>
            <button
              onClick={() => onBubbleClick(fb.s)}
              className="flex-shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold bg-blue-600 text-white"
            >
              個股清單
            </button>
            <button
              onClick={exitFocus}
              className="flex-shrink-0 text-slate-400 text-sm leading-none px-0.5"
            >
              ✕
            </button>
          </div>
        )
      })()}

      <p className="text-center text-[10px] text-slate-400 pb-2">
        {focused
          ? '▶ 回放看資金軌跡 · 點空白處返回'
          : zoom ? '點擊泡泡聚焦' : '點擊象限放大 · 雙指（或 ⌘/Ctrl+滾輪）縮放 · 點擊泡泡聚焦'}
      </p>

      {showHelp && <BubbleHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
