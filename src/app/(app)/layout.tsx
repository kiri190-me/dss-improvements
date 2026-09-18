import type { ReactNode } from "react";

import { ServiceMenuBar } from "@dss/ui";

import { AppHeader } from "@/components/AppHeader";
import { requireSession } from "@/lib/auth/guards";
import { portalAppsUrl, thisServiceId } from "@/lib/auth/oidc";
import { readServiceMenu } from "@/lib/auth/service-menu-cookie";

/**
 * 사내 구간. 여기 아래는 전부 세션이 있어야 볼 수 있다.
 *
 * 세션 검증을 이 한 곳에서 하고 각 화면에서 또 하지 않는다 — 화면을 더할
 * 때마다 손으로 적게 하면 언젠가 한 장을 빠뜨린다. 그 대신 **데이터를 바꾸는
 * 서버 액션·API 는 반드시 따로 다시 검증한다.** 레이아웃은 화면을 그릴 때만
 * 돌지, 액션이 불릴 때 도는 것이 아니다.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();

  // 머리말 **위**에 앉는 서비스 오가기 띠가 그릴 목록. 포털이 로그인 ID 토큰에
  // 실어 보낸 것을 콜백이 별도 서명 쿠키에 구워 두었다(auth/service-menu-cookie.ts).
  //
  // 쿠키가 없거나 못 믿을 것이면 빈 배열이고, 그때 ServiceMenuBar 는 아무것도
  // 그리지 않는다 — 빈 띠도 남기지 않으므로 화면이 예전과 한 픽셀도 같다.
  // 포털의 그 기능이 배포되기 전까지는 늘 이 상태다.
  //
  // 머리말 안에 끼우지 않고 위에 독립된 띠로 두는 이유는 @dss/ui README 3절에
  // 있다 — AppHeader 는 좌우 두 덩이라 칸이 여럿 붙는 목록이 들어가면 깨진다.
  const services = await readServiceMenu();
  // 「지금 여기」로 눌러 그릴 칸을 고르는 열쇠 — 이 시스템의 client_id 다.
  // 목록이 있을 때만 읽는다(없으면 띠 자체가 없어 물어볼 것도 없다).
  const currentServiceId = services.length > 0 ? thisServiceId() : null;

  return (
    <div className="flex min-h-full flex-col">
      <ServiceMenuBar
        services={services}
        currentServiceId={currentServiceId}
        className="shrink-0"
      />
      <AppHeader user={user} portalUrl={portalAppsUrl()} />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
