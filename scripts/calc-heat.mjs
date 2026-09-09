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
 * 第 7 個欄位 fSpot（外資現貨買賣超佔成交量%）**不計入熱度分數**——那是校準過的 6 項，
 * 動了驗收數字就不成立。它只供 AC-HT-E1 的外資反轉條件使用。
 *
 * 執行：node scripts/calc-heat.mjs
 * 需要：SUPABASE_URL、SUPABASE_SERVICE_KEY
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

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
    // a > 0 而不是 typeof a === 'number'：盤中班次的 volume 是 0，
    // 算出來會是 −100% 這種假值，反而通過完整性檢查（AC-HT-B5）
    let vol5 = null
    if (i >= 5) {
      const a = r.volume, b = rows[i - 5].volume
      if (a > 0 && b > 0) vol5 = (a / b - 1) * 100
    }

    // f5 投信台指期淨 OI 的 5 日變動，佔投信總部位%
    // AC-HT-B7：先前這裡固定寫 null，等於當日只用 5 項、歷史卻是 6 項，
    // 兩種分數混在同一個百分位視窗裡比。快照本來就有 fut_oi.tx.trust
    // （[多, 空, 淨]），照回補腳本的算法補上，六項才是同一套。
    let tFut5 = null
    if (i >= 5) {
      const c = chips.fut_oi?.tx?.trust
      const p5 = rows[i - 5].chips?.fut_oi?.tx?.trust
      if (Array.isArray(c) && Array.isArray(p5) && c.length === 3 && p5.length === 3) {
        const scale5 = c[0] + c[1]
        if (scale5 > 0) tFut5 = (c[2] - p5[2]) / scale5 * 100
      }
    }

    // fSpot 外資現貨買賣超佔成交金額%（AC-HT-E1 用，不計入熱度分數）
    // AC-HT-B9 單位：chips.foreign_spot 是「億元」，但 indexHistory.volume 是
    // 「十萬元」（fetch-daily.mjs 把 TWSE 的元除以 1e5）。直接相除會小 1000 倍，
    // 跟 heat-history 裡「億 ÷ 億」的舊資料混在同一個 Z 視窗會整條炸掉。
    const fs = chips.foreign_spot
    const volYi = r.volume > 0 ? r.volume / 1000 : null     // 十萬元 → 億元
    const fSpot = (typeof fs === 'number' && volYi) ? fs / volYi * 100 : null

    out[r.date] = {
      bias60: round(bias60), dCallOI: round(dCallOI), dSC: round(dSC),
      fCP: round(fCP), tFut5: round(tFut5), vol5: round(vol5),
      fSpot: round(fSpot),
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

/** 回傳 { dates, heat[], warn[], rev[] } —— dates 為 oldest first */
function compute(history) {
  const dates = Object.keys(history).sort()
  const ALL = [...KEYS.map(([k]) => k), 'fSpot']
  const cols = Object.fromEntries(ALL.map(k => [k, dates.map(d => history[d]?.[k] ?? null)]))
  const zs = Object.fromEntries(
    ALL.map(k => [k, dates.map((_, i) => zscore(cols[k], i, Z_WINDOW))]))

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
  // AC-HT-E1 外資倒貨：當日外資現貨買賣超佔成交金額 Z ≤ −1.0。
  //
  // AC-HT-B12（2026-09-08）：原本還要求「過去 10 日曾出現外資買方 C/P 比 Z ≥ 1.0」
  // 才算數。那條腿是錯的——外資押多買權本身是偏多訊號（215 天、20 日 +2.65%、
  // 跌 5% 僅 13%，低於 20% 的基準），把它當成空方警示的必要條件會互相抵銷：
  // 實測「只要大賣現貨」43%，加上押多這條腿反而降到 37%。
  // 它也不是底部訊號（熱度中位 87，58% 落在極熱區、弱勢區 493 天只出現 3 次），
  // 所以兩邊都不留。拿掉後 65 天 → 103 天、38% → 44%，跌 8% 由 12% 升到 22%，
  // 三段互不重疊的期間全部勝過同期基準（55/22、44/19、34/14），p < 0.0001。
  const rev = dates.map((_, i) => zs.fSpot[i] != null && zs.fSpot[i] <= -1.0)

  return { dates, heat, warn, rev, zs }
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

  // AC-HT-B4：只追加快照裡有、歷史檔還沒有的日期，不重算歷史。
  // 例外（AC-HT-B5）：pipeline 一天會跑多班，盤中那幾班籌碼還沒進來，
  // 特徵會是一整排 null。這種「殘缺列」不可以寫進歷史——寫進去之後
  // 「只追加」規則會讓它永遠卡住，該日熱度變 null，整張卡片消失。
  // 所以：六項要全部到齊才寫（不混用不同天的資料）；已經寫進去的殘缺列，
  // 等收盤後有完整資料時覆蓋掉。當日還沒齊就是不寫，卡片會顯示「待更新」。
  const complete = f => KEYS.every(([k]) => f[k] != null)
  const fresh = extractFeatures(indexHistory)
  let added = 0, repaired = 0, skipped = 0
  for (const [d, f] of Object.entries(fresh)) {
    if (!complete(f)) { if (!history[d]) skipped++; continue }
    if (!history[d]) { history[d] = f; added++; continue }
    if (!complete(history[d])) { history[d] = f; repaired++ }
  }
  console.log(`[calc-heat] 歷史 ${Object.keys(history).length} 天`
    + `（新增 ${added} 天、修復殘缺 ${repaired} 天、略過未完成 ${skipped} 天）`)

  const { dates, heat, warn, rev, zs } = compute(history)
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
    r.rev = rev[i]          // AC-HT-E2：警示 = warn>=4 或 rev
    written++
  }

  const last = dates.length - 1
  const on = KEYS.filter(([k, s]) => zs[k][last] != null && s * zs[k][last] >= 1.0).map(([k]) => k)
  console.log(`[calc-heat] ${dates[last]}　熱度 ${heat[last]}/100　警示 ${warn[last]}/6` +
              `　外資反轉 ${rev[last]}　進場 ${entry[last]}　成立項目：${on.join(', ') || '無'}`)
  console.log(`[calc-heat] 已寫入 ${written} 筆 indexHistory`)

  writeFileSync(DATA_FILE, JSON.stringify(snapshot))
  if (added > 0 || repaired > 0) await uploadHistory(history)
  console.log('[calc-heat] 完成')
}

// 只有直接執行才跑 main。被 import 時（heat-drift-report.mjs 要重用 compute /
// extractFeatures / entrySignal 以確保與 production 算出同一組數字）不能有副作用。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e); process.exit(1) })
}

export { extractFeatures, compute, entrySignal, KEYS, Z_WINDOW, P_WINDOW }
