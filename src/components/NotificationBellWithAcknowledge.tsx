"use client";

import { useState } from "react";
import { NotificationBell, isSafeNotificationHref } from "@dss/ui";
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
 *
 * 🔴 2026-10-22 — **같은 모양**을 포털 확인(아래 `acknowledgePortal` prop)에도
 * 그대로 쓴다. 적히는 **표**가 다를 뿐 함수 모양은 같아서 타입을 하나 더
 * 만들지 않았다. 넘기는 **값**이 다르다 — 우리 줄은 `item.id`, 포털 줄은
 * `item.key`다(갈라 부르는 자리는 아래 acknowledgePickedNotification).
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

/**
 * 「**보이는 알림 지우기 n건**」을 포털에 적는 서버 액션의 모양 —
 * server/actions/notification-dismissals.ts 의 dismissAllNotificationsAction 과 같다.
 *
 * 🔴 위 둘과 같은 이유로 **받아서** 쓴다(직접 가져오지 않는다).
 *
 * 🔴 **열쇠 목록을 인자로 받는다** — 줄 하나짜리 ✕ 가 줄을 통째로 받는 것과 다른
 * 모양인데, 묶음이 내준 자리가 `onDismissAll?: () => void` 로 **인자를 안 받기**
 * 때문이다(@dss/ui README 「보이는 알림 지우기」). 곧 「무엇이 전부인가」를 정하는
 * 것은 이 껍데기이고, 그 값을 액션에 실어 보내는 것도 여기다.
 */
export type DismissAllNotifications = (keys: readonly string[]) => Promise<void>;

/** 화면에서 줄을 감췄다 되살리는 두 손잡이. 시험에서는 가짜를 넣는다. */
export type AcknowledgeView = {
  hide: (key: string) => void;
  restore: (key: string) => void;
};

/**
 * 눌린 줄 하나를 처리한다 — 우리 줄은 **가리고 · 미리 감추고 · 뒤에서 적는다**,
 * 포털 줄은 **가리고 · 포털에 적는다**(2026-10-22).
 *
 * 🔴 묶음은 **모든 줄에서** 이 경로로 들어온다. 우리 줄인지(sourceId 가 비었는지)와
 * 우리 열쇠 모양인지는 도메인 판정 한 곳(shouldAcknowledgeNotification)이
 * 정한다 — 서버 액션도 같은 함수를 부르므로 두 곳이 갈라지지 않는다.
 *
 * ── 🔴 2026-10-22 — 포털 줄도 이제 여기서 끝나지 않는다 ─────────────────
 * 그 전까지는 판정이 거짓이면(포털에서 온 줄) 곧바로 돌아갔다 — 「확인했다」를
 * 적을 수 있는 곳이 그 알림을 만든 시스템뿐이라고 보았기 때문이다. 이제
 * 포털에 확인을 적는 통로가 생겼다(dss-auth 의
 * /api/integration/notification-acknowledgements). **적히는 표**가 갈릴 뿐이다
 * — 우리 줄은 우리 표(notification_acknowledgements)에, 포털 줄은 포털
 * 한 곳에. 넘기는 **값**도 다르다 — 우리 줄은 `item.id`, 포털 줄은 `item.key`
 * 다(포털의 열쇠가 `{client_id}:{id}` 모양이라 `id` 만으로는 포털에서 그 줄을
 * 찾지 못한다 — domain/notifications.ts 의 bellKeyOf 머리말).
 *
 * 🔴 **제 줄은 여전히 포털로 가지 않는다.** `isOwn` 이 참이면 `acknowledgePortal`
 * 은 아예 쳐다보지도 않는다 — 두 갈래가 섞이지 않게 if/else 로 완전히 가른다.
 *
 * ── 먼저 감추는 이유(우리 줄만) ─────────────────────────────────────────
 * 서버가 준 목록은 저장이 끝나고 다시 계산될 때까지 그 줄을 그대로 들고
 * 있다. 기다렸다 감추면 이동이 느린 동안 방금 누른 줄이 그대로 보인다.
 * 저장이 실패하면 되살린다.
 *
 * ── 🔴 포털 줄은 **감추지 않는다** ──────────────────────────────────────
 * 이유 둘이다.
 *  · 이 줄의 href 는 다른 시스템의 절대 주소다. 누르면 **하드 네비게이션**
 *    으로 이 페이지를 떠난다(포트가 다르면 브라우저가 보는 출처가 달라
 *    새 페이지 로드다) — 감췄다 되살리는 장치가 뜻이 없다. 페이지 자체가
 *    새로 뜨므로 「감춘 채로 영영 안 돌아온다」가 될 일도 없다.
 *  · 아래 visibleCount 는 「감춘 수만큼 뺀다」를 **우리 줄 하나당 하나씩
 *    세어진다**는 전제 위에서 계산한다. 포털의 count 는 줄 수와 다를 수
 *    있어(normalizePortalNotificationFeed 시험 — A/S 가 같은 대상을 한 번만
 *    센다) 포털 줄까지 그 셈에 끌어들이면 배지가 잠깐 어긋난다. 어차피
 *    하드 네비게이션으로 떠나는 줄이라 감출 값어치가 없다.
 *
 * React 를 모르는 순수한 모양이라 시험이 그대로 불러 본다.
 */
export function acknowledgePickedNotification(
  item: NotificationBellItem,
  acknowledge: AcknowledgeNotification | undefined,
  view: AcknowledgeView,
  acknowledgePortal?: AcknowledgeNotification,
): void {
  if (shouldAcknowledgeNotification(item)) {
    if (!acknowledge) return;

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
    return;
  }

  // ── 포털에서 온 줄(2026-10-22) ──────────────────────────────────────────
  if (!acknowledgePortal) return;

  let pending: Promise<{ ok: boolean }>;
  try {
    pending = acknowledgePortal({ notificationKey: item.key });
  } catch {
    // 감춘 것이 없으니 되살릴 것도 없다 — 조용히 넘어간다.
    return;
  }

  // 🔴 처리되지 않은 거절을 남기지 않는다(위 우리 줄 갈래와 같은 까닭).
  void Promise.resolve(pending).catch(() => {});
}

/**
 * **지금 종에 그려지는 줄**의 열쇠를 모은다 — 「보이는 알림 지우기」가 지울 것들.
 *
 * ── 🔴 왜 `key` 인가 (`id` 가 아니라) ───────────────────────────────────
 * 지움은 **포털**에 적히고 포털의 열쇠는 `{client_id}:{id}` 다 — 제 줄도 2026-10-20
 * 부터 그 모양으로 만들어져 온다(domain 의 bellKeyOf). `id` 를 보내면 포털이 모양
 * 틀린 열쇠로 보고 조용히 버린다. 🔴 `id` 는 **확인 기록**(우리 DB)이 쓰는 값이고
 * 그 표에는 접두사 없는 옛 열쇠가 영구 저장돼 있다 — 두 값은 **다른 값**이고
 * 섞으면 안 된다(domain/notifications.ts 의 bellKeyOf 머리말).
 *
 * ── 🔴 왜 `isSafeNotificationHref` 로 한 번 거르나 ──────────────────────
 * 묶음은 **그릴 수 없는 주소의 줄을 안 그리고**, 단추에 적는 수도 그렇게 남은 줄
 * 수다(@dss/ui 의 drawable). 여기서 같은 기준으로 거르지 않으면 「보이는 알림
 * 지우기 3건」을 눌렀는데 4건이 지워진다 — 보이지도 않은 줄이 말없이 사라지는
 * 것이다. 🔴 거르는 함수를 **묶음에서 가져다 쓴다**(직접 적지 않는다). 둘이
 * 어긋날 수 없게.
 */
export function visibleNotificationKeys(items: readonly NotificationBellItem[]): string[] {
  const keys: string[] = [];
  for (const item of items) {
    if (!isSafeNotificationHref(item.href)) continue;
    if (item.key === "") continue;
    keys.push(item.key);
  }
  return keys;
}

/**
 * 「보이는 알림 지우기」를 눌렀을 때 — **지금 그려져 있는 줄 전부**를 지운다.
 *
 * 🔴 받는 목록은 **이미 걸러진 뒤의 것**이어야 한다(아래 조각이 `visibleItems` 를
 * 넘긴다). 서버가 만든 원본 목록을 넘기면 확인하느라 감춰 둔 줄까지 함께
 * 지워진다 — 사람이 보는 수와 지워지는 수가 어긋난다.
 *
 * 🔴 **밖으로 던지지 않는다.** 묶음의 곁들이 조각이 이 함수를 누름 처리
 * 한가운데서 부른다(BellBehavior 의 notifyDismissedAll). 그쪽도 한 번 더 받아
 * 주지만 그것은 **동기 예외뿐**이라, 돌려받은 약속이 깨지는 갈래는 여기서 받아야
 * 한다 — 안 받으면 「처리되지 않은 거절」이 되어 개발 중에는 화면에 오류판이 뜬다
 * (바로 위 확인 경로가 같은 까닭으로 두 갈래를 다 받는다).
 *
 * 🔴 **감추지 않는다.** 줄은 서버가 revalidate 로 목록을 다시 그릴 때 빠진다 —
 * 줄 하나짜리 ✕ 와 같은 모습이고, 까닭은 위 DismissNotification 머리말에 있다.
 *
 * React 를 모르는 순수한 모양이라 시험이 그대로 불러 본다.
 */
export function dismissVisibleNotifications(
  items: readonly NotificationBellItem[],
  dismissAll: DismissAllNotifications | undefined,
): void {
  if (!dismissAll) return;

  const keys = visibleNotificationKeys(items);
  // 🔴 보낼 것이 없으면 서버 왕복을 만들지 않는다. 묶음도 줄이 없으면 단추를
  //    아예 안 그리지만(@dss/ui), 이 함수는 그 약속에 기대지 않는다.
  if (keys.length === 0) return;

  let pending: Promise<void>;
  try {
    pending = dismissAll(keys);
  } catch {
    // 액션을 부르는 것 자체가 실패했다(망이 끊겼다든가). 줄은 종에 남는다.
    return;
  }

  void Promise.resolve(pending).then(
    () => {},
    () => {},
  );
}

export function NotificationBellWithAcknowledge({
  items,
  count,
  acknowledge,
  acknowledgePortal,
  dismiss,
  dismissAll,
}: {
  /** 🔴 서버가 이미 만들어 넘긴 목록 — 자기 것 앞, 포털에서 온 것 뒤. */
  items: readonly NotificationBellItem[];
  /** 🔴 보낸 쪽이 센 값. 다시 세지 않는다(@dss/ui README 의 「개수」). */
  count: number;
  /** 없으면 확인을 적지 않는다 — 줄은 이동만 하고 종에 남는다. */
  acknowledge?: AcknowledgeNotification;
  /**
   * 🔴 포털에서 온 줄(남의 시스템 알림)의 확인을 **포털에** 적는 자리
   * (2026-10-22). 없으면 그 줄은 지금까지와 같이 확인을 적지 않는다 — 줄은
   * 이동만 하고 종에 남는다. `acknowledge`(우리 표)와 **모양은 같지만 다른
   * 함수**다 — 적히는 곳이 다르다.
   */
  acknowledgePortal?: AcknowledgeNotification;
  /** 🔴 없으면 ✕ 가 **아예 그려지지 않는다**(@dss/ui 의 onDismiss). */
  dismiss?: DismissNotification;
  /**
   * 🔴 없으면 「보이는 알림 지우기 n건」 단추가 **아예 그려지지 않는다**
   * (@dss/ui 의 onDismissAll). 있어도 그릴 줄이 없으면 서지 않는다.
   */
  dismissAll?: DismissAllNotifications;
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

  /**
   * ── 🔴 일괄 지우기가 **여기서** 열쇠를 모으는 까닭 ──────────────────────
   * 묶음이 내준 자리는 `() => void` 로 **인자를 안 받는다.** 지울 열쇠를 아는
   * 것은 사이트이므로 누군가는 그 목록을 함수 안에 넣어 두어야 하는데, 그 자리가
   * 둘 있다:
   *  · **서버 조각**(PortalNotificationBell)에서 `액션.bind(null, 열쇠들)` 로
   *    미리 묶는다. 종이 서버 조각 하나뿐인 사이트(계측기)는 그 길밖에 없다 —
   *    서버→클라이언트 경계를 건널 수 있는 함수는 서버 액션뿐이라 평범한 화살표
   *    함수를 넘길 수 없기 때문이다.
   *  · 🔵 **이 껍데기**에서 모은다. 이 조각은 `"use client"` 라 평범한 함수를
   *    자유롭게 만들어 묶음에 넘길 수 있다 — 이 사이트에만 있는 길이다.
   *
   * 🔴 뒤쪽을 고른 까닭은 **수가 맞아야 하기 때문**이다. 묶음이 단추에 적는
   *    「n건」은 **이 조각이 넘긴 목록**(visibleItems)을 센 값인데, 그 목록은
   *    방금 눌러 확인하느라 감춰 둔 줄이 빠진 뒤의 것이다(hiddenKeys). 서버에서
   *    묶으면 그 감춘 줄을 알 길이 없어 「2건」을 눌렀는데 3건이 지워진다 —
   *    사람이 방금 확인한 줄까지 포털에 지움으로 적히는 것이다.
   *
   * 🔵 그래서 **서버 액션 자체는 그대로 건너온다**(위 dismissAll). 바뀌는 것은
   *    「인자를 어디서 채우는가」뿐이고, 값이 브라우저를 거쳐 온다는 점은 묶어
   *    넘기는 길과 똑같다 — 가리는 일은 서버 액션이 한다(vetDismissKeys).
   */
  const dismissVisible = dismissAll
    ? () => dismissVisibleNotifications(visibleItems, dismissAll)
    : undefined;

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
      // 🔴 열쇠를 모으는 자리는 바로 위다 — 그 까닭이 거기 적혀 있다.
      onDismissAll={dismissVisible}
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
        }, acknowledgePortal)
      }
    />
  );
}
