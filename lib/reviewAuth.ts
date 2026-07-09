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

export async function checkPassword(password: string): Promise<boolean> {
  if (!password) return false
  const config = await readPrivate('auth.json')
  if (!config?.password) return false
  return password === config.password
}

export async function setPassword(
  newPassword: string,
  oldPassword?: string,
): Promise<{ ok: boolean; error?: string }> {
  const config = await readPrivate('auth.json')
  if (config?.password && oldPassword !== config.password) {
    return { ok: false, error: '舊密碼錯誤' }
  }
  await writePrivate('auth.json', { password: newPassword })
  return { ok: true }
}

export async function readPendingBatches(): Promise<any> {
  return (await readPrivate('pending.json')) ?? { batches: [] }
}
