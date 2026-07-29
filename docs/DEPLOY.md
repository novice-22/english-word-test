# 배포

## 로컬에서 컨테이너로 띄우기

```bash
docker compose up -d --build
```

- `127.0.0.1:3001` 에만 바인딩된다 (외부에서 접근 불가)
- 데이터는 `./data` 폴더에 SQLite 파일로 저장된다

## 공개 서버에 올리기

호스트 포트를 직접 열지 말고 **리버스 프록시 뒤에 두는 것을 권한다.** HTTPS와 보안 헤더를 프록시가 맡고,
앱 컨테이너는 포트를 노출하지 않는다.

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

이 설정은 다음이 적용돼 있다.

- `expose` 만 사용 — 호스트 포트 미개방
- 비root 실행(uid 10001), 루트 파일시스템 읽기 전용, `cap_drop: ALL`, `no-new-privileges`
- 메모리 512MB · 프로세스 256개 제한
- 프록시와 같은 도커 네트워크(기본 이름 `web`)에 참여

네트워크가 없으면 먼저 만든다.

```bash
docker network create web
```

### 리버스 프록시 예시 (Caddy)

`Caddyfile`:

```caddy
your-domain.com {
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        -Server
    }

    reverse_proxy voca-app:3001
}
```

Caddy 컨테이너도 같은 `web` 네트워크에 두면 컨테이너 이름(`voca-app`)으로 바로 접근된다.
HTTPS 인증서는 Caddy가 자동으로 발급·갱신한다.

> **CSP를 쓴다면** `index.html` 의 테마 인라인 스크립트 때문에 해시가 필요하다.
> 스크립트를 수정할 때마다 해시가 바뀌므로, 번거로우면 CSP에서 `script-src` 를 빼거나
> 해시를 다시 계산해 넣는다.

### 계정 만들기

배포 후 **반드시** 계정을 설정해야 로그인할 수 있다.

```bash
docker exec -it voca-app node server/setup-auth.mjs
```

자세한 내용은 [LOGIN_SETUP.md](LOGIN_SETUP.md) 참고.

## 환경변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3001` | 서버 포트 |
| `DATA_DIR` | `server/data` (도커에서는 `/app/data`) | SQLite DB와 `auth.json` 이 저장되는 폴더 |
| `NODE_ENV` | — | `production` 이면 세션 쿠키에 `Secure` 플래그가 붙는다. **HTTPS로 서비스한다면 반드시 설정** |
| `ALLOWED_ORIGINS` | (없음) | CORS 허용 출처를 쉼표로 구분. 비워 두면 CORS 헤더를 붙이지 않는다(같은 출처로만 서빙하는 기본 구성에서는 비워 두면 된다) |

## 데이터와 백업

백업할 것은 `data/` 폴더 하나뿐이다.

| 파일 | 내용 |
| --- | --- |
| `vocab.db` | 단어장 · 시험 기록 · 복습 상태 · 시험 일정 |
| `auth.json` | 로그인 계정(비밀번호 해시) · 세션 서명 키 · 구글 OAuth 설정 |

```bash
# 실행 중에도 안전하게 백업 (WAL 모드라 파일 복사만으로는 부족할 수 있음)
docker exec voca-app node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync('/app/data/vocab.db').exec(\"VACUUM INTO '/app/data/backup.db'\")"
```

> `auth.json` 에는 비밀번호 해시와 구글 시크릿이 들어 있다. 백업본도 같은 수준으로 관리할 것.
> 이 파일은 `.gitignore` 에 등록돼 있어 저장소에 올라가지 않는다.

## 업데이트

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

DB 스키마 변경은 서버 시작 시 자동으로 반영된다(`server/db.js` 의 마이그레이션). 데이터는 유지된다.
세션도 유지되므로 재배포 후 다시 로그인할 필요는 없다.
