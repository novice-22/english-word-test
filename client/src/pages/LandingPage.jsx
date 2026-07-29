import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../auth.jsx';
import './landing.css';

/** 구글 로그인 실패 시 콜백이 넘겨주는 에러 코드 → 사람 말 */
const LOGIN_ERRORS = {
  email_not_allowed: '허용되지 않은 구글 계정이에요. 등록된 계정으로만 로그인할 수 있어요.',
  state_mismatch: '로그인 절차가 꼬였어요. 처음부터 다시 시도해 주세요.',
  rate_limited: '시도가 너무 잦아 잠시 막았어요. 15분 뒤에 다시 해주세요.',
  not_configured: '구글 로그인이 아직 설정되지 않았어요.',
  token_exchange: '구글 로그인에 실패했어요. 다시 시도해 주세요.',
  no_id_token: '구글 로그인에 실패했어요. 다시 시도해 주세요.',
  bad_token: '구글 로그인에 실패했어요. 다시 시도해 주세요.',
  bad_claims: '구글 로그인에 실패했어요. 다시 시도해 주세요.',
  google_error: '구글 응답이 없어요. 잠시 뒤 다시 시도해 주세요.',
};

const FEATURES = [
  { icon: 'keyboard', title: '시험 모드 5종', desc: '뜻 쓰기 · 받아쓰기 · 객관식 · 혼합까지, 진짜 시험처럼' },
  { icon: 'refresh', title: '똑똑한 복습', desc: '틀린 단어는 잊어버릴 때쯤 다시 나와요 (SM-2 간격 반복)' },
  { icon: 'calendar', title: '시험일정 D-day', desc: '토익·텝스·지텔프 실제 일정과 접수 마감 알림' },
  { icon: 'chart', title: '학습 통계', desc: '단어장별 진도와 점수 흐름을 한눈에' },
];

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LandingPage() {
  const { passwordLogin, googleLogin, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  // 구글 콜백에서 돌아온 에러 메시지 표시
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('login_error');
    if (code) {
      setError(LOGIN_ERRORS[code] || '로그인에 실패했어요.');
      window.history.replaceState(null, '', '/');
    }
  }, []);

  async function submit(ev) {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const nothingConfigured = !passwordLogin && !googleLogin;

  return (
    <div className="landing">
      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-logo">
            <span className="logo-mark">
              <Icon name="book" size={22} />
            </span>
            워드테스트
          </div>
          <h1 className="landing-title">
            영단어, <em>시험처럼</em> 외운다
          </h1>
          <p className="landing-sub">
            개인 영단어 학습 사이트예요. 단어장·시험·복습 기능은 로그인해야 쓸 수 있어요.
          </p>
          <ul className="landing-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="landing-fi">
                  <Icon name={f.icon} size={18} />
                </span>
                <span>
                  <b>{f.title}</b>
                  <small>{f.desc}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel landing-login" aria-label="로그인">
          <h2>
            <Icon name="target" size={18} /> 로그인
          </h2>

          {nothingConfigured && (
            <p className="landing-hint">
              아직 계정이 설정되지 않았어요. 서버에서 <code>setup-auth</code>를 실행해 주세요.
            </p>
          )}

          {googleLogin && (
            <a className="btn landing-google" href="/api/auth/google/start">
              <GoogleMark /> 구글로 로그인
            </a>
          )}

          {googleLogin && passwordLogin && <div className="landing-or">또는</div>}

          {passwordLogin && (
            <form onSubmit={submit} className="landing-form">
              <label className="field">
                <span>아이디</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="field">
                <span>비밀번호</span>
                <div className="landing-pw">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
                  >
                    <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </div>
              </label>
              <button type="submit" className="btn primary full" disabled={busy}>
                {busy ? '확인 중…' : '로그인'}
              </button>
            </form>
          )}

          {error && (
            <p className="error-msg landing-error">
              <Icon name="x" size={15} /> {error}
            </p>
          )}
        </section>
      </main>
      <footer className="landing-foot muted">personal vocabulary trainer</footer>
    </div>
  );
}
