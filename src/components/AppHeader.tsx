import { logoutAction } from "@/app/actions/auth";
import type { WebUser } from "@/lib/db/schema";

/**
 * 머리말.
 *
 * 서버 컴포넌트다 — "use client" 를 붙이지 않는다. 로그아웃은 서버 액션을
 * 부르는 평범한 <form> 이라 자바스크립트 없이도 동작한다. 사내망에서
 * 스크립트가 늦게 붙는 동안 눌러도 제대로 나가진다.
 *
 * 「통합 로그인으로」 버튼은 포털 앱 런처로 간다. 로그아웃과 다르다 —
 * 세션을 끊지 않으므로 돌아오면 그대로 들어와 있다.
 */
export function AppHeader({
  user,
  portalUrl,
}: {
  user: WebUser;
  portalUrl: string;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-4 py-3">
        <h1 className="text-base font-semibold text-slate-900">DSS 개선요청</h1>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600">
            {user.displayName}
            {user.role === "ADMIN" && (
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                관리자
              </span>
            )}
          </span>

          <a
            href={portalUrl}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            통합 로그인으로
          </a>

          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
