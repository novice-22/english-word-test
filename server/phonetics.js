/**
 * 영어 단어의 발음기호(IPA)를 찾아준다.
 *
 * CMU Pronouncing Dictionary 를 IPA 로 변환해 둔 phonetics.json.gz 를 읽어 쓴다.
 * 외부 사전 API 를 부르지 않으므로 네트워크 없이도 동작하고,
 * 교재에 없는 정보가 섞여 들어올 일도 없다.
 *
 * 원 데이터 저작권: Copyright (C) 1993-2015 Carnegie Mellon University (BSD-2-clause).
 * 재배포 조건과 면책조항 전문은 레포 루트의 THIRD-PARTY-NOTICES.md 에 있다.
 *
 * 데이터를 다시 만들려면: node tools/build-phonetics.mjs
 * 파일이 없으면 발음기호 없이(null) 동작한다 — pos-lexicon 과 같은 방식.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 프로토타입 없는 객체에 담는다.
 * 그냥 JSON.parse 결과를 쓰면 DICT['constructor'] 가 Object.prototype.constructor
 * (함수, truthy)를 돌려줘 발음기호 자리에 함수가 들어간다 — 실제로 단어 'constructor' 를
 * 넣으면 INSERT 바인딩이 터져 500 이 났다.
 * @type {Record<string, string>}
 */
let DICT = Object.create(null);
try {
  const parsed = JSON.parse(
    gunzipSync(readFileSync(path.join(__dirname, 'phonetics.json.gz'))).toString()
  );
  if (parsed && typeof parsed === 'object') Object.assign(DICT, parsed);
} catch {
  /* 데이터 파일 없음·깨짐 — 발음기호 기능만 꺼진다 */
}

export const phoneticsAvailable = Object.keys(DICT).length > 0;

/**
 * 사전 조회용 정규화.
 * 양끝 구두점만 떼고, 남은 것이 영문 낱말 꼴이 아니면 조회를 포기한다(빈 문자열).
 * 숫자·한글이 섞인 것을 그냥 깎아내면 'ba가' -> 'ba', '1st' -> 'st', 'CO2' -> 'co' 처럼
 * 엉뚱한 단어의 발음을 가져다 붙인다 — 그건 "틀린 발음을 지어내지 않는다"는 원칙에 어긋난다.
 */
function key(word) {
  const trimmed = String(word || '')
    .toLowerCase()
    .trim()
    .replace(/^[.,!?;:"'()[\]]+/, '')
    .replace(/[,!?;:"'()[\]]+$/, '');
  return /^[a-z][a-z'.-]*$/.test(trimmed) ? trimmed : '';
}

/** 한 낱말의 발음기호 (없으면 null) */
function lookupOne(word) {
  const k = key(word);
  if (!k) return null;
  const hit = DICT[k];
  // "cats" 처럼 사전에 없는 굴절형은 포기한다 — 틀린 발음을 지어내지 않는다
  return typeof hit === 'string' && hit ? hit : null;
}

/**
 * 발음기호를 돌려준다. 슬래시는 붙이지 않는다(표시 측 책임).
 * "ice cream" 처럼 두 낱말이면 각각 찾아 공백으로 잇고, 하나라도 없으면 null.
 */
export function phoneticOf(word) {
  const raw = String(word || '').trim();
  if (!raw) return null;

  const single = lookupOne(raw);
  if (single) return single;

  const parts = raw.split(/[\s]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const found = parts.map(lookupOne);
  if (found.some((p) => !p)) return null;
  return found.join(' ');
}
