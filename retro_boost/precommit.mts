// retro_boost/precommit.mts —— 提交前自检：这次到底暂存了什么、有没有混入不属于这次的路径。
//
// 解决什么问题：主树多会话共享时，stage-mine 把文件写进共享索引后，最容易出的事故是「把别人的改动
// 一起提交」或「漏掉自己的某个文件」。这个脚本只读不写：列出暂存清单、按 --expect 前缀标记意外文件、
// 跑 git diff --cached --check 查空白/冲突标记、提醒未跟踪文件。
//
// 安全边界：只调用 git 的只读命令（diff/status/ls-files），不写文件、不改索引、不发网络。
//
// 用法（在仓库根目录跑）:
//   node retro_boost/precommit.mts
//   node retro_boost/precommit.mts --expect src/refresh/,tests/verify-1852
//   node retro_boost/precommit.mts --json
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);

function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const expect = (flag('expect', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const wantJson = argv.includes('--json');
const maxSizeKb = Math.max(1, Number(flag('max-size', '2048')));

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

// 暂存清单：A 新增、M 修改、D 删除、R 重命名。路径里可能有空格，按 TAB 切分。
const stagedRaw = git(['diff', '--cached', '--name-status']).split('\n').filter(Boolean);
const staged = stagedRaw.map(line => {
  const parts = line.split('\t');
  const status = parts[0].slice(0, 1);
  const file = parts[parts.length - 1].trim();
  let size = 0;
  try { size = fs.statSync(path.join(root, file)).size; } catch { size = 0; }
  const unexpected = expect.length > 0 && !expect.some(prefix => file === prefix || file.startsWith(prefix));
  return { status, file, size, unexpected };
});

const whitespaceOut = git(['diff', '--cached', '--check']).split('\n').filter(Boolean);
const untracked = git(['status', '--porcelain']).split('\n').filter(l => l.startsWith('??')).map(l => l.slice(3).trim());
const bigFiles = staged.filter(s => s.size > maxSizeKb * 1024);
const unexpected = staged.filter(s => s.unexpected);

const report = {
  stagedCount: staged.length,
  staged,
  unexpected,
  whitespace: whitespaceOut.slice(0, 20),
  untrackedCount: untracked.length,
  untracked: untracked.slice(0, 10),
  bigFiles,
  expect,
};

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(unexpected.length || whitespaceOut.length ? 1 : 0);
}

console.log(`暂存了 ${staged.length} 个文件：`);
for (const s of staged) {
  const flagText = s.unexpected ? '  ← 不在 --expect 里' : '';
  console.log(`  ${s.status}  ${s.file}${flagText}`);
}
if (!staged.length) console.log('  （索引是空的）');

if (unexpected.length) {
  console.log('');
  console.log(`⚠ 有 ${unexpected.length} 个暂存文件不在 --expect 里，先确认是不是别人的改动：`);
  for (const s of unexpected) console.log('  ' + s.file);
}

if (whitespaceOut.length) {
  console.log('');
  console.log(`⚠ git diff --cached --check 报了 ${whitespaceOut.length} 条（空白/冲突标记，提交前修掉）：`);
  for (const line of whitespaceOut.slice(0, 10)) console.log('  ' + line);
}

if (bigFiles.length) {
  console.log('');
  console.log(`⚠ 有 ${bigFiles.length} 个大文件（> ${maxSizeKb}KB），确认不是误提交的产物：`);
  for (const s of bigFiles) console.log(`  ${s.file}  ${(s.size / 1024).toFixed(0)}KB`);
}

if (untracked.length) {
  console.log('');
  console.log(`还有 ${untracked.length} 个未跟踪文件（前 10 个）：`);
  for (const f of untracked.slice(0, 10)) console.log('  ' + f);
}

console.log('');
const bad = unexpected.length + whitespaceOut.length;
console.log(bad === 0 ? '自检通过：暂存清单与预期一致，没有空白问题。' : `自检未通过：${unexpected.length} 个意外文件、${whitespaceOut.length} 条空白问题。`);
process.exit(bad === 0 ? 0 : 1);
