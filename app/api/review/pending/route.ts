import { NextRequest, NextResponse } from 'next/server'
import { checkPassword, readPendingBatches } from '@/lib/reviewAuth'

export async function GET(req: NextRequest) {
  const password = req.headers.get('x-review-password') ?? ''
  if (!(await checkPassword(password))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await readPendingBatches())
}
