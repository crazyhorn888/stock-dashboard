'use client'
import { useEffect, useState } from 'react'

/**
 * 後台「熱度校準」區塊。
 *
 * 資料由 scripts/heat-drift-report.mjs 季度跑完寫進 Supabase 的 heat-drift.json。
 * 沒超標也會寫，所以這裡永遠看得到「上次檢查是什麼時候、結論是什麼」——
 * 季度一次的 GitHub 失敗信太容易滑掉，後台才是真的會看到的地方。
 */
interface Drift {
  checkedAt: string
  asOf: string | null
  range: [string, string]
  sampleDays: number
  shippedSampleDays: number
  ok: boolean
  alerts: string[]
  rows: { label: string; n: number; shipped: { down: number; up: number }; now: { down: number; up: number } }[]
  baseline: { shipped: { down: number; up: number }; now: { down: number; up: number } }
}

const fmt = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export default function DriftPanel() {
  const [d, setD] = useState<Drift | null>(null)
  const [missing, setMissing] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
    if (!base) return
    fetch(base.replace('latest.json', 'heat-drift.json'), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setD)
      .catch(() => setMissing(true))
  }, [])

  // 還沒跑過第一次就整塊不顯示——後台已經夠擠，沒資料的空殼沒有意義
  if (missing || !d) return null

  const stale = (Date.now() - new Date(d.checkedAt).getTime()) / 86400000 > 100

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5 mb-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 text-left">
        <span className="text-[11px] font-bold text-slate-500">熱度校準</span>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
          d.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {d.ok ? '線上數字仍成立' : `${d.alerts.length} 項超過門檻`}
        </span>
        <span className="text-[10.5px] text-slate-400 ml-auto">
          {fmt(d.checkedAt)} 檢查{stale ? '（已逾一季）' : ''}
        </span>
        <span className="text-[10px] text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {!d.ok && (
        <ul className="mt-2 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed list-disc pl-6">
          {d.alerts.map(a => <li key={a}>{a}</li>)}
          <li className="list-none -ml-4 mt-1 text-[11px] text-amber-700">
            先確認不是資料源問題，再跑三段外樣本，才決定要不要改 <code>lib/marketHeat.ts</code>
          </li>
        </ul>
      )}

      {open && (
        <div className="mt-2">
          <p className="text-[10.5px] text-slate-400 mb-1.5">
            {d.range[0]} ~ {d.range[1]}　樣本 {d.sampleDays} 天
            （校準時 {d.shippedSampleDays} 天，多了 {d.sampleDays - d.shippedSampleDays} 天）
            {d.asOf && `　· 指定 as-of ${d.asOf}`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="text-left px-2 py-1 font-semibold">狀態</th>
                  <th className="text-right px-2 py-1 font-semibold">跌 5% 線上 / 最新</th>
                  <th className="text-right px-2 py-1 font-semibold">賺 10% 線上 / 最新</th>
                </tr>
              </thead>
              <tbody className="text-slate-600 tabular-nums">
                {d.rows.map(r => {
                  const dd = r.now.down - r.shipped.down
                  return (
                    <tr key={r.label} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1">{r.label}</td>
                      <td className="px-2 py-1 text-right">
                        {r.shipped.down}% / {r.now.down}%
                        {dd !== 0 && <span className={Math.abs(dd) >= 6 ? 'text-amber-600 font-semibold' : 'text-slate-400'}> ({sign(dd)})</span>}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {r.shipped.up}% / {r.now.up}%
                      </td>
                    </tr>
                  )
                })}
                <tr className="text-slate-400 border-t border-slate-200">
                  <td className="px-2 py-1">基準</td>
                  <td className="px-2 py-1 text-right">{d.baseline.shipped.down}% / {d.baseline.now.down}%</td>
                  <td className="px-2 py-1 text-right">{d.baseline.shipped.up}% / {d.baseline.now.up}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-slate-400 mt-1.5 leading-relaxed">
            每季首日自動跑。風險側任一格差 ≥6 個百分點、或報酬側與基準的差距變 ≥8 個百分點，
            就會標為超標——報酬絕對值會隨多空循環漂，但與基準的差距穩定得多。
          </p>
        </div>
      )}
    </div>
  )
}
