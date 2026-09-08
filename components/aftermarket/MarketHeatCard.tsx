'use client'
import { useState } from 'react'
import type { IndexOHLC } from '@/lib/types'
import {
  getHeatState, HEAT_BAR, HEAT_TONE, HEAT_BASELINE, HEAT_CONDITIONS, FLAG_STATS,
} from '@/lib/marketHeat'

/**
 * 市場熱度卡（AC-HT-D1~D8）。
 *
 * 分層顯示：熱度數字、溫度條、兩格固定機率永遠在；警示與進場區塊平常不出現，
 * 只在條件成立時長出，兩者互斥。設計理由見 lib/marketHeat.ts 的註解——
 * 熱度高不等於危險，若熱度高就變紅，紅色一年會亮 200 天且方向是錯的。
 */

interface Props {
  indexHistory?: IndexOHLC[]
}

/** 2026-09-07 → 09/07 */
const fmtDate = (d: string) => d.slice(5).replace('-', '/')

export default function MarketHeatCard({ indexHistory }: Props) {
  const [open, setOpen] = useState(false)
  const st = getHeatState(indexHistory)

  // 整段歷史都沒有熱度（heat-history 未回補）→ 整張卡不顯示。
  // 只是「今天籌碼還沒進來」不會走到這裡，而是走 AC-HT-B6 的待更新提示
  if (!st) return null

  const tone = HEAT_TONE[st.level]
  const today = indexHistory?.[0]

  return (
    <>
      <div className="w-full bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex flex-col gap-3">
        {/* 標題列 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 tracking-wide">市場熱度</span>
            <button
              onClick={() => setOpen(true)}
              aria-label="市場熱度說明"
              className="w-[17px] h-[17px] rounded-full border border-slate-300 text-slate-400 text-[11px] font-bold leading-none flex items-center justify-center transition-colors hover:border-slate-500 hover:text-slate-700"
            >?</button>
          </div>
          <span className={`text-[11.5px] font-bold px-2.5 py-0.5 rounded-full ${tone.pill}`}>
            {st.label}
          </span>
        </div>

        {/* AC-HT-B6 待更新提示：六項條件必須同一天，寧可標示落後也不混用兩天的資料 */}
        {st.stale && (
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5">
            <span className="text-[12px] leading-[18px]">🕘</span>
            <span className="text-[11.5px] leading-[18px] text-amber-800">
              {fmtDate(st.stale.latest)} 的籌碼尚未更新，以下為
              <span className="font-semibold">{fmtDate(st.stale.asOf)}</span>
              收盤的熱度。籌碼約在盤後陸續進來，屆時自動更新。
            </span>
          </div>
        )}

        {/* 數值 */}
        <div className="flex items-baseline gap-1.5">
          <span className={`text-[34px] font-semibold leading-none tabular-nums ${tone.num}`}>
            {st.heat}
          </span>
          <span className="text-xs text-slate-400 tabular-nums">/ 100</span>
        </div>

        {/* 溫度條 */}
        <div>
          <div className="h-[7px] rounded bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded transition-all duration-500"
              style={{ width: `${st.heat}%`, background: HEAT_BAR[st.level] }}
            />
          </div>
          <div className="flex justify-between text-[9.5px] text-slate-400 mt-1 tabular-nums">
            <span>冷</span><span>P30</span><span>P50</span><span>P80</span><span>熱</span>
          </div>
        </div>

        {/* AC-HT-D11 風險–報酬雙軸條：兩個指標各自跟全樣本基準並排，
            長短一眼看出高於還是低於平均。兩條共用同一個 0~60% 尺規，
            所以風險與報酬的絕對大小也可以互相比 */}
        <div className="border-t border-slate-100 pt-2.5 flex flex-col gap-2">
          <CompareBar label="20 日內回落 5%" value={st.downOdds} base={HEAT_BASELINE.down} worseIsHigher />
          <CompareBar label="60 日賺 10% 不被套" value={st.upOdds} base={HEAT_BASELINE.up} />
        </div>

        {/* AC-HT-D9 兩個旗標常駐：平常灰著把條件寫出來，成立時整列變色並補上機率。
            先前只在成立時才出現，等於一年裡有 220 天使用者不知道系統在看什麼 */}
        <div className="border-t border-slate-100 pt-2.5 flex flex-col gap-1.5">
          <FlagRow
            on={st.alertTop} tone="red" name="外資倒貨"
            cond="熱度 ≥P30，且外資今天大賣現貨"
            note="這根下跌比一般的更容易延續 —— 先別接刀，等藍燈"
            stat={`亮燈日有 ${FLAG_STATS.rev.hit}% 在 20 日內跌 5%（平常 ${FLAG_STATS.rev.base}%）`}
          />
          <FlagRow
            on={st.entry} tone="blue" name="跌深轉強"
            cond="自 60 日高點回落 ≥8%，熱度由 P30 以下翻上 P50"
            note="跌夠了、動能翻上來，歷史上最好的承接點"
            stat={`亮燈日有 ${FLAG_STATS.entry.hit}% 在 60 日內賺 10%（平常 ${FLAG_STATS.entry.base}%）`}
          />
        </div>

        {/* 一句話建議 */}
        <div className={`text-xs leading-relaxed px-3 py-2 rounded-lg ${tone.msg}`}>
          {st.advice}
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl p-5 shadow-xl max-h-[82vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="text-sm font-bold text-slate-800">市場熱度怎麼算</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 text-lg leading-none px-1">✕</button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              回測 2019-11 ~ 2026-06（1602 個交易日）
              {st.stale ? `　·　資料日 ${st.stale.asOf}` : today?.date ? `　·　目前顯示 ${today.date}` : ''}
            </p>

            <p className="text-xs text-slate-600 leading-relaxed mb-2">
              把六項籌碼與價量指標各自轉成 <b>Z 值</b>（今天的數字比過去 250 天的平均高或低幾個標準差），
              取平均後看這個分數在過去 250 天排第幾個百分位，就是熱度 0~100。
              全部用<b>相對比率</b>而非絕對金額，市場量體長大也不會失真。
            </p>

            <Section>六項條件</Section>
            <ul className="text-xs text-slate-600 leading-relaxed list-disc pl-5 mb-1">
              {HEAT_CONDITIONS.map(c => <li key={c}>{c}</li>)}
            </ul>
            <p className="text-[11px] text-slate-400 mb-1">
              今日成立 <b className="text-slate-600">{st.warn} / 6</b> 項。這只是熱度的組成，不是警示。
            </p>

            <Section>熱度分級的歷史表現</Section>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="text-left px-2 py-1 font-semibold">熱度</th>
                    <th className="text-right px-2 py-1 font-semibold">樣本</th>
                    <th className="text-right px-2 py-1 font-semibold">60 日賺 10%</th>
                    <th className="text-right px-2 py-1 font-semibold">20 日回落 5%</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600 tabular-nums">
                  {[
                    ['≤P30　弱勢', 474, 26, 24],
                    ['P30–50　轉溫', 306, 32, 21],
                    ['P50–80　健康', 472, 36, 18],
                    ['P80–95　強勢', 231, 45, 11],
                    ['≥P95　極熱', 119, 29, 28],
                    ['基準（隨便挑一天）', 1602, 33, 20],
                  ].map(([l, n, u, d]) => (
                    <tr key={String(l)} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1">{l}</td>
                      <td className="px-2 py-1 text-right">{n}</td>
                      <td className="px-2 py-1 text-right">{u}%</td>
                      <td className="px-2 py-1 text-right">{d}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              風險呈 U 型：太冷與太熱都危險，最安全的是 P80–95（跌 5% 僅 11%），
              真正該警戒的只有 ≥P95（28%）與低溫區（24%）。
              樣本 1602 天（2019-11 ~ 2026-06），資料源為期交所官方序列。
              「60 日賺 10%」指未來 60 個交易日報酬 ≥ +10% 且 20 日內未跌破 −5%。
            </p>
            {st.unstable && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 leading-relaxed">
                ⚠️ 目前所在的「{st.label}」區間：{st.unstable}。
              </p>
            )}

            <Section>兩個旗標</Section>
            <p className="text-xs text-slate-600 leading-relaxed mb-1">
              <b>🔴 外資倒貨</b>　熱度 ≥P30，且外資今天大賣現貨（佔成交金額的 Z ≤ −1）。
            </p>
            <p className="text-xs text-slate-600 leading-relaxed mb-2.5">
              <b>🔵 跌深轉強</b>　指數自 60 日高點回落 ≥8%，且熱度曾跌破 P30、現已回升至 ≥P50。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="text-left px-2 py-1 font-semibold">亮燈後</th>
                    <th className="text-right px-2 py-1 font-semibold">🔴 倒貨</th>
                    <th className="text-right px-2 py-1 font-semibold">🔵 轉強</th>
                    <th className="text-right px-2 py-1 font-semibold">隨便挑一天</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600 tabular-nums">
                  {[
                    ['樣本天數', '103', '79', '1602'],
                    ['20 日內跌 5%', '44%', '13%', '20%'],
                    ['持有 20 日報酬', '+0.5%', '+4.9%', '+1.9%'],
                    ['持有 60 日報酬', '+6.9%', '+7.8%', '+5.7%'],
                    ['60 日賺 10% 不被套', '—', '56%', '33%'],
                  ].map(([l, a, b, c]) => (
                    <tr key={l} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1">{l}</td>
                      <td className="px-2 py-1 text-right">{a}</td>
                      <td className="px-2 py-1 text-right">{b}</td>
                      <td className="px-2 py-1 text-right text-slate-400">{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              <b className="text-slate-500">紅燈不是承接點。</b>亮燈當天有 92% 在跌（平常 45%），
              但買進後持有 20 日只有 +0.5%，輸給隨便挑一天的 +1.9%；真的跌破 5% 的那 23 天，
              60 日後只有 35% 回到正報酬。跌夠了要等藍燈——同樣持有 20 日是 +4.9%、勝率 82%。
            </p>

            <Section>這張卡做不到的事</Section>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-800 leading-relaxed">
              <b>抓不到突發衝擊。</b>地緣、政策、結算日這類事件，籌碼面事前不會有徵兆——
              2024-04 伊朗攻以、2025-02 關稅就是這樣跌下來的。<br />
              <b>機率不是保證。</b>籌碼結構每隔幾年會漂移，表上的數字每年要重跑一次。
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 一個指標與全樣本基準的並排對比條。
 * worseIsHigher：這個指標越高越糟（回落機率）——決定超出基準時該用紅還是綠。
 */
function CompareBar({ label, value, base, worseIsHigher = false }: {
  label: string; value: number; base: number; worseIsHigher?: boolean
}) {
  const SCALE = 60                       // 共用尺規上限，兩條才能互相比大小
  const w = (v: number) => `${Math.min(100, v / SCALE * 100)}%`
  const above = value > base
  const good = worseIsHigher ? !above : above
  const diff = Math.round(value - base)
  const barColor = Math.abs(diff) < 2 ? 'bg-slate-400'
    : good ? 'bg-emerald-500' : 'bg-rose-500'
  const tag = Math.abs(diff) < 2 ? '與平均相當'
    : `${above ? '高' : '低'}於平均 ${Math.abs(diff)} 個百分點`
  const tagColor = Math.abs(diff) < 2 ? 'text-slate-400'
    : good ? 'text-emerald-600' : 'text-rose-600'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] text-slate-400">{label}</span>
        <span className={`text-[10px] font-medium ${tagColor}`}>{tag}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <div className="flex-1 h-[9px] rounded bg-slate-100 overflow-hidden">
          <div className={`h-full rounded transition-all duration-500 ${barColor}`} style={{ width: w(value) }} />
        </div>
        <span className="text-[12px] font-semibold text-slate-700 tabular-nums w-[34px] text-right">{value}%</span>
      </div>
      <div className="flex items-center gap-1.5 mt-[3px]">
        <div className="flex-1 h-[5px] rounded bg-slate-100 overflow-hidden">
          <div className="h-full rounded bg-slate-300" style={{ width: w(base) }} />
        </div>
        <span className="text-[10px] text-slate-400 tabular-nums w-[34px] text-right">{base}%</span>
      </div>
    </div>
  )
}

/** 常駐的旗標列：未成立時是灰底一行條件，成立時上色並長出機率與提醒 */
function FlagRow({ on, tone, name, cond, stat, note }: {
  on: boolean; tone: 'red' | 'blue'; name: string; cond: string; stat: string; note: string
}) {
  const c = on
    ? (tone === 'red'
        ? { box: 'bg-red-50 border-red-200', dot: 'bg-red-500', name: 'text-red-700', cond: 'text-slate-700' }
        : { box: 'bg-blue-50 border-blue-200', dot: 'bg-blue-500', name: 'text-blue-700', cond: 'text-slate-700' })
    : { box: 'bg-slate-50 border-slate-100', dot: 'bg-slate-300', name: 'text-slate-500', cond: 'text-slate-400' }
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${c.box}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${c.dot}`} />
        <span className={`text-[11.5px] font-bold shrink-0 ${c.name}`}>{name}</span>
        <span className="text-[10px] text-slate-400 ml-auto shrink-0">{on ? '成立' : '未成立'}</span>
      </div>
      <p className={`text-[11px] leading-snug mt-0.5 pl-[13px] ${c.cond}`}>{cond}</p>
      {on && (
        <>
          <p className="text-[10px] text-slate-500 leading-snug mt-1 pl-[13px]">{stat}</p>
          <p className={`text-[10.5px] font-medium leading-snug mt-0.5 pl-[13px] ${c.name}`}>{note}</p>
        </>
      )}
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold text-slate-400 tracking-wider mt-4 mb-1.5">{children}</div>
  )
}
