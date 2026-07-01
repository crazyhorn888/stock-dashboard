# 台股儀表板 — 任務清單

notion-spec-synced: （待建立 Notion Spec 後填入）

---

## 第一階段：盤後行情頁面

- [ ] 初始化 Next.js 專案，設定 Firebase 連線，部署空白頁到 Vercel | 產出：`taiwan-stock-dashboard/` 專案骨架 + Vercel URL
- [ ] 建立 GitHub Actions 每日排程腳本（15:30 CST），抓 TWSE 日線 + 融資/外資 | 產出：`.github/workflows/daily-fetch.yml`
- [ ] 建立 FinMind 基本面抓取（EPS/P/E/殖利率），batch 查詢避免超額 | 產出：`scripts/fetch-fundamentals.js`
- [ ] 計算個股指標（距高/距低/漲跌%）並寫入 Firebase Firestore | 產出：Firestore `stocks/{code}` 文件含 250 日原始價格陣列
- [ ] 計算大盤融資指標（減幅/增幅/條件 flag）並寫入 Firebase | 產出：Firestore `market/signals` 文件
- [ ] 建立 `/aftermarket` 頁面：N 日參數列、大盤指標卡片（含條件觸發樣式）、個股表格（含篩選、欄位全開） | 產出：`app/aftermarket/page.tsx`
- [ ] 前端 N 值計算邏輯：讀取 250 日陣列，按 N 動態算距高/距低，更新表格 | 整合在 `/aftermarket` 頁面
- [ ] 部署驗收：Vercel URL 可正常開啟，表格資料正確，大盤指標卡片數字正確

## 第二階段：市場條件頁面

- [ ] 建立 `/signals` 頁面框架：正向/負向兩區塊，卡片元件 | 產出：`app/signals/page.tsx`
- [ ] 實作條件卡片：觸發高亮、點擊 Modal（含公式、基準點、計算過程） | 產出：`components/SignalCard.tsx`、`components/SignalModal.tsx`
- [ ] 新增「融資減幅>大盤減幅 5%」正向條件卡片（含 Modal 說明）
- [ ] 新增「融資增幅>大盤增幅 7%」負向條件卡片（含 Modal 說明）
- [ ] 預留佔位卡片（「+ 未來新增條件」樣式）
- [ ] 撰寫 `/stock-add-signal` 規格文件 | 產出：`docs/add-signal-spec.md`
- [ ] 部署驗收：條件卡片顯示正確，Modal 開關正常，觸發狀態與 Firebase 數據一致

## 第三階段：盤中即時頁面

- [ ] 申請 Fugle Market Data API Key（需開富果帳號）
- [ ] 建立 `/intraday` 頁面：WebSocket 連線 Fugle，每 3 秒 batch 更新 | 產出：`app/intraday/page.tsx`
- [ ] 實作產業資金流向泡泡圖（X=漲跌%、Y=成交量佔比、大小=資金流入）| 產出：`components/BubbleChart.tsx`
- [ ] 實作點擊 Drawer：展開產業個股清單（含距 N 日高%） | 產出：`components/StockDrawer.tsx`
- [ ] 非交易時間 fallback：改顯示前一個交易日盤後快照
- [ ] 部署驗收：盤中泡泡圖更新正常，Drawer 開關正確，非交易時間顯示盤後數據

## 第四階段：Skill 建立（第二階段完成後）

- [ ] 建立 `/stock-add-signal` Skill | 產出：`000_Agent/skills/stock-add-signal/`
