import assert from "node:assert/strict";
import test from "node:test";

import {
  isMenuKeyOf,
  isServiceKey,
  listMenusOf,
  listServices,
  menuLabel,
  NO_MENU_LABEL,
  OTHER_SERVICE_KEY,
  serviceLabel,
  SERVICE_CATALOG,
  UNKNOWN_MENU_LABEL,
  UNKNOWN_SERVICE_LABEL,
} from "./service-catalog";

/**
 * 적어 둔 서비스·메뉴 목록의 시험.
 *
 * 🔴 여기서 못 박는 것은 「서비스를 고르면 **그 서비스의 메뉴만** 나온다」와
 * 「적어 둔 목록에 **없는 열쇠는 통과하지 못한다**」 둘이다. 목록의 내용(어느
 * 서비스가 있는가)은 사람이 늘리고 줄이는 값이라 개수를 못 박지 않는다 — 못 박으면
 * 서비스 하나를 더할 때마다 시험이 먼저 실패해, 고치라는 말만 하는 시험이 된다.
 */

test("목록에 적힌 서비스 열쇠는 서로 겹치지 않는다", () => {
  const keys = SERVICE_CATALOG.map((service) => service.key);
  assert.equal(new Set(keys).size, keys.length, `서비스 열쇠가 겹칩니다: ${keys.join(", ")}`);
});

test("한 서비스 안의 메뉴 열쇠는 서로 겹치지 않는다", () => {
  for (const service of SERVICE_CATALOG) {
    const keys = service.menus.map((menu) => menu.key);
    assert.equal(
      new Set(keys).size,
      keys.length,
      `${service.key} 안에서 메뉴 열쇠가 겹칩니다: ${keys.join(", ")}`,
    );
  }
});

test("서비스와 메뉴에 빈 이름이나 빈 열쇠가 없다", () => {
  for (const service of SERVICE_CATALOG) {
    assert.ok(service.key.trim() !== "", "서비스 열쇠가 비었습니다");
    assert.ok(service.label.trim() !== "", `${service.key} 의 이름이 비었습니다`);
    for (const menu of service.menus) {
      assert.ok(menu.key.trim() !== "", `${service.key} 에 빈 메뉴 열쇠가 있습니다`);
      assert.ok(menu.label.trim() !== "", `${service.key}/${menu.key} 의 이름이 비었습니다`);
    }
  }
});

test("「시스템 아님」 열쇠는 포털 clientId 와 겹치지 않는다", () => {
  // 포털에 등록된 clientId 는 전부 `dss-` 또는 `rf-` 로 시작한다(dss-auth 등록값).
  // 그 규칙을 어기지 않는 한, 이 열쇠가 어느 시스템과도 헷갈릴 일이 없다.
  assert.ok(!OTHER_SERVICE_KEY.startsWith("dss-"));
  assert.ok(!OTHER_SERVICE_KEY.startsWith("rf-"));
  assert.ok(isServiceKey(OTHER_SERVICE_KEY), "「시스템 아님」도 고를 수 있는 서비스여야 한다");
  assert.deepEqual(listMenusOf(OTHER_SERVICE_KEY), [], "「시스템 아님」에는 메뉴가 없다");
});

test("🔴 서비스를 고르면 그 서비스의 메뉴만 나온다", () => {
  const as = listMenusOf("rf-service-system").map((menu) => menu.key);
  const meters = listMenusOf("dss-meters").map((menu) => menu.key);

  assert.ok(as.includes("quotes"), "A/S 에는 견적서 메뉴가 있다");
  assert.ok(!meters.includes("quotes"), "계측기에는 견적서 메뉴가 없다");
  assert.ok(meters.includes("meterList"), "계측기에는 계측기 목록이 있다");
  assert.ok(!as.includes("meterList"), "A/S 에는 계측기 목록이 없다");

  // 다른 서비스의 메뉴가 섞여 들어오지 않는다 — 한 칸도.
  for (const service of SERVICE_CATALOG) {
    const own = new Set(service.menus.map((menu) => menu.key));
    assert.deepEqual(
      listMenusOf(service.key).map((menu) => menu.key),
      [...own],
      `${service.key} 의 메뉴 목록이 적어 둔 것과 다릅니다`,
    );
  }
});

test("모르는 서비스의 메뉴 목록은 빈 배열이다(예외를 던지지 않는다)", () => {
  // 화면의 두 번째 선택칸이 부르는 자리다. 던지면 옛 글 하나 때문에 화면이 죽는다.
  assert.deepEqual(listMenusOf("없는-서비스"), []);
  assert.deepEqual(listMenusOf(undefined), []);
  assert.deepEqual(listMenusOf(42), []);
});

test("🔴 적어 둔 목록에 없는 서비스 열쇠는 판정을 통과하지 못한다", () => {
  assert.ok(isServiceKey("rf-service-system"));
  assert.ok(!isServiceKey("rf-service-System"), "대소문자가 다르면 다른 열쇠다");
  assert.ok(!isServiceKey("없는-서비스"));
  assert.ok(!isServiceKey(""));
  assert.ok(!isServiceKey(null));
  assert.ok(!isServiceKey(undefined));
  assert.ok(!isServiceKey(123));
});

test("🔴 메뉴는 고른 서비스와 짝으로 판정한다", () => {
  assert.ok(isMenuKeyOf("rf-service-system", "quotes"));
  // 열쇠는 서비스 안에서만 유일하다 — 짝으로 보지 않으면 이것이 통과한다.
  assert.ok(!isMenuKeyOf("dss-meters", "quotes"), "남의 서비스 메뉴는 통과하면 안 된다");
  assert.ok(!isMenuKeyOf("없는-서비스", "quotes"));
  assert.ok(!isMenuKeyOf("rf-service-system", "없는-메뉴"));
  assert.ok(!isMenuKeyOf("rf-service-system", ""));
  assert.ok(!isMenuKeyOf("rf-service-system", null));
});

test("이름 붙이기 — 없는 열쇠와 고르지 않은 메뉴", () => {
  assert.equal(serviceLabel("rf-service-system"), "DSS A/S 관리 시스템");
  assert.equal(serviceLabel("사라진-서비스"), UNKNOWN_SERVICE_LABEL);

  assert.equal(menuLabel("rf-service-system", "quotes"), "견적서");
  assert.equal(menuLabel("rf-service-system", null), NO_MENU_LABEL);
  // 메뉴가 사이드바에서 빠진 뒤의 옛 글. DB CHECK 가 없으므로 이런 행이 남아 있다.
  assert.equal(menuLabel("rf-service-system", "사라진-메뉴"), UNKNOWN_MENU_LABEL);
  // 서비스 자체가 사라졌으면 그 메뉴도 찾을 길이 없다.
  assert.equal(menuLabel("사라진-서비스", "quotes"), UNKNOWN_MENU_LABEL);
});

test("A/S 메뉴 열쇠는 그쪽 navItems 의 key 와 같은 글자다 — 열 건 이관이 그것에 기댄다", () => {
  // db/schema.ts 머리말의 'A/S 의 개선요청 열 건이 들어올 자리' 참조. 그 글의
  // menu_key 를 그대로 넣을 수 있으려면 이 열쇠들이 A/S navigation.ts 의 key 와
  // 글자 그대로 같아야 한다. 저장소가 서로를 참조하지 않아 컴파일이 잡아 주지
  // 않으므로, 실제로 쌓여 있는 값들만이라도 여기 적어 둔다.
  const keys = new Set(listMenusOf("rf-service-system").map((menu) => menu.key));
  for (const key of ["weeklyReport", "users", "customers", "repairCases", "quotes"]) {
    assert.ok(keys.has(key), `A/S 의 menu_key "${key}" 가 목록에 없습니다`);
  }
});

test("listServices 는 적어 둔 차례 그대로이고, 받은 배열을 고쳐도 목록이 바뀌지 않는다", () => {
  const first = listServices();
  assert.deepEqual(
    first.map((service) => service.key),
    SERVICE_CATALOG.map((service) => service.key),
  );
  first.pop();
  assert.equal(listServices().length, SERVICE_CATALOG.length);
});
