import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * ============================================================================
 * DSS 개선요청 — 표
 * ============================================================================
 *
 * 표는 둘이다.
 *   · `web_users`            — 이 사이트의 이용자 (1차, 로그인)
 *   · `improvement_requests` — 개선요청 글 한 줄 (2차, 이 파일 아래쪽)
 *
 * DB 에는 영문 코드를 저장하고, 화면에 보일 한국어 글자는 화면 쪽에서 붙인다.
 *
 * 🔴 이 파일은 **아무것도 import 하지 않는다**(drizzle-orm 말고는). drizzle-kit
 *    이 스키마 파일을 Next 밖에서 따로 읽으므로 `@/` 경로가 풀리지 않고, 도메인
 *    층을 가져오면 거기서 다시 딸려 오는 것들까지 끌고 온다. 그래서 상태 값이나
 *    글자 수 같은 상수가 도메인과 여기에 **두 번** 적혀 있다 — 갈라지지 않는지는
 *    시험이 이 파일의 글자를 읽어 대조한다.
 */

/* ------------------------------------------------------------------ */
/* 코드값                                                               */
/* ------------------------------------------------------------------ */

/**
 * 이 사이트에서의 역할.
 *
 * 포털이 ID 토큰의 `role` 클레임으로 지정한다. 여기 없는 값이 오면 로그인을
 * 거절한다(sso-login.ts 의 decideRole 주석에 이유가 있다).
 *
 * 둘로 시작하는 이유: 개선요청은 **누구나 적는 글**이라 쓰기 권한을 나눌 일이
 * 없다. 나뉘는 것은 「내가 적은 글」과 「남의 글의 상태를 옮기는 일」뿐이다.
 * 역할을 더 잘게 나누는 것은 필요해진 뒤에 한다 — 미리 나눠 두면 아무도
 * 쓰지 않는 값이 포털 드롭다운에 남는다.
 */
export const USER_ROLES = [
  "ADMIN", // 관리자 — 남의 글의 상태를 옮기고 정리한다
  "MEMBER", // 일반 — 글을 적고, 자기 글을 고친다
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/* ------------------------------------------------------------------ */
/* 공통 칸                                                              */
/* ------------------------------------------------------------------ */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * 소프트 삭제 4칼럼 — 이름과 개수가 고정이다.
 * 이웃 저장소 셋이 같은 이름을 쓴다(RF_Service_System/DATABASE_DESIGN.md #8).
 * 사람을 물리 삭제하지 않는 이유는 간단하다 — 글을 적은 사람이 사라지면
 * 「누가 적었는가」가 끊긴다.
 */
const softDelete = {
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  deleteReason: text("delete_reason"),
};

/* ------------------------------------------------------------------ */
/* web_users — 이 사이트의 이용자                                       */
/*                                                                      */
/* dss-auth 의 users 표와는 **별개**다. auth_sub 하나로만 이어진다 —      */
/* 이름이 바뀌어도, 이메일이 바뀌어도, 사람은 같은 사람이다.             */
/*                                                                      */
/* 포털의 표를 직접 읽지 않는 이유: 그러면 이 사이트가 포털 DB 에 붙어야   */
/* 하고, 그 순간 "포털은 누구인가만 답한다"는 경계가 무너진다. 포털 DB 는  */
/* 서명 개인키·클라이언트 시크릿 해시를 담아 보안 등급이 다르다.           */
/* ------------------------------------------------------------------ */

export const webUsers = pgTable(
  "web_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * dss-auth ID 토큰의 sub (= dss-auth users.id). 사람의 영구 식별자.
     *
     * 이메일로 잇지 않는 이유: 포털의 이메일은 포털 관리자가 손으로 적는
     * 값이고 카카오 계정의 이메일은 바뀔 수 있다. 바뀌는 값으로 사람을
     * 이으면 언젠가 남의 계정이 된다.
     */
    authSub: uuid("auth_sub").notNull(),

    /** 화면 표시용. 로그인할 때마다 최신값으로 갱신한다. */
    displayName: text("display_name").notNull(),

    /** 화면 표시용. 카카오에서 이메일은 선택 동의라 없을 수 있다. */
    email: text("email"),

    role: text("role", { enum: USER_ROLES }).notNull().default("MEMBER"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    /**
     * 이 시각보다 **먼저 발급된 세션은 전부 무효**다.
     *
     * 이 사이트의 세션은 서버에 저장되지 않는다 — 서명된 토큰이라 발급된
     * 뒤에는 스스로 유효하다. 그래서 "저 세션 하나만 끊어라" 라고 할 때
     * 지목할 대상이 없다. 대신 이 선을 지금으로 올리면, 그보다 먼저 나간
     * 토큰이 한꺼번에 무효가 된다.
     *
     * 포털이 로그아웃이나 정지를 알려올 때 now() 로 올린다
     * (api/auth/sso/backchannel-logout → auth/session.ts 의
     * revokeSessionsForSubject). null 은 한 번도 끊긴 적이 없다는 뜻이고,
     * 그때는 아무것도 무효가 되지 않는다.
     *
     * 이것은 그 사람의 세션을 **전부** 끊는다, 하나가 아니라. 회수 목록을
     * 따로 두면 정확하지만 계속 자라는 표와 그것을 쓸어 담는 일이 함께
     * 딸려 온다 — 공용 PC 에서 "나 나간다" 는 대개 정말로 전부를 뜻한다.
     *
     * (A/S 시스템 users.sessions_valid_from 과 같은 칸·같은 뜻이다.)
     */
    sessionsValidFrom: timestamp("sessions_valid_from", { withTimezone: true }),

    ...timestamps,
    ...softDelete,
  },
  (t) => [
    // 조건 없는 유일 색인이다 — 삭제된 행도 자리를 차지한다. 일부러 그렇게
    // 둔다: 내보낸 사람이 다시 로그인해 **새 계정으로 조용히** 돌아오는 것이
    // 색인 충돌보다 나쁘다. sso-login.ts 가 삭제된 행까지 함께 찾는 이유다.
    uniqueIndex("web_users_auth_sub_uq").on(t.authSub),
    index("web_users_alive_idx")
      .on(t.role)
      .where(sql`${t.isDeleted} = false`),
  ],
);

export type WebUser = typeof webUsers.$inferSelect;

/* ------------------------------------------------------------------ */
/* 세션 표는 없다 — 왜 없는지                                            */
/*                                                                      */
/* 처음에는 web_sessions 라는 **서버 저장형** 표가 여기 있었다. 쿠키에는  */
/* 랜덤 토큰 원문, DB 에는 그 sha256. 고른 이유는 하나였다 — 포털이 "이   */
/* 사람 끊어라" 라고 알려 왔을 때(백채널 로그아웃) 지목해 끊을 행이 있다. */
/*                                                                      */
/* 🔴 2026-09-17, 사용자 결정으로 **서명 토큰**으로 바꾼다. A/S 시스템    */
/*    (RF_Service_System/src/lib/auth/session.ts)과 같은 길로 맞춘다.    */
/*                                                                      */
/*    바꾼 이유:                                                         */
/*    · 같은 회사의 사이트 넷이 같은 포털에 붙는다. 세션을 다루는 방식이  */
/*      제각각이면, 로그인에 문제가 생겼을 때 사이트마다 다른 곳을 봐야   */
/*      한다. 한 곳에서 밟은 함정이 나머지에 옮겨지지도 않는다.          */
/*    · 서버 저장형의 값은 "즉시 끊기"인데, 그것은 서명 토큰도 위         */
/*      web_users.sessions_valid_from 한 칸으로 할 수 있다 — 표 하나와    */
/*      칸 하나의 차이다. A/S 가 이미 그렇게 쓰고 있고 실제로 끊긴다.     */
/*    · 매 요청 세션 표를 조회하지 않아도 된다. (다만 이 사이트는 정지·   */
/*      삭제·기준선을 보려고 어차피 web_users 한 행을 읽는다 —           */
/*      auth/session.ts 의 getSessionUser 주석에 그 이유가 있다.)        */
/*                                                                      */
/*    잃은 것도 적어 둔다: web_sessions 가 갖고 있던 ip · user_agent ·   */
/*    「지금 몇 곳에서 로그인해 있나」가 함께 없어졌다. 그 값이 필요해     */
/*    지면 세션 표를 되살릴 일이 아니라 접속 이력(감사 로그) 표를 따로     */
/*    만들 일이다 — 세션의 수명과 이력의 보관 기간은 서로 다르다.        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* improvement_requests — 개선요청 글 한 줄                             */
/* ------------------------------------------------------------------ */

/**
 * 🔴 값 목록은 domain/improvement-request.ts 의 IMPROVEMENT_REQUEST_STATUSES 와
 * **글자 그대로 같아야 한다**(이 파일 머리말의 '아무것도 import 하지 않는다').
 * 시험이 둘을 맞춰 본다.
 */
export const improvementRequestStatusEnum = pgEnum("improvement_request_status", [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
]);

/**
 * ────────────────────────────────────────────────────────────────────────
 * 개선요청 글 한 줄 (2026-09-17)
 * ────────────────────────────────────────────────────────────────────────
 * 전 직원이 적고, 전 직원이 본다(README 의 「정해진 것」). 상태를 옮기는 것은
 * 관리자다. 규칙은 전부 domain/improvement-request.ts 에 있고 — 여기는 그 규칙이
 * 깨진 행이 들어오지 못하게 막는 마지막 방어선이다.
 *
 * ── 🔴 서비스 + 그 서비스의 메뉴, 둘이다 ────────────────────────────────
 * A/S 시스템 안의 같은 기능은 `menu_key` 하나만 담는다 — 그 안의 일만 받으니까.
 * 이 사이트는 **회사 전체**를 받으므로 「어느 시스템의」가 먼저 있어야 한다.
 *
 *  · `service_key` — 필수. 어느 시스템 이야기인가.
 *  · `menu_key`    — **비울 수 있다.** 어느 화면인지 모를 수도 있고(「로그인이
 *                    가끔 풀려요」), 메뉴가 아예 없는 서비스도 있다
 *                    (「일하는 방식」). 기본값을 두지 않는 것도 그래서다 —
 *                    모르는 글에 아무 메뉴나 채워 넣으면 사실이 아닌 기록이 된다.
 *
 * 열쇠는 **이름이 아니다.** domain/service-catalog.ts 에 적어 둔 `key` 를 담는다 —
 * 메뉴 이름표가 바뀌어도 기록이 따라간다.
 *
 * ── 🔴 서비스·메뉴에 CHECK 도 참조 표도 두지 않는다 ─────────────────────
 * 두 값 모두 text 이고, 고를 수 있는 값은 코드에 적힌 목록
 * (domain/service-catalog.ts)이 정한다. 막는 곳은 검증
 * (validation/improvement-request-input.ts)이고, 저장(mutations)이 트랜잭션 전에
 * 같은 함수를 한 번 더 부른다.
 *
 *  · **CHECK 를 두면** 메뉴 한 줄을 더할 때마다 마이그레이션이 따라붙고, 메뉴
 *    하나를 뺄 때는 그 열쇠를 가진 옛 글 때문에 새 CHECK 를 걸 수조차 없다.
 *  · **참조 표(services · service_menus)를 두면** 목록을 고치는 일이 「코드 한 줄」
 *    에서 「마이그레이션 또는 운영 DB 손질」로 올라간다. 목록을 코드에 적어 두기로
 *    한 결정(사용자, 2026-09-17)이 무의미해진다.
 *  · 대가는 하나다 — 목록에서 사라진 열쇠를 가진 옛 글이 남는다. 화면이
 *    「(없어진 메뉴)」·「(없어진 서비스)」로 읽는다(service-catalog.ts).
 *
 * ── 상태는 셋이다 ───────────────────────────────────────────────────────
 * 접수(OPEN) → 진행중(IN_PROGRESS) → 해결(RESOLVED). 어느 방향으로든 바뀐다
 * (되돌리기 포함). 순서를 강제하는 전이표를 두지 않는 것은 A/S 시스템에서 승인된
 * 설계를 그대로 따른 것이다 — 근거는 domain 의 planImprovementRequestStatusChange.
 *
 * ── 🔴 상태와 네 칸은 같은 말이어야 한다 ────────────────────────────────
 * in_progress_by/at · resolved_by/at 는 **누가 언제 그 상태로 옮겼는가**다. 아래
 * CHECK 가 지키는 규칙은 도메인의 planImprovementRequestStatusChange 가 계산하는
 * 규칙과 같다. 한쪽만 고치면 화면은 저장을 시도하고 DB 는 23514 로 거절해, 사람에게는
 * 이유 없는 실패만 남는다.
 *
 * ── version 은 처음부터 둔다 ────────────────────────────────────────────
 * 작성자가 글을 들여다보는 동안 관리자가 상태를 옮기는 일이 실제로 일어난다. 그때
 * 뒤에 저장한 쪽이 앞사람의 변경을 조용히 덮으면 안 된다. 칸을 나중에 더하는
 * 마이그레이션을 한 번 덜 하려고 지금 만든다.
 *
 * ── 지우기는 소프트 삭제 4칼럼이다 (이번 조각에는 화면이 없다) ──────────
 * 이 저장소의 규칙은 「물리 삭제를 하지 않는다」이고 4칼럼은 이름과 개수가
 * 고정이다(CLAUDE.md · 위 softDelete). A/S 는 같은 기능에서 바로 지우기를 골랐지만
 * 그쪽에는 감사 로그 표가 있어 무엇이 사라졌는지 PURGE 줄이 안다 — 이 사이트에는
 * 아직 그 표가 없다. 감사 로그 없이 물리 삭제를 하면 지워진 글은 **아무 데도**
 * 남지 않는다. 그래서 여기서는 4칼럼을 쓴다.
 * 🔴 이번 조각은 목록 · 작성 · 상태 옮기기까지다(README 의 다음 할 일). 지우기
 * 화면은 없지만 칸은 지금 만든다 — 나중에 마이그레이션을 한 번 덜 하려고.
 * 읽는 쪽(queries)은 지금도 `is_deleted = false` 로 거른다.
 *
 * ── 🔴 A/S 의 개선요청 열 건이 들어올 자리 ──────────────────────────────
 * A/S 시스템 안에 이미 열 건이 쌓여 있고(2026-09-13~), 나중에 이리로 옮긴다
 * (사용자 결정). 옮길 때 무엇이 걸리는지 미리 보고 자리를 남겼다.
 *
 *  · **메뉴** — 걸리지 않는다. service-catalog.ts 의 `rf-service-system` 메뉴
 *    열쇠가 A/S navItems 의 key 와 **글자 그대로 같게** 적혀 있다. 그 글의
 *    menu_key 를 그대로 넣고 service_key 만 `rf-service-system` 으로 달면 된다.
 *  · **사람** — 걸린다. A/S 의 작성자는 A/S users 표의 id 이고, 이 사이트의
 *    web_users 에는 그 사람이 아직 없을 수 있다(여기 한 번도 안 들어온 사람).
 *    그래서 `created_by` 를 **NULL 을 받는 칸**으로 둔다. 이을 계정을 찾으면
 *    그것을 넣고, 못 찾으면 `imported_author_name` 에 이름만 남긴다. 「누가
 *    적었는가」가 둘 다 비는 일은 아래 CHECK 가 막는다.
 *    (in_progress_by · resolved_by 도 같은 이유로 비어 있을 수 있다.)
 *  · **두 번 옮기기** — `imported_from` + `imported_ref` 에 원본 시스템과 원본
 *    id 를 적고 그 짝에 유일 색인을 건다. 이관 스크립트를 두 번 돌려도 스무
 *    건이 되지 않는다. 이것이 이 세 칸의 주된 값이다 — 이관은 대개 한 번에
 *    끝나지 않고, 중간에 멈췄을 때 「어디까지 왔나」를 DB 가 답해야 한다.
 *  · **적힌 때** — created_at 은 기본값이 있을 뿐 넣을 수 있는 칸이라, 원본의
 *    시각을 그대로 넣으면 된다. 목록이 적힌 차례대로 서려면 그래야 한다.
 *
 * 🔴 이관 스크립트는 **이번 조각에 없다.** 위 칸들은 그것이 들어올 자리다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * body 는 자유 입력이라 사람 이름이나 고객사 사정이 섞일 수 있다. 로그나 오류
 * 보고로 그대로 내보내지 않는다 — 서버 액션이 예상 밖 DB 오류를 통째로 로그하지
 * 않는 이유가 그것이다.
 */
export const improvementRequests = pgTable(
  "improvement_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * 어느 시스템 이야기인가 — service-catalog.ts 의 서비스 `key`(이름이 아니다).
     * 필수다. CHECK 가 없는 까닭은 머리말의 '서비스·메뉴에 CHECK 도 참조 표도
     * 두지 않는다'.
     */
    serviceKey: text("service_key").notNull(),

    /**
     * 그 서비스의 어느 메뉴인가 — service-catalog.ts 의 메뉴 `key`.
     * NULL = 「메뉴를 고르지 않았다」. 기본값을 두지 않는다(머리말).
     */
    menuKey: text("menu_key"),

    /** 사람이 적는 글. 1~2000자(아래 CHECK). */
    body: text("body").notNull(),

    status: improvementRequestStatusEnum("status").notNull().default("OPEN"),

    /** 진행중으로 옮긴 사람과 때. 머리말의 '상태와 네 칸은 같은 말이어야 한다'. */
    inProgressBy: uuid("in_progress_by").references(() => webUsers.id, { onDelete: "restrict" }),
    inProgressAt: timestamp("in_progress_at", { withTimezone: true }),
    /** 해결로 옮긴 사람과 때. */
    resolvedBy: uuid("resolved_by").references(() => webUsers.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    /**
     * 작성자. 「접수 상태인 자기 글만 고칠 수 있다」가 이 칸을 본다.
     *
     * 🔴 NOT NULL 이 아닌 유일한 이유는 이관이다(머리말의 'A/S 의 개선요청 열
     * 건이 들어올 자리'). 이 사이트에서 적은 글은 **언제나** 값이 있다 — 아래
     * `improvement_requests_origin` CHECK 가 그것을 지킨다.
     */
    createdBy: uuid("created_by").references(() => webUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => webUsers.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /** 낙관적 잠금 토큰. 머리말의 'version 은 처음부터 둔다'. */
    version: integer("version").notNull().default(1),

    /**
     * 어느 시스템에서 옮겨 왔나 — 서비스 열쇠와 같은 글자를 쓴다
     * (`rf-service-system`). NULL = 이 사이트에서 적은 글.
     */
    importedFrom: text("imported_from"),
    /** 원본 시스템에서의 id. `imported_from` 과 짝으로 유일하다(아래 색인). */
    importedRef: text("imported_ref"),
    /**
     * 원본의 작성자 이름 — 이을 web_users 계정을 **찾지 못했을 때만** 적는다.
     * 계정을 찾았으면 created_by 에 넣고 이 칸은 비운다(이름은 그 계정에서 읽는다).
     */
    importedAuthorName: text("imported_author_name"),

    ...softDelete,
  },
  (t) => [
    // 목록은 언제나 최근 글부터 읽는다 — 이 표에서 가장 많이 타는 길이다.
    index("improvement_requests_created_at_idx").on(t.createdAt),

    // 같은 글을 두 번 옮기지 않는다(머리말의 '두 번 옮기기'). 이 사이트에서 적은
    // 글은 두 칸이 NULL 이라 색인에 들어가지 않는다 — 그래서 부분 색인이다.
    uniqueIndex("improvement_requests_imported_uq")
      .on(t.importedFrom, t.importedRef)
      .where(sql`${t.importedFrom} IS NOT NULL`),

    // 🔴 이 수는 domain/improvement-request.ts 의
    // IMPROVEMENT_REQUEST_BODY_MAX_CHARS 와 같아야 한다(시험이 이 파일의 글자를
    // 읽어 대조한다). 둘 다 char_length — 코드 포인트 수로 센다.
    check("improvement_requests_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),

    // 상태와 시각 칸이 맞는다 — 도메인의 planImprovementRequestStatusChange 와
    // 같은 규칙이다. 「누가」가 아니라 「언제」로 적는 이유는 바로 아래 CHECK.
    check(
      "improvement_requests_status_columns",
      sql`
        (${t.status} = 'OPEN' AND ${t.inProgressAt} IS NULL AND ${t.resolvedAt} IS NULL)
        OR
        (${t.status} = 'IN_PROGRESS' AND ${t.inProgressAt} IS NOT NULL AND ${t.resolvedAt} IS NULL)
        OR
        (${t.status} = 'RESOLVED' AND ${t.resolvedAt} IS NOT NULL)
      `
    ),

    // 「누가」만 있고 「언제」가 없는 행은 없다.
    //
    // 🔴 그 반대(언제만 있고 누가 없다)는 **막지 않는다.** 옮겨 온 글에는 상태를
    // 바꾼 사람을 이 사이트 계정으로 이을 수 없는 경우가 있고, 그때 남는 것이
    // 「2026-09-13 에 해결되었다」뿐이다. 그 사실까지 버리면 옮겨 온 글의 상태가
    // 거짓이 된다. 이 사이트에서 옮긴 상태는 언제나 쌍으로 적힌다 —
    // planImprovementRequestStatusChange 가 둘을 함께 계산하기 때문이다.
    check(
      "improvement_requests_actor_pairs",
      sql`
        (${t.inProgressBy} IS NULL OR ${t.inProgressAt} IS NOT NULL)
        AND (${t.resolvedBy} IS NULL OR ${t.resolvedAt} IS NOT NULL)
      `
    ),

    // 이 사이트에서 적은 글인가, 옮겨 온 글인가 — 둘 중 하나이고 섞이지 않는다.
    //  · 이 사이트 글: 이관 세 칸이 모두 비고, created_by 가 반드시 있다.
    //  · 옮겨 온 글 : imported_from 과 imported_ref 가 짝으로 있고, 「누가
    //    적었는가」가 created_by 든 imported_author_name 이든 하나는 있다.
    check(
      "improvement_requests_origin",
      sql`
        (${t.importedFrom} IS NULL AND ${t.importedRef} IS NULL
          AND ${t.importedAuthorName} IS NULL AND ${t.createdBy} IS NOT NULL)
        OR
        (${t.importedFrom} IS NOT NULL AND ${t.importedRef} IS NOT NULL
          AND (${t.createdBy} IS NOT NULL OR ${t.importedAuthorName} IS NOT NULL))
      `
    ),
  ],
);

export type ImprovementRequest = typeof improvementRequests.$inferSelect;

/* ------------------------------------------------------------------ */
/* improvement_request_attachments — 글에 붙는 스크린샷 한 장            */
/* ------------------------------------------------------------------ */

/**
 * ────────────────────────────────────────────────────────────────────────
 * 개선요청에 붙는 스크린샷 (2026-09-17)
 * ────────────────────────────────────────────────────────────────────────
 * 글 한 줄에 화면 사진을 최대 다섯 장 붙인다. 「이렇게 나와요」를 글로만 적게
 * 하면 고치는 사람이 재현부터 해야 한다.
 *
 * ── 🔴 표 하나에 주인은 하나다 (승인된 설계 ①) ─────────────────────────
 * A/S 시스템의 `attachments` 는 수리건 · 제품모델 · 견적서 · 개선요청 넷을 한
 * 표에 담느라 「주인이 정확히 하나여야 한다」는 CHECK 가 네 겹으로 걸려 있다.
 * 여기는 첨부의 주인이 **개선요청 하나뿐**이라 그 복잡함이 필요 없다 —
 * `improvement_request_id` 가 NOT NULL 이면 끝이다. 주인이 늘어나면 그때 표를
 * 나눌지 CHECK 를 걸지 정할 일이고, 미리 나눠 두면 아무도 쓰지 않는 NULL 칸이
 * 남는다.
 *
 * ── 🔴 파일 자체는 DB 밖에 있다 (승인된 설계 ②) ────────────────────────
 * 바이트는 `UPLOADS_DIR` 아래에 놓고, 이 행에는 **루트 기준 상대 경로**만 적는다
 * (`stored_path`). 루트를 행에 적지 않는 것이 요점이다 — 그래야 NAS 이전이
 * 「파일을 복사하고 설정 한 줄을 바꾸는 일」이 된다. bytea 로 DB 에 넣으면 백업이
 * 통째로 무거워지고, 20MB 짜리 이미지가 커넥션을 타고 흐른다.
 *
 * ── 🔴 경로에는 UUID 만 들어간다 ───────────────────────────────────────
 * `improvement-requests/{글id}/{첨부id}.{png|jpg|jpeg}`. 사람이 올린 이름은
 * `original_file_name` 칸에만 남는다. 까닭은 domain/attachment-path.ts 머리말에
 * 있다(`..` · 구분자 · 덮어쓰기 · 한글 깨짐). 아래
 * `improvement_request_attachments_stored_path_shape` CHECK 가 **DB 쪽에서도**
 * 그 모양을 강제한다 — 코드를 거치지 않고 손으로 넣은 SQL 한 줄이 저장 루트 밖을
 * 가리키는 경로를 만들지 못하게. 경로를 만드는 곳과 검사하는 곳이 두 겹인 것은
 * 일부러다.
 *
 * ── 🔴 지우기는 소프트 삭제다 (승인된 설계 ③) ──────────────────────────
 * 이 사이트에는 감사 로그 표가 없다. 물리 삭제를 하면 **무엇이 사라졌는지가
 * 아무 데도 남지 않는다.** 본문(improvement_requests)이 이미 소프트 삭제 4칼럼을
 * 쓰므로 첨부도 같게 맞춘다. 읽는 쪽은 언제나 `is_deleted = false` 로 거른다.
 * 디스크의 파일은 그대로 둔다 — 행이 살아 있는 한 되살릴 수 있어야 하고, 지운
 * 순간 파일을 지우면 「되살리기」가 영영 불가능해진다. 정말로 지우는 일(보관기간
 * 만료 등)은 나중에 따로 정할 일이다.
 *
 * ── 다섯 장은 이 표가 세지 않는다 ──────────────────────────────────────
 * 상한은 domain/improvement-request.ts 의 IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT
 * 이고, 세는 곳은 **글 행을 잠근 트랜잭션 안**이다
 * (db/mutations/improvement-request-attachments.ts). CHECK 로는 「다른 행이 몇
 * 개인가」를 볼 수 없다 — 그것을 하려면 트리거가 필요하고, 트리거는 코드에서
 * 보이지 않는 곳에서 실패한다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * `original_file_name` 은 사람이 붙인 이름이라 이름·고객사가 섞일 수 있고,
 * 이미지 자체는 화면 사진이라 더하다. 로그나 오류 보고로 내보내지 않는다.
 */
export const improvementRequestAttachments = pgTable(
  "improvement_request_attachments",
  {
    /**
     * 🔴 기본값(defaultRandom)을 두지 않는다. 이 id 가 **디스크 파일 이름**이라
     * 파일을 놓기 전에 값이 필요하다 — DB 가 정하면 파일을 어디에 놓을지 모르는
     * 채로 INSERT 를 해야 한다. 코드가 randomUUID() 로 만들어 넣는다.
     */
    id: uuid("id").primaryKey(),

    improvementRequestId: uuid("improvement_request_id")
      .notNull()
      .references(() => improvementRequests.id, { onDelete: "restrict" }),

    /** 사람이 올린 이름 그대로. **경로에는 쓰이지 않는다**(머리말). */
    originalFileName: text("original_file_name").notNull(),

    /** 저장 루트(UPLOADS_DIR) 기준 상대 경로. 모양은 아래 CHECK 가 지킨다. */
    storedPath: text("stored_path").notNull(),

    /**
     * 내려받기 응답의 Content-Type 이 되는 값.
     * 🔴 브라우저가 보낸 Content-Type 이 아니라 **확장자에서 서버가 고른 정본**이다
     * (domain/attachment-file.ts 의 canonicalMimeTypeForExtension). 올린 쪽이 고른
     * 값을 그대로 돌려주면 응답 헤더가 남의 손에 넘어간다.
     */
    mimeType: text("mime_type").notNull(),

    /** 실제로 디스크에 쓴 바이트 수. 브라우저가 알려 준 값이 아니다. */
    fileSize: integer("file_size").notNull(),

    /**
     * 흘려보내며 계산한 sha256(소문자 hex).
     * 같은 파일인지, 옮기는 동안 상하지 않았는지를 나중에 말할 수 있게 한다.
     */
    checksumSha256: text("checksum_sha256").notNull(),

    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => webUsers.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),

    ...softDelete,
  },
  (t) => [
    // 「이 글의 살아 있는 첨부」가 이 표에서 가장 많이 타는 길이다 — 목록도,
    // 다섯 장을 세는 트랜잭션도 이 색인을 탄다.
    index("improvement_request_attachments_live_idx")
      .on(t.improvementRequestId)
      .where(sql`${t.isDeleted} = false`),

    // 두 행이 같은 파일을 가리키지 않는다. 첨부 id 가 매번 새 UUID 라 정상적으로는
    // 일어나지 않지만, 그렇다면 이 색인은 공짜다 — 그리고 만약 깨진다면 그것은
    // 한쪽을 지울 때 남의 파일이 함께 사라진다는 뜻이라 조용히 두면 안 된다.
    uniqueIndex("improvement_request_attachments_stored_path_uq").on(t.storedPath),

    // 🔴 이 수는 domain/attachment-file.ts 의 MAX_ATTACHMENT_SIZE_BYTES 와 같아야
    // 한다(20MB = 20971520). 시험이 이 파일의 글자를 읽어 대조한다. 빈 파일(0)도
    // 받지 않는다 — 올리기 통로가 이미 막지만, 거치지 않는 길이 생겨도 남는다.
    check(
      "improvement_request_attachments_file_size",
      sql`${t.fileSize} BETWEEN 1 AND 20971520`
    ),

    // 🔴 **경로에 사람이 준 글자가 섞이지 않는다** — DB 쪽의 같은 규칙.
    // `improvement-requests/{uuid}/{uuid}.{png|jpg|jpeg}` 말고는 아무것도 받지
    // 않는다. 대문자·역슬래시·`..`·한글은 이 정규식에 들어맞을 수 없다.
    // (`[.]` 를 쓰는 것은 SQL 문자열 안에서 역슬래시 이스케이프를 피하려는 것뿐이다.)
    check(
      "improvement_request_attachments_stored_path_shape",
      sql`${t.storedPath} ~ '^improvement-requests/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|jpeg)$'`
    ),
  ],
);

export type ImprovementRequestAttachment = typeof improvementRequestAttachments.$inferSelect;
