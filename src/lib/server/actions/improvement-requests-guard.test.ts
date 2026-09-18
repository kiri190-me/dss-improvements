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

/* ── 고치기 — 접수 상태인 자기 글 ─────────────────────────────────────── */

/**
 * 한 함수의 글자만 잘라 낸다.
 *
 * 🔴 파일 전체를 보면 **옆 함수가 가진 관문이 이 함수를 통과시킨다.** 고치기는
 * 지우기·상태 옮기기와 규칙이 다른 함수(관리자 예외가 없다)라, 파일 단위로 보는
 * 시험으로는 「고치기만 뚫린」 상태를 잡지 못한다.
 */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`${name} 을(를) 찾지 못했습니다`);
  const next = source.indexOf("\nexport ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

const updateMutationRaw = () => functionSource(mutations, "updateImprovementRequestBody");
const updateMutationCode = () => codeOnly(updateMutationRaw());
const updateActionCode = () => codeOnly(functionSource(actions, "updateImprovementRequestAction"));

test("🔴 고치기 판정의 재료는 **잠근 행**에서만 온다", () => {
  // 화면이 「내 글입니다」라고 말한 값으로 판정하면 관문이 무의미하다. status 와
  // created_by 는 잠그고 읽은 행(current)의 것이어야 한다 — created_by 가 null 인
  // 옮겨 온 글이 거절되는 것도 이 한 줄에 달려 있다.
  const code = updateMutationCode();
  assert.match(code, /lockImprovementRequest\(\s*tx,\s*params\.id\s*\)/, "행을 잠그지 않습니다");
  assert.match(
    code,
    /canEditImprovementRequestBody\(\{[\s\S]*?status:\s*current\.status[\s\S]*?createdBy:\s*current\.createdBy[\s\S]*?actorUserId:\s*params\.actorUserId[\s\S]*?\}\)/,
    "고치기 판정을 잠근 행의 값으로 부르지 않습니다",
  );
});

test("🔴 관리자여도 남의 글 내용은 못 고친다 — canManage 를 받지도 쓰지도 않는다", () => {
  // 인자로 받아 두면 언젠가 「관리자는 예외」가 한 줄로 끼어든다. 아예 없으면
  // 그 줄을 적을 수 없다(domain 의 canEditImprovementRequestBody 주석).
  assert.ok(
    !/canManage/.test(updateMutationCode()),
    "고치기 저장이 관리 권한을 다루고 있습니다 — 관리자도 남의 글 내용은 못 고칩니다",
  );
  assert.ok(
    !/canManage/.test(updateActionCode()),
    "고치기 액션이 관리 권한을 구하고 있습니다 — 고치기에는 쓰이지 않는 값입니다",
  );
});

test("🔴 고치기도 낙관적 잠금이 두 겹이다 — 그 사이 누가 바꿨으면 거절", () => {
  const code = updateMutationCode();
  assert.match(code, /decideImprovementRequestWrite\(/, "잠근 행에 대한 판정이 없습니다");
  assert.match(
    code,
    /eq\(improvementRequests\.version,\s*params\.expectedVersion\)/,
    "조건부 UPDATE 의 WHERE 에 version 이 없습니다",
  );
});

test("🔴 고치면 version 이 오르고 updated_by·updated_at 이 채워진다", () => {
  // 주석을 걷지 않은 글자를 본다 — 템플릿 문자열(sql`…`)이 codeOnly 에서 비워지기 때문.
  const raw = updateMutationRaw();
  assert.match(
    raw,
    /version:\s*sql`\$\{improvementRequests\.version\}\s*\+\s*1`/,
    "version 을 올리지 않습니다 — 다음 사람의 낙관적 잠금이 통째로 무의미해집니다",
  );
  assert.match(raw, /updatedBy:\s*params\.actorUserId/, "updated_by 를 채우지 않습니다");
  assert.match(raw, /updatedAt:\s*now/, "updated_at 을 채우지 않습니다");
});

test("🔴 고치는 것은 본문·시스템·메뉴 셋이고, 상태는 아니다", () => {
  const code = updateMutationCode();
  const setBlock = code.slice(code.indexOf(".set({"), code.indexOf(".where("));
  assert.ok(setBlock.length > 0, "고치기의 UPDATE 를 찾지 못했습니다");
  for (const field of ["body", "serviceKey", "menuKey"]) {
    assert.match(setBlock, new RegExp(`\\b${field}\\b`), `${field} 를 고칠 수 없습니다`);
  }
  // 상태는 관리자만 옮긴다(changeImprovementRequestStatus). 여기로 새면 작성자가
  // 자기 글의 상태를 되돌릴 수 있게 된다 — 네 칸(in_progress_*·resolved_*)도
  // 함께 계산되지 않아 DB CHECK 와 어긋난다.
  assert.ok(!/\bstatus\b/.test(setBlock), "고치기가 상태 칸을 쓰고 있습니다");
});

test("🔴 고치기 저장도 입력을 다시 검증한다", () => {
  assert.match(
    updateMutationCode(),
    /validateImprovementRequestFields\(/,
    "service_key·menu_key 에는 DB CHECK 가 없습니다 — 검증을 건너뛰면 아무 글자나 저장됩니다",
  );
});

test("🔴 고치기 액션이 세션과 쓰기 권한을 처음부터 다시 본다", () => {
  const code = updateActionCode();
  assert.match(code, /getSessionUser\(\)/, "세션을 읽지 않습니다");
  assert.match(code, /canWriteImprovementRequests\(\s*actor\.role\s*\)/, "쓰기 관문이 없습니다");
  assert.match(code, /targetFieldErrors\(input\)/, "id·version 을 보지 않습니다");
  assert.match(code, /actorUserId:\s*actor\.id/, "작성자 대조에 쓸 id 가 세션에서 오지 않습니다");
  assert.ok(
    !/actorUserId:\s*input\./.test(code),
    "요청 본문의 사용자 id 를 저장에 넘기고 있습니다",
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
