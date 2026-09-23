import { db } from "@/lib/db";
import { notificationAcknowledgements } from "@/lib/db/schema";

/**
 * ============================================================================
 * 알림 확인 기록 — 적기 (「이 사람이 이 알림을 눌러 봤다」)
 * ============================================================================
 * 표의 뜻과 설계의 이유는 db/schema.ts 의 notification_acknowledgements 머리말.
 *
 * ── 🔴 이 저장은 업무 자료를 한 칸도 움직이지 않는다 ────────────────────
 * 개선요청 행은 손대지 않는다 — 상태도, version 도, updated_at 도. 알림을 눌러
 * 본 일은 **한 사람의 화면 상태**이지 업무 기록이 아니다. 그래서
 *  · 트랜잭션도 행 잠금도 없다. 고칠 행이 없고 넣는 줄 하나가 전부다.
 *  · 낙관적 잠금(version)이 없다. 「그 사이 누가 바꿨나」를 물을 대상이 없다.
 *  · 감사 로그도 남기지 않는다(A/S 가 같은 자리에서 같은 판단을 했다).
 *
 * ── 🔴 두 번 눌러도 한 줄 — ON CONFLICT DO NOTHING ──────────────────────
 * 같은 알림을 두 번 누르는 일은 평범하게 일어난다(목록을 다시 열어 같은 줄을
 * 또 누른다). 먼저 읽어 보고 없으면 넣는 방식은 두 요청이 겹칠 때 둘 다
 * 「없다」를 보고 둘 다 넣는다 — 그러면 유니크 색인이 23505 로 거절하고, 사람은
 * 아무 잘못 없이 실패를 본다. 여기서는 **DB 가 정한다**: 유니크
 * (user_id, notification_key)에 부딪히면 조용히 아무것도 하지 않는다.
 *
 * 그래서 이 함수는 「새로 적었는가 / 이미 있었는가」를 구별해 돌려주지 않는다.
 * 부르는 쪽이 알고 싶은 것은 「이제 확인된 상태인가」 하나이고, 두 경우 모두
 * 답은 같다.
 *
 * ⚠️ 이 파일은 **서버에서만** 부른다. 막는 것(세션·권한·열쇠 모양)은 서버 액션
 * (server/actions/notification-acknowledgements.ts)이고, 여기는 넘어온 값을 적기만
 * 한다 — 그 액션 말고 다른 곳에서 이 함수를 부르게 되면 같은 관문을 먼저 세워야
 * 한다.
 * ============================================================================
 */
export async function markNotificationAcknowledged(input: {
  /** 🔴 세션에서 푼 web_users.id 여야 한다 — 브라우저가 보낸 값이 아니라. */
  userId: string;
  /** 🔴 우리 모양인지 이미 검사된 열쇠(domain/notifications.ts 의 isOwnNotificationKey). */
  notificationKey: string;
}): Promise<void> {
  await markNotificationsAcknowledged({
    userId: input.userId,
    notificationKeys: [input.notificationKey],
  });
}

/**
 * 여러 줄을 **한 문장으로** 적는다 — 개선요청 화면에 들어왔을 때 쓴다
 * (2026-09-23, 사용자 결정: 「개선 요청 창에서 개선 요청들을 한번에 볼 수 있기
 * 때문」에 들어온 것 자체가 「다 봤다」는 뜻이다 — domain/notifications.ts 의
 * acknowledgeableNotificationKeys 머리말).
 *
 * 줄마다 따로 넣지 않는 이유: 다섯 줄이면 왕복이 다섯 번이고, 그중 하나가
 * 실패했을 때 「어디까지 적혔나」가 애매해진다. 한 문장이면 전부 적히거나
 * 전부 안 적힌다 — 트랜잭션을 따로 열지 않아도 그렇다.
 *
 * 🔴 위 한 줄짜리도 이 함수를 부른다. `ON CONFLICT` 를 두 곳에 적으면 한쪽만
 * 고쳐지는 날이 온다.
 */
export async function markNotificationsAcknowledged(input: {
  userId: string;
  /** 🔴 전부 우리 모양인지 이미 검사된 열쇠들. */
  notificationKeys: readonly string[];
}): Promise<void> {
  // 적을 것이 없으면 DB 에 가지 않는다. 빈 VALUES 는 문법 오류다.
  if (input.notificationKeys.length === 0) return;

  const rows = [...new Set(input.notificationKeys)].map((notificationKey) => ({
    userId: input.userId,
    notificationKey,
  }));

  await db
    .insert(notificationAcknowledgements)
    .values(rows)
    .onConflictDoNothing({
      target: [notificationAcknowledgements.userId, notificationAcknowledgements.notificationKey],
    });
}
