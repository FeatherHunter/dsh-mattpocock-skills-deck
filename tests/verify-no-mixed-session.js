#!/usr/bin/env node
/**
 * verify-no-mixed-session.js —— 会话越界门禁（#326，承接 #313 的 D4 项）
 *
 * 判断一次改动（base...head 之间提交过的文件清单）有没有跨房间：
 *   房间文件是指住在 src/tracker/rooms/<name>/** 里的文件（name 取 github / gitlab / markdown）；
 *   tests/ 下的各种门禁与夹具不算任何房间。
 * 拿不到对比基准时（例如直接 push 到主分支）跳过本门禁，不让它失败。
 * 判定失败时打印命中的房间与各自文件清单，方便分票。
 *
 * 用法：node tests/verify-no-mixed-session.js
 * CI 需要 checkout 带 fetch-depth: 0，才能读到 GITHUB_EVENT_PATH 里的 base sha。
 *
 * 2026-10-17 先修：这个文件里的中文原本整片是乱码（历史上某次以错误编码写入，原文已不可复原），
 *   本笔按代码行为把注释与提示文案重写成人话；判据逻辑一个字没动。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const child_process = require("child_process");
const execSync = child_process.execSync;

const root = path.resolve(__dirname, "..");
const BACKENDS = ["github", "gitlab", "markdown"];
const BACKEND_ROOT_POSIX = "src/tracker/rooms";

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
  // 只改一个房间：应通过
  const r1 = detectMixedSession(["src/tracker/rooms/github/a.ts"]);
  selfCheck(r1.ok && r1.rooms.length === 1 && r1.rooms[0] === "github", "只改一个房间应通过");
}
{
  // 同时改两个房间：应失败
  const r2 = detectMixedSession(["src/tracker/rooms/github/a.ts", "src/tracker/rooms/gitlab/b.js"]);
  selfCheck(!r2.ok && r2.rooms.length === 2, "同时改两个房间应失败");
}
{
  // 房间外的共用文件（契约层、判定件）：不算任何房间
  const r3 = detectMixedSession(["src/tracker/contract/vocabulary.ts", "src/tracker/kernel/preflight.ts"]);
  selfCheck(r3.ok && r3.rooms.length === 0, "房间外的共用文件不算房间");
}
{
  // 改动里混着 tests/ 下的门禁：它不算房间，仍只算一个房间
  const r4 = detectMixedSession(["tests/verify-no-cross-import.js", "src/tracker/rooms/markdown/a.ts"]);
  selfCheck(r4.ok && r4.rooms.length === 1, "混入 tests 目录的改动仍算单个房间");
}
{
  // 一次动三个房间：应失败
  const r5 = detectMixedSession([
    "src/tracker/rooms/github/a.ts",
    "src/tracker/rooms/gitlab/b.js",
    "src/tracker/rooms/markdown/c.ts"
  ]);
  selfCheck(!r5.ok && r5.rooms.length === 3, "同时改三个房间应失败");
}

// 临时 git 仓库自检
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-mixed-"));
  try {
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email \"test@test\"", { cwd: tmp });
    execSync("git config user.name \"test\"", { cwd: tmp });
    fs.mkdirSync(path.join(tmp, "src/tracker/rooms/github"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "src/tracker/rooms/gitlab"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "README.md"), "# test\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m init", { cwd: tmp });
    const base = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();

    // 第一次提交：只改 github
    fs.writeFileSync(path.join(tmp, "src/tracker/rooms/github/a.ts"), "console.log(1)\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m \"github only\"", { cwd: tmp });
    const head1 = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    const diff1 = execSync("git diff --name-only " + base + ".." + head1, { cwd: tmp, encoding: "utf8" }).split("\n").map(s=>s.trim()).filter(Boolean);
    const res1 = detectMixedSession(diff1);
    selfCheck(res1.ok, "临时仓库里单房间的提交应通过", JSON.stringify(diff1));

    // 第二次提交：再加一个 gitlab
    fs.writeFileSync(path.join(tmp, "src/tracker/rooms/gitlab/b.js"), "console.log(2)\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m \"gitlab\"", { cwd: tmp });
    const head2 = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    const diff2 = execSync("git diff --name-only " + base + ".." + head2, { cwd: tmp, encoding: "utf8" }).split("\n").map(s=>s.trim()).filter(Boolean);
    const res2 = detectMixedSession(diff2);
    selfCheck(!res2.ok && res2.rooms.length === 2, "临时仓库里跨两个房间的提交应失败", JSON.stringify(diff2));

    // 空改动：没有房间，应通过（对应真实场景里拿到 base 但两次之间没改任何文件）
    const res3 = detectMixedSession([]);
    selfCheck(res3.ok, "临时仓库里空改动应通过");

  } catch (e) {
    selfCheck(false, "临时仓库自检过程抛错", String(e && e.message || e));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

if (selfFailed) {
  console.log("\n自检失败 - 门禁实现本身没通过");
  process.exit(1);
}
console.log("  PASS 自检全部通过");

// ---- 真实仓库判断 ----
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
            // 直接 push 到主分支时没有对比基准
            if (ev.pull_request.base.ref === "main" && process.env.GITHUB_EVENT_NAME === "push") {
              return null;
            }
            return sha;
          }
        }
        if (ev.before && ev.before !== "0000000000000000000000000000000000000000") {
          // push 事件：before 是这次推送的起点；ref 是 main 时同样视为没有基准
          if (ev.ref === "refs/heads/main") return null;
          return String(ev.before).trim();
        }
      }
    } catch {}
  }
  // 兜底：如果环境变量显示是 push 到 main
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
  // 先确认这个 base 在本地仓库里存在
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
      // 命令跑成功了就返回，哪怕是空清单（空表示改动与 base 相同）
      return files;
    } catch {}
  }
  return null;
}

const baseSha = getBaseSha();
if (!baseSha) {
  skip("没有对比基准（例如 push 到主分支或 shallow 检出），跳过本会话门禁");
  console.log("\n[verify-no-mixed-session] PASS (SKIP)");
  process.exit(0);
}

const changedFiles = getChangedFiles(baseSha);
if (changedFiles === null) {
  skip("读不到改动清单（可能是 shallow clone），跳过本会话门禁");
  console.log("\n[verify-no-mixed-session] PASS (SKIP)");
  process.exit(0);
}

console.log("  INFO 基准: " + baseSha.slice(0,8) + " 改动文件: " + changedFiles.length);

const result = detectMixedSession(changedFiles);
if (result.ok) {
  ok("会话没有跨房间（命中: " + (result.rooms.join(",") || "无") + " 个）");
  if (changedFiles.length) {
    const roomFiles = changedFiles.filter(f=>getRoom(f));
    if (roomFiles.length) console.log("    房间文件: " + roomFiles.join(", "));
  }
} else {
  bad("会话跨了多个房间（命中: " + result.rooms.join(", ") + " 个）");
  for (const room of result.rooms) {
    const list = result.filesByRoom[room] || [];
    console.log("    [" + room + "] " + list.join(", "));
  }
  console.log("\n提示：一次会话只动一个房间；要同时改多个房间请分票分次做（#326）");
}

console.log(failed ? "\n[verify-no-mixed-session] FAIL" : "\n[verify-no-mixed-session] PASS");
process.exit(failed ? 1 : 0);

