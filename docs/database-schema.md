# Database Schema（現況文件）

> **重要**：`migrations/0001_init.sql` 已經過時，不是完整的 production schema。
> 現階段 runtime schema bootstrap 位於 `worker/index.js` 的 `SCHEMA_SQL`
> 常數（搭配 `ensureSchema()` 函式在每次 Worker 冷啟動時執行）。
> 這份文件依據 `worker/index.js` 目前的 `SCHEMA_SQL` + 後續的
> `ALTER TABLE` / 一次性 backfill 邏輯整理，代表**目前 production 實際的
> 資料庫結構**。

D1 database: `ruby-class-db`（binding `DB`）。

## 為什麼 SSOT 變成 worker/index.js

新增 table / column 目前的做法是：直接改 `SCHEMA_SQL`，然後在
`ensureSchema()` 裡用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD
COLUMN`（失敗就吞掉，代表欄位已存在）在啟動時自動補齊，而不是寫新的
migration 檔案。這樣做的好處是「Ruby 明天打開網站，資料庫自動補好新欄位」，
不需要手動跑 migration；壞處是 `migrations/0001_init.sql` 沒有同步更新，
變成兩份不一致的定義。**這是已知技術債，今天不處理**（見下方「未來待辦」）。

## 目前完整 table 清單

| Table | 用途 | 主要欄位 | 備註 |
|---|---|---|---|
| `classes` | 班級 | `id` (PK), `name` | |
| `students` | 學生名冊 | `id` (PK), `class_id`, `seat`, `name`, `photo_key` | `photo_key` 由 `ALTER TABLE` 後補 |
| `schedule` | 課表 | `id` (PK), `class_id`, `weekday`, `start`, `end`, `label` | |
| `attendance` | 遲到／缺席 | `id` (PK), `student_id`, `date`, `status`, UNIQUE(`student_id`,`date`) | `status`: `'late'` \| `'absent'` |
| `behavior_events` | 加減分紀錄 | `id` (PK), `student_id`, `date`, `delta`, `created_at` | 每筆一次加/扣分事件，undo 用刪最後一筆實作 |
| `assignments` | 作業／作品項目 | `id` (PK), `class_id`, `name`, `order_no` | 同名作業會跨所有班級各建一筆，保持同步 |
| `submissions` | 作業評分＋作品照片 | `id` (PK, = `assignmentId_studentId`), `assignment_id`, `student_id`, `tier`, `score`, `note`, `photo_key`, `photo_key_2`, `photo_key_3`, UNIQUE(`assignment_id`,`student_id`) | 最多 3 張照片；`photo_key_2/3` 由 `ALTER TABLE` 後補 |
| `grade_weights` | 成績權重 | `class_id` (PK), `behavior_weight`, `assignment_weights` (JSON) | **目前程式碼未見任何 route 讀寫此表**（見下方待確認） |
| `class_notes` | 舊版單筆班級備註 | `class_id` (PK), `note`, `updated_at` | 已被 `class_progress` 取代；舊資料在啟動時一次性搬進 `class_progress` week 1，之後保留表但不再主動寫入 |
| `class_progress` | 班級每週進度 | `class_id`, `week`, `note`, `updated_at`, PRIMARY KEY(`class_id`,`week`) | 週次上限見 `PROGRESS_WEEKS = 21` |
| `app_settings` | 系統設定 / 一次性 backfill 旗標 | `key` (PK), `value` | 同時被拿來存 `schema_bootstrap_done`、`semester_start`、多個一次性 backfill 完成旗標 |
| `seat_positions` | 座位表座位配置 | `class_id`, `position`, `student_id`, PRIMARY KEY(`class_id`,`position`) | |
| `group_leaders` | 小組長標記 | `class_id`, `student_id`, PRIMARY KEY(`class_id`,`student_id`) | |
| `student_notes` | 學生個人紀錄 | `id` (PK), `student_id`, `note`, `created_at` | |
| `community_sources` | 社群/學校公告來源 | `id` (PK), `url` (UNIQUE), `note`, `source_type`, `created_at` | `source_type`: `school` \| `government` \| `community`，由 `classifySourceUrl()` 依網域判斷 |
| `habits` | 健康習慣（教師端／`index.html`） | `id` (PK), `name`, `order_no`, `created_at`, `child` | |
| `habit_logs` | 健康習慣打卡紀錄 | `id` (PK), `habit_id`, `date`, `bonus`, UNIQUE(`habit_id`,`date`) | `bonus` 欄位由 `ALTER TABLE` 後補，健康習慣目前不啟用 bonus 邏輯 |
| `study_habits` | 讀書習慣（家庭端） | `id` (PK), `name`, `order_no`, `created_at`, `child` | |
| `study_habit_logs` | 讀書習慣打卡紀錄 | `id` (PK), `habit_id`, `date`, `bonus`, UNIQUE(`habit_id`,`date`) | 啟用「久違澆水」bonus 邏輯（超過 7 天沒打卡後補打卡 +1） |
| `meal_times` | 吃飯時間紀錄 | `id` (PK), `child`, `meal`, `date`, `minutes`, UNIQUE(`child`,`meal`,`date`) | `meal`: `breakfast` \| `lunch` \| `dinner` |
| `weekly_penalties` | 讀書習慣週罰點 | `child`, `week_date`, `count`, PRIMARY KEY(`child`,`week_date`) | 每週日 22:00（台北時間）結算一次，鎖定後不再改變 |
| `bank_withdrawals` | 點數銀行提領紀錄 | `id` (PK), `child`, `points`, `amount`, `date`, `created_at` | |
| `meal_weekly_status` | 吃飯時間週達標狀態 | `child`, `week_date`, `total`, `success`, `threshold`, `passed`, `level_after`, PRIMARY KEY(`child`,`week_date`) | 門檻會隨週次滾動調整（連續達標 +1，沒達標 -1，下限 `total*0.5`） |

以及一個 index：`idx_community_sources_url` (UNIQUE on `community_sources.url`)。

## 一次性 backfill / migration 旗標（存在 `app_settings`）

這些都是「跑過一次就不再重跑」的資料修正，寫在 `ensureSchema()` 裡：

| Key | 做什麼 |
|---|---|
| `schema_bootstrap_done` | 存目前 `SCHEMA_SQL` 內容的 hash；hash 不同才會重跑整套 bootstrap（避免每次冷啟動都重新執行一次所有 CREATE/ALTER） |
| `study_habits_sep1_backfill` | 把從未打卡過的讀書習慣的 `created_at` 往回改成 2026-09-01，避免誤判為「今天才種」 |
| `study_habits_shuati_sep1_backfill` | 針對後補的「刷題」習慣單獨補做同樣的 9/1 backfill |
| `study_habits_rename_math_20250905` | 一次性把「數20min+5題」改名為「數學」 |

另外還有一段**每次冷啟動都會重跑**的邏輯（不是一次性旗標控制），會依固定
清單覆寫 `schedule` 表裡「四年1~5班」的美術課時段（`SCHEDULE_FIXES`
陣列）。這不是 bug，是目前刻意的「用程式碼固定課表」做法，但代表：
**如果之後要讓老師自己在 UI 改這幾班的課表，需要先移除或改掉這段程式碼**。

## 待確認 / 疑似未使用

- `grade_weights` 表存在，但目前 `worker/index.js` 沒有任何 route 讀寫它
  （`/api/grades` 是即時用 query string 傳權重計算，不落地存 DB）。
  今天**不刪**這張表，先記錄為待確認項目。
- `class_notes` 表已被 `class_progress` 取代，目前只在啟動時被讀一次
  （做舊資料搬遷），程式碼裡沒有其他寫入路徑。今天**不刪**。

## 未來待辦（今天不做）

把 schema 正式搬到遞增 migration 檔案，例如：

```
migrations/
  0001_init.sql              (現況：已過時，僅供參考)
  0002_student_features.sql  (座位表、頭像、個人紀錄、小組長...)
  0003_habits.sql             (habits / study_habits / 相關 logs)
  0004_meals.sql               (meal_times / weekly_penalties / bank / meal_weekly_status)
```

並且讓 `worker/index.js` 不再是 schema 的真相來源，而是改成單純呼叫
「跑尚未套用的 migration」。**這次重構刻意不做這件事**，因為變更 schema
管理方式風險較高，需要更完整的 rollback 演練，不適合在「明天要用」的
壓力下進行。
