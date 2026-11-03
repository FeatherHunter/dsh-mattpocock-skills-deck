// retro_boost/stage-mine.mts —— 主树很脏、你只想把自己的改动暂存进去时用：把工作树里的文件对象直接写进主树索引。
//
// 解决什么问题：多个会话共用一个主树时，git status 里混着别人的改动，`git add` 很容易把别人的活
// 卷进自己的提交。这个脚本只处理你指定（或你所在工作树里）的文件：用 `git hash-object -w` 在
// 工作树里生成文件对象，再 `git update-index --cacheinfo` 直接写进索引——主树工作区里别人的改动
// 一个字不动，索引里只多你的文件。
//
// 安全边界：
//   - --from 必须与主树属于同一个 git 仓库（比较 git-common-dir），拒绝从无关仓库往索引里塞文件；
//   - 所有文件路径必须是相对路径、不能含 .. 或 .git，解析后必须分别落在工作树与主树内部；
//   - 只改索引，不碰任何工作区文件；删除项只从索引里移除，不会删磁盘文件；
//   - 不解决并发提交的竞争：暂存完请立刻 git commit，别和别的会话抢同一个索引。
//
// 用法（在主树根目录跑）:
//   node retro_boost/stage-mine.mts --from .worktrees/1852-budget-model
//   node retro_boost/stage-mine.mts --from .worktrees/1852-budget-model --files src/a.ts,tests/b.ts
//   node retro_boost/stage-mine.mts --from .worktrees/1852-budget-model --dry-run
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);

function flag(flagName: string, fallback?: string): string | undefined {
  const i = argv.indexOf('--' + flagName);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const from = flag('from');
const explicitFiles = (flag('files', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const dryRun = argv.includes('--dry-run');

if (!from) {
  console.log('用法: node retro_boost/stage-mine.mts --from .worktrees/<名字> [--files a,b] [--dry-run]');
  process.exit(1);
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const wt = path.resolve(root, from);
if (!fs.existsSync(path.join(wt, '.git'))) {
  console.error(`[stage-mine] 不是 git 工作树：${wt}`);
  process.exit(2);
}

function gitAt(cwd: string, gitArgs: string[]): string {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8' }).trim();
}

// 同一个仓库校验：git-common-dir 是主仓库的 .git 目录，两个工作树必须指向同一份。
function commonDirOf(dir: string): string {
  const raw = gitAt(dir, ['rev-parse', '--git-common-dir']);
  return path.resolve(dir, raw);
}
const mainCommon = commonDirOf(root);
const wtCommon = commonDirOf(wt);
if (mainCommon !== wtCommon) {
  console.error(`[stage-mine] 拒绝：${wt} 和主树不是同一个仓库（common-dir 不同）`);
  process.exit(2);
}

function assertRel(rel: string): string {
  if (!rel || path.isAbsolute(rel)) throw new Error('只接受仓库内相对路径：' + rel);
  const segs = rel.split(/[\\/]+/).filter(Boolean);
  if (segs.includes('..') || segs[0] === '.git') throw new Error('路径非法（含 .. 或 .git）：' + rel);
  return segs.join('/');
}
function assertInside(parent: string, child: string): string {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (c !== p && !c.startsWith(p + path.sep)) throw new Error('路径越界：' + child);
  return c;
}

let changed: string[];
if (explicitFiles.length) {
  changed = explicitFiles;
} else {
  const porcelain = gitAt(wt, ['status', '--porcelain']);
  changed = porcelain.split('\n').filter(Boolean).map(line => {
    const rel = line.slice(3).trim();
    const arrow = rel.indexOf(' -> ');
    return arrow >= 0 ? rel.slice(arrow + 4) : rel;
  });
}

let rels: string[];
try {
  rels = changed.map(assertRel);
} catch (e: any) {
  console.error('[stage-mine] ' + e.message);
  process.exit(2);
}
if (!rels.length) {
  console.log('[stage-mine] 工作树里没有改动，无事可做');
  process.exit(0);
}

const mainHead = gitAt(root, ['rev-parse', 'HEAD']);
const wtHead = gitAt(wt, ['rev-parse', 'HEAD']);
if (mainHead !== wtHead) {
  console.log(`[stage-mine] 注意：工作树 HEAD（${wtHead.slice(0, 8)}）与主树 HEAD（${mainHead.slice(0, 8)}）不同`);
}

let staged = 0;
for (const rel of rels) {
  let wtFile: string; let mainFile: string;
  try {
    wtFile = assertInside(wt, path.join(wt, rel));
    mainFile = assertInside(root, path.join(root, rel));
  } catch (e: any) {
    console.error('[stage-mine] ' + e.message);
    process.exit(2);
  }
  if (fs.existsSync(wtFile)) {
    const blob = gitAt(wt, ['hash-object', '-w', '--', rel]);
    if (dryRun) {
      console.log(`[stage-mine] 会暂存：${mainFile}（blob ${blob.slice(0, 8)}）`);
    } else {
      gitAt(root, ['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + rel]);
      console.log(`[stage-mine] 已暂存：${rel}（blob ${blob.slice(0, 8)}）`);
      staged++;
    }
  } else if (fs.existsSync(mainFile)) {
    if (dryRun) {
      console.log(`[stage-mine] 会删除索引里的：${rel}`);
    } else {
      gitAt(root, ['update-index', '--force-remove', rel]);
      console.log(`[stage-mine] 已从索引移除：${rel}（工作树里已删；磁盘文件不受影响）`);
      staged++;
    }
  } else {
    console.log(`[stage-mine] 跳过（两边都不存在）：${rel}`);
  }
}

if (dryRun) {
  console.log('[stage-mine] 只是预演，没有改索引');
} else {
  console.log('');
  console.log('[stage-mine] 索引现状：');
  console.log(gitAt(root, ['diff', '--cached', '--stat']) || '（索引没有改动）');
  console.log(`[stage-mine] 共暂存 ${staged} 个文件；主树工作区里别人的改动没有被碰`);
  console.log('[stage-mine] 提醒：索引是主树共享的，暂存完请立刻 git commit，别和别的会话抢。');
}
