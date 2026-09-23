import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { webUsers, type UserRole } from "@/lib/db/schema";

/**
 * ============================================================================
 * 포털 쪽 사람 → 이 사이트의 사람
 * ============================================================================
 * 포털이 물어 올 때 「누구의 알림인가」는 **서명된 토큰의 `sub`** 로만 온다
 * (auth/portal-service-token.ts). 그 값은 포털 users.id 이고, 이 사이트는 그것을
 * `web_users.auth_sub` 로 들고 있다(schema.ts 의 그 칸 주석 — 이메일이 아니라
 * 이것으로 사람을 잇는다).
 *
 * ⚠️ 서버에서만 부른다(이 저장소에는 `server-only` 패키지가 없다).
 *
 * ── 🔴 uuid 모양을 먼저 본다 ────────────────────────────────────────────
 * `auth_sub` 는 **uuid 칸**이다. 모양이 다른 글자로 비교하면 PostgreSQL 이
 * 22P02(invalid input syntax for type uuid)로 **던진다** — 그 통로는 포털이 매번
 * 두드리는 자리라, 이상한 sub 하나가 500 을 만들면 포털 화면에서는 「이 시스템은
 * 지금 불러올 수 없습니다」가 된다. 그래서 묻기 전에 모양을 본다.
 *
 * ── 살아 있는 사람만 ────────────────────────────────────────────────────
 * 정지(`is_active=false`)·삭제된 사람은 못 찾은 것으로 친다. 세션을 읽는 자리
 * (auth/session.ts 의 getSessionUser)와 **같은 줄**이다 — 화면에서 막힌 사람의
 * 알림이 포털의 종에는 계속 뜨면 안 된다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 판정에 필요한 만큼만. `WebUser` 가 구조적으로 그대로 들어맞는다. */
export type PortalActor = {
  id: string;
  role: UserRole;
};

/**
 * 포털 쪽 sub 로 이 사이트의 사람을 찾는다.
 *
 * 🔴 **못 찾는 것은 정상이다** — 이 사이트에 한 번도 들어오지 않은 사람은 행이
 * 없다. 포털은 같은 질문을 모든 시스템에 던지므로 흔한 일이고, 오류가 아니다.
 */
export async function getWebUserByAuthSub(subject: string): Promise<PortalActor | null> {
  if (!UUID_PATTERN.test(subject)) return null;

  const [user] = await db
    .select({ id: webUsers.id, role: webUsers.role })
    .from(webUsers)
    .where(
      and(
        eq(webUsers.authSub, subject),
        eq(webUsers.isActive, true),
        eq(webUsers.isDeleted, false),
      ),
    )
    .limit(1);

  return user ?? null;
}
