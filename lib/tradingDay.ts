// 台股交易日／鮮度基準的共用判斷。
// ⚠️ 一律以台北時間（Asia/Taipei）為準——使用者出國時手機時區會變，
//    用本地時間會整個判斷錯一天（2026-09-03 Franky 指正）。

export const CLOSE_MINUTES = 13 * 60 + 30   // 台股 13:30 收盤

/** 台北今日（YYYY-MM-DD） */
export function taipeiToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

/** 台北現在的「分鐘數」（00:00 起算） */
export function taipeiMinutes(now: Date = new Date()): number {
  const hhmm = now.toLocaleString('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 台北的星期（0=日 … 6=六） */
export function taipeiDayOfWeek(now: Date = new Date()): number {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getDay()
}

/** 台北今天是否為週末（國定假日需另外查 holiday-status，見 FreshnessBar） */
export function isWeekendTW(now: Date = new Date()): boolean {
  const d = taipeiDayOfWeek(now)
  return d === 0 || d === 6
}

/** 台北今天是否已過收盤（13:30） */
export function isAfterClose(now: Date = new Date()): boolean {
  return taipeiMinutes(now) >= CLOSE_MINUTES
}

/**
 * 鮮度比較的基準日：
 * - 休市（週末／國定假日）→ 最近交易日
 * - 交易日且已過 13:30 → 今日
 * - 交易日但還沒收盤 → 上一個交易日（此時最新應有的資料就是前一交易日的）
 *
 * @param tradingDates 有 K 棒的交易日清單（newest first），用來推「上一個交易日」
 */
export function freshnessBaseDate(
  tradingDates: (string | null | undefined)[],
  opts: { closed: boolean; now?: Date } = { closed: false },
): string | null {
  const dates = tradingDates.filter((d): d is string => !!d)
  const latest = dates[0] ?? null
  if (opts.closed) return latest

  const today = taipeiToday(opts.now)
  if (isAfterClose(opts.now)) return today
  return dates.find(d => d !== today) ?? latest
}

/** 兩個 YYYY-MM-DD 相差幾個日曆天（date 落後 base 幾天，負數代表超前） */
export function daysBehind(date: string | null, base: string | null): number | null {
  if (!date || !base) return null
  const a = Date.parse(date + 'T00:00:00Z')
  const b = Date.parse(base + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}
