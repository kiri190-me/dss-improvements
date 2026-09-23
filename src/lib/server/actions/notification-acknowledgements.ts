"use server";

import { revalidatePath } from "next/cache";

import { canReceiveImprovementRequestNotifications } from "@/lib/auth/improvement-request-authorization";
import { getSessionUser } from "@/lib/auth/session";
import {
  markNotificationAcknowledged,
  markNotificationsAcknowledged,
} from "@/lib/db/mutations/notification-acknowledgements";
import { listOwnNotifications } from "@/lib/db/queries/notifications";
import {
  acknowledgeableNotificationKeys,
  isOwnNotificationKey,
} from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 알림 확인 — 서버 액션 (정책 계층)
 * ============================================================================
 * 종의 줄을 누르면 「이 사람이 이 알림을 봤다」를 적는다. 그 줄은 다음 화면부터
 * 종에 뜨지 않는다.
 *
 * ── 🔴 관문 순서 — improvement-requests.ts 와 같다 ──────────────────────
 *   세션 → 권한 → 입력 검증 → 저장
 *
 *  · **세션**: `getSessionUser()` 가 매 요청 살아 있는 web_users 한 행을 읽는다.
 *    🔴 **사용자 id 는 여기서만 나온다** — 이 함수는 userId 도 role 도 인자로
 *    받지 않는다. 받으면 브라우저가 남의 id 를 보내 **남의 종을 대신 읽음
 *    처리**할 수 있다(그 사람은 자기가 못 본 알림이 사라진 것을 알 길이 없다).
 *  · **권한**: 알림을 받는 사람만 확인을 적는다. 화면이 누구에게 종을 그리는지와
 *    **같은 함수**로 판정한다(auth/improvement-request-authorization.ts).
 *  · **검증**: 열쇠의 **모양을 통째로** 다시 본다. 이 값은 브라우저를 거쳐 오고,
 *    종에는 포털이 실어 준 남의 시스템 알림도 함께 그려져 있다. 화면 쪽에도 같은
 *    판정이 있지만(클라이언트 껍데기), 🔴 **서버 액션은 브라우저에서 직접 부를 수
 *    있는 통로**라 화면을 거치지 않고 오는 요청을 가정한다.
 *
 * ── 🔴 돌려주는 것은 `{ ok }` 하나다 ────────────────────────────────────
 * 왜 거절됐는지 말하지 않는다. 이 값은 눌린 줄을 화면에서 되살릴지 말지에만
 * 쓰이고, 까닭을 실어 보내면 「어떤 열쇠가 유효한지」를 알려 주는 통로가 된다.
 * 실패해도 사람에게 보이는 것은 **그 줄이 종에 남는 것**뿐이다 — 이동은 평범한
 * <a href> 라 이 액션과 무관하게 그대로 간다(@dss/ui README 7절).
 *
 * ── 이 액션은 업무 자료를 바꾸지 않는다 ─────────────────────────────────
 * 그래서 낙관적 잠금도, 감사 로그도, 실패 문구도 없다(mutation 머리말).
 * `revalidatePath` 만 부른다 — 같은 화면에 머무는 경우 종이 다시 계산되도록.
 * ============================================================================
 */

/** 개선요청 목록 화면. 종이 이 화면의 서버 렌더에서 계산된다. */
const LIST_PATH = "/";

export async function acknowledgeNotificationAction(input: {
  notificationKey: string;
}): Promise<{ ok: boolean }> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false };
  if (!canReceiveImprovementRequestNotifications(actor.role)) return { ok: false };

  // 🔴 우리 알림의 열쇠 모양이 아니면 여기서 끝난다 — 포털에서 온 줄(`client_id:id`)도,
  //    손으로 지어낸 글자도 우리 확인 기록 표에 들어가지 못한다.
  const notificationKey = input?.notificationKey;
  if (!isOwnNotificationKey(notificationKey)) return { ok: false };

  try {
    await markNotificationAcknowledged({ userId: actor.id, notificationKey });
    revalidatePath(LIST_PATH);
    return { ok: true };
  } catch (error) {
    // 오류의 종류만 남긴다 — 값(열쇠·사람)은 싣지 않는다.
    console.error("acknowledgeNotificationAction: unexpected DB error", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false };
  }
}

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 개선요청 화면에 들어왔다 — **그 시점의 내 알림 전부**를 확인으로 적는다
 * ────────────────────────────────────────────────────────────────────────
 * 2026-09-23 사용자가 더한 동작이다. 까닭은 사용자의 말 그대로다:
 *
 *   「창에 들어오면 한꺼번에 사라지는 이유는 **개선 요청 창에서 개선 요청들을
 *     한번에 볼 수 있기 때문**이야.」
 *
 * 즉 **화면에 들어온 것 자체가 「다 봤다」**는 뜻이다 — 목록 화면 하나에 모든
 * 요청이 한눈에 보이므로, 들어온 사람은 이미 전부 본 것이다.
 * 🔴 글 하나만 여는 화면(상세)이 생기면 이 전제가 흔들린다 — 그때 다시 볼 결정이다.
 *
 * 🔴 **줄 하나 누르기(위 액션)는 그대로 남는다.** 조각 3에서 포털 타일에도 점이
 * 뜨는데, 이 사이트를 열지 않고도 확인할 길이 있어야 한다.
 *
 * ── 🔴 입력을 받지 않는다 ───────────────────────────────────────────────
 * 인자가 **하나도 없다.** 화면이 보낸 열쇠 목록을 받으면 그것이 곧 「남의 열쇠를
 * 밀어 넣는 통로」가 된다(브라우저에서 직접 부를 수 있는 통로다). 그래서 사람도
 * 역할도 목록도 **전부 서버에서 다시 만든다** — 종에 실릴 목록을 만드는 그 함수
 * (listOwnNotifications)를 그대로 불러, 화면이 무엇을 그렸든 서버가 지금 계산한
 * 것만 적는다.
 *
 * ── 새 요청은 다시 뜬다 ─────────────────────────────────────────────────
 * 확인은 **그 시점의 열쇠**에만 걸린다. 이 뒤에 들어온 글은 새 열쇠라 종에 다시
 * 뜬다 — 「들어왔으니 앞으로 영원히 안 본다」가 아니다.
 *
 * 실패는 조용히 넘어간다({ ok: false }). 사람이 보는 것은 **알림이 그대로 남는
 * 것**뿐이고, 다음에 들어오면 다시 적는다.
 */
export async function acknowledgeAllOwnNotificationsAction(): Promise<{ ok: boolean }> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false };
  if (!canReceiveImprovementRequestNotifications(actor.role)) return { ok: false };

  try {
    // 🔴 화면이 보낸 것이 아니라 **서버가 지금 만든** 목록이다. 이미 확인한 줄은
    //    여기서 빠져 있으므로, 적을 것은 아직 안 본 줄뿐이다.
    const own = await listOwnNotifications({ id: actor.id, role: actor.role });
    // 줄 하나를 누를 때와 **같은 판정**으로 거른다(포털 줄·모양이 다른 열쇠 제외).
    const notificationKeys = acknowledgeableNotificationKeys(own.items);

    // 🔴 적을 것이 없으면 DB 에 가지 않는다 — 화면을 열 때마다 도는 자리다.
    if (notificationKeys.length === 0) return { ok: true };

    await markNotificationsAcknowledged({ userId: actor.id, notificationKeys });
    // 종은 서버 렌더에서 계산된다 — 다시 계산하게 해야 눈앞에서 사라진다.
    revalidatePath(LIST_PATH);
    return { ok: true };
  } catch (error) {
    console.error("acknowledgeAllOwnNotificationsAction: unexpected DB error", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false };
  }
}
