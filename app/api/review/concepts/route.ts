import { NextRequest, NextResponse } from 'next/server'
import { checkPassword } from '@/lib/reviewAuth'

// 讀 GitHub raw 內容（不是 Next.js bundle 裡的靜態 import），確保 n8n commit 後
// 不用等 Vercel 重新部署，/review 頁面馬上看得到最新分類
const RAW_URL = 'https://raw.githubusercontent.com/crazyhorn888/stock-dashboard/main/data/concept-sectors.json'

export async function GET(req: NextRequest) {
  const password = req.headers.get('x-review-password') ?? ''
  if (!(await checkPassword(password))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const res = await fetch(RAW_URL, { cache: 'no-store' })
  if (!res.ok) return NextResponse.json({ error: 'GitHub 讀取失敗' }, { status: 502 })
  return NextResponse.json(await res.json())
}
