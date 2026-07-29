import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api.js';
import { speak, ttsAvailable } from '../tts.js';
import Icon from '../components/Icon.jsx';
import { ProgressRing } from '../components/charts.jsx';
import './learn.css';

const MODE_LABEL = {
  meaning: '뜻 보고 쓰기',
  kmeaning: '단어 보고 뜻 쓰기',
  mixed: '혼합 (랜덤)',
  dictation: '듣고 받아쓰기',
  choice: '객관식',
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function scoreMessage(pct) {
  if (pct >= 90) return '완벽해요!';
  if (pct >= 70) return '잘했어요!';
  if (pct >= 50) return '조금만 더!';
  return '다시 도전!';
}

function formatDuration(sec) {
  if (sec === null || sec === undefined) return null;
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return null;
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(str) {
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(str || '');
  return d.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ResultPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [starState, setStarState] = useState('idle'); // idle | busy | done
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .getResult(id)
      .then((data) => {
        if (alive) setResult(data);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="page">
        <p className="error-msg">
          <Icon name="x" size={16} /> {error}
        </p>
        <Link to="/" className="btn ghost">
          <Icon name="home" size={16} /> 홈으로
        </Link>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="page learn-skeletons">
        <div className="skeleton" style={{ height: 260, borderRadius: 'var(--radius)' }} />
        <div className="skeleton" style={{ height: 44, borderRadius: 'var(--radius-sm)' }} />
        <div className="skeleton" style={{ height: 300, borderRadius: 'var(--radius)' }} />
      </div>
    );
  }

  const pct = result.total > 0 ? Math.round((result.correct * 100) / result.total) : 0;
  const wrong = result.answers.filter((a) => !a.is_correct);
  const wrongWithId = wrong.filter((a) => a.word_id);
  const duration = formatDuration(result.duration_sec);
  const meta = [
    result.set_name,
    MODE_LABEL[result.mode] || result.mode,
    `${result.total}문제`,
    duration,
    formatDate(result.created_at),
  ]
    .filter(Boolean)
    .join(' · ');

  function retryWrong() {
    navigate('/quiz', {
      state: {
        setId: result.set_id || null,
        setName: `${result.set_name} (오답 다시)`,
        mode: result.mode,
        listenHint: true,
        words: shuffle(
          wrong.map((a) => ({ id: a.word_id || null, word: a.word, meaning: a.meaning }))
        ),
        pool: result.answers.map((a) => ({ word: a.word, meaning: a.meaning })),
      },
    });
  }

  async function starAllWrong() {
    if (starState !== 'idle') return;
    setStarState('busy');
    setActionError('');
    try {
      await Promise.all(wrongWithId.map((a) => api.starWord(a.word_id, 1)));
      setStarState('done');
    } catch (e) {
      setActionError(`별표 실패: ${e.message}`);
      setStarState('idle');
    }
  }

  return (
    <div className="page result-page">
      <section className="panel result-hero">
        <ProgressRing pct={pct} size={150} label={`${result.correct} / ${result.total} 정답`} />
        <h2 className="result-msg">{scoreMessage(pct)}</h2>
        <p className="result-meta muted">{meta}</p>
      </section>

      <div className="result-actions">
        {wrong.length > 0 && (
          <button type="button" className="btn primary" onClick={retryWrong}>
            <Icon name="refresh" size={16} /> 오답 {wrong.length}개 다시 풀기
          </button>
        )}
        {result.set_id && (
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/sets/${result.set_id}/quiz-setup`)}
          >
            <Icon name="play" size={16} /> 같은 단어장 다시
          </button>
        )}
        {wrongWithId.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={starAllWrong}
            disabled={starState !== 'idle'}
          >
            <Icon name={starState === 'done' ? 'starFill' : 'star'} size={16} />
            {starState === 'done' ? '별표 완료' : starState === 'busy' ? '별표 중…' : '오답 모두 별표'}
          </button>
        )}
        <Link to="/" className="btn ghost">
          <Icon name="home" size={16} /> 홈으로
        </Link>
      </div>

      {actionError && (
        <p className="error-msg">
          <Icon name="x" size={16} /> {actionError}
        </p>
      )}

      <section className="panel result-table">
        <h2 className="panel-title">
          <Icon name="list" size={18} /> 문제별 결과
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-label="정답 여부"></th>
                <th>단어</th>
                <th>뜻</th>
                <th>내 답안</th>
              </tr>
            </thead>
            <tbody>
              {result.answers.map((a) => (
                <tr key={a.id} className={a.is_correct ? '' : 'row-wrong'}>
                  <td className="result-mark">
                    {a.is_correct ? (
                      <Icon name="check" size={18} className="mark-ok" />
                    ) : (
                      <Icon name="x" size={18} className="mark-bad" />
                    )}
                  </td>
                  <td className="result-word">
                    {ttsAvailable() && (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => speak(a.word)}
                        aria-label={`${a.word} 발음 듣기`}
                      >
                        <Icon name="speaker" size={15} />
                      </button>
                    )}
                    <strong>{a.word}</strong>
                  </td>
                  <td>{a.meaning}</td>
                  <td className={a.is_correct ? '' : 'wrong-given'}>
                    {a.given || <span className="muted">(무응답)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
