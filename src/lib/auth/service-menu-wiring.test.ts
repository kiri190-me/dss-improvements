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
 *     → AppHeader 가 그것을 제 줄 **안**에 그린다(@dss/ui 의 ServiceMenuBar)
 *
 * ── 왜 파일의 글자를 읽는가 ─────────────────────────────────────────────
 * 이 자리들은 실제로 불러 볼 수 없다. 콜백과 시작 통로는 포털의 JWKS·요청
 * 맥락(쿠키)이 있어야 하고, 레이아웃은 세션과 DB 가 있어야 한다. 이 목록의
 * 시험은 DB 에 닿을 길이 없어야 하므로(scripts/test-lists/unit.txt) **구조**를
 * 못 박는다. 서명·거르기 판단 자체는 service-menu-cookie.test.ts 가 실제로
 * 돌려 보고, 메뉴바가 그리는 마크업은 dss-ui 저장소의 시험이 본다.
 *
 * 🔴 2026-09-18 부터 메뉴바는 머리말 **위**가 아니라 **안**에 앉는다(회색 층이
 * 하나 더 생겨 답답하고 창이 그만큼 작아진다는 사용자 지적 — A/S 가 먼저 같은
 * 결정을 했다). 아래 3절이 그 자리와 폰에서의 동작을 못 박는다.
 *
 * 여기서 지키는 것 다섯:
 *  1. 목록은 **검증이 끝난** ID 토큰에서만 온다 — 인가 판정에는 쓰이지 않는다.
 *  2. 🔴 로그인이 시작되는 자리와 로그아웃에서 그 쿠키를 **지운다**
 *     (공용 PC 에서 앞사람 목록이 뒷사람 화면에 뜨지 않게).
 *  3. 메뉴바는 머리말 **안**에 앉고, 목록은 서버에서 풀어 내린다. 폰에서는
 *     남는 자리만 쓰고 나가는 단추를 밀어내지 않는다.
 *  4. 생김새(CSS)를 사이트가 한 번 부른다. 다크는 @dss/ui 의 기본값에 맡긴다.
 *  5. 목록이 없으면 **아무것도 그리지 않는다** — 포털 배포 전인 지금 머리말은
 *     예전과 같아야 한다.
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
const appHeaderBare = withoutComments(appHeader);
const globalsCss = read("src/app/globals.css");
/* 서브모듈(vendor/dss-ui)이 실제로 실려 있는 CSS. 이 저장소가 기대는 규칙이
   그 판에 있는지 본다 — 포인터가 옛 커밋이면 여기서 걸린다. */
const menuCss = read("vendor/dss-ui/src/service-menu/service-menu.css");

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

test("🔴 메뉴바는 머리말 **안**에 앉는다 — 레이아웃이 머리말에 내려보낸다", () => {
  const headerAt = appLayout.indexOf("<AppHeader");
  const barAt = appLayout.indexOf("<ServiceMenuBar");
  assert.ok(headerAt > 0, "레이아웃이 머리말을 그리지 않는다");
  assert.ok(barAt > 0, "레이아웃이 메뉴바를 만들지 않는다");
  assert.ok(barAt > headerAt, "메뉴바가 머리말 **밖(위)** 에 있다 — 안으로 들어가야 한다");
  assert.match(appLayout, /serviceMenu=\{/, "머리말에 내려보내지 않는다");

  // 머리말 **위**의 회색 띠가 아니라 머리말 바탕에 그대로 얹히는 모습이어야 한다.
  assert.match(appLayout.slice(barAt), /variant="inline"/);

  // 🔴 `shrink-0` 은 세로 flex 안에 독립된 띠로 앉을 때의 것이다. 머리말
  // 안에서는 반대로 **줄어들 수 있어야** 한다(@dss/ui README 3절) — 남으면
  // 목록이 길어질 때 오른쪽 단추가 화면 밖으로 밀린다.
  assert.equal(
    appLayout.includes("shrink-0"),
    false,
    "띠로 앉히던 때의 shrink-0 이 남아 있다 — 머리말 안에서는 줄어들 수 있어야 한다",
  );

  assert.equal(
    /<header[\s>]/.test(appLayout),
    false,
    "머리말을 레이아웃이 직접 그리고 있다 — 머리말은 AppHeader 것이다",
  );
});

test("🔴 목록과 「지금 여기」는 서버에서 풀어 내린다", () => {
  assert.match(appLayout, /const services = await readServiceMenu\(\);/);
  assert.match(appLayout, /services\.length > 0 \? thisServiceId\(\) : null/);

  const bar = appLayout.slice(appLayout.indexOf("<ServiceMenuBar"));
  assert.match(bar, /services=\{services\}/);
  assert.match(bar, /currentServiceId=\{currentServiceId\}/);
});

test("🔴 머리말이 그리는 자리 — 시스템 이름 다음, 사용자명 앞", () => {
  const nameAt = appHeaderBare.indexOf("DSS 개선요청");
  const menuAt = appHeaderBare.indexOf("{serviceMenu}");
  const userAt = appHeaderBare.indexOf("{user.displayName}");
  assert.ok(menuAt > 0, "머리말이 메뉴바를 그리지 않는다");
  assert.ok(nameAt > 0 && nameAt < menuAt, "시스템 이름보다 앞에 그린다");
  assert.ok(menuAt < userAt, "사용자명보다 뒤에 그린다 — 가운데 빈 자리가 메뉴바 몫이다");

  // 받는 것은 다 그려진 노드다 — 이 파일이 @dss/ui 를 몰라야 한다.
  assert.equal(
    appHeaderBare.includes("@dss/ui"),
    false,
    "머리말이 @dss/ui 를 직접 부른다 — 그리는 자리만 정하고 조각은 받아야 한다",
  );
});

test("🔴 폰에서 나가는 단추가 밀려나지 않는다 — 메뉴바는 남는 자리만 쓴다", () => {
  // `flex-1`(= flex: 1 1 0%)은 기준 폭이 0 이라 이름·사용자명·단추 둘이 제 폭을
  // 먼저 가져간 **뒤 남은 만큼만** 차지한다. `min-w-0` 은 안의 목록이 길어도 이
  // 칸이 제 내용 폭까지 부풀지 못하게 막는다(목록은 자기 안에서 굴러간다).
  // 둘 중 하나라도 빠지면 오른쪽 「로그아웃」부터 화면 밖으로 밀린다.
  assert.match(appHeaderBare, /<div className="min-w-0 flex-1">\{serviceMenu\}<\/div>/);
});

test("🔴 폰에서는 시스템 이름과 사용자명을 **눈에서만** 감춘다 — 그 자리가 메뉴바로 간다", () => {
  // 360px 속폭 328 에 이름 ~101 · 사용자명 ~96 · 단추 둘 ~210 · 여백 40 이라
  // 메뉴바를 넣기 전에 이미 넘친다(AppHeader.tsx 머리말의 폭 계산). 글자만
  // 알려 주는 두 덩이를 감춰야 메뉴바 몫이 생긴다.
  for (const [what, pattern] of [
    ["시스템 이름", /<h1 className="([^"]*)">\s*DSS 개선요청/],
    ["사용자명", /<span className="([^"]*)">\s*\{user\.displayName\}/],
  ] as const) {
    const found = appHeaderBare.match(pattern);
    assert.ok(found, `머리말에서 ${what} 을 그리는 자리를 찾지 못했다`);
    const classes = found[1].split(/\s+/);

    assert.ok(classes.includes("sr-only"), `폰에서 ${what} 이 그대로 보인다 — 메뉴 칸이 0 이 된다`);
    assert.ok(
      classes.includes("md:not-sr-only"),
      `넓은 화면에서 ${what} 이 되돌아오지 않는다`,
    );
    // 🔴 마크업에서 사라지지는 않는다 — 낭독기에는 남아야 한다.
    assert.equal(
      classes.includes("hidden"),
      false,
      `${what} 을 display:none 으로 지웠다 — 낭독기에서도 사라진다`,
    );
  }

  // 글자 자체는 마크업에 그대로 있다.
  assert.ok(appHeaderBare.includes("DSS 개선요청"), "이름 글자를 통째로 뺐다");
});

test("🔴 나가는 길(통합 로그인으로 · 로그아웃)은 폰에서도 감추지 않는다", () => {
  // 이 둘 말고 이 사이트를 떠날 길이 없다. 폰에서 가장 넓은 자리를 먹지만
  // 감추면 나갈 수가 없다 — 메뉴가 굴러가는 편이 낫다.
  for (const label of ["통합 로그인으로", "로그아웃"] as const) {
    const at = appHeaderBare.indexOf(label);
    assert.ok(at > 0, `머리말에서 「${label}」 이 사라졌다`);
    // 그 글자를 감싼 여는 태그(바로 앞의 `<a …>` 또는 `<button …>`).
    const openTag = appHeaderBare.slice(0, at).lastIndexOf("<");
    const tag = appHeaderBare.slice(openTag, at);
    assert.equal(/\bsr-only\b/.test(tag), false, `「${label}」 을 눈에서 감췄다`);
    assert.equal(/\bhidden\b/.test(tag), false, `「${label}」 을 감췄다`);
  }
});

test("🔴 폰에서는 칸에서도 이름을 감추고 아이콘만 보인다 — 칸 하나가 아이콘 하나 폭이다", () => {
  // 그 동작은 @dss/ui 가 CSS 로 한다(그쪽 시험이 자세히 본다). 여기서는 이
  // 저장소가 기대는 그 규칙이 실제로 실려 있는지만 본다 — 서브모듈 포인터가
  // 옛 커밋이면 `--inline` 규칙이 통째로 없다.
  assert.match(menuCss, /\.dss-menu\.dss-menu--inline \{/);
  assert.match(menuCss, /@media not all and \(min-width: 768px\)/);
  assert.match(menuCss, /\.dss-menu--inline \.dss-menu__name \{/);
  // 이름은 눈에서만 감춘다 — 낭독기는 그대로 읽어야 한다.
  assert.match(menuCss, /clip-path: inset\(50%\)/);
});

test("🔴 감추는 기준점이 메뉴바의 「아이콘만」 기준점과 같다 — 둘 다 768px", () => {
  // 어긋나면 그 사이 폭에서 「이름은 없는데 메뉴는 글자」인 어정쩡한 상태가
  // 생긴다. 머리말 쪽은 Tailwind 의 `md:`(=min-width: 768px), 메뉴바 쪽은 그
  // 여집합인 `not all and (min-width: 768px)` 이라 둘이 정확히 맞물린다.
  const breakpoint = menuCss.match(/@media not all and \(min-width: (\d+)px\)/);
  assert.ok(breakpoint, "메뉴바의 「아이콘만」 기준점을 찾지 못했다");
  assert.equal(breakpoint[1], "768", "메뉴바 기준점이 768px 이 아니다");

  // 이 저장소가 Tailwind 의 md 기준점을 덮어썼다면 여기서 걸린다.
  assert.equal(
    /--breakpoint-md:\s*(?!768px)/.test(globalsCss),
    false,
    "이 저장소가 md 기준점을 768px 이 아닌 값으로 덮었다",
  );
});

test("생김새를 사이트가 한 번 부른다", () => {
  assert.match(rootLayout, /^import "@dss\/ui\/styles\.css";$/m);
});

test("🔴 다크는 @dss/ui 기본값에 맡긴다 — colorScheme 도 dark: 유틸리티도 손대지 않는다", () => {
  // 이 사이트는 globals.css 에서 color-scheme: light 로 밝은 화면에 고정되어
  // 있고 dark 변형 자체가 없다. 기본값("host")은 조상에 .dark 가 있을 때만
  // 어두워지므로 그대로 두는 것이 맞다. colorScheme 을 넘기거나 dark: 유틸리티를
  // 쓰면 메뉴바만 따로 놀게 된다(@dss/ui README 4절).
  assert.match(globalsCss, /color-scheme: light/);
  assert.equal(appLayout.includes("colorScheme"), false, "colorScheme 을 넘기고 있다");
  assert.equal(/\bdark:/.test(appLayout), false, "메뉴바 자리에 dark: 유틸리티를 썼다");
  assert.equal(/\bdark:/.test(appHeaderBare), false, "머리말에 dark: 유틸리티를 썼다");
});

test("노치 인셋을 가진 요소가 없다 — 생기면 맨 위 요소(머리말)가 **하나만** 가져야 한다", () => {
  // 이 사이트에는 env(safe-area-inset-top) 도 viewport-fit=cover 도 없다.
  // 그래서 메뉴바를 머리말 안으로 들이면서 옮길 인셋도 없었다(A/S 는 있어서
  // 그것을 머리말로 되돌려야 했다). 나중에 인셋을 넣는 사람이 있으면 여기서
  // 걸린다 — 맨 위 요소는 머리말이고, 둘이 가지면 노치 높이만큼 두 번 밀린다
  // (@dss/ui README 3절. inline 모습은 제 padding-top 을 0 으로 못 박아 둔다).
  for (const [name, source] of [
    ["globals.css", globalsCss],
    ["AppHeader.tsx", appHeader],
    ["(app)/layout.tsx", appLayout],
    ["layout.tsx", rootLayout],
  ] as const) {
    assert.equal(
      /safe-area-inset-top/.test(source),
      false,
      `${name} 에 노치 인셋이 생겼다 — 맨 위 요소인 머리말 하나만 갖게 하고 이 시험을 고쳐라`,
    );
  }
});

/* ── 4. 메뉴바가 그리는 것 (실제로 불러 본다) ─────────────────────────── */

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
