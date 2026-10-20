"use client";

import { useState } from "react";
import { NotificationBell } from "@dss/ui";
import type { NotificationBellItem } from "@dss/ui";

import { shouldAcknowledgeNotification } from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 종의 **껍데기** — 「눌러서 확인」을 얹는 자리
 * ============================================================================
 * 그리는 일은 묶음(@dss/ui 의 NotificationBell)이 하고, 목록과 개수는 **서버가
 * 이미 만들어 넘긴 값**이다(PortalNotificationBell). 여기가 하는 일은 둘뿐이다 —
 * 눌린 줄을 확인으로 적는 일, 그리고 적는 동안 그 줄을 미리 감추는 일.
 *
 * ── 🔴 왜 클라이언트 조각이 하나 필요한가 ───────────────────────────────
 * 묶음의 `onAcknowledge` 는 **함수**다. 서버 컴포넌트에서 종을 그리면 넘길 수
 * 있는 것은 서버 액션뿐이고(@dss/ui README 7절), 그러면 **모든 줄에서** —
 * 포털이 실어 준 남의 시스템 줄에서도 — 서버로 한 번씩 왕복이 나간다. 여기서
 * 가리면 우리 줄일 때만 나간다. A/S 가 같은 이유로 같은 자리에 껍데기를 두었다
 * (RF_Service_System 의 components/layout/NotificationBell.tsx).
 *
 * 🔴 **목록을 여기서 만들지 않는다.** DB 도 세션도 포털도 모르고, 받은 값을
 * 그대로 넘긴다 — 서버가 그리는 부분은 서버에 남는다.
 *
 * ── 🔴 확인은 기다리지 않는다 ───────────────────────────────────────────
 * 줄은 평범한 `<a href>` 라 브라우저가 곧바로 그 화면으로 나간다. 확인 저장을
 * 기다리면 이동이 그만큼 늦어지고, 저장이 실패하면 이동이 막힌다 — 훨씬 나쁘다.
 * 그래서 **시작만 하고 돌아온다.** 실패하면 그 줄이 종에 다시 나타날 뿐이다.
 * ============================================================================
 */

/**
 * 확인을 적는 서버 액션의 모양 — server/actions/notification-acknowledgements.ts
 * 의 acknowledgeNotificationAction 과 같다.
 *
 * 🔴 그 파일을 여기서 **직접 가져오지 않고 받아서** 쓴다. 액션 파일은 세션과
 * DB 를 물고 있어서, 여기서 가져오면 이 조각을 그냥 불러 보는 시험이 그 사슬을
 * 통째로 끌고 온다. 받아서 쓰면 시험이 가짜 함수를 넘겨 「언제 부르는가」를
 * 그대로 볼 수 있다(A/S 가 같은 이유로 같은 모양을 쓴다).
 */
export type AcknowledgeNotification = (input: {
  notificationKey: string;
}) => Promise<{ ok: boolean }>;

/**
 * 「이 알림은 그만 보겠다」를 **포털에** 적는 서버 액션의 모양 —
 * server/actions/notification-dismissals.ts 의 dismissNotificationAction 과 같다.
 *
 * 🔴 위와 같은 이유로 **받아서** 쓴다(직접 가져오지 않는다). 그 액션 파일은
 * 세션과 포털 자격증명을 물고 있다.
 *
 * ── 🔴 확인과 **다른 것**이다. 섞지 않는다 ──────────────────────────────
 * 아래 hide/restore 는 **확인을 저장하는 동안** 줄을 미리 감추는 장치다. 지움은
 * 감추지 않는다 — 두 가지 까닭이다:
 *  · ✕ 는 줄의 링크 **밖**(형제)이라 누름이 확인 쪽으로 가지 않는다(@dss/ui 의
 *    BellBehavior 가 `a.dss-bell__link` 를 찾는다). 같은 누름에서 둘이 함께
 *    도는 일이 **없다** — 섞일 자리가 애초에 없다.
 *  · 지움은 서버가 revalidate 로 목록을 다시 그려 그때 줄이 빠진다. 여기서도
 *    감추면 **같은 줄을 두 곳에서 지우는** 꼴이 되어, 포털이 거절했을 때
 *    (되살릴 길이 없는 채로) 눈에서만 사라진 줄이 남는다.
 */
export type DismissNotification = (item: NotificationBellItem) => Promise<void>;

/** 화면에서 줄을 감췄다 되살리는 두 손잡이. 시험에서는 가짜를 넣는다. */
export type AcknowledgeView = {
  hide: (key: string) => void;
  restore: (key: string) => void;
};

/**
 * 눌린 줄 하나를 처리한다 — **가리고 · 미리 감추고 · 뒤에서 적는다.**
 *
 * 🔴 묶음은 **모든 줄에서** 이 경로로 들어온다. 우리 줄인지(sourceId 가 비었는지)와
 * 우리 열쇠 모양인지는 도메인 판정 한 곳이 정한다 — 서버 액션도 같은 함수를
 * 부르므로 두 곳이 갈라지지 않는다.
 *
 * 먼저 감추는 이유: 서버가 준 목록은 저장이 끝나고 다시 계산될 때까지 그 줄을
 * 그대로 들고 있다. 기다렸다 감추면 이동이 느린 동안 방금 누른 줄이 그대로
 * 보인다. 저장이 실패하면 되살린다.
 *
 * React 를 모르는 순수한 모양이라 시험이 그대로 불러 본다.
 */
export function acknowledgePickedNotification(
  item: NotificationBellItem,
  acknowledge: AcknowledgeNotification | undefined,
  view: AcknowledgeView,
): void {
  if (!acknowledge) return;
  // 🔴 포털에서 온 줄은 여기서 끝난다. 「확인했다」를 적을 수 있는 곳은 그 알림을
  //    만든 시스템뿐이다 — 적어 봐야 우리 표에 쓸모없는 줄이 쌓이고, 그 알림은
  //    남의 종에 그대로 남는다.
  if (!shouldAcknowledgeNotification(item)) return;

  view.hide(item.key);
  const restore = () => view.restore(item.key);

  let pending: Promise<{ ok: boolean }>;
  try {
    pending = acknowledge({ notificationKey: item.id });
  } catch {
    // 액션을 부르는 것 자체가 실패했다(네트워크가 끊겼다든가). 줄을 되살린다.
    restore();
    return;
  }

  // 🔴 두 갈래를 다 받는다 — 두 번째 인자가 없으면 거절이 「처리되지 않은
  //    거절」이 되어 개발 중에는 화면에 오류판이 뜬다.
  void Promise.resolve(pending).then((result) => {
    if (!result?.ok) restore();
  }, restore);
}

export function NotificationBellWithAcknowledge({
  items,
  count,
  acknowledge,
  dismiss,
}: {
  /** 🔴 서버가 이미 만들어 넘긴 목록 — 자기 것 앞, 포털에서 온 것 뒤. */
  items: readonly NotificationBellItem[];
  /** 🔴 보낸 쪽이 센 값. 다시 세지 않는다(@dss/ui README 의 「개수」). */
  count: number;
  /** 없으면 확인을 적지 않는다 — 줄은 이동만 하고 종에 남는다. */
  acknowledge?: AcknowledgeNotification;
  /** 🔴 없으면 ✕ 가 **아예 그려지지 않는다**(@dss/ui 의 onDismiss). */
  dismiss?: DismissNotification;
}) {
  /**
   * 방금 눌러 확인했고 저장이 도는 중(또는 끝난) 줄. 서버가 준 목록이 다시
   * 계산되기 전까지 여기 든 줄은 그리지도 세지도 않는다. 저장이 실패하면 빠진다.
   */
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(() => new Set());

  const visibleItems =
    hiddenKeys.size === 0 ? items : items.filter((item) => !hiddenKeys.has(item.key));

  // 감춘 줄은 우리 줄뿐이고(위 판정), 우리 알림은 한 줄이 하나씩 세어져 있다 —
  // 그래서 감춘 수만큼 빼면 배지와 목록이 같은 말을 한다. 0 아래로는 내리지
  // 않는다(포털이 센 값이 제 줄 수와 다를 수 있다 — 그쪽 규칙은 우리가 모른다).
  const visibleCount = Math.max(0, count - hiddenKeys.size);

  return (
    <NotificationBell
      items={visibleItems}
      count={visibleCount}
      // 🔴 colorScheme 을 넘기지 않는다 — 이 사이트는 라이트 고정이고 기본값
      //    "host" 가 그것을 그대로 따른다(@dss/ui README 4절).
      //
      // 🔴 `onDismiss` 를 **넘겼을 때만** 줄마다 ✕ 가 그려진다(@dss/ui). 받은
      //    것을 그대로 넘긴다 — 감추지도, 가리지도 않는다(위 DismissNotification).
      onDismiss={dismiss}
      // 🔴 `canDismiss` 는 넘기지 않는다 = **모든 줄에 ✕ 가 선다.** 제 줄도 남의
      //    시스템 줄도 지울 수 있다. 한때 A/S 가 「처리해야 사라지는 제 할 일」은
      //    못 지우게 가렸는데 2026-10-20 에 그 규칙을 **풀었다**(A/S 의 551641f) —
      //    다른 시스템의 종에서는 어차피 지워지므로, 막는 것이 아니라 헷갈리게
      //    만들고 있었기 때문이다. 같은 까닭이 여기에도 그대로 적용된다.
      onAcknowledge={(picked) =>
        acknowledgePickedNotification(picked, acknowledge, {
          hide: (key) => setHiddenKeys((prev) => new Set(prev).add(key)),
          restore: (key) =>
            setHiddenKeys((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            }),
        })
      }
    />
  );
}
