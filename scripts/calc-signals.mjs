/**
 * 計算市場訊號：大盤 vs 融資 的高低點差距
 * 讀取 data/latest.json（含大盤歷史）→ 輸出 marketSignals 並更新檔案
 *
 * 融資正向條件（看多）：融資減幅 − 大盤減幅 ≥ 5%（從N日最高點算）
 * 融資負向條件（看空）：融資增幅 − 大盤增幅 ≥ 7%（從N日最低點算）
 *
 * 2026-07-14 起：資料改從快照 indexHistory 取（close + chips.margin_amount），
 * 不再重抓 TWSE（舊版每 run 打 100+ 請求，且無失敗保護——07-14 17:07 班撞上
 * TWSE 端點群暫時異常，拿到空資料直接炸掉整個 run）。
 * 日期對齊保證：calcSignals 只用「大盤與融資都有值的日期交集」，todayIndex/todayMargin
 * 永遠同一天；今日融資未發布時整組退到最後一個兩者都有的交易日，不會混天計算。
 *
 * 執行：node scripts/calc-signals.mjs [N=100]
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, '..', 'data', 'latest.json')

// ── 計算訊號 ─────────────────────────────────────────
function calcSignals(indexHistory, marginHistory, n) {
  // 以兩邊都有的日期為準
  const indexMap = Object.fromEntries(indexHistory.map(r => [r.date, r.close]))
  const marginMap = Object.fromEntries(marginHistory.map(r => [r.date, r.margin]))
  const dates = indexHistory.map(r => r.date).filter(d => marginMap[d]).slice(0, n)

  if (dates.length < 2) throw new Error('資料不足，無法計算訊號')

  // 今日
  const todayDate = dates[0]
  const todayIndex = indexMap[todayDate]
  const todayMargin = marginMap[todayDate]

  // N 日最高點（大盤）
  let peakDate = todayDate, peakIndex = todayIndex
  for (const d of dates) {
    if (indexMap[d] > peakIndex) { peakIndex = indexMap[d]; peakDate = d }
  }

  // N 日最低點（大盤）
  let troughDate = todayDate, troughIndex = todayIndex
  for (const d of dates) {
    if (indexMap[d] < troughIndex) { troughIndex = indexMap[d]; troughDate = d }
  }

  // 峰頂當日融資
  const peakMargin = marginMap[peakDate] ?? todayMargin
  // 谷底當日融資
  const troughMargin = marginMap[troughDate] ?? todayMargin

  // 正向條件（從高點跌幅比較）
  const indexDropPct = peakIndex > 0 ? ((peakIndex - todayIndex) / peakIndex) * 100 : 0
  const marginDropPct = peakMargin > 0 ? ((peakMargin - todayMargin) / peakMargin) * 100 : 0
  const posGapPct = marginDropPct - indexDropPct
  const posTriggered = posGapPct >= 5

  // 負向條件（從低點漲幅比較）
  const indexRisePct = troughIndex > 0 ? ((todayIndex - troughIndex) / troughIndex) * 100 : 0
  const marginRisePct = troughMargin > 0 ? ((todayMargin - troughMargin) / troughMargin) * 100 : 0
  const negGapPct = marginRisePct - indexRisePct
  const negTriggered = negGapPct >= 7

  return {
    updatedAt: new Date().toISOString(),
    nDays: n,
    todayDate, todayIndex, todayMargin,
    peakDate, peakIndex, peakMargin,
    indexDropPct, marginDropPct, posGapPct, posTriggered,
    troughDate, troughIndex, troughMargin,
    indexRisePct, marginRisePct, negGapPct, negTriggered,
  }
}

// ── Main ─────────────────────────────────────────────
async function main() {
  const N = parseInt(process.argv[2] ?? '100', 10)

  // 若 latest.json 的 stocks 為空（非交易日被跳過後留下舊版），直接離開
  const snapshot = JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
  if (!snapshot.stocks || snapshot.stocks.length === 0) {
    console.log('[calc-signals] stocks 為空，非交易日，跳過，exit 0')
    process.exit(0)
  }

  console.log(`[calc-signals] N=${N} 開始計算（資料源：快照 indexHistory，零外部請求）`)

  const bars = snapshot.indexHistory ?? []
  const indexHistory  = bars.map(r => ({ date: r.date, close: r.close }))                    // newest first
  const marginHistory = bars
    .filter(r => r.chips?.margin_amount != null)
    .map(r => ({ date: r.date, margin: r.chips.margin_amount }))
  console.log(`[calc-signals] 大盤 ${indexHistory.length} 筆，融資 ${marginHistory.length} 筆`)

  // 資料不足（如融資回補前的極端狀態）→ 保留既有 marketSignals、exit 0 不標紅
  let signals
  try {
    signals = calcSignals(indexHistory, marginHistory, N)
  } catch (e) {
    console.warn(`[calc-signals] ${e.message}——保留既有 marketSignals，跳過本次計算`)
    process.exit(0)
  }

  console.log(`[calc-signals] 正向差距 ${signals.posGapPct.toFixed(2)}%，觸發：${signals.posTriggered}`)
  console.log(`[calc-signals] 負向差距 ${signals.negGapPct.toFixed(2)}%，觸發：${signals.negTriggered}`)

  // 更新 latest.json
  snapshot.marketSignals = signals
  writeFileSync(DATA_FILE, JSON.stringify(snapshot))
  console.log('[calc-signals] 已寫入 data/latest.json')
}

main().catch(e => { console.error(e); process.exit(1) })
