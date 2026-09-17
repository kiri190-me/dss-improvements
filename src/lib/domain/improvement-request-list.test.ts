import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeImprovementRequestList,
  canChangeImprovementRequestScreenshots,
  canDeleteImprovementRequest,
  filterImprovementRequests,
  hasImprovementRequestScreenshotRoom,
  IMPROVEMENT_REQUEST_FILTER_ALL,
  IMPROVEMENT_REQUEST_FILTER_NO_MENU,
  IMPROVEMENT_REQUEST_FILTER_UNKNOWN,
  IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
  improvementRequestCopyText,
  improvementRequestScreenshotRoomLeft,
  listImprovementRequestMenuFilterOptions,
  listImprovementRequestServiceFilterOptions,
  type ImprovementRequestStatus,
} from "./improvement-request";

/**
 * ============================================================================
 * 개선요청 — 지우기 권한 · 다섯 장 · 목록 차례 · 거르기 · 복사
 * ============================================================================
 * 스크린샷과 함께 들어온 규칙들이다. 상태 옮기기와 낙관적 잠금은
 * improvement-request.test.ts 가 본다.
 * ============================================================================
 */

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

/* ------------------------------------------------------------------ */
/* 지우기 — 「자기 글 + 관리자는 전부」                                  */
/* ------------------------------------------------------------------ */

test("🔴 남의 글을 지우려 하면 거절되고, ADMIN 은 된다", () => {
  const othersPost = { createdBy: SOMEONE_ELSE, actorUserId: ME };

  assert.equal(
    canDeleteImprovementRequest({ ...othersPost, canManage: false }),
    false,
    "일반 사용자가 남의 글을 지울 수 있습니다",
  );
  assert.equal(
    canDeleteImprovementRequest({ ...othersPost, canManage: true }),
    true,
    "관리자가 남의 글을 지울 수 없습니다",
  );
});

test("자기 글은 관리 권한이 없어도 지운다", () => {
  assert.equal(
    canDeleteImprovementRequest({ createdBy: ME, actorUserId: ME, canManage: false }),
    true,
  );
});

test("🔴 상태를 보지 않는다 — 진행중이 된 뒤에도 자기 글은 지운다", () => {
  // 승인된 설계 ④. 잘못 적었다는 것은 대개 진행중이 된 뒤에 깨닫는다.
  // (상태를 인자로 받지도 않는다 — 그것이 이 규칙의 모양이다.)
  assert.equal(
    canDeleteImprovementRequest({ createdBy: ME, actorUserId: ME, canManage: false }),
    true,
  );
});

test("옮겨 온 글(작성자 계정 없음)은 관리자만 지운다", () => {
  assert.equal(
    canDeleteImprovementRequest({ createdBy: null, actorUserId: ME, canManage: false }),
    false,
  );
  assert.equal(
    canDeleteImprovementRequest({ createdBy: null, actorUserId: ME, canManage: true }),
    true,
  );
});

test("🔴 첨부 지우기·붙이기도 글 지우기와 같은 규칙이다", () => {
  for (const canManage of [false, true]) {
    for (const createdBy of [ME, SOMEONE_ELSE, null]) {
      const input = { createdBy, actorUserId: ME, canManage };
      assert.equal(
        canChangeImprovementRequestScreenshots(input),
        canDeleteImprovementRequest(input),
        `규칙이 갈라졌습니다 (createdBy=${createdBy}, canManage=${canManage})`,
      );
    }
  }
});

/* ------------------------------------------------------------------ */
/* 다섯 장                                                              */
/* ------------------------------------------------------------------ */

test("🔴 여섯 장째가 거절된다", () => {
  assert.equal(IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT, 5);
  for (let liveCount = 0; liveCount < 5; liveCount += 1) {
    assert.equal(hasImprovementRequestScreenshotRoom(liveCount), true, `${liveCount}장에서 막혔습니다`);
  }
  assert.equal(hasImprovementRequestScreenshotRoom(5), false, "여섯 장째가 들어갑니다");
  assert.equal(hasImprovementRequestScreenshotRoom(6), false);
});

test("남은 자리는 음수가 되지 않는다", () => {
  assert.equal(improvementRequestScreenshotRoomLeft(0), 5);
  assert.equal(improvementRequestScreenshotRoomLeft(5), 0);
  // 지워 놓고 되살리는 길이 생기면 실제로 6 이 들어올 수 있다.
  assert.equal(improvementRequestScreenshotRoomLeft(6), 0);
});

/* ------------------------------------------------------------------ */
/* 목록 차례 · 해결된 것 감추기                                          */
/* ------------------------------------------------------------------ */

function entry(
  id: string,
  status: ImprovementRequestStatus,
  createdAt: string,
  serviceKey = "rf-service-system",
  menuKey: string | null = "quotes",
) {
  return { id, status, createdAt, serviceKey, menuKey };
}

test("차례는 진행중 → 접수 → 해결, 그 안에서는 최근 글부터", () => {
  const items = [
    entry("a", "RESOLVED", "2026-09-17T00:00:00.000Z"),
    entry("b", "OPEN", "2026-09-15T00:00:00.000Z"),
    entry("c", "IN_PROGRESS", "2026-09-10T00:00:00.000Z"),
    entry("d", "OPEN", "2026-09-16T00:00:00.000Z"),
  ];
  const { rows } = arrangeImprovementRequestList(items, { showResolved: true });
  assert.deepEqual(
    rows.map((row) => row.id),
    ["c", "d", "b", "a"],
  );
});

test("같은 시각이면 id 내림차순 — 새로 고칠 때마다 자리가 바뀌지 않는다", () => {
  const items = [
    entry("a", "OPEN", "2026-09-17T00:00:00.000Z"),
    entry("c", "OPEN", "2026-09-17T00:00:00.000Z"),
    entry("b", "OPEN", "2026-09-17T00:00:00.000Z"),
  ];
  const first = arrangeImprovementRequestList(items, { showResolved: true });
  const second = arrangeImprovementRequestList([...items].reverse(), { showResolved: true });
  assert.deepEqual(
    first.rows.map((row) => row.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    second.rows.map((row) => row.id),
    first.rows.map((row) => row.id),
  );
});

test("해결된 것은 기본으로 감추고, 몇 건을 감췄는지 알린다", () => {
  const items = [
    entry("a", "RESOLVED", "2026-09-17T00:00:00.000Z"),
    entry("b", "RESOLVED", "2026-09-16T00:00:00.000Z"),
    entry("c", "OPEN", "2026-09-15T00:00:00.000Z"),
  ];
  const hidden = arrangeImprovementRequestList(items, { showResolved: false });
  assert.deepEqual(
    hidden.rows.map((row) => row.id),
    ["c"],
  );
  assert.equal(hidden.resolvedCount, 2);
  assert.equal(hidden.hiddenResolvedCount, 2);

  const shown = arrangeImprovementRequestList(items, { showResolved: true });
  assert.equal(shown.rows.length, 3);
  assert.equal(shown.resolvedCount, 2);
  assert.equal(shown.hiddenResolvedCount, 0);
});

test("받은 배열을 건드리지 않는다 (서버가 넘긴 props 다)", () => {
  const items = [
    entry("a", "RESOLVED", "2026-09-17T00:00:00.000Z"),
    entry("b", "IN_PROGRESS", "2026-09-16T00:00:00.000Z"),
  ];
  const before = items.map((item) => item.id);
  arrangeImprovementRequestList(items, { showResolved: true });
  assert.deepEqual(
    items.map((item) => item.id),
    before,
  );
});

/* ------------------------------------------------------------------ */
/* 거르기 — 서비스와 메뉴 둘 다                                          */
/* ------------------------------------------------------------------ */

const MIXED = [
  entry("a", "OPEN", "2026-09-17T00:00:00.000Z", "rf-service-system", "quotes"),
  entry("b", "OPEN", "2026-09-16T00:00:00.000Z", "rf-service-system", "users"),
  entry("c", "OPEN", "2026-09-15T00:00:00.000Z", "dss-meters", "meterList"),
  entry("d", "RESOLVED", "2026-09-14T00:00:00.000Z", "rf-service-system", "quotes"),
  entry("e", "OPEN", "2026-09-13T00:00:00.000Z", "rf-service-system", null),
  entry("f", "OPEN", "2026-09-12T00:00:00.000Z", "없어진-서비스", "quotes"),
  entry("g", "OPEN", "2026-09-11T00:00:00.000Z", "rf-service-system", "없어진메뉴"),
];

test("시스템으로 거른다", () => {
  const rows = filterImprovementRequests(MIXED, {
    serviceFilter: "dss-meters",
    menuFilter: IMPROVEMENT_REQUEST_FILTER_ALL,
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ["c"],
  );
});

test("🔴 시스템을 고른 뒤에만 메뉴로 거른다 — 열쇠가 서비스 안에서만 유일하다", () => {
  // A/S 의 `users` 와 포털의 `adminUsers` 처럼 이름이 겹치는 열쇠가 실제로 있다.
  // 「전체 시스템」인데 메뉴만 고르면 엉뚱한 시스템의 글이 함께 걸린다.
  const all = filterImprovementRequests(MIXED, {
    serviceFilter: IMPROVEMENT_REQUEST_FILTER_ALL,
    menuFilter: "quotes",
  });
  assert.equal(all.length, MIXED.length, "시스템이 「전체」인데 메뉴 거르개가 먹었습니다");

  const narrowed = filterImprovementRequests(MIXED, {
    serviceFilter: "rf-service-system",
    menuFilter: "quotes",
  });
  assert.deepEqual(
    narrowed.map((row) => row.id),
    ["a", "d"],
  );
});

test("메뉴를 고르지 않은 글과 없어진 메뉴의 글도 거를 수 있다", () => {
  assert.deepEqual(
    filterImprovementRequests(MIXED, {
      serviceFilter: "rf-service-system",
      menuFilter: IMPROVEMENT_REQUEST_FILTER_NO_MENU,
    }).map((row) => row.id),
    ["e"],
  );
  assert.deepEqual(
    filterImprovementRequests(MIXED, {
      serviceFilter: "rf-service-system",
      menuFilter: IMPROVEMENT_REQUEST_FILTER_UNKNOWN,
    }).map((row) => row.id),
    ["g"],
  );
});

test("없어진 서비스의 글은 한 칸으로 모인다", () => {
  assert.deepEqual(
    filterImprovementRequests(MIXED, {
      serviceFilter: IMPROVEMENT_REQUEST_FILTER_UNKNOWN,
      menuFilter: IMPROVEMENT_REQUEST_FILTER_ALL,
    }).map((row) => row.id),
    ["f"],
  );
});

test("거르개의 건수는 「지금 보이는 것」만 센다", () => {
  const hidden = listImprovementRequestServiceFilterOptions(MIXED, {
    showResolved: false,
    selected: IMPROVEMENT_REQUEST_FILTER_ALL,
  });
  const all = hidden.find((option) => option.value === IMPROVEMENT_REQUEST_FILTER_ALL);
  // 해결된 d 를 빼고 여섯.
  assert.equal(all?.count, 6);

  const shown = listImprovementRequestServiceFilterOptions(MIXED, {
    showResolved: true,
    selected: IMPROVEMENT_REQUEST_FILTER_ALL,
  });
  assert.equal(shown.find((option) => option.value === IMPROVEMENT_REQUEST_FILTER_ALL)?.count, 7);
});

test("글이 없는 시스템은 거르개에 나오지 않는다 — 단 고른 칸은 남는다", () => {
  const options = listImprovementRequestServiceFilterOptions(MIXED, {
    showResolved: true,
    selected: IMPROVEMENT_REQUEST_FILTER_ALL,
  });
  const values = options.map((option) => option.value);
  assert.ok(values.includes("rf-service-system"));
  assert.ok(!values.includes("dss-home"), "글이 없는 시스템이 나왔습니다");

  // 마지막 글이 사라져도 고른 칸은 남는다(선택칸과 목록이 엇갈리지 않게).
  const selected = listImprovementRequestServiceFilterOptions(MIXED, {
    showResolved: true,
    selected: "dss-home",
  });
  const kept = selected.find((option) => option.value === "dss-home");
  assert.equal(kept?.count, 0);
});

test("메뉴 거르개는 고른 시스템의 메뉴만 내놓는다", () => {
  const whenAll = listImprovementRequestMenuFilterOptions(MIXED, {
    serviceFilter: IMPROVEMENT_REQUEST_FILTER_ALL,
    showResolved: true,
    selected: IMPROVEMENT_REQUEST_FILTER_ALL,
  });
  assert.deepEqual(
    whenAll.map((option) => option.value),
    [IMPROVEMENT_REQUEST_FILTER_ALL],
    "시스템이 「전체」인데 메뉴 칸이 채워졌습니다",
  );

  const forAs = listImprovementRequestMenuFilterOptions(MIXED, {
    serviceFilter: "rf-service-system",
    showResolved: true,
    selected: IMPROVEMENT_REQUEST_FILTER_ALL,
  });
  const values = forAs.map((option) => option.value);
  assert.deepEqual(values, [
    IMPROVEMENT_REQUEST_FILTER_ALL,
    "quotes",
    "users",
    IMPROVEMENT_REQUEST_FILTER_NO_MENU,
    IMPROVEMENT_REQUEST_FILTER_UNKNOWN,
  ]);
  // 계측기의 meterList 는 A/S 를 고른 동안 나오지 않는다.
  assert.ok(!values.includes("meterList"));
});

/* ------------------------------------------------------------------ */
/* 복사                                                                 */
/* ------------------------------------------------------------------ */

test("복사 글은 「[개선요청 : 시스템 · 메뉴] 본문」이다", () => {
  assert.equal(
    improvementRequestCopyText({
      serviceKey: "rf-service-system",
      menuKey: "quotes",
      body: "표가 느려요",
    }),
    "[개선요청 : DSS A/S 관리 시스템 · 견적서] 표가 느려요",
  );
});

test("메뉴를 고르지 않은 글도 복사된다", () => {
  assert.equal(
    improvementRequestCopyText({
      serviceKey: "other",
      menuKey: null,
      body: "접수 절차를 줄이자",
    }),
    "[개선요청 : 시스템 아님 · 일하는 방식 · 메뉴 지정 안 함] 접수 절차를 줄이자",
  );
});

test("본문의 줄바꿈은 그대로 붙는다", () => {
  const body = "첫 줄\n둘째 줄";
  assert.ok(
    improvementRequestCopyText({ serviceKey: "dss-meters", menuKey: null, body }).endsWith(body),
  );
});
