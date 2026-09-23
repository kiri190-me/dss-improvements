import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeableNotificationKeys,
  IMPROVEMENT_REQUEST_NOTIFICATION_DETAIL_MAX_CHARS,
  IMPROVEMENT_REQUEST_NOTIFICATION_KIND,
  IMPROVEMENT_REQUEST_NOTIFICATION_KIND_LABEL,
  buildImprovementRequestNotifications,
  improvementRequestNotificationId,
  isOwnNotificationKey,
  shouldAcknowledgeNotification,
  type ImprovementRequestNotificationSource,
} from "./notifications";

/**
 * ============================================================================
 * 🔴 자체 알림 — 「확인하지 않은 개선요청」이 종에 실리는 규칙
 * ============================================================================
 * 여기서 못 박는 것 여섯:
 *  1. 한 번 확인한 것은 빠지고, 안 한 것만 남는다.
 *  2. 같은 요청이면 **언제나 같은 알림 열쇠**다 — 이 값이 흔들리면 확인 기록이
 *     알림을 놓쳐 이미 확인한 줄이 되살아난다.
 *  3. 아홉 칸이 전부 있고 undefined·null 이 하나도 없다(@dss/ui 의 약속).
 *  4. sourceId 가 빈 문자열이다 — 「확인을 적을 수 있는 우리 줄」의 표시다.
 *  5. href 가 절대 주소다 — 조각 2에서 포털이 상대경로를 버린다.
 *  6. 🔴 RESOLVED 인 글도 확인 전이면 남는다. **일부러 그런 것**이라 시험이
 *     그렇게 말한다(사용자 결정 2026-09-23 — 상태로 거르면 남이 상태를 옮기는
 *     순간 내 종에서 사라진다).
 *
 * DB 도 화면도 부르지 않는다 — 순수 함수라 그럴 수 있다(unit.txt 의 규칙).
 * ============================================================================
 */

const BASE_URL = "http://192.168.1.132:3500";

/** 종이 받는 한 줄의 아홉 칸. 이 목록이 @dss/ui 의 타입과 같아야 한다. */
const BELL_ITEM_FIELDS = [
  "detail",
  "href",
  "id",
  "key",
  "kind",
  "kindLabel",
  "sourceId",
  "sourceName",
  "subject",
] as const;

function request(
  overrides: Partial<ImprovementRequestNotificationSource> = {},
): ImprovementRequestNotificationSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    serviceKey: "rf-service-system",
    menuKey: "repairCases",
    body: "목록에서 고객명으로 검색이 안 됩니다.",
    status: "OPEN",
    createdByName: "김아무개",
    ...overrides,
  };
}

/* ── 1. 확인한 것은 빠진다 ────────────────────────────────────────────── */

test("확인한 열쇠는 빠지고, 확인하지 않은 것만 남는다", () => {
  const first = request({ id: "aaaaaaaa-1111-4111-8111-111111111111" });
  const second = request({ id: "bbbbbbbb-2222-4222-8222-222222222222" });
  const third = request({ id: "cccccccc-3333-4333-8333-333333333333" });

  const feed = buildImprovementRequestNotifications({
    requests: [first, second, third],
    acknowledgedKeys: [improvementRequestNotificationId(second.id)],
    baseUrl: BASE_URL,
  });

  assert.deepEqual(
    feed.items.map((item) => item.id),
    [
      improvementRequestNotificationId(first.id),
      improvementRequestNotificationId(third.id),
    ],
  );
  assert.equal(feed.count, 2);
});

test("전부 확인했으면 목록도 개수도 비어 있다 — 종 자체가 그려지지 않는 상태다", () => {
  const only = request();
  const feed = buildImprovementRequestNotifications({
    requests: [only],
    acknowledgedKeys: [improvementRequestNotificationId(only.id)],
    baseUrl: BASE_URL,
  });

  assert.deepEqual(feed.items, []);
  assert.equal(feed.count, 0);
});

test("글이 하나도 없으면 개수가 0 이다", () => {
  const feed = buildImprovementRequestNotifications({
    requests: [],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  assert.deepEqual(feed.items, []);
  assert.equal(feed.count, 0);
});

test("남의 확인 기록(모르는 열쇠)은 아무것도 걸러 내지 않는다", () => {
  const feed = buildImprovementRequestNotifications({
    requests: [request()],
    acknowledgedKeys: ["IMPROVEMENT_REQUEST:99999999-9999-4999-8999-999999999999", "APPROVAL:7"],
    baseUrl: BASE_URL,
  });

  assert.equal(feed.count, 1);
});

/* ── 2. 🔴 같은 요청이면 언제나 같은 열쇠 ─────────────────────────────── */

test("🔴 같은 개선요청 id 는 언제나 같은 알림 열쇠를 낸다 — 확인 기록이 이 값으로만 이어진다", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(improvementRequestNotificationId(id), improvementRequestNotificationId(id));
  assert.equal(improvementRequestNotificationId(id), `IMPROVEMENT_REQUEST:${id}`);

  // 🔴 변하는 것(상태·사람·본문)이 섞이지 않는다. 같은 글의 상태가 옮겨져도
  //    열쇠는 그대로여야 한다 — 아니면 이미 확인한 줄이 되살아난다.
  const opened = buildImprovementRequestNotifications({
    requests: [request({ id, status: "OPEN", body: "처음 적은 글", createdByName: "김아무개" })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });
  const resolved = buildImprovementRequestNotifications({
    requests: [request({ id, status: "RESOLVED", body: "고쳐 적은 글", createdByName: null })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  assert.equal(opened.items[0].id, resolved.items[0].id);
  assert.equal(opened.items[0].key, resolved.items[0].key);
});

test("열쇠는 확인 기록 표의 길이 제한(1~200자) 안이다", () => {
  const key = improvementRequestNotificationId("11111111-1111-4111-8111-111111111111");
  assert.ok(key.length >= 1 && key.length <= 200, `열쇠가 ${key.length}자다`);
});

test("열쇠는 종류 코드로 시작한다 — 종류가 둘이 되는 날 열쇠끼리 부딪히지 않게", () => {
  assert.ok(
    improvementRequestNotificationId("x").startsWith(`${IMPROVEMENT_REQUEST_NOTIFICATION_KIND}:`),
  );
});

test("목록 안의 key 는 유일하다 — 같은 글이 두 번 실려 와도 한 줄이다", () => {
  const twice = request();
  const feed = buildImprovementRequestNotifications({
    requests: [twice, twice],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  assert.equal(feed.items.length, 1);
  assert.equal(feed.count, 1);
  assert.equal(new Set(feed.items.map((item) => item.key)).size, feed.items.length);
});

/* ── 3. 🔴 아홉 칸이 전부 채워진다 ────────────────────────────────────── */

test("🔴 아홉 칸이 전부 있고 undefined·null 이 하나도 없다", () => {
  const feed = buildImprovementRequestNotifications({
    // 비어 있을 수 있는 칸을 전부 비운 줄로 본다 — 여기서 빈 값이 생긴다면 생긴다.
    requests: [request({ menuKey: null, createdByName: null })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  const [item] = feed.items;
  assert.ok(item, "줄이 만들어지지 않았다");
  assert.deepEqual(Object.keys(item).sort(), [...BELL_ITEM_FIELDS]);

  for (const field of BELL_ITEM_FIELDS) {
    const value = item[field];
    assert.equal(typeof value, "string", `${field} 가 글자가 아니다: ${String(value)}`);
    assert.notEqual(value, undefined, `${field} 가 undefined 다`);
    assert.notEqual(value, null, `${field} 가 null 이다`);
  }

  // 「없음」은 빈 문자열이지, 빈 자리가 아니다. 그리지 않을 칸은 종이 고른다.
  assert.equal(item.sourceName, "");
  // 굵은 칸과 종류 이름은 언제나 글자가 있다 — 빈 줄처럼 보이면 안 된다.
  assert.notEqual(item.subject, "");
  assert.notEqual(item.kindLabel, "");
  assert.notEqual(item.detail, "");
});

test("종류 코드와 사람이 읽는 이름을 싣는다 — 이름은 한국어다", () => {
  const [item] = buildImprovementRequestNotifications({
    requests: [request()],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  }).items;

  assert.equal(item.kind, IMPROVEMENT_REQUEST_NOTIFICATION_KIND);
  assert.equal(item.kindLabel, IMPROVEMENT_REQUEST_NOTIFICATION_KIND_LABEL);
  assert.match(item.kindLabel, /[가-힣]/);
});

test("굵은 칸은 서비스와 메뉴 이름이고, 메뉴를 고르지 않은 글은 서비스만 그린다", () => {
  const withMenu = buildImprovementRequestNotifications({
    requests: [request({ serviceKey: "rf-service-system", menuKey: "repairCases" })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  }).items[0];
  assert.equal(withMenu.subject, "DSS A/S 관리 시스템 · 전체 A/S 현황");

  const withoutMenu = buildImprovementRequestNotifications({
    requests: [request({ serviceKey: "rf-service-system", menuKey: null })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  }).items[0];
  assert.equal(withoutMenu.subject, "DSS A/S 관리 시스템");
});

test("상세 칸은 「누가」와 본문 앞머리이고, 긴 본문은 … 로 끝난다", () => {
  const short = buildImprovementRequestNotifications({
    requests: [request({ createdByName: "김아무개", body: "검색이 안 됩니다." })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  }).items[0];
  assert.equal(short.detail, "김아무개: 검색이 안 됩니다.");

  // 이름이 없는 글(이관)은 본문만 — 「: 」 만 덩그러니 남지 않는다.
  const nameless = buildImprovementRequestNotifications({
    requests: [request({ createdByName: null, body: "검색이 안 됩니다." })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  }).items[0];
  assert.equal(nameless.detail, "검색이 안 됩니다.");

  // 줄바꿈은 한 줄로 펴고, 길면 자른다(자른 뒤 길이는 상한 + …).
  const long = buildImprovementRequestNotifications({
    requests: [request({ createdByName: null, body: `첫 줄\n두 번째 줄 ${"가".repeat(200)}` })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  }).items[0];
  assert.equal(long.detail.includes("\n"), false, "줄바꿈이 그대로 실렸다");
  assert.ok(long.detail.endsWith("…"), "잘린 표시가 없다");
  assert.equal(
    Array.from(long.detail).length,
    IMPROVEMENT_REQUEST_NOTIFICATION_DETAIL_MAX_CHARS + 1,
  );
});

/* ── 4. 🔴 sourceId 는 빈 문자열이다 ──────────────────────────────────── */

test("🔴 sourceId 가 빈 문자열이다 — 「확인을 적을 수 있는 우리 줄」이라는 표시다", () => {
  const feed = buildImprovementRequestNotifications({
    requests: [request(), request({ id: "bbbbbbbb-2222-4222-8222-222222222222" })],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  for (const item of feed.items) {
    assert.equal(item.sourceId, "", "🔴 sourceId 에 값이 실렸다 — 확인이 적히지 않는 줄이 된다");
    assert.equal(item.sourceName, "");
    // 우리 줄은 key 와 id 가 같다. 포털을 거쳐 온 줄만 `client_id:id` 로 갈라진다.
    assert.equal(item.key, item.id);
  }
});

/* ── 5. 🔴 href 는 절대 주소다 ────────────────────────────────────────── */

test("🔴 href 가 http 로 시작한다 — 조각 2에서 포털이 상대경로를 버린다", () => {
  const [item] = buildImprovementRequestNotifications({
    requests: [request()],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  }).items;

  assert.ok(item.href.startsWith("http"), `절대 주소가 아니다: ${item.href}`);
  assert.equal(item.href, `${BASE_URL}/`);
  assert.doesNotThrow(() => new URL(item.href));
});

test("주소 앞머리의 끝 슬래시가 겹치지 않는다", () => {
  const [item] = buildImprovementRequestNotifications({
    requests: [request()],
    acknowledgedKeys: [],
    baseUrl: `${BASE_URL}//`,
  }).items;

  assert.equal(item.href, `${BASE_URL}/`);
});

test("🔴 상대경로를 받으면 조용히 넘어가지 않고 멈춘다", () => {
  for (const bad of ["", "/", "   ", "192.168.1.132:3500", "ftp://192.168.1.132"]) {
    assert.throws(
      () =>
        buildImprovementRequestNotifications({
          requests: [request()],
          acknowledgedKeys: [],
          baseUrl: bad,
        }),
      /절대 주소/,
      `"${bad}" 를 받아들였다`,
    );
  }
});

/* ── 6. 🔴 상태로 거르지 않는다 ───────────────────────────────────────── */

test("🔴 RESOLVED 인 글도 확인 전이면 알림에 남는다 — 일부러 그렇게 한 것이다", () => {
  // 상태로 거르면 **남이 상태를 옮기는 순간** 내 종에서 줄이 사라진다. 사용자가
  // 정한 것은 「내가 한 번 눌러 확인하면 사라지는 알림」이다(2026-09-23).
  const feed = buildImprovementRequestNotifications({
    requests: [
      request({ id: "aaaaaaaa-1111-4111-8111-111111111111", status: "OPEN" }),
      request({ id: "bbbbbbbb-2222-4222-8222-222222222222", status: "IN_PROGRESS" }),
      request({ id: "cccccccc-3333-4333-8333-333333333333", status: "RESOLVED" }),
    ],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  assert.equal(feed.count, 3, "🔴 상태로 걸러 냈다");
  assert.deepEqual(
    feed.items.map((item) => item.id),
    [
      "IMPROVEMENT_REQUEST:aaaaaaaa-1111-4111-8111-111111111111",
      "IMPROVEMENT_REQUEST:bbbbbbbb-2222-4222-8222-222222222222",
      "IMPROVEMENT_REQUEST:cccccccc-3333-4333-8333-333333333333",
    ],
  );
});

/* ── 7. 🔴 확인을 적을 수 있는 줄인가 ─────────────────────────────────── */

test("🔴 우리가 만든 줄은 언제나 확인을 적을 수 있다 — 만든 것과 가리는 것이 어긋나지 않는다", () => {
  // 이 시험이 요점이다: 열쇠를 만드는 곳과 열쇠를 알아보는 곳이 갈라지면,
  // 눌러도 아무 일이 일어나지 않는데 아무 오류도 없다.
  const feed = buildImprovementRequestNotifications({
    requests: [
      request({ id: "aaaaaaaa-1111-4111-8111-111111111111" }),
      request({ id: "bbbbbbbb-2222-4222-8222-222222222222", menuKey: null, createdByName: null }),
    ],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  for (const item of feed.items) {
    assert.equal(isOwnNotificationKey(item.id), true, `우리 열쇠를 못 알아본다: ${item.id}`);
    assert.equal(shouldAcknowledgeNotification(item), true);
  }
});

test("🔴 포털에서 온 줄은 확인을 적지 않는다 — sourceId 가 있으면 거짓이다", () => {
  assert.equal(
    shouldAcknowledgeNotification({
      id: "IMPROVEMENT_REQUEST:11111111-1111-4111-8111-111111111111",
      sourceId: "dss-improvements",
    }),
    false,
    "🔴 남의 시스템을 거쳐 온 줄에 우리 확인 기록을 적고 있다",
  );
});

test("🔴 남의 시스템 알림 id 는 우리 확인 기록에 들어가지 못한다", () => {
  for (const key of [
    "APPROVAL:123", // A/S 의 알림 id
    "IMPROVEMENT:7",
    "IMPROVEMENT_REQUEST:not-a-uuid",
    "IMPROVEMENT_REQUEST:11111111-1111-4111-8111-111111111111 ", // 뒤에 공백
    "improvement_request:11111111-1111-4111-8111-111111111111", // 소문자 앞머리
    "IMPROVEMENT_REQUEST:11111111-1111-4111-8111-11111111111", // 한 글자 짧다
    "", // 빈 열쇠 — 표의 CHECK 도 막는다
    `IMPROVEMENT_REQUEST:${"a".repeat(300)}`, // 200자 넘는다
  ]) {
    assert.equal(isOwnNotificationKey(key), false, `받아들이면 안 되는 열쇠: ${key.slice(0, 40)}`);
    assert.equal(shouldAcknowledgeNotification({ id: key }), false);
  }
});

test("🔴 대문자 uuid 는 받지 않는다 — 같은 요청에 확인 기록이 두 줄 생긴다", () => {
  // PostgreSQL 의 uuid 는 언제나 소문자로 나오고, 유니크 색인은 글자 그대로 본다.
  assert.equal(
    isOwnNotificationKey("IMPROVEMENT_REQUEST:AAAAAAAA-1111-4111-8111-111111111111"),
    false,
  );
});

test("글자가 아닌 값에도 답한다 — 브라우저를 거쳐 오는 값이다", () => {
  for (const value of [null, undefined, 7, {}, [], true]) {
    assert.equal(isOwnNotificationKey(value), false, `${String(value)} 를 받아들였다`);
  }
});

/* ── 8. 🔴 화면에 들어오면 전부 확인 (2026-09-23 사용자 결정) ─────────── */

test("🔴 화면에 들어오면 그 시점의 내 알림 열쇠가 전부 나온다", () => {
  // 「창에 들어오면 한꺼번에 사라지는 이유는 개선 요청 창에서 개선 요청들을
  //  한번에 볼 수 있기 때문」 — 들어온 것 자체가 「다 봤다」는 뜻이다.
  const feed = buildImprovementRequestNotifications({
    requests: [
      request({ id: "aaaaaaaa-1111-4111-8111-111111111111" }),
      request({ id: "bbbbbbbb-2222-4222-8222-222222222222", status: "RESOLVED" }),
      request({ id: "cccccccc-3333-4333-8333-333333333333", menuKey: null }),
    ],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  assert.deepEqual(acknowledgeableNotificationKeys(feed.items), [
    "IMPROVEMENT_REQUEST:aaaaaaaa-1111-4111-8111-111111111111",
    "IMPROVEMENT_REQUEST:bbbbbbbb-2222-4222-8222-222222222222",
    "IMPROVEMENT_REQUEST:cccccccc-3333-4333-8333-333333333333",
  ]);
});

test("🔴 「전부」에도 포털에서 온 줄은 들어가지 않는다 — 줄 하나 누를 때와 같은 판정이다", () => {
  const keys = acknowledgeableNotificationKeys([
    { id: "IMPROVEMENT_REQUEST:aaaaaaaa-1111-4111-8111-111111111111", sourceId: "" },
    { id: "APPROVAL:123", sourceId: "rf-service-system" },
    { id: "IMPROVEMENT_REQUEST:bbbbbbbb-2222-4222-8222-222222222222", sourceId: "dss-improvements" },
    { id: "지어낸 열쇠", sourceId: "" },
  ]);

  assert.deepEqual(keys, ["IMPROVEMENT_REQUEST:aaaaaaaa-1111-4111-8111-111111111111"]);
});

test("같은 열쇠가 두 번 와도 한 번만 적는다 · 적을 것이 없으면 빈 배열이다", () => {
  const same = { id: "IMPROVEMENT_REQUEST:aaaaaaaa-1111-4111-8111-111111111111", sourceId: "" };
  assert.deepEqual(acknowledgeableNotificationKeys([same, same]), [same.id]);
  assert.deepEqual(acknowledgeableNotificationKeys([]), []);
});

test("🔴 화면에 들어와 전부 확인한 **뒤에 들어온 글**은 다시 뜬다", () => {
  // 확인은 그 시점의 열쇠에만 걸린다 — 「한 번 들어왔으니 앞으로 영원히 안 본다」가
  // 아니다. 이것이 깨지면 새 개선요청이 아무에게도 안 보이게 된다.
  const before = [
    request({ id: "aaaaaaaa-1111-4111-8111-111111111111" }),
    request({ id: "bbbbbbbb-2222-4222-8222-222222222222" }),
  ];
  const acknowledged = acknowledgeableNotificationKeys(
    buildImprovementRequestNotifications({
      requests: before,
      acknowledgedKeys: [],
      baseUrl: BASE_URL,
    }).items,
  );
  assert.equal(acknowledged.length, 2);

  // 그 뒤에 새 글이 하나 들어왔다(목록 맨 앞에 선다).
  const after = buildImprovementRequestNotifications({
    requests: [request({ id: "dddddddd-4444-4444-8444-444444444444" }), ...before],
    acknowledgedKeys: acknowledged,
    baseUrl: BASE_URL,
  });

  assert.equal(after.count, 1, "🔴 새 글이 종에 뜨지 않는다");
  assert.deepEqual(
    after.items.map((item) => item.id),
    ["IMPROVEMENT_REQUEST:dddddddd-4444-4444-8444-444444444444"],
  );
});

test("차례는 받은 그대로다 — 여기서 다시 정렬하지 않는다(목록 조회가 이미 정렬한다)", () => {
  const feed = buildImprovementRequestNotifications({
    requests: [
      request({ id: "cccccccc-3333-4333-8333-333333333333" }),
      request({ id: "aaaaaaaa-1111-4111-8111-111111111111" }),
    ],
    acknowledgedKeys: [],
    baseUrl: BASE_URL,
  });

  assert.deepEqual(
    feed.items.map((item) => item.id),
    [
      "IMPROVEMENT_REQUEST:cccccccc-3333-4333-8333-333333333333",
      "IMPROVEMENT_REQUEST:aaaaaaaa-1111-4111-8111-111111111111",
    ],
  );
});
