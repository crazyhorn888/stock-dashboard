'use client'
import { useState } from 'react'
import SectorBubbleSection from '@/components/bubble/SectorBubbleSection'
import UpdateStamp from '@/components/shared/UpdateStamp'

/**
 * AC-NAV-1/3/5：泡泡圖獨立滿版頁（原「盤中即時」佔位頁）。
 * 板塊泡泡圖需要的畫面空間大，從 /aftermarket 的分頁裡搬出來獨佔一頁。
 */

interface DataStatus {
  updatedAt: string | null
  date: string | null
  stale: boolean
  isHoliday: boolean
  holidayName?: string | null
}

export default function BubblePage() {
  // 更新戳記與板塊資料日期放 header 右上角，格式與盤後行情／市場條件一致
  const [status, setStatus] = useState<DataStatus | null>(null)

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      <div className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm">
        <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
        <UpdateStamp
          updatedAt={status?.updatedAt}
          sub={{ label: '板塊資料', date: status?.date ?? null }}
        />
      </div>

      <main className="max-w-screen-xl mx-auto px-2 py-2 pb-20">
        <SectorBubbleSection fullHeight onDataStatus={setStatus} />
      </main>
    </div>
  )
}
