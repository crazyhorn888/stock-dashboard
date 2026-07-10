/**
 * 判斷台北今日是否為台股休市日，寫一個小檔案供前端讀取。
 * 資料源：TWSE 官方 OpenAPI holidaySchedule（不是政府機關辦公日曆——
 * 兩者不完全一致，實測發現至少一天有落差，這支只信任證交所自己的行事曆）
 *
 * 這支腳本設計成「永遠執行」（不受 daily-fetch.yml 的 FMTQIK Guard 限制），
 * 因為它本身就是用來判斷「今天為什麼沒有新資料」的說明依據。
 *
 * 執行：SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx node scripts/check-holiday.mjs
 */

function todayTWDate() {
  return process.env.DATE_OVERRIDE ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function rocToISO(rocStr) {
  const s = String(rocStr).replace(/\//g, '')
  const year = parseInt(s.slice(0, -4)) + 1911
  return `${year}-${s.slice(-4, -2)}-${s.slice(-2)}`
}

async function fetchHolidayList() {
  const res = await fetch('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`TWSE holidaySchedule HTTP ${res.status}`)
  const rows = await res.json()
  const map = new Map()
  for (const r of rows ?? []) {
    const iso = rocToISO(r.Date)
    if (iso) map.set(iso, r.Name ?? '休市')
  }
  return map
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[check-holiday] 需要 SUPABASE_URL 和 SUPABASE_SERVICE_KEY')
    process.exit(1)
  }

  const today = todayTWDate()
  const dow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getDay()
  const isWeekend = dow === 0 || dow === 6

  let isHoliday = isWeekend
  let name = isWeekend ? '週末' : null

  if (!isWeekend) {
    try {
      const holidays = await fetchHolidayList()
      if (holidays.has(today)) {
        isHoliday = true
        name = holidays.get(today)
      }
    } catch (e) {
      console.warn('[check-holiday] TWSE holidaySchedule 查詢失敗，僅用週末判斷：', e.message)
    }
  }

  const payload = { date: today, isHoliday, name, checkedAt: new Date().toISOString() }
  console.log('[check-holiday]', JSON.stringify(payload))

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/snapshots/holiday-status.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'cache-control': 'no-cache',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    console.error('[check-holiday] 上傳失敗:', res.status, await res.text())
    process.exit(1)
  }
  console.log('[check-holiday] 完成')
}

main().catch(e => { console.error('[check-holiday] 異常：', e); process.exit(1) })
