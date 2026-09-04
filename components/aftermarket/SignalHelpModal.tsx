'use client'

/**
 * 市場訊號說明（AC-PB-4）。比照泡泡圖的問號 Modal：公式在上、白話在下，分區塊收納。
 * 每個區塊都附 647 天回測的實測數據，避免把「理論設計」誤當成「已驗證有效」。
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

function Cond({ n, label, formula }: { n: string; label: string; formula: string }) {
  return (
    <div className="flex gap-1.5 text-[10px] leading-relaxed">
      <span className="text-slate-400 shrink-0">{n}</span>
      <span>
        <b className="text-slate-600">{label}</b>
        <span className="text-slate-400"> — {formula}</span>
      </span>
    </div>
  )
}

export default function SignalHelpModal({ nDays, onClose }: Props) {
  // 與 marginMaintenance.ts 的 clamp 同步：低於 20 天樣本太少、高於 120 天含太多已平倉部位
  const maintLookback = Math.max(20, Math.min(120, nDays))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl p-4 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-slate-700">這些指標怎麼算的</span>
          <button onClick={onClose} className="text-slate-400 text-lg leading-none px-1">✕</button>
        </div>

        {/* Z-Score：兩張反轉卡共用的基礎 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">Z-Score（統計標準化）</div>
        <Block
          title="融資變動的 Z-Score"
          formula={`X = (今日融資餘額 − 昨日) ÷ 昨日
Z = (X − 近20日平均) ÷ 近20日標準差`}
        >
          衡量「今天的融資變動，比平常誇張多少」。<b>Z ≤ −2</b> 代表融資單日減幅落在統計上最極端的
          2.5%，也就是恐慌殺出；<b>Z ≥ +2</b> 則是瘋狂追價。
          <br />
          用 Z-Score 而不是「單日減少 50 億」這種固定金額，是因為台股市值會膨脹——
          固定金額的門檻幾年後就失效了，Z-Score 會自動跟著市場規模調整。
        </Block>

        {/* 低點反轉 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">低點反轉（正向）</div>
        <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2 space-y-1">
          <Cond n="①" label="大盤有感下跌" formula="當日跌幅 > 0.5%" />
          <Cond n="②" label="融資恐慌殺出" formula="|融資變動%| ÷ |大盤跌幅%| > 1.5" />
          <Cond n="③" label="統計極端恐慌" formula="融資變動 20 日 Z ≤ −2" />
          <Cond n="④" label="法人低檔接手" formula="外資 + 投信現貨合計買超" />
          <div className="text-[10px] text-slate-500 mt-1.5 pt-1.5 border-t border-slate-200 leading-relaxed">
            散戶砍在低點、法人接手，是統計上勝率較高的落底型態。
            <b>最常缺的是④</b>——大跌當天法人通常也在賣，要隔一兩天才進場承接。
          </div>
        </div>

        {/* 高點反轉 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">高點反轉（負向）</div>
        <div className="rounded-lg bg-slate-50 px-2.5 py-2 mb-2 space-y-1">
          <Cond n="①" label="融資追價過頭" formula={`融資增幅 − 大盤增幅 ≥ 7%（從 ${nDays} 日低點起算）`} />
          <Cond n="②" label="價跌資增背離" formula="大盤下跌，但融資反而增加" />
          <Cond n="③" label="軋空燃料枯竭" formula="券資比 60 日 Z ≤ −1" />
          <Cond n="④" label="外資調節出貨" formula="外資買賣超 60 日 Z ≤ −1.5" />
          <div className="text-[10px] text-slate-500 mt-1.5 pt-1.5 border-t border-slate-200 leading-relaxed">
            散戶用融資接外資倒出來的貨，且沒有空頭回補的力道可以推升。
            <b>這是風險警示不是放空訊號</b>——命中率約五成，但命中時通常回檔 5~15%，
            誤報時也只是少賺 1~4%。
          </div>
        </div>

        {/* 計分規則 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">亮燈規則</div>
        <Block title="四項條件各 1 分，直接加總（無加權）">
          <b>3 分</b>＝觀察（黃燈）、<b>4 分</b>＝強訊號（紅燈）、2 分以下不亮。
          <br />
          為什麼不是「四項全中才亮」：實測 647 個交易日，四項同時成立<b>一次都沒發生過</b>。
          改成 3 分後，低點反轉在回測中出現 10 次，之後 5 個交易日平均 <b>+4.30%</b>
          （同期大盤平均 +0.82%）。
        </Block>

        {/* 融資維持率 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">融資維持率（估算）</div>
        <Block
          title="怎麼推出來的"
          formula={`建倉維持率 = 1 ÷ 融資成數 ≈ 166.7%
成本指數 C = Σ(融資淨增加 × 當日指數) ÷ Σ(融資淨增加)
估算維持率 = 166.7% × 今日指數 ÷ C`}
        >
          <div className="mb-1.5">
            成本指數只計「融資淨增加」的交易日——那些天才是新部位建倉，融資減少的日子是平倉，
            不影響剩餘部位的成本。回看期<b>跟著上方的 N 走</b>（目前 <b>{maintLookback} 日</b>
            {maintLookback !== nDays && `，N=${nDays} 已夾到 20~120 的範圍內`}）。
          </div>
          <b>這是市場整體的估算，不是你在券商看到的個人帳戶維持率。</b>
          官方不公布整體維持率（要逐戶計算），所以用「融資部位平均建倉指數」回推。
          <br />
          <br />
          分級門檻 <b>175／165／155</b> 是依 130 天實測分布訂的（實測範圍 149~197%、中位 173%）。
          個別帳戶的 130%（追繳）、140%（危險）是另一回事——整體加權平均天然落在 155~175%，
          套個別帳戶的門檻會有九成日子都是綠燈。卡片下方的「大盤再跌 N% 觸及追繳線」
          才是對應到 130% 那條線的講法。
        </Block>

        {/* 融資乖離（原有兩張卡） */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5 mt-3">融資乖離（正向／負向指標）</div>
        <Block
          title={`正向：融資減幅 > 大盤減幅 5%（從 ${nDays} 日高點起算）`}
          formula={`大盤減幅 = (${nDays}日最高點 − 今日) ÷ ${nDays}日最高點
融資減幅 = (高點當日融資 − 今日融資) ÷ 高點當日融資
觸發：融資減幅 − 大盤減幅 ≥ 5%`}
        >
          指數只跌一點、融資卻大幅退場，代表散戶浮額洗得比指數兇，籌碼變乾淨。
        </Block>
        <Block
          title={`負向：融資增幅 > 大盤增幅 7%（從 ${nDays} 日低點起算）`}
          formula={`大盤增幅 = (今日 − ${nDays}日最低點) ÷ ${nDays}日最低點
融資增幅 = (今日融資 − 低點當日融資) ÷ 低點當日融資
觸發：融資增幅 − 大盤增幅 ≥ 7%`}
        >
          指數漲一段、融資追得更兇，籌碼往散戶手上集中。
          單獨看鑑別度不高（647 天中成立 128 天），所以它同時也是高點反轉的條件①——
          要搭配其他訊號一起看才有意義。
        </Block>

        <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
          所有門檻都採統計相對值（Z-Score、百分比），不用絕對金額或口數，
          市場規模改變時不需要重新調參。資料為證交所公開籌碼，僅呈現事實，不構成投資建議。
        </p>
      </div>
    </div>
  )
}
