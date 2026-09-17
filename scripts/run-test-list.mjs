// 시험 목록 파일(scripts/test-lists/<이름>.txt)을 읽어 node --test 로 돌린다.
//
//   node scripts/run-test-list.mjs <목록 이름> -- <node 플래그들>
//
// ── 왜 목록 파일인가 ────────────────────────────────────────────────────
// package.json 에 시험 파일 경로를 줄줄이 적는 길도 있다. 그런데 npm run 은
// Windows 에서 스크립트를 cmd.exe 로 돌리고, cmd.exe 의 명령줄 한도는 8191자다.
// 이웃 저장소(RF_Service_System)가 2026-09-11 에 그 벽을 정통으로 맞았다 —
// `test` 줄이 8113자에 닿아 시험 파일 하나만 더 적어도 `npm test` 가 「명령줄이
// 너무 깁니다」로 아예 돌지 않았다. 여기는 아직 시험이 몇 개뿐이지만, 같은 벽을
// 나중에 다시 맞는 것보다 지금 같은 모양으로 시작하는 편이 싸다. 이 스크립트는
// 셸을 거치지 않고(shell: false) node 를 직접 띄우므로 한도가 CreateProcess 의
// 32767자로 올라간다.
//
// 플래그는 package.json 에 그대로 둔다 — 무엇으로 도는지 거기서 한눈에 보이게.
//
// ── 🔴 이 스크립트가 막는 것 — 전부 「시험이 조용히 덜 도는」 경우다 ────
//   - 목록에 적힌 파일이 없다(오타·옮긴 파일·대소문자 차이). node --test 는 다른
//     파일이 하나라도 잡히면 못 찾은 경로를 **말없이 건너뛴다.**
//   - 목록이 비었다. 파일을 하나도 안 주면 node 가 기본 규칙으로 저장소 전체를
//     훑어 엉뚱한 플래그로 모든 시험을 돌린다.
//   - 플래그에 --test 가 없다. 그러면 node 는 첫 파일 하나만 스크립트로 실행한다.
//   - 같은 줄이 두 번 있다.
//
// ── 이웃 저장소와 다른 점 ───────────────────────────────────────────────
// RF_Service_System 의 같은 이름 스크립트에는 글롭 패턴 펼치기와 명령줄 길이
// 예산 검사가 더 있다. 여기는 시험이 몇 개뿐이고 패턴 줄이 없어 뺐다 — 필요해지면
// 그 파일을 보고 가져오면 된다. **`*` 가 든 줄은 여기서 그냥 「없는 파일」이다.**
//
// 의존성 없는 순수 Node 다. scripts/test-lists/test-list-registration.test.ts 가
// 아래 export 를 가져다 같은 규칙으로 목록을 검사한다.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LIST_DIR = path.join(ROOT, "scripts", "test-lists");

const LIST_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** 목록 폴더에 있는 목록 이름들(.txt 를 뗀 것). */
export function listNames() {
  return fs
    .readdirSync(LIST_DIR)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => name.slice(0, -".txt".length))
    .sort();
}

/**
 * 목록 파일을 읽어 경로 줄만 돌려준다. `#` 로 시작하는 줄과 빈 줄은 건너뛴다.
 * @param {string} name
 * @returns {string[]}
 */
export function readTestList(name) {
  if (!LIST_NAME.test(name)) {
    throw new Error(`목록 이름이 올바르지 않습니다: "${name}" (소문자·숫자·하이픈만)`);
  }
  const file = path.join(LIST_DIR, `${name}.txt`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `목록 파일이 없습니다: scripts/test-lists/${name}.txt\n  있는 목록: ${listNames().join(", ")}`,
    );
  }
  return fs
    .readFileSync(file, "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * 대소문자까지 정확히 같은 이름의 파일이 있는가.
 *
 * 🔴 Windows 는 대소문자를 가리지 않아 `existsSync` 로는 통과하지만, 최종 운영은
 * NAS(Linux) Docker 라 거기서는 못 찾는다 — 그때 그 시험은 **조용히 안 돈다.**
 */
function existsWithExactCase(relativePath, dirCache) {
  let dir = ROOT;
  for (const segment of relativePath.split("/")) {
    let names = dirCache.get(dir);
    if (!names) {
      try {
        names = new Set(fs.readdirSync(dir));
      } catch {
        return false;
      }
      dirCache.set(dir, names);
    }
    if (!names.has(segment)) return false;
    dir = path.join(dir, segment);
  }
  return fs.statSync(dir).isFile();
}

/**
 * 돌리기 전에 막아야 할 문제들. 비어 있으면 통과다.
 * @param {string[]} entries
 * @returns {string[]}
 */
export function findListProblems(entries) {
  const problems = [];
  if (entries.length === 0) {
    problems.push("목록이 비었습니다 — 파일 없이 node --test 를 부르면 저장소 전체를 돌립니다.");
  }
  const seen = new Set();
  const dirCache = new Map();
  for (const entry of entries) {
    if (seen.has(entry)) {
      problems.push(`같은 줄이 두 번 있습니다: ${entry}`);
      continue;
    }
    seen.add(entry);
    if (/\s/.test(entry)) {
      problems.push(`한 줄에 한 경로만 적습니다: ${entry}`);
    } else if (entry.includes("\\") || entry.startsWith("/") || entry.startsWith(".")) {
      problems.push(
        `저장소 뿌리 기준 상대경로를 슬래시로 적습니다(./ · \\ · 절대경로 불가): ${entry}`,
      );
    } else if (!existsWithExactCase(entry, dirCache)) {
      problems.push(`없는 파일입니다(대소문자까지 확인): ${entry}`);
    }
  }
  return problems;
}

function fail(message, exitCode = 1) {
  console.error(`[run-test-list] ${message}`);
  process.exit(exitCode);
}

function main() {
  const [listName, separator, ...nodeFlags] = process.argv.slice(2);
  if (!listName || separator !== "--") {
    fail("사용법: node scripts/run-test-list.mjs <목록 이름> -- <node 플래그들>", 2);
  }
  if (!nodeFlags.includes("--test")) {
    fail("플래그에 --test 가 없습니다 — 없으면 node 가 첫 파일 하나만 실행합니다.", 2);
  }

  let entries = [];
  try {
    entries = readTestList(listName);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }

  const problems = findListProblems(entries);
  if (problems.length > 0) {
    fail(
      `scripts/test-lists/${listName}.txt 에 문제가 있어 시험을 돌리지 않았습니다:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
  }

  console.log(`[run-test-list] ${listName}: 파일 ${entries.length}개`);

  const child = spawn(process.execPath, [...nodeFlags, ...entries], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
  // 터미널의 Ctrl+C 는 자식도 함께 받는다. 부모는 먼저 죽지 말고 자식이 정리하고
  // 끝나기를 기다렸다가 그 결과로 끝난다.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("error", (error) => fail(`node 를 띄우지 못했습니다: ${error.message}`));
  child.on("exit", (code, signal) => {
    if (signal) fail(`시험 프로세스가 시그널 ${signal} 로 끝났습니다.`);
    process.exit(code ?? 1);
  });
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  const normalize = (file) => {
    const resolved = path.resolve(file);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) main();
