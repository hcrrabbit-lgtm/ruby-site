-- 上課助手資料庫結構
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,   -- 0=Sun ... 6=Sat
  start TEXT NOT NULL,        -- "HH:MM"
  end TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,         -- "YYYY-MM-DD"
  status TEXT NOT NULL,       -- 'late' | 'absent'
  UNIQUE(student_id, date)
);

CREATE TABLE IF NOT EXISTS behavior_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,
  delta INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_no INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  score INTEGER NOT NULL,
  note TEXT,
  photo_key TEXT,
  UNIQUE(assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS grade_weights (
  class_id TEXT PRIMARY KEY,
  behavior_weight REAL NOT NULL DEFAULT 0.1,
  assignment_weights TEXT NOT NULL DEFAULT '{}'
);

-- 練習用種子資料:五年一班,座號1~30
INSERT OR IGNORE INTO classes (id, name) VALUES ('5-1', '五年一班');

INSERT OR IGNORE INTO schedule (class_id, weekday, start, end, label) VALUES
  ('5-1', 2, '09:50', '10:30', '第3節'),
  ('5-1', 5, '13:10', '13:50', '第6節');

INSERT OR IGNORE INTO assignments (id, class_id, name, order_no) VALUES ('hw1', '5-1', '作業1', 1);

INSERT OR IGNORE INTO students (id, class_id, seat, name) VALUES
  ('s1','5-1',1,'王小明'),('s2','5-1',2,'陳怡君'),('s3','5-1',3,'林政宏'),('s4','5-1',4,'張雅婷'),
  ('s5','5-1',5,'李明哲'),('s6','5-1',6,'吳佳蓉'),('s7','5-1',7,'黃俊傑'),('s8','5-1',8,'劉思妤'),
  ('s9','5-1',9,'蔡承翰'),('s10','5-1',10,'楊宜蓁'),('s11','5-1',11,'許家瑋'),('s12','5-1',12,'鄭雨萱'),
  ('s13','5-1',13,'謝宗翰'),('s14','5-1',14,'郭曉彤'),('s15','5-1',15,'洪柏宇'),('s16','5-1',16,'邱怡萱'),
  ('s17','5-1',17,'曾冠廷'),('s18','5-1',18,'廖芸熙'),('s19','5-1',19,'賴俊安'),('s20','5-1',20,'徐子涵'),
  ('s21','5-1',21,'周奕安'),('s22','5-1',22,'潘詩涵'),('s23','5-1',23,'蘇柏諺'),('s24','5-1',24,'江宜臻'),
  ('s25','5-1',25,'顏彥廷'),('s26','5-1',26,'簡佳琪'),('s27','5-1',27,'施宇軒'),('s28','5-1',28,'范詠晴'),
  ('s29','5-1',29,'沈致遠'),('s30','5-1',30,'姚語彤');

CREATE TABLE IF NOT EXISTS community_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, note TEXT, source_type TEXT NOT NULL DEFAULT 'community', created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_sources_url ON community_sources(url);
INSERT OR IGNORE INTO community_sources (url, note, source_type, created_at) VALUES ('https://wsnps.ntct.edu.tw/p/403-1167-1646-1.php?Lang=zh-tw', '南投縣草屯鎮虎山國小・校務公告（機器人保護擋自動讀取，需人工查看）', 'school', '2026-07-19T00:00:00Z');
