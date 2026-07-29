import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api.js';
import { speak, ttsAvailable } from '../tts.js';
import { CHAPTER_SIZE } from '../config.js';
import Icon from '../components/Icon.jsx';
import { EmptyState } from '../components/ui.jsx';
import './set-detail.css';

const SORT_OPTIONS = [
  { value: 'added', label: '추가순' },
  { value: 'alpha', label: '가나다순' },
  { value: 'rate', label: '정답률 낮은순' },
];

const POS_FULL = { 명: '명사', 동: '동사', 형: '형용사', 부: '부사' };

/** 품사 태그 묶음 ("명·동" → 명 동 배지 2개) */
function PosTag({ pos }) {
  const tags = String(pos || '')
    .split('·')
    .filter(Boolean);
  if (tags.length === 0) return null;
  return (
    <span className="pos-tags">
      {tags.map((t) => (
        <span key={t} className={`pos-tag pos-${t}`} title={POS_FULL[t] || t}>
          {t}
        </span>
      ))}
    </span>
  );
}

/** 괄호 깊이를 인식해 최상위 쉼표로만 뜻을 분리 (서버 splitMeaningParts와 동일 규칙) */
function splitMeaning(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(s || '')) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * 뜻을 조각으로 나눠 각 조각 앞에 그 조각의 품사를 붙여 보여준다.
 *   pos_parts = "형|명|부|명"  →  [형] 옳은, [명] 오른쪽(의), [부] 바로, [명] 권리
 */
function MeaningWithPos({ meaning, posParts }) {
  const segs = splitMeaning(meaning);
  const tags = String(posParts || '').split('|');
  // 조각 수와 태그 수가 어긋나면(데이터 갱신 전 등) 뜻만 그대로 보여준다
  if (!posParts || tags.length !== segs.length) return <>{meaning}</>;
  return (
    <span className="meaning-parts">
      {segs.map((seg, i) => (
        <span key={i} className="meaning-part">
          {tags[i] && <PosTag pos={tags[i]} />}
          <span className="meaning-text">{seg}</span>
          {i < segs.length - 1 && <span className="meaning-sep">,</span>}
        </span>
      ))}
    </span>
  );
}

/** 시험 모드 표시 순서 · 짧은 라벨 (Day별 "어떤 시험 봤나" 배지용) */
const MODE_ORDER = ['meaning', 'kmeaning', 'mixed', 'dictation', 'choice'];
const MODE_LABEL = {
  meaning: '뜻→단어',
  kmeaning: '단어→뜻',
  mixed: '혼합',
  dictation: '받아쓰기',
  choice: '객관식',
};

/**
 * 이 Day를 어떤 시험 모드로 봤는지 보여주는 배지 줄.
 * 실제로 본 모드만 표시하고, 같은 모드를 여러 번 봐도 배지는 하나만 남는다.
 */
function ModeBadges({ modes, total }) {
  const taken = modes.filter((m) => m.done);
  if (taken.length === 0) return <span className="chapter-modes-empty muted">아직 시험 안 봄</span>;
  return (
    <div className="chapter-modes">
      {taken.map((m) => (
        <span
          key={m.key}
          className={`mode-badge ${m.full ? 'full' : 'partial'}`}
          title={
            m.full
              ? `${m.label} · 전체 ${total}단어 응시`
              : `${m.label} · ${m.covered}/${total} 단어만 출제됨`
          }
        >
          {m.label}
          {!m.full && <em>{m.covered}</em>}
        </span>
      ))}
    </div>
  );
}

/** 정렬용 정답률 (미학습은 맨 뒤로) */
function rateValue(w) {
  return w.attempts > 0 ? w.correct / w.attempts : 2;
}

function RateBadge({ word }) {
  if (!word.attempts) return <span className="muted sd-untested">미학습</span>;
  const rate = Math.round((word.correct / word.attempts) * 100);
  const tone = rate >= 80 ? 'ok' : rate >= 50 ? 'mid' : 'bad';
  return (
    <span className={`badge ${tone}`} title={`${word.correct}/${word.attempts} 정답`}>
      {rate}%
    </span>
  );
}

export default function SetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [set, setSet] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // 단어 추가
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [example, setExample] = useState('');
  const [adding, setAdding] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const wordInputRef = useRef(null);

  // 보기 모드: 'gallery'(Day 카드) | 'day'(선택한 Day 단어만) | 'list'(전체 목록)
  const [view, setView] = useState('gallery');
  const [activeDay, setActiveDay] = useState(null); // day 뷰에서 보고 있는 Day 번호 (1부터)
  const dayRef = useRef(null);

  // 도구줄
  const [query, setQuery] = useState('');
  const [starOnly, setStarOnly] = useState(false);
  const [sortKey, setSortKey] = useState('added');

  // 인라인 편집
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ word: '', meaning: '', example: '' });

  const canTts = ttsAvailable();

  useEffect(() => {
    let alive = true;
    setSet(null);
    setError('');
    api
      .getSet(id)
      .then((data) => {
        if (alive) setSet(data);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const reload = () =>
    api
      .getSet(id)
      .then(setSet)
      .catch((e) => setError(e.message));

  const words = set?.words ?? [];
  // 추가순 기준 전역 순번 (1부터) — 검색/정렬과 무관하게 고정
  const seqMap = useMemo(() => new Map(words.map((w, i) => [w.id, i + 1])), [words]);
  const starredCount = useMemo(() => words.filter((w) => w.starred).length, [words]);
  const studiedCount = useMemo(
    () => words.filter((w) => w.attempts > 0).length,
    [words]
  );
  const progressPct = words.length > 0 ? Math.round((studiedCount / words.length) * 100) : 0;

  // CHAPTER_SIZE 단위 챕터(Day) — 갤러리 뷰용. 각 Day의 학습률/정답률/별표/응시 모드 집계
  const chapters = useMemo(() => {
    const out = [];
    for (let i = 0; i < words.length; i += CHAPTER_SIZE) {
      const slice = words.slice(i, i + CHAPTER_SIZE);
      const studied = slice.filter((w) => w.attempts > 0).length;
      const attempted = slice.filter((w) => w.attempts > 0);
      const totalAtt = attempted.reduce((s, w) => s + w.attempts, 0);
      const totalCor = attempted.reduce((s, w) => s + w.correct, 0);

      // 이 Day를 어떤 시험 모드로 봤는지 (모드별로 몇 단어가 출제됐는지 함께 집계)
      const modeCount = new Map();
      for (const w of slice) {
        for (const m of w.modes || []) modeCount.set(m, (modeCount.get(m) || 0) + 1);
      }
      const modes = MODE_ORDER.map((m) => {
        const covered = modeCount.get(m) || 0;
        return {
          key: m,
          label: MODE_LABEL[m] || m,
          covered,
          done: covered > 0,
          full: covered >= slice.length,
        };
      });

      out.push({
        day: out.length + 1,
        from: i + 1,
        to: i + slice.length,
        words: slice,
        studied,
        starred: slice.filter((w) => w.starred).length,
        rate: totalAtt > 0 ? Math.round((totalCor / totalAtt) * 100) : null,
        modes,
      });
    }
    return out;
  }, [words]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = words;
    if (q) {
      list = list.filter(
        (w) => w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q)
      );
    }
    if (starOnly) list = list.filter((w) => w.starred);
    const sorted = [...list];
    if (sortKey === 'alpha') {
      sorted.sort((a, b) => a.word.localeCompare(b.word, 'en', { sensitivity: 'base' }));
    } else if (sortKey === 'rate') {
      sorted.sort((a, b) => rateValue(a) - rateValue(b) || b.attempts - a.attempts);
    } else {
      sorted.sort((a, b) => a.id - b.id);
    }
    return sorted;
  }, [words, query, starOnly, sortKey]);

  // day 뷰에서 보고 있는 Day (단어가 지워져 Day가 사라지면 갤러리로 되돌아간다)
  const activeChapter = useMemo(
    () => (view === 'day' ? (chapters.find((c) => c.day === activeDay) ?? null) : null),
    [view, chapters, activeDay]
  );
  const showDay = view === 'day' && activeChapter != null;
  const showGallery = view === 'gallery' || (view === 'day' && activeChapter == null);
  const dayPct = activeChapter
    ? Math.round((activeChapter.studied / activeChapter.words.length) * 100)
    : 0;

  // Day를 열면 그 화면이 보이도록 스크롤
  useEffect(() => {
    if (showDay) dayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showDay, activeDay]);

  function flashNotice(msg) {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 3000);
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!word.trim() || !meaning.trim() || adding) return;
    setAdding(true);
    setError('');
    try {
      await api.addWords(id, [
        { word: word.trim(), meaning: meaning.trim(), example: example.trim() },
      ]);
      setWord('');
      setMeaning('');
      setExample('');
      await reload();
      wordInputRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleBulkAdd() {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed = [];
    for (const line of lines) {
      // "word - 뜻", "word : 뜻", "word[TAB]뜻" 형식 지원
      const m = line.match(/^(.+?)\s*(?:[-:—\t])\s*(.+)$/);
      if (m) parsed.push({ word: m[1].trim(), meaning: m[2].trim() });
    }
    if (parsed.length === 0) {
      setError('추가할 단어를 찾지 못했어요. "단어 - 뜻" 형식으로 한 줄에 하나씩 입력하세요.');
      return;
    }
    setError('');
    try {
      const res = await api.addWords(id, parsed);
      setBulkText('');
      setShowBulk(false);
      await reload();
      flashNotice(`단어 ${res.added}개를 추가했어요.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleStar(w) {
    const next = w.starred ? 0 : 1;
    // 낙관적 갱신 후 실패 시 되돌림
    setSet((prev) =>
      prev
        ? {
            ...prev,
            words: prev.words.map((x) => (x.id === w.id ? { ...x, starred: next } : x)),
          }
        : prev
    );
    api.starWord(w.id, next).catch((err) => {
      setError(err.message);
      setSet((prev) =>
        prev
          ? {
              ...prev,
              words: prev.words.map((x) => (x.id === w.id ? { ...x, starred: w.starred } : x)),
            }
          : prev
      );
    });
  }

  function startEdit(w) {
    setEditingId(w.id);
    setEditForm({ word: w.word, meaning: w.meaning, example: w.example || '' });
  }

  async function saveEdit(e, w) {
    e.preventDefault();
    const payload = {
      word: editForm.word.trim(),
      meaning: editForm.meaning.trim(),
      example: editForm.example.trim(),
    };
    if (!payload.word || !payload.meaning) return;
    setError('');
    try {
      await api.updateWord(w.id, payload);
      setSet((prev) =>
        prev
          ? {
              ...prev,
              words: prev.words.map((x) =>
                x.id === w.id
                  ? { ...x, word: payload.word, meaning: payload.meaning, example: payload.example || null }
                  : x
              ),
            }
          : prev
      );
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteWord(w) {
    if (!window.confirm(`'${w.word}' 단어를 삭제할까요?`)) return;
    setError('');
    try {
      await api.deleteWord(w.id);
      setSet((prev) =>
        prev ? { ...prev, words: prev.words.filter((x) => x.id !== w.id) } : prev
      );
    } catch (err) {
      setError(err.message);
    }
  }

  /** 해당 Day 단어만 보는 화면으로 전환 */
  function openDay(day) {
    setEditingId(null);
    setActiveDay(day);
    setView('day');
  }

  /** 해당 Day만 골라 시험 설정으로 이동 */
  function startDayQuiz(day) {
    navigate(`/sets/${id}/quiz-setup`, { state: { chapters: [day] } });
  }

  /** 단어 한 줄 (편집 중이면 편집 폼). 전체 목록 뷰 / Day 뷰 공용 */
  function wordRow(w) {
    if (editingId === w.id) {
      return (
        <tr key={w.id} className="sd-edit-row">
          <td colSpan={5}>
            <form className="sd-edit-form" onSubmit={(e) => saveEdit(e, w)}>
              <input
                value={editForm.word}
                onChange={(e) => setEditForm((f) => ({ ...f, word: e.target.value }))}
                placeholder="영어 단어"
                aria-label="영어 단어"
                autoFocus
              />
              <input
                value={editForm.meaning}
                onChange={(e) => setEditForm((f) => ({ ...f, meaning: e.target.value }))}
                placeholder="뜻"
                aria-label="뜻"
              />
              <input
                value={editForm.example}
                onChange={(e) => setEditForm((f) => ({ ...f, example: e.target.value }))}
                placeholder="예문 (선택)"
                aria-label="예문 (선택)"
              />
              <div className="sd-edit-actions">
                <button
                  type="submit"
                  className="btn primary sm"
                  disabled={!editForm.word.trim() || !editForm.meaning.trim()}
                >
                  저장
                </button>
                <button type="button" className="btn sm" onClick={() => setEditingId(null)}>
                  취소
                </button>
              </div>
            </form>
          </td>
        </tr>
      );
    }
    return (
      <tr key={w.id}>
        <td className="sd-cell-speak">
          <button
            type="button"
            className="icon-btn sd-speak"
            title="발음 듣기"
            aria-label={`${w.word} 발음 듣기`}
            disabled={!canTts}
            onClick={() => speak(w.word)}
          >
            <Icon name="speaker" size={17} />
          </button>
        </td>
        <td className="sd-cell-word">
          <span className="sd-seq">{seqMap.get(w.id)}</span>
          <strong>{w.word}</strong>
          {w.example && <div className="sd-example muted">{w.example}</div>}
        </td>
        <td className="sd-cell-meaning">
          <MeaningWithPos meaning={w.meaning} posParts={w.pos_parts} />
        </td>
        <td className="sd-cell-rate">
          <RateBadge word={w} />
        </td>
        <td className="sd-cell-actions cell-actions">
          <button
            type="button"
            className={`icon-btn sd-star${w.starred ? ' on' : ''}`}
            title={w.starred ? '별표 해제' : '별표'}
            aria-label={`${w.word} ${w.starred ? '별표 해제' : '별표'}`}
            aria-pressed={!!w.starred}
            onClick={() => toggleStar(w)}
          >
            <Icon name={w.starred ? 'starFill' : 'star'} size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="수정"
            aria-label={`${w.word} 수정`}
            onClick={() => startEdit(w)}
          >
            <Icon name="pencil" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title="삭제"
            aria-label={`${w.word} 삭제`}
            onClick={() => handleDeleteWord(w)}
          >
            <Icon name="trash" size={16} />
          </button>
        </td>
      </tr>
    );
  }

  /** 단어 표 껍데기 (전체 목록 뷰 / Day 뷰 공용) */
  function wordTable(rows) {
    return (
      <div className="table-wrap">
        <table className="sd-table">
          <thead>
            <tr>
              <th className="sd-th-speak" aria-label="발음" />
              <th>단어</th>
              <th>뜻</th>
              <th>정답률</th>
              <th className="sd-th-actions" aria-label="관리" />
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }

  if (error && !set) {
    return (
      <div className="page">
        <p className="error-msg">
          <Icon name="x" size={16} />
          {error}
        </p>
        <Link to="/sets" className="btn">
          <Icon name="arrowLeft" size={16} />
          단어장 목록으로
        </Link>
      </div>
    );
  }

  if (!set) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 30, width: 140, marginBottom: '0.9rem' }} />
        <div className="skeleton" style={{ height: 66, marginBottom: '1.1rem' }} />
        <div className="skeleton" style={{ height: 150, marginBottom: '1.1rem' }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  return (
    <div className="page sd">
      <Link to="/sets" className="sd-back">
        <Icon name="arrowLeft" size={15} />
        단어장 목록
      </Link>

      <div className="page-head sd-head">
        <div className="sd-head-info">
          <h1>{set.name}</h1>
          <p className="sd-meta">
            단어 {words.length}개 · 별표 {starredCount}개 · 학습률 {progressPct}%
          </p>
        </div>
        <div className="sd-head-actions">
          <button
            type="button"
            className="btn primary"
            disabled={words.length === 0}
            onClick={() => navigate(`/sets/${id}/quiz-setup`)}
          >
            <Icon name="play" size={16} />
            시험 보기
          </button>
          <a
            className={`btn ghost${words.length === 0 ? ' disabled' : ''}`}
            href={`/api/sets/${id}/export`}
            download
            aria-disabled={words.length === 0}
            onClick={(e) => {
              if (words.length === 0) e.preventDefault();
            }}
          >
            <Icon name="download" size={16} />
            CSV
          </a>
        </div>
      </div>

      {error && (
        <p className="error-msg">
          <Icon name="x" size={16} />
          {error}
        </p>
      )}
      {notice && (
        <p className="sd-notice">
          <Icon name="check" size={16} />
          {notice}
        </p>
      )}

      <section className="panel sd-add">
        <h2 className="panel-title">
          <Icon name="plus" size={18} />
          단어 추가
        </h2>
        <form className="sd-add-form" onSubmit={handleAdd}>
          <input
            ref={wordInputRef}
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="영어 단어"
            aria-label="영어 단어"
          />
          <input
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            placeholder="뜻"
            aria-label="뜻"
          />
          <input
            value={example}
            onChange={(e) => setExample(e.target.value)}
            placeholder="예문 (선택)"
            aria-label="예문 (선택)"
          />
          <button
            type="submit"
            className="btn primary"
            disabled={adding || !word.trim() || !meaning.trim()}
          >
            추가
          </button>
        </form>
        <button
          type="button"
          className="btn subtle sm sd-bulk-toggle"
          onClick={() => setShowBulk((v) => !v)}
        >
          <Icon name="layers" size={15} />
          {showBulk ? '한꺼번에 추가 닫기' : '여러 개 한꺼번에 추가'}
        </button>
        {showBulk && (
          <div className="sd-bulk">
            <textarea
              rows={7}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'한 줄에 하나씩 입력하세요.\n\napple - 사과\nrun : 달리다\nbook\t책'}
              aria-label="여러 단어 한꺼번에 입력"
            />
            <div className="sd-bulk-actions">
              <span className="muted">"단어 - 뜻" · "단어 : 뜻" · 탭 구분을 지원해요.</span>
              <button type="button" className="btn primary sm" onClick={handleBulkAdd}>
                모두 추가
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 보기 전환: Day별 보기(갤러리·Day 상세) ↔ 전체 목록 */}
      <div className="sd-viewtabs" role="tablist" aria-label="보기 방식">
        <button
          type="button"
          role="tab"
          aria-selected={view !== 'list'}
          className={`sd-viewtab ${view !== 'list' ? 'selected' : ''}`}
          onClick={() => setView('gallery')}
        >
          <Icon name="layers" size={16} /> Day별 보기
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'list'}
          className={`sd-viewtab ${view === 'list' ? 'selected' : ''}`}
          onClick={() => setView('list')}
        >
          <Icon name="list" size={16} /> 전체 목록
        </button>
      </div>

      {showGallery &&
        (words.length === 0 ? (
          <section className="panel">
            <EmptyState
              icon="book"
              title="아직 단어가 없어요"
              desc="위의 입력창에서 첫 단어를 추가해 보세요."
            />
          </section>
        ) : (
          <div className="chapter-grid">
            {chapters.map((c) => {
              const pct = Math.round((c.studied / c.words.length) * 100);
              return (
                <div key={c.day} className="chapter-card">
                  <div className="chapter-top">
                    <span className="chapter-day">Day {c.day}</span>
                    {c.rate != null && (
                      <span
                        className={`badge ${c.rate >= 80 ? 'ok' : c.rate >= 50 ? 'mid' : 'bad'}`}
                      >
                        {c.rate}%
                      </span>
                    )}
                  </div>
                  <p className="chapter-range">
                    {c.from} ~ {c.to}
                    <span className="muted"> · {c.words.length}개</span>
                  </p>
                  <div className="chapter-preview">
                    {c.words.slice(0, 3).map((w) => (
                      <span key={w.id}>{w.word}</span>
                    ))}
                    {c.words.length > 3 && <span className="muted">…</span>}
                  </div>
                  <div className="chapter-bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="chapter-meta muted">
                    학습 {c.studied}/{c.words.length}
                    {c.starred > 0 && (
                      <>
                        {' · '}
                        <Icon name="starFill" size={12} /> {c.starred}
                      </>
                    )}
                  </div>
                  <ModeBadges modes={c.modes} total={c.words.length} />
                  <div className="chapter-actions">
                    <button
                      type="button"
                      className="btn primary sm"
                      onClick={() => startDayQuiz(c.day)}
                    >
                      <Icon name="play" size={14} /> 시험
                    </button>
                    <button type="button" className="btn sm" onClick={() => openDay(c.day)}>
                      <Icon name="list" size={14} /> 단어 보기
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {/* 선택한 Day의 단어만 보는 화면 */}
      {showDay && (
        <section className="panel sd-day" ref={dayRef}>
          <div className="sd-day-head">
            <button
              type="button"
              className="btn subtle sm sd-day-back"
              onClick={() => setView('gallery')}
            >
              <Icon name="arrowLeft" size={15} />
              Day 목록
            </button>
            <div className="sd-day-title">
              <h2>Day {activeChapter.day}</h2>
              <p className="sd-day-sub">
                {activeChapter.from} ~ {activeChapter.to} · {activeChapter.words.length}개
              </p>
            </div>
            <button
              type="button"
              className="btn primary sm sd-day-quiz"
              onClick={() => startDayQuiz(activeChapter.day)}
            >
              <Icon name="play" size={15} />
              이 Day 시험
            </button>
          </div>

          <div className="sd-day-summary">
            <div className="sd-day-stats">
              <span>
                학습 <b>{activeChapter.studied}</b> / {activeChapter.words.length} ({dayPct}%)
              </span>
              <span>
                정답률{' '}
                <b>{activeChapter.rate != null ? `${activeChapter.rate}%` : '미학습'}</b>
              </span>
              <span className="sd-day-star">
                <Icon name="starFill" size={13} /> 별표 <b>{activeChapter.starred}</b>
              </span>
            </div>
            <div className="chapter-bar">
              <i style={{ width: `${dayPct}%` }} />
            </div>
            <div className="sd-day-modes">
              <span className="sd-day-modes-label muted">본 시험</span>
              <ModeBadges modes={activeChapter.modes} total={activeChapter.words.length} />
            </div>
          </div>

          {wordTable(activeChapter.words.map((w) => wordRow(w)))}

          <div className="sd-day-foot">
            <button type="button" className="btn" onClick={() => setView('gallery')}>
              <Icon name="arrowLeft" size={16} />
              Day 목록으로
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => startDayQuiz(activeChapter.day)}
            >
              <Icon name="play" size={16} />
              Day {activeChapter.day} 시험 보기
            </button>
          </div>
        </section>
      )}

      <section className="panel sd-list" hidden={view !== 'list'}>
        <div className="sd-list-head">
          <h2 className="panel-title">
            <Icon name="list" size={18} />
            단어 목록
            <span className="sd-count">{visible.length}</span>
          </h2>
          <div className="sd-tools">
            <div className="search-box sd-search">
              <Icon name="search" size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="단어·뜻 검색"
                aria-label="단어 또는 뜻 검색"
              />
            </div>
            <button
              type="button"
              className={`chip${starOnly ? ' selected' : ''}`}
              onClick={() => setStarOnly((v) => !v)}
              aria-pressed={starOnly}
            >
              <Icon name={starOnly ? 'starFill' : 'star'} size={14} />
              별표만
            </button>
            <select
              className="sd-sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              aria-label="정렬"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {words.length === 0 ? (
          <EmptyState
            icon="book"
            title="아직 단어가 없어요"
            desc="위의 입력창에서 첫 단어를 추가해 보세요."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="search"
            title="조건에 맞는 단어가 없어요"
            desc="검색어나 필터를 바꿔 보세요."
          />
        ) : (
          wordTable(
            visible.flatMap((w) => {
              const seq = seqMap.get(w.id);
              // 기본 보기(추가순·필터 없음)에서는 CHAPTER_SIZE 마다 구분 줄로 묶는다
              const showGroups = sortKey === 'added' && !query.trim() && !starOnly;
              const rows = [];
              if (showGroups && (seq - 1) % CHAPTER_SIZE === 0) {
                rows.push(
                  <tr className="sd-group-row" key={`group-${seq}`} id={`grp-${seq}`}>
                    <td colSpan={5}>
                      Day {Math.floor((seq - 1) / CHAPTER_SIZE) + 1} · {seq} ~{' '}
                      {Math.min(seq + CHAPTER_SIZE - 1, words.length)}
                    </td>
                  </tr>
                );
              }
              rows.push(wordRow(w));
              return rows;
            })
          )
        )}
      </section>
    </div>
  );
}
