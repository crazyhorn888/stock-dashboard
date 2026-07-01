'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/aftermarket', label: '盤後行情' },
  { href: '/signals',     label: '市場條件' },
  { href: '/intraday',    label: '盤中即時' },
]

export default function NavBar({ updatedAt }: { updatedAt?: string }) {
  const pathname = usePathname()
  return (
    <nav className="sticky top-0 z-50 flex items-center gap-2 px-6 py-3 bg-[#111320] border-b border-[#2d3148]">
      <span className="mr-auto font-extrabold text-[#60a5fa] text-base tracking-tight">
        📈 StockView
      </span>
      {links.map(l => (
        <Link
          key={l.href}
          href={l.href}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            pathname.startsWith(l.href)
              ? 'bg-[#3b82f6] text-white'
              : 'text-[#94a3b8] hover:text-white hover:bg-[#1e2235]'
          }`}
        >
          {l.label}
        </Link>
      ))}
      {updatedAt && (
        <span className="ml-3 text-xs text-[#f59e0b]">
          ● 更新 {new Date(updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </nav>
  )
}
