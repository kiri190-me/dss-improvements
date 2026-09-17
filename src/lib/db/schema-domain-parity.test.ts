import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  IMPROVEMENT_REQUEST_BODY_MAX_CHARS,
  IMPROVEMENT_REQUEST_STATUSES,
} from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 🔴 스키마와 도메인이 같은 말을 하는가
 * ============================================================================
 * db/schema.ts 는 아무것도 import 하지 않는다 — drizzle-kit 이 그 파일을 Next 밖에서
 * 따로 읽기 때문이다(그 파일 머리말). 그래서 상태 값과 본문 상한이 스키마와 도메인에
 * **두 번** 적혀 있고, 둘이 갈라져도 컴파일이 잡아 주지 않는다.
 *
 * 갈라지면 어떻게 되나: 화면은 저장을 시도하고 DB 가 23514(CHECK 위반)로 거절해,
 * 사람에게는 **이유 없는 실패**만 남는다. 그래서 파일의 글자를 읽어 대조한다 —
 * 이웃 저장소(RF_Service_System)의 validation/improvement-request-input.test.ts 가
 * 쓰는 방법과 같다.
 * ============================================================================
 */

const SCHEMA_PATH = path.resolve(process.cwd(), "src/lib/db/schema.ts");
const schemaSource = fs.readFileSync(SCHEMA_PATH, "utf8");

test("상태 enum 의 값이 도메인의 목록과 글자 그대로 같다", () => {
  const enumBlock = schemaSource.match(
    /pgEnum\(\s*"improvement_request_status"\s*,\s*\[([\s\S]*?)\]\s*\)/,
  );
  assert.ok(enumBlock, "schema.ts 에서 improvement_request_status enum 을 찾지 못했습니다");

  const values = [...enumBlock[1].matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    values,
    [...IMPROVEMENT_REQUEST_STATUSES],
    "schema.ts 의 상태 값과 domain/improvement-request.ts 의 IMPROVEMENT_REQUEST_STATUSES 가 다릅니다",
  );
});

test("본문 길이 CHECK 의 수가 도메인의 상한과 같다", () => {
  const check = schemaSource.match(
    /improvement_requests_body_length[\s\S]*?BETWEEN\s+1\s+AND\s+(\d+)/,
  );
  assert.ok(check, "schema.ts 에서 improvement_requests_body_length CHECK 를 찾지 못했습니다");
  assert.equal(
    Number(check[1]),
    IMPROVEMENT_REQUEST_BODY_MAX_CHARS,
    "schema.ts 의 CHECK 와 IMPROVEMENT_REQUEST_BODY_MAX_CHARS 가 다릅니다",
  );
});

test("🔴 서비스·메뉴 칸에는 CHECK 를 두지 않는다 — 막는 곳은 검증 하나다", () => {
  // 승인된 설계다(schema.ts 머리말의 '서비스·메뉴에 CHECK 도 참조 표도 두지 않는다').
  // 누가 좋은 뜻으로 CHECK 를 걸면 메뉴 한 줄을 더할 때마다 마이그레이션이 붙고,
  // 메뉴를 뺄 때는 옛 글 때문에 새 CHECK 를 걸 수조차 없게 된다. 여기서 먼저 걸려
  // 그 결정을 다시 이야기하게 한다.
  assert.ok(
    !/check\(\s*"improvement_requests_service_key/.test(schemaSource),
    "service_key 에 CHECK 가 생겼습니다 — schema.ts 머리말의 결정을 먼저 보세요",
  );
  assert.ok(
    !/check\(\s*"improvement_requests_menu_key/.test(schemaSource),
    "menu_key 에 CHECK 가 생겼습니다 — schema.ts 머리말의 결정을 먼저 보세요",
  );
});

test("소프트 삭제 4칼럼이 개선요청 표에도 있다", () => {
  // 이 저장소의 규칙은 「물리 삭제를 하지 않는다」이고 4칼럼은 이름과 개수가
  // 고정이다(CLAUDE.md). 표가 늘 때 그 네 칸을 빠뜨리는 일이 실제로 일어난다.
  const table = schemaSource.slice(schemaSource.indexOf('pgTable(\n  "improvement_requests"'));
  assert.ok(table.length > 0, "improvement_requests 표를 찾지 못했습니다");
  assert.ok(/\.\.\.softDelete,/.test(table), "improvement_requests 에 소프트 삭제 4칼럼이 없습니다");
});
