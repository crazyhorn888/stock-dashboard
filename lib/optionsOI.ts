import type { OptionsOISnapshot, OptionsOIContract } from '@/lib/types'

// 功能二十三：選擇權 OI 日曆的計算邏輯（純函式，方便單獨驗證）
//
// 核心概念（AC-OI-B4）：日曆三行 ＝「追蹤契約」的完整生命週期，不是固定的日曆週。
// 週選提前兩週掛牌，掛牌日固定落在第一行的週三（週五表為週五），結算日落在第三行，
// 所以第一行的日／一／二（掛牌前）與第三行的四／五／六（結算後）永遠是灰的。
// 追蹤契約結算後會換成下一檔，整張表跟著往後滾，今天因此會在三行之間移動。

export type OIKind = 'wed' | 'fri'

export interface TrackedContract {
  code: string
  exp: string        // 結算日
  listDate: string   // 掛牌日 ＝ 結算日往前 14 天
  /** AC-OI-B14：這是「已結算、還在等下一檔掛牌」的契約，不是正常追蹤中的那檔 */
  settled: boolean
}

export interface OICell {
  date: string
  weekend: boolean
  /** 落在掛牌～結算之外（灰底，不放任何內容） */
  outside: boolean
  today: boolean
  rec: OptionsOIContract | null
  /** 沒有資料時要標的字：週結算日／月結算日／無週選 */
  note: '週結算日' | '月結算日' | '無週選' | null
  /** 該日結算的上一檔（只有掛牌日會有），點開看結算價 */
  prevCode: string | null
  /** 下一檔同型週選的代號（掛牌後才有），徽章顯示其週數 */
  nextCode: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
/** 一律用 UTC 解析與計算，避免使用者在別的時區時整排位移一天（比照 AC-FIX-5） */
const parse = (s: string) => new Date(`${s}T00:00:00Z`)
const shift = (s: string, days: number) => {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

/** 週三表只認代號含 W 的契約、週五表只認含 F 的；月選（純 6 碼）兩邊都不進日曆 */
export const isOurs = (code: string, kind: OIKind) => code.includes(kind === 'wed' ? 'W' : 'F')

/** 徽章文字：取代號後兩碼（W4 / F3） */
export const weekTag = (code: string) => code.slice(-2)

/** 月結算日 ＝ 當月第三個週三；月選是週三結算，只在週三表標 */
export function isMonthlySettle(dateISO: string, kind: OIKind): boolean {
  if (kind !== 'wed') return false
  const d = parse(dateISO)
  return d.getUTCDay() === 3 && Math.floor((d.getUTCDate() - 1) / 7) + 1 === 3
}

/**
 * 追蹤契約 ＝ 資料裡最近一檔「還沒結算」的同型週選。
 *
 * AC-OI-B14：結算日當天沒有任何未結算契約——舊的今天到期、新的要等當天盤後
 * （約 14:37）那班抓到才進資料。這段空窗期若回 null，整張卡會消失，而且每個
 * 週三／週五選結算日都會發生。所以找不到時退回最近一檔「已結算」的同型週選，
 * 標記 settled 讓 UI 說明現在的狀態；當天盤後新契約進來後自動切回正常追蹤。
 */
export function trackContract(
  snap: OptionsOISnapshot, kind: OIKind, today: string,
): TrackedContract | null {
  let best: { code: string; exp: string } | null = null
  let settled: { code: string; exp: string } | null = null
  for (const [date, day] of Object.entries(snap.days)) {
    if (date > today) continue
    for (const [code, rec] of Object.entries(day)) {
      if (!isOurs(code, kind)) continue
      if (rec.exp > today) {
        if (!best || rec.exp < best.exp) best = { code, exp: rec.exp }
      } else if (!settled || rec.exp > settled.exp) {
        settled = { code, exp: rec.exp }   // 已結算的取最近一檔
      }
    }
  }
  const pick = best ?? settled
  if (!pick) return null
  return { code: pick.code, exp: pick.exp, listDate: shift(pick.exp, -14), settled: !best }
}

/** 某日掛牌中、到期晚於追蹤契約的最近一檔同型週選（AC-OI-B7 的右上角徽章） */
export function nextContractOn(
  snap: OptionsOISnapshot, kind: OIKind, dateISO: string, mainExp: string,
): string | null {
  const day = snap.days[dateISO]
  if (!day) return null
  let best: string | null = null
  for (const [code, rec] of Object.entries(day)) {
    if (!isOurs(code, kind) || rec.exp <= mainExp) continue
    if (!best || rec.exp < day[best].exp) best = code
  }
  return best
}

/**
 * 上一檔（AC-OI-B8）：新契約的掛牌日就是上一檔的結算日，兩件事同一天。
 * 那天結算的若是月選（純 6 碼）就沒有上一檔，回 null。
 */
export function prevContract(
  snap: OptionsOISnapshot, kind: OIKind, listDate: string, today: string,
): { code: string; date: string; fsp: number; lastDay: string | null; rec: OptionsOIContract | null } | null {
  const hit = Object.entries(snap.settle)
    .find(([code, v]) => isOurs(code, kind) && v.date === listDate && v.date <= today)
  if (!hit) return null
  const [code, v] = hit
  const days = Object.keys(snap.days).filter(d => d <= today && snap.days[d][code]).sort()
  const lastDay = days.length ? days[days.length - 1] : null
  return { code, date: v.date, fsp: v.fsp, lastDay, rec: lastDay ? snap.days[lastDay][code] : null }
}

/** 三行 × 7 格：第一行＝掛牌週、第三行＝結算週 */
export function buildCalendar(
  snap: OptionsOISnapshot, kind: OIKind, t: TrackedContract, today: string,
): OICell[][] {
  const list = parse(t.listDate)
  const sun = new Date(list)
  sun.setUTCDate(list.getUTCDate() - list.getUTCDay())

  // 當週有沒有同型週選結算；沒有（月結算週）主體整排標「無週選」
  const hasMain = Object.keys(snap.days).some(d => d <= today && snap.days[d][t.code])

  return [0, 7, 14].map(offset =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sun)
      d.setUTCDate(sun.getUTCDate() + offset + i)
      const date = iso(d)
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
      const outside = date < t.listDate || date > t.exp
      // AC-OI-B10：超過當日一律不顯示數字，即使資料已存在
      const rec = date <= today ? (snap.days[date]?.[t.code] ?? null) : null

      let note: OICell['note'] = null
      if (!weekend && !outside && !rec) {
        if (isMonthlySettle(date, kind)) note = '月結算日'
        else if (date === t.exp) note = '週結算日'
        else if (!hasMain && date <= today) note = '無週選'
      }

      const prev = !weekend && date === t.listDate && date <= today
        ? prevContract(snap, kind, t.listDate, today) : null

      return {
        date, weekend, outside, today: date === today, rec, note,
        prevCode: prev?.code ?? null,
        nextCode: !weekend && date <= today ? nextContractOn(snap, kind, date, t.exp) : null,
      }
    }),
  )
}

/** 月選區塊（AC-OI-B9）：當月／次月依選擇權月份而非日曆月份 */
export function monthlyContracts(
  snap: OptionsOISnapshot, today: string,
): { date: string | null; items: { code: string; rec: OptionsOIContract }[] } {
  const days = Object.keys(snap.days).filter(d => d <= today).sort()
  const latest = days[days.length - 1]
  if (!latest) return { date: null, items: [] }
  const items = Object.entries(snap.days[latest])
    .filter(([code, rec]) => /^\d{6}$/.test(code) && rec.exp > today)
    .sort((a, b) => a[1].exp.localeCompare(b[1].exp))
    .slice(0, 2)
    .map(([code, rec]) => ({ code, rec }))
  return { date: latest, items }
}

/** 追蹤契約最後一個有記錄的交易日，供明細預設選中 */
export function latestRecordedDay(
  snap: OptionsOISnapshot, code: string, today: string,
): string | null {
  const days = Object.keys(snap.days).filter(d => d <= today && snap.days[d][code]).sort()
  return days.length ? days[days.length - 1] : null
}
