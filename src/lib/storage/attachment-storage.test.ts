import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AttachmentPathError } from "@/lib/domain/attachment-path";
import {
  AttachmentAlreadyStoredError,
  AttachmentNotStoredError,
  AttachmentTooLargeError,
  createLocalFileSystemAttachmentStorage,
} from "./attachment-storage";

/**
 * ============================================================================
 * 🔴 크기 관문 — 「다 받아 놓고 재는」 것이 아니다
 * ============================================================================
 * 이 시험은 진짜 디스크를 쓴다(OS 임시 폴더). DB 에는 닿지 않으므로 unit 목록에
 * 있어도 된다 — 이 목록의 금기는 DB 다(scripts/test-lists/unit.txt 머리말).
 *
 * 20MB 그대로를 시험에 흘리지 않고 작은 상한으로 같은 길을 탄다. 판정하는 코드는
 * 상한 값을 모르는 같은 한 줄이라, 작은 수로 증명한 것이 20MB 에서도 같다.
 * ============================================================================
 */

const REQUEST_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const ATTACHMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const STORED_PATH = `improvement-requests/${REQUEST_ID}/${ATTACHMENT_ID}.png`;

/** 바이트를 조각조각 흘려보내는 스트림 — 실제 업로드가 오는 모양이다. */
function streamOf(bytes: Uint8Array, chunkSize = 7): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

async function withRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "dss-improvements-uploads-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("🔴 상한을 넘으면 던지고, 임시 파일을 남기지 않는다", async () => {
  await withRoot(async (root) => {
    const storage = createLocalFileSystemAttachmentStorage(root);
    const tooBig = new Uint8Array(101).fill(0x41);

    await assert.rejects(
      () => storage.writeTemp(streamOf(tooBig), { maxBytes: 100 }),
      AttachmentTooLargeError,
    );

    // 임시 폴더에 `.part` 가 남아 있으면 상한을 넘긴 파일이 디스크를 차지한다.
    const tempDirectory = path.join(root, ".tmp-uploads");
    const leftovers = await readdirSafe(tempDirectory);
    assert.deepEqual(leftovers, [], `임시 파일이 남았습니다: ${leftovers.join(", ")}`);
  });
});

test("상한과 똑같은 크기는 통과한다 (경계에서 한 바이트씩 어긋나지 않는다)", async () => {
  await withRoot(async (root) => {
    const storage = createLocalFileSystemAttachmentStorage(root);
    const exact = new Uint8Array(100).fill(0x42);
    const written = await storage.writeTemp(streamOf(exact), { maxBytes: 100 });
    assert.equal(written.size, 100);
    await storage.discard(written.tempPath);
  });
});

test("크기·체크섬·앞머리는 **흘려보낸 바이트**에서 나온다", async () => {
  await withRoot(async (root) => {
    const storage = createLocalFileSystemAttachmentStorage(root);
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

    const written = await storage.writeTemp(streamOf(bytes, 3), {
      maxBytes: 1024,
      headerBytes: 8,
    });

    assert.equal(written.size, bytes.byteLength);
    assert.equal(written.sha256, createHash("sha256").update(bytes).digest("hex"));
    // 🔴 조각을 이어 붙인 앞머리가 원본과 같아야 한다 — 뷰(subarray)만 들고 있으면
    // 다음 조각이 같은 버퍼를 다시 써서 내용이 뒤바뀐다.
    assert.deepEqual([...written.header], [...bytes.slice(0, 8)]);

    await storage.discard(written.tempPath);
  });
});

test("commit 하면 저장 경로 그대로 놓이고, 다시 읽힌다", async () => {
  await withRoot(async (root) => {
    const storage = createLocalFileSystemAttachmentStorage(root);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const written = await storage.writeTemp(streamOf(bytes), { maxBytes: 1024 });

    await storage.commit(written.tempPath, STORED_PATH);

    const onDisk = await readFile(path.join(root, ...STORED_PATH.split("/")));
    assert.deepEqual([...onDisk], [...bytes]);
    assert.equal(await storage.exists(STORED_PATH), true);

    // 임시 파일은 옮겨졌으므로 남아 있지 않다.
    await assert.rejects(() => stat(written.tempPath));

    await storage.delete(STORED_PATH);
    assert.equal(await storage.exists(STORED_PATH), false);
    await assert.rejects(() => storage.read(STORED_PATH), AttachmentNotStoredError);
  });
});

test("같은 자리에 두 번 놓지 않는다 — 남의 파일을 조용히 덮지 않는다", async () => {
  await withRoot(async (root) => {
    const storage = createLocalFileSystemAttachmentStorage(root);
    const first = await storage.writeTemp(streamOf(new Uint8Array([1])), { maxBytes: 1024 });
    await storage.commit(first.tempPath, STORED_PATH);

    const second = await storage.writeTemp(streamOf(new Uint8Array([2])), { maxBytes: 1024 });
    await assert.rejects(
      () => storage.commit(second.tempPath, STORED_PATH),
      AttachmentAlreadyStoredError,
    );
    await storage.discard(second.tempPath);
  });
});

test("🔴 저장 루트 밖을 가리키는 경로는 디스크에 닿기 전에 던진다", async () => {
  await withRoot(async (root) => {
    const storage = createLocalFileSystemAttachmentStorage(root);
    const written = await storage.writeTemp(streamOf(new Uint8Array([1])), { maxBytes: 1024 });

    for (const bad of [
      "improvement-requests/../../secret.png",
      "/etc/passwd",
      "improvement-requests\\a\\b.png",
      "web_users/a/b.png",
    ]) {
      await assert.rejects(
        () => storage.commit(written.tempPath, bad),
        AttachmentPathError,
        `"${bad}" 가 통과했습니다`,
      );
      await assert.rejects(() => storage.read(bad), AttachmentPathError);
      await assert.rejects(() => storage.delete(bad), AttachmentPathError);
    }

    await storage.discard(written.tempPath);
  });
});

async function readdirSafe(directory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
