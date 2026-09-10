#!/usr/bin/env node
/**
 * scripts/wire-subissues.mjs —— 「把子票挂到地图下、把阻塞声明升格成原生边」的可执行化身
 *
 * 出处：#572（任务：子议题关联脚本落地（含阻塞与校验））按定版契约 #576 落地。
 * 为什么要它：agent 在终端里手敲建边命令时，要先取数据库编号、再发建边请求、最后数一遍，
 *   三步里漏一步（最常见的是只写了地图正文的任务清单，忘了建原生边），面板按原生边统计就会
 *   显示错误的空计数（线上事故 #345 就是这样从 0 补到 6 的）。这个脚本把三步收成一条命令，
 *   提示词以后只写脚本名加参数。
 *
 * 用法：
 *   node scripts/wire-subissues.mjs --map 567 --children 568,569,572 --body-file ./.tmp-567-map-body.md
 *   node scripts/wire-subissues.mjs --map 567 --children 568,569,572 --body-file ./map.md --repo owner/name
 *   node scripts/wire-subissues.mjs --map 567 --children 568,569,572 --body-file ./map.md --dry-run
 *   node scripts/wire-subissues.mjs --help
 *
 * 参数：
 *   --map <号>           必传。地图票号（子议题挂到它下面，地图正文也写回它）。
 *   --children <号,号>   必传。子票号列表，逗号分隔；重复的自动去掉，结果按升序规范化。
 *   --body-file <路径>   必传。地图正文文件（文件里必须是真实换行）。脚本不替你编正文，只校正写法。
 *   --repo <owner/name>  可选。默认用当前目录所在仓库（跨仓库调用时才传）。
 *   --dry-run            可选。只演练：打印将要执行的命令与将要写入的正文，不联网、不写。
 *   --help               打印这段说明。
 *
 * 脚本做五件事：
 *   1. 把 --body-file 的内容按正规化写法写回地图（剥开头不可见字符、按阈值还原字面 \n 转义），写完读回比对。
 *   2. 把 --children 里还没挂在地图下的子票，用 gh 原生旗 --parent 挂成原生子议题。
 *   3. 读每张子票正文第一处有内容的行里的 `Blocked by: #n, #n` 声明，升格成原生阻塞边（原生旗优先）。
 *   4. 建完读回校验：本次要求的子票里实际挂上了几张，与 --children 去重后的张数比对，对不上就非零退出。
 *   5. 建边前先校验输入：地图不能是它自己的子票；每张子票必须存在；已经挂在别的地图下的子票直接拒绝。
 *
 * 为什么正文文件写的是地图：契约 #576 Implementation Decisions 把参数集写死为「地图号、子票号列表、
 *   正文文件与演练开关，仓库地址可选」。参数集里唯一的单票身份是地图号，而正文文件只有一份，
 *   装不下多张子票各自的正文，所以这一份只能属于地图。子票正文请用 scripts/fix-issue-body.mjs。
 *   这条判定只写在 writeMapBody() 一个函数里，日后若口径改成「写子票正文」，改那一处即可。
 *   为防止把子票正文覆盖到地图上，正文文件必须先通过 assertLooksLikeMapBody() 那道闸：\n *   剥掉围栏后第一处有内容的行必须是 ## Destination，并且正文里至少有一个 wayfinder 规范章节。
 *
 * 阻塞声明只认正文第一处有内容的行（与降级写回同一口径）：正文别处出现的 `Blocked by:` 只写进
 *   warnings 提醒，不据此建边——历史正文里常见「后来解除了」之类的注解，按全文扫描会建出错误的边。
 *
 * 幂等：先读当前状态（地图正文、现有子议题、每张子票的现有阻塞边与当前父），全部已是目标状态就直接返回
 *   changed: []、ok: true，一个请求都不发（读请求用于判等是允许的）。正文比对两侧都先做同一套归一化
 *   （CRLF 与 LF 视为相同、去尾部空白），避免服务端把 CRLF 归一成 LF 以后每遍都重写。
 * 失败处理：写操作失败自动重试一次；第二次成功会在人话里说明「重试一次后成功」；
 *   还失败就在对应的票下留一条固定格式评论（含脚本名、参数、失败原因），方便以后按脚本名搜失败现场。
 *   失败评论、stderr 与回包 error 里都不写本地绝对路径：--body-file 只写文件名。
 * 降级：只有原生阻塞边被明确判为不支持时，才在子票正文首部补写 `Blocked by: #n, #n` 文字行，
 *   这时 ok 仍为 true（这次调用按契约完成了），但 edge 为 false（原生边没建上）。
 * 不删已有的文字行：本脚本只读 `Blocked by:` 文字行、只补原生边，不清洗历史正文。
 *
 * 已知遗留（写在这里备查，不是本脚本承诺的能力）：
 *   - 跑到一半被 Ctrl+C 打断：会留下半成品（正文已写、边只挂了一部分），且不留失败评论；重跑会把差的补上。
 *   - 两个进程同时对同一张地图跑且传了不同正文：后写的覆盖先写的，先写那次的成功回包是假的；本脚本不做加锁。
 *   - 平台不支持原生阻塞边时，降级路径每次跑都会再试一次原生边（注定失败），所以那条路径上「零请求」不成立。
 *   - 裸接口返回 404/410 时按「接口不存在」处理并降级写文字行；若 404 其实是权限或票号写错，会多写一行正文。
 *
 * 回包：stdout 一行 JSON（stderr 是给人看的叙述）。字段：
 *   changed   这次实际改了什么（数组；已经是目标状态就是空数组）
 *   edge      本次要求建的原生边是否全部到位（子议题边 + 声明的阻塞边）；演练时是 null（没联网，不知道）
 *   expected  --children 去重后的张数
 *   actual    本次要求的子票里，实际已经挂在地图下的张数；演练时是 null
 *   commented 失败时有没有留下失败评论
 *   ok        总通过没（机器只看这个字段）
 *   warnings  提示（数组；只提示，不影响 ok）
 *   dryRun    是不是演练模式
 *   body      只有演练模式才有：将要写回的地图正文
 *   command   只有演练模式才有：将要执行的命令，每条一个数组（数组的数组）
 *   error     只有失败才有：失败原因
 *
 * 退出码：0 通过；1 操作失败（已重试一次，或数量/内容对不上）；2 参数、后端或输入状态不对，命令根本没执行。
 *
 * 回包形状与 scripts/fix-issue-body.mjs 对齐（同样的六个字段名加 warnings/dryRun/body/command/error）。
 * 区别只有一处：那个脚本不建边也不数数，所以 edge/expected/actual 恒为 null；本脚本里它们是实义值。
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_NAME = "scripts/wire-subissues.mjs";
const SIBLING_SCRIPT = "scripts/fix-issue-body.mjs";
const TRACKER_DOC = "docs/agents/issue-tracker.md";
const BOM = "\uFEFF";
const PAGE_SIZE = 100;

/**
 * 判定「平台明确不支持原生边」用的错误文本特征，口径与宿主 src/host/tracker/backends/github/graph.js:98-99、:259 一致。
 * 刻意不含 ghes：错误文本里出现 GHES 字样（例如「GHES 实例限流」）不代表这条接口不存在，
 * 把它当「不支持」会误降级、往子票正文里写文字行。
 */
const UNSUPPORTED_RE = /unsupported|not supported|sub_issues.*not|dependencies.*not/i;
/** 裸接口回退时，HTTP 404/410 也按「这条接口不存在」处理。 */
const GONE_RE = /(^|\D)(404|410)(\D|$)/;
/** 票不存在的错误文本特征（用来把「票号写错」与「网络/权限故障」分开）。 */
const NOT_FOUND_RE = /could not resolve|not found|404/i;

/** 读文件失败、参数缺失、后端不对时统一走这里：先给人话，再给一行机器可读的回包。 */
function fail(code, message, extra) {
  const clean = redactLocalPaths(message);
  console.error(clean);
  const out = Object.assign({
    changed: [],
    edge: null,
    expected: null,
    actual: null,
    commented: false,
    ok: false,
    warnings: [],
    dryRun: false,
    error: clean,
  }, extra || {});
  console.log(JSON.stringify(out));
  process.exit(code);
}

/** 取路径最后一段（不把本地绝对路径写进评论、stderr 或回包）。 */
function baseName(p) {
  const s = String(p == null ? "" : p);
  const parts = s.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

/** 把文本里的本地绝对路径换成文件名。评论与日志只留文件名，不记工作区原始路径。 */
function redactLocalPaths(text) {
  let s = String(text == null ? "" : text);
  s = s.replace(/[A-Za-z]:\\[^\s"'`|<>]*/g, (m) => baseName(m));
  s = s.replace(/\\\\[^\s"'`|<>]+/g, (m) => baseName(m));
  s = s.replace(/(^|[\s(`"'])\/(?:[^\s"'`|<>/]+\/)+[^\s"'`|<>]*/g, (m, p1) => p1 + baseName(m));
  return s;
}

/** Markdown 行内代码：内容里出现反引号时改用更长的定界符，免得把行内代码截断。 */
function codeSpan(text) {
  const s = String(text == null ? "" : text);
  const longest = (s.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0);
  const ticks = "`".repeat(longest + 1);
  const pad = /^\s|\s$/.test(s) ? " " : "";
  return ticks + pad + s + pad + ticks;
}

/** 正文比对前的归一化：剥 BOM、CRLF 与 CR 都当 LF、去掉尾部空白。两侧用同一把尺子。 */
function normalizeForCompare(text) {
  let s = String(text == null ? "" : text);
  if (s.startsWith(BOM)) s = s.slice(1);
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return s.replace(/\s+$/, "");
}

function sameBody(a, b) {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

function usage() {
  console.error(`用法：
  node ${SCRIPT_NAME} --map <号> --children <号,号> --body-file <路径> [--repo <owner/name>] [--dry-run]

  --map <号>           必传，地图票号（子议题挂到它下面，地图正文也写回它）
  --children <号,号>   必传，子票号列表，逗号分隔；重复的自动去掉并按升序规范化
  --body-file <路径>   必传，地图正文文件（文件里必须是真实换行）
  --repo <owner/name>  可选，默认当前目录所在仓库
  --dry-run            可选，只演练：打印将要执行的命令与将要写入的正文，不联网、不写
  --help               打印这段说明

例子：
  node ${SCRIPT_NAME} --map 567 --children 568,569,572 --body-file ./.tmp-567-map-body.md
  node ${SCRIPT_NAME} --map 567 --children 568,569,572 --body-file ./map.md --dry-run

脚本会：把正文文件写回地图并读回比对；把还没挂上的子票用 --parent 挂成原生子议题；
读每张子票正文第一处有内容的行里的 Blocked by: 声明并升格成原生阻塞边；最后读回校验张数，对不上非零退出。
已经全部到位时一个写请求都不发，可以重复跑。`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { usage(); process.exit(0); }
  const out = { map: null, childrenRaw: null, children: null, bodyFile: null, repo: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") { out.dryRun = true; continue; }
    if (a === "--map" || a === "--children" || a === "--body-file" || a === "--repo") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) fail(2, `参数 ${a} 后面没给值。`);
      i++;
      if (a === "--map") out.map = v.trim();
      else if (a === "--children") out.childrenRaw = v.trim();
      else if (a === "--body-file") out.bodyFile = v;
      else out.repo = v.trim();
      continue;
    }
    fail(2, `不认识的参数：${a}。用 --help 看用法。`);
  }
  if (!out.map) fail(2, "没给 --map。子议题要挂到哪张地图下面？用 --map <号> 传进来。");
  if (!/^\d+$/.test(out.map)) fail(2, `--map 只接受数字编号，收到的是「${out.map}」。`);
  if (Number(out.map) <= 0) fail(2, `--map 必须是大于 0 的票号，收到的是「${out.map}」。`);
  if (out.childrenRaw === null) fail(2, "没给 --children。要挂哪几张子票？用 --children 571,572 这样传（逗号分隔）。");
  if (out.childrenRaw === "") fail(2, "--children 里一个票号都没有。请把要挂的子票号列出来。");
  const parts = out.childrenRaw.split(",").map((s) => s.trim());
  if (parts.some((s) => !/^\d+$/.test(s))) fail(2, `--children 只接受逗号分隔的数字编号，收到的是「${out.childrenRaw}」。`);
  if (parts.some((s) => Number(s) <= 0)) fail(2, `--children 里的票号必须大于 0，收到的是「${out.childrenRaw}」。`);
  out.children = Array.from(new Set(parts.map(Number))).sort((a, b) => a - b);
  if (!out.children.length) fail(2, "--children 里一个票号都没有。请把要挂的子票号列出来。");
  if (out.children.indexOf(Number(out.map)) >= 0) {
    fail(2, `--children 里有 --map 自己（#${out.map}）。一张票不能当自己的子票，请把它从 --children 里去掉。`);
  }
  if (!out.bodyFile) fail(2, "没给 --body-file。正文必须放在文件里传进来（命令行内联正文会被外壳吃掉引号）。");
  if (out.repo && !/^[^/\s]+\/[^/\s]+$/.test(out.repo)) fail(2, `--repo 要写成 owner/name，收到的是「${out.repo}」。`);
  return out;
}

/**
 * 认后端：读工作区的主锚文件 docs/agents/issue-tracker.md，只认首批支持的 GitHub。
 * 判定口径与姊妹脚本 scripts/fix-issue-body.mjs:124-138 完全一致（也一致于宿主 src/host/tracker/detection/parseIssueTracker.js）。
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
  // 只报相对路径（TRACKER_DOC），不把工作区绝对路径写进回包与终端
  const head = `这个工作区用的不是首批支持的 GitHub（主锚文件：${TRACKER_DOC}）。`;
  if (det.backendId === "gitlab") {
    fail(2, `${head}它声明的是 GitLab；首批脚本只服务 GitHub，GitLab 待第二批。请按 GitLab 的方式改票，不要调本脚本。`);
  }
  if (det.backendId === "markdown") {
    fail(2, `${head}它声明的是本地 Markdown；本地 Markdown 的票就是仓库里的文件，请直接改文件存盘，不要调本脚本。`);
  }
  fail(2, `${head}认不出后端（文件${det.reason === "missing" ? "不存在" : "里没有后端标记"}）。GitHub 工作区请确认该文件首行写着「# Issue tracker: GitHub」；本地 Markdown 工作区请直接改票文件存盘；GitLab 待第二批。`);
}

/**
 * 校正正文写法。返回 { text, changes }。
 * 阈值与 src/shared/parser.js 的 normalizeBody 一致，与姊妹脚本 scripts/fix-issue-body.mjs:158-172 同一套：
 * 剥掉开头的第一个不可见字符；真实换行少于 2 处且字面 \n 转义至少 1 处时，把转义还原成真实换行；否则原样保留。
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
  return { text: s, changes: changes };
}

/** 取正文里第一处有内容的行（跳过开头的空行）。 */
function firstMeaningfulLine(body) {
  const lines = String(body == null ? "" : body).split(/\r?\n/);
  for (const l of lines) {
    if (l.trim() !== "") return l;
  }
  return "";
}

/** 剥掉围栏代码块（``` 或 ~~~ 包起来的部分）里的内容，围栏行本身也去掉。 */
function stripFencedBlocks(text) {
  const out = [];
  let fence = null;
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const fm = line.match(/^\s*(`{3,}|~{3,})/);
    if (fm) {
      const marker = fm[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence === null) out.push(line);
  }
  return out.join("\n");
}

/** wayfinder 地图的规范章节（中英并存时只认这几个英文标题）。 */
const MAP_SECTION_RE = /^##\s*(Notes|Decisions so far|Not yet specified|Out of scope)\s*$/m;

/**
 * 保护：正文文件看起来不是地图正文时拒绝执行（退出码 2，不写任何东西）。
 * 两条判定（都先剥掉围栏代码块，围栏里的引用不算）：
 *   1. 第一处有内容的行恰是 `## Destination`；
 *   2. 正文里至少出现一个 wayfinder 规范章节（## Notes / ## Decisions so far / ## Not yet specified / ## Out of scope）。
 * 为什么要这么严：本脚本会把这份正文整篇写回 --map 那张票，一旦放行子票正文，地图正文就被覆盖，
 *   而地图正文是 Decisions 索引与计划的唯一载体（src/shared/parser.js 的 parseMapBody 直接解析它）。
 *   只判「第一行是 ## Destination」还不够：子票正文首行恰好也写 `## Destination` 时会被放行
 *   （对抗式审查实测过），而子票正文几乎不可能同时具备规范章节。
 *   实测口径：仓库现存 52 张地图里，通过第 1 条的 34 张全部也通过第 2 条，所以这道闸对真地图零误拒。
 */
function assertLooksLikeMapBody(text) {
  const stripped = stripFencedBlocks(text);
  const first = firstMeaningfulLine(stripped);
  if (!/^##\s*Destination\s*$/.test(first)) {
    fail(2, `--body-file 的第一处有内容的行不是「## Destination」，看起来不是地图正文（实际读到的是「${first.slice(0, 40)}」）。本脚本只写地图正文，子票正文请用 ${SIBLING_SCRIPT}。`);
  }
  if (!MAP_SECTION_RE.test(stripped)) {
    fail(2, `--body-file 里没有 wayfinder 地图的规范章节（## Notes / ## Decisions so far / ## Not yet specified / ## Out of scope 至少要有其中一个），看起来不是地图正文。本脚本只写地图正文，子票正文请用 ${SIBLING_SCRIPT}。`);
  }
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

/** 写操作失败按契约自动重试一次；第二次成功会如实标出来。 */
function runGhRetry(argv) {
  let res = runGh(argv);
  if (res.ok) return { ok: true, retried: false, reason: "", stderr: "" };
  console.error(`命令失败，按契约自动重试一次：gh ${argv.map((a) => redactLocalPaths(a)).join(" ")} —— ${shortReason(res.stderr)}`);
  res = runGh(argv);
  if (res.ok) return { ok: true, retried: true, reason: "", stderr: "" };
  return { ok: false, retried: true, reason: shortReason(res.stderr), stderr: res.stderr };
}

/** 失败原因取一行：太长只留前一段并标注已截断；顺手把本地绝对路径收敛成文件名。 */
function shortReason(text) {
  const first = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";
  const cut = first.length > 200 ? first.slice(0, 200) + "…（已截断）" : first;
  return redactLocalPaths(cut);
}

function repoArgs(repo) {
  return repo ? ["--repo", repo] : [];
}

/** gh api 路径里的仓库段：给了 --repo 就用它，没给就交给 gh 按当前目录展开 {owner}/{repo}。 */
function repoSlug(repo) {
  return repo ? repo : "{owner}/{repo}";
}

/** 读一张票的正文（地图正文、降级时读子票正文都用它）。 */
function readIssueBody(issue, repo) {
  const res = runGh(["issue", "view", String(issue)].concat(repoArgs(repo)).concat(["--json", "body"]));
  if (!res.ok) return { ok: false, reason: shortReason(res.stderr), stderr: res.stderr };
  try {
    const parsed = JSON.parse(res.stdout.replace(/^\uFEFF/, ""));
    return { ok: true, body: typeof parsed.body === "string" ? parsed.body : "" };
  } catch (e) {
    return { ok: false, reason: "读回的正文不是 JSON：" + e.message, stderr: "" };
  }
}

/**
 * 读一张子票的正文与当前父（一次请求拿两样）。
 * parentNumber 为 null 表示还没有父；不等于 --map 时说明它已经挂在别的地图下，本脚本拒绝改挂。
 */
function readChildSnapshot(child, repo) {
  const res = runGh(["issue", "view", String(child)].concat(repoArgs(repo)).concat(["--json", "body,parent"]));
  if (!res.ok) return { ok: false, reason: shortReason(res.stderr), stderr: res.stderr };
  let parsed;
  try {
    parsed = JSON.parse(res.stdout.replace(/^\uFEFF/, ""));
  } catch (e) {
    return { ok: false, reason: "读回的票信息不是 JSON：" + e.message, stderr: "" };
  }
  const pRaw = parsed && parsed.parent && parsed.parent.number;
  const pn = pRaw === undefined || pRaw === null ? null : Number(pRaw);
  return {
    ok: true,
    body: typeof parsed.body === "string" ? parsed.body : "",
    parentNumber: pn !== null && Number.isFinite(pn) ? pn : null,
  };
}

/**
 * 读地图现有的全部原生子议题号（REST 列表端点，与宿主 src/host/issueList.js:260、issueDetail.js:91 同一路数据）。
 * 一律带 --paginate 翻页：子议题超过一页（默认 30、本脚本显式 100）时，不翻页会把「已经挂满」误判成数量对不上。
 */
function readSubIssueNumbers(map, repo) {
  const res = runGh(["api", `repos/${repoSlug(repo)}/issues/${map}/sub_issues?per_page=${PAGE_SIZE}`, "--paginate", "--jq", ".[].number"]);
  if (!res.ok) return { ok: false, reason: shortReason(res.stderr), warnings: [] };
  const numbers = String(res.stdout)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return { ok: true, numbers: numbers, total: numbers.length, warnings: [] };
}

/** 读某张票现有的原生阻塞边（gh issue view --json blockedBy；gh 2.97.0 返回 {nodes:[...],totalCount}）。 */
function readBlockedByNumbers(issue, repo) {
  const res = runGh(["issue", "view", String(issue)].concat(repoArgs(repo)).concat(["--json", "blockedBy"]));
  if (!res.ok) return { ok: false, reason: shortReason(res.stderr) };
  let parsed;
  try {
    parsed = JSON.parse(res.stdout.replace(/^\uFEFF/, ""));
  } catch (e) {
    return { ok: false, reason: "现有阻塞边不是 JSON：" + e.message };
  }
  const raw = parsed && parsed.blockedBy;
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.nodes) ? raw.nodes : []);
  const numbers = list.map((x) => Number(x && x.number)).filter((n) => Number.isFinite(n));
  return { ok: true, numbers: numbers };
}

/** 取某张票的数据库编号（不是 # 后面的显示编号）——裸接口回退时要用它。 */
function readIssueDbId(issue, repo) {
  const res = runGh(["api", `repos/${repoSlug(repo)}/issues/${issue}`, "--jq", ".id"]);
  if (!res.ok) return { ok: false, reason: shortReason(res.stderr) };
  const id = Number(String(res.stdout).trim());
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: `#${issue} 的数据库编号不是数字：${shortReason(res.stdout)}` };
  return { ok: true, id: id };
}

/** 从一行声明里取票号。 */
function numbersIn(decl) {
  return Array.from(new Set(String(decl).split(",").map((s) => Number(s.trim().replace(/^#/, ""))).filter((n) => Number.isFinite(n) && n > 0)));
}

/**
 * 正文第一处有内容的行里的阻塞声明：`Blocked by: #n, #n`。
 * 这是仓库唯一的文字声明位置约定：docs/agents/issue-tracker.md:50「fall back to a
 * `Blocked by: #<n>, #<n>` line at the top of the child body」。
 */
function headBlockers(body) {
  const m = firstMeaningfulLine(body).match(/^\s*Blocked by:\s*(#\d+(?:\s*,\s*#\d+)*)\s*$/);
  return m ? numbersIn(m[1]) : [];
}

/** 全文扫描阻塞声明（含正文别处的），只用来告警：正文别处的声明不建边。 */
function allBlockers(body) {
  const out = [];
  const re = /^\s*Blocked by:\s*(#\d+(?:\s*,\s*#\d+)*)/gm;
  let m;
  while ((m = re.exec(String(body == null ? "" : body))) !== null) {
    for (const n of numbersIn(m[1])) if (out.indexOf(n) < 0) out.push(n);
  }
  return out;
}

/**
 * 把 --body-file 的正文写回地图（--map 指向的那张票）。
 * 契约出处：#576 Implementation Decisions「关联脚本的参数为地图号、子票号列表、正文文件与演练开关，
 *   仓库地址可选。正文文件必传，不传直接报错。」——参数集里唯一的单票身份是地图号，正文文件只有一份，
 *   所以这份正文属于地图（详细论证见本文件头注释）。改口径时只改这里。
 */
function writeMapBody(map, repo, text, workDir) {
  const bodyPath = join(workDir, "map-body.md");
  writeFileSync(bodyPath, text, "utf8");
  const argv = ["issue", "edit", String(map)].concat(repoArgs(repo)).concat(["--body-file", bodyPath]);
  return runGhRetry(argv);
}

/**
 * 建子议题边：gh 原生旗 --parent 优先；只有该旗明确不可用（老版本或报错）才回退裸接口。
 * 裸接口必须用 -F（类型化传整数），用 -f/--raw-field 传 sub_issue_id 会被 GitHub 拒掉。
 */
function wireSubIssue(child, map, repo) {
  const flag = runGhRetry(["issue", "edit", String(child)].concat(repoArgs(repo)).concat(["--parent", String(map)]));
  if (flag.ok) return { ok: true, retried: flag.retried, how: "flag" };
  console.error(`#${child} 的 --parent 旗不可用（${flag.reason}），回退裸接口建边。`);
  const dbId = readIssueDbId(child, repo);
  if (!dbId.ok) return { ok: false, retried: flag.retried, reason: dbId.reason, stderr: flag.stderr };
  const api = runGhRetry(["api", `repos/${repoSlug(repo)}/issues/${map}/sub_issues`, "--method", "POST", "-F", `sub_issue_id=${dbId.id}`]);
  if (api.ok) return { ok: true, retried: api.retried, how: "api" };
  return { ok: false, retried: api.retried, reason: `--parent 旗：${flag.reason}；裸接口：${api.reason}`, stderr: flag.stderr + "\n" + api.stderr };
}

/**
 * 建原生阻塞边：gh 原生旗 --add-blocked-by 优先；旗不可用才回退裸接口（-F issue_id=<数据库编号>）。
 * 返回里额外带 unsupported：只有错误文本明确说「不支持」时才允许降级成文字行，网络/限流/权限一律当失败。
 */
function addBlockedBy(child, blocker, repo) {
  const flag = runGhRetry(["issue", "edit", String(child)].concat(repoArgs(repo)).concat(["--add-blocked-by", String(blocker)]));
  if (flag.ok) return { ok: true, retried: flag.retried, how: "flag", unsupported: false };
  console.error(`#${child} 的 --add-blocked-by 旗不可用（${flag.reason}），回退裸接口建边。`);
  const dbId = readIssueDbId(blocker, repo);
  if (!dbId.ok) {
    return { ok: false, retried: flag.retried, reason: dbId.reason, unsupported: UNSUPPORTED_RE.test(flag.stderr) };
  }
  const api = runGhRetry(["api", `repos/${repoSlug(repo)}/issues/${child}/dependencies/blocked_by`, "--method", "POST", "-F", `issue_id=${dbId.id}`]);
  if (api.ok) return { ok: true, retried: api.retried, how: "api", unsupported: false };
  const unsupported = UNSUPPORTED_RE.test(flag.stderr) || UNSUPPORTED_RE.test(api.stderr) || GONE_RE.test(api.stderr);
  return { ok: false, retried: api.retried, reason: `--add-blocked-by 旗：${flag.reason}；裸接口：${api.reason}`, unsupported: unsupported };
}

/**
 * 降级：原生阻塞边明确不支持时，把声明补写到子票正文首部（走 --body-file 文件参数）。
 * 「首部」按 docs/agents/issue-tracker.md:50 的约定判定：正文第一处有内容的行就是这条声明。
 * 首部已经有这条声明（覆盖了要写的票号）就不写；不在首部才补写一行，已有的文字行不删。
 */
function writeFallbackTextLine(child, blockers, repo, workDir) {
  const line = `Blocked by: ${blockers.map((b) => "#" + b).join(", ")}`;
  const cur = readIssueBody(child, repo);
  if (!cur.ok) return { ok: false, reason: "读不到 #" + child + " 的正文：" + cur.reason };
  const headDeclared = headBlockers(cur.body);
  if (blockers.every((b) => headDeclared.indexOf(b) >= 0)) return { ok: true, wrote: false, line: line };
  const bodyPath = join(workDir, `child-${child}-body.md`);
  writeFileSync(bodyPath, line + "\n" + cur.body, "utf8");
  const argv = ["issue", "edit", String(child)].concat(repoArgs(repo)).concat(["--body-file", bodyPath]);
  const res = runGhRetry(argv);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, wrote: true, line: line, retried: res.retried };
}

/**
 * 失败留痕：在对应票下留一条固定格式评论，含脚本名、参数、失败原因与影响，方便按脚本名搜出所有失败现场。
 * 评论是公开可搜的，所以参数里只写 --body-file 的文件名，不写本地绝对路径。
 */
function commentFailure(issue, repo, opts, reason, impact, workDir) {
  const params = `--map ${opts.map} --children ${opts.children.join(",")} --body-file ${baseName(opts.bodyFile)}`;
  const lines = [
    `<!-- 失败留痕：${SCRIPT_NAME} -->`,
    `**${SCRIPT_NAME} 子议题关联失败**`,
    "",
    `- 脚本：${codeSpan(SCRIPT_NAME)}`,
    `- 参数：${codeSpan(params)}${opts.repo ? "（--repo " + codeSpan(opts.repo) + "）" : ""}`,
    `- 失败原因：${redactLocalPaths(reason || "没有拿到报错文本")}`,
    `- 影响：${redactLocalPaths(impact)}`,
    "",
    "这条评论由脚本自动留下，用来以后按脚本名搜出失败现场。已经建好的边不会被撤销。",
  ];
  const notePath = join(workDir, `failure-comment-${issue}.md`);
  writeFileSync(notePath, lines.join("\n") + "\n", "utf8");
  const res = runGh(["issue", "comment", String(issue)].concat(repoArgs(repo)).concat(["--body-file", notePath]));
  return res.ok;
}

/** 演练模式的计划：不联网，所以只按输入算出「将要做哪些事」。 */
function buildPlan(opts) {
  const changed = [];
  const command = [];
  changed.push(`#${opts.map} 正文：将按文件内容写回（演练不联网，未核对当前正文）`);
  command.push(["gh", "issue", "edit", String(opts.map)].concat(repoArgs(opts.repo)).concat(["--body-file", "<临时文件，演练时未创建>"]));
  for (const c of opts.children) {
    changed.push(`#${c} 将挂到 #${opts.map} 下（演练不联网，未核对是否已挂）`);
    command.push(["gh", "issue", "edit", String(c)].concat(repoArgs(opts.repo)).concat(["--parent", String(opts.map)]));
  }
  return { changed: changed, command: command };
}

/**
 * 收尾：把最终回包与退出码交回给最外层。
 * 这里刻意不在中途 process.exit——中途退出会跳过清理临时目录的 finally，
 * 临时目录会在系统临时目录里越积越多。
 */
function uniqWarnings(list) { return Array.from(new Set(list)); }

function done(code, payload) {
  return { code: code, payload: payload };
}

function main() {
  const opts = parseArgs(process.argv);
  requireGithub(process.cwd());

  let raw;
  try {
    raw = readFileSync(opts.bodyFile, "utf8");
  } catch (e) {
    fail(2, `读不到正文文件：${baseName(opts.bodyFile)}（${e.code || "读文件失败"}）。请检查这个文件是否存在、路径是否写对。`);
  }

  const normalized = normalizeForWrite(raw);
  assertLooksLikeMapBody(normalized.text);

  const expected = opts.children.length;

  // 演练：不联网、不改任何东西，把「将要写什么、将要执行什么」摆出来给人看。
  if (opts.dryRun) {
    const plan = buildPlan(opts);
    const warnings = [
      "演练模式：不联网，没读线上状态，所以 edge 与 actual 是 null，数量校验留到真跑。",
      "演练模式读不到子票正文，所以列不出「将要建哪几条原生阻塞边」；阻塞边来自子票正文，读它就要联网。",
    ];
    console.error("演练：不会联网、不会写任何东西。将执行的命令：");
    plan.command.forEach((c) => console.error("  " + c.join(" ")));
    console.error("将要写回地图的正文：");
    console.error(normalized.text);
    return done(0, {
      changed: plan.changed,
      edge: null,
      expected: expected,
      actual: null,
      commented: false,
      ok: true,
      warnings: uniqWarnings(warnings),
      dryRun: true,
      body: normalized.text,
      command: plan.command,
    });
  }

  const workDir = mkdtempSync(join(tmpdir(), "wire-subissues-"));
  try {
    const warnings = [];
    const changed = [];

    // ——— 1. 先读当前状态（读请求用来判等是允许的；写之前必须知道差集在哪） ———
    const mapBodyNow = readIssueBody(opts.map, opts.repo);
    if (!mapBodyNow.ok) {
      const commented = commentFailure(opts.map, opts.repo, opts, mapBodyNow.reason, `读不到地图 #${opts.map} 的当前正文，本次什么都没改。`, workDir);
      const msg = `读不到地图 #${opts.map} 的当前正文：${mapBodyNow.reason}`;
      console.error(msg);
      return done(1, { changed: [], edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
    }
    const subsNow = readSubIssueNumbers(opts.map, opts.repo);
    if (!subsNow.ok) {
      const commented = commentFailure(opts.map, opts.repo, opts, subsNow.reason, `读不到地图 #${opts.map} 的子议题列表，本次什么都没改。`, workDir);
      const msg = `读不到地图 #${opts.map} 的子议题列表：${subsNow.reason}`;
      console.error(msg);
      return done(1, { changed: [], edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
    }
    warnings.push.apply(warnings, subsNow.warnings);

    // ——— 2. 读每张子票的正文与当前父（顺带校验它存在、没挂在别处） ———
    const perChild = {};
    for (const c of opts.children) {
      const snap = readChildSnapshot(c, opts.repo);
      if (!snap.ok) {
        const msg = `读不到子票 #${c}：${snap.reason}`;
        if (NOT_FOUND_RE.test(snap.stderr || "")) {
          // 票号写错/票不存在：属于输入不对，命令根本没执行，也不留评论（评论也发不到那张票上）
          fail(2, `${msg}。请确认票号写对了、而且这个票在当前仓库里存在。`);
        }
        const commented = commentFailure(opts.map, opts.repo, opts, snap.reason, `读不到子票 #${c}，本次什么都没改。`, workDir);
        console.error(msg);
        return done(1, { changed: [], edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
      }
      if (snap.parentNumber !== null && snap.parentNumber !== Number(opts.map)) {
        // 已挂在别的地图下：拒绝改挂（改挂要显式做，本脚本不做）
        fail(2, `子票 #${c} 已经挂在 #${snap.parentNumber} 下面了，本脚本不会替它改挂。要改挂请先显式解除它现在的父关系，再把它加进 --children。`);
      }
      const edgeRes = readBlockedByNumbers(c, opts.repo);
      if (!edgeRes.ok) {
        const commented = commentFailure(c, opts.repo, opts, edgeRes.reason, `读不到子票 #${c} 的现有阻塞边，本次什么都没改。`, workDir);
        const msg = `读不到子票 #${c} 的现有阻塞边：${edgeRes.reason}`;
        console.error(msg);
        return done(1, { changed: [], edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
      }
      const declared = headBlockers(snap.body);
      const elsewhere = allBlockers(snap.body).filter((b) => declared.indexOf(b) < 0);
      if (elsewhere.length) {
        warnings.push(`子票 #${c} 的正文里，除了第一处有内容的行以外还有 Blocked by: 声明（${elsewhere.map((b) => "#" + b).join("、")}）；本脚本只认第一处，没有据此建边。`);
      }
      perChild[c] = { body: snap.body, parentNumber: snap.parentNumber, blockedBy: edgeRes.numbers, declared: declared };
    }

    // ——— 3. 算差集 ———
    const needBodyWrite = !sameBody(mapBodyNow.body, normalized.text);
    const missingSubs = opts.children.filter((c) => subsNow.numbers.indexOf(c) < 0);
    const missingEdges = [];
    for (const c of opts.children) {
      for (const b of perChild[c].declared) {
        if (perChild[c].blockedBy.indexOf(b) < 0) missingEdges.push({ child: c, blocker: b });
      }
    }

    const totalNow = subsNow.numbers.length;
    if (totalNow !== expected) {
      warnings.push(`地图 #${opts.map} 上的原生子议题总数为 ${totalNow} 张，本次只校验 --children 列出的 ${expected} 张。`);
    }

    // ——— 4. 已经是目标状态：一个写请求都不发（连校验用的重复读也不发） ———
    if (!needBodyWrite && missingSubs.length === 0 && missingEdges.length === 0) {
      console.error(`#${opts.map} 正文已一致、${expected} 张子票都已挂上、声明的阻塞边都在位，不再发任何请求。`);
      return done(0, {
        changed: [],
        edge: true,
        expected: expected,
        actual: expected,
        commented: false,
        ok: true,
        warnings: uniqWarnings(warnings),
        dryRun: false,
      });
    }

    // ——— 5. 写地图正文（只在内容确实不同时写），写完读回比对 ———
    if (needBodyWrite) {
      const w = writeMapBody(opts.map, opts.repo, normalized.text, workDir);
      if (!w.ok) {
        const commented = commentFailure(opts.map, opts.repo, opts, w.reason, `地图 #${opts.map} 的正文没写回（已重试一次）。`, workDir);
        const msg = `写回 #${opts.map} 正文失败：${w.reason}`;
        console.error(msg);
        return done(1, { changed: changed, edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
      }
      if (w.retried) console.error(`#${opts.map} 正文写回重试一次后成功。`);
      // 读回校验：写请求返回成功不等于内容真的落盘（对抗式审查实测过服务端静默不落盘的情况）
      const readBack = readIssueBody(opts.map, opts.repo);
      if (!readBack.ok) {
        const commented = commentFailure(opts.map, opts.repo, opts, readBack.reason, `地图 #${opts.map} 的正文写完后读不回来，没法确认是否写对。`, workDir);
        const msg = `地图 #${opts.map} 的正文写完后读不回来：${readBack.reason}`;
        console.error(msg);
        return done(1, { changed: changed, edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
      }
      if (!sameBody(readBack.body, normalized.text)) {
        const msg = `地图 #${opts.map} 的正文写回后读回来不一样：写请求返回成功，但服务端内容不是文件里的内容（可能被拒或没落盘）。`;
        const commented = commentFailure(opts.map, opts.repo, opts, msg, `地图 #${opts.map} 的正文没写对（已重试一次），票上现在的正文与文件不一致。`, workDir);
        console.error(msg);
        return done(1, { changed: changed, edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
      }
      changed.push(`#${opts.map} 正文：按文件内容写回`);
    }

    // ——— 6. 补子议题边（只补缺的） ———
    for (const c of missingSubs) {
      const r = wireSubIssue(c, opts.map, opts.repo);
      if (!r.ok) {
        const commented = commentFailure(c, opts.repo, opts, r.reason, `子票 #${c} 没挂到地图 #${opts.map} 下（已重试一次）。`, workDir);
        const msg = `把 #${c} 挂到 #${opts.map} 下失败：${r.reason}`;
        console.error(msg);
        return done(1, { changed: changed, edge: false, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
      }
      if (r.retried) console.error(`#${c} 挂到 #${opts.map} 下：重试一次后成功。`);
      changed.push(`#${c} 已挂到 #${opts.map} 下`);
    }

    // ——— 7. 补原生阻塞边（只补缺的；明确不支持才降级成文字行） ———
    const degraded = [];
    for (const item of missingEdges) {
      const r = addBlockedBy(item.child, item.blocker, opts.repo);
      if (r.ok) {
        if (r.retried) console.error(`#${item.child} 新增原生阻塞边 #${item.blocker}：重试一次后成功。`);
        changed.push(`#${item.child} 新增原生阻塞边：#${item.blocker}`);
        continue;
      }
      if (!r.unsupported) {
        const commented = commentFailure(item.child, opts.repo, opts, r.reason, `子票 #${item.child} 的阻塞边 #${item.blocker} 没建上（已重试一次）。`, workDir);
        const msg = `给 #${item.child} 建阻塞边 #${item.blocker} 失败：${r.reason}`;
        console.error(msg);
        return done(1, { changed: changed, edge: false, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
      }
      // 明确不支持：降级成子票正文首部的文字行
      console.error(`#${item.child} 的原生阻塞边被判定为不支持，按契约降级成正文文字行。`);
      if (degraded.indexOf(item.child) < 0) degraded.push(item.child);
    }

    if (degraded.length) {
      for (const c of degraded) {
        const blockers = perChild[c].declared.filter((b) => missingEdges.some((m) => m.child === c && m.blocker === b));
        const w = writeFallbackTextLine(c, blockers.length ? blockers : perChild[c].declared, opts.repo, workDir);
        if (!w.ok) {
          const commented = commentFailure(c, opts.repo, opts, w.reason, `子票 #${c} 的降级文字行没写进去（已重试一次）。`, workDir);
          const msg = `给 #${c} 写降级文字行失败：${w.reason}`;
          console.error(msg);
          return done(1, { changed: changed, edge: false, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
        }
        changed.push(w.wrote ? `#${c} 已降级为文字行：${w.line}` : `#${c} 已降级为文字行（文字行本就在正文首部，未再写）：${w.line}`);
      }
      warnings.push(`本仓库不支持原生阻塞边，已按契约把声明的阻塞关系写成子票正文首部的文字行（${degraded.map((c) => "#" + c).join("、")}）。`);
    }

    // ——— 8. 读回校验 ———
    const subsAfter = readSubIssueNumbers(opts.map, opts.repo);
    if (!subsAfter.ok) {
      const commented = commentFailure(opts.map, opts.repo, opts, subsAfter.reason, `写完了但读不回子议题列表，数量没校验成。`, workDir);
      const msg = `读回子议题列表失败：${subsAfter.reason}`;
      console.error(msg);
      return done(1, { changed: changed, edge: null, expected: expected, actual: null, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: msg });
    }
    const actual = opts.children.filter((c) => subsAfter.numbers.indexOf(c) >= 0).length;
    const totalAfter = subsAfter.numbers.length;
    if (totalAfter !== expected) {
      warnings.push(`地图 #${opts.map} 上的原生子议题总数为 ${totalAfter} 张，本次只校验 --children 列出的 ${expected} 张。`);
    }

    let edgesAllIn = true;
    for (const c of opts.children) {
      if (!perChild[c].declared.length) continue;
      const e = readBlockedByNumbers(c, opts.repo);
      if (!e.ok) { edgesAllIn = false; warnings.push(`校验时读不到子票 #${c} 的阻塞边：${e.reason}`); continue; }
      for (const b of perChild[c].declared) {
        if (e.numbers.indexOf(b) < 0) edgesAllIn = false;
      }
    }
    if (degraded.length) edgesAllIn = false;

    if (actual !== expected) {
      const missing = opts.children.filter((c) => subsAfter.numbers.indexOf(c) < 0);
      const target = missing.length ? missing[0] : opts.map;
      const reason = `数量对不上：预期 ${expected} 张子票挂在地图 #${opts.map} 下，实际只挂上 ${actual} 张（缺 ${missing.map((c) => "#" + c).join("、") || "未定位到具体子票"}）。`;
      const commented = commentFailure(target, opts.repo, opts, reason, `数量校验没过，缺的子票是 ${missing.map((c) => "#" + c).join("、") || "未定位到"}。`, workDir);
      console.error(reason);
      return done(1, { changed: changed, edge: false, expected: expected, actual: actual, commented: commented, ok: false, warnings: uniqWarnings(warnings), dryRun: false, error: reason });
    }

    console.error(`#${opts.map}：预期 ${expected} 张，实际挂上 ${actual} 张，原生边${edgesAllIn ? "全部到位" : "没全到位"}。`);
    return done(0, {
      changed: changed,
      edge: edgesAllIn,
      expected: expected,
      actual: actual,
      commented: false,
      ok: true,
      warnings: uniqWarnings(warnings),
      dryRun: false,
    });
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* 临时目录清不掉不影响结果 */ }
  }
}

const result = main();
console.log(JSON.stringify(result.payload));
process.exit(result.code);
