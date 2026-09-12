/**
 * fetch-holders.mjs
 * 功能二十四（AC-HD-1~5）：抓集保戶股權分散表，維護 52 週滾動歷史。
 *
 * 零依賴（只用內建 fetch），比照 fetch-global.mjs，不碰 latest.json / 主 pipeline。
 *
 * 執行：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/fetch-holders.mjs
 *   HOLDERS_DRY_RUN=1 ...    # 只抓不寫，先看產出
 *
 * 資料源：https://opendata.tdcc.com.tw/getOD.ashx?id=1-5
 *   CSV 約 2.36 MB、68,867 列、4,051 檔證券，無需 key。每檔 17 列：
 *     級距 1~15 是持股分級、16 是差異數調整、17 是合計（含總股數）
 *   百張大戶 = 級距 10~15（100,001 股以上）佔比加總
 *   千張大戶 = 級距 15（1,000,001 股以上）佔比
 *
 * ⚠️ 三個必須遵守的坑：
 *  1. 級距 16 是「差異數調整」不是持股分級，加總時必須跳過——用 10~15 的範圍，
 *     不能寫成「10 以上」，否則百張大戶會把調整數和合計一起吃進去。
 *  2. 只追加不重算的檔案一旦寫進殘缺列，那一週就永遠是壞的（2026-09-07 calc-heat
 *     中毒事故同型）。解析出的檔數 < 2,000 或資料日期沒變 → 整批不寫（AC-HD-3）。
 *  3. TDCC 每週最後營業日結算、週六才上架。週間跑這支只會拿到同一份資料，
 *     靠 AC-HD-3 的日期比對擋掉重複寫入。
 */

import { pathToFileURL } from 'url'

const TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
const FILE = 'holders-history.json'
const KEEP_WEEKS = 52        // AC-HD-2：TDCC 官方只留一年（實際 51 週），52 是上限
const MIN_SECURITIES = 2000  // AC-HD-3：正常一份有 4,000+ 檔，低於這個數視為殘檔

// 級距編號 → 意義（TDCC CSV 固定 17 級，2026-09-11 實測）
const LEVEL_HUNDRED_LOT_MIN = 10   // 100,001 股以上
const LEVEL_HUNDRED_LOT_MAX = 15   // 1,000,001 股以上（最後一個真正的持股分級）
const LEVEL_THOUSAND_LOT = 15
const LEVEL_ADJUSTMENT = 16        // 差異數調整，不是持股分級
const LEVEL_TOTAL = 17             // 合計

/** 解析 TDCC CSV → { dataDate, stocks: { code: [h, k, total] } } */
export function parseTDCC(csv) {
  const lines = csv.split(/\r?\n/)
  const header = lines[0]?.replace(/^﻿/, '') ?? ''
  if (!header.includes('持股分級')) {
    throw new Error(`TDCC CSV 表頭不符預期：${header.slice(0, 80)}`)
  }

  const stocks = {}
  const dates = new Set()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cols = line.split(',')
    if (cols.length < 6) continue

    const date = cols[0].trim()
    const code = cols[1].trim()          // CSV 裡代號有補空白（"2330  "）
    const level = Number(cols[2])
    const shares = Number(cols[4])
    const pct = Number(cols[5])
    if (!code || !Number.isFinite(level)) continue

    dates.add(date)
    const s = stocks[code] ?? (stocks[code] = { h: 0, k: 0, total: null })

    if (level === LEVEL_TOTAL) {
      s.total = Number.isFinite(shares) ? shares : null
      continue
    }
    if (level === LEVEL_ADJUSTMENT) continue   // 坑 1
    if (!Number.isFinite(pct)) continue
    if (level >= LEVEL_HUNDRED_LOT_MIN && level <= LEVEL_HUNDRED_LOT_MAX) s.h += pct
    if (level === LEVEL_THOUSAND_LOT) s.k += pct
  }

  if (dates.size !== 1) {
    throw new Error(`TDCC CSV 混到多個資料日期：${[...dates].join('、')}`)
  }
  const dataDate = [...dates][0]
  if (!/^\d{8}$/.test(dataDate)) throw new Error(`資料日期格式不對：${dataDate}`)

  const out = {}
  for (const [code, s] of Object.entries(stocks)) {
    if (s.total == null) continue     // 沒有合計列 = 該檔資料不完整，跳過
    out[code] = [round2(s.h), round2(s.k), s.total]
  }

  return { dataDate: isoDate(dataDate), stocks: out }
}

const round2 = n => Math.round(n * 100) / 100
const isoDate = yyyymmdd => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

/**
 * AC-HD-2：把新的一週併進歷史，維持 52 週滾動。
 * 回傳 { history, skipped }；skipped 有值代表這次不該寫（AC-HD-3）。
 */
export function rollWindow(history, week) {
  const weeks = history?.weeks ?? []
  const count = Object.keys(week.stocks).length

  if (count < MIN_SECURITIES) {
    return { history, skipped: `解析出的檔數只有 ${count}（門檻 ${MIN_SECURITIES}），整批不寫` }
  }
  if (weeks.some(w => w.date === week.dataDate)) {
    return { history, skipped: `資料日期 ${week.dataDate} 已經在歷史裡，跳過` }
  }

  const next = [...weeks, { date: week.dataDate, stocks: week.stocks }]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-KEEP_WEEKS)

  return {
    history: { updatedAt: new Date().toISOString(), weeks: next },
    skipped: null,
  }
}

async function fetchText(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (res.ok) return await res.text()   // R6：body 讀取要包在重試範圍內
    if (res.status < 500) throw new Error(`HTTP ${res.status}`)
    throw new Error(`HTTP ${res.status}（可重試）`)
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 3000))
      return fetchText(url, attempt + 1)
    }
    throw e
  }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  const dryRun = process.env.HOLDERS_DRY_RUN === '1'
  if (!SUPABASE_URL || (!dryRun && !SUPABASE_SERVICE_KEY)) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')
  }

  console.log('[holders] 下載 TDCC 股權分散表 …')
  const csv = await fetchText(TDCC_URL)
  const week = parseTDCC(csv)
  console.log(`[holders] 資料日期 ${week.dataDate}，解析 ${Object.keys(week.stocks).length} 檔`)

  let history = { weeks: [] }
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/${FILE}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-cache' })
    if (res.ok) history = await res.json()
  } catch { /* 首次執行，無舊值 */ }
  console.log(`[holders] 既有歷史 ${history.weeks?.length ?? 0} 週`)

  const { history: next, skipped } = rollWindow(history, week)
  if (skipped) {
    console.log(`[holders] ⏭  ${skipped}`)
    return
  }

  const body = JSON.stringify(next)
  console.log(`[holders] 新歷史 ${next.weeks.length} 週（${next.weeks[0].date} ~ `
    + `${next.weeks[next.weeks.length - 1].date}），${(body.length / 1024 / 1024).toFixed(2)} MB`)

  if (dryRun) {
    console.log('[holders] DRY RUN：不上傳')
    return
  }

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/${FILE}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body,
  })
  if (!res.ok) throw new Error(`Supabase 上傳失敗：${res.status} ${await res.text()}`)
  console.log(`[holders] ${FILE} 上傳完成`)
}

// 被 import 當模組時不執行 main（給測試與 calc-holders-z.mjs 用）。
// 一定要用 pathToFileURL 比對：專案路徑含空白，import.meta.url 是 %20、argv[1] 是真空白，
// 直接字串相接會永遠不相等，main() 就靜默不執行（比照 fetch-options-oi.mjs）。
// argv[1] 在 `node --input-type=module -e` 下是 undefined，要先擋掉才不會炸在 pathToFileURL
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
