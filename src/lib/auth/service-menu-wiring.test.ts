import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { ServiceMenuBar } from "@dss/ui";

/**
 * ============================================================================
 * 🔴 서비스 메뉴 목록이 흐르는 길 — 굽는 자리 · 지우는 자리 · 그리는 자리
 * ============================================================================
 * 목록은 이렇게 흐른다:
 *
 *   포털이 ID 토큰에 싣는 dss_services 클레임
 *     → verifyIdToken 이 검증된 payload 에서 꺼내 SsoIdentity.services 로
 *     → 콜백이 writeServiceMenuCookie 로 별도 서명 쿠키에 굽고
 *     → (app)/layout.tsx 가 readServiceMenu 로 풀어 prop 으로 내리고
 *     → @dss/ui 의 ServiceMenuBar 가 머리말 **위**에 그린다
 *
 * ── 왜 파일의 글자를 읽는가 ─────────────────────────────────────────────
 * 이 자리들은 실제로 불러 볼 수 없다. 콜백과 시작 통로는 포털의 JWKS·요청
 * 맥락(쿠키)이 있어야 하고, 레이아웃은 세션과 DB 가 있어야 한다. 이 목록의
 * 시험은 DB 에 닿을 길이 없어야 하므로(scripts/test-lists/unit.txt) **구조**를
 * 못 박는다. 서명·거르기 판단 자체는 service-menu-cookie.test.ts 가 실제로
 * 돌려 보고, 띠가 그리는 마크업은 dss-ui 저장소의 시험이 본다.
 *
 * 여기서 지키는 것 다섯:
 *  1. 목록은 **검증이 끝난** ID 토큰에서만 온다 — 인가 판정에는 쓰이지 않는다.
 *  2. 🔴 로그인이 시작되는 자리와 로그아웃에서 그 쿠키를 **지운다**
 *     (공용 PC 에서 앞사람 목록이 뒷사람 화면에 뜨지 않게).
 *  3. 띠는 머리말 **위**에 앉고, 목록은 서버에서 풀어 내린다.
 *  4. 생김새(CSS)를 사이트가 한 번 부른다. 다크는 @dss/ui 의 기본값에 맡긴다.
 *  5. 목록이 없으면 **아무것도 그리지 않는다** — 포털 배포 전인 지금 화면은
 *     예전과 한 픽셀도 같아야 한다.
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
const callback = withoutComments(read("src/app/api/auth/sso/callback/route.ts"));
const start = withoutComments(read("src/app/api/auth/sso/start/route.ts"));
const logout = withoutComments(read("src/app/actions/auth.ts"));
const ssoLogin = withoutComments(read("src/lib/auth/sso-login.ts"));
const appLayout = withoutComments(read("src/app/(app)/layout.tsx"));
const rootLayout = read("src/app/layout.tsx");
const appHeader = read("src/components/AppHeader.tsx");
const globalsCss = read("src/app/globals.css");

/* ── 1. 어디서 오는가 ─────────────────────────────────────────────────── */

test("🔴 목록은 jwtVerify 가 끝난 payload 에서 온다 — sub 와 같은 보증을 받는다", () => {
  const verifyAt = oidc.indexOf("const { payload } = await jwtVerify(");
  const claimAt = oidc.indexOf("services: payload.dss_services");
  const subjectAt = oidc.indexOf("subject: payload.sub");
  assert.ok(verifyAt > 0, "검증하는 자리를 찾지 못했다");
  assert.ok(claimAt > verifyAt, "검증보다 먼저 클레임을 읽는다");
  assert.ok(claimAt > subjectAt, "sub 를 확인하기 전에 클레임을 읽는다");
  // 검증에 실패하면 그 try 는 null 을 내보낸다 — 콜백은 거기서 멈춘다.
  assert.match(oidc, /catch \(error\) \{[\s\S]*?return null;/);
});

test("🔴 이 목록으로 권한을 판정하지 않는다 — 들어올 수 있는지는 role 하나로 정한다", () => {
  assert.equal(
    /services/i.test(ssoLogin),
    false,
    "로그인 판정(sso-login.ts)이 서비스 목록을 보고 있다 — 판정은 role 만 본다",
  );
});

/* ── 2. 굽는 자리 · 지우는 자리 ───────────────────────────────────────── */

test("콜백이 세션을 준 뒤 목록을 굽는다 — 목록 때문에 로그인이 거절되는 길은 없다", () => {
  const sessionAt = callback.indexOf("await createSession(result.user);");
  const cookieAt = callback.indexOf("await writeServiceMenuCookie(identity.services);");
  assert.ok(sessionAt > 0, "세션을 만드는 자리를 찾지 못했다");
  assert.ok(cookieAt > sessionAt, "콜백이 목록을 굽지 않거나 세션보다 먼저 굽는다");

  const tail = callback.slice(cookieAt);
  assert.equal(tail.includes("fail("), false, "목록 때문에 로그인이 거절되는 길이 생겼다");
  assert.match(tail, /return redirectTo\(transaction\.returnTo\);/);
});

test("🔴 로그인이 시작되는 자리에서 앞사람의 목록을 지운다 — 이미 들어와 있는 사람 것은 그대로", () => {
  const sessionGuardAt = start.indexOf("if (await getSessionUser())");
  const clearAt = start.indexOf("await clearServiceMenuCookie();");
  const beginAt = start.indexOf("beginLogin(returnTo)");
  assert.ok(sessionGuardAt > 0, "이미 들어와 있는 사람을 돌려보내는 자리를 찾지 못했다");
  assert.ok(clearAt > 0, "🔴 로그인 시작 통로가 메뉴 쿠키를 지우지 않는다");
  assert.ok(clearAt > sessionGuardAt, "들어와 있는 사람의 목록까지 지운다");
  assert.ok(clearAt < beginAt, "포털로 보낸 뒤에 지운다 — 그 사이가 비어 있다");
});

test("🔴 로그아웃이 세션과 함께 목록도 지운다 — redirect 앞이어야 실제로 지워진다", () => {
  const destroyAt = logout.indexOf("await destroySession();");
  const clearAt = logout.indexOf("await clearServiceMenuCookie();");
  const redirectAt = logout.indexOf("redirect(endSessionUrl());");
  assert.ok(destroyAt > 0 && redirectAt > 0);
  assert.ok(clearAt > 0, "🔴 로그아웃이 메뉴 쿠키를 지우지 않는다");
  assert.ok(clearAt < redirectAt, "redirect 뒤에 지운다 — 그 줄은 돌지 않는다");
});

/* ── 3. 그리는 자리 ───────────────────────────────────────────────────── */

test("🔴 띠는 머리말 **위**에 앉고, 목록은 서버에서 풀어 내린다", () => {
  assert.match(appLayout, /const services = await readServiceMenu\(\);/);
  assert.match(appLayout, /services\.length > 0 \? thisServiceId\(\) : null/);

  const barAt = appLayout.indexOf("<ServiceMenuBar");
  const headerAt = appLayout.indexOf("<AppHeader");
  assert.ok(barAt > 0, "레이아웃이 띠를 그리지 않는다");
  assert.ok(barAt < headerAt, "띠가 머리말보다 아래에 있다 — 위에 앉혀야 한다");

  const bar = appLayout.slice(barAt, appLayout.indexOf("/>", barAt));
  assert.match(bar, /services=\{services\}/);
  assert.match(bar, /currentServiceId=\{currentServiceId\}/);
  // 세로 flex 안에서 눌리지 않게(@dss/ui README 3절).
  assert.match(bar, /className="shrink-0"/);

  assert.equal(
    /<header[\s>]/.test(appLayout),
    false,
    "머리말을 레이아웃이 직접 그리고 있다 — 머리말은 AppHeader 것이고, 띠는 그 위 별도 요소다",
  );
});

test("생김새를 사이트가 한 번 부른다", () => {
  assert.match(rootLayout, /^import "@dss\/ui\/styles\.css";$/m);
});

test("🔴 다크는 @dss/ui 기본값에 맡긴다 — colorScheme 도 dark: 유틸리티도 손대지 않는다", () => {
  // 이 사이트는 globals.css 에서 color-scheme: light 로 밝은 화면에 고정되어
  // 있고 dark 변형 자체가 없다. 기본값("host")은 조상에 .dark 가 있을 때만
  // 어두워지므로 그대로 두는 것이 맞다. colorScheme 을 넘기거나 dark: 유틸리티를
  // 쓰면 띠만 따로 놀게 된다(@dss/ui README 4절).
  assert.match(globalsCss, /color-scheme: light/);
  assert.equal(appLayout.includes("colorScheme"), false, "colorScheme 을 넘기고 있다");
  assert.equal(/\bdark:/.test(appLayout), false, "띠 자리에 dark: 유틸리티를 썼다");
});

test("노치 인셋을 가진 요소가 없다 — 생기면 맨 위 요소(띠)가 **하나만** 가져야 한다", () => {
  // 이 사이트에는 env(safe-area-inset-top) 도 viewport-fit=cover 도 없다.
  // 그래서 띠를 올리면서 옮길 인셋도 없었다. 나중에 머리말에 인셋을 넣는
  // 사람이 있으면 여기서 걸린다 — 띠와 머리말이 둘 다 가지면 노치 높이만큼
  // 두 번 밀린다(@dss/ui README 3절).
  for (const [name, source] of [
    ["globals.css", globalsCss],
    ["AppHeader.tsx", appHeader],
    ["(app)/layout.tsx", appLayout],
    ["layout.tsx", rootLayout],
  ] as const) {
    assert.equal(
      /safe-area-inset-top/.test(source),
      false,
      `${name} 에 노치 인셋이 생겼다 — 맨 위 요소인 띠로 옮기고 이 시험을 고쳐라`,
    );
  }
});

/* ── 4. 띠가 그리는 것 (실제로 불러 본다) ─────────────────────────────── */

/** 이 시스템의 client_id — 포털에 등록된 이름이자 ID 토큰의 aud 다. */
const THIS_SERVICE_ID = "dss-improvements";

type RenderedElement = { type: unknown; props: Record<string, unknown> };

function isElement(value: unknown): value is RenderedElement {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

/** 나온 나무에서 <a> 만 차례대로 줍는다. */
function links(node: unknown, found: RenderedElement[] = []): RenderedElement[] {
  if (Array.isArray(node)) {
    for (const child of node) links(child, found);
    return found;
  }
  if (!isElement(node)) return found;
  if (node.type === "a") found.push(node);
  links(node.props.children, found);
  return found;
}

test("🔴 목록이 비면 아무것도 그리지 않는다 — 빈 띠도 남기지 않는다(포털 배포 전 상태)", () => {
  assert.equal(ServiceMenuBar({ services: [], currentServiceId: null }), null);
});

test("이 시스템(dss-improvements) 칸만 눌린 상태로, 받은 차례 그대로 그려진다", () => {
  const anchors = links(
    ServiceMenuBar({
      services: [
        { id: "rf-service-system", name: "A/S 관리", url: "http://10.0.0.5:3000", icon: "🔧" },
        { id: "njlee", name: "계측기", url: "http://10.0.0.5:3300" },
        { id: THIS_SERVICE_ID, name: "개선요청", url: "http://10.0.0.5:3500" },
      ],
      currentServiceId: THIS_SERVICE_ID,
    }),
  );

  assert.deepEqual(
    anchors.map((anchor) => anchor.props["data-service-id"]),
    ["rf-service-system", "njlee", THIS_SERVICE_ID],
    "받은 차례 그대로 그리지 않는다",
  );
  assert.deepEqual(
    anchors.map((anchor) => anchor.props["aria-current"]),
    [undefined, undefined, "page"],
    "색 말고 aria-current 로도 「지금 여기」를 알려야 한다",
  );
});
