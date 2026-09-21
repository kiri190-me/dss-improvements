import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { NotificationBell } from "@dss/ui";

import { fetchPortalNotifications, normalizePortalNotificationFeed } from "./oidc";

/**
 * ============================================================================
 * 🔴 알림 종이 흐르는 길 — 묻는 자리 · 삼키는 자리 · 그리는 자리
 * ============================================================================
 * 알림은 이렇게 흐른다:
 *
 *   다른 시스템들(A/S · 계측기 …)이 저마다 가진 알림
 *     → 포털이 모아 합친다(dss-auth 의 notifications/merge.ts)
 *     → 이 사이트의 **서버**가 client_id/secret 으로 묻는다(oidc.ts)
 *     → (app)/layout.tsx 가 <Suspense> 로 감싸 머리말에 내려보내고
 *     → AppHeader 가 줄의 **맨 오른쪽 끝**에 그린다(@dss/ui 의 NotificationBell)
 *
 * ── 여기서 지키는 것 다섯 ───────────────────────────────────────────────
 *  1. 🔴 **어떤 답이 와도 던지지 않는다.** 포털이 죽어도·거절해도·설정이
 *     빠져도 빈 목록이 나간다. 이 종은 모든 화면에 딸려 오므로, 여기서 나는
 *     오류 하나가 사이트 전체를 못 쓰게 만든다. 이 파일에서 가장 중요한 줄이다.
 *  2. 🔴 자격증명은 **머리말(Basic)** 로만 나가고 어디에도 찍히지 않는다.
 *  3. 답은 캐시하지 않고(no-store), 이상한 줄은 **그 줄만** 버린다.
 *  4. 개수는 **포털이 센 값 그대로**다 — 줄 수로 다시 세지 않는다.
 *  5. 그리는 자리는 줄의 맨 오른쪽 끝이다(펼친 목록이 화면 밖으로 잘리지
 *     않으려면 그 자리여야 한다).
 *
 * ── 왜 어떤 것은 파일의 글자를 읽는가 ───────────────────────────────────
 * 레이아웃과 머리말은 실제로 불러 볼 수 없다(세션·DB·요청 맥락이 있어야 한다).
 * 이 목록의 시험은 DB 에 닿을 길이 없어야 하므로(scripts/test-lists/unit.txt)
 * 그 자리들은 **구조**를 못 박는다. 반대로 판단이 들어 있는 것(거절을 삼키는
 * 일, 답을 고르는 일, 빈 목록일 때 그리지 않는 일)은 **실제로 불러 본다.**
 * ============================================================================
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 걷어 낸 코드. 주석에 적힌 낱말이 시험을 통과시키지 않게. */
function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const oidc = withoutComments(read("src/lib/auth/oidc.ts"));
const appLayout = withoutComments(read("src/app/(app)/layout.tsx"));
const rootLayout = read("src/app/layout.tsx");
const appHeader = withoutComments(read("src/components/AppHeader.tsx"));
const bellComponent = withoutComments(read("src/components/PortalNotificationBell.tsx"));
const tsconfig = read("tsconfig.json");
/* 서브모듈(vendor/dss-ui)이 실제로 실려 있는 CSS. 포인터가 옛 커밋이면 여기서
   걸린다 — 종은 2026-09-21 에 들어왔고 그 전 판에는 폴더 자체가 없다. */
const bellCss = read("vendor/dss-ui/src/notification-bell/notification-bell.css");

/** 포털 답 한 줄. 아홉 칸 전부 글자다(없는 값은 빈 문자열로 온다). */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "rf-service-system:APPROVAL:123",
    sourceId: "rf-service-system",
    sourceName: "DSS A/S 관리 시스템",
    id: "APPROVAL:123",
    kind: "APPROVAL",
    kindLabel: "결재 대기",
    subject: "RF-2026-0007",
    detail: "김아무개가 올렸습니다",
    href: "http://192.168.1.132:3000/repair-cases/123",
    ...overrides,
  };
}

/* ── 1. 🔴 어떤 답이 와도 던지지 않는다 ───────────────────────────────── */

test("🔴 포털에 닿지 못해도 던지지 않는다 — 빈 목록과 degraded 로 돌아온다", async () => {
  // 실제로 불러 본다. 아무도 듣고 있지 않은 자리(127.0.0.1:1)라 연결이 곧바로
  // 거절된다 — 바깥 망에 나가지 않고 DB 도 쓰지 않는다.
  const before = { ...process.env };
  process.env.SSO_ISSUER = "http://127.0.0.1:1";
  process.env.SSO_CLIENT_ID = "dss-improvements";
  process.env.SSO_CLIENT_SECRET = "not-a-real-secret";

  try {
    const feed = await fetchPortalNotifications("00000000-0000-0000-0000-000000000000");
    assert.deepEqual(feed, { items: [], count: 0, degraded: true });
  } finally {
    process.env = before;
  }
});

test("🔴 설정이 빠져도 던지지 않는다 — env 의 getter 가 던지는 자리까지 삼킨다", async () => {
  // .env 가 없는 채로 뜬 서버에서도 머리말은 떠야 한다. env 를 try 밖에서
  // 읽으면 여기서 걸린다(그 getter 는 값이 없으면 던진다).
  const before = { ...process.env };
  delete process.env.SSO_ISSUER;
  delete process.env.SSO_CLIENT_ID;
  delete process.env.SSO_CLIENT_SECRET;

  try {
    const feed = await fetchPortalNotifications("00000000-0000-0000-0000-000000000000");
    assert.deepEqual(feed, { items: [], count: 0, degraded: true });
  } finally {
    process.env = before;
  }
});

test("포털 계정과 이어지지 않은 사람은 아예 묻지 않는다 — 빈 sub 로는 나가지 않는다", async () => {
  const feed = await fetchPortalNotifications("");
  assert.deepEqual(feed, { items: [], count: 0, degraded: true });
});

test("🔴 거절(401·403·429·503)도 같은 자리에서 삼킨다 — 화면에는 「알림 없음」으로 보인다", () => {
  // 위 두 시험이 연결 실패와 설정 누락을 실제로 확인했다. 나머지 거절은 진짜
  // 포털이 있어야 만들 수 있으므로(dss-auth 의 check:notify:site 가 그것을
  // 한다) 여기서는 삼키는 **구조**를 못 박는다: 실패하는 모든 갈래가
  // UNREACHABLE 을 돌려주고, 이 통로에는 throw 가 한 군데도 없다.
  const call = oidc.slice(oidc.indexOf("export async function fetchPortalNotifications"));
  assert.ok(call.length > 0, "알림을 묻는 함수를 찾지 못했다");
  assert.equal(/\bthrow\b/.test(call), false, "🔴 알림 통로가 던진다 — 머리말이 깨진다");
  assert.match(call, /if \(!response\.ok\) \{[\s\S]*?return UNREACHABLE;/);
  assert.match(call, /catch[\s\S]*?return UNREACHABLE;/);
});

test("🔴 왕복에 상한이 있다 — 응답 없는 곳을 두드려도 화면이 멈추지 않는다", () => {
  assert.match(oidc, /signal: AbortSignal\.timeout\(NOTIFICATIONS_TIMEOUT_MS\)/);
  const limit = oidc.match(/const NOTIFICATIONS_TIMEOUT_MS = (\d+);/);
  assert.ok(limit, "상한 값을 찾지 못했다");
  assert.ok(Number(limit[1]) > 0 && Number(limit[1]) <= 5000, "상한이 없거나 너무 길다");
});

/* ── 2. 🔴 자격증명 ───────────────────────────────────────────────────── */

test("🔴 자격증명은 Authorization: Basic 으로만 나간다 — 주소에 싣지 않는다", () => {
  const call = oidc.slice(oidc.indexOf("export async function fetchPortalNotifications"));
  assert.match(call, /authorization: `Basic \$\{Buffer\.from\(credentials/);
  // 🔴 주소에 실리면 포털이 400 으로 거절하고, 그 값은 이미 접근 로그에 남아
  //    **다시 발급**해야 한다(dss-auth/docs/사이트-알림-통로.md).
  assert.equal(
    /client_secret=|client_id=/.test(call),
    false,
    "🔴 자격증명이 주소(쿼리)에 실린다 — 시크릿을 다시 발급해야 하는 사고다",
  );
  // 몸통에 실어 보내는 것은 sub 하나뿐이다.
  assert.match(call, /new URLSearchParams\(\{ sub: subject \}\)/);
});

test("🔴 자격증명을 로그에 찍지 않는다 — 찍히는 것은 오류의 종류와 상태뿐이다", () => {
  const call = oidc.slice(oidc.indexOf("export async function fetchPortalNotifications"));
  for (const logged of call.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
    const args = logged[2];
    assert.equal(
      /credentials|ssoClientSecret|ssoClientId|authorization/i.test(args),
      false,
      `🔴 로그에 자격증명이 딸려 나간다: ${args.trim().slice(0, 60)}`,
    );
  }
  // 오류 객체를 통째로 찍지 않는다 — 요청 정보가 딸려 나올 수 있다.
  assert.match(call, /error instanceof Error \? error\.name : "unknown"/);
});

test("답을 캐시하지 않는다 — 방금 처리한 일이 종에 남으면 안 된다", () => {
  const call = oidc.slice(oidc.indexOf("export async function fetchPortalNotifications"));
  assert.match(call, /cache: "no-store"/);
});

/* ── 3. 받은 답을 고르는 일 (실제로 불러 본다) ────────────────────────── */

test("정상 답은 아홉 칸 그대로 나른다 — 종에 넘길 모양 그대로다", () => {
  const feed = normalizePortalNotificationFeed({
    items: [row()],
    count: 3,
    sources: [{ clientId: "rf-service-system", name: "A/S", ok: true, count: 3 }],
    degraded: false,
  });

  assert.deepEqual(feed.items, [row()]);
  assert.equal(feed.count, 3);
  assert.equal(feed.degraded, false);
});

test("🔴 모양이 깨진 줄은 **그 줄만** 버린다 — 한 줄 때문에 머리말이 비지 않는다", () => {
  const feed = normalizePortalNotificationFeed({
    items: [
      row({ key: "a" }),
      row({ detail: null }), // 포털은 빈 문자열로 싣는다 — null 은 우리가 모르는 답이다
      null,
      "알림",
      row({ key: "b", href: undefined }),
      row({ key: "c" }),
    ],
    count: 4,
  });

  assert.deepEqual(
    feed.items.map((item) => item.key),
    ["a", "c"],
  );
  // 🔴 개수는 그대로다 — 버린 줄만큼 빼서 다시 세지 않는다(아래 시험).
  assert.equal(feed.count, 4);
});

test("🔴 개수는 포털이 센 값 그대로다 — 줄 수로 다시 세지 않는다", () => {
  // A/S 는 「같은 대상은 한 번만」 센다(한 건에 결재가 둘 걸려 있어도 1).
  // 여기서 줄을 세면 A/S 의 종과 이 종이 서로 다른 숫자를 말하게 된다.
  const feed = normalizePortalNotificationFeed({
    items: [row({ key: "a" }), row({ key: "b" }), row({ key: "c" })],
    count: 2,
  });
  assert.equal(feed.count, 2);
});

test("개수가 숫자가 아니면 0 이다 — 배지만 안 그려지고 목록은 그대로 보인다", () => {
  for (const count of ["3", null, undefined, Number.NaN, -1]) {
    const feed = normalizePortalNotificationFeed({ items: [row()], count });
    assert.equal(feed.count, 0, `count=${String(count)} 에서 0 이 아니다`);
    assert.equal(feed.items.length, 1, "목록까지 버렸다");
  }
});

test("알 수 없는 답(빈 몸통·글자·배열 아님)은 못 물어본 것으로 친다", () => {
  for (const body of [null, "", 7, [], { items: "없음" }]) {
    const feed = normalizePortalNotificationFeed(body);
    assert.deepEqual(feed.items, [], `${JSON.stringify(body)} 에서 목록이 생겼다`);
  }
});

test("degraded 는 「알림이 없다」와 다른 말이라 값을 버리지 않는다", () => {
  assert.equal(normalizePortalNotificationFeed({ items: [], degraded: true }).degraded, true);
  assert.equal(normalizePortalNotificationFeed({ items: [] }).degraded, false);
});

/* ── 4. 그리는 자리 ───────────────────────────────────────────────────── */

test("🔴 이 사이트는 **서버**에서 묻는다 — 브라우저로 나가는 중계 통로를 두지 않았다", () => {
  // 자격증명이 client_secret 이라 브라우저에서는 부를 수 없다. 중계 통로를
  // 두면 시크릿을 다루는 자리가 하나 더 생긴다(PortalNotificationBell 머리말).
  assert.equal(
    bellComponent.includes('"use client"'),
    false,
    "종을 그리는 조각이 클라이언트로 넘어갔다 — 시크릿을 서버에 두는 판단이 깨진다",
  );
  assert.match(bellComponent, /await fetchPortalNotifications\(subject\)/);
  assert.equal(
    fs.existsSync(path.resolve(ROOT, "src/app/api/notifications")),
    false,
    "브라우저용 중계 통로가 생겼다 — 생겼다면 세션 재검증까지 함께 봐야 한다",
  );
});

test("🔴 묻는 열쇠는 검증된 세션의 authSub 다 — 클라이언트가 보낸 값이 아니다", () => {
  assert.match(appLayout, /const user = await requireSession\(\);/);
  assert.match(appLayout, /<PortalNotificationBell subject=\{user\.authSub\} \/>/);
});

test("🔴 <Suspense> 가 감싼다 — 포털이 느려도 모든 화면 이동이 느려지지 않는다", () => {
  const bellAt = appLayout.indexOf("<PortalNotificationBell");
  const suspenseAt = appLayout.indexOf("<Suspense fallback={null}>");
  assert.ok(suspenseAt > 0, "🔴 종이 <Suspense> 밖에 있다 — 머리말이 포털을 기다린다");
  assert.ok(suspenseAt < bellAt, "감싸는 차례가 뒤집혔다");
  assert.match(appLayout, /notificationBell=\{/, "머리말에 내려보내지 않는다");
});

test("🔴 종은 줄의 **맨 오른쪽 끝**이다 — 아니면 폰에서 펼친 목록이 잘린다", () => {
  // 펼친 목록은 종에 오른쪽 끝을 맞춰 왼쪽으로 펼쳐지고(아래 CSS 시험) 폭이
  // 폰에서 320px 이다. 종이 가운데쯤 앉으면 목록 왼쪽이 화면 밖으로 나간다.
  const logoutAt = appHeader.indexOf("로그아웃");
  const bellAt = appHeader.indexOf("{notificationBell}");
  assert.ok(bellAt > 0, "머리말이 종을 그리지 않는다");
  assert.ok(bellAt > logoutAt, "🔴 종이 나가는 단추보다 앞에 있다 — 목록이 화면 밖으로 잘린다");

  // 받는 것은 다 그려진 노드다 — 이 파일이 @dss/ui 를 몰라야 한다(메뉴바와 같다).
  assert.equal(appHeader.includes("@dss/ui"), false, "머리말이 @dss/ui 를 직접 부른다");
});

test("🔴 종을 래퍼 <div> 로 감싸지 않는다 — 알림이 없을 때 빈 자리와 여백이 남는다", () => {
  assert.equal(
    /<div[^>]*>\s*\{notificationBell\}/.test(appHeader),
    false,
    "종을 감쌌다 — 알림이 없어도 flex 항목 하나와 gap 12px 이 남는다",
  );
});

test("생김새를 사이트가 한 번 부른다 — 메뉴바와 **다른 파일**이다", () => {
  assert.match(rootLayout, /^import "@dss\/ui\/notification-bell\.css";$/m);
  assert.match(rootLayout, /^import "@dss\/ui\/styles\.css";$/m);
  // 경로 별칭이 없으면 tsc 는 통과해도 화면에서 CSS 가 통째로 빠진다.
  assert.match(tsconfig, /"@dss\/ui\/notification-bell\.css":/);
});

test("🔴 다크는 @dss/ui 기본값에 맡긴다 — colorScheme 을 넘기지 않는다", () => {
  // 이 사이트는 globals.css 에서 color-scheme: light 고정이고, 기본값("host")은
  // 조상에 .dark 가 있을 때만 어두워진다(메뉴바와 같은 판단).
  assert.equal(bellComponent.includes("colorScheme"), false, "colorScheme 을 넘기고 있다");
});

/* ── 5. 종이 실제로 그리는 것 (불러 본다) ─────────────────────────────── */

test("🔴 알림이 없으면 종 자체가 없다 — fallback 이 null 인 것과 같은 모습이다", () => {
  // 이것이 참이라서 (1) <Suspense fallback={null}> 이 자리를 들썩이지 않고
  // (2) 머리말이 래퍼 없이 그대로 두어도 빈 자리가 남지 않는다. @dss/ui 가
  // 이 판단을 바꾸면 여기서 걸린다(A/S 의 종은 빈 종도 그린다 — 다른 선택이다).
  assert.equal(NotificationBell({ items: [], count: 0 }), null);
});

test("받은 알림은 받은 차례 그대로, 받은 주소 그대로 그려진다", () => {
  // 🔴 포털의 답을 고른 그대로 종에 넘긴다 — 옮겨 담는 코드가 한 줄도 없다는
  //    것이 이 시험의 요점이다(타입이 포털 응답의 거울이라 그럴 수 있다).
  const feed = normalizePortalNotificationFeed({
    items: [
      row({ key: "a", href: "http://192.168.1.132:3000/repair-cases/1" }),
      row({ key: "b", href: "http://192.168.1.132:3300/instruments/2" }),
    ],
    count: 2,
  });

  const rendered = NotificationBell({ items: feed.items, count: feed.count });
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== "object" || node === null || !("props" in node)) return;
    const element = node as { type: unknown; props: Record<string, unknown> };
    if (element.type === "a" && typeof element.props.href === "string") {
      found.push(element.props.href);
    }
    walk(element.props.children);
  };
  walk(rendered);

  assert.deepEqual(found, [
    "http://192.168.1.132:3000/repair-cases/1",
    "http://192.168.1.132:3300/instruments/2",
  ]);
});

test("🔴 서브모듈에 종이 실려 있고, 펼친 목록이 오른쪽에 붙는다 — 자리 판단의 근거", () => {
  // 포인터가 옛 커밋이면 이 파일 자체가 없다(위 read 에서 걸린다).
  const listRule = bellCss.match(/\.dss-bell__list \{([\s\S]*?)\n\}/);
  assert.ok(listRule, "펼친 목록 규칙을 찾지 못했다");
  assert.match(listRule[1], /position: absolute;/);
  assert.match(listRule[1], /right: 0;/, "왼쪽에 붙으면 종을 맨 끝에 둘 이유가 사라진다");
  assert.match(listRule[1], /width: min\(20rem, calc\(100vw - 2rem\)\);/);
});
