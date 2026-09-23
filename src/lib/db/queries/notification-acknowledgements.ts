import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationAcknowledgements } from "@/lib/db/schema";

/**
 * ============================================================================
 * 알림 확인 기록 — 읽기 (「이 사람이 이미 눌러 본 알림은 무엇인가」)
 * ============================================================================
 * 표의 뜻과 설계의 이유는 db/schema.ts 의 notification_acknowledgements 머리말에
 * 있다. 요약하면 **알림을 저장하는 표가 아니라**, 업무 자료에서 매번 파생한 알림
 * 중 이미 확인한 것을 걸러 내는 표다.
 *
 * ⚠️ 이 파일은 **서버에서만** 부른다(queries/improvement-requests.ts 와 같다 —
 * 이 저장소에는 `server-only` 패키지가 없다).
 *
 * ── 🔴 언제나 「지금 띄우려는 알림의 열쇠」로 좁혀 묻는다 ────────────────
 * 사람이 누른 기록은 지워지지 않고 쌓인다(그 표에는 삭제 규칙이 없다). 사람마다
 * 전부 읽어 오면 화면과 아무 상관 없는 옛 줄까지 매 요청 실려 온다. 좁혀 물으면
 * 읽히는 줄 수가 **지금 화면에 띄울 알림 수**를 넘지 않고, 유니크 색인
 * (user_id, notification_key)이 그 조회를 그대로 받는다.
 * ============================================================================
 */

/**
 * 이 사람이 이미 확인한 열쇠들 — 넘긴 것 중에서만.
 *
 * 돌려주는 차례는 정하지 않는다. 부르는 쪽은 이것을 Set 으로 만들어 「들어 있는가」만
 * 묻는다(domain/notifications.ts 의 buildImprovementRequestNotifications).
 */
export async function listAcknowledgedNotificationKeys(
  userId: string,
  keys: readonly string[],
): Promise<string[]> {
  // 물어볼 것이 없으면 DB 를 두드리지 않는다. `inArray` 에 빈 배열을 넘기면
  // 드라이버마다 다른 SQL 이 나가는 자리라, 아예 가지 않는 편이 분명하다.
  if (keys.length === 0) return [];

  const rows = await db
    .select({ notificationKey: notificationAcknowledgements.notificationKey })
    .from(notificationAcknowledgements)
    .where(
      and(
        eq(notificationAcknowledgements.userId, userId),
        inArray(notificationAcknowledgements.notificationKey, [...keys]),
      ),
    );

  return rows.map((row) => row.notificationKey);
}
