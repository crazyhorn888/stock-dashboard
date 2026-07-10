import { NextRequest, NextResponse } from 'next/server'
import { checkPassword } from '@/lib/reviewAuth'

// 手動觸發 daily-fetch.yml 的 workflow_dispatch（force_run=true，略過 FMTQIK Guard）。
// 2026-07-10 教訓：本機直接跑 fetch-daily.mjs/write-firebase.mjs 寫 production 會被 iCloud
// 干擾弄壞資料，之後任何「立刻讓修復生效」的需求都要走這個 GitHub Actions 管道，不要本機跑。
const REPO = 'crazyhorn888/stock-dashboard'
const WORKFLOW = 'daily-fetch.yml'

export async function POST(req: NextRequest) {
  const password = req.headers.get('x-review-password') ?? ''
  if (!(await checkPassword(password))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_DISPATCH_TOKEN 未設定，請先到 Vercel 環境變數新增' }, { status: 500 })
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { force_run: 'true' } }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `GitHub API 失敗：${res.status} ${text}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
