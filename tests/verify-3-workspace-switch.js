#!/usr/bin/env node
/**
 * verify-3-workspace-switch.js — 多工作区快速切换不串味 门禁（地图 #278 · A 方案验收）。
 *
 * 用户高频场景：3 个不同工作区，每 5-10 分钟来回切，每天必走。同一工作区经会话快照不同
 * 字段（cwd/workspacePath/projectPath/…）上报时可能带三种写法（盘符大小写、尾斜杠、斜杠
 * 方向），host 侧按工作区分桶的抽屉若用原始串做钥匙，就会分桶重复探测、失效删不中。
 *
 * 三部分：
 *   P1 洗衣机数学 —— normalizeWorkspacePath / canonicalWorkspaceKey 单元断言
 *      （Windows 小写折叠、尾斜杠去除、盘根/UNC/POSIX 根不去斜杠、三级回退、空值回退）。
 *   P2 三区五轮推演 —— A→B→C→B→A 连续切 5 轮：旧钥匙（原始串）必然分裂成多桶（缺陷在案），
 *      新钥匙（规整钥匙）每个工作区恰好一桶且三区互不合并（无串味）。
 *   P3 接线在场守卫 —— src/host/index.js 与 detectionService.js 的全部按工作区分桶点位
 *      （repoKeys/repoRoots/chainCache/workspaceStore/wf.detect/wf.chain/wf.snapshot/wf.bind/
 *      建仓失效点/detect 入口）必须出现规整钥匙调用（门禁扫描先例：verify-client-hardcode-gate）。
 */
const fs = require('fs')
const path = require('path')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

const BS = String.fromCharCode(92) // 反斜杠（路径构造用，避免源码转义噪音）
const W = function (s) { return s.split('/').join(BS) } // 'D:/work/a' → 'D:' + BS + 'work' + BS + 'a'
const winPlat = { os: 'win32', path: require('path').win32 }
const posixPlat = { os: 'linux', path: require('path').posix }

async function main() {
  const fp = path.resolve(__dirname, '..', 'src', 'host', 'workspaceKey.js')
  const wm = await import(require('url').pathToFileURL(fp).href)
  const norm = wm.normalizeWorkspacePath
  const canon = wm.canonicalWorkspaceKey

  // ---------- P1 洗衣机数学 ----------
  console.log('P1 洗衣机数学（normalizeWorkspacePath / canonicalWorkspaceKey）')
  const eq = function (name, actual, want) { (actual === want) ? ok(name) : bad(name + ' → got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(want)) }

  // Windows：小写折叠 + 尾斜杠去除 + 斜杠方向归一
  eq('win 盘符大小写折叠', norm(W('D:/Work/Alpha'), winPlat), W('d:/work/alpha'))
  eq('win 尾斜杠去除', norm(W('d:/work/alpha/'), winPlat), W('d:/work/alpha'))
  eq('win 正斜杠归一', norm('D:/work/alpha/', winPlat), W('d:/work/alpha'))
  // Windows：三种根不被洗空
  eq('win 盘根保留', norm(W('D:/'), winPlat), W('d:/'))
  eq('win UNC 根保留', norm(W('//srv/share/'), winPlat), W('//srv/share'))
  eq('win 裸斜杠根保留', norm('/', winPlat), BS)
  // POSIX：保持大小写（仅去尾斜杠），根保留
  eq('posix 大小写敏感保留', norm('/work/Alpha/', posixPlat), '/work/Alpha')
  eq('posix 根保留', norm('/', posixPlat), '/')
  // canonical：绝对路径短路（不碰 fs）
  eq('canon 绝对路径短路', await canon(W('D:/Work/Alpha/'), { getPlatform: async function () { return winPlat } }), W('d:/work/alpha'))
  // canonical 二级：相对路径经 fs.resolve
  eq('canon 相对路径走 fs.resolve', await canon('sub', {
    getPlatform: async function () { return winPlat },
    getFs: function () { return { resolve: async function () { return { path: W('D:/Work/Alpha/sub') } } } }
  }), W('d:/work/alpha/sub'))
  // canonical 三级：裸名走 home join
  eq('canon 裸名走 home join', await canon('notes', {
    getPlatform: async function () { return Object.assign({}, winPlat, { getHome: async function () { return W('C:/Users/me') } }) }
  }), W('c:/users/me/notes'))
  // canonical：无平台降级（原样返回，不抛）
  eq('canon 无平台降级', await canon('x', {}), 'x')
  // canonical：空值回退默认 cwd
  eq('canon 空值回退默认 cwd', await canon('', {
    getPlatform: async function () { return winPlat },
    getDefaultCwd: function () { return W('D:/Work/Alpha') }
  }), W('d:/work/alpha'))

  // ---------- P2 三区五轮推演 ----------
  console.log('P2 三区五轮推演（A→B→C→B→A ×5，每区三种写法轮转）')
  const DEFAULT = W('D:/work/alpha') // DSH 进程恰在 A 区启动时的默认 cwd
  const areas = {
    A: [W('D:/work/alpha'), W('d:/work/alpha/'), 'D:/work/alpha'],
    B: [W('D:/work/beta'), W('D:/WORK/BETA'), 'D:/work/beta/'],
    C: [W('E:/work/gamma'), 'e:/work/gamma/', W('E:/work/gamma/')]
  }
  const rounds = ['A', 'B', 'C', 'B', 'A']
  const oldBuckets = { A: new Set(), B: new Set(), C: new Set() }
  const newBuckets = { A: new Set(), B: new Set(), C: new Set() }
  const oldKeyOf = function (raw) { return String(raw || DEFAULT) } // 旧推导：cwd || DEFAULT_CWD 原样
  const newKeyOf = async function (raw) { return String(await canon(raw || DEFAULT, { getPlatform: async function () { return winPlat } }) || (raw || DEFAULT)) }
  let step = 0
  for (let r = 0; r < 5; r++) {
    for (const a of rounds) {
      const writing = areas[a][step % 3]; step++
      oldBuckets[a].add(oldKeyOf(writing))
      newBuckets[a].add(await newKeyOf(writing))
    }
  }
  const splitOld = Object.keys(oldBuckets).filter(function (a) { return oldBuckets[a].size > 1 })
  if (splitOld.length === 3) ok('旧钥匙下三区写法均分裂成多桶（缺陷在案：' + splitOld.map(function (a) { return a + '=' + oldBuckets[a].size + '桶' }).join('，') + '）')
  else bad('旧钥匙缺陷推演与预期不符：分裂区数=' + splitOld.length)
  for (const a of ['A', 'B', 'C']) {
    ;(newBuckets[a].size === 1) ? ok('新钥匙下 ' + a + ' 区五轮 15 步恰好一桶（' + Array.from(newBuckets[a])[0] + '）')
      : bad('新钥匙下 ' + a + ' 区仍分裂：' + newBuckets[a].size + ' 桶 ' + JSON.stringify(Array.from(newBuckets[a])))
  }
  const trio = ['A', 'B', 'C'].map(function (a) { return Array.from(newBuckets[a])[0] })
  ;(new Set(trio).size === 3) ? ok('新钥匙下三区桶互不相同（无合并串味）') : bad('新钥匙把不同工作区洗成了同一桶：' + JSON.stringify(trio))

  // ---------- P3 接线在场守卫 ----------
  console.log('P3 接线在场守卫（src/host 全部分桶点位出现规整钥匙调用）')
  const root = path.resolve(__dirname, '..')
  const linesOf = function (rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8').split(String.fromCharCode(10)).map(function (l) {
      return (l.length && l.charCodeAt(l.length - 1) === 13) ? l.slice(0, -1) : l
    })
  }
  const hasTok = function (arr, tok) { return arr.some(function (l) { return l.indexOf(tok) >= 0 }) }

  const idx = linesOf(path.join('src', 'host', 'index.js'))
  const idxAt = function (tok) { for (let i = 0; i < idx.length; i++) { if (idx[i].indexOf(tok) >= 0) return i } return -1 }
  const guardSite = function (name, anchor, before, after) {
    const at = idxAt(anchor)
    if (at < 0) return bad(name + '：锚点未找到 ' + anchor)
    hasTok(idx.slice(Math.max(0, at - before), at + after + 1), 'canonical') ? ok(name) : bad(name + '：锚点窗口内未见规整钥匙调用')
  }

  const g1 = idxAt('async function getRepoRoot(')
  ;(g1 >= 0 && hasTok(idx.slice(g1, g1 + 5), 'canonical')) ? ok('getRepoRoot 首行规整') : bad('getRepoRoot 首行未见规整钥匙')
  const g2 = idxAt('async function getRepoKey(')
  ;(g2 >= 0 && hasTok(idx.slice(g2, g2 + 5), 'canonical')) ? ok('getRepoKey 首行规整') : bad('getRepoKey 首行未见规整钥匙')
  guardSite('wf.chain 入口规整', "harness.handle('wf.chain'", 1, 6)
  guardSite('wf.detect 入口规整', "harness.handle('wf.detect'", 1, 6)
  guardSite('wf.snapshot 入口规整', "harness.handle('wf.snapshot'", 1, 6)
  guardSite('wf.bind 入口规整', "harness.handle('wf.bind'", 1, 8)
  const d1 = idxAt('delete repoKeys[')
  ;(d1 >= 0 && hasTok(idx.slice(Math.max(0, d1 - 6), d1 + 1), 'canonical')) ? ok('建仓失效点 repoKeys 删除前规整') : bad('repoKeys 删除前未见规整钥匙（删不中即缓存僵尸）')
  const d2 = idxAt('delete repoRoots[')
  ;(d2 >= 0 && hasTok(idx.slice(Math.max(0, d2 - 6), d2 + 1), 'canonical')) ? ok('建仓失效点 repoRoots 删除前规整') : bad('repoRoots 删除前未见规整钥匙（删不中即缓存僵尸）')
  hasTok(idx, 'workspaceKey.js') ? ok('index.js 引入 workspaceKey 模块') : bad('index.js 未引入 workspaceKey 模块')

  const ds = linesOf(path.join('src', 'host', 'tracker', 'detection', 'detectionService.js'))
  let dsAt = -1
  for (let i = 0; i < ds.length; i++) { if (ds[i].indexOf('async function detect(') >= 0) { dsAt = i; break } }
  ;(dsAt >= 0 && hasTok(ds.slice(Math.max(0, dsAt - 8), dsAt + 8), 'canonical')) ? ok('detectionService.detect 入口规整 handle.cwd') : bad('detectionService.detect 入口未见规整调用')
  hasTok(ds, 'workspaceKey.js') ? ok('detectionService 引入 workspaceKey 模块') : bad('detectionService 未引入 workspaceKey 模块')

  console.log('')
  console.log('结果：' + passed + ' 通过，' + (failed ? '存在失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('verify-3-workspace-switch 自身异常：', e); process.exit(1) })
