import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-file";
import { IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT } from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 🔴 첨부의 관문이 **제자리에** 있는가
 * ============================================================================
 * 스크린샷을 붙이고 지우는 길은 세션 · 파일 · 트랜잭션이 함께 있어야 실제로 불러
 * 볼 수 있다. 이 목록의 시험은 DB 에 닿을 길이 없으므로(scripts/test-lists/unit.txt)
 * 부를 수 없다. 그래서 **구조**를 못 박는다 — 관문이 빠지거나, 세는 자리가 트랜잭션
 * 밖으로 나가거나, 지워진 첨부를 거르지 않게 되면 여기서 걸린다.
 *
 * 판정 자체의 옳음은 domain/attachment-file.test.ts(형식·크기) ·
 * domain/attachment-path.test.ts(경로) · domain/improvement-request-list.test.ts
 * (권한·다섯 장·되살리기) · storage/attachment-storage.test.ts(흘려보내며 재기)가 본다.
 *
 * 이 방법의 한계도 적어 둔다: 글자를 보는 시험이라 **함수가 있는지**는 알아도
 * **거절하는지**는 모른다. DB 에 붙는 통합 시험이 생기면 그쪽이 진짜 답이다
 * (목록을 하나 더 만드는 방법은 unit.txt 머리말). 그때까지는 이것이 「화면만
 * 막았다」와 「관문이 잠금 밖으로 나갔다」를 잡는 가장 싼 그물이다.
 * ============================================================================
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8");
}

/** 주석과 문자열을 걷어 낸 코드. 주석에 적힌 낱말이 시험을 통과시키지 않게. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const SCHEMA_PATH = "src/lib/db/schema.ts";
const QUERIES_PATH = "src/lib/db/queries/improvement-request-attachments.ts";
const MUTATIONS_PATH = "src/lib/db/mutations/improvement-request-attachments.ts";
const REQUEST_MUTATIONS_PATH = "src/lib/db/mutations/improvement-requests.ts";
const UPLOAD_ROUTE_PATH = "src/app/api/improvement-requests/[id]/attachments/route.ts";
const DOWNLOAD_ROUTE_PATH =
  "src/app/api/improvement-requests/[id]/attachments/[attachmentId]/route.ts";

const ACTIONS_PATH = "src/lib/server/actions/improvement-requests.ts";

const schema = read(SCHEMA_PATH);
const queries = read(QUERIES_PATH);
const queriesCode = codeOnly(queries);
const mutations = read(MUTATIONS_PATH);
const mutationsCode = codeOnly(mutations);
const actionsCode = codeOnly(read(ACTIONS_PATH));
const requestMutationsCode = codeOnly(read(REQUEST_MUTATIONS_PATH));
const uploadRoute = read(UPLOAD_ROUTE_PATH);
const uploadRouteCode = codeOnly(uploadRoute);
const downloadRoute = read(DOWNLOAD_ROUTE_PATH);
const downloadRouteCode = codeOnly(downloadRoute);

const ATTACHMENT_TABLE_MARKER = 'pgTable(\n  "improvement_request_attachments"';

/**
 * 한 함수의 글자만 잘라 낸다.
 *
 * 🔴 파일 전체를 보면 **옆 함수가 가진 관문이 이 함수를 통과시킨다.** 되살리기는
 * 붙이기·떼기와 같은 파일에 있고 같은 도우미를 부르므로, 파일 단위로 보는 시험으로는
 * 「되살리기만 다섯 장을 안 센다」를 잡지 못한다
 * (server/actions/improvement-requests-guard.test.ts 의 같은 도우미와 같은 까닭이다).
 */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`${name} 을(를) 찾지 못했습니다`);
  const next = source.indexOf("\nexport ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

/* ------------------------------------------------------------------ */
/* 스키마 ↔ 도메인                                                      */
/* ------------------------------------------------------------------ */

test("🔴 크기 CHECK 의 수가 도메인의 상한과 같다", () => {
  // 스키마는 아무것도 import 하지 않으므로(그 파일 머리말) 수가 두 번 적힌다.
  // 갈라지면 화면은 저장을 시도하고 DB 가 23514 로 거절해, 사람에게는 이유 없는
  // 실패만 남는다.
  const check = schema.match(
    /improvement_request_attachments_file_size[\s\S]*?BETWEEN\s+1\s+AND\s+(\d+)/,
  );
  assert.ok(check, "schema.ts 에서 file_size CHECK 를 찾지 못했습니다");
  assert.equal(
    Number(check[1]),
    MAX_ATTACHMENT_SIZE_BYTES,
    "schema.ts 의 CHECK 와 MAX_ATTACHMENT_SIZE_BYTES 가 다릅니다",
  );
});

test("🔴 DB 에서도 경로 모양을 강제한다 — UUID 둘과 허용 확장자뿐", () => {
  // 코드를 거치지 않고 손으로 넣은 SQL 한 줄이 저장 루트 밖을 가리키는 경로를
  // 만들지 못하게 하는 두 번째 겹이다.
  const check = schema.match(
    /improvement_request_attachments_stored_path_shape[\s\S]*?~\s*'([^']+)'/,
  );
  assert.ok(check, "schema.ts 에서 stored_path 모양 CHECK 를 찾지 못했습니다");
  const pattern = check[1];
  assert.match(pattern, /^\^improvement-requests\//, "첫 마디가 고정되어 있지 않습니다");
  assert.match(pattern, /\(png\|jpg\|jpeg\)\$$/, "확장자가 셋으로 고정되어 있지 않습니다");
  // 대문자·한글·역슬래시가 들어갈 자리가 정규식 자체에 없다.
  assert.ok(!/[A-Z]/.test(pattern), "패턴이 대문자를 받습니다");
  assert.ok(!/\\\\/.test(pattern), "패턴이 역슬래시를 받습니다");
});

test("첨부 표에도 소프트 삭제 4칼럼이 있다", () => {
  const table = schema.slice(schema.indexOf(ATTACHMENT_TABLE_MARKER));
  assert.ok(table.length > 0, "improvement_request_attachments 표를 찾지 못했습니다");
  assert.match(table, /\.\.\.softDelete,/, "첨부 표에 소프트 삭제 4칼럼이 없습니다");
});

test("첨부 id 에 DB 기본값을 두지 않는다 — 파일 이름이 먼저 정해져야 한다", () => {
  const table = schema.slice(schema.indexOf(ATTACHMENT_TABLE_MARKER));
  const idLine = table.match(/id:\s*uuid\("id"\)[^,\n]*/);
  assert.ok(idLine, "첨부 표의 id 칸을 찾지 못했습니다");
  assert.ok(
    !/defaultRandom/.test(idLine[0]),
    "첨부 id 에 defaultRandom 이 붙었습니다 — 파일을 놓기 전에 id 가 있어야 합니다",
  );
});

/* ------------------------------------------------------------------ */
/* 읽기 — 지워진 것은 안 나온다                                          */
/* ------------------------------------------------------------------ */

test("🔴 소프트 삭제된 첨부가 목록에도 내려받기에도 나오지 않는다", () => {
  // 조회가 넷이다 — 살아 있는 것을 읽는 **셋**과 휴지통 **하나**(2026-09-21 되살리기).
  // 셋은 모두 지워진 것을 걸러야 하고, 지워진 것을 읽어도 되는 곳은 휴지통뿐이다.
  // 하나라도 어긋나면 지운 스크린샷이 목록에 다시 나타나거나 통로로 계속 열린다.
  const selects = queriesCode.match(/\.select\(\{/g) ?? [];
  assert.equal(
    selects.length,
    4,
    `조회 수가 넷이 아닙니다(${selects.length}) — 늘었다면 이 시험도 함께 고치세요`,
  );

  // 주석을 걷지 않은 글자를 본다 — 조회 하나가 셈을 sql 템플릿(상관 하위질의)으로
  // 하는데, codeOnly 가 템플릿을 비우기 때문이다. `eq(…, false)` 와 `} = false` 를
  // 둘 다 센다.
  const liveGuards =
    queries.match(/improvementRequestAttachments\.isDeleted\}?\s*(?:,\s*false|=\s*false)/g) ?? [];
  assert.equal(
    liveGuards.length,
    3,
    `살아 있는 첨부만 읽는 조건이 ${liveGuards.length}곳입니다 — 휴지통을 뺀 세 조회 모두에 있어야 합니다`,
  );

  // 🔴 지워진 것을 읽어도 되는 곳은 휴지통 하나뿐이다. 둘이 되는 순간 「어느 조회가
  // 지운 것을 내놓는가」를 사람이 외워야 한다.
  const trashGuards = queries.match(/improvementRequestAttachments\.isDeleted,\s*true/g) ?? [];
  assert.equal(
    trashGuards.length,
    1,
    "지워진 첨부를 읽는 조회가 휴지통 말고 또 있습니다",
  );
  assert.match(
    queriesCode,
    /export async function listDeletedScreenshotsByRequestIds\(/,
    "휴지통 조회를 찾지 못했습니다",
  );

  // 글이 지워졌으면 그 글의 첨부도 열리지 않는다.
  const requestGuards = queries.match(/improvementRequests\.isDeleted/g) ?? [];
  assert.ok(
    requestGuards.length >= 2,
    "지워진 글의 첨부가 열립니다 — 글의 is_deleted 조건이 모자랍니다",
  );
});

test("🔴 첨부 하나를 읽을 때 글 id 와 짝으로 본다", () => {
  assert.match(
    queriesCode,
    /eq\(\s*improvementRequestAttachments\.improvementRequestId,\s*params\.improvementRequestId,?\s*\)/,
    "첨부를 id 하나로만 찾고 있습니다 — 남의 글의 첨부가 열립니다",
  );
});

/* ------------------------------------------------------------------ */
/* 다섯 장 — 잠근 트랜잭션 안에서 센다                                    */
/* ------------------------------------------------------------------ */

test("🔴 다섯 장은 글 행을 잠근 트랜잭션 안에서 센다", () => {
  assert.match(mutationsCode, /db\.transaction\(/, "트랜잭션이 없습니다");
  assert.match(mutationsCode, /\.for\(\s*""\s*\)/, "글 행을 잠그지(FOR UPDATE) 않습니다");

  // 세는 함수가 트랜잭션 인자(tx)를 받아야 한다 — db 를 직접 쓰면 잠금 밖이다.
  assert.match(
    mutationsCode,
    /async function countLiveAttachments\(\s*tx:\s*Tx/,
    "첨부를 세는 함수가 트랜잭션을 받지 않습니다 — 잠금 밖에서 세면 여섯 장이 됩니다",
  );
  assert.match(
    mutationsCode,
    /hasImprovementRequestScreenshotRoom\(\s*liveCount\s*\)/,
    "잠근 트랜잭션 안에서 다섯 장을 판정하지 않습니다",
  );
  assert.ok(
    !/countLiveAttachments\(\s*db\s*,/.test(mutationsCode),
    "첨부를 잠금 밖(db)에서 세고 있습니다",
  );
  // 🔴 붙이기 **그 함수 안에서** 세는지 본다. 파일 전체로 보면 옆 함수(되살리기)의
  // 셈이 이 함수를 통과시킨다 — `const liveCount = 0` 한 줄로 관문이 비어도
  // 파일에는 countLiveAttachments 가 남아 있다.
  assert.match(
    codeOnly(functionSource(mutations, "createImprovementRequestAttachment")),
    /countLiveAttachments\(\s*tx,\s*request\.id\s*\)/,
    "붙이기가 자기 트랜잭션 안에서 살아 있는 첨부를 세지 않습니다",
  );
  assert.equal(IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT, 5);
});

test("붙이기·떼기·되살리기 모두 글에 대한 판정을 다시 부른다", () => {
  const guards = mutationsCode.match(/canChangeImprovementRequestScreenshots\(/g) ?? [];
  assert.ok(
    guards.length >= 3,
    `판정이 ${guards.length}곳뿐입니다 — 붙이기·떼기·되살리기 셋 다여야 합니다`,
  );
});

/* ------------------------------------------------------------------ */
/* 되살리기 — 휴지통에서 돌아오는 길도 같은 관문을 지난다                 */
/* ------------------------------------------------------------------ */

const restoreMutationRaw = () => functionSource(mutations, "restoreImprovementRequestAttachment");
const restoreMutationCode = () => codeOnly(restoreMutationRaw());

test("🔴 되살리기도 잠근 트랜잭션 안에서 다섯 장을 다시 센다", () => {
  // 이것이 없으면 다섯 장을 채운 뒤 한 장 지웠다 되살리는 것만으로 **여섯 장**이
  // 된다 — 붙이기 쪽 관문은 INSERT 에만 서 있어서 이 길을 보지 못한다.
  const code = restoreMutationCode();
  assert.match(
    code,
    /lockImprovementRequest\(\s*tx,\s*params\.improvementRequestId\s*\)/,
    "되살리기가 글 행을 잠그지 않습니다",
  );
  assert.match(
    code,
    /countLiveAttachments\(\s*tx,\s*request\.id\s*\)/,
    "되살리기가 살아 있는 첨부를 잠근 트랜잭션 안에서 세지 않습니다",
  );
  assert.match(
    code,
    /decideImprovementRequestScreenshotRestore\(\{[\s\S]*?liveCount[\s\S]*?\}\)/,
    "센 수로 되살리기 판정을 하지 않습니다 — 다섯 장 관문이 없는 것과 같습니다",
  );
  // 판정 자체(다섯 장이면 거절)의 옳음은 domain/improvement-request-list.test.ts 가 본다.
  assert.match(
    restoreMutationRaw(),
    /failure\(\s*"LIMIT_REACHED"/,
    "자리가 없을 때 LIMIT_REACHED 로 거절하지 않습니다",
  );
});

test("🔴 되살리기가 소프트 삭제 4칼럼을 모두 되돌린다 — 그래야 목록에 다시 보인다", () => {
  // 읽는 쪽은 `is_deleted = false` 로 거른다(위 '소프트 삭제된 첨부가 …' 시험). 그래서
  // 이 UPDATE 가 is_deleted 를 내리는 순간 그 장은 목록과 내려받기 통로에 다시 나온다.
  // 나머지 셋을 남겨 두면 「살아 있는데 지워진 기록이 붙은」 행이 된다.
  const raw = restoreMutationRaw();
  const setAt = raw.indexOf(".set({");
  assert.ok(setAt > 0, "되살리기의 UPDATE 를 찾지 못했습니다");
  const setBlock = raw.slice(setAt, raw.indexOf(".where(", setAt));
  assert.match(setBlock, /isDeleted:\s*false/, "is_deleted 를 내리지 않습니다 — 되살아나지 않습니다");
  assert.match(setBlock, /deletedAt:\s*null/, "deleted_at 을 비우지 않습니다");
  assert.match(setBlock, /deletedBy:\s*null/, "deleted_by 를 비우지 않습니다");
  assert.match(setBlock, /deleteReason:\s*null/, "delete_reason 을 비우지 않습니다");
});

test("🔴 되살리기도 글 id 와 짝으로 찾고, 이미 살아 있는 행은 건드리지 않는다", () => {
  const code = restoreMutationCode();
  assert.match(
    code,
    /eq\(\s*improvementRequestAttachments\.improvementRequestId,\s*request\.id,?\s*\)/,
    "첨부를 id 하나로 되살리고 있습니다 — 내 글 권한으로 남의 글의 첨부를 되살릴 수 있습니다",
  );
  const where = code.slice(code.indexOf(".set({"));
  assert.match(
    where,
    /eq\(\s*improvementRequestAttachments\.isDeleted,\s*true,?\s*\)/,
    "조건부 UPDATE 의 WHERE 에 is_deleted = true 가 없습니다",
  );
});

test("🔴 되살리기 액션도 살아 있는 계정의 역할로 다시 판정한다", () => {
  const action = codeOnly(
    functionSource(read(ACTIONS_PATH), "restoreImprovementRequestAttachmentAction"),
  );
  assert.match(action, /getSessionUser\(\)/, "세션을 읽지 않습니다");
  assert.match(action, /canWriteImprovementRequests\(\s*actor\.role\s*\)/, "쓰기 관문이 없습니다");
  assert.match(
    action,
    /const canManage = canManageImprovementRequests\(\s*actor\.role\s*\)/,
    "관리 권한을 살아 있는 계정의 역할이 아닌 곳에서 얻고 있습니다",
  );
  assert.match(action, /actorUserId:\s*actor\.id/, "작성자 대조에 쓸 id 가 세션에서 오지 않습니다");
  assert.ok(
    !/canManage:\s*input\./.test(actionsCode),
    "요청 본문의 값으로 관리 권한을 넘기고 있습니다",
  );
});

test("🔴 떼기도 글 id 와 짝으로 찾는다", () => {
  assert.match(
    mutationsCode,
    /eq\(\s*improvementRequestAttachments\.improvementRequestId,\s*request\.id,?\s*\)/,
    "첨부를 id 하나로 지우고 있습니다 — 내 글 권한으로 남의 글의 첨부를 지울 수 있습니다",
  );
});

test("글을 지우면 붙은 첨부도 같은 트랜잭션에서 지워진다", () => {
  const deleteBlock = requestMutationsCode.slice(
    requestMutationsCode.indexOf("export async function deleteImprovementRequest("),
  );
  assert.ok(deleteBlock.length > 0, "deleteImprovementRequest 를 찾지 못했습니다");
  assert.match(
    deleteBlock,
    /tx\s*\.update\(improvementRequestAttachments\)/,
    "글만 지우고 첨부를 남깁니다 — 목록에 안 나오는데 살아 있는 행이 됩니다",
  );
  assert.match(
    deleteBlock,
    /canDeleteImprovementRequest\(/,
    "지우기 판정을 저장 쪽에서 다시 보지 않습니다",
  );
});

/* ------------------------------------------------------------------ */
/* 올리기 통로 — 관문 다섯                                               */
/* ------------------------------------------------------------------ */

test("🔴 형식은 앞머리 바이트로 판정한다 — 이름만 바꾼 파일이 막힌다", () => {
  assert.match(
    uploadRouteCode,
    /isContentCompatibleWithExtension\(\s*extension,\s*written\.header\s*\)/,
    "내용 대조가 없습니다 — 확장자만 보고 받고 있습니다",
  );
});

test("🔴 크기는 흘려보내며 센다 — 다 받아 놓고 재지 않는다", () => {
  assert.match(
    uploadRouteCode,
    /storage\.writeTemp\(\s*body,\s*\{\s*maxBytes:\s*MAX_ATTACHMENT_SIZE_BYTES\s*\}\s*\)/,
    "상한을 흘려보내는 자리에 넘기지 않습니다",
  );
  assert.match(uploadRouteCode, /AttachmentTooLargeError/, "상한 초과를 413 으로 가르지 않습니다");
  // Content-Length 는 빠른 거절일 뿐이고, 그것만으로 판정하지 않는다.
  assert.match(uploadRoute, /content-length/i);
});

test("🔴 장수는 통로 앞과 트랜잭션 안, 두 번 본다", () => {
  assert.match(
    uploadRouteCode,
    /hasImprovementRequestScreenshotRoom\(\s*target\.liveAttachmentCount\s*\)/,
    "본문을 받기 전의 빠른 거절이 없습니다",
  );
  assert.match(
    uploadRouteCode,
    /createImprovementRequestAttachment\(/,
    "잠근 트랜잭션의 저장을 부르지 않습니다",
  );
});

test("🔴 경로는 사람이 준 문자열을 쓰지 않는다", () => {
  const at = uploadRouteCode.indexOf("buildImprovementRequestAttachmentStoredPath(");
  assert.ok(at > 0, "경로를 만드는 함수를 부르지 않습니다");
  const call = uploadRouteCode.slice(at, at + 260);
  assert.match(
    call,
    /\{[\s\S]*?improvementRequestId:\s*target\.id,[\s\S]*?attachmentId,[\s\S]*?extension,[\s\S]*?\}/,
    "경로 인자가 UUID 둘과 확장자가 아닙니다",
  );
  assert.ok(
    !/originalFileName/.test(call),
    "경로를 만들 때 원본 파일 이름을 넘기고 있습니다",
  );
  assert.match(
    uploadRouteCode,
    /randomUUID\(\)\.toLowerCase\(\)/,
    "첨부 id 를 UUID 로 만들지 않습니다",
  );
});

test("🔴 권한은 살아 있는 계정에서 온다 — 요청이 보낸 값이 아니다", () => {
  assert.match(uploadRouteCode, /getSessionUser\(\)/, "세션을 읽지 않습니다");
  assert.match(uploadRouteCode, /canWriteImprovementRequests\(\s*actor\.role\s*\)/);
  assert.match(
    uploadRouteCode,
    /const canManage = canManageImprovementRequests\(\s*actor\.role\s*\)/,
    "관리 권한을 살아 있는 계정의 역할이 아닌 곳에서 얻고 있습니다",
  );
  assert.match(
    uploadRouteCode,
    /canChangeImprovementRequestScreenshots\(\{[\s\S]*?actorUserId:\s*actor\.id/,
    "글 한 건에 대한 판정을 하지 않거나 세션의 사용자를 쓰지 않습니다",
  );
});

test("🔴 MIME 은 확장자에서 서버가 고른다", () => {
  assert.match(uploadRouteCode, /canonicalMimeTypeForExtension\(\s*extension\s*\)/);
  assert.ok(
    !/mimeType:\s*request\.headers\.get/.test(uploadRouteCode),
    "브라우저가 보낸 Content-Type 을 그대로 저장하고 있습니다",
  );
});

test("🔴 파일을 먼저 놓고 DB 를 나중에 쓴다", () => {
  const commitAt = uploadRouteCode.indexOf("storage.commit(");
  const recordAt = uploadRouteCode.indexOf("createImprovementRequestAttachment(");
  assert.ok(commitAt > 0 && recordAt > 0, "두 단계를 찾지 못했습니다");
  assert.ok(
    commitAt < recordAt,
    "DB 를 먼저 쓰고 있습니다 — 파일 쓰기가 실패하면 가리키는 파일이 없는 행이 남습니다",
  );
  // 기록에 실패하면 놓은 파일을 치운다.
  assert.match(
    uploadRouteCode,
    /storage\.delete\(storedPath\)/,
    "실패했을 때 놓은 파일을 치우지 않습니다",
  );
});

test("올리기 통로가 교차 출처 요청을 거절한다", () => {
  // 쿠키로 인증하는 POST 라, 이것이 없으면 남의 사이트의 <form> 한 줄이 로그인한
  // 사람의 쿠키로 이 통로를 부를 수 있다(서버 액션과 달리 Next 가 해 주지 않는다).
  assert.match(uploadRouteCode, /function isSameOriginRequest\(/);
  assert.match(uploadRouteCode, /if\s*\(!isSameOriginRequest\(request\)\)/);
});

/* ------------------------------------------------------------------ */
/* 내려받기 통로                                                         */
/* ------------------------------------------------------------------ */

test("🔴 내려받기·미리보기도 로그인한 사람만", () => {
  assert.match(downloadRouteCode, /getSessionUser\(\)/, "세션을 읽지 않습니다");
  assert.match(downloadRouteCode, /canViewImprovementRequests\(\s*actor\.role\s*\)/);
});

test("🔴 그 첨부가 그 글의 것인지 확인한다", () => {
  assert.match(
    downloadRouteCode,
    /getImprovementRequestAttachmentFile\(\{\s*improvementRequestId,\s*attachmentId\s*\}\)/,
    "글 id 와 짝으로 찾지 않습니다",
  );
});

test("응답 헤더를 서버가 정한다 (nosniff · DB 의 mime_type)", () => {
  assert.match(downloadRoute, /X-Content-Type-Options/);
  assert.match(downloadRoute, /nosniff/);
  assert.match(downloadRouteCode, /file\.mimeType/);
});
