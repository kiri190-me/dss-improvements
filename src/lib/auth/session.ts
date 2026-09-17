/**
 * 이 사이트의 세션을 읽고 쓰는 유일한 파일.
 *
 * 화면·API 곳곳에서 쿠키를 직접 읽지 않는다. 반드시 여기를 거친다.
 *
 * **서명 토큰**이다 — 쿠키에 담긴 값 자체가 세션이고, 서버에는 그것을
 * 기록해 두는 표가 없다. 값이 위조되지 않았다는 것은 HMAC 서명으로,
 * 아직 살아 있다는 것은 토큰 안의 expiresAt 으로 확인한다.
 * (A/S 시스템 RF_Service_System/src/lib/auth/session.ts 와 같은 방식이다.
 *  2026-09-17 사용자 결정 — 근거는 db/schema.ts 의 "세션 표는 없다" 절.)
 *
 * 🔴 서명 토큰의 유일한 약점은 **발급된 뒤에는 스스로 유효하다**는 것이다.
 *    그래서 포털이 "이 사람 끊어라" 라고 알려올 때 지목할 대상이 없다.
 *    이 파일은 그 구멍을 web_users.sessions_valid_from 한 칸으로 막는다 —
 *    revokeSessionsForSubject 가 그 선을 지금으로 올리고, getSessionUser 가
 *    매 요청 그 선보다 먼저 발급된 토큰을 거절한다. 둘 중 하나라도 빠지면
 *    백채널 로그아웃이 조용히 아무 일도 하지 않게 된다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { USER_ROLES, webUsers, type UserRole, type WebUser } from "@/lib/db/schema";
import { env } from "@/lib/env";

/** 이 사이트 고유 쿠키 이름. 포털의 dss_sso 와 절대 겹치지 않게 한다. */
export const SESSION_COOKIE = "improvements_session";

/**
 * 쿠키에 담기는 값.
 *
 * 여기에 담는 것은 **바뀌어도 8시간쯤 늦게 반영되어도 되는 값**뿐이다.
 * 이름·정지 여부·삭제 여부는 담지 않는다 — 담으면 정지시킨 사람이 토큰이
 * 만료될 때까지 그대로 들어온다. 그런 값은 아래에서 매 요청 행을 읽어 본다.
 *
 * issuedAt 을 담는 이유는 하나뿐이다: sessions_valid_from 과 견주기 위해서다.
 */
export type SessionPayload = {
  /** web_users.id */
  userId: string;
  role: UserRole;
  /** 유닉스 초 */
  issuedAt: number;
  /** 유닉스 초 */
  expiresAt: number;
};

/* ------------------------------------------------------------------ */
/* 서명                                                                 */
/*                                                                      */
/* `payload.signature` 두 토막. payload 는 base64url(JSON) 이라 누구나    */
/* 읽을 수 있다 — 숨기려는 값이 아니라 **바꾸지 못하게** 하려는 값이다.   */
/*                                                                      */
/* 같은 모양의 HMAC 이 auth/oidc.ts 의 왕복 쿠키에도 있다. 합치지 않은    */
/* 이유: 둘은 수명도(10분 ↔ 12시간) 비밀값도(SSO_TX_SECRET ↔              */
/* AUTH_SESSION_SECRET) 다르고, 한쪽 서명 방식을 고칠 때 나머지가 함께     */
/* 딸려 오면 안 되는 자리다. A/S 도 같은 이유로 auth/token.ts 를 따로 둔다.*/
/* ------------------------------------------------------------------ */

function sign(payloadBase64: string): string {
  return createHmac("sha256", env.authSessionSecret).update(payloadBase64).digest("base64url");
}

function signPayload(payload: SessionPayload): string {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadBase64}.${sign(payloadBase64)}`;
}

/**
 * 서명이 맞고, 모양이 맞고, 아직 만료되지 않았을 때만 값을 돌려준다.
 * 그 밖에는 전부 null 이다 — 위조든 잘린 값이든 만료든 호출자에게는
 * "세션이 없다" 하나로만 보인다. 예외를 던지지 않는다.
 */
export function parseSessionToken(token: string): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const payloadBase64 = token.slice(0, dot);
  const presented = token.slice(dot + 1);

  // 문자열 비교는 앞에서부터 다른 지점까지 걸리는 시간이 달라, 서명을 한
  // 글자씩 알아내는 공격이 이론상 가능하다. 길이가 다르면 timingSafeEqual 이
  // 던지므로 먼저 본다.
  const a = Buffer.from(presented);
  const b = Buffer.from(sign(payloadBase64));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  // 서명이 유효해도 role 값 자체는 지금 허용된 목록과 대조한다. 역할 하나를
  // 없애거나 이름을 바꾼 날, 이미 나가 있는 토큰이 그 값을 들고 돌아온다.
  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.role !== "string" ||
    !(USER_ROLES as readonly string[]).includes(candidate.role) ||
    typeof candidate.issuedAt !== "number" ||
    typeof candidate.expiresAt !== "number"
  ) {
    return null;
  }

  if (candidate.expiresAt <= Math.floor(Date.now() / 1000)) return null;

  return candidate as SessionPayload;
}

/* ------------------------------------------------------------------ */
/* 발급 · 읽기 · 끊기                                                    */
/* ------------------------------------------------------------------ */

/**
 * 로그인에 성공한 사람에게 세션 쿠키를 준다.
 *
 * 쿠키의 만료와 토큰 안의 expiresAt 을 같은 값으로 맞춘다. 쿠키 쪽 만료는
 * 브라우저의 호의일 뿐이라 서버가 믿을 것은 토큰 안의 값이고, 쿠키 쪽에도
 * 적어 두는 것은 만료된 쿠키를 브라우저가 알아서 버려 주기 때문이다.
 *
 * 예전(서버 저장형)에는 ip·user_agent 도 함께 남겼다. 그 자리가 없어졌다 —
 * 남기려면 접속 이력 표를 따로 만들 일이다(db/schema.ts 의 "세션 표는 없다").
 */
export async function createSession(user: Pick<WebUser, "id" | "role">): Promise<void> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + env.sessionHours * 60 * 60;

  const token = signPayload({
    userId: user.id,
    role: user.role,
    issuedAt,
    expiresAt,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 사내망 HTTP 단계에서 켜면 쿠키가 저장되지 않아 로그인이 조용히 실패한다.
    secure: env.sessionCookieSecure,
    expires: new Date(expiresAt * 1000),
  });
}

/**
 * 현재 요청의 로그인 사용자. 없으면 null.
 *
 * 토큰이 유효해도 그것만으로 통과시키지 않고 **매 요청 web_users 한 행을
 * 읽는다.** 서명 토큰을 쓰면서도 그렇게 하는 이유는 셋이다.
 *   · sessions_valid_from — 포털이 끊으라고 한 사람을 즉시 끊는다.
 *   · is_active · is_deleted — 정지·삭제된 사람이 토큰 만료까지 남지 않는다.
 *   · 화면에 쓰는 이름·역할이 토큰에 굳지 않고 늘 지금 값이다.
 *
 * 조회 한 번이 아깝지 않은 자리다. 이 검사들을 화면 쪽으로 옮기면 그 화면만
 * 빠뜨리는 날이 온다.
 */
export async function getSessionUser(): Promise<WebUser | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const session = parseSessionToken(raw);
  if (!session) return null;

  const [user] = await db
    .select()
    .from(webUsers)
    .where(
      and(
        eq(webUsers.id, session.userId),
        eq(webUsers.isActive, true),
        eq(webUsers.isDeleted, false),
      ),
    )
    .limit(1);

  if (!user) return null;

  // 포털이 이 사람의 세션을 끊었는가.
  //
  // 이 검사를 여기 둔 이유: 위에서 이미 읽은 행에 들어 있어 조회가 늘지
  // 않는다. 그리고 매 요청 반드시 도는 자리라 빠뜨릴 수 없다.
  //
  // issuedAt 은 초 단위이고 기준선은 밀리초까지 있다. 같은 초에 걸친 토큰은
  // **무효 쪽으로** 기운다 — 끊긴 세션을 살려 두는 것보다 살아 있는 세션을
  // 한 번 더 끊는 편이 안전하다.
  if (user.sessionsValidFrom && session.issuedAt * 1000 < user.sessionsValidFrom.getTime()) {
    return null;
  }

  return user;
}

/**
 * 그 사람의 이 사이트 세션을 전부 끊는다.
 *
 * 포털이 백채널 로그아웃으로 "이 사람 끊어라" 라고 알려올 때 쓴다.
 * 🔴 **서명 토큰을 즉시 무효로 만드는 길은 이것 하나뿐이다.** 기준선을
 * 지금으로 올리면, 그보다 먼저 나간 토큰은 다음 요청에서 getSessionUser 가
 * 전부 거절한다. 이미 열려 있는 화면도 다음 이동에서 포털로 되돌아간다.
 *
 * auth_sub 로 찾는다 — 포털은 사람을 자기 id 로 알지, 이 사이트가 그 사람을
 * 무엇이라 부르는지 모른다. 그리고 그 대조가 곧 안전장치다: 포털이 실제로
 * 관리하는 계정만 이 방법으로 끊을 수 있다.
 *
 * 특정 세션 하나가 아니라 그 사람 전부를 끊는다. 공용 PC 에서 로그아웃한
 * 사람에게는 그편이 기대에 맞고, 정지된 사람에게는 반드시 그래야 한다.
 *
 * 끊을 것이 없으면 false 다. 오류가 아니다 — 이 사이트에 한 번도 들어온 적
 * 없는 사람의 통보일 수 있고, 그때 원하는 상태는 이미 이루어져 있다.
 */
export async function revokeSessionsForSubject(authSub: string): Promise<boolean> {
  if (!authSub) return false;

  const now = new Date();
  const updated = await db
    .update(webUsers)
    .set({ sessionsValidFrom: now, updatedAt: now })
    .where(and(eq(webUsers.authSub, authSub), eq(webUsers.isDeleted, false)))
    .returning({ id: webUsers.id });

  return updated.length > 0;
}

/**
 * 이 브라우저의 세션 쿠키를 지운다. (포털 세션은 그대로 — endSessionUrl 이 맡는다)
 *
 * 쿠키만 지우고 기준선은 올리지 않는다. 즉 **지운 그 토큰은 만료 전까지는
 * 여전히 유효하다** — 다른 곳에 복사해 둔 값이 있다면 살아 있다. 그래도
 * 이대로 두는 이유:
 *
 *   · 로그아웃 버튼은 곧바로 포털의 로그아웃으로 이어지고(actions/auth.ts),
 *     포털은 그 즉시 백채널 로그아웃을 이 사이트로 보낸다. 그 통보가
 *     위 revokeSessionsForSubject 를 불러 기준선을 올린다 — 결국 모든
 *     기기에서 끊긴다. 여기서 또 올리는 것은 같은 일을 두 번 하는 것이다.
 *   · 포털 통보가 오지 않는 상황(등록 전, 포털이 꺼져 있음)에서 여기서
 *     기준선을 올려 버리면, 한 기기에서 나간 것만으로 다른 기기가 함께
 *     끊긴다. 서버 저장형이었을 때는 그러지 않았다 — 조용히 달라지는 동작은
 *     만들지 않는다.
 *
 * (A/S 시스템의 로그아웃도 자기 쿠키만 지운다. 같은 이유다.)
 */
export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
