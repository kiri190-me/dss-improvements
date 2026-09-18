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
            (2026-09-18, A/S 에서 먼저 같은 결정을 했다) 때문이다.

            🔴 2026-09-18 오후부터 그 모습은 **드롭다운 단추 하나**다
            (@dss/ui — 가로로 늘어놓으니 폰에서 폭이 모자랐고,
            서비스가 늘수록 나빠지는 구조였다). 단추에는 지금 있는 서비스가
            서고(폰은 아이콘만), 누르면 목록이 단추 아래로 **떠서** 펼쳐진다.
            펼치고 접는 것은 `<details>` 라 **자바스크립트 없이** 된다 —
            로그아웃을 평범한 `<form>` 으로 둔 것과 같은 판단이다. 바깥을
            눌러 접기와 Esc 만 묶음 안의 작은 조각(`DropdownDismiss`,
            그것만 `"use client"`)이 **얹는다** — 아무것도 그리지 않으므로
            마크업이 늘지 않고, 스크립트가 늦게 붙어도 그 둘만 없다.
            🔴 그렇다고 이 파일이나 AppHeader 에 `"use client"` 를 붙이지
            않는다. 딸려 오는 조각은 묶음 안에 있고 이 파일과 무관하다.

            🔴 `className="shrink-0"` 은 여전히 **넘기지 않는다**. 이 조각의
            className 은 `<nav>` 에 붙는데, 머리말의 flex 항목은 그 바깥의
            래퍼 `<div>` 다 — 여기에 걸어도 아무 일도 하지 않으면서 읽는
            사람만 헷갈리게 한다. 폭을 정하는 장치는 머리말 쪽의
            `shrink-0 mr-auto` 한 겹이다(AppHeader.tsx 의 폭 셈).

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
