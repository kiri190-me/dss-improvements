/**
 * ============================================================================
 * 서비스와 그 메뉴 — **이 파일에 적어 둔다**
 * ============================================================================
 *
 * 개선요청 한 줄은 「어느 시스템의, 어느 화면 이야기인가」를 달고 다닌다. 그
 * 목록이 여기 있다.
 *
 * ── 🔴 왜 각 서비스에 물어보지 않나 (2026-09-17, 사용자 결정) ────────────
 * 실시간으로 물어보면 그 서비스가 멈춘 날 **개선요청 화면도 함께 멈춘다.**
 * 「A/S 가 느려요」를 적으러 들어왔는데 A/S 가 죽어서 메뉴가 안 나오는 것이
 * 정확히 그 상황이다. 그래서 여기로 넘어오는 것은 **글**이지 코드 의존이
 * 아니다 — 이 회사의 「업데이트 소식」(dss-auth/src/lib/release-notes.ts)이
 * 같은 방식이고, 같은 이유다.
 *
 * 값이 조금 낡을 수 있다는 것은 이 선택의 대가다. 메뉴 이름이 바뀌면 여기가
 * 옛 이름으로 남는다. 그 대가를 치르는 대신 얻는 것은 「저쪽이 어떤 상태든 이
 * 사이트는 돈다」이고, 개선요청에서는 그편이 맞다.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ■ 늘리는 방법 — 새 서비스가 생기면 아래 배열에 **한 덩이**를 더한다
 * ────────────────────────────────────────────────────────────────────────
 *
 *   1. `key`  — 포털(dss-auth)에 등록한 **clientId 그대로**. 포털이 이미 그
 *               이름으로 그 시스템을 부르고 있어서, 새 이름을 지으면 같은
 *               것을 가리키는 이름이 둘이 된다. 포털에 없는 것(아래 `other`)
 *               만 예외이고, 그때는 주석에 왜 없는지 적는다.
 *   2. `label`— 포털 타일에 뜨는 이름과 같게. 사람이 두 화면에서 같은 글자를
 *               봐야 같은 것인 줄 안다.
 *   3. `menus`— 🔴 **그 저장소의 메뉴 정의를 읽어서** 옮겨 적는다. 지어내지
 *               않는다. 어디를 읽었는지는 각 덩이의 주석에 적어 두었다.
 *
 *   메뉴가 하나도 없는 서비스도 된다(`menus: []`). 그러면 화면의 메뉴 칸이
 *   비활성으로 열린다 — 메뉴는 원래 고르지 않아도 되는 값이다.
 *
 * ■ 메뉴 이름이 바뀌면 — `label` 만 고치고 `key` 는 그대로 둔다
 *
 *   저장된 것은 열쇠이지 이름이 아니다. 열쇠를 바꾸면 그 열쇠로 적혀 있던 옛
 *   글이 전부 「(없어진 메뉴)」가 된다.
 *
 * ■ 메뉴가 없어지면 — 줄을 지우면 된다. 옛 글은 남는다
 *
 *   DB 에는 CHECK 를 두지 않았다(schema.ts 의 improvement_requests 머리말).
 *   목록에서 사라진 열쇠를 가진 옛 글은 화면이 「(없어진 메뉴)」로 읽고, 새
 *   글은 검증이 막는다. **CHECK 를 두면** 메뉴 하나를 더할 때마다
 *   마이그레이션이 따라붙고, 메뉴 하나를 뺄 때는 그 열쇠를 가진 옛 글 때문에
 *   새 CHECK 를 걸 수조차 없다. 서비스도 같다.
 *
 * ■ 지금 빠져 있는 것과 그 이유
 *
 *   · **시너지 출석부**(synergy-attendance) — 포털에 등록된 사내 시스템이
 *     아니다(Vercel + Neon 으로 따로 돌고 통합 로그인을 쓰지 않는다). 사내
 *     시스템이 되면 그때 한 덩이를 더한다.
 *   · 그 밖에 이 회사 저장소가 아닌 도구(그룹웨어·메신저 등)는 `other` 로
 *     적는다. 서비스 목록은 「우리가 고칠 수 있는 것」의 목록이다.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ■ 이 파일은 순수하다
 *
 *   DB 도 서버도 next 도 가져오지 않는다. 화면·서버 액션·검증·저장이 **같은
 *   목록**을 보게 하려고 따로 뺀 자리다 — 목록을 두 곳에 적으면 화면은 내놓는
 *   메뉴를 저장이 거절하는(또는 그 반대의) 날이 온다.
 * ============================================================================
 */

export type ServiceMenu = {
  /**
   * 저장되는 값. 그 서비스 **안에서만** 겹치지 않으면 된다 — DB 에는 서비스
   * 열쇠와 함께 담기므로, A/S 의 `users` 와 포털의 `adminUsers` 가 서로를
   * 신경 쓸 일이 없다.
   */
  key: string;
  /** 사람에게 보이는 이름. 그 시스템의 메뉴 이름표 그대로. */
  label: string;
};

export type ServiceEntry = {
  /** 저장되는 값. 포털 clientId 그대로(파일 머리말의 '늘리는 방법'). */
  key: string;
  label: string;
  /** 그 서비스의 메뉴, 그 시스템의 차례대로. 비어 있어도 된다. */
  menus: readonly ServiceMenu[];
};

/**
 * 「어느 시스템도 아닌 일」의 열쇠.
 *
 * 이 사이트는 사내 시스템**과 일하는 방식**을 함께 받는다(README 첫 줄). 일하는
 * 방식에 대한 요청 — 「A/S 접수 절차를 줄이자」 같은 — 은 어느 시스템의 메뉴도
 * 아니라서, 서비스를 고르라고만 하면 적을 자리가 없다.
 *
 * 🔴 이 열쇠는 포털 clientId 가 아니다. 어떤 clientId 와도 겹치지 않는 낱말이어야
 * 한다(시험이 단언한다) — 포털의 clientId 는 전부 `dss-` 나 `rf-` 로 시작한다.
 */
export const OTHER_SERVICE_KEY = "other";

/**
 * 🔴 **이 목록이 전부다.** 여기 없는 서비스·메뉴 열쇠는 저장되지 않는다
 * (validation/improvement-request-input.ts 가 이 목록으로 판정하고, 저장
 * (mutations)이 트랜잭션 전에 같은 함수를 한 번 더 부른다).
 */
export const SERVICE_CATALOG: readonly ServiceEntry[] = [
  {
    // 포털 등록: `rf-service-system` (dss-auth/docs/주소.md 의 등록 예시).
    key: "rf-service-system",
    label: "DSS A/S 관리 시스템",
    /**
     * 🔴 열쇠와 이름을 **RF_Service_System/src/lib/navigation.ts 의 navItems 에서
     * 그대로** 옮겨 적었다(2026-09-17 기준). 차례도 그 저장소의 사이드바 차례다
     * (대시보드 → 주간보고 → navGroups 의 asOperations · techResources ·
     * poDomestic · admin · systemSettings).
     *
     * 🔴 **열쇠를 다시 짓지 않은 것이 요점이다.** A/S 시스템 안에도 같은 기능이
     * 있고(그쪽 improvement_requests.menu_key), 거기 쌓인 글 열 건을 나중에 이리로
     * 옮긴다. 그때 그 글의 menu_key 를 **그대로** 이 표의 menu_key 에 넣고 서비스만
     * `rf-service-system` 으로 달면 끝난다 — 열쇠를 새로 지었다면 열 건마다 옛
     * 열쇠를 새 열쇠로 옮기는 대응표가 필요했을 것이고, 그 표는 틀리면 조용히 틀린다.
     */
    menus: [
      { key: "dashboard", label: "대시보드" },
      { key: "weeklyReport", label: "주간보고" },
      { key: "repairCases", label: "전체 A/S 현황" },
      { key: "myActiveWork", label: "내 담당 제품" },
      { key: "repairCaseNew", label: "A/S 접수" },
      { key: "customerPortal", label: "고객 안내 현황" },
      { key: "diagnosisFlowcharts", label: "진단 Flowchart 관리" },
      { key: "workflows", label: "워크플로 관리" },
      { key: "excelKyosanIntakeList", label: "일본 본사 Excel 생성" },
      { key: "kyosanIntakeImport", label: "과거 인수품 가져오기" },
      { key: "technicalProcedures", label: "기술 작업 절차" },
      { key: "inventory", label: "재고 관리" },
      { key: "domesticOrders", label: "내자 정리" },
      { key: "quotes", label: "견적서" },
      { key: "repairLabor", label: "작업 비용" },
      { key: "customers", label: "고객사 관리" },
      { key: "productModels", label: "제품 모델 관리" },
      { key: "users", label: "사용자 관리" },
      { key: "settings", label: "시스템 설정" },
      { key: "mailSettings", label: "메일 설정" },
      { key: "improvementRequests", label: "개선 요청" },
      { key: "developerMode", label: "개발자 모드" },
    ],
  },
  {
    // 포털 등록: `dss-meters` (njlee/CLAUDE.md 의 등록 절차).
    key: "dss-meters",
    label: "DSS 계측기 관리 시스템",
    /**
     * 그 저장소에는 A/S 의 navigation.ts 같은 **메뉴 정의 파일이 없다** — 화면이
     * 다섯 장뿐이라 머리말(njlee/src/components/AppHeader.tsx)이 링크 하나만 걸고
     * 나머지는 목록에서 눌러 들어간다. 그래서 열쇠는 이쪽에서 지었고, 이름은
     * njlee/src/lib/i18n/ko.ts 와 각 화면의 제목에서 가져왔다. 라우트는 옆에 적어
     * 둔다 — 나중에 그쪽에 메뉴 정의가 생기면 무엇과 짝인지 알아볼 수 있게.
     */
    menus: [
      { key: "meterList", label: "계측기 목록" }, // /
      { key: "meterNew", label: "계측기 등록" }, // /meters/new
      { key: "meterDetail", label: "계측기 상세 · 교정 이력" }, // /meters/[id]
      { key: "certificates", label: "미등록 성적서" }, // /certificates
      { key: "notifySettings", label: "알림 설정" }, // /settings/notify
    ],
  },
  {
    // 포털 그 자신. clientId 는 없지만(자기 자신에게 발급하지 않는다) 사람들이
    // 「로그인이 이상해요」를 적을 곳은 있어야 한다. 열쇠는 저장소 이름으로 둔다.
    key: "dss-auth",
    label: "DSS 통합 로그인",
    /** 이름과 라우트는 dss-auth/src/app 의 화면들과 admin/layout.tsx 의 링크에서. */
    menus: [
      { key: "signin", label: "로그인 화면" }, // /signin
      { key: "apps", label: "사내 시스템 (앱 런처)" }, // /apps
      { key: "releaseNotes", label: "업데이트 소식" }, // /release-notes
      { key: "adminUsers", label: "사용자 관리" }, // /admin/users
      { key: "adminAudit", label: "감사 기록" }, // /admin/audit
    ],
  },
  {
    // 이 사이트 자신. 포털 등록: `dss-improvements` (README 의 「포털에 등록하기」).
    key: "dss-improvements",
    label: "DSS 개선요청",
    /** 화면이 아직 둘뿐이다. 늘면 여기에 한 줄씩 더한다. */
    menus: [
      { key: "list", label: "개선요청 목록" },
      { key: "new", label: "새 개선요청" },
    ],
  },
  {
    // 회사 홈페이지(dss-home). 손님이 보는 사이트라 사내 시스템은 아니지만, 오타와
    // 옛 자료를 발견하는 것은 언제나 직원이다 — 적을 곳이 있어야 고쳐진다.
    key: "dss-home",
    label: "DSS 회사 홈페이지",
    /**
     * dss-home/src/lib/site.ts 의 `NAV` 에서 **대메뉴만** 옮겨 적었다. 하위 항목
     * (「대표이사 인사말」 등)까지 넣으면 스무 줄이 넘는데, 홈페이지에 대한 요청은
     * 대개 「제품소개에 옛 모델이 있어요」 수준이라 그 단으로 충분하다. 더 좁혀야
     * 할 일이 생기면 그때 하위 항목을 `제품소개 · Vacuum products` 처럼 한 줄씩
     * 더한다(열쇠는 그쪽 slug 를 이어 붙이면 된다).
     */
    menus: [
      { key: "company", label: "회사소개" },
      { key: "products", label: "제품소개" },
      { key: "inquiry", label: "온라인문의" },
      { key: "investment", label: "투자정보" },
      { key: "recruit", label: "인재채용" },
      { key: "support", label: "고객센터" },
    ],
  },
  {
    // 맨 끝이다 — 목록을 훑다가 「내 이야기는 여기 없네」에 닿는 자리가 마지막이어야
    // 한다. 위 상수 OTHER_SERVICE_KEY 의 주석에 이 칸이 있는 이유가 있다.
    key: OTHER_SERVICE_KEY,
    label: "시스템 아님 · 일하는 방식",
    menus: [],
  },
];

/* ------------------------------------------------------------------ */
/* 이름 붙이기 — 열쇠 → 사람이 읽는 글자                                 */
/* ------------------------------------------------------------------ */

/** 메뉴를 고르지 않은 글. DB 의 menu_key 가 NULL 이다. */
export const NO_MENU_LABEL = "메뉴 지정 안 함";
/** 목록에서 사라진 열쇠를 가진 옛 글(파일 머리말의 '메뉴가 없어지면'). */
export const UNKNOWN_MENU_LABEL = "(없어진 메뉴)";
export const UNKNOWN_SERVICE_LABEL = "(없어진 서비스)";

/* ------------------------------------------------------------------ */
/* 고르기                                                               */
/* ------------------------------------------------------------------ */

/** 고를 수 있는 서비스 전부, 적어 둔 차례대로. */
export function listServices(): ServiceEntry[] {
  return [...SERVICE_CATALOG];
}

function findService(serviceKey: unknown): ServiceEntry | undefined {
  if (typeof serviceKey !== "string") return undefined;
  return SERVICE_CATALOG.find((service) => service.key === serviceKey);
}

/**
 * 🔴 **그 서비스의 메뉴만** 돌려준다 — 이 화면의 핵심 동작이다(사용자 요구).
 *
 * 모르는 서비스면 빈 배열이다. 예외를 던지지 않는 이유: 이 함수를 부르는 곳이
 * 화면의 두 번째 선택칸인데, 옛 글을 열었을 때 그 글의 서비스가 목록에서 빠져
 * 있으면 화면이 통째로 죽는다. 빈 목록은 「고를 것이 없다」로 그려진다.
 */
export function listMenusOf(serviceKey: unknown): ServiceMenu[] {
  return [...(findService(serviceKey)?.menus ?? [])];
}

/* ------------------------------------------------------------------ */
/* 판정 — 🔴 저장 쪽이 이것으로 막는다                                   */
/* ------------------------------------------------------------------ */

/** 적어 둔 목록에 있는 서비스 열쇠인가. */
export function isServiceKey(value: unknown): value is string {
  return findService(value) !== undefined;
}

/**
 * 이 서비스에 **속한** 메뉴 열쇠인가.
 *
 * 🔴 서비스와 **짝으로** 본다. 메뉴 열쇠만 따로 보면 A/S 의 `users` 를 고른 채
 * 서비스만 계측기로 바꾼 값이 통과한다 — 열쇠가 서비스 안에서만 유일하기
 * 때문이다(ServiceMenu.key 주석).
 */
export function isMenuKeyOf(serviceKey: unknown, menuKey: unknown): menuKey is string {
  if (typeof menuKey !== "string") return false;
  return listMenusOf(serviceKey).some((menu) => menu.key === menuKey);
}

/* ------------------------------------------------------------------ */
/* 읽기 — 목록에 그릴 글자                                              */
/* ------------------------------------------------------------------ */

/** 서비스 열쇠 → 이름. 목록에서 사라진 열쇠는 「(없어진 서비스)」. */
export function serviceLabel(serviceKey: string): string {
  return findService(serviceKey)?.label ?? UNKNOWN_SERVICE_LABEL;
}

/**
 * 메뉴 열쇠 → 이름. 세 경우가 있다(schema.ts 의 menu_key 주석과 같은 셋).
 *  · null        → 「메뉴 지정 안 함」 — 고르지 않고 적은 글.
 *  · 목록에 있음 → 그 이름표.
 *  · 목록에 없음 → 「(없어진 메뉴)」 — 메뉴가 빠진 뒤의 옛 글.
 */
export function menuLabel(serviceKey: string, menuKey: string | null): string {
  if (menuKey === null) return NO_MENU_LABEL;
  const menu = listMenusOf(serviceKey).find((item) => item.key === menuKey);
  return menu ? menu.label : UNKNOWN_MENU_LABEL;
}
