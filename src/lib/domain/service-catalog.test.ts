import assert from "node:assert/strict";
import test from "node:test";

import {
  isMenuKeyOf,
  isServiceKey,
  listMenusOf,
  listServices,
  MENU_GROUP_MARK,
  MENU_INDENT,
  menuLabel,
  menuOptionText,
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

/* ==================================================================== */
/* 대메뉴 — 2026-09-18                                                   */
/* ==================================================================== */

/**
 * 🔴 **대메뉴가 더해지기 전의 A/S 메뉴 목록.** 열쇠와 이름과 차례 그대로다.
 *
 * 이 표가 있는 이유는 하나다 — 대메뉴 다섯 줄을 끼워 넣으면서 **기존 스물두 줄이
 * 한 칸도 바뀌지 않았다**를 기계가 대조하게 하려고. 저쪽(A/S)에 쌓인 글과 이쪽에
 * 쌓일 글이 전부 이 열쇠들을 달고 다니고, 열쇠 하나가 어긋나면 그 글의 이름표가
 * 조용히 「(없어진 메뉴)」가 된다.
 *
 * ■ 이 시험이 실패했을 때
 *   · 열쇠나 차례가 달라졌다  → **되돌린다.** 저장된 값이 가리키는 곳이 바뀐다.
 *   · 이름만 달라졌다         → A/S 가 메뉴 이름을 바꾼 것이라면 이 표도 같이
 *                               고친다(카탈로그 머리말: 이름은 바뀔 수 있다).
 *                               고칠 때 **열쇠는 건드리지 않는다.**
 */
const AS_MENUS_BEFORE_GROUPS: readonly (readonly [string, string])[] = [
  ["dashboard", "대시보드"],
  ["weeklyReport", "주간보고"],
  ["repairCases", "전체 A/S 현황"],
  ["myActiveWork", "내 담당 제품"],
  ["repairCaseNew", "A/S 접수"],
  ["customerPortal", "고객 안내 현황"],
  ["diagnosisFlowcharts", "진단 Flowchart 관리"],
  ["workflows", "워크플로 관리"],
  ["excelKyosanIntakeList", "일본 본사 Excel 생성"],
  ["kyosanIntakeImport", "과거 인수품 가져오기"],
  ["technicalProcedures", "기술 작업 절차"],
  ["inventory", "재고 관리"],
  ["domesticOrders", "내자 정리"],
  ["quotes", "견적서"],
  ["repairLabor", "작업 비용"],
  ["customers", "고객사 관리"],
  ["productModels", "제품 모델 관리"],
  ["users", "사용자 관리"],
  ["settings", "시스템 설정"],
  ["mailSettings", "메일 설정"],
  ["improvementRequests", "개선 요청"],
  ["developerMode", "개발자 모드"],
];

/**
 * 🔴 RF_Service_System/src/lib/navigation.ts 의 `navGroups` 를 **손으로 옮겨 적은**
 * 것이다(2026-09-18 확인). 저 저장소를 import 하지 않는다 — 이 저장소는 옆
 * 저장소를 가져오지 않는다(CLAUDE.md). 그래서 컴파일이 대조해 주지 않는 자리를
 * 이 표가 대신 대조한다.
 */
const AS_NAV_GROUPS: readonly { key: string; label: string; itemKeys: readonly string[] }[] = [
  {
    key: "asOperations",
    label: "A/S 업무",
    itemKeys: [
      "repairCases",
      "myActiveWork",
      "repairCaseNew",
      "customerPortal",
      "diagnosisFlowcharts",
      "workflows",
      "excelKyosanIntakeList",
      "kyosanIntakeImport",
    ],
  },
  { key: "techResources", label: "기술 / 자원", itemKeys: ["technicalProcedures", "inventory"] },
  { key: "poDomestic", label: "PO / 내자", itemKeys: ["domesticOrders", "quotes", "repairLabor"] },
  { key: "admin", label: "관리", itemKeys: ["customers", "productModels"] },
  {
    key: "systemSettings",
    label: "설정",
    itemKeys: ["users", "settings", "mailSettings", "developerMode"],
  },
];

/** 저쪽 navGroups 에는 없지만 여기엔 남아 있는 메뉴 — 지금 하나뿐이다. */
const AS_MENUS_REMOVED_FROM_NAV = ["improvementRequests"];

/** 어느 구획에도 안 든 A/S 메뉴 — 저쪽 사이드바에서도 구획 위에 단독으로 있다. */
const AS_MENUS_OUTSIDE_GROUPS = ["dashboard", "weeklyReport"];

const asMenus = () => listMenusOf("rf-service-system");

test("🔴 대메뉴를 걷어내면 예전 목록 그대로다 — 열쇠도 이름도 차례도", () => {
  assert.deepEqual(
    asMenus()
      .filter((menu) => !menu.isGroup)
      .map((menu) => [menu.key, menu.label] as const),
    AS_MENUS_BEFORE_GROUPS,
    "저장되는 열쇠·이름·차례가 달라졌습니다 — 위 AS_MENUS_BEFORE_GROUPS 머리말을 읽으세요",
  );
});

test("🔴 대메뉴 열쇠와 이름과 차례는 A/S 의 navGroups 그대로다", () => {
  assert.deepEqual(
    asMenus()
      .filter((menu) => menu.isGroup)
      .map((menu) => [menu.key, menu.label] as const),
    AS_NAV_GROUPS.map((group) => [group.key, group.label] as const),
    "대메뉴 열쇠를 다시 지으면 A/S 글을 옮겨 올 때 대응표가 필요해집니다",
  );
});

test("🔴 각 대메뉴에 든 메뉴가 A/S 의 navGroups 와 어긋나지 않는다", () => {
  const menus = asMenus();
  for (const group of AS_NAV_GROUPS) {
    const mine = menus
      .filter((menu) => menu.groupKey === group.key)
      .map((menu) => menu.key)
      .filter((key) => !AS_MENUS_REMOVED_FROM_NAV.includes(key));
    assert.deepEqual(mine, [...group.itemKeys], `${group.key} 에 든 메뉴가 저쪽과 다릅니다`);
  }

  // 대조에서 빼 준 메뉴가 늘어나지 않게. 예외가 늘면 그만큼 이 시험이 눈을 감는다.
  const grouped = new Set(AS_NAV_GROUPS.flatMap((group) => group.itemKeys));
  const extras = menus
    .filter((menu) => menu.groupKey !== undefined && !grouped.has(menu.key))
    .map((menu) => menu.key);
  assert.deepEqual(
    extras,
    AS_MENUS_REMOVED_FROM_NAV,
    "저쪽 navGroups 에 없는 메뉴가 구획에 들어 있습니다 — 예외라면 근거를 적고 목록에 더하세요",
  );
});

test("🔴 구획 밖 메뉴는 대시보드와 주간보고 둘뿐이고, 그래도 고를 수 있다", () => {
  const outside = asMenus()
    .filter((menu) => !menu.isGroup && menu.groupKey === undefined)
    .map((menu) => menu.key);
  assert.deepEqual(outside, AS_MENUS_OUTSIDE_GROUPS);
  // 저쪽 사이드바에서도 구획 위에 단독으로 있다. 묶이지 않았다고 못 고르면 안 된다.
  for (const key of AS_MENUS_OUTSIDE_GROUPS) {
    assert.ok(isMenuKeyOf("rf-service-system", key), `${key} 를 고를 수 없습니다`);
  }
});

test("🔴 대메뉴도 고를 수 있다 — 저장되는 열쇠다", () => {
  for (const group of AS_NAV_GROUPS) {
    assert.ok(
      isMenuKeyOf("rf-service-system", group.key),
      `대메뉴 ${group.key} 를 고를 수 없습니다 — 저장이 거절합니다`,
    );
    // 남의 시스템의 대메뉴가 통과하면 안 되는 것은 보통 메뉴와 같다.
    assert.ok(!isMenuKeyOf("dss-meters", group.key));
  }
  assert.equal(menuLabel("rf-service-system", "asOperations"), "A/S 업무");
});

test("🔴 대메뉴와 메뉴가 같은 이름 공간을 쓴다 — 한 칸도 겹치면 안 된다", () => {
  // 저쪽에서는 navGroups 와 navItems 가 서로 다른 이름 공간이라 겹쳐도 됐다.
  // 여기서는 한 배열이라 겹치면 조용히 한쪽이 먹힌다(find 가 앞의 것만 집는다).
  const groupKeys = AS_NAV_GROUPS.map((group) => group.key);
  const menuKeys = AS_MENUS_BEFORE_GROUPS.map(([key]) => key);
  for (const key of groupKeys) {
    assert.ok(!menuKeys.includes(key), `대메뉴 열쇠 "${key}" 가 메뉴 열쇠와 겹칩니다`);
  }
  // 「설정」이 그 함정이다 — 구획은 systemSettings, 메뉴는 settings 로 갈라져 있다.
  assert.ok(groupKeys.includes("systemSettings"));
  assert.ok(menuKeys.includes("settings"));
});

test("🔴 같은 대메뉴에 든 메뉴는 연이어 있고, 그 대메뉴 바로 뒤에서 시작한다", () => {
  // 사이에 남이 끼면 선택칸에서 한 구획이 두 토막으로 보인다.
  for (const service of SERVICE_CATALOG) {
    let current: string | undefined;
    const seen = new Set<string>();
    for (const menu of service.menus) {
      if (menu.isGroup) {
        assert.equal(menu.groupKey, undefined, `${menu.key}: 대메뉴는 남의 구획에 들지 않는다`);
        assert.ok(!seen.has(menu.key), `${menu.key}: 대메뉴가 두 번 나옵니다`);
        seen.add(menu.key);
        current = menu.key;
        continue;
      }
      if (menu.groupKey === undefined) {
        current = undefined;
        continue;
      }
      assert.equal(
        menu.groupKey,
        current,
        `${service.key}/${menu.key}: 바로 앞 대메뉴(${current ?? "없음"})와 다른 구획입니다`,
      );
    }
  }
});

test("묶음이 없는 시스템의 메뉴 목록은 예전 그대로다", () => {
  for (const key of ["dss-meters", "dss-auth", "dss-improvements", "dss-home", OTHER_SERVICE_KEY]) {
    for (const menu of listMenusOf(key)) {
      assert.equal(menu.isGroup, undefined, `${key}/${menu.key} 에 대메뉴가 생겼습니다`);
      assert.equal(menu.groupKey, undefined, `${key}/${menu.key} 가 구획에 들어갔습니다`);
    }
  }
  assert.deepEqual(
    listMenusOf("dss-meters").map((menu) => menu.key),
    ["meterList", "meterNew", "meterDetail", "certificates", "notifySettings"],
  );
});

/* ------------------------------------------------------------------ */
/* 선택칸에 그릴 글자                                                    */
/* ------------------------------------------------------------------ */

test("🔴 선택칸 글자는 세 단으로 갈린다 — 굵기가 안 먹어도 구분된다", () => {
  assert.equal(menuOptionText({ label: "대시보드" }), "대시보드");
  assert.equal(menuOptionText({ label: "A/S 업무", isGroup: true }), "■ A/S 업무");
  assert.equal(menuOptionText({ label: "견적서", groupKey: "poDomestic" }), `${MENU_INDENT}견적서`);
  // 들여쓰기는 NBSP 다 — 보통 공백은 브라우저가 <option> 안에서 접는다.
  assert.equal(MENU_INDENT, "   ");
  assert.ok(!MENU_INDENT.includes(" "), "들여쓰기에 보통 공백이 섞였습니다");
  assert.equal(MENU_GROUP_MARK, "■ ");
});

test("🔴 선택칸 글자는 저장되는 값에도 이름표에도 섞이지 않는다", () => {
  for (const menu of asMenus()) {
    assert.ok(!menu.key.includes(MENU_INDENT), `${menu.key}: 열쇠에 들여쓰기가 섞였습니다`);
    assert.ok(!menu.label.startsWith(MENU_GROUP_MARK), `${menu.key}: 이름표에 표가 섞였습니다`);
    assert.ok(!menu.label.startsWith(MENU_INDENT), `${menu.key}: 이름표에 들여쓰기가 섞였습니다`);
    // 목록·복사 글이 읽는 것은 언제나 label 그대로다.
    assert.equal(menuLabel("rf-service-system", menu.key), menu.label);
  }
});
