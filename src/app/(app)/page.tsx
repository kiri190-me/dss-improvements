import { ImprovementRequestsScreen } from "@/components/improvement-requests/ImprovementRequestsScreen";
import {
  canManageImprovementRequests,
  canWriteImprovementRequests,
} from "@/lib/auth/improvement-request-authorization";
import { requireSession } from "@/lib/auth/guards";
import { listImprovementRequests } from "@/lib/db/queries/improvement-requests";

/**
 * 첫 화면 — 개선요청 목록과 작성.
 *
 * 세션 검증은 상위 레이아웃((app)/layout.tsx)도 하지만 여기서 한 번 더 부른다.
 * 이유는 이 화면이 **그 사람의 역할**을 쓰기 때문이다 — 레이아웃이 읽은 값을
 * 내려받는 길을 만들면, 그 길에 무엇이 실려 오는지가 화면마다 갈린다.
 * getSessionUser 는 쿠키 하나와 DB 한 행이라 두 번 불러도 싸다.
 *
 * 🔴 `canManage` 는 **화면에 단추를 그릴지**에만 쓴다. 막는 것은 서버 액션이고,
 * 그쪽은 이 값을 받지 않고 살아 있는 계정의 역할로 다시 판정한다
 * (lib/server/actions/improvement-requests.ts 머리말).
 *
 * 목록은 전 직원이 본다(README 의 「정해진 것」). 그래서 사람으로 거르지 않는다.
 */
export default async function HomePage() {
  const user = await requireSession();
  const items = await listImprovementRequests();

  return (
    <ImprovementRequestsScreen
      items={items}
      // 「자기 글인가」를 줄마다 판정하는 재료다. 🔴 판정 자체는 서버가 잠근 행의
      // created_by 로 다시 한다 — 이 값은 단추를 그릴지 고르는 데만 쓴다.
      actingUserId={user.id}
      canWrite={canWriteImprovementRequests(user.role)}
      canManage={canManageImprovementRequests(user.role)}
    />
  );
}
