/**
 * 計算市場熱度（AC-HT-C1~C5）
 *
 * 流程：
 *   1. 從 Supabase 讀 heat-history.json（一次性回補產生，見 scripts/backfill-heat-history.py）
 *   2. 從 data/latest.json 的 indexHistory 取當日 6 項特徵原始值，追加一筆（AC-HT-B4）
 *   3. 算滾動 Z（250 日）→ 熱度分數 → 滾動百分位（250 日）→ heat / warn / entry
 *   4. 把三個值寫回 indexHistory 每一筆（AC-HT-C3），並把更新後的 history 傳回 Supabase
 *
 * 六項特徵一律用相對比率，市場量體長大不會失真：
 *   f1 bias60   大盤乖離 MA60%            = close / MA60 − 1              （正向）
 *   f2 dCallOI  自營 CallOI 金額佔比%      = dealer.call_oi_net_amt / 規模  （反向）
 *   f3 dSC      自營 SC 金額佔比%          = dealer.sc_amt / 規模           （正向）
 *   f4 fCP      外資買方 C/P 比            = foreign.bc / foreign.bp        （正向）
 *   f5 tFut5    投信期貨 5 日變動佔規模%    （回補檔提供，每日增量暫留 null）
 *   f6 vol5     成交量 5 日變動%                                            （正向）
 * 規模 = 外資與自營 8 類選擇權交易金額（bc/sc/bp/sp）絕對值總和
 *
 * 執行：node scripts/calc-heat.mjs
 * 需要：SUPABASE_URL、SUPABASE_SERVICE_KEY
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, '..', 'data', 'latest.json')
const HISTORY_KEY = 'heat-history.json'
const BUCKET = 'snapshots'

const Z_WINDOW = 250   // AC-HT-C1：Z 值視窗
const P_WINDOW = 250   // 百分位視窗
const KEYS = [         // [欄位, 方向]；方向 -1 代表「越低越熱」
  ['bias60', 1], ['dCallOI', -1], ['dSC', 1],
  ['fCP', 1], ['tFut5', 1], ['vol5', 1],
]

// ── Supabase ────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

async function downloadHistory() {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${HISTORY_KEY}`
  const res = await fetch(url, { cache: 'no-cache' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`heat-history 下載失敗：${res.status}`)
  return res.json()
}

async function uploadHistory(obj) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${HISTORY_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(obj),
  })
  if (!res.ok) throw new Error(`heat-history 上傳失敗：${res.status} ${await res.text()}`)
}

// ── 從快照取當日特徵 ─────────────────────────────────
/** indexHistory 為 newest first；回傳 { 'YYYY-MM-DD': {6 項特徵} } */
function extractFeatures(indexHistory) {
  const rows = [...indexHistory].reverse()          // 改為 oldest first 方便算移動平均
  const out = {}
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const chips = r.chips ?? {}

    // f1 大盤乖離 MA60%
    let bias60 = null
    if (i >= 59) {
      const seg = rows.slice(i - 59, i + 1).map(x => x.close)
      if (seg.every(v => typeof v === 'number')) {
        const ma = seg.reduce((a, b) => a + b, 0) / seg.length
        if (ma) bias60 = (r.close / ma - 1) * 100
      }
    }

    // 選擇權金額規模（外資 + 自營 八類交易金額絕對值總和）
    const tr = chips.opt_tr ?? {}
    const amts = ['foreign', 'dealer'].flatMap(p =>
      ['bc_amt', 'sc_amt', 'bp_amt', 'sp_amt'].map(k => tr[p]?.[k]))
    const scale = amts.every(v => typeof v === 'number')
      ? amts.reduce((a, b) => a + Math.abs(b), 0) : null

    // f2 自營 CallOI 金額佔比% ／ f3 自營 SC 金額佔比%
    const dCallOIAmt = chips.opt_oi?.dealer?.call_oi_net_amt
    const dSCAmt = tr.dealer?.sc_amt
    const dCallOI = (scale && typeof dCallOIAmt === 'number') ? dCallOIAmt / scale * 100 : null
    const dSC = (scale && typeof dSCAmt === 'number') ? dSCAmt / scale * 100 : null

    // f4 外資買方 C/P 比（口數比）
    const fbc = tr.foreign?.bc, fbp = tr.foreign?.bp
    const fCP = (typeof fbc === 'number' && fbp) ? fbc / fbp : null

    // f6 成交量 5 日變動%
    let vol5 = null
    if (i >= 5) {
      const a = r.volume, b = rows[i - 5].volume
      if (typeof a === 'number' && b) vol5 = (a / b - 1) * 100
    }

    out[r.date] = {
      bias60: round(bias60), dCallOI: round(dCallOI), dSC: round(dSC),
      fCP: round(fCP), tFut5: null, vol5: round(vol5),
    }
  }
  return out
}

const round = (v, n = 4) =>
  (typeof v === 'number' && Number.isFinite(v)) ? Number(v.toFixed(n)) : null

// ── 統計 ────────────────────────────────────────────
function zscore(series, i, w) {
  const seg = series.slice(Math.max(0, i - w + 1), i + 1).filter(v => v != null)
  if (seg.length < w * 0.6 || series[i] == null) return null
  const mu = seg.reduce((a, b) => a + b, 0) / seg.length
  const sd = Math.sqrt(seg.reduce((a, b) => a + (b - mu) ** 2, 0) / seg.length)
  return sd ? (series[i] - mu) / sd : null
}

/** 回傳 { dates, heat[], warn[] } —— dates 為 oldest first */
function compute(history) {
  const dates = Object.keys(history).sort()
  const cols = Object.fromEntries(KEYS.map(([k]) => [k, dates.map(d => history[d]?.[k] ?? null)]))
  const zs = Object.fromEntries(
    KEYS.map(([k]) => [k, dates.map((_, i) => zscore(cols[k], i, Z_WINDOW))]))

  const score = dates.map((_, i) => {
    const vals = KEYS.map(([k, s]) => zs[k][i] == null ? null : s * zs[k][i]).filter(v => v != null)
    return vals.length >= 5 ? vals.reduce((a, b) => a + b, 0) / vals.length : null  // AC-HT-C2
  })
  const warn = dates.map((_, i) =>
    KEYS.reduce((n, [k, s]) => n + (zs[k][i] != null && s * zs[k][i] >= 1.0 ? 1 : 0), 0))

  const heat = dates.map((_, i) => {
    if (score[i] == null) return null
    const seg = score.slice(Math.max(0, i - P_WINDOW + 1), i + 1).filter(v => v != null)
    if (seg.length < P_WINDOW * 0.8) return null
    return Math.round(seg.filter(v => v <= score[i]).length / seg.length * 100)
  })
  return { dates, heat, warn, zs }
}

/** AC-HT-D5：自 60 日高點回落 ≥8%，且熱度曾 ≤P30、現已回升至 ≥P50 */
function entrySignal(dates, heat, closeByDate) {
  return dates.map((d, i) => {
    if (heat[i] == null || heat[i] < 50) return false
    const recent = heat.slice(Math.max(0, i - 15), i)
    if (!recent.some(h => h != null && h <= 30)) return false
    const win = dates.slice(Math.max(0, i - 59), i + 1)
      .map(x => closeByDate[x]).filter(v => typeof v === 'number')
    if (!win.length || !closeByDate[d]) return false
    return (closeByDate[d] - Math.max(...win)) / Math.max(...win) * 100 <= -8
  })
}

// ── 主流程 ──────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')
  }
  const snapshot = JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
  const indexHistory = snapshot.indexHistory ?? []
  if (!indexHistory.length) {
    console.warn('[calc-heat] indexHistory 為空，跳過')
    return
  }

  const history = await downloadHistory()
  if (!history) {
    console.warn(`[calc-heat] Supabase 尚無 ${HISTORY_KEY}——請先在本機執行 ` +
                 'scripts/backfill-heat-history.py 完成一次性回補，本次跳過')
    return
  }

  // AC-HT-B4：只追加快照裡有、歷史檔還沒有的日期，不重算歷史
  const fresh = extractFeatures(indexHistory)
  let added = 0
  for (const [d, f] of Object.entries(fresh)) {
    if (history[d]) continue
    history[d] = f
    added++
  }
  console.log(`[calc-heat] 歷史 ${Object.keys(history).length} 天（本次新增 ${added} 天）`)

  const { dates, heat, warn, zs } = compute(history)
  const closeByDate = Object.fromEntries(indexHistory.map(r => [r.date, r.close]))
  const entry = entrySignal(dates, heat, closeByDate)

  const idx = Object.fromEntries(dates.map((d, i) => [d, i]))
  let written = 0
  for (const r of indexHistory) {          // AC-HT-C3：三個數字寫進 indexHistory
    const i = idx[r.date]
    if (i == null) continue
    r.heat = heat[i]
    r.warn = warn[i]
    r.entry = entry[i]
    written++
  }

  const last = dates.length - 1
  const on = KEYS.filter(([k, s]) => zs[k][last] != null && s * zs[k][last] >= 1.0).map(([k]) => k)
  console.log(`[calc-heat] ${dates[last]}　熱度 ${heat[last]}/100　警示 ${warn[last]}/6` +
              `　進場 ${entry[last]}　成立項目：${on.join(', ') || '無'}`)
  console.log(`[calc-heat] 已寫入 ${written} 筆 indexHistory`)

  writeFileSync(DATA_FILE, JSON.stringify(snapshot))
  if (added > 0) await uploadHistory(history)
  console.log('[calc-heat] 完成')
}

main().catch(e => { console.error(e); process.exit(1) })
