import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router';
import Icon from './components/Icon.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import LandingPage from './pages/LandingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SetsPage from './pages/SetsPage.jsx';
import SetDetailPage from './pages/SetDetailPage.jsx';
import QuizSetupPage from './pages/QuizSetupPage.jsx';
import QuizPage from './pages/QuizPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import ResultPage from './pages/ResultPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import StatsPage from './pages/StatsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ExamsPage from './pages/ExamsPage.jsx';

const NAV_ITEMS = [
  { to: '/', icon: 'home', label: '홈', end: true },
  { to: '/sets', icon: 'book', label: '단어장' },
  { to: '/review', icon: 'refresh', label: '복습' },
  { to: '/exams', icon: 'calendar', label: '시험일정' },
  { to: '/stats', icon: 'chart', label: '통계' },
];

function getStoredTheme() {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage 접근 불가 */
  }
  return 'dark'; // 기본은 다크
}

function ThemeToggle() {
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* localStorage 접근 불가 */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const next = theme === 'dark' ? '라이트' : '다크';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      title={`${next} 테마로 전환`}
      aria-label={`${next} 테마로 전환`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <NavLink to="/" className="logo" aria-label="워드테스트 홈으로">
          <span className="logo-mark">
            <Icon name="book" size={17} />
          </span>
          <span className="logo-text">워드테스트</span>
        </NavLink>
        <nav aria-label="주 메뉴">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-actions">
          <ThemeToggle />
          <NavLink to="/settings" className="icon-btn" title="설정" aria-label="설정">
            <Icon name="settings" size={20} />
          </NavLink>
        </div>
      </div>
    </header>
  );
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="모바일 메뉴">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          <Icon name={item.icon} size={22} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** 로그인 여부에 따라 랜딩 ↔ 앱 전체를 가른다 */
function Shell() {
  const { loading, authed } = useAuth();

  if (loading) {
    return (
      <div className="auth-splash" aria-label="불러오는 중">
        <span className="logo-mark">
          <Icon name="book" size={22} />
        </span>
      </div>
    );
  }

  if (!authed) return <LandingPage />;

  return (
    <>
      <ScrollToTop />
      <Topbar />
      <main className="container">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sets" element={<SetsPage />} />
          <Route path="/sets/:id" element={<SetDetailPage />} />
          <Route path="/sets/:id/quiz-setup" element={<QuizSetupPage />} />
          <Route path="/quiz" element={<QuizPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/results/:id" element={<ResultPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/exams" element={<ExamsPage />} />
        </Routes>
      </main>
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}
