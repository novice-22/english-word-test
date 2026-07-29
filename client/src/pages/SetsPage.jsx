import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { EmptyState, ProgressBar, ScoreBadge } from '../components/ui.jsx';
import './sets.css';

export default function SetsPage() {
  const [sets, setSets] = useState(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const navigate = useNavigate();
  const createInputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api
      .getSets()
      .then((data) => {
        if (alive) setSets(data);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!sets) return [];
    const q = query.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter((s) => s.name.toLowerCase().includes(q));
  }, [sets, query]);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError('');
    try {
      const created = await api.createSet(name);
      setNewName('');
      navigate(`/sets/${created.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function startRename(set) {
    setRenamingId(set.id);
    setRenameValue(set.name);
  }

  async function handleRename(e, set) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name || name === set.name) {
      setRenamingId(null);
      return;
    }
    setError('');
    try {
      await api.renameSet(set.id, name);
      setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, name } : s)));
      setRenamingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(set) {
    if (
      !window.confirm(
        `'${set.name}' 단어장을 삭제할까요?\n단어 ${set.word_count}개가 함께 삭제됩니다.`
      )
    )
      return;
    setError('');
    try {
      await api.deleteSet(set.id);
      setSets((prev) => prev.filter((s) => s.id !== set.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page sets">
      <div className="page-head">
        <div>
          <h1>단어장</h1>
          <p>{sets ? `총 ${sets.length}개의 단어장` : '단어장을 불러오는 중'}</p>
        </div>
      </div>

      <div className="sets-toolbar">
        <form className="row-form sets-create" onSubmit={handleCreate}>
          <input
            ref={createInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 단어장 이름 (예: 수능 필수 Day 1)"
            aria-label="새 단어장 이름"
          />
          <button type="submit" className="btn primary" disabled={creating || !newName.trim()}>
            <Icon name="plus" size={16} />
            만들기
          </button>
        </form>
        <div className="search-box sets-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="단어장 검색"
            aria-label="단어장 검색"
          />
        </div>
      </div>

      {error && (
        <p className="error-msg">
          <Icon name="x" size={16} />
          {error}
        </p>
      )}

      {sets === null && !error && (
        <div className="grid-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 148 }} />
          ))}
        </div>
      )}

      {sets && sets.length === 0 && (
        <div className="panel">
          <EmptyState
            icon="book"
            title="아직 단어장이 없어요"
            desc="첫 단어장을 만들고 단어를 추가해 보세요."
            action={
              <button
                type="button"
                className="btn primary"
                onClick={() => createInputRef.current?.focus()}
              >
                <Icon name="plus" size={16} />
                단어장 만들기
              </button>
            }
          />
        </div>
      )}

      {sets && sets.length > 0 && filtered.length === 0 && (
        <div className="panel">
          <EmptyState
            icon="search"
            title="검색 결과가 없어요"
            desc={`'${query.trim()}' 이름을 가진 단어장을 찾지 못했어요.`}
          />
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid-2">
          {filtered.map((set) => (
            <article key={set.id} className="set-card">
              <div className="set-card-head">
                {renamingId === set.id ? (
                  <form className="set-card-rename" onSubmit={(e) => handleRename(e, set)}>
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label="단어장 이름 변경"
                      autoFocus
                    />
                    <button type="submit" className="btn primary sm">
                      저장
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setRenamingId(null)}
                    >
                      취소
                    </button>
                  </form>
                ) : (
                  <>
                    <Link to={`/sets/${set.id}`} className="set-card-name">
                      {set.name}
                    </Link>
                    {set.last_pct != null && <ScoreBadge pct={set.last_pct} />}
                  </>
                )}
              </div>

              <p className="set-card-meta">
                단어 {set.word_count}개
                {set.starred_count > 0 && (
                  <>
                    {' · '}
                    <Icon name="starFill" size={12} className="set-card-star" /> {set.starred_count}
                  </>
                )}
                {' · '}학습 {set.studied_count}/{set.word_count}
              </p>
              <ProgressBar value={set.studied_count} max={set.word_count} />

              <div className="set-card-actions">
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={set.word_count === 0}
                  onClick={() => navigate(`/sets/${set.id}/quiz-setup`)}
                >
                  <Icon name="play" size={15} />
                  시험 보기
                </button>
                <Link to={`/sets/${set.id}`} className="btn sm">
                  <Icon name="list" size={15} />
                  단어 관리
                </Link>
                <span className="set-card-tools">
                  <button
                    type="button"
                    className="icon-btn"
                    title="이름 변경"
                    aria-label={`'${set.name}' 이름 변경`}
                    onClick={() => startRename(set)}
                  >
                    <Icon name="pencil" size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="삭제"
                    aria-label={`'${set.name}' 삭제`}
                    onClick={() => handleDelete(set)}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
