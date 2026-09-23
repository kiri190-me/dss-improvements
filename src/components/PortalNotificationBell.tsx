import { NotificationBellWithAcknowledge } from "@/components/NotificationBellWithAcknowledge";
import { fetchPortalNotifications } from "@/lib/auth/oidc";
import { listOwnNotifications } from "@/lib/db/queries/notifications";
import type { UserRole } from "@/lib/db/schema";
import { acknowledgeNotificationAction } from "@/lib/server/actions/notification-acknowledgements";

/**
 * 머리말의 알림 종 — **이 사이트의 알림과 다른 시스템들의 알림**을 함께 그린다.
 *
 * 사내 시스템이 다섯인데(A/S · 개선요청 · 계측기 · PO/내자 · 휴가) 종은 A/S
 * 에만 있었다. 「어느 시스템에 있든 같은 알림을 본다」를 위해 포털이 모든
 * 시스템에 물어 합쳐 주는 통로를 열었고, 이 조각이 그것을 이 사이트에
 * 끌어온다(부르는 법: dss-auth/docs/사이트-알림-통로.md).
 *
 * ── 🔴 2026-09-23 — 이 사이트에도 **자체 알림이 생겼다** ─────────────────
 * 그 전까지 여기 오는 것은 전부 남의 시스템 알림이었다(그래서 확인을 적을 자리도
 * 없었다). 이제 **확인하지 않은 개선요청**이 관리자의 종에 실린다 —
 *  · 무엇이 알림이 되는가 · 왜 상태로 거르지 않는가 → domain/notifications.ts
 *  · 누구의 종에 실리는가(ADMIN 만) → db/queries/notifications.ts
 *  · 「확인했다」를 어디에 적는가 → server/actions/notification-acknowledgements.ts
 * 🔴 **자기 것이 앞, 포털에서 온 것이 뒤**다. 지금 이 사이트에서 일하는 사람의
 *    할 일이 먼저 보여야 하고, 받은 목록은 다시 섞지 않는다 — 포털이 정한 차례가
 *    있다. 포털은 **부른 사이트 자신의 알림을 빼고** 주므로 두 목록은 겹치지
 *    않는다. 개수도 각자 센 값을 그대로 더한다(다시 세지 않는다 — @dss/ui README 7절).
 *
 * ── 🔴 왜 **서버**에서 가져오나 (브라우저가 아니라) ──────────────────────
 * 자격증명이 `client_secret` 이라 브라우저에서는 부를 수 없다. 브라우저에서
 * 가져오려면 이 사이트 안에 중계 통로(route handler)를 하나 더 두고, 거기서
 * 세션을 다시 검증하고, 그 왕복이 도는 동안의 상태까지 다뤄야 한다 —
 * **시크릿을 다루는 자리를 하나 더 만드는** 일이다. 서버에서 부르면 시크릿은 이
 * 프로세스 밖으로 나가지 않는다. 자체 알림도 같은 자리에서 서버가 만든다(DB 를
 * 브라우저가 읽을 일이 없다).
 *
 * 🔴 그 대신 **모든 화면 이동이 이 왕복만큼 느려지는** 것을 막아야 한다.
 *    그래서 부르는 쪽((app)/layout.tsx)이 이 조각을 `<Suspense>` 로 감싼다 —
 *    머리말과 본문은 먼저 뜨고 종만 나중에 흘러 들어온다. 포털이 느리거나
 *    죽어도 사람이 기다리는 시간은 늘지 않는다. 왕복 자체에도 상한이
 *    걸려 있다(oidc.ts 의 NOTIFICATIONS_TIMEOUT_MS). 두 물음은 **나란히** 나간다 —
 *    우리 DB 가 포털을 기다릴 이유가 없다.
 *
 * ── 🔴 다시 묻는 주기는 두지 않는다 ─────────────────────────────────────
 * 브라우저에서 몇 초마다 다시 묻는 장치를 붙이지 않았다. 포털이 이미 30초
 * 캐시를 들고 있어 그보다 자주 물으면 **같은 답**을 받고, 그 장치를 붙이는
 * 순간 위에서 피한 중계 통로가 도로 필요해진다. 종은 화면을 새로 열 때
 * 갱신된다.
 *
 * ── 확인(onAcknowledge)은 껍데기가 나른다 ───────────────────────────────
 * 묶음의 확인 함수는 **함수**라 서버 컴포넌트에서 넘길 수 있는 것은 서버 액션뿐
 * 이다. 액션을 그대로 넘기면 **모든 줄에서**(포털 줄에서도) 서버 왕복이 한 번씩
 * 나가므로, 가리는 일을 하는 클라이언트 껍데기를 하나 둔다
 * (NotificationBellWithAcknowledge — 그 파일 머리말). 🔴 목록은 여기서 다
 * 만들어 **값으로** 넘긴다.
 *
 * 포털에서 온 줄은 확인을 적지 않는다 — 「확인했다」를 적을 수 있는 곳은 그
 * 알림을 만든 시스템뿐이다. 그 줄을 누르면 그 시스템의 화면으로 건너가고,
 * 거기서 일을 마치면 다음 왕복에서 목록이 줄어든다.
 */
export async function PortalNotificationBell({
  subject,
  userId,
  role,
}: {
  /** 포털에 물을 때 쓰는 그 사람의 영구 식별자(web_users.auth_sub). */
  subject: string;
  /** 확인 기록을 거를 때 쓰는 이 사이트의 사람 id(web_users.id). */
  userId: string;
  /** 🔴 자체 알림을 누구에게 싣는지 정한다. 살아 있는 계정의 역할이어야 한다. */
  role: UserRole;
}) {
  // 🔴 둘 다 던지지 않는다. 포털이 죽었든 우리를 거절했든, DB 가 멎었든 빈
  //    목록이 온다 — 종 하나 때문에 모든 화면이 죽지 않게.
  const [own, feed] = await Promise.all([
    listOwnNotifications({ id: userId, role }),
    fetchPortalNotifications(subject),
  ]);

  return (
    <NotificationBellWithAcknowledge
      items={[...own.items, ...feed.items]}
      count={own.count + feed.count}
      acknowledge={acknowledgeNotificationAction}
    />
  );
}
