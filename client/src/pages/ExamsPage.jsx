import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { EmptyState } from '../components/ui.jsx';
import './exams.css';

/**
 * 시험 종류별 공식 사이트 (일정·접수 페이지).
 * 일정마다 link 를 따로 넣지 않아도 여기 주소가 기본으로 걸린다.
 */
const TYPES = [
  {
    key: 'toeic',
    label: '토익',
    short: 'TOEIC',
    site: 'https://exam.toeic.co.kr/receipt/examSchList.php',
  },
  { key: 'toeic_s', label: '토익스피킹', short: 'TOEIC S', site: 'https://www.toeicswt.co.kr/' },
  { key: 'opic', label: '오픽', short: 'OPIc', site: 'https://www.opic.or.kr/' },
  { key: 'teps', label: '텝스', short: 'TEPS', site: 'https://www.teps.or.kr/receiption/examination' },
  // 지텔프 공식 사이트는 https 를 지원하지 않아 http 로 연결된다
  { key: 'gtelp', label: '지텔프', short: 'G-TELP', site: 'http://www.g-telp.co.kr' },
  { key: 'etc', label: '기타', short: 'ETC', site: null },
];
const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.key, t]));

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 로컬 기준 오늘 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → 날짜 차이(일). 음수면 지난 것 */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - base) / 86400000);
}

function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일(${wd})`;
}

/** 지금 이 시험이 어떤 상태인지 — 배지 문구와 색을 정한다 */
function statusOf(e) {
  const dExam = daysUntil(e.exam_date);
  const dRegEnd = daysUntil(e.reg_end);
  const dLateEnd = daysUntil(e.late_end);

  if (dExam < 0) return { tone: 'done', text: '종료' };
  if (dExam === 0) return { tone: 'today', text: '오늘 시험' };
  if (dRegEnd != null && dRegEnd >= 0) {
    const dRegStart = daysUntil(e.reg_start);
    if (dRegStart != null && dRegStart > 0)
      return { tone: 'soon', text: `접수 시작 D-${dRegStart}` };
    return { tone: 'open', text: dRegEnd === 0 ? '접수 오늘 마감' : `접수 마감 D-${dRegEnd}` };
  }
  if (dLateEnd != null && dLateEnd >= 0)
    return { tone: 'late', text: dLateEnd === 0 ? '추가접수 오늘 마감' : `추가접수 D-${dLateEnd}` };
  return { tone: 'closed', text: `시험 D-${dExam}` };
}

export default function ExamsPage() {
  const [exams, setExams] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('list'); // 'list' | 'calendar'
  const [filter, setFilter] = useState('all');
  const [showPast, setShowPast] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // 편집 폼: null이면 닫힘, {} 면 새로 추가, {id:...} 면 수정
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api
      .getExams()
      .then(setExams)
      .catch((e) => setError(e.message));

  useEffect(() => {
    let alive = true;
    api
      .getExams()
      .then((d) => {
        if (alive) setExams(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const all = exams ?? [];
  const hasSample = all.some((e) => e.is_sample);

  const openNew = () =>
    setForm({ exam_type: 'toeic', round: '', exam_date: '', reg_start: '', reg_end: '', late_start: '', late_end: '', result_date: '', note: '', link: '' });

  /** 기존 일정을 폼에 올린다. copy면 id를 떼서 '복제' 가 된다 */
  const openEdit = (e, copy = false) =>
    setForm({
      ...(copy ? {} : { id: e.id }),
      exam_type: e.exam_type,
      round: copy ? '' : e.round || '',
      exam_date: copy ? '' : e.exam_date || '',
      reg_start: copy ? '' : e.reg_start || '',
      reg_end: copy ? '' : e.reg_end || '',
      late_start: copy ? '' : e.late_start || '',
      late_end: copy ? '' : e.late_end || '',
      result_date: copy ? '' : e.result_date || '',
      note: copy ? '' : e.note || '',
      link: e.link || '',
    });

  async function save(ev) {
    ev.preventDefault();
    if (!form.exam_date || saving) return;
    setSaving(true);
    setError('');
    try {
      const body = { ...form, is_sample: 0 };
      if (form.id) await api.updateExam(form.id, body);
      else await api.createExam(body);
      setForm(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(e) {
    if (!window.confirm(`${TYPE_MAP[e.exam_type]?.label || e.exam_type} ${e.round || ''} 일정을 삭제할까요?`))
      return;
    try {
      await api.deleteExam(e.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  /** 내 시험 깃발 토글 */
  async function toggleMine(e) {
    try {
      await api.setExamMine(e.id, !e.is_mine);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }


  // 화면에 있는 시험 종류만 필터 칩으로 보여준다.
  // 오픽은 상시시험이라 일정 데이터가 없어도 탭을 항상 노출하고, 탭 안에서 안내문을 보여준다.
  const usedTypes = useMemo(() => {
    const set = new Set(all.map((e) => e.exam_type));
    return TYPES.filter((t) => set.has(t.key) || t.key === 'opic');
  }, [all]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? all : all.filter((e) => e.exam_type === filter);
    if (!showPast) list = list.filter((e) => daysUntil(e.exam_date) >= 0);
    return [...list].sort((a, b) => a.exam_date.localeCompare(b.exam_date));
  }, [all, filter, showPast]);

  // 깃발 표시한 시험은 맨 위 "내 시험" 섹션에 고정
  const mine = filtered.filter((e) => e.is_mine);
  const others = filtered.filter((e) => !e.is_mine);

  const pastCount = useMemo(
    () =>
      (filter === 'all' ? all : all.filter((e) => e.exam_type === filter)).filter(
        (e) => daysUntil(e.exam_date) < 0
      ).length,
    [all, filter]
  );

  // 달력: 해당 월의 날짜별 일정 모으기
  const monthMap = useMemo(() => {
    const map = new Map();
    const prefix = `${month.y}-${String(month.m + 1).padStart(2, '0')}`;
    const add = (date, item) => {
      if (!date || !date.startsWith(prefix)) return;
      const day = Number(date.slice(8, 10));
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(item);
    };
    for (const e of filter === 'all' ? all : all.filter((x) => x.exam_type === filter)) {
      add(e.exam_date, { e, kind: 'exam' });
      add(e.reg_end, { e, kind: 'reg' });
    }
    return map;
  }, [all, filter, month]);

  const calendarCells = useMemo(() => {
    const first = new Date(month.y, month.m, 1).getDay();
    const days = new Date(month.y, month.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    return cells;
  }, [month]);

  /** 일정 카드 한 장 — 내 시험/전체 일정 두 그룹에서 같이 쓴다 */
  const renderCard = (e) => {
    const t = TYPE_MAP[e.exam_type] || { label: e.exam_type, short: '?' };
    const st = statusOf(e);
    const dExam = daysUntil(e.exam_date);
    return (
      <li
        key={e.id}
        className={`exam-card ${st.tone === 'done' ? 'is-past' : ''} ${e.is_mine ? 'is-mine' : ''}`}
      >
        <div className={`exam-type exam-type--${e.exam_type}`}>{t.short}</div>
        <div className="exam-body">
          <div className="exam-top">
            <span className="exam-title">
              {t.label}
              {e.round ? ` ${e.round}` : ''}
              {e.is_mine ? (
                <em className="exam-mine-tag">
                  <Icon name="flagFill" size={10} /> 내 시험
                </em>
              ) : null}
              {e.is_sample ? <em className="exam-sample-tag">예시</em> : null}
            </span>
            <span className={`exam-status exam-status--${st.tone}`}>{st.text}</span>
            <span className="exam-actions">
              <button
                type="button"
                className={`icon-btn exam-flag ${e.is_mine ? 'is-on' : ''}`}
                title={e.is_mine ? '내 시험 해제' : '내 시험으로 표시'}
                aria-label={e.is_mine ? '내 시험 해제' : '내 시험으로 표시'}
                aria-pressed={!!e.is_mine}
                onClick={() => toggleMine(e)}
              >
                <Icon name={e.is_mine ? 'flagFill' : 'flag'} size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="수정"
                aria-label="일정 수정"
                onClick={() => openEdit(e)}
              >
                <Icon name="pencil" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="이 일정을 복제해 새로 만들기"
                aria-label="일정 복제"
                onClick={() => openEdit(e, true)}
              >
                <Icon name="layers" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="삭제"
                aria-label="일정 삭제"
                onClick={() => remove(e)}
              >
                <Icon name="trash" size={15} />
              </button>
            </span>
          </div>
          <div className="exam-date">
            <Icon name="calendar" size={14} />
            시험일 <b>{fmtDate(e.exam_date)}</b>
            {dExam > 0 && <span className="exam-dday">D-{dExam}</span>}
          </div>
          <dl className="exam-meta">
            {(e.reg_start || e.reg_end) && (
              <>
                <dt>접수</dt>
                <dd>
                  {fmtDate(e.reg_start)}
                  {e.reg_end ? ` ~ ${fmtDate(e.reg_end)}` : ''}
                </dd>
              </>
            )}
            {(e.late_start || e.late_end) && (
              <>
                <dt>추가접수</dt>
                <dd>
                  {fmtDate(e.late_start)}
                  {e.late_end ? ` ~ ${fmtDate(e.late_end)}` : ''}
                </dd>
              </>
            )}
            {e.result_date && (
              <>
                <dt>성적발표</dt>
                <dd>{fmtDate(e.result_date)}</dd>
              </>
            )}
          </dl>
          {e.note && <p className="exam-note muted">{e.note}</p>}
          {(e.link || t.site) && (
            <a
              className="exam-link"
              href={e.link || t.site}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t.label} 공식 사이트
              <Icon name="chevronRight" size={14} />
            </a>
          )}
        </div>
      </li>
    );
  };

  const today = todayStr();
  const shiftMonth = (delta) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <div className="page exams-page">
      <div className="page-head">
        <div>
          <h1>시험 일정</h1>
          <p>토익·오픽 등 영어 시험 접수와 시험 날짜를 모아 봐요.</p>
        </div>
        <div className="exam-head-actions">
          <div className="sd-viewtabs" role="tablist">
            <button
              type="button"
              className={`sd-viewtab ${view === 'list' ? 'selected' : ''}`}
              onClick={() => setView('list')}
              aria-selected={view === 'list'}
              role="tab"
            >
              <Icon name="list" size={15} /> 목록
            </button>
            <button
              type="button"
              className={`sd-viewtab ${view === 'calendar' ? 'selected' : ''}`}
              onClick={() => setView('calendar')}
              aria-selected={view === 'calendar'}
              role="tab"
            >
              <Icon name="calendar" size={15} /> 달력
            </button>
          </div>
          <button type="button" className="btn primary" onClick={openNew}>
            <Icon name="plus" size={16} /> 일정 추가
          </button>
        </div>
      </div>

      {form && (
        <form className="panel exam-form" onSubmit={save}>
          <div className="exam-form-head">
            <h2 className="panel-title">
              <Icon name={form.id ? 'pencil' : 'plus'} size={18} />
              {form.id ? '일정 수정' : '일정 추가'}
            </h2>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setForm(null)}
              aria-label="닫기"
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          {/* 필수 */}
          <div className="exam-form-row exam-form-row--req">
            <label className="field">
              <span>
                시험 종류 <em className="req">필수</em>
              </span>
              <select
                value={form.exam_type}
                onChange={(ev) => setForm({ ...form, exam_type: ev.target.value })}
              >
                {TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                시험일 <em className="req">필수</em>
              </span>
              <input
                type="date"
                required
                value={form.exam_date}
                onChange={(ev) => setForm({ ...form, exam_date: ev.target.value })}
              />
            </label>
            <label className="field">
              <span>회차</span>
              <input
                value={form.round}
                onChange={(ev) => setForm({ ...form, round: ev.target.value })}
                placeholder="예: 제402회"
              />
            </label>
          </div>

          <p className="exam-form-hint muted">
            아래는 모두 선택 사항이에요. 비워 두면 그 항목은 카드에 표시되지 않아요.
          </p>

          {/* 접수 기간 */}
          <fieldset className="exam-fieldset">
            <legend>접수 기간</legend>
            <div className="exam-form-row">
              <label className="field">
                <span>시작</span>
                <input
                  type="date"
                  value={form.reg_start}
                  onChange={(ev) => setForm({ ...form, reg_start: ev.target.value })}
                />
              </label>
              <label className="field">
                <span>마감</span>
                <input
                  type="date"
                  value={form.reg_end}
                  onChange={(ev) => setForm({ ...form, reg_end: ev.target.value })}
                />
              </label>
            </div>
          </fieldset>

          {/* 추가접수 */}
          <fieldset className="exam-fieldset">
            <legend>추가접수 기간</legend>
            <div className="exam-form-row">
              <label className="field">
                <span>시작</span>
                <input
                  type="date"
                  value={form.late_start}
                  onChange={(ev) => setForm({ ...form, late_start: ev.target.value })}
                />
              </label>
              <label className="field">
                <span>마감</span>
                <input
                  type="date"
                  value={form.late_end}
                  onChange={(ev) => setForm({ ...form, late_end: ev.target.value })}
                />
              </label>
            </div>
          </fieldset>

          {/* 기타 */}
          <fieldset className="exam-fieldset">
            <legend>그 밖에</legend>
            <div className="exam-form-row">
              <label className="field">
                <span>성적 발표</span>
                <input
                  type="date"
                  value={form.result_date}
                  onChange={(ev) => setForm({ ...form, result_date: ev.target.value })}
                />
              </label>
              <label className="field">
                <span>비고</span>
                <input
                  value={form.note}
                  onChange={(ev) => setForm({ ...form, note: ev.target.value })}
                  placeholder="예: 특별시험, 고사장 제한"
                />
              </label>
            </div>
            <label className="field">
              <span>공식 링크</span>
              <input
                value={form.link}
                onChange={(ev) => setForm({ ...form, link: ev.target.value })}
                placeholder={`비워두면 ${TYPE_MAP[form.exam_type]?.label || ''} 기본 링크를 써요`}
              />
            </label>
          </fieldset>

          <div className="exam-form-actions">
            <button type="button" className="btn" onClick={() => setForm(null)}>
              취소
            </button>
            <button type="submit" className="btn primary" disabled={!form.exam_date || saving}>
              {saving ? '저장 중…' : form.id ? '수정 저장' : '추가'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="error-msg">
          <Icon name="x" size={16} /> {error}
        </p>
      )}

      {hasSample && (
        <p className="exam-sample-warn">
          <Icon name="x" size={15} />
          <span>
            <b>예시 데이터</b>가 섞여 있어요. 실제 시험 날짜가 아닙니다.
          </span>
        </p>
      )}

      {!exams && !error && (
        <div className="learn-skeletons">
          <div className="skeleton" style={{ height: 44, borderRadius: 999 }} />
          <div className="skeleton" style={{ height: 300, borderRadius: 'var(--radius)' }} />
        </div>
      )}

      {exams && all.length === 0 && (
        <div className="panel">
          <EmptyState
            icon="calendar"
            title="등록된 시험 일정이 없어요"
            desc="토익·오픽 등의 일정을 넣으면 여기에서 한눈에 볼 수 있어요."
          />
        </div>
      )}

      {/* 공식 사이트 바로가기 — 일정이 없어도 접수 페이지로 갈 수 있게 */}
      <section className="exam-sites">
        <h2 className="exam-sites-title">
          <Icon name="chevronRight" size={15} /> 공식 사이트 바로가기
        </h2>
        <div className="exam-sites-row">
          {TYPES.filter((t) => t.site).map((t) => (
            <a
              key={t.key}
              className={`exam-site-chip exam-type--${t.key}`}
              href={t.site}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t.label}
            </a>
          ))}
        </div>
      </section>

      {exams && all.length > 0 && (
        <>
          {usedTypes.length > 1 && (
            <div className="chip-row exam-filters">
              <button
                type="button"
                className={`chip ${filter === 'all' ? 'selected' : ''}`}
                onClick={() => setFilter('all')}
              >
                전체
              </button>
              {usedTypes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`chip ${filter === t.key ? 'selected' : ''}`}
                  onClick={() => setFilter(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* 오픽 탭: 상시시험 안내 */}
          {filter === 'opic' && (
            <p className="exam-opic-note">
              <Icon name="clock" size={15} />
              <span>
                <b>오픽(OPIc)</b>은 정해진 회차 없이 <b>상시 시행</b>돼요. 고사장마다 거의 매일
                열리니{' '}
                <a href="https://www.opic.or.kr/" target="_blank" rel="noreferrer noopener">
                  오픽 공식 사이트
                </a>
                에서 원하는 날짜·고사장을 골라 접수하면 됩니다. 접수한 날짜를 [일정 추가]로
                넣으면 여기서 D-day로 볼 수 있어요.
              </span>
            </p>
          )}

          {view === 'list' ? (
            <>
              {filtered.length === 0 ? (
                filter === 'opic' ? null : (
                  <div className="panel">
                    <EmptyState
                      icon="calendar"
                      title="다가오는 일정이 없어요"
                      desc="지난 일정을 보려면 아래 버튼을 눌러 주세요."
                    />
                  </div>
                )
              ) : (
                <>
                  {mine.length > 0 && (
                    <>
                      <h2 className="exam-group-title">
                        <Icon name="flagFill" size={15} /> 내 시험
                      </h2>
                      <ul className="exam-list">{mine.map(renderCard)}</ul>
                      {others.length > 0 && (
                        <h2 className="exam-group-title plain">전체 일정</h2>
                      )}
                    </>
                  )}
                  {others.length > 0 && <ul className="exam-list">{others.map(renderCard)}</ul>}
                </>
              )}

              {pastCount > 0 && (
                <button
                  type="button"
                  className="btn ghost full exam-pasttoggle"
                  onClick={() => setShowPast((v) => !v)}
                >
                  <Icon name="history" size={16} />
                  {showPast ? '지난 일정 숨기기' : `지난 일정 ${pastCount}개 보기`}
                </button>
              )}
            </>
          ) : (
            <section className="panel exam-calendar">
              <div className="cal-head">
                <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="이전 달">
                  <Icon name="arrowLeft" size={18} />
                </button>
                <strong>
                  {month.y}년 {month.m + 1}월
                </strong>
                <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="다음 달">
                  <Icon name="chevronRight" size={18} />
                </button>
              </div>
              <div className="cal-grid cal-weekdays">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="cal-wd">
                    {w}
                  </div>
                ))}
              </div>
              <div className="cal-grid">
                {calendarCells.map((d, i) => {
                  if (d == null) return <div key={`e${i}`} className="cal-cell is-empty" />;
                  const dateStr = `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const items = monthMap.get(d) || [];
                  const hasMine = items.some((it) => it.kind === 'exam' && it.e.is_mine);
                  return (
                    <div
                      key={d}
                      className={`cal-cell ${dateStr === today ? 'is-today' : ''} ${items.length ? 'has-item' : ''} ${hasMine ? 'is-mine' : ''}`}
                    >
                      <span className="cal-day">
                        {d}
                        {hasMine && <Icon name="flagFill" size={10} />}
                      </span>
                      {items.map((it, k) => {
                        const t = TYPE_MAP[it.e.exam_type] || { short: '?' };
                        return (
                          <span
                            key={k}
                            className={`cal-tag cal-tag--${it.kind} exam-type--${it.e.exam_type} ${
                              it.kind === 'exam' && it.e.is_mine ? 'is-mine' : ''
                            }`}
                            title={`${t.short} ${it.kind === 'exam' ? '시험일' : '접수 마감'}${
                              it.e.is_mine ? ' · 내 시험' : ''
                            }`}
                          >
                            {t.short}
                            {it.kind === 'reg' ? ' 마감' : ''}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <p className="cal-legend muted">
                <span className="cal-tag cal-tag--exam">시험일</span>
                <span className="cal-tag cal-tag--reg">접수 마감</span>
                <span className="cal-tag is-mine">내 시험</span>
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
