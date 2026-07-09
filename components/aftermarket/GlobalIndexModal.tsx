'use client'
import type { GlobalIndexData } from '@/lib/types'
import KlineChart from './KlineChart'

interface Props {
  data: GlobalIndexData | null
  onClose: () => void
}

export default function GlobalIndexModal({ data, onClose }: Props) {
  if (!data) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div
        className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '85svh' }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-sm font-bold text-slate-800">{data.name}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg px-1">✕</button>
        </div>
        <div className="overflow-y-auto px-3 pb-4" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))' }}>
          <KlineChart data={data.bars} n={Math.min(120, data.bars.length)} title={data.name} />
          <p className="text-[10px] text-slate-400 -mt-2">
            資料至 {data.bars[0]?.date}（各市場自己的交易日曆，非台北時間當日）
          </p>
        </div>
      </div>
    </>
  )
}
