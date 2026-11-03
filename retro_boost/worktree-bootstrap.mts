// retro_boost/worktree-bootstrap.mts —— 一条命令建好「能直接跑门禁的工作树」：工作树、依赖、构建产物、可选归属表。
//
// 解决什么问题：并行会话规则要求在独立工作树里干活，但干净检出的工作树里没有 node_modules、
// 也没有构建产物（src/shared/time-config/values.js 之类是构建出来的），第一次跑门禁会报
// ERR_MODULE_NOT_FOUND、全链会白跑一次（一次就是二十分钟）。这个脚本把「建树、把主树的
// node_modules 以 junction 接进来、构建、按需重录归属表」这几步一次做完，并在最后打印下一步命令。
//
// 安全边界（脚本里每一处写操作都先做路径与名字校验）：
//   - 工作树名只允许字母/数字/点/下划线/连字符，且不能含 ..，工作树路径必须落在 <仓库>/.worktrees/ 下；
//   - --ref 先用 git rev-parse 解析成提交哈希再使用，拒绝任何以 - 开头的字符串（防选项注入）；
//   - --files 的每个相对路径都必须是仓库内路径，目标必须落在新工作树内（防路径穿越写到别处）；
//   - 已存在同名 node_modules 时只允许删除「链接」或「空目录」，绝不递归删真实目录；
//   - 构建会执行该提交里的 npm 脚本，请只对可信提交运行。
//
// 用法（在仓库根目录跑）:
//   node retro_boost/worktree-bootstrap.mts 1852-budget-model
//   node retro_boost/worktree-bootstrap.mts 1852-budget-model --ref f003c705 --files src/a.ts,tests/b.ts
//   node retro_boost/worktree-bootstrap.mts 1852-budget-model --no-build --dry-run
//   node retro_boost/worktree-bootstrap.mts 1852-budget-model --regen
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const name = argv[0];
const rest = argv.slice(1);

function flag(flagName: string, fallback?: string): string | undefined {
  const i = rest.indexOf('--' + flagName);
  if (i < 0) return fallback;
  const next = rest[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const dryRun = rest.includes('--dry-run');
const doBuild = !rest.includes('--no-build');
const doRegen = rest.includes('--regen');
const files = (flag('files', '') || '').split(',').map(s => s.trim()).filter(Boolean);

if (!name || name.startsWith('--')) {
  console.log('用法: node retro_boost/worktree-bootstrap.mts <工作树名> [--ref <ref>] [--files a,b] [--no-build] [--regen] [--dry-run]');
  process.exit(1);
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) || name.includes('..')) {
  console.error('[bootstrap] 工作树名只允许字母、数字、点、下划线、连字符（1–80 个字符），且不能含 ..');
  process.exit(2);
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const worktreesRoot = path.resolve(root, '.worktrees');
const worktreePath = path.resolve(worktreesRoot, name);
const depsPath = path.join(root, 'node_modules');

function assertInside(parent: string, child: string, what: string): string {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (c !== p && !c.startsWith(p + path.sep)) {
    console.error(`[bootstrap] ${what}越出了允许的目录 ${p}：${c}`);
    process.exit(2);
  }
  return c;
}

assertInside(worktreesRoot, worktreePath, '工作树路径');

// --ref 先解析成提交哈希，既防选项注入（--xxx 被当成 git 选项），也让日志里是可复查的具体提交。
const rawRef = flag('ref', 'HEAD')!;
if (rawRef.startsWith('-') || /\s/.test(rawRef)) {
  console.error('[bootstrap] --ref 不能以 - 开头，也不能含空白：' + rawRef);
  process.exit(2);
}
let refSha: string;
try {
  refSha = execFileSync('git', ['rev-parse', '--verify', rawRef + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  console.error('[bootstrap] 认不出这个提交：' + rawRef);
  process.exit(2);
}

// --files 的每个路径：仓库内路径 → 写进新工作树内；两侧都做前缀校验，防止 ../.. 写出边界。
const filePairs: { rel: string; from: string; to: string }[] = [];
for (const rel of files) {
  if (path.isAbsolute(rel)) {
    console.error('[bootstrap] --files 只接受仓库内相对路径：' + rel);
    process.exit(2);
  }
  const segs = rel.split(/[\\/]+/);
  if (segs.includes('..') || segs.includes('.git')) {
    console.error('[bootstrap] --files 路径非法（含 .. 或 .git）：' + rel);
    process.exit(2);
  }
  const from = assertInside(root, path.join(root, rel), '复制源');
  const to = assertInside(worktreePath, path.join(worktreePath, rel), '复制目标');
  if (!fs.existsSync(from)) {
    console.error('[bootstrap] 找不到要复制的文件：' + from);
    process.exit(2);
  }
  filePairs.push({ rel: rel, from: from, to: to });
}

function show(label: string, cmd: string) {
  console.log(`[bootstrap] ${label}：${cmd}`);
}
function run(label: string, cmd: string, args: string[], cwd: string): { code: number; out: string } {
  const line = [cmd, ...args].join(' ');
  show(label, line);
  // 用一整条命令字符串交给 shell：参数拼在字符串里而不是走 args 数组，避免 Node 的 DEP0190
  // （shell 模式 + args 数组）。这里的参数都是脚本里写死的常量，不含用户输入。
  const r = spawnSync(line, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (out.trim()) console.log(out.trim().split('\n').slice(-3).join('\n'));
  return { code: r.status ?? 1, out };
}

if (fs.existsSync(worktreePath)) {
  console.error(`[bootstrap] 工作树已存在：${worktreePath}（要重建请先 git worktree remove）`);
  process.exit(2);
}
if (!fs.existsSync(depsPath)) {
  console.error(`[bootstrap] 主树没有 node_modules：${depsPath}，请先在主树装依赖`);
  process.exit(2);
}

if (dryRun) {
  show('建工作树', `git worktree add ${worktreePath} --detach ${refSha}（${rawRef}）`);
  show('接依赖', `把 ${depsPath} 以 junction 接到 ${path.join(worktreePath, 'node_modules')}`);
  for (const p of filePairs) show('复制文件', `${p.from} → ${p.to}`);
  if (doBuild) show('构建', `npm run build（在 ${worktreePath}）`);
  if (doRegen) show('重录归属表', `node scripts/gate-map.mts（在 ${worktreePath}）`);
  console.log('[bootstrap] 预演结束，没有改动磁盘');
  process.exit(0);
}

// 1. 建工作树（用解析后的哈希，绕开一切选项注入空间）
let r = run('建工作树', 'git', ['worktree', 'add', worktreePath, '--detach', refSha], root);
if (r.code !== 0) process.exit(r.code);

// 2. 把主树的 node_modules 以 junction / 目录软链接接进来（工作树不走 npm install，省几分钟）
const wtDeps = path.join(worktreePath, 'node_modules');
if (fs.existsSync(wtDeps) || (() => { try { return fs.lstatSync(wtDeps).isSymbolicLink(); } catch { return false; } })()) {
  const st = fs.lstatSync(wtDeps);
  if (st.isSymbolicLink()) {
    fs.unlinkSync(wtDeps);
  } else if (st.isDirectory() && fs.readdirSync(wtDeps).length === 0) {
    fs.rmdirSync(wtDeps);
  } else {
    console.error(`[bootstrap] 工作树里的 node_modules 不是链接且非空，拒绝删除：${wtDeps}`);
    process.exit(2);
  }
}
try {
  fs.symlinkSync(depsPath, wtDeps, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`[bootstrap] 依赖已接上：${wtDeps} → ${depsPath}`);
} catch (e: any) {
  console.error(`[bootstrap] 接依赖失败：${e.message}`);
  process.exit(2);
}

// 3. 把主树里正在改的文件复制进工作树（--files）
for (const p of filePairs) {
  fs.mkdirSync(path.dirname(p.to), { recursive: true });
  fs.copyFileSync(p.from, p.to);
  console.log(`[bootstrap] 已复制：${p.rel}`);
}

// 4. 构建（干净工作树没有构建产物，不建就跑不了门禁）
if (doBuild) {
  console.log('[bootstrap] 注意：构建会执行该提交里的 npm 脚本，只对可信提交运行');
  r = run('构建', 'npm', ['run', 'build'], worktreePath);
  if (r.code !== 0) {
    console.error('[bootstrap] 构建失败（工作树保留，方便排查）：' + worktreePath);
    process.exit(r.code);
  }
}

// 5. 可选：重录门禁归属表
if (doRegen) {
  r = run('重录归属表', 'node', ['scripts/gate-map.mts'], worktreePath);
  if (r.code !== 0) process.exit(r.code);
}

console.log('');
console.log('[bootstrap] 完成：');
console.log('  工作树：' + worktreePath);
console.log('  下一步：');
console.log(`    cd ${path.join('.worktrees', name)}`);
console.log('    node retro_boost/quickcheck.mts <门禁名>    # 改完先单跑');
console.log('    node retro_boost/chain.mts                  # 提交前跑一次全链');
console.log('  合回主树：node retro_boost/stage-mine.mts --from .worktrees/' + name);
