'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  {
    href: '/intraday',
    label: '盤中即時',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="16" r="3" />
        <circle cx="17" cy="8" r="4.5" />
        <circle cx="13" cy="18" r="1.8" />
      </svg>
    ),
  },
  {
    href: '/aftermarket',
    label: '盤後行情',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="13" width="4" height="8" rx="1" />
        <rect x="10" y="8" width="4" height="13" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
  },
  {
    href: '/signals',
    label: '市場條件',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12 C5 4 7 4 9 12 C11 20 13 20 15 12 C17 4 19 4 22 12" />
        <circle cx="22" cy="12" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="bottom-nav">
      {tabs.map(t => {
        const active = pathname.startsWith(t.href)
        return (
          <Link key={t.href} href={t.href} className={`nav-tab ${active ? 'active' : ''}`}>
            {t.icon}
            <span>{t.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
