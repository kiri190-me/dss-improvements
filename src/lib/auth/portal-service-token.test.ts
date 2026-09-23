import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import test from "node:test";
import { SignJWT } from "jose";

import {
  PORTAL_TOKEN_CLOCK_TOLERANCE_SECONDS,
  PORTAL_TOKEN_MAX_LIFETIME_SECONDS,
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalTokenWithKey,
  type PortalTokenPurpose,
} from "./portal-service-token";

/**
 * ============================================================================
 * 🔴 포털이 물으러 올 때의 문 — 여덟 가지를 **실제로 서명해 가며** 잰다
 * ============================================================================
 * 이 검증이 「남의 알림을 볼 수 있는 문」의 전부다. 하나만 느슨해져도 증상은
 * 나지 않고(알림은 그대로 잘 온다) 문만 열린다 — 그래서 흉내가 아니라 **진짜
 * 토큰을 구워** 확인한다. 열쇠는 이 시험이 직접 만들므로 네트워크도 DB 도 닿지
 * 않는다(unit.txt 의 규칙).
 *
 * 여덟 가지(dss-auth 의 oidc/service-token.ts:20-28):
 *  1. 서명이 우리가 아는 열쇠로 검증될 것   5. exp − iat ≤ 600초
 *  2. iss 가 포털일 것                      6. nonce 가 없을 것
 *  3. aud 가 우리 client_id 일 것           7. purpose 가 이 통로의 값일 것
 *  4. exp 가 있을 것                        8. sub 가 있을 것
 * ============================================================================
 */

const ISSUER = "http://192.168.1.132:3100";
const AUDIENCE = "dss-improvements";
const SUBJECT = "11111111-1111-4111-8111-111111111111";

/**
 * 열쇠는 이 시험이 직접 만든다 — 포털에도 망에도 닿지 않는다.
 *
 * `generateKeyPairSync` 를 쓰는 까닭: 이 저장소의 시험은 CJS 로 변환되어 돌아가
 * **최상위 await 를 쓸 수 없다**(tsx 가 「Top-level await is currently not
 * supported with the "cjs" output format」으로 멈춘다). jose 는 Node 의
 * KeyObject 를 그대로 받는다.
 */
const portal = generateKeyPairSync("rsa", { modulusLength: 2048 });
/** 포털이 아닌 누군가의 열쇠 — 「서명만 그럴듯한」 토큰을 만들 때 쓴다. */
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });

type TokenOverrides = {
  issuer?: string;
  audience?: string;
  subject?: string | null;
  purpose?: string | null;
  nonce?: string;
  issuedAt?: number;
  expiresAt?: number | null;
  key?: KeyObject;
};

const NOW = Math.floor(Date.now() / 1000);

async function makeToken(overrides: TokenOverrides = {}): Promise<string> {
  const issuedAt = overrides.issuedAt ?? NOW;
  const claims: Record<string, unknown> = {};
  if (overrides.purpose !== null) {
    claims.purpose = overrides.purpose ?? PORTAL_TOKEN_PURPOSES.notificationsRead;
  }
  if (overrides.nonce !== undefined) claims.nonce = overrides.nonce;

  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt(issuedAt);

  const subject = overrides.subject === undefined ? SUBJECT : overrides.subject;
  if (subject !== null) jwt = jwt.setSubject(subject);

  // 🔴 expiresAt: null 이면 exp 를 아예 넣지 않는다(4번을 재는 토큰).
  if (overrides.expiresAt !== null) {
    jwt = jwt.setExpirationTime(overrides.expiresAt ?? issuedAt + 120);
  }

  return jwt.sign(overrides.key ?? portal.privateKey);
}

function verify(
  token: string | null,
  purpose: PortalTokenPurpose = PORTAL_TOKEN_PURPOSES.notificationsRead,
) {
  return verifyPortalTokenWithKey({
    token,
    key: portal.publicKey,
    issuer: ISSUER,
    audience: AUDIENCE,
    purpose,
  });
}

/* ── 통과하는 토큰 ────────────────────────────────────────────────────── */

test("포털이 구운 제대로 된 토큰은 통과하고, sub 를 그대로 돌려준다", async () => {
  const result = await verify(await makeToken());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 🔴 이 값이 「누구의 알림인가」다 — 쿼리 문자열이 아니라 토큰 안에서만 온다.
  assert.equal(result.subject, SUBJECT);
  assert.equal(result.payload.purpose, PORTAL_TOKEN_PURPOSES.notificationsRead);
});

test("시계가 조금 어긋나도(30초 안) 통과한다 — 서버 둘의 시계는 정확히 같지 않다", async () => {
  // 아직 시작되지 않은(iat 가 미래인) 토큰도 여유 안이면 받는다.
  const token = await makeToken({ issuedAt: NOW + PORTAL_TOKEN_CLOCK_TOLERANCE_SECONDS - 5 });
  assert.equal((await verify(token)).ok, true);
});

/* ── 1. 서명 ──────────────────────────────────────────────────────────── */

test("🔴 남이 서명한 토큰은 거절한다 — 모양이 아무리 맞아도", async () => {
  const token = await makeToken({ key: stranger.privateKey });
  assert.deepEqual(await verify(token), { ok: false, reason: "invalid_token" });
});

test("글자를 한 자 고친 토큰은 거절한다", async () => {
  const token = await makeToken();
  const [header, payload, signature] = token.split(".");
  const tampered = `${header}.${payload}.${signature.slice(0, -2)}${signature.endsWith("A") ? "B" : "A"}=`;
  assert.deepEqual(await verify(tampered), { ok: false, reason: "invalid_token" });
});

/* ── 2·3. 발급자와 수신자 ─────────────────────────────────────────────── */

test("🔴 다른 포털이 발급한 토큰은 거절한다", async () => {
  const token = await makeToken({ issuer: "http://evil.example" });
  assert.deepEqual(await verify(token), { ok: false, reason: "invalid_token" });
});

test("🔴 **다른 시스템**에 발급된 토큰을 여기로 들이밀 수 없다", async () => {
  // 포털이 A/S 에 주려고 구운 토큰이다 — 서명도 발급자도 맞지만 aud 가 다르다.
  const token = await makeToken({ audience: "rf-service-system" });
  assert.deepEqual(await verify(token), { ok: false, reason: "invalid_token" });
});

/* ── 4·5. 만료와 수명 ─────────────────────────────────────────────────── */

test("🔴 exp 가 **없는** 토큰은 거절한다 — 영원히 사는 토큰은 영원히 새는 문이다", async () => {
  // jose 는 exp 가 아예 없으면 「만료 없음」으로 통과시킨다. requiredClaims 가 막는다.
  const token = await makeToken({ expiresAt: null });
  assert.deepEqual(await verify(token), { ok: false, reason: "invalid_token" });
});

test("이미 만료된 토큰은 거절한다 — 시계 여유를 넘긴 것", async () => {
  const issuedAt = NOW - 300;
  const token = await makeToken({
    issuedAt,
    expiresAt: NOW - PORTAL_TOKEN_CLOCK_TOLERANCE_SECONDS - 5,
  });
  assert.deepEqual(await verify(token), { ok: false, reason: "invalid_token" });
});

test("🔴 수명이 상한(600초)을 넘으면 거절한다 — 아직 안 만료됐어도", async () => {
  const token = await makeToken({
    issuedAt: NOW,
    expiresAt: NOW + PORTAL_TOKEN_MAX_LIFETIME_SECONDS + 1,
  });
  assert.deepEqual(await verify(token), { ok: false, reason: "lifetime_too_long" });
});

test("상한과 **똑같은** 수명은 통과한다 — 경계에서 한 초씩 어긋나지 않게", async () => {
  const token = await makeToken({
    issuedAt: NOW,
    expiresAt: NOW + PORTAL_TOKEN_MAX_LIFETIME_SECONDS,
  });
  assert.equal((await verify(token)).ok, true);
});

/* ── 6. nonce ─────────────────────────────────────────────────────────── */

test("🔴 nonce 가 있으면 거절한다 — 로그인 때 받은 ID 토큰의 재사용을 막는다", async () => {
  const token = await makeToken({ nonce: "n-0S6_WzA2Mj" });
  assert.deepEqual(await verify(token), { ok: false, reason: "id_token" });
});

/* ── 7. purpose ───────────────────────────────────────────────────────── */

test("🔴 다른 통로의 토큰으로는 들어올 수 없다 — 알림 읽기용으로 설정을 못 고친다", async () => {
  const token = await makeToken({ purpose: PORTAL_TOKEN_PURPOSES.notificationsRead });
  assert.deepEqual(await verify(token, PORTAL_TOKEN_PURPOSES.notificationSettingsWrite), {
    ok: false,
    reason: "wrong_purpose",
  });
});

test("purpose 가 아예 없는 토큰도 거절한다", async () => {
  const token = await makeToken({ purpose: null });
  assert.deepEqual(await verify(token), { ok: false, reason: "wrong_purpose" });
});

test("설정 읽기·쓰기 토큰은 각자의 통로에서만 통과한다", async () => {
  const read = await makeToken({ purpose: PORTAL_TOKEN_PURPOSES.notificationSettingsRead });
  assert.equal((await verify(read, PORTAL_TOKEN_PURPOSES.notificationSettingsRead)).ok, true);
  assert.equal((await verify(read, PORTAL_TOKEN_PURPOSES.notificationSettingsWrite)).ok, false);
});

/* ── 8. sub ───────────────────────────────────────────────────────────── */

test("🔴 sub 가 없으면 거절한다 — 누구의 알림인지 알 수 없다", async () => {
  const token = await makeToken({ subject: null });
  assert.deepEqual(await verify(token), { ok: false, reason: "invalid_token" });
});

/* ── 통로의 글자와 머리말 ─────────────────────────────────────────────── */

test("🔴 purpose 글자가 포털·A/S 와 **똑같다** — 저장소가 셋이라 컴파일러가 못 잡는다", () => {
  // 한쪽만 바꾸면 그 통로만 401 이 되고, 증상은 「알림이 안 온다」 하나로 뭉뚱그려진다.
  assert.deepEqual(PORTAL_TOKEN_PURPOSES, {
    notificationsRead: "dss.notifications.read",
    notificationSettingsRead: "dss.notification-settings.read",
    notificationSettingsWrite: "dss.notification-settings.write",
  });
});

test("토큰이 없으면 「토큰 없음」이다 — 부르는 쪽에는 같은 답이 나간다", async () => {
  assert.deepEqual(await verify(null), { ok: false, reason: "missing_token" });
  assert.deepEqual(await verify(""), { ok: false, reason: "missing_token" });
});

test("Authorization 머리말에서 토큰만 꺼낸다", () => {
  assert.equal(readBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(readBearerToken("bearer abc.def.ghi"), "abc.def.ghi", "대소문자를 가리지 않는다");
  assert.equal(readBearerToken("Bearer\tabc.def.ghi  "), "abc.def.ghi");
});

test("머리말이 없거나 모양이 다르면 null — Basic 자격을 여기로 들이밀 수 없다", () => {
  for (const header of [null, "", "Bearer", "Bearer ", "Basic abc", "abc.def.ghi", "Bearer a b"]) {
    assert.equal(readBearerToken(header), null, `받아들이면 안 되는 머리말: ${String(header)}`);
  }
});
