/**
 * "단어 보고 뜻 쓰기" 채점 엔진.
 * 뜻 문자열("두다[놓다]", "위층(으로, 의)", "삶[인생/생활], 생명" 등)을
 * 정답 후보들로 전개하고, 여러 뜻 중 하나만 맞아도 정답 처리한다.
 * 전개할 수 없는 특수 표기 부분은 채점 후보에서 제외한다(파일 원문은 유지).
 */

/**
 * 포함 판정에서 제외하는 조각 — 뜻이 아니라 문법 꼬리다.
 * "연습(하다)"의 "하다", "각각(의)"의 "의" 처럼 괄호 안에 자주 들어가는 것들
 * (1800단어 기준 하다 119회·의 55회로 압도적). 완전일치 경로는 막지 않으므로
 * 뜻 자체가 "하다"인 단어(do)는 영향받지 않는다.
 */
const SUFFIX_ONLY = new Set([
  '하다',
  '되다',
  '시키다',
  '당하다',
  '드리다',
  '이다',
  '있는',
  '없는',
  '하는',
  '되는',
  '적인',
  '하기',
  '으로',
  '에게',
  '에서',
  '의',
  '것',
  '들',
  '로',
  '에',
]);

/** 포함 판정에 쓸 수 있는 최소 길이 — "의"·"것" 한 글자로 전부 통과되는 것을 막는다 */
const MIN_MATCH_LEN = 2;

/**
 * 입력 끝에 붙은 조사 한 글자. "삶이"·"길을" 처럼 한 글자 뜻에 조사만 붙인 답은
 * 포함 판정(최소 2글자)에 걸리지 않으므로, 조사를 떼고 한 번 더 본다.
 */
const TAIL_PARTICLES = new Set(['이', '가', '은', '는', '을', '를', '의', '에', '도', '만', '로', '와', '과']);

/** 괄호 깊이를 인식해 최상위 쉼표로만 분리 */
export function splitMeaningParts(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(s || '')) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** 비교용 정규화: 공백/물결/가운뎃점/마침표 제거 */
export function normalizeKorean(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s~∼·.·]/g, '')
    .replace(/이다$/, ''); // "~하다" 유지, 서술격 "이다"만 관대하게
}

/** 한 부분(예: "사용[이용](하다)")을 정답 후보 문자열들로 전개 */
export function expandPart(part) {
  let p = String(part || '').trim();
  if (!p) return [];

  // 대괄호: 앞말의 대체어 — "두다[놓다]" -> 두다|놓다, "삶[인생/생활]" -> 삶|인생|생활
  const squareAlts = [];
  p = p.replace(/\[([^\]]*)\]/g, (_, inner) => {
    for (const alt of inner.split(/[/,]/)) if (alt.trim()) squareAlts.push(alt.trim());
    return '';
  });

  // 소괄호: 선택 접미/보충 — "위층(으로, 의)" -> 위층|위층으로|위층의
  const suffixGroups = [];
  p = p.replace(/\(([^)]*)\)/g, (_, inner) => {
    const opts = inner
      .split(/[/,]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (opts.length) suffixGroups.push(opts);
    return '';
  });

  // 남은 본문에서 슬래시는 대체어
  const bases = [];
  for (const b of p.split('/')) {
    const t = b.trim();
    if (t) bases.push(t);
  }
  for (const alt of squareAlts) bases.push(alt);

  const out = new Set();
  for (const b of bases) {
    out.add(b);
    // 접미 조합: 각 그룹의 옵션을 하나씩 붙인 형태도 후보로
    for (const group of suffixGroups) {
      for (const s of group) out.add(b + s);
    }
  }
  // 괄호 제거 전 원문 자체도 후보 (괄호째 그대로 입력한 경우)
  out.add(String(part).trim());

  return [...out].map(normalizeKorean).filter(Boolean);
}

/** 뜻 문자열 전체 -> 정답 후보 집합 */
export function meaningCandidates(meaning) {
  const set = new Set();
  for (const part of splitMeaningParts(meaning)) {
    for (const c of expandPart(part)) set.add(c);
  }
  // 전체 문자열 그대로도 허용
  const whole = normalizeKorean(meaning);
  if (whole) set.add(whole);
  return set;
}

/**
 * 완전일치 또는 "입력이 후보로 시작함" 판정.
 *
 * 포함(includes)이 아니라 앞머리(startsWith)만 보는 이유: 뒤쪽 포함을 허용하면
 * 동사 어미가 전부 통과한다. 뜻이 "치다"인 단어에 "가르치다"를, "~하게 하다"인
 * make/have/let 에 "지루하게 하다"를 정답으로 처리해 버린다(실측: 어미 조각
 * 치다·되다·주다·지다가 다른 뜻 조각 14~18개에 부분 문자열로 들어 있다).
 * 앞머리만 보면 "다른 사람"·"방법은"·"이웃나라" 는 그대로 통과하면서 그게 걸러진다.
 */
function matchesCandidates(answer, candidates) {
  if (!answer) return false;
  if (candidates.has(answer)) return true;
  if (answer.length < MIN_MATCH_LEN) return false;
  for (const c of candidates) {
    if (c.length < MIN_MATCH_LEN || SUFFIX_ONLY.has(c)) continue;
    if (answer.startsWith(c)) return true;
  }
  return false;
}

/**
 * 사용자가 입력한 뜻이 정답인지.
 *
 * 1) 뜻 조각 후보와 완전히 일치하면 정답 (여러 뜻 중 1개만 맞아도 OK)
 * 2) 입력이 후보로 시작해도 정답 — "다른 (것[사람])"에 "다른 사람",
 *    "방법[방식]"에 "방법은" 처럼 뒤에 조사·수식이 붙은 답을 틀리지 않게 한다.
 *    단 문법 꼬리(SUFFIX_ONLY)와 한 글자 후보는 이 경로에서 제외해,
 *    "하다"·"의" 한 마디로 아무 단어나 맞는 일을 막는다.
 * 3) 그래도 아니면 끝 조사 한 글자를 떼고 다시 본다 ("삶이" -> "삶").
 */
export function gradeKoreanMeaning(input, meaning) {
  const answer = normalizeKorean(input);
  if (!answer) return false;

  const candidates = meaningCandidates(meaning);
  if (matchesCandidates(answer, candidates)) return true;

  if (answer.length >= 2 && TAIL_PARTICLES.has(answer.slice(-1))) {
    return matchesCandidates(answer.slice(0, -1), candidates);
  }
  return false;
}
