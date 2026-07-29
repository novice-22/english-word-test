import { useEffect, useRef, useState } from "react";
import "./components.css";
import Icon from "./Icon.jsx";

/**
 * 숫자 카운트업 애니메이션. value가 "86%" 같은 문자열이어도 숫자 부분만 굴린다.
 * prefers-reduced-motion 시 즉시 표시.
 */
export function CountUp({ value, duration = 700 }) {
  const str = String(value ?? "");
  const match = str.match(/-?[\d,.]+/);
  const target = match ? parseFloat(match[0].replace(/,/g, "")) : NaN;
  const [display, setDisplay] = useState(Number.isFinite(target) ? "0" : str);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplay(str);
      return undefined;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fmt = (n) => {
      const rounded = Number.isInteger(target) ? Math.round(n) : Math.round(n * 10) / 10;
      const numStr = match[0].includes(",") ? rounded.toLocaleString() : String(rounded);
      return str.replace(match[0], numStr);
    };
    if (reduced) {
      setDisplay(fmt(target));
      return undefined;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(fmt(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [str]);

  return <>{display}</>;
}

/**
 * 통계 카드: 아이콘 틴트 원 + 큰 숫자 + 라벨.
 * tone: "accent" | "ok" | "warn" | "danger"
 */
export function StatCard({ icon, tone = "accent", value, label, sub }) {
  return (
    <div className={`c-stat c-stat--${tone}`}>
      {icon ? (
        <div className="c-stat-icon">
          <Icon name={icon} size={20} />
        </div>
      ) : null}
      <div className="c-stat-body">
        <div className="c-stat-value">{value}</div>
        <div className="c-stat-label">{label}</div>
        {sub != null && sub !== "" ? <div className="c-stat-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

/**
 * 빈 상태 안내. action은 ReactNode (버튼/링크 등).
 */
export function EmptyState({ icon, title, desc, action }) {
  return (
    <div className="c-empty">
      {icon ? (
        <div className="c-empty-icon">
          <Icon name={icon} size={26} />
        </div>
      ) : null}
      {title ? <div className="c-empty-title">{title}</div> : null}
      {desc ? <p className="c-empty-desc">{desc}</p> : null}
      {action ? <div className="c-empty-action">{action}</div> : null}
    </div>
  );
}

/**
 * 4px 그라데이션 진행 바.
 */
export function ProgressBar({ value, max }) {
  const m = Number(max) || 0;
  const v = Number(value) || 0;
  const pct = m > 0 ? Math.min(100, Math.max(0, (v / m) * 100)) : 0;
  return (
    <div
      className="c-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={m}
      aria-valuenow={Math.min(v, m)}
    >
      <div className="c-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * 점수 배지. 80점 이상 ok / 50점 이상 warn / 미만 danger.
 */
export function ScoreBadge({ pct }) {
  if (pct == null || Number.isNaN(Number(pct))) {
    return <span className="c-score c-score--none">-</span>;
  }
  const n = Math.round(Number(pct));
  const tone = n >= 80 ? "ok" : n >= 50 ? "warn" : "danger";
  return <span className={`c-score c-score--${tone}`}>{n}%</span>;
}

/**
 * 작은 로딩 스피너.
 */
export function Spinner() {
  return <span className="c-spinner" role="status" aria-label="로딩 중" />;
}
