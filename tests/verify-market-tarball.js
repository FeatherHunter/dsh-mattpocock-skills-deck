#!/usr/bin/env node
/**
 * tests/verify-market-tarball.js — 市场里那条「预构建包安装」链接的门禁
 *
 * 为什么需要这道门禁：
 * 插件市场（awesome-dsh-plugin 列表与 dsh-market）的详情页会给出一条「预构建包安装」命令，
 * 它指向 https://github.com/<owner>/<repo>/releases/latest/download/<资产名>.tgz。
 * 其中 latest 是请求时解析的、资产名是照字面取的，所以要同时满足两件事，
 * 这条链接才会永远指向最新版、也不会 404：
 *
 *   1. 每次发布 Release，都往这条 Release 附一个同名资产 —— 由
 *      .github/workflows/release-tarball.yml 在新 Release 发布时自动完成；
 *   2. 资产名与 npm 包名一致，且文档里写的是 latest/download 形式
 *      （写成钉住某个 tag 的带版本号文件名，下一次发版就指向旧版本）。
 *
 * 这道门禁把上面两条约定读原文钉住：改包名、删掉 workflow、或把链接改回钉 tag 的写法，
 * 都会在这里当场变红，而不是等到有人从市场点安装才发现。
 *
 * 用法：node tests/verify-market-tarball.js
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = [];
let passes = 0;

function assert(cond, msg) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

console.log("verify-market-tarball — 市场预构建包链接门禁");
console.log("");

const workflowPath = resolve(ROOT, ".github/workflows/release-tarball.yml");
const runbookPath = resolve(ROOT, "docs/releases/RELEASE-RUNBOOK.md");
const packageJsonPath = resolve(ROOT, "package/package.json");
const rootPackageJsonPath = resolve(ROOT, "package.json");

// 1. 自动附着资产的那个 workflow
console.log("[1] 发版即自动附着预构建包（workflow）");
let workflow = "";
if (existsSync(workflowPath)) {
  workflow = readFileSync(workflowPath, "utf8");
  assert(true, ".github/workflows/release-tarball.yml 存在");
  assert(/types:\s*\[\s*published\s*\]/.test(workflow), "在 Release 发布时触发（types: [published]）");
  assert(/contents:\s*write/.test(workflow), "申请 contents: write（否则上传资产会失败）");
  assert(workflow.includes("gh release upload"), "确实执行 gh release upload 把资产附上去");
  assert(workflow.includes("--clobber"), "用 --clobber 覆盖同名资产（重跑不会因已存在而失败）");
} else {
  assert(false, ".github/workflows/release-tarball.yml 存在（缺失则市场那条链接会随版本推进而 404）");
}
console.log("");

// 2. 资产名与 npm 包名一致
console.log("[2] 资产名与 npm 包名一致");
const pkg = existsSync(packageJsonPath) ? JSON.parse(readFileSync(packageJsonPath, "utf8")) : null;
const pkgName = pkg?.name ?? "";
assert(Boolean(pkgName), `package/package.json 读到了包名（${pkgName || "读不到"}）`);
if (pkgName) {
  assert(workflow.includes(`NAME="${pkgName}"`), `workflow 里的资产名 NAME 等于包名 ${pkgName}`);
  assert(!/\d+\.\d+\.\d+/.test(pkgName), "资产名本身不带版本号（带版本号会在下一次发版时失配）");
}
console.log("");

// 3. 文档里写的是不会过期的链接形式
console.log("[3] 文档里的链接形式");
if (existsSync(runbookPath)) {
  const runbook = readFileSync(runbookPath, "utf8");
  const expected = `releases/latest/download/${pkgName}.tgz`;
  assert(runbook.includes(expected), `RELEASE-RUNBOOK.md 写明了 ${expected}`);
  assert(runbook.includes("tarball:"), "RELEASE-RUNBOOK.md 给出了可直接粘进市场条目的 tarball 那一行");
} else {
  assert(false, "docs/releases/RELEASE-RUNBOOK.md 存在");
}
console.log("");

// 4. 本门禁自己确认已挂进 verify 链（仓库惯例：免得哪天被摘掉还没人发现）
console.log("[4] 本门禁已挂进 npm run verify 链");
const rootPkg = existsSync(rootPackageJsonPath) ? JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) : null;
assert(
  String(rootPkg?.scripts?.verify || "").includes("verify-market-tarball.js"),
  "package.json 的 scripts.verify 里有 verify-market-tarball.js",
);
console.log("");

// 汇总
console.log(`结果：${passes} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.log("\n失败项：");
  failures.forEach((f) => console.log("  - " + f));
  console.log("\n修哪里：");
  console.log("  - 资产名对不上包名：改 .github/workflows/release-tarball.yml 里的 NAME，或改回 package/package.json 的包名。");
  console.log("  - 链接不是 latest/download 形式：改 docs/releases/RELEASE-RUNBOOK.md 第 9 节里那一行。");
  process.exit(1);
} else {
  console.log("\n全部通过 — 发版会自动把 npm 上这一版的原样产物以固定文件名附到最新 Release，市场那条链接因此永远指向最新版。");
}
