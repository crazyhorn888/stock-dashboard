'use client'

interface Props {
  n: number
  onChange: (n: number) => void
}

export default function ParamBar({ n, onChange }: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-[#1a2540] border border-[#3b82f6] rounded-xl mb-4">
      <span className="text-sm font-bold text-[#60a5fa] whitespace-nowrap">📅 參考區間 N =</span>
      <input
        type="number"
        min={10}
        max={250}
        value={n}
        onChange={e => {
          const v = Math.min(250, Math.max(10, parseInt(e.target.value) || 100))
          onChange(v)
        }}
        className="w-20 text-center font-bold text-base bg-[#0f1117] border border-[#3b82f6] rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
      />
      <span className="font-bold text-[#60a5fa]">天</span>
      <span className="text-xs text-[#475569]">— 影響距高/距低計算 &amp; 大盤融資增減幅。預設 100 天。</span>
    </div>
  )
}
