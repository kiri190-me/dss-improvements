import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { CONTENT_SNIFF_BYTES } from "@/lib/domain/attachment-file";
import { resolveAttachmentAbsolutePath } from "@/lib/domain/attachment-path";

/**
 * ============================================================================
 * 첨부 파일 저장소 — 디스크에 닿는 유일한 자리
 * ============================================================================
 * 저장 루트는 환경변수 `UPLOADS_DIR` 하나다. **이 값은 DB 에 들어가지 않는다** —
 * 행에는 루트 아래의 상대 경로만 적히므로, NAS 로 옮기는 일이 「파일을 복사하고
 * 설정 한 줄을 바꾸는 일」이 된다(db/schema.ts 의 stored_path 주석).
 *
 * 값이 없으면 **던진다.** 조용히 기본값(예: ./uploads)으로 넘어가면 파일이 어디로
 * 갔는지 아무도 모르는 상태로 한동안 잘 돌아가다가, 배포 뒤에야 「그때 올린 파일이
 * 없다」로 발견된다.
 *
 * ⚠️ 이 파일은 **서버에서만** 부른다. `server-only` 를 import 하지 않는 것은 이
 * 저장소에 그 패키지가 없기 때문이다(의존성을 하나 더 들이지 않았다 —
 * db/queries 의 같은 주석과 같은 이유). node:fs 를 가져오므로 클라이언트 번들에
 * 실리면 빌드가 먼저 깨진다.
 *
 * ── 🔴 크기 상한은 「다 받아 놓고 재는」 것이 아니다 ────────────────────
 * writeTemp 는 조각을 읽을 때마다 누적 바이트를 보고 상한을 넘는 **순간** 스트림을
 * 끊고 임시 파일을 지운다. 끝까지 받아 두고 나서 재면 상한을 두는 의미가 없다 —
 * 그 사이 디스크와 메모리는 이미 다 쓴 뒤다.
 *
 * ── 임시 자리는 루트 안에 둔다 ─────────────────────────────────────────
 * `<루트>/.tmp-uploads`. OS 임시 폴더를 쓰지 않는 까닭은 commit 이 **이름 바꾸기
 * 한 번**이어야 하기 때문이다 — 다른 볼륨(또는 다른 도커 마운트)에 있으면 rename 이
 * EXDEV 로 실패해 결국 복사가 되고, 그 복사 도중 프로세스가 죽으면 최종 자리에
 * 반쯤 쓰인 파일이 남는다. 같은 루트 안이면 같은 볼륨이라 rename 이 원자적이다.
 * (그래도 EXDEV 대비 복사 갈래를 남겨 둔다 — 마운트 구성은 운영에서 바뀐다.)
 *
 * 이름이 점으로 시작하므로 stored_path 의 첫 마디(`improvement-requests`)와 절대
 * 겹치지 않는다.
 *
 * 🔴 저장 루트 값 자체를 로그로 찍지 않는다(보안 규칙: .env 내용은 출력하지 않는다).
 * ============================================================================
 */

const TEMP_DIRECTORY_NAME = ".tmp-uploads";
const TEMP_FILE_SUFFIX = ".part";

export class AttachmentTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`첨부 파일이 상한(${maxBytes} 바이트)을 넘습니다.`);
    this.name = "AttachmentTooLargeError";
  }
}

export class AttachmentAlreadyStoredError extends Error {
  constructor(readonly storedPath: string) {
    super("이미 같은 자리에 파일이 있습니다.");
    this.name = "AttachmentAlreadyStoredError";
  }
}

export class AttachmentNotStoredError extends Error {
  constructor(readonly storedPath: string) {
    super("저장된 파일을 찾을 수 없습니다.");
    this.name = "AttachmentNotStoredError";
  }
}

export type TempWriteResult = {
  /** 임시 파일의 절대 경로. commit 이나 discard 에 그대로 넘긴다. */
  tempPath: string;
  /** 실제로 쓴 바이트 수. **이 값이 크기 판정의 근거다.** */
  size: number;
  /** 소문자 hex sha256. */
  sha256: string;
  /** 앞머리 바이트 — 형식 대조(isContentCompatibleWithExtension)에 쓴다. */
  header: Uint8Array;
};

export type WriteTempOptions = {
  maxBytes: number;
  headerBytes?: number;
};

/**
 * 저장 루트. 없으면 던진다 — 조용한 기본값을 두지 않는다(파일 머리말).
 */
export function resolveUploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR;
  if (!configured || configured.trim().length === 0) {
    throw new Error(
      "UPLOADS_DIR 이 설정되지 않았습니다. 첨부 파일 저장 루트를 .env.local 에 지정해야 합니다.",
    );
  }
  return path.resolve(configured.trim());
}

export type AttachmentStorage = {
  writeTemp(stream: ReadableStream<Uint8Array>, options: WriteTempOptions): Promise<TempWriteResult>;
  commit(tempPath: string, storedPath: string): Promise<void>;
  discard(tempPath: string): Promise<void>;
  read(storedPath: string): Promise<ReadableStream<Uint8Array>>;
  delete(storedPath: string): Promise<void>;
  exists(storedPath: string): Promise<boolean>;
};

class LocalFileSystemAttachmentStorage implements AttachmentStorage {
  constructor(private readonly root: string) {}

  private get tempDirectory(): string {
    return path.join(this.root, TEMP_DIRECTORY_NAME);
  }

  /**
   * 루트 밖을 가리키면 여기서 던진다. **DB 에서 읽은 값이라도 그대로 믿지 않는다**
   * (domain/attachment-path.ts 의 assertPortableStoredPath 주석).
   */
  private absolute(storedPath: string): string {
    return resolveAttachmentAbsolutePath(this.root, storedPath);
  }

  async writeTemp(
    stream: ReadableStream<Uint8Array>,
    options: WriteTempOptions,
  ): Promise<TempWriteResult> {
    const headerBytes = options.headerBytes ?? CONTENT_SNIFF_BYTES;
    await mkdir(this.tempDirectory, { recursive: true });

    // 임시 이름도 소문자 UUID 다 — 이 파일이 최종 자리로 옮겨지지는 않지만,
    // 이름 규칙을 저장소 전체에서 한 가지로 유지한다.
    const tempPath = path.join(
      this.tempDirectory,
      `${randomUUID().toLowerCase()}${TEMP_FILE_SUFFIX}`,
    );
    // "wx" — 이미 있으면 덮어쓰지 않고 실패한다.
    const handle = await open(tempPath, "wx");

    const hash = createHash("sha256");
    const headerParts: Uint8Array[] = [];
    let headerLength = 0;
    let size = 0;

    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        size += value.byteLength;
        if (size > options.maxBytes) {
          // 🔴 더 읽지 않는다. 남은 바이트를 끝까지 받아 두고 나서 버리면 상한을
          // 두는 의미가 없다(파일 머리말).
          await reader.cancel().catch(() => undefined);
          throw new AttachmentTooLargeError(options.maxBytes);
        }

        hash.update(value);

        if (headerLength < headerBytes) {
          // subarray 가 아니라 slice — 스트림이 넘겨준 버퍼는 다음 조각에서
          // 재사용될 수 있어서, 뷰만 들고 있으면 내용이 뒤바뀐다.
          const part = value.slice(0, Math.min(value.byteLength, headerBytes - headerLength));
          headerParts.push(part);
          headerLength += part.byteLength;
        }

        // await 로 한 조각씩 쓴다 — 이것이 백프레셔다. 큐에 쌓아 두면 파일 전체가
        // 결국 메모리에 올라간다.
        await handle.write(value);
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }

    await handle.close();

    const header = new Uint8Array(headerLength);
    let offset = 0;
    for (const part of headerParts) {
      header.set(part, offset);
      offset += part.byteLength;
    }

    return { tempPath, size, sha256: hash.digest("hex"), header };
  }

  async commit(tempPath: string, storedPath: string): Promise<void> {
    const target = this.absolute(storedPath);
    await mkdir(path.dirname(target), { recursive: true });

    if (await pathExists(target)) {
      // 첨부 id 가 매번 새 UUID 라 정상적으로는 일어나지 않는다. 그래도 덮어쓰기로
      // 넘어가지 않는다 — 남의 파일을 조용히 지우는 것보다 올리기 하나가 실패하는
      // 편이 낫다.
      throw new AttachmentAlreadyStoredError(storedPath);
    }

    try {
      await rename(tempPath, target);
    } catch (error) {
      if (!isCrossDeviceError(error)) throw error;
      // 임시 자리와 최종 자리가 다른 볼륨이 된 경우(마운트 구성 변경 등).
      await copyFile(tempPath, target);
      await unlink(tempPath).catch(() => undefined);
    }
  }

  async discard(tempPath: string): Promise<void> {
    await unlink(tempPath).catch(() => undefined);
  }

  async read(storedPath: string): Promise<ReadableStream<Uint8Array>> {
    const target = this.absolute(storedPath);
    if (!(await pathExists(target))) {
      throw new AttachmentNotStoredError(storedPath);
    }
    return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  }

  async delete(storedPath: string): Promise<void> {
    await rm(this.absolute(storedPath), { force: true });
  }

  async exists(storedPath: string): Promise<boolean> {
    return pathExists(this.absolute(storedPath));
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "EXDEV"
  );
}

/**
 * 시험이 임시 루트를 넘겨 쓸 수 있도록 열어 둔다. 업무 코드는
 * getAttachmentStorage() 만 부른다.
 */
export function createLocalFileSystemAttachmentStorage(root: string): AttachmentStorage {
  return new LocalFileSystemAttachmentStorage(path.resolve(root));
}

let cachedStorage: { root: string; storage: AttachmentStorage } | null = null;

/**
 * 업무 코드가 쓰는 저장소. UPLOADS_DIR 을 **부르는 시점에** 읽는다 — 모듈을
 * 불러오는 것만으로 던지면 값이 없는 환경(도커 이미지를 구울 때)에서는 빌드조차
 * 되지 않는다. lib/env.ts 가 getter 를 쓰는 것과 같은 이유다.
 */
export function getAttachmentStorage(): AttachmentStorage {
  const root = resolveUploadsRoot();
  if (cachedStorage?.root !== root) {
    cachedStorage = { root, storage: createLocalFileSystemAttachmentStorage(root) };
  }
  return cachedStorage.storage;
}
