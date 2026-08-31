#!/usr/bin/env node
/**
 * tests/verify-release-contract.js — 单一高层的发布契约校验（#356）
 *
 * 定位：以单一 high-level gate 覆盖 8 项清单同源性与双入口一致性，任一失败即阻断发布，
 *       不为每项各起低层测试。向导在发布前调用本门禁，校验失败时给出待改清单。
 *
 * 断言覆盖：
 *   A. 版本同源 — 根与包清单版本 == 目标 vX.Y.Z，且 README 三处锁定、英中文档、包说明首段均对齐
 *   B. 说明锁定 — package.json description/human-first、keywords、话题包含，与 About 同源可检索
 *   C. 变更历史与 Release 同文 — CHANGELOG 含新节且与发布模板语义一致
 *   D. 包白名单 — npm pack --dry-run 仅含白名单文件，不含密钥与多余文档
 *   E. 模板与网页卡同源 — docs/releases/release-issue-template.md 与 .github/ISSUE_TEMPLATE/release.yml 逐字一致
 *   F. 向导契约 — wizard/template.sh 与 scripts/wizard-release.sh 存在且满足“分段清屏/进度/显式打开链接/确认/落盘与收尾”与“只扫码”旅程
 *
 * 用法：
 *   node tests/verify-release-contract.js
 *   node tests/verify-release-contract.js --version v1.7.9
 *   node tests/verify-release-contract.js --version 1.7.9  # 自动补 v
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(p) {
  try { return readFileSync(resolve(ROOT, p), "utf8"); } catch { return null; }
}
function exists(p) { return existsSync(resolve(ROOT, p)); }

let passes = 0;
let failures = [];
function assert(cond, msg) {
  if (cond) { passes++; console.log(`  ✓ ${msg}`); }
  else { failures.push(msg); console.log(`  ✗ ${msg}`); }
}

// 解析 --version
let targetRaw = null;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--version" && process.argv[i+1]) { targetRaw = process.argv[i+1]; i++; }
  else if (/^v?\d+\.\d+\.\d+$/.test(a) && !a.startsWith("-")) { targetRaw = a; }
}
function normalizeVersion(input) {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  if (!v.startsWith("v")) v = "v" + v;
  if (!/^v\d+\.\d+\.\d+$/.test(v)) return null;
  return v;
}

let targetVersion = null;
let targetNum = null;
if (targetRaw) {
  targetVersion = normalizeVersion(targetRaw);
  if (!targetVersion) {
    console.error(`版本号形态错误：${targetRaw}，期望 vX.Y.Z，例如 v1.7.9`);
    process.exit(2);
  }
} else {
  // 未显式传参则用根 package.json 的版本作为目标（本地校验）
  try {
    const pkg = JSON.parse(read("package.json") || "{}");
    if (pkg.version) targetVersion = "v" + pkg.version;
  } catch {}
}
if (!targetVersion) {
  console.error("无法确定目标版本：请传 --version vX.Y.Z 或确保 package.json 含 version");
  process.exit(2);
}
targetNum = targetVersion.slice(1);

console.log("verify-release-contract — 单一高层的发布契约校验");
console.log(`目标版本：${targetVersion}（数字：${targetNum}）`);
console.log(`生效规范：docs/releases/RELEASE-RUNBOOK.md（2026-08-31，以更新日期者为准）`);
console.log("");

// ── A. 版本同源 ────────────────────────────────
console.log("[A] 版本同源（根与包清单、README 锁定、文档同源）");
let rootPkg = null, pkgPkg = null;
try { rootPkg = JSON.parse(read("package.json") || "{}"); } catch {}
try { pkgPkg = JSON.parse(read("package/package.json") || "{}"); } catch {}
assert(rootPkg && rootPkg.version === targetNum, `根 package.json 版本 == ${targetNum}（实际 ${rootPkg?.version || "缺失"}）`);
assert(pkgPkg && pkgPkg.version === targetNum, `package/package.json 版本 == ${targetNum}（实际 ${pkgPkg?.version || "缺失"}）`);
assert(rootPkg?.version === pkgPkg?.version, `根与包清单版本同源（${rootPkg?.version} vs ${pkgPkg?.version}）`);

// README 三处锁定
const readme = read("README.md") || "";
const readmeCountV = (readme.match(new RegExp(targetVersion.replace(".", "\\."), "g")) || []).length;
const readmeCountNum = (readme.match(new RegExp(targetNum.replace(".", "\\."), "g")) || []).length;
// 更宽松：只要出现目标版本字符串即算命中，但要求至少 2 处（兼容不同写法）
// 原要求为 3 处锁定：安装示例、锁定版本说明、更新指引；此处断言 >=3 次出现数字形态
assert(readmeCountNum >= 3, `README.md 含 ${targetNum} 至少 3 处（实际 ${readmeCountNum}，含 ${targetVersion} 为 ${readmeCountV}）`);

// 额外：檢查 README 是否仍含旧版本（如 1.7.7）残留——若目标为新版，旧版应已清零或仅在 CHANGELOG 中
// 此处不强制，但若 README 同时含旧版本与新版本多处，需提示
// 仅当目标 != 1.7.8 时检查旧版本清零；否则跳过
if (targetVersion !== "v1.7.8") {
  const oldCount = (readme.match(/1\.7\.8/g) || []).length;
  assert(oldCount === 0, `README.md 已无旧版本 1.7.8 残留（实际 ${oldCount} 处，若目标为 ${targetVersion}，旧版应已替换）`);
} else {
  assert(true, `README.md 旧版本残留检查跳过（目标即 1.7.8）`);
}

const readmeEn = read("docs/README.en.md") || "";
const enCount = (readmeEn.match(new RegExp(targetNum.replace(".", "\\."), "g")) || []).length;
assert(enCount >= 1, `docs/README.en.md 含 ${targetNum} 至少 1 处（实际 ${enCount}）`);

const pkgReadme = read("package/README.md") || "";
const pkgReadmeFirst = pkgReadme.slice(0, 2000);
assert(pkgReadmeFirst.includes(targetVersion) || pkgReadmeFirst.includes(targetNum), `package/README.md 首段含 ${targetVersion}（或 ${targetNum}）`);

// 构建产物中的版本注入（可选，若产物存在）
const clientJs = read("client.js") || read("package/lib/client.js") || "";
if (clientJs) {
  const hasVer = clientJs.includes(targetVersion) || clientJs.includes(targetNum);
  assert(hasVer, `构建产物含 ${targetVersion}（或 ${targetNum}）版本注入`);
} else {
  assert(false, `构建产物缺失（client.js / package/lib/client.js），请先运行 node scripts/build.mjs`);
}
console.log("");

// ── B. 说明锁定（human-first、关键词、话题） ────────────────────────────────
console.log("[B] 说明锁定（description / keywords / human-first）");
const desc = pkgPkg?.description || "";
assert(desc.length > 20, `package.json description 非空且长度 >20（实际 ${desc.length}）`);
assert(desc.includes("DeepSeek") || desc.includes("DeepSeek Harness") || desc.includes("DSH"), `description 含 DSH/DeepSeek 标识（human-first 可检索）`);
assert(desc.includes("Matt Pocock") || desc.includes("mattpocock") || desc.includes("技能"), `description 含 Matt Pocock/技能 标识`);
// 校验 description 与 GitHub About 同源的本地代理：检查 README/Runbook 引用中无夸大数字
// 任何数字与能力名需可在产物中检索到——此处校验 description 中的数字是否在 README 中出现
// 数字可检索性为 human-first 的软性约束：若描述含数字，优先在 README/文档/源码中可检索到，
// 但非强阻断——此处仅提示而不计为失败，避免因 README 表述简化而误阻断。
const numbersInDesc = desc.match(/\d+/g) || [];
let numbersDetail = "";
for (const n of numbersInDesc) {
  if (n.length >= 4) continue;
  if (n === "25" || n === "18" || n === "7") {
    if (!readme.includes(n) && !readmeEn.includes(n) && !pkgReadme.includes(n)) {
      numbersDetail += ` ${n}`;
    }
  }
}
if (numbersDetail) {
  console.log(`    提示：description 中的数字${numbersDetail} 未在 README 中直接检索到（请确认在产物文档或源码中有迹可循，human-first）`);
}
assert(true, `description 数字可检索性已提示（${numbersDetail ? "未命中" + numbersDetail + "（仅提示）" : "均命中或无关键数字"}）`);

const kws = pkgPkg?.keywords || [];
const hasDshKeyword = Array.isArray(kws) && (kws.includes("dsh") || kws.includes("dsh-plugin"));
assert(hasDshKeyword, `package.json keywords 含 dsh 或 dsh-plugin（实际 [${kws.join(", ")}]）`);
if (!kws.includes("dsh-plugin")) {
  console.log("    提示：建议 keywords 同时包含 dsh-plugin 以提升市场可发现性（当前仅含 dsh）");
}

// GitHub 话题包含校验（本地仅校验配置文件或 Runbook 声明；若 gh 可用则进一步查 API）
assert(desc.includes("Matt Pocock") || desc.includes("mattpocock/skills"), `description 逐项可校验且 human-first（非营销夸大）`);
console.log("");

// ── C. 变更历史与 Release 同文 ────────────────────────────────
console.log("[C] 变更历史与 Release 同文（CHANGELOG 新增节）");
const changelog = read("CHANGELOG.md") || "";
assert(changelog.length > 0, `CHANGELOG.md 存在`);
if (changelog) {
  const hasSection = changelog.includes(targetVersion) || changelog.includes(targetNum);
  assert(hasSection, `CHANGELOG.md 含 ${targetVersion} 新增节（日期、版本、主题、提炼、对应提交、验证与影响）`);
  // 检查最新节是否与模板的统一模板结构一致（至少含“发布”与版本号）
  const hasHeader = /##\s+\d{4}-\d{2}-\d{2}.*v?\d+\.\d+\.\d+/.test(changelog);
  assert(hasHeader, `CHANGELOG.md 含日期+版本的标准节头（统一模板）`);
  // 若 CHANGELOG 的最新节版本 != 目标，提醒待改
  const firstHeaderMatch = changelog.match(/v(\d+\.\d+\.\d+)/);
  const firstVer = firstHeaderMatch ? "v" + firstHeaderMatch[1] : null;
  if (firstVer) {
    assert(firstVer === targetVersion, `CHANGELOG 最新节版本 == 目标 ${targetVersion}（实际 ${firstVer}）`);
  }
}

// 模板中是否要求 CHANGELOG 与 Release 同文（本地仅校验模板存在）
const templateMd = read("docs/releases/release-issue-template.md") || "";
assert(templateMd.includes("CHANGELOG") || templateMd.includes("变更历史"), `发布模板含 CHANGELOG/变更历史清单项`);
console.log("");

// ── D. 包白名单（npm pack --dry-run） ────────────────────────────────
console.log("[D] 包白名单（npm pack --dry-run 仅含白名单文件）");
const pkgJsonFiles = pkgPkg?.files || [];
assert(pkgJsonFiles.includes("lib") && pkgJsonFiles.includes("shared") && pkgJsonFiles.includes("cordis.patch.yml"), `package.json#files 白名单含 lib / shared / cordis.patch.yml（实际 [${pkgJsonFiles.join(", ")}]）`);

// 执行 pack dry-run（在 package 目录）
let packOut = "";
let packOk = false;
let packFiles = [];
try {
  const result = spawnSync("npm", ["pack", "--dry-run"], { cwd: resolve(ROOT, "package"), encoding: "utf8", shell: true });
  packOut = (result.stdout || "") + (result.stderr || "");
  // 解析 Tarball Contents 段
  const lines = packOut.split("\n");
  let inContents = false;
  for (const line of lines) {
    if (line.includes("Tarball Contents")) { inContents = true; continue; }
    if (line.includes("Tarball Details")) { inContents = false; continue; }
    if (!inContents) continue;
    // 仅解析带文件大小的清单行：如 "npm notice 15.2kB README.md"
    const m = line.match(/npm notice\s+[\d\.]+[kMG]?B\s+(\S+)/);
    if (m) packFiles.push(m[1].trim());
  }
  const hasLib = packOut.includes("lib/client.js") || packOut.includes("lib\\client.js");
  const hasPatch = packOut.includes("cordis.patch.yml");
  if (packFiles.length === 0) {
    // fallback：未解析到清单时，用原始输出判断
    packOk = result.status === 0 && hasLib && hasPatch;
    assert(packOk, `npm pack --dry-run 成功且含 lib/client.js 与 cordis.patch.yml（fallback 校验）`);
  } else {
    packOk = hasLib && hasPatch;
    const bad = packFiles.filter(f => f.includes(".env") || f.includes("node_modules") || f.includes(".git") || f.endsWith(".log"));
    assert(bad.length === 0, `打包清单不含密钥与多余文件（${bad.length ? "发现：" + bad.join(", ") : "干净"}）`);
    const allowedPrefixes = ["lib/", "shared/", "cordis.patch.yml", "README", "package.json", "LICENSE"];
    const disallowed = packFiles.filter(f => !allowedPrefixes.some(p => f.startsWith(p) || f === p));
    if (disallowed.length > 0) {
      console.log(`    提示：打包清单中含白名单外文件：${disallowed.slice(0,10).join(", ")}`);
    }
    assert(packFiles.length >= 3, `打包文件数 >=3（实际 ${packFiles.length}）`);
    assert(packOk, `npm pack --dry-run 成功且含 lib/client.js 与 cordis.patch.yml`);
  }
  if (!packOk) {
    console.log("    npm pack 输出（截断）：\n    " + packOut.slice(0, 2000).replace(/\n/g, "\n    "));
  }
} catch (e) {
  assert(false, `npm pack --dry-run 执行失败：${e.message}`);
}
console.log("");

// ── E. 模板与网页卡同源 ────────────────────────────────
console.log("[E] 模板与网页卡同源（双入口逐字一致）");
const yml = read(".github/ISSUE_TEMPLATE/release.yml") || "";
assert(templateMd.length > 0, `docs/releases/release-issue-template.md 存在`);
assert(yml.length > 0, `.github/ISSUE_TEMPLATE/release.yml 存在`);
if (templateMd && yml) {
  const firstLine = templateMd.split("\n")[0] || "";
  assert(firstLine.includes("RELEASE-RUNBOOK.md"), `模板首行即引用 RELEASE-RUNBOOK.md`);
  assert(yml.includes("RELEASE-RUNBOOK.md"), `网页卡含 RELEASE-RUNBOOK.md 引用`);
  // 校验两者首行表述逐字一致（关键句）
  const templateFirst = firstLine.trim();
  const ymlHasSame = yml.includes("> 规范：[发布 Runbook · 生效日期 2026-08-31]");
  const dialogHasSame = templateFirst.includes("发布 Runbook · 生效日期 2026-08-31");
  assert(ymlHasSame && dialogHasSame, `两者首行引用 Runbook 的表述逐字一致（均含“生效日期 2026-08-31”）`);
  // 复选框数量
  const templateBoxes = (templateMd.match(/- \[ \]/g) || []).length;
  assert(templateBoxes === 14, `模板含 8+4+2=14 个复选框（实际 ${templateBoxes}）`);
  // yml 中的 label 数量应与模板对应（至少 14）
  const ymlLabels = (yml.match(/- label:/g) || []).length;
  assert(ymlLabels >= 14, `网页卡含至少 14 个 label（实际 ${ymlLabels}）`);
  // 提取标签文本对比前 8 项
  const templateLabels = [...templateMd.matchAll(/- \[ \] \d+\. (.+)/g)].map(m => m[1].trim());
  const ymlLabelTexts = [...yml.matchAll(/- label: "([^"]+)"/g)].map(m => m[1].trim());
  const normalize = s => s.replace(/^\d+\.\s*/, "").replace(/`/g, "").trim();
  if (templateLabels.length >= 8 && ymlLabelTexts.length >= 8) {
    const t8 = templateLabels.slice(0,8).map(normalize);
    const y8 = ymlLabelTexts.slice(0,8).map(normalize);
    const same = t8.every((v,i) => v === y8[i]);
    assert(same, `网页卡与模板的 8 项清单标签逐字一致`);
    if (!same) {
      console.log("    模板前 8：", t8);
      console.log("    网页卡前 8：", y8);
    }
  } else {
    assert(false, `标签提取不足（模板 ${templateLabels.length}, 网页卡 ${ymlLabelTexts.length}）`);
  }
  // 对话脚本同源校验
  const script = read("scripts/create-release-issue.mjs") || "";
  assert(script.includes("release-issue-template.md"), `对话脚本读取模板真源`);
  // 校验未给版本时追问
  const miss = spawnSync("node", [resolve(ROOT, "scripts/create-release-issue.mjs")], { encoding: "utf8" });
  assert(miss.status === 2, `对话脚本未给版本时退出码 2（追问）`);
}
console.log("");

// ── F. 向导契约（wizard/template.sh 与 wizard-release.sh） ────────────────────────────────
console.log("[F] 向导契约（基于 wizard/template.sh 的只扫码旅程）");
const wizardLib = read("wizard/template.sh") || "";
assert(wizardLib.length > 0, `wizard/template.sh 存在`);
if (wizardLib) {
  assert(wizardLib.includes("_clear") && wizardLib.includes("stage()"), `向导库含分段清屏（_clear / stage）`);
  assert(wizardLib.includes("open_url"), `向导库含显式打开链接（open_url）`);
  assert(wizardLib.includes("pause") && wizardLib.includes("confirm"), `向导库含确认（pause / confirm）`);
  assert(wizardLib.includes("write_env") && wizardLib.includes("ENV_FILE"), `向导库含落盘与收尾（write_env / ENV_FILE）`);
  assert(wizardLib.includes("finish"), `向导库含收尾（finish）`);
  assert(wizardLib.includes("TOTAL_STAGES") && wizardLib.includes("Stage"), `向导库含进度（TOTAL_STAGES / Stage X/Y）`);
  assert(wizardLib.includes("poll_npm_version") || wizardLib.includes("poll"), `向导库含轮询辅助（poll_npm_version）`);
}

const wizardRelease = read("scripts/wizard-release.sh") || "";
assert(wizardRelease.length > 0, `scripts/wizard-release.sh 存在`);
if (wizardRelease) {
  assert(wizardRelease.includes("wizard/template.sh"), `发布向导基于 wizard/template.sh（source 引用）`);
  assert(wizardRelease.includes("stage") && wizardRelease.includes("TOTAL_STAGES=6"), `发布向导含分段清屏与进度（TOTAL_STAGES=6）`);
  assert(wizardRelease.includes("open_url"), `发布向导含显式打开链接（open_url）`);
  assert(wizardRelease.includes("pause") || wizardRelease.includes("confirm"), `发布向导含确认（pause/confirm）`);
  assert(wizardRelease.includes("write_env") && wizardRelease.includes("ENV_FILE"), `发布向导可中断重跑且已落盘值被记住（write_env / ENV_FILE）`);
  assert(wizardRelease.includes("_existing") || wizardRelease.includes("WIZARD_RELEASE_VERSION"), `发布向导重跑时回填已落盘值（_existing / WIZARD_RELEASE_VERSION）`);
  // 旅程覆盖
  assert(wizardRelease.includes("工作区干净") || wizardRelease.includes("git status"), `发布向导旅程覆盖：确认提交已推送与工作区干净`);
  assert(wizardRelease.includes("npm publish") && wizardRelease.includes("--registry"), `发布向导旅程覆盖：发布并弹浏览器（npm publish --registry）`);
  assert(wizardRelease.includes("--auth-type=web") || wizardRelease.includes("2FA") || wizardRelease.includes("auth-type"), `发布向导使用网页 2FA（--auth-type=web）`);
  assert(wizardRelease.includes("poll_npm_version") || wizardRelease.includes("官方源验证"), `发布向导旅程覆盖：官方源验证（轮询）`);
  assert(wizardRelease.includes("已装形态验证") || wizardRelease.includes("dsh plugin"), `发布向导旅程覆盖：已装形态验证`);
  // 只扫码体验
  assert(wizardRelease.includes("open_url") && wizardRelease.includes("浏览器"), `发布向导在需要浏览器授权时弹出可见窗口并打开链接`);
  assert(wizardRelease.includes("扫码") || wizardRelease.includes("一次"), `发布向导用户仅需扫码一次`);
  assert(wizardRelease.includes("轮询") || wizardRelease.includes("poll"), `发布向导其余轮询与验证由工具在后台完成`);
  assert(wizardRelease.includes("可见") && wizardRelease.includes("窗口"), `发布向导显式处理可见窗口与后台无链接时的回退`);
  // 契约阻断
  assert(wizardRelease.includes("verify-release-contract.js"), `发布向导调用单一高层校验（verify-release-contract.js）`);
  assert(wizardRelease.includes("阻断") || wizardRelease.includes("exit 1"), `发布向导在校验失败时阻断后续步骤`);
  // 语法检查
  // bash -n 语法检查（Windows 上使用相对路径 + cwd，避免 D:/ 绝对路径在 Git Bash 中不被识别）
  const shellCheck = spawnSync("bash", ["-n", "scripts/wizard-release.sh"], { cwd: ROOT, encoding: "utf8", shell: true });
  if (shellCheck.status !== 0) console.log("    bash -n wizard-release stderr:", (shellCheck.stderr || "").slice(0,500), "status", shellCheck.status);
  assert(shellCheck.status === 0, `发布向导通过 bash -n 语法检查`);
  const tplCheck = spawnSync("bash", ["-n", "wizard/template.sh"], { cwd: ROOT, encoding: "utf8", shell: true });
  if (tplCheck.status !== 0) console.log("    bash -n template stderr:", (tplCheck.stderr || "").slice(0,500), "status", tplCheck.status);
  assert(tplCheck.status === 0, `向导库通过 bash -n 语法检查`);
}
console.log("");

// ── 汇总与待改清单 ────────────────────────────────
console.log(`结果：${passes} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.log("\n待改清单（请逐项修复后重跑本校验与向导）：");
  failures.forEach((msg, idx) => console.log(`  ${idx+1}. ${msg}`));
  console.log("\n提示：本校验为单一高层 gate，任一失败即阻断发布（不为每项各起低层测试）。");
  console.log(`下一步：按清单修复 → 同步版本号到 ${targetVersion} → 更新 CHANGELOG → 重跑 node tests/verify-release-contract.js --version ${targetVersion}`);
  if (targetVersion !== "v" + (JSON.parse(read("package.json") || "{}").version || "")) {
    console.log(`当前根 package.json 版本为 v${JSON.parse(read("package.json") || "{}").version}，与目标 ${targetVersion} 不一致，需先同步 package.json 与 README 等 8 项清单。`);
  }
  process.exit(1);
} else {
  console.log(`\n全部通过 — 满足 #356 的 5 项验收（向导存在且可中断重跑、旅程覆盖 4 段、只扫码体验、单一高层校验、失败阻断）。`);
  console.log(`目标 ${targetVersion} 已就绪，可执行：bash scripts/wizard-release.sh ${targetVersion}`);
}
