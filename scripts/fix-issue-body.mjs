#!/usr/bin/env node
/**
 * scripts/fix-issue-body.mjs —— 「把一段正文写回 issue」的可执行化身
 *
 * 出处：#571（任务：正文写回脚本落地）按契约 #576 落地。
 * 为什么要它：agent 在终端里手敲 gh 命令写正文时，Windows PowerShell 会吞掉参数里的引号，
 *   长正文内联进命令行也容易写坏；写坏以后正文格式（字面 \n 转义、开头不可见字符）没人兜底。
 *   这个脚本把「读文件 → 校正写法 → 走文件参数写回」收成一条命令，提示词以后只写脚本名加参数。
 *
 * 用法：
 *   node scripts/fix-issue-body.mjs --issue 571 --body-file ./.tmp-571-body.md
 *   node scripts/fix-issue-body.mjs --issue 571 --body-file ./body.md --repo owner/name
 *   node scripts/fix-issue-body.mjs --issue 571 --body-file ./body.md --dry-run
 *   node scripts/fix-issue-body.mjs --help
 *
 * 参数：
 *   --issue <号>        必传。要写回正文的 issue 编号。
 *   --body-file <路径>  必传。正文文件；文件里必须是真实换行。脚本不替你编正文，只校正写法。
 *   --repo <owner/name> 可选。默认用当前目录所在仓库（跨仓库调用时才传）。
 *   --dry-run           可选。只演练：打印将要执行的命令与将要写入的正文，不联网、不改任何东西。
 *   --help              打印这段说明。
 *
 * 脚本做四件事：
 *   1. 剥掉正文开头的第一个不可见字符（BOM）——Windows 编辑器另存常带这个字符。
 *   2. 正文几乎没有真实换行、却存在字面 \n 转义时，把转义还原成真实换行；否则原样保留
 *      （阈值与 src/shared/parser.js 的 normalizeBody 一致：真实换行少于 2 处且字面转义至少 1 处才还原）。
 *   3. 检查正文格式，只告警不改写：每个 `## 章节` 是否独占一行、标题后是否留空行。
 *   4. 写回一律走正文文件参数（--body-file），不把正文拼进命令行字符串。
 *
 * 可重复跑：写之前先读一次当前正文，已经和要写的内容一样就直接返回，不再发请求。
 * 失败处理：失败自动重试一次；还失败就在该 issue 下留一条固定格式评论（含脚本名、参数、失败原因），
 *   方便以后按脚本名搜出所有失败现场。正文没被改坏。
 *
 * 回包：stdout 一行 JSON（stderr 是给人看的叙述）。字段：
 *   changed   这次对票做了什么（数组；真跑时已经一致就是空数组）
 *   edge      本脚本不建边，恒为 null（占位保持与关联脚本同形）
 *   expected  本脚本不数数，恒为 null
 *   actual    本脚本不数数，恒为 null
 *   commented 失败时有没有在该 issue 下留评论
 *   ok        总通过没（机器只看这个字段）
 *   warnings  格式告警（数组；只提示，不影响 ok）
 *   dryRun    是不是演练模式
 *   body      只有演练模式才有：将要写入的正文（真实换行）
 *   command   只有演练模式才有：将要执行的命令（数组）
 *   error     只有失败才有：失败原因
 *
 * 退出码：0 通过；1 写回失败（已重试一次）；2 参数或工作区后端不对，命令根本没执行。
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_NAME = "scripts/fix-issue-body.mjs";
const TRACKER_DOC = "docs/agents/issue-tracker.md";
const BOM = "\uFEFF";

/** 读文件失败、参数缺失、后端不对时统一走这里：先给人话，再给一行机器可读的回包。 */
function fail(code, message, extra) {
  console.error(message);
  const out = Object.assign({
    changed: [],
    edge: null,
    expected: null,
    actual: null,
    commented: false,
    ok: false,
    warnings: [],
    dryRun: false,
    error: message,
  }, extra || {});
  console.log(JSON.stringify(out));
  process.exit(code);
}

function usage() {
  console.error(`用法：
  node ${SCRIPT_NAME} --issue <号> --body-file <路径> [--repo <owner/name>] [--dry-run]

  --issue <号>        必传，要写回正文的 issue 编号
  --body-file <路径>  必传，正文文件（文件里必须是真实换行）
  --repo <owner/name> 可选，默认当前目录所在仓库
  --dry-run           可选，只演练：打印将要执行的命令与将要写入的正文，不联网、不改任何东西
  --help              打印这段说明

例子：
  node ${SCRIPT_NAME} --issue 571 --body-file ./.tmp-571-body.md
  node ${SCRIPT_NAME} --issue 571 --body-file ./body.md --dry-run

脚本会剥掉正文开头的不可见字符、按阈值还原字面 \\n 转义、检查标题是否独占一行与标题后是否留空行，
再统一走正文文件参数写回。已经和当前正文一样时不再发请求，可以重复跑。`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { usage(); process.exit(0); }
  const out = { issue: null, bodyFile: null, repo: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") { out.dryRun = true; continue; }
    if (a === "--issue" || a === "--body-file" || a === "--repo") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) fail(2, `参数 ${a} 后面没给值。`);
      i++;
      if (a === "--issue") out.issue = v.trim();
      else if (a === "--body-file") out.bodyFile = v;
      else out.repo = v.trim();
      continue;
    }
    fail(2, `不认识的参数：${a}。用 --help 看用法。`);
  }
  if (!out.issue) fail(2, "没给 --issue。要写回哪张票的正文？用 --issue <号> 传进来。");
  if (!/^\d+$/.test(out.issue)) fail(2, `--issue 只接受数字编号，收到的是「${out.issue}」。`);
  if (!out.bodyFile) fail(2, "没给 --body-file。正文必须放在文件里传进来（命令行内联正文会被外壳吃掉引号）。");
  if (out.repo && !/^[^/\s]+\/[^/\s]+$/.test(out.repo)) fail(2, `--repo 要写成 owner/name，收到的是「${out.repo}」。`);
  return out;
}

/**
 * 认后端：读工作区的主锚文件 docs/agents/issue-tracker.md，只认首批支持的 GitHub。
 * 判定口径与宿主探测的标题规则一致（# Issue tracker: <后端名>），不另造一套。
 */
function detectBackend(cwd) {
  const docPath = resolve(cwd, TRACKER_DOC);
  let raw = "";
  try {
    raw = readFileSync(docPath, "utf8");
  } catch (e) {
    return { backendId: null, reason: "missing", docPath: docPath };
  }
  const text = raw.replace(/^\uFEFF/, "");
  if (/^#\s*issue\s*tracker\s*:\s*gitlab/im.test(text)) return { backendId: "gitlab", reason: "title", docPath: docPath };
  if (/^#\s*issue\s*tracker\s*:\s*(markdown|local)/im.test(text)) return { backendId: "markdown", reason: "title", docPath: docPath };
  if (/^#\s*issue\s*tracker\s*:\s*github/im.test(text)) return { backendId: "github", reason: "title", docPath: docPath };
  if (/github/i.test(text)) return { backendId: "github", reason: "keyword", docPath: docPath };
  return { backendId: null, reason: "unknown", docPath: docPath };
}

function requireGithub(cwd) {
  const det = detectBackend(cwd);
  if (det.backendId === "github") return det;
  const head = `这个工作区用的不是首批支持的 GitHub（主锚文件：${det.docPath}）。`;
  if (det.backendId === "gitlab") {
    fail(2, `${head}它声明的是 GitLab；首批脚本只服务 GitHub，GitLab 待第二批。请按 GitLab 的方式改票，不要调本脚本。`);
  }
  if (det.backendId === "markdown") {
    fail(2, `${head}它声明的是本地 Markdown；本地 Markdown 的票就是仓库里的文件，请直接改文件存盘，不要调本脚本。`);
  }
  fail(2, `${head}认不出后端（文件${det.reason === "missing" ? "不存在" : "里没有后端标记"}）。GitHub 工作区请确认该文件首行写着「# Issue tracker: GitHub」；本地 Markdown 工作区请直接改票文件存盘；GitLab 待第二批。`);
}

/**
 * 校正正文写法。返回 { text, changes, realNewlines, literalEscapes }。
 * 阈值与 src/shared/parser.js 的 normalizeBody 完全一致，本文件是它的独立副本（脚本要能单跑，
 * 不依赖仓库源码目录与 Node 的模块探测），两者是否一致由 tests/verify-issue-body-script.js 差分钉住。
 */
function normalizeForWrite(raw) {
  const changes = [];
  let s = String(raw == null ? "" : raw);
  if (s.startsWith(BOM)) {
    s = s.slice(1);
    changes.push("剥掉开头的不可见字符（BOM）");
  }
  const realNewlines = (s.match(/\n/g) || []).length;
  const literalEscapes = (s.match(/\\n/g) || []).length;
  if (realNewlines < 2 && literalEscapes > 0) {
    s = s.split("\\n").join("\n");
    changes.push(`把 ${literalEscapes} 处字面 \\n 转义还原成真实换行`);
  }
  return { text: s, changes: changes, realNewlines: realNewlines, literalEscapes: literalEscapes };
}

/** 判断某一行里，`##` 开头的标题是不是没独占一行（出现在行中间）。行内代码里的写法不算。 */
function midLineHeading(line) {
  const re = /#{2,6}\s+\S/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const before = line.slice(0, m.index);
    if (before.trim() === "") return null; // 标题在行首（允许前面是空白），正常
    const ticks = (before.match(/`/g) || []).length;
    if (ticks % 2 === 1) continue; // 落在行内代码里，是举例不是标题
    return m[0].trim();
  }
  return null;
}

/**
 * 检查正文格式，只告警不改写。规则来自正文格式契约：
 * 每个 `## 章节` 独占一行；标题后留空行。代码围栏内的内容不检查。
 */
function checkFormat(text) {
  const warnings = [];
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*(`{3,}|~{3,})/);
    if (fm) {
      const marker = fm[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const mid = midLineHeading(line);
    if (mid) warnings.push(`第 ${i + 1} 行：标题「${mid}」前面还有文字，标题没独占一行`);
    if (/^#{2,6}\s+\S/.test(line)) {
      const next = lines[i + 1];
      if (next !== undefined && next.trim() !== "") {
        warnings.push(`第 ${i + 1} 行：标题后没留空行（下一行还有内容）`);
      }
    }
  }
  return warnings;
}

/** 找 gh：优先环境变量 DSH_GH_PATH（与平台抽象层的备用路径语义一致），否则用 PATH 上的 gh。 */
function resolveGh() {
  const envPath = process.env.DSH_GH_PATH;
  if (envPath && existsSync(envPath)) {
    // 指向 .js/.mjs 时用 node 跑（给门禁与离线验收放一个假 gh 用；真实安装的 gh 是可执行文件，走下面那支）
    if (/\.(m?js|cjs)$/i.test(envPath)) return { cmd: process.execPath, prefix: [envPath] };
    return { cmd: envPath, prefix: [] };
  }
  return { cmd: "gh", prefix: [] };
}

function runGh(argv) {
  const gh = resolveGh();
  const res = spawnSync(gh.cmd, gh.prefix.concat(argv), {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error) return { ok: false, status: -1, stdout: "", stderr: String(res.error.message || res.error) };
  return {
    ok: res.status === 0,
    status: typeof res.status === "number" ? res.status : -1,
    stdout: res.stdout || "",
    stderr: (res.stderr || "").trim(),
  };
}

/** 失败原因取一行：太长只留前一段并标注已截断。 */
function shortReason(text) {
  const first = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";
  return first.length > 200 ? first.slice(0, 200) + "…（已截断）" : first;
}

function repoArgs(repo) {
  return repo ? ["--repo", repo] : [];
}

/** 读当前正文（只用来判「是否已经一致」，读不到不阻塞写回）。 */
function readCurrentBody(issue, repo) {
  const res = runGh(["issue", "view", String(issue)].concat(repoArgs(repo)).concat(["--json", "body"]));
  if (!res.ok) return { ok: false, reason: shortReason(res.stderr) };
  try {
    const parsed = JSON.parse(res.stdout);
    return { ok: true, body: typeof parsed.body === "string" ? parsed.body : "" };
  } catch (e) {
    return { ok: false, reason: "读回的正文不是 JSON：" + e.message };
  }
}

/** 写回正文：正文先落临时文件，再走 --body-file 参数，绝不把正文拼进命令行。 */
function writeBody(issue, repo, text, workDir) {
  const bodyPath = join(workDir, "body.md");
  writeFileSync(bodyPath, text, "utf8");
  const argv = ["issue", "edit", String(issue)].concat(repoArgs(repo)).concat(["--body-file", bodyPath]);
  let res = runGh(argv);
  if (res.ok) return { ok: true, retried: false };
  console.error(`写回失败，按契约自动重试一次：${shortReason(res.stderr)}`);
  res = runGh(argv);
  if (res.ok) return { ok: true, retried: true };
  return { ok: false, retried: true, reason: shortReason(res.stderr) };
}

/** 失败留痕：在该 issue 下留一条固定格式评论，含脚本名、参数与失败原因，方便按脚本名搜出所有失败现场。 */
function commentFailure(issue, repo, opts, reason, workDir) {
  const lines = [
    `<!-- 失败留痕：${SCRIPT_NAME} -->`,
    `**${SCRIPT_NAME} 写正文失败**`,
    "",
    `- 脚本：\`${SCRIPT_NAME}\``,
    `- 参数：\`--issue ${issue} --body-file ${opts.bodyFile}\`${repo ? "（--repo " + repo + "）" : ""}`,
    `- 失败原因：${reason || "没有拿到报错文本"}`,
    "",
    "这条评论由脚本自动留下，用来以后按脚本名搜出失败现场。票的正文没有被改坏。",
  ];
  const notePath = join(workDir, "failure-comment.md");
  writeFileSync(notePath, lines.join("\n") + "\n", "utf8");
  const res = runGh(["issue", "comment", String(issue)].concat(repoArgs(repo)).concat(["--body-file", notePath]));
  return res.ok;
}

function main() {
  const opts = parseArgs(process.argv);
  requireGithub(process.cwd());

  let raw;
  try {
    raw = readFileSync(opts.bodyFile, "utf8");
  } catch (e) {
    fail(2, `读不到正文文件：${opts.bodyFile} —— ${e.message}`);
  }

  const normalized = normalizeForWrite(raw);
  const warnings = checkFormat(normalized.text);
  warnings.forEach((w) => console.error("告警：" + w));

  // 演练：不联网、不改任何东西，把「将要写什么、将要执行什么」摆出来给人看。
  if (opts.dryRun) {
    const previewCommand = ["gh", "issue", "edit", String(opts.issue)]
      .concat(repoArgs(opts.repo))
      .concat(["--body-file", "<临时文件，演练时未创建>"]);
    const changed = normalized.changes.map((c) => `#${opts.issue} 正文：${c}`);
    changed.push(`#${opts.issue} 正文：将按文件内容写回（演练未联网核对当前正文）`);
    console.error("演练：不会写任何东西。将执行的命令：");
    console.error("  " + previewCommand.join(" "));
    console.error("将要写入的正文：");
    console.error(normalized.text);
    console.log(JSON.stringify({
      changed: changed,
      edge: null,
      expected: null,
      actual: null,
      commented: false,
      ok: true,
      warnings: warnings,
      dryRun: true,
      body: normalized.text,
      command: previewCommand,
    }));
    process.exit(0);
  }

  const workDir = mkdtempSync(join(tmpdir(), "fix-issue-body-"));
  try {
    const current = readCurrentBody(opts.issue, opts.repo);
    if (!current.ok) {
      console.error(`读不到当前正文（${current.reason}），跳过「是否已经一致」的检查，直接写。`);
    }
    if (current.ok && current.body === normalized.text) {
      console.error(`#${opts.issue} 的正文已经和要写的内容一样，不再发请求。`);
      console.log(JSON.stringify({
        changed: [],
        edge: null,
        expected: null,
        actual: null,
        commented: false,
        ok: true,
        warnings: warnings,
        dryRun: false,
      }));
      process.exit(0);
    }

    const written = writeBody(opts.issue, opts.repo, normalized.text, workDir);
    if (!written.ok) {
      const commented = commentFailure(opts.issue, opts.repo, opts, written.reason, workDir);
      console.error(`写回 #${opts.issue} 正文失败：${written.reason}`);
      console.error(commented ? "已在该票下留一条失败评论。" : "失败评论也没留上（可能连评论权限都没有），请人工处理。");
      console.log(JSON.stringify({
        changed: [],
        edge: null,
        expected: null,
        actual: null,
        commented: commented,
        ok: false,
        warnings: warnings,
        dryRun: false,
        error: written.reason || "写回失败",
      }));
      process.exit(1);
    }

    const changed = normalized.changes.map((c) => `#${opts.issue} 正文：${c}`);
    changed.push(`#${opts.issue} 正文：已按文件内容写回`);
    console.error(`#${opts.issue} 正文已写回${written.retried ? "（重试一次后成功）" : ""}。`);
    console.log(JSON.stringify({
      changed: changed,
      edge: null,
      expected: null,
      actual: null,
      commented: false,
      ok: true,
      warnings: warnings,
      dryRun: false,
    }));
    process.exit(0);
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* 临时目录清不掉不影响结果 */ }
  }
}

main();
