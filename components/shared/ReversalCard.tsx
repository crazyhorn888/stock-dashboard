'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { ReversalSignal } from '@/lib/reversalSignals'

/**
 * 反轉訊號卡（AC-RV-4）。市場條件頁與盤後行情頁共用同一個元件。
 *
 * 分數規則（AC-RV-3）：四條件各 1 分，3 分黃燈、4 分紅燈、2 分以下不亮。
 * 647 天回測：低點 3 分超額 +3.48%、高點 3 分 −1.22%／4 分 −1.43%。
 */

interface Props {
  kind: 'low' | 'high'
  signal: ReversalSignal
  compact?: boolean   // 盤後行情頁的小方塊版
  nDays?: number      // 「融資追價過頭」的起算區間，用來把 N 代進公式字串
}

// 建立在 Z-Score 上的條件；卡片裡出現任何一個就附上 Z 的算式（AC-PB-7）
const Z_CONDITIONS = new Set(['統計極端恐慌', '軋空燃料枯竭', '外資調節出貨'])

/**
 * 各條件的算式。AC-PB-6：說明跟著它所屬的卡走，不再集中在問號 Modal——
 * 看哪張卡就讀哪張卡的公式，問號只留四張卡共用的基礎知識。
 */
const FORMULA: Record<string, string | ((n: number) => string)> = {
  大盤有感下跌: '當日跌幅 > 0.5%',
  融資恐慌殺出: '|融資變動%| ÷ |大盤跌幅%| > 1.5',
  統計極端恐慌: '融資變動 20 日 Z ≤ −2',
  法人低檔接手: '外資 + 投信現貨合計買超',
  融資追價過頭: (n: number) => `融資增幅 − 大盤增幅 ≥ 7%（從 ${n} 日低點起算）`,
  價跌資增背離: '大盤下跌，但融資反而增加',
  軋空燃料枯竭: '券資比 60 日 Z ≤ −1',
  外資調節出貨: '外資買賣超 60 日 Z ≤ −1.5',
}

const META = {
  low: {
    title: '低點反轉',
    formula: '4 項條件成立 ≥ 3',
    tone: 'red' as const,
    watch: '融資恐慌殺出，留意落底',
    alert: '恐慌 + 法人接手，反轉訊號',
    idle: '尚無恐慌訊號',
    desc: '散戶融資恐慌殺出、法人低檔接手時亮燈。四項條件成立三項即進入觀察。',
    note: '散戶砍在低點、法人接手，是統計上勝率較高的落底型態。最常缺的是「法人低檔接手」——大跌當天法人通常也在賣，要隔一兩天才進場承接。',
    backtest: '647 天回測：3 分出現 10 次，之後 5 個交易日平均 +4.30%（同期大盤平均 +0.82%）。',
  },
  high: {
    title: '高點反轉',
    formula: '4 項條件成立 ≥ 3',
    tone: 'green' as const,
    // AC-RV-8：定位是風險警示，不是見頂放空——命中率約 50%，但命中時跌 5~15%
    watch: '融資過熱，注意回檔風險',
    alert: '多項警訊同時成立，慎追高',
    idle: '尚無過熱訊號',
    desc: '融資追價過頭、外資同步調節時亮燈。屬風險警示，命中率約五成，但命中時回檔幅度通常不小。',
    note: '散戶用融資接外資倒出來的貨，且沒有空頭回補的力道可以推升。這是風險警示不是放空訊號。',
    backtest: '647 天回測：3 分 21 次、後 5 日 −1.22%，4 分 3 次、−1.43%。命中時通常回檔 5~15%，誤報時也只是少賺 1~4%。',
  },
}

const TONE = {
  red:   { on: 'border-red-300 bg-red-50 hover:bg-red-100',       card: 'border-red-300 bg-red-50',     text: 'text-red-500',   dot: 'bg-red-500' },
  green: { on: 'border-green-300 bg-green-50 hover:bg-green-100', card: 'border-green-300 bg-green-50', text: 'text-green-600', dot: 'bg-green-500' },
}

export default function ReversalCard({ kind, signal, compact = false, nDays = 100 }: Props) {
  const [open, setOpen] = useState(false)
  const hasZ = signal.conditions.some(c => Z_CONDITIONS.has(c.label))
  const m = META[kind]
  const t = TONE[m.tone]
  const lit = signal.level !== 'none'
  const label = signal.level === 'alert' ? m.alert : signal.level === 'watch' ? m.watch : m.idle

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          className={`flex flex-col items-start px-3 py-2.5 rounded-xl border text-left transition-colors w-full ${
            lit ? t.on : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">{m.title}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                lit ? `${t.text} bg-white/70` : 'text-slate-400 bg-slate-100'
              }`}>
                {signal.score}/4
              </span>
              {signal.level === 'alert' && (
                <span className={`w-1.5 h-1.5 rounded-full ${t.dot} animate-pulse`} />
              )}
            </span>
            <span className="text-[10px] text-slate-300">›</span>
          </div>
          <span className={`text-[11px] font-bold leading-snug ${lit ? t.text : 'text-slate-400'}`}>
            {label}
          </span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={`text-left rounded-xl p-4 border transition-all hover:-translate-y-0.5 hover:shadow-md w-full ${
            lit ? t.card : 'border-slate-200 bg-white opacity-70'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm font-bold text-slate-700">{m.title}</span>
            {signal.level === 'alert' && (
              <span className={`w-1.5 h-1.5 rounded-full ${t.dot} animate-pulse`} />
            )}
          </div>
          <div className="text-xs font-mono text-slate-400 mb-3">{m.formula}</div>
          <div className={`text-sm font-bold mb-1 ${t.text}`}>
            {signal.score}/4 項成立
          </div>
          <div className={`text-xs font-bold ${lit ? t.text : 'text-slate-400'}`}>
            {signal.level === 'alert' ? '● 強訊號' : signal.level === 'watch' ? '● 觀察中' : '○ 未觸發'}
          </div>
          <div className="text-[10px] text-slate-400 mt-2">點擊查看計算說明 →</div>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl p-4 shadow-xl max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-slate-700">
                {m.title}　<span className={t.text}>{signal.score}/4 項成立</span>
              </span>
              <button onClick={() => setOpen(false)} className="text-slate-400 text-lg leading-none px-1">✕</button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">{m.desc}</p>

            <div className="space-y-1.5 mb-3">
              {signal.conditions.map(c => (
                <div
                  key={c.label}
                  className={`rounded-lg px-2.5 py-2 border ${
                    c.ok ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">{c.ok ? '✅' : '⬜'}</span>
                    <span className={`text-[11px] font-semibold ${c.ok ? 'text-slate-700' : 'text-slate-400'}`}>
                      {c.label}
                    </span>
                  </div>
                  {FORMULA[c.label] && (
                    <code className="block text-[10px] text-slate-400 mt-0.5 ml-5 whitespace-pre overflow-x-auto">
                      {typeof FORMULA[c.label] === 'function'
                        ? (FORMULA[c.label] as (n: number) => string)(nDays)
                        : (FORMULA[c.label] as string)}
                    </code>
                  )}
                  <div className="text-[10px] text-slate-600 mt-1 ml-5">{c.detail}</div>
                </div>
              ))}
            </div>

            {/* AC-PB-7：Z-Score 的算式跟著用到它的卡走，問號不再重複一份 */}
            {!compact && hasZ && (
              <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2">
                <div className="text-[11px] font-semibold text-slate-600 mb-1">上面的 Z 怎麼算</div>
                <code className="block text-[10px] text-slate-400 leading-relaxed whitespace-pre overflow-x-auto">
{`X = 當期數值相對前期的變動
Z = (X − 近 N 期平均) ÷ 近 N 期標準差`}
                </code>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                  衡量「這次的變動比平常誇張多少」。<b>|Z| ≥ 2</b> 落在統計上最極端的 2.5%。
                  用 Z 而不是「單日減少 50 億」這種固定金額，是因為台股市值會膨脹，
                  固定門檻幾年後就失效。
                </p>
              </div>
            )}

            <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2">
              <div className="text-[11px] font-semibold text-slate-600 mb-1">怎麼解讀</div>
              <p className="text-[10px] text-slate-500 leading-relaxed">{m.note}</p>
            </div>

            {!compact && (
              <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                <div className="text-[11px] font-semibold text-slate-600 mb-1">實測表現</div>
                <p className="text-[10px] text-slate-500 leading-relaxed">{m.backtest}</p>
              </div>
            )}

            <p className="text-[10px] text-slate-400 leading-relaxed mt-2">
              亮燈規則：3 項成立＝觀察、4 項成立＝強訊號。四項各 1 分、不加權。
            </p>

            {/* 盤後行情只給結論，完整的 Z 原理與回測留在市場條件頁 */}
            {compact && (
              <Link
                href="/signals"
                className="block mt-2 text-[10px] text-blue-600 font-semibold text-center py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                看完整公式與回測 →
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}
