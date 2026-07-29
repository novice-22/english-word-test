import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * 로그인 상태 컨텍스트.
 * - 부팅 시 /api/auth/me 로 세션 확인
 * - api.js 가 401 을 받으면 'auth:expired' 이벤트를 쏘고 여기서 받아서 랜딩으로 전환
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    authed: false,
    passwordLogin: false,
    googleLogin: false,
  });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me');
      const d = await r.json();
      setState({
        loading: false,
        authed: !!d.authed,
        passwordLogin: !!d.password_login,
        googleLogin: !!d.google_login,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => setState((s) => (s.authed ? { ...s, authed: false } : s));
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(
    async (username, password) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '로그인에 실패했어요.');
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setState((s) => ({ ...s, authed: false }));
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
