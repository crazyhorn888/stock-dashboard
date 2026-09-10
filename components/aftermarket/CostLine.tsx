'use client'

/**
 * 主力成本推估（AC-CL-3～AC-CL-7，2026-09-10）。
 *
 * 日曆 → 圖表 → 明細。三者的日期口徑刻意不同：
 *  - 日曆：整段生命週期，一格＝那一天主力押的成本帶
 *  - 圖表：永遠看最新，畫完整生命週期，靠橫向捲動看更早（AC-CL-7：不隨選日改變）
 *  - 明細：跟著日曆選的那天，成本與累積量都用「當日（含）之前」重算
 *
 * 線寬＝目前 OI 而非累積建倉量（AC-CL-5）。用累積量的話，早就平掉的部位
 * 還會被畫成一條粗防線——那是不存在的支撐。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { legsAsOf, type CostCase, type CostLeg } from '@/lib/costLine'

const H = 248, PT = 10, PB = 30, IN = 14, DAY_W = 34
const LBH = 13, LBW = 78

const nf = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString()
const md = (s: string) => `${Number(s.slice(5, 7))}/${s.slice(8, 10)}`

/** Catmull-Rom 轉三次貝茲。兩點之間是插值，不代表當日真實位置 */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    d += `C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6},`
      + `${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6},${p2[0]} ${p2[1]}`
  }
  return d
}

/** 生命週期內的平日，若不在交易日序列裡就是休市（颱風假／國定假日） */
function calendarWeeks(c: CostCase) {
  const inLife = new Set(c.days)
  const first = new Date(`${c.days[0]}T00:00:00Z`)
  const cur = new Date(first)
  cur.setUTCDate(first.getUTCDate() - first.getUTCDay())
  const end = new Date(`${c.exp}T00:00:00Z`)
  const weeks: { iso: string; day: number; weekend: boolean; live: boolean; isExp: boolean }[][] = []
  while (cur <= end) {
    const cells = []
    for (let i = 0; i < 7; i++) {
      const iso = cur.toISOString().slice(0, 10)
      cells.push({ iso, day: cur.getUTCDate(), weekend: i === 0 || i === 6, live: inLife.has(iso), isExp: iso === c.exp })
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    weeks.push(cells)
  }
  return weeks
}

export default function CostLine({ c }: { c: CostCase }) {
  const [selDay, setSelDay] = useState<string | null>(null)
  const [showOld, setShowOld] = useState(false)
  const [showOtm, setShowOtm] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(300)
  const [view, setView] = useState<[number, number] | null>(null)

  const tl = c.timeline
  const todayD = tl[tl.length - 1].d
  const weeks = useMemo(() => calendarWeeks(c), [c])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setAvail(el.clientWidth || 300)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 換契約時回到初始狀態，否則會沿用上一檔的選中日與捲動範圍
  useEffect(() => { setSelDay(null); setView(null) }, [c.code])

  // ── 圖表：永遠看最新，不隨 selDay 變動（AC-CL-7）──────────────
  const chart = useMemo(() => {
    const future: string[] = []
    if (!tl.some(t => t.d === c.exp)) {
      const cur = new Date(`${tl[tl.length - 1].d}T00:00:00Z`)
      const end = new Date(`${c.exp}T00:00:00Z`)
      for (;;) {
        cur.setUTCDate(cur.getUTCDate() + 1)
        if (cur > end) break
        const w = cur.getUTCDay()
        if (w !== 0 && w !== 6) future.push(cur.toISOString().slice(0, 10))
      }
    }
    const n = tl.length + future.length
    const rollIdx = Math.max(0, Math.min(tl.findIndex(t => t.d === c.lastRoll), Math.max(0, tl.length - 5)))
    const DW = Math.max(DAY_W, avail / Math.max(1, n - rollIdx))
    const W = n * DW
    const [vf, vt] = view ?? [rollIdx * DW, rollIdx * DW + avail]
    const vi0 = Math.max(0, Math.min(n - 1, Math.floor(vf / DW)))
    const vi1 = Math.max(vi0 + 1, Math.min(n, Math.ceil(vt / DW)))
    const vis = tl.slice(vi0, vi1)
    const seen = vis.length ? vis : tl

    const curOI = (k: string) => tl[tl.length - 1].oi[k] ?? 0
    const dayAdd = (l: CostLeg) => l.entries.filter(e => e.d === todayD).reduce((a, e) => a + e.dOI, 0)
    const born = c.legs.filter(l => l.first <= seen[seen.length - 1].d)
    const recent = born.filter(l => l.first >= c.lastRoll)

    // ⚠️ 底與重必須在「全部有部位的線」中認定，不能只看勾選後留下的那幾條，
    // 否則取消勾選時顯示的「底」會不是真正的底
    const calls = born.filter(l => l.cp === 'C' && curOI(l.key) > 0)
    const maxCall = Math.max(1, ...calls.map(l => curOI(l.key)))
    const pool = calls.filter(l => curOI(l.key) >= maxCall * 0.15)
    const fPool = pool.length ? pool : calls
    const floorKey = fPool.length ? fPool.reduce((a, b) => a.be <= b.be ? a : b).key : null
    const heavyKey = calls.length ? calls.reduce((a, b) => curOI(a.key) >= curOI(b.key) ? a : b).key : null
    const base = (showOld || !recent.length) ? born : recent
    const legsIn = [...new Set([...base, ...born.filter(l => l.key === floorKey || l.key === heavyKey || dayAdd(l) > 0)])]

    const scsp = showOtm ? seen.flatMap(t => [t.sc, t.sp]).filter((v): v is number => v != null) : []
    const vals = [
      ...legsIn.map(l => l.be), ...scsp,
      ...seen.map(t => t.idx ?? t.fut).filter((v): v is number => v != null),
    ]
    // 剛掛牌的契約可能一條線都還沒有，vals 只剩指數；空陣列的話 Math.min 會回 Infinity
    const ref = seen.map(x => x.idx ?? x.fut).filter((v): v is number => v > 0)
    const safe = vals.length ? vals : (ref.length ? ref : [0])
    const lo = Math.min(...safe), hi = Math.max(...safe)
    const pad = Math.max(120, (hi - lo) * 0.08)
    const Ylo = lo - pad, Yhi = hi + pad
    const X = (i: number) => i * DW + DW / 2
    const Y = (v: number) => PT + IN + (Yhi - v) / (Yhi - Ylo) * (H - PT - PB - IN * 2)

    return { future, n, DW, W, rollIdx, vi0, X, Y, Ylo, Yhi, legsIn, floorKey, heavyKey, curOI, seen, born, recent }
  }, [c, tl, todayD, avail, view, showOld, showOtm])

  // ── 明細：跟著日曆選的那天（AC-CL-4）────────────────────────
  const detail = useMemo(() => {
    let ai = selDay ? tl.findIndex(t => t.d === selDay) : -1
    if (ai < 0) ai = tl.length - 1
    const sub = tl.slice(0, ai + 1)
    const asOf = sub[sub.length - 1].d
    const isLatest = ai === tl.length - 1
    const legs = legsAsOf(c.legs, asOf)
    const oi = (k: string) => sub[sub.length - 1].oi[k] ?? 0
    // 當日增量取 entries 的 dOI，不用 OI 差值——首建日的前一天沒有這個履約價的
    // OI 紀錄，用差值會把整筆當成新增（實例 C46000：479−0 而非 479−27）
    const add = (l: CostLeg) => l.entries.filter(e => e.d === asOf).reduce((a, e) => a + e.dOI, 0)
    const last = sub[sub.length - 1].idx ?? sub[sub.length - 1].fut
    const recent = legs.filter(l => l.first >= c.lastRoll)
    const calls = legs.filter(l => l.cp === 'C' && oi(l.key) > 0)
    const maxCall = Math.max(1, ...calls.map(l => oi(l.key)))
    const pool = calls.filter(l => oi(l.key) >= maxCall * 0.15)
    const fPool = pool.length ? pool : calls
    const floorKey = fPool.length ? fPool.reduce((a, b) => a.be <= b.be ? a : b).key : null
    const heavyKey = calls.length ? calls.reduce((a, b) => oi(a.key) >= oi(b.key) ? a : b).key : null
    const base = (showOld || !recent.length) ? legs : recent
    const rows = [...new Set([...base, ...legs.filter(l => l.key === floorKey || l.key === heavyKey || add(l) > 0)])]
      .sort((a, b) => (add(b) > 0 ? 1 : 0) - (add(a) > 0 ? 1 : 0) || a.first.localeCompare(b.first))
    const t = sub[sub.length - 1]
    return {
      asOf, isLatest, legs, rows, oi, add, last, floorKey, heavyKey, sub, t,
      dayWord: isLatest ? '今日' : '當日',
      hidden: !showOld && recent.length && legs.length > recent.length ? legs.length - recent.length : 0,
      forced: !showOld && !recent.length && legs.length > 0,
    }
  }, [c, tl, selDay, showOld])

  const { X, Y, DW, W, legsIn, floorKey, heavyKey, curOI, future } = chart

  // 初次繪製停在「上次轉倉後」，更早的靠往左捲（AC-CL-5）
  useEffect(() => {
    const el = scrollRef.current
    if (el && view === null) el.scrollLeft = chart.rollIdx * chart.DW
  }, [chart.rollIdx, chart.DW, view])

  // 已站上的成本線染色，上界止於賣方防線——染到畫布頂端的話語意會變成
  // 「多方控制到無限高」，那是錯的
  const scSeen = showOtm ? chart.seen.map(t => t.sc).filter((v): v is number => v != null) : []
  const ceilY = scSeen.length ? Math.max(PT, Math.min(...scSeen.map(Y))) : PT
  const lastIdx = [...tl].reverse().find(t => t.idx != null)
  const nowIdx = lastIdx?.idx ?? tl[tl.length - 1].fut

  const firsts = [...new Set(c.legs.map(l => l.first))].sort()
  const curMax = Math.max(1, ...legsIn.map(l => curOI(l.key)))
  const labels: { y: number; col: string; op: number; oi: number; tag: string; be: number }[] = []

  const cellClass = (cell: { weekend: boolean; live: boolean; iso: string }, inRange: boolean, noTrade: boolean) => {
    if (cell.weekend || !inRange || noTrade) return 'bg-slate-100 border-transparent'
    if (cell.iso === todayD) return 'bg-amber-50 border-amber-300'
    return cell.live ? 'bg-blue-50 border-blue-200 cursor-pointer' : 'bg-white border-slate-100'
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ── 日曆（AC-CL-6）───────────────────────────────── */}
      <table className="w-full table-fixed border-separate border-spacing-[2px]">
        <thead>
          <tr>{['日', '一', '二', '三', '四', '五', '六'].map(w => (
            <th key={w} className="text-[9.5px] font-semibold text-slate-400 pb-0.5">{w}</th>
          ))}</tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map(cell => {
                const inRange = cell.iso >= c.days[0] && cell.iso <= c.exp
                const noTrade = !cell.weekend && inRange && !cell.live && cell.iso < todayD
                const rec = c.daily[cell.iso]
                const sel = cell.iso === (selDay ?? todayD)
                return (
                  <td
                    key={cell.iso}
                    onClick={() => { if (cell.live) setSelDay(cell.iso) }}
                    className={`h-[50px] align-top rounded-md border px-0.5 pt-0.5 text-center ${cellClass(cell, inRange, noTrade)} ${
                      sel ? 'outline outline-2 outline-blue-500' : ''
                    }`}
                  >
                    <div className={`text-[9.5px] tabular-nums leading-tight ${
                      cell.iso === todayD ? 'font-extrabold text-blue-600' : 'text-slate-400'
                    }`}>{cell.day}</div>
                    {cell.weekend || !inRange ? null
                      : noTrade ? <div className="text-[8px] text-slate-400 pt-2.5 opacity-60">休市</div>
                      : rec && !rec.weak ? (
                        <>
                          <div className="text-[9px] tabular-nums leading-tight text-blue-600">{nf(rec.hi)}</div>
                          <div className="text-[9px] tabular-nums leading-tight text-blue-600/75">{nf(rec.lo)}</div>
                          <div className="text-[8px] text-slate-400">{nf(rec.oi)} 口</div>
                        </>
                      ) : rec ? (
                        <>
                          <div className="text-[8.5px] text-slate-400 pt-0.5">無參考</div>
                          <div className="text-[8px] text-slate-400">{nf(rec.rawOI)} 口</div>
                        </>
                      ) : cell.isExp ? <div className="text-[8px] text-slate-400 pt-3">結算日</div>
                      : cell.live ? (
                        <>
                          <div className="text-[8.5px] text-slate-400 pt-0.5">無參考</div>
                          <div className="text-[8px] text-slate-400">0 口</div>
                        </>
                      ) : <div className="text-[8px] text-slate-400 pt-3">未到</div>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── 圖表（AC-CL-5）───────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white px-1 pt-2 pb-0.5">
        <div className="flex items-start">
          <svg width={44} height={H} aria-hidden="true" className="block shrink-0">
            {[0, 1, 2, 3, 4].map(k => {
              const v = chart.Ylo + (chart.Yhi - chart.Ylo) * k / 4
              return <text key={k} x={40} y={Y(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">
                {Math.round(v / 100) * 100}
              </text>
            })}
          </svg>

          <div
            ref={scrollRef}
            className="flex-1 overflow-x-auto overflow-y-hidden"
            onScroll={e => {
              const el = e.currentTarget
              setView([el.scrollLeft, el.scrollLeft + el.clientWidth])
            }}
          >
            <svg width={W} height={H} className="block" role="img" aria-label="主力成本線與指數走勢">
              {future.length > 0 && (
                <rect x={tl.length * DW} y={PT} width={future.length * DW} height={H - PT - PB} fill="#f8fafc" />
              )}
              {[0, 1, 2, 3, 4].map(k => {
                const y = Y(chart.Ylo + (chart.Yhi - chart.Ylo) * k / 4)
                return <line key={k} x1={0} y1={y} x2={W} y2={y} stroke="#e8edf3" />
              })}

              {/* 已站上的成本線染色，上界止於賣方防線 */}
              {legsIn.map(l => {
                const fi = tl.findIndex(t => t.d === l.first)
                const y = Y(l.be), x0 = fi < 0 ? 0 : X(fi) - DW / 2
                const above = l.cp === 'C' ? nowIdx >= l.be : nowIdx <= l.be
                if (!above) return null
                const top = l.cp === 'C' ? ceilY : y
                const h = l.cp === 'C' ? y - ceilY : (H - PB) - y
                if (h <= 0) return null
                return <rect key={`s${l.key}`} x={x0} y={top} width={W - x0} height={h}
                  fill={l.cp === 'C' ? 'rgba(37,99,235,.08)' : 'rgba(5,150,105,.07)'} />
              })}

              {/* 成本線本體。線寬＝目前 OI，部位被平掉線就變細 */}
              {legsIn.map(l => {
                const fi = tl.findIndex(t => t.d === l.first)
                const y = Y(l.be), x0 = fi < 0 ? 0 : X(fi) - DW / 2
                const col = l.cp === 'C' ? '#2563eb' : '#059669'
                const early = l.first < c.lastRoll
                const age = early ? 0 : (firsts.length > 1 ? firsts.indexOf(l.first) / (firsts.length - 1) : 1)
                const op = early ? 0.22 : 0.45 + 0.55 * age
                const now = curOI(l.key)
                if (now <= 0) return null
                const thin = now < l.totOI * 0.2
                const isFloor = l.key === floorKey, isHeavy = l.key === heavyKey
                const lw = 1.1 + 2.2 * (now / curMax)
                if (!thin || isFloor || isHeavy) {
                  labels.push({ y, col, op: isFloor ? 1 : op, oi: now, tag: isFloor ? '底' : isHeavy ? '重' : '', be: l.be })
                }
                const maxOi = Math.max(...tl.map(t => t.oi[l.key] ?? 0))
                return (
                  <g key={`l${l.key}`}>
                    <line x1={x0} y1={y} x2={W - 2} y2={y} stroke={col}
                      strokeWidth={isFloor ? Math.max(2.2, lw) : lw}
                      opacity={thin ? 0.25 : isFloor ? 1 : op} />
                    {tl.map((t, i) => {
                      const v = t.oi[l.key]
                      if (!v) return null
                      return <circle key={t.d} cx={X(i)} cy={y} r={1.5 + 2.6 * Math.sqrt(v / maxOi)}
                        fill={col} opacity={0.55} stroke="#fff" strokeWidth={0.5} />
                    })}
                  </g>
                )
              })}

              {/* 賣方防線 SC/SP：天天變，畫成折線不是水平線 */}
              {showOtm && (['sc', 'sp'] as const).map(key => {
                const col = key === 'sc' ? '#dc2626' : '#059669'
                const pts = tl.map((t, i) => t[key] != null ? [X(i), Y(t[key]!)] as [number, number] : null)
                  .filter((p): p is [number, number] => !!p)
                if (pts.length < 2) return null
                const lastPt = pts[pts.length - 1]
                const lastVal = [...tl].reverse().find(t => t[key] != null)?.[key]
                // 已結算的契約最後一點就貼在右緣，往右寫會被右側標籤欄切掉
                const flip = lastPt[0] + 4 + 46 > W - 2
                return (
                  <g key={key}>
                    <path d={smooth(pts)} fill="none" stroke={col} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.65} />
                    <text x={flip ? lastPt[0] - 4 : lastPt[0] + 4} y={lastPt[1] - 3}
                      textAnchor={flip ? 'end' : 'start'} fontSize={8} fontWeight={700} fill={col}
                      opacity={0.9} stroke="#fff" strokeWidth={2.4} paintOrder="stroke">
                      {key === 'sc' ? 'SC' : 'SP'} {nf(lastVal)}
                    </text>
                  </g>
                )
              })}

              <path d={smooth(tl.map((t, i) => t.idx != null ? [X(i), Y(t.idx)] as [number, number] : null)
                .filter((p): p is [number, number] => !!p))} fill="none" stroke="#0f172a" strokeWidth={2.4} />

              {tl.map((t, i) => (
                <g key={t.d}>
                  {t.idx != null && <circle cx={X(i)} cy={Y(t.idx)} r={2.4} fill="#0f172a" />}
                  <text x={X(i)} y={H - PB + 13} textAnchor="middle" fontSize={8.5} fill="#94a3b8">
                    {+t.d.slice(8)}
                  </text>
                  {(i === 0 || i === chart.vi0 || t.d.slice(5, 7) !== tl[i - 1].d.slice(5, 7)) && (
                    <text x={X(i)} y={H - PB + 23} textAnchor="middle" fontSize={8} fontWeight={600} fill="#475569">
                      {+t.d.slice(5, 7)}月
                    </text>
                  )}
                </g>
              ))}
              {future.map((fd, j) => {
                const x = X(tl.length + j), isExp = fd === c.exp
                return (
                  <g key={fd}>
                    {j === 0 && <line x1={x - DW / 2} y1={PT} x2={x - DW / 2} y2={H - PB} stroke="#cbd5e1" strokeDasharray="2 3" />}
                    <text x={x} y={H - PB + 13} textAnchor="middle" fontSize={8.5}
                      fontWeight={isExp ? 700 : 400} fill={isExp ? '#475569' : '#94a3b8'}>{+fd.slice(8)}</text>
                    {isExp && <text x={x} y={H - PB + 23} textAnchor="middle" fontSize={7.5} fill="#94a3b8">結算</text>}
                  </g>
                )
              })}
            </svg>
          </div>

          {/* 標籤畫在圖表外的固定欄，不佔繪圖區也不隨捲動跑掉 */}
          <svg width={LBW + 6} height={H} aria-hidden="true" className="block shrink-0">
            {(() => {
              const sorted = [...labels].sort((a, b) => a.y - b.y)
              let cursor = PT
              return sorted.map((lb, i) => {
                const ly = Math.max(cursor, Math.min(lb.y - LBH / 2, H - PB - LBH))
                cursor = ly + LBH + 1.5
                return (
                  <g key={i}>
                    <line x1={0} y1={lb.y} x2={3} y2={ly + LBH / 2} stroke={lb.col} strokeWidth={1} opacity={0.55} />
                    <rect x={3} y={ly} width={LBW} height={LBH} rx={3} fill={lb.col} opacity={lb.tag ? 1 : 0.15} />
                    <text x={7} y={ly + 9.5} fontSize={8.5} fontWeight={lb.tag ? 800 : 700} fill={lb.tag ? '#fff' : lb.col}>
                      {lb.tag ? `${lb.tag} ` : ''}{nf(lb.be)}
                    </text>
                    <text x={LBW - 1} y={ly + 9.5} textAnchor="end" fontSize={7.5} fill={lb.tag ? '#fff' : '#94a3b8'}>
                      {lb.oi}
                    </text>
                  </g>
                )
              })
            })()}
          </svg>
        </div>

        <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[9.5px] text-slate-500 px-1.5 pt-1">
          <span><i className="inline-block w-3 h-[3px] align-middle mr-0.5 bg-slate-900" />大盤收盤</span>
          <span><i className="inline-block w-3 h-0.5 align-middle mr-0.5 bg-blue-600" />BC 成本線</span>
          <span><i className="inline-block w-3 h-0.5 align-middle mr-0.5 bg-emerald-600" />BP 成本線</span>
          {showOtm && (
            <span>
              <i className="inline-block w-3 align-middle mr-0.5 border-t-2 border-dashed border-red-600" />SC
              <i className="inline-block w-3 align-middle mx-0.5 border-t-2 border-dashed border-emerald-600" />SP 賣方虧損點
            </span>
          )}
          <span className="text-slate-400">線粗＝目前 OI／底＝最低成本／重＝OI 最大</span>
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-[10.5px] text-slate-500 cursor-pointer">
        <input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} className="w-3 h-3 m-0" />
        顯示更早建倉的成本線（淡色）
      </label>
      <label className="flex items-center gap-1.5 text-[10.5px] text-slate-500 cursor-pointer">
        <input type="checkbox" checked={showOtm} onChange={e => setShowOtm(e.target.checked)} className="w-3 h-3 m-0" />
        顯示賣方防線 SC / SP（價外 OI 最大 ＋ 權利金＝賣方虧損點）
      </label>

      {/* ── 明細：跟著日曆選的日期（AC-CL-4／AC-CL-7）──────────── */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 flex flex-col gap-1">
        <div className="text-[11px] font-semibold text-slate-600">
          建倉明細（{detail.isLatest ? '' : `${md(detail.asOf)} · `}價內 · 留倉率 ≥80% · 累積 ≥100 口）
        </div>
        {!detail.rows.length && (
          <div className="text-[10.5px] text-slate-400 py-1">
            這個契約還沒有符合門檻的建倉（價內 · 留倉率 ≥80% · 累積 ≥100 口）。
            剛掛牌的契約通常要幾天才會出現主力部位。
          </div>
        )}
        {detail.rows.map(l => {
          const col = l.cp === 'C' ? 'text-blue-600' : 'text-emerald-600'
          const bar = l.cp === 'C' ? 'bg-blue-600' : 'bg-emerald-600'
          const gap = detail.last - l.be
          const ok = l.cp === 'C' ? gap >= 0 : gap <= 0
          const now = detail.oi(l.key)
          const max = Math.max(...detail.sub.map(t => t.oi[l.key] ?? 0))
          const trend = now >= max * 0.95 ? '' : now < max * 0.5 ? '已減倉逾半' : '部分平倉'
          const volSum = l.entries.reduce((a, e) => a + e.vol, 0)
          const churn = volSum > l.totOI ? (volSum - l.totOI) / 2 / volSum : 0
          const added = detail.add(l)
          return (
            <div key={l.key} className="flex items-start gap-1.5 border-b border-slate-200 last:border-0 pb-1 last:pb-0">
              <span className={`${bar} rounded-sm shrink-0 self-stretch ${l.key === detail.floorKey ? 'w-[5px]' : 'w-[3px]'}`} />
              <span className="flex-1 min-w-0">
                <span className="text-[11.5px] text-slate-700">
                  <b>{l.cp === 'C' ? 'BC' : 'BP'} {l.k}</b> 成本 {nf(l.cost)} → 兩平 <b>{nf(l.be)}</b>
                  {l.key === detail.floorKey && <span className={`ml-1 text-[9px] text-white rounded-sm px-1 ${bar}`}>底</span>}
                  {l.key === detail.heavyKey && <span className={`ml-1 text-[9px] text-white rounded-sm px-1 opacity-85 ${bar}`}>重</span>}
                  {added > 0 && <span className={`ml-1 text-[9px] rounded-sm px-1 border ${col} border-current`}>新</span>}
                </span>
                <span className="block text-[9.5px] text-slate-400 leading-relaxed">
                  {md(l.first)} · OI {nf(now)}（主力建 {nf(l.totOI)}）
                  {trend && ` · ${trend}`}
                  {added > 0 && <b className={`${col}`}> · {detail.dayWord} +{nf(added)}</b>}
                  {churn > 0.15 && <span className="text-amber-600"> · 換手 {(churn * 100).toFixed(0)}%</span>}
                </span>
              </span>
              <span className={`text-[11px] text-right shrink-0 tabular-nums ${ok ? col : 'text-slate-400'}`}>
                {gap >= 0 ? '+' : ''}{nf(gap)}
                <span className="block text-[9.5px] text-slate-400">{ok ? '已站上' : '未達'}</span>
              </span>
            </div>
          )
        })}

        {showOtm && detail.t.sc != null && detail.t.sp != null && (
          <div className="mt-1 pt-1.5 border-t border-slate-200 flex flex-col gap-1">
            <div className="text-[11px] font-semibold text-slate-600">賣方防線（{md(detail.t.d)}）</div>
            <div className="text-[11.5px] text-slate-700">
              <b>SC {nf(detail.t.sc)}</b> 賣方虧損點
              <span className="block text-[9.5px] text-slate-400">
                {nf(detail.t.scK)}C ＋權利金 · 距現價 {((detail.t.sc - detail.last) / detail.last * 100).toFixed(1)}%
              </span>
            </div>
            <div className="text-[11.5px] text-slate-700">
              <b>SP {nf(detail.t.sp)}</b> 賣方虧損點
              <span className="block text-[9.5px] text-slate-400">
                {nf(detail.t.spK)}P −權利金 · 距現價 {((detail.t.sp - detail.last) / detail.last * 100).toFixed(1)}%
              </span>
            </div>
            <div className="text-[9.5px] text-slate-400 leading-relaxed">
              取<b>價外</b> Call／Put、現價 ±5% 內的最大 OI。畫的是<b>賣方虧損點</b>（履約價 ± 權利金），
              賣方漲/跌過去才開始賠——與 BC 成本線是同一個數字、視角相反。
            </div>
          </div>
        )}

        <div className="text-[9.5px] text-slate-400 leading-relaxed mt-1">
          {detail.forced && <b className="text-amber-600">這個契約的建倉全在上次轉倉之前，已自動顯示全部。</b>}
          {detail.hidden > 0 && <span>已隱藏 {detail.hidden} 條轉倉前建立的舊部位。</span>}
          {' '}{detail.isLatest ? '最新指數' : `${md(detail.asOf)} 指數`} <b>{nf(detail.last)}</b>，
          在 {detail.legs.length} 條成本線中站上 <b>
            {detail.legs.filter(l => l.cp === 'C' ? detail.last >= l.be : detail.last <= l.be).length}
          </b> 條。
        </div>
      </div>
    </div>
  )
}
