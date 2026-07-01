# 台股儀表板 — 專案憲法

> 生成時間：2026-07-01 14:45

## 專案目標

做一個每天自動更新、可分享連結的台股分析網頁，取代手動整理資料，讓自己和親友能直觀查閱股票修正幅度、大盤融資指標、及市場條件訊號。

## 技術棧

- 前端：Next.js + D3.js（泡泡圖）或 ECharts，部署 Vercel 免費版
- 資料庫：Firebase Firestore（Spark 免費方案）— 選擇理由：不會因閒置刪除，且有 vivihair-booking 使用經驗
- 資料來源：
  - TWSE OpenAPI（日線/融資/外資，免費）
  - FinMind（EPS/P/E/殖利率，免費 600 req/hr）
  - Fugle Market Data API（盤中即時，需開富果帳號，第三階段）
- 自動化：GitHub Actions Cron（每日 15:30 CST 觸發，免費）
- 題材 Mapping：爬 Yahoo 股市 / 玩股網，人工維護

## 核心規則

1. **N 值在前端計算**：Firebase 存 250 天原始日線資料，每位使用者的瀏覽器各自依自己設定的 N 算距高/距低，互不干擾
2. **資料預算**：FinMind 每日實際用量 < 20 次（batch 查詢），遠低於 600 次上限
3. **顏色慣例**：正向條件觸發用紅字，負向條件觸發用綠字（台灣股市慣例：紅=漲=利多，綠=跌=利空）
4. **條件擴充點**：新增正/負向條件需改動 4 個位置（/signals 卡片、/aftermarket 指標區、表格行內標籤、GitHub Actions 腳本），未來靠 `/stock-add-signal` Skill 半自動完成
5. **分階段開發**：第一階段（盤後行情）→ 第二階段（市場條件）→ 第三階段（盤中即時）

## 不做的事

- 題材 Mapping（第一階段用 TWSE 標準產業分類）
- 籌碼分析功能（外資連續買超天數等）
- 基本面同產業橫向比較
- 帳號登入 / 會員系統
- 手機 App（網頁已支援手機）
- `/stock-add-signal` Skill 本體（第二階段完成後再建）

---

## ⚡ Session 開始時執行（每次必做）

1. 讀取 `.notion-spec-id`（建立後）取得 Notion Spec page ID
2. 呼叫 Notion API 取得 `last_edited_time`
3. 與 `tasks.md` 第二行的 `notion-spec-synced:` 比對
4. 若時間戳不同 → 告知：「Notion Spec 在 [time] 有更新，要重新生成 tasks.md 嗎？」並等待確認

---

## 已知參考

- UI Demo：`docs/2026-07-01_taiwan-stock-dashboard-arch.html`（可用瀏覽器開啟）
- 籌碼表自動化：`100_Todo/projects/stock-chips-daily/`（資料格式參考）
- Notion Project：Claude|project|台股儀表板（已建立，ID 待補入 .notion-spec-id）
