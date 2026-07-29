/**
 * 로그인 계정 설정 스크립트 — 서버에서 직접 실행 (비밀번호가 채팅·레포에 남지 않게).
 *
 *   docker exec -it voca-app node server/setup-auth.mjs
 *
 * DATA_DIR/auth.json 에 저장되며, 서버 재시작 없이 바로 적용된다.
 * 빈 입력(Enter)은 "기존 값 유지"다.
 */
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRYPT_PARAMS } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUTH_FILE = path.join(dataDir, 'auth.json');

let cfg = {};
try {
  cfg = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`❌ ${AUTH_FILE} 를 읽을 수 없어요: ${err.message}`);
    console.error('   파일이 손상됐다면 백업 후 지우고 다시 실행하세요.');
    process.exit(1);
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

// readline 이 입력을 화면에 되쓰는 것을 막는 스위치 (비밀번호 입력 중에만 켠다)
let muted = false;
const origWrite = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (s) => {
  if (!muted) (origWrite ?? ((x) => rl.output.write(x)))(s);
};

// 줄 버퍼 — 입력이 한꺼번에 들어와도(파이프) 순서대로 하나씩 꺼내 쓴다
const pending = [];
const waiters = [];
let closed = false;
rl.on('line', (line) => {
  const w = waiters.shift();
  if (w) w(line);
  else pending.push(line);
});
rl.on('close', () => {
  closed = true;
  while (waiters.length) waiters.shift()('');
});

function nextLine() {
  return new Promise((resolve) => {
    if (pending.length) resolve(pending.shift());
    else if (closed) resolve('');
    else waiters.push(resolve);
  });
}

/** 보통 질문 — 입력이 화면에 보인다 */
function ask(q) {
  process.stdout.write(q);
  return nextLine();
}

/**
 * 화면에 보이지 않게 입력받기.
 * readline 이 줄 편집(백스페이스·붙여넣기·한글 등 멀티바이트)을 처리하고
 * 에코 출력만 막는 방식이라, 직접 raw 모드를 다루는 것보다 안전하다.
 */
async function askHidden(q) {
  process.stdout.write(q);
  muted = true;
  try {
    return await nextLine();
  } finally {
    muted = false;
    process.stdout.write('\n');
  }
}

console.log('=== 워드테스트 로그인 계정 설정 ===');
console.log(`설정 파일: ${AUTH_FILE}`);
console.log('(빈 입력 = 기존 값 유지)\n');

// --- 비밀번호 로그인 ---
const username = (await ask(`아이디 [${cfg.username || '미설정'}]: `)).trim();
if (username) cfg.username = username;

if (cfg.username) {
  const pw = await askHidden('비밀번호 (화면에 안 보여요, 유지하려면 그냥 Enter): ');
  if (pw) {
    if (pw.length < 12) {
      console.log('❌ 비밀번호는 12자 이상으로 해주세요. 다시 실행해 주세요.');
      process.exit(1);
    }
    if (pw.length > 200) {
      console.log('❌ 비밀번호가 너무 길어요(200자 이하). 다시 실행해 주세요.');
      process.exit(1);
    }
    const pw2 = await askHidden('비밀번호 확인: ');
    if (pw !== pw2) {
      console.log('❌ 두 입력이 달라요. 다시 실행해 주세요.');
      process.exit(1);
    }
    process.stdout.write('해시 계산 중… ');
    cfg.pass_salt = randomBytes(16).toString('hex');
    cfg.pass_n = SCRYPT_PARAMS.N;
    cfg.pass_r = SCRYPT_PARAMS.r;
    cfg.pass_p = SCRYPT_PARAMS.p;
    cfg.pass_hash = scryptSync(pw, cfg.pass_salt, 64, {
      N: cfg.pass_n,
      r: cfg.pass_r,
      p: cfg.pass_p,
      maxmem: SCRYPT_PARAMS.maxmem,
    }).toString('hex');
    console.log('완료');
    console.log('✅ 비밀번호 저장됨 — 기존에 로그인돼 있던 모든 기기의 세션은 무효가 됩니다.');
  }
}

// --- 구글 OAuth (선택) ---
console.log('\n--- 구글 로그인 (선택, 건너뛰려면 그냥 Enter) ---');
const gid = (await ask(`구글 클라이언트 ID [${cfg.google_client_id ? '설정됨' : '미설정'}]: `)).trim();
if (gid) cfg.google_client_id = gid;
const gsec = await askHidden(
  `구글 클라이언트 시크릿 [${cfg.google_client_secret ? '설정됨' : '미설정'}] (화면에 안 보여요): `
);
if (gsec.trim()) cfg.google_client_secret = gsec.trim();
const email = (await ask(`허용할 구글 이메일 [${cfg.allowed_email || '미설정'}]: `)).trim();
if (email && email !== cfg.allowed_email) {
  cfg.allowed_email = email;
  delete cfg.google_sub; // 이메일이 바뀌면 고정해 둔 계정 ID도 초기화
}

// --- 사이트 주소 (OAuth redirect 기준) ---
// 구글 OAuth 리디렉션과 CSRF 출처 검사의 기준이 되는 주소.
// 배포했다면 실제 주소(https://내도메인)를 넣는다.
const DEFAULT_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;
console.log('\n배포 주소가 있으면 넣으세요 (구글 로그인 리디렉션 기준).');
const origin = (await ask(`사이트 주소 [${cfg.site_origin || DEFAULT_ORIGIN}]: `)).trim();
cfg.site_origin = origin || cfg.site_origin || DEFAULT_ORIGIN;

if (!cfg.session_secret) cfg.session_secret = randomBytes(32).toString('hex');

// 원자적 저장
const tmp = `${AUTH_FILE}.tmp`;
writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
renameSync(tmp, AUTH_FILE);
try {
  chmodSync(AUTH_FILE, 0o600);
} catch {
  /* 무시 */
}
rl.close();

console.log('\n✅ 저장 완료. 서버 재시작 없이 바로 적용돼요.');
console.log(`   비밀번호 로그인: ${cfg.username && cfg.pass_hash ? '사용 가능 (' + cfg.username + ')' : '미설정'}`);
console.log(
  `   구글 로그인:     ${cfg.google_client_id && cfg.google_client_secret && cfg.allowed_email ? '사용 가능 (' + cfg.allowed_email + ')' : '미설정'}`
);
