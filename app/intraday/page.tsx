'use client'
import SectorBubbleSection from '@/components/bubble/SectorBubbleSection'

/**
 * AC-NAV-1/3/5：泡泡圖獨立滿版頁（原「盤中即時」佔位頁）。
 * 板塊泡泡圖需要的畫面空間大，從 /aftermarket 的分頁裡搬出來獨佔一頁。
 */
export default function BubblePage() {
  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      <div className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm">
        <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
        <span className="text-xs font-semibold text-slate-500">產業板塊泡泡圖</span>
      </div>

      <main className="max-w-screen-xl mx-auto px-2 py-2 pb-20">
        <SectorBubbleSection fullHeight />
      </main>
    </div>
  )
}
