import assert from "node:assert/strict";
import test from "node:test";

import { env, ownBaseUrlFrom } from "./env";

/**
 * ============================================================================
 * 🔴 이 사이트 자신의 주소 — 알림 링크가 밖에서 닿는 주소여야 한다
 * ============================================================================
 * 2026-09-29 운영에서 난 일: 0.2 를 배포한 날 A/S 의 종에 뜬 개선요청 알림의
 * 링크가 `http://172.20.0.7:3500/` 이었다. 도커가 컨테이너에 준 주소라 밖에서는
 * 아무도 닿지 못한다. 그때 `ownBaseUrl` 은 「이 기계의 첫 사설 IPv4」
 * (primaryLanAddress)로 주소를 만들고 있었다 — 개발 PC 에서는 192.168.x.x 라
 * 맞아 보였고, 컨테이너 안에서만 틀렸다.
 *
 * 포털은 「절대 주소이고 http 니까」 그대로 통과시킨다(dss-auth 의
 * notifications/merge.ts 의 isNavigableHref). 그래서 **조용히** 틀린다 —
 * 시험으로 못 박아 두지 않으면 다음 배포에서 또 같은 모양으로 샌다.
 *
 * 여기서 못 박는 것 넷:
 *  1. 🔴 주소는 **SSO_REDIRECT_URI** 에서만 온다. 기계의 랜 주소도, 도커가 준
 *     주소도 섞이지 않는다 — 등록된 주소가 글자 그대로 나온다.
 *  2. 개발의 `auto` 도 동작한다(ssoRedirectUri 가 먼저 풀고, 우리는 경로만 뗀다).
 *  3. 콜백 경로로 끝나지 않으면 **던진다.** 조용히 물러서지 않는다.
 *  4. 설정이 없으면 던진다 — 기본값으로 넘어가지 않는다(env.ts 머리말의 규칙).
 *
 * DB 도 네트워크도 부르지 않는다 — 환경변수를 읽는 순수 계산이다(unit.txt 의 규칙).
 * ============================================================================
 */

const CALLBACK_PATH = "/api/auth/sso/callback";

/** 포털에 등록된 운영 값(dss-deploy 의 improvements.env 와 같은 모양). */
const REGISTERED = `https://improvements.dss21.co.kr${CALLBACK_PATH}`;

/**
 * SSO_REDIRECT_URI 를 잠깐 바꿔 놓고 돌린다.
 *
 * `npm test` 는 부트스트랩을 싣지 않아 이 값이 원래 없다(unit.txt). 그래도
 * 되돌려 놓는다 — 한 파일 안의 시험끼리 순서에 기대지 않게.
 */
function withRedirectUri<T>(value: string, run: () => T): T {
  const before = process.env.SSO_REDIRECT_URI;
  process.env.SSO_REDIRECT_URI = value;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.SSO_REDIRECT_URI;
    else process.env.SSO_REDIRECT_URI = before;
  }
}

/* ── 1. 🔴 등록된 주소가 나온다 (컨테이너 주소가 아니라) ───────────────── */

test("🔴 ownBaseUrl 은 포털에 등록된 주소다 — 도커가 준 내부 주소가 아니다", () => {
  withRedirectUri(REGISTERED, () => {
    assert.equal(env.ownBaseUrl, "https://improvements.dss21.co.kr");
  });
});

test("🔴 이 기계의 주소가 섞일 길이 없다 — 172.x·192.168.x 도, 포트 3500 도 붙지 않는다", () => {
  // 옛 방식(resolveAutoUrl("auto", 3500, primaryLanAddress()))이 살아 있으면
  // 등록값과 상관없이 `http://<사설 IPv4>:3500` 이 나와 이 시험이 깨진다.
  withRedirectUri(REGISTERED, () => {
    const own = env.ownBaseUrl;
    assert.equal(own, REGISTERED.slice(0, -CALLBACK_PATH.length));
    assert.equal(/^\s*https?:\/\/(\d{1,3}\.){3}\d{1,3}(:|$)/.test(own), false, `🔴 IP 주소가 나왔다: ${own}`);
    assert.equal(own.includes(":3500"), false, `🔴 컨테이너 안쪽 포트가 붙었다: ${own}`);
  });
});

test("사내망 IP 로 등록된 시스템도 그 등록값 그대로다", () => {
  // 등록값이 도메인이든 IP 든 우리는 판단하지 않는다 — 포털에 적힌 글자가 곧 답이다.
  withRedirectUri(`http://192.168.1.132:3500${CALLBACK_PATH}`, () => {
    assert.equal(env.ownBaseUrl, "http://192.168.1.132:3500");
  });
});

/* ── 2. 개발의 auto ───────────────────────────────────────────────────── */

test("🔴 개발의 auto 도 동작한다 — ssoRedirectUri 가 먼저 풀고 경로만 뗀다", () => {
  withRedirectUri("auto", () => {
    let resolved: string;
    try {
      resolved = env.ssoRedirectUri;
    } catch {
      // 랜/Wi-Fi 가 없는 기계에서는 ssoRedirectUri 가 먼저 던진다. 그때 ownBaseUrl 도
      // 같이 던져야 한다 — 조용히 다른 주소로 물러서지 않는 것이 이 시험의 요점이다.
      assert.throws(() => env.ownBaseUrl);
      return;
    }
    assert.match(resolved, new RegExp(`^http://[\\d.]+:\\d+${CALLBACK_PATH}$`));
    assert.equal(env.ownBaseUrl, resolved.slice(0, -CALLBACK_PATH.length));
  });
});

test("auto:포트 도 동작한다 — 같은 길로 흐른다", () => {
  withRedirectUri("auto:13500", () => {
    let resolved: string;
    try {
      resolved = env.ssoRedirectUri;
    } catch {
      assert.throws(() => env.ownBaseUrl);
      return;
    }
    assert.equal(env.ownBaseUrl, resolved.slice(0, -CALLBACK_PATH.length));
    assert.ok(env.ownBaseUrl.endsWith(":13500"));
  });
});

/* ── 3. 🔴 틀린 값은 던진다 ───────────────────────────────────────────── */

test("🔴 콜백 경로로 끝나지 않으면 던진다 — 알림 링크에 콜백 경로가 실려 나가지 않게", () => {
  assert.throws(() => ownBaseUrlFrom("https://improvements.dss21.co.kr"), /SSO_REDIRECT_URI/);
  assert.throws(() => ownBaseUrlFrom("https://improvements.dss21.co.kr/"), /SSO_REDIRECT_URI/);
  assert.throws(
    () => ownBaseUrlFrom("https://improvements.dss21.co.kr/api/auth/sso/callback/"),
    /SSO_REDIRECT_URI/,
  );
  withRedirectUri("https://improvements.dss21.co.kr/login", () => {
    assert.throws(() => env.ownBaseUrl, /SSO_REDIRECT_URI/);
  });
});

test("🔴 SSO_REDIRECT_URI 가 없으면 던진다 — 기본값으로 넘어가지 않는다", () => {
  const before = process.env.SSO_REDIRECT_URI;
  delete process.env.SSO_REDIRECT_URI;
  try {
    assert.throws(() => env.ownBaseUrl, /SSO_REDIRECT_URI/);
  } finally {
    if (before !== undefined) process.env.SSO_REDIRECT_URI = before;
  }
});

/* ── 4. 잘라 내는 규칙 자체 ───────────────────────────────────────────── */

test("앞머리만 남기고 끝의 슬래시는 남기지 않는다", () => {
  assert.equal(ownBaseUrlFrom(REGISTERED), "https://improvements.dss21.co.kr");
  assert.equal(
    ownBaseUrlFrom(`http://10.0.0.5:3500${CALLBACK_PATH}`),
    "http://10.0.0.5:3500",
  );
  // 경로 앞에 슬래시가 겹쳐 있어도 앞머리에는 남기지 않는다.
  assert.equal(ownBaseUrlFrom(`https://x.dss21.co.kr/${CALLBACK_PATH}`), "https://x.dss21.co.kr");
});
