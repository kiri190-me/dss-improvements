/**
 * 포털이 확인해 준 사람을 이 사이트의 이용자와 잇는다.
 *
 * 포털의 users 표는 건드리지 않는다. 이 사이트는 자기 web_users 를 갖고,
 * `auth_sub` 하나로만 이어진다 — 이름이 바뀌어도, 이메일이 바뀌어도,
 * 사람은 같은 사람이다.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { USER_ROLES, webUsers, type UserRole, type WebUser } from "@/lib/db/schema";
import type { SsoIdentity } from "./oidc";

export type SsoLoginResult =
  | { outcome: "SESSION"; user: WebUser; created: boolean }
  | {
      outcome: "REJECTED";
      code: "BAD_SUBJECT" | "UNKNOWN_ROLE" | "INACTIVE" | "DELETED";
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RoleDecision =
  /** 클레임이 없다. 포털이 이 사람의 역할을 관리하지 않는다는 뜻이니 그대로 둔다. */
  | { kind: "KEEP" }
  /** 이 사이트가 아는 값이다. 그대로 적용한다. */
  | { kind: "APPLY"; role: UserRole }
  /** 모르는 값이다. 로그인을 거절한다. */
  | { kind: "REJECT" };

/**
 * 포털이 ID 토큰에 실어 보낸 role 클레임을 어떻게 다룰지.
 *
 * **클레임이 없으면 유지(KEEP)** 다. 이 시스템은 전 직원이 글을 적는 곳이라
 * 부여 행이 없는 사람이 정상이고, 그런 사람에게는 role 이 실리지 않는다.
 * 없다고 거절하면 아무도 못 들어온다.
 *
 * **모르는 값이면 거절(REJECT)** 이다. 유지하면 안전한 쪽으로 실패하지
 * 않는다 — 관리자를 일반으로 **내리려다** 역할 이름을 잘못 적었을 때, 그
 * 사람이 관리자로 남아 있는데 아무 표시도 나지 않는다. 거절하면 잘못
 * 설정된 그 계정만 못 들어오고, 즉시 드러나며, 나머지는 멀쩡히 고칠 수 있다.
 *
 * (A/S 시스템 src/lib/auth/sso-role.ts · 계측기 시스템의 같은 함수와 같은 판정이다.)
 */
function decideRole(claim: unknown): RoleDecision {
  if (claim === undefined || claim === null) return { kind: "KEEP" };
  if (typeof claim !== "string") return { kind: "REJECT" };
  if ((USER_ROLES as readonly string[]).includes(claim)) {
    return { kind: "APPLY", role: claim as UserRole };
  }
  return { kind: "REJECT" };
}

/**
 * 처음 보는 사람이면 **일반(MEMBER)으로** 만든다.
 *
 * 포털이 "우리 회사 사람인가" 를 이미 판정했고 이 시스템은 전 직원이 쓰는
 * 곳이라, 여기서 또 승인을 기다리게 할 이유가 없다. 다만 자동으로 주는
 * 권한은 가장 낮은 것뿐이다 — 남의 글을 정리할 사람은 포털에서 ADMIN 역할을
 * 명시적으로 받아야 한다.
 */
export async function resolveSsoLogin(identity: SsoIdentity): Promise<SsoLoginResult> {
  // auth_sub 는 uuid 열이다. 아닌 값이 오면 insert 가 터지므로 먼저 막는다.
  if (!UUID_PATTERN.test(identity.subject)) {
    console.error("[sso] sub 가 uuid 형식이 아닙니다.");
    return { outcome: "REJECTED", code: "BAD_SUBJECT" };
  }

  const decision = decideRole(identity.role);
  if (decision.kind === "REJECT") {
    console.error(
      `[sso] 이 시스템이 모르는 역할입니다: ${String(identity.role)} ` +
        `(아는 값: ${USER_ROLES.join(", ")})`,
    );
    return { outcome: "REJECTED", code: "UNKNOWN_ROLE" };
  }

  const displayName = identity.name?.trim().slice(0, 40) || "이름 없음";
  const now = new Date();

  // 삭제된 사람도 함께 찾는다. auth_sub 의 유일 색인에는 조건이 없어서,
  // 못 본 척하면 새로 만들려다 색인 충돌로 터진다. 그리고 내보낸 사람이
  // 조용히 새 계정으로 돌아오는 편이 더 나쁘다.
  const [existing] = await db
    .select()
    .from(webUsers)
    .where(eq(webUsers.authSub, identity.subject))
    .limit(1);

  if (existing) {
    if (existing.isDeleted) {
      console.warn(`[sso] 삭제된 계정입니다: ${identity.subject}`);
      return { outcome: "REJECTED", code: "DELETED" };
    }
    if (!existing.isActive) {
      console.warn(`[sso] 정지된 계정입니다: ${identity.subject}`);
      return { outcome: "REJECTED", code: "INACTIVE" };
    }

    const [updated] = await db
      .update(webUsers)
      .set({
        displayName,
        // 포털에 이메일이 없으면 예전 값을 지우지 않는다. 카카오에서
        // 이메일은 선택 동의라 있다가 없어질 수 있다 — "말하지 않았다" 와
        // "비웠다" 는 다르다.
        ...(identity.email ? { email: identity.email } : {}),
        ...(decision.kind === "APPLY" ? { role: decision.role } : {}),
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(webUsers.id, existing.id))
      .returning();

    return { outcome: "SESSION", user: updated, created: false };
  }

  const [created] = await db
    .insert(webUsers)
    .values({
      authSub: identity.subject,
      displayName,
      email: identity.email,
      role: decision.kind === "APPLY" ? decision.role : "MEMBER",
      lastLoginAt: now,
    })
    .returning();

  return { outcome: "SESSION", user: created, created: true };
}
