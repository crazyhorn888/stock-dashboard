'use client'
import { useMemo } from 'react'
import type { SnapshotData, HolidayStatus } from '@/lib/types'

/**
 * P1-6 資料鮮度統一顯示。
 * 原則（Franky 決策）：以「今日」為基準，已更新 ✓、未更新「更新中」；
 * 非交易日（週末/假日）顯示「最近交易日」且不標更新中。
 * 假日判定：優先用 TWSE 官方休市日曆（holiday prop，check-holiday.mjs 產出，
 * 可以在上午就準確判斷）；holiday 資料還沒到位或不是今天時，退回原本的被動推斷
 * （平日 18:00 後大盤仍無今日 K 棒 → 視為非交易日，只能在晚上才成立）。
 * 各日期戳直接從快照內容推導，layered（market.json）與 fallback（latest.json）皆適用。
 */
export default function FreshnessBar({ data, holiday }: { data: SnapshotData; holiday?: HolidayStatus | null }) {
  const info = useMemo(() => {
    const now = new Date()
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    const hourTW = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }))
    const dowTW = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getDay()

    const minsTW = (() => {
      const hhmm = now.toLocaleString('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
      const [h, m] = hhmm.split(':').map(Number)
      return h * 60 + m
    })()
    // 台股 13:30 收盤：當天收盤前，「最新應有的資料」還是前一個交易日的，
    // 拿今天當基準會讓整排變橘色（2026-09-03 Franky 指正）
    const afterClose = minsTW >= 13 * 60 + 30

    const indexDate  = data.indexHistory?.[0]?.date ?? null
    const marginDate = data.indexHistory?.find(r => r.chips?.margin_amount != null)?.date ?? null
    const chipsDate  = data.indexHistory?.find(r => r.chips?.inst_total != null)?.date ?? null
    const sectorDate = data.sectorHistory?.[0]?.date ?? null
    const stocksDate = data.stocksDate ?? null

    const isWeekend = dowTW === 0 || dowTW === 6
    const holidayKnown = holiday?.date === today
    // 平日 18:00 後大盤仍無今日 K 棒 → 假日（如國定假日）；holiday prop 到位時直接採用，不用等 18:00
    const isHoliday = holidayKnown ? holiday!.isHoliday : (!isWeekend && indexDate !== today && hourTW >= 18)
    const closed = isWeekend || isHoliday
    const holidayName = holidayKnown && holiday!.isHoliday ? holiday!.name : null

    // 收盤前的比較基準＝上一個交易日（indexHistory 裡第一筆不是今天的日期）
    const prevTradingDate = data.indexHistory?.find(r => r.date !== today)?.date ?? indexDate

    return {
      today, closed, holidayName, afterClose,
      // 顏色比較基準：休市→最近交易日；交易日收盤後→今日；收盤前→上一個交易日
      baseDate: closed ? indexDate : afterClose ? today : prevTradingDate,
      refDate: closed ? indexDate : today,
      items: [
        { label: 'K線',  date: indexDate },
        { label: '籌碼', date: chipsDate },
        { label: '融資', date: marginDate },
        { label: '板塊', date: sectorDate },
        { label: '股價', date: stocksDate },
      ],
    }
  }, [data, holiday])

  const fmt = (d: string | null) => (d ? d.slice(5).replace('-', '/') : '—')
  // 資料項用短格式（9/03 而非 09/03）：手機單行剛好塞得下六欄，不必折行也不必橫捲
  const fmtShort = (d: string | null) => (d ? fmt(d).replace(/^0/, '') : '—')

  return (
    // 2026-09-04：正常寬度一行放得下（縮 gap + 短日期格式，實測 344px vs 手機可用 366px），
    // 極窄螢幕才需要滑動、不折行。overflow-x-auto 的容器捲到底時 padding-right 不生效，
    // 所以右側留白改用尾端 spacer 補，初始狀態左右對稱
    <div className="flex items-center gap-x-1.5 mb-3 pl-3 py-1.5 rounded-lg bg-white shadow-sm overflow-x-auto scrollbar-none">
      <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
        {info.closed
          ? `${info.holidayName ? `今日休市（${info.holidayName}）` : '最近交易日'} ${fmt(info.refDate)}`
          : `今日 ${fmt(info.today)}`}
      </span>
      <span className="w-px h-3 bg-slate-200 shrink-0" />
      {info.items.map(({ label, date }) => {
        // 2026-09-03 起改成直接標日期：與基準日相符＝綠、落後＝橘（原本只顯示 ✓／更新中，
        // 看不出落後幾天）。非交易日的基準日是最近交易日，資料齊全時一樣是綠色
        const fresh = date != null && date === info.baseDate
        return (
          <span key={label} className="flex items-center gap-0.5 text-[10px] whitespace-nowrap shrink-0">
            <span className="text-slate-400">{label}</span>
            {date == null ? (
              <span className="text-slate-300 font-semibold">—</span>
            ) : (
              <span className={`font-semibold ${fresh ? 'text-green-600' : 'text-amber-500'}`}>
                {fmtShort(date)}
              </span>
            )}
          </span>
        )
      })}
      {/* 對稱右側留白（等同 pl-3，與盤後總結卡的 px-3 同起點） */}
      <span className="w-3 shrink-0" aria-hidden />
    </div>
  )
}
