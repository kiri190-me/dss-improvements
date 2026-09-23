import { NextResponse, type NextRequest } from "next/server";

import {
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalServiceToken,
  type PortalTokenPurpose,
  type PortalTokenResult,
} from "@/lib/auth/portal-service-token";
import { getWebUserByAuthSub } from "@/lib/db/queries/web-users";
import {
  readPortalNotificationSettings,
  writePortalNotificationSettings,
} from "@/lib/server/integration/portal-notifications";

/**
 * ============================================================================
 * 알림 설정을 밖에서 읽고 쓰는 통로
 * ============================================================================
 * ── 🔴 왜 이 통로가 있어야 하나 ─────────────────────────────────────────
 * 포털에 한 줄을 등록하면 포털 관리자 화면이 알림 목록과 **알림 설정을 함께**
 * 물으러 온다. 이 통로가 없으면 404 가 나고 그 시스템이 「지금은 불러올 수
 * 없습니다」로 그려진다 — 고장이 아닌데 화면이 상한 것처럼 보인다.
 *
 * ── 🔴 이 시스템의 설정은 **읽기 전용**이다 ─────────────────────────────
 * 설정을 저장할 표가 없고 이번 조각은 스키마를 건드리지 않는다. 그래서
 *  · `GET` 은 **코드에 있는 규칙을 그대로 옮겨 적은 표**를 내준다 — 종류 하나
 *    (`IMPROVEMENT_REQUEST`), 받는 사람은 ADMIN, 모든 칸이 `editable: false`.
 *  · `PUT` 은 **403 으로 분명히 거절**하고 까닭을 문장으로 보낸다. 200 으로
 *    받아들이고 아무것도 안 바꾸면, 포털 관리자가 스위치를 눌러 「저장됨」을 본 뒤
 *    화면을 다시 열었을 때 값이 되돌아 있다 — **눌렀는데 아무 일도 일어나지
 *    않는** 쪽이 훨씬 나쁘다. 포털은 403 을 **정상 응답**으로 다루고(degraded 로
 *    세지 않는다) 우리가 보낸 문장을 그 자리에 그린다.
 * 판단의 전부와 고칠 자리는 server/integration/portal-notifications.ts 에 있다.
 *
 * ── 🔴 403 의 까닭을 구분해 주지 않는다 ─────────────────────────────────
 * 「이 시스템에 계정이 없다」·「정지됐다」·「관리자가 아니다」가 **같은 본문**이다.
 * 구분해 주면 토큰 하나 구울 수 있는 쪽이 사람 목록과 각자의 권한을 알아낼 수 있다.
 * (저장 거절만 다른 문장인데, 그것은 **관문을 통과한 관리자에게만** 간다.)
 *
 * 쓰기가 PUT 인 것은 포털이 PUT 으로 보내기 때문이다(실측: dss-auth 의
 * gather.ts 의 pushNotificationSettings).
 * ============================================================================
 */

const NO_STORE = { "cache-control": "no-store" };

function invalidToken() {
  return NextResponse.json(
    { error: "invalid_token" },
    { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } },
  );
}

function temporarilyUnavailable(error: unknown) {
  console.error("[integration] 알림 설정 통로가 실패했습니다:", {
    name: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    { error: "temporarily_unavailable" },
    { status: 503, headers: NO_STORE },
  );
}

/** 두 메서드가 같은 순서로 같은 것을 확인한다 — 한쪽만 느슨해지지 않게 묶어 둔다. */
async function authenticate(
  request: NextRequest,
  purpose: PortalTokenPurpose,
): Promise<PortalTokenResult> {
  return verifyPortalServiceToken(readBearerToken(request.headers.get("authorization")), purpose);
}

export async function GET(request: NextRequest) {
  try {
    const verified = await authenticate(request, PORTAL_TOKEN_PURPOSES.notificationSettingsRead);
    if (!verified.ok) return invalidToken();

    const result = await readPortalNotificationSettings({
      subject: verified.subject,
      findActor: getWebUserByAuthSub,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "forbidden", message: result.message },
        { status: result.status, headers: NO_STORE },
      );
    }
    return NextResponse.json(result.value, { headers: NO_STORE });
  } catch (error) {
    return temporarilyUnavailable(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const verified = await authenticate(request, PORTAL_TOKEN_PURPOSES.notificationSettingsWrite);
    if (!verified.ok) return invalidToken();

    // 🔴 본문을 읽지 않는다. 어떤 값이 와도 저장하지 않으므로, 모양을 따져 400 을
    //    돌려주면 「모양만 맞추면 저장된다」는 거짓 신호를 준다. 답은 하나다 —
    //    이 시스템은 설정을 바꿀 수 없다.
    const result = await writePortalNotificationSettings({
      subject: verified.subject,
      findActor: getWebUserByAuthSub,
    });

    return NextResponse.json(
      { error: "forbidden", message: result.message },
      { status: result.status, headers: NO_STORE },
    );
  } catch (error) {
    return temporarilyUnavailable(error);
  }
}
