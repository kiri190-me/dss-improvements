import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// 목록을 읽는 규칙을 한 벌만 두려고 실행기(.mjs)의 함수를 그대로 쓴다.
// 타입은 그 파일의 JSDoc 에서 온다(allowJs) — 선언 파일을 따로 만들지 않는다.
import { findListProblems, listNames, readTestList, ROOT } from "../run-test-list.mjs";

/**
 * ============================================================================
 * 🔴 시험 파일이 어느 목록에도 안 적히면 **조용히 안 돈다**
 * ============================================================================
 * 이 저장소의 시험은 목록 파일(scripts/test-lists/*.txt)에 적힌 것만 돈다. 새
 * *.test.ts 를 만들고 목록에 적는 것을 잊으면, 그 시험은 실패하지도 통과하지도
 * 않는다 — 있는 줄 알고 넘어가게 된다. 그것을 막는 것이 이 파일이다.
 *
 * 이웃 저장소(RF_Service_System)의 같은 이름 파일과 같은 일을 한다.
 * ============================================================================
 */

/** `src` 와 `scripts` 아래의 모든 시험 파일, 저장소 뿌리 기준 슬래시 경로로. */
function findAllTestFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        found.push(path.relative(ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  for (const top of ["src", "scripts"]) {
    const dir = path.join(ROOT, top);
    if (fs.existsSync(dir)) walk(dir);
  }
  return found.sort();
}

test("모든 시험 파일이 목록 가운데 하나에 적혀 있다", () => {
  const listed = new Set<string>();
  for (const name of listNames()) {
    for (const entry of readTestList(name) as string[]) listed.add(entry);
  }

  const missing = findAllTestFiles().filter((file) => !listed.has(file));
  assert.deepEqual(
    missing,
    [],
    `목록에 없는 시험 파일이 있습니다 — 이대로면 이 시험들은 돌지 않습니다:\n${missing
      .map((file) => `  - ${file}`)
      .join("\n")}\n  scripts/test-lists/unit.txt 에 한 줄씩 적으세요.`,
  );
});

test("목록 파일 자체에 문제가 없다", () => {
  for (const name of listNames()) {
    const problems = findListProblems(readTestList(name)) as string[];
    assert.deepEqual(problems, [], `scripts/test-lists/${name}.txt: ${problems.join(" / ")}`);
  }
});
