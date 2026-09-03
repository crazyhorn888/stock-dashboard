'use client'
import { useState } from 'react'
import SectorBubbleSection from '@/components/bubble/SectorBubbleSection'

/**
 * AC-NAV-1/3/5：泡泡圖獨立滿版頁（原「盤中即時」佔位頁）。
 * 板塊泡泡圖需要的畫面空間大，從 /aftermarket 的分頁裡搬出來獨佔一頁。
 */

interface DataStatus {
  date: string | null
  stale: boolean
  isHoliday: boolean
  holidayName?: string | null
}

export default function BubblePage() {
  // 資料日期／落後提示改放 header 右上角（比照盤後行情、市場條件兩頁的位置）
  const [status, setStatus] = useState<DataStatus | null>(null)

  const label = (() => {
    if (!status?.date) return null
    const d = status.date.slice(5).replace('-', '/')
    if (!status.stale) return { text: `板塊 ${d}`, tone: 'text-slate-400' }
    if (status.isHoliday) {
      return { text: `今日休市${status.holidayName ? `（${status.holidayName}）` : ''} · 顯示 ${d}`, tone: 'text-slate-400' }
    }
    return { text: `板塊 ${d} 待更新中`, tone: 'text-amber-600' }
  })()

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      <div className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm">
        <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
        {label && <span className={`text-xs font-medium ${label.tone}`}>{label.text}</span>}
      </div>

      <main className="max-w-screen-xl mx-auto px-2 py-2 pb-20">
        <SectorBubbleSection fullHeight onDataStatus={setStatus} />
      </main>
    </div>
  )
}
