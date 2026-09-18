import assert from "node:assert/strict";
import test from "node:test";

import { IMPROVEMENT_REQUEST_BODY_MAX_CHARS } from "@/lib/domain/improvement-request";
import { validateImprovementRequestFields } from "./improvement-request-input";

const OK_SERVICE = "rf-service-system";

function ok(raw: Record<string, unknown>) {
  const result = validateImprovementRequestFields(raw);
  assert.ok(result.ok, `통과할 값인데 거절됐습니다: ${JSON.stringify(result)}`);
  return result.data;
}

function errors(raw: Record<string, unknown>): Record<string, string> {
  const result = validateImprovementRequestFields(raw);
  assert.ok(!result.ok, "거절될 값인데 통과했습니다");
  return result.fieldErrors;
}

test("서비스와 본문만 있으면 통과한다", () => {
  const data = ok({ serviceKey: OK_SERVICE, body: "느려요" });
  assert.deepEqual(data, { serviceKey: OK_SERVICE, menuKey: null, body: "느려요" });
});

test("🔴 메뉴를 고르지 않아도 적을 수 있다", () => {
  // 빈 문자열(폼의 첫 칸) · 없음 · null 은 모두 「고르지 않았다」다.
  for (const menuKey of ["", undefined, null]) {
    const data = ok({ serviceKey: OK_SERVICE, menuKey, body: "어느 화면인지 모르겠어요" });
    assert.equal(data.menuKey, null, `menuKey=${String(menuKey)} 는 null 이어야 한다`);
  }
  // 메뉴가 아예 없는 서비스(「일하는 방식」)도 적을 수 있다.
  const data = ok({ serviceKey: "other", body: "A/S 접수 절차를 줄였으면 합니다" });
  assert.equal(data.menuKey, null);
});

test("고른 메뉴는 그대로 담긴다", () => {
  const data = ok({ serviceKey: OK_SERVICE, menuKey: "quotes", body: "견적서 인쇄가 잘려요" });
  assert.equal(data.menuKey, "quotes");
});

test("🔴 적어 둔 목록에 없는 서비스 열쇠는 저장되지 않는다", () => {
  const fieldErrors = errors({ serviceKey: "없는-서비스", body: "본문" });
  assert.ok(fieldErrors.serviceKey, "서비스 칸에 오류가 붙어야 한다");
  // 🔴 받은 값을 오류 문장에 싣지 않는다(무엇이 올지 모르는 값이다).
  assert.ok(!fieldErrors.serviceKey.includes("없는-서비스"));
});

test("🔴 적어 둔 목록에 없는 메뉴 열쇠는 저장되지 않는다", () => {
  const fieldErrors = errors({ serviceKey: OK_SERVICE, menuKey: "없는-메뉴", body: "본문" });
  assert.ok(fieldErrors.menuKey);
  assert.ok(!fieldErrors.menuKey.includes("없는-메뉴"));
});

test("🔴 남의 서비스의 메뉴는 저장되지 않는다", () => {
  // 열쇠는 서비스 안에서만 유일하다. 짝으로 보지 않으면 이것이 통과한다 —
  // 화면에서 서비스만 바꾸고 보낸 값이 정확히 이 모양이다.
  const fieldErrors = errors({ serviceKey: "dss-meters", menuKey: "quotes", body: "본문" });
  assert.ok(fieldErrors.menuKey);
});

test("서비스를 고르지 않으면 서비스 칸만 나무란다", () => {
  const fieldErrors = errors({ serviceKey: "", menuKey: "quotes", body: "본문" });
  assert.ok(fieldErrors.serviceKey);
  // 어느 목록으로 봐야 할지 모르는 상태에서 메뉴까지 나무라면, 서비스를 고친 뒤
  // 같은 말을 한 번 더 듣게 된다.
  assert.equal(fieldErrors.menuKey, undefined);
});

test("본문은 비울 수 없다", () => {
  assert.ok(errors({ serviceKey: OK_SERVICE, body: "" }).body);
  assert.ok(errors({ serviceKey: OK_SERVICE, body: "   \n  " }).body);
  assert.ok(errors({ serviceKey: OK_SERVICE, body: 12 }).body);
  assert.ok(errors({ serviceKey: OK_SERVICE }).body);
});

test("본문은 앞뒤 공백을 걷고 줄바꿈을 LF 로 통일한다", () => {
  const data = ok({ serviceKey: OK_SERVICE, body: "  첫 줄\r\n둘째 줄\r셋째 줄  " });
  assert.equal(data.body, "첫 줄\n둘째 줄\n셋째 줄");
});

test("본문 상한은 코드 포인트로 센다", () => {
  const max = IMPROVEMENT_REQUEST_BODY_MAX_CHARS;
  assert.equal(ok({ serviceKey: OK_SERVICE, body: "가".repeat(max) }).body.length, max);
  assert.ok(errors({ serviceKey: OK_SERVICE, body: "가".repeat(max + 1) }).body);
  // 이모지는 한 글자다 — UTF-16 단위로 세면 이 값이 상한을 넘겼다고 거절된다.
  ok({ serviceKey: OK_SERVICE, body: "🙂".repeat(max) });
  assert.ok(errors({ serviceKey: OK_SERVICE, body: "🙂".repeat(max + 1) }).body);
});

test("CRLF 는 한 글자로 센다 — 화면에서 맞춘 글이 서버에서 넘치지 않게", () => {
  const max = IMPROVEMENT_REQUEST_BODY_MAX_CHARS;
  // LF 로 바꾸면 정확히 max 글자다("가\n" × 999 + "가가"). 끝을 줄바꿈으로 두지
  // 않는 것은 trim 이 그것을 걷어 내기 때문이다.
  const body = "가\r\n".repeat(max / 2 - 1) + "가가";
  assert.ok(body.length > max, "CRLF 를 두 글자로 세면 이 값은 상한을 넘는다");

  const data = ok({ serviceKey: OK_SERVICE, body });
  assert.equal(data.body.length, max);
});

test("틀린 칸이 여럿이면 한꺼번에 돌려준다", () => {
  const fieldErrors = errors({ serviceKey: "없는-서비스", body: "" });
  assert.ok(fieldErrors.serviceKey);
  assert.ok(fieldErrors.body);
});

test("🔴 대메뉴도 저장된다 — 고를 수 있는 값이면 검증이 받아 준다", () => {
  // 2026-09-18 부터 대메뉴(A/S 사이드바의 구획)도 고를 수 있는 한 칸이다
  // (service-catalog.ts 의 ServiceMenu.isGroup). 검증은 목록 하나만 보므로
  // 자동으로 따라오는데, **자동으로 따라오는 것을 못 박아 둔다** — 나중에 여기에
  // 「대메뉴는 빼고」 같은 갈래가 생기면 화면은 내놓는데 저장이 거절하게 된다.
  const data = ok({ serviceKey: OK_SERVICE, menuKey: "asOperations", body: "A/S 업무 전반이 느려요" });
  assert.equal(data.menuKey, "asOperations");

  // 남의 시스템의 대메뉴는 통과하지 못한다 — 보통 메뉴와 같은 규칙이다.
  assert.ok(errors({ serviceKey: "dss-meters", menuKey: "asOperations", body: "느려요" }).menuKey);
});
