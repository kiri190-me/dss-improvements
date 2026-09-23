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

export const env = {
  /** PostgreSQL 접속 주소 */
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /**
   * 이 사이트 자신의 주소 앞머리(`http://192.168.1.132:3500` 꼴).
   *
   * 무엇에 쓰나: 이 사이트가 만드는 알림의 `href` 를 **절대 주소**로 만드는 데
   * 쓴다. 자기 화면에서는 `/` 만으로도 열리지만, 이 목록을 포털에 내주게 되면
   * (다음 조각) 포털이 상대경로로 온 줄을 버린다. 계산을 두 번 적지 않으려고
   * 지금부터 절대 주소로 만든다(domain/notifications.ts 의 requireAbsoluteBaseUrl).
   *
   * 🔴 `ssoRedirectUri` 에서 콜백 경로를 떼어 쓰지 않는다. 그 값은 **포털에 등록된
   * 글자**라 우리 사정으로 잘라 쓰면, 등록값을 도메인으로 바꾸는 날 알림 주소가
   * 말없이 따라 바뀐다(또는 경로가 달라 엉뚱하게 잘린다). 두 값은 서로 다른
   * 이유로 정해지므로 서로를 재료로 삼지 않는다.
   *
   * 환경변수를 두지 않고 매번 찾는 이유는 `ssoRedirectUri` 의 auto 와 같다 —
   * 개발 PC 도 NAS 도 주소를 DHCP 로 받고, 적어 두면 주소가 바뀔 때마다 고칠 곳이
   * 늘어난다. 🔴 나중에 이 사이트가 도메인 뒤에 서면(HTTPS·리버스 프록시) 이
   * 기계는 밖에서 보이는 이름을 알 수 없다 — 그때 고칠 곳은 **이 getter 하나**다.
   *
   * 랜/Wi-Fi 가 끊겨 주소를 못 찾으면 던진다(primaryLanAddress). 알림을 만드는
   * 쪽이 그것을 삼켜 빈 목록으로 돌아간다 — 종 하나 때문에 모든 화면이 죽지
   * 않게(db/queries/notifications.ts).
   */
  get ownBaseUrl(): string {
    return resolveAutoUrl("auto", OWN_PORT, primaryLanAddress());
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
