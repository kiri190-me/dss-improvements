import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

/**
 * ============================================================================
 * 서비스 메뉴바 목록을 나르는 별도 서명 쿠키
 * ============================================================================
 * 세션 쿠키(improvements_session)와 **갈라 둔** 값이다. 담긴 것은 인가 자료가
 * 아니라 「그릴 목록」이고, 그래서 이 파일이 지키는 것도 넷뿐이다:
 *
 *  1. 포털이 목록을 안 보내면(아직 배포 전이다) 토큰이 null 이다 — 쿠키를
 *     굽지 않으니 로그인은 예전과 똑같이 끝나고 띠도 안 그려진다.
 *  2. 보내면 굽고, 그 쿠키는 **서명되어 있다** — 위조·변조하면 거절된다.
 *  3. 수명은 세션 쿠키와 같다.
 *  4. 무엇이 들어오든 **던지지 않는다** — 띠 때문에 본문이 죽어서는 안 된다.
 *
 * 쿠키를 굽고 지우는 자리(로그인 통로·로그아웃)는 next/headers 의 요청 맥락이
 * 있어야 돌아가므로 여기서 부르지 못한다. 그 자리는 소스로 못 박는다
 * (service-menu-wiring.test.ts).
 * ============================================================================
 */

import { env } from "@/lib/env";

import {
  createServiceMenuToken,
  parseServiceMenuToken,
  SERVICE_MENU_COOKIE,
} from "./service-menu-cookie";

// env.ts 는 getter 라 값을 **쓰는 순간** 읽는다. 시험이 돌기 전에 여기서 넣어
// 두면 충분하다(모듈 적재 순서에 매이지 않는다 — 위 모듈들은 불릴 때 읽는다).
// 32자 이상이어야 한다: env.ts 의 authSessionSecret 이 짧은 서명 키를 거절한다.
process.env.AUTH_SESSION_SECRET = "test-secret-only-for-unit-tests-0123456789";

/** 이 저장소가 쓰는 것과 같은 모양의 서명 — 시험이 제 손으로 토큰을 지어 본다. */
function forge(payload: unknown, secret: string): string {
  const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${base64}.${createHmac("sha256", secret).update(base64).digest("base64url")}`;
}

const SECRET = process.env.AUTH_SESSION_SECRET as string;

const SERVICES = [
  { id: "rf-service-system", name: "A/S 관리", url: "http://10.0.0.5:3000", icon: "🔧" },
  { id: "njlee", name: "계측기", url: "http://10.0.0.5:3300" },
];

// session.ts 를 import 하지 않는다 — 그 파일은 db/index.ts 를 타고, 그 모듈은
// 불리는 순간 DATABASE_URL 을 읽어 접속 풀을 만든다. 이 목록의 시험은 DB 에
// 닿을 길이 없어야 한다(scripts/test-lists/unit.txt 머리말). 그래서 세션 쿠키
// 이름은 글자로 적어 견준다.
const SESSION_COOKIE_NAME = "improvements_session";

test("쿠키 이름이 세션 쿠키와 다르다 — 굽고 지우는 곳이 이 이름 하나를 나눠 쓴다", () => {
  assert.equal(SERVICE_MENU_COOKIE, "improvements_service_menu");
  assert.notEqual(SERVICE_MENU_COOKIE, SESSION_COOKIE_NAME);
});

test("🔴 dss_services 클레임이 없으면 토큰이 null 이다 — 쿠키를 굽지 않는다(포털 배포 전 상태)", () => {
  assert.equal(createServiceMenuToken(undefined), null);
  assert.equal(createServiceMenuToken(null), null);
  // 배열이 아니거나, 배열이어도 그릴 수 있는 칸이 하나도 없으면 같은 취급이다.
  assert.equal(createServiceMenuToken("dss-improvements"), null);
  assert.equal(createServiceMenuToken([]), null);
  assert.equal(createServiceMenuToken([{ id: "x", name: "주소 없음" }]), null);
  assert.equal(
    createServiceMenuToken([{ id: "x", name: "나쁜 주소", url: "javascript:alert(1)" }]),
    null,
  );
});

test("클레임이 있으면 구운 토큰이 같은 목록으로 되돌아온다(차례도 그대로)", () => {
  const token = createServiceMenuToken(SERVICES);
  assert.ok(token);
  assert.deepEqual(parseServiceMenuToken(token), SERVICES);
});

test("그릴 수 없는 칸만 걸러 낸다 — 나머지 칸은 남는다", () => {
  const token = createServiceMenuToken([
    { id: "dss-improvements", name: "개선요청", url: "/" },
    { id: "", name: "빈 id", url: "http://10.0.0.5:3000" },
    { id: "bad", name: "나쁜 주소", url: "javascript:alert(1)" },
    { id: "dss-improvements", name: "겹친 id", url: "http://10.0.0.5:3300" },
  ]);
  assert.ok(token);
  assert.deepEqual(parseServiceMenuToken(token), [
    { id: "dss-improvements", name: "개선요청", url: "/" },
  ]);
});

test("🔴 서명이 붙어 있다 — 페이로드를 고치면 서명이 어긋나 빈 목록이 된다", () => {
  const token = createServiceMenuToken(SERVICES);
  assert.ok(token);
  const [payload, signature] = token.split(".");
  assert.ok(payload && signature, "토큰이 payload.signature 모양이 아니다");

  // 브라우저에서 값을 바꿔 가짜 링크를 심으려는 시도.
  const now = Math.floor(Date.now() / 1000);
  const forgedPayload = Buffer.from(
    JSON.stringify({
      services: [{ id: "evil", name: "가짜", url: "http://10.0.0.9:9999" }],
      issuedAt: now,
      expiresAt: now + 3600,
    }),
    "utf8",
  ).toString("base64url");

  assert.deepEqual(parseServiceMenuToken(`${forgedPayload}.${signature}`), []);
  assert.deepEqual(parseServiceMenuToken(`${payload}.${signature}xx`), []);
  assert.deepEqual(parseServiceMenuToken(forgedPayload), []);
  assert.deepEqual(parseServiceMenuToken(""), []);
  assert.deepEqual(parseServiceMenuToken(".서명만"), []);
});

test("🔴 다른 비밀값으로 서명한 토큰은 거절된다", () => {
  const now = Math.floor(Date.now() / 1000);
  const foreign = forge(
    { services: SERVICES, issuedAt: now, expiresAt: now + 3600 },
    "another-secret-that-is-long-enough-0123456789",
  );
  assert.deepEqual(parseServiceMenuToken(foreign), []);
});

test("수명이 세션 쿠키와 같고, 지난 토큰은 빈 목록이 된다", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createServiceMenuToken(SERVICES);
  assert.ok(token);

  const decoded = JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
  ) as { issuedAt: number; expiresAt: number };
  assert.equal(decoded.expiresAt - decoded.issuedAt, env.sessionHours * 60 * 60);
  assert.ok(Math.abs(decoded.issuedAt - now) <= 5);

  const expired = forge(
    { services: SERVICES, issuedAt: now - 10, expiresAt: now - 1 },
    SECRET,
  );
  assert.deepEqual(parseServiceMenuToken(expired), []);
});

test("서명은 맞지만 안이 이상한 토큰도 죽지 않고 빈 목록이 된다 — 띠 때문에 본문이 죽어서는 안 된다", () => {
  const after = Math.floor(Date.now() / 1000) + 3600;

  assert.deepEqual(parseServiceMenuToken(forge("문자열", SECRET)), []);
  assert.deepEqual(parseServiceMenuToken(forge(null, SECRET)), []);
  // 만료 시각이 없는 토큰은 「언제까지나 유효한 토큰」이 되므로 거절한다.
  assert.deepEqual(parseServiceMenuToken(forge({ services: SERVICES }, SECRET)), []);
  assert.deepEqual(
    parseServiceMenuToken(forge({ services: "배열이 아님", expiresAt: after }, SECRET)),
    [],
  );
  assert.deepEqual(
    parseServiceMenuToken(forge({ services: [1, 2, 3], expiresAt: after }, SECRET)),
    [],
  );
});
