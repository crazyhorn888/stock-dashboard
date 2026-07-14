/**
 * 回補 indexHistory 中缺少的籌碼欄位（近 100 個交易日，2026-07-15 Franky 要求）
 *
 * 資料源（全部官方歷史查詢）：
 *   - TWSE BFI82U               三大法人現貨買賣超（上市，與 Phase1 主路徑同源）
 *   - TAIFEX futContractsDateDown  期貨三大法人 交易+未平倉（TXF/MXF/TMF）
 *   - TAIFEX callsAndPutsDateDown  選擇權三大法人 交易+未平倉（TXO）
 *   - TAIFEX pcRatioDown           PCR（未平倉量比率%，同 Phase1 取法）
 *   - TAIFEX futDataDown           台指期近月收盤 + 當月/次月市場未沖銷（散戶 OI 推導）
 *
 * 合併原則：只填 null/缺少的欄位，永不覆蓋既有非 null 值（Phase1 產的日子保持原樣）。
 * VIX 與 retail_mtx/imf_pct 無官方歷史端點 → 維持 null 顯示「—」。
 * 只透過 HTTP 讀寫 Supabase，不碰本機 data/（iCloud 規則）。
 *
 * 用法：SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx node scripts/backfill-chips.mjs [天數=100]
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('需要 SUPABASE_URL 和 SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const N_DAYS = parseInt(process.argv[2] ?? '100', 10)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const r2 = v => Math.round(v * 100) / 100

// ── TAIFEX CSV 下載（POST，big5）────────────────────────────────
async function taifexCSV(path, params) {
  const body = new URLSearchParams(params).toString()
  const res = await fetch(`https://www.taifex.com.tw/cht/3/${path}`, {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const text = new TextDecoder('big5').decode(buf)
  return text.trim().split('\n').map(l => l.split(',').map(c => c.trim()))
}

/** 日期區間切月（TAIFEX 查詢上限約 1 個月） */
function monthChunks(oldestISO, newestISO) {
  const chunks = []
  let cur = new Date(oldestISO)
  const end = new Date(newestISO)
  while (cur <= end) {
    const from = new Date(cur)
    const to = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
    chunks.push([from, to > end ? end : to])
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return chunks.map(([a, b]) => [fmtSlash(a), fmtSlash(b)])
}
const fmtSlash = d => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
const slashToISO = s => s.replaceAll('/', '-')
const num = s => parseFloat(String(s).replace(/,/g, '')) || 0

const PARTY = { '自營商': 'dealer', '投信': 'trust', '外資及陸資': 'foreign', '外資': 'foreign' }

// ── 期貨（交易+未平倉，三商品）────────────────────────────────
async function fetchFutures(chunks) {
  const out = {} // date → product → party → {trL,trS,oiL,oiS}
  const PRODUCTS = [['TXF', 'tx'], ['MXF', 'mtx'], ['TMF', 'imf']]
  for (const [cid, key] of PRODUCTS) {
    for (const [from, to] of chunks) {
      const rows = await taifexCSV('futContractsDateDown', {
        firstDate: '2026/01/01', lastDate: to, queryStartDate: from, queryEndDate: to, commodityId: cid,
      })
      for (const c of rows.slice(1)) {
        if (c.length < 15) continue
        const [date, , identity] = c
        const p = PARTY[identity]
        if (!p) continue
        const d = slashToISO(date)
        out[d] ??= {}; out[d][key] ??= {}
        out[d][key][p] = { trL: num(c[3]), trS: num(c[5]), oiL: num(c[9]), oiS: num(c[11]) }
      }
      await sleep(800)
    }
    console.log(`[backfill-chips] 期貨 ${cid} 完成`)
  }
  return out
}

// ── 選擇權（TXO）────────────────────────────────────────────────
async function fetchOptions(chunks) {
  const out = {} // date → party → {bc,sc,bp,sp, oi:{callL,callS,putL,putS}}
  for (const [from, to] of chunks) {
    const rows = await taifexCSV('callsAndPutsDateDown', {
      firstDate: '2026/01/01', lastDate: to, queryStartDate: from, queryEndDate: to, commodityId: 'TXO',
    })
    for (const c of rows.slice(1)) {
      if (c.length < 16) continue
      const [date, , cp, identity] = c
      const p = PARTY[identity]
      if (!p) continue
      const d = slashToISO(date)
      out[d] ??= {}
      out[d][p] ??= { bc: 0, sc: 0, bp: 0, sp: 0, oi: { callL: 0, callS: 0, putL: 0, putS: 0 } }
      const t = out[d][p]
      if (cp === 'CALL') { t.bc = num(c[4]); t.sc = num(c[6]); t.oi.callL = num(c[10]); t.oi.callS = num(c[12]) }
      else if (cp === 'PUT') { t.bp = num(c[4]); t.sp = num(c[6]); t.oi.putL = num(c[10]); t.oi.putS = num(c[12]) }
    }
    await sleep(800)
  }
  console.log('[backfill-chips] 選擇權 TXO 完成')
  return out
}

// ── PCR ─────────────────────────────────────────────────────────
async function fetchPCR(chunks) {
  const out = {}
  for (const [from, to] of chunks) {
    const rows = await taifexCSV('pcRatioDown', { queryStartDate: from, queryEndDate: to })
    for (const c of rows.slice(1)) {
      if (c.length < 7) continue
      out[slashToISO(c[0])] = num(c[6])   // 買賣權未平倉量比率%（與 Phase1 同欄）
    }
    await sleep(800)
  }
  console.log('[backfill-chips] PCR 完成')
  return out
}

// ── 台指期近月收盤 + 市場未沖銷（TX/MTX/TMF）───────────────────
async function fetchFutMarket(chunks) {
  const out = {} // date → { txClose, totalOI: {tx,mtx,imf} }
  const PRODUCTS = [['TX', 'tx'], ['MTX', 'mtx'], ['TMF', 'imf']]
  for (const [cid, key] of PRODUCTS) {
    for (const [from, to] of chunks) {
      const rows = await taifexCSV('futDataDown', {
        down_type: '1', commodity_id: cid, queryStartDate: from, queryEndDate: to,
      })
      // 欄位：交易日期,契約,到期月份(週別),開盤,最高,最低,收盤,...,未沖銷契約數,...
      const header = rows[0]
      const iDate = 0, iMonth = 2
      const iClose = header.findIndex(h => h.includes('收盤'))
      const iOI = header.findIndex(h => h.includes('未沖銷'))
      const perDate = {}
      for (const c of rows.slice(1)) {
        if (c.length < Math.max(iClose, iOI)) continue
        const month = c[iMonth]
        if (!/^\d{6}$/.test(month)) continue   // 排除週契約/價差
        const d = slashToISO(c[iDate])
        perDate[d] ??= []
        perDate[d].push({ month, close: num(c[iClose]), oi: num(c[iOI]) })
      }
      for (const [d, list] of Object.entries(perDate)) {
        list.sort((a, b) => a.month.localeCompare(b.month))
        out[d] ??= { totalOI: {} }
        // 近月收盤（僅 TX 用）＋ 全部月份未沖銷合計（散戶推導——實測 Phase1 07-14 的
        // retail 反推 total=114,901 = 全月份合計；當月+次月在結算週會小於法人合計導致歸零）
        if (key === 'tx') out[d].txClose = list[0]?.close ?? null
        out[d].totalOI[key] = list.reduce((s, x) => s + x.oi, 0)
      }
      await sleep(800)
    }
    console.log(`[backfill-chips] 市場報表 ${cid} 完成`)
  }
  return out
}

// ── TWSE 三大法人現貨（逐日）──────────────────────────────────
async function fetchSpot(dateISO) {
  const yyyymmdd = dateISO.replaceAll('-', '')
  try {
    const res = await fetch(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=${yyyymmdd}&response=json`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const d = await res.json()
    if (d?.stat !== 'OK') return null
    const out = {}
    for (const row of d.data ?? []) {
      const name = String(row[0])
      const diff = num(row[3]) / 1e8
      if (name.includes('外資及陸資') && name.includes('不含')) out.foreign_spot = r2(diff)
      else if (name.includes('投信')) out.trust_spot = r2(diff)
      else if (name.includes('自行買賣')) out.dealer_self = r2(diff)
      else if (name.includes('避險')) out.dealer_hedge = r2(diff)
    }
    return Object.keys(out).length >= 4 ? out : null
  } catch { return null }
}

// ── 組裝 ────────────────────────────────────────────────────────
function buildFutTables(dayFut, dayMkt) {
  if (!dayFut) return { fut_oi: null, fut_tr: null }
  const fut_oi = {}, fut_tr = {}
  for (const key of ['tx', 'mtx', 'imf']) {
    const t = dayFut[key]
    if (!t?.foreign) { fut_oi[key] = null; fut_tr[key] = null; continue }
    const oi = {}, tr = {}
    let instL = 0, instS = 0
    for (const p of ['foreign', 'trust', 'dealer']) {
      const v = t[p] ?? { trL: 0, trS: 0, oiL: 0, oiS: 0 }
      oi[p] = [v.oiL, v.oiS, v.oiL - v.oiS]
      tr[p] = [v.trL, v.trS, v.trL - v.trS]
      instL += v.oiL; instS += v.oiS
    }
    const total = dayMkt?.totalOI?.[key] ?? 0
    const rl = Math.max(0, total - instL), rs = Math.max(0, total - instS)
    oi.retail = [rl, rs, rl - rs]
    fut_oi[key] = oi
    fut_tr[key] = tr
  }
  return { fut_oi, fut_tr }
}

function buildOptTables(dayOpt) {
  if (!dayOpt?.foreign) return { opt_tr: null, opt_oi: null }
  const tr = {}, oi = {}
  let trC = 0, trP = 0, oiC = 0, oiP = 0
  for (const p of ['foreign', 'trust', 'dealer']) {
    const v = dayOpt[p] ?? { bc: 0, sc: 0, bp: 0, sp: 0, oi: { callL: 0, callS: 0, putL: 0, putS: 0 } }
    tr[p] = { bc: v.bc, sc: v.sc, bp: v.bp, sp: v.sp }
    oi[p] = { bc: v.oi.callL, sc: v.oi.callS, bp: v.oi.putL, sp: v.oi.putS }
    trC += v.bc - v.sc; trP += v.bp - v.sp
    oiC += v.oi.callL - v.oi.callS; oiP += v.oi.putL - v.oi.putS
  }
  tr.retail = { call_net: -trC, put_net: -trP }
  oi.retail = { call_net: -oiC, put_net: -oiP }
  return { opt_tr: tr, opt_oi: oi }
}

async function main() {
  console.log('[backfill-chips] 下載 latest.json...')
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`latest.json ${res.status}`)
  const snap = await res.json()
  const bars = (snap.indexHistory ?? []).slice(0, N_DAYS + 1)  // +1 供最舊一天算 chg
  const targets = bars.slice(0, N_DAYS)
  console.log(`[backfill-chips] 目標 ${targets.length} 個交易日（${targets[targets.length - 1].date} ~ ${targets[0].date}）`)

  const chunks = monthChunks(bars[bars.length - 1].date, bars[0].date)
  const [fut, opt, pcr, mkt] = [
    await fetchFutures(chunks),
    await fetchOptions(chunks),
    await fetchPCR(chunks),
    await fetchFutMarket(chunks),
  ]

  // 現貨逐日（只抓缺的日子）
  const spotByDate = {}
  for (const bar of targets) {
    if (bar.chips?.foreign_spot != null) continue
    spotByDate[bar.date] = await fetchSpot(bar.date)
    await sleep(900)
  }
  console.log(`[backfill-chips] 現貨 BFI82U 完成（抓 ${Object.keys(spotByDate).length} 天）`)

  // 逐日合併（只填 null/缺欄位）
  let filled = 0
  for (let i = 0; i < targets.length; i++) {
    const bar = targets[i]
    const d = bar.date
    const prevD = bars[i + 1]?.date
    const existing = bar.chips ?? {}
    const patch = {}

    const spot = spotByDate[d]
    if (existing.foreign_spot == null && spot) {
      Object.assign(patch, spot)
      patch.inst_total = r2(spot.foreign_spot + spot.trust_spot + spot.dealer_self + spot.dealer_hedge)
    }
    if (existing.tx_close == null && mkt[d]?.txClose) {
      patch.tx_close = mkt[d].txClose
      patch.basis = r2(mkt[d].txClose - bar.close)
      const prevClose = prevD ? mkt[prevD]?.txClose : null
      patch.tx_change = prevClose ? r2(mkt[d].txClose - prevClose) : null
    }
    if (existing.fx_tx_oi == null && fut[d]?.tx?.foreign) {
      patch.fx_tx_oi = fut[d].tx.foreign.oiL - fut[d].tx.foreign.oiS
      const pf = prevD ? fut[prevD]?.tx?.foreign : null
      patch.fx_tx_chg = pf ? patch.fx_tx_oi - (pf.oiL - pf.oiS) : null
    }
    if (existing.pcr == null && pcr[d] != null) patch.pcr = pcr[d]
    if (existing.opt_tr == null || existing.opt_oi == null) {
      const { opt_tr, opt_oi } = buildOptTables(opt[d])
      if (existing.opt_tr == null && opt_tr) patch.opt_tr = opt_tr
      if (existing.opt_oi == null && opt_oi) patch.opt_oi = opt_oi
    }
    if (existing.fut_oi == null || existing.fut_tr == null) {
      const { fut_oi, fut_tr } = buildFutTables(fut[d], mkt[d])
      if (existing.fut_oi == null && fut_oi) patch.fut_oi = fut_oi
      if (existing.fut_tr == null && fut_tr) patch.fut_tr = fut_tr
    }

    if (Object.keys(patch).length > 0) {
      bar.chips = { ...existing, ...patch }
      filled++
    }
  }
  console.log(`[backfill-chips] 合併完成：${filled}/${targets.length} 天有補值`)

  // 驗證：07-14（Phase1 產的日子）官方回補值 vs 既有值抽對
  const v = targets.find(b => b.date === '2026-07-14')
  if (v && fut['2026-07-14']) {
    const f = fut['2026-07-14'].tx.foreign
    console.log(`[驗證] 07-14 外資大台 OI 淨額：官方=${f.oiL - f.oiS} vs Phase1=${v.chips?.fx_tx_oi}（應相等）`)
    console.log(`[驗證] 07-14 PCR：官方=${pcr['2026-07-14']} vs Phase1=${v.chips?.pcr}`)
  }

  if (process.env.DRY_RUN === '1') {
    console.log('[backfill-chips] DRY_RUN=1，不上傳。樣本（最新一天 chips）：')
    console.log(JSON.stringify(targets[0].chips, null, 1).slice(0, 1500))
    return
  }
  const payload = JSON.stringify(snap)
  console.log(`[backfill-chips] 上傳 latest.json（${(payload.length / 1048576).toFixed(1)} MB）...`)
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/latest.json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body: payload,
  })
  if (!up.ok) { console.error('上傳失敗:', up.status, await up.text()); process.exit(1) }
  console.log('[backfill-chips] 完成！執行 gh workflow run daily-fetch.yml -f force_run=true 重派生 market.json')
}

main().catch(e => { console.error(e); process.exit(1) })
