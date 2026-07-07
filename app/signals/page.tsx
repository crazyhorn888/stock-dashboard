'use client'
import { useState, useEffect } from 'react'
import { MOCK_DATA } from '@/lib/mockData'
import { fetchSnapshot } from '@/lib/fetchSnapshot'
import type { MarketSignals } from '@/lib/types'

interface Condition {
  id: string
  name: string
  type: 'positive' | 'negative'
  formula: string
  currentGap: number
  threshold: number
  triggered: boolean
  modalContent: {
    formulaDetail: string
    currentCalc: string
    meaning: string
  }
}

function buildConditions(s: MarketSignals): Condition[] {
  return [
    {
      id: 'pos1',
      name: '融資減幅 > 大盤減幅 5%',
      type: 'positive',
      formula: '( 融資減幅 − 大盤減幅 ) ≥ 5%',
      currentGap: s.posGapPct ?? 0,
      threshold: 5,
      triggered: s.posTriggered,
      modalContent: {
        formulaDetail: s.posGapPct != null
          ? `基準日：${s.peakDate}（N日最高點）\n大盤減幅 = (${s.peakIndex.toLocaleString()} − ${s.todayIndex.toLocaleString()}) / ${s.peakIndex.toLocaleString()} = ${s.indexDropPct.toFixed(2)}%\n融資減幅 = (${s.peakMargin} − ${s.todayMargin}) / ${s.peakMargin} = ${s.marginDropPct!.toFixed(2)}%\n\n差距 = ${s.marginDropPct!.toFixed(2)}% − ${s.indexDropPct.toFixed(2)}% = ${s.posGapPct.toFixed(2)}%`
          : '融資資料累積中，計算詳情暫不可用',
        currentCalc: s.posGapPct != null
          ? `差距 ${s.posGapPct.toFixed(2)}% ${s.posTriggered ? '≥' : '<'} 門檻 5%`
          : '融資資料累積中',
        meaning: '大盤從高點下跌，但融資餘額縮水幅度遠大於大盤跌幅。代表投資人已大量去化融資槓桿，恐慌性降槓桿完成，後續反彈壓力較輕。',
      },
    },
    {
      id: 'neg1',
      name: '融資增幅 > 大盤增幅 7%',
      type: 'negative',
      formula: '( 融資增幅 − 大盤增幅 ) ≥ 7%',
      currentGap: s.negGapPct ?? 0,
      threshold: 7,
      triggered: s.negTriggered,
      modalContent: {
        formulaDetail: s.negGapPct != null
          ? `基準日：${s.troughDate}（N日最低點）\n大盤增幅 = (${s.todayIndex.toLocaleString()} − ${s.troughIndex.toLocaleString()}) / ${s.troughIndex.toLocaleString()} = ${s.indexRisePct.toFixed(2)}%\n融資增幅 = (${s.todayMargin} − ${s.troughMargin}) / ${s.troughMargin} = ${s.marginRisePct!.toFixed(2)}%\n\n差距 = ${s.marginRisePct!.toFixed(2)}% − ${s.indexRisePct.toFixed(2)}% = ${s.negGapPct.toFixed(2)}%`
          : '融資資料累積中，計算詳情暫不可用',
        currentCalc: s.negGapPct != null
          ? `差距 ${s.negGapPct.toFixed(2)}% ${s.negTriggered ? '≥' : '<'} 門檻 7%`
          : '融資資料累積中',
        meaning: '大盤從低點反彈，但融資餘額增加幅度比大盤漲幅更快，代表散戶加速追高加槓桿，市場過熱，風險升溫。',
      },
    },
  ]
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<MarketSignals>(MOCK_DATA.marketSignals)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<Condition | null>(null)

  useEffect(() => {
    fetchSnapshot()
      .then(d => { setSignals(d.marketSignals); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const conditions = buildConditions(signals)
  const pos = conditions.filter(c => c.type === 'positive')
  const neg = conditions.filter(c => c.type === 'negative')

  function CardGroup({ title, items }: { title: string; items: Condition[] }) {
    return (
      <section className="mb-7">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{title}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(c => (
            <button
              key={c.id}
              onClick={() => setModal(c)}
              className={`text-left rounded-xl p-4 border transition-all hover:-translate-y-0.5 hover:shadow-md ${
                c.triggered
                  ? c.type === 'positive' ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'
                  : 'border-slate-200 bg-white opacity-70'
              }`}
            >
              <div className="text-sm font-bold text-slate-700 mb-1">{c.name}</div>
              <div className="text-xs font-mono text-slate-400 mb-3">{c.formula}</div>
              <div className={`text-sm font-bold mb-1 ${c.type === 'positive' ? 'text-red-500' : 'text-green-600'}`}>
                差距 {c.currentGap >= 0 ? '+' : ''}{c.currentGap.toFixed(2)}%
              </div>
              <div className={`text-xs font-bold ${c.triggered ? (c.type === 'positive' ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>
                {c.triggered ? '● 目前觸發中' : '○ 未觸發'}
              </div>
              <div className="text-[10px] text-slate-400 mt-2">點擊查看計算說明 →</div>
            </button>
          ))}
          {[1, 2].map(i => (
            <div key={i} className="rounded-xl border border-dashed border-slate-200 bg-white flex items-center justify-center min-h-[120px] text-slate-300 text-sm">
              ＋ 未來新增
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      <div className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm">
        <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
        {!loading && signals.updatedAt && (
          <span className="text-xs text-amber-600 font-medium">
            更新 {new Date(signals.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <main className="max-w-screen-xl mx-auto px-4 py-5">
        <h1 className="text-base font-bold text-slate-700 mb-1">市場條件</h1>
        <p className="text-xs text-slate-400 mb-6">紅字 = 正向（看多），綠字 = 負向（看空）。點擊卡片查看計算說明。</p>

        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-6 w-32 rounded bg-slate-200" />
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-xl bg-slate-200" />)}
            </div>
          </div>
        ) : (
          <>
            <CardGroup title="正向條件（看多）" items={pos} />
            <CardGroup title="負向條件（看空）" items={neg} />
          </>
        )}
      </main>

      {modal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setModal(null)}
        >
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-slate-200 shadow-xl relative">
            <button
              onClick={() => setModal(null)}
              className="absolute top-4 right-5 text-slate-400 hover:text-slate-700 text-xl"
            >✕</button>
            <h3 className="text-base font-bold text-slate-800 mb-1">{modal.name}</h3>
            <div className={`text-xs font-bold mb-4 ${modal.type === 'positive' ? 'text-red-500' : 'text-green-600'}`}>
              {modal.type === 'positive' ? '正向條件（看多）' : '負向條件（看空）'}
            </div>
            <div className="bg-slate-50 rounded-lg p-4 mb-3 font-mono text-xs text-blue-700 leading-7 whitespace-pre-wrap border border-slate-200">
              {modal.modalContent.formulaDetail}
            </div>
            <div className={`rounded-lg p-3 mb-3 text-xs border ${modal.type === 'positive' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <div className={`font-bold mb-1 ${modal.type === 'positive' ? 'text-red-600' : 'text-green-700'}`}>▶ 意義</div>
              <p className={`leading-relaxed ${modal.type === 'positive' ? 'text-red-700' : 'text-green-700'}`}>
                {modal.modalContent.meaning}
              </p>
            </div>
            <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg border ${
              modal.triggered
                ? modal.type === 'positive' ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'
                : 'bg-slate-50 border-slate-200'
            }`}>
              <span className={`text-xs font-bold ${modal.triggered ? (modal.type === 'positive' ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>
                門檻：差距 ≥ {modal.threshold}% → 觸發
              </span>
              <span className="text-sm font-bold text-slate-700">
                目前 {modal.currentGap >= 0 ? '+' : ''}{modal.currentGap.toFixed(2)}% {modal.triggered ? '✓' : '✗'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
