import path from "node:path";

import { isAttachmentExtension } from "./attachment-file";

/**
 * ============================================================================
 * 첨부 파일의 자리 — DB 에 적는 상대 경로를 만드는 단 하나의 지점
 * ============================================================================
 *
 *   저장 루트 (UPLOADS_DIR)  →  C:/DSS-IMPROVEMENTS-DATA/uploads   ← 설정값, DB 에 안 들어감
 *   DB stored_path           →  improvement-requests/{글id}/{첨부id}.{확장자}
 *
 * ── 🔴 디스크 경로에는 UUID 만 쓴다 ────────────────────────────────────
 * **사람이 올린 파일 이름은 경로에 한 글자도 들어가지 않는다.** 원본 이름은
 * `original_file_name` 칸에만 남는다. 까닭 셋:
 *
 *   · 그 이름에는 `..` · 경로 구분자 · 널 바이트 · 윈도우 예약 문자가 섞일 수
 *     있고, 그대로 파일명으로 쓰면 **저장 루트 밖을 가리키는 경로**가 만들어진다.
 *   · 같은 이름이 두 번 올라오면 앞의 파일을 조용히 덮어쓴다.
 *   · 한글·특수문자가 NAS(Linux) 로 옮길 때 인코딩 때문에 깨진다.
 *
 * 이 파일이 만드는 경로에는 UUID 둘과 허용된 확장자 하나뿐이다. 값이 UUID 가
 * 아니면 **던진다** — 조용히 다듬어 받지 않는다. 다듬어 받으면 「무엇이 들어와도
 * 경로가 나오는」 함수가 되고, 그 순간 이 자리가 관문이 아니게 된다.
 *
 * ── 왜 이 계산이 파일 하나로 떨어져 있는가 ──────────────────────────────
 * 이 사이트의 최종 운영은 NAS(Synology) Docker 이고 **컨테이너 안은 Linux** 인데
 * 개발은 Windows 에서 한다. 경로를 실제로 만들어 내는 이 자리가 그 차이가 물리는
 * 유일한 지점이라, 규칙 셋을 여기에 모아 두고 시험으로 못 박는다(실제 파일 없이
 * 검증된다).
 *
 *   1. **DB 에는 언제나 `/` 로 저장한다.** Windows 에서 `a\b\c.png` 로 적으면
 *      Linux 는 그 전체를 **폴더 하나의 이름**으로 읽는다 — 옮긴 순간 못 찾는다.
 *      그래서 DB 에 넣을 값을 만들 때는 path.join 같은 OS 구분자 함수를 쓰지 않고
 *      문자열로 `/` 를 붙인다.
 *   2. **소문자로 통일한다.** Windows 는 `A.PNG` 와 `a.png` 를 같은 파일로 보지만
 *      Linux 는 다른 파일로 본다. 섞인 채로 옮기면 **일부만** 안 열린다.
 *   3. **절대경로를 DB 에 넣지 않는다.** `C:/DSS-IMPROVEMENTS-DATA` 는 컨테이너
 *      안에 존재하지 않는다. 루트는 설정값 하나로 남기고 행에는 루트 아래 자리만
 *      적는다 — 그래야 NAS 이전이 「파일을 복사하고 설정 한 줄을 바꾸는 일」이 된다.
 *
 * ── OS 구분자는 디스크에 닿는 순간에만 ──────────────────────────────────
 * node:path 를 쓰는 함수는 이 파일에서 resolveAttachmentAbsolutePath 하나뿐이다 —
 * 실제로 파일을 열고 쓰는 그 순간의 절대 경로를 만드는 함수라서다.
 * ============================================================================
 */

/**
 * stored_path 의 첫 마디. 소문자·하이픈 — 규칙 2 를 파일 이름 수준에서 지킨다.
 *
 * 이 사이트의 첨부 주인은 **개선요청 하나뿐**이라 마디가 하나다(승인된 설계 ①).
 * 그래도 접두어를 붙여 두는 까닭: 저장 루트 아래에 나중에 무엇이 더 놓이더라도
 * 폴더 하나만 보면 그것이 무엇의 파일인지 알 수 있고, 백업이 DB 없이 디스크만
 * 훑어도 구조가 읽힌다.
 */
export const IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX = "improvement-requests";

/** 저장 경로로 인정하는 첫 마디의 **전부**. 여기 없는 접두어는 거절된다. */
const ALLOWED_STORED_PATH_PREFIXES: readonly string[] = [IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX];

/** UUID(소문자 hex). 대문자가 섞인 값은 눕혀서 받고, 형태가 아니면 던진다. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class AttachmentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentPathError";
  }
}

function requireUuid(label: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new AttachmentPathError(`${label}가 UUID 형식이 아닙니다.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new AttachmentPathError(`${label}가 UUID 형식이 아닙니다.`);
  }
  return normalized;
}

/**
 * DB 의 stored_path 에 넣을 값을 만든다. **여기서 나온 문자열만이 저장 경로다.**
 *
 * 인자는 셋 다 서버가 만든 값이다 — 글 id 는 DB 에서 읽은 것, 첨부 id 는 방금
 * randomUUID() 로 만든 것, 확장자는 허용목록으로 좁혀 정규화한 것. 사람이 준
 * 문자열은 한 조각도 들어오지 않는다(파일 머리말).
 */
export function buildImprovementRequestAttachmentStoredPath(params: {
  improvementRequestId: string;
  attachmentId: string;
  /** 원본 파일명이 아니라 정규화된 확장자(점 없음). normalizeFileExtension 의 결과. */
  extension: string;
}): string {
  const improvementRequestId = requireUuid("개선요청 ID", params.improvementRequestId);
  const attachmentId = requireUuid("첨부 ID", params.attachmentId);

  const extension =
    typeof params.extension === "string" ? params.extension.trim().toLowerCase() : "";
  if (!isAttachmentExtension(extension)) {
    throw new AttachmentPathError(`허용되지 않은 확장자입니다: ${extension || "(없음)"}`);
  }

  // path.join 을 쓰지 않는다 — Windows 에서 역슬래시가 섞이면 Linux 가 이 값을
  // 폴더 하나의 이름으로 읽는다(파일 머리말 규칙 1).
  return `${IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX}/${improvementRequestId}/${attachmentId}.${extension}`;
}

/**
 * DB 에서 읽어 온 stored_path 가 옮겨도 되는 값인가 — 규칙 1·2·3 을 그대로 검사한다.
 *
 * 🔴 **DB 값이라고 그대로 믿지 않는다.** 이 표의 행은 옛 버전 코드나 손으로 넣은
 * SQL 로도 들어올 수 있고, 그 한 줄이 저장 루트 밖의 파일을 열게 만들 수 있다.
 * (같은 규칙을 DB 쪽에서도 CHECK 하나가 지킨다 — db/schema.ts 의
 * `improvement_request_attachments_stored_path_shape`. 두 겹인 것은 일부러다.)
 */
export function assertPortableStoredPath(storedPath: string): void {
  if (typeof storedPath !== "string" || storedPath.length === 0) {
    throw new AttachmentPathError("저장 경로가 비어 있습니다.");
  }
  // 규칙 1 — 역슬래시는 Linux 에서 파일명의 일부가 된다.
  if (storedPath.includes("\\")) {
    throw new AttachmentPathError("저장 경로에 역슬래시가 들어 있습니다. 구분자는 '/' 하나뿐입니다.");
  }
  // 규칙 3 — 절대경로·드라이브 문자·UNC 는 루트 설정을 무의미하게 만든다.
  if (storedPath.startsWith("/") || /^[a-zA-Z]:/.test(storedPath)) {
    throw new AttachmentPathError("저장 경로는 저장 루트 기준 상대 경로여야 합니다.");
  }
  // 규칙 2 — 대문자가 섞이면 NAS 로 옮긴 뒤 그 파일만 열리지 않는다.
  if (storedPath !== storedPath.toLowerCase()) {
    throw new AttachmentPathError("저장 경로는 소문자여야 합니다.");
  }
  if (storedPath.includes("\0")) {
    throw new AttachmentPathError("저장 경로에 허용되지 않은 문자가 들어 있습니다.");
  }

  const segments = storedPath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new AttachmentPathError("저장 경로에 빈 마디나 상위 이동(..)이 들어 있습니다.");
    }
  }
  if (!ALLOWED_STORED_PATH_PREFIXES.includes(segments[0])) {
    throw new AttachmentPathError(
      `저장 경로는 '${IMPROVEMENT_REQUEST_ATTACHMENT_PREFIX}/' 로 시작해야 합니다.`,
    );
  }
}

/** 던지지 않는 형태. 화면·시험이 가부만 물을 때 쓴다. */
export function isPortableStoredPath(storedPath: string): boolean {
  try {
    assertPortableStoredPath(storedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 실제로 디스크에 닿는 절대 경로. **이 파일에서 node:path 를 쓰는 유일한 함수다.**
 *
 * 규칙 검사를 통과한 값이라도 한 번 더 정규화해서 루트 밖을 가리키면 던진다 —
 * 검사와 해석 사이에 무엇이 달라졌든, 저장 루트 밖의 파일을 여는 일은 없어야 한다.
 */
export function resolveAttachmentAbsolutePath(uploadsRoot: string, storedPath: string): string {
  if (!uploadsRoot || uploadsRoot.trim().length === 0) {
    throw new AttachmentPathError("저장 루트가 설정되지 않았습니다.");
  }
  assertPortableStoredPath(storedPath);

  const absoluteRoot = path.resolve(uploadsRoot);
  const absolute = path.resolve(absoluteRoot, ...storedPath.split("/"));

  const relative = path.relative(absoluteRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AttachmentPathError("저장 경로가 저장 루트 밖을 가리킵니다.");
  }
  return absolute;
}
