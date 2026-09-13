# Review 交辦 — 安全式重構第一輪（給 TT）

> 狀態：**尚未 merge、尚未 deploy**。這份文件整理目前 branch 上的所有變更，
> 請 review 完後再決定下一步（merge / 補測試 / 退回修改）。

## 基本資訊

| 項目 | 內容 |
|---|---|
| Repo | `hcrrabbit-lgtm/ruby-site` |
| 開發分支 | `claude/sharp-heisenberg-qfzplx` |
| 對比基準（`main` HEAD，重構前） | `6555204e8dcfdae939d3b63accaa34e2660d3e0b` |
| 目前分支 HEAD | `7f6ab4b6bb9428fb6a2888bffda268b6d51f61c7` |
| 是否 merge 進 main | **否** |
| 是否已 deploy | **否** |
| 是否碰過 production D1 / R2 | **否** |

Rollback 目標（若之後 merge/deploy 後出問題）：`6555204e8dcfdae939d3b63accaa34e2660d3e0b`。

## Commit 列表（6 個，由舊到新）

```
5c49c24 docs: add SYSTEMS.md overview and current database schema doc
0d32459 docs: add API contract and backend/frontend architecture inventory
b250ab5 docs: add security audit (auth, XSS, admin-reset exposure)
5fd2d5f test: add production smoke-test checklist and refactor safety log
3bb2558 refactor: extract pure response/time helpers into worker/lib/
7f6ab4b refactor: extract isJpegMagicBytes/classifySourceUrl into worker/lib/validation.js
```

刻意拆成小 commit，方便單獨 revert：前 4 個是純文件，後 2 個才是 code 改動。

## Diff 摘要（`main` HEAD → 目前分支）

```
 SYSTEMS.md               |  82 ++++++++++++
 docs/api-contract.md     | 335 +++++++++++++++++++++++++++++++++++++++++++++++
 docs/architecture.md     | 177 +++++++++++++++++++++++++
 docs/database-schema.md  |  90 +++++++++++++
 docs/refactor-log.md     |  51 ++++++++
 docs/security-audit.md   | 136 +++++++++++++++++++
 docs/smoke-test.md       |  93 +++++++++++++
 worker/index.js          |  39 +-----
 worker/lib/response.js   |   8 ++
 worker/lib/time.js       |  17 +++
 worker/lib/validation.js |  17 +++
 11 files changed, 1010 insertions(+), 35 deletions(-)
```

### 檔案分類

| 檔案 | 類型 | 重點 |
|---|---|---|
| `SYSTEMS.md` | 純文件（新增） | 專案總覽、production 拓樸、critical flows |
| `docs/database-schema.md` | 純文件（新增） | 目前實際 D1 schema（`worker/index.js` 的 `SCHEMA_SQL` 為 SSOT），標明 `migrations/0001_init.sql` 已過時 |
| `docs/api-contract.md` | 純文件（新增） | 每支 `/api/*` 的 method/input/output/tables/side-effect |
| `docs/architecture.md` | 純文件（新增） | Backend function 索引 + `class-assistant.html` 的 UI→API 對照表 |
| `docs/security-audit.md` | 純文件（新增） | Critical/High/Medium/Low 分級稽核（見下方「需要 TT 特別注意」） |
| `docs/smoke-test.md` | 純文件（新增） | P0/P1/P2 smoke test checklist + rollback 流程 |
| `docs/refactor-log.md` | 純文件（新增） | 本輪安全基線記錄（起始 SHA、驗證方式、限制） |
| `worker/index.js` | **Production code（修改）** | 移除 6 個函式定義，改為 3 行 `import`，**沒有動任何 route handler、沒有動 `hashSchema`/`ensureSchema`/`SCHEMA_SQL`** |
| `worker/lib/response.js` | **Production code（新增）** | `json()`（純函式） |
| `worker/lib/time.js` | **Production code（新增）** | `taipeiNow/pad/taipeiDateStr/addDaysStr`（純函式） |
| `worker/lib/validation.js` | **Production code（新增）** | `isJpegMagicBytes/classifySourceUrl`（純函式） |

**`public/class-assistant.html` 完全沒有改動**（0 行 diff）。

### Production code 實際變動量

- `worker/index.js`：淨變動 39 行（+3 import / −36 舊定義），**route handler 邏輯 0 行變動**
- 新增 3 個 `worker/lib/*.js`，共 42 行，全部是「原地搬移」的純函式，函式本體逐字元未變
- **API path、method、input/output 格式：完全未改**
- **D1 schema：完全未改**（`SCHEMA_SQL` 一行沒動，沒跑任何 migration）
- **R2：完全未改**（`env.PHOTOS` 相關呼叫一行沒動）

## 驗證結果（本輪，沙盒環境限制說明見下）

已完成：
- `node --check`：`worker/index.js`、`worker/lib/response.js`、`worker/lib/time.js`、`worker/lib/validation.js` 全數語法通過
- Dynamic import 整支 `worker/index.js`：resolve 成功，**確認無 circular import**（兩個/三個 lib 檔彼此、對 index.js 皆零 import）
- 逐一比對每個抽出函式的輸出 vs. 手算預期值：
  - `taipeiNow()`：UTC+8 換算正確
  - `pad()`：補零正確
  - `taipeiDateStr()` / `addDaysStr()`：日期字串與加減天數正確（含跨月案例）
  - `isJpegMagicBytes()`：真陽性（合法 JPEG bytes）與假陰性（非 JPEG bytes）都正確
  - `classifySourceUrl()`：`.edu.tw` → school、`.gov.tw` → government、其他 → community、無效 URL → community（fallback），皆正確
- 用 mocked D1 + `env.ASSETS` 跑了 14 條 GET route（`/api/schedule`、`/api/roster`、`/api/attendance/summary`、`/api/behavior/summary`、`/api/assignments`、`/api/assignments/scores`、`/api/seating`、`/api/group-leaders`、`/api/class-progress/overview`、`/api/student-notes/class`、`/api/habits`、`/api/open/study-habits`、`/api/community-sources`、`/api/settings/semester-start`），全部回傳 200、無例外
- 額外驗證 `POST /api/students/photo`：合法 JPEG bytes 能通過 `isJpegMagicBytes` 檢查（往下走到 R2 寫入才因測試環境沒 mock `PHOTOS` binding而 500，屬預期的測試限制，不是程式問題）；非法 bytes 正確回傳 415

**未完成**（沙盒沒有 production Cloudflare 存取權，也沒裝 `wrangler`）：
- 沒有跑過真正的 `wrangler dev` 或部署到 staging
- `docs/smoke-test.md` 裡需要瀏覽器互動的項目（座位表拖曳、modal、拍照、undo 畫面回饋等）**完全沒有實機測試過**，這些項目狀態是「未測」而非「PASS」

## 需要 TT 特別注意的地方

1. **`docs/security-audit.md` 的 Critical/High 項目是稽核發現，不是這輪改的東西**：
   - 程式碼裡完全沒有 authentication 邏輯，保護完全依賴 repo 外部的 Cloudflare
     Access 設定（無法從程式碼確認是否正確涵蓋所有 `/api/*`）
   - `activity-radar.html` 有一個既有的 stored XSS（`community_sources` 的
     `url`/`note` 渲染時沒有 `escapeHtml()`），這次**沒有修**，只記錄
   - `/api/admin/reset-test-data` 的確認碼 `"RESET"` 是寫死在公開原始碼裡
   - 這些都列為「今天不做」，但建議 TT review 時一併看一下優先順序是否同意
2. **`hashSchema()` 沒有跟著抽出去**：雖然它也是純函式，但因為跟
   `SCHEMA_SQL`/`ensureSchema()` 綁在一起（schema bootstrap 的一部分），
   刻意留在 `worker/index.js`，避免混到「今天不重新設計 migration system」
   的範圍。這是判斷取捨，TT 可以檢查是否同意這個分類方式。
3. **`docs/architecture.md` 前端函式對照表是靜態閱讀 + grep 反推**，只對照過
   幾個關鍵觸發點（刪除學生、作業改名/刪除），沒有逐行核對所有 event
   listener。如果之後要依這份文件拆 `class-assistant.html`，建議先實機操作
   一輪核對。

## 給 TT 的建議 review 順序

1. 先看 `docs/refactor-log.md` 了解這輪的範圍界線
2. 看 `worker/index.js` 的 diff（`git diff 6555204 HEAD -- worker/index.js`）
   + 3 個新的 `worker/lib/*.js`，確認搬移的函式本體逐字元一致
3. 看 `docs/api-contract.md` / `docs/database-schema.md` 是否與你認知的
   production 現況一致（尤其 schema 部分，因為 SSOT 目前在
   `worker/index.js` 而非 migrations）
4. 決定 `docs/security-audit.md` 的項目要不要排進下一輪處理
5. 若同意這輪的 code 改動，**請安排一次真人瀏覽器實測**
   （`docs/smoke-test.md` 的 P0 清單），通過後才 merge + deploy

## TT review 完成後

請把結果（同意/退回/需要補充的地方）回覆回來，我再依結果：
- 若通過 → 準備 merge 到 `main` 的方式（一般 merge 還是走 PR，看你們習慣）
  以及部署後的 smoke test
- 若退回 → 針對指出的問題修改，重新跑一次驗證
