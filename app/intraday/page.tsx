import NavBar from '@/components/shared/NavBar'

export default function IntradayPage() {
  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0]">
      <NavBar />
      <main className="max-w-screen-xl mx-auto px-4 py-12 text-center">
        <div className="text-4xl mb-4">📈</div>
        <h1 className="text-xl font-bold mb-2">盤中即時頁面</h1>
        <p className="text-[#64748b] text-sm">第三階段開發，需申請 Fugle Market Data API Key</p>
      </main>
    </div>
  )
}
