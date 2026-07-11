'use client'
import { useState, useEffect, useMemo } from 'react'
import type { SectorBubble, StockData, StockRow } from '@/lib/types'
import StockRowsTable from '@/components/shared/StockRowsTable'

const QUADRANT_LABEL: Record<string, { label: string; color: string }> = {
  TR: { label: '漲潮', color: 'text-red-500'   },
  TL: { label: '觀望', color: 'text-slate-400' },
  BL: { label: '退潮', color: 'text-green-600' },
  BR: { label: '輪動', color: 'text-amber-500' },
}

function quadrantOf(x: number, y: number) {
  if (x >= 0 && y >= 0) return 'TR'
  if (x <  0 && y >= 0) return 'TL'
  if (x <  0 && y <  0) return 'BL'
  return 'BR'
}

/**
 * 板塊/概念面板（bottom sheet）。個股列表 2026-07-12 起改用共用的 StockRowsTable——
 * 與「個股清單」Tab 同欄位/同排序規則/同顯示格式，rows 由 page.tsx 統一產生
 * （rowsByCode，法人欄位來自 day0 T86，見 lib/instNet），本元件只做成員篩選。
 */
interface Props {
  sector: SectorBubble | null
  onClose: () => void
  rowsByCode: Record<string, StockRow>
  onStockClick?: (stock: StockData) => void
  onConceptClick?: (concept: string) => void
}

function sign(v: number) { return v > 0 ? '+' : '' }

export default function SectorPanel({ sector, onClose, rowsByCode, onStockClick, onConceptClick }: Props) {
  // iOS 15+ Safari compact bottom toolbar (~49px) 蓋在 position:fixed 內容上，
  // 最後一列被遮住且內容沒超過容器高度時「無法捲動」（2026-07-12 Franky 回報）。
  // 與 StockDetailSheet 同一套解法：UA 偵測 iOS → 整個 sheet 上抬固定位移
  const [iosOffset, setIosOffset] = useState(0)
  useEffect(() => {
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) setIosOffset(49)
  }, [])

  // 面板開啟時鎖背景捲動：iOS 觸控會把捲動事件讓給 body（scroll chaining），
  // 造成「滑面板結果背景在動、面板不動」
  useEffect(() => {
    if (!sector) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [sector])

  const rows = useMemo(
    () => (sector?.stocks ?? []).map(s => rowsByCode[s.code]).filter((r): r is StockRow => !!r),
    [sector, rowsByCode],
  )

  if (!sector) return null

  const qId = quadrantOf(sector.x, sector.y)
  const q   = QUADRANT_LABEL[qId]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} />

      {/* Bottom sheet — bottom/maxHeight 由 iosOffset 推高，避開 Safari compact toolbar（同 StockDetailSheet） */}
      <div
        className="fixed left-0 right-0 z-40 bg-white rounded-t-2xl shadow-xl flex flex-col"
        style={{
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${iosOffset}px)`,
          maxHeight: iosOffset ? `calc(82svh - ${iosOffset}px)` : '82svh',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-1 pb-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">{sector.sectorName}</h2>
              <span className={`text-xs font-semibold ${q.color}`}>{q.label}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              法人淨買超 {sign(sector.x)}{sector.x.toFixed(1)} 億/日 ·
              加速指標 {sign(sector.y)}{(sector.y * 100).toFixed(1)}%
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-lg leading-none px-1 pt-1">✕</button>
        </div>

        <hr className="border-slate-100" />

        {/* 共用表格：預設按合計(億)絕對值降冪（大動作在前）；overscroll-contain 阻止捲動外溢到背景 */}
        <StockRowsTable
          rows={rows}
          onStockClick={onStockClick}
          onConceptClick={onConceptClick}
          defaultSortKey="instTotal"
          defaultAsc={false}
          wrapperClassName="overflow-x-auto overflow-y-auto overscroll-contain flex-1"
          wrapperStyle={{ minHeight: 0 }}
        />

        <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
      </div>
    </>
  )
}
