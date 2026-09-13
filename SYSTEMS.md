# Ruby Site — 系統總覽（SYSTEMS.md）

> 這份文件是給「未來的 Claude / 未來的維護者」看的第一份文件。
> 每次要動這個 repo 之前，請先讀這份，再讀 `docs/architecture.md`、
> `docs/api-contract.md`、`docs/database-schema.md`。

這不是展示網站，是 Ruby 每天實際使用的教師工作 + 家庭管理系統。
**任何修改都不能讓「明天上班/放學後」用不了。**

---

## Production

- Repo: `hcrrabbit-lgtm/ruby-site`
- Production 部署分支：`main`
- Cloudflare Worker：`ruby-site`（見 `wrangler.jsonc` 的 `name`）
- D1：binding `DB`，database name `ruby-class-db`
  （database_id: `55e99051-819a-4ab2-b230-8004962c7375`）
- R2：binding `PHOTOS`，bucket name `ruby-class-photos`
- 靜態資源：binding `ASSETS`，目錄 `./public`

## 進入點（Entry points）

Frontend（靜態頁面，皆位於 `public/`）：
- `public/index.html` — 首頁；也承載「健康習慣」(`/api/habits*`) 相關 UI
- `public/class-assistant.html` — 主力教師端頁面（座位表、點名、加減分、
  作業評分、班級進度…），目前約 110 KB / 2600+ 行，**今天不拆**
- `public/open/study-habits.html` — 家庭端頁面（讀書習慣、吃飯時間、
  週罰點、銀行提領），對應 `/api/open/*`，刻意繞過 Cloudflare Access
  （見 `docs/security-audit.md`）
- `public/open/cathy.html`、`public/open/rina.html` — 導向/殼頁面，指到
  `study-habits.html`
- `public/activity-radar.html` — 社群/學校公告來源列表 (`/api/community-sources`)
- `public/go-tournaments.html` — 靜態頁面，目前未呼叫任何 `/api/*`

Backend：
- `worker/index.js` — 唯一的 Worker 入口，目前約 1380 行 / 67 KB，
  內含所有 route handler。**今天不拆成 routes/**，只抽出極少數
  不碰 DB 的 pure helper 到 `worker/lib/`（見下方「今天做了什麼」）。

## SSOT（Single Source of Truth）現況

- **應用程式碼**：GitHub `main` branch 是唯一真相來源。
- **Runtime schema（重要技術債）**：目前 production 的實際資料庫結構，
  是由 `worker/index.js` 裡的 `SCHEMA_SQL` 常數 + `ensureSchema()`
  在 Worker 啟動時自動補建/補 migrate 決定的。
  `migrations/0001_init.sql` **已經過時，不能視為完整的 production schema**
  （只涵蓋最早期的 8 張表，目前實際上有 20+ 張表/欄位）。
  詳見 `docs/database-schema.md`。

  未來待辦（今天不做）：把 schema 正式搬回
  `migrations/0001_init.sql, 0002_..., 0003_...` 這種遞增 migration 檔案。

## Critical user flows（明天一定要能動）

1. 開啟網站（`class-assistant.html` 能載入）
2. 自動判定目前是哪一堂課、哪個班級（`/api/schedule`）
3. 座位表顯示、拖曳/指定座位（`/api/seating`）
4. 點學生開啟 modal（roster + 頭像）
5. 加分／扣分／undo（`/api/behavior*`）
6. 遲到／缺席登記（`/api/attendance*`）
7. 個人紀錄（`/api/student-notes*`）
8. 學生照片顯示／上傳（`/api/students/photo`, `/api/photo*`）
9. 作品評分、班級進度、課表（`/api/submissions*`, `/api/class-progress*`）
10. 家庭功能（habits / study-habits / meal-times / bank）— 優先度較低，
    壞了不影響 Ruby 明天教學工作，但仍應保持正常

完整優先分級見 `docs/smoke-test.md`（P0/P1/P2）。

## Do not break

- 原網址、API path 不能變
- D1 資料不能丟、R2 照片不能動
- `applyBehaviorDelta()` / `undoBehavior()` / `toggleAttendance()` 這幾個
  已經是共用邏輯的 shared function，**不要**在別的地方重新複製一份同樣邏輯
- 不要在沒有把握全部驗證通過的情況下部署重構版本

## 這次（本輪安全重構）做了什麼

見對話最後的報告，或 git log（commit 訊息按 `docs:` / `refactor:` /
`test:` 分開，方便單獨 revert）。這次**沒有**變更任何 API path、
DB schema、UI 使用流程，也**沒有**部署到 production。
