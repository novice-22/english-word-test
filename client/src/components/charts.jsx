import "./components.css";
import { useEffect, useId, useRef, useState } from "react";

/*
 * 순수 SVG 차트 (라이브러리 없음).
 * 규칙:
 * - 색은 var(--accent) 계열 CSS 변수만 사용, hex 하드코딩 금지.
 * - 텍스트(라벨/눈금/값)는 --text-2 / --muted, 눈금 숫자는 tabular-nums.
 * - 그리드는 1px 헤어라인(--border). 값 라벨은 최대값 하나만.
 * - 막대 두께 최대 24px, 데이터 끝쪽만 4px 라운드, 막대 간격 2px 이상.
 * - 선 2px round join/cap, 영역 워시 10%, 끝점 도트 + 서피스 링.
 */

const EMPTY_MSG = "아직 표시할 데이터가 없어요.";

/** 부모 너비를 측정해 viewBox 픽셀과 1:1로 맞춘다 (텍스트 크기 왜곡 방지). */
function useMeasuredWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 40) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** 깔끔한 눈금 상한 (1/2/5 x 10^n). */
function niceCeil(x) {
  if (!(x > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / pow;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * pow;
}

function normalize(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((d) => d != null)
    .map((d) => ({
      label: d.label != null ? String(d.label) : "",
      value: Math.max(0, Number(d.value) || 0),
      hint: d.hint,
    }));
}

function ChartEmpty() {
  return <div className="c-chart-empty">{EMPTY_MSG}</div>;
}

/** x축 라벨 표시 간격: 30개면 5칸 간격 정도. */
function labelStep(n) {
  return Math.max(1, Math.ceil(n / 6));
}

/* ---------------------------------------------------------------- */
/* ProgressRing                                                      */
/* ---------------------------------------------------------------- */

export function ProgressRing({ pct, size = 140, stroke = 12, label, sub }) {
  const rawId = useId();
  const gid = `c-ring-grad-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const half = size / 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);

  return (
    <div className="c-ring" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`진행률 ${Math.round(p)}%`}
      >
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle
          cx={half}
          cy={half}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.15"
          strokeWidth={stroke}
        />
        {p > 0 ? (
          <circle
            className="c-ring-arc"
            cx={half}
            cy={half}
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ "--c-ring-c": `${c}px` }}
            transform={`rotate(-90 ${half} ${half})`}
          />
        ) : null}
      </svg>
      <div className="c-ring-center">
        <div className="c-ring-num" style={{ fontSize: Math.round(size * 0.2) }}>
          {Math.round(p)}
          <span className="c-ring-unit">%</span>
        </div>
        {label ? <div className="c-ring-label">{label}</div> : null}
        {sub ? <div className="c-ring-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* BarChart                                                          */
/* ---------------------------------------------------------------- */

/** 데이터 끝(위)만 4px 라운드, 베이스라인은 각진 막대 path. */
function barPath(x, y, w, h, radius) {
  const r = Math.min(radius, h, w / 2);
  const x2 = x + w;
  const y0 = y + h;
  return [
    `M${x},${y0}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x2 - r},${y}`,
    `Q${x2},${y} ${x2},${y + r}`,
    `L${x2},${y0}`,
    "Z",
  ].join(" ");
}

export function BarChart({ data, height = 160 }) {
  const [ref, width] = useMeasuredWidth();
  const items = normalize(data);
  const maxVal = items.length ? Math.max(...items.map((d) => d.value)) : 0;

  if (!items.length || maxVal <= 0) return <ChartEmpty />;

  const M = { top: 16, right: 8, bottom: 20, left: 34 };
  const W = width;
  const H = height;
  const plotW = Math.max(10, W - M.left - M.right);
  const plotH = Math.max(10, H - M.top - M.bottom);
  const n = items.length;
  const slot = plotW / n;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const yMax = niceCeil(maxVal);
  const yOf = (v) => M.top + plotH - (v / yMax) * plotH;

  const ticks = yMax % 2 === 0 ? [0, yMax / 2, yMax] : [0, yMax];
  const step = labelStep(n);
  const maxIdx = items.findIndex((d) => d.value === maxVal);
  const baseY = M.top + plotH;

  return (
    <div className="c-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="막대 차트">
        {/* 그리드 + y 눈금 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="c-gridline"
              x1={M.left}
              x2={W - M.right}
              y1={yOf(t)}
              y2={yOf(t)}
            />
            <text className="c-tick" x={M.left - 6} y={yOf(t) + 3.5} textAnchor="end">
              {t}
            </text>
          </g>
        ))}

        {/* 막대 */}
        {items.map((d, i) => {
          if (d.value <= 0) return null;
          const x = M.left + i * slot + (slot - barW) / 2;
          const y = yOf(d.value);
          const h = baseY - y;
          return (
            <g key={i} className="c-bar-g">
              <title>{d.hint != null ? d.hint : `${d.label}: ${d.value}`}</title>
              <path className="c-bar" d={barPath(x, y, barW, h, 4)} />
            </g>
          );
        })}

        {/* 최대값 하나만 직접 라벨 */}
        {maxIdx >= 0 ? (
          <text
            className="c-value-label"
            x={Math.min(
              Math.max(M.left + maxIdx * slot + slot / 2, M.left + 10),
              W - M.right - 10
            )}
            y={yOf(maxVal) - 5}
            textAnchor="middle"
          >
            {maxVal}
          </text>
        ) : null}

        {/* x 라벨 */}
        {items.map((d, i) =>
          i % step === 0 && d.label ? (
            <text
              key={`x${i}`}
              className="c-xlabel"
              x={M.left + i * slot + slot / 2}
              y={H - 5}
              textAnchor="middle"
            >
              {d.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* LineChart                                                         */
/* ---------------------------------------------------------------- */

export function LineChart({ data, height = 160, yMax = 100 }) {
  const [ref, width] = useMeasuredWidth();
  const items = normalize(data);
  const maxVal = items.length ? Math.max(...items.map((d) => d.value)) : 0;

  if (!items.length || maxVal <= 0) return <ChartEmpty />;

  const M = { top: 16, right: 12, bottom: 20, left: 34 };
  const W = width;
  const H = height;
  const plotW = Math.max(10, W - M.left - M.right);
  const plotH = Math.max(10, H - M.top - M.bottom);
  const n = items.length;
  const top = Math.max(Number(yMax) || 0, niceCeil(maxVal));
  const xOf = (i) => (n === 1 ? M.left + plotW / 2 : M.left + (i * plotW) / (n - 1));
  const yOf = (v) => M.top + plotH - (v / top) * plotH;

  const pts = items.map((d, i) => [xOf(i), yOf(d.value)]);
  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const baseY = M.top + plotH;
  const areaPath =
    n > 1
      ? `${linePath} L${pts[n - 1][0].toFixed(2)},${baseY} L${pts[0][0].toFixed(2)},${baseY} Z`
      : null;

  const ticks = top % 2 === 0 ? [0, top / 2, top] : [0, top];
  const step = labelStep(n);
  const maxIdx = items.findIndex((d) => d.value === maxVal);
  const last = pts[n - 1];

  return (
    <div className="c-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="선 차트">
        {/* 그리드 + y 눈금 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="c-gridline"
              x1={M.left}
              x2={W - M.right}
              y1={yOf(t)}
              y2={yOf(t)}
            />
            <text className="c-tick" x={M.left - 6} y={yOf(t) + 3.5} textAnchor="end">
              {t}
            </text>
          </g>
        ))}

        {/* 영역 워시 (10%) */}
        {areaPath ? <path className="c-area" d={areaPath} /> : null}

        {/* 선 */}
        {n > 1 ? <path className="c-line" d={linePath} /> : null}

        {/* 끝점 도트: 서피스색 2px 링 */}
        <circle className="c-line-end" cx={last[0]} cy={last[1]} r={4} />

        {/* 최대값 하나만 직접 라벨 */}
        {maxIdx >= 0 ? (
          <text
            className="c-value-label"
            x={Math.min(Math.max(pts[maxIdx][0], M.left + 10), W - M.right - 10)}
            y={pts[maxIdx][1] - 9}
            textAnchor="middle"
          >
            {items[maxIdx].value}
          </text>
        ) : null}

        {/* 호버 포인트 + 툴팁 */}
        {items.map((d, i) => (
          <g key={i} className="c-line-pt">
            <title>{d.hint != null ? d.hint : `${d.label}: ${d.value}`}</title>
            <circle className="c-line-hit" cx={pts[i][0]} cy={pts[i][1]} r={10} />
            <circle className="c-line-dot" cx={pts[i][0]} cy={pts[i][1]} r={3.5} />
          </g>
        ))}

        {/* x 라벨 */}
        {items.map((d, i) =>
          i % step === 0 && d.label ? (
            <text
              key={`x${i}`}
              className="c-xlabel"
              x={pts[i][0]}
              y={H - 5}
              textAnchor="middle"
            >
              {d.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
