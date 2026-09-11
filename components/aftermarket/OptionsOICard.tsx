'use client'
import { useEffect, useMemo, useState } from 'react'
import OptionsOIChart from '@/components/aftermarket/OptionsOIChart'
import CostLine from '@/components/aftermarket/CostLine'
import type { OptionsOISnapshot } from '@/lib/types'
import { fetchOptionsOI } from '@/lib/fetchOptionsOI'
import { taipeiToday } from '@/lib/tradingDay'
import { buildCases } from '@/lib/costLine'

/**
 * 功能二十三：選擇權（AC-CL-0～AC-CL-11，2026-09-10 改版）。
 *
 * 一張卡兩個區塊，順序固定：
 *  1. 主力成本推估——單一契約的買方成本線與賣方防線
 *  2. PCR——全市場所有到期別合計的 PC Ratio 與支撐壓力通道
 *
 * ⚠️ 兩者不可合併成一張圖：Y 軸尺度不同（指數點位 vs 百分比），
 * 而且 PCR 是全市場合計、成本線是單一契約，疊在一起會讓人誤讀 PCR 屬於該契約。
 */

interface CardProps {
  /** 大盤日 K，供成本線畫指數走勢、PCR 圖畫現貨收盤線（AC-PCR-8） */
  indexHistory?: { date: string; close: number }[]
}

export default function OptionsOICard({ indexHistory = [] }: CardProps) {
  const [snap, setSnap] = useState<OptionsOISnapshot | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => { fetchOptionsOI().then(setSnap) }, [])

  const today = taipeiToday()
  const indexClose = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of indexHistory) if (r?.date && r.close) m[r.date] = r.close
    return m
  }, [indexHistory])

  const cases = useMemo(
    () => snap ? buildCases(snap, indexClose, today) : [],
    [snap, indexClose, today],
  )

  // AC-CL-1：預設停在最近即將到期、但還沒結算的那一檔
  // AC-CL-14（2026-09-11 修訂）：全部依結算日升冪排成單一時間軸。
  // 已結算的（7 天內）結算日最早，自然落在最前面——不另外分組，分組會讓
  // 最近到期、最該看的那一檔被推到最後一格
  const tabs = useMemo(
    () => [...cases].sort((a, b) => a.exp.localeCompare(b.exp)),
    [cases],
  )

  const pick = useMemo(() => {
    if (!tabs.length) return null
    return tabs.find(c => c.code === code)
      ?? tabs.find(c => c.exp > today)
      ?? tabs[0]
  }, [tabs, code, today])

  if (!snap) return null

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            選擇權
            <button
              onClick={() => setHelpOpen(true)}
              aria-label="說明"
              className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-[10px] leading-none hover:border-blue-500 hover:text-blue-600"
            >?</button>
          </h2>
          {pick && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              {pick.code}　{pick.exp.slice(5).replace('-', '/')} 結算　可左右滑看更早
            </p>
          )}
        </div>
      </div>

      {/* ── 區塊一：主力成本推估 ───────────────────────────── */}
      <div className="text-[11px] font-semibold text-slate-600 pt-0.5">主力成本推估</div>

      {!pick ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-[11px] text-slate-500 text-center">
          主力成本推估需要至少兩個交易日的建倉紀錄，稍後收盤更新後顯示
        </div>
      ) : (
        <>
          {/* AC-CL-1：清單＝快照有揭露且尚未結算的契約，依結算日升冪 */}
          <div className="flex flex-wrap gap-1">
            {tabs.map(c => (
              <button
                key={c.code}
                onClick={() => setCode(c.code)}
                className={`text-[10px] px-2 py-0.5 rounded-md border tabular-nums ${
                  c.code === pick.code
                    ? 'bg-slate-800 text-white border-slate-800 font-bold'
                    : c.exp < today
                      ? 'bg-white text-slate-400 border-slate-200'
                      : 'bg-white text-slate-600 border-slate-200'
                }`}
              >{c.code}{c.exp < today ? ' ·已結' : c.exp === today ? ' ·結算日' : ''}</button>
            ))}
          </div>
          <CostLine c={pick} today={today} />
        </>
      )}

      {/* ── 區塊二：PCR ─────────────────────────────────── */}
      <div className="text-[11px] font-semibold text-slate-600 pt-1.5 border-t border-slate-200">PCR</div>
      <OptionsOIChart snap={snap} indexClose={indexClose} today={today} />

      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={() => setHelpOpen(false)}
        >
          <div className="bg-white rounded-xl border border-slate-200 p-4 max-w-sm w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-800">怎麼看這張卡</h3>
              <button onClick={() => setHelpOpen(false)} className="text-slate-400 text-sm">✕</button>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">主力成本推估</b>：找出<b className="text-slate-800">價內</b>、
                當日<b className="text-slate-800">留倉率 ≥80%</b>（OI 增量 ÷ 成交量，≈100% 代表新倉留著過夜而非當沖換手）、
                累積 ≥100 口的建倉，用<code className="bg-slate-100 rounded px-1">履約價 ± 權利金</code>畫成成本線，
                看指數一路走到結算日是站上還是跌破。
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">成本用最後成交價</b>，不用結算價——結算價是模型推導的理論價，
                <span className="text-slate-400">實例 45800C：結算 1,360 vs 收盤 1,260，差 100 點。</span>
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">線粗＝目前 OI</b>，不是累積建倉量。部位被平掉線就變細，
                剩不到兩成幾乎淡出——用累積量的話，早就平掉的部位還會被畫成一條粗防線。
                <b className="text-slate-800">底</b>＝成本最低的那條（買方最後防線），
                <b className="text-slate-800">重</b>＝目前 OI 最大的那條。
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">賣方防線 SC / SP</b>：價外、現價 ±5% 內 OI 最大的履約價，
                加減權利金後就是賣方開始虧損的點。買方回本點與賣方虧損點是同一個數字，只是視角相反。
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">點日曆</b>只切換底下明細的日期口徑（成本與累積量都用當天重算），
                圖表與捲動位置不動。
              </p>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col gap-2">
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">分頁什麼時候會多一檔？</b>週選在<b className="text-slate-800">結算日前 14 天</b>掛牌
                （前兩週的同一個星期幾），月選在<b className="text-slate-800">前一個月選結算的次一營業日</b>掛牌。
                <span className="text-slate-400">
                　掛牌日遇休市會順延（2026-06-19 端午、2026-07-10 各順延一次），所以本卡不推算日期，
                  直接列當日快照有揭露的契約。
                </span>
              </p>
            </div>

            {/* AC-PCR-15：折線圖的口徑與濾波理由 */}
            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col gap-2">
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">PCR</b> ＝ 賣權 OI ÷ 買權 OI，數值高代表賣權佈局相對多。
                折線圖採<b className="text-slate-800">近月月選</b>：週選每兩週換約、全市場合計每隔幾天就有契約結算，
                數字的跳動來自成分更換而非市場情緒。
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">支撐壓力取近月選現價 ±5% 範圍內的最大 OI</b>，不用全域 Top1。
                <span className="text-slate-400">
                　例：2026-09-08 指數 47,105，當月選賣權第二大 OI 掛在 21,800——那是深價外的災難險保單，不是防守線。
                </span>
              </p>
              <p className="text-xs text-amber-700 leading-relaxed bg-amber-50 border-l-2 border-amber-400 pl-2 py-1.5">
                <b>PC Ratio 上升 ＋ 支撐往下鋪，是偏多形狀，不是背離警訊。</b>
                <span className="text-amber-600">
                　889 個交易日回測：該組合未來 20 日跌逾 3% 的機率 4.1%，低於基準 12.0%。本卡不提供自動警示訊號。
                </span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
