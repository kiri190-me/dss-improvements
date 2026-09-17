/**
 * 로그인 왕복의 시작. 포털(dss-auth)로 사람을 보낸다.
 *
 *   GET /api/auth/sso/start?returnTo=/어디로
 *
 * 여기서 만든 state·nonce·code_verifier 를 서명한 쿠키에 담아 두었다가
 * 돌아왔을 때 대조한다. 무엇이 무엇을 막는지는 lib/auth/oidc.ts 에 적혀 있다.
 */
import { cookies } from "next/headers";

import { safeReturnTo } from "@/lib/auth/guards";
import {
  beginLogin,
  sealTransaction,
  SSO_TX_COOKIE,
  SSO_TX_COOKIE_PATH,
  SSO_TX_MAX_AGE_SECONDS,
} from "@/lib/auth/oidc";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));

  // 이미 들어와 있는 사람을 포털까지 다녀오게 할 이유가 없다.
  if (await getSessionUser()) {
    return new Response(null, { status: 303, headers: { Location: returnTo } });
  }

  const { authorizeUrl, transaction } = beginLogin(returnTo);

  (await cookies()).set(SSO_TX_COOKIE, sealTransaction(transaction), {
    httpOnly: true,
    sameSite: "lax",
    // 사내망 HTTP 단계에서 켜면 쿠키가 저장되지 않아 로그인이 조용히 실패한다.
    secure: env.sessionCookieSecure,
    path: SSO_TX_COOKIE_PATH,
    maxAge: SSO_TX_MAX_AGE_SECONDS,
  });

  return new Response(null, {
    status: 303,
    headers: { Location: authorizeUrl, "cache-control": "no-store" },
  });
}
