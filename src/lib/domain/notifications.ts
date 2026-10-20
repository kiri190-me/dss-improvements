import type { NotificationBellItem } from "@dss/ui";

import type { ImprovementRequestStatus } from "./improvement-request";
import { menuLabel, serviceLabel } from "./service-catalog";

/**
 * ============================================================================
 * 이 사이트의 **자체 알림** — 「아직 확인하지 않은 개선요청」
 * ============================================================================
 * 머리말의 종은 지금까지 **남의 시스템 알림만** 그렸다(PortalNotificationBell).
 * 이 파일이 이 사이트 자신의 알림을 만든다: 새 개선요청이 등록되면 관리자의
 * 종에 뜨고, 그 사람이 한 번 눌러 확인하면 다시 뜨지 않는다.
 *
 * ── 🔴 알림을 **저장하지 않는다** ────────────────────────────────────────
 * 알림 표는 없다. 개선요청 줄(업무 자료)에서 **매번 파생**하고, 사람이 눌러
 * 확인한 사실만 따로 적어 둔다(db/schema.ts 의 notification_acknowledgements).
 * A/S 시스템이 같은 길을 쓰고 그 까닭이 그쪽 표 머리말에 적혀 있다 — 알림을
 * 저장하면 업무 자료와 알림이 **두 벌의 진실**이 되어 언젠가 어긋난다.
 * 그래서 createImprovementRequest(db/mutations)는 알림에 대해 아무것도 하지
 * 않는다. 글이 한 줄 생기면 그것이 곧 알림이다.
 *
 * ── 🔴 상태로 거르지 않는다 (사용자 결정 2026-09-23) ─────────────────────
 * OPEN · IN_PROGRESS · RESOLVED 를 가리지 않고 **확인하지 않은 글 전부**가
 * 알림이다. 사용자가 정한 것은 「한 번 클릭해서 확인하면 다시 뜨지 않는 알림」
 * 이다. 상태로 거르면 **남이 상태를 옮기는 순간 내 종에서 사라져** 「내가 눌러
 * 확인했다」와 어긋난다 — 보는 사람은 자기가 누른 적 없는 줄이 사라진 것을
 * 알 길이 없다.
 *
 * ⚠️ 그래서 이 기능을 **처음 켤 때 이미 쌓여 있던 글이 한꺼번에 뜬다**
 *    (2026-09-23 개발 DB 기준 6건). 그것이 맞는 동작이다 — 아무도 아직 아무
 *    것도 확인하지 않았기 때문이다. 한 번씩 눌러 주면 그 뒤로는 새 글만 뜬다.
 *
 * ── 🔴 순수 계산만 한다 ──────────────────────────────────────────────────
 * DB 도 React 도 세션도 모른다. 받은 줄과 「이미 확인한 열쇠 목록」으로 종이
 * 받는 모양을 만들 뿐이다. 그래야 화면 없이(npm test) 규칙을 그대로 시험할 수
 * 있고, 조각 2에서 포털에 같은 목록을 내줄 때 **같은 계산을 두 번 적지 않아도**
 * 된다.
 * ============================================================================
 */

/** 알림 종류 코드. 알림 열쇠의 앞머리이기도 하다(아래 improvementRequestNotificationId). */
export const IMPROVEMENT_REQUEST_NOTIFICATION_KIND = "IMPROVEMENT_REQUEST";

/** 사람이 읽는 종류 이름. 🔴 색과 **함께 글자로도** 그려진다(@dss/ui 의 kindLabel). */
export const IMPROVEMENT_REQUEST_NOTIFICATION_KIND_LABEL = "새 개선요청";

/**
 * 누르면 갈 곳의 경로.
 *
 * 🔴 글 하나만 여는 화면이 **아직 없다** — 이 사이트의 화면은 목록 하나뿐이다
 * (app/(app)/page.tsx). 그래서 모든 줄이 같은 곳(목록)으로 간다. 글마다 다른
 * 주소가 생기면 고칠 곳은 이 상수와 아래 href 한 줄뿐이다.
 */
export const IMPROVEMENT_REQUEST_NOTIFICATION_PATH = "/";

/**
 * 종 한 줄에 실을 본문 미리보기의 길이(코드 포인트 수).
 *
 * 종의 상세 칸은 CSS 가 어차피 한 줄에서 자르지만(@dss/ui 의 .dss-bell__detail),
 * 여기서도 자르는 이유는 둘이다 — 본문은 2000자까지 들어갈 수 있고, 조각 2에서
 * 같은 글자가 **포털을 타고 다른 사이트로** 건너간다. 화면이 못 그릴 글자를
 * 망 너머로 보낼 이유가 없다.
 */
export const IMPROVEMENT_REQUEST_NOTIFICATION_DETAIL_MAX_CHARS = 60;

/**
 * 알림으로 만들 개선요청 한 줄.
 *
 * db/queries 의 ImprovementRequestListItem 이 이 칸들을 **전부 갖고 있다** —
 * 일부러 그 모양의 부분집합으로 적었다(조각 2에서 목록 조회 결과를 그대로 넘길
 * 수 있게). 이 타입이 db 를 import 하지 않는 것이 요점이다.
 */
export type ImprovementRequestNotificationSource = {
  /** 개선요청 행의 id(uuid). 알림 열쇠가 이 값에서 나온다. */
  id: string;
  serviceKey: string;
  menuKey: string | null;
  /** 사람이 적은 글. 앞머리만 미리보기로 쓴다. */
  body: string;
  /**
   * 🔴 **거르는 데 쓰지 않는다.** 칸이 여기 있는 것은 「상태를 받고도 일부러
   * 보지 않는다」를 타입으로 말해 두려는 것이다(머리말의 '상태로 거르지 않는다').
   */
  status: ImprovementRequestStatus;
  /** 적은 사람의 이름. 이관된 글은 계정이 없을 수 있어 null 이 온다. */
  createdByName: string | null;
};

export type ImprovementRequestNotificationFeed = {
  items: NotificationBellItem[];
  /**
   * 배지에 찍을 수.
   *
   * 여기서는 줄 수와 같다 — 개선요청 하나가 알림 하나라 「같은 대상을 두 번
   * 세는」 일이 없다(A/S 는 한 건에 결재가 둘 걸릴 수 있어 따로 센다).
   * 세는 곳을 한 곳으로 두려고 부르는 쪽이 다시 세지 않고 이 값을 쓴다.
   */
  count: number;
};

/**
 * 개선요청 id → 알림 열쇠.
 *
 * 🔴 **같은 요청에는 언제나 같은 값이 나와야 한다.** 파생된 알림과 확인 기록
 * (notification_acknowledgements.notification_key)을 잇는 것은 이 문자열 하나뿐
 * 이라, 이 값이 흔들리면 이미 확인한 알림이 다시 뜨거나 영영 사라진다. 그래서
 * 시각·상태·사람처럼 **변하는 것을 섞지 않는다** — 들어가는 것은 절대 바뀌지
 * 않는 행 id 뿐이고, 다듬지도(trim·소문자) 않는다.
 *
 * 앞머리를 붙이는 까닭: 확인 기록 표는 알림 종류를 모른다(종류가 늘 때마다
 * 마이그레이션이 필요해지지 않게 enum 을 쓰지 않았다). 종류가 둘이 되는 날
 * 열쇠끼리 부딪히지 않으려면 열쇠 자체가 종류를 말해야 한다.
 *
 * 길이는 `IMPROVEMENT_REQUEST:` + uuid = 56자라 표의 CHECK(1~200) 안이다.
 */
export function improvementRequestNotificationId(requestId: string): string {
  return `${IMPROVEMENT_REQUEST_NOTIFICATION_KIND}:${requestId}`;
}

/**
 * 알림 id → 종 한 줄의 **열쇠**(`key`).
 *
 * ── 🔴 왜 `id` 와 다른 값이 되었나 (2026-10-20) ─────────────────────────
 * 2026-10-19 까지 「이 알림 그만 보겠다」는 각 사이트의 **브라우저**에 적혔고,
 * 그래서 우리 줄은 `key` 와 `id` 가 같아도 아무 탈이 없었다. 지금은 그 기록이
 * **포털 한 곳**에 쌓인다 — 어느 시스템에서 지우든 사내 시스템 전부의 종에서
 * 사라지게 하려고 그렇게 바꿨다(dss-auth/docs/사이트-알림-통로.md).
 *
 * 포털에 적히는 열쇠는 **`{client_id}:{id}`** 다. 접두사가 없으면 같은 알림이
 * 개선요청 종에서는 `{id}`, 계측기 종에서는 `dss-improvements:{id}` 로 보여서
 * **계측기에서 지워도 개선요청 종에는 그대로 남는다** — 다른 곳에서는 사라지는데
 * 여기서만 남는, 제일 헷갈리는 모양이다.
 *
 * 🔴 **`id` 는 건드리지 않는다.** 확인 기록(notification_acknowledgements)과
 * 알림을 잇는 것은 `id` 하나뿐이고, 그 표에는 `(user_id, notification_key)` 에
 * 유일 제약이 걸려 **영구 저장**된다(db/schema.ts). 확인을 적는 쪽이 `item.key`
 * 를 쓰도록 바뀌면 옛 기록과 모양이 달라져 **이미 확인한 알림이 전부 다시 뜨고**,
 * 되돌릴 수도 없다(사람들이 다시 확인해야 한다). 확인 경로는 지금도
 * `item.id` 를 쓴다(components/NotificationBellWithAcknowledge.tsx).
 *
 * 🔴 접두사가 **빈 문자열이면 붙이지 않는다** — 설정을 못 읽었을 때 물러서는
 * 자리다. 그때 잃는 것은 제 줄 지움이 포털에 안 통하는 것 하나뿐이다.
 */
function bellKeyOf(id: string, clientId: string): string {
  return clientId === "" ? id : `${clientId}:${id}`;
}

/**
 * 절대 주소인지 보고 끝의 슬래시를 떼어 낸다.
 *
 * 🔴 **상대경로를 받지 않는다.** 자기 화면에서는 `/` 로도 잘 열리지만, 조각 2에서
 * 포털이 상대경로로 온 줄을 **버린다**(dss-auth 의 merge.ts). 같은 계산을 두 번
 * 적지 않으려면 지금부터 절대 주소여야 한다.
 *
 * 조용히 물러서지 않고 던지는 이유는 env.ts · lan-address.ts 와 같다 — 주소가
 * 틀린 채로 그럭저럭 도는 상태가 가장 오래 숨는다. 이 함수를 부르는 자리(조각 2)가
 * 종을 통째로 죽이지 않도록 삼키는 것은 그쪽 몫이다.
 */
function requireAbsoluteBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(\/\S*)?$/.test(trimmed)) {
    throw new Error(
      `알림 주소의 앞머리(baseUrl)는 http(s):// 로 시작하는 절대 주소여야 합니다(받은 값: ${baseUrl}).`,
    );
  }
  return trimmed;
}

/** 종 한 줄에 실을 본문 미리보기. 줄바꿈을 한 줄로 펴고 길면 … 로 끝낸다. */
function summarizeBody(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  const characters = Array.from(oneLine);
  if (characters.length <= IMPROVEMENT_REQUEST_NOTIFICATION_DETAIL_MAX_CHARS) return oneLine;
  return `${characters
    .slice(0, IMPROVEMENT_REQUEST_NOTIFICATION_DETAIL_MAX_CHARS)
    .join("")
    .trimEnd()}…`;
}

/**
 * 왼쪽에 굵게 오는 글자 — 「어느 시스템의 어느 메뉴 이야기인가」.
 *
 * 메뉴를 고르지 않은 글은 서비스 이름만 그린다. 「메뉴 지정 안 함」은 목록
 * 화면에서는 필요한 글자지만(빈 칸과 구별해야 한다) 종에서는 굵은 자리를
 * 차지할 값이 아니다.
 */
function subjectOf(request: ImprovementRequestNotificationSource): string {
  const service = serviceLabel(request.serviceKey);
  if (request.menuKey === null) return service;
  return `${service} · ${menuLabel(request.serviceKey, request.menuKey)}`;
}

/** 무슨 일인가 — 「누가 적었나」와 본문 앞머리. 이름이 없는 글(이관)은 본문만. */
function detailOf(request: ImprovementRequestNotificationSource): string {
  const summary = summarizeBody(request.body);
  const name = request.createdByName?.trim() ?? "";
  if (name === "") return summary;
  return `${name}: ${summary}`;
}

/**
 * 개선요청 줄 + 이미 확인한 열쇠 → 종이 받는 목록.
 *
 * ── 차례는 받은 그대로다 ────────────────────────────────────────────────
 * 여기서 다시 정렬하지 않는다. 목록 조회가 이미 최신 글부터 준다
 * (db/queries/improvement-requests.ts). 두 곳에서 각자 정렬하면 종과 목록의
 * 차례가 언젠가 갈린다.
 *
 * ── 🔴 아홉 칸이 전부 채워진다 ──────────────────────────────────────────
 * @dss/ui 의 NotificationBellItem 은 아홉 칸이 모두 필수 string 이고, **없는
 * 값은 빈 문자열**이다(undefined·null 이 아니다 — 포털이 그렇게 싣고 타입이
 * 그것을 거울처럼 따른다).
 *
 * ── 🔴 sourceId · sourceName 이 빈 문자열인 까닭 ────────────────────────
 * 「어느 시스템에서 왔는가」인데, 이것은 **이 사이트 자신의 알림**이라 보는
 * 사람이 이미 여기 있다(묶음은 빈 문자열이면 그 칸을 아예 안 그린다). 더
 * 중요한 것은 이 빈 값이 **「확인을 적을 수 있는 줄」의 표시**라는 점이다 —
 * 조각 2·3에서 종이 눌린 줄을 받았을 때 sourceId 가 비어 있으면 우리 것이라
 * 확인을 적고, 값이 있으면 남의 시스템 것이라 적지 않는다(A/S 의
 * components/layout/NotificationBell.tsx 가 같은 줄로 가른다).
 */
export function buildImprovementRequestNotifications(input: {
  requests: readonly ImprovementRequestNotificationSource[];
  /** 이 사람이 이미 확인한 알림 열쇠. notification_acknowledgements 에서 온다. */
  acknowledgedKeys: Iterable<string>;
  /** 이 사이트의 주소 앞머리. 🔴 절대 주소여야 한다(requireAbsoluteBaseUrl). */
  baseUrl: string;
  /**
   * 포털에 등록된 이 시스템의 식별자(`SSO_CLIENT_ID`). 🔴 **`key` 의 접두사**다 —
   * 위 bellKeyOf 머리말이 왜 필요한지 적고 있다.
   *
   * 🔴 **빈 문자열이면 접두사 없이 만든다**(2026-10-20 이전 모양). 안 넘기는 것과
   * 같은 뜻이고, 부르는 쪽이 설정을 못 읽었을 때 **물러서는 자리**다 — 설정 하나
   * 때문에 종이, 곧 모든 화면이 깨지면 안 된다(db/queries/notifications.ts 의
   * ownNotificationClientId). 그 경우 잃는 것은 **제 줄 지움이 포털에 안 통하는
   * 것** 하나뿐이고, 종은 예전 그대로 그려진다.
   */
  clientId?: string;
}): ImprovementRequestNotificationFeed {
  const href = `${requireAbsoluteBaseUrl(input.baseUrl)}${IMPROVEMENT_REQUEST_NOTIFICATION_PATH}`;
  const acknowledged = new Set(input.acknowledgedKeys);
  const seen = new Set<string>();
  const items: NotificationBellItem[] = [];

  for (const request of input.requests) {
    const id = improvementRequestNotificationId(request.id);

    // 이미 눌러 확인한 것은 여기서 빠진다 — 이 한 줄이 「한 번 확인하면 다시
    // 뜨지 않는다」의 전부다.
    if (acknowledged.has(id)) continue;

    // key 는 목록 안에서 유일해야 한다(React key 이자 눌린 줄을 되찾는 열쇠다).
    // 같은 글이 두 번 실려 오는 일은 정상적으로는 없지만, 그렇다면 이 줄은
    // 공짜다 — 만약 일어난다면 종이 줄을 잘못 지운다.
    if (seen.has(id)) continue;
    seen.add(id);

    items.push({
      // 🔴 `{client_id}:{id}` — 포털에 지움이 적히는 그 열쇠다(bellKeyOf).
      //    🔴 **`id` 와 다른 값이다.** 확인 기록은 그대로 `id` 로 적힌다.
      key: bellKeyOf(id, input.clientId ?? ""),
      sourceId: "",
      sourceName: "",
      id,
      kind: IMPROVEMENT_REQUEST_NOTIFICATION_KIND,
      kindLabel: IMPROVEMENT_REQUEST_NOTIFICATION_KIND_LABEL,
      subject: subjectOf(request),
      detail: detailOf(request),
      href,
    });
  }

  return { items, count: items.length };
}

/* ------------------------------------------------------------------ */
/* 🔴 포털이 돌려준 지움으로 **제 줄**을 거른다                           */
/* ------------------------------------------------------------------ */

/**
 * 「그만 보겠다」로 지워진 제 줄을 목록에서 뺀다.
 *
 * ── 🔴 왜 이 일이 우리 몫인가 ──────────────────────────────────────────
 * **남의 시스템 줄**은 포털이 제 손으로 걸러서 보낸다 — `items` 에서 빠져 있고
 * `count` 도 그만큼 줄어 있어 우리가 할 일이 없다(그래서 `feed.count` 는 **손대지
 * 않는다**). 할 일이 남는 것은 **제 줄**뿐이다: 포털은 부른 사이트 자신에게는
 * 묻지 않아(규격서 「빠져 있는 것」) 이 목록을 애초에 모르고, 그것을 거르라고
 * `dismissed` 를 함께 보낸다.
 *
 * 🔴 **안 거르면 「여기서 지웠는데 여기서만 그대로 뜬다」가 된다.**
 *
 * 🔴 **개수도 함께 줄인다.** 줄은 빠졌는데 배지 숫자가 그대로면 사람은 「알림이
 * 있다는데 열면 없다」로 읽는다. 지금 이 시스템의 `count` 는 줄 수와 같지만
 * (한 요청이 한 줄이다) **0 아래로 내려가지 않게** 바닥을 둔다 — 세는 규칙이
 * 바뀌거나(묶음 줄·상한에 잘린 목록) 이미 사라진 줄의 지움 기록이 섞여 와도
 * 배지가 음수가 되지 않게.
 *
 * 🔵 **열쇠를 다시 조립하지 않는다.** 만들어진 `item.key` 를 그대로 맞춰 본다 —
 * 여기서 접두사를 다시 지으면 만드는 자리(bellKeyOf)와 갈라질 수 있고, 갈라지면
 * 아무 오류 없이 「지워지지 않는 알림」만 남는다.
 *
 * 망도 DB 도 타지 않는 **순수 함수**라 그대로 불러 시험한다.
 */
export function withoutDismissed(
  mine: { items: readonly NotificationBellItem[]; count: number },
  dismissed: readonly string[],
): ImprovementRequestNotificationFeed {
  if (dismissed.length === 0) return { items: [...mine.items], count: mine.count };

  const hidden = new Set(dismissed);
  const items = mine.items.filter((item) => !hidden.has(item.key));
  const removed = mine.items.length - items.length;
  if (removed === 0) return { items, count: mine.count };

  return { items, count: Math.max(0, mine.count - removed) };
}

/* ------------------------------------------------------------------ */
/* 포털에 내줄 모양으로 옮겨 담기                                        */
/* ------------------------------------------------------------------ */

/**
 * 한 시스템이 포털에 보낼 수 있는 줄 수의 상한.
 *
 * 🔴 포털이 받은 목록을 **200줄에서 자른다**(dss-auth 의 merge.ts 의
 * MAX_ITEMS_PER_SOURCE). 그보다 많이 보내는 것은 버려질 바이트를 1.5초짜리
 * 왕복(그쪽 READ_TIMEOUT_MS)에 싣는 일이다. 그래서 여기서 먼저 자른다.
 */
export const PORTAL_MAX_ITEMS_PER_SOURCE = 200;

/**
 * 내 종에 실을 줄 → **포털에 내줄 줄**.
 *
 * ── 🔴 같은 알림인데 두 방향에서 모양이 다르다 ──────────────────────────
 * 내 화면의 종에 넣을 때는 `sourceId`·`sourceName` 이 **빈 문자열**이다 —
 * 「우리 줄이니 여기서 확인을 적을 수 있다」는 표시다(shouldAcknowledgeNotification).
 * 포털에 내줄 때는 그 두 칸에 **우리 이름표**를 적는다 — 받는 쪽에서는 우리가
 * 「남의 시스템」이고, 보는 사람이 어느 시스템 알림인지 알아야 한다.
 * `key` 도 `client_id:id` 가 된다(여러 시스템의 줄이 한 목록에 섞이므로 id 만으로는
 * 부딪힌다).
 *
 * 🔵 2026-10-20 부터 **내 종에 넣는 줄도 같은 모양의 `key`** 를 들고 온다
 * (bellKeyOf — 지움이 포털에 적히기 때문이다). 그래서 아래 덮어쓰기는 대개 같은
 * 값을 다시 적는 일이 되었다. 그래도 **`item.id` 에서 다시 만든다** — 설정을 못
 * 읽어 접두사 없이 만들어진 줄이 섞여 와도 포털에는 규격대로 나가야 한다.
 *
 * ⚠️ 실측(2026-09-23): 포털은 이 세 칸을 **제 등록 정보로 덮어쓴다**
 * (merge.ts 의 `key: \`${source.clientId}:${id}\``). 그래도 규격대로 채워 보내는
 * 것은, 포털이 덮어쓰는 것은 그쪽 사정이고 우리 답은 그 자체로 말이 되어야 하기
 * 때문이다(규격서 「답 (200)」의 아홉 칸).
 *
 * 🔴 포털이 **버리는 줄**이 있다 — `id`·`href`·`subject` 중 하나라도 비었거나
 * `href` 가 절대 주소가 아니면 그 줄만 버린다(merge.ts). 우리 줄은 만드는 자리에서
 * 이미 셋 다 채워져 있고 href 는 절대 주소다(buildImprovementRequestNotifications).
 *
 * 개수는 **보내는 줄 수**다. 포털이 `min(받은 count, 줄 수)` 로 깎으므로
 * (merge.ts), 자른 뒤의 줄 수보다 큰 수를 적어 보내는 것은 뜻이 없다.
 */
export function toPortalNotificationFeed(
  items: readonly NotificationBellItem[],
  source: { clientId: string; sourceName: string },
): ImprovementRequestNotificationFeed {
  const capped = items.slice(0, PORTAL_MAX_ITEMS_PER_SOURCE).map((item) => ({
    ...item,
    key: `${source.clientId}:${item.id}`,
    sourceId: source.clientId,
    sourceName: source.sourceName,
  }));

  return { items: capped, count: capped.length };
}

/* ------------------------------------------------------------------ */
/* 확인(눌러서 읽음)을 적을 수 있는 줄인가                               */
/* ------------------------------------------------------------------ */

/**
 * 이 열쇠가 **우리가 만든 알림의 열쇠**인가.
 *
 * 🔴 확인을 적는 서버 액션이 이 판정으로 막는다. 종에서 오는 값은 **브라우저를
 * 거쳐 온 글자**라, 그 안에는 포털이 실어 준 남의 시스템 알림 id(`APPROVAL:123`
 * 같은 것)도 있고 사람이 손으로 지어낸 글자도 올 수 있다. 걸러 내지 않으면 우리
 * 확인 기록 표에 **아무 의미 없는 줄이 쌓인다** — 아무 오류도 없이, 정작 그
 * 알림은 남의 종에 그대로 남은 채로.
 *
 * 모양을 통째로 본다(앞머리 + uuid). 길이만 보면(표의 CHECK) 아무 글자나 200자
 * 안에서 통과한다.
 *
 * 대소문자를 가린다 — PostgreSQL 의 uuid 는 언제나 소문자로 나오고, 유니크
 * 색인도 글자 그대로 본다. 대문자를 받아 주면 같은 요청에 대소문자가 다른 확인
 * 기록이 두 줄 생기고, 둘 다 아무것도 걸러 내지 못한다.
 */
const OWN_NOTIFICATION_KEY_PATTERN = new RegExp(
  `^${IMPROVEMENT_REQUEST_NOTIFICATION_KIND}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
);

export function isOwnNotificationKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // 표의 CHECK(1~200)와 같은 선. 모양 검사가 이미 길이를 정해 두지만, 종류가
  // 늘었을 때 이 줄을 지우지 않으면 길이 방어선도 함께 남는다.
  if (value.length < 1 || value.length > 200) return false;
  return OWN_NOTIFICATION_KEY_PATTERN.test(value);
}

/**
 * 이 줄을 눌렀을 때 **확인을 적어야 하는가**.
 *
 * 🔴 묶음 종은 **모든 줄에서** 확인 함수를 부른다(@dss/ui 의 BellBehavior). 「적을
 * 수 있는 줄인가」는 묶음이 알 수 없는 우리 쪽 사정이라, 그 판정을 **이 함수 한
 * 곳**에 둔다 — 화면(클라이언트 껍데기)과 서버 액션이 **같은 함수**를 부른다.
 * 두 곳에 따로 적으면 한쪽만 느슨해지는 날이 온다.
 *
 * 두 가지를 본다:
 *  · `sourceId` 가 **비어 있는가** — 포털에서 온 줄에는 값이 있다. 「확인했다」를
 *    적을 수 있는 곳은 그 알림을 만든 시스템뿐이고, 포털에 그 통로는 아직 없다
 *    (A/S 의 components/layout/NotificationBell.tsx 가 같은 줄로 가른다).
 *  · 열쇠가 **우리 모양인가** — 위 isOwnNotificationKey. 🔴 sourceId 는 브라우저를
 *    거쳐 오므로 그 값 하나만 믿지 않는다.
 */
export function shouldAcknowledgeNotification(item: {
  id: string;
  sourceId?: string;
}): boolean {
  if (item.sourceId) return false;
  return isOwnNotificationKey(item.id);
}

/**
 * 줄 여럿 → **한꺼번에 확인으로 적을 열쇠들**(중복 없이, 받은 차례대로).
 *
 * ── 🔴 왜 「한꺼번에」가 생겼나 (2026-09-23, 사용자 결정) ────────────────
 * 처음 정한 것은 「한 번 클릭해서 확인하면 다시 뜨지 않는 알림」 하나뿐이었다.
 * 같은 날 사용자가 동작을 하나 더했다 — **개선요청 화면에 들어오면 그 시점의 내
 * 개선요청 알림이 전부 사라진다.** 까닭은 사용자의 말 그대로다:
 *
 *   「창에 들어오면 한꺼번에 사라지는 이유는 **개선 요청 창에서 개선 요청들을
 *     한번에 볼 수 있기 때문**이야.」
 *
 * 즉 **화면에 들어온 것 자체가 「다 봤다」**는 뜻이다 — 이 사이트는 목록 화면
 * 하나에 모든 요청이 한눈에 보이므로, 들어온 사람은 이미 전부 본 것이다.
 *
 * 🔴 **글 하나만 여는 화면(상세)이 생기면 이 전제가 흔들린다.** 그때는 목록이
 * 「한눈에」가 아니게 되고(가려진 글이 생긴다), 이 결정을 다시 볼 자리가 여기다.
 *
 * 🔴 **줄 하나 누르기는 그대로 남는다.** 조각 3이 오면 포털 타일에도 점이 뜨는데,
 * 개선요청 사이트를 열지 않고도 확인할 길이 있어야 한다.
 *
 * ── 가르는 규칙은 하나다 ────────────────────────────────────────────────
 * 「전부」라고 해서 아무 줄이나 적지 않는다 — 줄 하나를 누를 때와 **같은 판정**
 * (shouldAcknowledgeNotification)을 쓴다. 그래서 포털에서 온 줄은 여기서도 빠진다.
 * 같은 열쇠가 두 번 들어오면 한 번만 남긴다(한 문장에 같은 줄을 두 번 실을 이유가
 * 없다).
 */
export function acknowledgeableNotificationKeys(
  items: readonly { id: string; sourceId?: string }[],
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!shouldAcknowledgeNotification(item)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    keys.push(item.id);
  }

  return keys;
}
