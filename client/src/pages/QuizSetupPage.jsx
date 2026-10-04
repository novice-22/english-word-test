import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../api.js';
import { getTtsSettings, setTtsSettings, ttsAvailable } from '../tts.js';
import { CHAPTER_SIZE } from '../config.js';
import Icon from '../components/Icon.jsx';
import './learn.css';


const MODES = [
  { key: 'meaning', icon: 'keyboard', title: '뜻 보고 쓰기', desc: '한글 뜻을 보고 영어 단어를 입력해요' },
  { key: 'kmeaning', icon: 'pencil', title: '단어 보고 뜻 쓰기', desc: '영어 단어를 보고 한글 뜻을 입력해요' },
  { key: 'mixed', icon: 'refresh', title: '혼합 (랜덤)', desc: '문제마다 뜻↔단어 방향이 무작위로 나와요' },
  { key: 'dictation', icon: 'headphones', title: '듣고 받아쓰기', desc: '발음을 듣고 영어 단어를 입력해요' },
  { key: 'choice', icon: 'list', title: '객관식', desc: '영어 단어를 보고 알맞은 뜻을 골라요' },
];

const SCOPES = [
  { key: 'all', label: '전체' },
  { key: 'chapters', label: 'Day 선택' },
  { key: 'custom', label: '직접 범위' },
  { key: 'starred', label: '별표만' },
  { key: 'weak', label: '취약 단어' },
];

const COUNT_OPTIONS = [5, 10, 20, 30, 50];

const ACCENT_OPTIONS = [
  { value: 'en-US', label: '미국식' },
  { value: 'en-GB', label: '영국식' },
];

const RATE_OPTIONS = [
  { value: 0.75, label: '느리게' },
  { value: 0.9, label: '보통' },
  { value: 1.1, label: '빠르게' },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuizSetupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state: navState } = useLocation();

  const [set, setSet] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('meaning');
  const [scope, setScope] = useState('all');
  const [selectedDays, setSelectedDays] = useState(() => new Set());
  const [customFrom, setCustomFrom] = useState(1);
  const [customTo, setCustomTo] = useState(30);
  const [count, setCount] = useState('all');
  // 발음 듣기 버튼은 항상 표시 (소리는 눌렀을 때만 재생)
  const [tts, setTts] = useState(getTtsSettings);

  useEffect(() => {
    let alive = true;
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

  const all = set?.words ?? [];

  // CHAPTER_SIZE 단위 챕터(Day) 목록
  const chapters = useMemo(() => {
    const out = [];
    for (let i = 0; i < all.length; i += CHAPTER_SIZE) {
      out.push({ day: out.length + 1, start: i, end: Math.min(i + CHAPTER_SIZE, all.length) });
    }
    return out;
  }, [all]);

  // 갤러리에서 넘어온 사전 선택(state) 반영
  useEffect(() => {
    if (!navState || all.length === 0) return;
    if (Array.isArray(navState.chapters) && navState.chapters.length) {
      setScope('chapters');
      setSelectedDays(new Set(navState.chapters));
    } else if (Number.isInteger(navState.from) && Number.isInteger(navState.to)) {
      setScope('custom');
      setCustomFrom(navState.from);
      setCustomTo(navState.to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navState, all.length]);

  const starred = useMemo(() => all.filter((w) => w.starred), [all]);
  const weak = useMemo(
    () =>
      all
        .filter((w) => w.attempts > 0)
        .slice()
        .sort((a, b) => a.correct / a.attempts - b.correct / b.attempts),
    [all]
  );

  // 현재 범위의 단어 목록
  const rangeWords = useMemo(() => {
    if (scope === 'all') return all;
    if (scope === 'starred') return starred;
    if (scope === 'weak') return weak;
    if (scope === 'chapters') {
      const days = [...selectedDays].sort((a, b) => a - b);
      return days.flatMap((d) => {
        const ch = chapters[d - 1];
        return ch ? all.slice(ch.start, ch.end) : [];
      });
    }
    if (scope === 'custom') {
      const lo = Math.max(1, Math.min(customFrom, customTo));
      const hi = Math.min(all.length, Math.max(customFrom, customTo));
      return all.slice(lo - 1, hi);
    }
    return all;
  }, [scope, all, starred, weak, selectedDays, chapters, customFrom, customTo]);

  const rangeCount = rangeWords.length;

  useEffect(() => {
    if (count !== 'all' && count >= rangeCount) setCount('all');
  }, [scope, rangeCount, count]);

  function changeTts(partial) {
    setTts(setTtsSettings(partial));
  }

  function toggleDay(day) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  if (error) {
    return (
      <div className="page">
        <p className="error-msg">
          <Icon name="x" size={16} /> {error}
        </p>
        <Link to="/sets" className="btn ghost">
          <Icon name="arrowLeft" size={16} /> 단어장 목록으로
        </Link>
      </div>
    );
  }

  if (!set) {
    return (
      <div className="page learn-skeletons">
        <div className="skeleton" style={{ height: 30, width: 200 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 'var(--radius)' }} />
        <div className="skeleton" style={{ height: 140, borderRadius: 'var(--radius)' }} />
      </div>
    );
  }

  const choiceDisabled = all.length < 4;
  const visibleCounts = COUNT_OPTIONS.filter((n) => n < rangeCount);
  const quizCount = count === 'all' ? rangeCount : Math.min(count, rangeCount);
  const canStart = quizCount > 0 && !(mode === 'choice' && choiceDisabled);

  function rangeLabelText() {
    if (scope === 'chapters' && selectedDays.size) {
      const days = [...selectedDays].sort((a, b) => a - b);
      return ` · ${days.map((d) => `${d}일차`).join(',')}`;
    }
    if (scope === 'custom') return ` · ${Math.min(customFrom, customTo)}~${Math.max(customFrom, customTo)}`;
    if (scope === 'starred') return ' · 별표';
    if (scope === 'weak') return ' · 취약';
    return '';
  }

  function start() {
    if (!canStart) return;
    const picked =
      scope === 'weak'
        ? shuffle(rangeWords.slice(0, quizCount))
        : shuffle(rangeWords).slice(0, quizCount);
    const words = picked.map((w) => ({
      id: w.id,
      word: w.word,
      meaning: w.meaning,
      example: w.example,
      phonetic: w.phonetic,
    }));
    const setName = set.name + rangeLabelText();

    navigate('/quiz', {
      state: {
        setId: set.id,
        setName,
        mode,
        listenHint: true,
        words,
        pool: all.map((w) => ({ word: w.word, meaning: w.meaning })),
      },
    });
  }

  return (
    <div className="page setup-page">
      <Link to={`/sets/${id}`} className="learn-back">
        <Icon name="arrowLeft" size={16} /> {set.name}
      </Link>
      <div className="page-head">
        <div>
          <h1>시험 설정</h1>
          <p>
            {set.name} · 단어 {all.length}개
          </p>
        </div>
      </div>

      <div className="setup-panels">
        <section className="panel">
          <h2 className="panel-title">
            <Icon name="bolt" size={18} /> 시험 모드
          </h2>
          <div className="mode-grid">
            {MODES.map((m) => {
              const disabled = m.key === 'choice' && choiceDisabled;
              return (
                <button
                  key={m.key}
                  type="button"
                  className={`mode-card ${mode === m.key ? 'selected' : ''}`}
                  onClick={() => setMode(m.key)}
                  disabled={disabled}
                  aria-pressed={mode === m.key}
                >
                  <span className="mode-card-icon">
                    <Icon name={m.icon} size={19} />
                  </span>
                  <strong>{m.title}</strong>
                  <span>{m.desc}</span>
                </button>
              );
            })}
          </div>
          {choiceDisabled && (
            <p className="setup-note">객관식은 단어가 4개 이상일 때 선택할 수 있어요.</p>
          )}
          {mode === 'dictation' && !ttsAvailable() && (
            <p className="error-msg">
              <Icon name="x" size={16} /> 이 브라우저는 음성 재생(TTS)을 지원하지 않아요.
            </p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <Icon name="target" size={18} /> 범위와 문제 수
          </h2>
          <p className="setup-sub">출제 범위</p>
          <div className="chip-row">
            {SCOPES.map((s) => {
              const cnt =
                s.key === 'all'
                  ? all.length
                  : s.key === 'starred'
                    ? starred.length
                    : s.key === 'weak'
                      ? weak.length
                      : null;
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`chip ${scope === s.key ? 'selected' : ''}`}
                  onClick={() => setScope(s.key)}
                >
                  {s.label}
                  {cnt != null ? ` (${cnt})` : ''}
                </button>
              );
            })}
          </div>

          {scope === 'chapters' && (
            <div className="setup-days">
              <div className="setup-days-head">
                <span className="muted">학습할 Day를 선택하세요 (여러 개 가능)</span>
                <div className="setup-days-actions">
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setSelectedDays(new Set(chapters.map((c) => c.day)))}
                  >
                    전체
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => setSelectedDays(new Set())}>
                    해제
                  </button>
                </div>
              </div>
              <div className="day-grid">
                {chapters.map((c) => (
                  <button
                    key={c.day}
                    type="button"
                    className={`day-chip ${selectedDays.has(c.day) ? 'selected' : ''}`}
                    onClick={() => toggleDay(c.day)}
                    title={`${c.start + 1}~${c.end}`}
                  >
                    {c.day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {scope === 'custom' && (
            <div className="setup-custom">
              <span className="muted">단어 순번 범위</span>
              <div className="setup-custom-row">
                <input
                  type="number"
                  min="1"
                  max={all.length}
                  value={customFrom}
                  onChange={(e) => setCustomFrom(Math.max(1, Math.min(all.length, Number(e.target.value) || 1)))}
                  aria-label="시작 번호"
                />
                <span>~</span>
                <input
                  type="number"
                  min="1"
                  max={all.length}
                  value={customTo}
                  onChange={(e) => setCustomTo(Math.max(1, Math.min(all.length, Number(e.target.value) || 1)))}
                  aria-label="끝 번호"
                />
                <span className="muted">/ {all.length}</span>
              </div>
            </div>
          )}

          {scope === 'weak' && rangeCount > 0 && (
            <p className="setup-note">정답률이 낮은 단어부터 우선 출제돼요.</p>
          )}

          {rangeCount === 0 ? (
            <p className="setup-note">선택한 범위에 단어가 없어요. 다른 범위를 선택해 주세요.</p>
          ) : (
            <>
              <p className="setup-sub">
                문제 수 <span className="muted">(선택 범위 {rangeCount}개)</span>
              </p>
              <div className="chip-row">
                {visibleCounts.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`chip ${count === n ? 'selected' : ''}`}
                    onClick={() => setCount(n)}
                  >
                    {n}개
                  </button>
                ))}
                <button
                  type="button"
                  className={`chip ${count === 'all' ? 'selected' : ''}`}
                  onClick={() => setCount('all')}
                >
                  전체 ({rangeCount}개)
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">
            <Icon name="speaker" size={18} /> 발음 설정
          </h2>
          <p className="setup-note" style={{ marginTop: 0 }}>
            시험 중 소리는 자동으로 나지 않고, 🔊 버튼을 눌렀을 때만 재생돼요.
          </p>
          <p className="setup-sub">억양</p>
          <div className="chip-row">
            {ACCENT_OPTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                className={`chip ${tts.accent === a.value ? 'selected' : ''}`}
                onClick={() => changeTts({ accent: a.value })}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="setup-sub">속도</p>
          <div className="chip-row">
            {RATE_OPTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`chip ${Math.abs(tts.rate - r.value) < 0.01 ? 'selected' : ''}`}
                onClick={() => changeTts({ rate: r.value })}
              >
                {r.label}
              </button>
            ))}
          </div>
        </section>
      </div>

      <button
        type="button"
        className="btn primary lg full setup-start"
        onClick={start}
        disabled={!canStart}
      >
        <Icon name="play" size={18} />
        시험 시작 ({quizCount}문제)
      </button>
      {!canStart && rangeCount === 0 && (
        <p className="setup-note center">선택한 범위에 단어가 없어 시작할 수 없어요.</p>
      )}
    </div>
  );
}
