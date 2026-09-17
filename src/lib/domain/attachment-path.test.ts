import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  AttachmentPathError,
  assertPortableStoredPath,
  buildImprovementRequestAttachmentStoredPath,
  IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX,
  isPortableStoredPath,
  resolveAttachmentAbsolutePath,
} from "./attachment-path";

/**
 * ============================================================================
 * 🔴 저장 경로에 사람이 준 글자가 섞이지 않는다
 * ============================================================================
 * 이 파일이 못 박는 것은 지시서의 관문 하나다 — 「저장 경로를 만들 때 사용자가 준
 * 문자열을 한 조각도 쓰지 마라」. 실제 파일 없이 전부 검증된다.
 * ============================================================================
 */

const REQUEST_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const ATTACHMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("🔴 경로는 UUID 둘과 확장자로만 만들어진다 — 원본 이름이 섞이지 않는다", () => {
  const storedPath = buildImprovementRequestAttachmentStoredPath({
    improvementRequestId: REQUEST_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "png",
  });
  assert.equal(
    storedPath,
    `${IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX}/${REQUEST_ID}/${ATTACHMENT_ID}.png`,
  );

  // 경로의 마디는 정확히 셋이고, 그중 둘은 UUID, 마지막은 UUID + 허용 확장자다.
  const segments = storedPath.split("/");
  assert.equal(segments.length, 3);
  assert.equal(segments[0], IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX);
  assert.match(segments[1], /^[0-9a-f-]{36}$/);
  assert.match(segments[2], /^[0-9a-f-]{36}\.(png|jpg|jpeg)$/);
});

test("🔴 사람이 준 이름의 어떤 조각도 경로에 나타날 수 없다", () => {
  // 이 함수는 파일 이름을 **받지 않는다.** 받는 것은 정규화된 확장자뿐이라,
  // 「이름을 넣을 자리」가 애초에 없다. 확장자 자리에 이름을 밀어 넣어도 막힌다.
  for (const attempt of [
    "../../etc/passwd",
    "png/../../secret",
    "png\\..\\x",
    "고객명단.png",
    "",
    "p n g",
    "pdf",
  ]) {
    assert.throws(
      () =>
        buildImprovementRequestAttachmentStoredPath({
          improvementRequestId: REQUEST_ID,
          attachmentId: ATTACHMENT_ID,
          extension: attempt,
        }),
      AttachmentPathError,
      `확장자 자리에 "${attempt}" 가 통과했습니다`,
    );
  }
});

test("🔴 UUID 가 아닌 id 는 다듬어 받지 않고 던진다", () => {
  for (const bad of ["", "not-a-uuid", "../..", `${REQUEST_ID}/..`, "1b9d6bcd"]) {
    assert.throws(
      () =>
        buildImprovementRequestAttachmentStoredPath({
          improvementRequestId: bad,
          attachmentId: ATTACHMENT_ID,
          extension: "png",
        }),
      AttachmentPathError,
      `글 id 로 "${bad}" 가 통과했습니다`,
    );
    assert.throws(
      () =>
        buildImprovementRequestAttachmentStoredPath({
          improvementRequestId: REQUEST_ID,
          attachmentId: bad,
          extension: "png",
        }),
      AttachmentPathError,
      `첨부 id 로 "${bad}" 가 통과했습니다`,
    );
  }
});

test("대문자 UUID 는 소문자로 눕혀 받는다 (NAS 는 대소문자를 가린다)", () => {
  const storedPath = buildImprovementRequestAttachmentStoredPath({
    improvementRequestId: REQUEST_ID.toUpperCase(),
    attachmentId: ATTACHMENT_ID.toUpperCase(),
    extension: "JPG",
  });
  assert.equal(storedPath, storedPath.toLowerCase());
});

test("🔴 DB 에서 읽은 경로도 그대로 믿지 않는다", () => {
  const good = `${IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX}/${REQUEST_ID}/${ATTACHMENT_ID}.png`;
  assert.equal(isPortableStoredPath(good), true);

  for (const bad of [
    "",
    "improvement-requests\\a\\b.png", // 역슬래시 — Linux 에서 파일명의 일부가 된다
    "/improvement-requests/a/b.png", // 절대경로
    "C:/improvement-requests/a/b.png", // 드라이브 문자
    "improvement-requests/A/b.png", // 대문자
    "improvement-requests/../../secret.png", // 상위 이동
    "improvement-requests//b.png", // 빈 마디
    "web_users/a/b.png", // 알 수 없는 첫 마디
    "improvement-requests/a/b.png\0", // 널 바이트
  ]) {
    assert.throws(
      () => assertPortableStoredPath(bad),
      AttachmentPathError,
      `"${bad}" 가 통과했습니다`,
    );
  }
});

test("🔴 절대 경로는 저장 루트 안에서만 나온다", () => {
  const root = path.resolve("/tmp/dss-improvements-uploads");
  const storedPath = `${IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX}/${REQUEST_ID}/${ATTACHMENT_ID}.png`;
  const absolute = resolveAttachmentAbsolutePath(root, storedPath);
  assert.ok(absolute.startsWith(root), "저장 루트 밖을 가리킵니다");
  assert.ok(absolute.endsWith(`${ATTACHMENT_ID}.png`));

  // 루트를 안 주면 던진다 — 조용히 현재 폴더를 쓰지 않는다.
  assert.throws(() => resolveAttachmentAbsolutePath("", storedPath), AttachmentPathError);
  // 루트 밖으로 나가려는 값은 앞의 검사에서 이미 걸린다.
  assert.throws(
    () => resolveAttachmentAbsolutePath(root, "improvement-requests/../../x.png"),
    AttachmentPathError,
  );
});
