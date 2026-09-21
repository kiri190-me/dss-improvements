import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  RETURN_TO_FALLBACK,
  RETURN_TO_MAX_LENGTH,
  safeReturnTo,
} from "@/lib/auth/return-to";

/**
 * ============================================================================
 * 🔴 「가려던 주소로 보내 준다」가 피싱 통로가 되지 않게 못 박는다
 * ============================================================================
 * 통합 알림에서 다른 시스템의 깊은 주소를 눌러 건너오면 로그인이 한 번 돌고,
 * 그 뒤 **원래 가려던 화면**으로 도착해야 한다. 그 편의가 열린 전달(open
 * redirect)이 되면, 우리 도메인으로 시작하는 링크가 진짜 통합 로그인을 거친
 * 뒤 공격자 사이트로 떨어진다 — 사람은 그것을 우리 화면으로 믿는다.
 *
 * 그래서 이 파일은 **거절해야 하는 모양을 하나씩** 적어 둔다. 새로 허용을
 * 넓히려는 사람은 여기 걸린다.
 *
 * 아래 둘째 묶음은 **구조**를 본다: 돌아갈 주소가 어디서 들어와 어디로
 * 나가는지, 포털이 돌려보낸 주소를 믿지는 않는지. 그 자리들은 쿠키와 포털
 * 없이는 실제로 불러 볼 수 없어서 글자로 확인한다
 * (service-menu-wiring.test.ts 와 같은 방식이다).
 * ============================================================================
 */

/* 역슬래시와 제어문자는 **글자로 적지 않는다** — 편집기·도구를 거치며 한 겹이
   조용히 사라지면, 막으려던 입력이 아닌 것을 시험하면서 통과하게 된다. */
const BACKSLASH = String.fromCharCode(0x5c);
const TAB = String.fromCharCode(0x09);
const LINE_FEED = String.fromCharCode(0x0a);
const CARRIAGE_RETURN = String.fromCharCode(0x0d);
const NUL = String.fromCharCode(0x00);

/* ── 1. 🔴 거절해야 하는 입력 ─────────────────────────────────────────── */

test("🔴 다른 사이트를 가리키는 값은 전부 첫 화면으로 떨군다", () => {
  const rejected: [string, string][] = [
    ["https://evil.example/x", "다른 사이트"],
    ["http://evil.example/x", "다른 사이트"],
    ["https:/evil.example", "슬래시 하나짜리 변형"],
    ["//evil.example/x", "🔴 프로토콜 생략 형태 — 브라우저가 다른 사이트로 읽는다"],
    ["//evil.example", "🔴 프로토콜 생략 형태"],
    [`/${BACKSLASH}evil.example`, "🔴 역슬래시 — 브라우저가 '/' 처럼 다룬다"],
    [`${BACKSLASH}${BACKSLASH}evil.example`, "🔴 역슬래시 둘"],
    [`/login?error=a${BACKSLASH}b`, "뒤쪽에 섞인 역슬래시"],
    ["/%2F%2Fevil.example", "🔴 인코딩 — 한 번 풀면 '//' 가 된다"],
    ["/%2f%2fevil.example", "🔴 인코딩(소문자)"],
    ["/%5Cevil.example", "🔴 인코딩된 역슬래시"],
    ["javascript:alert(1)", "스크립트 실행"],
    ["JavaScript:alert(1)", "스크립트 실행(대소문자 섞기)"],
    ["data:text/html,<script>alert(1)</script>", "스크립트 실행"],
    [" //evil.example", "앞의 빈칸으로 가린 프로토콜 생략 형태"],
    ["evil.example", "슬래시로 시작하지 않는 값"],
    [`/${LINE_FEED}/evil.example`, "🔴 줄바꿈 — 브라우저가 지우면 '//' 가 된다"],
    [`/${CARRIAGE_RETURN}/evil.example`, "🔴 복귀문자"],
    [`/${TAB}/evil.example`, "🔴 탭"],
    [`/login${NUL}?error=x`, "🔴 널문자"],
    ["/%0A/evil.example", "🔴 인코딩된 줄바꿈"],
    ["/%09/evil.example", "🔴 인코딩된 탭"],
    ["/login?error=%zz", "반쪽짜리 퍼센트 — 무엇이 될지 모르면 거절한다"],
  ];

  for (const [value, why] of rejected) {
    assert.equal(
      safeReturnTo(value),
      RETURN_TO_FALLBACK,
      `${JSON.stringify(value)} 를 받아들였다 (${why})`,
    );
  }
});

test("🔴 로그인 통로 자신을 가리키는 값은 거절한다 — 무한 되돌기가 된다", () => {
  for (const value of [
    "/api/auth/sso/start",
    "/api/auth/sso/start?returnTo=/",
    "/api/auth/sso/callback?code=abc&state=def",
    "/api/auth/sso/backchannel-logout",
    "/API/AUTH/SSO/START",
    "/api/auth",
  ]) {
    assert.equal(safeReturnTo(value), RETURN_TO_FALLBACK, `${value} 를 받아들였다`);
  }
});

test("🔴 길이 상한을 넘으면 거절한다 — improvements_sso_tx 쿠키가 통째로 싣고 다닌다", () => {
  const atLimit = `/${"a".repeat(RETURN_TO_MAX_LENGTH - 1)}`;
  assert.equal(atLimit.length, RETURN_TO_MAX_LENGTH);
  assert.equal(safeReturnTo(atLimit), atLimit, "상한과 같은 길이는 통과해야 한다");

  assert.equal(safeReturnTo(`${atLimit}a`), RETURN_TO_FALLBACK, "한 글자 넘은 값");
  assert.equal(
    safeReturnTo(`/${"a".repeat(10_000)}`),
    RETURN_TO_FALLBACK,
    "아주 긴 값",
  );

  // 🔴 한글은 퍼센트 인코딩으로 아홉 배가 된다. 날것의 길이만 보면 상한이
  // 여섯 배로 새는데, 그 셈이 쿠키 한도(4096바이트)를 정한다.
  const manyHangul = `/?status=${"결".repeat(80)}`;
  assert.ok(manyHangul.length < RETURN_TO_MAX_LENGTH, "날것으로는 상한 안이다");
  assert.equal(
    safeReturnTo(manyHangul),
    RETURN_TO_FALLBACK,
    "인코딩하면 상한을 넘는데 통과시켰다 — 쿠키가 여섯 배로 커진다",
  );
});

test("값이 없으면 첫 화면이다", () => {
  assert.equal(safeReturnTo(null), RETURN_TO_FALLBACK);
  assert.equal(safeReturnTo(undefined), RETURN_TO_FALLBACK);
  assert.equal(safeReturnTo(""), RETURN_TO_FALLBACK);
});

/* ── 2. 허용해야 하는 입력 ────────────────────────────────────────────── */

test("이 사이트 안의 깊은 주소는 그대로 살아 돌아온다", () => {
  // 🔴 이 판정은 **주소록을 보지 않는다** — 이 사이트에 그 화면이 있는지는
  // 라우터가 정하고(없으면 404), 여기서는 「이 사이트 밖인가」만 본다. 지금
  // 이 사이트의 화면은 목록 한 장뿐이지만, 통합 알림이 나르게 될 깊은 주소를
  // 미리 못 박아 두는 이유가 그것이다 — 나중에 화면이 늘어도 이 파일은 그대로다.
  for (const value of [
    "/",
    "/login?error=inactive",
    "/api/improvement-requests/abc-123/attachments",
    "/?status=RECEIVED",
    "/?status=RECEIVED&page=2#r-3",
    "/?q=50%25",
    "/%EC%A0%91%EC%88%98",
  ]) {
    assert.equal(safeReturnTo(value), value, `${value} 가 달라졌다`);
  }
});

test("🔴 물음표 · '#' · 한글이 온전히 살아 돌아온다 — 머리말에 실을 수 있는 모습으로", () => {
  const wanted = "/?status=접수#r-3";
  const got = safeReturnTo(wanted);

  assert.equal(got, "/?status=%EC%A0%91%EC%88%98#r-3");
  // 뜻이 하나도 바뀌지 않았다 — 주소창과 화면의 searchParams 는 원래 글자를 본다.
  assert.equal(decodeURIComponent(got), wanted);

  // 🔴 이 인코딩이 없으면 로그인이 500 으로 끝난다: 응답 머리말의 값은
  // ByteString(0~255)이라 "접"(U+C811) 을 그대로 넣으면 여기서 TypeError 가 난다.
  assert.doesNotThrow(() => new Response(null, { status: 303, headers: { Location: got } }));
  assert.throws(() => new Response(null, { status: 303, headers: { Location: wanted } }));
});

test("한 번 더 거쳐도 같은 값이다 — 통로를 오가며 겹겹이 인코딩되지 않는다", () => {
  // 실제 흐름이 이렇다: guards 가 encodeURIComponent 로 싣고 → 시작 통로의
  // searchParams.get 이 한 겹 풀고 → 다시 이 함수를 거친다.
  for (const value of ["/?status=접수#r-3", "/login?error=inactive", "/?q=50%25"]) {
    const once = safeReturnTo(value);
    const carried = new URLSearchParams(`returnTo=${encodeURIComponent(once)}`).get("returnTo");
    assert.equal(safeReturnTo(carried), once, `${value} 가 왕복에서 달라졌다`);
  }
});

test("🔴 상한 길이의 주소를 담아도 improvements_sso_tx 쿠키가 브라우저 한도(4096) 안이다", () => {
  // oidc.ts 의 sealTransaction 은 env(비밀키)를 요구해 이 목록에서는 부를 수
  // 없다. 대신 그 파일이 담는 **모양 그대로** 크기만 재 본다 — 칸이 늘면
  // 여기서 먼저 걸린다.
  const transaction = {
    state: "s".repeat(43),
    nonce: "n".repeat(43),
    codeVerifier: "v".repeat(86),
    returnTo: `/${"a".repeat(RETURN_TO_MAX_LENGTH - 1)}`,
    expiresAt: 1_800_000_000,
  };
  const payload = Buffer.from(JSON.stringify(transaction), "utf8").toString("base64url");
  const cookieValue = `${payload}.${"g".repeat(43)}`;

  assert.ok(
    cookieValue.length < 4096,
    `improvements_sso_tx 가 ${cookieValue.length}바이트다 — 넘으면 브라우저가 조용히 저장하지 않아 로그인이 「만료」로 끝난다`,
  );
});

/* ── 3. 구조 — 어디서 들어와 어디로 나가는가 ──────────────────────────── */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 걷어 낸 코드. 주석에 적힌 낱말이 시험을 통과시키지 않게. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const start = withoutComments(read("src/app/api/auth/sso/start/route.ts"));
const callback = withoutComments(read("src/app/api/auth/sso/callback/route.ts"));
const guards = withoutComments(read("src/lib/auth/guards.ts"));
const oidc = withoutComments(read("src/lib/auth/oidc.ts"));
const loginPage = withoutComments(read("src/app/(public)/login/page.tsx"));

test("🔴 바깥에서 들어온 주소는 예외 없이 safeReturnTo 를 거친다", () => {
  // 시작 통로: 쿼리에서 꺼내는 순간 검사를 거친다.
  assert.match(
    start,
    /const returnTo = safeReturnTo\(new URL\(request\.url\)\.searchParams\.get\("returnTo"\)\);/,
  );
  // 날것을 따로 꺼내 쓰는 자리가 없어야 한다 — 한 번이라도 새면 검사가 무의미해진다.
  assert.equal(
    (start.match(/searchParams\.get\("returnTo"\)/g) ?? []).length,
    1,
    "시작 통로가 returnTo 를 두 번 이상 꺼낸다 — 검사를 지나친 값이 있을 수 있다",
  );

  // 문지기: 화면이 건넨 값도 믿지 않는다.
  assert.match(guards, /const target = safeReturnTo\(returnTo\);/);
  // 로그인 화면: 주소창의 ?returnTo= 도 마찬가지다.
  assert.match(loginPage, /safeReturnTo\(typeof sp\.returnTo === "string"/);
});

test("🔴 돌아갈 주소는 **서명된 쿠키**에서만 나온다 — 포털이 돌려보낸 쿼리를 믿지 않는다", () => {
  // 포털은 code 와 state 만 돌려보낸다. 콜백이 거기서 돌아갈 주소를 읽으면,
  // 서명 밖의 값이 마지막 이동을 정하게 된다 — 쿠키에 담아 나르는 까닭이 그것이다.
  assert.equal(
    /params\.get\("returnTo"\)/.test(callback),
    false,
    "콜백이 포털이 돌려보낸 쿼리에서 돌아갈 주소를 읽는다",
  );
  assert.match(callback, /return redirectTo\(transaction\.returnTo\);/);

  // 그 쿠키는 서명과 만료를 확인한 뒤에야 열린다(oidc.ts 의 openTransaction).
  assert.match(callback, /const transaction = openTransaction\(/);
  assert.match(oidc, /typeof tx\.returnTo !== "string"/);
});

test("🔴 로그인에 성공했을 때만 그 주소로 간다 — 실패는 /login?error= 로 간다", () => {
  const redirectAt = callback.indexOf("return redirectTo(transaction.returnTo);");
  const sessionAt = callback.indexOf("await createSession(result.user);");
  assert.ok(sessionAt > 0, "세션을 만드는 자리를 찾지 못했다");
  assert.ok(redirectAt > sessionAt, "세션을 만들기 전에 돌아갈 주소로 보낸다");

  // 거절하는 길은 모두 fail(...) 로 모이고, fail 은 /login?error= 로만 간다.
  assert.match(
    callback,
    /const fail = async \(reason: string\)[\s\S]*?return redirectTo\(`\/login\?error=\$\{encodeURIComponent\(reason\)\}`\);/,
  );
});

test("🔴 가려던 주소는 한 번 쓰고 버린다 — 쿠키에 남겨 두지 않는다", () => {
  // 돌아갈 주소를 담은 쿠키는 왕복이 끝나면 지워진다. 성공한 길에서도,
  // 거절된 길에서도 지운다(지우지 않으면 다음 로그인이 남의 주소로 끝난다).
  assert.match(callback, /async function clearTransactionCookie\(\): Promise<void> \{/);
  assert.match(callback, /maxAge: 0,/);
  assert.match(callback, /await clearTransactionCookie\(\);\n  return redirectTo\(transaction\.returnTo\);/);

  const failBlock = callback.slice(callback.indexOf("const fail = async"));
  assert.match(
    failBlock.slice(0, failBlock.indexOf("};")),
    /await clearTransactionCookie\(\);/,
    "거절된 길에서 왕복 쿠키를 남긴다",
  );

  // 쿠키는 이 왕복에만 쓰이므로 경로가 좁다 — 나머지 요청에 딸려 나가지 않는다.
  assert.match(oidc, /export const SSO_TX_COOKIE_PATH = "\/api\/auth\/sso";/);
});

test("이미 들어와 있는 사람은 포털을 거치지 않고 곧장 그 화면으로 간다", () => {
  const guardAt = start.indexOf("if (await getSessionUser())");
  const beginAt = start.indexOf("beginLogin(returnTo)");
  assert.ok(guardAt > 0 && beginAt > guardAt, "이미 들어와 있는 사람을 돌려보내는 자리가 없다");
  assert.match(
    start.slice(guardAt, beginAt),
    /Location: returnTo/,
    "들어와 있는 사람을 첫 화면으로만 보내고 있다",
  );
});
