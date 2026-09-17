import type { ReactNode } from "react";

import { AppHeader } from "@/components/AppHeader";
import { requireSession } from "@/lib/auth/guards";
import { portalAppsUrl } from "@/lib/auth/oidc";

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

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader user={user} portalUrl={portalAppsUrl()} />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
