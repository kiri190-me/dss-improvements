import assert from "node:assert/strict";
import test from "node:test";

import {
  canChangeImprovementRequestStatus,
  canEditImprovementRequestBody,
  countImprovementRequestBodyChars,
  decideImprovementRequestWrite,
  IMPROVEMENT_REQUEST_STATUS_LABELS,
  IMPROVEMENT_REQUEST_STATUSES,
  isImprovementRequestStatus,
  planImprovementRequestStatusChange,
} from "./improvement-request";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-17T01:02:03.000Z");
const EARLIER = new Date("2026-09-16T00:00:00.000Z");

const EMPTY = {
  inProgressBy: null,
  inProgressAt: null,
  resolvedBy: null,
  resolvedAt: null,
} as const;

test("상태 값과 이름표가 짝이 맞는다", () => {
  assert.deepEqual([...IMPROVEMENT_REQUEST_STATUSES], ["OPEN", "IN_PROGRESS", "RESOLVED"]);
  for (const status of IMPROVEMENT_REQUEST_STATUSES) {
    assert.ok(IMPROVEMENT_REQUEST_STATUS_LABELS[status], `${status} 의 이름표가 없습니다`);
  }
  assert.ok(isImprovementRequestStatus("OPEN"));
  assert.ok(!isImprovementRequestStatus("open"));
  assert.ok(!isImprovementRequestStatus("DONE"));
  assert.ok(!isImprovementRequestStatus(null));
});

test("글자는 코드 포인트로 센다 — 이모지가 둘로 세어지지 않는다", () => {
  // UTF-16 단위로 세면 2 가 나온다. Postgres 의 char_length 는 1 이다.
  assert.equal(countImprovementRequestBodyChars("🙂"), 1);
  assert.equal(countImprovementRequestBodyChars("가나다"), 3);
});

/* ── 상태 옮기기 ──────────────────────────────────────────────────────── */

test("같은 상태로 누르면 아무것도 바뀌지 않는다", () => {
  const plan = planImprovementRequestStatusChange({
    from: "IN_PROGRESS",
    to: "IN_PROGRESS",
    current: { inProgressBy: OTHER, inProgressAt: EARLIER, resolvedBy: null, resolvedAt: null },
    actorUserId: ACTOR,
    now: NOW,
  });
  assert.deepEqual(plan, { kind: "unchanged" });
});

test("진행중으로 옮기면 지금 옮긴 사람이 적히고 해결 쌍은 비워진다", () => {
  const plan = planImprovementRequestStatusChange({
    from: "RESOLVED",
    to: "IN_PROGRESS",
    current: { inProgressBy: OTHER, inProgressAt: EARLIER, resolvedBy: OTHER, resolvedAt: EARLIER },
    actorUserId: ACTOR,
    now: NOW,
  });
  assert.deepEqual(plan, {
    kind: "changed",
    status: "IN_PROGRESS",
    // 「지금 이 글을 맡은 사람」이라 되돌려 와도 새로 적힌다.
    fields: { inProgressBy: ACTOR, inProgressAt: NOW, resolvedBy: null, resolvedAt: null },
  });
});

test("해결로 옮기면 맡았던 기록은 남는다", () => {
  const plan = planImprovementRequestStatusChange({
    from: "IN_PROGRESS",
    to: "RESOLVED",
    current: { inProgressBy: OTHER, inProgressAt: EARLIER, resolvedBy: null, resolvedAt: null },
    actorUserId: ACTOR,
    now: NOW,
  });
  assert.deepEqual(plan, {
    kind: "changed",
    status: "RESOLVED",
    fields: { inProgressBy: OTHER, inProgressAt: EARLIER, resolvedBy: ACTOR, resolvedAt: NOW },
  });
});

test("접수에서 곧바로 해결하면 맡은 사람 칸은 빈 채다", () => {
  const plan = planImprovementRequestStatusChange({
    from: "OPEN",
    to: "RESOLVED",
    current: EMPTY,
    actorUserId: ACTOR,
    now: NOW,
  });
  assert.deepEqual(plan, {
    kind: "changed",
    status: "RESOLVED",
    fields: { inProgressBy: null, inProgressAt: null, resolvedBy: ACTOR, resolvedAt: NOW },
  });
});

test("접수로 되돌리면 네 칸이 모두 비워진다", () => {
  const plan = planImprovementRequestStatusChange({
    from: "RESOLVED",
    to: "OPEN",
    current: { inProgressBy: OTHER, inProgressAt: EARLIER, resolvedBy: OTHER, resolvedAt: EARLIER },
    actorUserId: ACTOR,
    now: NOW,
  });
  assert.deepEqual(plan, { kind: "changed", status: "OPEN", fields: { ...EMPTY } });
});

test("🔴 어느 조합을 옮겨도 DB CHECK 가 요구하는 모양이 나온다", () => {
  // schema.ts 의 improvement_requests_status_columns · _actor_pairs 와 같은 규칙을
  // 여기서 그대로 확인한다. 한쪽만 고치면 화면은 저장을 시도하고 DB 가 23514 로
  // 거절해, 사람에게는 이유 없는 실패만 남는다.
  const currents = [
    EMPTY,
    { inProgressBy: OTHER, inProgressAt: EARLIER, resolvedBy: null, resolvedAt: null },
    { inProgressBy: OTHER, inProgressAt: EARLIER, resolvedBy: OTHER, resolvedAt: EARLIER },
    { inProgressBy: null, inProgressAt: null, resolvedBy: OTHER, resolvedAt: EARLIER },
  ];
  for (const from of IMPROVEMENT_REQUEST_STATUSES) {
    for (const to of IMPROVEMENT_REQUEST_STATUSES) {
      for (const current of currents) {
        const plan = planImprovementRequestStatusChange({
          from,
          to,
          current,
          actorUserId: ACTOR,
          now: NOW,
        });
        if (plan.kind === "unchanged") continue;
        const f = plan.fields;

        // 「누가」만 있고 「언제」가 없는 행은 없다.
        assert.ok(f.inProgressBy === null || f.inProgressAt !== null);
        assert.ok(f.resolvedBy === null || f.resolvedAt !== null);

        // 상태와 시각 칸이 맞는다.
        if (plan.status === "OPEN") {
          assert.equal(f.inProgressAt, null);
          assert.equal(f.resolvedAt, null);
        } else if (plan.status === "IN_PROGRESS") {
          assert.notEqual(f.inProgressAt, null);
          assert.equal(f.resolvedAt, null);
        } else {
          assert.notEqual(f.resolvedAt, null);
        }
      }
    }
  }
});

/* ── 누가 무엇을 ──────────────────────────────────────────────────────── */

test("상태를 옮기는 것은 관리 권한이 있을 때만이다", () => {
  assert.equal(canChangeImprovementRequestStatus({ canManage: true }), true);
  assert.equal(canChangeImprovementRequestStatus({ canManage: false }), false);
});

test("내용은 접수 상태인 자기 글만 고칠 수 있다", () => {
  const edit = (input: Parameters<typeof canEditImprovementRequestBody>[0]) =>
    canEditImprovementRequestBody(input);

  assert.equal(edit({ status: "OPEN", createdBy: ACTOR, actorUserId: ACTOR }), true);
  assert.equal(edit({ status: "OPEN", createdBy: OTHER, actorUserId: ACTOR }), false);
  assert.equal(edit({ status: "IN_PROGRESS", createdBy: ACTOR, actorUserId: ACTOR }), false);
  assert.equal(edit({ status: "RESOLVED", createdBy: ACTOR, actorUserId: ACTOR }), false);
  // 옮겨 온 글(이을 계정이 없다)은 「자기 글」이 성립하지 않는다.
  assert.equal(edit({ status: "OPEN", createdBy: null, actorUserId: ACTOR }), false);
});

/* ── 🔴 낙관적 잠금 ───────────────────────────────────────────────────── */

test("🔴 낙관적 잠금이 동시 수정을 막는다", () => {
  const row = { version: 3, isDeleted: false };

  // 화면이 들고 있던 값과 지금 값이 같다 — 그 사이 아무도 안 바꿨다.
  assert.deepEqual(decideImprovementRequestWrite({ row, expectedVersion: 3 }), {
    kind: "proceed",
  });

  // 🔴 그 사이 누가 먼저 바꿨다. 그대로 저장하면 앞사람의 변경을 말없이 덮는다.
  assert.deepEqual(decideImprovementRequestWrite({ row, expectedVersion: 2 }), {
    kind: "conflict",
  });
  // 화면이 미래의 값을 들고 있는 일은 없어야 하지만, 그래도 충돌로 본다 —
  // 무엇이 어긋났든 앞사람의 변경을 덮지 않는 쪽으로 기운다.
  assert.deepEqual(decideImprovementRequestWrite({ row, expectedVersion: 9 }), {
    kind: "conflict",
  });
});

test("없는 글과 이미 지워진 글은 둘 다 「없음」이다", () => {
  assert.deepEqual(decideImprovementRequestWrite({ row: undefined, expectedVersion: 1 }), {
    kind: "not-found",
  });
  // 소프트 삭제라 행은 남아 있지만 쓰는 쪽에는 없는 것과 같다. 버전이 맞아도
  // 「없음」이 먼저다 — 목록에 없는 글이 조용히 움직이면 안 된다.
  assert.deepEqual(
    decideImprovementRequestWrite({ row: { version: 1, isDeleted: true }, expectedVersion: 1 }),
    { kind: "not-found" },
  );
});
