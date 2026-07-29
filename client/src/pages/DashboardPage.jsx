import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { StatCard, EmptyState, ProgressBar, ScoreBadge, CountUp } from '../components/ui.jsx';
import './dashboard.css';

/** 터미널처럼 한 글자씩 타이핑되는 텍스트 */
function TypeText({ text }) {
  const [len, setLen] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? text.length : 0
  );
  useEffect(() => {
    if (len >= text.length) return undefined;
    const t = setTimeout(() => setLen(len + 1), 42);
    return () => clearTimeout(t);
  }, [len, text]);
  return <>{text.slice(0, len)}</>;
}

const MODE_META = {
  meaning: { label: '뜻 보고 쓰기', icon: 'keyboard' },
  kmeaning: { label: '뜻 쓰기', icon: 'pencil' },
  mixed: { label: '혼합', icon: 'refresh' },
  dictation: { label: '받아쓰기', icon: 'headphones' },
  choice: { label: '객관식', icon: 'list' },
};

const EXAM_LABELS = {
  toeic: '토익',
  toeic_s: '토익스피킹',
  opic: '오픽',
  teps: '텝스',
  gtelp: '지텔프',
  etc: '기타',
};

/** 'YYYY-MM-DD' → 오늘 기준 남은 일수 */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - base) / 86400000);
}

function fmtExamDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const wd = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일(${wd})`;
}

/** 내 시험의 접수 상태 한 줄 (없으면 null) */
function regStatusText(e) {
  const dRegEnd = daysUntil(e.reg_end);
  if (dRegEnd != null && dRegEnd >= 0) {
    const dRegStart = daysUntil(e.reg_start);
    if (dRegStart != null && dRegStart > 0) return `접수 시작 D-${dRegStart}`;
    return dRegEnd === 0 ? '접수 오늘 마감' : `접수 마감 D-${dRegEnd}`;
  }
  const dLateEnd = daysUntil(e.late_end);
  if (dLateEnd != null && dLateEnd >= 0)
    return dLateEnd === 0 ? '추가접수 오늘 마감' : `추가접수 마감 D-${dLateEnd}`;
  if (e.reg_end || e.late_end) return '접수 기간 종료';
  return null;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return '늦은 밤까지 열심이네요';
  if (h < 12) return '좋은 아침이에요';
  if (h < 18) return '좋은 오후예요';
  if (h < 22) return '좋은 저녁이에요';
  return '오늘 하루도 수고했어요';
}

function formatRelative(dateStr) {
  const d = new Date(String(dateStr).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([api.getStats(), api.getSets(), api.getResults(3), api.getExams(true)])
      .then(([stats, sets, results, exams]) => {
        if (alive) setData({ stats, sets, results, exams });
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const t = data?.stats?.totals;

  return (
    <div className="page dash">
      <header className="dash-head">
        <h1 className="dash-greet">
          <span className="dash-prompt" aria-hidden="true">
            ~$
          </span>{' '}
          <TypeText text={getGreeting()} />
          <span className="dash-caret" aria-hidden="true" />
        </h1>
        <p className="dash-date">{today}</p>
      </header>

      {error && (
        <p className="error-msg">
          <Icon name="x" size={16} />
          {error}
        </p>
      )}

      {!data && !error && (
        <>
          <div className="dash-stats">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton" style={{ height: 74 }} />
            ))}
          </div>
          <div className="skeleton" style={{ height: 92, marginBottom: '1.5rem' }} />
          <div className="grid-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 112 }} />
            ))}
          </div>
        </>
      )}

      {data && (
        <>
          <div className="dash-stats">
            <StatCard
              icon="book"
              value={<CountUp value={t.words.toLocaleString()} />}
              label="전체 단어"
              sub={data.sets.length > 0 ? `단어장 ${data.sets.length}개` : null}
            />
            <StatCard
              icon="bolt"
              tone="warn"
              value={<CountUp value={t.studied.toLocaleString()} />}
              label="학습한 단어"
              sub={t.due_count > 0 ? `복습 대기 ${t.due_count}개` : null}
            />
          </div>

          {(() => {
            const myExams = (data.exams || []).filter((e) => e.is_mine);
            if (myExams.length === 0) return null;
            const e = myExams[0]; // 서버가 날짜순 정렬해서 내려줌 → 첫 개가 가장 가까운 시험
            const dExam = daysUntil(e.exam_date);
            const reg = regStatusText(e);
            return (
              <Link to="/exams" className="dash-exam">
                <span className="dash-exam-icon">
                  <Icon name="flagFill" size={20} />
                </span>
                <span className="dash-exam-text">
                  <span className="dash-exam-title">
                    {EXAM_LABELS[e.exam_type] || e.exam_type}
                    {e.round ? ` ${e.round}` : ''}
                  </span>
                  <span className="dash-exam-sub">
                    시험일 {fmtExamDate(e.exam_date)}
                    {reg ? ` · ${reg}` : ''}
                    {myExams.length > 1 ? ` · 그 외 ${myExams.length - 1}개` : ''}
                  </span>
                </span>
                <span className="dash-exam-dday">{dExam === 0 ? 'D-DAY' : `D-${dExam}`}</span>
                <Icon name="chevronRight" size={16} className="dash-exam-chev" />
              </Link>
            );
          })()}

          {t.due_count > 0 && (
            <section className="dash-cta">
              <span className="dash-cta-icon">
                <Icon name="refresh" size={22} />
              </span>
              <div className="dash-cta-text">
                <div className="dash-cta-title">오늘 복습할 단어 {t.due_count}개가 기다려요</div>
                <div className="dash-cta-sub">잊어버리기 전에 복습하면 기억이 오래가요.</div>
              </div>
              <Link to="/review" className="btn dash-cta-btn">
                <Icon name="play" size={16} />
                복습 시작
              </Link>
            </section>
          )}

          <section className="dash-section">
            <div className="dash-section-head">
              <h2>단어장별 학습 진도</h2>
              <Link to="/sets" className="dash-link">
                전체 보기
                <Icon name="chevronRight" size={15} />
              </Link>
            </div>
            {data.sets.length === 0 ? (
              <div className="panel">
                <EmptyState
                  icon="book"
                  title="아직 단어장이 없어요"
                  desc="첫 단어장을 만들고 단어를 추가해 보세요."
                  action={
                    <Link to="/sets" className="btn primary">
                      <Icon name="plus" size={16} />
                      단어장 만들기
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="grid-2">
                {data.sets.slice(0, 6).map((s) => {
                  const pct =
                    s.word_count > 0 ? Math.round((s.studied_count / s.word_count) * 100) : 0;
                  return (
                    <Link key={s.id} to={`/sets/${s.id}`} className="dash-set-card">
                      <div className="dash-set-top">
                        <h3>{s.name}</h3>
                        <span className="dash-set-pct">{pct}%</span>
                      </div>
                      <p className="dash-set-meta">
                        학습 {s.studied_count.toLocaleString()} / {s.word_count.toLocaleString()}개
                        {s.last_pct != null && (
                          <>
                            {' · 최근 '}
                            <ScoreBadge pct={s.last_pct} />
                          </>
                        )}
                      </p>
                      <ProgressBar value={s.studied_count} max={s.word_count} />
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {data.results.length > 0 && (
            <section className="dash-section">
              <div className="dash-section-head">
                <h2>최근 시험</h2>
                <Link to="/history" className="dash-link">
                  전체 이력
                  <Icon name="chevronRight" size={15} />
                </Link>
              </div>
              <div className="panel dash-recent">
                {data.results.slice(0, 3).map((r) => {
                  const meta = MODE_META[r.mode] || { label: r.mode, icon: 'list' };
                  const pct = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
                  return (
                    <Link key={r.id} to={`/results/${r.id}`} className="dash-recent-item">
                      <span className="dash-recent-icon">
                        <Icon name={meta.icon} size={18} />
                      </span>
                      <span className="dash-recent-main">
                        <span className="dash-recent-name">{r.set_name}</span>
                        <span className="dash-recent-meta">
                          {meta.label} · {r.correct}/{r.total} · {formatRelative(r.created_at)}
                        </span>
                      </span>
                      <ScoreBadge pct={pct} />
                      <Icon name="chevronRight" size={16} className="dash-recent-chev" />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
