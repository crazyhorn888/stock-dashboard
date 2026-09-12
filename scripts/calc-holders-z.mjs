/**
 * calc-holders-z.mjs
 * 功能二十四（AC-HZ-1~7）：從 holders-history.json 算出每檔的週變化、股本事件、穩健 Z、
 * 籌碼異動旗標，產出 holders.json 給前端（由 fetch-daily.mjs 併進 stocks-lite.json）。
 *
 * 零依賴。執行：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/calc-holders-z.mjs
 *   HOLDERS_DRY_RUN=1 ...                  # 只算不寫
 *   HOLDERS_HISTORY_FILE=/tmp/h.json ...   # 用本機檔案取代 Supabase（回測／驗證用）
 *
 * ⚠️ 三個回測學到、不能改回去的設計（詳見 docs/2026-09-11_集保大戶籌碼_回測報告.md）：
 *
 *  1. Z 用中位數／MAD，不用平均數／標準差（AC-HZ-2）。大戶持股比例週變化的峰度高達 640，
 *     一根極端值就把標準差撐大，讓後面真正的異動被壓成小 Z。同一份資料只換算法，
 *     BT-3 的 OI 檢定就從 p=1.0000 變成 p<0.0001——結論完全相反。
 *
 *  2. 門檻是 5 不是 2（AC-HZ-4）。這份資料不是常態分布，|Z|≥2 的命中率是 24.2%
 *     （每週要標 479 檔），那不叫異動。|Z|≥5 是 5.2%，每週約 103 檔。
 *
 *  3. ETF 整檔跳過（AC-HZ-3a）。ETF 每週申購買回讓總股數週週在動，股本事件守門會把
 *     60% 的週數判成不可比；而且 ETF 的「千張大戶」是造市商庫存，語意根本不同。
 */

import { pathToFileURL } from 'url'

const HISTORY_FILE = 'holders-history.json'
const OUT_FILE = 'holders.json'

const Z_WINDOW = 26          // AC-HZ-2：滾動窗（週）
const Z_MIN_PERIODS = 26     // AC-HZ-2：樣本不足 26 週 → Z = null，UI 顯示「累積中」
const CAPITAL_EVENT_PCT = 0.5  // AC-HZ-3：總股數週變化超過這個 % 就是股本／庫存事件
const Z_THRESHOLD = 5          // AC-HZ-4：上線預設，前端可由 AC-HF-4 在 3~8 之間調
const MAD_TO_SIGMA = 1.4826    // 常態分布下 MAD × 這個係數 ≈ 標準差
// 註：2026-09-12 曾加過一個 MAD 尺度下限（0.05 pp）來擋「幾乎不動的股票 Z 值爆到 259」，
// 後來拿掉了，原因有兩個：①那個 0.05 是試了幾個值挑一個命中率好看的，先射箭再畫靶；
// ②改用「百張達門檻且千張同向」的判定之後，單一級距的極端值自然被擋掉，不需要這個參數。
// 實測加不加下限，觸發率只差 0.5 個百分點（11.3% vs 11.8%），對結論沒有影響。
const SSF_FILE = 'ssf-daily.json'
const SSF_MIN_OI = 200_000    // OI 中位數低於這個股數的標的不判期貨異動（小基數會讓比率爆掉）

/** AC-HZ-3a：ETF（代號 00 開頭）不套用這套判定 */
export const isEtf = code => code.startsWith('00')

const median = arr => {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * AC-HZ-3：股本／庫存事件偵測。
 * 擋的是增資、減資、可轉債轉換、實體股票匯撥、ETF 成分調整這類與籌碼無關的跳動——
 * 級距是以股數分級，股價漲跌不會改變任何人的級距歸屬，會讓比例憑空跳動的是股數本身變了。
 */
export function detectCapitalEvent(prevTotal, total) {
  if (prevTotal == null || total == null || prevTotal === 0) return false
  return Math.abs((total - prevTotal) / prevTotal) * 100 > CAPITAL_EVENT_PCT
}

/**
 * AC-HZ-2：穩健 Z。
 * @param deltas  時間順序（舊 → 新）的週變化；股本事件週要先放 null，它們既不進基準窗、
 *                自己的 Z 也是 null（AC-HZ-3）
 * @returns 與 deltas 等長的 Z 陣列
 */
export function calcZ(deltas, floor = 0) {
  const out = new Array(deltas.length).fill(null)
  for (let i = 0; i < deltas.length; i++) {
    const cur = deltas[i]
    if (cur == null) continue
    // 基準只用「這一週之前」的資料，不能讓當週自己進基準
    const base = []
    for (let j = Math.max(0, i - Z_WINDOW); j < i; j++) {
      if (deltas[j] != null) base.push(deltas[j])
    }
    if (base.length < Z_MIN_PERIODS) continue
    const med = median(base)
    const mad = median(base.map(v => Math.abs(v - med)))
    const scale = Math.max(MAD_TO_SIGMA * mad, floor)
    if (!scale) continue      // 連下限都是 0（floor=0 的呼叫端）→ 不給 Z
    out[i] = round2((cur - med) / scale)
  }
  return out
}

const round2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null)

/**
 * AC-HZ-7：期貨異動。把個股期貨的日序列摺成「以集保週別為界」的週特徵，再取穩健 Z。
 *
 * 兩個特徵取 |Z| ≥ 門檻任一成立就算：OI 週變化、週成交量。
 * OI 週變化不能用單純比率——小 OI 的股票從 1 口變 1,855 口就是 1,854 倍（回測實測），
 * 分母一律用該股自己的 OI 中位數，並排除 OI 中位數太小的標的。
 *
 * @param ssf   ssf-daily.json；沒有就回空 Map，futMove 一律 undefined（前端只畫空心點）
 * @param weekDates 集保週別（舊→新）
 */
export function calcFutMove(ssf, weekDates, threshold = Z_THRESHOLD) {
  const out = new Map()
  if (!ssf?.dates?.length || !ssf?.stocks) return out

  const dates = ssf.dates
  for (const [code, series] of Object.entries(ssf.stocks)) {
    const oi = series.oi ?? []
    const vol = series.vol ?? []
    const valid = oi.filter(v => v != null).sort((a, b) => a - b)
    if (valid.length === 0) continue
    const scale = valid[valid.length >> 1]           // 該股 OI 中位數
    if (!scale || scale < SSF_MIN_OI) continue

    const oiChg = []
    const volSum = []
    for (let w = 0; w < weekDates.length; w++) {
      const to = weekDates[w]
      const from = w > 0 ? weekDates[w - 1] : null
      let first = null, last = null, vsum = null
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i]
        if (d > to) break
        if (from != null ? d <= from : false) continue
        if (oi[i] != null) { if (first == null) first = oi[i]; last = oi[i] }
        if (vol[i] != null) vsum = (vsum ?? 0) + vol[i]
      }
      oiChg.push(first != null && last != null ? (last - first) / scale : null)
      volSum.push(vsum)
    }

    const zOi = calcZ(oiChg)
    const zVol = calcZ(volSum)
    const i = weekDates.length - 1
    const hit = (zOi[i] != null && Math.abs(zOi[i]) >= threshold)
      || (zVol[i] != null && Math.abs(zVol[i]) >= threshold)
    // 只有「算得出 Z」的標的才給值；算不出來就不給欄位，前端當 undefined
    if (zOi[i] != null || zVol[i] != null) out.set(code, hit)
  }
  return out
}

/**
 * 把 holders-history.json 攤成每檔的最新一週結果。
 * 回傳 { dataDate, prevDate, threshold, stocks: { code: {...} } }
 */
export function buildHolders(history, ssf = null) {
  const weeks = [...(history?.weeks ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))
  if (weeks.length === 0) throw new Error('holders-history.json 沒有任何週別資料')

  const dataDate = weeks[weeks.length - 1].date
  const prevDate = weeks.length > 1 ? weeks[weeks.length - 2].date : null

  // 先把每檔的時間序列收集起來（h=百張%、k=千張%、t=總股數）
  const series = new Map()
  weeks.forEach((w, wi) => {
    for (const [code, v] of Object.entries(w.stocks)) {
      if (isEtf(code)) continue            // AC-HZ-3a
      let s = series.get(code)
      if (!s) series.set(code, (s = { h: [], k: [], t: [] }))
      // 該股在某些週可能缺席（新上市／暫停交易），用 null 佔位維持週別對齊
      while (s.h.length < wi) { s.h.push(null); s.k.push(null); s.t.push(null) }
      s.h.push(v[0]); s.k.push(v[1]); s.t.push(v[2])
    }
  })

  const futMoves = calcFutMove(ssf, weeks.map(w => w.date))

  const stocks = {}
  for (const [code, s] of series) {
    while (s.h.length < weeks.length) { s.h.push(null); s.k.push(null); s.t.push(null) }

    const events = s.t.map((t, i) => detectCapitalEvent(i > 0 ? s.t[i - 1] : null, t))
    const diff = arr => arr.map((v, i) => {
      const prev = i > 0 ? arr[i - 1] : null
      return v == null || prev == null ? null : round2(v - prev)
    })
    const dh = diff(s.h)
    const dk = diff(s.k)
    // 股本事件週：Δ 與 Z 一律 null（AC-HZ-3）
    const maskedH = dh.map((v, i) => (events[i] ? null : v))
    const maskedK = dk.map((v, i) => (events[i] ? null : v))
    const zh = calcZ(maskedH)
    const zk = calcZ(maskedK)

    const i = weeks.length - 1
    if (s.h[i] == null) continue          // 最新一週沒這檔 → AC-HD-5 顯示「—」

    const zhL = zh[i]
    const zkL = zk[i]
    // AC-HZ-4（2026-09-13 定案）：判定＝百張的偏離達門檻「且」千張同方向變動。
    //
    // 為什麼不是取兩者最大：那等於同一件事問兩次、任一個說怪就算，命中率被灌水
    //（百張 2.2% + 千張 4.9% → 6.5%）。
    // 為什麼不是只看千張：千張級距全市場人數中位數只有 10~15 人，有些股票只有 1~2 個，
    //   比例變化根本是單一帳戶的動作；而且低價股有 34% 的週數千張整週不動。
    // 為什麼要千張同向：兩個級距互相佐證，單純中實戶換手、或單一大戶進出都不會觸發。
    const sameDir = maskedH[i] != null && maskedK[i] != null && maskedH[i] * maskedK[i] > 0

    stocks[code] = {
      h: s.h[i],
      k: s.k[i],
      prevH: s.h[i - 1] ?? null,
      prevK: s.k[i - 1] ?? null,
      dh: maskedH[i],
      dk: maskedK[i],
      zh: zhL,
      zk: zkL,
      // 前端拿 |zh| 跟使用者自己調的門檻比（AC-HF-4），所以旗標本身不寫死門檻
      sameDir,
      capitalEvent: events[i],
      weeks: s.h.filter(v => v != null).length,   // 已累積週數，UI 判斷要不要顯示「累積中」
      // AC-HZ-7：沒有個股期貨、或 Z 還算不出來的標的不給這個欄位（undefined），
      // 前端只畫空心點，不會畫錯成實心
      ...(futMoves.has(code) ? { futMove: futMoves.get(code) } : {}),
    }
  }

  return { dataDate, prevDate, threshold: Z_THRESHOLD, window: Z_WINDOW,
           minPeriods: Z_MIN_PERIODS, stocks }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  const dryRun = process.env.HOLDERS_DRY_RUN === '1'
  const localFile = process.env.HOLDERS_HISTORY_FILE

  let history
  if (localFile) {
    const { readFileSync } = await import('fs')
    history = JSON.parse(readFileSync(localFile, 'utf8'))
  } else {
    if (!SUPABASE_URL) throw new Error('SUPABASE_URL 未設定')
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/${HISTORY_FILE}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-cache' })
    if (!res.ok) throw new Error(`讀 ${HISTORY_FILE} 失敗：${res.status}`)
    history = await res.json()
  }

  let ssf = null
  const ssfLocal = process.env.SSF_DAILY_FILE
  try {
    if (ssfLocal) {
      const { readFileSync } = await import('fs')
      ssf = JSON.parse(readFileSync(ssfLocal, 'utf8'))
    } else {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/${SSF_FILE}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-cache' })
      if (res.ok) ssf = await res.json()
    }
  } catch { /* 個股期貨還沒上線 → futMove 一律不給 */ }

  const out = buildHolders(history, ssf)
  const codes = Object.keys(out.stocks)
  const withZ = codes.filter(c => out.stocks[c].zh != null)
  const hit = withZ.filter(c => Math.abs(out.stocks[c].zh) >= Z_THRESHOLD && out.stocks[c].sameDir)
  const events = codes.filter(c => out.stocks[c].capitalEvent)

  console.log(`[holders-z] 資料週 ${out.dataDate}（上一週 ${out.prevDate ?? '—'}）`)
  console.log(`[holders-z] ${codes.length} 檔（已排除 ETF）；Z 值可算 ${withZ.length} 檔`
    + `、累積中 ${codes.length - withZ.length} 檔；股本事件 ${events.length} 檔`)
  const wide = hit.filter(c => out.stocks[c].futMove)
  console.log(`[holders-z] 個股期貨序列 ${ssf?.dates?.length ?? 0} 天`
    + `；有期貨異動判定的 ${codes.filter(c => out.stocks[c].futMove !== undefined).length} 檔`)
  console.log(`[holders-z] 門檻 ${Z_THRESHOLD} → 籌碼異動 ${hit.length} 檔`
    + `（其中同週期貨也異動 ${wide.length} 檔）`
    + (withZ.length ? `（${(hit.length / withZ.length * 100).toFixed(1)}%）` : ''))
  if (hit.length) {
    const top = hit.sort((a, b) => Math.abs(out.stocks[b].zh) - Math.abs(out.stocks[a].zh)).slice(0, 5)
    console.log('[holders-z] Z 最大的幾檔：'
      + top.map(c => `${c} Z=${out.stocks[c].zh}（百張 ${out.stocks[c].dh}pp／千張 ${out.stocks[c].dk}pp）`).join('、'))
  }

  const body = JSON.stringify({ updatedAt: new Date().toISOString(), ...out })
  console.log(`[holders-z] ${OUT_FILE} 大小 ${(body.length / 1024).toFixed(0)} KB`)

  if (dryRun) { console.log('[holders-z] DRY RUN：不上傳'); return }
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY 未設定')

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/${OUT_FILE}`, {
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
  console.log(`[holders-z] ${OUT_FILE} 上傳完成`)
}

// argv[1] 在 `node --input-type=module -e` 下是 undefined；路徑含空白必須走 pathToFileURL
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
