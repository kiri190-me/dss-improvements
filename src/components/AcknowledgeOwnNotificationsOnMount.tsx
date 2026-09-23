"use client";

import { useEffect, useRef } from "react";

/**
 * ============================================================================
 * 개선요청 화면에 **들어왔다** — 쌓여 있던 내 알림을 한꺼번에 확인으로 적는다
 * ============================================================================
 * 아무것도 그리지 않는다(null). 화면이 떴을 때 서버 액션을 **한 번** 부르는 것이
 * 이 조각의 전부다.
 *
 * ── 왜 이 동작이 있나 (2026-09-23, 사용자 결정) ─────────────────────────
 * 사용자의 말 그대로다:
 *
 *   「창에 들어오면 한꺼번에 사라지는 이유는 **개선 요청 창에서 개선 요청들을
 *     한번에 볼 수 있기 때문**이야.」
 *
 * 즉 **화면에 들어온 것 자체가 「다 봤다」**는 뜻이다 — 이 사이트는 목록 화면
 * 하나에 모든 요청이 한눈에 보이므로, 들어온 사람은 이미 전부 본 것이다.
 * 🔴 **글 하나만 여는 화면(상세)이 생기면 이 전제가 흔들린다**(가려진 글이
 * 생긴다) — 그때 이 결정을 다시 볼 자리다.
 *
 * 🔴 종에서 **줄 하나를 누르는 길은 그대로 남는다**(NotificationBellWithAcknowledge).
 * 조각 3에서 포털 타일에도 점이 뜨는데, 이 사이트를 열지 않고도 확인할 길이
 * 있어야 한다.
 *
 * ── 🔴 왜 서버 컴포넌트에서 부르지 않나 ─────────────────────────────────
 * 목록 화면(app/(app)/page.tsx)은 서버 조각이고 **GET 요청으로 그려진다.**
 * 거기서 DB 에 쓰면 새로고침 · 링크 미리 가져오기(prefetch) · 봇 · 미리보기가
 * 전부 쓰기를 일으킨다. GET 은 아무것도 바꾸지 않아야 한다. 그래서 **그려진
 * 뒤에 브라우저가** 서버 액션을 부른다(POST).
 *
 * ── 🔴 먼저 그리고 나중에 부른다 ────────────────────────────────────────
 * 목록은 이 왕복을 기다리지 않는다. 저장이 늦어도 · 실패해도 화면은 그대로다 —
 * 실패하면 알림이 종에 남고 다음에 들어올 때 다시 적는다. 그래서 결과를
 * 보지 않고, 어떤 거절도 삼킨다.
 * ============================================================================
 */

/** 확인을 전부 적는 서버 액션의 모양. 🔴 **인자가 없다**(그 파일 머리말). */
export type AcknowledgeAllNotifications = () => Promise<{ ok: boolean }>;

/** 「이미 불렀는가」를 담아 두는 상자. 시험에서는 평범한 객체를 넣는다. */
export type AcknowledgeAllGuard = { started: boolean };

/**
 * **딱 한 번만** 부른다.
 *
 * 🔴 왜 막아야 하나: React 의 개발 모드(StrictMode)는 조각을 띄웠다 내렸다 다시
 * 띄워 효과를 **두 번** 돌린다. `ON CONFLICT DO NOTHING` 이라 자료가 망가지지는
 * 않지만 서버 왕복이 두 번 나간다. 상자(ref)는 그 사이에도 살아남으므로 두 번째는
 * 여기서 멈춘다. 서버가 종을 다시 계산해 이 화면이 다시 그려질 때도 같다.
 *
 * React 를 모르는 모양이라 시험이 그대로 불러 본다.
 */
export function acknowledgeAllOnce(
  guard: AcknowledgeAllGuard,
  acknowledgeAll?: AcknowledgeAllNotifications,
): void {
  if (guard.started) return;
  guard.started = true;
  if (!acknowledgeAll) return;

  let pending: Promise<{ ok: boolean }>;
  try {
    pending = acknowledgeAll();
  } catch {
    // 부르는 것 자체가 실패했다 — 알림이 종에 남을 뿐이다.
    return;
  }

  // 🔴 두 갈래를 다 받는다. 두 번째 인자가 없으면 거절이 「처리되지 않은 거절」이
  //    되어 개발 중에는 화면에 오류판이 뜬다 — 알림 하나 때문에 화면이 깨진다.
  void Promise.resolve(pending).then(
    () => {},
    () => {},
  );
}

export function AcknowledgeOwnNotificationsOnMount({
  acknowledgeAll,
}: {
  /**
   * 🔴 액션 파일을 여기서 직접 가져오지 않고 **받아서** 쓴다(껍데기 종과 같다).
   * 그 파일은 세션과 DB 를 물고 있어 시험이 불러 볼 수 없다.
   * 없으면 아무 일도 하지 않는다.
   */
  acknowledgeAll?: AcknowledgeAllNotifications;
}): null {
  const guard = useRef<AcknowledgeAllGuard>({ started: false });

  useEffect(() => {
    acknowledgeAllOnce(guard.current, acknowledgeAll);
  }, [acknowledgeAll]);

  return null;
}
