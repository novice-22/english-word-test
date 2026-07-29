import { useEffect, useMemo, useState } from 'react';
import { getTtsSettings, setTtsSettings, listEnglishVoices, speak, ttsAvailable } from '../tts.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import './settings.css';

const THEMES = [
  { value: 'dark', icon: 'moon', label: '다크' },
  { value: 'light', icon: 'sun', label: '라이트' },
];

const ACCENTS = [
  { value: 'en-US', label: '미국식' },
  { value: 'en-GB', label: '영국식' },
];

const RATES = [
  { value: 0.75, label: '느리게' },
  { value: 0.9, label: '보통' },
  { value: 1.1, label: '빠르게' },
];

function getThemePref() {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* 기본값 */
  }
  return 'dark';
}

function applyTheme(pref) {
  document.documentElement.dataset.theme = pref;
  try {
    localStorage.setItem('theme', pref);
  } catch {
    /* 무시 */
  }
}

export default function SettingsPage() {
  const { logout } = useAuth();
  const [theme, setTheme] = useState(getThemePref);
  const [tts, setTts] = useState(getTtsSettings);
  const [prefs, setPrefsState] = useState(getPrefs);
  const [voiceList, setVoiceList] = useState(() => listEnglishVoices());

  // 보이스 목록은 비동기로 로드되는 브라우저가 있어 잠깐 뒤 한 번 더 갱신
  useEffect(() => {
    const t = setTimeout(() => setVoiceList(listEnglishVoices()), 600);
    return () => clearTimeout(t);
  }, []);

  const changeTheme = (value) => {
    setTheme(value);
    applyTheme(value);
  };

  const changeTts = (partial) => setTts(setTtsSettings(partial));
  const changePrefs = (partial) => setPrefsState(setPrefs(partial));

  const voiceOptions = useMemo(() => {
    const groups = { 'en-US': [], 'en-GB': [], etc: [] };
    for (const v of voiceList) {
      if (v.lang === 'en-US') groups['en-US'].push(v);
      else if (v.lang === 'en-GB') groups['en-GB'].push(v);
      else groups.etc.push(v);
    }
    return groups;
  }, [voiceList]);

  const preview = () => speak('vocabulary');

  return (
    <div className="page settings-page">
      <div className="page-head">
        <div>
          <h1>설정</h1>
          <p>이 기기(브라우저)에 저장돼요.</p>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel-title">
          <Icon name="sun" size={18} /> 테마
        </h2>
        <div className="chip-row">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`chip ${theme === t.value ? 'selected' : ''}`}
              onClick={() => changeTheme(t.value)}
            >
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          <Icon name="speaker" size={18} /> 발음 (TTS)
        </h2>
        {!ttsAvailable() && (
          <p className="error-msg">
            <Icon name="x" size={16} /> 이 브라우저는 음성 재생을 지원하지 않아요.
          </p>
        )}

        <p className="settings-sub">억양</p>
        <div className="chip-row">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              className={`chip ${tts.accent === a.value ? 'selected' : ''}`}
              onClick={() => changeTts({ accent: a.value, voice: '' })}
            >
              {a.label}
            </button>
          ))}
        </div>

        <p className="settings-sub">속도</p>
        <div className="chip-row">
          {RATES.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`chip ${Math.abs(tts.rate - r.value) < 0.01 ? 'selected' : ''}`}
              onClick={() => changeTts({ rate: r.value })}
            >
              {r.label}
            </button>
          ))}
        </div>

        <p className="settings-sub">
          음량 <span className="muted settings-vol">{Math.round(tts.volume * 100)}%</span>
        </p>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={tts.volume}
          onChange={(e) => changeTts({ volume: e.target.value })}
          aria-label="발음 음량"
        />
        <p className="settings-note muted">
          일부 휴대폰 브라우저는 음량 조절 대신 기기 볼륨을 따라요.
        </p>

        <p className="settings-sub">목소리</p>
        <div className="settings-voice-row">
          <select
            value={tts.voice}
            onChange={(e) => changeTts({ voice: e.target.value })}
            aria-label="TTS 목소리 선택"
          >
            <option value="">자동 (억양에 맞춰 선택)</option>
            {voiceOptions['en-US'].length > 0 && (
              <optgroup label="미국식 (en-US)">
                {voiceOptions['en-US'].map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {voiceOptions['en-GB'].length > 0 && (
              <optgroup label="영국식 (en-GB)">
                {voiceOptions['en-GB'].map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {voiceOptions.etc.length > 0 && (
              <optgroup label="기타 영어">
                {voiceOptions.etc.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" className="btn" onClick={preview} disabled={!ttsAvailable()}>
            <Icon name="play" size={15} /> 미리듣기
          </button>
        </div>
        <p className="settings-note muted">
          목소리 목록은 기기·브라우저마다 달라요. Edge 브라우저가 가장 자연스러운 편이에요.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          <Icon name="bolt" size={18} /> 학습 동작
        </h2>
        <label className="check-line">
          <input
            type="checkbox"
            checked={prefs.autoNext}
            onChange={(e) => changePrefs({ autoNext: e.target.checked })}
          />
          정답이면 잠시 후 자동으로 다음 문제로
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={prefs.speakOnWrong}
            onChange={(e) => changePrefs({ speakOnWrong: e.target.checked })}
          />
          오답이면 정답 단어 발음 자동 재생
        </label>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          <Icon name="target" size={18} /> 계정
        </h2>
        <p className="muted settings-note">이 기기에서 로그아웃해요. 다른 기기 세션은 유지돼요.</p>
        <button type="button" className="btn" onClick={logout}>
          <Icon name="arrowLeft" size={16} /> 로그아웃
        </button>
      </section>
    </div>
  );
}
