#!/usr/bin/env node
/**
 * server/phonetics.json.gz 생성기 — CMU Pronouncing Dictionary -> IPA.
 *
 *   node tools/build-phonetics.mjs [cmudict 경로]
 *
 * 사전 파일이 없으면 받아온다 (약 3.6MB):
 *   curl -L -o tools/cmudict.dict https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
 *
 * CMUdict 저작권: Copyright (C) 1993-2015 Carnegie Mellon University — BSD-2-clause.
 * 소스·바이너리 재배포 모두 저작권 고지·조건문·면책조항을 함께 실어야 하므로
 * 전문을 레포 루트 THIRD-PARTY-NOTICES.md 에 담았다. 산출물을 커밋할 때 그 파일도 같이 가야 한다.
 * (교재에서 파생돼 아예 공개하지 않는 server/pos-lexicon.js 와는 사정이 다르다 — 이쪽은 고지하면 된다.)
 *
 * 새 단어장을 넣었는데 발음기호가 비어 있으면 이 스크립트를 다시 돌릴 필요는 없다 —
 * 산출물이 CMUdict 전체(약 12.6만 단어)를 담으므로 보통은 이미 들어 있다.
 * CMUdict 자체가 갱신됐을 때만 다시 돌리면 된다.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const SRC = process.argv[2] || path.join(__dirname, 'cmudict.dict');
const OUT = path.join(REPO, 'server', 'phonetics.json.gz');

/** ARPAbet 39음소 -> IPA (미국식) */
const IPA = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð',
  EH: 'ɛ', ER: 'ɝ', EY: 'eɪ',
  F: 'f', G: 'ɡ', HH: 'h',
  IH: 'ɪ', IY: 'i', JH: 'dʒ',
  K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ',
  OW: 'oʊ', OY: 'ɔɪ',
  P: 'p', R: 'ɹ', S: 's', SH: 'ʃ',
  T: 't', TH: 'θ',
  UH: 'ʊ', UW: 'u',
  V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);

/**
 * 영어에서 한 음절의 앞에 올 수 있는 2자음 묶음(IPA 표기).
 * 강세 표시를 모음 앞 자음 묶음의 어디에 꽂을지 정하는 데 쓴다 —
 * "mp" 는 어두에 못 오므로 important 는 ɪmˈpɔɹtənt (ɪˈmpɔɹtənt 가 아니라).
 */
const ONSET2 = new Set([
  'st', 'sp', 'sk', 'sl', 'sm', 'sn', 'sw',
  'tɹ', 'dɹ', 'pɹ', 'bɹ', 'kɹ', 'ɡɹ', 'fɹ', 'θɹ', 'ʃɹ',
  'pl', 'bl', 'kl', 'ɡl', 'fl',
  'kw', 'ɡw', 'tw', 'dw', 'hw',
  'pj', 'bj', 'kj', 'fj', 'mj', 'vj', 'sj',
]);

/** 3자음 어두 — s + 폐쇄음 + 유음/활음. 이걸 안 보면 destroy·describe 류에서 강세가 한 칸 밀린다 */
const ONSET3 = new Set(['stɹ', 'spɹ', 'skɹ', 'skw', 'spl', 'skl', 'stj', 'spj', 'skj']);

/** "K AH1 N T R IY0" -> "ˈkʌntɹi". 모르는 음소가 섞이면 null */
function toIpa(arpa) {
  const phones = [];
  for (const token of arpa.split(/\s+/).filter(Boolean)) {
    const m = token.match(/^([A-Z]+)([012])?$/);
    if (!m) return null;
    const base = m[1];
    if (!IPA[base]) return null;
    const stress = m[2] === undefined ? null : Number(m[2]);
    // 약화모음은 따로: AH0 -> ə, ER0 -> ɚ
    let ipa = IPA[base];
    if (base === 'AH' && stress === 0) ipa = 'ə';
    if (base === 'ER' && stress === 0) ipa = 'ɚ';
    phones.push({ ipa, base, stress, vowel: VOWELS.has(base) });
  }
  if (!phones.length) return null;

  // 강세 표시를 꽂을 자리 계산: 강세 모음 앞 자음 묶음 중 '어두로 허용되는' 만큼 앞으로 당긴다
  const marks = new Map();
  let primaryPlaced = false; // 1차 강세(ˈ)는 한 단어에 하나뿐이다 (IPA 표기법)
  for (let i = 0; i < phones.length; i++) {
    if (!phones[i].vowel || !phones[i].stress) continue;
    let runStart = i;
    while (runStart > 0 && !phones[runStart - 1].vowel) runStart--;
    const run = phones.slice(runStart, i).map((p) => p.ipa);
    let at;
    if (runStart === 0) at = 0; // 단어 맨 앞이면 자음 묶음 전체가 어두
    else if (run.length === 0) at = i;
    else if (run.length >= 3 && ONSET3.has(run.slice(-3).join(''))) at = i - 3;
    else if (run.length >= 2 && ONSET2.has(run.slice(-2).join(''))) at = i - 2;
    else at = i - 1;

    // CMUdict 에 1 강세가 두 번 찍힌 단어가 있다. 둘째부터는 2차 강세로 내린다.
    const wantsPrimary = phones[i].stress === 1 && !primaryPlaced;
    if (wantsPrimary) primaryPlaced = true;
    if (!marks.has(at)) marks.set(at, wantsPrimary ? 'ˈ' : 'ˌ');
  }

  // 단음절은 강세를 표시하지 않는다 (사전 관례)
  const polysyllabic = phones.filter((p) => p.vowel).length > 1;

  let out = '';
  for (let i = 0; i < phones.length; i++) {
    if (polysyllabic && marks.has(i)) out += marks.get(i);
    out += phones[i].ipa;
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`사전 파일이 없습니다: ${SRC}`);
  console.error('받아오기:');
  console.error(
    '  curl -L -o tools/cmudict.dict https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict'
  );
  process.exit(1);
}

// 프로토타입 없는 객체 — 평범한 {} 면 `'constructor' in map` 이 true 라서
// 'constructor' 가 사전에 아예 안 담기고, 집계에도 안 잡힌 채 사라진다.
const map = Object.create(null);
let variants = 0;
let nonWord = 0;
let unconverted = 0;

for (const line of fs.readFileSync(SRC, 'utf8').split('\n')) {
  const text = line.trim();
  if (!text || text.startsWith(';;;')) continue;
  const sp = text.indexOf(' ');
  if (sp < 0) continue;

  const word = text.slice(0, sp);
  const arpa = text.slice(sp + 1).replace(/#.*$/, '').trim(); // 줄 끝 주석 제거

  if (/\(\d\)$/.test(word)) { variants++; continue; } // 2순위 발음은 버리고 첫 발음만
  if (!/^[a-z][a-z'.-]*$/.test(word)) { nonWord++; continue; } // 영문 단어만
  if (word in map) continue;

  const ipa = toIpa(arpa);
  if (!ipa) { unconverted++; continue; }
  map[word] = ipa;
}

const json = JSON.stringify(map);
fs.writeFileSync(OUT, zlib.gzipSync(json, { level: 9 }));

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`단어 ${Object.keys(map).length.toLocaleString()}개 -> ${path.relative(REPO, OUT)}`);
console.log(`  원본 ${kb(json.length)} / 압축 ${kb(fs.statSync(OUT).size)}`);
console.log(`  건너뜀: 변이발음 ${variants} · 비영문 ${nonWord} · 변환실패 ${unconverted}`);
