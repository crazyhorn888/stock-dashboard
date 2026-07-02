/**
 * 計算市場訊號：大盤 vs 融資 的高低點差距
 * 讀取 data/latest.json（含大盤歷史）→ 輸出 marketSignals 並更新檔案
 *
 * 融資正向條件（看多）：融資減幅 − 大盤減幅 ≥ 5%（從N日最高點算）
 * 融資負向條件（看空）：融資增幅 − 大盤增幅 ≥ 7%（從N日最低點算）
 *
 * 執行：node scripts/calc-signals.mjs [N=100]
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, '..', 'data', 'latest.json')

// ── 抓大盤歷史（FMTQIK，每月一請求）──────────────────
async function fetchIndexHistory(n) {
  const months = getLastNMonths(Math.ceil(n / 18) + 1)  // 每月約 20 天，多備 1 個月
  const results = []

  for (const ym of months) {
    try {
      const url = `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=${ym}01`
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) continue
      const d = await res.json()
      for (const row of d?.data ?? []) {
        const date = twDateToISO(row[0])   // '115/06/01' → '2026-06-01'
        const close = parseFloat(row[4]?.replace(/,/g, '') ?? 0)
        if (date && close > 0) results.push({ date, close })
      }
    } catch { /* 忽略單月失敗 */ }
    await new Promise(r => setTimeout(r, 400))
  }

  return results
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n)
}

// ── 抓大盤融資歷史（RWD MI_MARGN，按交易日並行查詢）──
async function fetchMarginHistory(tradingDates) {
  const CONCURRENCY = 5
  const results = []

  for (let i = 0; i < tradingDates.length; i += CONCURRENCY) {
    const batch = tradingDates.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(async date => {
        const yyyymmdd = date.replace(/-/g, '')
        const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${yyyymmdd}&selectType=MS`
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d = await res.json()
        if (d?.stat !== 'OK' || !d?.tables?.[0]?.data) throw new Error('no data')
        // tables[0].data[2] = 融資金額行，[5] = 今日餘額（仟元）
        const balance = d.tables[0].data[2]?.[5]
        if (!balance) throw new Error('no balance field')
        const margin = parseFloat(balance.replace(/,/g, '')) / 1e5  // 仟元 → 億元
        return { date, margin }
      })
    )
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value)
    }
    if (i + CONCURRENCY < tradingDates.length) await new Promise(r => setTimeout(r, 300))
  }

  return results.sort((a, b) => b.date.localeCompare(a.date))
}

// ── 工具函式 ─────────────────────────────────────────
/** 民國年日期字串（'115/06/01'）→ YYYY-MM-DD */
function twDateToISO(str) {
  if (!str) return null
  const m = str.match(/(\d+)\/(\d+)\/(\d+)/)
  if (!m) return null
  const year = parseInt(m[1]) + 1911
  return `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 取最近 k 個月的 YYYYMM 字串（含當月，倒序）*/
function getLastNMonths(k) {
  const result = []
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  for (let i = 0; i < k; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    result.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

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

  console.log(`[calc-signals] N=${N} 開始計算`)

  const indexHistory = await fetchIndexHistory(N)
  console.log(`[calc-signals] 大盤 ${indexHistory.length} 筆`)

  const tradingDates = indexHistory.map(r => r.date)
  const marginHistory = await fetchMarginHistory(tradingDates)
  console.log(`[calc-signals] 融資 ${marginHistory.length} 筆`)

  const signals = calcSignals(indexHistory, marginHistory, N)

  console.log(`[calc-signals] 正向差距 ${signals.posGapPct.toFixed(2)}%，觸發：${signals.posTriggered}`)
  console.log(`[calc-signals] 負向差距 ${signals.negGapPct.toFixed(2)}%，觸發：${signals.negTriggered}`)

  // 更新 latest.json
  snapshot.marketSignals = signals
  writeFileSync(DATA_FILE, JSON.stringify(snapshot))
  console.log('[calc-signals] 已寫入 data/latest.json')
}

main().catch(e => { console.error(e); process.exit(1) })
