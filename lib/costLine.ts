/**
 * 主力成本推估的資料模型（AC-CL-1～AC-CL-5，2026-09-10）。
 *
 * 把 options-oi.json 的 ml 切片（每日建倉明細 + OI 序列 + 賣方防線）攤成
 * 「每個契約一組 legs + timeline + 日曆」，供 CostLine 元件直接畫。
 *
 * 兩個不可更動的口徑：
 *  1. 成本用「最後成交價」加權，不可用結算價——結算價是模型推導的理論價
 *     （實例 45800C：結算 1360 vs 收盤 1260，差 100 點）。
 *  2. 建倉的認定是「價內 ＋ 留倉率 ≥80%」，留倉率＝OI 增量 ÷ 成交量。
 *     ≈100% 代表新倉留著過夜，不是當沖換手——那才是主力的指紋。
 */

import type { OptionsOISnapshot } from './types'

/** 單一履約價的一次建倉 */
export interface CostEntry {
  d: string
  vol: number
  dOI: number
  close: number
}

/** 一條成本線＝同一個履約價的所有建倉合併 */
export interface CostLeg {
  key: string
  k: number
  cp: 'C' | 'P'
  /** OI 增量加權後的平均權利金 */
  cost: number
  /** 兩平點：BC＝履約價＋成本、BP＝履約價−成本 */
  be: number
  totOI: number
  first: string
  entries: CostEntry[]
}

export interface CostDay {
  d: string
  fut: number
  idx: number | null
  /** 追蹤中履約價的當日 OI，缺項即為 0 */
  oi: Record<string, number>
  /** 賣方虧損點（履約價 ± 權利金），與買方兩平是同一個數字、視角相反 */
  sc: number | null
  sp: number | null
  scK: number | null
  spK: number | null
}

/** 日曆一格：當天主力押的成本帶（用當日收盤價算，不是加權後的） */
export interface CostDaily {
  d: string
  oi: number
  rawOI: number
  weak: boolean
  lo: number | null
  hi: number | null
}

export interface CostCase {
  code: string
  exp: string
  days: string[]
  timeline: CostDay[]
  legs: CostLeg[]
  daily: Record<string, CostDaily>
  /** 生命週期內最後一次「其他契約」結算的日子，預設從這裡開始看 */
  lastRoll: string
}

/** AC-CL-4：單一履約價累積不到這個口數就不列，濾掉零星單 */
export const MIN_OI = 100

const mlOf = (snap: OptionsOISnapshot, d: string, code: string) =>
  snap.days[d]?.[code]?.ml ?? null

/**
 * 依 as-of 日期重算 legs。
 *
 * ⚠️ 不可先算完整段生命週期再拿來回看某一天——那會把當天之後才發生的建倉
 * 混進成本與累積量裡（實例：C46600 在 09/08 只有 1 口，09/09 才變成 453 口）。
 * ≥100 口的門檻同理，必須用當日（含）之前的 entries 重判。
 */
export function legsAsOf(legs: CostLeg[], asOf: string): CostLeg[] {
  const out: CostLeg[] = []
  for (const l of legs) {
    const es = l.entries.filter(e => e.d <= asOf)
    if (!es.length) continue
    const tot = es.reduce((a, e) => a + e.dOI, 0)
    if (tot < MIN_OI) continue
    const cost = tot > 0 ? es.reduce((a, e) => a + e.dOI * e.close, 0) / tot : l.cost
    out.push({
      ...l,
      entries: es,
      totOI: tot,
      cost,
      be: l.cp === 'C' ? l.k + cost : l.k - cost,
      first: es[0].d,
    })
  }
  return out
}

function analyze(
  snap: OptionsOISnapshot,
  code: string,
  dates: string[],
  settleDays: Record<string, string[]>,
  indexClose: Record<string, number>,
): CostCase | null {
  const days = dates.filter(d => mlOf(snap, d, code))
  if (!days.length) return null
  const exp = snap.days[days[0]][code].exp

  const legMap: Record<string, { k: number; cp: 'C' | 'P'; entries: CostEntry[] }> = {}
  const timeline: CostDay[] = []

  for (const d of days) {
    const ml = mlOf(snap, d, code)!
    for (const [k, cp, vol, dOI, close] of ml.e ?? []) {
      const key = `${cp}${k}`
      ;(legMap[key] ??= { k, cp, entries: [] }).entries.push({ d, vol, dOI, close })
    }
    const oi: Record<string, number> = {}
    for (const [k, cp, v] of ml.o ?? []) oi[`${cp}${k}`] = v
    timeline.push({
      d,
      fut: snap.fut?.[d] ?? 0,
      idx: indexClose[d] ?? null,
      oi,
      sc: ml.sc ? ml.sc[0] + ml.sc[2] : null,
      sp: ml.sp ? ml.sp[0] - ml.sp[2] : null,
      scK: ml.sc?.[0] ?? null,
      spK: ml.sp?.[0] ?? null,
    })
  }

  const legs: CostLeg[] = Object.entries(legMap).map(([key, l]) => {
    const tot = l.entries.reduce((a, e) => a + e.dOI, 0)
    const cost = l.entries.reduce((a, e) => a + e.close * e.dOI, 0) / tot
    return {
      key, k: l.k, cp: l.cp, cost,
      be: l.cp === 'C' ? l.k + cost : l.k - cost,
      totOI: tot, first: l.entries[0].d, entries: l.entries,
    }
  })
  legs.sort((a, b) => a.first.localeCompare(b.first) || b.totOI - a.totOI)

  // 日曆用「當日收盤價」各自算兩平點，不用加權後的——那格看的是
  // 「那一天主力押在哪個區間」，與圖表的累積視角不同
  const daily: Record<string, CostDaily> = {}
  const items: Record<string, { dOI: number; be: number }[]> = {}
  for (const l of legs) {
    for (const e of l.entries) {
      const be = l.cp === 'C' ? l.k + e.close : l.k - e.close
      ;(items[e.d] ??= []).push({ dOI: e.dOI, be })
    }
  }
  for (const [d, list] of Object.entries(items)) {
    const rawOI = list.reduce((a, x) => a + x.dOI, 0)
    // 低於當日總量 5% 且不足 50 口的算零星單——一口單的極端履約價會把成本帶整個拉開
    const cut = Math.max(50, rawOI * 0.05)
    const main = list.filter(x => x.dOI >= cut)
    if (main.length) {
      const bes = main.map(x => x.be)
      daily[d] = {
        d, rawOI, weak: false,
        oi: main.reduce((a, x) => a + x.dOI, 0),
        lo: Math.min(...bes), hi: Math.max(...bes),
      }
    } else {
      daily[d] = { d, rawOI, weak: true, oi: rawOI, lo: null, hi: null }
    }
  }

  const rolls = days.filter(d => settleDays[d]?.some(c => c !== code))
  return { code, exp, days, timeline, legs, daily, lastRoll: rolls.length ? rolls[rolls.length - 1] : days[0] }
}

/**
 * AC-CL-1：可選契約＝當日快照有揭露、且結算日尚未過（exp >= today）的全部契約，
 * 依結算日升冪。
 *
 * ⚠️ 掛牌時點不寫成硬編規則。週選是結算日前 14 天、月選是前一個月選結算的次一營業日，
 * 但掛牌日遇休市會順延（實測 2026-06-19 端午、2026-07-10 各順延一次），
 * 寫死就會算錯。快照當天有這個代號，本身就是掛牌事實。
 */
export function buildCases(
  snap: OptionsOISnapshot,
  indexClose: Record<string, number>,
  today: string,
): CostCase[] {
  const dates = Object.keys(snap.days).filter(d => d <= today).sort()
  if (!dates.length) return []

  const settleDays: Record<string, string[]> = {}
  for (const d of dates) {
    const codes = Object.entries(snap.days[d]).filter(([, v]) => v.exp === d).map(([c]) => c)
    if (codes.length) settleDays[d] = codes
  }

  const codes = new Set<string>()
  for (const d of dates) for (const c of Object.keys(snap.days[d])) if (mlOf(snap, d, c)) codes.add(c)

  return [...codes]
    .map(c => analyze(snap, c, dates, settleDays, indexClose))
    // ⚠️ 不可再加「有合格建倉線才留」的條件——剛掛牌的契約本來就還沒有建倉，
    // 濾掉的話 F3、下期月選就永遠不會出現在分頁上，正好違反 AC-CL-1
    .filter((c): c is CostCase => !!c && c.exp >= today)
    .sort((a, b) => a.exp.localeCompare(b.exp))
}
