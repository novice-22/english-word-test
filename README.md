# 📘 워드테스트 — 영어 단어 암기·시험 웹앱

혼자 쓰려고 만든 영어 단어 학습 사이트입니다. 단어를 넣어두면 **시험을 보고, 틀린 건 잊어버릴 때쯤 다시 물어봅니다.**
PC·모바일 어디서든 되고, 로그인한 사람만 쓸 수 있습니다.

> **단어 데이터는 들어있지 않습니다.** 기능만 있는 껍데기라, 받아서 본인 단어를 채워 쓰시면 됩니다.
> 마음대로 고쳐 쓰셔도 됩니다 (MIT).

## 기능

- **시험 5종** — 뜻 보고 쓰기 · 단어 보고 뜻 쓰기 · 혼합 · 듣고 받아쓰기 · 객관식
- **범위 지정** — 전체 / Day 단위 / 별표한 것만 / 자주 틀리는 것만 + 문제 수 선택
- **간격 반복 복습(SM-2)** — 정답·오답에 따라 단어별 복습 주기를 자동 계산
- **발음 듣기** — 브라우저 내장 TTS (미국식/영국식, 속도 조절)
- **품사 자동 태깅** — 뜻의 어미를 보고 명/동/형/부를 뜻 조각마다 표시
- **시험 일정 관리** — 시험 날짜·접수 마감을 목록/달력으로 보고, 응시할 시험엔 깃발을 꽂아 D-day 표시
- **통계** — 단어장별 진도, 점수 추이, 자주 틀리는 단어
- **로그인** — 비밀번호(scrypt) + 구글 OAuth. 비로그인은 소개 화면만 보임
- 다크/라이트 테마, 모바일 하단 탭 내비게이션

## 빠른 시작

**Node.js 22.5 이상**이 필요합니다 (`node:sqlite` 내장 모듈을 씁니다). 외부 DB는 필요 없습니다.

```bash
git clone <이 저장소>
cd english-word-test

# 1. 의존성 설치 (루트 + server + client)
npm run install:all

# 2. 계정 만들기 — 이걸 해야 로그인할 수 있습니다
node server/setup-auth.mjs

# 3. 실행 (서버 3001 + 프론트 5173)
npm run dev
```

http://localhost:5173 접속 → 2번에서 만든 계정으로 로그인.

> 2번을 건너뛰면 로그인 화면에서 *"아직 계정이 설정되지 않았어요"* 가 뜨고 들어갈 수 없습니다.
> 자세한 내용과 구글 로그인 설정은 [docs/LOGIN_SETUP.md](docs/LOGIN_SETUP.md) 참고.

### 단어 채우기

단어장을 만든 다음, 단어장 화면에서

- **한 개씩** — 영어 단어 / 뜻 / 예문(선택) 입력
- **여러 개 한꺼번에** — `단어 - 뜻` 형식으로 한 줄에 하나씩 붙여넣기 (수백 개도 한 번에)

뜻이 여러 개면 쉼표로 구분하면 됩니다 (`apple - 사과, 사과나무`).

## 커스텀 지점

| 바꾸고 싶은 것 | 어디를 고치면 되나 |
| --- | --- |
| 사이트 이름 | `client/src/App.jsx`, `client/src/pages/LandingPage.jsx`, `client/index.html` — 세 곳의 "워드테스트" |
| 테마 색상 | `client/src/index.css` 의 `--accent` (라이트/다크 각각 한 줄) |
| 시험 종류 | `client/src/pages/ExamsPage.jsx` 의 `TYPES` 배열 — 한국 시험(토익·텝스 등)이 기본값이라 필요에 맞게 교체 |
| Day 묶음 크기 | `client/src/config.js` 의 `CHAPTER_SIZE` (기본 30개) |
| 품사 판정 | `server/pos.js` 의 어미 규칙. 검증 사전을 쓰려면 `server/pos-lexicon.example.js` 를 `pos-lexicon.js` 로 복사해 채우면 규칙보다 우선 적용됨 |

## 기술 스택

| 구분 | 사용 |
| --- | --- |
| 프론트엔드 | React 19 + Vite + react-router 8 |
| 백엔드 | Node.js + Express 5 (의존성 2개: express, cors) |
| DB | SQLite — Node 내장 `node:sqlite`, 별도 설치 불필요 |
| 차트 | SVG 직접 구현 (라이브러리 없음) |
| 배포 | Docker |

## 배포

로컬에서 컨테이너로 띄우기:

```bash
docker compose up -d --build     # 127.0.0.1:3001 에만 바인딩
```

공개 서버에 올릴 때는 리버스 프록시 뒤에 두고 하드닝된 설정을 씁니다 —
[docs/DEPLOY.md](docs/DEPLOY.md)에 Caddy 예시와 환경변수, 백업 방법을 정리해 뒀습니다.

## 프로젝트 구조

```
client/                     React 프론트엔드
  src/
    pages/                  대시보드 · 단어장 · 시험 · 복습 · 통계 · 시험일정 · 랜딩
    components/             아이콘(SVG) · UI 부품 · 차트
    api.js                  백엔드 호출
    auth.jsx                로그인 상태 컨텍스트
    tts.js                  발음 재생 (Web Speech API)
server/
  index.js                  API 라우트 + 정적 파일 서빙
  db.js                     SQLite 스키마 · 마이그레이션 · SM-2
  auth.js                   세션 · 비밀번호 · 구글 OAuth · 로그인 제한
  setup-auth.mjs            계정 설정 CLI
  pos.js                    품사 추론
deploy/
  docker-compose.prod.yml   공개 서버용 (expose-only + 하드닝)
docker-compose.yml          로컬용 (127.0.0.1 바인딩)
```

## API

`/api/auth/*` 와 `/api/health` 를 뺀 나머지는 전부 로그인이 필요합니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/auth/me` | 로그인 상태 · 사용 가능한 로그인 방식 |
| POST | `/api/auth/login` `/api/auth/logout` | 비밀번호 로그인 / 로그아웃 |
| GET | `/api/auth/google/start` `/api/auth/google/callback` | 구글 OAuth |
| GET/POST | `/api/sets` | 단어장 목록(진행률 포함) / 생성 |
| GET/PUT/DELETE | `/api/sets/:id` | 단어장 조회(단어+정답률+SRS) / 수정 / 삭제 |
| GET | `/api/sets/:id/export` | CSV 내보내기 |
| POST | `/api/sets/:id/words` | 단어 추가 (단건/대량) |
| PUT/DELETE | `/api/words/:id` | 단어 수정 / 삭제 |
| PATCH | `/api/words/:id/star` | 별표 토글 |
| GET | `/api/review/due` | 오늘 복습할 단어 |
| POST | `/api/review` | 복습 결과 반영 (SM-2) |
| GET/POST | `/api/results` | 시험 이력 / 결과 저장 |
| GET/DELETE | `/api/results/:id` | 결과 상세 / 삭제 |
| GET | `/api/stats` | 통계 |
| GET/POST | `/api/exams` | 시험 일정 (`?upcoming=1`) / 추가 |
| PUT/DELETE | `/api/exams/:id` | 일정 수정 / 삭제 |
| PATCH | `/api/exams/:id/mine` | "내 시험" 깃발 토글 |
| GET | `/api/health` | 가동 확인 (로그인 불필요) |

## 라이선스

MIT — [LICENSE](LICENSE) 참고.
