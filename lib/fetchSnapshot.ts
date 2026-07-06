import type { SnapshotData } from './types'

/** 從 Supabase Storage 下載最新快照（公開讀取，不需 key） */
export async function fetchSnapshot(): Promise<SnapshotData> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL 未設定')
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.status}`)
  return res.json()
}
