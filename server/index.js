import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import db, { applySm2 } from './db.js';
import { posOfMeaning, posPartsString } from './pos.js';
import { authRouter, requireAuth, sameOriginOnly } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// 서버 소프트웨어 핑거프린팅 방지
app.disable('x-powered-by');

// CORS: 같은 출처(Caddy 경유)로만 서빙되므로 교차 출처 요청은 불필요.
// 명시적 허용 목록이 있으면 그것만, 없으면 CORS 헤더를 붙이지 않는다(동일 출처는 영향 없음).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.length === 0) return cb(null, false); // 헤더 미부착
      cb(null, allowedOrigins.includes(origin));
    },
  })
);

app.use(express.json({ limit: '512kb' }));

// ---------- 인증 ----------
// Caddy 뒤에서 실제 클라이언트 IP를 쓰기 위해 (로그인 레이트리밋용)
app.set('trust proxy', 1);
// 상태 변경 요청은 같은 출처에서만 (CSRF 보강)
app.use('/api', sameOriginOnly);
// 로그인/로그아웃/세션확인
app.use('/api/auth', authRouter);
// 그 외 /api 전부 로그인 필수 (health 는 공개 — 가동 확인용)
app.use('/api', (req, res, next) =>
  req.path === '/health' ? next() : requireAuth(req, res, next)
);

// ---------- 공용 헬퍼 ----------

const DUE_WHERE = "due_at IS NOT NULL AND date(due_at) <= date('now', 'localtime')";

// 입력 길이 상한 (저장형 XSS·자원소진 완화)
const LIMITS = {
  setName: 200,
  word: 200,
  meaning: 1000,
  example: 2000,
  given: 1000,
  answers: 2000,
};

/** 문자열 정리: 트리밍 후 상한 초과 시 잘라냄 (null/undefined → '') */
function clip(value, max) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

/** 로컬 기준 YYYY-MM-DD 문자열 (offsetDays 만큼 이동) */
function localDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** words 테이블 SRS 필드 갱신 (prepared) */
const updateSrsStmt = db.prepare(
  'UPDATE words SET ease = ?, "interval" = ?, reps = ?, due_at = ? WHERE id = ?'
);
const getWordStmt = db.prepare('SELECT * FROM words WHERE id = ?');

// ---------- 단어장 ----------

app.get('/api/sets', (req, res) => {
  const sets = db
    .prepare(
      `SELECT s.id, s.name, s.created_at,
              (SELECT COUNT(*) FROM words w WHERE w.set_id = s.id) AS word_count,
              (SELECT COUNT(*) FROM words w
                WHERE w.set_id = s.id
                  AND EXISTS (SELECT 1 FROM quiz_answers a WHERE a.word_id = w.id)
              ) AS studied_count,
              (SELECT COUNT(*) FROM words w WHERE w.set_id = s.id AND w.starred = 1) AS starred_count,
              (SELECT CAST(ROUND(r.correct * 100.0 / r.total) AS INTEGER)
                 FROM quiz_results r WHERE r.set_id = s.id
                ORDER BY r.id DESC LIMIT 1) AS last_pct
       FROM word_sets s
       ORDER BY s.id DESC`
    )
    .all();
  res.json(sets);
});

app.post('/api/sets', (req, res) => {
  const name = clip(req.body.name, LIMITS.setName);
  if (!name) return res.status(400).json({ error: '단어장 이름을 입력하세요.' });
  const { lastInsertRowid } = db.prepare('INSERT INTO word_sets (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM word_sets WHERE id = ?').get(lastInsertRowid));
});

app.put('/api/sets/:id', (req, res) => {
  const name = clip(req.body.name, LIMITS.setName);
  if (!name) return res.status(400).json({ error: '단어장 이름을 입력하세요.' });
  const info = db.prepare('UPDATE word_sets SET name = ? WHERE id = ?').run(name, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '단어장이 없습니다.' });
  res.json(db.prepare('SELECT * FROM word_sets WHERE id = ?').get(req.params.id));
});

app.delete('/api/sets/:id', (req, res) => {
  const info = db.prepare('DELETE FROM word_sets WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '단어장이 없습니다.' });
  res.json({ ok: true });
});

app.get('/api/sets/:id', (req, res) => {
  const set = db.prepare('SELECT * FROM word_sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: '단어장이 없습니다.' });
  const words = db
    .prepare(
      `SELECT w.*,
              COUNT(a.id) AS attempts,
              COALESCE(SUM(a.is_correct), 0) AS correct
       FROM words w LEFT JOIN quiz_answers a ON a.word_id = w.id
       WHERE w.set_id = ?
       GROUP BY w.id ORDER BY w.id`
    )
    .all(req.params.id);

  // 단어별로 어떤 시험 모드로 응시했는지 (Day별 "어떤 시험 봤나" 표시용)
  const modeRows = db
    .prepare(
      `SELECT a.word_id AS word_id, r.mode AS mode
       FROM quiz_answers a
       JOIN quiz_results r ON r.id = a.result_id
       WHERE a.word_id IN (SELECT id FROM words WHERE set_id = ?)
       GROUP BY a.word_id, r.mode`
    )
    .all(req.params.id);
  const modeMap = new Map();
  for (const row of modeRows) {
    if (!modeMap.has(row.word_id)) modeMap.set(row.word_id, []);
    modeMap.get(row.word_id).push(row.mode);
  }
  for (const w of words) w.modes = modeMap.get(w.id) || [];

  res.json({ ...set, words });
});

// ---------- CSV 내보내기 ----------

app.get('/api/sets/:id/export', (req, res) => {
  const set = db.prepare('SELECT * FROM word_sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: '단어장이 없습니다.' });

  const words = db
    .prepare('SELECT word, meaning, example, starred FROM words WHERE set_id = ? ORDER BY id')
    .all(set.id);

  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // CSV 인젝션 방지: 수식으로 해석될 수 있는 선행문자(= + - @ 및 탭/캐리지리턴)는 앞에 '를 붙여 무력화
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = ['word,meaning,example,starred'];
  for (const w of words) {
    lines.push([esc(w.word), esc(w.meaning), esc(w.example), w.starred ? 1 : 0].join(','));
  }
  const BOM = String.fromCharCode(0xfeff);
  const csv = BOM + lines.join('\r\n');

  const encodedName = encodeURIComponent(`${set.name}.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="set-${set.id}.csv"; filename*=UTF-8''${encodedName}`
  );
  res.send(csv);
});

// ---------- 단어 ----------

app.post('/api/sets/:id/words', (req, res) => {
  const set = db.prepare('SELECT id FROM word_sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: '단어장이 없습니다.' });

  const rawItems = Array.isArray(req.body.words) ? req.body.words : [req.body];
  // 한 번에 넣을 수 있는 단어 수 상한 (자원 소진 방지)
  const items = rawItems.slice(0, 5000);
  const cleaned = [];
  for (const item of items) {
    const word = clip(item?.word, LIMITS.word);
    const meaning = clip(item?.meaning, LIMITS.meaning);
    if (!word || !meaning) continue;
    cleaned.push({ word, meaning, example: clip(item?.example, LIMITS.example) || null });
  }
  if (cleaned.length === 0)
    return res.status(400).json({ error: '단어와 뜻을 입력하세요.' });

  const insert = db.prepare(
    'INSERT INTO words (set_id, word, meaning, example, pos, pos_parts) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const w of cleaned)
      insert.run(
        set.id, w.word, w.meaning, w.example,
        posOfMeaning(w.meaning), posPartsString(w.meaning)
      );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(201).json({ added: cleaned.length });
});

app.put('/api/words/:id', (req, res) => {
  const word = clip(req.body.word, LIMITS.word);
  const meaning = clip(req.body.meaning, LIMITS.meaning);
  if (!word || !meaning) return res.status(400).json({ error: '단어와 뜻을 입력하세요.' });
  // 뜻이 바뀌면 품사도 다시 계산. pos를 직접 지정해 보내면 그 값을 쓴다(검수 결과 반영용)
  const pos =
    typeof req.body.pos === 'string' && req.body.pos.trim()
      ? clip(req.body.pos, 20)
      : posOfMeaning(meaning);
  const posParts =
    typeof req.body.pos_parts === 'string' && req.body.pos_parts.trim()
      ? clip(req.body.pos_parts, 200)
      : posPartsString(meaning);
  const info = db
    .prepare(
      'UPDATE words SET word = ?, meaning = ?, example = ?, pos = ?, pos_parts = ? WHERE id = ?'
    )
    .run(word, meaning, clip(req.body.example, LIMITS.example) || null, pos, posParts, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '단어가 없습니다.' });
  res.json({ ok: true });
});

/** 단어장 전체 품사 일괄 계산/지정 (items 주면 그 값으로, 없으면 뜻으로 자동 계산) */
app.post('/api/sets/:id/pos', (req, res) => {
  const set = db.prepare('SELECT id FROM word_sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: '단어장이 없습니다.' });

  // items: [{ id, pos_parts: "형|명|부" }] — 조각별 품사를 직접 지정 (검수 결과 반영)
  const overrides = new Map();
  if (Array.isArray(req.body.items)) {
    for (const it of req.body.items.slice(0, 5000)) {
      const id = Number(it?.id);
      if (Number.isInteger(id) && typeof it?.pos_parts === 'string')
        overrides.set(id, clip(it.pos_parts, 200));
    }
  }

  const words = db.prepare('SELECT id, meaning FROM words WHERE set_id = ?').all(set.id);
  const upd = db.prepare('UPDATE words SET pos = ?, pos_parts = ? WHERE id = ?');
  const ORDER = ['명', '동', '형', '부'];
  let updated = 0;
  db.exec('BEGIN');
  try {
    for (const w of words) {
      const parts = overrides.has(w.id) ? overrides.get(w.id) : posPartsString(w.meaning);
      // 조각별 품사에서 단어 전체 품사를 재계산 (둘이 항상 일치하도록)
      const tags = new Set(String(parts || '').split(/[|·]/).filter(Boolean));
      const pos = ORDER.filter((t) => tags.has(t)).join('·') || posOfMeaning(w.meaning);
      upd.run(pos, parts, w.id);
      updated += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ updated, overrides: overrides.size });
});

app.delete('/api/words/:id', (req, res) => {
  const info = db.prepare('DELETE FROM words WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '단어가 없습니다.' });
  res.json({ ok: true });
});

app.patch('/api/words/:id/star', (req, res) => {
  const starred = Number(req.body.starred) === 1 ? 1 : 0;
  const info = db.prepare('UPDATE words SET starred = ? WHERE id = ?').run(starred, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '단어가 없습니다.' });
  res.json({ ok: true, starred });
});

// ---------- 오늘의 복습 (SRS) ----------

app.get('/api/review/due', (req, res) => {
  const { c: count } = db
    .prepare(`SELECT COUNT(*) AS c FROM words WHERE ${DUE_WHERE}`)
    .get();
  const words = db
    .prepare(
      `SELECT w.id, w.set_id, s.name AS set_name, w.word, w.meaning, w.example,
              w.starred, w.due_at, w.reps
       FROM words w JOIN word_sets s ON s.id = w.set_id
       WHERE w.due_at IS NOT NULL AND date(w.due_at) <= date('now', 'localtime')
       ORDER BY w.due_at ASC, w.id ASC
       LIMIT 100`
    )
    .all();
  res.json({ count, words });
});

app.post('/api/review', (req, res) => {
  // 개수 상한 (다른 쓰기 엔드포인트와 동일하게 자원 소진 방지)
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, LIMITS.answers);
  if (items.length === 0)
    return res.status(400).json({ error: '복습 항목이 없습니다.' });

  const insertLog = db.prepare('INSERT INTO review_log (word_id, grade) VALUES (?, ?)');

  let updated = 0;
  db.exec('BEGIN');
  try {
    for (const item of items) {
      const wordId = Number(item.word_id);
      const grade = Number(item.grade);
      if (!Number.isInteger(wordId) || !Number.isInteger(grade) || grade < 0 || grade > 5)
        continue;
      const row = getWordStmt.get(wordId);
      if (!row) continue;
      const next = applySm2(row, grade);
      updateSrsStmt.run(next.ease, next.interval, next.reps, next.due_at, wordId);
      insertLog.run(wordId, grade);
      updated += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ updated });
});

// ---------- 시험 결과 ----------

const VALID_MODES = new Set(['meaning', 'kmeaning', 'mixed', 'dictation', 'choice']);

app.post('/api/results', (req, res) => {
  const { set_id, answers } = req.body;
  const set_name = clip(req.body.set_name, LIMITS.setName);
  const mode = clip(req.body.mode, 32);
  if (!set_name || !VALID_MODES.has(mode) || !Array.isArray(answers) || answers.length === 0)
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  if (answers.length > LIMITS.answers)
    return res.status(400).json({ error: '문항 수가 너무 많습니다.' });

  const setId = Number.isInteger(Number(set_id)) ? Number(set_id) : null;
  const rawDuration = req.body.duration_sec;
  const duration_sec =
    rawDuration === null || rawDuration === undefined || !Number.isInteger(Number(rawDuration))
      ? null
      : Math.max(0, Math.min(Number(rawDuration), 86400)); // 0~24시간

  const correct = answers.filter((a) => a && a.is_correct).length;

  let resultId;
  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO quiz_results (set_id, set_name, mode, total, correct, duration_sec) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(setId, set_name, mode, answers.length, correct, duration_sec);
    resultId = lastInsertRowid;

    const insert = db.prepare(
      'INSERT INTO quiz_answers (result_id, word_id, word, meaning, given, is_correct) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const a of answers) {
      if (!a) continue;
      const wid = Number.isInteger(Number(a.word_id)) ? Number(a.word_id) : null;
      insert.run(
        resultId,
        wid,
        clip(a.word, LIMITS.word),
        clip(a.meaning, LIMITS.meaning),
        clip(a.given, LIMITS.given),
        a.is_correct ? 1 : 0
      );
      // 정답=grade 4, 오답=grade 1 로 SRS 자동 갱신 (review_log에는 기록하지 않음)
      if (wid) {
        const row = getWordStmt.get(wid);
        if (row) {
          const next = applySm2(row, a.is_correct ? 4 : 1);
          updateSrsStmt.run(next.ease, next.interval, next.reps, next.due_at, wid);
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.status(201).json({ id: Number(resultId) });
});

app.get('/api/results', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(db.prepare('SELECT * FROM quiz_results ORDER BY id DESC LIMIT ?').all(limit));
});

app.get('/api/results/:id', (req, res) => {
  const result = db.prepare('SELECT * FROM quiz_results WHERE id = ?').get(req.params.id);
  if (!result) return res.status(404).json({ error: '결과가 없습니다.' });
  const answers = db.prepare('SELECT * FROM quiz_answers WHERE result_id = ? ORDER BY id').all(req.params.id);
  res.json({ ...result, answers });
});

app.delete('/api/results/:id', (req, res) => {
  const info = db.prepare('DELETE FROM quiz_results WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '결과가 없습니다.' });
  res.json({ ok: true });
});

// ---------- 통계 ----------

function computeStreak() {
  const rows = db
    .prepare(
      `SELECT DISTINCT date(created_at) AS d FROM quiz_results
       UNION
       SELECT DISTINCT date(created_at) AS d FROM review_log`
    )
    .all();
  const dates = new Set(rows.map((r) => r.d));
  if (dates.size === 0) return 0;

  // 오늘 활동이 없으면 어제부터 계산 (어제도 없으면 0)
  let offset = 0;
  if (!dates.has(localDateStr(0))) {
    if (!dates.has(localDateStr(-1))) return 0;
    offset = -1;
  }
  let streak = 0;
  while (dates.has(localDateStr(offset - streak))) streak += 1;
  return streak;
}

app.get('/api/stats', (req, res) => {
  const totals = {
    words: db.prepare('SELECT COUNT(*) AS c FROM words').get().c,
    sets: db.prepare('SELECT COUNT(*) AS c FROM word_sets').get().c,
    starred: db.prepare('SELECT COUNT(*) AS c FROM words WHERE starred = 1').get().c,
    studied: db
      .prepare(
        `SELECT COUNT(*) AS c FROM words w
         WHERE EXISTS (SELECT 1 FROM quiz_answers a WHERE a.word_id = w.id)`
      )
      .get().c,
    tests: db.prepare('SELECT COUNT(*) AS c FROM quiz_results').get().c,
    avg_score:
      db
        .prepare(
          'SELECT CAST(ROUND(AVG(correct * 100.0 / total)) AS INTEGER) AS v FROM quiz_results'
        )
        .get().v ?? 0,
    answers: db.prepare('SELECT COUNT(*) AS c FROM quiz_answers').get().c,
    correct_answers: db
      .prepare('SELECT COALESCE(SUM(is_correct), 0) AS c FROM quiz_answers')
      .get().c,
    streak: computeStreak(),
    due_count: db.prepare(`SELECT COUNT(*) AS c FROM words WHERE ${DUE_WHERE}`).get().c,
  };

  // 최근 30일 (오늘 포함), 빈 날짜는 0으로 채움
  const quizByDay = new Map(
    db
      .prepare(
        `SELECT date(created_at) AS d, SUM(total) AS c FROM quiz_results
         WHERE date(created_at) >= date('now', 'localtime', '-29 days')
         GROUP BY date(created_at)`
      )
      .all()
      .map((r) => [r.d, Number(r.c)])
  );
  const reviewByDay = new Map(
    db
      .prepare(
        `SELECT date(created_at) AS d, COUNT(*) AS c FROM review_log
         WHERE date(created_at) >= date('now', 'localtime', '-29 days')
         GROUP BY date(created_at)`
      )
      .all()
      .map((r) => [r.d, Number(r.c)])
  );
  const daily = [];
  for (let i = 29; i >= 0; i -= 1) {
    const full = localDateStr(-i);
    const quizAnswers = quizByDay.get(full) || 0;
    const reviews = reviewByDay.get(full) || 0;
    daily.push({
      date: full.slice(5),
      full_date: full,
      quiz_answers: quizAnswers,
      reviews,
      total: quizAnswers + reviews,
    });
  }

  const score_trend = db
    .prepare(
      `SELECT id, CAST(ROUND(correct * 100.0 / total) AS INTEGER) AS pct, set_name, created_at
       FROM quiz_results ORDER BY id DESC LIMIT 20`
    )
    .all()
    .reverse();

  const weak_words = db
    .prepare(
      `SELECT w.id, w.word, w.meaning,
              COUNT(a.id) AS attempts,
              COALESCE(SUM(a.is_correct), 0) AS correct,
              CAST(ROUND(COALESCE(SUM(a.is_correct), 0) * 100.0 / COUNT(a.id)) AS INTEGER) AS rate,
              s.name AS set_name, w.starred
       FROM words w
       JOIN quiz_answers a ON a.word_id = w.id
       JOIN word_sets s ON s.id = w.set_id
       GROUP BY w.id
       HAVING COUNT(a.id) >= 2
       ORDER BY rate ASC, attempts DESC
       LIMIT 10`
    )
    .all();

  const mode_stats = db
    .prepare(
      `SELECT mode, COUNT(*) AS tests,
              CAST(ROUND(AVG(correct * 100.0 / total)) AS INTEGER) AS avg_pct
       FROM quiz_results GROUP BY mode ORDER BY tests DESC`
    )
    .all();

  res.json({ totals, daily, score_trend, weak_words, mode_stats });
});

// ---------- 영어 시험 일정 ----------

const EXAM_TYPES = new Set(['toeic', 'toeic_s', 'opic', 'teps', 'gtelp', 'etc']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD 형식만 통과, 아니면 null */
function dateOrNull(v) {
  const s = clip(v, 10);
  return DATE_RE.test(s) ? s : null;
}

app.get('/api/exams', (req, res) => {
  // ?upcoming=1 이면 오늘 이후(시험일 기준)만. is_mine = 내가 깃발 표시한 시험
  const base = `SELECT e.*, CASE WHEN m.exam_id IS NULL THEN 0 ELSE 1 END AS is_mine
     FROM exam_schedules e LEFT JOIN my_exams m ON m.exam_id = e.id`;
  const rows = req.query.upcoming
    ? db
        .prepare(
          `${base}
           WHERE date(e.exam_date) >= date('now', 'localtime')
           ORDER BY e.exam_date ASC, e.id ASC`
        )
        .all()
    : db.prepare(`${base} ORDER BY e.exam_date ASC, e.id ASC`).all();
  res.json(rows);
});

/** 내 시험 깃발 토글 — body { mine: true|false } */
app.patch('/api/exams/:id/mine', (req, res) => {
  const exam = db.prepare('SELECT id FROM exam_schedules WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ error: '일정이 없습니다.' });
  if (req.body.mine) db.prepare('INSERT OR IGNORE INTO my_exams (exam_id) VALUES (?)').run(exam.id);
  else db.prepare('DELETE FROM my_exams WHERE exam_id = ?').run(exam.id);
  res.json({ id: exam.id, is_mine: req.body.mine ? 1 : 0 });
});

app.post('/api/exams', (req, res) => {
  const exam_type = clip(req.body.exam_type, 20);
  const exam_date = dateOrNull(req.body.exam_date);
  if (!EXAM_TYPES.has(exam_type) || !exam_date)
    return res.status(400).json({ error: '시험 종류와 시험일(YYYY-MM-DD)은 필수입니다.' });

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO exam_schedules
        (exam_type, round, exam_date, reg_start, reg_end, late_start, late_end, result_date, link, note, is_sample)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      exam_type,
      clip(req.body.round, 40) || null,
      exam_date,
      dateOrNull(req.body.reg_start),
      dateOrNull(req.body.reg_end),
      dateOrNull(req.body.late_start),
      dateOrNull(req.body.late_end),
      dateOrNull(req.body.result_date),
      clip(req.body.link, 500) || null,
      clip(req.body.note, 300) || null,
      req.body.is_sample ? 1 : 0
    );
  res.status(201).json(db.prepare('SELECT * FROM exam_schedules WHERE id = ?').get(lastInsertRowid));
});

app.put('/api/exams/:id', (req, res) => {
  const exam_type = clip(req.body.exam_type, 20);
  const exam_date = dateOrNull(req.body.exam_date);
  if (!EXAM_TYPES.has(exam_type) || !exam_date)
    return res.status(400).json({ error: '시험 종류와 시험일(YYYY-MM-DD)은 필수입니다.' });

  const info = db
    .prepare(
      `UPDATE exam_schedules SET
        exam_type = ?, round = ?, exam_date = ?, reg_start = ?, reg_end = ?,
        late_start = ?, late_end = ?, result_date = ?, link = ?, note = ?, is_sample = ?
       WHERE id = ?`
    )
    .run(
      exam_type,
      clip(req.body.round, 40) || null,
      exam_date,
      dateOrNull(req.body.reg_start),
      dateOrNull(req.body.reg_end),
      dateOrNull(req.body.late_start),
      dateOrNull(req.body.late_end),
      dateOrNull(req.body.result_date),
      clip(req.body.link, 500) || null,
      clip(req.body.note, 300) || null,
      req.body.is_sample ? 1 : 0,
      req.params.id
    );
  if (info.changes === 0) return res.status(404).json({ error: '일정이 없습니다.' });
  res.json(db.prepare('SELECT * FROM exam_schedules WHERE id = ?').get(req.params.id));
});

app.delete('/api/exams/:id', (req, res) => {
  const info = db.prepare('DELETE FROM exam_schedules WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '일정이 없습니다.' });
  res.json({ ok: true });
});

/** 예시(더미) 일정만 한꺼번에 삭제 — 실제 일정 넣기 전 정리용 */
app.delete('/api/exams', (req, res) => {
  if (req.query.samples !== '1')
    return res.status(400).json({ error: 'samples=1 이 필요합니다.' });
  const info = db.prepare('DELETE FROM exam_schedules WHERE is_sample = 1').run();
  res.json({ deleted: info.changes });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- 프론트엔드 정적 파일 (빌드돼 있으면 서빙) ----------

const distDir = path.join(__dirname, '..', 'client', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// 잘못된 JSON 바디 등 파싱 에러를 400으로 (스택 노출 없이)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large')
    return res.status(413).json({ error: '요청이 너무 큽니다.' });
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError)
    return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
  console.error('[server error]', err?.message || err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
