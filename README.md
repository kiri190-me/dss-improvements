# DSS 개선요청

사내 시스템과 일하는 방식에 대한 **개선 요청을 모으는 사내 웹사이트**다.
독립된 사이트이고, 사내 통합 로그인(dss-auth)으로 들어온다.

지금은 **뼈대와 로그인까지** 되어 있다. 로그인하면 빈 화면이 뜬다 —
개선요청 기능은 다음 작업이다.

- 규칙과 진행 상황: [CLAUDE.md](./CLAUDE.md)

---

## 한눈에

| | 값 |
|---|---|
| 앱 포트 | **3500** |
| 개발 DB 포트 | **5446** (`dss_improvements_dev`) |
| 포털 clientId | `dss-improvements` |
| 사람에게 보이는 이름 | **DSS 개선요청** |
| 세션 쿠키 | `improvements_session` |

이 PC 의 다른 사이트: A/S 3000 · 통합 로그인 3100 · 회사 홈페이지 3200 ·
계측기 3300 · 시너지 출석부 3400.

### 정해진 것 (2026-09-17)

| | 정한 것 | 왜 |
|---|---|---|
| 공개 범위 | **전 직원 공개** — 포털 등록 때 `--open-to-all` | 개선요청은 누구나 적는 곳이다. 권한을 받아야 적을 수 있으면 아무도 적지 않는다 |
| 데이터베이스 | **이 저장소의 전용 상자(5446)** | 공용 `dss-pg-app`(5442)에는 A/S·계측기의 **실운영 자료**가 들어 있다. 새로 만드는 사이트를 그 인스턴스에 얹지 않는다 |
| 세션 | **서명 토큰** (`AUTH_SESSION_SECRET` 로 서명) | A/S 시스템과 같은 길로 맞춘다. 즉시 끊기는 `web_users.sessions_valid_from` 한 칸이 맡는다 — 근거는 `src/lib/db/schema.ts` 의 「세션 표는 없다」 절 |
| 형상관리 | **`git init` 을 하지 않는다** — 지금은 그냥 폴더다 | 아직 아무도 쓰지 않는 사이트라 되돌릴 이력이 필요하지 않다. 저장소로 만들 시점은 사람이 정한다. 그때까지 `git add`·`commit` 도 하지 않는다 |

---

## 처음 한 번 (설치)

```
npm install
cp .env.example .env.local
```

`.env.local` 에서 채울 것:

| 항목 | 어디서 오나 |
|---|---|
| `DEV_POSTGRES_PASSWORD` | 직접 정한다. 아래 `DATABASE_URL` 의 비밀번호와 같게 |
| `DATABASE_URL` | 위 비밀번호를 끼워 넣는다 |
| `SSO_CLIENT_SECRET` | 포털 등록할 때 **한 번만** 보인다 (아래 절) |
| `SSO_TX_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `AUTH_SESSION_SECRET` | 같은 명령으로 **하나 더** 만든다. `SSO_TX_SECRET` 과 다른 값이어야 한다 |

> `AUTH_SESSION_SECRET` 은 세션 쿠키의 서명 키다. 이 사이트의 세션은 서버에
> 저장되지 않고 쿠키에 담긴 값 자체가 세션이라, 이 키가 새면 누구나 아무
> 사람의 세션이나 만들어 낼 수 있다. 값을 바꾸면 이미 로그인해 있던 사람이
> 전부 다시 로그인한다 — 고장이 아니라 그렇게 만든 것이다.

`SSO_ISSUER` 와 `SSO_REDIRECT_URI` 는 `auto` 그대로 둔다 — 실행할 때 이 기계의
사내망 주소를 찾아 쓴다.

### 데이터베이스

```
npm run db:up        # 개발용 PostgreSQL 컨테이너 (5446)
npm run db:generate  # 스키마 → 마이그레이션 SQL
npm run db:migrate   # 적용 (🔴 사용자 승인 후)
```

> 🔴 **전용 상자(5446)를 쓰기로 정했다** (2026-09-17). 이 PC 의 업무 DB 가
> 2026-09-03 부터 `dss-pg-app`(5442) 하나에 모여 있어 거기에
> `dss_improvements` 를 만드는 길도 있었지만, 그 인스턴스에는 A/S·계측기의
> **실운영 자료**가 들어 있다. 상자 하나를 아끼자고 아직 아무도 쓰지 않는
> 사이트를 그 옆에 붙이지 않는다. 생각이 바뀌면 절차는
> `docker-compose.yml` 머리말에 남겨 두었다 — 그 일은 사람이 한다.

---

## 매일 쓰는 방법

```
npm run dev
```

http://localhost:3500 → 로그인 화면 없이 포털로 넘어갔다가 돌아온다.
**포털(dss-auth, 3100)이 함께 떠 있어야 로그인이 된다.**

같은 사무실의 다른 PC 에서 보려면 `http://<이 PC 의 IP>:3500`.
(윈도우 방화벽에서 3500 포트를 열어야 할 수 있다)

끄기는 `Ctrl+C`. DB 는 `npm run db:down`.

---

## 🔴 포털에 등록하기 (사람이 한다)

이 사이트는 등록되기 전까지 로그인이 **되지 않는다.** 포털은 모르는 client_id 의
요청을 거절한다.

아래는 전부 **dss-auth 저장소에서** 실행한다
(`C:\Users\희만\Desktop\Development\dss-auth`).
포털 DB 가 떠 있어야 한다.

### 1. 클라이언트 등록

```bash
npm run client:register -- \
    --client-id dss-improvements \
    --name "DSS 개선요청" \
    --description "사내 시스템과 일하는 방식에 대한 개선 요청" \
    --redirect-uri 'http://{lan}:3500/api/auth/sso/callback' \
    --redirect-uri 'http://localhost:3500/api/auth/sso/callback' \
    --post-logout-redirect-uri 'http://{lan}:3500/login' \
    --backchannel-logout-uri 'http://{lan}:3500/api/auth/sso/backchannel-logout' \
    --launcher-url 'http://{lan}:3500/' \
    --launcher-icon 💡 \
    --role ADMIN --role MEMBER \
    --open-to-all
```

- **중괄호는 작은따옴표로 감싼다.** 셸이 건드리면 등록값이 깨진다.
- `{lan}` 은 와일드카드가 아니다. 포털이 대조 **직전에** 자기 기계의 실제
  사내망 주소로 펼친 뒤 평소처럼 정확 일치로 비교한다
  (`dss-auth/docs/주소.md`). 주소가 바뀌어도 다시 등록하지 않아도 된다.
- `localhost` 를 하나 더 넣는 이유: 이 PC 에서 `http://localhost:3500` 으로
  열어 볼 때 `{lan}` 이 펼쳐진 값과 문자가 달라 대조에 걸린다.
- 🔴 `--open-to-all` 은 **전 직원 공개**로 두는 뜻이고(`requires_grant=false`),
  **그렇게 하기로 정했다**(2026-09-17). 개선요청은 누구나 적는 곳이다 —
  권한을 받아야 적을 수 있으면 아무도 적지 않는다. 이 줄을 빼면
  권한을 받은 사람만 들어오게 되니, 빼려면 아래 2번으로 한 사람씩 부여해야
  한다(지금은 그 길을 택하지 않았다).
- `--role` 로 등록한 값이 포털 관리 화면의 드롭다운이 되고, 거기서 고른 값이
  ID 토큰의 `role` 클레임이 된다. 이 사이트가 아는 값은 `ADMIN` 과 `MEMBER`
  둘뿐이고, **모르는 값이 오면 로그인을 거절한다.**
- 실행하면 **시크릿이 한 번만** 화면에 뜬다. 그 값을 이 사이트의
  `.env.local` 의 `SSO_CLIENT_SECRET` 에 직접 넣는다. 채팅·이메일로 옮기지
  않는다. 잃어버리면 `--rotate` 로 재발급뿐이다.

### 2. (전 직원 공개로 두지 않았을 때만) 사람에게 권한 주기

```bash
npm run client:grant -- --client dss-improvements --user <이메일 또는 이름> \
    --role ADMIN --by <관리자>
```

`--role` 을 주지 않으면 역할 없이 부여된다. 그러면 이 사이트가 첫 로그인에
`MEMBER` 로 계정을 만든다.

### 3. 이 사이트의 `.env.local` 채우기

| 항목 | 값 |
|---|---|
| `SSO_CLIENT_ID` | `dss-improvements` |
| `SSO_CLIENT_SECRET` | 1번에서 한 번 보인 값 |
| `SSO_ISSUER` | `auto` |
| `SSO_REDIRECT_URI` | `auto` |
| `SSO_TX_SECRET` | 32자 이상 랜덤 |
| `AUTH_SESSION_SECRET` | 32자 이상 랜덤 (`SSO_TX_SECRET` 과 다른 값) |
| `SESSION_COOKIE_SECURE` | `false` (HTTPS 붙이면 `true`) |

### 4. 로그인이 도는지 확인

1. dss-auth 에서 `npm run net:doctor` — 이 기계의 주소와 `{lan}` 이 무엇으로
   펼쳐지는지, 등록값이 무엇과 대조되는지 한 화면에 보인다. ⚠️ 표시가 있으면
   거기부터 고친다.
2. 포털(3100)과 이 사이트(3500)를 둘 다 띄운다.
3. 브라우저에서 http://localhost:3500 — 포털 로그인 화면으로 넘어가야 한다.
4. 로그인하면 돌아와서 **「DSS 개선요청」 머리말과 빈 화면**이 뜬다.
5. 포털의 앱 런처(http://localhost:3100/apps)에 **「DSS 개선요청」 타일**이 보인다.
6. 「로그아웃」을 누르면 포털 로그인 화면으로 간다. 거기서 다시 들어와도
   묻지 않고 통과하면 로그아웃이 덜 된 것이다.

안 되면 보는 곳:

| 증상 | 대개 이것 |
|---|---|
| 포털이 `invalid_client` | client_id 오타, 또는 아직 등록 안 됨 |
| 포털이 `invalid_redirect_uri` | 등록 주소와 `SSO_REDIRECT_URI` 가 글자 단위로 다름 |
| 돌아왔는데 다시 로그인 화면 | `SESSION_COOKIE_SECURE=true` 인데 HTTP 로 접속 중 |
| `/login?error=unknown_role` | 포털이 `ADMIN`·`MEMBER` 가 아닌 역할을 보냄 |
| `/login?error=expired` | 왕복 쿠키 만료(10분) 또는 `SSO_TX_SECRET` 이 바뀜 |
| 콜백에서 500, 로그에 `AUTH_SESSION_SECRET` | 그 값이 비었거나 32자 미만 |
| 어제까지 되던 로그인이 전부 풀림 | `AUTH_SESSION_SECRET` 이 바뀌었다 (그러면 기존 세션은 전부 무효다) |

---

## 주소가 바뀌었을 때

**손댈 곳이 없다.** `SSO_ISSUER`·`SSO_REDIRECT_URI` 가 `auto` 이고 포털 등록값이
`{lan}` 이라, 둘 다 실행할 때 이 기계의 실제 주소를 찾는다.

예외는 둘이다.

- `localhost` 로 따로 등록한 redirect_uri — 포트를 바꾸면 그것은 다시 등록한다.
- HTTPS 로 옮길 때 — `auto` 는 언제나 `http` 를 만든다. 도메인이 생기면
  `SSO_ISSUER` 에 그 도메인을 직접 적고 등록값도 도메인으로 바꾼다.

---

## NAS 로 옮길 때

개발 PC 에서 이미지를 굽고 NAS 로 옮긴다. 절차는 `Dockerfile` 머리말과
`../dss-deploy/runbook/02-이미지-빌드.md`.

⚠️ NAS 안에서는 `auto` 와 `{lan}` 이 컨테이너 자신의 주소(172.17.x.x 같은 것)를
집는다. 리버스 프록시 뒤 도메인을 직접 적어야 한다 — `dss-auth/docs/주소.md` 의
마지막 절에 세 갈래가 정리되어 있다.

이 사이트를 NAS 에 띄우려면 `dss-deploy/nas/docker-compose.nas.yml` 에 서비스가
하나 늘고 DSM 리버스 프록시에 주소가 하나 늘어야 한다. **그 저장소의 일이다.**
