import type { SnapshotData } from './types'

/** 從 Firebase Storage 下載最新快照 */
export async function fetchSnapshot(): Promise<SnapshotData> {
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  if (!bucket) throw new Error('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET 未設定')

  const url = `https://storage.googleapis.com/${bucket}/snapshots/latest.json`
  const res = await fetch(url, { next: { revalidate: 3600 } }) // 1h cache
  if (!res.ok) throw new Error(`Storage fetch failed: ${res.status}`)
  return res.json()
}
