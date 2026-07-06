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

// ── 上傳 snapshot 到 Supabase Storage ────────────────
async function uploadToSupabase(raw) {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定')

  const url = `${SUPABASE_URL}/storage/v1/object/snapshots/latest.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',  // CDN 不快取，每次請求都取最新版
    },
    body: raw,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase 上傳失敗：${res.status} ${err}`)
  }
  return `${SUPABASE_URL}/storage/v1/object/public/snapshots/latest.json`
}

// ── Main ─────────────────────────────────────────────
async function main() {
  const snapshotPath = join(__dirname, '..', 'data', 'latest.json')
  const raw = readFileSync(snapshotPath, 'utf-8')
  const snapshot = JSON.parse(raw)

  if (!snapshot.marketSignals) {
    throw new Error('marketSignals 為 null，請先執行 calc-signals.mjs')
  }

  // 1. 上傳 snapshot JSON 到 Supabase Storage
  const publicUrl = await uploadToSupabase(raw)
  console.log(`[write] Supabase Storage 上傳完成：${publicUrl}`)

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
