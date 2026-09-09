'use client'
import { useEffect, useMemo, useState } from 'react'
import type { OptionsOISnapshot, OptionsOIContract } from '@/lib/types'
import { fetchOptionsOI } from '@/lib/fetchOptionsOI'
import { taipeiToday } from '@/lib/tradingDay'
import {
  type OIKind, type OICell,
  trackContract, buildCalendar, prevContract, nextContractOn,
  monthlyContracts, latestRecordedDay, weekTag,
} from '@/lib/optionsOI'

// 功能二十三：選擇權 OI（AC-OI-B1~B10）
// 日曆三行 ＝ 追蹤契約的完整生命週期（掛牌週／中間週／結算週），規則詳見 lib/optionsOI.ts。

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']
type DetailMode = 'main' | 'next' | 'prev' | 'm0' | 'm1'

const md = (d: string) => `${Number(d.slice(5, 7))}/${d.slice(8, 10)}`

export default function OptionsOICard() {
  const [snap, setSnap] = useState<OptionsOISnapshot | null>(null)
  const [kind, setKind] = useState<OIKind>('wed')
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<DetailMode>('main')
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => { fetchOptionsOI().then(setSnap) }, [])

  const today = taipeiToday()
  const track = useMemo(() => snap ? trackContract(snap, kind, today) : null, [snap, kind, today])
  const rows = useMemo(
    () => (snap && track) ? buildCalendar(snap, kind, track, today) : [],
    [snap, track, kind, today],
  )

  // 切換週三／週五時把選中日期移到該契約最後有記錄的那天
  useEffect(() => {
    if (!snap || !track) return
    const fallback = latestRecordedDay(snap, track.code, today)
    setSelected(prev => (prev && snap.days[prev]?.[track.code]) ? prev : fallback)
    setMode('main')
  }, [snap, track, today])

  // AC-OI-B15：月選與週選結算無關，不得被 track = null 一起隱藏
  if (!snap) return null

  const hasWeek = !!track && rows.length > 0
  const prev = track && selected === track.listDate ? prevContract(snap, kind, track.listDate, today) : null
  const nextCode = track && selected ? nextContractOn(snap, kind, selected, track.exp) : null
  const detailCode = mode === 'next' && nextCode ? nextCode : track?.code ?? ''
  const detailRec = selected ? snap.days[selected]?.[detailCode] ?? null : null
  const { date: monthDate, items: months } = monthlyContracts(snap, today)
  const monthPick = mode === 'm0' ? months[0] : mode === 'm1' ? months[1] : null

  const cellClass = (c: OICell) => {
    if (c.weekend) return 'bg-transparent border-transparent'
    if (c.outside) return 'bg-slate-100 border-transparent'
    if (c.rec) return 'bg-blue-50 border-blue-200 cursor-pointer'
    if (c.today) return 'bg-amber-50 border-amber-300'
    return 'bg-white border-slate-100'
  }

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-3 flex flex-col gap-2">
      {/* 標題列 */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          選擇權 OI
          <button
            onClick={() => setHelpOpen(true)}
            aria-label="說明"
            className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-[10px] leading-none hover:border-blue-500 hover:text-blue-600"
          >?</button>
        </div>
        <div className="flex items-center gap-1">
          {track?.settled && (
            <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 whitespace-nowrap">
              已結算 · 等下一檔掛牌
            </span>
          )}
          {(['wed', 'fri'] as const).map(k => (
            <button
              key={k}
              onClick={() => { setKind(k); setMode('main') }}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border ${
                kind === k
                  ? 'bg-slate-800 text-white border-slate-800 font-semibold'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >{k === 'wed' ? '週三選' : '週五選'}</button>
          ))}
        </div>
      </div>

      {!hasWeek && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-[11px] text-slate-500 text-center">
          {kind === 'wed' ? '週三選' : '週五選'}目前沒有可追蹤的契約，收盤後新契約掛牌即會恢復。
        </div>
      )}

      {hasWeek && <>
      {/* 日曆：三行＝掛牌週／中間週／結算週 */}
      <table className="w-full table-fixed border-separate border-spacing-[2px]">
        <thead>
          <tr>{WEEK_LABELS.map(w => (
            <th key={w} className="text-[10px] font-semibold text-slate-400 pb-0.5">{w}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((week, wi) => (
            <tr key={wi}>
              {week.map(c => (
                <td
                  key={c.date}
                  onClick={() => { if (c.rec) { setSelected(c.date); setMode('main') } }}
                  className={`h-14 align-top rounded-md border px-0.5 pt-0.5 text-center ${cellClass(c)} ${
                    c.date === selected ? 'outline outline-2 outline-blue-500' : ''
                  }`}
                >
                  {/* 日期與徽章同一行：日期靠左、徽章靠右，不用絕對定位（AC-OI-B7） */}
                  <div className="flex items-start justify-between gap-0.5">
                    <span className={`text-[9.5px] tabular-nums leading-tight pl-0.5 ${
                      c.today ? 'text-blue-600 font-extrabold' : c.weekend ? 'text-slate-300' : 'text-slate-400'
                    }`}>{md(c.date)}</span>
                    <span className="flex gap-0.5 shrink-0">
                      {c.prevCode && (
                        <button
                          onClick={e => { e.stopPropagation(); setSelected(c.date); setMode('prev') }}
                          title={`上一檔 ${c.prevCode}`}
                          className="text-[7.5px] font-extrabold text-white bg-slate-400 rounded px-[3px] leading-relaxed hover:bg-blue-500"
                        >上</button>
                      )}
                      {c.nextCode && (
                        <button
                          onClick={e => { e.stopPropagation(); setSelected(c.date); setMode('next') }}
                          title={`下一檔 ${c.nextCode}`}
                          className="text-[7.5px] font-extrabold text-white bg-slate-400 rounded px-[3px] leading-relaxed hover:bg-blue-500"
                        >{weekTag(c.nextCode)}</button>
                      )}
                    </span>
                  </div>

                  {c.rec && (
                    <>
                      <div className="text-[11px] font-bold tabular-nums text-red-600 leading-tight">{c.rec.C[0]?.[0]}</div>
                      <div className="text-[11px] font-bold tabular-nums text-emerald-600 leading-tight">{c.rec.P[0]?.[0]}</div>
                    </>
                  )}
                  {!c.rec && c.today && (
                    <div className="text-[9px] text-slate-400 mt-2 leading-tight">收盤後<br />更新</div>
                  )}
                  {!c.rec && !c.today && c.note && (
                    <div className={`text-[8.5px] font-bold mt-2 leading-tight ${
                      c.note === '月結算日' ? 'text-blue-600' : 'text-slate-500'
                    }`}>{c.note}</div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 明細：追蹤中／下一檔／上一檔 */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="flex flex-wrap gap-1 mb-1.5">
          <TabButton on={mode === 'main'} onClick={() => setMode('main')} label={`追蹤中 ${track.code}`} />
          {nextCode && <TabButton on={mode === 'next'} onClick={() => setMode('next')} label={`下一檔 ${nextCode}`} />}
          {prev && <TabButton on={mode === 'prev'} onClick={() => setMode('prev')} label={`上一檔 ${prev.code}`} />}
          {monthPick && <TabButton on onClick={() => setMode('main')} label={`月選 ${monthPick.code}`} />}
        </div>

        {monthPick ? (
          <>
            <h4 className="text-[11px] font-bold text-slate-800 mb-1.5">
              {monthDate ? `${md(monthDate)} 收盤 · ` : ''}{monthPick.code}（月選，結算 {md(monthPick.rec.exp)}）
            </h4>
            <TopThree rec={monthPick.rec} />
          </>
        ) : mode === 'prev' && prev ? (
          <>
            <h4 className="text-[11px] font-bold text-slate-800 mb-1.5">
              {prev.code} · 已於 {md(prev.date)} 結算
            </h4>
            <div className="text-[10.5px] text-slate-500 leading-relaxed mb-1.5">
              <b className="text-slate-800">最後結算價</b>{' '}
              <span className="text-[13px] font-extrabold tabular-nums text-slate-800">{prev.fsp.toLocaleString()}</span>
              {prev.rec && prev.lastDay && (
                <>　結算前（{md(prev.lastDay)}）壓力 {prev.rec.C[0]?.[0]} ／ 支撐 {prev.rec.P[0]?.[0]} →{' '}
                  <b className="text-slate-800">
                    {prev.fsp <= (prev.rec.C[0]?.[0] ?? Infinity) && prev.fsp >= (prev.rec.P[0]?.[0] ?? -Infinity)
                      ? '收在區間內' : '突破區間'}
                  </b>
                </>
              )}
            </div>
            {prev.rec && <TopThree rec={prev.rec} />}
          </>
        ) : detailRec && selected ? (
          <>
            <h4 className="text-[11px] font-bold text-slate-800 mb-1.5">
              {md(selected)} 收盤 · {detailCode}（結算 {md(detailRec.exp)}）
            </h4>
            <TopThree rec={detailRec} />
          </>
        ) : (
          <div className="text-[11px] text-slate-400">尚無記錄</div>
        )}
      </div>
      </>}

      {/* 月選（AC-OI-B9） */}
      {months.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {months.map((m, i) => (
            <button
              key={m.code}
              onClick={() => setMode(i === 0 ? 'm0' : 'm1')}
              className={`text-left rounded-lg border bg-slate-50 p-2 ${
                (mode === 'm0' && i === 0) || (mode === 'm1' && i === 1)
                  ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'
              }`}
            >
              <div className="text-[10px] text-slate-400 mb-1">
                月選{i === 0 ? '當月' : '次月'} · 結算 {md(m.rec.exp)}
              </div>
              <div className="flex justify-between text-[11px] tabular-nums">
                <span className="text-red-600">壓力 SC</span>
                <b className="text-slate-800">{m.rec.C[0]?.[0] ?? '—'}</b>
              </div>
              <div className="flex justify-between text-[11px] tabular-nums">
                <span className="text-emerald-600">支撐 SP</span>
                <b className="text-slate-800">{m.rec.P[0]?.[0] ?? '—'}</b>
              </div>
              <div className="text-[9px] text-slate-400 mt-1">點看前三大與今日新增</div>
            </button>
          ))}
        </div>
      )}

      {/* 圖例 */}
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[9.5px] text-slate-500">
        <Legend className="bg-blue-50 border-blue-200" label="未結算" />
        <Legend className="bg-amber-50 border-amber-300" label="今日" />
        <Legend className="bg-white border-slate-200" label="尚未到" />
        <Legend className="bg-slate-100 border-transparent" label="掛牌前／結算後" />
      </div>

      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={() => setHelpOpen(false)}
        >
          <div className="bg-white rounded-xl border border-slate-200 p-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-800">怎麼看這張表</h3>
              <button onClick={() => setHelpOpen(false)} className="text-slate-400 text-sm">✕</button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-2">
              <b className="text-slate-800">SP，OI 最大量區</b>：市場的<b className="text-slate-800">支撐區</b>，因為賣方不希望指數跌破這裡。
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              <b className="text-slate-800">SC，OI 最大量區</b>：市場的<b className="text-slate-800">壓力區</b>，因為賣方不希望指數漲過這裡。
            </p>

            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col gap-2">
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">日曆上的數字</b>：該日收盤的<b className="text-slate-800">未沖銷契約量（OI）</b>，
                即當下尚未平倉的部位，非每日成交量累加。部位平掉 OI 即減少，結算日歸零。
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">今日新增未平倉</b>：今日 OI −昨日 OI 的正值，為<b className="text-slate-800">淨增加</b>
                （＝新開倉 − 平倉），非當日新開倉口數。當沖來回會互相抵銷，留下的是實際押上去的部位。
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-800">前三大 vs 今日新增</b>：前者是整段累積的佈局，後者是當天的動作，兩者位置常不同。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-[9.5px] px-1.5 py-0.5 rounded border tabular-nums ${
        on ? 'bg-blue-600 text-white border-blue-600 font-bold' : 'bg-white text-slate-500 border-slate-200'
      }`}
    >{label}</button>
  )
}

function TopThree({ rec }: { rec: OptionsOIContract }) {
  const list = (arr: [number, number][] | undefined, sign = false) => (arr ?? []).map(([strike, oi], i) => (
    <div key={strike} className="flex justify-between text-[10.5px] tabular-nums text-slate-500 py-[1.5px]">
      <b className={`text-slate-800 font-bold ${i === 0 ? 'text-[11.5px]' : ''}`}>{strike}</b>
      <span>{sign ? '+' : ''}{oi.toLocaleString()} 口</span>
    </div>
  ))
  const hasDelta = (rec.dC?.length ?? 0) > 0 || (rec.dP?.length ?? 0) > 0
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] font-bold text-red-600 mb-0.5">壓力 SC · 前三大</div>
          {list(rec.C)}
        </div>
        <div>
          <div className="text-[10px] font-bold text-emerald-600 mb-0.5">支撐 SP · 前三大</div>
          {list(rec.P)}
        </div>
      </div>
      {/* 累積是整段佈局，今日新增是當天的動作，兩者位置常常不同 */}
      {hasDelta && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-200">
          <div className="text-[9.5px] text-slate-400 mb-0.5">今日新增未平倉（當天押在哪）</div>
          <div className="grid grid-cols-2 gap-2">
            <div>{list(rec.dC, true)}</div>
            <div>{list(rec.dP, true)}</div>
          </div>
        </div>
      )}
    </>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <i className={`inline-block w-2.5 h-2.5 rounded-sm border ${className}`} />
      {label}
    </span>
  )
}
