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

// ── 初始化 Firebase Admin（只用 Firestore，不用 Storage）──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '{}')
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// ── 上傳檔案到 Supabase Storage ──────────────────────
async function uploadToSupabase(path, body, contentType = 'application/json', cacheControl = 'no-cache') {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')

  const url = `${SUPABASE_URL}/storage/v1/object/snapshots/${path}`
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
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase 上傳失敗（${path}）：${res.status} ${err}`)
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
  }
  await uploadToSupabase('market.json', JSON.stringify(market))
  console.log('[write] market.json 上傳完成')

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
