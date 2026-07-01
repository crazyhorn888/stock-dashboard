/**
 * 將 data/latest.json 上傳到 Firebase
 *   - Firebase Storage：snapshot JSON（前端直接下載）
 *   - Firestore：market_signals 文件（快速讀取訊號狀態）
 *
 * 環境變數：FIREBASE_SERVICE_ACCOUNT_JSON（GitHub Secrets 注入）
 * 執行：node scripts/write-firebase.mjs
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 初始化 Firebase Admin ───────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '{}')
initializeApp({
  credential: cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
})

const db = getFirestore()
const bucket = getStorage().bucket()

// ── Main ─────────────────────────────────────────────
async function main() {
  const snapshotPath = join(__dirname, '..', 'data', 'latest.json')
  const raw = readFileSync(snapshotPath, 'utf-8')
  const snapshot = JSON.parse(raw)

  if (!snapshot.marketSignals) {
    throw new Error('marketSignals 為 null，請先執行 calc-signals.mjs')
  }

  // 1. 上傳 snapshot JSON 到 Firebase Storage
  const storageFile = bucket.file('snapshots/latest.json')
  await storageFile.save(raw, {
    metadata: {
      contentType: 'application/json',
      cacheControl: 'public, max-age=3600',
    },
  })
  // 設定公開讀取
  await storageFile.makePublic()
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/snapshots/latest.json`
  console.log(`[write-firebase] Storage 上傳完成：${publicUrl}`)

  // 2. 寫入 Firestore market_signals 文件
  const signalsRef = db.collection('market_data').doc('signals')
  await signalsRef.set(snapshot.marketSignals)
  console.log('[write-firebase] Firestore market_signals 更新完成')

  // 3. 寫入 Firestore snapshot 元資料（讓前端知道最新更新時間）
  const metaRef = db.collection('market_data').doc('meta')
  await metaRef.set({
    updatedAt: snapshot.updatedAt,
    stockCount: snapshot.stocks.length,
    snapshotUrl: publicUrl,
  })
  console.log('[write-firebase] Firestore meta 更新完成')

  console.log(`[write-firebase] 完成，${snapshot.stocks.length} 檔`)
}

main().catch(e => { console.error(e); process.exit(1) })
