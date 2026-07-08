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
async function uploadToSupabase(path, body, contentType = 'application/json') {
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
      'cache-control': 'no-cache',
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
