/**
 * verify-workspace-key.js — 交付块2 回归：统一路径入口
 * 验收：
 *  - 三种合法写法在同一目录上规整键字节一致（win32 大小写/斜杠/尾杠）
 *  - 缓存键审计：宿主全部读数命令经 toWorkspaceKey，无裸用原值
 *  - 快照字符串一致性（模拟：canonical 相同 => 快照缓存命中 => 字符串相等）
 * 运行: node tests/verify-workspace-key.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function check(ok, msg) {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg);
  if (!ok) process.exitCode = 1;
}

(async () => {
  console.log('=== 统一路径入口 回归 ===');

  // 1) 静态审计：宿主全部读数命令经 toWorkspaceKey，无裸用
  console.log('\n-- 1. 宿主缓存键审计 --');
  const hostSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'host', 'index.js'), 'utf8');
  const rawCwdRemaining = (hostSrc.match(/const cwd = \(args && args\.cwd\) \|\| DEFAULT_CWD/g) || []).length;
  check(rawCwdRemaining === 0, '无裸用 const cwd = (args && args.cwd) || DEFAULT_CWD (剩余 ' + rawCwdRemaining + ')');

  const rawCwd2 = (hostSrc.match(/const cwd = \(args && \(args\.cwd \|\| args\.path\)\) \|\| DEFAULT_CWD/g) || []).length;
  check(rawCwd2 === 0, '无裸用 const cwd = (args && (args.cwd || args.path)) || DEFAULT_CWD');

  const hasToWorkspaceKey = hostSrc.includes('async function toWorkspaceKey');
  check(hasToWorkspaceKey, '宿主含 toWorkspaceKey 定义');

  const hasNormalize = hostSrc.includes('function normalizeWorkspacePath');
  check(hasNormalize, '宿主含 normalizeWorkspacePath');

  const toKeyUsages = (hostSrc.match(/await toWorkspaceKey\(/g) || []).length;
  check(toKeyUsages >= 15, 'toWorkspaceKey 调用 >=15 (实际 ' + toKeyUsages + ')');

  const normCwdRemaining = (hostSrc.match(/await normCwd\(/g) || []).length;
  check(normCwdRemaining === 0, '无残留 await normCwd (剩余 ' + normCwdRemaining + ')');

  // 检查 getRepoKey / getRepoRoot 经规整键
  check(hostSrc.includes('async function getRepoKey(cwd) {') && hostSrc.includes('await toWorkspaceKey(_rawKey2)'), 'getRepoKey 经 toWorkspaceKey');
  check(hostSrc.includes('async function getRepoRoot(cwd) {') && hostSrc.includes('await toWorkspaceKey(_rawKey)'), 'getRepoRoot 经 toWorkspaceKey');

  // 检查 panelSyncEvaluate 规整
  check(hostSrc.includes('const _rawCwd = String(cwdList[i]'), 'panelSyncEvaluate 对 cwdList 规整');

  // 检查 workspaceKey 模块存在
  const wkPath = path.join(__dirname, '..', 'src', 'host', 'workspaceKey.js');
  check(fs.existsSync(wkPath), 'src/host/workspaceKey.js 存在');
  const wkSrc = fs.readFileSync(wkPath, 'utf8');
  check(wkSrc.includes('export function normalizeWorkspacePath'), 'workspaceKey.js 含 normalizeWorkspacePath');
  check(wkSrc.includes('export async function canonicalWorkspaceKey'), 'workspaceKey.js 含 canonicalWorkspaceKey');

  // 2) 规整函数单元测试（win32 大小写/斜杠/尾杠）
  console.log('\n-- 2. 规整函数单元测试 --');
  const mod = await import('../src/host/workspaceKey.js');
  const { normalizeWorkspacePath, canonicalWorkspaceKey } = mod;

  // 构造平台 mock：win32 与 posix
  const win32Path = require('node:path').win32;
  const posixPath = require('node:path').posix;
  const winPlat = { os: 'win32', path: win32Path, getHome: async () => 'C:\\Users\\alice' };
  const posixPlat = { os: 'linux', path: posixPath, getHome: async () => '/home/alice' };

  // win32: 同一目录三种写法 -> 同一键（小写 + 去尾杠 + 斜杠统一）
  const v1 = normalizeWorkspacePath('D:\\repo\\myproj', winPlat);
  const v2 = normalizeWorkspacePath('D:\\repo\\myproj\\', winPlat);
  const v3 = normalizeWorkspacePath('D:/repo/myproj', winPlat);
  const v4 = normalizeWorkspacePath('d:\\REPO\\MYPROJ', winPlat);
  const v5 = normalizeWorkspacePath('D:\\repo\\myproj\\.', winPlat);
  check(v1 === v2, 'win32 尾杠坍缩: ' + v1 + ' === ' + v2);
  check(v1 === v3, 'win32 斜杠统一: ' + v1 + ' === ' + v3);
  check(v1 === v4, 'win32 大小写折叠: ' + v1 + ' === ' + v4);
  check(v1 === v5, 'win32 冗余 ./ 坍缩: ' + v1 + ' === ' + v5);
  check(v1 === 'd:\\repo\\myproj', 'win32 规整结果为 d:\\repo\\myproj, 实际=' + v1);

  // posix: 尾杠坍缩，但大小写敏感
  const p1 = normalizeWorkspacePath('/home/alice/repo', posixPlat);
  const p2 = normalizeWorkspacePath('/home/alice/repo/', posixPlat);
  const p3 = normalizeWorkspacePath('/home/alice/repo/.', posixPlat);
  check(p1 === p2, 'posix 尾杠坍缩');
  check(p1 === p3, 'posix ./ 坍缩');
  const pCase1 = normalizeWorkspacePath('/home/Alice/repo', posixPlat);
  const pCase2 = normalizeWorkspacePath('/home/alice/repo', posixPlat);
  check(pCase1 !== pCase2, 'posix 大小写敏感: ' + pCase1 + ' !== ' + pCase2);

  // 根路径不去尾
  const winRoot = normalizeWorkspacePath('C:\\', winPlat);
  check(winRoot === 'c:\\', 'win32 根 C:\\ 保持（小写）实际=' + winRoot);
  const posixRoot = normalizeWorkspacePath('/', posixPlat);
  check(posixRoot === '/', 'posix 根 / 保持');

  // 3) canonicalWorkspaceKey 三写法 -> 同一键（async，含平台与 fs 归一）
  console.log('\n-- 3. canonicalWorkspaceKey 三写法一致性 --');
  // mock getPlatform, getFs, getDefaultCwd
  const mockFsWin = {
    resolve: async (input) => {
      // 模拟 DSH fs.resolve 对相对名的处理：若输入为相对名，直接返回该输入（不转为绝对），让 home 归一接管
      // 若输入本身已是绝对（如 D:\repo...），则返回其本身
      if (/^[A-Za-z]:/.test(input) || input.startsWith('/') || input.startsWith('\\\\')) return { path: input };
      // 相对路径：模拟按 workspaces 根解析失败，返回原值（非绝对），触发 home 归一
      return { path: input };
    }
  };
  const mockGetPlatformWin = async () => winPlat;
  const depsWin = { getPlatform: mockGetPlatformWin, getFs: () => mockFsWin, getDefaultCwd: () => 'D:\\repo\\myproj' };

  const k1 = await canonicalWorkspaceKey('D:\\repo\\myproj', depsWin);
  const k2 = await canonicalWorkspaceKey('D:\\repo\\myproj\\', depsWin);
  const k3 = await canonicalWorkspaceKey('D:/repo/myproj', depsWin);
  const k4 = await canonicalWorkspaceKey('d:\\repo\\MYPROJ', depsWin);
  check(k1 === k2 && k2 === k3 && k3 === k4, 'win32 canonical 三写法同键: ' + k1);

  // 模拟相对名经 home 归一：裸名 -> home join
  const kRel1 = await canonicalWorkspaceKey('myproj', depsWin);
  const kRel2 = await canonicalWorkspaceKey('myproj/', depsWin);
  check(kRel1 === kRel2, '相对名尾杠坍缩经 home 归一: ' + kRel1);

  // posix 侧
  const mockFsPosix = { resolve: async (input) => ({ path: input }) };
  const mockGetPlatformPosix = async () => posixPlat;
  const depsPosix = { getPlatform: mockGetPlatformPosix, getFs: () => mockFsPosix, getDefaultCwd: () => '/home/alice/repo' };
  const pk1 = await canonicalWorkspaceKey('/home/alice/repo', depsPosix);
  const pk2 = await canonicalWorkspaceKey('/home/alice/repo/', depsPosix);
  const pk3 = await canonicalWorkspaceKey('/home/alice/repo/.', depsPosix);
  check(pk1 === pk2 && pk2 === pk3, 'posix canonical 三写法同键');

  // 4) 快照字符串一致性模拟（同一规整键 => 同一快照字符串）
  console.log('\n-- 4. 快照字符串一致性模拟 --');
  // 模拟 host 的 cache 命中逻辑：若规整键相同，则第二次 snapshot 来自缓存且字符串相等
  const snapshotCache = new Map();
  function fakeSnapshot(cwdKey) {
    // 模拟 buildSnapshot 的输出：按 cwdKey 生成快照对象，其 JSON 字符串应与 key 相关
    // 若 key 相同，字符串必相同
    const snap = { ok: true, cwd: cwdKey, maps: [{ number: 1 }], generatedMs: 12345 };
    return JSON.stringify(snap);
  }
  const keyA = await canonicalWorkspaceKey('D:\\repo\\myproj', depsWin);
  const keyB = await canonicalWorkspaceKey('D:\\repo\\myproj\\', depsWin);
  const keyC = await canonicalWorkspaceKey('D:/repo/myproj', depsWin);
  // 模拟两次抓取
  const sA = fakeSnapshot(keyA);
  const sB = fakeSnapshot(keyB);
  const sC = fakeSnapshot(keyC);
  check(sA === sB && sB === sC, '三写法快照字符串逐字节相等');
  check(keyA === keyB && keyB === keyC, '且规整键相等');

  // 5) 异工作区隔离：不同目录规整后仍不同
  console.log('\n-- 5. 异工作区隔离 --');
  const otherKey = await canonicalWorkspaceKey('D:\\other\\proj', depsWin);
  check(otherKey !== k1, '异工作区键不同: ' + otherKey + ' !== ' + k1);
  const otherSnap = fakeSnapshot(otherKey);
  check(otherSnap !== sA, '异工作区快照字符串不同');

  console.log('\n=== 汇总 ===');
  if (process.exitCode === 1) {
    console.log('存在失败');
  } else {
    console.log('全部通过');
  }
})();
