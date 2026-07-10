import { NextResponse } from 'next/server'
import { countPendingItems } from '@/lib/reviewAuth'

// 不需要密碼——只回傳數量，給首頁齒輪圖示判斷要不要發亮用
export async function GET() {
  const count = await countPendingItems()
  return NextResponse.json({ count })
}
