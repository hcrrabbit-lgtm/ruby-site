// 美術課上課助手 - Cloudflare Worker 後端
// 負責處理 /api/* 請求，其餘一律交給靜態檔案 (env.ASSETS)

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, seat INTEGER NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, class_id TEXT NOT NULL, weekday INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(student_id, date));
CREATE TABLE IF NOT EXISTS behavior_events (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, date TEXT NOT NULL, delta INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, name TEXT NOT NULL, order_no INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_id TEXT NOT NULL, tier TEXT NOT NULL, score INTEGER NOT NULL, note TEXT, photo_key TEXT, UNIQUE(assignment_id, student_id));
CREATE TABLE IF NOT EXISTS grade_weights (class_id TEXT PRIMARY KEY, behavior_weight REAL NOT NULL DEFAULT 0.1, assignment_weights TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS community_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, note TEXT, source_type TEXT NOT NULL DEFAULT 'community', created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_sources_url ON community_sources(url);
CREATE TABLE IF NOT EXISTS habits (id TEXT PRIMARY KEY, name TEXT NOT NULL, order_no INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS habit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, habit_id TEXT NOT NULL, date TEXT NOT NULL, UNIQUE(habit_id, date));
INSERT OR IGNORE INTO community_sources (url, note, source_type, created_at) VALUES ('https://wsnps.ntct.edu.tw/p/403-1167-1646-1.php?Lang=zh-tw', '南投縣草屯鎮虎山國小・校務公告（機器人保護擋自動讀取，需人工查看）', 'school', '2026-07-19T00:00:00Z');
`;

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  const statements = SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      // continue past any single statement that fails (e.g. unique index blocked by pre-existing duplicate rows)
    }
  }
  try {
    await env.DB.prepare("ALTER TABLE students ADD COLUMN photo_key TEXT").run();
  } catch (e) {
    // column already exists, safe to ignore
  }
  try {
    await env.DB.prepare(
      "ALTER TABLE community_sources ADD COLUMN source_type TEXT NOT NULL DEFAULT 'community'"
    ).run();
  } catch (e) {
    // column already exists, safe to ignore
  }
  try {
    const rows = (await env.DB.prepare(
      "SELECT id, url FROM community_sources WHERE source_type = 'community' OR source_type IS NULL"
    ).all()).results;
    for (const row of rows) {
      const detected = classifySourceUrl(row.url);
      if (detected !== "community") {
        await env.DB.prepare("UPDATE community_sources SET source_type = ? WHERE id = ?")
          .bind(detected, row.id).run();
      }
    }
  } catch (e) {
    // best-effort backfill only
  }
  try {
    // 各班美術課固定時段：四年1~4班依原課表，四年5班已改到週一下午第六、七節
    const SCHEDULE_FIXES = [
      { className: "四年1班", weekday: 4, start: "09:30", end: "11:10", label: "美術課（第二、三節）" },
      { className: "四年2班", weekday: 2, start: "14:20", end: "15:55", label: "美術課（第六、七節）" },
      { className: "四年3班", weekday: 4, start: "13:30", end: "15:00", label: "美術課（第五、六節）" },
      { className: "四年4班", weekday: 5, start: "09:30", end: "11:10", label: "美術課（第二、三節）" },
      { className: "四年5班", weekday: 1, start: "14:20", end: "15:55", label: "美術課（第六、七節）" }
    ];
    for (const fix of SCHEDULE_FIXES) {
      const cls = await env.DB.prepare("SELECT id FROM classes WHERE name = ?").bind(fix.className).first();
      if (!cls) continue;
      await env.DB.prepare("DELETE FROM schedule WHERE class_id = ?").bind(cls.id).run();
      await env.DB.prepare(
        "INSERT INTO schedule (class_id, weekday, start, end, label) VALUES (?, ?, ?, ?, ?)"
      ).bind(cls.id, fix.weekday, fix.start, fix.end, fix.label).run();
    }
  } catch (e) {
    // best-effort schedule fix only
  }
  schemaReady = true;
}

function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init && init.headers) }
  });
}

function taipeiNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}
function pad(n) { return n.toString().padStart(2, "0"); }
function taipeiDateStr(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function handleSchedule(env) {
  const now = taipeiNow();
  const weekday = now.getUTCDay();
  const hhmm = pad(now.getUTCHours()) + ":" + pad(now.getUTCMinutes());

  const classesRes = await env.DB.prepare("SELECT id, name FROM classes").all();
  const classes = classesRes.results;

  const schedRes = await env.DB.prepare(
    "SELECT class_id as classId, start, end, label FROM schedule WHERE weekday = ?"
  ).bind(weekday).all();

  const match = schedRes.results.find(s => hhmm >= s.start && hhmm <= s.end);

  const allSchedRes = await env.DB.prepare(
    `SELECT sc.class_id as classId, c.name as className, sc.weekday as weekday,
            sc.start as start, sc.end as end, sc.label as label
     FROM schedule sc LEFT JOIN classes c ON c.id = sc.class_id
     ORDER BY sc.weekday, sc.start`
  ).all();

  return json({
    source: "d1",
    current: match ? { classId: match.classId, label: match.label } : null,
    classes,
    schedule: allSchedRes.results
  });
}

async function handleRoster(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const res = await env.DB.prepare(
    "SELECT id, seat, name, photo_key as photoKey FROM students WHERE class_id = ? ORDER BY seat"
  ).bind(classId).all();
  return json(res.results);
}

async function handleAttendanceGet(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const date = url.searchParams.get("date");
  const res = await env.DB.prepare(
    `SELECT a.student_id as studentId, a.status FROM attendance a
     JOIN students s ON s.id = a.student_id
     WHERE s.class_id = ? AND a.date = ?`
  ).bind(classId, date).all();
  const map = {};
  res.results.forEach(r => { map[r.studentId] = r.status; });
  return json(map);
}

async function handleAttendanceSummary(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const res = await env.DB.prepare(
    `SELECT a.student_id as studentId, a.status as status, COUNT(*) as cnt FROM attendance a
     JOIN students s ON s.id = a.student_id
     WHERE s.class_id = ?
     GROUP BY a.student_id, a.status`
  ).bind(classId).all();
  const map = {};
  res.results.forEach(r => {
    if (!map[r.studentId]) map[r.studentId] = { late: 0, absent: 0 };
    if (r.status === "late") map[r.studentId].late = r.cnt;
    if (r.status === "absent") map[r.studentId].absent = r.cnt;
  });
  return json(map);
}

async function handleAttendanceDetail(env, url) {
  const studentId = url.searchParams.get("studentId");
  const status = url.searchParams.get("status");
  if (!studentId || !status) return json({ error: "缺少 studentId 或 status" }, { status: 400 });
  const res = await env.DB.prepare(
    "SELECT date FROM attendance WHERE student_id = ? AND status = ? ORDER BY date"
  ).bind(studentId, status).all();
  return json(res.results.map(r => r.date));
}

async function handleBehaviorSummary(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const res = await env.DB.prepare(
    `SELECT b.student_id as studentId,
            SUM(CASE WHEN b.delta > 0 THEN b.delta ELSE 0 END) as plusTotal,
            SUM(CASE WHEN b.delta < 0 THEN -b.delta ELSE 0 END) as minusTotal
     FROM behavior_events b JOIN students s ON s.id = b.student_id
     WHERE s.class_id = ?
     GROUP BY b.student_id`
  ).bind(classId).all();
  const map = {};
  res.results.forEach(r => { map[r.studentId] = { plus: r.plusTotal || 0, minus: r.minusTotal || 0 }; });
  return json(map);
}

async function handleAssignmentScores(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const assignments = (await env.DB.prepare(
    "SELECT id, name FROM assignments WHERE class_id = ? ORDER BY order_no"
  ).bind(classId).all()).results;

  const subs = (await env.DB.prepare(
    `SELECT sub.student_id as studentId, sub.assignment_id as assignmentId, sub.score as score, sub.photo_key as photoKey
     FROM submissions sub JOIN students s ON s.id = sub.student_id
     WHERE s.class_id = ?`
  ).bind(classId).all()).results;

  const scores = {};
  const photos = {};
  subs.forEach(r => {
    if (!scores[r.studentId]) scores[r.studentId] = {};
    scores[r.studentId][r.assignmentId] = r.score;
    if (r.photoKey) {
      if (!photos[r.studentId]) photos[r.studentId] = {};
      photos[r.studentId][r.assignmentId] = r.photoKey;
    }
  });

  return json({ assignments, scores, photos });
}

async function handleAttendancePost(env, request) {
  const body = await request.json();
  const { classId, date, action } = body;

  if (action === "clearAll") {
    await env.DB.prepare(
      `DELETE FROM attendance WHERE date = ? AND student_id IN (SELECT id FROM students WHERE class_id = ?)`
    ).bind(date, classId).run();
    return json({ ok: true });
  }

  if (action === "setStatus") {
    const { seats, status } = body;
    const notFound = [];
    for (const seat of seats) {
      const stu = await env.DB.prepare(
        "SELECT id FROM students WHERE class_id = ? AND seat = ?"
      ).bind(classId, seat).first();
      if (!stu) { notFound.push(seat); continue; }
      await env.DB.prepare(
        `INSERT INTO attendance (student_id, date, status) VALUES (?, ?, ?)
         ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status`
      ).bind(stu.id, date, status).run();
    }
    return json({ ok: true, notFound });
  }

  if (action === "clear") {
    const { seats } = body;
    for (const seat of seats) {
      const stu = await env.DB.prepare(
        "SELECT id FROM students WHERE class_id = ? AND seat = ?"
      ).bind(classId, seat).first();
      if (!stu) continue;
      await env.DB.prepare(
        "DELETE FROM attendance WHERE student_id = ? AND date = ?"
      ).bind(stu.id, date).run();
    }
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, { status: 400 });
}

async function handleBehaviorGet(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const date = url.searchParams.get("date");
  const res = await env.DB.prepare(
    `SELECT b.student_id as studentId,
            SUM(CASE WHEN b.delta > 0 THEN b.delta ELSE 0 END) as plusTotal,
            SUM(CASE WHEN b.delta < 0 THEN -b.delta ELSE 0 END) as minusTotal
     FROM behavior_events b JOIN students s ON s.id = b.student_id
     WHERE s.class_id = ? AND b.date = ?
     GROUP BY b.student_id`
  ).bind(classId, date).all();
  const map = {};
  res.results.forEach(r => { map[r.studentId] = { plus: r.plusTotal || 0, minus: r.minusTotal || 0 }; });
  return json(map);
}

async function handleBehaviorPost(env, request) {
  const { studentId, date, delta } = await request.json();
  await env.DB.prepare(
    "INSERT INTO behavior_events (student_id, date, delta, created_at) VALUES (?, ?, ?, ?)"
  ).bind(studentId, date, delta, new Date().toISOString()).run();
  return json({ ok: true });
}

async function handleBehaviorUndo(env, request) {
  // 復原該生當天最後一次加/扣分紀錄，避免點錯無法修正
  const { studentId, date } = await request.json();
  const row = await env.DB.prepare(
    "SELECT id, delta FROM behavior_events WHERE student_id = ? AND date = ? ORDER BY id DESC LIMIT 1"
  ).bind(studentId, date).first();
  if (!row) return json({ error: "沒有可復原的紀錄" }, { status: 404 });
  await env.DB.prepare("DELETE FROM behavior_events WHERE id = ?").bind(row.id).run();
  return json({ ok: true, delta: row.delta });
}

async function handleAssignmentsGet(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const res = await env.DB.prepare(
    "SELECT id, name FROM assignments WHERE class_id = ? ORDER BY order_no"
  ).bind(classId).all();
  return json(res.results);
}

async function handleAssignmentsPost(env, request) {
  // 每班的作業都一樣：新增作業會一次幫所有班級建立同名的一筆，維持各班同步
  const { classId, name } = await request.json();
  const classes = (await env.DB.prepare("SELECT id FROM classes").all()).results;
  const countRes = await env.DB.prepare(
    "SELECT COALESCE(MAX(order_no), 0) as maxOrder FROM assignments WHERE class_id = ?"
  ).bind(classId).first();
  const orderNo = (countRes.maxOrder || 0) + 1;

  let newId = null;
  for (const cls of classes) {
    const id = "hw_" + Date.now() + "_" + cls.id;
    await env.DB.prepare(
      "INSERT INTO assignments (id, class_id, name, order_no) VALUES (?, ?, ?, ?)"
    ).bind(id, cls.id, name, orderNo).run();
    if (cls.id === classId) newId = id;
  }
  return json({ id: newId || ("hw_" + Date.now()), name });
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB

function isJpegMagicBytes(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
}

async function handleAssignmentsRename(env, request) {
  // 每班的作業都一樣：依目前名稱找出所有班級同名的那一筆一起改名，維持各班同步
  const { id, name } = await request.json();
  if (!id || !name) return json({ error: "缺少 id 或 name" }, { status: 400 });
  const current = await env.DB.prepare("SELECT name FROM assignments WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "查無此作業" }, { status: 404 });
  await env.DB.prepare("UPDATE assignments SET name = ? WHERE name = ?").bind(name, current.name).run();
  return json({ ok: true });
}

async function handleAssignmentsDelete(env, request) {
  // 每班的作業都一樣：依目前名稱刪除所有班級同名的作業與對應的作品紀錄，維持各班同步
  const { id } = await request.json();
  if (!id) return json({ error: "缺少 id" }, { status: 400 });
  const current = await env.DB.prepare("SELECT name FROM assignments WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "查無此作業" }, { status: 404 });
  const rows = (await env.DB.prepare("SELECT id FROM assignments WHERE name = ?").bind(current.name).all()).results;
  for (const row of rows) {
    await env.DB.prepare("DELETE FROM submissions WHERE assignment_id = ?").bind(row.id).run();
  }
  await env.DB.prepare("DELETE FROM assignments WHERE name = ?").bind(current.name).run();
  return json({ ok: true });
}

async function handleStudentPhotoUpload(env, request, url) {
  const studentId = url.searchParams.get("studentId");
  if (!studentId) return json({ error: "缺少 studentId" }, { status: 400 });
  const body = await request.arrayBuffer();

  if (body.byteLength > MAX_PHOTO_BYTES) {
    return json({ error: "檔案超過 8MB 上限" }, { status: 413 });
  }
  const bytes = new Uint8Array(body.slice(0, 3));
  if (!isJpegMagicBytes(bytes)) {
    return json({ error: "檔案不是有效的 JPEG 格式" }, { status: 415 });
  }

  const key = `avatar/${studentId}-${Date.now()}.jpg`;
  await env.PHOTOS.put(`photos/${key}`, body, { httpMetadata: { contentType: "image/jpeg" } });
  await env.DB.prepare("UPDATE students SET photo_key = ? WHERE id = ?").bind(key, studentId).run();
  return json({ key });
}

async function handlePhotoUpload(env, request, url) {
  const tier = url.searchParams.get("tier") || "未分類";
  const contentType = request.headers.get("Content-Type") || "image/jpeg";
  const body = await request.arrayBuffer();

  if (body.byteLength > MAX_PHOTO_BYTES) {
    return json({ error: "檔案超過 8MB 上限" }, { status: 413 });
  }
  const bytes = new Uint8Array(body.slice(0, 3));
  if (!isJpegMagicBytes(bytes)) {
    return json({ error: "檔案不是有效的 JPEG 格式" }, { status: 415 });
  }

  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}`;
  const key = `${encodeURIComponent(tier)}/${yearMonth}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  await env.PHOTOS.put(`photos/${key}`, body, { httpMetadata: { contentType: "image/jpeg" } });
  return json({ key });
}

async function handlePhotoGet(env, key) {
  const obj = await env.PHOTOS.get(`photos/${key}`);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

async function handleSubmissionsGet(env, url) {
  const assignmentId = url.searchParams.get("assignmentId");
  const res = await env.DB.prepare(
    `SELECT sub.student_id as studentId, s.seat as seat, s.name as name,
            sub.tier as tier, sub.score as score, sub.note as note, sub.photo_key as photoKey
     FROM submissions sub JOIN students s ON s.id = sub.student_id
     WHERE sub.assignment_id = ?`
  ).bind(assignmentId).all();
  return json(res.results);
}

async function handleSubmissionsPost(env, request) {
  const { assignmentId, classId, seat, tier, score, note, photoKey } = await request.json();
  const stu = await env.DB.prepare(
    "SELECT id FROM students WHERE class_id = ? AND seat = ?"
  ).bind(classId, seat).first();
  if (!stu) return json({ error: "查無座號 " + seat }, { status: 400 });

  const id = assignmentId + "_" + stu.id;
  await env.DB.prepare(
    `INSERT INTO submissions (id, assignment_id, student_id, tier, score, note, photo_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(assignment_id, student_id) DO UPDATE SET
       tier = excluded.tier, score = excluded.score, note = excluded.note, photo_key = excluded.photo_key`
  ).bind(id, assignmentId, stu.id, tier, score, note || "", photoKey).run();
  return json({ ok: true, studentId: stu.id });
}

async function handleSubmissionsDelete(env, request) {
  const { assignmentId, studentId } = await request.json();
  await env.DB.prepare(
    "DELETE FROM submissions WHERE assignment_id = ? AND student_id = ?"
  ).bind(assignmentId, studentId).run();
  return json({ ok: true });
}

async function handleScoreUpdate(env, request) {
  // upsert：既有建檔（有等第/照片）只更新分數；沒有建檔過的（例如統計表直接輸入分數）就新建一筆空白等第的紀錄
  const { assignmentId, studentId, score } = await request.json();
  const id = assignmentId + "_" + studentId;
  await env.DB.prepare(
    `INSERT INTO submissions (id, assignment_id, student_id, tier, score, note, photo_key)
     VALUES (?, ?, ?, '', ?, '', NULL)
     ON CONFLICT(assignment_id, student_id) DO UPDATE SET score = excluded.score`
  ).bind(id, assignmentId, studentId, score).run();
  return json({ ok: true });
}

async function handleNoteUpdate(env, request) {
  // upsert：既有建檔的只更新備註；沒有建檔過的(例如作品庫直接輸入備註)就新建一筆空白紀錄
  const { assignmentId, studentId, note } = await request.json();
  const id = assignmentId + "_" + studentId;
  await env.DB.prepare(
    `INSERT INTO submissions (id, assignment_id, student_id, tier, score, note, photo_key)
     VALUES (?, ?, ?, '', 0, ?, NULL)
     ON CONFLICT(assignment_id, student_id) DO UPDATE SET note = excluded.note`
  ).bind(id, assignmentId, studentId, note || "").run();
  return json({ ok: true });
}

function classifySourceUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (/\.edu\.tw$/.test(host) || /\.edu\.tw\.?$/.test(host)) return "school";
    if (/\.gov\.tw$/.test(host)) return "government";
    return "community";
  } catch (e) {
    return "community";
  }
}

async function handleCommunitySourcesGet(env) {
  const res = await env.DB.prepare(
    "SELECT id, url, note, source_type FROM community_sources ORDER BY created_at DESC"
  ).all();
  return json(res.results);
}

async function handleCommunitySourcesPost(env, request) {
  const { url, note } = await request.json();
  if (!url) return json({ error: "缺少網址" }, { status: 400 });
  const sourceType = classifySourceUrl(url);
  await env.DB.prepare(
    "INSERT INTO community_sources (url, note, source_type, created_at) VALUES (?, ?, ?, ?)"
  ).bind(url, note || "", sourceType, new Date().toISOString()).run();
  return json({ ok: true, sourceType });
}

async function handleCommunitySourcesDelete(env, request) {
  const { id } = await request.json();
  await env.DB.prepare("DELETE FROM community_sources WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function handleHabitsGet(env) {
  const res = await env.DB.prepare(
    "SELECT id, name FROM habits ORDER BY order_no"
  ).all();
  return json(res.results);
}

async function handleHabitsPost(env, request) {
  const { name } = await request.json();
  if (!name || !name.trim()) return json({ error: "缺少習慣名稱" }, { status: 400 });
  const countRes = await env.DB.prepare(
    "SELECT COALESCE(MAX(order_no), 0) as maxOrder FROM habits"
  ).first();
  const orderNo = (countRes.maxOrder || 0) + 1;
  const id = "habit_" + Date.now();
  await env.DB.prepare(
    "INSERT INTO habits (id, name, order_no, created_at) VALUES (?, ?, ?, ?)"
  ).bind(id, name.trim(), orderNo, new Date().toISOString()).run();
  return json({ id, name: name.trim() });
}

async function handleHabitsDelete(env, request) {
  const { id } = await request.json();
  if (!id) return json({ error: "缺少 id" }, { status: 400 });
  await env.DB.prepare("DELETE FROM habit_logs WHERE habit_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM habits WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function handleHabitLogGet(env, url) {
  const date = url.searchParams.get("date");
  if (!date) return json({ error: "缺少 date" }, { status: 400 });
  const res = await env.DB.prepare(
    "SELECT habit_id as habitId FROM habit_logs WHERE date = ?"
  ).bind(date).all();
  const map = {};
  res.results.forEach(r => { map[r.habitId] = true; });
  return json(map);
}

async function handleHabitLogToggle(env, request) {
  const { habitId, date } = await request.json();
  if (!habitId || !date) return json({ error: "缺少 habitId 或 date" }, { status: 400 });
  const existing = await env.DB.prepare(
    "SELECT id FROM habit_logs WHERE habit_id = ? AND date = ?"
  ).bind(habitId, date).first();
  if (existing) {
    await env.DB.prepare("DELETE FROM habit_logs WHERE id = ?").bind(existing.id).run();
    return json({ ok: true, done: false });
  }
  await env.DB.prepare(
    "INSERT INTO habit_logs (habit_id, date) VALUES (?, ?)"
  ).bind(habitId, date).run();
  return json({ ok: true, done: true });
}

async function handleHabitMonth(env, url) {
  const month = url.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return json({ error: "缺少或格式錯誤的 month（YYYY-MM）" }, { status: 400 });
  const habits = (await env.DB.prepare("SELECT id, name FROM habits ORDER BY order_no").all()).results;
  const res = await env.DB.prepare(
    "SELECT habit_id as habitId, date FROM habit_logs WHERE date LIKE ? ORDER BY date"
  ).bind(month + "-%").all();
  const logs = {};
  res.results.forEach(r => {
    if (!logs[r.habitId]) logs[r.habitId] = [];
    logs[r.habitId].push(r.date);
  });
  return json({ habits, logs });
}

async function handleGrades(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const behaviorWeight = parseFloat(url.searchParams.get("behaviorWeight") || "0.1");
  let weights = {};
  try { weights = JSON.parse(url.searchParams.get("weights") || "{}"); } catch (e) {}

  const students = (await env.DB.prepare(
    "SELECT id, seat, name FROM students WHERE class_id = ? ORDER BY seat"
  ).bind(classId).all()).results;

  const assignments = (await env.DB.prepare(
    "SELECT id, name FROM assignments WHERE class_id = ? ORDER BY order_no"
  ).bind(classId).all()).results;

  const subs = (await env.DB.prepare(
    `SELECT sub.assignment_id as assignmentId, sub.student_id as studentId, sub.score as score
     FROM submissions sub JOIN students s ON s.id = sub.student_id WHERE s.class_id = ?`
  ).bind(classId).all()).results;

  const behaviorTotals = (await env.DB.prepare(
    `SELECT student_id as studentId, SUM(delta) as total FROM behavior_events b
     JOIN students s ON s.id = b.student_id WHERE s.class_id = ? GROUP BY student_id`
  ).bind(classId).all()).results;
  const behaviorMap = {};
  behaviorTotals.forEach(b => { behaviorMap[b.studentId] = b.total; });

  const n = assignments.length || 1;
  const equalWeight = (1 - behaviorWeight) / n;

  const results = students.map(st => {
    let assignmentTotal = 0;
    const breakdown = {};
    assignments.forEach(a => {
      const w = weights[a.id] != null ? weights[a.id] : equalWeight;
      const sub = subs.find(s => s.assignmentId === a.id && s.studentId === st.id);
      const score = sub ? sub.score : 0;
      breakdown[a.name] = score;
      assignmentTotal += score * w;
    });
    const behaviorRaw = behaviorMap[st.id] || 0;
    const finalScore = Math.round(assignmentTotal + behaviorRaw * behaviorWeight);
    return { seat: st.seat, name: st.name, breakdown, behaviorRaw, finalScore };
  });

  return json({ assignments: assignments.map(a => a.name), behaviorWeight, results });
}

async function handleUsage(env) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
    return json({ error: "尚未設定 CF_ANALYTICS_TOKEN 或 CF_ACCOUNT_ID" }, { status: 400 });
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = now.toISOString();

  const query = `
    query R2Usage($accountTag: string!, $start: Time, $end: Time) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
            sum { requests }
            dimensions { actionType }
          }
          r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }, orderBy: [datetime_DESC]) {
            max { payloadSize }
          }
        }
      }
    }
  `;

  const resp = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CF_ANALYTICS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables: { accountTag: env.CF_ACCOUNT_ID, start, end } })
  });

  if (!resp.ok) {
    return json({ error: "Cloudflare API 查詢失敗", status: resp.status }, { status: 502 });
  }
  const data = await resp.json();
  const acct = data && data.data && data.data.viewer && data.data.viewer.accounts && data.data.viewer.accounts[0];
  if (!acct) return json({ error: "no data", raw: data }, { status: 502 });

  let classA = 0, classB = 0;
  const CLASS_A_TYPES = new Set(["PutObject", "ListObjects", "ListBuckets", "PutBucket", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "ListMultipartUploads", "ListParts"]);
  (acct.r2OperationsAdaptiveGroups || []).forEach(g => {
    const type = g.dimensions.actionType;
    const reqs = g.sum.requests;
    if (CLASS_A_TYPES.has(type)) classA += reqs; else classB += reqs;
  });
  const storageBytes = (acct.r2StorageAdaptiveGroups && acct.r2StorageAdaptiveGroups[0] && acct.r2StorageAdaptiveGroups[0].max.payloadSize) || 0;
  const storageGB = storageBytes / (1024 ** 3);

  const freeStorageGB = 10, freeClassA = 1000000, freeClassB = 10000000;
  const overStorage = Math.max(0, storageGB - freeStorageGB);
  const overA = Math.max(0, classA - freeClassA);
  const overB = Math.max(0, classB - freeClassB);
  const estCost = overStorage * 0.015 + (overA / 1e6) * 4.50 + (overB / 1e6) * 0.36;

  return json({
    period: { start, end },
    storageGB: Math.round(storageGB * 100) / 100,
    classA, classB,
    estimatedCostUSD: Math.round(estCost * 100) / 100,
    note: "此為依 R2 用量估算的參考金額，非正式帳單"
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/usage" && request.method === "GET") {
        return await handleUsage(env);
      }

      if (path.startsWith("/api/")) {
        await ensureSchema(env);
      }

      if (path === "/api/schedule" && request.method === "GET") return await handleSchedule(env);
      if (path === "/api/roster" && request.method === "GET") return await handleRoster(env, url);
      if (path === "/api/students/photo" && request.method === "POST") return await handleStudentPhotoUpload(env, request, url);

      if (path === "/api/attendance" && request.method === "GET") return await handleAttendanceGet(env, url);
      if (path === "/api/attendance" && request.method === "POST") return await handleAttendancePost(env, request);
      if (path === "/api/attendance/summary" && request.method === "GET") return await handleAttendanceSummary(env, url);
      if (path === "/api/attendance/detail" && request.method === "GET") return await handleAttendanceDetail(env, url);

      if (path === "/api/behavior" && request.method === "GET") return await handleBehaviorGet(env, url);
      if (path === "/api/behavior" && request.method === "POST") return await handleBehaviorPost(env, request);
      if (path === "/api/behavior/undo" && request.method === "POST") return await handleBehaviorUndo(env, request);
      if (path === "/api/behavior/summary" && request.method === "GET") return await handleBehaviorSummary(env, url);

      if (path === "/api/assignments" && request.method === "GET") return await handleAssignmentsGet(env, url);
      if (path === "/api/assignments" && request.method === "POST") return await handleAssignmentsPost(env, request);
      if (path === "/api/assignments/rename" && request.method === "POST") return await handleAssignmentsRename(env, request);
      if (path === "/api/assignments" && request.method === "DELETE") return await handleAssignmentsDelete(env, request);
      if (path === "/api/assignments/scores" && request.method === "GET") return await handleAssignmentScores(env, url);

      if (path === "/api/photo" && request.method === "POST") return await handlePhotoUpload(env, request, url);
      if (path.startsWith("/api/photo/") && request.method === "GET") {
        return await handlePhotoGet(env, path.replace("/api/photo/", ""));
      }

      if (path === "/api/submissions" && request.method === "GET") return await handleSubmissionsGet(env, url);
      if (path === "/api/submissions" && request.method === "POST") return await handleSubmissionsPost(env, request);
      if (path === "/api/submissions" && request.method === "DELETE") return await handleSubmissionsDelete(env, request);
      if (path === "/api/submissions/score" && request.method === "POST") return await handleScoreUpdate(env, request);
      if (path === "/api/submissions/note" && request.method === "POST") return await handleNoteUpdate(env, request);

      if (path === "/api/grades" && request.method === "GET") return await handleGrades(env, url);

      if (path === "/api/habits" && request.method === "GET") return await handleHabitsGet(env);
      if (path === "/api/habits" && request.method === "POST") return await handleHabitsPost(env, request);
      if (path === "/api/habits" && request.method === "DELETE") return await handleHabitsDelete(env, request);
      if (path === "/api/habits/log" && request.method === "GET") return await handleHabitLogGet(env, url);
      if (path === "/api/habits/log" && request.method === "POST") return await handleHabitLogToggle(env, request);
      if (path === "/api/habits/month" && request.method === "GET") return await handleHabitMonth(env, url);

      if (path === "/api/community-sources" && request.method === "GET") return await handleCommunitySourcesGet(env);
      if (path === "/api/community-sources" && request.method === "POST") return await handleCommunitySourcesPost(env, request);
      if (path === "/api/community-sources" && request.method === "DELETE") return await handleCommunitySourcesDelete(env, request);

      if (path.startsWith("/api/")) return json({ error: "not found" }, { status: 404 });

      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: err.message || String(err) }, { status: 500 });
    }
  }
};
