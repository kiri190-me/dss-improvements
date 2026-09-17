import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { improvementRequestAttachments, improvementRequests } from "@/lib/db/schema";

/**
 * ============================================================================
 * 개선요청 스크린샷 — 읽기만 한다
 * ============================================================================
 * 표의 뜻과 설계의 이유는 db/schema.ts 의 improvement_request_attachments 머리말에
 * 있다.
 *
 * ⚠️ 이 파일은 **서버에서만** 부른다(queries/improvement-requests.ts 의 같은 주석).
 *
 * ── 🔴 지워진 첨부는 읽지 않는다 ───────────────────────────────────────
 * 이 파일의 **모든** 조회가 `is_deleted = false` 를 조건에 단다. 소프트 삭제라 행은
 * 남아 있지만, 읽는 쪽에는 없는 것과 같아야 한다 — 한 곳이라도 빠뜨리면 지운
 * 스크린샷이 목록에 다시 나타나거나, 더 나쁘게는 **내려받기 통로로 계속 열린다.**
 * 글 자체가 지워진 경우도 같다(아래 두 함수가 글의 is_deleted 까지 본다).
 *
 * ── 🔴 첨부 하나를 읽을 때는 글 id 와 짝으로 본다 ──────────────────────
 * getImprovementRequestAttachmentFile 은 첨부 id 만으로 찾지 않는다. 주소에 적힌
 * 글의 것이 맞는지 DB 가 답하게 한다 — 남의 글의 첨부 id 를 아무 글 주소에 끼워
 * 넣어도 아무것도 나오지 않는다.
 * ============================================================================
 */

/** 화면 한 줄에 그릴 스크린샷 하나. 경로도 체크섬도 화면으로 내보내지 않는다. */
export type ImprovementRequestScreenshot = {
  id: string;
  /** 사람이 올린 이름 — 화면의 title·alt 에만 쓴다. */
  originalFileName: string;
  fileSize: number;
  uploadedAt: string;
};

/**
 * 글 여럿의 살아 있는 스크린샷을 한 번에 읽어 글 id 로 묶는다.
 *
 * 목록이 글 수만큼 질의를 날리지 않게(N+1) 한 번에 읽는다. 글이 하나도 없으면
 * 질의하지 않는다 — `IN ()` 은 SQL 로 성립하지 않는다.
 *
 * 차례는 **올린 순서**(uploaded_at 오름차순, 같으면 id)다. 붙인 차례대로 보여야
 * 「첫 장 · 둘째 장」으로 말할 수 있고, 새로 고칠 때마다 자리가 바뀌지 않는다.
 */
export async function listScreenshotsByRequestIds(
  improvementRequestIds: readonly string[],
): Promise<Map<string, ImprovementRequestScreenshot[]>> {
  const grouped = new Map<string, ImprovementRequestScreenshot[]>();
  if (improvementRequestIds.length === 0) return grouped;

  const rows = await db
    .select({
      id: improvementRequestAttachments.id,
      improvementRequestId: improvementRequestAttachments.improvementRequestId,
      originalFileName: improvementRequestAttachments.originalFileName,
      fileSize: improvementRequestAttachments.fileSize,
      uploadedAt: improvementRequestAttachments.uploadedAt,
    })
    .from(improvementRequestAttachments)
    .where(
      and(
        inArray(improvementRequestAttachments.improvementRequestId, [...improvementRequestIds]),
        eq(improvementRequestAttachments.isDeleted, false),
      ),
    )
    .orderBy(asc(improvementRequestAttachments.uploadedAt), asc(improvementRequestAttachments.id));

  for (const row of rows) {
    const list = grouped.get(row.improvementRequestId) ?? [];
    list.push({
      id: row.id,
      originalFileName: row.originalFileName,
      fileSize: row.fileSize,
      uploadedAt: row.uploadedAt.toISOString(),
    });
    grouped.set(row.improvementRequestId, list);
  }
  return grouped;
}

/** 올리기 통로가 본문을 받기 **전에** 보는 값들. */
export type ImprovementRequestAttachmentTarget = {
  id: string;
  /** 「자기 글인가」 판정의 재료. 옮겨 온 글은 null 이다. */
  createdBy: string | null;
  /** 지금 살아 있는 첨부 수 — **빠른 거절에만 쓴다**(진짜 셈은 트랜잭션 안이다). */
  liveAttachmentCount: number;
};

/**
 * 스크린샷을 붙일 글 하나. 지워진 글이면 없는 것으로 답한다.
 *
 * 🔴 여기서 센 첨부 수는 **빠른 거절**용이다. 20MB 를 다 받아 놓고 「이미 다섯
 * 장입니다」라고 하지 않으려는 것뿐이고, 진짜 다섯 장 판정은 글 행을 잠근
 * 트랜잭션 안에서 다시 한다(db/mutations/improvement-request-attachments.ts).
 * 이 셈만 믿으면 두 창에서 동시에 올린 두 장이 둘 다 「네 장뿐」을 보고 들어간다.
 */
export async function getImprovementRequestAttachmentTarget(
  improvementRequestId: string,
): Promise<ImprovementRequestAttachmentTarget | null> {
  const [row] = await db
    .select({
      id: improvementRequests.id,
      createdBy: improvementRequests.createdBy,
      liveAttachmentCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${improvementRequestAttachments}
        WHERE ${improvementRequestAttachments.improvementRequestId} = ${improvementRequests.id}
          AND ${improvementRequestAttachments.isDeleted} = false
      )`,
    })
    .from(improvementRequests)
    .where(and(eq(improvementRequests.id, improvementRequestId), eq(improvementRequests.isDeleted, false)))
    .limit(1);

  return row ?? null;
}

/** 내려받기·미리보기 통로가 파일을 열기 위해 필요한 값들. */
export type ImprovementRequestAttachmentFile = {
  id: string;
  storedPath: string;
  mimeType: string;
  originalFileName: string;
  fileSize: number;
};

/**
 * 그 글의, 살아 있는 첨부 하나. 아니면 null.
 *
 * 🔴 조건이 넷이다 — 첨부 id · **그 글의 것인가** · 첨부가 지워지지 않았는가 ·
 * 글이 지워지지 않았는가. 넷 중 하나라도 빠지면 지운 것이 계속 열리거나, 남의 글의
 * 첨부를 아무 글 주소로 꺼낼 수 있게 된다(파일 머리말).
 */
export async function getImprovementRequestAttachmentFile(params: {
  improvementRequestId: string;
  attachmentId: string;
}): Promise<ImprovementRequestAttachmentFile | null> {
  const [row] = await db
    .select({
      id: improvementRequestAttachments.id,
      storedPath: improvementRequestAttachments.storedPath,
      mimeType: improvementRequestAttachments.mimeType,
      originalFileName: improvementRequestAttachments.originalFileName,
      fileSize: improvementRequestAttachments.fileSize,
    })
    .from(improvementRequestAttachments)
    .innerJoin(
      improvementRequests,
      eq(improvementRequests.id, improvementRequestAttachments.improvementRequestId),
    )
    .where(
      and(
        eq(improvementRequestAttachments.id, params.attachmentId),
        eq(improvementRequestAttachments.improvementRequestId, params.improvementRequestId),
        eq(improvementRequestAttachments.isDeleted, false),
        eq(improvementRequests.isDeleted, false),
      ),
    )
    .limit(1);

  return row ?? null;
}
