"use server";

import { redirect } from "next/navigation";

import { endSessionUrl } from "@/lib/auth/oidc";
import { clearServiceMenuCookie } from "@/lib/auth/service-menu-cookie";
import { destroySession } from "@/lib/auth/session";

/**
 * 로그아웃.
 *
 * 이 사이트의 세션을 끊은 뒤 **포털의 로그아웃까지** 다녀온다. 여기 쿠키만
 * 지우면 포털 세션은 그대로라, 로그인 버튼을 한 번 누르는 것만으로 누구인지
 * 다시 묻지도 않고 그대로 들어온다. 자세한 근거는 lib/auth/oidc.ts 의
 * endSessionUrl 주석에 있다.
 *
 * 포털도 백채널 로그아웃으로 이 사이트에 통보하지만, 그 통보를 기다리지
 * 않는다 — 누른 사람의 세션은 지금 끊겨 있어야 한다. 이 브라우저의 쿠키는
 * 여기서 바로 없어지고, 다른 기기에 남은 토큰은 곧 도착할 그 통보가
 * 기준선을 올려 함께 끊는다(lib/auth/session.ts 의 destroySession 주석).
 */
export async function logoutAction(): Promise<void> {
  // 세션이 있었는지 확인하지 않는다. 이미 끊긴 사람이 로그아웃을 눌렀을 때
  // 오류를 보여 줄 이유가 없다 — 원하는 결과는 이미 이루어져 있다.
  await destroySession();
  // 🔴 세션과 함께 서비스 메뉴 목록도 지운다. 남겨 두면 로그아웃한 사람의
  // 브라우저에 「이 사람이 어떤 시스템을 쓰는지」가 그대로 남고, 공용 PC 에서는
  // 뒷사람 화면에 그것이 뜬다. 지우는 것은 redirect 앞이어야 한다 — redirect 는
  // 예외를 던져 이 아래가 돌지 않는다.
  await clearServiceMenuCookie();
  redirect(endSessionUrl());
}
