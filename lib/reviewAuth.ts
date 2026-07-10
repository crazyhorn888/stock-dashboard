// P2-6：/review 頁面密碼機制，比照 gym-tracker（單一通關密碼，明文存，可自助更換）
// 存放位置：Supabase 私有 bucket "review"（非 public，只有 SUPABASE_SERVICE_KEY 讀得到）

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function readPrivate(path: string): Promise<any | null> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/review/${path}`, {
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

async function writePrivate(path: string, data: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/review/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Supabase write 失敗：${res.status} ${await res.text()}`)
}

export async function isPasswordSet(): Promise<boolean> {
  const config = await readPrivate('auth.json')
  return !!config?.password
}

// R2：暴力猜測防護。密碼背後能觸發 force-run（燒 Actions 額度）與 confirm-queue
// （間接 commit 到 public repo），4 碼下限太容易猜，加簡單的失敗計數窗口。
const FAIL_WINDOW_MS = 60 * 60 * 1000  // 1 小時
const FAIL_LIMIT = 20

export async function checkPassword(password: string): Promise<boolean> {
  const fails = (await readPrivate('auth-fails.json')) as { count: number; firstFailAt: number } | null
  const now = Date.now()
  const windowActive = fails && now - fails.firstFailAt < FAIL_WINDOW_MS
  if (windowActive && fails!.count >= FAIL_LIMIT) return false

  if (!password) return false
  const config = await readPrivate('auth.json')
  if (!config?.password) return false

  if (password === config.password) {
    if (fails) await writePrivate('auth-fails.json', { count: 0, firstFailAt: 0 })
    return true
  }

  const next = windowActive
    ? { count: fails!.count + 1, firstFailAt: fails!.firstFailAt }
    : { count: 1, firstFailAt: now }
  await writePrivate('auth-fails.json', next)
  return false
}

export async function setPassword(
  newPassword: string,
  oldPassword?: string,
  setupToken?: string,
): Promise<{ ok: boolean; error?: string }> {
  const config = await readPrivate('auth.json')
  if (config?.password) {
    if (oldPassword !== config.password) return { ok: false, error: '舊密碼錯誤' }
  } else {
    // R2：首次設定密碼前沒有任何認證，公開網站上誰先到誰設——要求帶伺服器端設定的
    // setupToken 才能首設，防止陌生人搶先設定。刻意 fail-closed：REVIEW_SETUP_TOKEN
    // 沒設定時直接拒絕（不是靜默放行），逼自己記得去 Vercel 設定
    const required = process.env.REVIEW_SETUP_TOKEN
    if (!required) {
      return { ok: false, error: '尚未設定 REVIEW_SETUP_TOKEN，請先到 Vercel 環境變數設定' }
    }
    if (setupToken !== required) {
      return { ok: false, error: 'setup token 錯誤' }
    }
  }
  await writePrivate('auth.json', { password: newPassword })
  return { ok: true }
}

export async function readPendingBatches(): Promise<any> {
  return (await readPrivate('pending.json')) ?? { batches: [] }
}

// 給首頁齒輪發亮用：只回傳數量，不回傳內容，不需要密碼也能查（低敏感度，只是「有沒有
// 待辦事項」的提示，不算洩漏隱私）
export async function countPendingItems(): Promise<number> {
  const data = await readPendingBatches()
  const batches = data?.batches ?? []
  return batches.reduce((sum: number, b: any) => sum + (b.items?.length ?? 0), 0)
}
