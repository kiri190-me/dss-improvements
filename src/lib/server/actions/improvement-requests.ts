"use server";

import { revalidatePath } from "next/cache";

import { getSessionUser } from "@/lib/auth/session";
import {
  canManageImprovementRequests,
  canWriteImprovementRequests,
} from "@/lib/auth/improvement-request-authorization";
import {
  changeImprovementRequestStatus,
  createImprovementRequest,
  deleteImprovementRequest,
} from "@/lib/db/mutations/improvement-requests";
import { softDeleteImprovementRequestAttachment } from "@/lib/db/mutations/improvement-request-attachments";
import { isImprovementRequestStatus } from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 개선요청 — 서버 액션 (정책 계층)
 * ============================================================================
 *
 * ── 🔴 화면이 감춘 것은 경계가 아니다 ───────────────────────────────────
 * 화면이 단추를 그리지 않는 것은 편의일 뿐이다. 서버 액션은 브라우저에서 **직접
 * 부를 수 있는 통로**라, 화면을 거치지 않고 오는 요청이 있다고 가정한다. 그래서
 * 이 파일은 화면이 무엇을 보여 줬든 매번 처음부터 다시 검사한다.
 *
 * ── 🔴 관문 순서 ────────────────────────────────────────────────────────
 *   세션 → 권한 → 입력 검증 → 저장(mutation)
 *
 *  · **세션**은 `getSessionUser()` 로 읽는다. 그 함수는 쿠키의 서명만 보고 넘기지
 *    않고 **매 요청 web_users 한 행을 읽는다**(auth/session.ts) — 정지·삭제된
 *    사람, 포털이 끊은 세션, 그리고 **강등된 역할**이 여기서 걸린다. 쿠키에 박힌
 *    역할을 믿으면 강등된 사람이 토큰 만료까지 예전 권한으로 저장한다.
 *  · **권한**은 그 살아 있는 행의 `role` 하나로 판정한다
 *    (auth/improvement-request-authorization.ts). 🔴 **요청 본문에서 오는 값은
 *    권한 판정에 쓰지 않는다** — 역할도, 사용자 id 도, 「관리자입니다」도 받지
 *    않는다. 그래서 이 파일의 함수들은 actorUserId 나 role 을 인자로 받지 않는다.
 *  · **검증을 권한보다 먼저 하지 않는다.** 먼저 하면 권한 없는 사람이 어떤 값이
 *    유효한지를(예: 어떤 서비스 열쇠가 있는지) 오류 메시지로 알아낼 수 있다.
 *
 * ── 저장도 한 번 더 본다 ────────────────────────────────────────────────
 * mutation 은 `canManage` 를 인자로 받아 같은 판정을 다시 하고, 입력도 같은 검증
 * 함수로 다시 본다(db/mutations/improvement-requests.ts 머리말). 이 액션을 거치지
 * 않는 길이 생겨도 규칙이 남는다.
 *
 * ── 🔴 로그에 본문을 싣지 않는다 ────────────────────────────────────────
 * 예상 밖 오류를 `console.error(…, err)` 로 통째로 넘기지 않는다. drizzle 의
 * 오류는 메시지에 쿼리 인자를 그대로 싣고(본문이 거기 있다), Postgres 의 CHECK
 * 오류는 detail 에 「Failing row contains (…)」로 행 전체를 싣는다. 그래서 오류
 * 이름 · Postgres 오류 코드 · 제약 이름만 남긴다(logUnexpectedDbError).
 * 본문은 자유 입력이다 — db/schema.ts 의 PII 절.
 * ============================================================================
 */

export type ImprovementRequestActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type ImprovementRequestActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: ImprovementRequestActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

/** 목록 화면. 저장이 성공하면 이 경로를 다시 그린다. */
const LIST_PATH = "/";

const UNAUTHORIZED_MESSAGE = "로그인이 필요합니다.";
const FORBIDDEN_MESSAGE = "이 작업을 수행할 권한이 없습니다.";
const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const DATABASE_UNAVAILABLE_MESSAGE =
  "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unauthorized(): ImprovementRequestActionResult {
  return { ok: false, code: "UNAUTHORIZED", message: UNAUTHORIZED_MESSAGE };
}

function forbidden(): ImprovementRequestActionResult {
  return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
}

function invalid(fieldErrors: Record<string, string>): ImprovementRequestActionResult {
  return { ok: false, code: "VALIDATION_ERROR", fieldErrors, message: VALIDATION_MESSAGE };
}

function databaseUnavailable(): ImprovementRequestActionResult {
  return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
}

/** 오류에서 값이 없는 부분만 꺼낸다 — 파일 머리말의 '로그에 본문을 싣지 않는다'. */
function describeErrorWithoutValues(err: unknown): {
  name: string;
  code: string | null;
  constraint: string | null;
} {
  const name = err instanceof Error ? err.name : typeof err;
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        name,
        code: candidate.code,
        constraint:
          typeof candidate.constraint_name === "string" ? candidate.constraint_name : null,
      };
    }
    current = candidate.cause;
  }
  return { name, code: null, constraint: null };
}

function logUnexpectedDbError(actionName: string, err: unknown): void {
  console.error(`${actionName}: unexpected DB error`, describeErrorWithoutValues(err));
}

/** 새 글 하나 — 들어온 사람 누구나. */
export async function createImprovementRequestAction(input: {
  fields: Record<string, unknown>;
}): Promise<ImprovementRequestActionResult> {
  const actor = await getSessionUser();
  if (!actor) return unauthorized();
  if (!canWriteImprovementRequests(actor.role)) return forbidden();

  try {
    const result = await createImprovementRequest({
      fields: input.fields ?? {},
      actorUserId: actor.id,
    });
    if (result.ok) revalidatePath(LIST_PATH);
    return result;
  } catch (err) {
    logUnexpectedDbError("createImprovementRequestAction", err);
    return databaseUnavailable();
  }
}

/**
 * 상태를 옮긴다 — 관리 권한이 있을 때만.
 *
 * `expectedVersion` 은 화면이 들고 있던 값이다. 그 사이 누가 먼저 옮겼으면
 * mutation 이 CONFLICT 로 돌려주고, 화면은 다시 보내지 않고 새로 불러온다.
 */
export async function changeImprovementRequestStatusAction(input: {
  id: string;
  expectedVersion: number;
  to: string;
}): Promise<ImprovementRequestActionResult> {
  const actor = await getSessionUser();
  if (!actor) return unauthorized();

  // 🔴 이 값은 살아 있는 계정의 역할에서만 나온다. 화면이 넘긴 값이 아니다.
  const canManage = canManageImprovementRequests(actor.role);
  if (!canManage) return forbidden();

  const fieldErrors: Record<string, string> = {};
  if (typeof input.id !== "string" || !UUID_PATTERN.test(input.id)) {
    fieldErrors.id = "개선요청을 확인할 수 없습니다.";
  }
  if (
    typeof input.expectedVersion !== "number" ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion <= 0
  ) {
    fieldErrors.expectedVersion = "수정 시점 정보를 확인할 수 없습니다.";
  }
  if (!isImprovementRequestStatus(input.to)) {
    fieldErrors.to = "옮길 상태를 확인할 수 없습니다.";
  }
  if (Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);

  try {
    const result = await changeImprovementRequestStatus({
      id: input.id,
      expectedVersion: input.expectedVersion,
      // 위에서 isImprovementRequestStatus 로 좁혔다.
      to: input.to as Parameters<typeof changeImprovementRequestStatus>[0]["to"],
      actorUserId: actor.id,
      canManage,
    });
    if (result.ok) revalidatePath(LIST_PATH);
    return result;
  } catch (err) {
    logUnexpectedDbError("changeImprovementRequestStatusAction", err);
    return databaseUnavailable();
  }
}

/**
 * 글 하나를 지운다 — 소프트 삭제. 「자기 글, 또는 관리자」(승인된 설계 ④).
 *
 * 🔴 **여기서 역할을 계산해 넘긴다.** 화면이 「지우기」 단추를 그렸다는 사실도,
 * 요청 본문이 「내 글입니다」라고 말하는 것도 근거가 아니다 — 작성자 대조는 잠근
 * 행의 created_by 로 mutation 이 하고, 관리 권한은 살아 있는 계정의 역할에서 온다.
 *
 * `expectedVersion` 은 화면이 들고 있던 값이다. 그 사이 누가 글을 바꿨으면
 * CONFLICT 로 돌아간다 — 낡은 화면에서 누른 [지우기]가 방금 바뀐 글에 닿지 않게.
 */
export async function deleteImprovementRequestAction(input: {
  id: string;
  expectedVersion: number;
}): Promise<ImprovementRequestActionResult> {
  const actor = await getSessionUser();
  if (!actor) return unauthorized();
  if (!canWriteImprovementRequests(actor.role)) return forbidden();

  // 🔴 살아 있는 계정의 역할에서만 나온다. 화면이 넘긴 값이 아니다.
  const canManage = canManageImprovementRequests(actor.role);

  const fieldErrors: Record<string, string> = {};
  if (typeof input.id !== "string" || !UUID_PATTERN.test(input.id)) {
    fieldErrors.id = "개선요청을 확인할 수 없습니다.";
  }
  if (
    typeof input.expectedVersion !== "number" ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion <= 0
  ) {
    fieldErrors.expectedVersion = "수정 시점 정보를 확인할 수 없습니다.";
  }
  if (Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);

  try {
    const result = await deleteImprovementRequest({
      id: input.id,
      expectedVersion: input.expectedVersion,
      actorUserId: actor.id,
      canManage,
    });
    if (result.ok) revalidatePath(LIST_PATH);
    return result;
  } catch (err) {
    logUnexpectedDbError("deleteImprovementRequestAction", err);
    return databaseUnavailable();
  }
}

export type ImprovementRequestAttachmentActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      /**
       * LIMIT_REACHED 는 지우기에서 나올 수 없지만 저장(mutation)의 코드 목록을
       * 그대로 받는다 — 목록이 늘 때 이쪽만 좁혀 두면 컴파일이 조용히 통과하고
       * 화면이 모르는 코드를 받는다.
       */
      code: ImprovementRequestActionResultCode | "ALREADY_DELETED" | "LIMIT_REACHED";
      message: string;
    };

/**
 * 스크린샷 한 장을 뗀다 — 소프트 삭제. 글 지우기와 **같은 권한 규칙**이다.
 *
 * 🔴 글 id 와 첨부 id 를 **둘 다** 받는다. 권한 판정이 보는 것은 글이므로, 첨부가
 * 정말 그 글의 것인지 확인하지 않으면 「내 글 권한으로 남의 글의 첨부를 지우는」
 * 길이 열린다. 그 짝 확인은 잠근 트랜잭션 안에서 mutation 이 한다.
 *
 * 올리기는 서버 액션이 아니라 Route Handler 다(api/improvement-requests/[id]/
 * attachments). 파일 바이트를 흘려보내며 크기를 재야 하는데 서버 액션에는 그 통로가
 * 없기 때문이다 — 지우기는 바이트를 다루지 않으므로 여기 있는 것이 맞다.
 */
export async function deleteImprovementRequestAttachmentAction(input: {
  improvementRequestId: string;
  attachmentId: string;
}): Promise<ImprovementRequestAttachmentActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, code: "UNAUTHORIZED", message: UNAUTHORIZED_MESSAGE };
  if (!canWriteImprovementRequests(actor.role)) {
    return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }

  const canManage = canManageImprovementRequests(actor.role);

  if (
    typeof input.improvementRequestId !== "string" ||
    !UUID_PATTERN.test(input.improvementRequestId) ||
    typeof input.attachmentId !== "string" ||
    !UUID_PATTERN.test(input.attachmentId)
  ) {
    return { ok: false, code: "NOT_FOUND", message: "해당 스크린샷을 찾을 수 없습니다." };
  }

  try {
    const result = await softDeleteImprovementRequestAttachment({
      attachmentId: input.attachmentId,
      improvementRequestId: input.improvementRequestId,
      actorUserId: actor.id,
      canManage,
    });
    if (result.ok) {
      revalidatePath(LIST_PATH);
      return { ok: true, id: result.id };
    }
    return { ok: false, code: result.code, message: result.message };
  } catch (err) {
    logUnexpectedDbError("deleteImprovementRequestAttachmentAction", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}
