export default function IntradayPage() {
  return (
    <div className="bg-slate-50 min-h-screen text-slate-800">
      <div className="sticky top-0 z-40 flex items-center px-4 py-3 bg-white border-b border-slate-200 shadow-sm">
        <span className="font-extrabold text-blue-600 text-base tracking-tight">StockView</span>
      </div>
      <main className="max-w-screen-xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-5">🫧</div>
        <h1 className="text-lg font-bold text-slate-700 mb-2">盤中即時</h1>
        <p className="text-slate-400 text-sm mb-1">產業板塊泡泡圖 · 資金輪動即時監控</p>
        <p className="text-slate-300 text-xs">Phase 3 開發中，需申請 Fugle Market Data API Key</p>
      </main>
    </div>
  )
}
