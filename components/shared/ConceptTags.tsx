'use client'

interface Props {
  concepts?: string[]
  onTagClick?: (concept: string) => void
  className?: string
}

// P2-2：一股多概念 tag chips，個股列表/詳情頁/概念面板共用同一顯示與點擊行為
export default function ConceptTags({ concepts, onTagClick, className }: Props) {
  if (!concepts?.length) return null
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ''}`}>
      {concepts.map(c => (
        <button
          key={c}
          onClick={e => { e.stopPropagation(); onTagClick?.(c) }}
          className="bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 text-[10px] text-blue-600 whitespace-nowrap hover:bg-blue-100"
        >
          {c}
        </button>
      ))}
    </div>
  )
}
