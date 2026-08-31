#!/usr/bin/env node
/**
 * scripts/create-release-issue.mjs — 对话触发“按发布规范发版 vX.Y.Z”的可执行化身
 *
 * 用法：
 *   node scripts/create-release-issue.mjs v1.7.9
 *   node scripts/create-release-issue.mjs --version v1.7.9
 *   node scripts/create-release-issue.mjs 1.7.9   （自动补 v 前缀）
 *
 * 行为：
 *   1. 校验版本号形态 vX.Y.Z（未提供时追问而非猜测，对应验收标准）
 *   2. 读取 docs/releases/release-issue-template.md（真源）并将 vX.Y.Z 占位替换为实际版本
 *   3. 通过 gh CLI 创建发布议题，标题为 "发布 vX.Y.Z"，首行即引用 RELEASE-RUNBOOK.md
 *   4. 生成的正文与网页卡 .github/ISSUE_TEMPLATE/release.yml 逐字一致（8+4+2 清单）
 *
 * 要求：已安装 gh 且已通过 gh auth login；需在仓库根目录执行。
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = resolve(ROOT, "docs/releases/release-issue-template.md");
const RUNBOOK_PATH = resolve(ROOT, "docs/releases/RELEASE-RUNBOOK.md");

function usageAndExit(code = 1) {
  console.error(`
用法：按发布规范发版 vX.Y.Z

  node scripts/create-release-issue.mjs v1.7.9
  node scripts/create-release-issue.mjs --dry-run v1.7.9   # 仅打印正文，不创建
  node scripts/create-release-issue.mjs --help

说明：
  - 未提供版本号时将追问（不猜测），请显式传入 vX.Y.Z
  - 正文逐字来源于 docs/releases/release-issue-template.md，首行引用 RELEASE-RUNBOOK.md
  - 网页卡与对话创建的议题正文逐字一致且包含 8+4+2 清单
`);
  process.exit(code);
}

function normalizeVersion(input) {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  if (!v.startsWith("v")) v = "v" + v;
  if (!/^v\d+\.\d+\.\d+$/.test(v)) return null;
  return v;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usageAndExit(0);
  const dryRun = args.includes("--dry-run");
  const filtered = args.filter(a => a !== "--dry-run" && a !== "--version");
  // 支持 --version vX.Y.Z 形式
  let versionRaw = null;
  const verIdx = argv.indexOf("--version");
  if (verIdx !== -1 && argv[verIdx + 1]) versionRaw = argv[verIdx + 1];
  else {
    // 取最后一个非 flag 参数为版本
    const candidates = filtered.filter(a => !a.startsWith("-"));
    if (candidates.length > 0) versionRaw = candidates[candidates.length - 1];
  }
  return { versionRaw, dryRun };
}

function askForVersion() {
  console.error("未提供版本号。请按语义化口径显式提供本次发布版本，例如：");
  console.error("  node scripts/create-release-issue.mjs v1.7.9");
  console.error("（修补递增用于缺陷与收口、次版本递增用于新增能力、主版本递增用于破坏契约）");
  console.error("已追问而非猜测，等待你提供版本号后再执行。");
  process.exit(2);
}

function loadTemplate(version) {
  let template;
  try {
    template = readFileSync(TEMPLATE_PATH, "utf8");
  } catch (e) {
    console.error(`读取模板失败：${TEMPLATE_PATH} — ${e.message}`);
    process.exit(1);
  }
  // 校验 runbook 存在性
  try { readFileSync(RUNBOOK_PATH, "utf8"); } catch (e) {
    console.error(`Runbook 不存在：${RUNBOOK_PATH}`);
    process.exit(1);
  }
  // 替换占位 vX.Y.Z 为实际版本；模板中多处出现
  const body = template.replaceAll("vX.Y.Z", version);
  const title = `发布 ${version}`;
  return { title, body };
}

function createIssue(title, body, dryRun) {
  if (dryRun) {
    console.log(`=== 标题：${title} ===\n`);
    console.log(body);
    console.log("\n--- dry-run：未创建议题 ---");
    return;
  }
  const result = spawnSync("gh", ["issue", "create", "--title", title, "--body", body], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    console.error("\n创建议题失败。请确认已 gh auth login 且在仓库目录内。");
    process.exit(result.status || 1);
  }
  const url = (result.stdout || "").trim();
  console.log(`已创建发布议题：${url}`);
  console.log(`标题：${title}`);
}

const { versionRaw, dryRun } = parseArgs(process.argv);
if (!versionRaw) askForVersion();
const version = normalizeVersion(versionRaw);
if (!version) {
  console.error(`版本号形态错误：${versionRaw}。期望形态为 vX.Y.Z，例如 v1.7.9`);
  process.exit(2);
}
const { title, body } = loadTemplate(version);
createIssue(title, body, dryRun);
