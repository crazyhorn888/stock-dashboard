import type { IndexOHLC } from '@/lib/types'

/**
 * 融資維持率（估算值）— AC-PB-3
 *
 * ⚠️ 這是「市場整體」的估算，不是你在券商看到的個人帳戶維持率。
 * 官方不公布整體維持率（要逐戶計算），2026-07-28 查過 TWSE／MacroMicro／
 * twmarketdata／玩股網四個來源都沒有現成數字，所以自己推。
 *
 * 推法：
 *   建倉時維持率 = 1 ÷ 融資成數 ≈ 166.7%（融資六成、自備四成）
 *   融資部位平均成本指數 C = Σ(當日融資淨增加 × 當日指數) ÷ Σ(當日融資淨增加)
 *     （回看 60 日，只計融資淨增加的交易日——那些天才是「新部位建倉」）
 *   估算維持率 ≈ 166.7% × (今日指數 ÷ C)
 *
 * 分級門檻依 130 天實測分布訂（2026-09-04 Franky 選定「方案 B」）：
 *   實測範圍 149%~197%、中位 172.9%。
 *   個別帳戶的 130%（追繳）／140%（危險）是另一回事——整體加權平均天然落在
 *   155~175%，套個別帳戶的門檻會有 92% 的日子都是綠燈，溫度計等於不會動。
 */

export type MaintenanceLevel = 'safe' | 'watch' | 'danger' | 'critical'

export interface MarginMaintenance {
  ratio: number          // 估算維持率 %
  costIndex: number      // 融資部位平均成本指數
  lookback: number       // 實際採用的回看天數（夾在 20~120 後的結果）
  todayIndex: number
  level: MaintenanceLevel
  /** 大盤還要再跌幾 % 才會觸及個別帳戶的追繳線 130% */
  dropToCall: number
}

export const MAINTENANCE_THRESHOLDS = { safe: 175, watch: 165, danger: 155 } as const
const INITIAL_RATIO = 166.7   // 融資六成 → 建倉維持率
const MARGIN_CALL = 130       // 券商追繳線（個別帳戶）

/**
 * @param lookback 回看天數。呼叫端請傳頁面的 N——2026-09-04 原本寫死 60，
 *   使用者改 N 時成本指數完全不動，與頁面其他指標的行為不一致。
 *   夾在 20~120：低於 20 天樣本太少、成本指數會被單日大額融資帶偏；
 *   超過 120 天則早就平倉的舊部位還被算進來。
 */
export function estimateMarginMaintenance(
  history: IndexOHLC[],
  lookback = 60,
): MarginMaintenance | null {
  const days = Math.max(20, Math.min(120, Math.round(lookback) || 60))
  const win = history.slice(0, days).filter(r => r.chips?.margin_amount != null)
  if (win.length < 10) return null   // 樣本太少不估，寧可不顯示也不要給錯數字

  let weight = 0, weighted = 0
  for (let i = 0; i < win.length - 1; i++) {
    const inc = win[i].chips!.margin_amount! - win[i + 1].chips!.margin_amount!
    if (inc > 0) { weight += inc; weighted += inc * win[i].close }
  }
  if (weight <= 0) return null       // 這段期間融資只減不增 → 無從估成本

  const costIndex = weighted / weight
  const todayIndex = history[0].close
  const ratio = INITIAL_RATIO * (todayIndex / costIndex)

  return {
    ratio,
    costIndex,
    lookback: days,
    todayIndex,
    level:
      ratio >= MAINTENANCE_THRESHOLDS.safe   ? 'safe'   :
      ratio >= MAINTENANCE_THRESHOLDS.watch  ? 'watch'  :
      ratio >= MAINTENANCE_THRESHOLDS.danger ? 'danger' : 'critical',
    // 維持率與指數成正比 → 跌到追繳線所需跌幅
    dropToCall: Math.max(0, (1 - MARGIN_CALL / ratio) * 100),
  }
}
