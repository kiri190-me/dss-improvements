import assert from "node:assert/strict";
import test from "node:test";

import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-file";
import {
  isPlaceholderPastedName,
  kstFileStamp,
  nameScreenshotFile,
  pastedScreenshotName,
  pickPastedScreenshots,
  screenshotBatchNotice,
  screenshotUploadUrl,
  screenScreenshotBatch,
  screenshotUrl,
  type ClipboardItemLike,
} from "./improvement-request-screenshot-files";

/**
 * ============================================================================
 * 화면의 사전 검사 — 편의이지 관문이 아니다
 * ============================================================================
 * 여기서 못 박는 것은 「사람에게 무엇을 어떻게 알리는가」다. 실제로 막는 것은
 * 올리기 통로이고, 그쪽의 구조는 db/attachment-guard.test.ts 가 본다.
 * ============================================================================
 */

function fakeFile(name: string, size: number): { name: string; size: number } {
  return { name, size };
}

test("한 장이 틀려도 나머지는 받는다", () => {
  const batch = screenScreenshotBatch(
    [
      fakeFile("a.png", 10),
      fakeFile("b.pdf", 10), // 형식
      fakeFile("c.jpg", 10),
    ],
    0,
  );
  assert.deepEqual(
    batch.accepted.map((file) => file.name),
    ["a.png", "c.jpg"],
  );
  assert.equal(batch.rejected.length, 1);
  assert.equal(batch.rejected[0].fileName, "b.pdf");
  assert.equal(batch.overflowCount, 0);
});

test("🔴 이미 붙은 장을 세어 다섯 장까지만 받는다", () => {
  const files = [1, 2, 3, 4, 5].map((n) => fakeFile(`${n}.png`, 10));
  const batch = screenScreenshotBatch(files, 3);
  assert.deepEqual(
    batch.accepted.map((file) => file.name),
    ["1.png", "2.png"],
  );
  assert.equal(batch.overflowCount, 3);

  const full = screenScreenshotBatch(files, 5);
  assert.equal(full.accepted.length, 0);
  assert.equal(full.overflowCount, 5);
});

test("검사에 걸린 장은 자리를 차지하지 않는다", () => {
  const batch = screenScreenshotBatch(
    [fakeFile("bad.pdf", 10), fakeFile("a.png", 10), fakeFile("b.png", 10)],
    3,
  );
  // 남은 자리는 둘 — 형식에 걸린 bad.pdf 가 그 자리를 먹지 않는다.
  assert.deepEqual(
    batch.accepted.map((file) => file.name),
    ["a.png", "b.png"],
  );
  assert.equal(batch.overflowCount, 0);
});

test("20MB 를 넘는 장은 받지 않고 까닭을 알린다", () => {
  const batch = screenScreenshotBatch(
    [fakeFile("big.png", MAX_ATTACHMENT_SIZE_BYTES + 1), fakeFile("empty.png", 0)],
    0,
  );
  assert.equal(batch.accepted.length, 0);
  assert.equal(batch.rejected.length, 2);
  const notice = screenshotBatchNotice(batch);
  assert.ok(notice !== null);
  assert.match(notice, /big\.png/);
  assert.match(notice, /empty\.png/);
});

test("다 받았으면 아무 말도 하지 않는다", () => {
  const batch = screenScreenshotBatch([fakeFile("a.png", 10)], 0);
  assert.equal(screenshotBatchNotice(batch), null);
});

/* ------------------------------------------------------------------ */
/* 붙여넣기                                                             */
/* ------------------------------------------------------------------ */

function clipboardImage(type: string, name = "image.png"): ClipboardItemLike {
  return {
    kind: "file",
    type,
    getAsFile: () => new File([new Uint8Array([1, 2, 3])], name, { type }),
  };
}

const clipboardText: ClipboardItemLike = {
  kind: "string",
  type: "text/plain",
  getAsFile: () => null,
};

test("붙여넣기에서 이미지만 고른다", () => {
  const plan = pickPastedScreenshots([clipboardImage("image/png"), clipboardText]);
  assert.equal(plan.images.length, 1);
  assert.equal(plan.hasText, true);
});

test("이미지만 왔으면 글자는 오지 않았다고 답한다 (부르는 쪽이 기본 동작을 막는다)", () => {
  const plan = pickPastedScreenshots([clipboardImage("image/png")]);
  assert.equal(plan.hasText, false);
});

test("🔴 받지 않는 이미지도 일단 골라 온다 — 조용히 무시하지 않는다", () => {
  // gif 를 붙여넣었는데 아무 일도 안 일어나면 사람은 붙었는지 모른다.
  // 골라 온 뒤 사전 검사가 형식 까닭으로 거절해 알린다.
  const plan = pickPastedScreenshots([clipboardImage("image/gif", "image.gif")]);
  assert.equal(plan.images.length, 1);
  const batch = screenScreenshotBatch(
    plan.images.map((file) => ({ name: file.name, size: file.size })),
    0,
  );
  assert.equal(batch.accepted.length, 0);
  assert.equal(batch.rejected.length, 1);
});

test("자리표시 이름만 새로 짓는다 — 사람이 붙인 이름은 그대로 둔다", () => {
  assert.equal(isPlaceholderPastedName("image.png"), true);
  assert.equal(isPlaceholderPastedName(""), true);
  assert.equal(isPlaceholderPastedName("증상-화면.png"), false);

  const now = new Date("2026-09-17T00:30:00.000Z"); // KST 09:30
  assert.equal(pastedScreenshotName("image/png", now, 1), "스크린샷-20260917-093000-1.png");
  assert.equal(pastedScreenshotName("image/jpeg", now, 2), "스크린샷-20260917-093000-2.jpg");

  const kept = new File([new Uint8Array([1])], "증상-화면.png", { type: "image/png" });
  assert.equal(nameScreenshotFile(kept, now, 1).name, "증상-화면.png");

  const renamed = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
  assert.equal(nameScreenshotFile(renamed, now, 3).name, "스크린샷-20260917-093000-3.png");
});

test("날짜 도장은 KST 다 (자정을 넘는 시각에서 어긋나지 않는다)", () => {
  // UTC 2026-09-16 15:00 = KST 2026-09-17 00:00
  assert.equal(kstFileStamp(new Date("2026-09-16T15:00:00.000Z")), "20260917-000000");
});

/* ------------------------------------------------------------------ */
/* 주소                                                                 */
/* ------------------------------------------------------------------ */

test("주소에 글 id 와 첨부 id 가 함께 들어간다", () => {
  const requestId = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
  const attachmentId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  assert.equal(
    screenshotUrl(requestId, attachmentId),
    `/api/improvement-requests/${requestId}/attachments/${attachmentId}`,
  );
});

test("🔴 올리기 주소의 파일 이름은 쿼리로 인코딩된다", () => {
  const requestId = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
  const url = screenshotUploadUrl(requestId, "증상 화면 #1.png");
  // 이름이 주소의 경로를 비집고 들어가지 못한다.
  assert.ok(url.startsWith(`/api/improvement-requests/${requestId}/attachments?fileName=`));
  assert.ok(!url.includes("#"), "인코딩되지 않은 # 가 주소에 남았습니다");
  assert.equal(new URL(url, "http://x").searchParams.get("fileName"), "증상 화면 #1.png");
});
