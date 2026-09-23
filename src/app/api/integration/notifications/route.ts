import { NextResponse, type NextRequest } from "next/server";

import {
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalServiceToken,
} from "@/lib/auth/portal-service-token";
import { getWebUserByAuthSub } from "@/lib/db/queries/web-users";
import { listOwnNotifications } from "@/lib/db/queries/notifications";
import { env } from "@/lib/env";
import { buildPortalNotificationFeed } from "@/lib/server/integration/portal-notifications";

/**
 * ============================================================================
 * 「이 사람의 지금 알림」을 밖으로 내주는 통로
 * ============================================================================
 * 통합 종이 쓴다 — 포털이 등록된 시스템마다 이 통로에 물어 합친다. 그래야 A/S 든
 * 계측기든 **어느 시스템에서 종을 열어도** 개선요청 알림이 보인다(사용자 요구
 * 2026-09-23: 「모든 시스템에서 종에서 확인하는 것」).
 *
 * 알림을 저장하지 않는 이 사이트의 방식은 그대로 두고 **매 요청마다 계산해
 * 내주기만** 한다 — 목록을 만드는 함수는 화면의 종이 쓰는 그것이다
 * (db/queries/notifications.ts 의 listOwnNotifications).
 *
 * 🔴 대상 사용자는 **토큰 안에서만** 온다. 쿼리 문자열을 읽지 않는다 — 읽으면
 * 토큰 하나로 아무 사람의 알림이나 볼 수 있는 문이 된다.
 *
 * ── 🔴 GET 이다 (POST 가 아니다) ────────────────────────────────────────
 * 규격서(dss-auth/docs/사이트-알림-통로.md)의 POST 는 **반대 방향** — 사이트가
 * 포털에 물을 때의 것이다. 포털이 우리에게 올 때는 GET 으로 온다(실측:
 * dss-auth 의 lib/notifications/gather.ts 의 `method: "GET"`). 읽기뿐이라 GET 이
 * 맞고, 토큰을 쿼리가 아니라 `Authorization` 머리말로 받는 것은 쿼리가 접근
 * 로그에 그대로 남기 때문이다.
 *
 * ⚠️ 포털은 이 왕복을 **1.5초**만 기다린다(그쪽 READ_TIMEOUT_MS). 여기서 하는
 * 일은 질의 둘이다.
 * ============================================================================
 */

/** 🔴 이 응답이 캐시되면 처리된 일이 남의 종에 계속 남는다. */
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const verified = await verifyPortalServiceToken(
      readBearerToken(request.headers.get("authorization")),
      PORTAL_TOKEN_PURPOSES.notificationsRead,
    );
    if (!verified.ok) {
      // 🔴 왜 거절했는지는 밖으로 내보내지 않는다 — 부르는 쪽이 맞혀 가며 두드릴
      //    실마리가 된다. 까닭은 서버 로그에만 남는다(portal-service-token.ts).
      return NextResponse.json(
        { error: "invalid_token" },
        { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } },
      );
    }

    const feed = await buildPortalNotificationFeed({
      subject: verified.subject,
      clientId: env.ssoClientId,
      findActor: getWebUserByAuthSub,
      listNotifications: listOwnNotifications,
    });

    // 🔴 이 시스템에 계정이 없는 사람은 **빈 목록**이다 — 오류가 아니다. 포털은
    //    여러 시스템에 같은 질문을 던지고, 여기 한 번도 안 들어온 사람은 흔하다.
    //    오류를 돌려주면 포털의 종이 그 줄에서 상한 것처럼 보인다.
    return NextResponse.json(feed, { headers: NO_STORE });
  } catch (error) {
    // 환경값이 빠졌거나(env 의 getter 가 던진다) DB 가 멎었다. 안쪽 사정은 내보내지
    // 않고 「지금은 안 된다」로만 답한다 — 포털은 이 줄만 빼고 나머지를 그린다.
    console.error("[integration] 알림 목록을 내주지 못했습니다:", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}
