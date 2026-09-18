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

  // 머리말 **안**에 앉는 서비스 오가기 목록. 포털이 로그인 ID 토큰에 실어 보낸
  // 것을 콜백이 별도 서명 쿠키에 구워 두었다(auth/service-menu-cookie.ts).
  //
  // 쿠키가 없거나 못 믿을 것이면 빈 배열이고, 그때 ServiceMenuBar 는 아무것도
  // 그리지 않는다 — 빈 자리도 남기지 않으므로 머리말이 예전과 같다.
  // 포털의 그 기능이 배포되기 전까지는 늘 이 상태다.
  const services = await readServiceMenu();
  // 「지금 여기」로 눌러 그릴 칸을 고르는 열쇠 — 이 시스템의 client_id 다.
  // 목록이 있을 때만 읽는다(없으면 그릴 칸 자체가 없어 물어볼 것도 없다).
  const currentServiceId = services.length > 0 ? thisServiceId() : null;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader
        user={user}
        portalUrl={portalAppsUrl()}
        serviceMenu={
          /*
            사내 시스템 오가기 목록(@dss/ui). 머리말 **위**가 아니라 **안**에
            앉는다(variant="inline") — 위에 회색 띠로 따로 두면 화면 맨 위가 두
            층이 되어 답답하고 본문이 한 줄만큼 줄어든다는 사용자 지적
            (2026-09-18, A/S 에서 먼저 같은 결정을 했다) 때문이다. 그 모습은
            바탕도 아래 테두리도 없이 머리말 위에 그대로 얹히고, 지금 있는
            서비스는 굵기·글자색·2px 밑줄로 알린다(회색 띠일 때의 「흰 칸으로
            띄우기」는 흰 머리말 위에서 보이지 않는다).

            🔴 `className="shrink-0"` 은 **일부러 뺐다**. 그것은 세로 flex 안에
            독립된 띠로 앉을 때의 것이고, 머리말 안에서는 반대로 **줄어들 수
            있어야** 한다(@dss/ui README 3절). 폭을 정하는 장치는 머리말 쪽의
            `min-w-0 flex-1` 한 겹이다 — 여기서는 아무 폭도 주지 않는다.

            🔴 colorScheme 은 넘기지 않는다. 이 사이트는 globals.css 에서
            color-scheme: light 로 고정이고, 기본값 "host" 는 조상에 .dark 가
            있을 때만 어두워지므로 그대로 두는 것이 옳다(@dss/ui README 4절).
          */
          <ServiceMenuBar
            services={services}
            currentServiceId={currentServiceId}
            variant="inline"
          />
        }
      />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
