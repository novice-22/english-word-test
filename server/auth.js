/**
 * 인증 모듈 — 계정 1개(가입 없음) 전제.
 *
 * 설정 파일: DATA_DIR/auth.json (레포·이미지에 절대 포함되지 않는 데이터 볼륨)
 *   {
 *     session_secret,                     // 서버가 처음 뜰 때 자동 생성
 *     username, pass_salt, pass_hash,     // 비밀번호 로그인 (scrypt) — setup-auth.mjs 로 설정
 *     pass_n, pass_r, pass_p,             // scrypt 코스트 (없으면 구버전 기본값)
 *     google_client_id, google_client_secret, allowed_email,  // 구글 OAuth — 선택
 *     google_sub,                         // 최초 로그인 시 고정되는 구글 계정 고유 ID
 *     site_origin                         // OAuth redirect 기준 주소 (호스트헤더 신뢰 안 함)
 *   }
 *
 * 세션: HMAC 서명된 무상태 쿠키 (저장소 없음 → 재배포에도 로그인 유지).
 *   서명 키를 비밀번호 해시로부터 파생하므로, 비밀번호를 바꾸면 기존 세션이 전부 무효가 된다.
 */
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, statSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';

const scrypt = promisify(scryptCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUTH_FILE = path.join(dataDir, 'auth.json');

const SESSION_COOKIE = 'voca_sess';
const STATE_COOKIE = 'voca_oauth_state';
const SESSION_DAYS = 30;
const RENEW_BEFORE_DAYS = 15; // 남은 기간이 이보다 짧으면 재발급(슬라이딩)
const ABSOLUTE_MAX_DAYS = 180; // 최초 발급 후 이 기간이 지나면 갱신 불가 → 재로그인
const PROD = process.env.NODE_ENV === 'production';

// scrypt 코스트 — 컨테이너 메모리(512MB)와 로그인 지연 사이의 절충
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };
const PASSWORD_MAX = 200; // 과도한 입력으로 CPU 소모시키지 못하게

// ---------- 설정 로드 (파일 mtime 캐시 — setup 스크립트 실행 시 재시작 없이 반영) ----------

let cache = { mtime: 0, cfg: null };

/** 원자적 저장 — 쓰다가 죽어도 기존 파일이 남아 있게 */
function saveConfig(cfg) {
  const tmp = `${AUTH_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, AUTH_FILE);
  try {
    chmodSync(AUTH_FILE, 0o600); // 기존 파일이 있었을 때도 권한을 좁힌다
  } catch {
    /* 파일시스템이 권한을 지원하지 않으면 무시 */
  }
}

function loadConfig() {
  let mtime;
  try {
    mtime = statSync(AUTH_FILE).mtimeMs;
  } catch (err) {
    // 진짜 '파일 없음'일 때만 새로 만든다. 권한·IO 오류로 계정을 덮어쓰면 안 된다.
    if (err.code !== 'ENOENT') throw err;
    const cfg = { session_secret: randomBytes(32).toString('hex') };
    saveConfig(cfg);
    cache = { mtime: statSync(AUTH_FILE).mtimeMs, cfg };
    return cfg;
  }
  if (cache.cfg && cache.mtime === mtime) return cache.cfg;
  const cfg = JSON.parse(readFileSync(AUTH_FILE, 'utf8')); // 손상 시 500 — 조용히 덮어쓰지 않는다
  if (!cfg.session_secret) {
    cfg.session_secret = randomBytes(32).toString('hex');
    saveConfig(cfg);
  }
  cache = { mtime: statSync(AUTH_FILE).mtimeMs, cfg };
  return cfg;
}

const hasPassword = (cfg) => !!(cfg.username && cfg.pass_salt && cfg.pass_hash);
const hasGoogle = (cfg) =>
  !!(cfg.google_client_id && cfg.google_client_secret && cfg.allowed_email);

// ---------- 비밀번호 (scrypt, 비동기) ----------

/** 동시 실행 상한 — 인증 전 경로가 이벤트 루프/메모리를 독점하지 못하게 */
let scryptRunning = 0;
const SCRYPT_MAX_CONCURRENT = 2;

async function derive(password, salt, params) {
  const p = { N: params?.N ?? 16384, r: params?.r ?? 8, p: params?.p ?? 1 };
  return scrypt(password, salt, 64, { ...p, maxmem: SCRYPT.maxmem });
}

// 아이디가 틀려도 같은 비용이 들도록 쓰는 더미 (타이밍으로 아이디 유추 방지)
const DUMMY_SALT = randomBytes(16).toString('hex');

async function verifyPassword(cfg, username, password) {
  const target = hasPassword(cfg) && username === cfg.username ? cfg : null;
  const salt = target ? target.pass_salt : DUMMY_SALT;
  const params = target
    ? { N: target.pass_n, r: target.pass_r, p: target.pass_p }
    : { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
  const actual = await derive(password, salt, params);
  if (!target) return false;
  const expected = Buffer.from(target.pass_hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- 세션 토큰 (발급시각.만료시각.서명) ----------

/**
 * 서명 키를 session_secret + 현재 비밀번호 해시로부터 파생한다.
 * → 비밀번호를 바꾸면 기존에 발급된 모든 세션이 자동으로 무효가 된다.
 */
function signingKey(cfg) {
  return createHmac('sha256', cfg.session_secret)
    .update(`v1|${cfg.pass_hash || ''}|${cfg.google_sub || ''}`)
    .digest();
}

function sign(value, cfg) {
  return createHmac('sha256', signingKey(cfg)).update(value).digest('base64url');
}

function issueSession(cfg, issuedAt = Date.now()) {
  const body = `${issuedAt}.${issuedAt + SESSION_DAYS * 86400000}`;
  return `${body}.${sign(body, cfg)}`;
}

function checkSession(cfg, token) {
  if (!token || typeof token !== 'string') return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false };
  const [iatStr, expStr, sig] = parts;
  const body = `${iatStr}.${expStr}`;
  const expected = sign(body, cfg);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };

  const iat = Number(iatStr);
  const exp = Number(expStr);
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return { ok: false };
  const now = Date.now();
  if (now >= exp) return { ok: false };
  // 발급 후 절대 상한을 넘긴 토큰은 더 이상 인정하지 않는다 (탈취 토큰 영구화 방지)
  if (now - iat > ABSOLUTE_MAX_DAYS * 86400000) return { ok: false };
  return { ok: true, iat, renew: exp - now < RENEW_BEFORE_DAYS * 86400000 };
}

// ---------- 쿠키 ----------

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value; // 잘못 인코딩된 쿠키 하나로 요청 전체가 죽지 않게
    }
  }
  return out;
}

function cookieStr(name, value, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (PROD) parts.push('Secure');
  if (maxAgeSec != null) parts.push(`Max-Age=${maxAgeSec}`);
  return parts.join('; ');
}

function setSession(res, token) {
  res.append('Set-Cookie', cookieStr(SESSION_COOKIE, token, SESSION_DAYS * 86400));
}

function clearCookie(res, name) {
  res.append('Set-Cookie', cookieStr(name, '', 0));
}

// ---------- 로그인 시도 제한 ----------
//
// 버킷을 둘로 나눈다:
//   password — IP당 비밀번호 추측 (실패 5회/15분)
//   oauth    — IP당 구글 콜백 오류 (실패 10회/15분)
// 콜백은 인증 없이 아무나 때릴 수 있으므로, 이걸로 비밀번호 로그인까지 잠기면 안 된다.
// 여기에 더해 "비밀번호 실패 총량" 전역 상한을 둬서 분산 무차별 대입도 늦춘다.

const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { password: 5, oauth: 10 };
const MAX_TRACKED_IPS = 5000; // 메모리 소진 방지
const GLOBAL_FAIL_MAX = 50; // 15분간 전체 비밀번호 실패 상한

const buckets = { password: new Map(), oauth: new Map() };
let globalFails = { count: 0, first: Date.now() };

function limited(kind, ip) {
  if (kind === 'password') {
    if (Date.now() - globalFails.first > WINDOW_MS) globalFails = { count: 0, first: Date.now() };
    if (globalFails.count >= GLOBAL_FAIL_MAX) return true;
  }
  const m = buckets[kind];
  const a = m.get(ip);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    m.delete(ip);
    return false;
  }
  return a.fails >= LIMITS[kind];
}

function recordFail(kind, ip) {
  const m = buckets[kind];
  // 추적 대상이 너무 많아지면 가장 오래된 항목부터 버린다 (Map은 삽입 순서 유지)
  if (m.size >= MAX_TRACKED_IPS && !m.has(ip)) {
    const oldest = m.keys().next().value;
    if (oldest !== undefined) m.delete(oldest);
  }
  const a = m.get(ip);
  if (!a || Date.now() - a.first > WINDOW_MS) m.set(ip, { fails: 1, first: Date.now() });
  else a.fails += 1;

  if (kind === 'password') {
    if (Date.now() - globalFails.first > WINDOW_MS) globalFails = { count: 0, first: Date.now() };
    globalFails.count += 1;
  }
}

const clearFails = (kind, ip) => buckets[kind].delete(ip);

setInterval(() => {
  const now = Date.now();
  for (const m of Object.values(buckets)) {
    for (const [ip, a] of m) if (now - a.first > WINDOW_MS) m.delete(ip);
  }
}, WINDOW_MS).unref();

// ---------- 구글 OAuth (authorization code flow, 전부 서버사이드) ----------

function googleAuthUrl(cfg, state) {
  const p = new URLSearchParams({
    client_id: cfg.google_client_id,
    redirect_uri: `${cfg.site_origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/**
 * code → id_token 교환 후 신원 확인.
 * id_token은 구글 토큰 엔드포인트에서 TLS로 직접 받으므로 서명 재검증은 불필요(구글 공식 문서 기준).
 * 대신 iss/aud/exp/email_verified/email 을 모두 확인하고, 최초 로그인 때 sub(계정 고유 ID)를
 * 고정해 두었다가 이후에는 sub 일치까지 요구한다 (이메일 재사용/도메인 인수 대비).
 */
async function verifyGoogleCode(cfg, code) {
  let r;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.google_client_id,
        client_secret: cfg.google_client_secret,
        redirect_uri: `${cfg.site_origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { ok: false, reason: 'google_error' };
  }
  if (!r.ok) {
    await r.body?.cancel().catch(() => {}); // 소켓 정리
    return { ok: false, reason: 'token_exchange' };
  }
  const { id_token } = await r.json().catch(() => ({}));
  if (!id_token) return { ok: false, reason: 'no_id_token' };

  let claims;
  try {
    claims = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_token' };
  }
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  const audOk = claims.aud === cfg.google_client_id;
  const expOk = Number(claims.exp) * 1000 > Date.now();
  if (!issOk || !audOk || !expOk) return { ok: false, reason: 'bad_claims' };

  const emailOk =
    claims.email_verified === true &&
    String(claims.email ?? '').toLowerCase() === String(cfg.allowed_email).toLowerCase();
  if (!emailOk) return { ok: false, reason: 'email_not_allowed' };
  if (!claims.sub) return { ok: false, reason: 'bad_claims' };
  if (cfg.google_sub && cfg.google_sub !== claims.sub)
    return { ok: false, reason: 'email_not_allowed' };

  return { ok: true, sub: claims.sub };
}

// ---------- 미들웨어 ----------

/** /api 전체 보호 (auth/health 예외는 index.js 배선에서 처리) */
export function requireAuth(req, res, next) {
  const cfg = loadConfig();
  const s = checkSession(cfg, parseCookies(req)[SESSION_COOKIE]);
  if (!s.ok) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (s.renew) setSession(res, issueSession(cfg, s.iat)); // 발급시각은 유지 → 절대 상한이 살아있음
  res.set('Cache-Control', 'no-store'); // 개인 데이터가 캐시·프록시에 남지 않게
  next();
}

/** 상태 변경 요청은 같은 출처에서만 (CSRF 보강 — SameSite=Lax에 더한 이중 장치) */
export function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cfg = loadConfig();
  const allowed = [cfg.site_origin, `http://localhost:${process.env.PORT || 3001}`].filter(Boolean);
  const origin = req.headers.origin;
  if (origin) {
    if (allowed.includes(origin)) return next();
    return res.status(403).json({ error: '허용되지 않은 출처입니다.' });
  }
  // Origin이 없으면 Referer로 한 번 더 확인 (없으면 브라우저 요청이 아니라고 보고 통과)
  const referer = req.headers.referer;
  if (referer) {
    try {
      if (allowed.includes(new URL(referer).origin)) return next();
    } catch {
      /* 형식 오류 */
    }
    return res.status(403).json({ error: '허용되지 않은 출처입니다.' });
  }
  return next();
}

// ---------- 라우터 ----------

export const authRouter = express.Router();

authRouter.get('/me', (req, res) => {
  const cfg = loadConfig();
  const s = checkSession(cfg, parseCookies(req)[SESSION_COOKIE]);
  if (s.ok && s.renew) setSession(res, issueSession(cfg, s.iat));
  res.set('Cache-Control', 'no-store');
  res.json({
    authed: s.ok,
    password_login: hasPassword(cfg),
    google_login: hasGoogle(cfg),
  });
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const cfg = loadConfig();
    res.set('Cache-Control', 'no-store');
    if (!hasPassword(cfg))
      return res
        .status(503)
        .json({ error: '아직 계정이 설정되지 않았어요. 서버에서 setup-auth를 실행해 주세요.' });

    const ip = req.ip || 'unknown';
    if (limited('password', ip))
      return res
        .status(429)
        .json({ error: '실패가 잦아 잠시 막았어요. 15분 뒤에 다시 시도해 주세요.' });
    if (scryptRunning >= SCRYPT_MAX_CONCURRENT)
      return res.status(503).json({ error: '잠시 혼잡해요. 곧 다시 시도해 주세요.' });

    const username = String(req.body?.username ?? '').slice(0, PASSWORD_MAX);
    const password = String(req.body?.password ?? '');
    if (password.length > PASSWORD_MAX) {
      recordFail('password', ip);
      return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않아요.' });
    }

    scryptRunning += 1;
    let ok;
    try {
      ok = await verifyPassword(cfg, username, password);
    } finally {
      scryptRunning -= 1;
    }

    if (!ok) {
      recordFail('password', ip);
      return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않아요.' });
    }
    clearFails('password', ip);
    setSession(res, issueSession(cfg));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req, res) => {
  clearCookie(res, SESSION_COOKIE);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

authRouter.get('/google/start', (req, res) => {
  const cfg = loadConfig();
  if (!hasGoogle(cfg)) return res.status(503).send('구글 로그인이 설정되지 않았어요.');
  const state = randomBytes(16).toString('hex');
  res.append('Set-Cookie', cookieStr(STATE_COOKIE, state, 600));
  res.set('Cache-Control', 'no-store');
  res.redirect(googleAuthUrl(cfg, state));
});

authRouter.get('/google/callback', async (req, res, next) => {
  try {
    const cfg = loadConfig();
    clearCookie(res, STATE_COOKIE);
    res.set('Cache-Control', 'no-store');
    const fail = (reason) => res.redirect(`/?login_error=${encodeURIComponent(reason)}`);

    if (!hasGoogle(cfg)) return fail('not_configured');
    const ip = req.ip || 'unknown';
    if (limited('oauth', ip)) return fail('rate_limited');

    const { code, state } = req.query;
    const cookieState = parseCookies(req)[STATE_COOKIE];
    if (
      typeof code !== 'string' ||
      typeof state !== 'string' ||
      !cookieState ||
      state.length !== cookieState.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))
    ) {
      recordFail('oauth', ip);
      return fail('state_mismatch');
    }

    const v = await verifyGoogleCode(cfg, code);
    if (!v.ok) {
      recordFail('oauth', ip);
      return fail(v.reason);
    }

    // 최초 성공 시 구글 계정 고유 ID를 고정 저장
    if (!cfg.google_sub) {
      cfg.google_sub = v.sub;
      saveConfig(cfg);
      cache = { mtime: statSync(AUTH_FILE).mtimeMs, cfg };
    }

    clearFails('oauth', ip);
    setSession(res, issueSession(cfg));
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// setup-auth.mjs 가 같은 코스트를 쓰도록 공유
export const SCRYPT_PARAMS = SCRYPT;
