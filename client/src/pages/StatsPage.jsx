import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { speak, ttsAvailable } from "../tts.js";
import Icon from "../components/Icon.jsx";
import { StatCard, EmptyState, ScoreBadge } from "../components/ui.jsx";
import { BarChart, LineChart } from "../components/charts.jsx";
import "./stats.css";

const MODE_META = {
  meaning: { label: "뜻 보고 쓰기", icon: "keyboard" },
  kmeaning: { label: "단어 보고 뜻 쓰기", icon: "pencil" },
  mixed: { label: "혼합 (랜덤)", icon: "refresh" },
  dictation: { label: "받아쓰기", icon: "headphones" },
  choice: { label: "객관식", icon: "list" },
};

/** "YYYY-MM-DD HH:MM:SS" -> "MM-DD" */
function shortDate(s) {
  return typeof s === "string" && s.length >= 10 ? s.slice(5, 10) : "";
}

/** "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DD" */
function dateOnly(s) {
  return typeof s === "string" && s.length >= 10 ? s.slice(0, 10) : "";
}

export default function StatsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .getStats()
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStar(w) {
    const next = w.starred ? 0 : 1;
    // 낙관적 갱신
    setStats((s) => ({
      ...s,
      weak_words: s.weak_words.map((x) => (x.id === w.id ? { ...x, starred: next } : x)),
    }));
    try {
      await api.starWord(w.id, next);
    } catch (e) {
      // 실패 시 되돌림
      setStats((s) => ({
        ...s,
        weak_words: s.weak_words.map((x) =>
          x.id === w.id ? { ...x, starred: w.starred } : x
        ),
      }));
      setError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="page stats-page">
        <div className="page-head">
          <div>
            <h1>통계</h1>
            <p>학습 기록을 한눈에 확인해요.</p>
          </div>
        </div>
        <div className="stats-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton stats-skel-card" />
          ))}
        </div>
        <div className="grid-2 stats-charts">
          <div className="skeleton stats-skel-panel" />
          <div className="skeleton stats-skel-panel" />
        </div>
        <div className="skeleton stats-skel-panel" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="page stats-page">
        <div className="page-head">
          <div>
            <h1>통계</h1>
            <p>학습 기록을 한눈에 확인해요.</p>
          </div>
        </div>
        <div className="error-msg">
          <Icon name="x" size={17} />
          {error}
        </div>
        <button type="button" className="btn" onClick={load}>
          <Icon name="refresh" size={16} />
          다시 시도
        </button>
      </div>
    );
  }

  const { totals, daily, score_trend, weak_words, mode_stats } = stats;
  const dailySum = daily.reduce((acc, d) => acc + d.total, 0);
  const canSpeak = ttsAvailable();

  return (
    <div className="page stats-page">
      <div className="page-head">
        <div>
          <h1>통계</h1>
          <p>학습 기록을 한눈에 확인해요.</p>
        </div>
      </div>

      {error ? (
        <div className="error-msg">
          <Icon name="x" size={17} />
          {error}
        </div>
      ) : null}

      {/* 요약 카드 */}
      <div className="stats-grid">
        <StatCard
          icon="history"
          tone="accent"
          value={`${totals.tests.toLocaleString()}회`}
          label="총 시험 횟수"
        />
        <StatCard
          icon="list"
          tone="ok"
          value={totals.answers.toLocaleString()}
          label="푼 문제 수"
          sub={`정답 ${totals.correct_answers.toLocaleString()}개`}
        />
        <StatCard
          icon="target"
          tone="accent"
          value={totals.tests > 0 ? `${totals.avg_score}점` : "-"}
          label="평균 점수"
        />
        <StatCard
          icon="flame"
          tone="warn"
          value={`${totals.streak}일`}
          label="연속 학습"
        />
      </div>

      <div className="grid-2 stats-charts">
        {/* 패널 1: 최근 30일 학습량 */}
        <section className="panel">
          <h2 className="panel-title">
            <Icon name="calendar" size={18} />
            최근 30일 학습량
            {dailySum > 0 ? (
              <span className="panel-title-sub">총 {dailySum.toLocaleString()}개</span>
            ) : null}
          </h2>
          {dailySum === 0 ? (
            <EmptyState
              icon="calendar"
              title="최근 30일 기록이 없어요"
              desc="시험을 보거나 복습을 하면 날짜별 학습량이 여기에 쌓여요."
            />
          ) : (
            <BarChart
              data={daily.map((d) => ({
                label: d.date,
                value: d.total,
                hint: `${d.full_date} · 시험 ${d.quiz_answers} · 복습 ${d.reviews}`,
              }))}
            />
          )}
        </section>

        {/* 패널 2: 점수 추이 */}
        <section className="panel">
          <h2 className="panel-title">
            <Icon name="chart" size={18} />
            점수 추이
            {score_trend.length > 1 ? (
              <span className="panel-title-sub">최근 {score_trend.length}회</span>
            ) : null}
          </h2>
          {score_trend.length < 2 ? (
            <p className="chart-note muted">
              시험을 2회 이상 보면 점수 변화 그래프가 표시돼요.
            </p>
          ) : (
            <LineChart
              yMax={100}
              data={score_trend.map((t) => ({
                label: shortDate(t.created_at),
                value: t.pct,
                hint: `${t.set_name} · ${dateOnly(t.created_at)} · ${t.pct}점`,
              }))}
            />
          )}
        </section>
      </div>

      {/* 패널 3: 집중 공략 단어 TOP 10 */}
      <section className="panel">
        <h2 className="panel-title">
          <Icon name="bolt" size={18} />
          집중 공략 단어 TOP 10
        </h2>
        {weak_words.length === 0 ? (
          <p className="chart-note muted">시험을 2번 이상 본 단어가 생기면 나타나요.</p>
        ) : (
          <div className="table-wrap">
            <table className="weak-table">
              <thead>
                <tr>
                  <th aria-label="발음 듣기" />
                  <th>단어</th>
                  <th>뜻</th>
                  <th>정답률</th>
                  <th>시도</th>
                  <th aria-label="별표" />
                </tr>
              </thead>
              <tbody>
                {weak_words.map((w) => (
                  <tr key={w.id}>
                    <td className="weak-cell-tts">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => speak(w.word)}
                        disabled={!canSpeak}
                        title="발음 듣기"
                        aria-label={`${w.word} 발음 듣기`}
                      >
                        <Icon name="speaker" size={17} />
                      </button>
                    </td>
                    <td>
                      <span className="weak-word">{w.word}</span>
                      <span className="weak-set muted">{w.set_name}</span>
                    </td>
                    <td className="weak-meaning">{w.meaning}</td>
                    <td>
                      <ScoreBadge pct={w.rate} />
                    </td>
                    <td className="weak-attempts">
                      {w.correct}/{w.attempts}회
                    </td>
                    <td className="weak-cell-star">
                      <button
                        type="button"
                        className={`icon-btn star-btn${w.starred ? " on" : ""}`}
                        onClick={() => toggleStar(w)}
                        title={w.starred ? "별표 해제" : "별표"}
                        aria-label={w.starred ? `${w.word} 별표 해제` : `${w.word} 별표`}
                        aria-pressed={w.starred ? true : false}
                      >
                        <Icon name={w.starred ? "starFill" : "star"} size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 패널 4: 모드별 성적 */}
      <section className="panel">
        <h2 className="panel-title">
          <Icon name="layers" size={18} />
          모드별 성적
        </h2>
        {mode_stats.length === 0 ? (
          <p className="chart-note muted">아직 시험 기록이 없어요.</p>
        ) : (
          <div className="mode-grid">
            {mode_stats.map((m) => {
              const meta = MODE_META[m.mode] || { label: m.mode, icon: "list" };
              return (
                <div key={m.mode} className="mode-card">
                  <span className="mode-icon">
                    <Icon name={meta.icon} size={19} />
                  </span>
                  <div className="mode-body">
                    <div className="mode-name">{meta.label}</div>
                    <div className="mode-meta muted">
                      시험 {m.tests.toLocaleString()}회 · 평균 {m.avg_pct}점
                    </div>
                  </div>
                  <ScoreBadge pct={m.avg_pct} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
