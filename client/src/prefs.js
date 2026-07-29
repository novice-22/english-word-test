/** 학습 동작 설정 (localStorage) */
const AUTO_NEXT_KEY = 'quiz.autoNext';
const SPEAK_WRONG_KEY = 'quiz.speakOnWrong';

export function getPrefs() {
  let autoNext = false;
  let speakOnWrong = false; // 기본: 시험 중 소리는 사용자가 🔊 누를 때만
  try {
    autoNext = localStorage.getItem(AUTO_NEXT_KEY) === '1';
    speakOnWrong = localStorage.getItem(SPEAK_WRONG_KEY) === '1';
  } catch {
    /* 기본값 사용 */
  }
  return { autoNext, speakOnWrong };
}

export function setPrefs(partial = {}) {
  try {
    if (partial.autoNext !== undefined)
      localStorage.setItem(AUTO_NEXT_KEY, partial.autoNext ? '1' : '0');
    if (partial.speakOnWrong !== undefined)
      localStorage.setItem(SPEAK_WRONG_KEY, partial.speakOnWrong ? '1' : '0');
  } catch {
    /* 무시 */
  }
  return getPrefs();
}
