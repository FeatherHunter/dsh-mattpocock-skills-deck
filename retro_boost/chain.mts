// retro_boost/chain.mts —— 跑一次完整的验证链，把逐条输出压成摘要；结果写到「本次运行专属」的文件。
//
// 解决什么问题：全链一次十几到二十分钟，逐条日志几千行。以前靠反复调 job_output 轮询（一次等待被拆成
// 十几次工具调用，单次等待 4–5 分钟），光等待就占了 42 分钟。这个脚本把「启动、盯进度、收结果、摘失败
// 原因」压成一次调用：进度行打在终端，完整日志落文件，结束只打印摘要。
//
// 为什么结果文件要专属：npm run verify:parallel 默认写共享的 node_modules/.cache/dsh-verify-last.json，
// 同一台机器上多个会话同时跑全链时会互相覆盖，摘要可能把别人的红绿当成自己的。这里直接调用同一个
// 执行器（node scripts/verify-parallel.mts，也就是 npm run verify:parallel 展开后的命令），但把
// --json 指到本次专属文件，互不干扰；门禁内容与「唯一裁决入口」完全一致。
//
// 安全边界：
//   - 默认只跑上面那条命令；自定义命令必须显式加 --allow-cmd，且只在你自己确认命令可信时使用。
//   - --log / --result 只允许写在仓库内或系统临时目录里，防止误把任意文件截断。
//   - 默认加一把「本仓库级别」的锁：同一时刻只允许一个 chain 在跑，别的会话排队等待。锁文件在
//     node_modules/.cache/retro-chain.lock（主树与接了 junction 的工作树共享）。注意：直接跑
//     `npm run verify:parallel` 的会话不认这把锁，所以它只能减少、不能彻底消除并发争用。
//   - 锁有超时兜底：持有进程已退出、或锁超过 4 小时，会被当成陈旧锁清掉，不会永久卡住。
//
// 用法（在仓库根目录跑）:
//   node retro_boost/chain.mts
//   node retro_boost/chain.mts --log D:\temp\chain.log --interval 15000
//   node retro_boost/chain.mts --allow-cmd --cmd "npm run verify:changed"    # 换命令（自测也用它）
//   node retro_boost/chain.mts --no-lock                                     # 明知别的会话在跑，仍要并发
//   node retro_boost/chain.mts --json
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);

function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}
function has(name: string): boolean { return argv.includes('--' + name); }

const ROOT = process.cwd();
const VERIFY_SCRIPT = path.join(ROOT, 'scripts', 'verify-parallel.mts');
if (!fs.existsSync(VERIFY_SCRIPT)) {
  console.error('[chain] 请在仓库根目录运行（找不到 scripts/verify-parallel.mts）');
  process.exit(2);
}

// 只允许写仓库内或系统临时目录：这两个位置本来就有可被覆盖的文件（日志、缓存），
// 其他路径一律拒绝，避免 `--log C:\...\id_rsa` 这类误用把别处文件清空。
const REPO_PREFIX = path.resolve(ROOT) + path.sep;
const TMP_PREFIX = path.resolve(os.tmpdir()) + path.sep;
function safeOutputPath(raw: string, what: string): string {
  const resolved = path.resolve(raw);
  if (!resolved.startsWith(REPO_PREFIX) && !resolved.startsWith(TMP_PREFIX)) {
    console.error(`[chain] 拒绝写${what}：${resolved}\n        只允许写在仓库内或系统临时目录（${os.tmpdir()}）里`);
    process.exit(2);
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    console.error(`[chain] ${what}指向了一个目录：${resolved}`);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultPath = safeOutputPath(
  flag('result', path.join(ROOT, 'node_modules', '.cache', `retro-chain-${process.pid}-${stamp}.json`))!,
  '结果文件',
);
const logPath = safeOutputPath(
  flag('log', path.join(os.tmpdir(), `retro-chain-${process.pid}-${stamp}.log`))!,
  '日志文件',
);
const interval = Math.max(1000, Number(flag('interval', '15000')));
const wantJson = has('json');

const customCmd = flag('cmd');
if (customCmd && !has('allow-cmd')) {
  console.error('[chain] 拒绝执行自定义命令：--cmd 需要同时加 --allow-cmd，表示你确认这条命令可信。');
  process.exit(2);
}

// —— 仓库级别并发锁 ——
// 结果文件已经每次专属，但构建缓存、端口、CPU 仍然是共享的：两个会话同时跑全链会互相拖慢，
// 还可能把构建缓存写坏、让浏览器类门禁抢端口，冒出与环境有关的假红。所以默认串行：
// 后来的 chain 排队等待，持有者退出（或锁过期/持有进程已死）后自动接上。
const lockPath = path.join(ROOT, 'node_modules', '.cache', 'retro-chain.lock');
const LOCK_STALE_MS = 4 * 60 * 60 * 1000;
let lockHeld = false;

function lockOwnerAlive(owner: any): boolean {
  if (!owner || typeof owner.pid !== 'number') return false;
  try { process.kill(owner.pid, 0); return true; } catch { return false; }
}
function readLock(): any {
  try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { return null; }
}
function releaseLock(): void {
  if (!lockHeld) return;
  lockHeld = false;
  try {
    const owner = readLock();
    if (owner && owner.pid === process.pid) fs.unlinkSync(lockPath);
  } catch { /* 尽力而为 */ }
}
async function acquireLock(): Promise<void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let noticeAt = 0;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      fs.closeSync(fd);
      lockHeld = true;
      return;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
      const owner = readLock();
      const age = Date.now() - (owner?.startedAt || 0);
      if (!owner || age > LOCK_STALE_MS || !lockOwnerAlive(owner)) {
        try { fs.unlinkSync(lockPath); } catch { /* 别人刚清掉也无妨 */ }
        continue;
      }
      if (Date.now() - noticeAt > 30000) {
        noticeAt = Date.now();
        console.log(`[chain] 另一个会话正在跑全链（pid ${owner.pid}，已 ${(age / 60000).toFixed(1)} 分钟），排队等待…（加 --no-lock 可跳过）`);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

if (!has('no-lock')) await acquireLock();

function readLast(): any {
  try { return JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { return null; }
}
function firstErrorLine(evidence: unknown): string {
  const lines = String(evidence ?? '').split('\n');
  const hit = lines.find(l => /FAIL|失败|Error|error|断言/.test(l) && !/^\s*PASS/.test(l));
  return (hit || lines[0] || '').trim().slice(0, 160);
}

const log = fs.createWriteStream(logPath);
const startedAt = Date.now();
let child: any;
let display: string;
if (customCmd) {
  display = customCmd;
  child = spawn(customCmd, { shell: true, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} else {
  display = 'node scripts/verify-parallel.mts --keep-going --json <本次专属结果文件>';
  child = spawn(process.execPath, [VERIFY_SCRIPT, '--keep-going', '--json', resultPath], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
child.stdout.pipe(log);
child.stderr.pipe(log);
console.log(`[chain] 开始跑：${display}`);
console.log(`[chain] 进度文件：${resultPath}`);
console.log(`[chain] 完整日志：${logPath}`);

let lastLine = '';
const timer = setInterval(() => {
  const d = readLast();
  if (!d || !d.stepsTotal) return;
  const line = `[chain] ${d.stepsRan}/${d.stepsTotal} 步，red=${d.red}，flaky=${d.flaky ?? 0}，已用 ${((Date.now() - startedAt) / 60000).toFixed(1)} 分钟`;
  if (line !== lastLine) { console.log(line); lastLine = line; }
}, interval);

let finishing = false;
function killTree(): void {
  try {
    if (process.platform === 'win32' && child?.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (child?.kill) {
      child.kill('SIGKILL');
    }
  } catch { /* 尽力而为 */ }
}
process.on('SIGINT', () => { killTree(); releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { killTree(); releaseLock(); process.exit(143); });

child.on('close', (code: number | null) => {
  if (finishing) return;
  finishing = true;
  releaseLock();
  clearInterval(timer);
  log.end();
  const data = readLast();
  const reds = Array.isArray(data?.results) ? data.results.filter((r: any) => r.exitCode !== 0) : [];
  const ok = code === 0 && (data ? data.red === 0 : reds.length === 0);

  if (wantJson) {
    console.log(JSON.stringify({ code, ok, data, log: logPath, result: resultPath, wallMs: Date.now() - startedAt }, null, 2));
    process.exit(ok ? 0 : 1);
  }

  console.log('');
  if (!data) {
    console.log(`[chain] 没读到结果文件 ${resultPath}（命令退出码 ${code}）。完整输出：${logPath}`);
    process.exit(code ?? 1);
  }
  console.log(`[chain] ${ok ? '全绿' : '有红'}：${data.stepsRan}/${data.stepsTotal} 步，red=${data.red}，flaky=${data.flaky ?? 0}，墙钟 ${((Date.now() - startedAt) / 60000).toFixed(1)} 分钟`);
  for (const r of reds.slice(0, 12)) console.log(`  FAIL ${r.file}  ${firstErrorLine(r.evidence)}`);
  if (reds.length > 12) console.log(`  ……另有 ${reds.length - 12} 个失败，完整清单见结果文件`);
  console.log(`[chain] 结果文件：${resultPath}`);
  console.log(`[chain] 完整日志：${logPath}`);
  process.exit(ok ? 0 : 1);
});
