import { NextRequest, NextResponse } from 'next/server'
import { setPassword } from '@/lib/reviewAuth'

export async function POST(req: NextRequest) {
  const { oldPassword, newPassword } = await req.json()
  if (!newPassword || String(newPassword).length < 4) {
    return NextResponse.json({ ok: false, error: '新密碼至少 4 碼' }, { status: 400 })
  }
  const result = await setPassword(newPassword, oldPassword)
  return NextResponse.json(result, { status: result.ok ? 200 : 401 })
}
