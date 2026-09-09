'use client'

/**
 * 市場訊號說明（AC-PB-4 → AC-PB-6 改版）。
 *
 * 只留「各卡共用」的基礎知識：亮燈規則與統計門檻原則。
 * 各指標自己的公式與回測收在所屬卡片的 modal（MarketHeatCard、MarginThermometer、
 * 乖離卡），看哪張卡就讀哪張卡——放在這裡會重複多次，也讓這個 Modal
 * 長到找不到東西。
 *
 * AC-HT-F2（2026-09-06）：高低點反轉卡已下架，改由市場熱度卡的警示計分制涵蓋，
 * 本 Modal 的亮燈規則同步改寫。
 */

interface Props {
  nDays: number
  onClose: () => void
}

function Block({ title, formula, children }: { title: string; formula?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2">
      <div className="text-[11px] font-semibold text-slate-600">{title}</div>
      {formula && (
        <code className="block text-[10px] text-slate-400 mt-1 leading-relaxed whitespace-pre overflow-x-auto">
          {formula}
        </code>
      )}
      <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">{children}</div>
    </div>
  )
}

export default function SignalHelpModal({ nDays, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl p-4 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-bold text-slate-700">共用的計算基礎</span>
          <button onClick={onClose} className="text-slate-400 text-lg leading-none px-1">✕</button>
        </div>
        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
          下面三項是所有卡片共用的規則。<b className="text-slate-500">各指標自己的公式與 Z 的算法，點該張卡片就會展開。</b>
        </p>

        {/* 1. 亮燈規則 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">① 亮燈規則</div>
        <Block title="市場熱度：六項條件各 1 分，≥4 分亮紅燈">
          實測 1130 個交易日，<b>≥4 分</b>時未來 20 日內回落 6% 的機率是 36%（平時 12%），
          平均提前 4.5 個交易日；但仍有 <b>64% 是誤報</b>。
          <br />
          為什麼不用單一門檻：挑門檻必然過擬合——最佳的門檻式組合訓練段 67%、
          測試段掉到 17%。計分制自由度低，訓練與測試都是 36%，沒有衰減。
        </Block>

        {/* 2. 為什麼用統計相對值 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">② 為什麼門檻都是相對值</div>
        <Block title="不用「單日減少 50 億」這種絕對金額">
          台股市值會隨時間膨脹，固定金額的門檻幾年後就失效——今天的 50 億跟十年前的 50 億
          不是同一回事。Z-Score 與百分比會自動跟著市場規模調整，不需要定期回來調參。
          <br />
          融資乖離的 5%／7% 同理，那是相對於<b>{nDays} 日高低點</b>的百分比，也不受市值影響。
        </Block>

        {/* 3. N 值管到哪些地方（AC-IC-7） */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">③ N 值管到哪些地方</div>
        <Block title="法人成本的累積窗口沒有獨立設定，跟著 N 換算">
          個股清單的「成本／距成本%」兩欄，以及選股條件「低於法人成本」，用的窗口都由頁面
          N（目前 <b>{nDays}</b>）換算而來，不另設開關——改 N 就等於換窗口。
          <br />
          <span className="inline-block mt-1 font-mono text-slate-400">
            N≤7 → 5 日　N≤15 → 10 日　N≤40 → 20 日　N≤90 → 60 日　N&gt;90 → 120 日
          </span>
          <br />
          分段是刻意的：低於 5 日樣本太少，單日一筆大額買超就把成本帶偏；超過 120 日則早已
          出場的舊部位還被算進來。序列累積天數不足該窗口時，欄位標示「累積中」而非顯示半套數字。
          <br />
          N 同時也管：距N高／距N低兩欄與其篩選條件、融資維持率的成本指數回看期（夾在 20~120）。
        </Block>

        <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
          資料為證交所公開籌碼，僅呈現事實，不構成投資建議。
        </p>
      </div>
    </div>
  )
}
