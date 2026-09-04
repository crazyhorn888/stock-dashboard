'use client'

/**
 * 泡泡圖說明視窗（AC-HELP-1~3）
 * 內容對齊 Tide 的說明結構：先講怎麼看，再給實際算式。
 * 象限名稱與顏色必須與 BubbleChart 的 QUADRANTS 一致，改一邊要同步。
 */

interface Props {
  onClose: () => void
}

const QUAD_ROWS = [
  { label: '流入加速', pos: '右上', color: '#dc2626', bg: '#fff1f2', desc: '近 5 日法人買超，且力道還在增強' },
  { label: '流入放緩', pos: '右下', color: '#d97706', bg: '#fffbeb', desc: '仍是買超，但買的力道開始減弱' },
  { label: '流出放緩', pos: '左上', color: '#64748b', bg: '#f1f5f9', desc: '仍是賣超，但賣壓正在減輕' },
  { label: '流出加速', pos: '左下', color: '#16a34a', bg: '#f0fdf4', desc: '近 5 日法人賣超，且賣壓還在加重' },
]

// 各象限的白話例子。數字取自 2026-09-02 的實際板塊型態，但刻意不寫板塊名稱——
// 名稱每天都在換象限，寫死會過期；這裡要教的是「怎麼讀這四個位置」
const QUAD_EXAMPLES = [
  {
    label: '流入加速', pos: '右上', color: '#dc2626', bg: '#fff1f2',
    numbers: '近5日每天買 41 億 · 過去20日每天賣 3 億 → Y = +45',
    plain: '過去大半個月法人一直在倒貨，最近五天突然轉成大買——從賣轉買、力道爆增，這是圖上最右上角的位置。',
  },
  {
    label: '流入放緩', pos: '右下', color: '#d97706', bg: '#fffbeb',
    numbers: '近5日每天買 26 億 · 過去20日每天買 43 億 → Y = −16',
    plain: '還是在買，但每天買的金額比過去少了快四成。錢還在流進來，只是動能在退，追高要留意。',
  },
  {
    label: '流出放緩', pos: '左上', color: '#64748b', bg: '#f1f5f9',
    numbers: '近5日每天賣 3.4 億 · 過去20日每天賣 7.8 億 → Y = +4.5',
    plain: '法人還在賣，但賣的力道砍了一半以上。賣壓正在減輕，是「跌不太動了」的訊號，但還沒轉成買方。',
  },
  {
    label: '流出加速', pos: '左下', color: '#16a34a', bg: '#f0fdf4',
    numbers: '近5日每天賣 5.8 億 · 過去20日每天買 24.5 億 → Y = −30',
    plain: '過去一個月都在買，最近五天翻臉變成賣——從買轉賣，資金在撤退，這是圖上最左下角的位置。',
  },
]

export default function BubbleHelpModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl p-4 shadow-xl max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-slate-700">怎麼看這張圖</span>
          <button onClick={onClose} className="text-slate-400 text-lg leading-none px-1">✕</button>
        </div>

        {/* 怎麼看 */}
        <ul className="space-y-1.5 text-[12px] text-slate-600 mb-4">
          <li>· <b>越右</b>＝近 5 日三大法人買越多；<b>越左</b>＝賣越多</li>
          <li>· <b>越上</b>＝買賣力道在加速；<b>越下</b>＝在放緩</li>
          <li>· 所以<b>右上角＝買最多、還在加速</b></li>
          <li>· <b>泡泡大小</b>＝近 20 日買賣總額，只是規模、不分好壞</li>
        </ul>

        {/* 四象限 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">四個象限</div>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {QUAD_ROWS.map(q => (
            <div key={q.label} className="rounded-lg px-2.5 py-2" style={{ background: q.bg }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold" style={{ color: q.color }}>{q.label}</span>
                <span className="text-[9px] text-slate-400">{q.pos}</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{q.desc}</div>
            </div>
          ))}
        </div>

        {/* 計算公式 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">計算方式</div>
        <div className="space-y-2 mb-4">
          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
            <div className="text-[11px] font-semibold text-slate-600">X 軸：資金流入／流出（億）</div>
            <code className="block text-[10px] text-slate-400 mt-1">X = Σ(近5日 買進金額 − 賣出金額)</code>
            <div className="text-[10px] text-slate-500 mt-1">近 5 日三大法人淨買超總額</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
            <div className="text-[11px] font-semibold text-slate-600">Y 軸：力道加速（億/天）</div>
            <code className="block text-[10px] text-slate-400 mt-1">Y = 近5日日均淨買超 − 近20日日均淨買超</code>
            <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              最近 5 天「平均每天」買超多少，減掉過去 20 天「平均每天」買超多少。
              正值＝比以前買得更兇，負值＝力道在退。
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
            <div className="text-[11px] font-semibold text-slate-600">泡泡大小：交投規模（億）</div>
            <code className="block text-[10px] text-slate-400 mt-1">size = Σ(近20日 買進金額 + 賣出金額)</code>
            <div className="text-[10px] text-slate-500 mt-1">近 20 日買進＋賣出，滾動視窗，所以回放時會漲也會縮</div>
          </div>
        </div>

        {/* 各象限實例（放在下方，捲動才看到，不干擾上面簡潔的公式） */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">看個例子</div>
        <div className="space-y-2 mb-4">
          {QUAD_EXAMPLES.map(e => (
            <div key={e.label} className="rounded-lg border px-2.5 py-2" style={{ borderColor: e.bg, background: e.bg }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold" style={{ color: e.color }}>{e.label}</span>
                <span className="text-[9px] text-slate-400">{e.pos}</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono leading-relaxed">{e.numbers}</div>
              <div className="text-[11px] text-slate-600 mt-1 leading-relaxed">{e.plain}</div>
            </div>
          ))}
        </div>

        {/* 篩選按鈕 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">篩選按鈕</div>
        <ul className="space-y-1.5 text-[12px] text-slate-600 mb-4">
          <li>· <b>四個象限</b>（上方統計卡）：點一下只看該象限的板塊，再點一下取消</li>
          <li>
            · <b>🔥 熱門 15</b>：依<b>泡泡大小</b>排序取前 15 名，也就是
            <b>近 20 日買賣總額最大</b>的 15 個板塊。看的是「法人交投最熱絡」的地方，
            跟買超或賣超的方向無關——大買大賣都算熱門
          </li>
        </ul>

        {/* 回放 */}
        <div className="text-[11px] font-bold text-slate-500 mb-1.5">回放</div>
        <ul className="space-y-1.5 text-[12px] text-slate-600 mb-3">
          <li>· 點泡泡進入聚焦，按 <b>▶ 回放</b> 看最近 5 個交易日走過的路</li>
          <li>· <b>尾線</b>＝主角走過的軌跡；<b>半透明泡泡</b>＝同族群的其他標的</li>
          <li>· 泡泡大小會跟著每一天的交投規模一起變化</li>
        </ul>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          資料為三大法人（外資＋投信＋自營）合計，來源為證交所與櫃買中心公開資料，僅呈現籌碼事實，不構成投資建議。
        </p>
      </div>
    </div>
  )
}
