import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { canReceiveImprovementRequestNotifications } from "@/lib/auth/improvement-request-authorization";
import { db } from "@/lib/db";
import { improvementRequests, webUsers, type UserRole } from "@/lib/db/schema";
import {
  buildImprovementRequestNotifications,
  improvementRequestNotificationId,
  type ImprovementRequestNotificationFeed,
  type ImprovementRequestNotificationSource,
} from "@/lib/domain/notifications";
import { env } from "@/lib/env";
import { listAcknowledgedNotificationKeys } from "./notification-acknowledgements";

/**
 * ============================================================================
 * 이 사이트 자신의 알림 — 「확인하지 않은 개선요청」을 매 요청 파생한다
 * ============================================================================
 * 규칙은 전부 domain/notifications.ts 에 있다. 이 파일은 그 순수 계산에 **재료를
 * 날라다 주는 자리**다 — 개선요청 줄, 이 사람의 확인 기록, 이 사이트의 주소.
 *
 * ── 🔴 알림 표는 없다 ───────────────────────────────────────────────────
 * 새 요청이 들어오면 저절로 알림이 된다(db/mutations/improvement-requests.ts 의
 * createImprovementRequest 는 알림에 대해 아무것도 하지 않는다). 알림을 따로
 * 저장하면 업무 자료와 알림이 두 벌의 진실이 되어 언젠가 어긋난다.
 *
 * ── 🔴 여기서 던지지 않는다 ─────────────────────────────────────────────
 * 이 값은 **모든 화면의 머리말**에 실린다. DB 가 죽었든, 랜선이 빠져 이 기계의
 * 주소를 못 찾든(env.ownBaseUrl), 종 하나 때문에 사이트 전체가 못 쓰게 되면 안
 * 된다. 그래서 어떤 실패도 **빈 목록**으로 돌아간다 — 포털 알림을 가져오는 통로
 * (auth/oidc.ts)가 같은 판단을 하고 있고, 그 규칙은
 * auth/notification-bell-wiring.test.ts 가 지킨다.
 *
 * ⚠️ 로그에는 **오류의 종류만** 남긴다. 개선요청 본문은 자유 입력이라 사람
 * 이름이나 고객사 사정이 섞일 수 있다(schema.ts 의 PII 주석).
 *
 * ── 상태로 거르지 않는다 · 기간으로도 거르지 않는다 ─────────────────────
 * 확인하지 않은 글은 전부 알림이다(사용자 결정 2026-09-23 — 까닭은 도메인
 * 머리말). 그래서 이 조회에는 `status` 조건도 날짜 조건도 없다. 거르는 것은
 * 「지워진 글」뿐이다.
 * ============================================================================
 */

const EMPTY: ImprovementRequestNotificationFeed = { items: [], count: 0 };

const author = alias(webUsers, "improvement_request_notification_author");

/**
 * 알림으로 만들 개선요청 줄 — **알림에 필요한 칸만** 읽는다.
 *
 * 목록 조회(listImprovementRequests)를 돌려쓰지 않는 이유: 그쪽은 첨부·휴지통까지
 * 세 질의로 읽어 오는데(그 화면에 필요하다), 종에는 한 칸도 쓰이지 않는다. 종은
 * **모든 화면**에 딸려 오므로 그 비용이 매 화면에 붙는다.
 *
 * 차례는 최근 글부터 — 목록 화면과 같은 정렬이다(두 곳이 다른 차례를 말하지
 * 않게).
 */
async function listImprovementRequestNotificationSources(): Promise<
  ImprovementRequestNotificationSource[]
> {
  const rows = await db
    .select({
      id: improvementRequests.id,
      serviceKey: improvementRequests.serviceKey,
      menuKey: improvementRequests.menuKey,
      body: improvementRequests.body,
      status: improvementRequests.status,
      authorAccountName: author.displayName,
      importedAuthorName: improvementRequests.importedAuthorName,
    })
    .from(improvementRequests)
    .leftJoin(author, eq(author.id, improvementRequests.createdBy))
    .where(eq(improvementRequests.isDeleted, false))
    .orderBy(desc(improvementRequests.createdAt), desc(improvementRequests.id));

  return rows.map(({ authorAccountName, importedAuthorName, ...row }) => ({
    ...row,
    // 계정이 있으면 그 이름, 없으면 옮겨 온 글에 적힌 이름(queries/improvement-requests.ts 와 같다).
    createdByName: authorAccountName ?? importedAuthorName,
  }));
}

/**
 * 이 사람의 종에 실을 **자체 알림**.
 *
 * 🔴 **관리자에게만 실린다**(사용자 결정 2026-09-23 — 「개발자」는 지금 ADMIN 인
 * 사람이다). 판정은 auth/improvement-request-authorization.ts 한 곳이 갖는다 —
 * 확인을 적는 서버 액션도 **같은 함수**를 부르므로 둘이 갈라지지 않는다.
 *
 * 🔴 역할은 부르는 쪽이 `getSessionUser()` 로 읽은 **살아 있는 web_users 행**에서
 * 와야 한다. 쿠키에 박힌 값이나 요청 본문에서 온 값을 넘기면 그 보호가 사라진다.
 */
export async function listOwnNotifications(actor: {
  id: string;
  role: UserRole;
}): Promise<ImprovementRequestNotificationFeed> {
  if (!canReceiveImprovementRequestNotifications(actor.role)) return EMPTY;

  try {
    const requests = await listImprovementRequestNotificationSources();
    if (requests.length === 0) return EMPTY;

    // 🔴 「지금 띄우려는 알림의 열쇠」로 좁혀 묻는다(그 파일 머리말).
    const acknowledgedKeys = await listAcknowledgedNotificationKeys(
      actor.id,
      requests.map((request) => improvementRequestNotificationId(request.id)),
    );

    return buildImprovementRequestNotifications({
      requests,
      acknowledgedKeys,
      // 주소를 못 찾으면 여기서 던진다 — 아래 catch 가 받는다(env.ts 의 그 주석).
      baseUrl: env.ownBaseUrl,
    });
  } catch (error) {
    // 🔴 오류의 **종류만** 남긴다. 값(본문·이름·주소)은 싣지 않는다.
    console.error("listOwnNotifications: failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return EMPTY;
  }
}
