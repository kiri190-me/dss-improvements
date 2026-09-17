import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * ============================================================================
 * 🔴 저장 쪽이 권한을 **다시** 본다 — 화면만 막지 않는다
 * ============================================================================
 * 서버 액션은 브라우저에서 직접 부를 수 있는 통로다. 화면이 단추를 감추는 것은
 * 편의일 뿐이고, 실제로 거절하는 곳은 액션이어야 한다.
 *
 * ── 왜 파일의 글자를 읽는가 ─────────────────────────────────────────────
 * 액션을 실제로 불러 보려면 요청 컨텍스트(쿠키)와 DB 가 있어야 한다. 이 목록의
 * 시험은 DB 에 닿을 길이 없어야 하므로(scripts/test-lists/unit.txt) 부를 수 없다.
 * 그래서 **구조**를 못 박는다 — 관문이 빠지거나, 클라이언트가 보낸 값으로 권한을
 * 판정하기 시작하면 여기서 걸린다. 판정 자체의 옳음은
 * auth/improvement-request-authorization.test.ts 가, 글 한 건에 대한 규칙은
 * domain/improvement-request.test.ts 가 본다.
 *
 * 이 방법의 한계도 적어 둔다: 글자를 보는 시험이라 **함수가 있는지**는 알아도
 * **거절하는지**는 모른다. DB 에 붙는 통합 시험이 생기면 그쪽이 진짜 답이다
 * (목록을 하나 더 만드는 방법은 unit.txt 머리말). 그때까지는 이것이 「화면만
 * 막았다」를 잡는 가장 싼 그물이다.
 * ============================================================================
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8");
}

const ACTIONS_PATH = "src/lib/server/actions/improvement-requests.ts";
const MUTATIONS_PATH = "src/lib/db/mutations/improvement-requests.ts";
const actions = read(ACTIONS_PATH);
const mutations = read(MUTATIONS_PATH);

/** 주석과 문자열을 걷어 낸 코드. 주석에 적힌 낱말이 시험을 통과시키지 않게. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const actionsCode = codeOnly(actions);
const mutationsCode = codeOnly(mutations);

test("서버 액션 파일이다 (브라우저에서 직접 부를 수 있는 통로다)", () => {
  assert.ok(actions.startsWith('"use server";'), `${ACTIONS_PATH} 첫 줄이 "use server" 가 아닙니다`);
});

test("🔴 역할은 살아 있는 계정에서 읽는다 — 쿠키에 박힌 값이 아니다", () => {
  // getSessionUser 는 매 요청 web_users 한 행을 읽는다(auth/session.ts). 이것을
  // 빼면 강등·정지된 사람이 토큰 만료까지 예전 권한으로 저장한다.
  assert.match(actionsCode, /getSessionUser\(\)/);
  const calls = actionsCode.match(/getSessionUser\(\)/g) ?? [];
  assert.ok(calls.length >= 2, "두 액션이 각자 세션을 읽어야 합니다(한 곳에서만 읽으면 하나가 뚫린다)");
});

test("🔴 두 액션 모두 권한 함수를 부른다", () => {
  assert.match(actionsCode, /canWriteImprovementRequests\(/, "적기 관문이 없습니다");
  assert.match(actionsCode, /canManageImprovementRequests\(/, "상태 옮기기 관문이 없습니다");
});

test("🔴 권한 판정에 요청 본문의 값을 쓰지 않는다", () => {
  // 클라이언트가 보낸 역할·사용자 id·「관리자입니다」를 받으면 관문이 무의미하다.
  assert.ok(
    !/canManageImprovementRequests\(\s*input\./.test(actionsCode),
    "요청 본문의 값으로 관리 권한을 판정하고 있습니다",
  );
  assert.ok(
    !/canWriteImprovementRequests\(\s*input\./.test(actionsCode),
    "요청 본문의 값으로 쓰기 권한을 판정하고 있습니다",
  );
  for (const forbidden of [/input\.role/, /input\.canManage/, /input\.actorUserId/]) {
    assert.ok(!forbidden.test(actionsCode), `요청 본문에서 ${forbidden} 를 읽고 있습니다`);
  }
});

test("🔴 저장(mutation)도 권한과 입력을 한 번 더 본다", () => {
  // 액션을 거치지 않는 길(시험 · 나중의 이관 스크립트)이 생겨도 규칙이 남는다.
  assert.match(mutationsCode, /canChangeImprovementRequestStatus\(/);
  assert.match(
    mutationsCode,
    /validateImprovementRequestFields\(/,
    "저장이 입력 검증을 다시 부르지 않습니다 — service_key·menu_key 에는 DB CHECK 가 없습니다",
  );
});

test("🔴 낙관적 잠금이 두 겹이다 — 판정과 조건부 UPDATE", () => {
  assert.match(mutationsCode, /decideImprovementRequestWrite\(/, "잠근 행에 대한 판정이 없습니다");
  assert.match(mutationsCode, /\.for\(\s*""\s*\)/, "행을 잠그지(FOR UPDATE) 않습니다");
  // UPDATE 의 WHERE 에 version 을 함께 적는다 — 잠금을 빼먹은 길이 생겨도
  // 앞사람의 변경을 덮지 않게(mutations 머리말).
  assert.match(
    mutationsCode,
    /eq\(improvementRequests\.version,\s*params\.expectedVersion\)/,
    "조건부 UPDATE 의 WHERE 에 version 이 없습니다",
  );
});

test("🔴 예상 밖 DB 오류를 통째로 로그하지 않는다 (본문에 PII 가 섞일 수 있다)", () => {
  // drizzle 의 오류 메시지에는 쿼리 인자가, Postgres 의 CHECK 오류 detail 에는
  // 행 전체가 실려 온다. 그대로 console 에 넘기면 본문이 로그에 남는다.
  assert.match(actionsCode, /describeErrorWithoutValues\(/);
  assert.ok(
    !/console\.error\([^)]*,\s*err\s*\)/.test(actionsCode),
    "오류 객체를 그대로 console.error 에 넘기고 있습니다",
  );
});
