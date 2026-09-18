/**
 * 포털이 사람을 돌려보내는 곳.
 *
 * 계정을 건드리기 전에 손댈 수 있는 것을 전부 먼저 확인한다 — 왕복 쿠키의
 * 서명과 만료, state 대조, 그다음 ID 토큰의 서명·발급자·수신자·만료·nonce.
 * 그것이 전부 통과한 뒤에야 sub 를 믿고 계정을 찾는다.
 */
import { cookies } from "next/headers";

import {
  exchangeCodeForIdToken,
  openTransaction,
  SSO_TX_COOKIE,
  SSO_TX_COOKIE_PATH,
  verifyIdToken,
} from "@/lib/auth/oidc";
import { writeServiceMenuCookie } from "@/lib/auth/service-menu-cookie";
import { createSession } from "@/lib/auth/session";
import { resolveSsoLogin } from "@/lib/auth/sso-login";
import { env } from "@/lib/env";

/**
 * Location 을 상대경로로 준다.
 *
 * 개발 서버가 request.url 을 자기 바인딩 주소(localhost)로 보고하는 경우가
 * A/S 시스템에서 실측되었다. 절대주소를 만들어 넣으면 폰이나 동료 PC 에서
 * 따라갈 수 없는 주소가 나온다. RFC 9110 에 따라 브라우저가 자기가 부른
 * 주소를 기준으로 상대경로를 푼다.
 */
function redirectTo(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: path, "cache-control": "no-store" },
  });
}

async function clearTransactionCookie(): Promise<void> {
  (await cookies()).set(SSO_TX_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.sessionCookieSecure,
    path: SSO_TX_COOKIE_PATH,
    maxAge: 0,
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const fail = async (reason: string): Promise<Response> => {
    await clearTransactionCookie();
    return redirectTo(`/login?error=${encodeURIComponent(reason)}`);
  };

  // 포털은 자기 쪽 실패를 이렇게 알려 온다 (access_denied, invalid_scope …).
  const upstreamError = params.get("error");
  if (upstreamError) {
    console.error("[sso] 포털이 요청을 거절했습니다:", upstreamError);
    return fail("sso");
  }

  const transaction = openTransaction((await cookies()).get(SSO_TX_COOKIE)?.value);
  if (!transaction) {
    return fail("expired");
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || state !== transaction.state) {
    return fail("state");
  }

  // ── 인가 코드를 ID 토큰으로 (서버 대 서버. 시크릿은 브라우저에 닿지 않는다) ──

  const idToken = await exchangeCodeForIdToken(code, transaction.codeVerifier);
  if (!idToken) return fail("sso");

  const identity = await verifyIdToken(idToken, transaction.nonce);
  if (!identity) return fail("sso");

  // ── 이 사이트의 이용자와 잇는다 ──

  const result = await resolveSsoLogin(identity);
  if (result.outcome === "REJECTED") {
    // 거절 이유마다 사람이 할 수 있는 일이 다르다. 화면에서 다른 문구를
    // 보여주려고 구분해 보낸다. 그 이상 자세히 알리지는 않는다 —
    // 자세히 알리면 이 화면이 "누가 이 시스템 사용자인지" 확인해 주는
    // 조회 도구가 된다.
    if (result.code === "UNKNOWN_ROLE") return fail("unknown_role");
    if (result.code === "INACTIVE") return fail("inactive");
    if (result.code === "DELETED") return fail("deleted");
    return fail("sso");
  }

  // 세션은 서명 토큰 하나다 — 이 줄 뒤에 DB 에 남는 세션 행은 없다.
  // (예전 서버 저장형에서는 여기서 ip·user_agent 도 함께 남겼다.
  //  그 자리가 왜 없어졌는지는 db/schema.ts 의 "세션 표는 없다" 절에 있다.)
  await createSession(result.user);

  // 머리말 **안**의 서비스 메뉴바가 그릴 목록 — **세션과 갈라** 따로 굽는다
  // (auth/service-menu-cookie.ts 의 파일 주석). 포털이 아직 그 클레임을
  // 싣지 않으면 굽지 않고 남아 있던 것을 지운다. 이 줄이 있으나 없으나
  // 로그인은 똑같이 끝난다 — 목록 때문에 거절되는 길은 만들지 않는다.
  await writeServiceMenuCookie(identity.services);

  console.info(
    result.created
      ? `[sso] 첫 로그인으로 계정을 만들었습니다: ${result.user.displayName}`
      : `[sso] 로그인: ${result.user.displayName}`,
  );

  await clearTransactionCookie();
  return redirectTo(transaction.returnTo);
}
