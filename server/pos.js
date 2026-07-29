/**
 * 한글 뜻으로 품사를 추론한다. (명/동/형/부)
 * 단어장에 적힌 뜻의 어미만 보고 판정하므로 외부 사전 API가 필요 없다.
 *
 * pos-lexicon.js(검증 사전)가 있으면 어미 규칙보다 우선해서 쓴다.
 * 없으면 규칙만으로 동작한다 — 형식은 pos-lexicon.example.js 참고.
 */
let LEXICON = {};
try {
  ({ LEXICON } = await import('./pos-lexicon.js'));
} catch {
  /* 사전 파일 없음 — 어미 규칙만 사용 */
}

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

/**
 * 한 조각이 나타내는 표현들을 모두 펼친다.
 *   "연습(하다)"      → 연습 / 연습하다        (명 + 동)
 *   "재미(있는)"      → 재미 / 재미있는        (명 + 형)
 *   "인공[인조]의"    → 인공의 / 인조의        (형)
 *   "삶[인생/생활]"   → 삶 / 인생 / 생활       (명)
 *   "데려[가져]가다"  → 데려가다 / 가져가다    (동)
 */
function expandForms(part) {
  const raw = String(part).trim();
  // 1) 대괄호: "A[B]C" → "AC" 와 "B의 각 대안 + C"
  const m = raw.match(/^(.*?)\[([^\]]*)\](.*)$/);
  let bracketForms;
  if (m) {
    const [, before, inner, after] = m;
    bracketForms = [before + after];
    for (const alt of inner.split(/[/,]/)) {
      if (alt.trim()) bracketForms.push(alt.trim() + after);
    }
  } else {
    bracketForms = [raw];
  }

  // 2) 소괄호: 맨 앞에 오면 보충설명이라 버리고, 뒤에 오면 선택적 어미로 붙여 본다
  //    "(수량이) 많음" → 많음        /  "위층(으로, 의)" → 위층 · 위층으로 · 위층의
  const out = [];
  for (const f of bracketForms) {
    const withoutParens = f.replace(/\([^)]*\)/g, '').trim();
    out.push(withoutParens);
    for (const mm of f.matchAll(/\(([^)]*)\)/g)) {
      if (mm.index === 0) continue; // 앞머리 보충설명은 품사와 무관
      for (const opt of mm[1].split(/[/,]/)) {
        const o = opt.trim();
        if (o) out.push(withoutParens + o);
      }
    }
    for (const s of withoutParens.split('/')) if (s.trim()) out.push(s.trim());
  }

  return [...new Set(out.map((s) => s.replace(/[~·]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

// "~인"으로 끝나지만 형용사가 아닌 명사들
const NOUN_IN =
  /(상인|지배인|대리인|중개인|주인|노인|군인|시인|본인|타인|개인|법인|성인|미인|증인|장인|부인|외국인|한국인|여인|연인|죄인|살인|원인|요인|사인|은인|위인|직장인|사회인|현대인|일반인|관계인)$/;

// "~이"로 끝나지만 부사가 아닌 명사들
const NOUN_I = /(하기|보기|사이|차이|나이|길이|넓이|높이|깊이|먹이|놀이|모이|종이|허리|다리|머리|어린이|가이)$/;

// "~은"으로 끝나지만 형용사가 아닌 명사들
const NOUN_EUN = /(은|믿음|웃음|죽음|얼음|울음|걸음|모음|가슴|마음|이름|사람|다음|처음|목숨|아픔|기쁨|슬픔|졸음)$/;

// "~로"로 끝나는 부사 (도로·경로·진로 같은 명사가 많아 화이트리스트로 관리)
const ADVERB_RO =
  /(대체로|주로|실제로|억지로|저절로|함부로|서로|따로|별로|새로|스스로|홀로|참으로|절로|그대로|바로|의외로|임의로|강제로|때때로|마음대로|차례로)$/;

/** 펼쳐진 표현 하나의 품사 */
function posOfForm(raw) {
  // "헤어지 다" 처럼 원본에 섞인 공백은 어미 판정에 방해되므로 제거
  const s = String(raw || '').replace(/\s+/g, '');
  if (!s) return null;

  // 검증된 사전에 있으면 그대로 (1800단어 검수 결과에서 추출)
  const known = LEXICON[s];
  if (known) return known;

  // 부사
  if (/(적으로|으로|없이|스레|토록)$/.test(s)) return '부';
  if (/(않다|못하다)$/.test(s)) return '부';
  if (ADVERB_RO.test(s)) return '부'; // "로"로 끝나는 건 명사가 많아 화이트리스트로만
  if (/(히|껏|게)$/.test(s) && s.length >= 2) return '부';
  if (/이$/.test(s) && s.length >= 2 && !NOUN_I.test(s)) return '부';

  // 동사
  if (/(하다|되다|시키다|당하다|드리다|짓다)$/.test(s)) return '동';
  if (/[가-힣]다$/.test(s)) {
    if (/(스럽다|롭다|답다|같다)$/.test(s)) return '형';
    return '동';
  }

  // 형용사 (관형형 -은/-ㄴ 계열)
  if (/(스러운|로운|다운|같은|적인|어린|없는|있는)$/.test(s)) return '형';
  if (/(한|운|는|린|난|힌|른|픈|쁜|큰|흰|긴|찬|싼|튼|얀|된)$/.test(s)) return '형';
  if (/은$/.test(s) && s.length >= 2 && !NOUN_EUN.test(s)) return '형';
  if (/인$/.test(s)) return NOUN_IN.test(s) ? '명' : '형';
  if (/의$/.test(s) && s.length >= 2) return '형';

  return '명';
}

const ORDER = ['명', '동', '형', '부'];

/** 조각 하나의 품사들 (괄호 표기를 펼쳐 여러 개가 나올 수 있다) */
function posOfPart(part) {
  const tags = new Set();
  for (const f of expandForms(part)) {
    const t = posOfForm(f);
    if (t) tags.add(t);
  }
  return tags;
}

/** 뜻 조각별 품사. splitMeaningParts 순서와 1:1 대응하는 배열 (조각당 "명" 또는 "명·동") */
export function posPartsOfMeaning(meaning) {
  return splitMeaningParts(meaning).map((p) => {
    const tags = posOfPart(p);
    return ORDER.filter((t) => tags.has(t)).join('·');
  });
}

/** 조각별 품사를 "|" 로 이어붙인 저장용 문자열 (예: "형|명|부|명") */
export function posPartsString(meaning) {
  const parts = posPartsOfMeaning(meaning);
  return parts.length ? parts.join('|') : null;
}

/** 뜻 전체 → "명·동" 형태의 품사 문자열 (없으면 null) */
export function posOfMeaning(meaning) {
  const tags = new Set();
  for (const p of splitMeaningParts(meaning)) {
    for (const t of posOfPart(p)) tags.add(t);
  }
  const list = ORDER.filter((t) => tags.has(t));
  return list.length ? list.join('·') : null;
}
