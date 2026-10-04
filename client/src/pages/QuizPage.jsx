import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api } from '../api.js';
import { speak, ttsAvailable } from '../tts.js';
import { gradeKoreanMeaning } from '../grading.js';
import { getPrefs } from '../prefs.js';
import Icon from '../components/Icon.jsx';
import { ProgressBar } from '../components/ui.jsx';
import './learn.css';

function normalizeAnswer(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuizPage() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const valid = !!(state && Array.isArray(state.words) && state.words.length > 0 && state.mode);
  const words = valid ? state.words : [];
  const mode = valid ? state.mode : 'meaning';
  const total = words.length;

  // 혼합 모드: 문제마다 뜻→단어(meaning) / 단어→뜻(kmeaning) 방향을 무작위로 고정
  const directions = useMemo(() => {
    if (!valid || mode !== 'mixed') return null;
    return words.map(() => (Math.random() < 0.5 ? 'meaning' : 'kmeaning'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, mode]);

  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [picked, setPicked] = useState(null); // 객관식: 선택한 보기 인덱스
  const [answers, setAnswers] = useState([]);
  const [feedback, setFeedback] = useState(null); // null | { isCorrect }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [combo, setCombo] = useState(0); // 연속 정답
  const [hint, setHint] = useState(false); // 이번 문제 스펠링 힌트 표시
  const inputRef = useRef(null);
  const startRef = useRef(Date.now());
  const prefs = useMemo(() => getPrefs(), []);

  // 객관식 보기: 문제마다 정답 뜻 + pool에서 다른 뜻 3개 (중복 제거 후 셔플)
  const choiceOptions = useMemo(() => {
    if (!valid || mode !== 'choice') return null;
    const source = Array.isArray(state.pool) && state.pool.length > 0 ? state.pool : words;
    const meanings = [...new Set(source.map((p) => p.meaning))];
    return words.map((w) => {
      const others = shuffle(meanings.filter((m) => m !== w.meaning)).slice(0, 3);
      return shuffle([w.meaning, ...others]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const current = valid ? words[index] : null;
  // 이번 문제의 실제 모드 (혼합이면 방향을 뽑아옴)
  const qMode = mode === 'mixed' ? (directions?.[index] ?? 'meaning') : mode;

  // 입력 모드: 문제 표시 시 입력창 포커스
  useEffect(() => {
    if (!feedback) inputRef.current?.focus();
  }, [index, feedback]);

  function record(given, isCorrect) {
    setAnswers((prev) => [
      ...prev,
      {
        word_id: current.id || null,
        word: current.word,
        meaning: current.meaning,
        given,
        is_correct: isCorrect,
      },
    ]);
    setFeedback({ isCorrect });
    setCombo((c) => (isCorrect ? c + 1 : 0));
    if (!isCorrect && prefs.speakOnWrong) speak(current.word);
  }

  function submitAnswer(e) {
    e.preventDefault();
    if (feedback) return;
    const isCorrect =
      qMode === 'kmeaning'
        ? gradeKoreanMeaning(input, current.meaning)
        : normalizeAnswer(input) === normalizeAnswer(current.word);
    record(input.trim(), isCorrect);
  }

  /** 스펠링 힌트: 첫 글자 + 글자 수 (예: a _ _ _ _ _ _) */
  const hintText = useMemo(() => {
    if (!current) return '';
    return current.word
      .split('')
      .map((ch, i) => (i === 0 || !/[a-zA-Z]/.test(ch) ? ch : '_'))
      .join(' ');
  }, [current]);

  function pick(i) {
    if (feedback) return;
    const opts = choiceOptions[index];
    setPicked(i);
    record(opts[i], opts[i] === current.meaning);
  }

  async function next() {
    if (saving) return;
    if (index + 1 < total) {
      setFeedback(null);
      setInput('');
      setPicked(null);
      setHint(false);
      setIndex(index + 1);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const duration = Math.max(0, Math.round((Date.now() - startRef.current) / 1000));
      const { id } = await api.saveResult({
        set_id: state.setId || null,
        set_name: state.setName || '이름 없는 시험',
        mode,
        duration_sec: duration,
        answers,
      });
      navigate(`/results/${id}`, { replace: true });
    } catch (e) {
      setError(`결과 저장 실패: ${e.message}`);
      setSaving(false);
    }
  }

  // 키보드: 피드백 중 Enter → 다음, 객관식 1~4 → 보기 선택
  useEffect(() => {
    function onKey(e) {
      if (!valid) return;
      if (feedback) {
        if (e.key === 'Enter') {
          // 버튼에 포커스가 있으면 기본 클릭 동작에 맡긴다 (중복 실행 방지)
          if (e.target?.tagName === 'BUTTON') return;
          e.preventDefault();
          next();
        }
        return;
      }
      if (mode === 'choice' && ['1', '2', '3', '4'].includes(e.key)) {
        const i = Number(e.key) - 1;
        const opts = choiceOptions?.[index] || [];
        if (i < opts.length) {
          e.preventDefault();
          pick(i);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 정답 시 자동 넘김 (설정에서 켠 경우)
  useEffect(() => {
    if (!feedback?.isCorrect || !prefs.autoNext || saving) return undefined;
    const t = setTimeout(() => next(), 850);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  if (!valid) return <Navigate to="/" replace />;

  function quit() {
    if (window.confirm('시험을 그만둘까요? 지금까지 푼 내용은 저장되지 않아요.')) {
      navigate(state.setId ? `/sets/${state.setId}` : '/');
    }
  }

  const opts = mode === 'choice' ? choiceOptions[index] : null;
  const cardState = feedback ? (feedback.isCorrect ? 'is-ok' : 'is-bad shake') : '';
  const mixedTag = mode === 'mixed' ? (qMode === 'kmeaning' ? '단어→뜻' : '뜻→단어') : null;

  return (
    <div className="page quiz-page">
      <div className="quiz-wrap">
        <div className="quiz-top">
          <button type="button" className="btn subtle sm" onClick={quit}>
            <Icon name="x" size={15} /> 그만두기
          </button>
          <div className="quiz-topinfo">
            {combo >= 2 && (
              <span className="combo-chip" key={combo}>
                ⚡ ×{combo}
              </span>
            )}
            <span className="quiz-set muted">{state.setName}</span>
            <span className="quiz-count">
              {index + 1} / {total}
            </span>
          </div>
        </div>
        <ProgressBar value={index + (feedback ? 1 : 0)} max={total} />

        <div className={`quiz-card ${cardState}`}>
          {mode === 'choice' ? (
            <>
              <p className="quiz-label">다음 단어의 뜻은?</p>
              <p className="quiz-question quiz-word">
                {current.word}
                {ttsAvailable() && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => speak(current.word)}
                    aria-label="발음 듣기"
                  >
                    <Icon name="speaker" size={19} />
                  </button>
                )}
              </p>
              {current.phonetic && <p className="quiz-phonetic">/{current.phonetic}/</p>}
              <div className="choice-list">
                {opts.map((opt, i) => {
                  let cls = 'choice-btn';
                  if (feedback) {
                    if (opt === current.meaning) cls += ' correct';
                    else if (picked === i) cls += ' wrong';
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      className={cls}
                      onClick={() => pick(i)}
                      disabled={!!feedback}
                    >
                      <span className="choice-num">{i + 1}</span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </>
          ) : mode === 'dictation' ? (
            <>
              <p className="quiz-label">발음을 듣고 영어 단어를 입력하세요</p>
              <div className="quiz-tts-row">
                <button type="button" className="btn ghost" onClick={() => speak(current.word)}>
                  <Icon name="speaker" size={18} /> 발음 듣기
                </button>
              </div>
              <form className="quiz-form" onSubmit={submitAnswer}>
                <input
                  ref={inputRef}
                  className="quiz-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="영어 단어 입력"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={!!feedback}
                />
                {!feedback && (
                  <button type="submit" className="btn primary lg full">
                    제출 (Enter)
                  </button>
                )}
              </form>
            </>
          ) : qMode === 'kmeaning' ? (
            <>
              {mixedTag && <span className="quiz-mixtag">{mixedTag}</span>}
              <p className="quiz-label">다음 단어의 뜻은? (여러 뜻 중 1개만 써도 돼요)</p>
              <p className="quiz-question quiz-word">
                {current.word}
                {ttsAvailable() && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => speak(current.word)}
                    aria-label="발음 듣기"
                  >
                    <Icon name="speaker" size={19} />
                  </button>
                )}
              </p>
              {current.phonetic && <p className="quiz-phonetic">/{current.phonetic}/</p>}
              <form className="quiz-form" onSubmit={submitAnswer}>
                <input
                  ref={inputRef}
                  className="quiz-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="한글 뜻 입력"
                  autoComplete="off"
                  disabled={!!feedback}
                />
                {!feedback && (
                  <button type="submit" className="btn primary lg full">
                    제출 (Enter)
                  </button>
                )}
              </form>
            </>
          ) : (
            <>
              {mixedTag && <span className="quiz-mixtag">{mixedTag}</span>}
              <p className="quiz-label">다음 뜻에 맞는 영어 단어는?</p>
              <p className="quiz-question">{current.meaning}</p>
              {(state.listenHint && ttsAvailable()) || !feedback ? (
                <div className="quiz-tts-row">
                  {state.listenHint && ttsAvailable() && (
                    <button type="button" className="btn ghost sm" onClick={() => speak(current.word)}>
                      <Icon name="speaker" size={16} /> 발음 듣기
                    </button>
                  )}
                  {!feedback && !hint && (
                    <button type="button" className="btn ghost sm" onClick={() => setHint(true)}>
                      <Icon name="search" size={16} /> 힌트
                    </button>
                  )}
                </div>
              ) : null}
              {hint && !feedback && <p className="quiz-hint">{hintText}</p>}
              <form className="quiz-form" onSubmit={submitAnswer}>
                <input
                  ref={inputRef}
                  className="quiz-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="영어 단어 입력"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={!!feedback}
                />
                {!feedback && (
                  <button type="submit" className="btn primary lg full">
                    제출 (Enter)
                  </button>
                )}
              </form>
            </>
          )}

          {feedback && (
            <div className="quiz-feedback">
              {feedback.isCorrect ? (
                <p className="fb-title ok">
                  <span className="fb-icon pop">
                    <Icon name="check" size={20} />
                  </span>
                  정답이에요!
                </p>
              ) : (
                <>
                  <p className="fb-title bad">
                    <span className="fb-icon">
                      <Icon name="x" size={20} />
                    </span>
                    아쉬워요
                  </p>
                  <div className="fb-answer">
                    <div className="fb-word">
                      {ttsAvailable() && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => speak(current.word)}
                          aria-label="발음 듣기"
                        >
                          <Icon name="speaker" size={17} />
                        </button>
                      )}
                      <strong>{current.word}</strong>
                    </div>
                    {current.phonetic && <div className="fb-phonetic">/{current.phonetic}/</div>}
                    <div className="fb-meaning">{current.meaning}</div>
                    {current.example && <div className="fb-example">{current.example}</div>}
                  </div>
                </>
              )}
              <button type="button" className="btn primary lg full" onClick={next} disabled={saving}>
                {saving ? '결과 저장 중…' : index + 1 < total ? '다음 (Enter)' : '결과 보기 (Enter)'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="error-msg">
            <Icon name="x" size={16} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
