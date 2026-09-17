import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTACHMENT_EXTENSIONS,
  canonicalMimeTypeForExtension,
  checkAttachmentFile,
  isAttachmentExtension,
  isContentCompatibleWithExtension,
  MAX_ATTACHMENT_SIZE_BYTES,
  normalizeFileExtension,
} from "./attachment-file";

/**
 * ============================================================================
 * 🔴 형식 관문 — 이름만 바꾼 파일이 들어오지 못한다
 * ============================================================================
 * 확장자도 브라우저가 보낸 Content-Type 도 사람이 마음대로 적을 수 있는 값이다.
 * 여기서 못 박는 것은 「앞머리 바이트가 확장자가 주장하는 형식과 같은가」이고,
 * 그것이 올리기 통로가 실제로 부르는 판정이다.
 * ============================================================================
 */

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
/** 윈도우 실행 파일("MZ"). 이름을 .png 로 바꿔 올리는 그 파일이다. */
const EXE_HEADER = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

test("🔴 png 가 아닌 것을 .png 로 위장해 올리면 거절된다", () => {
  // 이름은 통과한다 — 확장자만 보는 검사는 이 파일을 막지 못한다.
  assert.equal(normalizeFileExtension("보고서.png"), "png");
  assert.equal(isAttachmentExtension("png"), true);

  // 내용 대조가 막는다.
  assert.equal(isContentCompatibleWithExtension("png", EXE_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("png", PDF_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("png", JPEG_HEADER), false);
});

test("🔴 jpg·jpeg 도 앞머리로 판정한다 — 확장자를 바꿔 끼울 수 없다", () => {
  assert.equal(isContentCompatibleWithExtension("jpg", JPEG_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("jpeg", JPEG_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("jpg", PNG_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("jpeg", EXE_HEADER), false);
});

test("제대로 된 png 는 통과한다", () => {
  assert.equal(isContentCompatibleWithExtension("png", PNG_HEADER), true);
});

test("빈 앞머리는 언제나 거절이다 (빈 파일이 통과하지 않는다)", () => {
  assert.equal(isContentCompatibleWithExtension("png", new Uint8Array(0)), false);
  assert.equal(isContentCompatibleWithExtension("jpg", new Uint8Array(0)), false);
});

test("🔴 받지 않는 확장자는 앞머리가 맞아도 거절이다", () => {
  // 이 함수만 따로 불러도 열리지 않아야 한다 — 앞 단계에 기대지 않는다.
  assert.equal(isContentCompatibleWithExtension("pdf", PDF_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("exe", EXE_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("webp", PNG_HEADER), false);
});

test("🔴 확장자 정규화가 경로 조작 글자를 통째로 거절한다", () => {
  // 여기서 null 이 나오면 그 이름으로는 경로를 만들 수 없다.
  assert.equal(normalizeFileExtension("shot.pn g"), null);
  assert.equal(normalizeFileExtension("shot.pn/g"), null);
  assert.equal(normalizeFileExtension("shot.pn\\g"), null);
  assert.equal(normalizeFileExtension("shot.."), null);
  assert.equal(normalizeFileExtension(".."), null);
  assert.equal(normalizeFileExtension("shot"), null);
  assert.equal(normalizeFileExtension(".png"), null); // 이름이 없다
  assert.equal(normalizeFileExtension("shot."), null);
  assert.equal(normalizeFileExtension("shot.pn\0g"), null);
});

test("🔴 두 겹 확장자로 속이려는 이름은 마지막 것으로 판정된다", () => {
  // `shot.png\0.exe` 는 널 바이트 뒤의 `.exe` 가 마지막 마디다. 확장자는 exe 이고,
  // 받는 셋에 없으므로 거절된다 — 앞의 `.png` 가 통행증이 되지 않는다.
  assert.equal(normalizeFileExtension("shot.png\0.exe"), "exe");
  assert.equal(isAttachmentExtension("exe"), false);
  assert.equal(normalizeFileExtension("shot.png.exe"), "exe");
});

test("확장자는 소문자로 눕힌다 (NAS 는 대소문자를 가린다)", () => {
  assert.equal(normalizeFileExtension("SHOT.PNG"), "png");
  assert.equal(normalizeFileExtension("  화면 캡처.JPEG  "), "jpeg");
});

test("MIME 은 확장자에서 서버가 고른다 — 올린 쪽이 보낸 값이 아니다", () => {
  assert.equal(canonicalMimeTypeForExtension("png"), "image/png");
  assert.equal(canonicalMimeTypeForExtension("jpg"), "image/jpeg");
  assert.equal(canonicalMimeTypeForExtension("jpeg"), "image/jpeg");
  assert.equal(canonicalMimeTypeForExtension("pdf"), null);
});

test("받는 확장자는 셋뿐이다", () => {
  assert.deepEqual([...ATTACHMENT_EXTENSIONS], ["png", "jpg", "jpeg"]);
  for (const extension of ["pdf", "gif", "webp", "svg", "exe", "zip", ""]) {
    assert.equal(isAttachmentExtension(extension), false, `${extension} 가 열려 있습니다`);
  }
});

test("🔴 20MB 를 넘는 것은 사전 검사에서 거절된다", () => {
  assert.equal(MAX_ATTACHMENT_SIZE_BYTES, 20 * 1024 * 1024);
  assert.equal(checkAttachmentFile({ name: "a.png", size: MAX_ATTACHMENT_SIZE_BYTES }), null);
  const reason = checkAttachmentFile({ name: "a.png", size: MAX_ATTACHMENT_SIZE_BYTES + 1 });
  assert.ok(reason !== null, "20MB + 1 바이트가 통과했습니다");
  assert.match(reason, /20MB/);
});

test("사전 검사의 차례는 형식 → 빈 파일 → 크기다", () => {
  // 형식이 틀리면 크기를 말하지 않는다 — 고쳐야 할 것 하나만 알린다.
  const tooBigAndWrongFormat = checkAttachmentFile({
    name: "a.pdf",
    size: MAX_ATTACHMENT_SIZE_BYTES + 1,
  });
  assert.match(String(tooBigAndWrongFormat), /png/);
  assert.equal(checkAttachmentFile({ name: "a.png", size: 0 }), "빈 파일");
  assert.equal(checkAttachmentFile({ name: "a.png", size: 1 }), null);
});
