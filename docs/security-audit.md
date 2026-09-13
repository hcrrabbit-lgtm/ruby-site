# Security Audit（現況盤點，僅盤點不修）

> 本次只做**稽核**，不重做 auth architecture。若現有 Cloudflare Access
> 設定正常運作，今晚不動它。這份文件的目的是讓後續（不急）可以按優先級處理。

## 重要前提：程式碼裡完全沒有 authentication 邏輯

逐行檢查過 `worker/index.js`，**沒有找到任何**：
- 檢查 `Cf-Access-Jwt-Assertion` 或其他 Access header 的程式碼
- API key / session / cookie 驗證
- 依 IP、Referer、Origin 的存取限制

也就是說：**這個 repo 本身完全不做身分驗證**。目前唯一可能的保護層是
Cloudflare Zero Trust Access，設定在 Cloudflare Dashboard，**不在這個
repo 裡**，所以無法從程式碼稽核確認它是否存在、涵蓋範圍是什麼。

程式碼裡唯一一句相關註解：

```js
// served from public/open/ and bypassed from Cloudflare Access, so kept under /api/open/
```

這暗示：**其餘 `/api/*`（不含 `/api/open/*`）預期是被 Cloudflare Access
擋著的**，而 `/api/open/*` 是刻意設計成公開（給小孩不登入就能用）。
但這只是從一句註解推論，**需要 Ruby 或有 Cloudflare Dashboard 權限的人
親自確認**：

- [ ] 登入 Cloudflare Dashboard → Zero Trust → Access → Applications，
      確認確實有一條 Application 涵蓋這個 Worker 的 hostname，且路徑規則
      正確排除了 `/api/open/*`、`/open/*`
- [ ] 確認該 Access Application 的 policy 是「限定特定 email/群組」而非
      「allow everyone」
- [ ] 確認靜態頁面本身（例如直接打開 `class-assistant.html`）也在
      Access 涵蓋範圍內，不是只有 `/api/*` 被擋、頁面本身公開

**在以上勾選項確認之前，以下風險評級都是「假設 Access 正常運作」的前提下
給的評級；如果 Access 沒有涵蓋這個 Worker，幾乎所有項目都要升級為
Critical。**

---

## Critical

### C1. `/api/admin/reset-test-data` 的確認碼是寫死在公開原始碼裡的字串
- `confirm !== "RESET"` 才擋，但 `"RESET"` 這個字串本身就在
  GitHub 上的 `worker/index.js` 裡可以直接看到。
- 這不是密碼，只是防手滑的機制。**如果 Access 沒有涵蓋這支 API**，
  任何知道 URL 的人都可以清空所有作品照片、頭像、加減分、出席紀錄。
- 建議（未來處理，今天不做）：即使有 Access，也應該讓這支 API 需要額外
  的一次性 token 或改成兩階段確認（例如先 GET 拿到一次性 token 再 POST），
  降低「Access session 沒登出、電腦被別人用」時的誤觸/濫用風險。

### C2. 若 Access 未涵蓋整個 Worker：學生個資完全公開可寫
系統儲存學生姓名、大頭照、遲到缺席、行為紀錄、成績、個人紀錄。
程式碼本身對這些 API **沒有任何存取控制**，完全依賴外部 Cloudflare
Access。這是單點防線（single point of failure）：Access 設定一旦有
疏漏（例如新增 route 忘記加進規則、規則寫錯 hostname），學生個資就會
直接暴露且可被任意寫入/刪除。

---

## High

### H1. `activity-radar.html` 對 `community_sources` 的 `url`/`note` 有 stored XSS
`public/activity-radar.html` 第 177 行：
```js
`<a href="${s.url}" target="_blank" ...>${s.note || s.url}</a>`
```
`s.url`、`s.note` 直接來自 `POST /api/community-sources` 的使用者輸入，
未經 `escapeHtml()` 就塞進 `innerHTML`。相較之下，`class-assistant.html`
和 `index.html` 對所有使用者輸入（學生姓名、備註、習慣名稱）都正確使用
`escapeHtml()`，只有這個頁面漏掉。
- 若 `/api/community-sources` 的 POST 是公開（未受 Access 保護，例如
  設計上就是給非登入使用者回報公告連結），任何人都可以存入
  `<script>...</script>` 或 `javascript:` 開頭的 `url`，之後任何人打開
  `activity-radar.html` 就會執行該腳本（stored XSS）。
- 即使受 Access 保護，這仍是可被同帳號誤貼的惡意連結執行的風險，建議
  之後修：把第 177 行的 `s.url`、`s.note` 換成 `escapeHtml()`，並且
  `href` 屬性額外驗證 scheme 只能是 `http:`/`https:`（避免 `javascript:`）。
- **今天不動**（避免臨時改公開頁面造成新問題），列為下次小步重構的
  第一個候選（風險低、影響面小、修法明確）。

### H2. 沒有 rate limiting / 上傳大小以外的濫用防護
`/api/behavior`、`/api/attendance` 等寫入型 API 沒有任何頻率限制。
若 Access 之外還有暴露面（例如忘記登出的裝置、共用電腦），惡意或誤觸
的高頻請求可能大量灌爆 `behavior_events` / `attendance` 等表。目前
D1/Cloudflare 方案下影響有限，但屬於已知缺口。

---

## Medium

### M1. `/api/photo/:key` 用「猜不到的檔名」而非權限做保護
照片路徑格式如 `avatar/{studentId}-{timestamp}.jpg`、
`{tier}/{yyyyMM}/{timestamp}-{rand}.jpg`。這是「obscurity」而非真正授權：
只要 Access 涵蓋 `/api/photo/*`，沒有額外問題；但若這條路徑被排除在
Access 之外（例如為了讓某些分享情境不需登入也能看圖），`studentId` 的
命名規則（如 `s1`,`s2`...，見 `migrations/0001_init.sql` 的種子資料）
加上時間戳記，存在被有限度暴力枚舉的可能性。目前沒有證據顯示
`/api/photo/*` 被排除在 Access 之外，先記錄。

### M2. `GET /api/photo/:key` 404 回傳格式與其他 API 不一致
回傳 `new Response("Not found", { status: 404 })`（純文字），其餘 API
一律回傳 JSON `{ error }`。不是安全問題，但前端若用 `.json()` 解析會
噴例外，未來拆分/加防護層時容易忽略。已記錄在
`docs/api-contract.md` 的 `GET /api/photo/{key}` 條目。

### M3. `/api/usage` 會把 `env.CF_ANALYTICS_TOKEN` 用在 outbound 請求
目前寫法沒有把 token 洩漏到 response 裡（只回傳彙總數字），沒發現直接
問題；但這是唯一一支會對外（Cloudflare API）發請求的 route，若未來要加
更多外部整合，這裡是需要特別小心 token 不外洩的地方。

---

## Low

### L1. `worker/index.js` 的 SQL 都用參數化查詢（`.bind()`）
稽核過程中沒有發現字串拼接使用者輸入組 SQL 的情況（`makeHabitHandlers`
裡的 table 名稱是寫死的常數，不是使用者輸入）。**沒有發現 SQL injection
風險**，這裡記錄是為了讓下次稽核不用重查一次。

### L2. CORS 沒有特別設定
`json()` 沒有加 `Access-Control-Allow-Origin` 之類的 header。因為前端
與 API 同源（同一個 Worker 提供靜態檔案與 API），這對目前用法沒有影響；
只是如果未來要讓其他網域呼叫這些 API，需要額外處理。

---

## 今天不做的事（明確排除）

- 不新增/更改 Cloudflare Access 規則
- 不在 `worker/index.js` 加自製的 auth middleware
- 不修 `activity-radar.html` 的 XSS（H1）——雖然修法明確，但今天的目標是
  「不碰任何目前運作中的前端頁面」，這個修正排進下一輪小步重構
- 不對 `/api/admin/reset-test-data` 改架構（C1）——先記錄，之後跟 Ruby
  討論要不要加兩階段確認
