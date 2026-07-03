'use client'
import type { SectorBubble } from '@/lib/types'

const QUADRANT_LABEL: Record<string, { label: string; color: string }> = {
  TR: { label: '漲潮',  color: 'text-red-500'    },
  TL: { label: '觀望',  color: 'text-slate-400'  },
  BL: { label: '退潮',  color: 'text-green-600'  },
  BR: { label: '輪動',  color: 'text-amber-500'  },
}

function quadrantOf(x: number, y: number): string {
  if (x >= 0 && y >= 0) return 'TR'
  if (x <  0 && y >= 0) return 'TL'
  if (x <  0 && y <  0) return 'BL'
  return 'BR'
}

interface Props {
  sector: SectorBubble | null
  onClose: () => void
}

export default function SectorPanel({ sector, onClose }: Props) {
  if (!sector) return null

  const qId = quadrantOf(sector.x, sector.y)
  const q   = QUADRANT_LABEL[qId]

  // Group stocks by industry
  const grouped = sector.stocks.reduce<Record<string, typeof sector.stocks>>((acc, s) => {
    ;(acc[s.industry] ??= []).push(s)
    return acc
  }, {})

  const sign = (v: number) => v > 0 ? '+' : ''

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-30"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl shadow-xl"
        style={{ maxHeight: '75dvh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">{sector.sectorName}</h2>
              <span className={`text-xs font-semibold ${q.color}`}>{q.label}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              法人淨買超 {sign(sector.x)}{sector.x.toFixed(1)} 千張 ·
              加速指標 {sign(sector.y)}{(sector.y * 100).toFixed(1)}%
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        <hr className="border-slate-100 mx-4" />

        {/* Stock list */}
        <div className="overflow-y-auto flex-1 px-4 py-2">
          {sector.stocks.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">無個股資料</p>
          ) : (
            Object.entries(grouped).map(([industry, stocks]) => (
              <div key={industry} className="mb-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  {industry}
                </p>
                {stocks.map(s => (
                  <div
                    key={s.code}
                    className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 w-10">{s.code}</span>
                      <span className="text-sm text-slate-700">{s.name}</span>
                    </div>
                    <span className={`text-xs font-medium tabular-nums ${
                      s.netBuy > 0 ? 'text-red-500' : s.netBuy < 0 ? 'text-green-600' : 'text-slate-400'
                    }`}>
                      {sign(s.netBuy)}{s.netBuy.toLocaleString()} 張
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* iOS safe area */}
        <div className="h-safe-bottom" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
      </div>
    </>
  )
}
