const RATE_KEY = 'tts.rate';
const ACCENT_KEY = 'tts.accent';
const VOLUME_KEY = 'tts.volume';
const VOICE_KEY = 'tts.voice';
const DEFAULT_RATE = 0.9;
const DEFAULT_ACCENT = 'en-US';
const DEFAULT_VOLUME = 1;
const ACCENTS = ['en-US', 'en-GB'];

let voices = [];

function loadVoices() {
  voices = window.speechSynthesis?.getVoices() || [];
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export function ttsAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function normalizeLang(lang) {
  return (lang || '').replace('_', '-');
}

/** 기기에 설치된 영어 보이스 목록 (설정 화면용) */
export function listEnglishVoices() {
  loadVoices();
  return voices
    .filter((v) => normalizeLang(v.lang).toLowerCase().startsWith('en'))
    .map((v) => ({ name: v.name, lang: normalizeLang(v.lang), local: v.localService }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

export function getTtsSettings() {
  let rate = DEFAULT_RATE;
  let accent = DEFAULT_ACCENT;
  let volume = DEFAULT_VOLUME;
  let voice = '';
  try {
    const storedRate = parseFloat(localStorage.getItem(RATE_KEY));
    if (Number.isFinite(storedRate) && storedRate > 0) rate = storedRate;
    const storedAccent = localStorage.getItem(ACCENT_KEY);
    if (ACCENTS.includes(storedAccent)) accent = storedAccent;
    const storedVol = parseFloat(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(storedVol) && storedVol >= 0 && storedVol <= 1) volume = storedVol;
    voice = localStorage.getItem(VOICE_KEY) || '';
  } catch {
    /* localStorage 접근 불가 시 기본값 사용 */
  }
  return { rate, accent, volume, voice };
}

export function setTtsSettings(partial = {}) {
  try {
    if (partial.rate !== undefined) {
      const rate = parseFloat(partial.rate);
      if (Number.isFinite(rate) && rate > 0) localStorage.setItem(RATE_KEY, String(rate));
    }
    if (partial.accent !== undefined && ACCENTS.includes(partial.accent)) {
      localStorage.setItem(ACCENT_KEY, partial.accent);
    }
    if (partial.volume !== undefined) {
      const vol = parseFloat(partial.volume);
      if (Number.isFinite(vol) && vol >= 0 && vol <= 1)
        localStorage.setItem(VOLUME_KEY, String(vol));
    }
    if (partial.voice !== undefined) {
      localStorage.setItem(VOICE_KEY, String(partial.voice || ''));
    }
  } catch {
    /* localStorage 접근 불가 시 무시 */
  }
  return getTtsSettings();
}

function pickVoice(settings) {
  // 1순위: 사용자가 설정에서 고른 보이스
  if (settings.voice) {
    const chosen = voices.find((v) => v.name === settings.voice);
    if (chosen) return chosen;
  }
  // 2순위: 억양(en-US/en-GB) 일치 보이스
  const accent = settings.accent;
  const exact = (v) => normalizeLang(v.lang) === accent;
  const english = (v) => normalizeLang(v.lang).startsWith('en');
  return (
    voices.find((v) => exact(v) && v.localService) ||
    voices.find(exact) ||
    voices.find((v) => english(v) && v.localService) ||
    voices.find(english) ||
    null
  );
}

export function speak(text, overrides = {}) {
  if (!ttsAvailable() || !text) return false;
  const settings = { ...getTtsSettings(), ...overrides };
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = settings.accent;
  utter.rate = settings.rate;
  utter.volume = settings.volume;
  const voice = pickVoice(settings);
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang || settings.accent;
  }
  window.speechSynthesis.speak(utter);
  return true;
}
