'use client'

/**
 * 三個分頁 header 右上角的更新戳記，格式統一（2026-09-03 Franky 指定）：
 *   橘色第一行：最後更新：MM/DD HH:MM
 *   灰色第二行（可選）：<資料名>：MM/DD
 */

interface Props {
  updatedAt?: string | null                       // ISO 時間字串
  sub?: { label: string; date: string | null } | null
}

function fmtDate(d: string | null | undefined) {
  return d ? d.slice(5).replace('-', '/') : '—'
}

export default function UpdateStamp({ updatedAt, sub }: Props) {
  if (!updatedAt) return null

  const stamp = new Date(updatedAt).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-xs text-amber-600 font-medium whitespace-nowrap">最後更新：{stamp}</span>
      {sub && (
        <span className="text-[10px] text-slate-400 whitespace-nowrap">
          {sub.label}：{fmtDate(sub.date)}
        </span>
      )}
    </div>
  )
}
