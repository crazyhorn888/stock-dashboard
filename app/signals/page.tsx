'use client'
import { useState, useEffect } from 'react'
import NavBar from '@/components/shared/NavBar'
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
      currentGap: s.posGapPct,
      threshold: 5,
      triggered: s.posTriggered,
      modalContent: {
        formulaDetail: `基準日：${s.peakDate}（N日最高點）\n大盤減幅 = (${s.peakIndex.toLocaleString()} − ${s.todayIndex.toLocaleString()}) / ${s.peakIndex.toLocaleString()} = ${s.indexDropPct.toFixed(2)}%\n融資減幅 = (${s.peakMargin} − ${s.todayMargin}) / ${s.peakMargin} = ${s.marginDropPct.toFixed(2)}%\n\n差距 = ${s.marginDropPct.toFixed(2)}% − ${s.indexDropPct.toFixed(2)}% = ${s.posGapPct.toFixed(2)}%`,
        currentCalc: `差距 ${s.posGapPct.toFixed(2)}% ${s.posTriggered ? '≥' : '<'} 門檻 5%`,
        meaning: '大盤從高點下跌，但融資餘額縮水幅度遠大於大盤跌幅。代表投資人已大量去化融資槓桿，恐慌性降槓桿完成，後續反彈壓力較輕。',
      },
    },
    {
      id: 'neg1',
      name: '融資增幅 > 大盤增幅 7%',
      type: 'negative',
      formula: '( 融資增幅 − 大盤增幅 ) ≥ 7%',
      currentGap: s.negGapPct,
      threshold: 7,
      triggered: s.negTriggered,
      modalContent: {
        formulaDetail: `基準日：${s.troughDate}（N日最低點）\n大盤增幅 = (${s.todayIndex.toLocaleString()} − ${s.troughIndex.toLocaleString()}) / ${s.troughIndex.toLocaleString()} = ${s.indexRisePct.toFixed(2)}%\n融資增幅 = (${s.todayMargin} − ${s.troughMargin}) / ${s.troughMargin} = ${s.marginRisePct.toFixed(2)}%\n\n差距 = ${s.marginRisePct.toFixed(2)}% − ${s.indexRisePct.toFixed(2)}% = ${s.negGapPct.toFixed(2)}%`,
        currentCalc: `差距 ${s.negGapPct.toFixed(2)}% ${s.negTriggered ? '≥' : '<'} 門檻 7%`,
        meaning: '大盤從低點反彈，但融資餘額增加幅度比大盤漲幅更快，代表散戶加速追高加槓桿，市場過熱，風險升溫。目前差距為負值，籌碼仍健康。',
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

  function CardGroup({ title, badge, items }: { title: string; badge: React.ReactNode; items: Condition[] }) {
    return (
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-bold">{title}</h2>
          {badge}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(c => (
            <button
              key={c.id}
              onClick={() => setModal(c)}
              className={`text-left rounded-xl p-4 border transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                c.triggered
                  ? c.type === 'positive' ? 'border-red-500 bg-[#1f1215]' : 'border-green-500 bg-[#131f13]'
                  : 'border-[#2d3148] bg-[#1e2235] opacity-60'
              }`}
            >
              <div className="text-sm font-bold text-[#e2e8f0] mb-1">{c.name}</div>
              <div className="text-xs font-mono text-[#64748b] mb-3">{c.formula}</div>
              <div className={`text-sm font-bold mb-1 ${c.type === 'positive' ? 'text-red-400' : 'text-green-400'}`}>
                差距 {c.currentGap >= 0 ? '+' : ''}{c.currentGap.toFixed(2)}%
              </div>
              <div className={`text-xs font-bold ${c.triggered ? (c.type === 'positive' ? 'text-red-400' : 'text-green-400') : 'text-[#475569]'}`}>
                {c.triggered ? '● 目前觸發中' : '○ 未觸發'}
              </div>
              <div className="text-[10px] text-[#475569] mt-2">點擊查看計算說明 →</div>
            </button>
          ))}
          {[1, 2].map(i => (
            <div key={i} className="rounded-xl border border-dashed border-[#2d3148] bg-[#161925] flex items-center justify-center min-h-[120px] text-[#2d3148] text-sm">
              ＋ 未來新增條件<br /><span className="text-xs">/stock-add-signal</span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0]">
      <NavBar updatedAt={loading ? undefined : signals.updatedAt} />
      <main className="max-w-screen-xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold mb-1">市場條件</h1>
        <p className="text-xs text-[#64748b] mb-6">點擊卡片查看計算說明。紅字 = 正向（利多），綠字 = 負向（利空）。</p>

        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-8 w-40 rounded bg-[#1e2235]" />
            <div className="grid grid-cols-3 gap-3">
              {[1,2,3].map(i => <div key={i} className="h-32 rounded-xl bg-[#1e2235]" />)}
            </div>
          </div>
        ) : (
          <>
            <CardGroup
              title="正向條件（看多）"
              badge={<span className="text-xs font-bold text-red-400 border border-red-500 bg-[#2d1515] rounded-md px-2 py-0.5">● 紅字顯示（台灣：紅 = 漲 = 利多）</span>}
              items={pos}
            />
            <CardGroup
              title="負向條件（看空）"
              badge={<span className="text-xs font-bold text-green-400 border border-green-500 bg-[#152d15] rounded-md px-2 py-0.5">● 綠字顯示（台灣：綠 = 跌 = 利空）</span>}
              items={neg}
            />
          </>
        )}
      </main>

      {modal && (
        <div
          className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setModal(null)}
        >
          <div className="bg-[#1e2235] rounded-2xl p-7 max-w-lg w-full border border-[#2d3148] relative">
            <button
              onClick={() => setModal(null)}
              className="absolute top-4 right-5 text-[#64748b] hover:text-white text-xl"
            >✕</button>
            <h3 className="text-base font-bold mb-1">{modal.name}</h3>
            <div className={`text-xs font-bold mb-4 ${modal.type === 'positive' ? 'text-red-400' : 'text-green-400'}`}>
              {modal.type === 'positive' ? '正向條件（看多）' : '負向條件（看空）'}
            </div>
            <div className="bg-[#111320] rounded-lg p-4 mb-3 font-mono text-xs text-[#93c5fd] leading-7 whitespace-pre-wrap">
              {modal.modalContent.formulaDetail}
            </div>
            <div className={`rounded-lg p-3 mb-3 text-xs ${modal.type === 'positive' ? 'bg-[#1c2a1c] border border-green-800' : 'bg-[#1a2030] border border-blue-900'}`}>
              <div className={`font-bold mb-1 ${modal.type === 'positive' ? 'text-green-400' : 'text-blue-400'}`}>▶ 意義</div>
              <p className={`leading-relaxed ${modal.type === 'positive' ? 'text-green-200' : 'text-blue-200'}`}>
                {modal.modalContent.meaning}
              </p>
            </div>
            <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg border ${
              modal.triggered
                ? modal.type === 'positive' ? 'bg-[#2d1515] border-red-500' : 'bg-[#152d15] border-green-500'
                : 'bg-[#1e2235] border-[#2d3148]'
            }`}>
              <span className={`text-xs font-bold ${modal.triggered ? (modal.type === 'positive' ? 'text-red-400' : 'text-green-400') : 'text-[#475569]'}`}>
                門檻：差距 ≥ {modal.threshold}% → 觸發
              </span>
              <span className="text-sm font-bold text-[#e2e8f0]">
                目前 {modal.currentGap >= 0 ? '+' : ''}{modal.currentGap.toFixed(2)}% {modal.triggered ? '✓' : '✗'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
