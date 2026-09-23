import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { NotificationBellItem } from "@dss/ui";

import type { UserRole } from "@/lib/db/schema";
import {
  IMPROVEMENT_REQUEST_NOTIFICATION_KIND,
  PORTAL_MAX_ITEMS_PER_SOURCE,
  type ImprovementRequestNotificationFeed,
} from "@/lib/domain/notifications";
import {
  PORTAL_SOURCE_NAME,
  SETTINGS_READ_ONLY_MESSAGE,
  buildPortalNotificationFeed,
  improvementRequestNotificationSettings,
  readPortalNotificationSettings,
  writePortalNotificationSettings,
} from "./portal-notifications";

/**
 * ============================================================================
 * 🔴 포털이 물어 올 때 — 되짚기 · 옮겨 담기 · 설정 답하기
 * ============================================================================
 * 이 파일의 함수들은 DB 를 **인자로 받는다**. 그래서 판단을 DB 없이 그대로
 * 불러 볼 수 있다(unit.txt 의 규칙: 이 목록의 시험은 DB 에 닿을 길이 없어야 한다).
 * 라우트 자체는 DB 를 물고 있어 불러 볼 수 없으므로 **소스를 글자로 읽어** 못
 * 박는다 — 이 저장소가 쓰는 방식이다(auth/notification-bell-wiring.test.ts).
 * ============================================================================
 */

const CLIENT_ID = "dss-improvements";
const SUBJECT = "11111111-1111-4111-8111-111111111111";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const feedRoute = withoutComments(read("src/app/api/integration/notifications/route.ts"));
const settingsRoute = withoutComments(
  read("src/app/api/integration/notification-settings/route.ts"),
);

/** 내 종에 실릴 모양의 줄 하나 — sourceId 가 빈 문자열이고 key 와 id 가 같다. */
function ownItem(id: string): NotificationBellItem {
  return {
    key: `IMPROVEMENT_REQUEST:${id}`,
    sourceId: "",
    sourceName: "",
    id: `IMPROVEMENT_REQUEST:${id}`,
    kind: IMPROVEMENT_REQUEST_NOTIFICATION_KIND,
    kindLabel: "새 개선요청",
    subject: "DSS A/S 관리 시스템 · 전체 A/S 현황",
    detail: "김아무개: 검색이 안 됩니다.",
    href: "http://192.168.1.132:3500/",
  };
}

function feedOf(count: number): ImprovementRequestNotificationFeed {
  const items = Array.from({ length: count }, (_, index) =>
    ownItem(`${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`),
  );
  return { items, count: items.length };
}

const admin = { id: "99999999-9999-4999-8999-999999999999", role: "ADMIN" as UserRole };
const member = { id: "88888888-8888-4888-8888-888888888888", role: "MEMBER" as UserRole };

const findAdmin = async () => admin;
const findNobody = async () => null;
const findMember = async () => member;

/* ── 되짚기 ───────────────────────────────────────────────────────────── */

test("🔴 이 사이트에 계정이 없는 사람은 **빈 목록**이다 — 오류가 아니다", async () => {
  // 포털은 같은 질문을 모든 시스템에 던진다. 오류를 돌려주면 포털의 종이 그
  // 줄에서 「지금은 불러올 수 없습니다」로 상한 것처럼 보인다.
  let asked = false;
  const feed = await buildPortalNotificationFeed({
    subject: SUBJECT,
    clientId: CLIENT_ID,
    findActor: findNobody,
    listNotifications: async () => {
      asked = true;
      return feedOf(3);
    },
  });

  assert.deepEqual(feed, { items: [], count: 0 });
  assert.equal(asked, false, "계정도 못 찾았는데 알림을 계산했다");
});

test("🔴 알림 규칙을 복제하지 않는다 — 되짚은 사람으로 **그 함수를 그대로** 부른다", async () => {
  const seen: { id: string; role: UserRole }[] = [];
  await buildPortalNotificationFeed({
    subject: SUBJECT,
    clientId: CLIENT_ID,
    findActor: findAdmin,
    listNotifications: async (actor) => {
      seen.push(actor);
      return feedOf(1);
    },
  });

  // 🔴 역할 판정(누가 알림을 받는가)은 그 함수 안에 있다 — 여기서 다시 하지 않는다.
  assert.deepEqual(seen, [{ id: admin.id, role: "ADMIN" }]);
});

/* ── 옮겨 담기 ────────────────────────────────────────────────────────── */

test("🔴 포털에 답할 때는 sourceId 를 **자기 client_id** 로 채운다(내 종과 반대다)", async () => {
  const feed = await buildPortalNotificationFeed({
    subject: SUBJECT,
    clientId: CLIENT_ID,
    findActor: findAdmin,
    listNotifications: async () => feedOf(2),
  });

  for (const item of feed.items) {
    assert.equal(item.sourceId, CLIENT_ID, "🔴 빈 문자열이 나갔다 — 내 화면용 모양이다");
    assert.equal(item.sourceName, PORTAL_SOURCE_NAME);
    // 여러 시스템의 줄이 한 목록에 섞이므로 id 만으로는 부딪힌다.
    assert.equal(item.key, `${CLIENT_ID}:${item.id}`);
    // 포털이 버리는 세 칸은 반드시 차 있어야 한다.
    assert.notEqual(item.id, "");
    assert.notEqual(item.subject, "");
    assert.ok(item.href.startsWith("http"), "🔴 절대 주소가 아니면 포털이 그 줄을 버린다");
    assert.doesNotThrow(() => new URL(item.href));
  }
});

test("아홉 칸이 그대로 있고 빈 값은 빈 문자열이다", async () => {
  const feed = await buildPortalNotificationFeed({
    subject: SUBJECT,
    clientId: CLIENT_ID,
    findActor: findAdmin,
    listNotifications: async () => feedOf(1),
  });

  assert.deepEqual(Object.keys(feed.items[0]).sort(), [
    "detail",
    "href",
    "id",
    "key",
    "kind",
    "kindLabel",
    "sourceId",
    "sourceName",
    "subject",
  ]);
  for (const value of Object.values(feed.items[0])) {
    assert.equal(typeof value, "string");
  }
});

test("🔴 items 를 진짜로 채운다 — 포털이 count 를 줄 수로 깎는다", async () => {
  const feed = await buildPortalNotificationFeed({
    subject: SUBJECT,
    clientId: CLIENT_ID,
    findActor: findAdmin,
    listNotifications: async () => feedOf(6),
  });

  assert.equal(feed.items.length, 6);
  assert.equal(feed.count, 6, "개수만 보내면 포털에서 0이 된다");
});

test("🔴 시스템당 200줄에서 자르고, 개수도 자른 뒤의 줄 수다", async () => {
  const feed = await buildPortalNotificationFeed({
    subject: SUBJECT,
    clientId: CLIENT_ID,
    findActor: findAdmin,
    listNotifications: async () => feedOf(PORTAL_MAX_ITEMS_PER_SOURCE + 25),
  });

  assert.equal(feed.items.length, PORTAL_MAX_ITEMS_PER_SOURCE);
  assert.equal(feed.count, PORTAL_MAX_ITEMS_PER_SOURCE, "보이는 것보다 큰 숫자를 보냈다");
});

/* ── 알림 설정 ────────────────────────────────────────────────────────── */

test("설정 표는 **코드에 있는 규칙 그대로**다 — 종류 하나, 받는 사람은 관리자", () => {
  const settings = improvementRequestNotificationSettings();

  assert.deepEqual(
    settings.roles.map((role) => role.code),
    ["ADMIN", "MEMBER"],
  );
  assert.equal(settings.kinds.length, 1, "이 사이트의 알림 종류는 하나뿐이다");

  const [kind] = settings.kinds;
  assert.equal(kind.kind, IMPROVEMENT_REQUEST_NOTIFICATION_KIND);
  assert.equal(kind.enabled, true);
  assert.equal(kind.defaultEnabled, true);
  assert.deepEqual(kind.roles.ADMIN, { receives: true, defaultReceives: true });
  assert.deepEqual(kind.roles.MEMBER, { receives: false, defaultReceives: false });
});

test("🔴 모든 칸이 editable: false 다 — 저장할 표가 없다는 사실을 화면이 알아야 한다", () => {
  const settings = improvementRequestNotificationSettings();
  assert.equal(
    settings.roles.every((role) => role.editable === false),
    true,
  );
  // 포털이 그리는 데 필요한 글자가 전부 있다(dss-auth 의 parseSettingsPayload).
  for (const role of settings.roles) {
    assert.equal(typeof role.label, "string");
    assert.notEqual(role.label, "");
  }
  for (const kind of settings.kinds) {
    assert.notEqual(kind.label, "");
    assert.notEqual(kind.description, "");
  }
});

test("설정을 읽는 것도 관리자만 — 🔴 없는 사람과 일반 사용자가 **같은 문장**이다", async () => {
  const nobody = await readPortalNotificationSettings({ subject: SUBJECT, findActor: findNobody });
  const notAdmin = await readPortalNotificationSettings({ subject: SUBJECT, findActor: findMember });

  assert.equal(nobody.ok, false);
  assert.equal(notAdmin.ok, false);
  if (nobody.ok || notAdmin.ok) return;
  assert.equal(nobody.status, 403);
  assert.equal(notAdmin.status, 403);
  // 구분해 주면 토큰 하나로 「그 사람이 있는지」와 「관리자인지」를 알아낼 수 있다.
  assert.equal(nobody.message, notAdmin.message, "🔴 403 의 까닭이 갈라진다");
});

test("관리자는 설정을 읽을 수 있다", async () => {
  const result = await readPortalNotificationSettings({ subject: SUBJECT, findActor: findAdmin });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.kinds.length, 1);
});

test("🔴 저장은 **언제나 거절**하고, 까닭은 관문을 통과한 관리자에게만 간다", async () => {
  const asAdmin = await writePortalNotificationSettings({ subject: SUBJECT, findActor: findAdmin });
  const asMember = await writePortalNotificationSettings({
    subject: SUBJECT,
    findActor: findMember,
  });

  assert.equal(asAdmin.status, 403);
  assert.equal(asAdmin.message, SETTINGS_READ_ONLY_MESSAGE, "바꿀 수 없는 까닭을 말해야 한다");
  assert.equal(asMember.status, 403);
  assert.notEqual(
    asMember.message,
    SETTINGS_READ_ONLY_MESSAGE,
    "🔴 관리자가 아닌 사람에게 시스템 사정을 알려 준다",
  );
});

/* ── 라우트 (소스를 글자로 읽는다) ────────────────────────────────────── */

test("🔴 대상 사용자는 **토큰 안에서만** 온다 — 쿼리 문자열을 읽지 않는다", () => {
  for (const source of [feedRoute, settingsRoute]) {
    assert.match(source, /verified\.subject/);
    assert.equal(
      /searchParams|request\.url|nextUrl/.test(source),
      false,
      "🔴 주소에서 값을 읽는다 — 토큰 하나로 아무 사람의 알림이나 볼 수 있게 된다",
    );
  }
});

test("🔴 통로마다 **다른 purpose** 를 요구한다 — 최소 권한", () => {
  assert.match(feedRoute, /PORTAL_TOKEN_PURPOSES\.notificationsRead/);
  assert.match(settingsRoute, /PORTAL_TOKEN_PURPOSES\.notificationSettingsRead/);
  assert.match(settingsRoute, /PORTAL_TOKEN_PURPOSES\.notificationSettingsWrite/);
  // 알림 읽기용 토큰으로 설정을 고칠 수 없어야 한다.
  assert.equal(settingsRoute.includes("PORTAL_TOKEN_PURPOSES.notificationsRead"), false);
});

test("🔴 거절의 까닭을 밖으로 내보내지 않는다 · 답은 캐시되지 않는다", () => {
  for (const source of [feedRoute, settingsRoute]) {
    assert.match(source, /"cache-control": "no-store"/);
    assert.match(source, /error: "invalid_token"/);
    // 검증 실패의 종류(reason)를 몸통에 싣지 않는다.
    assert.equal(/verified\.reason|result\.reason/.test(source), false);
    assert.match(source, /"www-authenticate": "Bearer"/);
  }
});

test("🔴 실패해도 500 을 흘리지 않는다 — 503 으로 답하고 안쪽 사정은 감춘다", () => {
  for (const source of [feedRoute, settingsRoute]) {
    assert.match(source, /catch \(error\)/);
    assert.match(source, /temporarily_unavailable/);
    assert.match(source, /name: error instanceof Error \? error\.name : "unknown"/);
  }
});

test("🔴 알림 목록은 화면의 종과 **같은 함수**로 만든다", () => {
  assert.match(feedRoute, /listOwnNotifications/);
  assert.match(feedRoute, /buildPortalNotificationFeed\(\{/);
  assert.match(feedRoute, /clientId: env\.ssoClientId/);
  // 알림을 따로 계산하거나 DB 를 직접 뒤지지 않는다.
  assert.equal(/db\.select|improvementRequests/.test(feedRoute), false);
});

test("설정 저장은 본문을 읽지 않는다 — 어떤 값이 와도 답이 같다", () => {
  assert.equal(
    /request\.json\(\)/.test(settingsRoute),
    false,
    "본문을 읽으면 「모양만 맞추면 저장된다」는 거짓 신호를 준다",
  );
});
