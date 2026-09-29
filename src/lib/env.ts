/**
 * 실행 환경 값을 한곳에서 읽는다.
 *
 * 규칙: 비밀값이 없으면 조용히 기본값으로 넘어가지 않고 명확히 throw 한다.
 * 인증에서 "설정이 빠졌는데 그럭저럭 동작하는" 상태가 가장 위험하기 때문이다.
 *
 * getter 로 만든 이유: 모듈을 불러오는 시점이 아니라 실제로 값을 쓰는 시점에
 * 검사하기 위해서다. `next build` 는 각 화면의 서버 모듈을 실제로 불러오는데,
 * 도커 이미지를 구울 때는 .env 가 없다(.dockerignore 가 막는다 — 그게 맞다).
 * 모듈을 읽는 순간 던지면 빌드가 되지 않는다.
 *
 * 이름을 SSO_ 로 맞춘 이유: A/S 관리 시스템(RF_Service_System)과 계측기
 * 시스템(njlee)도 같은 이름을 쓴다. Wi-Fi 가 바뀌어 IP 가 달라지면 세
 * 시스템을 같은 방식으로 고칠 수 있어야 한다.
 */

import { isAutoValue, primaryLanAddress, resolveAutoUrl } from "./lan-address";

/** 포털(dss-auth)의 포트. */
const PORTAL_PORT = 3100;

/**
 * 이 사이트의 포트.
 *
 * 3500 인 이유: 이 개발 PC 에서 A/S 3000 · 통합 로그인 3100 · 회사 홈페이지
 * 3200 · 계측기 3300 · 시너지 출석부 3400 이 이미 쓴다. 로그인 왕복을 보려면
 * 포털과 이 사이트가 **동시에** 떠 있어야 하므로 겹치면 안 된다.
 */
const OWN_PORT = Number(process.env.PORT ?? 3500);

/** 포털에 등록된 이 시스템 redirect_uri 의 경로 부분. */
const SSO_CALLBACK_PATH = "/api/auth/sso/callback";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `환경변수 ${name} 이(가) 설정되지 않았습니다. .env.local 파일을 확인하세요.`,
    );
  }
  return value.trim();
}

function flag(name: string): boolean {
  return process.env[name] === "true";
}

/**
 * redirect_uri 에서 「밖에서 이 사이트에 닿는 주소」만 떼어 낸다.
 *
 * ── 🔴 왜 이 값에서 뽑는가 (2026-09-29 운영에서 실제로 난 일) ────────────
 * 그 전에는 이 기계의 첫 사설 IPv4(primaryLanAddress)로 만들었다. 개발 PC 에서는
 * 192.168.x.x 가 잡혀 맞았지만, NAS 의 도커 안에서는 **도커가 컨테이너에 준
 * 주소**가 잡힌다. 0.2 를 배포한 날 A/S 의 종에 뜬 개선요청 알림의 링크가
 * `http://172.20.0.7:3500/` 이었고, 눌러도 아무 데도 가지 못했다 — 밖에서 닿을
 * 수 없는 주소다. 포털은 「절대 주소이고 http 니까」 그대로 통과시키므로
 * (dss-auth 의 notifications/merge.ts 의 isNavigableHref) **조용히** 틀린 주소가
 * 나간다. 🔴 `auto` 로 되돌리지 않는다.
 *
 * ── 왜 새 환경변수를 두지 않는가 ────────────────────────────────────────
 * SSO_REDIRECT_URI 가 이미 **그 주소**다. 포털이 로그인 끝에 브라우저를 되돌려
 * 보내는 곳이라, 정의상 「밖에서 이 사이트에 닿는 주소」와 같아야 한다. 게다가
 * 포털에 등록된 값과 글자 단위로 같아야 로그인이 된다 — 그러니 따로 관리할 설정이
 * 하나도 늘지 않고, 틀리면 알림이 아니라 **로그인 단계에서 바로** 드러난다.
 * 값을 하나 더 두면 둘이 어긋날 수 있고, 어긋난 쪽이 알림 링크라면 증상은 「다른
 * 사이트의 종에서 누르면 엉뚱한 데로 간다」 하나뿐이라 원인을 찾기 어렵다.
 * 개발의 `auto` 는 저쪽 getter(ssoRedirectUri)가 이미 풀어 준다.
 *
 * 콜백 경로를 떼어 낼 수 없으면 조용히 물러서지 않고 던진다 — 그냥 넘어가면
 * 알림 링크가 `…/api/auth/sso/callback/` 꼴이 된다.
 *
 * (A/S 의 config/sso.ts `getAppBaseUrl` · 휴가의 env.ts `appBaseUrlFrom` 과 같은
 * 판정이다. 세 시스템이 같은 방식으로 자기 주소를 읽는다.)
 */
export function ownBaseUrlFrom(redirectUri: string): string {
  if (!redirectUri.endsWith(SSO_CALLBACK_PATH)) {
    throw new Error(
      `SSO_REDIRECT_URI 는 ${SSO_CALLBACK_PATH} 로 끝나야 합니다 — 이 값에서 이 사이트 자신의 주소도 읽습니다.`,
    );
  }
  return redirectUri.slice(0, -SSO_CALLBACK_PATH.length).replace(/\/+$/, "");
}

export const env = {
  /** PostgreSQL 접속 주소 */
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /**
   * 이 사이트 자신의 주소 앞머리. 뒤에 슬래시를 남기지 않는다.
   * 운영은 `https://improvements.dss21.co.kr`, 개발은 `http://192.168.x.x:3500` 꼴.
   *
   * 무엇에 쓰나: 이 사이트가 만드는 알림의 `href` 를 **절대 주소**로 만드는 데
   * 쓴다. 자기 화면에서는 `/` 만으로도 열리지만, 이 목록은 포털을 거쳐 **다른
   * 시스템의 종**에 실린다 — 포털이 상대경로로 온 줄을 버리기도 하거니와, 남의
   * 화면에 그려지는 링크라 어차피 절대 주소여야 한다
   * (domain/notifications.ts 의 requireAbsoluteBaseUrl).
   *
   * 🔴 **이 기계의 랜 주소로 만들지 않는다.** 그렇게 했다가 2026-09-29 운영에서
   * 도커 내부 주소(`http://172.20.0.7:3500/`)가 나갔다. 까닭과 고친 방식은
   * `ownBaseUrlFrom` 머리말에 적었다.
   *
   * 여기서 던질 수 있다 — SSO_REDIRECT_URI 가 없거나, `auto` 인데 랜/Wi-Fi 가
   * 끊겨 주소를 못 찾거나, 콜백 경로로 끝나지 않을 때다. 알림을 만드는 쪽이
   * 그것을 삼켜 빈 목록으로 돌아간다 — 종 하나 때문에 모든 화면이 죽지
   * 않게(db/queries/notifications.ts).
   */
  get ownBaseUrl(): string {
    return ownBaseUrlFrom(env.ssoRedirectUri);
  },

  /**
   * 세션 쿠키에 secure 를 붙일지.
   *
   * 사내망 HTTP 단계에서 true 로 켜면 브라우저가 쿠키를 저장하지 않아 로그인이
   * **조용히** 실패한다 — 포털까지 다녀와 돌아왔는데 다시 로그인 화면이다.
   * HTTPS 를 붙인 뒤에 true 로 바꾼다.
   */
  get sessionCookieSecure(): boolean {
    return flag("SESSION_COOKIE_SECURE");
  },

  /**
   * 세션 쿠키(서명 토큰)의 서명 키.
   *
   * 이 사이트의 세션은 서버에 저장되지 않는다 — 쿠키에 담긴 값 자체가
   * 세션이고, 이 서명만이 그 값이 우리가 준 것임을 보증한다. 새어 나가면
   * 누구나 아무 사람의 세션이나 만들어 낼 수 있다.
   *
   * 이름을 AUTH_SESSION_SECRET 으로 둔 이유: A/S 시스템(RF_Service_System)이
   * 같은 자리에 같은 이름을 쓴다. 두 사이트가 같은 방식으로 세션을 다루니
   * 이름도 같아야 옮겨 다니며 고칠 수 있다.
   *
   * 32자 검사는 A/S 에는 없고 이 저장소가 더한 것이다 — 바로 위 SSO_TX_SECRET
   * 과 같은 규칙으로 맞춘다. 서명 키가 짧으면 서명이 있으나 마나다.
   *
   * 값을 바꾸면 **이미 나가 있는 세션이 전부 무효가 된다.** 모두 다시
   * 로그인해야 한다는 뜻이지 고장이 아니다.
   */
  get authSessionSecret(): string {
    const secret = required("AUTH_SESSION_SECRET");
    if (secret.length < 32) {
      throw new Error("AUTH_SESSION_SECRET 은 32자 이상이어야 합니다.");
    }
    return secret;
  },

  /** 세션 수명(시간). dss-auth SSO 세션의 절대 만료 12시간을 넘기지 않는다. */
  get sessionHours(): number {
    const raw = process.env.SESSION_HOURS;
    const n = raw ? Number(raw) : 12;
    if (!Number.isFinite(n) || n <= 0 || n > 12) return 12;
    return n;
  },

  /* ---------------------------------------------------------------- */
  /* DSS 통합 로그인 (dss-auth 포털)                                    */
  /* ---------------------------------------------------------------- */

  /**
   * 포털 주소. ID 토큰의 iss 클레임과 문자 단위로 같아야 한다.
   *
   * 끝의 슬래시를 떼는 이유: "http://x/" 와 "http://x" 가 섞이면 iss 대조가
   * 실패하는데, 원인을 찾기가 가장 어려운 종류의 버그다.
   */
  get ssoIssuer(): string {
    // auto 면 이 기계의 사내망 주소로 푼다 — 개발 중에는 포털도 같은 PC 에 있다.
    const raw = required("SSO_ISSUER");
    const resolved = isAutoValue(raw)
      ? resolveAutoUrl(raw, PORTAL_PORT, primaryLanAddress())
      : raw;
    return resolved.replace(/\/+$/, "");
  },

  /** 포털에 등록된 이 시스템의 식별자. ID 토큰의 aud 이기도 하다. */
  get ssoClientId(): string {
    return required("SSO_CLIENT_ID");
  },

  /** 토큰 교환에만 쓴다. 브라우저에 절대 내보내지 않는다. */
  get ssoClientSecret(): string {
    return required("SSO_CLIENT_SECRET");
  },

  /**
   * 포털에 등록한 값과 문자 단위로 같아야 한다.
   *
   * 요청(request.url)에서 만들어 쓰지 않고 환경변수로 두는 이유: LAN 으로
   * 들어온 요청인데도 서버 자신의 바인딩 주소(localhost)가 보이는 경우가
   * A/S 시스템에서 실측되었다. redirect_uri 는 /authorize 와 /token 양쪽에서
   * 문자 단위로 대조되므로, 만들어 쓰면 "어떤 망에서는 되고 어떤 망에서는
   * 안 되는" 형태로 실패한다.
   *
   * auto 는 요청에서 만들어 쓰는 것과 다르다 — 이 기계의 네트워크 인터페이스를
   * 읽으므로 누가 부르든 같은 문자열이 나온다. 위 주석이 배제한 "망에 따라
   * 달라지는" 문제가 생기지 않는다.
   */
  get ssoRedirectUri(): string {
    const raw = required("SSO_REDIRECT_URI");
    if (!isAutoValue(raw)) return raw;
    return `${resolveAutoUrl(raw, OWN_PORT, primaryLanAddress())}${SSO_CALLBACK_PATH}`;
  },

  /**
   * 로그인 왕복 동안 state·nonce·PKCE 검증값을 나르는 쿠키의 서명 키.
   *
   * 이 서명이 곧 PKCE 다 — 서명이 없으면 브라우저가 code_verifier 를 제 손으로
   * 바꿔 끼울 수 있어 PKCE 가 무의미해진다.
   */
  get ssoTxSecret(): string {
    const secret = required("SSO_TX_SECRET");
    if (secret.length < 32) {
      throw new Error("SSO_TX_SECRET 은 32자 이상이어야 합니다.");
    }
    return secret;
  },
};
