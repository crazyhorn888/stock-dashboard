/**
 * seed-ssf-daily.mjs
 * 一次性：把回測抓的個股期貨歷史（backtest-ssf-fetch.py 的 ssf-daily.json）轉成
 * production 的共用日曆格式並上傳，讓 futMove 不用等半年才算得出來。
 *
 * 兩邊格式不同：
 *   回測版     { dates: [...], stocks: { code: { 'YYYY-MM-DD': {oi, vol, buy10, sell10} } } }
 *   production { dates: [...], stocks: { code: { oi: [], vol: [], b10: [] } } }（與 dates 等長）
 *
 * 執行：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed-ssf-daily.mjs /tmp/ssf/ssf-daily.json
 *   SSF_DRY_RUN=1 ...   # 只轉不寫
 *
 * ⚠️ 集中度（b10）兩邊定義不同：回測是爬網頁拿到的「近月」百分比，production 走 OpenAPI 的
 *    「所有契約」列（2026-09-10 台泥實測 44.0% vs 46.0%）。所有契約跟 OI 的跨月加總一致，
 *    所以 production 用它；種子資料的 b10 沿用回測值，會與之後每天寫入的值有一點落差，
 *    但 futMove 只用 OI 與成交量，不碰 b10（AC-HZ-7），不影響判定。
 */

import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'

const FILE = 'ssf-daily.json'
const KEEP_DAYS = 250

export function convert(backtest) {
  const dates = [...(backtest.dates ?? [])].sort().slice(-KEEP_DAYS)
  const stocks = {}
  for (const [code, days] of Object.entries(backtest.stocks ?? {})) {
    stocks[code] = {
      oi: dates.map(d => days[d]?.oi ?? null),
      vol: dates.map(d => days[d]?.vol ?? null),
      b10: dates.map(d => days[d]?.buy10 ?? null),
    }
  }
  return { updatedAt: new Date().toISOString(), dates, stocks }
}

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('用法：node scripts/seed-ssf-daily.mjs <回測版 ssf-daily.json>')

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  const dryRun = process.env.SSF_DRY_RUN === '1'
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL 未設定')

  const snapshot = convert(JSON.parse(readFileSync(path, 'utf8')))
  const codes = Object.keys(snapshot.stocks)
  const withOi = codes.filter(c => snapshot.stocks[c].oi.some(v => v != null))
  console.log(`[seed-ssf] ${codes.length} 檔（有 OI 的 ${withOi.length} 檔）× ${snapshot.dates.length} 天`
    + `（${snapshot.dates[0]} ~ ${snapshot.dates[snapshot.dates.length - 1]}）`)

  const body = JSON.stringify(snapshot)
  console.log(`[seed-ssf] ${FILE} 大小 ${(body.length / 1024 / 1024).toFixed(2)} MB`)
  if (dryRun) { console.log('[seed-ssf] DRY RUN：不上傳'); return }
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
  console.log(`[seed-ssf] ${FILE} 上傳完成`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
