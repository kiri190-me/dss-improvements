import { USER_ROLES, type UserRole } from "@/lib/db/schema";

/**
 * ============================================================================
 * 개선요청 권한 — 역할만 보는 순수 함수
 * ============================================================================
 * A/S 시스템의 auth/improvement-request-authorization.ts 와 같은 자리·같은 모양의
 * 파일이다. 역할 하나만 보고 답하고, DB 도 세션도 여기서 만지지 않는다.
 *
 * ── 막는 곳은 여기가 아니다 ────────────────────────────────────────────
 * 이 파일은 **판정**만 한다. 실제로 거절하는 것은 서버 액션
 * (server/actions/improvement-requests.ts)이고, 그 액션은 화면이 무엇을 보여
 * 줬든 매번 처음부터 다시 검사한다. 화면이 단추를 감추는 것은 편의일 뿐이다.
 *
 * ── 🔴 역할은 세션 쿠키가 아니라 살아 있는 계정에서 온다 ────────────────
 * 부르는 쪽은 언제나 `getSessionUser()` 가 돌려준 web_users 행의 `role` 을 넘긴다.
 * 그 함수가 매 요청 DB 한 행을 읽으므로(auth/session.ts), 강등된 사람이 토큰
 * 만료까지 예전 권한으로 저장하는 구멍이 없다. 폼·쿼리스트링·요청 본문에서 온
 * 값을 이 함수에 넘기면 그 보호가 통째로 사라진다.
 *
 * ── 정책 (README 의 「정해진 것」 · 2026-09-17) ──────────────────────────
 *
 *  · **보기와 적기는 전 직원이다.** 포털에 `--open-to-all` 로 등록했고, 그 결정의
 *    이유가 그대로 여기의 이유다 — 「권한을 받아야 적을 수 있으면 아무도 적지
 *    않는다」. 아무도 막지 않는 함수를 굳이 두는 것은, 나중에 좁혀야 할 날이 왔을
 *    때 고칠 곳이 **한 줄**이게 하기 위해서다. 조건을 화면마다 적어 두면 그날
 *    한 화면을 빠뜨린다.
 *
 *  · **상태를 옮기는 것은 관리자(ADMIN)다.** 상태는 「이 요청을 받아 움직이고
 *    있다」는 약속이라, 그 약속을 할 수 있는 자리만 바꾼다.
 *
 *  · **모르는 역할에는 거짓을 답한다.** 세션이나 자료가 망가졌을 때 열어 주지
 *    않는다 — 닫히는 쪽으로 실패한다. (포털이 모르는 역할을 보내면 애초에
 *    로그인이 거절되지만(sso-login.ts 의 decideRole), 그 문 하나에 기대지 않는다.)
 * ============================================================================
 */

function isKnownRole(role: UserRole): boolean {
  return (USER_ROLES as readonly string[]).includes(role);
}

/** 목록 보기 — 들어온 사람 모두. */
export function canViewImprovementRequests(role: UserRole): boolean {
  return isKnownRole(role);
}

/** 글 적기 — 들어온 사람 모두. */
export function canWriteImprovementRequests(role: UserRole): boolean {
  return isKnownRole(role);
}

/** 상태 옮기기 — 관리자만. */
export function canManageImprovementRequests(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * 개선요청 알림(머리말의 종)을 받는 사람 — 관리자만.
 *
 * 🔴 **「개발자」 = 지금 ADMIN 인 사람**이다(사용자 결정 2026-09-23). 새 역할을
 * 만들지 않았다 — 지금 이 회사에서 개선요청을 받아 고치는 사람과 상태를 옮기는
 * 사람이 같은 사람이라, 역할을 하나 더 만들면 아무도 그 값을 고르지 않는 채
 * 포털 드롭다운에만 남는다(이 파일 머리말의 같은 판단).
 *
 * 🔴 `canManageImprovementRequests` 를 **부른다**(`role === "ADMIN"` 을 다시 적지
 * 않는다). 둘이 같은 뜻이어서가 아니라 **지금은 같은 답이어야 하기 때문**이고,
 * 갈라져야 할 날이 오면 이 함수만 고치면 된다. 화면(누구의 종에 싣는가)과 서버
 * 액션(누구의 확인을 적는가)이 둘 다 이 함수 하나를 부른다.
 */
export function canReceiveImprovementRequestNotifications(role: UserRole): boolean {
  return canManageImprovementRequests(role);
}
