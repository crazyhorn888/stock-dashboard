'use client'
import { useEffect, useState } from 'react'
import type { HoldersSnapshot, HoldersEntry } from '@/lib/types'
import { fetchHolders, holdersOf, moveMultiple } from '@/lib/fetchHolders'

/**
 * 個股 Modal 的「集保大戶」區塊（AC-HU-3／AC-HU-4）。
 *
 * 清單只放週變化 pp，絕對值只出現在這裡（2026-09-11 Franky 指定：清單保持精簡）。
 *
 * ⚠️ 說明文字的三條紅線（AC-HU-4，來自 docs/2026-09-11_集保大戶籌碼_回測報告.md）：
 *   1. 籌碼異動單獨看沒有預測力（p=0.65），不能寫成買賣訊號
 *   2. 與期貨異動同時出現時也沒有（p=0.43）——原本以為有，是回測腳本 MAD 寫錯造成的
 *   3. 不得出現「主力進場」：實測前十大買方集中度在異動前是**下降**的（部位在分散）
 */
export default function HoldersBlock({ code }: { code: string }) {
  const [snap, setSnap] = useState<HoldersSnapshot | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => { fetchHolders().then(setSnap) }, [])

  const e = holdersOf(snap, code)
  if (!snap) {
    return <Frame date={null}><div className="py-2 text-[11px] text-slate-400">載入中…</div></Frame>
  }
  if (!e) {
    // AC-HD-5：集保檔沒有這檔（新上市、ETF 不套用）→ 顯示「—」，不是 0
    return <Frame date={snap.dataDate}>
      <div className="py-2 text-[11px] text-slate-400">此標的無集保大戶資料</div>
    </Frame>
  }

  return (
    <Frame date={snap.dataDate}>
      <table className="w-full text-[11px] mt-1">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left font-normal py-0.5 w-16" />
            <th className="text-right font-normal py-0.5">百張大戶</th>
            <th className="text-right font-normal py-0.5">千張大戶</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          <Row label={`上週${snap.prevDate ? `（${fmtDate(snap.prevDate)}）` : ''}`}
            a={e.prevH} b={e.prevK} suffix="%" />
          <Row label={`本週（${fmtDate(snap.dataDate)}）`} a={e.h} b={e.k} suffix="%" bold />
          <DeltaRow e={e} />
        </tbody>
      </table>

      {e.capitalEvent && (
        <p className="mt-1.5 text-[10px] text-amber-600">
          本週有股本／庫存異動（增資、減資、可轉債轉換或實體股票匯撥），
          比例變化與籌碼無關，這週的增減不列入判斷。
        </p>
      )}
      {!e.capitalEvent && e.zh == null && (
        <p className="mt-1.5 text-[10px] text-slate-400">
          異動判斷需要 {snap.minPeriods} 週基準，目前累積 {e.weeks} 週，還在累積中。
        </p>
      )}
      {e.zh != null && !e.capitalEvent && (
        <p className="mt-1.5 text-[10px] text-slate-500">
          本週的變動比自己平常的波動大 <span className="font-semibold">{fmtMultiple(moveMultiple(e)!)}</span>
          {e.sameDir
            ? `（門檻 ${snap.threshold} 以上、且千張同方向，才會在清單標點）`
            : '；但千張大戶這週沒有跟著同方向動，不列入標記'}
          {e.futMove && '；同週個股期貨也異動'}
        </p>
      )}

      <button
        onClick={() => setHelpOpen(o => !o)}
        className="mt-1.5 text-[10px] text-slate-400 hover:text-slate-600 underline"
      >
        ⓘ 這個數字怎麼算、能不能拿來買賣 {helpOpen ? '▲' : '▼'}
      </button>
      {helpOpen && (
        <div className="mt-1 space-y-1.5 text-[10px] leading-relaxed text-slate-500 bg-slate-50 rounded-lg p-2">
          <p>
            <span className="font-semibold text-slate-600">資料來源</span>：集保結算所每週最後一個營業日結算的股權分散表，
            週六上架。百張大戶＝持股 100 張以上的人合計持有的比例，千張大戶＝1,000 張以上。
            這是週更資料，跟每天更新的股價最多會差 5 個交易日。
          </p>
          <p>
            <span className="font-semibold text-slate-600">怎麼判定</span>：
            要「百張大戶的變動大到超過門檻」而且「千張大戶同一週往同方向動」兩個條件都成立才標記。
            只看其中一個都不夠——只看千張會被單一帳戶帶偏（這個級距全市場中位數只有 10~15 人，
            有些股票只有 1~2 人），只看百張又混了中實戶。兩個互相佐證才算數。
          </p>
          <p>
            <span className="font-semibold text-slate-600">為什麼看「幾倍」不看「幾 pp」</span>：
            每檔股票的股東結構差很多。有些股票平常大戶比例幾乎不動，動 0.5 pp 就是大事；
            有些本來就天天在變，動 3 pp 還算日常。所以比較的基準是這檔股票自己過去 {snap.window} 週的常態波動，
            而不是一個固定的百分點門檻。
          </p>
          <p>
            <span className="font-semibold text-slate-600">股本變動會被排除</span>：
            增資、減資、可轉債轉換、實體股票匯撥都會讓比例憑空跳動，跟大戶有沒有買賣無關。
            這類週別會標示出來並排除在判斷之外。
          </p>
          <p className="text-amber-700">
            <span className="font-semibold">這不是買賣訊號。</span>
            用過去一年的資料測過很多種切法——看百張、看千張、兩個一起看，次日／3 日／1 週／2 週／
            4 週各種天期，再按市值、股價位階、漲幅、變動幅度、連續週數分組。結論一致：
            <span className="font-semibold">同一個訊號在 2026 上半年是漲、下半年是跌</span>，
            幅度差不多、方向相反，合起來接近零。
          </p>
          <p className="text-amber-700">
            所以這個標記只回答「這檔的大戶結構這週動得比平常大很多」，
            不回答「接下來會漲還是會跌」。集保只保留一年資料，可比的期間只有兩段，
            要判斷這個關係是否穩定，還需要更長的時間累積。
          </p>
          <p>
            實心點代表籌碼與期貨同時異動，語意是<span className="font-semibold">動的範圍更廣</span>，
            不是更看空。回測也顯示前十大買方的集中度在異動前其實是下降的（部位在分散），
            所以不要把這個標記讀成「主力進場」。
          </p>
        </div>
      )}
    </Frame>
  )
}

function Frame({ date, children }: { date: string | null; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-slate-100">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-slate-600">集保大戶</span>
        {date && <span className="text-[10px] text-slate-400">資料週 {fmtDate(date)}</span>}
      </div>
      {children}
    </div>
  )
}

function Row({ label, a, b, suffix, bold }: {
  label: string; a: number | null; b: number | null; suffix: string; bold?: boolean
}) {
  const cls = bold ? 'font-semibold text-slate-700' : 'text-slate-600'
  return (
    <tr>
      <td className="text-left text-slate-400 py-0.5">{label}</td>
      <td className={`text-right py-0.5 ${cls}`}>{a == null ? '—' : `${a.toFixed(2)}${suffix}`}</td>
      <td className={`text-right py-0.5 ${cls}`}>{b == null ? '—' : `${b.toFixed(2)}${suffix}`}</td>
    </tr>
  )
}

function DeltaRow({ e }: { e: HoldersEntry }) {
  const cell = (v: number | null) => {
    if (e.capitalEvent || v == null) return <span className="text-slate-300">—</span>
    return (
      <span className={`font-semibold ${v > 0 ? 'text-red-500' : v < 0 ? 'text-green-600' : 'text-slate-400'}`}>
        {v > 0 ? '+' : ''}{v.toFixed(2)} pp
      </span>
    )
  }
  return (
    <tr className="border-t border-slate-100">
      <td className="text-left text-slate-400 py-0.5">增減</td>
      <td className="text-right py-0.5">{cell(e.dh)}</td>
      <td className="text-right py-0.5">{cell(e.dk)}</td>
    </tr>
  )
}

const fmtDate = (d: string) => d.slice(5).replace('-', '/')

// 幾乎不動的股票（週變化 MAD 只有 0.0x pp）遇到一次大變動，倍數會算出 200 以上。
// 那個數字本身沒有解讀價值，超過 50 就不再報精確值（2026-09-12 全市場實測）。
export const fmtMultiple = (z: number) => (z > 50 ? '50 倍以上' : `${z.toFixed(1)} 倍`)
