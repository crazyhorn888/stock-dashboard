'use client'
import { useState } from 'react'
import type { IndexOHLC } from '@/lib/types'
import {
  getHeatState, HEAT_BAR, HEAT_TONE, HEAT_BASELINE, HEAT_CONDITIONS,
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

export default function MarketHeatCard({ indexHistory }: Props) {
  const [open, setOpen] = useState(false)
  const st = getHeatState(indexHistory)

  // pipeline 尚未產出熱度（heat-history 未回補／當日籌碼缺金額欄位）→ 整張卡不顯示
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

        {/* 固定兩項指標（AC-HT-D2 的對照依據） */}
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2.5">
          <Stat label="進場後 60 日賺 10%" value={`${st.upOdds}%`} base={`基準 ${HEAT_BASELINE.up}%`} />
          <Stat label="20 日內回落 5%" value={`${st.downOdds}%`} base={`基準 ${HEAT_BASELINE.down}%`} />
        </div>

        {/* 警示層：平常不出現（AC-HT-D1），兩者互斥 */}
        {st.alertTop && (
          <Flag
            tone="red"
            title={st.alertBy === 'reversal' ? '🔴 頂部風險警示　外資背離'
                 : st.alertBy === 'both'     ? `🔴 頂部風險警示　計分 ${st.warn}/6 ＋ 外資背離`
                 :                             `🔴 頂部風險警示　${st.warn} / 6`}
            foot={st.alertBy === 'reversal'
              ? '24 天樣本、命中 33%（平時 12%）、平均提前 8.0 個交易日。67% 是誤報。'
              : '36 天樣本、命中 36%（平時 12%）、平均提前 4.5 個交易日。64% 是誤報。'}
          >
            {(st.alertBy === 'score' || st.alertBy === 'both') && (
              <li>六項條件中已成立 {st.warn} 項，詳見「?」說明</li>
            )}
            {(st.alertBy === 'reversal' || st.alertBy === 'both') && (
              <li>外資近 10 日曾在選擇權押多，今日現貨轉為大賣</li>
            )}
          </Flag>
        )}
        {!st.alertTop && st.entry && (
          <Flag tone="blue" title="🔵 進場訊號成立"
                foot={`歷史僅 ${st.sample} 次、成功率 ${st.upOdds}%（基準 ${HEAT_BASELINE.up}%）。樣本少，僅供參考。`}>
            <li>指數自 60 日高點回落 ≥8%</li>
            <li>熱度曾跌破 P30，現已回升至 P{st.heat}</li>
          </Flag>
        )}

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
              資料回溯 2022-01-03（1130 個交易日）
              {today?.date ? `　·　目前顯示 ${today.date}` : ''}
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
              今日成立 <b className="text-slate-600">{st.warn} / 6</b> 項，≥4 項即亮頂部風險警示。
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
                    ['≤P30　弱勢', 208, 25, 22],
                    ['P30–50　轉溫', 114, 40, 14],
                    ['P50–80　健康', 210, 61, 5],
                    ['P80–95　偏熱', 100, 50, 21],
                    ['≥P95　極熱', 62, 45, 29],
                    ['基準（隨便挑一天）', 715, 45, 16],
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
              風險呈 U 型：太冷與太熱都危險，最安全的是 P50–80（跌 5% 機率僅 5%）。
              P80 是最乾淨的斷點——P75–79 只有 2%，P80–84 直接跳到 19%。
              「60 日賺 10%」指未來 60 個交易日報酬 ≥ +10% 且 20 日內未跌破 −5%。
            </p>
            {st.unstable && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 leading-relaxed">
                ⚠️ 目前所在的「{st.label}」區間：{st.unstable}。
              </p>
            )}

            <Section>警示與進場的觸發條件</Section>
            <p className="text-xs text-slate-600 leading-relaxed mb-1.5">
              <b>🔴 頂部警示</b>：六項中 ≥4 項成立，或「外資近 10 日曾在選擇權押多、今日現貨轉為大賣」。
              歷史 36 天樣本、命中 36%（平時 12%）、平均提前 4.5 個交易日。
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              <b>🔵 進場訊號</b>：指數自 60 日高點回落 ≥8%，且熱度曾跌破 P30、現已回升至 ≥P50。
              歷史 16 次、成功率 88%、期間最大回落僅 −0.62%。
            </p>

            <Section>必須知道的限制</Section>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-800 leading-relaxed">
              ① 頂部警示 <b>64% 是誤報</b>，且會漏掉約 3/7 的下跌。<br />
              ② 只有 11 次起跌事件、21 次進場樣本，統計基礎薄弱。<br />
              ③ <b>不涵蓋突發的地緣或政策衝擊</b>——2024-04 伊朗攻以、2024-08 選擇權結算日、
              2025-02 關稅與油價這三次，籌碼面事前完全沒有徵兆。<br />
              ④ 籌碼結構會隨時間漂移，建議每年重跑一次回測。
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Stat({ label, value, base }: { label: string; value: string; base: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10.5px] text-slate-400 leading-snug">{label}</span>
      <span className="text-[15px] font-semibold text-slate-700 tabular-nums">
        {value}
        <span className="text-[10px] font-normal text-slate-400 ml-1">{base}</span>
      </span>
    </div>
  )
}

function Flag({ tone, title, foot, children }: {
  tone: 'red' | 'blue'; title: string; foot: string; children: React.ReactNode
}) {
  const c = tone === 'red'
    ? { box: 'bg-red-50 border-red-200', head: 'text-red-700', line: 'border-red-200' }
    : { box: 'bg-blue-50 border-blue-200', head: 'text-blue-700', line: 'border-blue-200' }
  return (
    <div className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 ${c.box}`}>
      <div className={`text-[12.5px] font-bold ${c.head}`}>{title}</div>
      <ul className="text-[12px] text-slate-700 list-disc pl-4 leading-relaxed">{children}</ul>
      <div className={`text-[10.5px] text-slate-500 border-t pt-1.5 leading-relaxed ${c.line}`}>{foot}</div>
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold text-slate-400 tracking-wider mt-4 mb-1.5">{children}</div>
  )
}
