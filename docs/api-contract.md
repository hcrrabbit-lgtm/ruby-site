# API Contract

> 這份文件的目的：**未來拆 backend 時，只要這份 contract 不變，內部可以
> 自由重構。** 任何修改都不應該改變這裡列出的 METHOD/PATH/INPUT/OUTPUT，
> 除非同時更新 `public/class-assistant.html` / `public/index.html` /
> `public/open/study-habits.html` / `public/activity-radar.html` 對應的呼叫端。

所有 API 都在 `worker/index.js` 的 `export default { fetch }` 裡用
`path === "..." && request.method === "..."` 這種寫法逐條比對，沒有用
router library。除了 `/api/usage` 之外，每個 `/api/*` 請求都會先呼叫
`ensureSchema(env)`（見 `docs/database-schema.md`）。

未列出方法/路徑的 `/api/*` 請求一律回傳 `404 { error: "not found" }`；
非 `/api/*` 的請求交給 `env.ASSETS.fetch(request)`（靜態檔案）。

錯誤一律回傳 `{ error: string }`，HTTP status 依情境為 400/404/413/415/500。

---

## 課表 / 班級

### GET /api/schedule
- input: 無
- output: `{ source: "d1", current: {classId,label}|null, classes: [{id,name}], schedule: [{classId,className,weekday,start,end,label}] }`
- tables: `classes`, `schedule`（唯讀）
- side effect: 無

### GET /api/roster?classId=
- output: `[{id, seat, name, photoKey}]`（依 seat 排序）
- tables: `students`（唯讀）

### DELETE /api/students  { studentId }
- 刪除學生本人 + 連帶清空其所有紀錄，並刪除 R2 大頭照
- writes: `attendance`, `behavior_events`, `submissions`, `student_notes`, `group_leaders`, `students`
- R2: 刪除 `photos/{photoKey}`（若有）

---

## 個人紀錄（student notes）

### GET /api/student-notes?studentId=
- output: `[{id, note, createdAt}]`（新到舊）
- tables: `student_notes`（唯讀）

### POST /api/student-notes  { studentId, note }
- output: `{ id, note, createdAt }`
- writes: `student_notes`

### DELETE /api/student-notes  { id }
- writes: `student_notes`

### GET /api/student-notes/class?classId=
- output: `[{studentId, note, createdAt}]`（依座號、新到舊排序），for 整班一次載入
- tables: `student_notes` join `students`（唯讀）

---

## 學生大頭照

### POST /api/students/photo?studentId=  (body: raw JPEG bytes)
- 限制：≤ 8MB、magic bytes 必須是 JPEG（`FF D8 FF`）
- output: `{ key }`
- R2 write: `photos/avatar/{studentId}-{timestamp}.jpg`
- writes: `students.photo_key`

---

## 遲到／缺席（attendance）

### GET /api/attendance?classId=&date=
- output: `{ [studentId]: status }`
- tables: `attendance` join `students`（唯讀）

### POST /api/attendance  { classId, date, action, ... }
三種 action：
- `action: "clearAll"` — 清空該班該日所有出席紀錄。writes: `attendance` (DELETE)
- `action: "setStatus"` { seats: number[], status } — 依座號設定狀態（upsert）。writes: `attendance`。回傳 `{ ok, notFound: number[] }`（查無座號的座位）
- `action: "clear"` { seats: number[] } — 清除指定座號當日紀錄。writes: `attendance` (DELETE)

### GET /api/attendance/summary?classId=
- output: `{ [studentId]: { late: number, absent: number } }`（累計次數）
- tables: `attendance` join `students`（唯讀）

### GET /api/attendance/detail?studentId=&status=
- output: `string[]`（該生該狀態的所有日期）
- tables: `attendance`（唯讀）

---

## 課堂表現加減分（behavior）

### GET /api/behavior?classId=&date=
- output: `{ [studentId]: { plus: number, minus: number } }`（當日累計）
- tables: `behavior_events` join `students`（唯讀）

### POST /api/behavior  { studentId, date, delta }
- writes: `behavior_events`（新增一筆事件，`created_at` = now）
- 前端呼叫點：`applyBehaviorDelta()`（共用邏輯，不要重複實作）

### POST /api/behavior/undo  { studentId, date }
- 刪除該生當日「最後一筆」加減分事件
- output: `{ ok, delta }`（被刪除的 delta 值，供前端還原畫面）；查無紀錄回 404
- writes: `behavior_events` (DELETE)
- 前端呼叫點：`undoBehavior()`（共用邏輯，不要重複實作）

### GET /api/behavior/summary?classId=
- output: `{ [studentId]: { plus, minus } }`（**全部日期**累計，非單日）
- tables: `behavior_events` join `students`（唯讀）

---

## 作業／作品項目（assignments）

> 設計限制：同名作業會**跨所有班級**各自建一筆（各班各一個 row，id 不同），
> 新增/改名/刪除都是「依目前名稱找出所有班級同名的那幾筆一起處理」，藉此讓
> 各班作業清單保持同步。拆 route 時務必保留這個 all-classes fan-out 行為。

### GET /api/assignments?classId=
- output: `[{id, name}]`（依 order_no 排序）

### POST /api/assignments  { classId, name }
- 對**所有**班級各建一筆同名作業（id 各自為 `hw_{timestamp}_{classId}`）
- output: `{ id, name }`（id 是呼叫時那個 classId 對應的那一筆）
- writes: `assignments`

### POST /api/assignments/rename  { id, name }
- 依 `id` 找出目前名稱，改掉**所有班級**同名那幾筆的 name
- writes: `assignments`

### DELETE /api/assignments  { id }
- 依 `id` 找出目前名稱，刪除**所有班級**同名的作業，以及對應的所有 `submissions`
- writes: `assignments`, `submissions` (DELETE)

### GET /api/assignments/scores?classId=
- output: `{ assignments: [{id,name}], scores: {[studentId]: {[assignmentId]: score}}, photos: {[studentId]: {[assignmentId]: string[]}} }`
- tables: `assignments`, `submissions` join `students`（唯讀）

---

## 作品照片 / 一般照片（R2）

### POST /api/photo?tier=&ext=jpg  (body: raw JPEG bytes)
- 限制：≤ 8MB、JPEG magic bytes
- output: `{ key }`
- R2 write: `photos/{encodeURIComponent(tier)}/{yyyyMM}/{timestamp}-{rand}.jpg`

### GET /api/photo/{key}
- 直接串流 R2 object；`Cache-Control: public, max-age=31536000, immutable`
- 查無回 404 plain text `"Not found"`（**不是** JSON，前端請注意）

---

## 作品評分紀錄（submissions）

### GET /api/submissions?assignmentId=
- output: `[{studentId, seat, name, tier, score, note, photoKeys: string[]}]`
- tables: `submissions` join `students`（唯讀）

### POST /api/submissions  { assignmentId, classId, seat, tier, score, note, photoKeys | photoKey }
- 依 `classId+seat` 找學生，upsert 該生此作業的評分（最多 3 張照片）
- id 規則：`{assignmentId}_{studentId}`
- writes: `submissions`

### DELETE /api/submissions  { assignmentId, studentId }
- writes: `submissions` (DELETE)

### POST /api/submissions/score  { assignmentId, studentId, score }
- upsert：只更新分數；若該生此作業尚無紀錄，建立一筆空白等第/照片的紀錄
- writes: `submissions`

### POST /api/submissions/note  { assignmentId, studentId, note }
- upsert：只更新備註；邏輯同上
- writes: `submissions`

---

## 班級進度 / 學期設定

### GET /api/settings/semester-start
- output: `{ date: string|null }`
- tables: `app_settings`（唯讀）

### POST /api/settings/semester-start  { date }
- writes: `app_settings`（key=`semester_start`）

### GET /api/class-progress?classId=&week=
- output: `{ note, updatedAt }`
- tables: `class_progress`（唯讀）；`week` 上限 21（`PROGRESS_WEEKS`）

### POST /api/class-progress  { classId, week, note }
- writes: `class_progress`（upsert）；`week` 必須在 1~21 之間

### GET /api/class-progress/overview
- output: `[{classId, week, note, updatedAt}]`（全部班級全部週次）
- tables: `class_progress`（唯讀）

---

## 座位表 / 小組長

### GET /api/seating?classId=
- output: `[{position, studentId}]`
- tables: `seat_positions`（唯讀）

### POST /api/seating  { classId, position, studentId }
- writes: `seat_positions`（upsert；`studentId` 可為 null 表示清空該座位）

### GET /api/group-leaders?classId=
- output: `string[]`（studentId 列表）
- tables: `group_leaders`（唯讀）

### POST /api/group-leaders  { classId, studentId, isLeader }
- writes: `group_leaders`（insert or delete，依 `isLeader`）

---

## 成績（即時計算，不落地）

### GET /api/grades?classId=&behaviorWeight=&weights=(JSON)
- 依權重即時算出每位學生的總分（作業加權平均 + 行為分 * behaviorWeight）
- output: `{ assignments: string[], behaviorWeight, results: [{seat,name,breakdown,behaviorRaw,finalScore}] }`
- tables: `students`, `assignments`, `submissions`, `behavior_events`（皆唯讀）
- side effect: **無**（`grade_weights` 表雖存在但此 route 不讀寫它）

---

## 開學前重置（危險操作）

### POST /api/admin/reset-test-data  { confirm: "RESET" }
- 必須帶正確的 `confirm` 字串，否則 400
- **會刪除**：所有 `submissions`、所有學生大頭照（含 R2 object）、所有
  `behavior_events`、所有 `attendance`
- **不會刪除**：班級、學生名冊、課表、作業欄位定義本身
- output: `{ ok, deletedSubmissions, deletedAvatars, deletedBehavior, deletedAttendance }`
- ⚠️ 前端目前是否有 UI 呼叫此 route 需再確認；即使有，也應該加上二次確認 UI

---

## 健康習慣（教師端 / index.html）

### GET /api/habits
### POST /api/habits  { name, child? }
### DELETE /api/habits  { id }
### GET /api/habits/log?date=
### POST /api/habits/log  { habitId, date }  — toggle 打卡
### GET /api/habits/month?month=(YYYY-MM)
- tables: `habits`, `habit_logs`
- 由共用工廠函式 `makeHabitHandlers("habits","habit_logs","habit")` 產生
  （不啟用 bonus 邏輯）

---

## 家庭端 — 讀書習慣（study-habits，走 /api/open/，繞過 Cloudflare Access）

> `/api/open/*` 之所以獨立出來，是刻意讓 `public/open/*.html` 不需要
> Cloudflare Access 登入就能用（給小孩自己用）。詳見
> `docs/security-audit.md` 的風險說明。

### GET /api/open/study-habits
### POST /api/open/study-habits  { name, child? }
### DELETE /api/open/study-habits  { id }
### GET /api/open/study-habits/log?date=
### POST /api/open/study-habits/log  { habitId, date }
### GET /api/open/study-habits/month?month=
- tables: `study_habits`, `study_habit_logs`
- 由 `makeHabitHandlers("study_habits","study_habit_logs","shabit", {bonusRescue:true})` 產生
- **與健康習慣的差異**：啟用「久違澆水」bonus — 若打卡日距離上次打卡（或
  建立日）≥ 7 天，這次打卡額外 +1 bonus 點數，寫入 `study_habit_logs.bonus`

### GET /api/open/study-habits/weekly-penalty?child=
- 每週日 22:00（台北時間）鎖定一次「本週有幾個習慣連續 7+ 天沒打卡」的懲罰計數；
  非週日造訪時，若上週日未曾結算，會用歷史紀錄回補結算（不受之後補打卡影響）
- writes: `weekly_penalties`（每個 child+週日 只會寫一次，之後永久鎖定）

### GET /api/open/study-habits/weekly-penalty/month?child=&month=
### GET /api/open/study-habits/weekly-penalty/history?child=
- tables: `weekly_penalties`（唯讀）

### GET /api/open/study-habits/bank?child=
- output: `{ totalPoints, totalPenalty, withdrawn, balance, amount, rate }`
- `totalPoints` = 打卡次數 + bonus 加總；`balance = max(0, totalPoints - totalPenalty - withdrawn)`；`amount = balance * BANK_RATE`（目前 `BANK_RATE = 1`，即 1 點 = NT$1）
- tables: `study_habit_logs`, `weekly_penalties`, `bank_withdrawals`（皆唯讀，即時計算）

### GET /api/open/study-habits/bank/history?child=
- tables: `bank_withdrawals`（唯讀，最多 50 筆）

### POST /api/open/study-habits/bank/withdraw  { child, points }
- 檢查 `points` 為正整數且不超過目前 balance，否則 400
- writes: `bank_withdrawals`

---

## 家庭端 — 吃飯時間（meal-times，同樣走 /api/open/）

### GET /api/open/meal-times?month=&child=
- tables: `meal_times`（唯讀）

### POST /api/open/meal-times  { child, meal, date, minutes }
- `meal` 必須是 `breakfast`/`lunch`/`dinner`；`minutes` 必須 ≥ 0
- writes: `meal_times`（upsert）

### GET /api/open/meal-times/weekly-status?child=
- 每週日 22:00（台北時間）結算一次「本週吃飯是否在 30 分鐘內完成」的達標狀態；
  門檻會隨連續達標/未達標滾動調整（見 `docs/database-schema.md` 的
  `meal_weekly_status` 說明）
- writes: `meal_weekly_status`（每個 child+週日只會寫一次）

### GET /api/open/meal-times/weekly-status/history?child=
- tables: `meal_weekly_status`（唯讀，最多 50 筆）

---

## 社群/學校公告來源（activity-radar.html）

### GET /api/community-sources
- output: `[{id, url, note, source_type}]`（新到舊）

### POST /api/community-sources  { url, note? }
- `source_type` 由 `classifySourceUrl(url)` 依網域自動判斷（`.edu.tw`→school，
  `.gov.tw`→government，其餘→community）
- writes: `community_sources`

### DELETE /api/community-sources  { id }
- writes: `community_sources`

---

## 系統 / 監控

### GET /api/usage
- 查詢 Cloudflare GraphQL Analytics API，估算本月 R2 用量與超額費用
- 需要 `env.CF_ANALYTICS_TOKEN` + `env.CF_ACCOUNT_ID`（未設定回 400）
- 唯一一支**不會**先跑 `ensureSchema()` 的 route（不碰 D1）
- 有對外呼叫：`https://api.cloudflare.com/client/v4/graphql`
- side effect: 無（唯讀查詢），但會消耗 Cloudflare Analytics API 的 rate limit
