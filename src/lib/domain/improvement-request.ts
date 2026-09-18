import {
  isMenuKeyOf,
  isServiceKey,
  listMenusOf,
  listServices,
  menuLabel,
  NO_MENU_LABEL,
  serviceLabel,
  UNKNOWN_MENU_LABEL,
  UNKNOWN_SERVICE_LABEL,
} from "./service-catalog";

/**
 * ============================================================================
 * 개선요청 — 순수 규칙 (상태 옮기기 · 누가 무엇을)
 * ============================================================================
 * DB 도 서버도 next 도 여기서 만지지 않는다. 화면·서버 액션·저장(mutation)이
 * **같은 함수**를 보게 하려고 따로 뺀 자리다 — 규칙을 두 곳에 적으면 화면은 단추를
 * 열어 주는데 저장이 거절하거나, 반대로 화면만 막고 저장은 열려 있는 상태가 된다.
 *
 * 표 구조와 설계의 이유는 db/schema.ts 의 improvement_requests 머리말에 있다.
 * 서비스·메뉴 목록은 domain/service-catalog.ts 다.
 *
 * ── 🔴 상태 칸 규칙은 DB CHECK 와 같다 ──────────────────────────────────
 * planImprovementRequestStatusChange 가 돌려주는 네 칸은 스키마의
 * `improvement_requests_status_columns` · `improvement_requests_actor_pairs`
 * CHECK 를 언제나 지킨다. 여기를 고치면 그 CHECK 도 함께 고칠 것(마이그레이션이
 * 필요하다).
 *
 * ── 권한의 「역할 부분」은 여기서 계산하지 않는다 ──────────────────────
 * 「관리 권한이 있는가」는 역할을 보는 질문이라 auth/improvement-request-
 * authorization.ts 가 답한다. 이 파일은 그 답을 **인자(`canManage`)로 받아** 글 한
 * 건에 대해서만 판정한다. A/S 시스템의 같은 이름 파일과 같은 나눔이다.
 * ============================================================================
 */

/**
 * 🔴 값 목록은 db/schema.ts 의 `improvementRequestStatusEnum` 과 **글자 그대로
 * 같아야 한다**(스키마가 도메인을 가져오지 않는다 — drizzle-kit 이 스키마 파일을
 * 따로 읽기 때문이다). 갈라지지 않도록 시험이 둘을 맞춰 본다.
 */
export const IMPROVEMENT_REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

export type ImprovementRequestStatus = (typeof IMPROVEMENT_REQUEST_STATUSES)[number];

export const IMPROVEMENT_REQUEST_STATUS_LABELS: Record<ImprovementRequestStatus, string> = {
  OPEN: "접수",
  IN_PROGRESS: "진행중",
  RESOLVED: "해결",
};

export function isImprovementRequestStatus(value: unknown): value is ImprovementRequestStatus {
  return (
    typeof value === "string" &&
    (IMPROVEMENT_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * 본문 상한(글자 = 코드 포인트).
 *
 * 🔴 db/schema.ts 의 `improvement_requests_body_length` CHECK 와 **같은 수**여야
 * 한다 — 시험이 스키마 파일의 글자를 읽어 대조한다. 한쪽만 고치면 화면은 저장을
 * 시도하고 DB 는 23514 로 거절해, 사람에게는 이유 없는 실패만 남는다.
 */
export const IMPROVEMENT_REQUEST_BODY_MAX_CHARS = 2000;

/**
 * 본문 글자 수. Postgres 의 char_length 와 같게 **코드 포인트**로 센다 —
 * `string.length`(UTF-16 단위)로 세면 이모지 하나가 둘로 세어져, 검증은 거절하는데
 * DB 는 받는 값(또는 그 반대)이 생긴다.
 */
export function countImprovementRequestBodyChars(text: string): number {
  return Array.from(text).length;
}

/* ------------------------------------------------------------------ */
/* 상태 옮기기                                                          */
/* ------------------------------------------------------------------ */

/** 상태에 딸린 네 칸 — 누가 언제 진행중으로, 누가 언제 해결로 옮겼는가. */
export type ImprovementRequestProgressFields = {
  inProgressBy: string | null;
  inProgressAt: Date | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
};

export type ImprovementRequestStatusChangePlan =
  /** 같은 상태로의 변경. 저장하지 않는다. */
  | { kind: "unchanged" }
  | {
      kind: "changed";
      status: ImprovementRequestStatus;
      /** 저장할 네 칸 전부. 부분이 아니다 — 그대로 SET 에 넣으면 된다. */
      fields: ImprovementRequestProgressFields;
    };

/**
 * 상태를 `from` 에서 `to` 로 옮길 때 네 칸을 어떻게 채우고 비울지 계산한다.
 *
 * 상태는 셋이고(접수 → 진행중 → 해결) **어느 방향으로든** 바뀐다 — 되돌리기도,
 * 접수에서 곧바로 해결도 된다. 순서를 강제하는 전이표를 두지 않는 것은 A/S 시스템의
 * 같은 기능에서 승인된 설계를 그대로 따른 것이다: 글 한 줄의 진행 표시라 잘못
 * 눌렀으면 되돌리면 된다.
 *
 *  · 접수(OPEN)로 가면 네 칸을 **모두 비운다** — 되돌린 글은 처음 접수된 글과
 *    구별되지 않는다.
 *  · 진행중(IN_PROGRESS)으로 가면 in_progress 쌍 = (행위자, 지금), resolved 쌍은
 *    비운다. 해결에서 되돌려 와도 in_progress 쌍은 **지금 옮긴 사람으로 새로**
 *    적힌다 — 이 칸은 「지금 이 글을 맡은 사람」이다.
 *  · 해결(RESOLVED)로 가면 resolved 쌍 = (행위자, 지금), in_progress 쌍은 **그대로
 *    둔다** — 진행중을 거쳐 왔으면 그 기록이 남고, 접수에서 곧바로 왔으면 비어
 *    있는 채다. 「누가 맡아서 했는가」는 해결 뒤에 오히려 가장 궁금한 값이다.
 *  · 같은 상태로의 변경은 `unchanged` 다. 진행중을 다시 진행중으로 눌렀다고 맡은
 *    사람이 바뀌지 않는다.
 *
 * 「지금」은 인자로 받는다 — 시험이 시계에 매이지 않게, 그리고 저장이 한 트랜잭션
 * 안에서 updated_at 과 같은 시각을 쓰게.
 */
export function planImprovementRequestStatusChange(input: {
  from: ImprovementRequestStatus;
  to: ImprovementRequestStatus;
  current: ImprovementRequestProgressFields;
  actorUserId: string;
  now: Date;
}): ImprovementRequestStatusChangePlan {
  const { from, to, current, actorUserId, now } = input;
  if (from === to) return { kind: "unchanged" };

  switch (to) {
    case "OPEN":
      return {
        kind: "changed",
        status: to,
        fields: { inProgressBy: null, inProgressAt: null, resolvedBy: null, resolvedAt: null },
      };
    case "IN_PROGRESS":
      return {
        kind: "changed",
        status: to,
        fields: {
          inProgressBy: actorUserId,
          inProgressAt: now,
          resolvedBy: null,
          resolvedAt: null,
        },
      };
    case "RESOLVED":
      return {
        kind: "changed",
        status: to,
        fields: {
          inProgressBy: current.inProgressBy,
          inProgressAt: current.inProgressAt,
          resolvedBy: actorUserId,
          resolvedAt: now,
        },
      };
  }
}

/* ------------------------------------------------------------------ */
/* 낙관적 잠금 — 잠근 행을 보고 무엇을 할지 정한다                       */
/* ------------------------------------------------------------------ */

export type ImprovementRequestWriteGate =
  /** 그런 글이 없거나 이미 지워졌다. */
  | { kind: "not-found" }
  /** 그 사이 누가 먼저 바꿨다. **한 글자도 바꾸지 않고** 돌아간다. */
  | { kind: "conflict" }
  | { kind: "proceed" };

/**
 * 🔴 **낙관적 잠금이 동시 수정을 막는 자리다.**
 *
 * 저장(mutation)이 행을 잠그고 읽은 직후 이 함수를 부른다. 순서가 곧 규칙이다.
 *
 *  1. 행이 없으면 — 없다.
 *  2. 이미 지워진 글이면 — 없다(소프트 삭제라 행은 남아 있지만, 쓰는 쪽에는
 *     없는 것과 같다. 지워진 글의 상태를 옮기게 두면 목록에 없는 글이 조용히
 *     움직인다).
 *  3. 화면이 들고 있던 version 과 지금 version 이 다르면 — 충돌이다. 화면이
 *     읽은 뒤 누가 먼저 바꿨다는 뜻이고, 그대로 저장하면 **앞사람의 변경을
 *     말없이 덮는다.** 되돌릴 방법이 없으므로 거절하고 다시 불러오게 한다.
 *
 * 저장을 하지 않고 이 판정만 따로 뺀 이유: 이 규칙이 DB 없이 시험할 수 있는
 * 종류의 규칙이기 때문이다. 트랜잭션 안에 파묻어 두면 「충돌이면 아무것도
 * 바꾸지 않는다」를 확인하는 데 매번 DB 가 필요해진다.
 *
 * 🔴 이것만으로 끝이 아니다. 저장은 UPDATE 의 WHERE 에 version 을 **한 번 더**
 * 적는다 — 이 함수는 「잠그고 읽었다」는 전제 위에서만 옳고, 그 전제가 깨진 길이
 * 생겨도 앞사람의 변경을 덮지 않게 하려고(mutations 머리말).
 */
export function decideImprovementRequestWrite(input: {
  row: { version: number; isDeleted: boolean } | undefined;
  expectedVersion: number;
}): ImprovementRequestWriteGate {
  if (!input.row || input.row.isDeleted) return { kind: "not-found" };
  if (input.row.version !== input.expectedVersion) return { kind: "conflict" };
  return { kind: "proceed" };
}

/* ------------------------------------------------------------------ */
/* 누가 무엇을 — 글 한 건에 대한 판정                                    */
/* ------------------------------------------------------------------ */

/**
 * 이 사람이 이 글의 **상태를** 옮길 수 있는가.
 *
 * 지금은 관리 권한 하나만 본다. 그래도 글의 값을 받는 모양으로 두는 이유:
 * 「이관해 온 글은 못 옮긴다」 같은 규칙이 붙을 자리가 여기이고, 그때 부르는
 * 쪽(화면·저장)을 고치지 않아도 된다.
 */
export function canChangeImprovementRequestStatus(input: { canManage: boolean }): boolean {
  return input.canManage;
}

/**
 * 이 사람이 이 글의 **내용을** 고칠 수 있는가 — 접수 상태인 자기 글일 때만.
 *
 * 관리 권한이 있어도 남의 글 내용은 못 고친다. 글은 적은 사람의 말이고, 관리자가
 * 고치면 「누가 무엇을 요청했는가」가 흐려진다. 진행중·해결이 되면 작성자도 못
 * 고친다 — 맡은 사람이 읽고 움직이기 시작한 글이 발밑에서 바뀌면 안 된다.
 *
 * 🔴 이번 조각에는 **고치기 화면이 없다**(README 의 다음 할 일: 목록 · 작성 · 상태
 * 옮기기). 그래도 지금 두는 이유는 상태 규칙과 짝인 판정이라 나중에 급히 만들 때
 * 화면 안에 손으로 조건을 적는 일이 실제로 일어나서다. 부를 자리가 먼저 있으면 그
 * 일이 덜 일어난다.
 *
 * `createdBy` 가 null 인 글(옮겨 온 글 — schema.ts 의 '이관해 온 글의 자리')은
 * 아무도 고칠 수 없다. 이을 계정이 없다는 뜻이라 「자기 글」이 성립하지 않는다.
 */
export function canEditImprovementRequestBody(input: {
  status: ImprovementRequestStatus;
  createdBy: string | null;
  actorUserId: string;
}): boolean {
  if (input.createdBy === null) return false;
  return input.status === "OPEN" && input.createdBy === input.actorUserId;
}

/* ------------------------------------------------------------------ */
/* 지우기 — 「자기 글 + 관리자는 전부」                                  */
/* ------------------------------------------------------------------ */

export const IMPROVEMENT_REQUEST_DELETE_FORBIDDEN_MESSAGE =
  "자기가 적은 글만 지울 수 있습니다.";

/**
 * 이 사람이 이 글을 지울 수 있는가 — **적은 사람 자신, 또는 관리자**
 * (2026-09-17 사용자 결정).
 *
 * 내용 고치기(canEditImprovementRequestBody)와 달리 **상태를 보지 않는다.** 잘못
 * 적었거나 같은 글을 두 번 적은 것은 진행중이 된 뒤에 깨닫는 일이 더 많고, 그때
 * 「못 지운다」로 두면 목록에 쓰레기가 남는다. 관리자에게 남의 글도 여는 것은
 * 그 정리를 할 수 있는 자리가 하나는 있어야 하기 때문이다.
 *
 * 지우기는 소프트 삭제다(db/schema.ts 의 지우기 절) — 행은 남고 읽는 쪽이 거른다.
 *
 * 🔴 `canManage` 는 **살아 있는 계정의 역할**에서 와야 한다. 화면이 넘긴 값이나
 * 요청 본문의 값을 넣으면 이 판정이 무의미해진다
 * (server/actions/improvement-requests.ts 머리말).
 *
 * `createdBy` 가 null 인 글(옮겨 온 글)은 「자기 글」이 성립하지 않아 관리자만
 * 지울 수 있다.
 */
export function canDeleteImprovementRequest(input: {
  createdBy: string | null;
  actorUserId: string;
  canManage: boolean;
}): boolean {
  if (input.canManage) return true;
  if (input.createdBy === null) return false;
  return input.createdBy === input.actorUserId;
}

/* ------------------------------------------------------------------ */
/* 스크린샷                                                             */
/* ------------------------------------------------------------------ */

/**
 * 한 글에 붙일 수 있는 스크린샷의 수.
 *
 * 🔴 이 수를 세는 곳은 **글 행을 잠근 트랜잭션 안**이다
 * (db/mutations/improvement-request-attachments.ts). 잠그지 않고 세면 두 창에서
 * 동시에 올린 두 장이 **둘 다** 「네 장뿐」을 보고 들어가 여섯 장이 된다. 화면과
 * 올리기 통로 앞머리에서도 세지만 그 둘은 빠른 거절일 뿐이다.
 *
 * 「살아 있는 첨부」(지워지지 않은 것)만 센다 — 지운 장은 자리를 비켜 준다.
 */
export const IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT = 5;

export const IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE = `스크린샷은 한 글에 ${IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT}장까지 붙일 수 있습니다.`;

export const IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE =
  "자기가 적은 글에만 스크린샷을 붙이거나 뗄 수 있습니다.";

/**
 * 이 사람이 이 글의 스크린샷을 붙이거나 뗄 수 있는가 — 지우기와 **같은 규칙**이다
 * (지시서 ④: 「첨부 지우기도 같은 규칙이다」).
 *
 * 글 내용 고치기와 다른 점은 관리 권한이 남의 글에도 열린다는 것 — 스크린샷은
 * 글쓴이의 말이 아니라 증거 자료라, 맡은 사람이 재현 화면을 붙이거나 잘못 붙은
 * 것을 떼는 일이 있어야 한다.
 */
export function canChangeImprovementRequestScreenshots(input: {
  createdBy: string | null;
  actorUserId: string;
  canManage: boolean;
}): boolean {
  return canDeleteImprovementRequest(input);
}

/** 한 장을 더 붙일 자리가 있는가. `liveCount` 는 지금 살아 있는 첨부 수다. */
export function hasImprovementRequestScreenshotRoom(liveCount: number): boolean {
  return liveCount < IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT;
}

/** 앞으로 몇 장을 더 붙일 수 있는가. 음수가 되지 않는다. */
export function improvementRequestScreenshotRoomLeft(liveCount: number): number {
  return Math.max(0, IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT - liveCount);
}

/* ------------------------------------------------------------------ */
/* 목록 차례 · 해결된 것 감추기                                          */
/* ------------------------------------------------------------------ */

/**
 * 목록에 놓는 상태의 차례 — 진행중 → 접수 → 해결.
 *
 * 진행중이 맨 위인 것은 「지금 누가 무엇을 하고 있는가」가 이 화면에서 가장 먼저
 * 궁금한 것이라서다. 접수는 그다음 — 아직 아무도 맡지 않은 글이 거기 쌓인다.
 * 해결은 끝난 일이라 맨 아래이고, 화면은 기본으로 감춘다.
 */
export const IMPROVEMENT_REQUEST_LIST_STATUS_ORDER: readonly ImprovementRequestStatus[] = [
  "IN_PROGRESS",
  "OPEN",
  "RESOLVED",
];

/** 차례를 정하는 데 필요한 칸만. 조회 결과가 그대로 맞는다. */
export type ImprovementRequestListEntry = {
  id: string;
  status: ImprovementRequestStatus;
  /** ISO 문자열 — 서버가 클라이언트로 넘기는 모양 그대로다. */
  createdAt: string;
};

export type ArrangedImprovementRequestList<T> = {
  /** 화면에 그릴 줄, 그릴 차례대로. */
  rows: T[];
  /** 해결된 글 전부의 수 — 감췄든 안 감췄든. */
  resolvedCount: number;
  /** 이번에 감춘 해결 글의 수. 「해결된 것도 보기」가 켜져 있으면 0 이다. */
  hiddenResolvedCount: number;
};

/**
 * 목록을 화면에 놓을 차례로 세우고, 해결된 글을 감출지 정한다.
 *
 *  · 상태는 IMPROVEMENT_REQUEST_LIST_STATUS_ORDER 차례다.
 *  · 같은 상태 안에서는 **최근에 적힌 글부터**(createdAt 내림차순). 상태를 옮긴
 *    시각이 아니라 적힌 시각이다 — 누가 상태를 누를 때마다 줄이 뛰면 읽던 자리를
 *    잃는다.
 *  · 같은 시각이면 id 내림차순 — 조회(listImprovementRequests)의 동점 규칙과 같아,
 *    새로 고칠 때마다 두 줄이 자리를 바꾸지 않는다.
 *
 * 받은 배열은 건드리지 않는다(새 배열을 돌려준다) — 서버가 넘긴 props 다.
 */
export function arrangeImprovementRequestList<T extends ImprovementRequestListEntry>(
  items: readonly T[],
  options: { showResolved: boolean },
): ArrangedImprovementRequestList<T> {
  const rank = (status: ImprovementRequestStatus) =>
    IMPROVEMENT_REQUEST_LIST_STATUS_ORDER.indexOf(status);
  const sorted = [...items].sort((a, b) => {
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });

  const resolvedCount = sorted.filter((item) => item.status === "RESOLVED").length;
  if (options.showResolved) {
    return { rows: sorted, resolvedCount, hiddenResolvedCount: 0 };
  }
  return {
    rows: sorted.filter((item) => item.status !== "RESOLVED"),
    resolvedCount,
    hiddenResolvedCount: resolvedCount,
  };
}

/* ------------------------------------------------------------------ */
/* 복사                                                                 */
/* ------------------------------------------------------------------ */

/**
 * [복사] 단추가 클립보드에 넣는 글 — 「[개선요청 : 서비스 · 메뉴] 본문」.
 *
 * A/S 시스템의 같은 단추는 「[개선요청 메뉴 : 내자 정리] 본문」이었다. 이 사이트는
 * 회사 전체를 받으므로 메뉴 이름만으로는 어느 시스템 이야기인지 알 수 없다 —
 * 그래서 서비스를 앞에 붙인다. 메뉴를 고르지 않은 글은 「메뉴 지정 안 함」이
 * 그대로 붙는다(menuLabel 이 답한다). 본문은 줄바꿈까지 그대로 잇는다.
 *
 * 🔴 복사되는 글은 누른 사람의 클립보드로만 간다 — 보는 권한만 있어도 쓴다(이미
 * 화면에 보이는 글이다).
 */
export function improvementRequestCopyText(item: {
  serviceKey: string;
  menuKey: string | null;
  body: string;
}): string {
  return `[개선요청 : ${serviceLabel(item.serviceKey)} · ${menuLabel(item.serviceKey, item.menuKey)}] ${item.body}`;
}

/* ------------------------------------------------------------------ */
/* 거르기 — 서비스와 메뉴 둘 다                                          */
/* ------------------------------------------------------------------ */

/*
 * 목록 위 선택칸의 값. 서비스·메뉴 열쇠 그대로이거나 아래 셋 중 하나다.
 *
 * 🔴 셋 다 어떤 열쇠와도 겹치지 않아야 한다(시험이 단언한다) — 서비스 열쇠는
 * 포털 clientId 이고 메뉴 열쇠는 영문 낱말이라 「@」로 시작하지 않는다.
 *
 * 목록에서 사라진 열쇠(「(없어진 메뉴)」·「(없어진 서비스)」)는 여럿이어도
 * **한 칸**으로 모은다 — 화면에서는 모두 같은 글자로 보여, 따로 세우면 이름이
 * 같은 칸이 여럿 생긴다.
 */
export const IMPROVEMENT_REQUEST_FILTER_ALL = "@all";
export const IMPROVEMENT_REQUEST_FILTER_NO_MENU = "@none";
export const IMPROVEMENT_REQUEST_FILTER_UNKNOWN = "@unknown";
export const IMPROVEMENT_REQUEST_ALL_SERVICES_LABEL = "전체 시스템";
export const IMPROVEMENT_REQUEST_ALL_MENUS_LABEL = "전체 메뉴";

/** 거르개가 다루는 칸만. 조회 결과가 그대로 맞는다. */
export type ImprovementRequestFilterEntry = {
  serviceKey: string;
  menuKey: string | null;
  status: ImprovementRequestStatus;
};

export type ImprovementRequestFilterOption = {
  value: string;
  label: string;
  /** 이 칸을 고르면 목록에 보일 글의 수(아래 주석의 '건수는 지금 보이는 것만'). */
  count: number;
  /**
   * 메뉴 거르개에서만 채운다 — 적기·고치기 폼과 **같은 단**으로 보이게 하려고
   * 그 메뉴의 대메뉴 여부(`isGroup`)와 소속(`groupKey`)을 그대로 실어 나른다
   * (service-catalog.ts 의 menuOptionText).
   *
   * 🔴 `label` 에 들여쓰기를 미리 섞지 않는다. 이 이름표는 선택칸 말고 다른
   * 곳에서도 읽히고(시험이 글자로 대조한다), 그리는 일은 화면의 몫이다.
   *
   * 「전체 메뉴」·「메뉴 지정 안 함」·「(없어진 메뉴)」는 어느 구획에도 안 든다 —
   * 그 셋은 메뉴가 아니라 거르개가 만든 칸이다.
   */
  isGroup?: true;
  groupKey?: string;
};

/** 글 하나가 서비스 거르개의 어느 칸에 들어가는가. */
export function improvementRequestServiceFilterValue(serviceKey: string): string {
  return isServiceKey(serviceKey) ? serviceKey : IMPROVEMENT_REQUEST_FILTER_UNKNOWN;
}

/** 글 하나가 메뉴 거르개의 어느 칸에 들어가는가. 서비스와 **짝으로** 본다. */
export function improvementRequestMenuFilterValue(
  serviceKey: string,
  menuKey: string | null,
): string {
  if (menuKey === null) return IMPROVEMENT_REQUEST_FILTER_NO_MENU;
  return isMenuKeyOf(serviceKey, menuKey) ? menuKey : IMPROVEMENT_REQUEST_FILTER_UNKNOWN;
}

/**
 * 고른 칸의 글만 남긴다. 「전체」면 모두.
 *
 * 🔴 **메뉴는 서비스를 고른 뒤에만 거른다.** 메뉴 열쇠는 그 서비스 안에서만
 * 유일하기 때문이다(service-catalog.ts 의 ServiceMenu.key 주석) — A/S 의 `users` 와
 * 포털의 `adminUsers` 처럼 겹치는 이름이 실제로 있다. 서비스가 「전체」인데 메뉴만
 * 고르면 엉뚱한 시스템의 글이 함께 걸린다. 그래서 화면은 서비스를 고르기 전까지
 * 메뉴 칸을 비활성으로 두고, 이 함수도 그때는 메뉴를 보지 않는다.
 *
 * 차례는 그대로 두고(차례는 arrangeImprovementRequestList 가 정한다), 받은 배열은
 * 건드리지 않는다.
 */
export function filterImprovementRequests<T extends { serviceKey: string; menuKey: string | null }>(
  items: readonly T[],
  filters: { serviceFilter: string; menuFilter: string },
): T[] {
  const { serviceFilter, menuFilter } = filters;
  if (serviceFilter === IMPROVEMENT_REQUEST_FILTER_ALL) return [...items];
  const byService = items.filter(
    (item) => improvementRequestServiceFilterValue(item.serviceKey) === serviceFilter,
  );
  if (menuFilter === IMPROVEMENT_REQUEST_FILTER_ALL) return byService;
  return byService.filter(
    (item) => improvementRequestMenuFilterValue(item.serviceKey, item.menuKey) === menuFilter,
  );
}

/*
 * ── 건수는 지금 보이는 것만 센다 ────────────────────────────────────────
 * 「해결된 것도 보기」가 꺼져 있으면 해결된 글은 세지 않는다(켜져 있으면 센다).
 * 칸 옆의 숫자는 「이것을 고르면 몇 줄이 보이는가」라서다 — 전체로 세면 「(5)」를
 * 골랐는데 세 줄만 보이는 일이 생긴다.
 *
 * 단 **지금 고른 칸(`selected`)은 0건이어도 남긴다** — 해결된 것을 감추거나 마지막
 * 글을 지운 순간 고른 칸이 선택칸에서 사라지면, 선택칸은 다른 칸을 보이는데 목록은
 * 옛 칸으로 걸러진 채가 된다.
 */

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * 서비스 거르개의 칸들 — 맨 앞에 「전체 시스템」, 그다음 **글이 있는 서비스만**
 * 적어 둔 차례대로, 맨 끝에 「(없어진 서비스)」(그런 글이 있을 때만).
 */
export function listImprovementRequestServiceFilterOptions(
  items: readonly ImprovementRequestFilterEntry[],
  options: { showResolved: boolean; selected: string },
): ImprovementRequestFilterOption[] {
  const counted = options.showResolved ? items : items.filter((item) => item.status !== "RESOLVED");
  const counts = countBy(counted, (item) => improvementRequestServiceFilterValue(item.serviceKey));

  const candidates = [
    ...listServices().map((service) => ({ value: service.key, label: service.label })),
    { value: IMPROVEMENT_REQUEST_FILTER_UNKNOWN, label: UNKNOWN_SERVICE_LABEL },
  ];

  return [
    {
      value: IMPROVEMENT_REQUEST_FILTER_ALL,
      label: IMPROVEMENT_REQUEST_ALL_SERVICES_LABEL,
      count: counted.length,
    },
    ...candidates
      .filter((candidate) => counts.has(candidate.value) || candidate.value === options.selected)
      .map((candidate) => ({ ...candidate, count: counts.get(candidate.value) ?? 0 })),
  ];
}

/**
 * 메뉴 거르개의 칸들 — 고른 서비스 **안에서만**. 서비스가 「전체」면 「전체 메뉴」
 * 한 칸뿐이다(위 filterImprovementRequests 주석의 '메뉴는 서비스를 고른 뒤에만').
 *
 * 맨 앞에 「전체 메뉴」, 그다음 그 서비스의 메뉴 가운데 **글이 있는 것만** 적어 둔
 * 차례대로, 그다음 「메뉴 지정 안 함」·「(없어진 메뉴)」(그런 글이 있을 때만).
 */
export function listImprovementRequestMenuFilterOptions(
  items: readonly ImprovementRequestFilterEntry[],
  options: { serviceFilter: string; showResolved: boolean; selected: string },
): ImprovementRequestFilterOption[] {
  const visible = options.showResolved
    ? items
    : items.filter((item) => item.status !== "RESOLVED");
  const all: ImprovementRequestFilterOption = {
    value: IMPROVEMENT_REQUEST_FILTER_ALL,
    label: IMPROVEMENT_REQUEST_ALL_MENUS_LABEL,
    count: visible.length,
  };
  // 시스템이 「전체」면 고를 메뉴가 없다. 그래도 수는 지금 보이는 것으로 적는다 —
  // 비활성인 칸에 「(0)」이 떠 있으면 「글이 없다」로 잘못 읽힌다.
  if (options.serviceFilter === IMPROVEMENT_REQUEST_FILTER_ALL) return [all];

  const counted = visible
    .filter((item) => improvementRequestServiceFilterValue(item.serviceKey) === options.serviceFilter);
  const counts = countBy(counted, (item) =>
    improvementRequestMenuFilterValue(item.serviceKey, item.menuKey),
  );

  // 🔴 대메뉴도 그냥 한 칸이다(service-catalog.ts 의 ServiceMenu.isGroup). 대메뉴로
  // 적은 글은 **그 칸에서만** 세어진다 — 대메뉴를 고르면 그 아래 소메뉴의 글까지
  // 함께 나오는 것이 아니다. 그 동작이 필요해지면 사람이 정할 일이라 여기서
  // 지어내지 않는다.
  const candidates: Omit<ImprovementRequestFilterOption, "count">[] = [
    ...listMenusOf(options.serviceFilter).map((menu) => ({
      value: menu.key,
      label: menu.label,
      ...(menu.isGroup ? { isGroup: menu.isGroup } : {}),
      ...(menu.groupKey ? { groupKey: menu.groupKey } : {}),
    })),
    { value: IMPROVEMENT_REQUEST_FILTER_NO_MENU, label: NO_MENU_LABEL },
    { value: IMPROVEMENT_REQUEST_FILTER_UNKNOWN, label: UNKNOWN_MENU_LABEL },
  ];

  return [
    { ...all, count: counted.length },
    ...candidates
      .filter((candidate) => counts.has(candidate.value) || candidate.value === options.selected)
      .map((candidate) => ({ ...candidate, count: counts.get(candidate.value) ?? 0 })),
  ];
}
