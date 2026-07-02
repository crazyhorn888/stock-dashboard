export default function IntradayPage() {
  return (
    <div className="bg-[#0f1117] text-[#e2e8f0]">
      <div className="sticky top-0 z-40 flex items-center px-4 py-3 bg-[#111320] border-b border-[#2d3148]">
        <span className="font-extrabold text-[#60a5fa] text-base tracking-tight">📈 StockView</span>
      </div>
      <main className="max-w-screen-xl mx-auto px-4 py-12 text-center">
        <div className="text-4xl mb-4">🫧</div>
        <h1 className="text-xl font-bold mb-2">盤中即時</h1>
        <p className="text-[#64748b] text-sm mb-1">產業板塊泡泡圖 · 資金輪動即時監控</p>
        <p className="text-[#475569] text-xs">Phase 3 開發中，需申請 Fugle Market Data API Key</p>
      </main>
    </div>
  )
}
