// retro_boost/quickcheck.mts —— 并发单跑几扇门禁，每条压成一行结果。
//
// 解决什么问题：改完一个模块要跑 3~5 扇门禁核对，以前一扇一次 pwsh 调用、一扇一屏输出，
// 还要人肉从几百行 PASS 里数失败。这里一次调用并发跑、解析每扇的 GATE-RESULT，只打结论与失败原文。
//
// 安全边界：接受的名字只允许解析到 tests/ 目录下的 verify-*.ts（软链接也要解析后仍在 tests/ 内）。
// 这既防「手滑写成 ../某脚本」把任意 .ts 当门禁执行，也保证它只做「跑仓库自己的门禁」这一件事。
// 超时会结束子进程树（Windows 用 taskkill /T），避免留下还在跑的测试进程。
//
// 用法（在仓库根目录跑）:
//   node retro_boost/quickcheck.mts verify-1852-async-gate-model
//   node retro_boost/quickcheck.mts 1852 1839 --jobs 4
//   node retro_boost/quickcheck.mts verify-1446-panel verify-1447-gitlab-e2e --timeout 300
//   node retro_boost/quickcheck.mts 1852 --json
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const names = argv.filter(a => !a.startsWith('--'));

function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const jobs = Math.max(1, Number(flag('jobs', '4')));
const timeoutMs = Math.max(10, Number(flag('timeout', '600'))) * 1000;
const wantJson = argv.includes('--json');
const root = process.cwd();
const testsRoot = path.resolve(root, 'tests');

if (names.length === 0) {
  console.log('用法: node retro_boost/quickcheck.mts <门禁名或文件名> [...] [--jobs 4] [--timeout 600] [--json]');
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'scripts', 'ts-hook.mts')) || !fs.existsSync(testsRoot)) {
  console.error('[quickcheck] 请在仓库根目录运行（找不到 scripts/ts-hook.mts 或 tests/）');
  process.exit(2);
}

function realOrSelf(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

// 只允许 tests/ 下的 verify-*.ts；解析软链接后再比对，防止用软链接把目录外的脚本伪装成门禁。
function resolveGate(name: string): string {
  const raw = path.resolve(testsRoot, name.endsWith('.ts') ? name : name + '.ts');
  const real = realOrSelf(raw);
  const inside = real === testsRoot || real.startsWith(testsRoot + path.sep);
  if (!inside) throw new Error('只允许跑 tests/ 下的门禁，拒绝：' + name);
  if (!/^verify-[^\\/]+\.ts$/.test(path.basename(real))) throw new Error('只允许跑 tests/verify-*.ts，拒绝：' + name);
  if (fs.existsSync(real)) return real;
  const all = fs.readdirSync(testsRoot).filter(f => /^verify-.*\.ts$/.test(f));
  const hit = all.filter(f => f.includes(name));
  if (hit.length === 1) return path.join(testsRoot, hit[0]);
  if (hit.length === 0) throw new Error('找不到门禁：' + name);
  throw new Error('门禁名不唯一：' + name + ' → ' + hit.join(', '));
}

let files: string[];
try { files = names.map(resolveGate); } catch (e: any) {
  console.error('[quickcheck] ' + e.message);
  process.exit(2);
}

function killTree(child: any): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (child.kill) {
      child.kill('SIGKILL');
    }
  } catch { /* 尽力而为 */ }
}

function runOne(file: string): Promise<{ file: string; code: number | null; out: string; sec: number; timedOut: boolean }> {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--import', './scripts/ts-hook.mts', path.relative(root, file)], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    let timedOut = false;
    const killTimer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(killTimer);
      resolve({ file, code, out, sec: (Date.now() - t0) / 1000, timedOut });
    });
  });
}

function summarize(r: { file: string; code: number | null; out: string; sec: number; timedOut: boolean }) {
  const m = r.out.match(/GATE-RESULT\s+(\{[^\n]*\})/);
  let data: any = null;
  if (m) { try { data = JSON.parse(m[1]); } catch { /* 保留 null */ } }
  const passLines = (r.out.match(/^PASS\b/gm) || []).length;
  const failLines = (r.out.match(/^FAIL\b/gm) || []).length;
  const assertions = data?.assertions ?? passLines + failLines;
  const failed = data?.failed ?? failLines;
  const ok = !r.timedOut && r.code === 0 && failed === 0;
  const detail = r.out.split('\n')
    .map(l => l.trim())
    .filter(l => l && (/^FAIL\b/.test(l) || /^断言/.test(l) || /AssertionError|Error:/.test(l)))
    .slice(0, 3);
  return { file: path.relative(root, r.file), ok, assertions, failed, sec: r.sec, timedOut: r.timedOut, code: r.code, detail };
}

const results: ReturnType<typeof summarize>[] = [];
let cursor = 0;
async function worker() {
  while (cursor < files.length) {
    const mine = files[cursor++];
    results.push(summarize(await runOne(mine)));
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

if (wantJson) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.every(r => r.ok) ? 0 : 1);
}

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${String(r.assertions).padStart(4)} 条断言  ${r.sec.toFixed(1)}s  ${r.file}`);
  else {
    failed++;
    const why = r.timedOut ? `超时（>${timeoutMs / 1000}s）` : `退出码 ${r.code}，失败 ${r.failed}/${r.assertions} 条`;
    console.log(`FAIL  ${why}  ${r.sec.toFixed(1)}s  ${r.file}`);
    for (const line of r.detail) console.log('      ' + line.slice(0, 180));
  }
}
const totalSec = results.reduce((a, r) => a + r.sec, 0);
console.log('');
console.log(`汇总：${results.length - failed}/${results.length} 通过，总用时 ${totalSec.toFixed(1)}s（并发 ${jobs}）`);
process.exit(failed === 0 ? 0 : 1);
