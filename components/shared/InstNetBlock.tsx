'use client'
import { fmtInstNet, instNetColor, type InstNet } from '@/lib/instNet'

/**
 * 當日三大法人區塊（外資/投信/自營/合計）——個股詳情頁用。
 * 資料來源與泡泡面板個股列同一份（lib/instNet 的 day0 T86 map），數字/配色格式一致。
 * inst 為 undefined/null（上櫃股或當日無 T86 資料）時顯示「—」，不顯示誤導的 0。
 */
interface Props {
  inst?: InstNet | null
  date?: string | null   // T86 資料日（YYYY-MM-DD），顯示 MM/DD
}

const CELLS: { key: keyof InstNet; label: string }[] = [
  { key: 'foreignNet', label: '外資' },
  { key: 'trustNet',   label: '投信' },
  { key: 'dealerNet',  label: '自營' },
  { key: 'net',        label: '合計' },
]

export default function InstNetBlock({ inst, date }: Props) {
  const dateLabel = date ? `（${date.slice(5).replace('-', '/')}）` : ''
  return (
    <div className="px-4 py-2 border-b border-slate-100">
      <div className="text-[10px] text-slate-400 mb-1">三大法人買賣超（億）{dateLabel}</div>
      <div className="grid grid-cols-4 gap-2">
        {CELLS.map(({ key, label }) => (
          <div key={key} className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
            <div className="text-[10px] text-slate-400">{label}</div>
            <div className={`text-sm font-bold tabular-nums ${instNetColor(inst?.[key])}`}>
              {fmtInstNet(inst?.[key])}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
