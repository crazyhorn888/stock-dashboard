/**
 * 輕量 Guard 前置檢查（GitHub Actions 在 npm ci 之前執行，被攔截的 run 30 秒內結束）
 *
 * 只用 Node 內建模組，零依賴。判斷邏輯必須與 fetch-daily.mjs 的
 * isAlreadyDoneToday()（Guard 1）/ isTradingDay()（Guard 2）保持一致。
 *
 * 輸出（寫入 $GITHUB_OUTPUT，若無此 env 則只印 stdout）：
 *   SHOULD_RUN=true|false
 *   REASON=<人可讀的原因>
 *
 * 保守原則：任何檢查失敗（網路錯誤、meta.json 不存在）→ SHOULD_RUN=true，
 * 交給完整 pipeline 內建的 Guard 做最終判斷。此腳本只負責省掉「明顯不用跑」的 run。
 */
import { appendFileSync } from 'fs'

function todayTWDate() {
  return process.env.DATE_OVERRIDE ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function rocToISO(rocStr) {
  const s = String(rocStr).replace(/\//g, '')
  const year = parseInt(s.slice(0, -4)) + 1911
  return `${year}-${s.slice(-4, -2)}-${s.slice(-2)}`
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

// Guard 1：今日資料是否已完整上傳（讀 ~1KB 的 meta.json）
// 回傳 true = 已完成（不用跑）；null = 無法判斷（放行）
async function isAlreadyDone(today) {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return null
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/public/snapshots/meta.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null   // meta.json 尚不存在 → 放行，由 pipeline fallback 判斷
    const m = await res.json()
    if (!m?.updatedAt) return null
    const uploaded = new Date(m.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    return uploaded === today
      && (m.stocksDate ?? null) === today
      && (m.marginDate ?? null) === today
      && (m.sectorHistoryLen ?? 0) >= 20
  } catch { return null }
}

// Guard 2：FMTQIK 是否已有今日 K 棒（非交易日 / 15:30 前 → false）
// 回傳 false = 確定不用跑；true / null = 放行
async function hasTodayBar(today) {
  const yyyymmdd = today.replace(/-/g, '')
  try {
    const d = await fetchJSON(`https://www.twse.com.tw/rwd/zh/historicalData/FMTQIK?response=json&date=${yyyymmdd}`)
    if (d?.stat === 'OK' && Array.isArray(d.data)) {
      return d.data.some(row => rocToISO(row[0]) === today)
    }
  } catch { /* 試備用端點 */ }
  try {
    const d2 = await fetchJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=${yyyymmdd}`)
    if (d2?.stat === 'OK' && Array.isArray(d2.data)) {
      return d2.data.some(row => rocToISO(row[0]) === today)
    }
  } catch { /* 兩端點都失敗 */ }
  return null   // TWSE 異常 → 放行，讓 pipeline 自行判斷
}

function emit(shouldRun, reason) {
  const lines = `SHOULD_RUN=${shouldRun}\nREASON=${reason}\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines)
  console.log(`[guard] SHOULD_RUN=${shouldRun}（${reason}）`)
}

async function main() {
  const today = todayTWDate()

  const done = await isAlreadyDone(today)
  if (done === true) return emit(false, `今日 ${today} 資料已完整上傳`)

  const bar = await hasTodayBar(today)
  if (bar === false) return emit(false, `FMTQIK 尚無今日（${today}）K 棒：非交易日或 15:30 前`)

  return emit(true, done === null ? 'meta.json 無法判斷，放行由 pipeline 決定' : '今日資料未完整，需要執行')
}

main().catch(e => {
  console.warn('[guard] 檢查異常，保守放行：', e.message)
  emit(true, `guard-check 異常（${e.message}），放行`)
})
