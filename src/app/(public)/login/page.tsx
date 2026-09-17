import { redirect } from "next/navigation";

import { safeReturnTo } from "@/lib/auth/guards";
import { getSessionUser } from "@/lib/auth/session";

/**
 * 로그인 화면.
 *
 * 이 사이트는 아이디도 비밀번호도 받지 않는다. 버튼 하나로 포털(dss-auth)에
 * 넘기고, 포털이 확인해 준 결과만 받는다. 자체 로그인을 만들지 않는 것이
 * 이 프로젝트의 전제다.
 *
 * ⚠️ 평소에는 이 화면을 거치지 않는다. 세션이 없으면 requireSession 이 곧장
 * /api/auth/sso/start 로 보낸다(guards.ts 에 이유가 있다). 이 화면은 로그인이
 * **거절됐을 때** 이유를 보여주는 자리다 — 그래서 여기서는 자동으로 다시
 * 보내지 않는다. 보내면 거절 → 자동 재시도 → 거절의 무한 왕복이 된다.
 */

/** 콜백이 /login?error=... 로 실어 보내는 거절 사유. 사유마다 할 일이 다르다. */
function errorMessage(code: string | undefined): string | null {
  switch (code) {
    case undefined:
      return null;
    case "expired":
    case "state":
      return "로그인 시도가 만료되었거나 중간에 끊겼습니다. 다시 시도해 주세요.";
    case "unknown_role":
      return "통합 로그인에 이 시스템이 모르는 역할이 지정되어 있습니다. 관리자에게 알려 주세요.";
    case "inactive":
      return "이 시스템에서 사용이 중지된 계정입니다. 관리자에게 문의해 주세요.";
    case "deleted":
      return "이 시스템에서 삭제된 계정입니다. 관리자에게 문의해 주세요.";
    default:
      return "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // 이미 로그인되어 있으면 첫 화면으로 보낸다.
  if (await getSessionUser()) redirect("/");

  const returnTo = safeReturnTo(typeof sp.returnTo === "string" ? sp.returnTo : undefined);
  const error = errorMessage(typeof sp.error === "string" ? sp.error : undefined);

  const startUrl =
    returnTo === "/"
      ? "/api/auth/sso/start"
      : `/api/auth/sso/start?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">DSS 개선요청</h1>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="space-y-3 rounded-lg border border-slate-200 bg-white px-5 py-6">
          <p className="text-sm text-slate-600">
            사내 통합 로그인으로 들어옵니다. 이 사이트는 따로 아이디와 비밀번호를 받지
            않습니다.
          </p>

          <a
            href={startUrl}
            className="block w-full rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-slate-700"
          >
            통합 로그인으로 들어가기
          </a>

          <p className="text-xs text-slate-400">
            들어오지 못하면 통합 로그인에서 이 시스템 권한을 받았는지 확인해 주세요.
          </p>
        </div>
      </div>
    </div>
  );
}
