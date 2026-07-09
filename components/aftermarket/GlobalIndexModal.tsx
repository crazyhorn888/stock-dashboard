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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl flex flex-col"
        style={{ maxHeight: '85svh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <span className="text-sm font-bold text-slate-800">{data.name}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg px-1">✕</button>
        </div>
        <div className="overflow-y-auto px-3 py-3">
          <KlineChart data={data.bars} n={Math.min(120, data.bars.length)} title={data.name} />
          <p className="text-[10px] text-slate-400 -mt-2">
            資料至 {data.bars[0]?.date}（各市場自己的交易日曆，非台北時間當日）
          </p>
        </div>
      </div>
    </div>
  )
}
