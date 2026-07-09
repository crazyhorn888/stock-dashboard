import { NextRequest, NextResponse } from 'next/server'
import { checkPassword, isPasswordSet } from '@/lib/reviewAuth'

export async function GET() {
  return NextResponse.json({ passwordSet: await isPasswordSet() })
}

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  const ok = await checkPassword(password)
  return NextResponse.json({ ok })
}
