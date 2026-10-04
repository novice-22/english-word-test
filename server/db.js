import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'vocab.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS word_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL REFERENCES word_sets(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    example TEXT,
    starred INTEGER NOT NULL DEFAULT 0,
    ease REAL NOT NULL DEFAULT 2.5,
    "interval" REAL NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    due_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER REFERENCES word_sets(id) ON DELETE SET NULL,
    set_name TEXT NOT NULL,
    mode TEXT NOT NULL,
    total INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    duration_sec INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS quiz_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_id INTEGER NOT NULL REFERENCES quiz_results(id) ON DELETE CASCADE,
    word_id INTEGER,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    given TEXT,
    is_correct INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS review_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER,
    grade INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 영어 시험 일정 (토익·토익스피킹·오픽 등). 공식 API가 없어 직접 입력해 관리한다.
  CREATE TABLE IF NOT EXISTS exam_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_type TEXT NOT NULL,          -- toeic | toeic_s | opic | teps | gtelp
    round TEXT,                       -- 회차 (예: "제402회")
    exam_date TEXT NOT NULL,          -- 시험일 YYYY-MM-DD
    reg_start TEXT,                   -- 접수 시작일
    reg_end TEXT,                     -- 접수 마감일
    late_start TEXT,                  -- 추가접수 시작일
    late_end TEXT,                    -- 추가접수 마감일
    result_date TEXT,                 -- 성적 발표일
    link TEXT,                        -- 공식 안내 링크
    note TEXT,                        -- 비고
    is_sample INTEGER NOT NULL DEFAULT 0,  -- 1이면 예시 데이터(실제 일정 아님)
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 내가 응시하기로 깃발 표시한 시험. 로그인 도입 시 user_id 컬럼을 붙여 사용자별로 확장한다.
  CREATE TABLE IF NOT EXISTS my_exams (
    exam_id INTEGER PRIMARY KEY REFERENCES exam_schedules(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_exam_date ON exam_schedules(exam_date);
  CREATE INDEX IF NOT EXISTS idx_words_set ON words(set_id);
  CREATE INDEX IF NOT EXISTS idx_answers_result ON quiz_answers(result_id);
  CREATE INDEX IF NOT EXISTS idx_answers_word ON quiz_answers(word_id);
  CREATE INDEX IF NOT EXISTS idx_review_log_word ON review_log(word_id);
`);

// ---------- 마이그레이션 (기존 DB에 새 컬럼 추가, 매 시작마다 안전하게 실행) ----------

function hasColumn(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}

function addColumnIfMissing(table, column, ddl) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

addColumnIfMissing('words', 'starred', 'starred INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('words', 'ease', 'ease REAL NOT NULL DEFAULT 2.5');
addColumnIfMissing('words', 'interval', '"interval" REAL NOT NULL DEFAULT 0');
addColumnIfMissing('words', 'reps', 'reps INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('words', 'due_at', 'due_at TEXT');
addColumnIfMissing('words', 'pos', 'pos TEXT'); // 단어 전체 품사 (명/동/형/부, 여러 개면 · 로 연결)
addColumnIfMissing('words', 'pos_parts', 'pos_parts TEXT'); // 뜻 조각별 품사 ("형|명|부|명")
addColumnIfMissing('words', 'phonetic', 'phonetic TEXT'); // 발음기호 IPA, 슬래시 없이 ("ˈkʌntɹi")
addColumnIfMissing('quiz_results', 'duration_sec', 'duration_sec INTEGER');

// due_at 컬럼이 (마이그레이션 이후) 존재해야 만들 수 있는 인덱스
db.exec('CREATE INDEX IF NOT EXISTS idx_words_due ON words(due_at)');

// ---------- SM-2 알고리즘 ----------

const dueDateStmt = db.prepare(
  "SELECT date('now', 'localtime', '+' || ? || ' days') AS due_at"
);

/**
 * SM-2 간격 반복 계산. wordRow의 현재 상태와 grade(0~5)를 받아
 * 새 {ease, interval, reps, due_at}를 반환한다 (DB 갱신은 호출자 몫).
 */
export function applySm2(wordRow, grade) {
  let ease = Number(wordRow.ease) || 2.5;
  let interval = Number(wordRow.interval) || 0;
  let reps = Number(wordRow.reps) || 0;

  if (grade < 3) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ease);
  }
  if (interval < 1) interval = 1;

  ease = Math.max(1.3, ease + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));

  const { due_at } = dueDateStmt.get(String(Math.round(interval)));
  return { ease, interval, reps, due_at };
}

export default db;
