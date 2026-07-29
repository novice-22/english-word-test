/**
 * "단어 보고 뜻 쓰기" 채점 엔진.
 * 뜻 문자열("두다[놓다]", "위층(으로, 의)", "삶[인생/생활], 생명" 등)을
 * 정답 후보들로 전개하고, 여러 뜻 중 하나만 맞아도 정답 처리한다.
 * 전개할 수 없는 특수 표기 부분은 채점 후보에서 제외한다(파일 원문은 유지).
 */

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

/** 사용자가 입력한 뜻이 정답인지 (여러 뜻 중 1개만 맞아도 OK) */
export function gradeKoreanMeaning(input, meaning) {
  const answer = normalizeKorean(input);
  if (!answer) return false;
  return meaningCandidates(meaning).has(answer);
}
