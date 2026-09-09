'use client'

/**
 * PC Ratio 與支撐壓力通道（AC-PCR-7～14，2026-09-09）。
 *
 * 四條線：SC 壓力（紅）、SP 支撐（綠）、大盤收盤（紫）走左軸，PC Ratio 走右軸。
 * SC 與 SP 之間填色，形成「選擇權隱含的支撐壓力通道」——通道張開代表佈局遠離現價。
 *
 * 口徑一律用近月月選（AC-PCR-13）：週選每兩週換約、全市場合計每隔幾天就有契約結算，
 * 那些數字的跳動來自成分更換而非市場情緒。散點也必須同源，否則「點有沒有落在通道裡」
 * 這個對照就不成立。
 *
 * ⚠️ 本元件不做任何亮燈（AC-PCR-1）。889 天回測已否證「佈局遠離＋PCR 上升＝背離」
 * 這個假設——那個組合實測是偏多形狀（跌逾 3% 機率 4.1%，基準 12.0%）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { OptionsOISnapshot } from '@/lib/types'

interface Point {
  date: string
  sc: number
  sp: number
  twii: number | null
  pcr: number
}

interface Props {
  snap: OptionsOISnapshot
  /** 大盤收盤，key 為 YYYY-MM-DD */
  indexClose: Record<string, number>
  today: string
}

const H = 228, PT = 8, PB = 28, DAY_W = 18
/** 平滑曲線的控制點會衝過資料點，60 日模式實測最多 10px；不內縮會壓到日期標籤 */
const IN = 12

/** 近月月選＝當日資料裡到期最近、尚未到期的純 6 碼契約 */
function monthlySeries(snap: OptionsOISnapshot, today: string): Point[] {
  const out: Point[] = []
  for (const date of Object.keys(snap.days).sort()) {
    if (date > today) continue
    const day = snap.days[date]
    const fut = snap.fut?.[date]
    if (!fut) continue
    const codes = Object.keys(day).filter(c => /^\d{6}$/.test(c) && day[c].exp >= date).sort()
    const rec = codes.length ? day[codes[0]] : null
    if (!rec?.oiC || !rec.nC || !rec.nP) continue
    out.push({ date, sc: rec.nC[0], sp: rec.nP[0], twii: null, pcr: (rec.oiP ?? 0) / rec.oiC * 100 })
  }
  return out
}

/** Catmull-Rom 轉三次貝茲。兩點之間是插值，不代表當日真實位置 */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${c1x} ${c1y},${c2x} ${c2y},${p2[0]} ${p2[1]}`
  }
  return d
}

export default function OptionsOIChart({ snap, indexClose, today }: Props) {
  const [range, setRange] = useState<20 | 60>(20)
  const [showDelta, setShowDelta] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(290)

  const all = useMemo(
    () => monthlySeries(snap, today).map(p => ({ ...p, twii: indexClose[p.date] ?? null })),
    [snap, indexClose, today],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setAvail(el.clientWidth || 290)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const view = useMemo(() => {
    const s = all.slice(-range)
    if (s.length < 2) return null
    // 20 日撐滿容器不必捲；60 日固定格寬、超出的橫向捲動
    const dw = range <= 20 ? Math.max(13, avail / s.length) : DAY_W
    const W = s.length * dw
    const prices = s.flatMap(p => [p.twii, p.sc, p.sp]).filter((v): v is number => v != null)
    const pMin = Math.min(...prices) * 0.995, pMax = Math.max(...prices) * 1.005
    const rs = s.map(p => p.pcr)
    const rMin = Math.min(...rs) * 0.95, rMax = Math.max(...rs) * 1.05
    const X = (i: number) => i * dw + dw / 2
    const Y = (v: number) => PT + IN + (pMax - v) / (pMax - pMin) * (H - PT - PB - IN * 2)
    const Y2 = (v: number) => PT + IN + (rMax - v) / (rMax - rMin) * (H - PT - PB - IN * 2)
    return { s, W, X, Y, Y2, pMin, pMax, rMin, rMax }
  }, [all, range, avail])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth   // 進來就停在最新一天
  }, [view])

  // 資料不足時說明現況，不要整塊無聲消失——舊快照沒有 fut/nC/nP 這些欄位，
  // 靜靜不顯示的話使用者只會看到卡片少一塊，無從判斷是壞了還是還沒到
  if (!view) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">
        PC Ratio 走勢需要至少兩個交易日的近月月選資料，稍後收盤更新後顯示
      </div>
    )
  }
  const { s, W, X, Y, Y2, pMin, pMax, rMin, rMax } = view

  const scPts = s.map((p, i) => [X(i), Y(p.sc)] as [number, number])
  const spPts = s.map((p, i) => [X(i), Y(p.sp)] as [number, number])
  const twiiPts = s.filter(p => p.twii != null).map((p) => [X(s.indexOf(p)), Y(p.twii!)] as [number, number])
  // revSp 開頭是 M，換成 L 才能接在 SC 那段後面而不另起新路徑
  const revSp = smooth([...spPts].reverse())

  const deltaMax = showDelta
    ? Math.max(1, ...s.flatMap(p => {
        const day = snap.days[p.date]
        const code = Object.keys(day).filter(c => /^\d{6}$/.test(c)).sort()[0]
        const r = day[code]
        return [...(r?.dnC ?? []), ...(r?.dnP ?? [])].map(v => v[1])
      }))
    : 1

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-1 pt-2 pb-0.5">
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
        <span className="text-[11px] font-semibold text-slate-600">PC Ratio 與支撐壓力通道</span>
        <div className="flex gap-1">
          {([20, 60] as const).map(n => (
            <button
              key={n}
              onClick={() => setRange(n)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border ${
                range === n
                  ? 'bg-slate-800 text-white border-slate-800 font-semibold'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >{n === 20 ? '近 20 日' : '60 日'}</button>
          ))}
        </div>
      </div>

      {/* 左右軸各自獨立，只有中間繪圖區捲動——整張一起捲的話刻度會跟著跑掉 */}
      <div className="flex items-start">
        <svg width={40} height={H} aria-hidden="true" className="block shrink-0">
          {[0, 1, 2, 3, 4].map(k => {
            const v = pMin + (pMax - pMin) * k / 4
            return (
              <text key={k} x={36} y={Y(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">
                {Math.round(v / 100) * 100}
              </text>
            )
          })}
        </svg>

        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <svg width={W} height={H} className="block" role="img" aria-label="PC Ratio 與支撐壓力通道走勢">
            {[0, 1, 2, 3, 4].map(k => {
              const y = Y(pMin + (pMax - pMin) * k / 4)
              return <line key={k} x1={0} y1={y} x2={W} y2={y} stroke="#e8edf3" />
            })}

            <path d={`${smooth(scPts)}L${revSp.slice(1)}Z`} fill="rgba(37,99,235,.07)" />
            <path d={smooth(scPts)} fill="none" stroke="#dc2626" strokeWidth={1.6} />
            <path d={smooth(spPts)} fill="none" stroke="#059669" strokeWidth={1.6} />
            {twiiPts.length > 1 && (
              <path d={smooth(twiiPts)} fill="none" stroke="#7c3aed" strokeWidth={1.5} />
            )}
            <path
              d={smooth(s.map((p, i) => [X(i), Y2(p.pcr)] as [number, number]))}
              fill="none" stroke="#d97706" strokeWidth={1.4} strokeDasharray="3 2"
            />

            {/* AC-PCR-12：加倉散點，刻意不連線——相鄰日跳動中位 1000 點，連起來只是鋸齒 */}
            {showDelta && s.map((p, i) => {
              const day = snap.days[p.date]
              const code = Object.keys(day).filter(c => /^\d{6}$/.test(c)).sort()[0]
              const r = day[code]
              if (!r) return null
              const pts = [
                ...(r.dnC ?? []).map(v => ({ v, fill: '#dc2626' })),
                ...(r.dnP ?? []).map(v => ({ v, fill: '#059669' })),
              ]
              return pts.map(({ v, fill }, j) => (
                <circle
                  key={`${p.date}-${j}`}
                  cx={X(i)} cy={Y(v[0])}
                  r={1.4 + 2.2 * Math.sqrt(v[1] / deltaMax)}
                  fill={fill} opacity={0.55} stroke="#fff" strokeWidth={0.6}
                />
              ))
            })}

            {s.map((p, i) => {
              const day = +p.date.slice(8)
              const isMonth = i === 0 || p.date.slice(5, 7) !== s[i - 1].date.slice(5, 7)
              return (
                <g key={p.date}>
                  <line x1={X(i)} y1={H - PB} x2={X(i)} y2={H - PB + 3} stroke="#cbd5e1" />
                  {p.twii != null && <circle cx={X(i)} cy={Y(p.twii)} r={1.5} fill="#7c3aed" />}
                  <text x={X(i)} y={H - PB + 12} textAnchor="middle" fontSize={8.5} fill="#94a3b8">{day}</text>
                  {/* 月份只在真的換月時標，先前每 5 日也標會讓同一個月出現三次 */}
                  {isMonth && (
                    <text x={X(i)} y={H - PB + 22} textAnchor="middle" fontSize={9} fontWeight={600} fill="#475569">
                      {+p.date.slice(5, 7)}月
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        <svg width={36} height={H} aria-hidden="true" className="block shrink-0">
          {[0, 1, 2, 3].map(k => {
            const v = rMin + (rMax - rMin) * k / 3
            return (
              <text key={k} x={3} y={Y2(v) + 3} fontSize={8} fill="#d97706">{Math.round(v)}%</text>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[9.5px] text-slate-500 px-1.5 pt-1">
        <span><i className="inline-block w-3 h-0.5 align-middle mr-0.5 bg-red-600" />SC 壓力</span>
        <span><i className="inline-block w-3 h-0.5 align-middle mr-0.5 bg-emerald-600" />SP 支撐</span>
        <span><i className="inline-block w-3 h-0.5 align-middle mr-0.5 bg-violet-600" />大盤收盤</span>
        <span><i className="inline-block w-3 align-middle mr-0.5 border-t-2 border-dashed border-amber-600" />PC Ratio（右軸）</span>
      </div>

      <label className="flex items-center gap-1.5 text-[10.5px] text-slate-500 px-1.5 pt-1 pb-0.5 cursor-pointer">
        <input
          type="checkbox"
          checked={showDelta}
          onChange={e => setShowDelta(e.target.checked)}
          className="w-3 h-3 m-0"
        />
        疊上每日加倉前三大（±5% 內）{showDelta && '（點大小＝口數）'}
      </label>
    </div>
  )
}
