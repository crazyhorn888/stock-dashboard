'use client'
import { useMemo } from 'react'
import type { SnapshotData } from '@/lib/types'

/**
 * P1-6 資料鮮度統一顯示。
 * 原則（Franky 決策）：以「今日」為基準，已更新 ✓、未更新「更新中」；
 * 非交易日（週末/假日）顯示「最近交易日」且不標更新中。
 * 假日判定不維護假日表：平日 18:00 後大盤仍無今日 K 棒 → 視為非交易日。
 * 各日期戳直接從快照內容推導，layered（market.json）與 fallback（latest.json）皆適用。
 */
export default function FreshnessBar({ data }: { data: SnapshotData }) {
  const info = useMemo(() => {
    const now = new Date()
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    const hourTW = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }))
    const dowTW = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getDay()

    const indexDate  = data.indexHistory?.[0]?.date ?? null
    const marginDate = data.indexHistory?.find(r => r.chips?.margin_amount != null)?.date ?? null
    const chipsDate  = data.indexHistory?.find(r => r.chips?.inst_total != null)?.date ?? null
    const sectorDate = data.sectorHistory?.[0]?.date ?? null
    const stocksDate = data.stocksDate ?? null

    const isWeekend = dowTW === 0 || dowTW === 6
    // 平日 18:00 後大盤仍無今日 K 棒 → 假日（如國定假日）
    const isHoliday = !isWeekend && indexDate !== today && hourTW >= 18
    const closed = isWeekend || isHoliday

    return {
      today, closed,
      refDate: closed ? indexDate : today,
      items: [
        { label: 'K線',  date: indexDate },
        { label: '籌碼', date: chipsDate },
        { label: '融資', date: marginDate },
        { label: '板塊', date: sectorDate },
        { label: '股價', date: stocksDate },
      ],
    }
  }, [data])

  const fmt = (d: string | null) => (d ? d.slice(5).replace('-', '/') : '—')

  return (
    <div className="flex items-center gap-2 mb-3 px-3 py-1.5 rounded-lg bg-white shadow-sm overflow-x-auto scrollbar-none">
      <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
        {info.closed ? `最近交易日 ${fmt(info.refDate)}` : `今日 ${fmt(info.today)}`}
      </span>
      <span className="w-px h-3 bg-slate-200 shrink-0" />
      {info.items.map(({ label, date }) => {
        // 非交易日：全部顯示中性狀態（資料就是最近交易日的，不標更新中）
        const fresh = info.closed ? true : date === info.today
        return (
          <span key={label} className="flex items-center gap-0.5 text-[10px] whitespace-nowrap">
            <span className="text-slate-400">{label}</span>
            {date == null ? (
              <span className="text-slate-300 font-semibold">—</span>
            ) : fresh ? (
              <span className="text-blue-600 font-semibold">✓</span>
            ) : (
              <span className="text-amber-500 font-semibold animate-pulse">更新中</span>
            )}
          </span>
        )
      })}
    </div>
  )
}
