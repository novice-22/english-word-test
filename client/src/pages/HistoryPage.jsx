import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import { EmptyState, ScoreBadge } from "../components/ui.jsx";
import "./history.css";

const MODE_LABEL = {
  meaning: "뜻 보고 쓰기",
  kmeaning: "단어 보고 뜻 쓰기",
  mixed: "혼합 (랜덤)",
  dictation: "받아쓰기",
  choice: "객관식",
};

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "meaning", label: "뜻 보고 쓰기" },
  { key: "kmeaning", label: "뜻 쓰기" },
  { key: "mixed", label: "혼합" },
  { key: "dictation", label: "받아쓰기" },
  { key: "choice", label: "객관식" },
];

/** "YYYY-MM-DD HH:MM:SS" (localtime 저장) -> "YYYY.MM.DD HH:MM" */
function formatDateTime(s) {
  if (typeof s !== "string" || s.length < 16) return s || "";
  return `${s.slice(0, 10).replaceAll("-", ".")} ${s.slice(11, 16)}`;
}

/** 초 -> "M분 S초" / "S초" */
function formatDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return null;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .getResults()
      .then(setResults)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(r) {
    if (!window.confirm(`'${r.set_name}' 시험 기록을 삭제할까요?`)) return;
    try {
      await api.deleteResult(r.id);
      setResults((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      setError(e.message);
    }
  }

  function openResult(id) {
    navigate(`/results/${id}`);
  }

  const filtered =
    results == null
      ? []
      : filter === "all"
        ? results
        : results.filter((r) => r.mode === filter);

  return (
    <div className="page history-page">
      <div className="page-head">
        <div>
          <h1>시험 이력</h1>
          <p>
            {results && results.length > 0
              ? `지금까지 ${results.length.toLocaleString()}회 시험을 봤어요.`
              : "지금까지 본 시험 기록을 모아 봤어요."}
          </p>
        </div>
      </div>

      {error ? (
        <div className="error-msg">
          <Icon name="x" size={17} />
          {error}
        </div>
      ) : null}

      {loading ? (
        <>
          <div className="history-filters" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skeleton history-skel-chip" />
            ))}
          </div>
          <ul className="history-list">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i}>
                <div className="skeleton history-skel-row" />
              </li>
            ))}
          </ul>
        </>
      ) : results && results.length === 0 ? (
        <EmptyState
          icon="history"
          title="아직 시험 기록이 없어요"
          desc="단어장을 골라 첫 시험을 보면 결과가 여기에 쌓여요."
          action={
            <Link to="/sets" className="btn primary">
              <Icon name="play" size={16} />
              시험 보러 가기
            </Link>
          }
        />
      ) : results ? (
        <>
          <div className="history-filters" role="group" aria-label="모드 필터">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`chip${filter === f.key ? " selected" : ""}`}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title="해당 모드의 기록이 없어요"
              desc="다른 필터를 선택하거나 새 시험을 봐 주세요."
            />
          ) : (
            <ul className="history-list">
              {filtered.map((r) => {
                const pct = r.total > 0 ? Math.round((r.correct / r.total) * 100) : null;
                const dur = formatDuration(r.duration_sec);
                return (
                  <li key={r.id}>
                    <div
                      className="history-item"
                      role="link"
                      tabIndex={0}
                      aria-label={`${r.set_name} 결과 보기`}
                      onClick={() => openResult(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openResult(r.id);
                        }
                      }}
                    >
                      <ScoreBadge pct={pct} />
                      <div className="history-main">
                        <div className="history-title">{r.set_name}</div>
                        <div className="history-meta muted">
                          {MODE_LABEL[r.mode] || r.mode} · {r.correct}/{r.total} ·{" "}
                          {formatDateTime(r.created_at)}
                          {dur ? ` · ${dur}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="icon-btn history-del"
                        title="기록 삭제"
                        aria-label={`${r.set_name} 기록 삭제`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(r);
                        }}
                      >
                        <Icon name="trash" size={17} />
                      </button>
                      <span className="history-chevron" aria-hidden="true">
                        <Icon name="chevronRight" size={18} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
