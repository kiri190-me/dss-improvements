/**
 * DSS 통합 로그인 포털(dss-auth)과 이야기하는 유일한 파일.
 *
 * OIDC 를 여기에만 가둔다 — 화면·서버 액션·라우트 어디에서도 포털의 주소나
 * 토큰 형식을 알지 못하게 한다. 나중에 포털이 바뀌어도 고칠 곳은 여기다.
 *
 * 이 사이트는 자체 로그인을 만들지 않는다. 포털이 신원을 확인하고, 여기서는
 * 그 결과(ID 토큰)를 검증해 자기 세션(improvements_session)을 발급할 뿐이다.
 *
 * ⚠️ 이 파일의 절차는 A/S 시스템(RF_Service_System/src/app/api/auth/sso/ 와
 *    src/lib/config/sso.ts)과 계측기 시스템(njlee/src/lib/auth/oidc.ts)의 것과
 *    **같다.** 셋 다 같은 포털에 붙고 같은 함정을 이미 밟았다. 한쪽에서
 *    프로토콜 쪽을 고치면 나머지도 함께 봐야 한다.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { createRemoteJWKSet, jwtVerify } from "jose";

import type { NotificationBellItem } from "@dss/ui";
import { env } from "@/lib/env";

/* ------------------------------------------------------------------ */
/* 로그인 왕복 동안 들고 있어야 하는 값                                  */
/* ------------------------------------------------------------------ */

/** 포털의 dss_sso 와도, 이 사이트의 improvements_session 과도 겹치지 않는 이름. */
export const SSO_TX_COOKIE = "improvements_sso_tx";

/**
 * 이 쿠키는 로그인 왕복에서만 쓰인다. 경로를 좁혀 두면 나머지 요청에
 * 딸려 나가지 않는다.
 */
export const SSO_TX_COOKIE_PATH = "/api/auth/sso";

/**
 * 10분. 카카오 동의 화면에서 잠시 망설일 만큼은 되고, 중간에 그만둔 시도가
 * 오래 살아 있지는 않을 만큼 짧다.
 */
export const SSO_TX_MAX_AGE_SECONDS = 600;

export type SsoTransaction = {
  /** 남의 로그인 응답이 이 브라우저에 떨어지는 것을 막는다. */
  state: string;
  /** 예전 ID 토큰을 다시 들이미는 것을 막는다. */
  nonce: string;
  /** PKCE. 이 값은 이 서버 밖으로 나가지 않으므로 인가 코드만으로는 쓸모가 없다. */
  codeVerifier: string;
  /** 로그인 후 돌아갈 이 사이트 안의 경로. */
  returnTo: string;
  /** 유닉스 초. 쿠키의 Max-Age 는 브라우저의 호의일 뿐이라 값으로도 확인한다. */
  expiresAt: number;
};

/* ------------------------------------------------------------------ */
/* 왕복 쿠키 서명                                                       */
/*                                                                     */
/* 서명이 곧 PKCE 다 — 서명이 없으면 브라우저가 code_verifier 를 제 손으로 */
/* 바꿔 끼울 수 있어 PKCE 가 무의미해진다.                               */
/* ------------------------------------------------------------------ */

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function sealTransaction(tx: SsoTransaction): string {
  const payload = Buffer.from(JSON.stringify(tx), "utf8").toString("base64url");
  return `${payload}.${sign(payload, env.ssoTxSecret)}`;
}

/** 서명이 맞고 만료되지 않았을 때만 값을 돌려준다. 아니면 null. */
export function openTransaction(raw: string | undefined): SsoTransaction | null {
  if (!raw) return null;

  const dot = raw.indexOf(".");
  if (dot <= 0) return null;

  const payload = raw.slice(0, dot);
  const presented = raw.slice(dot + 1);
  const expected = sign(payload, env.ssoTxSecret);

  // 문자열 비교는 앞에서부터 다른 지점까지의 시간이 달라, 서명을 한 글자씩
  // 알아내는 공격이 이론상 가능하다. 길이가 다르면 timingSafeEqual 이 던지므로
  // 먼저 본다.
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const tx = parsed as Record<string, unknown>;
  if (
    typeof tx.state !== "string" ||
    typeof tx.nonce !== "string" ||
    typeof tx.codeVerifier !== "string" ||
    typeof tx.returnTo !== "string" ||
    typeof tx.expiresAt !== "number"
  ) {
    return null;
  }

  if (tx.expiresAt <= Math.floor(Date.now() / 1000)) return null;

  return tx as SsoTransaction;
}

/* ------------------------------------------------------------------ */
/* 1단계 — 포털로 보낸다                                                */
/* ------------------------------------------------------------------ */

/**
 * 세 값을 새로 만든다. 각각 다른 구멍을 막는다.
 *   state         로그인 CSRF (남의 로그인 응답이 내 브라우저에 떨어지는 것)
 *   nonce         ID 토큰 재사용 (예전 토큰을 다시 들이미는 것)
 *   codeVerifier  인가 코드 가로채기 (코드만으로는 토큰을 못 받게)
 */
export function beginLogin(returnTo: string): {
  authorizeUrl: string;
  transaction: SsoTransaction;
} {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  // 64바이트 → base64url 86자. RFC 7636 이 정한 43~128자 안이다.
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");

  const url = new URL(`${env.ssoIssuer}/api/oidc/authorize`);
  url.search = new URLSearchParams({
    client_id: env.ssoClientId,
    redirect_uri: env.ssoRedirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();

  return {
    authorizeUrl: url.href,
    transaction: {
      state,
      nonce,
      codeVerifier,
      returnTo,
      expiresAt: Math.floor(Date.now() / 1000) + SSO_TX_MAX_AGE_SECONDS,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 2단계 — 인가 코드를 ID 토큰으로 바꾼다 (서버 대 서버)                 */
/* ------------------------------------------------------------------ */

/** 실패는 전부 null 이다. 이유는 서버 로그에만 남긴다. */
export async function exchangeCodeForIdToken(
  code: string,
  codeVerifier: string,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${env.ssoIssuer}/api/oidc/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        // /authorize 에 보낸 값과 문자 단위로 같아야 한다.
        redirect_uri: env.ssoRedirectUri,
        code_verifier: codeVerifier,
        client_id: env.ssoClientId,
        client_secret: env.ssoClientSecret,
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[sso] 포털에 연결할 수 없습니다:", error);
    return null;
  }

  if (!response.ok) {
    // 포털의 오류 본문은 내부 설정을 설명할 수 있다. 화면에는 내보내지 않는다.
    console.error("[sso] 토큰 교환 거절:", response.status);
    return null;
  }

  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") {
    console.error("[sso] 응답에 id_token 이 없습니다.");
    return null;
  }
  return body.id_token;
}

/* ------------------------------------------------------------------ */
/* 3단계 — ID 토큰을 검증한다                                           */
/* ------------------------------------------------------------------ */

/**
 * 한 번 만들어 재사용한다 — jose 가 JWKS 캐시·키 교체·재조회 간격을 알아서
 * 처리한다. 요청마다 만들면 포털을 두드리게 되고 그 캐시가 무의미해진다.
 *
 * 지연 생성인 이유: 이 파일을 불러오는 것만으로 SSO_ISSUER 를 요구하면
 * next build 가 환경변수 없이 돌지 못한다(도커 이미지에는 .env 가 없다).
 */
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  jwksCache ??= createRemoteJWKSet(new URL(`${env.ssoIssuer}/.well-known/jwks.json`));
  return jwksCache;
}

export type SsoIdentity = {
  /** 포털의 users.id. 이 사이트가 사람을 잇는 유일한 열쇠다. */
  subject: string;
  /** 화면 표시용. 없을 수 있다. */
  name: string | null;
  /** 카카오에서 이메일은 선택 동의라 없을 수 있다. */
  email: string | null;
  /**
   * 이 시스템에서의 역할. 포털이 지정하지 않았으면 아예 실리지 않는다.
   * "안 왔다" 와 "이상한 값이 왔다" 는 다르게 다뤄야 하므로 unknown 으로 둔다 —
   * 무엇인지 정하는 곳은 sso-login.ts 의 decideRole 한 곳뿐이다.
   */
  role: unknown;
  /**
   * 「이 사람이 들어갈 수 있는 사내 시스템 목록」(포털의 dss_services 클레임).
   * 머리말 **안**의 서비스 메뉴바가 그릴 값이고, **권한 판정에는 쓰지 않는다** —
   * 이 시스템에 들어올 수 있는지는 위 role 하나로만 정한다.
   *
   * role 과 같은 이유로 unknown 이다: 무엇을 그릴 수 있는 값으로 칠지는
   * service-menu-cookie.ts(와 @dss/ui 의 normalizeServiceMenu) 한 곳이 정한다.
   *
   * 🔴 포털의 그 기능은 아직 배포되지 않았다 — 지금은 **없을 수 있고**,
   * 없어도 로그인은 예전과 똑같이 끝나야 한다(쿠키만 안 구워진다).
   */
  services: unknown;
};

export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<SsoIdentity | null> {
  try {
    const { payload } = await jwtVerify(idToken, jwks(), {
      issuer: env.ssoIssuer,
      audience: env.ssoClientId,
      // 이 PC 와 포털의 시계 차이 몇 초를 흡수한다. 그 이상은 맞춰야 할
      // 시계지 감싸 줄 일이 아니다.
      clockTolerance: 30,
    });

    // jwtVerify 는 서명·iss·aud·exp 까지만 본다. nonce 는 따로 봐야 한다.
    // 건너뛰면 예전 ID 토큰을 다시 들이미는 길이 열린 채로 남는다.
    if (payload.nonce !== expectedNonce) {
      console.error("[sso] nonce 가 일치하지 않습니다.");
      return null;
    }
    if (typeof payload.sub !== "string" || payload.sub === "") {
      console.error("[sso] id_token 에 sub 가 없습니다.");
      return null;
    }

    return {
      subject: payload.sub,
      name: typeof payload.name === "string" ? payload.name : null,
      email: typeof payload.email === "string" ? payload.email : null,
      role: payload.role,
      // 위 sub 와 **같은 서명 · 발급자 · 수신자 보증을 받은** payload 에서
      // 꺼낸다. 검증이 실패하면 아래 catch 로 빠져 null 이 나가므로, 이
      // 클레임이 검증 없이 밖으로 새어 나갈 길은 없다.
      services: payload.dss_services,
    };
  } catch (error) {
    console.error("[sso] id_token 검증 실패:", error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 백채널 로그아웃 — 포털이 "이 사람 세션 끊어라" 라고 알려 온다          */
/* ------------------------------------------------------------------ */

/** 규격이 정한 표시. 이것이 없으면 로그아웃 통보가 아니다. */
const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * 이 창구는 인증 없이 누구나 두드릴 수 있다. 그래서 서명 검증이 전부다 —
 * 건너뛰면 아무나 아무 사람이나 로그아웃시킬 수 있는 창구가 된다.
 */
export async function verifyLogoutToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: env.ssoIssuer,
      audience: env.ssoClientId,
      clockTolerance: 30,
    });

    // nonce 가 있으면 ID 토큰이다. 규격이 로그아웃 토큰에 nonce 를 금지하는
    // 이유가 이것이다 — ID 토큰을 여기로 들이밀어 남을 로그아웃시키지
    // 못하게 한다.
    if (payload.nonce !== undefined) {
      console.error("[sso] nonce 가 있는 토큰입니다(ID 토큰일 수 있음).");
      return null;
    }

    const events = payload.events;
    if (
      typeof events !== "object" ||
      events === null ||
      !(LOGOUT_EVENT in (events as Record<string, unknown>))
    ) {
      console.error("[sso] 로그아웃 이벤트 표시가 없습니다.");
      return null;
    }

    if (typeof payload.sub !== "string" || payload.sub === "") {
      console.error("[sso] 로그아웃 토큰에 sub 가 없습니다.");
      return null;
    }
    return payload.sub;
  } catch (error) {
    console.error("[sso] 로그아웃 토큰 검증 실패:", error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 로그아웃 — 포털 세션까지 끝낸다                                       */
/* ------------------------------------------------------------------ */

/**
 * 이 사이트 쿠키만 지우면 포털 세션은 그대로 살아 있다. 그러면 로그아웃한
 * 사람이 로그인 버튼을 한 번 누르는 것만으로, 누구인지 다시 묻지도 않고
 * 그대로 들어온다. 공용 PC 에서는 그것이 곧 로그아웃이 안 된 것이다.
 *
 * post_logout_redirect_uri 를 일부러 붙이지 않는다 — 붙이면 이 사이트의
 * 로그인 화면으로 돌아오는데, 그 화면은 "포털로 가세요" 한 장을 더 거치게
 * 할 뿐이다. 방금 모든 시스템에서 나간 사람이 있어야 할 곳은 포털이다.
 * (포털은 이 값을 지원한다 — 나중에 생각이 바뀌면 등록만 하면 된다.)
 */
export function endSessionUrl(): string {
  return `${env.ssoIssuer}/api/oidc/logout`;
}

/**
 * 포털의 앱 런처 — 이 사람이 쓸 수 있는 다른 사내 시스템으로 가는 곳.
 *
 * 프로토콜 주소가 아니라 사람이 보는 화면이다. 로그아웃과 다르다: 여기로
 * 가도 이 사이트의 세션은 그대로 살아 있어서, 돌아오면 다시 로그인하지 않는다.
 */
export function portalAppsUrl(): string {
  return `${env.ssoIssuer}/apps`;
}

/**
 * 포털에 등록된 이 시스템의 식별자(= ID 토큰의 aud, dss-improvements).
 *
 * 서비스 메뉴바가 「지금 여기」 칸을 눌린 상태로 그리는 데 쓴다. 화면에서
 * env 를 직접 읽지 않고 이 파일을 거치는 이유는 파일 머리말과 같다 —
 * 포털과 이야기하는 값은 여기 한 곳에만 둔다. 이름이 아니라 식별자로
 * 견주는 이유는 @dss/ui 의 types.ts 에 적혀 있다(이름은 사람이 바꾼다).
 */
export function thisServiceId(): string {
  return env.ssoClientId;
}

/* ------------------------------------------------------------------ */
/* 「이 사람의 합쳐진 알림」을 포털에 묻는다                              */
/*                                                                     */
/* 부르는 법과 거절 목록은 dss-auth/docs/사이트-알림-통로.md 에 있다.     */
/* 이 파일에 두는 이유는 파일 머리말과 같다 — 포털 주소와 자격증명을      */
/* 아는 곳은 이 파일 하나다. 화면은 받은 배열을 그릴 뿐이다.             */
/* ------------------------------------------------------------------ */

/**
 * 이 왕복을 얼마나 기다릴지.
 *
 * 🔴 상한이 **반드시** 있어야 한다. 포털이 죽어서 연결이 거절되면 fetch 는
 * 곧바로 실패하지만, 주소가 틀려 응답 없는 곳을 두드리면 기본값으로는
 * 하염없이 기다린다. 이 종은 머리말에 있어 모든 화면에 딸려 오므로, 상한이
 * 없으면 알림 하나 때문에 사이트 전체가 멈춘 것처럼 보인다.
 *
 * 2초인 이유: 포털은 같은 사내망에 있고 30초 캐시까지 들고 있어 정상이라면
 * 수십 ms 다. 2초를 넘겼다는 것은 이미 정상이 아니라는 뜻이다.
 */
const NOTIFICATIONS_TIMEOUT_MS = 2000;

/**
 * 포털이 **다른 시스템들에** 물어 합쳐 준 알림.
 *
 * 🔴 여기에 **이 사이트의 알림은 없다.** 포털은 부른 사이트 자신에게는 묻지
 *    않는다(그쪽 문서 「빠져 있는 것」 절 — 되돌기와 30초 캐시 때문이다).
 *    이 사이트에 자체 알림이 생기면 그때는 `[...내것, ...받은것]` 으로 이어
 *    붙이고 개수도 **더해야** 한다. 지금은 자체 알림이 없어 받은 것이 전부다.
 *
 * 칸 이름이 @dss/ui 의 `NotificationBellItem` 과 글자 하나까지 같아서 받은
 * 배열을 종에 **그대로** 넘긴다 — 그 타입 자체가 포털 응답의 거울이라고
 * 그쪽에 적혀 있다. 여기서 타입을 새로 적지 않고 빌려 오는 이유가 그것이다:
 * 둘 중 하나가 어긋나면 tsc 가 먼저 말해 준다.
 */
export type PortalNotificationFeed = {
  items: NotificationBellItem[];
  /**
   * 배지에 찍을 숫자. 🔴 **포털이 센 값 그대로** 나른다 — 줄 수로 다시 세지
   * 않는다. 세는 규칙은 시스템마다 다르고(A/S 는 같은 대상을 한 번만 센다),
   * 여기서 다시 세면 그 시스템의 종과 이 종이 서로 다른 숫자를 말하게 된다.
   */
  count: number;
  /**
   * 🔴 「한 곳이라도 못 물어봤다」는 표시. **「알림이 없다」와 다른 말이다.**
   * 지금은 화면에 쓰지 않지만(알림이 없는 것과 똑같이 그린다) 값을 버리지는
   * 않는다 — 나중에 「일부를 못 불러왔습니다」를 보여 주기로 하면 여기 있다.
   */
  degraded: boolean;
};

/**
 * 못 물어봤을 때의 답. 🔴 **던지지 않는다** — 알림 하나 때문에 머리말이,
 * 곧 사이트 전체가 깨지는 일은 없어야 한다(그쪽 문서: 사이트는 거절을 삼킨다).
 */
const UNREACHABLE: PortalNotificationFeed = { items: [], count: 0, degraded: true };

/** 한 줄의 아홉 칸. 하나라도 글자가 아니면 그 줄만 버린다. */
function toBellItem(row: unknown): NotificationBellItem | null {
  if (typeof row !== "object" || row === null) return null;
  const { key, sourceId, sourceName, id, kind, kindLabel, subject, detail, href } =
    row as Record<string, unknown>;
  if (
    typeof key !== "string" ||
    typeof sourceId !== "string" ||
    typeof sourceName !== "string" ||
    typeof id !== "string" ||
    typeof kind !== "string" ||
    typeof kindLabel !== "string" ||
    typeof subject !== "string" ||
    typeof detail !== "string" ||
    typeof href !== "string"
  ) {
    return null;
  }
  return { key, sourceId, sourceName, id, kind, kindLabel, subject, detail, href };
}

/**
 * 포털의 답을 그릴 수 있는 모양으로 만든다. **네트워크를 타지 않는 순수
 * 함수라** 시험이 그대로 불러 본다.
 *
 * 왜 한 번 더 보나: 포털은 우리 편이지만 그 답에는 **다른 시스템들이 만든
 * 글자**가 실려 온다. 한 시스템이 이상한 줄을 하나 섞어 보냈다고 머리말이
 * 통째로 깨지면 안 된다 — 그래서 모양이 안 맞는 줄은 **그 줄만** 버린다.
 * (주소가 그릴 수 없는 것이면 @dss/ui 가 또 한 번 거른다.)
 */
export function normalizePortalNotificationFeed(body: unknown): PortalNotificationFeed {
  if (typeof body !== "object" || body === null) return UNREACHABLE;
  const answer = body as Record<string, unknown>;

  const items: NotificationBellItem[] = [];
  if (Array.isArray(answer.items)) {
    for (const row of answer.items) {
      const item = toBellItem(row);
      if (item) items.push(item);
    }
  }

  // 🔴 숫자가 아니면 **0** 이다(줄 수로 대신 세지 않는다 — 위 count 주석).
  // 0 이면 배지만 안 그려지고 목록은 그대로 보인다.
  const count =
    typeof answer.count === "number" && Number.isFinite(answer.count) && answer.count > 0
      ? answer.count
      : 0;

  return { items, count, degraded: answer.degraded === true };
}

/**
 * 포털에 묻는다. 🔴 **어떤 일이 있어도 던지지 않는다** — 포털이 죽었든(503),
 * 우리를 거절했든(401·403), 주소가 틀렸든, 설정이 빠졌든 빈 목록이 나간다.
 *
 * @param subject 포털의 users.id (= ID 토큰의 sub). 이 사이트는 `web_users.authSub`
 *                로 들고 있다. 포털 계정과 이어지지 않은 사람은 물을 수 없다.
 *
 * 🔴 자격증명은 **머리말(Authorization: Basic)** 로만 보낸다. 주소에 실으면
 *    포털이 400 으로 거절하고, 그 값은 이미 접근 로그에 남아 **다시 발급**해야
 *    한다(그쪽 문서). 값은 어떤 로그에도 찍지 않는다.
 */
export async function fetchPortalNotifications(
  subject: string,
): Promise<PortalNotificationFeed> {
  if (!subject) return UNREACHABLE;

  let response: Response;
  try {
    // env 의 getter 는 값이 없으면 던진다 — 그래서 try 안에서 읽는다.
    // 설정이 빠진 것 때문에 머리말이 깨지면 안 된다.
    const credentials = `${encodeURIComponent(env.ssoClientId)}:${encodeURIComponent(
      env.ssoClientSecret,
    )}`;

    response = await fetch(`${env.ssoIssuer}/api/integration/notifications`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ sub: subject }).toString(),
      // 포털의 답은 사람마다 다르고 방금 처리한 일이 바로 빠져야 한다.
      // 포털이 이미 30초 캐시를 들고 있으므로 여기서 또 담아 둘 이유가 없다.
      cache: "no-store",
      signal: AbortSignal.timeout(NOTIFICATIONS_TIMEOUT_MS),
    });
  } catch (error) {
    // 🔴 찍는 것은 오류의 **종류**뿐이다(TimeoutError·TypeError …).
    console.error(
      "[sso] 알림을 물어보지 못했습니다:",
      error instanceof Error ? error.name : "unknown",
    );
    return UNREACHABLE;
  }

  if (!response.ok) {
    // 거절 본문은 포털의 내부 설정을 설명할 수 있다. 상태만 남긴다.
    console.error("[sso] 알림 통로 거절:", response.status);
    return UNREACHABLE;
  }

  try {
    return normalizePortalNotificationFeed(await response.json());
  } catch {
    console.error("[sso] 알림 응답을 읽지 못했습니다.");
    return UNREACHABLE;
  }
}
