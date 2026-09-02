/**
 * 資料鮮度 poller — 被動偵測各資料集「實際落地到哪一天」，供「資料更新監控表」使用。
 *
 * 設計原則（見 docs/資料鮮度監控.md）：
 * - 只讀最終落地的 Supabase snapshots（meta.json 為主，208 bytes；不解析 1.1MB market.json）。
 *   資料真的進 DB 才算 ✅ —— 不管來源是 TWSE / TPEX / FinMind / n8n，一律以落地為準。
 * - 純計算 + stdout 報表；若設 FRESHNESS_SHEET_WEBHOOK，POST 一列 JSON 給 n8n（由 n8n Google Sheets 節點 upsert 進表）。
 * - 單一維護點：未來新增資料集，只在 DATASETS 加一欄。
 *
 * 用法：
 *   node scripts/freshness-log.mjs                    # 只印報表（可立即測）
 *   FRESHNESS_SHEET_WEBHOOK=https://... node scripts/freshness-log.mjs   # 併送 n8n
 *   SNAPSHOT_BASE=https://xxx.supabase.co/storage/v1/object/public/snapshots node scripts/freshness-log.mjs
 */

const SNAPSHOT_BASE = process.env.SNAPSHOT_BASE
  ?? (process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL
        ? process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL.replace(/\/latest\.json$/, '')
        : (process.env.SUPABASE_URL
            ? `${process.env.SUPABASE_URL}/storage/v1/object/public/snapshots`
            : 'https://bliybylxjwemgzjvazyc.supabase.co/storage/v1/object/public/snapshots'))

const WEBHOOK = process.env.FRESHNESS_SHEET_WEBHOOK ?? ''

// 監控欄位 ← docs/抓取檔案時序.md 的資料集，映射到 meta.json / market.json 的日期戳。
// source: 'meta' 讀 meta.json（輕量）；'market' 需 market.json（延伸欄，較大，選用）。
const DATASETS = [
  { col: '大盤K線',        field: 'indexDate',  source: 'meta',   note: 'TWSE FMTQIK，約 15:30' },
  { col: '三大法人/期貨/VIX', field: 'chipsDate',  source: 'meta',   note: 'n8n Phase 1，約 16:00–17:00' },
  { col: '融資餘額',        field: 'marginDate', source: 'meta',   note: 'TWSE MI_MARGN，約 17:00–22:00' },
  { col: '個股(價/外資/PE)', field: 'stocksDate', source: 'meta',   note: 'TWSE STOCK_DAY_ALL + TPEX，偶深夜' },
  { col: '板塊T86',         field: 'sectorDate', source: 'meta',   note: 'TWSE T86，18:00 起輪詢' },
  { col: '市場訊號',        field: 'signalsDate', source: 'market', note: 'calc-signals.mjs（GitHub Actions）' },
  { col: 'AI每日總結',      field: 'briefDate',  source: 'market', note: 'dailyBrief（可能延後產生）' },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

function taipei(d = new Date()) {
  // 回傳台北時間的 { dateISO: 'YYYY-MM-DD', hhmm: 'HH:MM' }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {})
  return { dateISO: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` }
}

async function getJSON(name) {
  const res = await fetch(`${SNAPSHOT_BASE}/${name}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-cache' })
  if (!res.ok) throw new Error(`${name} 下載失敗：${res.status}`)
  return res.json()
}

async function main() {
  const now = taipei()

  // 1) 讀 meta.json（一定要）＋ holiday-status.json（判斷今天是否交易日）
  const meta = await getJSON('meta.json')
  let holiday = { isHoliday: false, name: null }
  try { holiday = await getJSON('holiday-status.json') } catch { /* 缺就當交易日 */ }

  // 2) 需要延伸欄才抓 market.json（signalsDate / briefDate）
  const needMarket = DATASETS.some(d => d.source === 'market')
  let market = null
  if (needMarket) {
    try {
      market = await getJSON('market.json')
    } catch (e) { console.warn(`[freshness] market.json 載入失敗，延伸欄留白：${e.message}`) }
  }

  const valueOf = (d) => {
    if (d.source === 'meta') return meta[d.field] ?? null
    if (d.field === 'signalsDate') return market?.marketSignals?.todayDate ?? null
    if (d.field === 'briefDate')   return market?.dailyBrief?.date ?? null
    return null
  }

  // 3) 目標日 = 今天若為交易日則今天；否則以各資料集最新日為準（假日/剛開盤前不誤報）
  const dsDates = DATASETS.map(valueOf).filter(Boolean).sort()
  const frontier = dsDates.length ? dsDates[dsDates.length - 1] : now.dateISO
  const targetDate = holiday.isHoliday ? frontier : now.dateISO

  // 4) 逐資料集判定狀態
  const cells = DATASETS.map(d => {
    const date = valueOf(d)
    let status
    if (date == null)            status = 'N/A'          // 尚無此欄（如延伸欄未接）
    else if (date >= targetDate) status = 'READY'        // 已到目標日 → ✅
    else {
      const behind = daysBetween(date, targetDate)
      status = behind >= 2 ? 'DELAYED' : 'PENDING'       // ⚠️落後≥2天 / ⬜待更新
    }
    return { col: d.col, date, status }
  })

  // 5) stdout 報表
  const mark = s => ({ READY: '✅', PENDING: '⬜待更新', DELAYED: '⚠️落後', 'N/A': '—' }[s] ?? s)
  console.log(`\n📊 資料鮮度  目標交易日=${targetDate}  （台北 ${now.dateISO} ${now.hhmm}${holiday.isHoliday ? `｜今日休市${holiday.name ? '：' + holiday.name : ''}` : ''}）`)
  console.log(`   meta.updatedAt=${meta.updatedAt}  stockCount=${meta.stockCount ?? '?'}  sectorHistoryLen=${meta.sectorHistoryLen ?? '?'}\n`)
  for (const c of cells) {
    console.log(`   ${mark(c.status).padEnd(8)} ${c.col.padEnd(18)} ${c.date ?? '—'}`)
  }
  const allReady = cells.filter(c => c.status !== 'N/A').every(c => c.status === 'READY')
  console.log(`\n   ➜ ${allReady ? '✅ 目標交易日資料已到齊' : '⏳ 尚有資料集未更新（見上）'}\n`)

  // 6) 送 n8n（由 n8n 端 upsert 進 Google Sheet：以 targetDate 為列 key）
  const rowPayload = {
    targetDate,
    checkedAt: `${now.dateISO} ${now.hhmm}`,
    checkedAtISO: new Date().toISOString(),
    isHoliday: holiday.isHoliday,
    updatedAt: meta.updatedAt,
    stockCount: meta.stockCount ?? null,
    cells: Object.fromEntries(cells.map(c => [c.col, { date: c.date, status: c.status }])),
  }
  if (WEBHOOK) {
    try {
      const res = await fetch(WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowPayload),
      })
      console.log(`[freshness] 已送 n8n webhook：http=${res.status}`)
    } catch (e) { console.error(`[freshness] webhook 失敗：${e.message}`) }
  } else {
    console.log('[freshness] 未設 FRESHNESS_SHEET_WEBHOOK，僅輸出報表（未寫入 Sheet）。JSON：')
    console.log(JSON.stringify(rowPayload))
  }
}

function daysBetween(aISO, bISO) {
  const a = new Date(aISO + 'T00:00:00Z'), b = new Date(bISO + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

main().catch(e => { console.error('[freshness] 失敗：', e); process.exit(1) })
