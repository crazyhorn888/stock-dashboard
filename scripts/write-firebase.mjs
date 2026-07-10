/**
 * 將 data/latest.json 上傳：
 *   - Supabase Storage：snapshot JSON（前端直接下載，公開讀取）
 *   - Firestore：market_signals + meta 文件（快速讀取訊號狀態）
 *
 * 環境變數：
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY（GitHub Secrets 注入）
 *   FIREBASE_SERVICE_ACCOUNT_JSON（GitHub Secrets 注入）
 * 執行：node scripts/write-firebase.mjs
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))

// P2-4：盤後總結事實統計（不含 AI 文字，summary 由 n8n 讀 daily-brief-facts.json 呼叫 OpenAI 後寫回）
function computeDailyBriefFacts(snapshot) {
  const sectors = snapshot.sectors ?? []
  const sectorHistory = snapshot.sectorHistory ?? []
  const indexHistory = snapshot.indexHistory ?? []
  const stockHistory = snapshot.stockHistory ?? []
  const r2 = v => Math.round(v * 100) / 100

  const quadrantOf = (x, y) => (x >= 0 && y >= 0) ? 'TR' : (x < 0 && y >= 0) ? 'TL' : (x < 0 && y < 0) ? 'BL' : 'BR'
  const quadrantCounts = { TR: 0, TL: 0, BL: 0, BR: 0 }
  for (const s of sectors) quadrantCounts[quadrantOf(s.x, s.y)]++

  const [today, prev] = indexHistory
  const marketChangePct = today && prev && prev.close > 0 ? r2(((today.close - prev.close) / prev.close) * 100) : null

  // 逆勢買超板塊：大盤跌且板塊當日淨買超 > 0（與 QuadrantSummary.tsx 前端邏輯一致）
  const todayRows = sectorHistory[0]?.rows ?? []
  const contrarian = (marketChangePct != null && marketChangePct < 0)
    ? todayRows.filter(r => r.net > 0).map(r => r.name)
    : []

  // 昨日 top3 買超板塊，今日平均漲跌%
  const yesterdayRows = sectorHistory[1]?.rows ?? []
  const stockByCode = Object.fromEntries((snapshot.stocks ?? []).map(s => [s.code, s]))
  const top3Performance = [...yesterdayRows]
    .sort((a, b) => b.net - a.net)
    .slice(0, 3)
    .map(r => {
      const changes = (r.stocks ?? [])
        .map(s => stockByCode[s.code]?.changePercent)
        .filter(v => typeof v === 'number')
      const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null
      return { sector: r.name, avgChangePct: avg != null ? r2(avg) : null }
    })

  // 個股異常：|淨買超| > 30 億（今日 T86 扁平清單，來源與 P2-5 stockHistory 共用）
  const anomalies = (stockHistory[0]?.stocks ?? [])
    .filter(s => Math.abs(s.net) > 30)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 10)
    .map(s => ({ code: s.code, name: s.name, net: s.net }))

  // R12：brief 的內容（四象限/逆勢買超/異常個股）都是算自 sectorHistory/stockHistory（T86 時序），
  // 但 date 原本優先用 stocksDate（STOCK_DAY_ALL，常常較晚才前進）——兩者不同步時，卡片/Email
  // 標的日期會跟內容對不上。改成優先反映內容真正的來源日期。
  return {
    date: sectorHistory[0]?.date ?? snapshot.stocksDate ?? indexHistory[0]?.date ?? null,
    quadrantCounts,
    marketChangePct,
    contrarian,
    top3Performance,
    anomalies,
  }
}

// ── 初始化 Firebase Admin（只用 Firestore，不用 Storage）──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '{}')
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// ── 上傳檔案到 Supabase Storage ──────────────────────
// 2026-07-09：加重試——Supabase/Cloudflare 偶爾會回暫時性 400/5xx（跟程式碼、payload 內容無關，
// 手動重送同樣的 payload 就成功過），重試 3 次可以吸收掉大部分這種雜訊，減少 GitHub Actions 失敗信
async function uploadToSupabase(path, body, contentType = 'application/json', cacheControl = 'no-cache') {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')

  const url = `${SUPABASE_URL}/storage/v1/object/snapshots/${path}`
  const maxAttempts = 3
  let lastErr = ''
  let lastStatus = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
        'cache-control': cacheControl,
      },
      body,
    })
    if (res.ok) {
      if (attempt > 1) console.log(`[write] ${path} 上傳在第 ${attempt} 次重試後成功`)
      break
    }
    lastStatus = res.status
    lastErr = await res.text()
    if (attempt < maxAttempts) {
      console.warn(`[write] ${path} 上傳失敗（第 ${attempt} 次，${lastStatus}），${attempt * 3} 秒後重試...`)
      await new Promise(r => setTimeout(r, attempt * 3000))
    } else {
      throw new Error(`Supabase 上傳失敗（${path}，已重試 ${maxAttempts} 次）：${lastStatus} ${lastErr}`)
    }
  }
  return `${SUPABASE_URL}/storage/v1/object/public/snapshots/${path}`
}

// ── Main ─────────────────────────────────────────────
async function main() {
  const snapshotPath = join(__dirname, '..', 'data', 'latest.json')
  const raw = readFileSync(snapshotPath, 'utf-8')
  const snapshot = JSON.parse(raw)

  if (!snapshot.marketSignals) {
    throw new Error('marketSignals 為 null，請先執行 calc-signals.mjs')
  }

  // 1a. 從 stocks 分離 OHLC + volume → 產生 ohlc.json（前端 lazy fetch）
  const ohclBars = {}
  const stocksStripped = snapshot.stocks.map(s => {
    const { opens, highs, lows, volumes, ...rest } = s
    const hasOHLC = opens?.length > 0
    const hasVol  = volumes?.length > 0
    if (hasOHLC || hasVol) {
      ohclBars[s.code] = {
        ...(hasOHLC ? { o: opens, h: highs, l: lows } : {}),
        ...(hasVol  ? { v: volumes } : {}),
      }
    }
    return rest
  })
  const ohlcPayload = JSON.stringify({ updatedAt: snapshot.updatedAt, bars: ohclBars })
  const ohlcUrl = await uploadToSupabase('ohlc.json', ohlcPayload)
  console.log(`[write] ohlc.json 上傳完成（${Object.keys(ohclBars).length} 支）：${ohlcUrl}`)

  // 1b. 上傳不含 OHLC 的 latest.json（保持前端頁面 size 不變）
  const snapshotStripped = { ...snapshot, stocks: stocksStripped }
  const publicUrl = await uploadToSupabase('latest.json', JSON.stringify(snapshotStripped))
  console.log(`[write] Supabase Storage 上傳完成：${publicUrl}`)

  // 1c. 上傳 meta.json（~1KB）：Guard 檢查與前端鮮度標示用，避免為了看日期戳下載整包 latest.json
  const latestWithMargin = snapshot.indexHistory?.find(r => r.chips?.margin_amount != null)
  const latestWithChips  = snapshot.indexHistory?.find(r => r.chips?.inst_total != null)
  const meta = {
    updatedAt:        snapshot.updatedAt,
    stocksDate:       snapshot.stocksDate ?? null,
    indexDate:        snapshot.indexHistory?.[0]?.date ?? null,
    marginDate:       latestWithMargin?.date ?? null,
    chipsDate:        latestWithChips?.date ?? null,
    sectorDate:       snapshot.sectorHistory?.[0]?.date ?? null,
    sectorHistoryLen: snapshot.sectorHistory?.length ?? 0,
    stockCount:       snapshot.stocks.length,
  }
  await uploadToSupabase('meta.json', JSON.stringify(meta))
  console.log('[write] meta.json 上傳完成')

  // ── P1-1 檔案分層（寫入側）──────────────────────────
  // 雙寫過渡期：latest.json / ohlc.json 照舊產出，前端切換完成後才淘汰 latest.json。
  // 讀取側（fetchSnapshot 組合 market + stocks-lite + history）由後續任務交付。

  // 1d. market.json（~300KB）：首屏所需的全部資料。
  //     sectorHistory 只有 day 0 保留 rows[].stocks（歷史回放的 x/y/size 只用 net/buySell；
  //     歷史 frame 的個股面板本來就顯示 0，見 calcSectors 註解）
  const sectorHistoryLite = (snapshot.sectorHistory ?? []).map((d, i) =>
    i === 0 ? d : { ...d, rows: d.rows.map(({ stocks: _s, ...rest }) => rest) }
  )
  // P2-1：conceptHistory 同樣只在 day 0 保留個股明細（泡泡圖回放只用 net/buySell）
  const conceptHistoryLite = (snapshot.conceptHistory ?? []).map((d, i) =>
    i === 0 ? d : { ...d, rows: d.rows.map(({ stocks: _s, ...rest }) => rest) }
  )
  // P2-3：全球指數由獨立的 fetch-global.mjs（06:07 輕量班次）寫入，這裡只讀最新結果併進 market.json，
  // 不在本 pipeline 內呼叫 Yahoo（避免每個 cron 班次都重複打）
  let globalIndices = {}
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/snapshots/global-indices.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.ok) globalIndices = (await res.json()).indices ?? {}
  } catch (e) {
    console.warn('[write] global-indices.json 讀取失敗，globalIndices 留空：', e.message)
  }

  // P2-4：facts 每次 pipeline run 都重算；summary 由 n8n 讀 daily-brief-facts.json 呼叫 OpenAI 後寫回，
  // 這裡讀舊值只為了「同一天內」保留 n8n 已經產生的 summary，不被之後的 pipeline run 覆蓋成 null
  const dailyBriefFacts = computeDailyBriefFacts(snapshot)
  let existingSummary = null
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/snapshots/daily-brief-facts.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (res.ok) {
      const existing = await res.json()
      if (existing.date === dailyBriefFacts.date) existingSummary = existing.summary ?? null
    }
  } catch (e) {
    console.warn('[write] daily-brief-facts.json 讀取失敗（summary 沿用 null）：', e.message)
  }
  const dailyBrief = { ...dailyBriefFacts, summary: existingSummary }
  await uploadToSupabase('daily-brief-facts.json', JSON.stringify(dailyBrief))
  console.log('[write] daily-brief-facts.json 上傳完成')

  const market = {
    updatedAt:     snapshot.updatedAt,
    stocksDate:    snapshot.stocksDate ?? null,
    // P1-6 資料鮮度：各資料塊日期戳（與 meta.json 同源）
    indexDate:     meta.indexDate,
    marginDate:    meta.marginDate,
    chipsDate:     meta.chipsDate,
    sectorDate:    meta.sectorDate,
    indexHistory:  snapshot.indexHistory ?? [],
    marketSignals: snapshot.marketSignals,
    sectors:       snapshot.sectors ?? [],
    sectorHistory: sectorHistoryLite,
    concepts:       snapshot.concepts ?? [],
    conceptHistory: conceptHistoryLite,
    globalIndices,
    dailyBrief,
  }
  await uploadToSupabase('market.json', JSON.stringify(market))
  console.log('[write] market.json 上傳完成')

  // P2-5：stock-history.json —— 獨立 lazy-load 檔，只在使用者開「自選股模式」才會被前端下載，
  // 不併入 market.json（個股層級 25 天歷史資料量較大，不該影響首屏載入）
  const stockHistoryPayload = JSON.stringify({
    updatedAt: snapshot.updatedAt,
    stockHistory: snapshot.stockHistory ?? [],
  })
  await uploadToSupabase('stock-history.json', stockHistoryPayload)
  console.log(`[write] stock-history.json 上傳完成（${(snapshot.stockHistory ?? []).length} 天）`)

  // 1e. stocks-lite.json（~300KB）：個股清單欄位，不含任何歷史陣列
  const stocksLite = snapshot.stocks.map(({ closes, dates, opens, highs, lows, volumes, ...rest }) => rest)
  await uploadToSupabase('stocks-lite.json', JSON.stringify({ updatedAt: snapshot.updatedAt, stocks: stocksLite }))
  console.log(`[write] stocks-lite.json 上傳完成（${stocksLite.length} 支）`)

  // 1f. history.json（~3MB，lazy load 用）：closes 對齊「共用交易日曆」（= indexHistory 的日期），
  //     缺日補 null。前端還原：close != null 的位置即該股實際交易日。
  //     注意：刻意不併入 ohlc.json —— ohlc 的 o/h/l/v 對齊各股自己的 dates，混兩種對齊會出錯
  const calendar = (snapshot.indexHistory ?? []).map(r => r.date)   // newest first
  const calIdx = Object.fromEntries(calendar.map((d, i) => [d, i]))
  const historyStocks = {}
  for (const s of snapshot.stocks) {
    if (!s.closes?.length || !s.dates?.length) continue
    const aligned = new Array(calendar.length).fill(null)
    for (let i = 0; i < s.dates.length; i++) {
      const idx = calIdx[s.dates[i]]
      if (idx !== undefined) aligned[idx] = s.closes[i]
    }
    historyStocks[s.code] = aligned
  }
  await uploadToSupabase('history.json', JSON.stringify({
    updatedAt: snapshot.updatedAt, dates: calendar, stocks: historyStocks,
  }))
  console.log(`[write] history.json 上傳完成（日曆 ${calendar.length} 天）`)

  // 1g. daily/{date}.json（~200KB）：當日 Delta 歸檔（審計/回滾/回看前一日的資料基礎）。
  //     當日盤後多次 run 會收斂覆寫同一檔；收盤定案後不再變。
  //     cache 先設 5 分鐘（收斂期間不能 immutable），改 immutable 留給讀取側任務一併處理
  const deltaDate = snapshot.indexHistory?.[0]?.date
  if (deltaDate) {
    const t86Entry = (snapshot.sectorHistory ?? []).find(d => d.date === deltaDate) ?? null
    const delta = {
      date:     deltaDate,
      indexBar: snapshot.indexHistory[0],
      t86:      t86Entry,
      // prices 只在股價確定是這一天時寫入（STOCK_DAY_ALL 深夜更新的日子，早班 run 先缺 prices）
      prices: snapshot.stocksDate === deltaDate
        ? snapshot.stocks.map(s => ({
            code: s.code, name: s.name, close: s.close, changePercent: s.changePercent,
            open: s.opens?.[0] ?? null, high: s.highs?.[0] ?? null, low: s.lows?.[0] ?? null,
            volume: s.volumes?.[0] ?? null, foreignNetBuy: s.foreignNetBuy ?? null,
          }))
        : null,
    }
    await uploadToSupabase(`daily/${deltaDate.replace(/-/g, '')}.json`, JSON.stringify(delta), 'application/json', 'public, max-age=300')
    console.log(`[write] daily/${deltaDate.replace(/-/g, '')}.json 上傳完成（prices: ${delta.prices ? '含' : '暫缺'}）`)
  }

  // 2. 寫入 Firestore market_signals
  const signalsRef = db.collection('market_data').doc('signals')
  await signalsRef.set(snapshot.marketSignals)
  console.log('[write] Firestore market_signals 更新完成')

  // 3. 寫入 Firestore meta
  const metaRef = db.collection('market_data').doc('meta')
  await metaRef.set({
    updatedAt: snapshot.updatedAt,
    stockCount: snapshot.stocks.length,
    snapshotUrl: publicUrl,
  })
  console.log('[write] Firestore meta 更新完成')

  console.log(`[write] 完成，${snapshot.stocks.length} 檔`)
}

main().catch(e => { console.error(e); process.exit(1) })
