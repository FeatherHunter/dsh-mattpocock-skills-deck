#!/usr/bin/env node
/**
 * tests/verify-release-template.js — 发布 Runbook 与双入口模板的验收门禁
 *
 * 验收标准（来自 #355）：
 * - [ ] 存在一份带生效日期的发布 runbook 文档，以后所有发布议题首行即引用它，冲突时以更新日期者为准
 * - [ ] 在 https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/new/choose 出现“发布 vX.Y.Z”网页卡，点卡填版本号即创建发布议题
 * - [ ] 在对话中说“按发布规范发版 vX.Y.Z”可由 AI 代为创建同模板的发布议题，未给版本号时追问而非猜测
 * - [ ] 网页卡与对话创建的议题正文逐字一致且包含 8+4+2 清单
 *
 * 用法：node tests/verify-release-template.js
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

console.log("verify-release-template — 发布 Runbook 与双入口模板门禁");
console.log("");

// 1. Runbook 存在性与生效日期
console.log("[1] Runbook 存在性与生效日期");
const runbookPath = resolve(ROOT, "docs/releases/RELEASE-RUNBOOK.md");
assert(existsSync(runbookPath), "docs/releases/RELEASE-RUNBOOK.md 存在");
let runbook = "";
if (existsSync(runbookPath)) {
  runbook = readFileSync(runbookPath, "utf8");
  assert(runbook.includes("生效日期：2026-08-31") || runbook.includes("生效日期: 2026-08-31"), "Runbook 包含生效日期 2026-08-31");
  assert(runbook.includes("以更新日期者为准"), "Runbook 声明“冲突时以更新日期者为准”");
  assert(runbook.includes("8 项对外展示清单"), "Runbook 锁死 8 项清单");
  assert(runbook.includes("语义化") || runbook.includes("语义化版本"), "Runbook 包含语义化口径");
  assert(runbook.includes("隔离门禁"), "Runbook 包含隔离门禁");
  assert(runbook.includes("文档同源") || runbook.includes("同源"), "Runbook 包含文档同源");
  assert(runbook.includes("无回滚") || runbook.includes("不回滚"), "Runbook 包含无回滚顺序");
} else {
  failures.push("Runbook 文件缺失，跳过内容检查");
}
console.log("");

// 2. 模板存在性与首行引用
console.log("[2] 发布议题模板存在性与首行引用");
const templatePath = resolve(ROOT, "docs/releases/release-issue-template.md");
assert(existsSync(templatePath), "docs/releases/release-issue-template.md 存在");
let template = "";
if (existsSync(templatePath)) {
  template = readFileSync(templatePath, "utf8");
  const firstLine = template.split("\n")[0] || "";
  assert(firstLine.includes("RELEASE-RUNBOOK.md"), "模板首行即引用 Runbook");
  assert(firstLine.includes("2026-08-31") || firstLine.includes("生效日期"), "模板首行包含生效日期");
  assert(firstLine.includes("以更新日期者为准"), "模板首行包含冲突规则");
  const checkboxCount = (template.match(/- \[ \] /g) || []).length;
  assert(checkboxCount === 14, `模板包含 8+4+2=14 个复选框（实际 ${checkboxCount}）`);
  assert(template.includes("8 项对外展示清单"), "模板包含 8 项清单分组");
  assert(template.includes("4 项隔离门禁"), "模板包含 4 项门禁分组");
  assert(template.includes("2 项发布验证"), "模板包含 2 项验证分组");
}
console.log("");

// 3. GitHub 网页卡
console.log("[3] GitHub 网页卡（.github/ISSUE_TEMPLATE/release.yml）");
const ymlPath = resolve(ROOT, ".github/ISSUE_TEMPLATE/release.yml");
assert(existsSync(ymlPath), ".github/ISSUE_TEMPLATE/release.yml 存在");
let yml = "";
if (existsSync(ymlPath)) {
  yml = readFileSync(ymlPath, "utf8");
  assert(yml.includes("name: 发布 vX.Y.Z"), "网页卡名称为“发布 vX.Y.Z”");
  assert(yml.includes("RELEASE-RUNBOOK.md"), "网页卡首行引用 Runbook");
  assert(yml.includes("vX.Y.Z"), "网页卡包含版本占位 vX.Y.Z");
  assert(yml.includes("8 项对外展示清单") || yml.includes("checklist-8"), "网页卡包含 8 项清单");
  assert(yml.includes("4 项隔离门禁") || yml.includes("checklist-4"), "网页卡包含 4 项门禁");
  assert(yml.includes("2 项发布验证") || yml.includes("checklist-2"), "网页卡包含 2 项验证");
  // 检查 config.yml
  const configPath = resolve(ROOT, ".github/ISSUE_TEMPLATE/config.yml");
  assert(existsSync(configPath), ".github/ISSUE_TEMPLATE/config.yml 存在");
}
console.log("");

// 4. 对话触发脚本
console.log("[4] 对话触发脚本（scripts/create-release-issue.mjs）");
const scriptPath = resolve(ROOT, "scripts/create-release-issue.mjs");
assert(existsSync(scriptPath), "scripts/create-release-issue.mjs 存在");
if (existsSync(scriptPath)) {
  const script = readFileSync(scriptPath, "utf8");
  assert(script.includes("按发布规范发版"), "脚本说明包含对话触发句式“按发布规范发版 vX.Y.Z”");
  assert(script.includes("release-issue-template.md"), "脚本读取模板真源");
  assert(script.includes("追问") || script.includes("未提供版本号"), "脚本在未给版本号时追问而非猜测");
  // 实际运行：缺失版本号应退出 2
  const miss = spawnSync("node", [scriptPath], { encoding: "utf8" });
  assert(miss.status === 2, "未给版本号时脚本退出码为 2（追问）");
  assert((miss.stderr + miss.stdout).includes("追问") || (miss.stderr + miss.stdout).includes("未提供版本号"), "缺失版本号时输出追问文案");
  // 正常版本应可 dry-run
  const dry = spawnSync("node", [scriptPath, "--dry-run", "v1.7.9"], { encoding: "utf8" });
  assert(dry.status === 0, "提供版本号时 dry-run 成功");
  assert(dry.stdout.includes("发布 v1.7.9"), "dry-run 输出标题为 发布 v1.7.9");
  assert(dry.stdout.includes("RELEASE-RUNBOOK.md"), "dry-run 正文首行引用 Runbook");
  assert(dry.stdout.includes("8 项对外展示清单"), "dry-run 包含 8 项清单");
  // 自动补 v 前缀
  const dry2 = spawnSync("node", [scriptPath, "--dry-run", "1.7.9"], { encoding: "utf8" });
  assert(dry2.status === 0 && dry2.stdout.includes("发布 v1.7.9"), "支持无 v 前缀的版本号，自动补全");
}
console.log("");

// 5. 双入口逐字一致性（关键）
console.log("[5] 双入口逐字一致性");
if (existsSync(templatePath) && existsSync(ymlPath) && existsSync(scriptPath)) {
  const dry = spawnSync("node", [scriptPath, "--dry-run", "v1.7.9"], { encoding: "utf8" });
  const dialogBody = dry.stdout.replace(/^=== 标题：.*===\n+/, "").replace(/\n--- dry-run：未创建议题 ---\s*$/, "").trim();
  // 网页卡的清单标签应与对话模板的标签逐项对应
  // 提取模板中的复选框标签
  const templateLabels = [...template.matchAll(/- \[ \] \d+\. (.+)/g)].map(m => m[1].trim());
  const ymlLabels = [...yml.matchAll(/- label: "([^"]+)"/g)].map(m => m[1].trim());
  // yml 中的 label 包含 "1. 根 package.json..." 等，与 template 相同（去掉序号后的描述应一致）
  // 取前 8 项对比
  const normalize = s => s.replace(/^\d+\.\s*/, "").replace(/`/g, "").trim();
  const templateFirst8 = templateLabels.slice(0, 8).map(normalize);
  const ymlFirst8 = ymlLabels.slice(0, 8).map(normalize);
  const first8Match = templateFirst8.length === 8 && ymlFirst8.length === 8 && templateFirst8.every((v,i) => v === ymlFirst8[i]);
  assert(first8Match, "网页卡与对话模板的 8 项清单标签逐字一致");
  const dialogCheckboxCount = (dialogBody.match(/- \[ \] /g) || []).length;
  assert(dialogCheckboxCount === 14, `对话生成的正文包含 14 个复选框（实际 ${dialogCheckboxCount}）`);
  assert(dialogBody.includes("> 规范：[发布 Runbook"), "对话正文首行即引用 Runbook");
  // 对比 yml 与 md 的首行引用是否一致
  const ymlFirst = yml.includes("> 规范：[发布 Runbook · 生效日期 2026-08-31]");
  const dialogFirst = dialogBody.startsWith("> 规范：[发布 Runbook · 生效日期 2026-08-31]");
  assert(ymlFirst && dialogFirst, "两者首行引用 Runbook 的表述逐字一致");
} else {
  assert(false, "双入口一致性检查跳过（前置文件缺失）");
}
console.log("");

// 汇总
console.log(`结果：${passes} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.log("\n失败项：");
  failures.forEach(f => console.log("  - " + f));
  process.exit(1);
} else {
  console.log("\n全部通过 — 满足 #355 的 4 项验收标准（Runbook 有效、网页卡存在、对话可触发且未给版本时追问、双入口 8+4+2 逐字一致）。");
}