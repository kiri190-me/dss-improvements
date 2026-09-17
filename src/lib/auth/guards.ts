/**
 * 권한 판정은 여기서만 한다.
 *
 * 클라이언트가 보낸 사용자 ID·역할은 절대 믿지 않는다.
 * 폼 필드·쿼리스트링·요청 본문에 담겨 온 값으로 권한을 판정하지 않는다.
 * 화면에서 버튼을 숨기는 것은 UI 편의일 뿐이고, 실제 차단은 반드시 서버에서 한다.
 */
import { redirect } from "next/navigation";

import type { WebUser } from "@/lib/db/schema";
import { getSessionUser } from "./session";

/**
 * 로그인 후 돌아갈 주소를 안전하게 다듬는다.
 *
 * '/' 로 시작하고 '//' 로 시작하지 않는 경로만 허용한다.
 * '//evil.com' 은 브라우저가 프로토콜 상대 URL 로 해석하므로 반드시 함께 막는다
 * — 막지 않으면 이 사이트의 로그인 링크가 남의 사이트로 보내는 열린 리다이렉트가 된다.
 * 역슬래시가 섞인 값도 거절한다(일부 브라우저가 '/' 로 고쳐 읽는다).
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

/**
 * 로그인 필수. 없으면 포털로 곧장 보낸다.
 *
 * `/login` 화면을 거치지 않는 이유: 이 사이트에는 자체 로그인이 없어서 그
 * 화면에 있는 것이라고는 "포털로 가세요" 버튼 하나뿐이다. 포털 앱 런처에서
 * 타일을 눌러 들어온 사람은 방금 포털에서 왔는데 포털로 가라는 화면을 다시
 * 보게 되고, 그 버튼을 눌러도 이미 로그인된 포털을 그대로 통과해 돌아온다.
 * 아무것도 묻지 않는 화면이라면 보여줄 이유가 없다.
 *
 * `/login` 은 남는다 — 로그인이 **거절됐을 때** 이유를 보여줄 자리가 필요하고,
 * 거기서는 자동으로 다시 보내지 않는다(그러면 무한 왕복이 된다).
 */
export async function requireSession(returnTo?: string): Promise<WebUser> {
  const user = await getSessionUser();
  if (!user) {
    const target = safeReturnTo(returnTo);
    redirect(
      target === "/"
        ? "/api/auth/sso/start"
        : `/api/auth/sso/start?returnTo=${encodeURIComponent(target)}`,
    );
  }
  return user;
}

/**
 * 관리자 필수.
 *
 * 아직 관리자 전용 화면이 없다 — 개선요청 기능이 다음 조각이라 그렇다.
 * 그래도 지금 두는 이유: 나중에 급히 만들 때 requireSession 만 부르고
 * 역할 검사를 화면 안에 손으로 적는 일이 실제로 일어난다. 부를 자리가
 * 먼저 있으면 그 일이 덜 일어난다.
 */
export async function requireAdmin(returnTo?: string): Promise<WebUser> {
  const user = await requireSession(returnTo);
  if (user.role !== "ADMIN") {
    redirect("/");
  }
  return user;
}

export function isAdmin(user: Pick<WebUser, "role"> | null): boolean {
  return user?.role === "ADMIN";
}
