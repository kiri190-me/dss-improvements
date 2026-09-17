import assert from "node:assert/strict";
import test from "node:test";

import { USER_ROLES, type UserRole } from "@/lib/db/schema";
import {
  canManageImprovementRequests,
  canViewImprovementRequests,
  canWriteImprovementRequests,
} from "./improvement-request-authorization";

/** 포털이 모르는 값을 보냈거나 세션이 망가졌을 때. 로그인이 먼저 막지만, 그 문 하나에 기대지 않는다. */
const BROKEN_ROLE = "GUEST" as unknown as UserRole;

test("보기와 적기는 이 사이트가 아는 역할 전부다", () => {
  for (const role of USER_ROLES) {
    assert.equal(canViewImprovementRequests(role), true, `${role} 는 목록을 볼 수 있어야 한다`);
    assert.equal(canWriteImprovementRequests(role), true, `${role} 는 적을 수 있어야 한다`);
  }
});

test("🔴 상태를 옮기는 것은 관리자만이다", () => {
  assert.equal(canManageImprovementRequests("ADMIN"), true);
  assert.equal(canManageImprovementRequests("MEMBER"), false);
});

test("🔴 모르는 역할에는 닫히는 쪽으로 답한다", () => {
  assert.equal(canViewImprovementRequests(BROKEN_ROLE), false);
  assert.equal(canWriteImprovementRequests(BROKEN_ROLE), false);
  assert.equal(canManageImprovementRequests(BROKEN_ROLE), false);
});

test("아는 역할은 둘뿐이다 — 늘리면 위 시험부터 다시 보게 된다", () => {
  // 개수를 못 박아 두는 이유: 역할이 하나 늘면 「누가 상태를 옮기는가」를 반드시
  // 다시 정해야 하는데, 그 결정 없이 값만 늘어나면 새 역할이 조용히 MEMBER 취급을
  // 받는다. 여기서 먼저 걸려 사람이 한 번 생각하게 한다.
  assert.deepEqual([...USER_ROLES], ["ADMIN", "MEMBER"]);
});
