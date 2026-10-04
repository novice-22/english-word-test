import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { EmptyState } from '../components/ui.jsx';
import { ttsAvailable } from '../tts.js';
import './learn.css';

const MODES = [
  { key: 'meaning', icon: 'keyboard', title: '뜻 보고 쓰기', desc: '한글 뜻을 보고 영어 단어를 입력해요' },
  { key: 'kmeaning', icon: 'pencil', title: '단어 보고 뜻 쓰기', desc: '영어 단어를 보고 한글 뜻을 입력해요' },
  { key: 'mixed', icon: 'refresh', title: '혼합 (랜덤)', desc: '문제마다 뜻↔단어 방향이 무작위로 나와요' },
  { key: 'dictation', icon: 'headphones', title: '듣고 받아쓰기', desc: '발음을 듣고 영어 단어를 입력해요' },
  { key: 'choice', icon: 'list', title: '객관식', desc: '영어 단어를 보고 알맞은 뜻을 골라요' },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ReviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('meaning');

  useEffect(() => {
    let alive = true;
    api
      .getDueReview()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dueWords = data?.words ?? [];
  const choiceDisabled = dueWords.length < 4;

  function start() {
    if (dueWords.length === 0) return;
    const words = shuffle(dueWords).map((w) => ({
      id: w.id,
      word: w.word,
      meaning: w.meaning,
      example: w.example,
      phonetic: w.phonetic,
    }));
    // 복습 단어가 모두 같은 단어장이면 그 단어장으로 기록
    const setIds = [...new Set(dueWords.map((w) => w.set_id))];
    const setId = setIds.length === 1 ? setIds[0] : null;
    const baseName = setIds.length === 1 ? dueWords[0].set_name : '여러 단어장';

    navigate('/quiz', {
      state: {
        setId,
        setName: `${baseName} · 복습`,
        mode,
        listenHint: true,
        words,
        pool: dueWords.map((w) => ({ word: w.word, meaning: w.meaning })),
      },
    });
  }

  return (
    <div className="page review-page">
      <div className="page-head">
        <div>
          <h1>오늘의 복습</h1>
          {data && dueWords.length > 0 && (
            <p>
              복습할 단어 {data.count}개
              {data.count > dueWords.length ? ` 중 ${dueWords.length}개씩 진행해요` : ''}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="error-msg">
          <Icon name="x" size={16} /> {error}
        </p>
      )}

      {!data && !error && (
        <div className="learn-skeletons">
          <div className="skeleton" style={{ height: 88, borderRadius: 'var(--radius)' }} />
          <div className="skeleton" style={{ height: 260, borderRadius: 'var(--radius)' }} />
        </div>
      )}

      {data && dueWords.length === 0 && (
        <div className="panel">
          <EmptyState
            icon="trophy"
            title="오늘 복습할 단어가 없어요"
            desc="시험을 보면 그 결과에 따라 복습 일정이 자동으로 잡혀요."
            action={
              <Link to="/sets" className="btn primary">
                <Icon name="book" size={16} /> 단어장 보기
              </Link>
            }
          />
        </div>
      )}

      {data && dueWords.length > 0 && (
        <>
          <section className="review-banner">
            <span className="review-banner-icon">
              <Icon name="refresh" size={22} />
            </span>
            <div>
              <div className="review-banner-title">복습할 단어 {dueWords.length}개</div>
              <div className="review-banner-sub">
                맞힌 단어는 복습 간격이 늘어나고, 틀린 단어는 내일 다시 나와요.
              </div>
            </div>
          </section>

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
              <p className="setup-note">객관식은 복습 단어가 4개 이상일 때 선택할 수 있어요.</p>
            )}
            {mode === 'dictation' && !ttsAvailable() && (
              <p className="error-msg">
                <Icon name="x" size={16} /> 이 브라우저는 음성 재생(TTS)을 지원하지 않아요.
              </p>
            )}
          </section>

          <button type="button" className="btn primary lg full setup-start" onClick={start}>
            <Icon name="play" size={18} /> 복습 시작 ({dueWords.length}문제)
          </button>
        </>
      )}
    </div>
  );
}
