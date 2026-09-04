'use client'

/**
 * 市場訊號說明（AC-PB-4 → AC-PB-6 改版）。
 *
 * 只留「四張卡共用」的基礎知識三塊：Z-Score、亮燈規則、統計門檻原則。
 * 各指標自己的公式與回測已搬回所屬卡片的 modal（ReversalCard、MarginThermometer、
 * 乖離卡），看哪張卡就讀哪張卡——放在這裡會四張卡重複四次，也讓這個 Modal
 * 長到找不到東西。
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
          下面三項是所有卡片共用的規則。<b className="text-slate-500">各指標自己的公式，點該張卡片就會展開。</b>
        </p>

        {/* 1. Z-Score */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">① Z-Score（統計標準化）</div>
        <Block
          title="怎麼算"
          formula={`X = (今日融資餘額 − 昨日) ÷ 昨日
Z = (X − 近 20 日平均) ÷ 近 20 日標準差`}
        >
          衡量「今天的變動比平常誇張多少」。<b>Z ≤ −2</b> 代表落在統計上最極端的 2.5%，
          也就是恐慌殺出；<b>Z ≥ +2</b> 則是瘋狂追價。
          <br />
          反轉訊號的「統計極端恐慌」「軋空燃料枯竭」「外資調節出貨」三個條件都建立在這個算式上，
          差別只在看的是哪個數列、用幾日的窗。
        </Block>

        {/* 2. 亮燈規則 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">② 亮燈規則</div>
        <Block title="四項條件各 1 分，直接加總（無加權）">
          <b>3 分</b>＝觀察（黃燈）、<b>4 分</b>＝強訊號（紅燈）、2 分以下不亮。
          <br />
          為什麼不是「四項全中才亮」：實測 647 個交易日，四項同時成立<b>一次都沒發生過</b>。
          門檻訂在全中等於這張卡永遠不會亮。
        </Block>

        {/* 3. 為什麼用統計相對值 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">③ 為什麼門檻都是相對值</div>
        <Block title="不用「單日減少 50 億」這種絕對金額">
          台股市值會隨時間膨脹，固定金額的門檻幾年後就失效——今天的 50 億跟十年前的 50 億
          不是同一回事。Z-Score 與百分比會自動跟著市場規模調整，不需要定期回來調參。
          <br />
          唯一的例外是融資乖離的 5%／7%，那是相對於<b>{nDays} 日高低點</b>的百分比，
          同樣不受市值影響。
        </Block>

        <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
          資料為證交所公開籌碼，僅呈現事實，不構成投資建議。
        </p>
      </div>
    </div>
  )
}
