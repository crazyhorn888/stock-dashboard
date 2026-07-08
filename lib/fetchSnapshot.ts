import type { SnapshotData, StockData } from './types'

/**
 * P1-1 讀取側：組合分層檔案（market + stocks-lite + history），
 * 還原成與 latest.json 完全相同的 SnapshotData 形狀 —— 下游元件零改動。
 *
 *   market.json      ~300KB  大盤K線+籌碼+訊號+板塊（sectorHistory day0 含個股、其餘剝除）
 *   stocks-lite.json ~300KB  個股清單欄位（無歷史陣列）
 *   history.json     ~3MB    closes 對齊共用交易日曆（null = 該股當日無交易）
 *
 * 任一新檔 404（首次部署過渡期，pipeline 尚未產出）→ fallback 舊 latest.json。
 */
export async function fetchSnapshot(): Promise<SnapshotData> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_SNAPSHOT_URL 未設定')

  try {
    return await fetchLayered(url)
  } catch (e) {
    console.warn('[fetchSnapshot] 分層檔案載入失敗，fallback latest.json：', (e as Error).message)
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.status}`)
    return res.json()
  }
}

async function fetchLayered(latestUrl: string): Promise<SnapshotData> {
  const get = async (name: string) => {
    const res = await fetch(latestUrl.replace('latest.json', name), { cache: 'no-cache' })
    if (!res.ok) throw new Error(`${name} fetch failed: ${res.status}`)
    return res.json()
  }

  const [market, lite, history] = await Promise.all([
    get('market.json'),
    get('stocks-lite.json'),
    get('history.json'),
  ])

  // 用共用日曆還原每支股票自己的 closes / dates（null = 該日無交易，跳過）
  const calendar: string[] = history.dates ?? []
  const stocks: StockData[] = (lite.stocks ?? []).map((s: Omit<StockData, 'closes' | 'dates'>) => {
    const aligned: (number | null)[] = history.stocks?.[s.code] ?? []
    const closes: number[] = []
    const dates: string[] = []
    for (let i = 0; i < aligned.length; i++) {
      if (aligned[i] != null) {
        closes.push(aligned[i] as number)
        dates.push(calendar[i])
      }
    }
    return { ...s, closes, dates }
  })

  return {
    updatedAt:     market.updatedAt,
    stocksDate:    market.stocksDate ?? null,
    indexDate:     market.indexDate ?? null,
    marginDate:    market.marginDate ?? null,
    chipsDate:     market.chipsDate ?? null,
    sectorDate:    market.sectorDate ?? null,
    stocks,
    indexHistory:  market.indexHistory ?? [],
    sectorHistory: market.sectorHistory ?? [],
    sectors:       market.sectors ?? [],
    marketSignals: market.marketSignals ?? null,
  }
}
