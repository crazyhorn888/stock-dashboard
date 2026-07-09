import { NextRequest, NextResponse } from 'next/server'
import { checkPassword } from '@/lib/reviewAuth'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

interface ConfirmItem {
  code: string
  concepts: string[]  // 該股最終的完整概念清單（取代，不是疊加）
}

// n8n 沒有對外網域可以直接推 webhook 進去（跟 LINE Bot 事件同一個限制，見 project_line_bot_group_manager
// 的 Cloudflare Worker Relay 決策），所以這裡改成寫入 Supabase 的一個小 queue 檔案，
// n8n 用排程輪詢（比照現有 LINE 事件輪詢模式），不是即時 webhook。
export async function POST(req: NextRequest) {
  const password = req.headers.get('x-review-password') ?? ''
  if (!(await checkPassword(password))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { items: ConfirmItem[]; sourceBatchId?: string }
  if (!body.items?.length) {
    return NextResponse.json({ error: 'items 不可為空' }, { status: 400 })
  }

  const queueRes = await fetch(`${SUPABASE_URL}/storage/v1/object/review/confirm-queue.json`, {
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    cache: 'no-store',
  })
  const queue = queueRes.ok ? await queueRes.json() : { jobs: [] }

  queue.jobs = queue.jobs ?? []
  queue.jobs.push({
    id: `${Date.now()}`,
    createdAt: new Date().toISOString(),
    items: body.items,
    sourceBatchId: body.sourceBatchId ?? null,
  })

  const writeRes = await fetch(`${SUPABASE_URL}/storage/v1/object/review/confirm-queue.json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(queue),
  })
  if (!writeRes.ok) {
    return NextResponse.json({ error: 'queue 寫入失敗' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, queued: true })
}
