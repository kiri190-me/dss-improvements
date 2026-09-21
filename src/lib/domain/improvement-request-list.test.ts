import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeImprovementRequestList,
  canChangeImprovementRequestScreenshots,
  canDeleteImprovementRequest,
  decideImprovementRequestScreenshotRestore,
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
 * 개선요청 — 지우기 권한 · 다섯 장 · 되살리기 · 목록 차례 · 거르기 · 복사
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
/* 휴지통에서 되살리기 (2026-09-21)                                      */
/* ------------------------------------------------------------------ */

/** 지워진 첨부 한 장 — 판정이 보는 칸은 is_deleted 하나다. */
const DELETED = { isDeleted: true };
const LIVE = { isDeleted: false };

test("🔴 지운 첨부는 되살아난다 — 자리가 남아 있으면", () => {
  // 되살리기가 열리면 저장은 is_deleted 를 내리고(db/attachment-guard.test.ts 가
  // 그 UPDATE 를 못 박는다), 읽는 쪽은 `is_deleted = false` 인 것만 읽으므로
  // 그 장은 목록에 다시 나타난다.
  for (let liveCount = 0; liveCount < IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT; liveCount += 1) {
    assert.deepEqual(
      decideImprovementRequestScreenshotRestore({ attachment: DELETED, liveCount }),
      { kind: "proceed" },
      `${liveCount}장인데 되살리기가 막혔습니다`,
    );
  }
});

test("🔴 다섯 장이 차 있으면 되살리기가 거절된다 — 지웠다 되살려 여섯 장이 되는 길", () => {
  // 이 시험이 지키는 것: 다섯 장을 채우고 → 한 장 지우고 → 그 자리에 새로 한 장을
  // 붙인 뒤(다시 다섯 장) → 지운 장을 되살리는 길. 되살리기가 세지 않으면 여기서
  // 여섯 장이 된다.
  assert.deepEqual(
    decideImprovementRequestScreenshotRestore({
      attachment: DELETED,
      liveCount: IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
    }),
    { kind: "limit-reached" },
  );
  // 어쩌다 상한을 넘긴 글에서도 막힌다(옮겨 온 자료 등).
  assert.deepEqual(
    decideImprovementRequestScreenshotRestore({
      attachment: DELETED,
      liveCount: IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT + 1,
    }),
    { kind: "limit-reached" },
  );
});

test("🔴 되살리기는 붙이기와 **같은 함수**로 자리를 본다", () => {
  // 수를 따로 적으면 한쪽만 고치는 날이 온다. 두 판정이 언제나 같은 자리에서
  // 갈리는지 셈으로 대조한다.
  for (let liveCount = 0; liveCount <= IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT + 1; liveCount += 1) {
    const gate = decideImprovementRequestScreenshotRestore({ attachment: DELETED, liveCount });
    assert.equal(
      gate.kind === "proceed",
      hasImprovementRequestScreenshotRoom(liveCount),
      `${liveCount}장에서 붙이기와 되살리기의 판정이 갈라졌습니다`,
    );
  }
});

test("이미 살아 있는 장과 없는 장은 되살릴 것이 없다", () => {
  // 그 사이 다른 창이 먼저 되살린 경우가 앞의 것이다 — 「되살렸다」고 답하면
  // 아무 일도 일어나지 않았는데 성공으로 보인다.
  assert.deepEqual(
    decideImprovementRequestScreenshotRestore({ attachment: LIVE, liveCount: 0 }),
    { kind: "not-deleted" },
  );
  assert.deepEqual(
    decideImprovementRequestScreenshotRestore({ attachment: undefined, liveCount: 0 }),
    { kind: "not-found" },
  );
  // 🔴 없는 첨부는 자리가 차 있어도 「없다」다 — 다섯 장 거절로 답하면 남의 글의
  // 첨부 id 를 넣어 보고 「그 글이 몇 장인가」를 알아낼 수 있다.
  assert.deepEqual(
    decideImprovementRequestScreenshotRestore({
      attachment: undefined,
      liveCount: IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
    }),
    { kind: "not-found" },
  );
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

/* ------------------------------------------------------------------ */
/* 거르개의 단 — 2026-09-18, 대메뉴                                      */
/* ------------------------------------------------------------------ */

test("🔴 메뉴 거르개도 대메뉴와 소메뉴를 실어 나른다 — 폼과 같은 단으로 보이게", () => {
  // 화면이 이 두 칸으로 대메뉴는 굵게, 소메뉴는 한 단 들여쓴다. 이름표에는
  // 아무것도 섞지 않는다 — 들여쓰기를 label 에 미리 넣으면 다른 곳에서 그 글자가
  // 따라다닌다(service-catalog.ts 의 menuOptionText 머리말).
  const items = [
    entry("h", "OPEN", "2026-09-17T00:00:00.000Z", "rf-service-system", "asOperations"),
    entry("i", "OPEN", "2026-09-16T00:00:00.000Z", "rf-service-system", "quotes"),
  ];
  const options = listImprovementRequestMenuFilterOptions(items, {
    serviceFilter: "rf-service-system",
    showResolved: true,
    selected: IMPROVEMENT_REQUEST_FILTER_ALL,
  });

  const group = options.find((option) => option.value === "asOperations");
  assert.ok(group, "대메뉴로 적은 글이 거르개에 나오지 않습니다");
  assert.equal(group.isGroup, true);
  assert.equal(group.groupKey, undefined);
  assert.equal(group.label, "A/S 업무");

  const child = options.find((option) => option.value === "quotes");
  assert.ok(child);
  assert.equal(child.groupKey, "poDomestic");
  assert.equal(child.isGroup, undefined);
  assert.equal(child.label, "견적서");

  // 「전체 메뉴」는 메뉴가 아니라 거르개가 만든 칸이다 — 어느 단에도 안 든다.
  const all = options.find((option) => option.value === IMPROVEMENT_REQUEST_FILTER_ALL);
  assert.ok(all);
  assert.equal(all.isGroup, undefined);
  assert.equal(all.groupKey, undefined);
});

test("🔴 대메뉴로 적은 글은 그 칸에서만 세어진다 — 아래 소메뉴까지 끌어오지 않는다", () => {
  // 이번 조각에서 일부러 만들지 않은 동작이다. 「대메뉴를 고르면 그 아래 글까지
  // 함께」가 필요하면 사람이 정할 일이라, 지금은 대메뉴가 그냥 또 하나의 칸이다.
  const items = [
    entry("h", "OPEN", "2026-09-17T00:00:00.000Z", "rf-service-system", "asOperations"),
    entry("i", "OPEN", "2026-09-16T00:00:00.000Z", "rf-service-system", "repairCases"),
  ];
  assert.deepEqual(
    filterImprovementRequests(items, {
      serviceFilter: "rf-service-system",
      menuFilter: "asOperations",
    }).map((row) => row.id),
    ["h"],
    "대메뉴 칸이 그 아래 소메뉴의 글까지 끌어왔습니다",
  );

  const options = listImprovementRequestMenuFilterOptions(items, {
    serviceFilter: "rf-service-system",
    showResolved: true,
    selected: IMPROVEMENT_REQUEST_FILTER_ALL,
  });
  assert.equal(options.find((option) => option.value === "asOperations")?.count, 1);
  assert.equal(options.find((option) => option.value === "repairCases")?.count, 1);
});
