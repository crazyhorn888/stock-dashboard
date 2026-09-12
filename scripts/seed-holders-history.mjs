/**
 * seed-holders-history.mjs
 * 一次性：把 backtest-holders-fetch.py 爬回來的歷史（JSONL）灌進 holders-history.json。
 *
 * 為什麼要這支：TDCC 的批次下載只給當週，歷史只能逐檔逐週爬，而且官方只保留 51 週——
 * 現在不爬，2025-09 ~ 2026-09 這一年之後永遠拿不到。跑完這支，1,980 檔立刻都有
 * 26 週以上的基準，Z 值不用等到 2027-03（AC-HZ-2 的暖身期）。
 *
 * 執行（可給多個 JSONL，平行 worker 的分片檔直接全列上去）：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *     node scripts/seed-holders-history.mjs /tmp/backfill-*.jsonl /tmp/holders-history.jsonl
 *   HOLDERS_DRY_RUN=1 ...   # 只組不寫
 *
 * ⚠️ 這支是「合併」不是「覆寫」：遠端已經有的週別會保留，同一週的個股資料以本地為準補齊。
 *    週六班次先跑掉、把新的一週寫進去的情況下，這支不會把那一週洗掉。
 */

import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'

const FILE = 'holders-history.json'
const KEEP_WEEKS = 52
const MIN_PER_WEEK = 500   // 回填是逐檔爬的，單週檔數本來就少於批次檔；低於這個數視為該週沒爬完

/** 讀 JSONL → { 'YYYY-MM-DD': { code: [h, k, total] } } */
export function loadJsonl(paths) {
  const weeks = new Map()
  let rows = 0, skipped = 0
  for (const path of paths) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let r
      try { r = JSON.parse(line) } catch { continue }
      rows++
      if (r.h == null || r.k == null || r.total == null) { skipped++; continue }
      const date = `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`
      let w = weeks.get(date)
      if (!w) weeks.set(date, (w = {}))
      w[r.code] = [r.h, r.k, r.total]
    }
  }
  return { weeks, rows, skipped }
}

/** 本地週別併進既有歷史；同週同檔以本地為準，遠端獨有的保留 */
export function mergeWeeks(remoteWeeks, localWeeks) {
  const byDate = new Map()
  for (const w of remoteWeeks ?? []) byDate.set(w.date, { ...w.stocks })
  for (const [date, stocks] of localWeeks) {
    const target = byDate.get(date) ?? {}
    Object.assign(target, stocks)
    byDate.set(date, target)
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-KEEP_WEEKS)
    .map(([date, stocks]) => ({ date, stocks }))
}

async function main() {
  const paths = process.argv.slice(2)
  if (paths.length === 0) throw new Error('用法：node scripts/seed-holders-history.mjs <jsonl...>')

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  const dryRun = process.env.HOLDERS_DRY_RUN === '1'
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL 未設定')

  const { weeks: local, rows, skipped } = loadJsonl(paths)
  console.log(`[seed] 讀 ${paths.length} 個檔案、${rows} 列（查無資料 ${skipped} 列）`
    + ` → ${local.size} 個週別`)

  const thin = [...local.entries()].filter(([, s]) => Object.keys(s).length < MIN_PER_WEEK)
  if (thin.length) {
    console.log(`[seed] ⚠️ 以下週別檔數偏少，可能沒爬完：`
      + thin.map(([d, s]) => `${d}(${Object.keys(s).length})`).join('、'))
  }

  let remote = { weeks: [] }
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/${FILE}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-cache' })
    if (res.ok) remote = await res.json()
  } catch { /* 還沒有遠端檔案 */ }
  console.log(`[seed] 遠端既有 ${remote.weeks?.length ?? 0} 週`)

  const merged = mergeWeeks(remote.weeks, local)
  const counts = merged.map(w => Object.keys(w.stocks).length)
  console.log(`[seed] 合併後 ${merged.length} 週（${merged[0].date} ~ ${merged[merged.length - 1].date}）`
    + `，每週檔數 ${Math.min(...counts)} ~ ${Math.max(...counts)}`)

  const body = JSON.stringify({ updatedAt: new Date().toISOString(), weeks: merged })
  console.log(`[seed] ${FILE} 大小 ${(body.length / 1024 / 1024).toFixed(2)} MB`)

  if (dryRun) { console.log('[seed] DRY RUN：不上傳'); return }
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY 未設定')

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
  console.log(`[seed] ${FILE} 上傳完成；接著跑 node scripts/calc-holders-z.mjs 產出 holders.json`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
