import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { improvementRequestAttachments, improvementRequests } from "@/lib/db/schema";
import {
  canChangeImprovementRequestScreenshots,
  decideImprovementRequestScreenshotRestore,
  hasImprovementRequestScreenshotRoom,
  IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_NOT_DELETED_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_RESTORE_LIMIT_MESSAGE,
} from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 개선요청 스크린샷 — 붙이기 · 떼기 · 되살리기
 * ============================================================================
 * 순서가 곧 규칙이다. 세 함수 모두 같은 차례를 따른다.
 *
 *  1. 트랜잭션을 열고 **글 행**을 `.for("update")` 로 잠근다. ⚠️ id 로만 좁힌다.
 *  2. 없는(또는 이미 지워진) 글이면 NOT_FOUND.
 *  3. 판정이 거짓이면 FORBIDDEN — 「자기 글, 또는 관리자」
 *     (domain 의 canChangeImprovementRequestScreenshots).
 *  4. (붙이기·되살리기만) **같은 트랜잭션에서** 살아 있는 첨부를 세고, 다섯 장이면
 *     LIMIT_REACHED. 🔴 되살리기도 이 셈을 건너뛰지 않는다 — 다섯 장을 채운 뒤
 *     하나 지웠다 되살리는 것만으로 여섯 장이 되기 때문이다.
 *  5. 행을 넣거나 지우거나 되돌린다.
 *
 * ── 🔴 잠그는 것은 첨부가 아니라 「글」이다 ─────────────────────────────
 * 다섯 장을 세는 일은 **여러 행에 걸친 질문**이라, 첨부 행 하나를 잠가서는 답할 수
 * 없다. 두 창에서 동시에 올리면 둘 다 「지금 네 장」을 보고 둘 다 들어가 여섯 장이
 * 된다. 글 행을 잠그면 같은 글에 대한 올리기가 한 줄로 서고, 뒤에 선 쪽은 앞사람이
 * 넣은 뒤의 수를 본다. 이것이 5장 관문이 실제로 서 있는 자리다.
 *
 * 화면과 올리기 통로 앞머리에서도 세지만 그 둘은 **빠른 거절**이다 — 20MB 를 다
 * 보내고 나서 거절당하지 않게 해 주는 친절이지 관문이 아니다.
 *
 * ── 🔴 권한의 「역할 부분」은 여기서 보지 않는다 ────────────────────────
 * 「관리 권한이 있는가」는 부르는 쪽(서버 액션·올리기 통로)이 **살아 있는 계정의
 * 역할**로 계산해 `canManage` 로 넘긴다. 이 층은 그 답을 받아 글 한 건에 대해
 * 판정한다 — mutations/improvement-requests.ts 와 같은 나눔이다.
 *
 * ── 글의 version 은 오르지 않는다 ──────────────────────────────────────
 * 스크린샷을 붙이거나 떼어도 글 행은 **잠그기만** 하고 고치지 않는다. 그래서 글을
 * 읽고 있던 다른 창의 상태 옮기기가 이것 때문에 충돌하지 않는다 — 스크린샷은 글의
 * 내용이 아니라 곁에 붙는 자료다.
 *
 * ── 지우기는 소프트 삭제다 ─────────────────────────────────────────────
 * 행은 남기고 4칼럼만 채운다(db/schema.ts 의 승인된 설계 ③). **디스크의 파일은
 * 건드리지 않는다** — 행이 살아 있는 한 되살릴 수 있어야 하고, 지운 순간 파일을
 * 지우면 되살리기가 영영 불가능해진다. 되살리기(restore…)가 그 4칼럼을 되돌려
 * 놓는 자리다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * 파일 이름은 사람이 붙인 것이라 이름·고객사가 섞일 수 있다. 결과 메시지에 싣지
 * 않고, 이 파일은 아무것도 로그하지 않는다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ImprovementRequestAttachmentResultCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "LIMIT_REACHED"
  | "ALREADY_DELETED"
  | "NOT_DELETED";

export type ImprovementRequestAttachmentResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ImprovementRequestAttachmentResultCode; message: string };

const REQUEST_NOT_FOUND_MESSAGE = "해당 개선요청을 찾을 수 없습니다.";
const ATTACHMENT_NOT_FOUND_MESSAGE = "해당 스크린샷을 찾을 수 없습니다.";
const ALREADY_DELETED_MESSAGE = "이미 지워진 스크린샷입니다.";

function failure<T>(
  code: ImprovementRequestAttachmentResultCode,
  message: string,
): ImprovementRequestAttachmentResult<T> {
  return { ok: false, code, message };
}

/**
 * 글 행을 잠그고 읽는다.
 *
 * ⚠️ **id 로만 좁힌다.** 다른 조건을 붙이면 그 조건에 맞지 않는 행은 잠기지 않은
 * 채로 「없다」고 답하게 되고, 그 사이에 다른 요청이 같은 행을 바꾼다. 이미 지워진
 * 글인지는 잠근 **뒤에** 본다.
 */
async function lockImprovementRequest(tx: Tx, improvementRequestId: string) {
  const [row] = await tx
    .select({
      id: improvementRequests.id,
      createdBy: improvementRequests.createdBy,
      isDeleted: improvementRequests.isDeleted,
    })
    .from(improvementRequests)
    .where(eq(improvementRequests.id, improvementRequestId))
    .for("update");
  return row;
}

/** 잠근 글의 **살아 있는** 첨부 수. 이 셈이 다섯 장 관문의 근거다. */
async function countLiveAttachments(tx: Tx, improvementRequestId: string): Promise<number> {
  const [row] = await tx
    .select({ liveCount: sql<number>`count(*)::int` })
    .from(improvementRequestAttachments)
    .where(
      and(
        eq(improvementRequestAttachments.improvementRequestId, improvementRequestId),
        eq(improvementRequestAttachments.isDeleted, false),
      ),
    );
  return row?.liveCount ?? 0;
}

/**
 * 스크린샷 한 장을 글에 붙인다.
 *
 * 🔴 **파일은 이미 디스크에 놓인 뒤에** 불린다(api/…/attachments/route.ts 의
 * 차례). 이 함수가 거절하면 부르는 쪽이 그 파일을 치운다 — 순서를 뒤집어 DB 를
 * 먼저 넣으면, 파일 쓰기가 실패했을 때 **가리키는 파일이 없는 행**이 남는다.
 * 주인 없는 파일은 나중에 훑어 치울 수 있지만, 없는 파일을 가리키는 행은 화면에서
 * 깨진 그림으로 나타난다.
 *
 * `id` 와 `storedPath` 는 부르는 쪽이 만든다 — id 가 곧 디스크의 파일 이름이라
 * 파일을 놓기 전에 정해져 있어야 한다(db/schema.ts 의 id 칸 주석).
 */
export async function createImprovementRequestAttachment(params: {
  id: string;
  improvementRequestId: string;
  originalFileName: string;
  storedPath: string;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
  actorUserId: string;
  canManage: boolean;
}): Promise<ImprovementRequestAttachmentResult<{ id: string; uploadedAt: string }>> {
  return db.transaction(
    async (tx): Promise<ImprovementRequestAttachmentResult<{ id: string; uploadedAt: string }>> => {
      const request = await lockImprovementRequest(tx, params.improvementRequestId);
      if (!request || request.isDeleted) {
        return failure("NOT_FOUND", REQUEST_NOT_FOUND_MESSAGE);
      }
      if (
        !canChangeImprovementRequestScreenshots({
          createdBy: request.createdBy,
          actorUserId: params.actorUserId,
          canManage: params.canManage,
        })
      ) {
        return failure("FORBIDDEN", IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE);
      }

      // 🔴 다섯 장은 여기서 센다 — 글 행을 잠근 **이 트랜잭션 안**이다(파일 머리말).
      const liveCount = await countLiveAttachments(tx, request.id);
      if (!hasImprovementRequestScreenshotRoom(liveCount)) {
        return failure("LIMIT_REACHED", IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE);
      }

      const [inserted] = await tx
        .insert(improvementRequestAttachments)
        .values({
          id: params.id,
          improvementRequestId: request.id,
          originalFileName: params.originalFileName,
          storedPath: params.storedPath,
          mimeType: params.mimeType,
          fileSize: params.fileSize,
          checksumSha256: params.checksumSha256,
          uploadedBy: params.actorUserId,
        })
        .returning({
          id: improvementRequestAttachments.id,
          uploadedAt: improvementRequestAttachments.uploadedAt,
        });

      return { ok: true, id: inserted.id, uploadedAt: inserted.uploadedAt.toISOString() };
    },
  );
}

/**
 * 스크린샷 한 장을 뗀다 — 소프트 삭제.
 *
 * 첨부는 **글 id 와 짝으로** 찾는다. 남의 글의 첨부 id 를 자기 글 주소에 끼워
 * 넣어도 아무것도 지워지지 않는다 — 권한 판정이 보는 것은 주소에 적힌 글이라,
 * 짝을 보지 않으면 「내 글 권한으로 남의 글의 첨부를 지우는」 길이 열린다.
 */
export async function softDeleteImprovementRequestAttachment(params: {
  attachmentId: string;
  improvementRequestId: string;
  actorUserId: string;
  canManage: boolean;
  reason?: string | null;
}): Promise<ImprovementRequestAttachmentResult<{ id: string }>> {
  return db.transaction(
    async (tx): Promise<ImprovementRequestAttachmentResult<{ id: string }>> => {
      const request = await lockImprovementRequest(tx, params.improvementRequestId);
      if (!request || request.isDeleted) {
        return failure("NOT_FOUND", REQUEST_NOT_FOUND_MESSAGE);
      }
      if (
        !canChangeImprovementRequestScreenshots({
          createdBy: request.createdBy,
          actorUserId: params.actorUserId,
          canManage: params.canManage,
        })
      ) {
        return failure("FORBIDDEN", IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE);
      }

      const [attachment] = await tx
        .select({
          id: improvementRequestAttachments.id,
          isDeleted: improvementRequestAttachments.isDeleted,
        })
        .from(improvementRequestAttachments)
        .where(
          and(
            eq(improvementRequestAttachments.id, params.attachmentId),
            eq(improvementRequestAttachments.improvementRequestId, request.id),
          ),
        )
        .for("update");

      if (!attachment) return failure("NOT_FOUND", ATTACHMENT_NOT_FOUND_MESSAGE);
      // 이미 지워진 것을 다시 지우지 않는다 — 다시 지우면 「누가 언제 지웠는가」가
      // 뒤늦게 누른 사람으로 덮인다.
      if (attachment.isDeleted) return failure("ALREADY_DELETED", ALREADY_DELETED_MESSAGE);

      await tx
        .update(improvementRequestAttachments)
        .set({
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: params.actorUserId,
          deleteReason: params.reason ?? null,
        })
        .where(
          and(
            eq(improvementRequestAttachments.id, attachment.id),
            eq(improvementRequestAttachments.isDeleted, false),
          ),
        );

      return { ok: true, id: attachment.id };
    },
  );
}

/**
 * 지운 스크린샷 한 장을 되살린다 — 휴지통의 [되살리기].
 *
 * 떼기의 되돌림이라 **차례도 권한도 떼기와 같다**(파일 머리말). 다른 점은 하나뿐:
 *
 * 🔴 **다섯 장을 다시 센다.** 되살리면 살아 있는 장이 한 장 늘므로 붙이기와 같은
 * 관문을 지나야 한다. 이것이 없으면 다섯 장을 채운 뒤 한 장 지웠다 되살리는 것만
 * 으로 **여섯 장**이 된다 — 붙이기 쪽 관문은 INSERT 에만 서 있어서 이 길을 보지
 * 못한다. 세는 자리는 붙이기와 **같은 함수**(countLiveAttachments)이고, 판정도
 * 같은 함수(domain 의 hasImprovementRequestScreenshotRoom — 되살리기 판정
 * decideImprovementRequestScreenshotRestore 가 그것을 부른다)다.
 *
 * 되돌리는 것은 소프트 삭제 4칼럼 전부다. is_deleted 만 내리고 deleted_at·
 * deleted_by·delete_reason 을 남겨 두면 「살아 있는데 지워진 기록이 붙은」 행이
 * 되어, 다음에 읽는 사람이 어느 쪽을 믿어야 할지 알 수 없다. 이 사이트에는 감사
 * 로그 표가 없으므로 「한 번 지웠다 되살렸다」는 사실은 남지 않는다
 * (db/schema.ts 의 승인된 설계 ③ — 그 대신 파일도 행도 지우지 않는다).
 *
 * 🔴 UPDATE 의 WHERE 에 `is_deleted = true` 를 한 번 더 적는다. 잠그고 읽은 뒤이니
 * 보통은 필요 없지만, 잠금을 빼먹은 길이 생겨도 이미 살아 있는 행을 건드리지 않게
 * (mutations/improvement-requests.ts 의 조건부 UPDATE 와 같은 겹치기다).
 */
export async function restoreImprovementRequestAttachment(params: {
  attachmentId: string;
  improvementRequestId: string;
  actorUserId: string;
  canManage: boolean;
}): Promise<ImprovementRequestAttachmentResult<{ id: string }>> {
  return db.transaction(
    async (tx): Promise<ImprovementRequestAttachmentResult<{ id: string }>> => {
      const request = await lockImprovementRequest(tx, params.improvementRequestId);
      if (!request || request.isDeleted) {
        return failure("NOT_FOUND", REQUEST_NOT_FOUND_MESSAGE);
      }
      if (
        !canChangeImprovementRequestScreenshots({
          createdBy: request.createdBy,
          actorUserId: params.actorUserId,
          canManage: params.canManage,
        })
      ) {
        return failure("FORBIDDEN", IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE);
      }

      // 떼기와 같다 — 첨부는 **글 id 와 짝으로** 찾는다(떼기 머리말).
      const [attachment] = await tx
        .select({
          id: improvementRequestAttachments.id,
          isDeleted: improvementRequestAttachments.isDeleted,
        })
        .from(improvementRequestAttachments)
        .where(
          and(
            eq(improvementRequestAttachments.id, params.attachmentId),
            eq(improvementRequestAttachments.improvementRequestId, request.id),
          ),
        )
        .for("update");

      // 🔴 다섯 장은 여기서 센다 — 글 행을 잠근 **이 트랜잭션 안**이다(파일 머리말).
      // 되살릴 장은 지워져 있어 이 셈에 들지 않는다. 그래서 붙이기와 같은 견줌이다.
      const liveCount = await countLiveAttachments(tx, request.id);
      const gate = decideImprovementRequestScreenshotRestore({ attachment, liveCount });
      if (gate.kind === "not-found") return failure("NOT_FOUND", ATTACHMENT_NOT_FOUND_MESSAGE);
      if (gate.kind === "not-deleted") {
        return failure("NOT_DELETED", IMPROVEMENT_REQUEST_SCREENSHOT_NOT_DELETED_MESSAGE);
      }
      if (gate.kind === "limit-reached") {
        return failure("LIMIT_REACHED", IMPROVEMENT_REQUEST_SCREENSHOT_RESTORE_LIMIT_MESSAGE);
      }

      await tx
        .update(improvementRequestAttachments)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        })
        .where(
          and(
            eq(improvementRequestAttachments.id, attachment.id),
            eq(improvementRequestAttachments.isDeleted, true),
          ),
        );

      return { ok: true, id: attachment.id };
    },
  );
}
