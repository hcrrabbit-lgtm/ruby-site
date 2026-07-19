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
INSERT OR IGNORE INTO classes (id, name) VALUES ('5-1', '五年一班');
INSERT OR IGNORE INTO schedule (class_id, weekday, start, end, label) VALUES ('5-1', 2, '09:50', '10:30', '第3節'), ('5-1', 5, '13:10', '13:50', '第6節');
INSERT OR IGNORE INTO assignments (id, class_id, name, order_no) VALUES ('hw1', '5-1', '作業1', 1);
`;

const STUDENT_SEED = [
  ["s1",1,"王小明"],["s2",2,"陳怡君"],["s3",3,"林政宏"],["s4",4,"張雅婷"],["s5",5,"李明哲"],
  ["s6",6,"吳佳蓉"],["s7",7,"黃俊傑"],["s8",8,"劉思妤"],["s9",9,"蔡承翰"],["s10",10,"楊宜蓁"],
  ["s11",11,"許家瑋"],["s12",12,"鄭雨萱"],["s13",13,"謝宗翰"],["s14",14,"郭曉彤"],["s15",15,"洪柏宇"],
  ["s16",16,"邱怡萱"],["s17",17,"曾冠廷"],["s18",18,"廖芸熙"],["s19",19,"賴俊安"],["s20",20,"徐子涵"],
  ["s21",21,"周奕安"],["s22",22,"潘詩涵"],["s23",23,"蘇柏諺"],["s24",24,"江宜臻"],["s25",25,"顏彥廷"],
  ["s26",26,"簡佳琪"],["s27",27,"施宇軒"],["s28",28,"范詠晴"],["s29",29,"沈致遠"],["s30",30,"姚語彤"]
];

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  const statements = SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
  for (const [id, seat, name] of STUDENT_SEED) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO students (id, class_id, seat, name) VALUES (?, '5-1', ?, ?)"
    ).bind(id, seat, name).run();
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
  return json({
    source: "d1",
    current: match ? { classId: match.classId, label: match.label } : null,
    classes
  });
}

async function handleRoster(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const res = await env.DB.prepare(
    "SELECT id, seat, name FROM students WHERE class_id = ? ORDER BY seat"
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

  return json({ error: "unknown action" }, { status: 400 });
}

async function handleBehaviorGet(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const date = url.searchParams.get("date");
  const res = await env.DB.prepare(
    `SELECT b.student_id as studentId, SUM(b.delta) as total FROM behavior_events b
     JOIN students s ON s.id = b.student_id
     WHERE s.class_id = ? AND b.date = ?
     GROUP BY b.student_id`
  ).bind(classId, date).all();
  const map = {};
  res.results.forEach(r => { map[r.studentId] = r.total; });
  return json(map);
}

async function handleBehaviorPost(env, request) {
  const { studentId, date, delta } = await request.json();
  await env.DB.prepare(
    "INSERT INTO behavior_events (student_id, date, delta, created_at) VALUES (?, ?, ?, ?)"
  ).bind(studentId, date, delta, new Date().toISOString()).run();
  return json({ ok: true });
}

async function handleAssignmentsGet(env, url) {
  const classId = url.searchParams.get("classId") || "5-1";
  const res = await env.DB.prepare(
    "SELECT id, name FROM assignments WHERE class_id = ? ORDER BY order_no"
  ).bind(classId).all();
  return json(res.results);
}

async function handleAssignmentsPost(env, request) {
  const { classId, name } = await request.json();
  const id = "hw_" + Date.now();
  const countRes = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM assignments WHERE class_id = ?"
  ).bind(classId).first();
  await env.DB.prepare(
    "INSERT INTO assignments (id, class_id, name, order_no) VALUES (?, ?, ?, ?)"
  ).bind(id, classId, name, (countRes.c || 0) + 1).run();
  return json({ id, name });
}

async function handlePhotoUpload(env, request, url) {
  const ext = url.searchParams.get("ext") || "jpg";
  const contentType = request.headers.get("Content-Type") || "image/jpeg";
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const body = await request.arrayBuffer();
  await env.PHOTOS.put(`photos/${key}`, body, { httpMetadata: { contentType } });
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
  const { assignmentId, studentId, score } = await request.json();
  await env.DB.prepare(
    "UPDATE submissions SET score = ? WHERE assignment_id = ? AND student_id = ?"
  ).bind(score, assignmentId, studentId).run();
  return json({ ok: true });
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

      if (path === "/api/attendance" && request.method === "GET") return await handleAttendanceGet(env, url);
      if (path === "/api/attendance" && request.method === "POST") return await handleAttendancePost(env, request);

      if (path === "/api/behavior" && request.method === "GET") return await handleBehaviorGet(env, url);
      if (path === "/api/behavior" && request.method === "POST") return await handleBehaviorPost(env, request);

      if (path === "/api/assignments" && request.method === "GET") return await handleAssignmentsGet(env, url);
      if (path === "/api/assignments" && request.method === "POST") return await handleAssignmentsPost(env, request);

      if (path === "/api/photo" && request.method === "POST") return await handlePhotoUpload(env, request, url);
      if (path.startsWith("/api/photo/") && request.method === "GET") {
        return await handlePhotoGet(env, path.replace("/api/photo/", ""));
      }

      if (path === "/api/submissions" && request.method === "GET") return await handleSubmissionsGet(env, url);
      if (path === "/api/submissions" && request.method === "POST") return await handleSubmissionsPost(env, request);
      if (path === "/api/submissions" && request.method === "DELETE") return await handleSubmissionsDelete(env, request);
      if (path === "/api/submissions/score" && request.method === "POST") return await handleScoreUpdate(env, request);

      if (path === "/api/grades" && request.method === "GET") return await handleGrades(env, url);

      if (path.startsWith("/api/")) return json({ error: "not found" }, { status: 404 });

      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: err.message || String(err) }, { status: 500 });
    }
  }
};
