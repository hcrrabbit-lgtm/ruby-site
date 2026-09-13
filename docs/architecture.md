# Architecture Inventory（架構盤點）

> 目的**不是文件本身**，而是防止未來拆檔時漏掉隱藏依賴。
> 這是「盤點」，本階段**沒有改變任何行為**。

## 目前檔案大小

| 檔案 | 大小（本次盤點時） | 說明 |
|---|---|---|
| `worker/index.js` | ~67 KB / 1382 行 | 唯一 Worker 入口，所有 route handler |
| `public/class-assistant.html` | ~110 KB / 2668 行 | 教師端主力頁面，inline `<script>` |

兩者都已進入「功能成熟，需要開始模組化」階段，但**今天不拆**（見
`SYSTEMS.md`）。

---

## Backend 功能索引（worker/index.js）

完整逐支 API 的 input/output/side-effect 請看 `docs/api-contract.md`；
這裡是「功能分類 + 對照表」，方便未來決定要拆成哪些 `routes/*.js`。

未來目標分類（尚未拆分，僅供規劃）：

```
schema      → SCHEMA_SQL, hashSchema(), ensureSchema()
helpers     → json(), taipeiNow(), pad(), taipeiDateStr(), addDaysStr(),
              isJpegMagicBytes(), classifySourceUrl()
schedule    → handleSchedule()
students    → handleRoster(), handleStudentDelete(),
              handleStudentPhotoUpload()
notes       → handleStudentNotesGet/Post/Delete/ForClass()
attendance  → handleAttendanceGet/Post/Summary/Detail()
behavior    → handleBehaviorGet/Post/Undo/Summary()
assignments → handleAssignmentsGet/Post/Rename/Delete(),
              handleAssignmentScores()
photos      → handlePhotoUpload(), handlePhotoGet()
submissions → handleSubmissionsGet/Post/Delete(),
              handleScoreUpdate(), handleNoteUpdate()
progress    → handleSemesterStartGet/Post(),
              handleClassProgressGet/Post/Overview()
seating     → handleSeatingGet/Post(),
              handleGroupLeadersGet/Post()
grades      → handleGrades()
admin       → handleResetTestData()
habits      → makeHabitHandlers() 工廠 → healthHabitHandlers,
              studyHabitHandlers
meals       → mealTimeHandlers, settleMealWeek(), mealWeeklyHandlers
penalties   → computeNeglectCount(), weeklyPenaltyHandlers
bank        → computeBankBalance(), bankHandlers
sources     → handleCommunitySourcesGet/Post/Delete()
usage       → handleUsage()（唯一對外呼叫 Cloudflare API 的 route）
```

### 明細表

| Domain | API | Function | Tables | Write? | R2? | 副作用 |
|---|---|---|---|---|---|---|
| schedule | `GET /api/schedule` | `handleSchedule` | classes, schedule | No | No | 無 |
| students | `GET /api/roster` | `handleRoster` | students | No | No | 無 |
| students | `DELETE /api/students` | `handleStudentDelete` | students, attendance, behavior_events, submissions, student_notes, group_leaders | Yes | Yes(刪) | 連帶刪除所有紀錄+照片 |
| students | `POST /api/students/photo` | `handleStudentPhotoUpload` | students | Yes | Yes(寫) | 更新頭像 |
| notes | `GET /api/student-notes` | `handleStudentNotesGet` | student_notes | No | No | 無 |
| notes | `POST /api/student-notes` | `handleStudentNotesPost` | student_notes | Yes | No | 無 |
| notes | `DELETE /api/student-notes` | `handleStudentNotesDelete` | student_notes | Yes | No | 無 |
| notes | `GET /api/student-notes/class` | `handleStudentNotesForClass` | student_notes, students | No | No | 無 |
| attendance | `GET /api/attendance` | `handleAttendanceGet` | attendance, students | No | No | 無 |
| attendance | `POST /api/attendance` | `handleAttendancePost` | attendance | Yes | No | 3 種 action：clearAll/setStatus/clear |
| attendance | `GET /api/attendance/summary` | `handleAttendanceSummary` | attendance, students | No | No | 無 |
| attendance | `GET /api/attendance/detail` | `handleAttendanceDetail` | attendance | No | No | 無 |
| behavior | `GET /api/behavior` | `handleBehaviorGet` | behavior_events, students | No | No | 無 |
| behavior | `POST /api/behavior` | `handleBehaviorPost` | behavior_events | Yes | No | 無 |
| behavior | `POST /api/behavior/undo` | `handleBehaviorUndo` | behavior_events | Yes(刪) | No | 刪最後一筆 |
| behavior | `GET /api/behavior/summary` | `handleBehaviorSummary` | behavior_events, students | No | No | 無 |
| assignments | `GET /api/assignments` | `handleAssignmentsGet` | assignments | No | No | 無 |
| assignments | `POST /api/assignments` | `handleAssignmentsPost` | assignments, classes | Yes | No | fan-out 到所有班級 |
| assignments | `POST /api/assignments/rename` | `handleAssignmentsRename` | assignments | Yes | No | fan-out 到所有班級 |
| assignments | `DELETE /api/assignments` | `handleAssignmentsDelete` | assignments, submissions | Yes(刪) | No | fan-out 刪除 |
| assignments | `GET /api/assignments/scores` | `handleAssignmentScores` | assignments, submissions, students | No | No | 無 |
| photos | `POST /api/photo` | `handlePhotoUpload` | — | No | Yes(寫) | 8MB/JPEG 檢查 |
| photos | `GET /api/photo/:key` | `handlePhotoGet` | — | No | Yes(讀) | 無 |
| submissions | `GET /api/submissions` | `handleSubmissionsGet` | submissions, students | No | No | 無 |
| submissions | `POST /api/submissions` | `handleSubmissionsPost` | submissions, students | Yes | No | upsert |
| submissions | `DELETE /api/submissions` | `handleSubmissionsDelete` | submissions | Yes(刪) | No | 無 |
| submissions | `POST /api/submissions/score` | `handleScoreUpdate` | submissions | Yes | No | upsert |
| submissions | `POST /api/submissions/note` | `handleNoteUpdate` | submissions | Yes | No | upsert |
| progress | `GET /api/settings/semester-start` | `handleSemesterStartGet` | app_settings | No | No | 無 |
| progress | `POST /api/settings/semester-start` | `handleSemesterStartPost` | app_settings | Yes | No | 無 |
| progress | `GET /api/class-progress` | `handleClassProgressGet` | class_progress | No | No | 無 |
| progress | `POST /api/class-progress` | `handleClassProgressPost` | class_progress | Yes | No | upsert |
| progress | `GET /api/class-progress/overview` | `handleClassProgressOverview` | class_progress | No | No | 無 |
| seating | `GET /api/seating` | `handleSeatingGet` | seat_positions | No | No | 無 |
| seating | `POST /api/seating` | `handleSeatingPost` | seat_positions | Yes | No | upsert |
| seating | `GET /api/group-leaders` | `handleGroupLeadersGet` | group_leaders | No | No | 無 |
| seating | `POST /api/group-leaders` | `handleGroupLeadersPost` | group_leaders | Yes | No | insert/delete |
| grades | `GET /api/grades` | `handleGrades` | students, assignments, submissions, behavior_events | No | No | 即時計算，不落地 |
| admin | `POST /api/admin/reset-test-data` | `handleResetTestData` | submissions, students, behavior_events, attendance | Yes(刪) | Yes(刪) | **危險**：需 `confirm:"RESET"` |
| habits | `GET/POST/DELETE /api/habits*` | `healthHabitHandlers.*` | habits, habit_logs | Yes(依方法) | No | 無 bonus |
| habits(open) | `GET/POST/DELETE /api/open/study-habits*` | `studyHabitHandlers.*` | study_habits, study_habit_logs | Yes(依方法) | No | 有 bonus 邏輯 |
| meals | `GET/POST /api/open/meal-times*` | `mealTimeHandlers.*` | meal_times | Yes(依方法) | No | 無 |
| meals | `GET /api/open/meal-times/weekly-status*` | `mealWeeklyHandlers.*` | meal_weekly_status, meal_times | Yes(check 時) | No | 週日 22:00 結算 |
| penalties | `GET /api/open/study-habits/weekly-penalty*` | `weeklyPenaltyHandlers.*` | weekly_penalties, study_habits, study_habit_logs | Yes(check 時) | No | 週日 22:00 結算 |
| bank | `GET/POST /api/open/study-habits/bank*` | `bankHandlers.*` | study_habit_logs, weekly_penalties, bank_withdrawals | Yes(withdraw 時) | No | 無 |
| sources | `GET/POST/DELETE /api/community-sources` | `handleCommunitySourcesGet/Post/Delete` | community_sources | Yes(依方法) | No | 無 |
| usage | `GET /api/usage` | `handleUsage` | — | No | No | 呼叫外部 Cloudflare GraphQL API |

---

## 前端功能索引（public/class-assistant.html）

按 UI 分類整理，目的是抓出「同一個 business logic 是不是被複製了好幾份」。
**已確認良好的共用邏輯（不要重複實作）**：`applyBehaviorDelta()`、
`undoBehavior()`、`toggleAttendance()`。

| UI 功能 | 主要 JS function | 呼叫的 API |
|---|---|---|
| 課表/自動判斷目前課堂 | `tryFetchSchedule()`, `renderHeader()`, `renderWeeklySchedule()` | `GET /api/schedule` |
| 班級切換 | `renderClassButtons()`, `selectClass()` | 無（純前端狀態，觸發其他 loader） |
| 班級名冊載入 | `loadRosterFromApi()`, `studentsFor()`, `loadRoster()` | `GET /api/roster` |
| 座位表顯示/拖曳 | `loadSeating()`, `saveSeat()`, `renderSeatingChart()`, `updateSeatingLockUI()` | `GET/POST /api/seating` |
| 小組長 | `loadGroupLeaders()`, `toggleGroupLeader()` | `GET/POST /api/group-leaders` |
| 學生 grid / 點學生 | `renderStudentsGrid()`, `renderRoster()` | （靠已載入的 roster/attendance/behavior 資料渲染） |
| 座位分數 modal（點學生後彈出） | `openSeatScore()`, `updateSeatScoreModal()` | 內部呼叫下方加減分/遲到/個人紀錄邏輯 |
| 加減分 | `applyBehaviorDelta()` **(共用)** | `POST /api/behavior` |
| 加減分復原 | `undoBehavior()` **(共用)** | `POST /api/behavior/undo` |
| 遲到／缺席 | `toggleAttendance()` **(共用)**, `loadAttendanceAndBehaviorForDate()` | `POST /api/attendance`, `GET /api/attendance` |
| 遲到/缺席明細 | `openAttendanceDetail()` | `GET /api/attendance/detail` |
| 遲到累計 | `loadLateTotals()` | `GET /api/attendance/summary` |
| 個人紀錄（座位分數 modal 內展開） | `refreshSeatNotes()`（在 `openSeatScore()` 內部） | `GET/POST/DELETE /api/student-notes` |
| 個人紀錄（獨立 modal，舊路徑） | `openStudentNotes()` 內部 `refresh()` | `GET/POST/DELETE /api/student-notes` |
| 個人紀錄匯出 | `downloadStudentNotesText()` | `GET /api/student-notes/class` |
| 學生大頭照顯示/拍照上傳 | `openStudentPhoto()`, `openAvatarCamera()`, `uploadAvatar()` | `POST /api/students/photo` |
| 學生刪除（轉學） | 在 `openStudentPhoto()` 內的刪除按鈕事件（`photoModalDeleteBtn`） | `DELETE /api/students` |
| 頭像批次下載 | `downloadAvatarPhotos()` | `GET /api/photo/:key`（迴圈） |
| 作品照片拍照/上傳 | `startArtworkCapture()`, `addAnotherArtworkPhoto()`, `handlePickedFiles()`, `normalizeToJpeg()` | `POST /api/photo` |
| 作品照片檢視 | `openArtworkPhoto()` | `GET /api/photo/:key` |
| 作品照片批次下載 | `downloadArtworkPhotos()` | `GET /api/photo/:key`（迴圈） |
| 作業清單/切換 | `renderAssignmentButtons()`, `loadAssignments()` | `GET /api/assignments` |
| 新增作業 | `openAssignForm()` | `POST /api/assignments` |
| 作業改名/刪除 | 在 `renderStatsTable()` 內的 `.stats-rename-btn` / `[data-delete]` 按鈕事件 | `POST /api/assignments/rename`, `DELETE /api/assignments` |
| 作品評分主表 | `renderArtRoster()`, `loadSubmissionsForCurrentAssignment()` | `GET /api/submissions`, `POST /api/submissions` |
| 作品分數即時更新 | （評分表格 input 事件） | `POST /api/submissions/score` |
| 作品備註即時更新 | （評分表格 textarea 事件） | `POST /api/submissions/note` |
| 作品刪除 | （評分表格刪除按鈕事件） | `DELETE /api/submissions` |
| 統計表（班級總覽） | `loadStatsData()`, `renderStatsTable()`, `statsBehaviorFor/LateFor/AbsentFor/ValueFor()`, `getStatsList()` | `GET /api/behavior/summary`, `GET /api/assignments/scores` |
| 統計表排序/匯出 | `exportStatsCsv()` | （純前端，讀取已載入的 statsData） |
| 班級進度 | `computeCurrentWeek()`, `formatWeekRange()`, `renderProgressTable()`, `loadProgressOverview()` | `GET /api/class-progress/overview`, `POST /api/class-progress` |
| 學期起始日設定 | `loadSemesterStart()` | `GET/POST /api/settings/semester-start` |
| 班級進度備註（單一輸入框顯示） | `loadClassNote()` | `GET/POST /api/class-progress`（與「班級進度」表共用同一組 API，非獨立的 `class_notes` 表） |
| 週次/課表輔助 | `semesterWeekOf()`, `holidayOn()`, `examOn()`, `weekdayLabel()`, `classWeekdayLabel()`, `shortClassName()` | 無（純函式） |
| 音效提示 | `playBeep()` | 無（純函式，Web Audio） |
| 日期輔助 | `todayStr()`, `pad()`, `renderNowDate()` | 無（純函式，**與 worker 端同名 `pad()` 各自獨立實作，未共用**） |
| API wrapper | `apiGet()`, `apiPost()`, `apiDelete()` | 包裝所有 `fetch()` 呼叫 |
| 圖片處理輔助 | `loadImageFromBlob()`, `normalizeToJpeg()` | 無（純函式，canvas 轉檔） |
| HTML escape / 日期格式 | `escapeHtml()`, `formatNoteDate()` | 無（純函式） |

> 註：本表已對照原始碼核對主要觸發點，但仍是靜態閱讀，非實機操作驗證。
> **拆檔前務必用瀏覽器實際操作一次對照，不要只憑這份文件動刀。**

---

## 其他前端頁面

| 頁面 | 功能 | 對應 API |
|---|---|---|
| `public/index.html` | 首頁 + 健康習慣 UI | `GET/POST/DELETE /api/habits*` |
| `public/open/study-habits.html` | 家庭端：讀書習慣、吃飯時間、週罰點、銀行提領 | `/api/open/*`（study-habits, meal-times, weekly-penalty, bank） |
| `public/open/cathy.html`, `public/open/rina.html` | 導向殼頁面 | 無直接 API 呼叫（導向 study-habits.html） |
| `public/activity-radar.html` | 社群/學校公告來源列表 | `GET/POST/DELETE /api/community-sources` |
| `public/go-tournaments.html` | 靜態頁面 | 無 API 呼叫 |
