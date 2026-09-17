import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import {
  canManageImprovementRequests,
  canWriteImprovementRequests,
} from "@/lib/auth/improvement-request-authorization";
import { createImprovementRequestAttachment } from "@/lib/db/mutations/improvement-request-attachments";
import { getImprovementRequestAttachmentTarget } from "@/lib/db/queries/improvement-request-attachments";
import {
  canonicalMimeTypeForExtension,
  CONTENT_MISMATCH_TEXT,
  FORMAT_REJECTION_TEXT,
  isAttachmentExtension,
  isContentCompatibleWithExtension,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ORIGINAL_FILE_NAME_LENGTH,
  normalizeFileExtension,
  TOO_LARGE_TEXT,
} from "@/lib/domain/attachment-file";
import { buildImprovementRequestAttachmentStoredPath } from "@/lib/domain/attachment-path";
import {
  canChangeImprovementRequestScreenshots,
  hasImprovementRequestScreenshotRoom,
  IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
} from "@/lib/domain/improvement-request";
import { AttachmentTooLargeError, getAttachmentStorage } from "@/lib/storage/attachment-storage";

/**
 * ============================================================================
 * POST /api/improvement-requests/{id}/attachments — 스크린샷을 붙이는 통로
 * ============================================================================
 * 🔴 **여기가 바깥에서 파일이 들어오는 자리다.** 이 파일의 순서가 곧 관문이다.
 *
 * ── 왜 서버 액션이 아니라 Route Handler 인가 ───────────────────────────
 * 서버 액션은 인자를 통째로 직렬화해 받는다 — 20MB 짜리 이미지가 **메모리에 다
 * 올라온 뒤에야** 함수가 시작한다는 뜻이다. 그러면 크기 상한이 「받아 놓고 재는」
 * 것이 되어 상한을 두는 의미가 없다. Route Handler 는 `request.body` 를 스트림으로
 * 주므로, 흘려보내며 세다가 상한을 넘는 **순간** 끊을 수 있다.
 *
 * ── 왜 multipart 가 아닌가 ──────────────────────────────────────────────
 * 본문은 **파일 바이트 그대로**이고 파일 이름은 쿼리 문자열로 온다. multipart 를
 * 쓰면 경계를 찾아 파싱하는 층이 하나 끼어들고, 그 층은 대개 전체를 메모리(또는 제
 * 임시 파일)에 올린 뒤에 돌려준다 — 위 문단의 문제가 그대로 돌아온다.
 *
 * ── 🔴 관문 다섯 (지시서의 다섯과 같은 것들) ────────────────────────────
 *   권한  · 세션 → 역할 → **글 한 건에 대한 판정**(자기 글, 또는 관리자)
 *   장수  · 본문을 받기 전 빠른 셈 + **잠근 트랜잭션 안의 진짜 셈**
 *   형식  · 확장자 → **파일 앞머리 바이트 대조**(이름만 바꾼 파일을 막는 자리)
 *   크기  · Content-Length 로 빠른 거절 + **흘려보내며 센 바이트**로 진짜 판정
 *   경로  · UUID 둘과 확장자로만 만든다 — 사람이 준 문자열은 한 조각도 안 쓴다
 *
 * 각 관문마다 **싼 것이 먼저**다. 20MB 를 다 받아 놓고 「권한이 없습니다」라고 하지
 * 않는다. 그러나 싼 검사는 전부 **속일 수 있는 값**(이름·헤더)을 보므로, 같은 것을
 * 비싼 자리에서 한 번 더 본다.
 *
 * ── ⚠️ 4번(파일 놓기)과 5번(DB)을 뒤집지 않는다 ────────────────────────
 * 파일을 먼저 놓고 DB 를 나중에 쓴다. 거꾸로 하면 파일 쓰기가 실패했을 때 **가리키는
 * 파일이 없는 행**이 남고, 그것은 화면에서 깨진 그림으로 나타난다. 이 차례에서
 * 생길 수 있는 나쁜 일은 「주인 없는 파일」뿐이고, 그것은 나중에 훑어 치울 수 있다.
 *
 * 🔴 파일 이름과 이미지는 사람이 준 것이라 개인정보가 섞일 수 있다(db/schema.ts 의
 * PII 절). 실패 응답에 저장 루트나 내부 경로를 싣지 않고, console 에도 값을 싣지
 * 않는다.
 * ============================================================================
 */

// 파일을 다루므로 Node 런타임이 필요하다(node:fs, node:crypto).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_REQUEST_ID"
  | "IMPROVEMENT_REQUEST_NOT_FOUND"
  | "LIMIT_REACHED"
  | "INVALID_FILE_NAME"
  | "EXTENSION_NOT_ALLOWED"
  | "EMPTY_BODY"
  | "FILE_TOO_LARGE"
  | "CONTENT_MISMATCH"
  | "STORAGE_FAILED"
  | "RECORD_FAILED";

/**
 * 무엇이 왜 막혔는지 사람이 읽을 수 있게 돌려준다. 저장 루트나 내부 경로는 싣지
 * 않는다 — 실패 응답이 디스크 구조를 알려 주는 창구가 되면 안 된다.
 */
function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 이 요청이 이 사이트의 화면에서 왔는가.
 *
 * 서버 액션은 Next 가 같은 검사를 스스로 해 주지만 Route Handler 는 해 주지 않는다.
 * 쿠키로 인증하는 POST 통로라, 이것이 없으면 남의 사이트에 심어 둔 <form> 한 줄이
 * 로그인한 사람의 쿠키로 이 통로를 부를 수 있다(CSRF).
 *
 * Origin 이 **없는** 요청도 거절한다. 브라우저는 교차 출처 POST 에 Origin 을 반드시
 * 붙이므로, 없다는 것은 브라우저가 아니라는 뜻이다 — 그런 요청을 받아 줄 이유가
 * 이 통로에는 없다.
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // ── 1) 본문을 건드리기 전에 끝내야 하는 확인들 ────────────────────────
  if (!isSameOriginRequest(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  // 🔴 쿠키의 서명만 보지 않는다 — getSessionUser 가 매 요청 web_users 한 행을 읽어
  // 정지·삭제·강등과 포털이 끊은 세션을 걸러 준다(auth/session.ts).
  const actor = await getSessionUser();
  if (!actor) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }
  if (!canWriteImprovementRequests(actor.role)) {
    return fail(403, "FORBIDDEN", "개선요청에 스크린샷을 붙일 권한이 없습니다.");
  }
  // 🔴 살아 있는 계정의 역할에서만 나온다. 요청이 보낸 값이 아니다.
  const canManage = canManageImprovementRequests(actor.role);

  const { id: improvementRequestId } = await context.params;
  if (typeof improvementRequestId !== "string" || !UUID_PATTERN.test(improvementRequestId)) {
    // UUID 가 아니면 DB 에 묻지 않는다 — 형태가 아닌 값으로 질의하면 22P02 로 터진다.
    return fail(400, "INVALID_REQUEST_ID", "개선요청을 확인할 수 없습니다.");
  }

  const target = await getImprovementRequestAttachmentTarget(improvementRequestId);
  if (!target) {
    return fail(404, "IMPROVEMENT_REQUEST_NOT_FOUND", "해당 개선요청을 찾을 수 없습니다.");
  }

  // 글 한 건에 대한 판정 — 막히면 404 가 아니라 403 이다. 목록은 전 직원이 보므로
  // (README 의 「정해진 것」) 「그 글이 있다」는 이 사람에게 비밀이 아니고, 404 는
  // 오히려 「글이 지워졌나」로 잘못 읽힌다.
  if (
    !canChangeImprovementRequestScreenshots({
      createdBy: target.createdBy,
      actorUserId: actor.id,
      canManage,
    })
  ) {
    return fail(403, "FORBIDDEN", IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE);
  }

  // 다섯 장 — **빠른 거절일 뿐이다.** 진짜 셈은 아래 5)의 잠근 트랜잭션 안이다.
  if (!hasImprovementRequestScreenshotRoom(target.liveAttachmentCount)) {
    return fail(409, "LIMIT_REACHED", IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE);
  }

  // ── 메타데이터(쿼리 문자열) 검증 — 아직 본문은 건드리지 않았다 ────────
  const originalFileName = (request.nextUrl.searchParams.get("fileName") ?? "").trim();
  if (
    originalFileName.length === 0 ||
    originalFileName.length > MAX_ORIGINAL_FILE_NAME_LENGTH
  ) {
    return fail(400, "INVALID_FILE_NAME", "파일 이름이 비어 있거나 너무 깁니다.");
  }

  // 🔴 이름에서 쓰는 것은 **확장자뿐**이다. 나머지 글자는 어디에도 쓰이지 않는다 —
  // 경로는 아래에서 UUID 둘로만 만든다(domain/attachment-path.ts 머리말).
  const extension = normalizeFileExtension(originalFileName);
  if (!extension || !isAttachmentExtension(extension)) {
    return fail(415, "EXTENSION_NOT_ALLOWED", `${FORMAT_REJECTION_TEXT}.`);
  }

  // 브라우저가 알려 준 크기로 미리 자른다. 이 값은 믿을 수 없지만(진짜 판정은 아래
  // writeTemp 가 센 바이트로 한다) 맞을 때는 20MB 를 받아 놓고 버리는 일을 아낀다.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return fail(413, "FILE_TOO_LARGE", TOO_LARGE_TEXT);
  }

  const body = request.body;
  if (!body) {
    return fail(400, "EMPTY_BODY", "올릴 파일이 없습니다.");
  }

  const storage = getAttachmentStorage();

  // ── 2) 임시 파일로 흘려보내며 크기·체크섬·앞머리를 모은다 ─────────────
  let written;
  try {
    written = await storage.writeTemp(body, { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) {
      // 임시 파일은 writeTemp 가 던지기 전에 이미 지웠다.
      return fail(413, "FILE_TOO_LARGE", TOO_LARGE_TEXT);
    }
    console.error("스크린샷 임시 저장 실패", { name: (error as Error)?.name });
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 3) 확장자 ↔ 실제 내용 대조 (형식 관문의 본체) ────────────────────
  if (written.size === 0) {
    await storage.discard(written.tempPath);
    return fail(400, "EMPTY_BODY", "빈 파일은 올릴 수 없습니다.");
  }
  if (!isContentCompatibleWithExtension(extension, written.header)) {
    await storage.discard(written.tempPath);
    return fail(415, "CONTENT_MISMATCH", CONTENT_MISMATCH_TEXT);
  }

  const attachmentId = randomUUID().toLowerCase();
  // 🔴 경로는 UUID 둘과 확장자로만 만들어진다 — 사람이 준 문자열은 한 조각도 없다.
  const storedPath = buildImprovementRequestAttachmentStoredPath({
    improvementRequestId: target.id,
    attachmentId,
    extension,
  });

  // ── 4) 파일을 최종 자리로 옮긴다 (DB 보다 먼저 — 파일 머리말 ⚠️) ───────
  try {
    await storage.commit(written.tempPath, storedPath);
  } catch (error) {
    await storage.discard(written.tempPath);
    console.error("스크린샷 파일 이동 실패", { name: (error as Error)?.name });
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 5) 그 다음에 DB (글 행 잠금 → 판정 · 다섯 장 셈 → 행, 한 트랜잭션) ──
  let created;
  try {
    created = await createImprovementRequestAttachment({
      id: attachmentId,
      improvementRequestId: target.id,
      originalFileName,
      storedPath,
      // 🔴 브라우저가 보낸 Content-Type 이 아니라 확장자에서 서버가 고른 값이다.
      mimeType: canonicalMimeTypeForExtension(extension) ?? "application/octet-stream",
      fileSize: written.size,
      checksumSha256: written.sha256,
      actorUserId: actor.id,
      canManage,
    });
  } catch (error) {
    await storage.delete(storedPath).catch(() => undefined);
    console.error("스크린샷 기록 생성 실패", { name: (error as Error)?.name });
    return fail(500, "RECORD_FAILED", "파일 기록을 저장하는 중 문제가 발생했습니다.");
  }

  if (!created.ok) {
    // 기록을 만들지 못했으면 방금 놓은 파일은 주인이 없다. 치워 보되, 실패해도
    // 여기서 더 하지 않는다 — 주인 없는 파일은 나중에 훑어 치울 수 있다.
    await storage.delete(storedPath).catch(() => undefined);
    // 잠근 트랜잭션의 판정이 막았다 — 파일을 받는 동안 상황이 바뀌었다(다른 장이
    // 먼저 들어왔거나, 글이 지워졌거나).
    switch (created.code) {
      case "NOT_FOUND":
        return fail(404, "IMPROVEMENT_REQUEST_NOT_FOUND", created.message);
      case "FORBIDDEN":
        return fail(403, "FORBIDDEN", created.message);
      case "LIMIT_REACHED":
        return fail(409, "LIMIT_REACHED", created.message);
      default:
        // ALREADY_DELETED 는 붙이기에서 나올 수 없다. 나왔다면 저장 쪽이 바뀐
        // 것이므로 조용히 409 로 뭉개지 않고 서버 오류로 드러낸다.
        return fail(500, "RECORD_FAILED", "파일 기록을 저장하는 중 문제가 발생했습니다.");
    }
  }

  return NextResponse.json(
    {
      id: created.id,
      improvementRequestId: target.id,
      originalFileName,
      fileSize: written.size,
      uploadedAt: created.uploadedAt,
    },
    { status: 201 },
  );
}
