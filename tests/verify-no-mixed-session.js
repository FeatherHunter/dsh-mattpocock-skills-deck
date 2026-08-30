#!/usr/bin/env node
/**
 * verify-no-mixed-session.js — 会话越界门禁（#326 承接 #313 D4）
 *
 * 判定对象：PR 的全量改动清单（base...head），非单次提交。
 * 房间口径：仅 src/host/tracker/backends/<name>/** 属于房间文件；
 *           tests/ 与契约测试夹具不归属任何房间。
 * 无对比基准（如 push 到主分支）时跳过，不报失败。
 * 失败时输出混入的房内文件清单。
 *
 * 用法：node tests/verify-no-mixed-session.js
 * CI 需保证 checkout 的 fetch-depth: 0 或能读取 GITHUB_EVENT_PATH 中的 base sha。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const child_process = require("child_process");
const execSync = child_process.execSync;

const root = path.resolve(__dirname, "..");
const BACKENDS = ["github", "gitlab", "markdown"];
const BACKEND_ROOT_POSIX = "src/host/tracker/backends";

let failed = false;
function ok(msg) { console.log("  PASS " + msg); }
function bad(msg) { failed = true; console.log("  FAIL " + msg); }
function skip(msg) { console.log("  SKIP " + msg); }

function getRoom(filePath) {
  const posix = filePath.replace(/\\/g, "/");
  const prefix = BACKEND_ROOT_POSIX + "/";
  if (!posix.startsWith(prefix)) return null;
  const rest = posix.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const name = rest.slice(0, slash);
  if (BACKENDS.includes(name)) return name;
  return null;
}

function detectMixedSession(changedFiles) {
  const rooms = new Set();
  const filesByRoom = {};
  for (const f of changedFiles) {
    const room = getRoom(f);
    if (!room) continue;
    rooms.add(room);
    if (!filesByRoom[room]) filesByRoom[room] = [];
    filesByRoom[room].push(f);
  }
  const roomList = Array.from(rooms);
  return { ok: roomList.length <= 1, rooms: roomList, filesByRoom: filesByRoom };
}

console.log("== verify-no-mixed-session：会话越界门禁（#326） ==");

// ---- 自检：纯函数 + 临时 git 仓库 ----
let selfFailed = false;
function selfCheck(cond, msg, detail) {
  if (cond) console.log("  PASS " + msg);
  else { selfFailed = true; failed = true; console.log("  FAIL " + msg + (detail ? " - " + detail : "")); }
}

{
  // 纯函数：单房
  const r1 = detectMixedSession(["src/host/tracker/backends/github/a.js"]);
  selfCheck(r1.ok && r1.rooms.length === 1 && r1.rooms[0] === "github", "纯函数单房通过");
}
{
  // 纯函数：双房
  const r2 = detectMixedSession(["src/host/tracker/backends/github/a.js", "src/host/tracker/backends/gitlab/b.js"]);
  selfCheck(!r2.ok && r2.rooms.length === 2, "纯函数双房应失败");
}
{
  // 纯函数：仅公共文件
  const r3 = detectMixedSession(["src/shared/tracker/constants.js", "src/host/tracker/preflight.js"]);
  selfCheck(r3.ok && r3.rooms.length === 0, "纯函数仅公共文件不触发");
}
{
  // 纯函数：tests 不归属
  const r4 = detectMixedSession(["tests/verify-no-cross-import.js", "src/host/tracker/backends/markdown/a.js"]);
  selfCheck(r4.ok && r4.rooms.length === 1, "纯函数 tests 不计入房间");
}
{
  // 纯函数：三房
  const r5 = detectMixedSession([
    "src/host/tracker/backends/github/a.js",
    "src/host/tracker/backends/gitlab/b.js",
    "src/host/tracker/backends/markdown/c.js"
  ]);
  selfCheck(!r5.ok && r5.rooms.length === 3, "纯函数三房应失败");
}

// 临时 git 仓库自检
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-mixed-"));
  try {
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email \"test@test\"", { cwd: tmp });
    execSync("git config user.name \"test\"", { cwd: tmp });
    fs.mkdirSync(path.join(tmp, "src/host/tracker/backends/github"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "src/host/tracker/backends/gitlab"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "README.md"), "# test\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m init", { cwd: tmp });
    const base = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();

    // 单房提交：只改 github
    fs.writeFileSync(path.join(tmp, "src/host/tracker/backends/github/a.js"), "console.log(1)\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m \"github only\"", { cwd: tmp });
    const head1 = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    const diff1 = execSync("git diff --name-only " + base + ".." + head1, { cwd: tmp, encoding: "utf8" }).split("\n").map(s=>s.trim()).filter(Boolean);
    const res1 = detectMixedSession(diff1);
    selfCheck(res1.ok, "临时仓库单房提交通过", JSON.stringify(diff1));

    // 双房提交：再改 gitlab
    fs.writeFileSync(path.join(tmp, "src/host/tracker/backends/gitlab/b.js"), "console.log(2)\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m \"gitlab\"", { cwd: tmp });
    const head2 = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    const diff2 = execSync("git diff --name-only " + base + ".." + head2, { cwd: tmp, encoding: "utf8" }).split("\n").map(s=>s.trim()).filter(Boolean);
    const res2 = detectMixedSession(diff2);
    selfCheck(!res2.ok && res2.rooms.length === 2, "临时仓库双房提交应失败", JSON.stringify(diff2));

    // 无基准：模拟无 base 时应跳过（此处直接测试 detectMixedSession 对空数组）
    const res3 = detectMixedSession([]);
    selfCheck(res3.ok, "临时仓库空改动应通过");

  } catch (e) {
    selfCheck(false, "临时仓库自检异常", String(e && e.message || e));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

if (selfFailed) {
  console.log("\n自检失败 - 门禁实现未通过");
  process.exit(1);
}
console.log("  PASS 自检全部通过");

// ---- 真实仓库判定 ----
function getBaseSha() {
  if (process.env.GITHUB_BASE_SHA) {
    const s = process.env.GITHUB_BASE_SHA.trim();
    if (s && s !== "0000000000000000000000000000000000000000") return s;
  }
  if (process.env.GITHUB_EVENT_PATH) {
    try {
      const evPath = process.env.GITHUB_EVENT_PATH;
      if (fs.existsSync(evPath)) {
        const ev = JSON.parse(fs.readFileSync(evPath, "utf8"));
        if (ev.pull_request && ev.pull_request.base && ev.pull_request.base.sha) {
          const sha = String(ev.pull_request.base.sha).trim();
          if (sha) {
            // 若是 push 到主分支，则无基准
            if (ev.pull_request.base.ref === "main" && process.env.GITHUB_EVENT_NAME === "push") {
              return null;
            }
            return sha;
          }
        }
        if (ev.before && ev.before !== "0000000000000000000000000000000000000000") {
          // push 事件的 before 可能是主分支推送，若 ref 是 main 则视为无基准
          if (ev.ref === "refs/heads/main") return null;
          return String(ev.before).trim();
        }
      }
    } catch {}
  }
  // 检查 GITHUB_REF 是否为 push 到 main
  if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main") {
    return null;
  }
  try {
    const out = execSync("git rev-parse --verify origin/main", { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {}
  try {
    const out = execSync("git rev-parse --verify origin/master", { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {}
  try {
    const out = execSync("git rev-parse HEAD~1", { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {}
  return null;
}

function getChangedFiles(baseSha) {
  if (!baseSha) return null;
  // 检查 base 是否存在
  try { execSync("git cat-file -e " + baseSha, { stdio: "ignore" }); } catch { return null; }
  const head = (() => {
    try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "HEAD"; }
  })();
  if (baseSha === head) return [];
  const cmds = [
    "git diff --name-only --diff-filter=ACMRT " + baseSha + "...HEAD",
    "git diff --name-only --diff-filter=ACMRT " + baseSha + "..HEAD",
    "git diff --name-only --diff-filter=ACMRT " + baseSha + " HEAD"
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { encoding: "utf8" });
      const files = out.split("\n").map(s=>s.trim()).filter(Boolean);
      // 若命令成功，即使为空也返回（空表示无改动或 base 相同）
      return files;
    } catch {}
  }
  return null;
}

const baseSha = getBaseSha();
if (!baseSha) {
  skip("无对比基准（如 push 到主分支或 shallow），跳过会话门禁");
  console.log("\n[verify-no-mixed-session] PASS (SKIP)");
  process.exit(0);
}

const changedFiles = getChangedFiles(baseSha);
if (changedFiles === null) {
  skip("无法获取改动清单（如 shallow clone），跳过会话门禁");
  console.log("\n[verify-no-mixed-session] PASS (SKIP)");
  process.exit(0);
}

console.log("  INFO 基准: " + baseSha.slice(0,8) + " 改动文件: " + changedFiles.length);

const result = detectMixedSession(changedFiles);
if (result.ok) {
  ok("会话未跨房（房间: " + (result.rooms.join(",") || "无") + "）");
  if (changedFiles.length) {
    const roomFiles = changedFiles.filter(f=>getRoom(f));
    if (roomFiles.length) console.log("    房内文件: " + roomFiles.join(", "));
  }
} else {
  bad("会话跨房（房间: " + result.rooms.join(", ") + "）");
  for (const room of result.rooms) {
    const list = result.filesByRoom[room] || [];
    console.log("    [" + room + "] " + list.join(", "));
  }
  console.log("\n提示：一次会话只改一座后端，按纪律拆票分次实施（#326）");
}

console.log(failed ? "\n[verify-no-mixed-session] FAIL" : "\n[verify-no-mixed-session] PASS");
process.exit(failed ? 1 : 0);

