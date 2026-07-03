import type { Metadata, Viewport } from 'next'

// 不讓 Next.js PRERENDER 快取任何頁面（避免 Vercel CDN age 殘留舊版 HTML）
export const dynamic = 'force-dynamic'
export const revalidate = 0
import BottomNav from '@/components/shared/BottomNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'StockView — 台股儀表板',
  description: '台股盤後行情、市場條件、盤中即時分析工具',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>
        <div className="app-shell">
          <div className="app-content">
            {children}
          </div>
          <BottomNav />
        </div>
      </body>
    </html>
  )
}
