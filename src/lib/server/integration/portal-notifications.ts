import { canManageImprovementRequests } from "@/lib/auth/improvement-request-authorization";
import type { PortalActor } from "@/lib/db/queries/web-users";
import { USER_ROLES, type UserRole } from "@/lib/db/schema";
import {
  IMPROVEMENT_REQUEST_NOTIFICATION_KIND,
  IMPROVEMENT_REQUEST_NOTIFICATION_KIND_LABEL,
  toPortalNotificationFeed,
  type ImprovementRequestNotificationFeed,
} from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 포털이 물어 올 때의 판단 — 라우트가 아니라 여기에 둔다
 * ============================================================================
 * 세 가지를 정한다:
 *  1. 토큰이 실어 온 **포털 쪽 사람**을 이 사이트의 사람으로 되짚는 규칙.
 *  2. 되짚지 못했을 때의 답(🔴 오류가 아니라 **빈 목록**).
 *  3. 알림 설정을 읽고 쓸 자격이 있는가, 그리고 이 시스템이 무엇을 답하는가.
 *
 * DB 를 여기서 부르지 않고 **인자로 받는다.** 그래서 이 파일의 판단은 DB 없이
 * 그대로 시험할 수 있고, 라우트에는 「머리말에서 토큰 꺼내 검증하고 이 함수
 * 부르기」만 남는다. 본보기는 A/S 의 같은 이름 파일이다.
 *
 * ── 🔴 알림을 만드는 규칙을 복제하지 않는다 ─────────────────────────────
 * 목록은 **화면의 종이 쓰는 그 함수**(db/queries/notifications.ts 의
 * listOwnNotifications)가 만든다 — 여기서는 받은 것을 포털이 읽을 모양으로 옮겨
 * 담기만 한다(domain 의 toPortalNotificationFeed). 규칙을 두 벌로 적으면 같은
 * 사람이 이 사이트에서는 6건, 포털에서는 다른 수를 보게 된다.
 * ============================================================================
 */

/** 포털에 등록된 이 시스템의 사람이 읽는 이름(service-catalog 의 우리 줄과 같다). */
export const PORTAL_SOURCE_NAME = "DSS 개선요청";

/** 계정을 못 찾았을 때의 답. 🔴 오류가 아니다. */
const EMPTY_FEED: ImprovementRequestNotificationFeed = { items: [], count: 0 };

/** 포털 쪽 sub 로 이 사이트 계정을 찾는다. 없으면 null. */
export type FindActorByAuthSub = (subject: string) => Promise<PortalActor | null>;

/**
 * 「이 사람의 지금 알림」을 포털이 읽을 모양으로.
 *
 * 🔴 **이 시스템에 계정이 없는 사람은 빈 목록이다 — 오류가 아니다.** 포털은 여러
 * 시스템에 같은 질문을 던지고, 이 사이트에 한 번도 들어오지 않은 사람은 흔하다.
 * 그 사람에게 오류를 돌려주면 포털의 종이 그 줄에서 「지금은 불러올 수 없습니다」로
 * 상한 것처럼 보인다.
 *
 * 🔴 역할 판정(누가 개선요청 알림을 받는가)은 여기서 하지 않는다 —
 * `listOwnNotifications` 안에 이미 있고, 화면과 **같은 함수**다.
 */
export async function buildPortalNotificationFeed(params: {
  subject: string;
  clientId: string;
  findActor: FindActorByAuthSub;
  listNotifications: (actor: {
    id: string;
    role: UserRole;
  }) => Promise<ImprovementRequestNotificationFeed>;
}): Promise<ImprovementRequestNotificationFeed> {
  const actor = await params.findActor(params.subject);
  if (!actor) return EMPTY_FEED;

  const own = await params.listNotifications({ id: actor.id, role: actor.role });
  return toPortalNotificationFeed(own.items, {
    clientId: params.clientId,
    sourceName: PORTAL_SOURCE_NAME,
  });
}

/* ------------------------------------------------------------------ */
/* 알림 설정 통로                                                        */
/* ------------------------------------------------------------------ */

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 이 시스템의 알림 설정은 **읽기 전용**이다 — 그 까닭
 * ────────────────────────────────────────────────────────────────────────
 * 포털에 한 줄을 등록하면 포털 관리자 화면이 **알림 설정도** 물으러 온다. 통로가
 * 없으면 404 가 나고 그 시스템이 「지금은 불러올 수 없습니다」로 그려진다 —
 * 고장이 아닌데 화면이 상한 것처럼 보인다. 그래서 통로를 함께 낸다.
 *
 * 그런데 이 사이트에는 **설정을 저장할 표가 없다.** 만들지 않는 것이 이번 조각의
 * 결정이다(마이그레이션 없음). 그러면 답할 수 있는 길은 둘이다:
 *
 *  ① 200 으로 받아들이고 **아무것도 바꾸지 않는다**(`changedCount: 0`)
 *  ② 🔴 **읽기는 내주고, 저장은 403 으로 분명히 거절한다** ← 고른 길
 *
 * ①을 고르지 않은 까닭: 포털 관리자가 스위치를 눌러 「저장됨」을 보고 화면을 다시
 * 열면 값이 되돌아 있다. **눌렀는데 아무 일도 일어나지 않는 것**이 이 저장소에서
 * 가장 나쁜 실패다(조용히 틀리는 쪽). ②는 포털이 그 자리에 **우리가 적어 보낸
 * 문장을 그대로 그린다**(dss-auth 의 gather.ts `messageFrom`), 그리고 포털은 403 을
 * **정상 응답**으로 다룬다 — degraded 로 세지 않는다(그쪽 settings.ts 머리말).
 *
 * 🔴 설정이 진짜로 필요해지면: 표를 만들고(마이그레이션) `enabled`·`receives` 를
 * 그 표에서 읽은 뒤, 아래 `editable` 을 true 로 바꾸고 PUT 이 저장하게 하면 된다.
 * 고칠 자리가 이 파일과 라우트 하나뿐이도록 모아 두었다.
 *
 * ── 지금 내주는 내용은 **거짓이 아니다** ────────────────────────────────
 * 종류는 하나(`IMPROVEMENT_REQUEST`)이고, 받는 사람은 ADMIN 뿐이며, 그 규칙은
 * 코드에 있다(auth/improvement-request-authorization.ts 의
 * canReceiveImprovementRequestNotifications). 아래 표는 그 코드를 그대로 옮겨
 * 적은 것이고, `editable: false` 가 「여기서는 못 바꾼다」를 말한다.
 */

/** 그 시스템의 역할 한 줄. 🔴 포털은 우리 역할 어휘를 모른다 — 이름표를 함께 보낸다. */
export type PortalSettingsRole = {
  code: UserRole;
  label: string;
  /** 🔴 false 면 포털 화면이 그 줄을 잠근다. 이 시스템은 언제나 false(위 머리말). */
  editable: boolean;
};

export type PortalSettingsRoleCell = {
  receives: boolean;
  defaultReceives: boolean;
};

export type PortalSettingsKind = {
  kind: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
  /** 열쇠는 위 역할의 `code`. */
  roles: Record<string, PortalSettingsRoleCell>;
};

export type PortalNotificationSettings = {
  roles: PortalSettingsRole[];
  kinds: PortalSettingsKind[];
};

export type PortalSettingsResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 403; message: string };

/** 화면에 그릴 역할 이름. 이 사이트의 역할은 둘뿐이다(schema.ts 의 USER_ROLES). */
const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "관리자",
  MEMBER: "일반",
};

/**
 * 이 시스템이 내주는 알림 설정 — **코드에 있는 규칙을 그대로 옮겨 적은 표**.
 *
 * 🔴 켜짐·받음 값을 손으로 적지 않고 권한 함수에서 **계산한다**. 언젠가 「MEMBER
 * 도 받는다」로 바뀌면 이 표가 저절로 따라간다 — 손으로 적어 두면 그날 한 곳만
 * 고쳐지고 포털에는 옛말이 남는다.
 */
export function improvementRequestNotificationSettings(): PortalNotificationSettings {
  const roles: PortalSettingsRole[] = USER_ROLES.map((code) => ({
    code,
    label: ROLE_LABELS[code],
    // 🔴 저장할 표가 없다 — 이 시스템에서는 아무 칸도 바꿀 수 없다(위 머리말).
    editable: false,
  }));

  const cells: Record<string, PortalSettingsRoleCell> = {};
  for (const code of USER_ROLES) {
    const receives = canReceiveNotificationsForSettings(code);
    cells[code] = { receives, defaultReceives: receives };
  }

  return {
    roles,
    kinds: [
      {
        kind: IMPROVEMENT_REQUEST_NOTIFICATION_KIND,
        label: IMPROVEMENT_REQUEST_NOTIFICATION_KIND_LABEL,
        description:
          "확인하지 않은 개선요청을 종에 띄웁니다. 줄을 누르거나 개선요청 화면에 들어오면 사라집니다.",
        enabled: true,
        defaultEnabled: true,
        roles: cells,
      },
    ],
  };
}

/**
 * 설정 표에 적을 「이 역할이 받는가」.
 *
 * 화면·서버 액션이 쓰는 판정과 **같은 것**을 부른다. 이름만 여기서 한 번 감싼 것은
 * 이 파일이 왜 그 함수를 부르는지(설정 표를 채우려고) 읽는 사람에게 말해 주기
 * 위해서다.
 */
function canReceiveNotificationsForSettings(role: UserRole): boolean {
  return canManageImprovementRequests(role);
}

/**
 * 설정을 **읽는** 것도 자격을 본다 — 관리자만.
 *
 * 어느 역할이 무엇을 받는지는 그 자체가 조직 구성 정보다(A/S 가 같은 줄을 긋는다).
 * 🔴 되짚지 못한 사람·관리자가 아닌 사람 **둘 다 같은 답**이다 — 까닭을 나누면
 * 포털에 토큰 하나 구울 수 있는 쪽이 「그 사람이 그 시스템에 있는지」와
 * 「관리자인지」를 알아낼 수 있다(규격서의 403 셋이 같은 본문인 것과 같은 이유).
 */
export async function readPortalNotificationSettings(params: {
  subject: string;
  findActor: FindActorByAuthSub;
}): Promise<PortalSettingsResult<PortalNotificationSettings>> {
  const actor = await params.findActor(params.subject);
  if (!actor || !canManageImprovementRequests(actor.role)) {
    return { ok: false, status: 403, message: FORBIDDEN_MESSAGE };
  }
  return { ok: true, value: improvementRequestNotificationSettings() };
}

/** 🔴 세 갈래(없는 사람·정지된 사람·관리자가 아닌 사람)가 **같은 문장**이다. */
const FORBIDDEN_MESSAGE = "이 시스템의 알림 설정은 볼 수 없습니다.";

/** 저장은 받지 않는다 — 까닭은 위 머리말. 포털이 이 문장을 그대로 그린다. */
export const SETTINGS_READ_ONLY_MESSAGE =
  "DSS 개선요청은 알림 설정을 바꿀 수 없습니다. 알림 종류가 하나뿐이고, 관리자에게만 보내도록 코드에 정해져 있습니다.";

/**
 * 설정 저장 — **언제나 거절한다.** 돌려주는 것은 답에 실을 문장뿐이다.
 *
 * 🔴 자격을 먼저 보고 거절한다. 관리자가 아닌 사람에게 「바꿀 수 없는 시스템이다」를
 * 알려 줄 이유가 없다 — 읽기와 **같은 문장**으로 답한다. 까닭을 적은 문장은
 * 관문을 통과한 관리자에게만 간다.
 *
 * 돌려주는 타입에 `ok: true` 갈래가 아예 없다 — 저장할 표가 생기기 전에는 성공이
 * 있을 수 없고, 타입이 그것을 말한다. 표가 생기면 이 함수와 라우트만 고치면 된다.
 */
export async function writePortalNotificationSettings(params: {
  subject: string;
  findActor: FindActorByAuthSub;
}): Promise<{ status: 403; message: string }> {
  const actor = await params.findActor(params.subject);
  if (!actor || !canManageImprovementRequests(actor.role)) {
    return { status: 403, message: FORBIDDEN_MESSAGE };
  }
  return { status: 403, message: SETTINGS_READ_ONLY_MESSAGE };
}
