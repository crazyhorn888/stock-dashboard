'use client'
import { useEffect, useState } from 'react'
import { freshnessBaseDate, daysBehind, isAfterClose, isWeekendTW, taipeiToday, businessDaysBehind } from '@/lib/tradingDay'

/**
 * AC-FR-2：後台「資料鮮度」區塊。
 * 直接讀 Supabase 的 meta.json（~1KB），不必為了看日期戳下載整包快照。
 * 逐項時間戳由 scripts/write-firebase.mjs 維護——只有該資料集的日期真的前進時才會更新，
 * 所以「最後更新」代表的是「這一項最後一次抓到新資料的時間」，不是快照被寫入的時間。
 */

interface Meta {
  updatedAt?: string
  stocksDate?: string | null;  stocksUpdatedAt?: string | null
  indexDate?: string | null;   indexUpdatedAt?: string | null
  marginDate?: string | null;  marginUpdatedAt?: string | null
  chipsDate?: string | null;   chipsUpdatedAt?: string | null
  sectorDate?: string | null;  sectorUpdatedAt?: string | null
  conceptDate?: string | null; conceptUpdatedAt?: string | null
  sectorHistoryLen?: number
  stockCount?: number
  ohlcCount?: number
  volCount?: number
}

const ROWS: { label: string; dateKey: keyof Meta; stampKey: keyof Meta; note: string }[] = [
  { label: 'K 線',   dateKey: 'indexDate',   stampKey: 'indexUpdatedAt',   note: 'TWSE FMTQIK · 約 15:30' },
  { label: '籌碼',   dateKey: 'chipsDate',   stampKey: 'chipsUpdatedAt',   note: 'n8n Phase 1 · 約 16:00–17:00' },
  { label: '融資',   dateKey: 'marginDate',  stampKey: 'marginUpdatedAt',  note: 'TWSE MI_MARGN · 約 17:00–22:00' },
  { label: '板塊',   dateKey: 'sectorDate',  stampKey: 'sectorUpdatedAt',  note: 'TWSE T86 · 約 18:00 起' },
  { label: '股價',   dateKey: 'stocksDate',  stampKey: 'stocksUpdatedAt',  note: 'STOCK_DAY_ALL · 無固定時間，常延到深夜' },
  { label: '概念',   dateKey: 'conceptDate', stampKey: 'conceptUpdatedAt', note: '概念分類（同 T86 來源）' },
]

function fmtDate(d?: string | null) {
  return d ? d.slice(5).replace('-', '/') : '—'
}

function fmtStamp(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// 國際指數：各市場有自己的交易日曆與時區（美股收盤時台北已是隔天凌晨），
// 不能套台股的 13:30 基準，改用「距今幾天」寬鬆判斷（含週末與時差）
const GLOBAL_LABEL: Record<string, string> = {
  spx: 'S&P500', dji: '道瓊', ndq: '那斯達克', sox: '費半', nkx: '日經225', kospi: 'KOSPI',
}

interface GlobalIndices {
  updatedAt?: string
  indices?: Record<string, { name?: string; bars?: { date: string }[] }>
}

export default function FreshnessPanel() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [global, setGlobal] = useState<GlobalIndices | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL ?? ''
    fetch(base.replace('latest.json', 'meta.json'), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMeta)
      .catch(e => setError(e.message))
    fetch(base.replace('latest.json', 'global-indices.json'), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(setGlobal)
      .catch(() => setGlobal(null))
  }, [])

  if (error) {
    return (
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-xs font-bold text-slate-700 mb-1">📡 資料鮮度</div>
        <p className="text-[11px] text-red-500">meta.json 讀取失敗：{error}</p>
      </div>
    )
  }
  if (!meta) {
    return (
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-xs font-bold text-slate-700 mb-1">📡 資料鮮度</div>
        <p className="text-[11px] text-slate-400">載入中…</p>
      </div>
    )
  }

  // 基準日：週末以最近交易日為準；平日照 13:30 收盤規則。
  // 國定假日這裡不另外查 holiday-status（後台自用，週末判斷已涵蓋多數情況），
  // 真的碰到國定假日會顯示落後 1 天，不影響判讀
  const afterClose = isAfterClose()
  const tradingDates = [meta.indexDate, meta.sectorDate, meta.chipsDate].filter(Boolean) as string[]
  const baseDate = freshnessBaseDate(tradingDates, { closed: isWeekendTW() })

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-bold text-slate-700">📡 資料鮮度</span>
        <span className="text-[10px] text-slate-400">
          基準 {fmtDate(baseDate)}（{afterClose ? '13:30 後以今日為準' : '13:30 前以前一交易日為準'}）
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left font-semibold py-1 pr-2">項目</th>
              <th className="text-left font-semibold py-1 pr-2">資料日期</th>
              <th className="text-left font-semibold py-1 pr-2">最後更新</th>
              <th className="text-left font-semibold py-1 pr-2">狀態</th>
              <th className="text-left font-semibold py-1">來源／時段</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => {
              const date  = meta[r.dateKey] as string | null | undefined
              const stamp = meta[r.stampKey] as string | null | undefined
              const lag   = daysBehind(date ?? null, baseDate)
              const tone  = lag == null ? 'text-slate-300'
                : lag <= 0 ? 'text-green-600'
                : lag === 1 ? 'text-amber-500'
                : 'text-red-500'
              const status = lag == null ? '—' : lag <= 0 ? '● 最新' : `● 落後 ${lag} 天`
              return (
                <tr key={r.label} className="border-b border-slate-50">
                  <td className="py-1.5 pr-2 font-semibold text-slate-600 whitespace-nowrap">{r.label}</td>
                  <td className={`py-1.5 pr-2 font-semibold whitespace-nowrap ${tone}`}>{fmtDate(date)}</td>
                  <td className="py-1.5 pr-2 text-slate-500 whitespace-nowrap">{fmtStamp(stamp)}</td>
                  <td className={`py-1.5 pr-2 font-semibold whitespace-nowrap ${tone}`}>{status}</td>
                  <td className="py-1.5 text-slate-400 whitespace-nowrap">{r.note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 國際指數：獨立判斷，不套台股基準 */}
      {global?.indices && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[11px] font-bold text-slate-600">🌍 國際指數</span>
            <span className="text-[10px] text-slate-400">檔案更新 {fmtStamp(global.updatedAt)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {Object.entries(global.indices).map(([key, v]) => {
              const date = v?.bars?.[0]?.date ?? null
              // 用交易日（排除週末）而非日曆天：美股收盤時台北已隔天，落後 1 個交易日是正常時差；
              // 日曆天會被週末灌水，看不出真的卡住
              const lag  = businessDaysBehind(date, taipeiToday())
              const tone = lag == null ? 'text-slate-300'
                : lag <= 1 ? 'text-green-600'
                : lag === 2 ? 'text-amber-500'
                : 'text-red-500'
              return (
                <div key={key} className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">{GLOBAL_LABEL[key] ?? v?.name ?? key}</span>
                  <span className={`font-semibold ${tone}`}>
                    {fmtDate(date)}{lag != null && lag > 1 ? `（落後 ${lag} 個交易日）` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 資料量健康指標：抓取殘缺時這些數字會先掉下來 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500">
        <span>個股 <b className="text-slate-700">{meta.stockCount ?? '—'}</b> 檔</span>
        <span>板塊歷史 <b className="text-slate-700">{meta.sectorHistoryLen ?? '—'}</b> 天</span>
        <span>OHLC <b className="text-slate-700">{meta.ohlcCount ?? '—'}</b> 支</span>
        <span>其中有量能 <b className="text-slate-700">{meta.volCount ?? '—'}</b> 支</span>
        <span className="text-slate-400">快照寫入 {fmtStamp(meta.updatedAt)}</span>
      </div>

      <p className="text-[10px] text-slate-400 mt-1.5">
        「最後更新」＝該項最後一次抓到<b>新資料</b>的時間（日期沒前進不會刷新），
        逐項時間戳需等下一次 pipeline 跑完才會開始累積。
      </p>
    </div>
  )
}
