import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { NotificationBell } from "@dss/ui";
import type { NotificationBellItem } from "@dss/ui";

import {
  acknowledgePickedNotification,
  dismissVisibleNotifications,
} from "@/components/NotificationBellWithAcknowledge";
import {
  buildImprovementRequestNotifications,
  acknowledgeableNotificationKeys,
  improvementRequestNotificationId,
  isOwnNotificationKey,
  shouldAcknowledgeNotification,
  withoutDismissed,
  MAX_DISMISS_KEYS_AT_ONCE,
  vetDismissKeys,
} from "@/lib/domain/notifications";
import { dismissPortalNotifications, normalizePortalNotificationFeed } from "./oidc";

/**
 * ============================================================================
 * 🔴 알림 지움이 흐르는 길 — 누르는 자리 · 적는 자리 · 걸러지는 자리
 * ============================================================================
 * 2026-10-19 까지 「이 알림 그만 보겠다」는 **각 사이트의 브라우저**에 적혔다.
 * 브라우저 저장소는 주소(포트)별로 갈려서, A/S(3000)에서 지운 줄이 개선요청
 * (3500)의 종에는 그대로 떴다 — 같은 사람이 시스템마다 다른 목록을 봤다.
 * 그래서 지움을 포털 한 곳으로 모았다:
 *
 *   종의 ✕ (@dss/ui 가 그린다)
 *     → 서버 액션(server/actions/notification-dismissals.ts)이 **제 세션에서**
 *       사람 번호를 읽고
 *     → auth/oidc.ts 가 포털의 쓰기 통로에 Basic 자격으로 POST 하고
 *     → revalidate 로 사내 구간 레이아웃이 다시 그려지면 그 줄이 빠진다
 *
 * ── 🔴 이 사이트에만 있는 어려운 점 둘 ─────────────────────────────────
 *  ① **열쇠에 접두사가 없었다.** 포털에 적히는 열쇠는 `{client_id}:{id}` 인데
 *     이 사이트의 제 줄은 `key` 가 `id` 와 같았다 — 그대로 두면 계측기에서
 *     지워도 개선요청 종에는 그대로 남는다. 그래서 `key` 에 접두사를 붙였다.
 *  ② 🔴 **확인 기록은 DB 에 영구 저장된다**(notification_acknowledgements,
 *     `(user_id, notification_key)` 에 유일 제약). 확인 경로가 `item.key` 를
 *     쓰도록 바뀌면 옛 기록과 모양이 달라져 **이미 확인한 알림이 전부 다시
 *     뜬다** — 되돌릴 수도 없다. 그래서 `id` 칸은 그대로 두고, 확인은 계속
 *     `item.id` 로 적는다. 🔴 그 성질을 아래 「확인 기록은 깨지지 않는다」
 *     절이 못 박는다.
 *
 * ── 여기서 지키는 것 여덟 ───────────────────────────────────────────────
 *  1. 🔴 **어떤 답이 와도 던지지 않는다.** ✕ 를 누른 그 순간, 종의 다른 처리
 *     한가운데서 불린다 — 여기서 예외가 새면 그 누름이 통째로 멈춘다.
 *  2. 🔴 **200개씩 나눠 보낸다.** 넘기면 포털이 400 으로 **통째로** 거절한다.
 *  3. 🔴 **빈 목록은 아예 보내지 않는다** — 포털이 400 으로 거절한다.
 *  4. 🔴 **누구의 지움인지는 서버가 정한다.**
 *  5. 🔴 **`client_secret` 은 브라우저로 나가지 않는다.**
 *  6. 🔴 **제 줄을 거르면서 개수도 함께 줄인다.**
 *  7. 🔴 **열쇠의 접두사가 포털에 등록된 이름과 같다.**
 *  8. 🔴 **확인에 넘어가는 값은 `id`** 이고 `key` 와 **다르다**.
 *
 * 🔴 이 시험은 DB 에도 바깥 망에도 닿지 않는다 — 포털을 부르는 자리는 가짜
 *    fetch 로 가로챈다(unit.txt 의 규칙).
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

const ACTION_PATH = "src/lib/server/actions/notification-dismissals.ts";
const actionRaw = read(ACTION_PATH);
const action = withoutComments(actionRaw);
const oidc = withoutComments(read("src/lib/auth/oidc.ts"));
const bellComponent = withoutComments(read("src/components/PortalNotificationBell.tsx"));
const bellShell = withoutComments(read("src/components/NotificationBellWithAcknowledge.tsx"));
const ownQuery = withoutComments(read("src/lib/db/queries/notifications.ts"));
const domain = withoutComments(read("src/lib/domain/notifications.ts"));
/* 서브모듈(vendor/dss-ui)이 실제로 실고 있는 것. 포인터가 옛 커밋이면 ✕ 가 없다. */
const vendorBell = read("vendor/dss-ui/src/notification-bell/NotificationBell.tsx");
const vendorBehavior = read("vendor/dss-ui/src/notification-bell/BellBehavior.tsx");
const vendorCss = read("vendor/dss-ui/src/notification-bell/notification-bell.css");

/** 포털에 등록된 이 시스템의 식별자. 열쇠의 접두사다. */
const CLIENT_ID = "dss-improvements";

/* ── 가짜 포털 ────────────────────────────────────────────────────────── */

type PortalCall = { url: string; headers: Record<string, string>; body: URLSearchParams };

/** 포털이 보내는 정상 답. `recorded` 는 **뜻이 지켜진 수**다(새 행 수가 아니다). */
function accepted(count: number): Response {
  return new Response(JSON.stringify({ recorded: count, dropped: 0 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rejected(status: number): Response {
  return new Response(JSON.stringify({ error: "invalid_request", error_description: "" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 포털 자리에 가짜를 세우고 일을 시킨 뒤, **무엇이 나갔는지**를 돌려준다.
 * 🔴 진짜 망에 나가지 않는다. 환경변수도 이 블록 안에서만 산다.
 */
async function callingPortal(
  answer: (call: PortalCall, nth: number) => Response,
  run: () => Promise<boolean>,
): Promise<{ calls: PortalCall[]; recorded: boolean }> {
  const calls: PortalCall[] = [];
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };

  process.env.SSO_ISSUER = "http://portal.invalid";
  process.env.SSO_CLIENT_ID = CLIENT_ID;
  process.env.SSO_CLIENT_SECRET = "가짜-시크릿";

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const call: PortalCall = {
      url: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: new URLSearchParams(String(init.body ?? "")),
    };
    calls.push(call);
    return answer(call, calls.length);
  }) as typeof fetch;

  let recorded: boolean;
  try {
    recorded = await run();
  } finally {
    globalThis.fetch = realFetch;
    process.env = realEnv;
  }

  return { calls, recorded };
}

function dismissalKeys(count: number, prefix = CLIENT_ID): string[] {
  return Array.from(
    { length: count },
    (_, at) => `${prefix}:IMPROVEMENT_REQUEST:00000000-0000-4000-8000-${String(at + 1).padStart(12, "0")}`,
  );
}

/* ── 1. 보내지 않아야 하는 때 ─────────────────────────────────────────── */

describe("보내지 않아야 하는 때", () => {
  it("🔴 보낼 열쇠가 없으면 포털을 아예 부르지 않는다 — 빈 묶음은 400 으로 거절된다", async () => {
    for (const empty of [[], [""], ["", ""]]) {
      const { calls, recorded } = await callingPortal(
        () => accepted(0),
        () => dismissPortalNotifications("00000000-0000-0000-0000-000000000000", empty),
      );
      assert.equal(calls.length, 0, `${JSON.stringify(empty)} 로 포털을 불렀다`);
      assert.equal(recorded, false);
    }
  });

  it("사람 번호가 비어 있으면 아예 적지 않는다", async () => {
    const { calls, recorded } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("", dismissalKeys(1)),
    );
    assert.equal(calls.length, 0);
    assert.equal(recorded, false);
  });
});

/* ── 2. 나가는 모양 ───────────────────────────────────────────────────── */

describe("나가는 모양", () => {
  it("🔴 자격증명은 Authorization: Basic 으로만 나간다 — 주소에 싣지 않는다", async () => {
    const one = `${CLIENT_ID}:IMPROVEMENT_REQUEST:11111111-1111-4111-8111-111111111111`;
    const { calls, recorded } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("사람-1", [one]),
    );

    assert.equal(recorded, true);
    assert.equal(calls.length, 1);

    const [call] = calls;
    assert.equal(call.url, "http://portal.invalid/api/integration/notification-dismissals");
    // 🔴 주소에 실리면 포털이 400 으로 거절하고, 그 값은 이미 접근 로그에 남아
    //    **다시 발급**해야 한다(dss-auth/docs/사이트-알림-통로.md).
    assert.equal(call.url.includes("?"), false, "🔴 주소에 무언가 실렸다");
    assert.match(call.headers.authorization, /^Basic /);
    assert.equal(call.headers["content-type"], "application/x-www-form-urlencoded");

    // 몸통에 실리는 것은 둘뿐이다.
    assert.deepEqual([...call.body.keys()].sort(), ["keys", "sub"]);
    assert.equal(call.body.get("sub"), "사람-1");
    assert.equal(call.body.get("keys"), one);
  });

  it("읽는 통로와 같은 자격·같은 상한·같은 no-store 를 쓴다", () => {
    const write = oidc.slice(oidc.indexOf("async function recordDismissalChunk"));
    assert.ok(write.length > 0, "지움을 적는 함수를 찾지 못했다");
    assert.match(write, /authorization: `Basic \$\{Buffer\.from\(credentials/);
    assert.match(write, /signal: AbortSignal\.timeout\(NOTIFICATIONS_TIMEOUT_MS\)/);
    assert.match(write, /cache: "no-store"/);
  });

  it("🔴 자격증명도 열쇠도 로그에 찍지 않는다 — 찍히는 것은 오류의 종류와 상태뿐이다", () => {
    const write = oidc.slice(oidc.indexOf("async function recordDismissalChunk"));
    for (const logged of write.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
      const args = logged[2];
      assert.equal(
        /credentials|ssoClientSecret|ssoClientId|authorization/i.test(args),
        false,
        `🔴 로그에 자격증명이 딸려 나간다: ${args.trim().slice(0, 60)}`,
      );
      // 🔴 열쇠도 찍지 않는다 — 그 안에 개선요청 id 가 들어 있다.
      assert.equal(/\bkeys?\b/i.test(args), false, `🔴 로그에 열쇠가 딸려 나간다: ${args.trim()}`);
    }
    // 서버 액션도 같다 — 오류의 **종류**만 남긴다.
    for (const logged of action.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
      assert.match(
        logged[2],
        /name: error instanceof Error \? error\.name : "unknown"/,
        `🔴 로그에 오류 종류 말고 다른 것이 실린다: ${logged[2].trim().slice(0, 60)}`,
      );
    }
  });
});

/* ── 3. 200개씩 나눠 보낸다 ───────────────────────────────────────────── */

describe("200개씩 나눠 보낸다", () => {
  it("🔴 200개까지는 한 번에 간다", async () => {
    const { calls, recorded } = await callingPortal(
      () => accepted(200),
      () => dismissPortalNotifications("사람-1", dismissalKeys(200)),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.get("keys")?.split(",").length, 200);
    assert.equal(recorded, true);
  });

  it("🔴 201개부터 나눠 보낸다 — 한 번에 보내면 포털이 **통째로** 거절한다", async () => {
    const wanted = dismissalKeys(450);
    const { calls, recorded } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("사람-1", wanted),
    );

    assert.equal(calls.length, 3, "묶음 수가 다르다");
    assert.deepEqual(
      calls.map((call) => call.body.get("keys")?.split(",").length),
      [200, 200, 50],
    );
    // 🔴 나누면서 **한 개도 흘리지 않는다.** 차례도 그대로다.
    assert.deepEqual(
      calls.flatMap((call) => call.body.get("keys")?.split(",") ?? []),
      wanted,
    );
    // 사람 번호는 묶음마다 같은 값이 실린다.
    assert.deepEqual(new Set(calls.map((call) => call.body.get("sub"))), new Set(["사람-1"]));
    assert.equal(recorded, true);
  });

  it("같은 열쇠가 두 번 실려 와도 한 번만 보낸다", async () => {
    const one = dismissalKeys(1)[0];
    const { calls } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("사람-1", [one, one, one]),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.get("keys")?.split(","), [one]);
  });
});

/* ── 4. 🔴 던지지 않는다 ──────────────────────────────────────────────── */

describe("🔴 어떤 답이 와도 던지지 않는다", () => {
  it("🔴 설정이 빠져도 던지지 않는다 — env 의 getter 가 던지는 자리까지 삼킨다", async () => {
    const realEnv = { ...process.env };
    delete process.env.SSO_ISSUER;
    delete process.env.SSO_CLIENT_ID;
    delete process.env.SSO_CLIENT_SECRET;

    try {
      assert.equal(await dismissPortalNotifications("사람-1", dismissalKeys(1)), false);
    } finally {
      process.env = realEnv;
    }
  });

  it("🔴 거절(400·401·403·429·503)도 삼킨다 — 던지지 않고 false 다", async () => {
    for (const status of [400, 401, 403, 429, 503]) {
      const { recorded } = await callingPortal(
        () => rejected(status),
        () => dismissPortalNotifications("사람-1", dismissalKeys(1)),
      );
      assert.equal(recorded, false, `${status} 에서 false 가 아니다`);
    }
  });

  it("🔴 한 묶음이 거절돼도 나머지 묶음은 그대로 보낸다", async () => {
    // 가운데가 503 이어도 셋 다 나가야 한다. 여기서 멈추면 뒤쪽 열쇠는 영영 적히지
    // 않는데, 🔵 이 통로는 몇 번을 다시 보내도 안전하므로 멈출 까닭이 없다.
    const { calls, recorded } = await callingPortal(
      (_call, nth) => (nth === 2 ? rejected(503) : accepted(200)),
      () => dismissPortalNotifications("사람-1", dismissalKeys(450)),
    );
    assert.equal(calls.length, 3);
    assert.equal(recorded, false, "🔴 하나라도 거절됐으면 false 여야 한다");
  });

  it("🔴 이 통로에는 throw 가 한 군데도 없다", () => {
    const write = oidc.slice(oidc.indexOf("async function recordDismissalChunk"));
    assert.ok(write.length > 0, "지움을 적는 함수를 찾지 못했다");
    assert.equal(/\bthrow\b/.test(write), false, "🔴 지움 통로가 던진다 — 누름이 통째로 멈춘다");
    assert.equal(/\bthrow\b/.test(action), false, "🔴 서버 액션이 던진다");
    // 액션 전체가 try 로 싸여 있다 — 세션 조회(DB)도 포털 왕복도 함께 삼킨다.
    assert.match(action, /try \{[\s\S]*?\} catch \(error\) \{/);
  });
});

/* ── 5. 🔴 누구의 지움인지는 서버가 정한다 ────────────────────────────── */

describe("누구의 지움인지는 서버가 정한다", () => {
  it('🔴 서버 액션이다 — 파일 첫 줄이 "use server" 다', () => {
    assert.match(actionRaw, /^"use server";\n/, '🔴 "use server" 가 파일 맨 앞이 아니다');
  });

  it("🔴 사람 번호를 **세션에서** 읽는다 — 브라우저가 보낸 값을 쓰지 않는다", () => {
    assert.match(action, /const actor = await getSessionUser\(\);/);
    assert.match(action, /dismissPortalNotifications\(actor\.authSub, \[dismissalKey\]\)/);
    // 🔴 받는 것은 종이 넘겨 준 줄 하나뿐이다. sub·subject 를 인자로 받으면
    //    브라우저가 아무 번호나 실어 **남의 알림을 지우는 통로**가 된다.
    const signature = action.slice(action.indexOf("export async function dismissNotificationAction"));
    assert.match(
      signature,
      /^export async function dismissNotificationAction\(\s*item: NotificationBellItem,?\s*\)/,
    );
    // 🔴 세션이 끊긴 사람은 아무 일도 일어나지 않는다(로그인으로 튀지 않는다).
    assert.equal(
      action.includes("requireSession"),
      false,
      "🔴 종의 ✕ 하나 때문에 보던 화면이 로그인으로 튄다",
    );
  });

  it("🔴 세션이 없거나 열쇠가 비면 포털을 부르지 않는다", () => {
    assert.match(action, /if \(!actor\) return;/);
    assert.match(action, /if \(dismissalKey === ""\) return;/);
  });
});

/* ── 6. 🔴 client_secret 이 브라우저로 나가지 않는다 ──────────────────── */

/** `"use client"` 가 **첫 토큰**인 파일만 고른다(주석에 적힌 낱말은 세지 않는다). */
function clientFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = withoutComments(fs.readFileSync(full, "utf8")).trimStart();
      if (/^["']use client["']/.test(source)) found.push(full);
    }
  };
  walk(path.resolve(ROOT, "src"));
  return found;
}

describe("client_secret 이 브라우저로 나가지 않는다", () => {
  it("🔴 시크릿을 읽는 모듈을 클라이언트 조각이 부르지 않는다", () => {
    // auth/oidc.ts 와 env.ts 는 `client_secret` 을 읽는다. 클라이언트 그래프에 한
    // 번 들어가면 그 값이 번들에 실릴 길이 생긴다 — 들어갔는지는 화면에서
    // 드러나지 않으므로 여기서 본다.
    // 🔴 **단순 grep 으로 고르지 않는다** — 서버 조각의 주석에 그 낱말이 있으면
    //    (실제로 (app)/layout.tsx 와 AppHeader.tsx 의 머리말에 있다) 엉뚱한
    //    파일이 걸린다. 주석을 걷어낸 뒤 **첫 토큰**으로 가린다.
    const files = clientFiles();
    assert.ok(files.length > 0, "클라이언트 조각을 하나도 못 찾았다 — 고르는 방식이 깨졌다");
    for (const file of files) {
      const source = withoutComments(fs.readFileSync(file, "utf8"));
      assert.equal(
        /from "@\/lib\/auth\/oidc"|from "@\/lib\/env"/.test(source),
        false,
        `🔴 클라이언트 조각이 서버 전용 모듈을 부른다: ${path.relative(ROOT, file)}`,
      );
    }
  });

  it("🔴 종을 그리는 서버 조각은 서버 그대로다 — 지우기를 붙이면서 넘기지 않았다", () => {
    // 넘어갔다면 `client_secret` 을 다루는 자리가 하나 더 생긴다.
    assert.equal(
      clientFiles().includes(path.resolve(ROOT, "src/components/PortalNotificationBell.tsx")),
      false,
    );
    // 🔴 브라우저용 중계 통로. `api/integration/notifications` 는 **다른 것**이다 —
    //    포털이 우리 알림을 가져가는 들어오는 길이고, 자격이 포털의 서명이다.
    assert.equal(
      fs.existsSync(path.resolve(ROOT, "src/app/api/notifications")),
      false,
      "브라우저용 중계 통로가 생겼다 — 생겼다면 세션 재검증까지 함께 봐야 한다",
    );
    // 껍데기는 액션을 **받아서** 쓴다(직접 가져오지 않는다).
    assert.equal(bellShell.includes("notification-dismissals"), false);
    assert.match(bellShell, /dismiss\?: DismissNotification;/);
  });
});

/* ── 7. 그리는 자리 — ✕ 가 서고, 다음 렌더에서 줄어든다 ──────────────── */

describe("그리는 자리", () => {
  it("🔴 종에 서버 액션이 닿는다 — 이 함수가 있어야 ✕ 가 그려진다", () => {
    // 🔵 가져오는 줄의 **생김새**를 못 박지 않는다(2026-10-20). 같은 파일에서
    //    일괄 지우기 액션을 함께 가져오면서 한 줄이 여러 줄로 갈라졌는데, 그때
    //    깨지는 것은 보장이 아니라 글자 모양뿐이었다. 보는 것은 「그 파일에서
    //    이 이름을 가져오는가」다.
    const imported = bellComponent.match(
      /import \{([\s\S]*?)\} from "@\/lib\/server\/actions\/notification-dismissals";/,
    );
    assert.ok(imported, "🔴 지움 액션을 가져오는 줄이 없다");
    assert.match(imported[1], /\bdismissNotificationAction\b/);
    assert.match(bellComponent, /dismiss=\{dismissNotificationAction\}/);
    assert.match(bellShell, /onDismiss=\{dismiss\}/);
  });

  it("🔴 모든 줄에 ✕ 가 선다 — 종류를 가리지 않는다", () => {
    // A/S 가 「처리해야 사라지는 제 할 일」은 못 지우게 가렸는데 2026-10-20 에 그
    // 규칙을 **풀었다**(A/S 의 551641f) — 다른 시스템의 종에서는 어차피 지워져서,
    // 막는 것이 아니라 헷갈리게 만들고 있었기 때문이다. canDismiss 를 다시
    // 넘기려면 그때는 까닭이 함께 적혀 있어야 한다.
    assert.equal(bellShell.includes("canDismiss"), false);
  });

  it("🔴 지운 뒤 다음 렌더에서 줄이 빠진다 — 사내 구간 **레이아웃**을 되살린다", () => {
    // 종은 (app)/layout.tsx 가 그린다. 화면 하나만 되살리면 레이아웃은 그대로라
    // ✕ 를 눌러도 줄이 남는다.
    assert.match(action, /revalidatePath\("\/", "layout"\);/);
    // 적히지 않았으면 되살리지 않는다 — 목록이 똑같을 것이므로 캐시만 버리게 된다.
    const tail = action.slice(action.indexOf("const recorded"));
    assert.ok(
      tail.indexOf("if (!recorded) return;") < tail.indexOf('revalidatePath("/", "layout")'),
      "🔴 거절당했는데도 캐시를 버린다",
    );
  });

  it("🔴 포털이 보낸 개수는 손대지 않는다 — 남의 줄 몫이고 지움이 이미 반영돼 있다", () => {
    assert.match(bellComponent, /count=\{own\.count \+ feed\.count\}/);
  });

  it("🔴 묶음 포인터가 ✕ 가 있는 판이다 — 옛 판에는 단추가 아예 없다", () => {
    assert.match(vendorBell, /className="dss-bell__dismiss"/);
    assert.match(vendorBell, /onDismiss\?: \(item: NotificationBellItem\) => void;/);
    assert.match(vendorCss, /\.dss-bell__dismiss \{/);
  });
});

/* ── 8. 🔴 지움과 「확인하는 동안 미리 감추기」는 **다른 것**이다 ─────── */

describe("지움과 미리 감추기는 섞이지 않는다", () => {
  it("🔴 ✕ 는 줄의 링크 **밖**이라 같은 누름이 확인으로 가지 않는다", () => {
    // 이것이 참이라서 지움 쪽에서 hide/restore 를 쓸 까닭이 없다. 묶음이 두 길을
    // **다른 선택자**로 가른다 — 겹쳤다면 한 번 누른 것이 「지웠다」와
    // 「확인했다」 둘로 읽히고 페이지 이동까지 일어난다.
    assert.match(vendorBehavior, /const LINK = "a\.dss-bell__link";/);
    assert.match(vendorBehavior, /const DISMISS = "button\.dss-bell__dismiss";/);
    // 단추는 <li> 의 직계다 — 링크가 닫힌 **뒤에** 온다.
    const linkCloses = vendorBell.indexOf("</a>");
    const button = vendorBell.indexOf('className="dss-bell__dismiss"');
    assert.ok(linkCloses > 0 && button > linkCloses, "🔴 ✕ 가 링크 안에 들어갔다");
  });

  it("🔴 지움은 감추지 않는다 — 감추면 포털이 거절했을 때 되살릴 길이 없다", () => {
    // hide/restore 는 **확인을 저장하는 동안** 쓰는 장치다. 받은 액션을 **그대로**
    // 넘기므로 감추기를 끼워 넣을 자리 자체가 없다 — 감싸는 함수가 생기면 걸린다.
    assert.match(bellShell, /onDismiss=\{dismiss\}/);
    assert.equal(
      /onDismiss=\{\(/.test(bellShell),
      false,
      "🔴 지움을 감싸는 함수가 생겼다 — 거기서 감추면 거절됐을 때 되살릴 길이 없다",
    );
    assert.equal(action.includes("hide"), false, "🔴 서버 액션이 감추기까지 하려 든다");
  });

  it("감추기는 `key` 로, 확인은 `id` 로 — 접두사가 붙어도 둘이 어긋나지 않는다", () => {
    // 감춘 줄을 목록에서 빼는 것도 `item.key` 다(visibleItems). 둘이 같은 값을
    // 써야 「감췄는데 안 사라지는 줄」이 생기지 않는다.
    assert.match(bellShell, /view\.hide\(item\.key\)/);
    assert.match(bellShell, /hiddenKeys\.has\(item\.key\)/);
  });
});

/* ── 9. 🔴 확인 기록은 깨지지 않는다 ─────────────────────────────────── */

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OWN_ID = improvementRequestNotificationId(REQUEST_ID);
const OWN_KEY = `${CLIENT_ID}:${OWN_ID}`;

function ownRow(): NotificationBellItem {
  return {
    key: OWN_KEY,
    sourceId: "",
    sourceName: "",
    id: OWN_ID,
    kind: "IMPROVEMENT_REQUEST",
    kindLabel: "새 개선요청",
    subject: "DSS A/S 관리 시스템 · 전체 A/S 현황",
    detail: "김아무개: 검색이 안 됩니다.",
    href: "http://192.168.1.132:3500/",
  };
}

describe("🔴 확인 기록은 깨지지 않는다 — 넘어가는 값은 `id` 다", () => {
  it("🔴 확인에 넘어가는 값이 `id` 이고 `key` 와 **다르다**", () => {
    const asked: string[] = [];
    const hidden: string[] = [];

    acknowledgePickedNotification(
      ownRow(),
      async ({ notificationKey }) => {
        asked.push(notificationKey);
        return { ok: true };
      },
      { hide: (key) => hidden.push(key), restore: () => {} },
    );

    // 🔴 여기가 이 조각에서 가장 위험한 자리다. `item.key` 로 바뀌면 옛 확인
    //    기록과 모양이 달라져 **이미 확인한 알림이 전부 다시 뜬다**(되돌릴 수
    //    없다 — 사람들이 다시 확인해야 한다).
    assert.deepEqual(asked, [OWN_ID], "🔴 확인에 접두사가 붙은 열쇠가 넘어갔다");
    assert.notEqual(OWN_ID, OWN_KEY, "둘이 같으면 이 시험이 아무것도 못 본다");
    // 감추는 쪽은 `key` 다(목록을 거르는 값과 같아야 한다).
    assert.deepEqual(hidden, [OWN_KEY]);

    // 소스에도 못 박는다 — 가짜 함수를 넘기는 위 시험만으로는 다른 경로가
    // 생겼을 때 조용히 지나간다.
    assert.match(bellShell, /acknowledge\(\{ notificationKey: item\.id \}\)/);
    assert.equal(/notificationKey: item\.key/.test(bellShell), false);
  });

  it("🔴 접두사가 붙은 열쇠는 확인 기록 표에 **들어가지 못한다** — 모양 검사가 막는다", () => {
    // 서버 액션이 isOwnNotificationKey 로 다시 본다. 즉 누군가 `item.key` 를
    // 넘기도록 바꾸면 조용히 틀리는 것이 아니라 **확인이 아예 안 적힌다** —
    // 그 편이 옛 기록과 어긋난 줄이 표에 쌓이는 것보다 낫다.
    assert.equal(isOwnNotificationKey(OWN_ID), true);
    assert.equal(isOwnNotificationKey(OWN_KEY), false, "🔴 접두사가 붙은 열쇠가 통과한다");
    // 「적을 수 있는 줄인가」 판정은 `id` 를 본다 — 접두사가 붙어도 그대로 참이다.
    assert.equal(shouldAcknowledgeNotification(ownRow()), true);
  });

  it("🔴 「전부 확인」도 `id` 만 모은다 — 접두사가 섞여 들어가지 않는다", () => {
    const feed = buildImprovementRequestNotifications({
      requests: [
        { id: REQUEST_ID, serviceKey: "rf-service-system", menuKey: null, body: "가짜", status: "OPEN", createdByName: "김아무개" },
      ],
      acknowledgedKeys: [],
      baseUrl: "http://192.168.1.132:3500",
      clientId: CLIENT_ID,
    });

    assert.deepEqual(acknowledgeableNotificationKeys(feed.items), [OWN_ID]);
  });

  it("🔴 **옛 확인 기록이 그대로 듣는다** — 거르는 값은 접두사 없는 `id` 다", () => {
    // DB 에 이미 쌓인 열쇠는 전부 `IMPROVEMENT_REQUEST:<uuid>` 다. 접두사를
    // 붙이면서 거르는 값까지 바뀌었다면 **확인한 글이 전부 되살아난다.**
    const feed = buildImprovementRequestNotifications({
      requests: [
        { id: REQUEST_ID, serviceKey: "rf-service-system", menuKey: null, body: "가짜", status: "OPEN", createdByName: "김아무개" },
      ],
      acknowledgedKeys: [OWN_ID],
      baseUrl: "http://192.168.1.132:3500",
      clientId: CLIENT_ID,
    });

    assert.deepEqual(feed.items, [], "🔴 이미 확인한 글이 다시 떴다");
    assert.equal(feed.count, 0);
  });
});

/* ── 10. 🔴 열쇠의 접두사 ─────────────────────────────────────────────── */

describe("열쇠의 접두사", () => {
  function build(clientId?: string) {
    return buildImprovementRequestNotifications({
      requests: [
        { id: REQUEST_ID, serviceKey: "rf-service-system", menuKey: null, body: "가짜", status: "OPEN", createdByName: "김아무개" },
      ],
      acknowledgedKeys: [],
      baseUrl: "http://192.168.1.132:3500",
      clientId,
    });
  }

  it("🔴 제 줄의 열쇠는 `{client_id}:` 로 시작한다 — 어긋나면 포털이 조용히 버린다", () => {
    // 포털은 모르는 시스템의 열쇠를 **조용히 버린다**(규격서). 그래서 접두사가
    // 어긋나면 오류 없이 「지워지지 않는 알림」만 남는다.
    const [item] = build("가짜-클라이언트").items;
    assert.equal(item.key, `가짜-클라이언트:${OWN_ID}`);
    assert.equal(item.id, OWN_ID, "🔴 id 가 함께 바뀌었다 — 확인 기록이 깨진다");
  });

  it("🔴 접두사를 못 읽으면 **예전 모양**으로 물러선다 — 종은 그대로 그려진다", () => {
    // 설정을 못 읽었을 때의 모습이다(ownNotificationClientId). 잃는 것은 제 줄
    // 지움이 포털에 안 통하는 것 하나뿐이다.
    for (const fallback of [undefined, ""]) {
      const [item] = build(fallback).items;
      assert.equal(item.key, OWN_ID, `${String(fallback)} 에서 물러서지 않았다`);
      assert.equal(item.id, OWN_ID);
    }
  });

  it("🔴 그 접두사로 넘기는 값은 `SSO_CLIENT_ID` 다 — 포털에 등록된 이름 그대로", () => {
    assert.match(ownQuery, /clientId: ownNotificationClientId\(\),/);
    assert.match(domain, /key: bellKeyOf\(id, input\.clientId \?\? ""\),/);
  });

  it("🔴 그 값을 **던지지 않고** 읽는다 — 설정 하나 때문에 모든 화면이 깨지면 안 된다", () => {
    const reader = ownQuery.slice(ownQuery.indexOf("function ownNotificationClientId"));
    assert.match(reader, /try \{\s*return env\.ssoClientId;\s*\} catch \{\s*return "";/);
    // 🔴 목록을 만드는 try **밖**에서 읽는다. 안에서 읽으면 설정이 빠졌을 때
    //    물러서는 모습이 「접두사 없음」이 아니라 「알림 없음」이 된다.
    const listOwn = ownQuery.slice(ownQuery.indexOf("export async function listOwnNotifications"));
    assert.equal(
      /return env\.ssoClientId/.test(listOwn),
      false,
      "🔴 던지는 getter 를 목록 만드는 try 안에서 읽는다",
    );
  });
});

/* ── 11. 🔴 포털이 돌려준 지움으로 제 줄을 거른다 ─────────────────────── */

function myItem(id: string, clientId = CLIENT_ID): NotificationBellItem {
  return { ...ownRow(), key: `${clientId}:${id}`, id };
}

describe("포털이 돌려준 지움으로 제 줄을 거른다", () => {
  it("🔴 지운 제 줄이 목록에서 빠진다 — 안 거르면 「여기서 지웠는데 여기서만 뜬다」가 된다", () => {
    const mine = { items: [myItem("A"), myItem("B"), myItem("C")], count: 3 };
    const left = withoutDismissed(mine, [`${CLIENT_ID}:B`]);
    assert.deepEqual(
      left.items.map((row) => row.id),
      ["A", "C"],
    );
  });

  it("🔴 **개수도 함께 줄어든다** — 줄만 빠지면 「눌러도 안 없어지는 숫자」가 된다", () => {
    const mine = { items: [myItem("A"), myItem("B"), myItem("C")], count: 3 };
    assert.equal(withoutDismissed(mine, [`${CLIENT_ID}:B`]).count, 2);
    assert.equal(withoutDismissed(mine, [`${CLIENT_ID}:A`, `${CLIENT_ID}:C`]).count, 1);
    // 전부 지우면 0 이다 — 줄도 숫자도 남지 않는다.
    assert.deepEqual(
      withoutDismissed(mine, [`${CLIENT_ID}:A`, `${CLIENT_ID}:B`, `${CLIENT_ID}:C`]),
      { items: [], count: 0 },
    );
  });

  it("🔴 개수가 0 아래로 내려가지 않는다 — 세는 규칙이 줄 수와 달라질 수 있다", () => {
    const mine = { items: [myItem("A"), myItem("B"), myItem("C")], count: 1 };
    assert.equal(
      withoutDismissed(mine, [`${CLIENT_ID}:A`, `${CLIENT_ID}:B`, `${CLIENT_ID}:C`]).count,
      0,
    );
  });

  it("지운 것이 없으면 줄도 개수도 그대로다", () => {
    const mine = { items: [myItem("A")], count: 7 };
    assert.deepEqual(withoutDismissed(mine, []), { items: [myItem("A")], count: 7 });
    // 내 목록에 없는 열쇠가 와도 개수를 건드리지 않는다(이미 사라진 줄의 지움 기록).
    assert.deepEqual(withoutDismissed(mine, [`${CLIENT_ID}:없는줄`]), {
      items: [myItem("A")],
      count: 7,
    });
  });

  it("🔵 열쇠를 **다시 조립하지 않는다** — 만들어진 `item.key` 를 그대로 맞춘다", () => {
    // 접두사 없는 `id` 로는 안 걸린다. 여기서 접두사를 다시 지으면 만드는 자리와
    // 갈라질 수 있고, 갈라지면 아무 오류 없이 「지워지지 않는 알림」만 남는다.
    const mine = { items: [myItem("A")], count: 1 };
    assert.equal(withoutDismissed(mine, ["A"]).items.length, 1);
    assert.equal(withoutDismissed(mine, [`${CLIENT_ID}:A`]).items.length, 0);
  });

  it("🔴 종 조각이 실제로 걸러서 그린다 — 함수를 만들어 놓고 안 쓰면 증상이 똑같다", () => {
    assert.match(bellComponent, /withoutDismissed\(raw, feed\.dismissed\)/);
    assert.match(bellComponent, /items=\{\[\.\.\.own\.items, \.\.\.feed\.items\]\}/);
  });
});

/* ── 12. 포털이 보낸 dismissed 를 읽는다 ──────────────────────────────── */

describe("포털이 보낸 dismissed 를 읽는다", () => {
  it("열쇠 배열을 그대로 싣는다", () => {
    const feed = normalizePortalNotificationFeed({
      items: [],
      count: 0,
      dismissed: [`${CLIENT_ID}:A`, `${CLIENT_ID}:B`],
    });
    assert.deepEqual(feed.dismissed, [`${CLIENT_ID}:A`, `${CLIENT_ID}:B`]);
  });

  it("🔴 칸이 없는 옛 포털에도 돌아간다 — 빈 배열이고 종은 예전 그대로 그려진다", () => {
    for (const body of [
      { items: [], count: 0 },
      { items: [], count: 0, dismissed: null },
      { items: [], count: 0, dismissed: "A,B" },
      {},
    ]) {
      assert.deepEqual(normalizePortalNotificationFeed(body).dismissed, []);
    }
  });

  it("글자가 아닌 조각은 그 조각만 버린다", () => {
    const feed = normalizePortalNotificationFeed({
      items: [],
      count: 0,
      dismissed: [`${CLIENT_ID}:A`, 3, null, "", `${CLIENT_ID}:B`],
    });
    assert.deepEqual(feed.dismissed, [`${CLIENT_ID}:A`, `${CLIENT_ID}:B`]);
  });
});

/* ── 13. 🔴 보이는 알림 지우기(일괄) — 2026-10-20 ─────────────────────── */

/**
 * ============================================================================
 * 「**보이는 알림 지우기 n건**」 — 단추 하나로 종을 비운다
 * ============================================================================
 * 줄이 여럿이면 ✕ 를 여러 번 눌러야 했다. 그 단추는 A/S 에만 있었고, 이제
 * @dss/ui 가 **단추도 글자도 개수도** 그린다(묶음 1210d11). 사이트가 하는 일은
 * 함수를 넘기는 것뿐이다.
 *
 * ── 🔴 이 사이트에서만 어려운 것 셋 ─────────────────────────────────────
 *  ① **제 알림이 있다.** 종은 제 줄과 포털 줄을 합쳐 그린다 — 일괄로 지울 열쇠는
 *     **합쳐진 뒤의 목록**에서 모아야 한다. 빠뜨리면 「전부 지우기를 눌렀는데
 *     내 알림만 남는다」가 된다.
 *  ② 🔴 **확인 기록을 건드리면 안 된다.** 확인은 `item.id`(접두사 없음)를 쓰고
 *     지움은 `item.key`(접두사 있음)를 쓴다 — **다른 값**이다. 일괄에 `id` 가
 *     섞이면 포털이 조용히 버린다(아래 첫 시험이 그것을 못 박는다).
 *  ③ 🔴 **묶음이 그리는 기준과 같게 걸러야 한다.** 묶음은 그릴 수 없는 주소의
 *     줄을 안 그리고 단추에 적는 수도 그렇게 남은 줄 수다 — 안 맞추면 「3건」을
 *     눌렀는데 4건이 지워진다.
 *
 * 🔵 「확인하는 동안 미리 감추기」(hide/restore)와 **섞지 않는다** — 12절 위의
 *    8절이 지키는 선이고, 일괄도 그 선 안에 있다(감추지 않는다).
 * ============================================================================
 */

const dismissAllShell = withoutComments(
  read("src/components/NotificationBellWithAcknowledge.tsx"),
);

/** 포털에서 온 줄 하나 — `sourceId` 에 값이 있고 열쇠에 그쪽 접두사가 붙어 있다. */
function portalRow(id: string): NotificationBellItem {
  return {
    key: `rf-service-system:${id}`,
    sourceId: "rf-service-system",
    sourceName: "DSS A/S 관리 시스템",
    id,
    kind: "APPROVAL",
    kindLabel: "결재 대기",
    subject: "RF-0001",
    detail: "김아무개가 올렸습니다",
    href: "http://192.168.1.132:3000/repair-cases/1",
  };
}

/** 단추에 적힌 글자를 묶음이 그린 트리에서 꺼낸다. 없으면 null. */
function dismissAllButtonLabel(rendered: unknown): string | null {
  let label: string | null = null;
  const walk = (node: unknown): void => {
    if (label !== null) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== "object" || node === null || !("props" in node)) return;
    const element = node as { type: unknown; props: Record<string, unknown> };
    if (element.type === "button" && element.props.className === "dss-bell__dismissall") {
      label = String(element.props.children);
      return;
    }
    walk(element.props.children);
  };
  walk(rendered);
  return label;
}

describe("🔴 일괄에 넘어가는 값은 `key` 다 — `id` 가 아니다", () => {
  it("🔴 제 줄에서도 접두사가 붙은 `key` 가 나간다 — `id` 는 확인 기록의 값이다", () => {
    const sent: (readonly string[])[] = [];
    dismissVisibleNotifications([ownRow()], async (keys) => {
      sent.push(keys);
    });

    // 🔴 여기가 이 절에서 가장 위험한 자리다. `item.id` 로 바뀌면 포털이 모양
    //    틀린 열쇠로 보고 조용히 버려 「눌러도 안 없어지는 알림」이 되고, 더
    //    나쁘게는 확인 기록(notification_acknowledgements)의 값과 얽힌다.
    assert.deepEqual(sent, [[OWN_KEY]], "🔴 일괄에 접두사 없는 id 가 넘어갔다");
    assert.notEqual(OWN_ID, OWN_KEY, "둘이 같으면 이 시험이 아무것도 못 본다");

    // 소스에도 못 박는다 — 다른 경로가 생겼을 때 조용히 지나가지 않게.
    assert.match(dismissAllShell, /keys\.push\(item\.key\);/);
    assert.equal(
      /keys\.push\(item\.id\)/.test(dismissAllShell),
      false,
      "🔴 일괄이 모으는 값이 id 로 바뀌었다",
    );
  });

  it("🔴 확인 경로는 건드리지 않는다 — 일괄 액션은 확인 기록을 모른다", () => {
    // 확인은 우리 DB 에 영구 저장되고 유일 제약이 걸려 있다(9절). 일괄 지우기가
    // 그 표에 닿을 길이 한 군데도 없어야 한다.
    for (const forbidden of [
      "isOwnNotificationKey",
      "markNotification",
      "notificationAcknowledgements",
      "acknowledge",
    ]) {
      assert.equal(
        action.includes(forbidden),
        false,
        `🔴 지움 액션이 확인 쪽(${forbidden})에 닿는다`,
      );
    }
  });
});

describe("🔴 제 줄과 포털 줄을 **둘 다** 모은다", () => {
  it("🔴 합쳐진 목록 전부가 나간다 — 제 줄을 빠뜨리면 「내 알림만 남는다」가 된다", () => {
    const sent: string[][] = [];
    dismissVisibleNotifications(
      [ownRow(), portalRow("APPROVAL:1"), portalRow("APPROVAL:2")],
      async (keys) => {
        sent.push([...keys]);
      },
    );

    assert.deepEqual(sent, [
      [OWN_KEY, "rf-service-system:APPROVAL:1", "rf-service-system:APPROVAL:2"],
    ]);
  });

  it("🔴 종이 넘기는 목록이 **합쳐진 뒤의 것**이다 — 걸러진 제 줄까지 포함해서", () => {
    // 서버 조각이 `[...own.items, ...feed.items]` 를 껍데기에 넘기고(11절),
    // 껍데기는 그 목록에서 감춘 줄을 뺀 `visibleItems` 로 열쇠를 모은다.
    assert.match(bellComponent, /items=\{\[\.\.\.own\.items, \.\.\.feed\.items\]\}/);
    assert.match(dismissAllShell, /dismissVisibleNotifications\(visibleItems, dismissAll\)/);
    // 🔴 `items` 로 모으면 확인하느라 감춰 둔 줄까지 지워진다 — 단추에 적힌 수와
    //    실제로 지워지는 수가 달라지는 자리다.
    assert.equal(
      /dismissVisibleNotifications\(items,/.test(dismissAllShell),
      false,
      "🔴 감추기 전의 목록으로 모은다 — 적힌 수보다 많이 지워진다",
    );
  });
});

describe("🔴 묶음이 그리는 기준과 같게 거른다", () => {
  it("🔴 단추에 적힌 수와 보내는 열쇠 수가 **같다** — 묶음이 센 값으로 맞대어 본다", () => {
    // 그릴 수 없는 주소의 줄을 묶음은 안 그리고 수에서도 뺀다. 여기서 같은 기준
    // 으로 거르지 않으면 「3건」을 눌렀는데 4건이 지워진다 — 보이지도 않은 줄이
    // 말없이 사라지는 것이다.
    const items = [
      ownRow(),
      portalRow("APPROVAL:1"),
      { ...portalRow("APPROVAL:2"), href: "javascript:alert(1)" },
      { ...portalRow("APPROVAL:3"), href: "//evil.invalid/x" },
      portalRow("APPROVAL:4"),
    ];

    const sent: string[][] = [];
    dismissVisibleNotifications(items, async (keys) => {
      sent.push([...keys]);
    });

    const label = dismissAllButtonLabel(
      NotificationBell({ items, count: items.length, onDismissAll: () => {} }),
    );
    assert.equal(label, "보이는 알림 지우기 3건", "묶음이 센 값이 달라졌다");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].length, 3, `🔴 ${label} 인데 ${sent[0].length}건을 보낸다`);
    assert.deepEqual(sent[0], [
      OWN_KEY,
      "rf-service-system:APPROVAL:1",
      "rf-service-system:APPROVAL:4",
    ]);
  });

  it("🔴 거르는 함수를 **묶음에서 가져다 쓴다** — 직접 적으면 언젠가 갈라진다", () => {
    assert.match(dismissAllShell, /isSafeNotificationHref/);
    assert.match(dismissAllShell, /from "@dss\/ui"/);
  });

  it("열쇠가 빈 줄은 보내지 않는다 — 그 묶음은 포털이 400 으로 거절한다", () => {
    const sent: string[][] = [];
    dismissVisibleNotifications([{ ...portalRow("APPROVAL:1"), key: "" }], async (keys) => {
      sent.push([...keys]);
    });
    assert.deepEqual(sent, [], "빈 열쇠 하나로 포털을 불렀다");
  });
});

describe("🔴 단추를 눌러도 밖으로 새지 않는다", () => {
  it("함수를 안 넘기면 아무 일도 하지 않는다 — 단추 자체가 그려지지 않는다", () => {
    assert.doesNotThrow(() => dismissVisibleNotifications([ownRow()], undefined));
    // 묶음은 함수를 받았을 때만 단추를 그린다(@dss/ui). 안 넘긴 모습도 확인한다.
    assert.equal(
      dismissAllButtonLabel(NotificationBell({ items: [ownRow()], count: 1 })),
      null,
      "🔴 안 넘겼는데 단추가 그려졌다",
    );
  });

  it("🔴 보낼 것이 없으면 서버 왕복을 만들지 않는다", () => {
    let calls = 0;
    dismissVisibleNotifications([], async () => {
      calls += 1;
    });
    assert.equal(calls, 0);
  });

  it("🔴 던져도·거절당해도 밖으로 새지 않는다 — 누름의 나머지 처리가 멈추면 안 된다", async () => {
    assert.doesNotThrow(() =>
      dismissVisibleNotifications([ownRow()], () => {
        throw new Error("sync");
      }),
    );
    assert.doesNotThrow(() =>
      dismissVisibleNotifications([ownRow()], async () => {
        throw new Error("network");
      }),
    );
    // 처리되지 않은 거절이 남지 않는지 한 박자 기다려 본다(남으면 개발 중
    // 화면에 오류판이 뜬다 — 확인 경로가 같은 까닭으로 두 갈래를 다 받는다).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("🔴 일괄 액션이 받은 값을 가린다", () => {
  it("🔴 배열이 아니면 통째로 거절한다 — 종에서 온 값이 아니다", () => {
    for (const bogus of [undefined, null, "열쇠", 7, { 0: "a" }, new Set(["a"])]) {
      assert.equal(vetDismissKeys(bogus), null, `${String(bogus)} 가 통과했다`);
    }
  });

  it("🔴 울타리를 넘으면 **잘라 보내지 않고** 거절한다 — 적힌 수와 달라지면 거짓말이다", () => {
    assert.equal(vetDismissKeys(dismissalKeys(MAX_DISMISS_KEYS_AT_ONCE))?.length, MAX_DISMISS_KEYS_AT_ONCE);
    assert.equal(vetDismissKeys(dismissalKeys(MAX_DISMISS_KEYS_AT_ONCE + 1)), null);
  });

  it("🔴 울타리가 **정직한 누름 위**에 있다 — 포털이 한 시스템당 200줄에서 자른다", () => {
    // 사내 시스템이 일곱이고 포털은 부른 사이트 자신에게는 묻지 않으므로 남의
    // 줄은 많아야 여섯 × 200 = 1200 이다. 그 위에 있어야 정직한 누름이 거절되지
    // 않는다(근거는 domain/notifications.ts 의 그 상수 머리말).
    assert.ok(MAX_DISMISS_KEYS_AT_ONCE > 6 * 200, "울타리가 정직한 종보다 낮다");
  });

  it("모양이 틀린 칸은 **그 칸만** 버린다 — 하나 때문에 단추가 고장 나지 않게", () => {
    assert.deepEqual(vetDismissKeys(["a", "", 3, null, undefined, "b"]), ["a", "b"]);
    assert.deepEqual(vetDismissKeys([]), [], "빈 배열은 거절이 아니라 「보낼 것 없음」이다");
  });
});

describe("🔴 일괄 액션도 사람을 세션에서 정한다", () => {
  const start = action.indexOf("export async function dismissAllNotificationsAction");
  const body = action.slice(start);

  it("🔴 받는 것은 **열쇠 목록뿐**이다 — sub 을 받으면 남의 알림을 지우는 통로가 된다", () => {
    assert.ok(start >= 0, "일괄 액션을 찾지 못했다");
    assert.match(
      body,
      /^export async function dismissAllNotificationsAction\(keys: readonly string\[\]\): Promise<void> \{/,
    );
    assert.match(body, /const actor = await getSessionUser\(\);/);
    assert.match(body, /dismissPortalNotifications\(actor\.authSub, wanted\)/);
    assert.equal(
      /\bsub\b|subject/.test(body.slice(0, body.indexOf("dismissPortalNotifications"))),
      false,
      "🔴 사람 번호가 인자로 들어온다",
    );
  });

  it("🔴 가린 뒤에만 보낸다 — 세션도 열쇠도 통과해야 포털을 부른다", () => {
    assert.match(body, /if \(!actor\) return;/);
    assert.match(body, /const wanted = vetDismissKeys\(keys\);/);
    assert.match(body, /if \(wanted === null\) return;/);
    assert.match(body, /if \(wanted\.length === 0\) return;/);
    assert.ok(
      body.indexOf("vetDismissKeys") < body.indexOf("dismissPortalNotifications"),
      "🔴 가리기 전에 보낸다",
    );
  });

  it("🔴 「전부 적혔는가」를 **보지 않고** 되살린다 — 줄 하나짜리 ✕ 와 반대다", () => {
    // 200개를 넘으면 여러 묶음이 나가고, 가운데 하나가 거절돼도 나머지는 적혔다.
    // 그때 안 되살리면 **이미 지워진 줄이 종에 그대로 남는다.**
    assert.match(body, /await dismissPortalNotifications\(actor\.authSub, wanted\);/);
    assert.equal(
      /const recorded|if \(!recorded\)/.test(body),
      false,
      "🔴 일괄이 「전부 적혔는가」를 보고 되살리기를 건너뛴다",
    );
    assert.match(body, /revalidatePath\("\/", "layout"\);/);
  });

  it("🔴 종에 실제로 닿는다 — 액션을 만들어 놓고 안 넘기면 단추가 아예 없다", () => {
    const imported = bellComponent.match(
      /import \{([\s\S]*?)\} from "@\/lib\/server\/actions\/notification-dismissals";/,
    );
    assert.ok(imported, "지움 액션을 가져오는 줄이 없다");
    assert.match(imported[1], /\bdismissAllNotificationsAction\b/);
    assert.match(bellComponent, /dismissAll=\{dismissAllNotificationsAction\}/);
    assert.match(dismissAllShell, /onDismissAll=\{dismissVisible\}/);
  });

  it("🔴 묶음 포인터가 일괄 단추가 있는 판이다 — 옛 판에는 자리 자체가 없다", () => {
    assert.match(vendorBell, /onDismissAll\?: \(\) => void;/);
    assert.match(vendorBell, /className="dss-bell__dismissall"/);
    assert.match(vendorBehavior, /const DISMISS_ALL = "button\.dss-bell__dismissall";/);
    assert.match(vendorCss, /\.dss-bell__dismissall \{/);
  });

  it("🔴 세 길이 겹치지 않는다 — 일괄 단추는 줄로도 ✕ 로도 읽히지 않는다", () => {
    // 한 번 누른 것이 둘로 세어지면 읽지도 않은 알림이 확인으로 적히거나
    // 엉뚱한 화면으로 넘어간다(8절이 ✕ 와 줄에 대해 지키는 것과 같은 선이다).
    assert.match(vendorBehavior, /const LINK = "a\.dss-bell__link";/);
    assert.match(vendorBehavior, /const DISMISS = "button\.dss-bell__dismiss";/);
    // 일괄 단추는 줄(<li>)들과 **다른 <li>** 다 — 줄 안에 있으면 링크에 걸린다.
    assert.match(vendorBell, /className="dss-bell__dismissrow"/);
  });
});
