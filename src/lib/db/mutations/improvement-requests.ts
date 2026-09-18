import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { improvementRequestAttachments, improvementRequests } from "@/lib/db/schema";
import {
  canChangeImprovementRequestStatus,
  canDeleteImprovementRequest,
  canEditImprovementRequestBody,
  decideImprovementRequestWrite,
  IMPROVEMENT_REQUEST_DELETE_FORBIDDEN_MESSAGE,
  planImprovementRequestStatusChange,
  type ImprovementRequestStatus,
} from "@/lib/domain/improvement-request";
import { validateImprovementRequestFields } from "@/lib/validation/improvement-request-input";

/**
 * ============================================================================
 * 개선요청 — 적기 · 고치기 · 상태 옮기기
 * ============================================================================
 * 본보기는 A/S 시스템의 db/mutations/improvement-requests.ts 다. 순서가 곧 규칙인
 * 것도 같다:
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다. ⚠️ id 로만 좁힌다.
 *  2. 없는(또는 이미 지워진) 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — **한 글자도 바꾸지 않고** 돌아간다.
 *  4. 판정이 거짓이면 FORBIDDEN.
 *  5. 값과 함께 version + 1 · updated_by · updated_at 을 쓰고, 조건부 UPDATE 로
 *     version 을 한 번 더 본다(0행이면 CONFLICT — 마지막 안전망).
 *
 * ── 🔴 낙관적 잠금을 두 번 보는 이유 ────────────────────────────────────
 * 3번에서 이미 봤는데 5번에서 또 본다. 3번은 잠근 뒤라 그 사이에 바뀔 수 없어
 * 보이지만, 그것은 **이 함수가 언제나 잠그고 읽는다**는 전제 위에서만 참이다.
 * WHERE 에 version 을 함께 적어 두면 그 전제가 깨져도(잠금을 빼먹은 길이 생겨도)
 * 앞사람의 변경을 덮지 않는다. 한 줄 값이 싸다.
 *
 * ── 🔴 권한의 「역할 부분」은 여기서 보지 않는다 ────────────────────────
 * 「관리 권한이 있는가」는 서버 액션이 살아 있는 계정의 역할로 계산해 `canManage`
 * 로 넘긴다(auth/improvement-request-authorization.ts). 이 층은 그 답을 받아 글 한
 * 건에 대해 판정한다 — domain/improvement-request.ts 와 같은 나눔이고, 시험이
 * 세션 없이 규칙을 그대로 검증할 수 있는 이유이기도 하다.
 *
 * ── 🔴 입력은 여기서 한 번 더 검증한다 ──────────────────────────────────
 * 서버 액션이 이미 검증하지만, 이 함수를 직접 부르는 길(시험 · 나중의 이관
 * 스크립트)에서도 목록에 없는 서비스·메뉴 열쇠나 빈 글이 들어가지 않도록 같은
 * 함수(validateImprovementRequestFields)를 **트랜잭션 전에** 부른다. service_key ·
 * menu_key 에는 DB CHECK 가 없어서(db/schema.ts 머리말) 검증을 건너뛴 길로는 아무
 * 글자나 저장된다. 정규화는 멱등이라 두 번 거쳐도 값이 바뀌지 않는다.
 *
 * ── 감사 로그 표는 아직 없다 ────────────────────────────────────────────
 * A/S 는 같은 트랜잭션에서 audit_logs 에 한 줄을 남긴다. 이 사이트에는 그 표가
 * 없다. 대신 「누가 언제」는 상태 네 칸과 created_by/at · updated_by/at 이 들고
 * 있다 — 상태를 **누가** 옮겼는지까지는 남는다. 남지 않는 것은 「되돌린 이력」과
 * 「지운 사람」이고, 그 표가 필요해지면 그때 만든다(schema.ts 의 지우기 절).
 *
 * ── 「지금」은 트랜잭션마다 한 번 ───────────────────────────────────────
 * created_at 과 updated_at, 또는 in_progress_at/resolved_at 과 updated_at 이 같은
 * 시각이 되게 한다. 두 번 만들면 한 저장 안에서 밀리초가 어긋난다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * 본문은 자유 입력이다. 결과 메시지에 싣지 않고, 이 파일은 아무것도 로그하지
 * 않는다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ImprovementRequestRow = typeof improvementRequests.$inferSelect;

export type ImprovementRequestMutationResultCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "VALIDATION_ERROR";

export type ImprovementRequestMutationResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: ImprovementRequestMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const NOT_FOUND_MESSAGE = "해당 개선요청을 찾을 수 없습니다.";
const VERSION_CONFLICT_MESSAGE =
  "다른 사람이 이 개선요청을 먼저 바꿨습니다. 새로 불러온 뒤 다시 시도해 주세요.";
const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const STATUS_FORBIDDEN_MESSAGE = "상태를 바꿀 권한이 없습니다.";
const EDIT_FORBIDDEN_MESSAGE = "접수 상태인 자기 글만 고칠 수 있습니다.";

function notFound(): ImprovementRequestMutationResult {
  return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
}

function conflict(): ImprovementRequestMutationResult {
  return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
}

function forbidden(message: string): ImprovementRequestMutationResult {
  return { ok: false, code: "FORBIDDEN", message };
}

function invalid(fieldErrors: Record<string, string>): ImprovementRequestMutationResult {
  return { ok: false, code: "VALIDATION_ERROR", fieldErrors, message: VALIDATION_MESSAGE };
}

/**
 * 대상 행을 잠그고 읽는다.
 *
 * ⚠️ **id 로만 좁힌다.** 다른 조건을 붙이면 그 조건에 맞지 않는 행은 잠기지 않은
 * 채로 「없다」고 답하게 되고, 그 사이에 다른 요청이 같은 행을 바꾼다. 이미
 * 지워진 글(is_deleted)인지는 잠근 **뒤에** 본다.
 */
async function lockImprovementRequest(
  tx: Tx,
  id: string
): Promise<ImprovementRequestRow | undefined> {
  const [row] = await tx
    .select()
    .from(improvementRequests)
    .where(eq(improvementRequests.id, id))
    .for("update");
  return row;
}

/** 새 글 하나. 접수 상태 · version 1 로 시작한다. 메뉴는 고르지 않아도 된다. */
export async function createImprovementRequest(params: {
  fields: Record<string, unknown>;
  actorUserId: string;
}): Promise<ImprovementRequestMutationResult> {
  const validation = validateImprovementRequestFields(params.fields);
  if (!validation.ok) return invalid(validation.fieldErrors);
  const { body, serviceKey, menuKey } = validation.data;

  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const now = new Date();

    const [inserted] = await tx
      .insert(improvementRequests)
      .values({
        serviceKey,
        menuKey,
        body,
        status: "OPEN",
        createdBy: params.actorUserId,
        createdAt: now,
        // 만든 사람이 곧 마지막으로 손댄 사람이다 — 첫 수정 전까지 빈칸으로
        // 두지 않는다. 목록이 「마지막으로 움직인 때」를 한 칸으로 읽을 수 있다.
        updatedBy: params.actorUserId,
        updatedAt: now,
      })
      .returning({ id: improvementRequests.id, version: improvementRequests.version });

    return { ok: true, id: inserted.id, version: inserted.version };
  });
}

/**
 * 글의 **내용**을 고친다 — 접수 상태인 자기 글만(canEditImprovementRequestBody).
 *
 * ── 🔴 `canManage` 를 받지 않는다 ───────────────────────────────────────
 * 관리 권한이 있어도 **남의 글 내용은 못 고친다**(domain 의 규칙 주석: 글은 적은
 * 사람의 말이다). 인자로 아예 받지 않는 것이 그 규칙을 지키는 가장 싼 방법이다 —
 * 받아 두면 언젠가 "관리자는 예외"가 한 줄로 끼어든다. 지우기(canManage 를 받는다)와
 * 다른 점이 여기다.
 *
 * ── 여기서 고치는 것은 셋이다 — 본문 · 시스템 · 메뉴 ────────────────────
 * 이 사이트는 **여러 시스템**의 요청을 받는 곳이고, 적을 때 셋을 다 고르게 한다.
 * 시스템을 잘못 고른 글에 고칠 길이 없으면 지우고 다시 쓰는 수밖에 없다.
 * (본보기인 A/S 는 본문·메뉴만 고쳤지만, 거기는 개선요청이 그 시스템 **안의**
 * 기능이라 「어느 시스템인가」라는 칸 자체가 없었다.) 상태는 여기서 못 바꾼다 —
 * 그것은 관리자만 하는 별도 기능이다(changeImprovementRequestStatus).
 *
 * ── 메뉴는 적을 때와 같은 규칙이다 ─────────────────────────────────────
 * 「모름 · 해당 없음」(null)으로 둘 수 있다. 적을 때 비워 둘 수 있는 칸을 고칠 때만
 * 필수로 만들면, 메뉴를 모르고 적은 사람이 본문의 오타 하나를 고치려다 있지도 않은
 * 메뉴를 골라야 한다. 검증은 적기와 **같은 함수**(validateImprovementRequestFields)가
 * 하므로 두 길이 갈라지지 않는다.
 *
 * 차례는 없음 → 충돌 → 권한이다. 지우기와 같은 이유로 권한을 version 뒤에 본다 —
 * 판정이 **잠근 행의** status·created_by 를 봐야 하고, 낡은 화면에서 누른 [저장]이
 * 거절될 때 그 사이 상태가 옮겨졌다면 「권한 없음」보다 「다시 불러오라」가 맞는
 * 말이기 때문이다.
 */
export async function updateImprovementRequestBody(params: {
  id: string;
  expectedVersion: number;
  fields: Record<string, unknown>;
  actorUserId: string;
}): Promise<ImprovementRequestMutationResult> {
  const validation = validateImprovementRequestFields(params.fields);
  if (!validation.ok) return invalid(validation.fieldErrors);
  const { body, serviceKey, menuKey } = validation.data;

  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const now = new Date();

    const current = await lockImprovementRequest(tx, params.id);
    const gate = decideImprovementRequestWrite({
      row: current,
      expectedVersion: params.expectedVersion,
    });
    if (gate.kind === "not-found") return notFound();
    if (gate.kind === "conflict") return conflict();
    if (!current) return notFound();

    // 🔴 판정의 재료는 **잠근 행**에서만 온다. 화면이 「내 글입니다」라고 말한 값이
    // 아니다 — created_by 가 null 인 옮겨 온 글이 여기서 걸리는 것도 같은 이유다.
    if (
      !canEditImprovementRequestBody({
        status: current.status,
        createdBy: current.createdBy,
        actorUserId: params.actorUserId,
      })
    ) {
      return forbidden(EDIT_FORBIDDEN_MESSAGE);
    }

    const [updated] = await tx
      .update(improvementRequests)
      .set({
        body,
        serviceKey,
        menuKey,
        version: sql`${improvementRequests.version} + 1`,
        updatedBy: params.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(improvementRequests.id, params.id),
          eq(improvementRequests.version, params.expectedVersion)
        )
      )
      .returning({ id: improvementRequests.id, version: improvementRequests.version });
    if (!updated) return conflict();

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 상태를 옮긴다 — 관리 권한(`canManage`)이 있을 때만, 어느 방향으로든.
 *
 * 네 칸(in_progress_by/at · resolved_by/at)은 planImprovementRequestStatusChange 가
 * 계산한 그대로 SET 한다 — 그 함수가 DB CHECK 와 같은 규칙을 지킨다. 같은 상태로의
 * 변경(`unchanged`)은 저장 없이 지금 version 을 그대로 돌려준다.
 *
 * CONFLICT 를 FORBIDDEN 보다 먼저 보는 이유: 낡은 화면에서 누른 단추가 거절될 때,
 * 그 사이 상태가 옮겨졌다면 「권한 없음」보다 「다시 불러오라」가 맞는 말이다.
 */
export async function changeImprovementRequestStatus(params: {
  id: string;
  expectedVersion: number;
  to: ImprovementRequestStatus;
  actorUserId: string;
  canManage: boolean;
}): Promise<ImprovementRequestMutationResult> {
  // 행과 상관없는 판정이라 잠그기 전에 본다 — 권한 없는 요청이 잠금을 잡지 않게.
  if (!canChangeImprovementRequestStatus({ canManage: params.canManage })) {
    return forbidden(STATUS_FORBIDDEN_MESSAGE);
  }

  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const now = new Date();

    const current = await lockImprovementRequest(tx, params.id);
    // 없음 · 지워짐 · 충돌의 순서는 도메인이 정한다(decideImprovementRequestWrite).
    const gate = decideImprovementRequestWrite({
      row: current,
      expectedVersion: params.expectedVersion,
    });
    if (gate.kind === "not-found") return notFound();
    if (gate.kind === "conflict") return conflict();
    // gate 가 proceed 이면 current 는 있다 — 타입이 그것을 모를 뿐이다.
    if (!current) return notFound();

    const plan = planImprovementRequestStatusChange({
      from: current.status,
      to: params.to,
      current: {
        inProgressBy: current.inProgressBy,
        inProgressAt: current.inProgressAt,
        resolvedBy: current.resolvedBy,
        resolvedAt: current.resolvedAt,
      },
      actorUserId: params.actorUserId,
      now,
    });
    if (plan.kind === "unchanged") {
      return { ok: true, id: current.id, version: current.version };
    }

    const [updated] = await tx
      .update(improvementRequests)
      .set({
        status: plan.status,
        ...plan.fields,
        version: sql`${improvementRequests.version} + 1`,
        updatedBy: params.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(improvementRequests.id, params.id),
          eq(improvementRequests.version, params.expectedVersion)
        )
      )
      .returning({ id: improvementRequests.id, version: improvementRequests.version });
    if (!updated) return conflict();

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 글 하나를 지운다 — **소프트 삭제**. 「자기 글, 또는 관리자」(승인된 설계 ④).
 *
 * ── 🔴 붙은 스크린샷도 같은 트랜잭션에서 함께 지운다 ────────────────────
 * 글만 지우고 첨부를 남기면 그 첨부는 **아무 목록에도 안 나오는데 살아 있는** 행이
 * 된다 — 화면에서 뗄 길이 없으니 영영 남고, 다섯 장 셈에는 계속 들어간다(글을
 * 되살릴 때 드러난다). 따로 지우면 그 사이에 프로세스가 죽었을 때 반만 지워진다.
 * 그래서 한 트랜잭션이다.
 *
 * 🔴 **디스크의 파일은 건드리지 않는다** — 소프트 삭제의 뜻은 「되살릴 수 있다」이고,
 * 파일을 지우면 그 약속이 깨진다(mutations/improvement-request-attachments.ts).
 *
 * ── 권한을 버전보다 **뒤에** 본다 ──────────────────────────────────────
 * 상태 옮기기(changeImprovementRequestStatus)는 역할 하나로 판정이 끝나 잠그기
 * 전에 본다. 여기는 **글의 작성자**를 봐야 해서 잠근 행이 있어야 한다. 차례는
 * 없음 → 충돌 → 권한이다 — 낡은 화면에서 누른 [지우기]가 거절될 때, 그 사이 누가
 * 먼저 지웠다면 「권한 없음」보다 「다시 불러오라」가 맞는 말이다.
 */
export async function deleteImprovementRequest(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
  canManage: boolean;
  reason?: string | null;
}): Promise<ImprovementRequestMutationResult> {
  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const now = new Date();

    const current = await lockImprovementRequest(tx, params.id);
    const gate = decideImprovementRequestWrite({
      row: current,
      expectedVersion: params.expectedVersion,
    });
    if (gate.kind === "not-found") return notFound();
    if (gate.kind === "conflict") return conflict();
    if (!current) return notFound();

    if (
      !canDeleteImprovementRequest({
        createdBy: current.createdBy,
        actorUserId: params.actorUserId,
        canManage: params.canManage,
      })
    ) {
      return forbidden(IMPROVEMENT_REQUEST_DELETE_FORBIDDEN_MESSAGE);
    }

    const [updated] = await tx
      .update(improvementRequests)
      .set({
        isDeleted: true,
        deletedAt: now,
        deletedBy: params.actorUserId,
        deleteReason: params.reason ?? null,
        version: sql`${improvementRequests.version} + 1`,
        updatedBy: params.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(improvementRequests.id, params.id),
          eq(improvementRequests.version, params.expectedVersion)
        )
      )
      .returning({ id: improvementRequests.id, version: improvementRequests.version });
    if (!updated) return conflict();

    // 같은 트랜잭션에서 붙은 스크린샷도 함께(파일 머리말). 이미 지워진 것은
    // 건드리지 않는다 — 「누가 언제 지웠는가」가 덮이지 않게.
    await tx
      .update(improvementRequestAttachments)
      .set({
        isDeleted: true,
        deletedAt: now,
        deletedBy: params.actorUserId,
        deleteReason: "글이 지워져 함께 지워짐",
      })
      .where(
        and(
          eq(improvementRequestAttachments.improvementRequestId, params.id),
          eq(improvementRequestAttachments.isDeleted, false)
        )
      );

    return { ok: true, id: updated.id, version: updated.version };
  });
}
