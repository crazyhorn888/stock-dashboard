<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 專案接續指引（AI session 必讀）

- **活躍計劃（跨 session 交接棒）**：`plans/2026-07-08-優化修正計劃.md` — 開工前先讀 §0 與 §4 進度總覽；完成任務必須回寫狀態與執行紀錄
- 資料來源與時序權威對照：`docs/抓取檔案時序.md`
- 概念股分類資料（一股多概念）：`data/concept-sectors.json`
- `chips/{date}.json` 欄位契約正本：`../stock-chips-daily/doc/chips-contract.md`（改 `fetch-daily.mjs` 的 `buildChipsEntry()` 前必讀）
- 技術名詞圖解（泡泡碰撞/symlog/競態條件/事件驅動/HTTP快取/Delta快照/資料契約）：`../../../Technical Discussion/`
