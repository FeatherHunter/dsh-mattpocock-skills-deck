#!/usr/bin/env node
/**
 * verify-no-mixed-session.js �� �ỰԽ���Ž���#326 �н� #313 D4��
 *
 * �ж�����PR ��ȫ���Ķ��嵥��base...head�����ǵ����ύ��
 * ����ھ����� src/tracker/rooms/<name>/** ���ڷ����ļ���
 *           tests/ ����Լ���Լо߲������κη��䡣
 * �޶ԱȻ�׼���� push ������֧��ʱ����������ʧ�ܡ�
 * ʧ��ʱ�������ķ����ļ��嵥��
 *
 * �÷���node tests/verify-no-mixed-session.js
 * CI �豣֤ checkout �� fetch-depth: 0 ���ܶ�ȡ GITHUB_EVENT_PATH �е� base sha��
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

console.log("== verify-no-mixed-session���ỰԽ���Ž���#326�� ==");

// ---- �Լ죺������ + ��ʱ git �ֿ� ----
let selfFailed = false;
function selfCheck(cond, msg, detail) {
  if (cond) console.log("  PASS " + msg);
  else { selfFailed = true; failed = true; console.log("  FAIL " + msg + (detail ? " - " + detail : "")); }
}

{
  // ������������
  const r1 = detectMixedSession(["src/tracker/rooms/github/a.ts"]);
  selfCheck(r1.ok && r1.rooms.length === 1 && r1.rooms[0] === "github", "����������ͨ��");
}
{
  // ��������˫��
  const r2 = detectMixedSession(["src/tracker/rooms/github/a.ts", "src/tracker/rooms/gitlab/b.js"]);
  selfCheck(!r2.ok && r2.rooms.length === 2, "������˫��Ӧʧ��");
}
{
  // ���������������ļ�
  const r3 = detectMixedSession(["src/tracker/contract/vocabulary.ts", "src/tracker/kernel/preflight.ts"]);
  selfCheck(r3.ok && r3.rooms.length === 0, "�������������ļ�������");
}
{
  // ��������tests ������
  const r4 = detectMixedSession(["tests/verify-no-cross-import.js", "src/tracker/rooms/markdown/a.ts"]);
  selfCheck(r4.ok && r4.rooms.length === 1, "������ tests �����뷿��");
}
{
  // ������������
  const r5 = detectMixedSession([
    "src/tracker/rooms/github/a.ts",
    "src/tracker/rooms/gitlab/b.js",
    "src/tracker/rooms/markdown/c.ts"
  ]);
  selfCheck(!r5.ok && r5.rooms.length === 3, "����������Ӧʧ��");
}

// ��ʱ git �ֿ��Լ�
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

    // �����ύ��ֻ�� github
    fs.writeFileSync(path.join(tmp, "src/tracker/rooms/github/a.ts"), "console.log(1)\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m \"github only\"", { cwd: tmp });
    const head1 = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    const diff1 = execSync("git diff --name-only " + base + ".." + head1, { cwd: tmp, encoding: "utf8" }).split("\n").map(s=>s.trim()).filter(Boolean);
    const res1 = detectMixedSession(diff1);
    selfCheck(res1.ok, "��ʱ�ֿⵥ���ύͨ��", JSON.stringify(diff1));

    // ˫���ύ���ٸ� gitlab
    fs.writeFileSync(path.join(tmp, "src/tracker/rooms/gitlab/b.js"), "console.log(2)\n");
    execSync("git add .", { cwd: tmp });
    execSync("git commit -q -m \"gitlab\"", { cwd: tmp });
    const head2 = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    const diff2 = execSync("git diff --name-only " + base + ".." + head2, { cwd: tmp, encoding: "utf8" }).split("\n").map(s=>s.trim()).filter(Boolean);
    const res2 = detectMixedSession(diff2);
    selfCheck(!res2.ok && res2.rooms.length === 2, "��ʱ�ֿ�˫���ύӦʧ��", JSON.stringify(diff2));

    // �޻�׼��ģ���� base ʱӦ�������˴�ֱ�Ӳ��� detectMixedSession �Կ����飩
    const res3 = detectMixedSession([]);
    selfCheck(res3.ok, "��ʱ�ֿ�ոĶ�Ӧͨ��");

  } catch (e) {
    selfCheck(false, "��ʱ�ֿ��Լ��쳣", String(e && e.message || e));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

if (selfFailed) {
  console.log("\n�Լ�ʧ�� - �Ž�ʵ��δͨ��");
  process.exit(1);
}
console.log("  PASS �Լ�ȫ��ͨ��");

// ---- ��ʵ�ֿ��ж� ----
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
            // ���� push ������֧�����޻�׼
            if (ev.pull_request.base.ref === "main" && process.env.GITHUB_EVENT_NAME === "push") {
              return null;
            }
            return sha;
          }
        }
        if (ev.before && ev.before !== "0000000000000000000000000000000000000000") {
          // push �¼��� before ����������֧���ͣ��� ref �� main ����Ϊ�޻�׼
          if (ev.ref === "refs/heads/main") return null;
          return String(ev.before).trim();
        }
      }
    } catch {}
  }
  // ��� GITHUB_REF �Ƿ�Ϊ push �� main
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
  // ��� base �Ƿ����
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
      // ������ɹ�����ʹΪ��Ҳ���أ��ձ�ʾ�޸Ķ��� base ��ͬ��
      return files;
    } catch {}
  }
  return null;
}

const baseSha = getBaseSha();
if (!baseSha) {
  skip("�޶ԱȻ�׼���� push ������֧�� shallow���������Ự�Ž�");
  console.log("\n[verify-no-mixed-session] PASS (SKIP)");
  process.exit(0);
}

const changedFiles = getChangedFiles(baseSha);
if (changedFiles === null) {
  skip("�޷���ȡ�Ķ��嵥���� shallow clone���������Ự�Ž�");
  console.log("\n[verify-no-mixed-session] PASS (SKIP)");
  process.exit(0);
}

console.log("  INFO ��׼: " + baseSha.slice(0,8) + " �Ķ��ļ�: " + changedFiles.length);

const result = detectMixedSession(changedFiles);
if (result.ok) {
  ok("�Ựδ�緿������: " + (result.rooms.join(",") || "��") + "��");
  if (changedFiles.length) {
    const roomFiles = changedFiles.filter(f=>getRoom(f));
    if (roomFiles.length) console.log("    �����ļ�: " + roomFiles.join(", "));
  }
} else {
  bad("�Ự�緿������: " + result.rooms.join(", ") + "��");
  for (const room of result.rooms) {
    const list = result.filesByRoom[room] || [];
    console.log("    [" + room + "] " + list.join(", "));
  }
  console.log("\n��ʾ��һ�λỰֻ��һ����ˣ������ɲ�Ʊ�ִ�ʵʩ��#326��");
}

console.log(failed ? "\n[verify-no-mixed-session] FAIL" : "\n[verify-no-mixed-session] PASS");
process.exit(failed ? 1 : 0);

