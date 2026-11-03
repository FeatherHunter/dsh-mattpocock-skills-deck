// retro_boost/session-stats.mts —— 解压 DSH 会话日志（session.v4.jsonl.zstd），统计每轮对话、每个工具、
// 每个后台任务分别花掉多少墙钟时间，用来回答「时间都去哪了」。
//
// 安全边界：
//   - 只读：不写任何文件、不发网络请求、不读凭证文件；
//   - 只认 DSH_HOME 下 sessions/ 里的会话日志（解析后必须仍在该目录内）；
//   - 解压有上限（512MB / 20000 帧），防止被构造的「解压炸弹」拖垮内存；
//   - 输出会把常见凭证形状（ghp_、github_pat_、npm_、sk-、AKIA、URL 里的 token= 等）打码，
//     但会话日志里仍可能有命令原文与本地路径——贴到公开处前请自行再检查一遍。
//
// 用法（在仓库根目录跑）:
//   node retro_boost/session-stats.mts                     # 当前仓库 + 最近一次会话
//   node retro_boost/session-stats.mts --session latest
//   node retro_boost/session-stats.mts --session session-23bb2e0d-5004-44ee-85fe-c461a693f568
//   node retro_boost/session-stats.mts --cwd D:\other\repo --top 20
//   node retro_boost/session-stats.mts --json
//
// 为什么要自己解压：会话文件是「许多个连续的 zstd 帧」直接把字节拼在一起，Node 自带的
// zstdDecompressSync 只解第一帧，流式 createZstdDecompress 读到第二帧会报 Unknown frame descriptor；
// 按魔数（28 B5 2F FD）切成帧逐帧解，再拼起来才是完整的 JSONL。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_FRAMES = 20_000;

const argv = process.argv.slice(2);

function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const TOP = Math.max(1, Number(flag('top', '15')));
const wantJson = argv.includes('--json');
const cwd = path.resolve(flag('cwd', process.cwd())!);
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const sessionsRoot = path.join(dshHome, 'sessions');

// 常见凭证形状打码：这些样式一旦出现在命令行参数里，本仓库自己的规矩就是不许落盘；
// 日志里已经有的，输出时遮掉，避免复盘报告转手变成泄露源。
function redact(text: string): string {
  return String(text)
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '[已脱敏]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[已脱敏]')
    .replace(/npm_[A-Za-z0-9]{20,}/g, '[已脱敏]')
    .replace(/sk-[A-Za-z0-9]{16,}/g, '[已脱敏]')
    .replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, '[已脱敏]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[已脱敏]')
    .replace(/([?&](?:token|access_token|key|secret|password|auth)=)[^&\s]+/gi, '$1[已脱敏]')
    .replace(/((?:Authorization|authorization)\s*[:=]\s*)[^\s,;'"]+/g, '$1[已脱敏]');
}

// 会话目录名是把工作目录里的冒号去掉、斜杠换成横线，再包一层 --。例：
// D:\dsh-plugin\dsh-mattpocock-skills-deck → --D-dsh-plugin-dsh-mattpocock-skills-deck--
function mangledName(dir: string): string {
  return '--' + dir.replace(/:/g, '').replace(/[\\/]+/g, '-') + '--';
}

function listSessionFiles(): { file: string; id: string; group: string }[] {
  const found: { file: string; id: string; group: string }[] = [];
  if (!fs.existsSync(sessionsRoot)) {
    console.error('[session-stats] 找不到会话目录：' + sessionsRoot);
    return found;
  }
  for (const group of fs.readdirSync(sessionsRoot)) {
    const groupDir = path.join(sessionsRoot, group);
    let entries: string[];
    try { entries = fs.readdirSync(groupDir); } catch { continue; }
    for (const id of entries) {
      const file = path.join(groupDir, id, 'session.v4.jsonl.zstd');
      if (fs.existsSync(file)) found.push({ file, id, group });
    }
  }
  return found;
}

function realOrSelf(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function decompressSession(file: string): string {
  // 解析软链接后仍必须落在 sessions/ 里，防止把 --session 指到别处的文件。
  const realSessions = realOrSelf(sessionsRoot) + path.sep;
  const realFile = realOrSelf(file);
  if (!realFile.startsWith(realSessions)) throw new Error('拒绝读取会话目录之外的文件：' + realFile);

  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts: number[] = [];
  let at = buf.indexOf(magic, 0);
  while (at !== -1) { starts.push(at); at = buf.indexOf(magic, at + 4); }
  if (starts.length === 0) throw new Error('文件里找不到 zstd 帧魔数，格式可能变了：' + file);
  if (starts.length > MAX_FRAMES) throw new Error(`帧数超过上限（${MAX_FRAMES}），拒绝解压：${file}`);
  const chunks: Buffer[] = [];
  let failed = 0;
  let total = 0;
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length;
    try {
      const chunk = zstdDecompressSync(buf.subarray(starts[i], end));
      total += chunk.length;
      if (total > MAX_DECOMPRESSED_BYTES) throw new Error(`解压后超过 ${MAX_DECOMPRESSED_BYTES} 字节上限，疑似解压炸弹：${file}`);
      chunks.push(chunk);
    } catch (e: any) {
      if (/解压后超过/.test(e?.message || '')) throw e;
      failed++;
    }
  }
  if (failed) console.error(`[session-stats] 注意：${failed}/${starts.length} 个 zstd 帧解压失败，统计可能偏少`);
  return Buffer.concat(chunks).toString('utf8');
}

function pickSession() {
  const wanted = flag('session');
  const all = listSessionFiles();
  if (!all.length) throw new Error('这台机器上还没有会话日志');
  if (wanted && wanted !== 'latest') {
    const hit = all.find(s => s.id === wanted || s.id.endsWith(wanted));
    if (!hit) throw new Error('找不到会话：' + wanted);
    return hit;
  }
  const scoped = all.filter(s => s.group === mangledName(cwd));
  const pool = scoped.length ? scoped : all;
  pool.sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
  return pool[0];
}

function fmt(ms: number): string {
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60_000).toFixed(1) + 'min';
}

// 统一兜底：参数错误、找不到会话、超限等都以一句人话结束，不抛整段堆栈。
process.on('uncaughtException', (e: any) => {
  console.error('[session-stats] ' + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
process.on('unhandledRejection', (e: any) => {
  console.error('[session-stats] ' + (e && e.message ? e.message : String(e)));
  process.exit(1);
});

const session = pickSession();
const records: any[] = [];
for (const line of decompressSession(session.file).split('\n')) {
  if (!line.trim()) continue;
  try { records.push(JSON.parse(line)); } catch { /* 截断行忽略 */ }
}

type Call = { name: string; turn: number; start: number; args: string };
const callIndex = new Map<string, Call>();
const toolMs: Record<string, number> = {};
const toolCount: Record<string, number> = {};
const turnToolMs: Record<number, number> = {};
const slowCalls: { name: string; turn: number; ms: number; args: string }[] = [];
const turns: { turn: number; ms: number; steps: number }[] = [];
const jobs = new Map<string, any>();
const jobMs: Record<string, number> = {};
const slowJobs: { label: string; kind: string; ms: number }[] = [];
let waitCalls = 0;
let waitMs = 0;
let retries = 0;
let userMessages = 0;
let turnStart = 0;
let turnSteps = 0;

for (const r of records) {
  const d = r.data || {};
  if (r.type === 'turn/start') { turnStart = r.time; turnSteps = 0; }
  else if (r.type === 'step/start') { turnSteps++; }
  else if (r.type === 'turn/end') { turns.push({ turn: d.turn ?? turns.length + 1, ms: r.time - turnStart, steps: turnSteps }); }
  else if (r.type === 'user/message') { userMessages++; }
  else if (r.type === 'tool/call') {
    callIndex.set(d.callId, { name: d.name || '(未知)', turn: d.turn || 0, start: r.time, args: String(d.arguments ?? '') });
  } else if (r.type === 'tool/result') {
    const callId = d.message?.toolCallId || d.toolCallId;
    const call = callId ? callIndex.get(callId) : undefined;
    if (!call) continue;
    const ms = r.time - call.start;
    toolMs[call.name] = (toolMs[call.name] || 0) + ms;
    toolCount[call.name] = (toolCount[call.name] || 0) + 1;
    turnToolMs[call.turn] = (turnToolMs[call.turn] || 0) + ms;
    slowCalls.push({ name: call.name, turn: call.turn, ms, args: redact(call.args.replace(/\s+/g, ' ')).slice(0, 120) });
    if (call.name === 'job_output' && /"wait"\s*:\s*true/.test(call.args)) { waitCalls++; waitMs += ms; }
  } else if (r.type === 'job/registered') {
    jobs.set(d.jobId, d);
  } else if (r.type === 'job/settled') {
    const reg = jobs.get(d.jobId);
    if (!reg) continue;
    const ms = (d.finishedAt || r.time) - (reg.startedAt || r.time);
    const kind = reg.kind || d.kind || '?';
    jobMs[kind] = (jobMs[kind] || 0) + ms;
    slowJobs.push({ label: redact(String(reg.label || d.jobId)), kind, ms });
  } else if (r.type === 'llm/retry') {
    retries++;
  }
}

const totalToolMs = Object.values(toolMs).reduce((a, b) => a + b, 0);
const totalJobMs = Object.values(jobMs).reduce((a, b) => a + b, 0);
const toolRank = Object.keys(toolMs).sort((a, b) => toolMs[b] - toolMs[a]);
const jobRank = Object.keys(jobMs).sort((a, b) => jobMs[b] - jobMs[a]);
slowCalls.sort((a, b) => b.ms - a.ms);
slowJobs.sort((a, b) => b.ms - a.ms);

const report = {
  session: session.id,
  file: session.file,
  records: records.length,
  turns,
  userMessages,
  totalToolMs,
  totalJobMs,
  toolMs,
  toolCount,
  slowCalls: slowCalls.slice(0, TOP),
  jobKinds: jobMs,
  slowJobs: slowJobs.slice(0, TOP),
  waitCalls,
  waitMs,
  retries,
};

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`会话：${session.id}`);
console.log(`日志：${session.file}（${records.length} 条记录，${userMessages} 条用户消息）`);
console.log('注意：以下内容来自会话日志，可能含命令原文与本地路径（常见凭证形状已打码）；贴到公开处前请再检查。');
console.log('');
console.log(`轮次（共 ${turns.length} 轮）：`);
for (const t of turns) {
  const tool = turnToolMs[t.turn] || 0;
  const share = t.ms ? Math.round((tool / t.ms) * 100) : 0;
  console.log(`  turn ${t.turn}：墙钟 ${fmt(t.ms)}，${t.steps} 步，前台工具 ${fmt(tool)}（占 ${share}%）`);
}
console.log('');
console.log(`前台工具合计：${fmt(totalToolMs)}；后台任务合计：${fmt(totalJobMs)}`);
console.log('');
console.log('按工具（耗时从多到少）：');
for (const name of toolRank) {
  console.log(`  ${name.padEnd(20)} ${fmt(toolMs[name]).padStart(8)}  ${String(toolCount[name]).padStart(3)} 次`);
}
console.log('');
console.log(`最慢的 ${Math.min(TOP, slowCalls.length)} 次前台工具调用：`);
for (const c of slowCalls.slice(0, TOP)) {
  console.log(`  ${fmt(c.ms).padStart(8)}  ${c.name.padEnd(16)} turn${c.turn}  ${c.args}`);
}
console.log('');
console.log('后台任务按类型：');
for (const kind of jobRank) console.log(`  ${kind.padEnd(16)} ${fmt(jobMs[kind]).padStart(9)}`);
console.log('');
console.log(`最慢的 ${Math.min(TOP, slowJobs.length)} 个后台任务：`);
for (const j of slowJobs.slice(0, TOP)) console.log(`  ${fmt(j.ms).padStart(9)}  [${j.kind}] ${j.label.slice(0, 110)}`);
console.log('');
console.log(`等待类调用：job_output 带 wait=true 共 ${waitCalls} 次，合计 ${fmt(waitMs)}`);
console.log(`LLM 重试：${retries} 次`);
