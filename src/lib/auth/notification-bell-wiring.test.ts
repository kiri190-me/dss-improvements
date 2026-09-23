import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { NotificationBell } from "@dss/ui";
import type { NotificationBellItem } from "@dss/ui";

import { acknowledgeAllOnce } from "@/components/AcknowledgeOwnNotificationsOnMount";
import { acknowledgePickedNotification } from "@/components/NotificationBellWithAcknowledge";
import { fetchPortalNotifications, normalizePortalNotificationFeed } from "./oidc";

/**
 * ============================================================================
 * 🔴 알림 종이 흐르는 길 — 묻는 자리 · 삼키는 자리 · 그리는 자리 · 적는 자리
 * ============================================================================
 * 알림은 두 갈래로 흘러 한 종에서 만난다:
 *
 *   ① **이 사이트 것** — 확인하지 않은 개선요청
 *     → db/queries/notifications.ts 가 개선요청 줄 + 이 사람의 확인 기록을 읽고
 *     → domain/notifications.ts 가 종이 받는 모양으로 파생한다(저장하지 않는다)
 *
 *   ② **남의 시스템 것**(A/S · 계측기 …)
 *     → 포털이 모아 합친다(dss-auth 의 notifications/merge.ts)
 *     → 이 사이트의 **서버**가 client_id/secret 으로 묻는다(oidc.ts)
 *
 *   ①+② → PortalNotificationBell 이 **자기 것 앞 · 받은 것 뒤**로 이어 붙이고
 *     → (app)/layout.tsx 가 <Suspense> 로 감싸 머리말에 내려보내고
 *     → AppHeader 가 줄의 **맨 오른쪽 끝**에 그린다(@dss/ui 의 NotificationBell)
 *     → 줄을 누르면 클라이언트 껍데기가 **우리 줄일 때만** 확인을 적는다
 *       (server/actions/notification-acknowledgements.ts)
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
/* 자체 알림이 흐르는 자리 넷(2026-09-23). 소스를 글자로 읽는 이유는 위 머리말과
   같다 — 이 목록의 시험은 DB 에 닿을 길이 없어야 한다. */
const bellShell = withoutComments(read("src/components/NotificationBellWithAcknowledge.tsx"));
const ownQuery = withoutComments(read("src/lib/db/queries/notifications.ts"));
const ackQuery = withoutComments(read("src/lib/db/queries/notification-acknowledgements.ts"));
const ackMutation = withoutComments(read("src/lib/db/mutations/notification-acknowledgements.ts"));
const ackAction = withoutComments(
  read("src/lib/server/actions/notification-acknowledgements.ts"),
);
/* 「화면에 들어오면 전부 확인」이 흐르는 자리 둘(2026-09-23). */
const ackAllMount = withoutComments(
  read("src/components/AcknowledgeOwnNotificationsOnMount.tsx"),
);
const listPage = withoutComments(read("src/app/(app)/page.tsx"));
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

/**
 * **이 사이트가 만든** 알림 한 줄(2026-09-23).
 * 🔴 sourceId 가 빈 문자열이고 key 와 id 가 같다 — 그것이 「확인을 적을 수 있는
 * 우리 줄」의 표시다(domain/notifications.ts).
 */
const OWN_KEY = "IMPROVEMENT_REQUEST:11111111-1111-4111-8111-111111111111";

function ownRow(): NotificationBellItem {
  return {
    key: OWN_KEY,
    sourceId: "",
    sourceName: "",
    id: OWN_KEY,
    kind: "IMPROVEMENT_REQUEST",
    kindLabel: "새 개선요청",
    subject: "DSS A/S 관리 시스템 · 전체 A/S 현황",
    detail: "김아무개: 검색이 안 됩니다.",
    href: "http://192.168.1.132:3500/",
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
  // 🔴 우리 DB 조회와 포털 왕복은 **나란히** 나간다 — 우리 것이 포털을 기다릴
  //    이유가 없다(둘 다 던지지 않으므로 Promise.all 이 안전하다).
  assert.match(bellComponent, /await Promise\.all\(\[/);
  assert.match(bellComponent, /fetchPortalNotifications\(subject\)/);
  assert.match(bellComponent, /listOwnNotifications\(\{ id: userId, role \}\)/);
  assert.equal(
    fs.existsSync(path.resolve(ROOT, "src/app/api/notifications")),
    false,
    "브라우저용 중계 통로가 생겼다 — 생겼다면 세션 재검증까지 함께 봐야 한다",
  );
});

test("🔴 넘기는 값 셋이 전부 검증된 세션에서 온다 — 클라이언트가 보낸 값이 아니다", () => {
  assert.match(appLayout, /const user = await requireSession\(\);/);
  // 포털에 물을 열쇠 · 확인 기록을 거를 사람 · 자체 알림을 실을지 정하는 역할.
  // 🔴 셋 다 `user.` 에서 온다. 하나라도 쿼리스트링이나 폼에서 오면 남의 알림을
  //    들여다보거나 남의 종을 대신 읽음 처리할 수 있다.
  assert.match(appLayout, /<PortalNotificationBell\s+subject=\{user\.authSub\}/);
  assert.match(appLayout, /userId=\{user\.id\}/);
  assert.match(appLayout, /role=\{user\.role\}/);
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
  // 그리는 자리가 껍데기로 옮겨졌으므로 거기도 본다.
  assert.equal(bellShell.includes("colorScheme"), false, "껍데기가 colorScheme 을 넘긴다");
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

/* ── 6. 🔴 이 사이트 자신의 알림 (2026-09-23) ─────────────────────────── */

test("🔴 자체 알림은 **관리자에게만** 실린다 — 화면과 액션이 같은 함수로 판정한다", () => {
  // 둘이 각자 `role === "ADMIN"` 을 적고 있으면 한쪽만 느슨해지는 날이 온다.
  assert.match(ownQuery, /canReceiveImprovementRequestNotifications\(actor\.role\)/);
  assert.match(ackAction, /canReceiveImprovementRequestNotifications\(actor\.role\)/);
});

test("🔴 알림은 **상태로 거르지 않는다** — 확인하지 않은 글 전부다", () => {
  // 상태로 거르면 남이 상태를 옮기는 순간 내 종에서 사라져 「내가 눌러 확인」과
  // 어긋난다(사용자 결정 2026-09-23 — domain/notifications.ts 머리말).
  assert.equal(
    /improvementRequests\.status/.test(ownQuery.slice(ownQuery.indexOf(".where("))),
    false,
    "🔴 조회가 status 로 거르고 있다",
  );
  // 거르는 것은 지워진 글 하나뿐이다.
  assert.match(ownQuery, /\.where\(eq\(improvementRequests\.isDeleted, false\)\)/);
});

test("🔴 알림을 저장하지 않는다 — 새 요청을 적는 곳은 알림을 모른다", () => {
  const create = withoutComments(read("src/lib/db/mutations/improvement-requests.ts"));
  assert.equal(
    /notificationAcknowledgements|notification/i.test(create),
    false,
    "🔴 글을 적는 mutation 이 알림을 만들고 있다 — 알림은 파생이라 고칠 필요가 없다",
  );
});

test("🔴 종 하나 때문에 모든 화면이 죽지 않는다 — 조회가 던지지 않는다", () => {
  // DB 가 멎었든, 랜선이 빠져 이 기계 주소를 못 찾았든(env.ownBaseUrl) 빈 목록이다.
  const listOwn = ownQuery.slice(ownQuery.indexOf("export async function listOwnNotifications"));
  assert.ok(listOwn.length > 0, "자체 알림 조회를 찾지 못했다");
  assert.equal(/\bthrow\b/.test(listOwn), false, "🔴 자체 알림 조회가 던진다");
  assert.match(listOwn, /catch[\s\S]*?return EMPTY;/);
});

test("🔴 로그에 값을 싣지 않는다 — 본문에 사람 이름이 섞일 수 있다", () => {
  for (const source of [ownQuery, ackAction]) {
    for (const logged of source.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
      assert.match(
        logged[2],
        /name: error instanceof Error \? error\.name : "unknown"/,
        `🔴 로그에 오류 종류 말고 다른 것이 실린다: ${logged[2].trim().slice(0, 60)}`,
      );
      assert.equal(
        /body|notificationKey|userId|actor\.id/.test(logged[2]),
        false,
        "🔴 로그에 값이 딸려 나간다",
      );
    }
  }
});

test("🔴 두 번 눌러도 한 줄이다 — ON CONFLICT DO NOTHING 으로 유니크에 기댄다", () => {
  // 먼저 읽어 보고 없으면 넣는 방식은 두 요청이 겹칠 때 둘 다 넣어 23505 가 된다.
  assert.match(ackMutation, /\.onConflictDoNothing\(\{/);
  assert.match(ackMutation, /target: \[\s*notificationAcknowledgements\.userId,/);
});

test("🔴 확인을 적는 일은 업무 자료를 한 칸도 움직이지 않는다", () => {
  assert.equal(
    /improvementRequests/.test(ackMutation),
    false,
    "🔴 확인 기록 mutation 이 개선요청 표를 건드린다",
  );
  for (const forbidden of [".update(", ".delete(", "transaction("]) {
    assert.equal(ackMutation.includes(forbidden), false, `🔴 ${forbidden} 가 들어 있다`);
  }
});

test("🔴 액션은 **세션에서만** 사람을 푼다 — 입력에 userId·role 이 없다", () => {
  const start = ackAction.indexOf("export async function acknowledgeNotificationAction(");
  const signature = ackAction.slice(start, ackAction.indexOf("): Promise<{ ok: boolean }>", start));
  assert.ok(start >= 0 && signature.length > 0, "액션을 찾지 못했다");
  assert.match(signature, /notificationKey: string/);
  assert.equal(
    /userId|actorUserId|role/.test(signature),
    false,
    "🔴 액션이 사람을 입력으로 받는다 — 남의 종을 대신 읽음 처리할 수 있다",
  );
  assert.match(ackAction, /const actor = await getSessionUser\(\);/);
  assert.match(ackAction, /markNotificationAcknowledged\(\{ userId: actor\.id/);
});

test("🔴 액션이 열쇠를 **서버에서 다시** 검증한다 — 화면을 거치지 않고 오는 요청이 있다", () => {
  assert.match(ackAction, /if \(!isOwnNotificationKey\(notificationKey\)\) return \{ ok: false \};/);
  // 관문 순서: 세션 → 권한 → 검증 → 저장. 검증이 권한보다 앞서면 권한 없는
  // 사람이 「어떤 열쇠가 유효한지」를 알아낼 수 있다.
  // 🔴 import 줄이 아니라 **함수 안**의 차례를 본다(import 는 알파벳 순이다).
  const body = ackAction.slice(
    ackAction.indexOf("export async function acknowledgeNotificationAction("),
  );
  assert.ok(
    body.indexOf("getSessionUser") < body.indexOf("canReceiveImprovementRequestNotifications"),
    "세션보다 권한을 먼저 본다",
  );
  assert.ok(
    body.indexOf("canReceiveImprovementRequestNotifications") < body.indexOf("isOwnNotificationKey"),
    "권한보다 입력 검증을 먼저 한다",
  );
});

test("확인 기록 조회는 사람과 열쇠 둘로 좁힌다 — 남의 확인 기록을 읽지 않는다", () => {
  assert.match(ackQuery, /eq\(notificationAcknowledgements\.userId, userId\)/);
  assert.match(ackQuery, /inArray\(notificationAcknowledgements\.notificationKey/);
  assert.match(ackQuery, /if \(keys\.length === 0\) return \[\];/);
});

test('🔴 클라이언트로 넘어가는 것은 껍데기 하나뿐이다 — 목록은 서버가 만든다', () => {
  assert.match(bellShell, /^"use client";$/m);
  // 껍데기는 DB 도 포털도 액션 파일도 모른다 — 받아서 쓴다(그래야 시험이 가짜를 넣는다).
  for (const forbidden of ["@/lib/db", "fetchPortalNotifications", "server/actions"]) {
    assert.equal(
      bellShell.includes(forbidden),
      false,
      `🔴 껍데기가 ${forbidden} 를 직접 가져온다 — 서버 사슬이 클라이언트로 넘어간다`,
    );
  }
  assert.match(bellShell, /acknowledge\?: AcknowledgeNotification;/);
});

test("🔴 자기 것이 앞, 포털에서 온 것이 뒤 — 개수는 각자 센 값을 더한다", () => {
  assert.match(bellComponent, /items=\{\[\.\.\.own\.items, \.\.\.feed\.items\]\}/);
  assert.match(bellComponent, /count=\{own\.count \+ feed\.count\}/);
});

test("🔴 우리 줄을 누르면 확인을 적고 **먼저 감춘다**", () => {
  const hidden: string[] = [];
  const restored: string[] = [];
  const asked: string[] = [];

  acknowledgePickedNotification(
    ownRow(),
    async ({ notificationKey }) => {
      asked.push(notificationKey);
      return { ok: true };
    },
    { hide: (key) => hidden.push(key), restore: (key) => restored.push(key) },
  );

  // 적는 열쇠는 줄의 id 다(우리 줄은 key 와 id 가 같다).
  assert.deepEqual(asked, ["IMPROVEMENT_REQUEST:11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(hidden, ["IMPROVEMENT_REQUEST:11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(restored, [], "적기도 전에 되살렸다");
});

test("🔴 포털에서 온 줄은 **적지도 감추지도** 않는다 — sourceId 가 가른다", () => {
  const asked: string[] = [];
  const hidden: string[] = [];

  acknowledgePickedNotification(
    { ...ownRow(), key: "rf-service-system:APPROVAL:123", sourceId: "rf-service-system", id: "APPROVAL:123" },
    async ({ notificationKey }) => {
      asked.push(notificationKey);
      return { ok: true };
    },
    { hide: (key) => hidden.push(key), restore: () => {} },
  );

  assert.deepEqual(asked, [], "🔴 남의 시스템 알림 id 로 우리 확인 기록을 적는다");
  assert.deepEqual(hidden, [], "적지도 않을 줄을 감췄다 — 눈에서만 사라지고 다시 돌아온다");
});

test("🔴 저장이 실패하면 줄을 되살린다 — 적지 못한 것을 적은 것처럼 보이게 하지 않는다", async () => {
  const restored: string[] = [];

  // ① 액션이 거절한 경우(권한·열쇠 모양)
  acknowledgePickedNotification(ownRow(), async () => ({ ok: false }), {
    hide: () => {},
    restore: (key) => restored.push(key),
  });
  // ② 액션 자체가 깨진 경우(망이 끊겼다)
  acknowledgePickedNotification(
    ownRow(),
    async () => {
      throw new Error("network");
    },
    { hide: () => {}, restore: (key) => restored.push(key) },
  );
  // ③ 부르는 순간 던지는 경우
  acknowledgePickedNotification(
    ownRow(),
    () => {
      throw new Error("sync");
    },
    { hide: () => {}, restore: (key) => restored.push(key) },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(restored.length, 3, `되살리지 못한 갈래가 있다(${restored.length}/3)`);
});

test("🔴 확인 함수가 없으면 아무 일도 하지 않는다 — 감췄다가 되돌아오는 일이 없다", () => {
  const hidden: string[] = [];
  acknowledgePickedNotification(ownRow(), undefined, {
    hide: (key) => hidden.push(key),
    restore: () => {},
  });
  assert.deepEqual(hidden, []);
});

test("🔴 배지는 감춘 만큼만 줄어든다 — 0 아래로 내려가지 않는다", () => {
  // 감추는 줄은 우리 줄뿐이고 우리 알림은 한 줄이 하나씩 세어져 있다. 포털이
  // 센 값은 제 줄 수와 다를 수 있어(그쪽 규칙은 우리가 모른다) 바닥을 둔다.
  assert.match(bellShell, /Math\.max\(0, count - hiddenKeys\.size\)/);
});

/* ── 7. 🔴 화면에 들어오면 전부 확인 (2026-09-23 사용자 결정) ─────────── */

test("🔴 두 길이 **둘 다** 있다 — 줄 하나 누르기와 화면에 들어오기", () => {
  // 🔴 줄 하나 누르기를 없애면 안 된다: 조각 3에서 포털 타일에도 점이 뜨는데,
  //    이 사이트를 열지 않고도 확인할 길이 있어야 한다.
  assert.match(ackAction, /export async function acknowledgeNotificationAction\(/);
  assert.match(ackAction, /export async function acknowledgeAllOwnNotificationsAction\(/);
  assert.match(bellShell, /acknowledgePickedNotification\(picked, acknowledge,/);
});

test("🔴 「전부 확인」 액션은 **입력을 받지 않는다** — 화면이 보낸 열쇠를 믿지 않는다", () => {
  const start = ackAction.indexOf("export async function acknowledgeAllOwnNotificationsAction(");
  assert.ok(start >= 0, "액션을 찾지 못했다");
  const signature = ackAction.slice(start, ackAction.indexOf(")", start) + 1);
  assert.equal(
    signature,
    "export async function acknowledgeAllOwnNotificationsAction()",
    "🔴 인자가 생겼다 — 남의 열쇠를 밀어 넣는 통로가 된다",
  );

  const body = ackAction.slice(start);
  // 사람·역할·목록을 **전부 서버에서** 만든다.
  assert.match(body, /const actor = await getSessionUser\(\);/);
  assert.match(body, /canReceiveImprovementRequestNotifications\(actor\.role\)/);
  assert.match(body, /listOwnNotifications\(\{ id: actor\.id, role: actor\.role \}\)/);
  // 줄 하나를 누를 때와 같은 판정으로 거른다.
  assert.match(body, /acknowledgeableNotificationKeys\(own\.items\)/);
  assert.match(body, /markNotificationsAcknowledged\(\{ userId: actor\.id, notificationKeys \}\)/);
});

test("🔴 적을 것이 없으면 DB 에 가지 않는다 — 화면을 열 때마다 도는 자리다", () => {
  const body = ackAction.slice(
    ackAction.indexOf("export async function acknowledgeAllOwnNotificationsAction("),
  );
  const earlyReturn = body.indexOf("if (notificationKeys.length === 0) return { ok: true };");
  assert.ok(earlyReturn > 0, "🔴 빈 목록을 그냥 통과시킨다");
  assert.ok(
    earlyReturn < body.indexOf("markNotificationsAcknowledged"),
    "이른 반환이 저장보다 뒤에 있다",
  );
  // mutation 쪽에도 같은 바닥이 있다(빈 VALUES 는 문법 오류다).
  assert.match(ackMutation, /if \(input\.notificationKeys\.length === 0\) return;/);
});

test("🔴 서버 컴포넌트에서 DB 에 쓰지 않는다 — GET 이 자료를 바꾸면 안 된다", () => {
  // 새로고침 · 링크 미리 가져오기 · 봇이 전부 쓰기를 일으킨다.
  assert.equal(
    /await acknowledgeAllOwnNotificationsAction\(|markNotification|db\.insert/.test(listPage),
    false,
    "🔴 목록 화면(서버 조각)이 확인을 직접 적고 있다",
  );
  // 액션은 **넘기기만** 한다 — 부르는 일은 브라우저가 그려진 뒤에 한다.
  assert.match(
    listPage,
    /<AcknowledgeOwnNotificationsOnMount acknowledgeAll=\{acknowledgeAllOwnNotificationsAction\} \/>/,
  );
  // 알림이 실리지 않는 사람에게는 아예 그리지 않는다(빈 왕복을 만들지 않는다).
  assert.match(listPage, /canReceiveImprovementRequestNotifications\(user\.role\) && \(/);
});

test("🔴 부르는 조각은 클라이언트이고, DB 도 액션 파일도 직접 가져오지 않는다", () => {
  assert.match(ackAllMount, /^"use client";$/m);
  for (const forbidden of ["@/lib/db", "server/actions", "@/lib/auth"]) {
    assert.equal(
      ackAllMount.includes(forbidden),
      false,
      `🔴 ${forbidden} 를 직접 가져온다 — 서버 사슬이 클라이언트로 넘어간다`,
    );
  }
  // 아무것도 그리지 않는다.
  assert.match(ackAllMount, /\): null \{/);
  assert.match(ackAllMount, /return null;/);
});

test("🔴 두 번 띄워도 한 번만 부른다 — 개발 모드(StrictMode)가 효과를 두 번 돌린다", () => {
  let calls = 0;
  const guard = { started: false };
  const acknowledgeAll = async () => {
    calls += 1;
    return { ok: true };
  };

  acknowledgeAllOnce(guard, acknowledgeAll);
  acknowledgeAllOnce(guard, acknowledgeAll); // StrictMode 의 두 번째
  acknowledgeAllOnce(guard, acknowledgeAll); // 서버가 종을 다시 계산해 다시 그려졌을 때

  assert.equal(calls, 1, `🔴 서버 왕복이 ${calls}번 나갔다`);
});

test("🔴 저장이 실패해도 화면이 깨지지 않는다 — 조용히 넘어가고 알림은 다음에 다시 뜬다", async () => {
  // 거절 · 깨진 약속 · 부르는 순간 던지기 — 어느 것도 밖으로 새지 않는다.
  assert.doesNotThrow(() => acknowledgeAllOnce({ started: false }, async () => ({ ok: false })));
  assert.doesNotThrow(() =>
    acknowledgeAllOnce({ started: false }, async () => {
      throw new Error("network");
    }),
  );
  assert.doesNotThrow(() =>
    acknowledgeAllOnce({ started: false }, () => {
      throw new Error("sync");
    }),
  );
  // 처리되지 않은 거절이 남지 않는지 한 박자 기다려 본다(남으면 개발 중 오류판이 뜬다).
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("확인 함수가 없으면 아무 일도 하지 않는다", () => {
  const guard = { started: false };
  assert.doesNotThrow(() => acknowledgeAllOnce(guard, undefined));
  assert.equal(guard.started, true, "다음 번에 또 부르려고 상자를 비워 두었다");
});

test("🔴 서브모듈에 종이 실려 있고, 펼친 목록이 오른쪽에 붙는다 — 자리 판단의 근거", () => {
  // 포인터가 옛 커밋이면 이 파일 자체가 없다(위 read 에서 걸린다).
  const listRule = bellCss.match(/\.dss-bell__list \{([\s\S]*?)\n\}/);
  assert.ok(listRule, "펼친 목록 규칙을 찾지 못했다");
  assert.match(listRule[1], /position: absolute;/);
  assert.match(listRule[1], /right: 0;/, "왼쪽에 붙으면 종을 맨 끝에 둘 이유가 사라진다");
  assert.match(listRule[1], /width: min\(20rem, calc\(100vw - 2rem\)\);/);
});
