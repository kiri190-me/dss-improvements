import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { improvementRequests, webUsers } from "@/lib/db/schema";
import type { ImprovementRequestStatus } from "@/lib/domain/improvement-request";
import {
  listScreenshotsByRequestIds,
  type ImprovementRequestScreenshot,
} from "./improvement-request-attachments";

/**
 * ============================================================================
 * 개선요청 — 목록 조회 (읽기만 한다)
 * ============================================================================
 * 표의 뜻과 설계의 이유는 db/schema.ts 의 improvement_requests 머리말에 있다.
 *
 * ⚠️ 이 파일은 **서버에서만** 부른다. `server-only` 를 import 하지 않는 것은 이
 * 저장소에 그 패키지가 없기 때문이다(의존성을 하나 더 들이지 않았다). 지키는
 * 장치는 「db 를 가져오는 모듈은 클라이언트 컴포넌트에서 import 하지 않는다」는
 * 관례뿐이다 — 화면은 서버 컴포넌트가 읽어서 props 로 넘긴다.
 *
 * ── 사람으로 거르지 않는다 ──────────────────────────────────────────────
 * 목록은 **모두가 본다**(README 의 「전 직원 공개」). 누가 이 화면에 들어올 수
 * 있는가는 레이아웃이 정하고, 누가 상태를 옮길 수 있는가는 서버 액션이 정한다 —
 * 이 조회는 그 판정에 필요한 값(status · createdByUserId · version)을 그대로 넘길
 * 뿐이다.
 *
 * ── 지워진 글은 빼고 읽는다 ─────────────────────────────────────────────
 * 소프트 삭제 4칼럼을 쓴다(schema 머리말). 지우기 화면은 아직 없지만 읽는 쪽은
 * 지금부터 거른다 — 나중에 지우기를 붙일 때 「목록에서 안 사라지네」를 겪지
 * 않으려고. 거르지 않는 조회를 새로 만들 일이 생기면 그것은 관리자용이고, 이
 * 함수를 고치는 것이 아니라 함수를 하나 더 만들 일이다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 * 최근 글부터(created_at 내림차순). 같은 시각이면 id 로 한 번 더 정렬해, 새로
 * 고침할 때마다 두 줄이 자리를 바꾸지 않게 한다.
 *
 * ── 이름은 세 사람, 그리고 이름이 없을 수 있다 ──────────────────────────
 * 적은 사람 · 진행중으로 옮긴 사람 · 해결한 사람. web_users 를 별칭 셋으로 붙인다.
 * 🔴 셋 다 **바깥 조인**이다 — 옮겨 온 글은 셋 중 누구도 이 사이트 계정으로 이을
 * 수 없을 수 있다(schema 머리말의 'A/S 의 개선요청 열 건이 들어올 자리'). 적은
 * 사람의 이름은 계정이 없으면 `imported_author_name` 을 쓰고, 그것도 없으면 null
 * 이다(그런 행은 CHECK 가 막지만, 타입은 그것을 모른다).
 * 소프트 삭제된 계정도 이름은 그대로 보인다 — 적은 사람이 떠났다고 「누가
 * 요청했는가」가 사라지면 안 된다.
 *
 * ── 시각은 ISO 문자열 ───────────────────────────────────────────────────
 * 서버 컴포넌트가 클라이언트 컴포넌트로 넘기는 값이라 Date 를 그대로 두지 않는다.
 *
 * 🔴 body 는 자유 입력이다(schema 머리말의 PII). 화면에 그리는 것 말고는 어디로도
 * 내보내지 않는다 — console 에도 싣지 않는다.
 * ============================================================================
 */

const author = alias(webUsers, "improvement_request_author");
const inProgressUser = alias(webUsers, "improvement_request_in_progress_user");
const resolvedUser = alias(webUsers, "improvement_request_resolved_user");

export type ImprovementRequestListItem = {
  id: string;
  /** service-catalog.ts 의 서비스 열쇠. 이름은 화면이 serviceLabel 로 푼다. */
  serviceKey: string;
  /** 그 서비스의 메뉴 열쇠. null 은 「고르지 않았다」. */
  menuKey: string | null;
  body: string;
  status: ImprovementRequestStatus;
  /** 적은 사람의 계정 id. 옮겨 온 글은 null 일 수 있다. */
  createdByUserId: string | null;
  /** 화면에 그릴 작성자 이름. 계정이 없으면 옮겨 올 때 적어 둔 이름. */
  createdByName: string | null;
  createdAt: string;
  /** 진행중으로 옮긴 사람과 때. 접수 상태면 셋 다 null. */
  inProgressByUserId: string | null;
  inProgressByName: string | null;
  inProgressAt: string | null;
  /** 해결로 옮긴 사람과 때. 해결 상태가 아니면 셋 다 null. */
  resolvedByUserId: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  /** 상태 옮기기가 expectedVersion 으로 돌려보낼 값. */
  version: number;
  /**
   * 이 글에 붙은 **살아 있는** 스크린샷, 올린 차례대로.
   * 지워진 것은 들어오지 않는다(queries/improvement-request-attachments.ts).
   */
  screenshots: ImprovementRequestScreenshot[];
};

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** 살아 있는 개선요청 전부 — 최근 글부터. */
export async function listImprovementRequests(): Promise<ImprovementRequestListItem[]> {
  const rows = await db
    .select({
      id: improvementRequests.id,
      serviceKey: improvementRequests.serviceKey,
      menuKey: improvementRequests.menuKey,
      body: improvementRequests.body,
      status: improvementRequests.status,
      createdByUserId: improvementRequests.createdBy,
      authorAccountName: author.displayName,
      importedAuthorName: improvementRequests.importedAuthorName,
      createdAt: improvementRequests.createdAt,
      inProgressByUserId: improvementRequests.inProgressBy,
      inProgressByName: inProgressUser.displayName,
      inProgressAt: improvementRequests.inProgressAt,
      resolvedByUserId: improvementRequests.resolvedBy,
      resolvedByName: resolvedUser.displayName,
      resolvedAt: improvementRequests.resolvedAt,
      updatedAt: improvementRequests.updatedAt,
      version: improvementRequests.version,
    })
    .from(improvementRequests)
    .leftJoin(author, eq(author.id, improvementRequests.createdBy))
    .leftJoin(inProgressUser, eq(inProgressUser.id, improvementRequests.inProgressBy))
    .leftJoin(resolvedUser, eq(resolvedUser.id, improvementRequests.resolvedBy))
    .where(eq(improvementRequests.isDeleted, false))
    .orderBy(desc(improvementRequests.createdAt), desc(improvementRequests.id));

  // 스크린샷은 한 번에 읽어 글 id 로 묶는다 — 줄마다 질의하면 글이 서른 건일 때
  // 질의가 서른한 번이 된다(N+1). 조인으로 한 번에 읽지 않는 것은, 글 한 줄이
  // 첨부 수만큼 복제되어 본문(최대 2000자)이 다섯 번 실려 오기 때문이다.
  const screenshotsByRequest = await listScreenshotsByRequestIds(rows.map((row) => row.id));

  return rows.map(({ authorAccountName, importedAuthorName, ...row }) => ({
    ...row,
    // 계정이 있으면 **지금의** 이름을 쓴다(이름이 바뀌면 목록도 따라간다).
    // 계정이 없는 것은 옮겨 온 글뿐이고, 그때만 옮길 때 적어 둔 이름을 쓴다.
    createdByName: authorAccountName ?? importedAuthorName,
    createdAt: row.createdAt.toISOString(),
    inProgressAt: toIsoOrNull(row.inProgressAt),
    resolvedAt: toIsoOrNull(row.resolvedAt),
    updatedAt: row.updatedAt.toISOString(),
    screenshots: screenshotsByRequest.get(row.id) ?? [],
  }));
}
