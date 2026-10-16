#!/usr/bin/env node
/**
 * verify-656-subworkspace-acceptance.js — 子目录工作区场景验收门禁（地图 #647 · 票 #656）
 *
 * 判据的出处是架构决定记录 docs/adr/20260918-subworkspace-identity-root.md 第 4 节，票 #656 把它
 * 分成四组。每条断言都先说清「守的是哪条不变式」，失败时把那句话原样打出来，不只有一个行号。
 *
 *   A. 锚点判定的边界情形：从会话所选目录逐层向上，最近一个「自带 .git（文件或目录都算）」或
 *      「自带主锚文件 docs/agents/issue-tracker.md」的目录就是工作区根；两种标记同等优先、谁近听谁；
 *      一路到盘符根 / 文件系统根 / UNC 根都没有，就用所选目录本身；同一目录的几种写法洗成同一把钥匙。
 *   B. 四个抽屉的分桶：面板快照、检查链快照、后端绑定、仓库引用，在「仓库根 / 子目录 / 兄弟目录」
 *      三种形态下——同一个工作区根里的会话必须同桶，不同工作区根必须不同桶。其中「后端绑定」这一格
 *      #1138 起记录只落在工作区文件 docs/agents/workspace.yaml 里（注册表里那份进程内副本连同
 *      bind/bound/allBindings 三个口子已经删掉），所以 B 组自己带一条内存文件服务来落这份文件，
 *      再让统一判定出口 decideBackend 从它读回来。
 *   C. 写路径：子目录会话里不许出现第二套 .scratch（票仓与建票目录）、不许出现第二份
 *      docs/agents/label-colors.json；初始化产出的主锚文件只认工作区根那一份。
 *   D. 性能与体验：同一把钥匙 30 秒内只判定一次（数真探测次数，第二次必须为零）。
 *
 * 测法（尽量跑真代码，不另写仿制品）：
 *   A / C —— 真夹具目录 + 真判定函数（src/host/workspaceKey.js）与真后端路径函数
 *            （tracker/backends/markdown/path.js、label-colors.js、remotePredicates.js、explicitDetector.js）。
 *   B —— 真夹具算出来的这把钥匙，喂给真客户端缓存表（store-snapshot.js / store-prefs.js 的切片）与
 *        真注册表（src/tracker/registry/core.ts），并真的走一遍宿主的 wf.bind / wf.selection 处理体
 *        （workspaceCwd.js）与统一判定出口（tracker/detection/backendDecision.ts）；「后端绑定」这一格
 *        的落点由本门禁自己那条内存文件服务（makeAuthorityFs）供着——它只替换磁盘，判定仍是生产那一份。
 *   D —— 在同一把钥匙上数真探测次数（第二次必须为零）。
 *   E —— 本门禁与票面点名的两条既有用例都在 npm run verify 链里。
 *
 * 可选真机样本腿：默认跳过。设 DSW_VERIFY656_REAL=1 且本机存在样本目录时，额外在真样本上跑一遍。
 *   样本不在本机时只打一行说明、不计入断言——门禁本身不依赖任何机器上的具体路径。
 *
 * 用法：node tests/verify-656-subworkspace-acceptance.js
 */
const fsx = require('fs')
const fsp = fsx.promises
const nodePath = require('path')
const nodeOs = require('os')
const { pathToFileURL } = require('url')
// 本文件按文本求值统一走共用入口 compileFn：把真源文本配假零件造成模块（理由与用法见 tests/lib/eval-probe.js 文件头）。
const { compileFn } = require('./lib/eval-probe.js')

const ROOT = nodePath.resolve(__dirname, '..')
const read = (rel) => fsx.readFileSync(nodePath.join(ROOT, rel), 'utf8')
const noExport = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
/**
 * 一条判据 = 一句不变式。cond 为假时把不变式原文打进失败行，并记进最后的小结。
 * @param {boolean} cond 这次实测是否守住
 * @param {string} invariant 不变式原文（人类读的那句话）
 * @param {string} [detail] 实测值之类的补充，只在失败时打
 */
function must(cond, invariant, detail) {
  total++
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

// ── 本机平台与夹具文件服务 ────────────────────────────────────────────────
const OS = process.platform === 'win32' ? 'win32' : (process.platform === 'darwin' ? 'darwin' : 'linux')
const PLATFORM = { os: OS, path: nodePath, async getHome() { return nodeOs.homedir() } }
const target = (t) => (t && typeof t === 'object') ? String(t.path || t.targetKey || '') : String(t)
/**
 * 照 DSH 文件服务的形状做一个真读盘的服务：lstat 收路径，stat / listDir / readText 收 resolve 出来的 target。
 * counter 记「探测次数」（读盘问某条路径在不在），D 组靠它证明第二次判定一次盘都没读。
 */
function makeFsSvc(counter) {
  return {
    async resolve(p, opts) {
      const abs = nodePath.isAbsolute(String(p)) ? String(p) : nodePath.resolve((opts && opts.cwd) || process.cwd(), String(p))
      return { path: abs, targetKey: abs }
    },
    async lstat(p) { if (counter) counter.probes++; return fsp.lstat(target(p)) },   // 不在时抛错，与真服务同形
    async stat(t) { if (counter) counter.probes++; return fsp.stat(target(t)) },
    async listDir(t) { if (counter) counter.probes++; return fsp.readdir(target(t)) },
    async readText(t) { return fsp.readFile(target(t), 'utf8') },
  }
}

let BASE = null
function cleanup() { try { if (BASE) fsx.rmSync(BASE, { recursive: true, force: true }) } catch (e) {} }

/**
 * #1138：B 组「后端绑定」这一格要真落一份文件，所以给这一组一条**门禁自己管着的文件通道**。
 *
 * 为什么不能拿真盘上的夹具目录当落点：夹具目录是只读用意的（只放 A/C 两组要读的那些标记文件），
 * 往它里面写一份 docs/agents/workspace.yaml 会改掉夹具树本身，后面几组读到的世界就不是同一棵了。
 * 这里落在一张内存表里，键是文件路径的规范写法；它只做文件服务该做的三件事（resolve / readText /
 * writeText / mkdir），不做任何判定——判定仍由生产那一个出口做。
 */
function makeAuthorityFs() {
  const files = new Map()
  const key = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const abs = (rel, cwd) => (nodePath.isAbsolute(String(rel)) ? String(rel) : nodePath.resolve(String(cwd || BASE), String(rel)))
  return {
    /** 这一格里真写下来的内容（按读的原样回）：写没写成，靠它取证。 */
    read(rel, cwd) {
      const k = key(abs(rel, cwd))
      return files.has(k) ? files.get(k) : null
    },
    fs: {
      async resolve(rel, opts) { return { path: abs(rel, opts && opts.cwd), rel: String(rel), cwd: String((opts && opts.cwd) || '') } },
      async readText(t) {
        const p = String((t && t.path) || t)
        const v = files.get(key(p))
        if (v == null) throw Object.assign(new Error('ENOENT: no such file or directory, open \'' + p + '\''), { code: 'ENOENT' })
        return v
      },
      async writeText(t, content) { files.set(key(String((t && t.path) || t)), String(content)) },
      async mkdir() { return undefined },
    },
  }
}

async function main() {
  const wm = await import(url('src/host/workspaceKey.js'))
  const normPath = (p) => wm.normalizeWorkspacePath(p, PLATFORM)
  const canon = (raw) => wm.canonicalWorkspaceKey(raw, { getPlatform: async () => PLATFORM, getFs: () => fixtureFs, getDefaultCwd: () => BASE })

  // ── 夹具树（真目录、真文件）──────────────────────────────────────────────
  // 一棵树里把票面点名的每种情形各放一处，A / B / C 三组都在它上面跑。
  //   base/repo/                        自带 .git 与主锚（两种标记同层）→ 仓库根
  //   base/repo/packages/a/             子目录（自己与祖先都没有标记）→ 归仓库根
  //   base/repo/packages/b/deep/        更深的子目录 → 归仓库根
  //   base/repo/vendor/nested/          自带 .git（嵌套仓库）→ 自成一套
  //   base/repo/vendor/nested/leaf/     嵌套仓库里的目录 → 归那个嵌套仓库
  //   base/repo/standalone/             自带主锚文件（别人在这里初始化过）→ 自成一套
  //   base/gitonly/                     自带 .git、没有主锚 → 归它（这一档就是「没有主锚时用 git 根」）
  //   base/mdws/                        本地 Markdown 工作区：只有主锚、没有 .git → 归它
  //   base/outer/                       外层带主锚
  //   base/outer/inner/                 内层自带 .git（更近）→ 截住上溯，不跳到 outer
  //   base/plain/sub/                   一路上去一个标记都没有 → 根就是它自己
  //   base/sibling/                     另一棵工作区（兄弟目录）→ 与 repo 不同根
  BASE = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'subws656-'))
  const at = (rel) => nodePath.isAbsolute(rel) ? rel : nodePath.join(BASE, rel)
  const put = (rel, content) => {
    const abs = at(rel)
    fsx.mkdirSync(nodePath.dirname(abs), { recursive: true })
    fsx.writeFileSync(abs, content)
    return abs
  }
  const mkdir = (rel) => { const abs = at(rel); fsx.mkdirSync(abs, { recursive: true }); return abs }
  const W = (rel) => nodePath.join(BASE, rel)
  put(W('repo/.git/config'), '[core]\n\trepositoryformatversion = 0\n')
  put(W('repo/docs/agents/issue-tracker.md'), '# Issue tracker: GitHub\n\n本仓库的 issue 在 GitHub 上。\n')
  const RAW = {
    repo: mkdir('repo'),
    sub: mkdir('repo/packages/a'),
    subDeep: mkdir('repo/packages/b/deep'),
    nested: W('repo/vendor/nested'),
    nestedLeaf: W('repo/vendor/nested/leaf'),
    standalone: W('repo/standalone'),
    gitonly: W('gitonly'),
    gitonlyDeep: W('gitonly/deep'),
    mdws: W('mdws'),
    mdwsDeep: W('mdws/sub/deep'),
    outer: W('outer'),
    inner: W('outer/inner'),
    innerLeaf: W('outer/inner/leaf'),
    plainSub: mkdir('plain/sub'),
    sibling: W('sibling'),
    cacheProbe: mkdir('repo/packages/cache-probe/deep'),
  }
  mkdir('repo/vendor/nested/leaf')
  put(W('repo/vendor/nested/.git/config'), '[core]\n')
  put(W('repo/standalone/docs/agents/issue-tracker.md'), '# Issue tracker: GitHub\n')
  put(W('gitonly/.git/config'), '[core]\n')
  mkdir('gitonly/deep')
  put(W('mdws/docs/agents/issue-tracker.md'), '# Issue tracker: Local Markdown\n\n.scratch\n')
  mkdir('mdws/sub/deep')
  put(W('outer/docs/agents/issue-tracker.md'), '# Issue tracker: GitHub\n')
  put(W('outer/inner/.git/config'), '[core]\n')
  mkdir('outer/inner/leaf')

  const counter = { probes: 0 }
  const fixtureFs = makeFsSvc(counter)
  const deps = { getPlatform: async () => PLATFORM, getFs: () => fixtureFs }

  // 三把钥匙：仓库根、它下面的子目录、另一棵工作区（兄弟目录）。B 组四个抽屉都按这三把说话。
  const K = {
    repo: await canon(RAW.repo),
    sub: await canon(RAW.sub),
    subDeep: await canon(RAW.subDeep),
    sibling: await canon(RAW.sibling),
  }

  title('A) 锚点判定的边界情形（真夹具 + 真判定函数）')

  // —— A1 最近一个自带主锚文件的祖先 ——
  {
    const r = await wm.resolveWorkspaceRoot(normPath(RAW.mdwsDeep), deps)
    must(r.root === normPath(RAW.mdws) && r.source === 'anchor',
      '本地 Markdown 工作区：没有 .git 时，最近一个自带 docs/agents/issue-tracker.md 的祖先目录就是工作区根',
      'root=' + r.root + ' source=' + r.source)
  }
  // —— A2 没有主锚文件时用 git 根 ——
  {
    const r = await wm.resolveWorkspaceRoot(normPath(RAW.gitonlyDeep), deps)
    must(r.root === normPath(RAW.gitonly) && r.source === 'git',
      '目录自己与逐层祖先都没有主锚文件时，工作区根就是最近那个自带 .git 的祖先（git 根那一档照样成立）',
      'root=' + r.root + ' source=' + r.source)
  }
  // —— A3 嵌套仓库自成一套 ——
  {
    const r = await wm.resolveWorkspaceRoot(normPath(RAW.nestedLeaf), deps)
    must(r.root === normPath(RAW.nested) && r.source === 'git',
      '子目录自带 .git（嵌套仓库）时停在自己那一层，自成一套，不被外层仓库吞掉',
      'root=' + r.root + ' source=' + r.source)
  }
  // —— A4 自带主锚文件的子目录自成一套 ——
  {
    const r = await wm.resolveWorkspaceRoot(normPath(RAW.standalone), deps)
    must(r.root === normPath(RAW.standalone) && r.source === 'anchor',
      '子目录自带主锚文件（别人在这里初始化过）时同样自成一套，不并进外层仓库',
      'root=' + r.root + ' source=' + r.source)
  }
  // —— A5 一路到顶都没有标记 ——
  {
    const r = await wm.resolveWorkspaceRoot(normPath(RAW.plainSub), deps)
    must(r.root === normPath(RAW.plainSub) && r.source === 'self',
      '一路上去一个标记都没有（不在任何 git 仓库里）时，工作区根就是所选目录自己，不做任何上溯',
      'root=' + r.root + ' source=' + r.source)
  }
  // —— A6 盘符根与 UNC 根：到顶就停，不转圈 ——
  {
    const noMarker = makeFsSvc(null)          // 真服务形状但一条都不存在：只剩「往上走」这一件事
    const drive = await wm.resolveWorkspaceRoot('d:\\', { platform: PLATFORM, getFs: () => noMarker })
    const unc = await wm.resolveWorkspaceRoot('//srv/share', { platform: PLATFORM, getFs: () => noMarker })
    must(drive.root === 'd:\\' && drive.source === 'self' && unc.root === '//srv/share' && unc.source === 'self',
      '盘符根与 UNC 共享根都是上溯的终点：到顶就停，工作区根就是那一条根目录（不会往上溢出、也不会转不出来）',
      'drive=' + JSON.stringify(drive) + ' unc=' + JSON.stringify(unc))
    must(wm.parentWorkspaceDir('d:\\') === null && wm.parentWorkspaceDir('//srv/share') === null && wm.parentWorkspaceDir('/') === null,
      '「再往上一层」这件事在盘符根、UNC 共享根、文件系统根上都答「没有上一层」',
      'd:\\→' + wm.parentWorkspaceDir('d:\\') + ' //srv/share→' + wm.parentWorkspaceDir('//srv/share') + ' /→' + wm.parentWorkspaceDir('/'))
    must(wm.parentWorkspaceDir('//srv/share/a') === '//srv/share' && wm.parentWorkspaceDir('d:/a/b') === 'd:/a',
      'UNC 共享根下面的目录逐层向上走得到共享根这一层（该停的地方就是共享根本身）',
      '//srv/share/a→' + wm.parentWorkspaceDir('//srv/share/a') + ' d:/a/b→' + wm.parentWorkspaceDir('d:/a/b'))
  }
  // —— A7 同一条目录的几种写法洗成同一把钥匙 ——
  {
    const k2 = await canon(RAW.sub)
    const k3 = await canon(nodePath.join(RAW.sub, '.') + nodePath.sep)
    const rootLoose = await canon(RAW.repo + nodePath.sep)
    must(k3 === k2 && rootLoose === K.repo,
      '同一条目录的写法差异（尾斜杠、多余的分隔符）洗成同一把钥匙；锚根之后仍然同一把',
      'plain=' + k2 + ' loose=' + k3 + ' rootLoose=' + rootLoose + ' root=' + K.repo)
    const kUpper = await canon(RAW.sub.toUpperCase())
    if (OS === 'win32') {
      must(kUpper === k2,
        '盘符与目录名大小写不同的写法是同一把钥匙（Windows 的规矩：钥匙统一折成小写）',
        'upper=' + kUpper + ' plain=' + k2)
    } else {
      must(kUpper !== k2,
        'POSIX 上路径大小写是有意义的：两种写法是两个工作区（与 shared/workspaceKey.js 里定的规矩一致）',
        'upper=' + kUpper + ' plain=' + k2)
    }
  }
  // —— A8 更近的 .git 截住上溯 ——
  {
    const r = await wm.resolveWorkspaceRoot(normPath(RAW.innerLeaf), deps)
    must(r.root === normPath(RAW.inner) && r.root !== normPath(RAW.outer),
      '更近的那一层自带 .git 时截住上溯：不会跳到外层那个带主锚文件的目录去',
      'root=' + r.root + ' source=' + r.source)
  }
  // —— A9 探测能力缺失时诚实回退，且回退结论不进缓存 ——
  // 这一档必须用**没被问过**的目录：判定结果有 30 秒缓存，缓存命中时压根不会再去看文件服务，
  // 拿一条已经问过的目录来测「没有探测能力时会怎样」，测的其实是缓存。
  {
    const noFsDir = mkdir('mdws/sub/nofs-deep')
    const noFs = await wm.resolveWorkspaceRoot(normPath(noFsDir), { platform: PLATFORM, getFs: () => null })
    must(noFs.root === normPath(noFsDir) && noFs.source === 'no-fs' && noFs.cache === 'skip',
      '文件服务拿不到时回退「所选目录自己」，如实标注这不是真结论，绝不让面板因此失败',
      JSON.stringify(noFs))
    const later = await wm.resolveWorkspaceRoot(normPath(noFsDir), deps)
    must(later.root === normPath(RAW.mdws) && later.source === 'anchor',
      '「这次没有探测能力」这个回退结论不被记成永久答案：探测能力回来后，同一条目录按规矩得出真结论',
      JSON.stringify(later))
    const noProbeDir = mkdir('gitonly/noprobe-deep')
    const noProbe = await wm.resolveWorkspaceRoot(normPath(noProbeDir), { platform: PLATFORM, getFs: () => ({}) })
    must(noProbe.root === normPath(noProbeDir) && noProbe.source === 'no-probe',
      '文件服务在、但它没有「问某条路径在不在」的能力时，同样诚实回退，不猜一个根出来',
      JSON.stringify(noProbe))
  }

  title('B) 四个抽屉的分桶（仓库根 / 子目录 / 兄弟目录）')

  must(K.sub === K.repo && K.subDeep === K.repo && K.sibling !== K.repo,
    '三把钥匙先说清：同一个工作区根下的子目录与根算同一把钥匙（同桶），兄弟目录算另一把（不同桶）',
    'repo=' + K.repo + ' sub=' + K.sub + ' subDeep=' + K.subDeep + ' sibling=' + K.sibling)

  // —— 客户端那几样抽屉：跑真内核代码（去掉行首 export 后当纯函数求值）——
  const keyOfSrc = noExport(read('src/shared/workspaceKey.js'))
  // 切出来的这段源码不需要外部变量：改走共用入口 compileFn，参数表传空数组。
  const keyOfFn = compileFn([], keyOfSrc + '\nreturn keyOf')()
  const snapSrc = read('src/client/kernel/store-snapshot.js')
  const wsKeyBlock = noExport(snapSrc.slice(snapSrc.indexOf('export const workspaceRootByCwd'), snapSrc.indexOf('export const shared = makeStore()')))
  const storeBlock = noExport(snapSrc.slice(snapSrc.indexOf('export const getCachedSnapshot'), snapSrc.indexOf('export const lastProbeAtByCwd')))
  const probeBlock = noExport(snapSrc.slice(snapSrc.indexOf('export const lastProbeAtByCwd'), snapSrc.indexOf('export const SNAP_DISK_CAP')))
  const chainBlock = noExport(snapSrc.slice(snapSrc.indexOf('export const getChainCacheKey'), snapSrc.indexOf('export const hydrateFromCache')))
  // 真源文本与假零件一起求值：改走共用入口 compileFn，参数名照原样逐个列出。
  const C = compileFn(
    ['keyOf', 'snapshotByCwd', 'chainByCwd', 'shared', 'stores', 'emit',
      'dswsLogHash', 'isEnabled', 'log', 'touchLRUClient', 'diskPutSnapshot', 'CHAIN_CWD_LRU_MAX'],
    keyOfSrc + '\n' + wsKeyBlock + '\n' + storeBlock + '\n' + probeBlock + '\n' + chainBlock + '\n' +
    'return { wsKeyOf: wsKeyOf, rememberWorkspaceRoot: rememberWorkspaceRoot,' +
    ' getCachedSnapshot: getCachedSnapshot, setCachedSnapshot: setCachedSnapshot, snapshots: snapshotByCwd,' +
    ' getChainCacheKey: getChainCacheKey, getCachedChain: getCachedChain, setCachedChain: setCachedChain, chains: chainByCwd }'
  )(
    keyOfFn, new Map(), new Map(), { cwd: '' }, {}, () => {}, () => 'h', () => false, () => {},
    (m, k, v) => m.set(k, v), () => {}, 20
  )

  const prefsSrc = read('src/client/kernel/store-prefs.js')
  // 同一手法：真源文本配假 localStorage 等零件，统一走共用入口 compileFn。
  const P = compileFn(
    ['keyOf', 'wsKeyOf', 'localStorage', 'log', 'emit', 'shared', 'stores'],
    noExport(prefsSrc.slice(prefsSrc.indexOf('export const selectionByCwd = {}'))) + '\n' +
    'return { getCachedSelection: getCachedSelection, setCachedSelection: setCachedSelection,' +
    ' getCachedRepository: getCachedRepository, setCachedRepository: setCachedRepository }'
  )(
    keyOfFn, C.wsKeyOf,
    { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    () => {}, () => {}, { cwd: '' }, {}
  )

  // —— B1 面板快照 ——
  // 真流程：宿主回包带着工作区根（#652 起 canonicalKey 算出来的那一条），客户端先记住它再落缓存。
  const subSnap = { ok: true, maps: [], issues: [], workspaceRoot: RAW.repo, generatedMs: 2 }
  C.rememberWorkspaceRoot(RAW.sub, RAW.repo)        // 子目录会话第一次收到回包时学到根
  C.setCachedSnapshot(RAW.sub, subSnap)             // 它把快照落了缓存
  must(C.getCachedSnapshot(RAW.sub) === subSnap && C.getCachedSnapshot(RAW.repo) === subSnap,
    '面板快照：子目录会话落下的那一份，根会话按根就能读到（同一个工作区一份数据，不占两个桶）',
    'sub=' + !!C.getCachedSnapshot(RAW.sub) + ' root=' + !!C.getCachedSnapshot(RAW.repo))
  C.rememberWorkspaceRoot(RAW.subDeep, RAW.repo)    // 同一个工作区里另一个子目录会话也学到了根
  C.rememberWorkspaceRoot(RAW.sibling, RAW.sibling)
  must(C.getCachedSnapshot(RAW.subDeep) === subSnap && C.getCachedSnapshot(RAW.sibling) === null && C.snapshots.size === 1,
    '面板快照：同一个工作区里几个子目录会话读到的是同一份（面板不空着），兄弟工作区读不到它（不串台）',
    'subDeep=' + !!C.getCachedSnapshot(RAW.subDeep) + ' sibling=' + !!C.getCachedSnapshot(RAW.sibling) + ' 表里条目=' + C.snapshots.size)
  must(C.getCachedSnapshot(RAW.sub) === C.getCachedSnapshot(RAW.repo) && C.getCachedSnapshot(RAW.repo).workspaceRoot === RAW.repo,
    '面板快照里那份数据自报的工作区根就是工作区根这一条（界面上的归属提示也按它判）',
    JSON.stringify(C.getCachedSnapshot(RAW.repo)))

  // —— B2 检查链快照 ——
  {
    const chain = { steps: [{ id: 'tracker:initialized', status: 'done' }], chainState: 'allDone' }
    C.setCachedChain(RAW.sub, 'github', 'zh', chain)
    const sameKey = C.getChainCacheKey(RAW.sub, 'github', 'zh') === C.getChainCacheKey(RAW.repo, 'github', 'zh')
    const otherKey = C.getChainCacheKey(RAW.sibling, 'github', 'zh') !== C.getChainCacheKey(RAW.repo, 'github', 'zh')
    must(sameKey && C.getCachedChain(RAW.repo, 'github', 'zh') === chain && C.getCachedChain(RAW.subDeep, 'github', 'zh') === chain,
      '检查链快照：同一个工作区里的会话共用同一把链键、同一个答案（不重复求值）',
      'sameKey=' + sameKey + ' root=' + !!C.getCachedChain(RAW.repo, 'github', 'zh') + ' subDeep=' + !!C.getCachedChain(RAW.subDeep, 'github', 'zh'))
    must(otherKey && C.getCachedChain(RAW.sibling, 'github', 'zh') === null,
      '检查链快照：另一个工作区（兄弟目录）拿不到这条链的答案，它的键不一样',
      'otherKey=' + otherKey + ' sibling=' + !!C.getCachedChain(RAW.sibling, 'github', 'zh'))
    must(C.getChainCacheKey(RAW.sub, 'markdown', 'zh') !== C.getChainCacheKey(RAW.sub, 'github', 'zh') &&
      C.getChainCacheKey(RAW.sub, 'github', 'en') !== C.getChainCacheKey(RAW.sub, 'github', 'zh'),
      '检查链快照的键还带着后端与语言：同一把工作区钥匙下，换了后端或换了语言算另一条链（不与别的后端串）',
      C.getChainCacheKey(RAW.sub, 'markdown', 'zh') + ' / ' + C.getChainCacheKey(RAW.sub, 'github', 'en'))
  }

  // —— B3 后端绑定（宿主侧真注册表 + 真 wf.bind 处理体 + 真判定出口）——
  {
    const anchor = await import(url('src/deck/shell/workspace-anchor.ts'))
    const WORKSPACE_FILE_REL = anchor.WORKSPACE_FILE_REL
    const parseWorkspaceFile = anchor.parseWorkspaceFile
    const registry = (await import(url('src/tracker/registry/core.ts'))).createRegistry()
    registry.register({ id: 'github', label: 'GitHub', create: () => ({}), matches: async () => false })
    registry.register({ id: 'markdown', label: '本地 Markdown', create: () => ({}), matches: async () => false })
    // #1138：绑定（用户为这个工作区选定后端）不再写注册表里那份进程内副本，唯一去处是工作区文件
    //   docs/agents/workspace.yaml。所以这一组换了两件事同时验：写——真 wf.bind 处理体把文件写到工作区根这一层；
    //   读——统一判定出口 decideBackend 从那份文件读回同一个人选。
    const authority = makeAuthorityFs()
    const outlet = await import(url('src/tracker/detection/backendDecision.ts'))
    const wsCwd = (await import(url('src/host/workspaceCwd.js'))).createWorkspaceCwd({
      ctx: { get: (name) => (name === 'fs' ? authority.fs : undefined) },
      DEFAULT_CWD: '',
      getPlatform: async () => Object.assign({}, PLATFORM, { fs: authority.fs }),
      getTrackerRegistry: async () => registry,
      getWorkspaceStore: async () => ({ invalidate() {} }),
      // 判定出口整份交进去（与生产装配给的形状一致），读文件那一路由上面那份文件服务供着。
      getDecisionFn: async () => ({ decideBackend: outlet.decideBackend, selectionFromOutlet: outlet.selectionFromOutlet }),
      canonicalKey: canon,
      setCache: () => {},
      logCtx: { fire: () => {}, isEnabled: () => false },
      timer: { timeout: () => 0 },
      detectionExec: async () => ({ ok: false }),
    })
    // 子目录会话在界面上选了后端 → 走的就是这条电话。生产里写不进去就等于这次选择没生效（#1138），
    // 所以这里必须真给一条文件通道：本组用的是 Gate656 自己的文件服务（不碰真实盘）。
    const bindOut = await wsCwd.handleBind({ cwd: RAW.subDeep, backendId: 'github' })
    must(bindOut.ok === true && bindOut.workspaceFile && bindOut.workspaceFile.ok === true,
      '后端绑定：子目录会话选定后端这一步，把选择写进了工作区文件（写不进去就等于这次选择没生效，所以回包必须写着写成了）',
      '回包=' + JSON.stringify(bindOut).slice(0, 240) + ' 真写盘=' + JSON.stringify(authority.read(WORKSPACE_FILE_REL, K.repo)))
    // 写下来的这份文件按工作区根这一层归一：子目录会话（RAW.subDeep）、它上面的子目录（RAW.sub）与根会话
    //   （RAW.repo）读到的是同一份；兄弟目录（RAW.sibling）没有这一份，读不着。
    const readAt = (cwd) => authority.read(WORKSPACE_FILE_REL, cwd)
    const atRoot = readAt(K.repo)
    must(atRoot !== null && atRoot === readAt(K.sub) && atRoot === readAt(K.subDeep) && readAt(K.sibling) === null,
      '后端绑定：这份文件按工作区根归一——同一仓库的子目录会话与根会话读到同一份，兄弟目录读不着',
      'root=' + JSON.stringify(atRoot) + ' sub=' + JSON.stringify(readAt(K.sub)) + ' deep=' + JSON.stringify(readAt(K.subDeep)) + ' sibling=' + JSON.stringify(readAt(K.sibling)))
    const parsedAtRoot = parseWorkspaceFile(atRoot)
    must(parsedAtRoot && parsedAtRoot.backendId === 'github',
      '后端绑定：文件里写的后端名就是会话选的那一个（人选只有这一份记录）',
      JSON.stringify(parsedAtRoot))
    // 读这条路（#652 修的就是它：以前把原样入参交给注册表，绑定写进去、这里读不着）
    const regOut = await wsCwd.handleRegistry({ cwd: RAW.subDeep })
    must(regOut.ok === true && !('bound' in regOut),
      '后端绑定：注册表那条电话不再答「这个工作区绑了谁」——绑定表随 #1138 删掉了，那一格整格去掉，不拿别的来源凑一个值',
      JSON.stringify(regOut).slice(0, 240))
    const bindingsOut = await wsCwd.handleBindings({ cwds: [RAW.repo, RAW.sub, RAW.subDeep] })
    must(bindingsOut.ok === true && bindingsOut.bindings.length === 1 && bindingsOut.bindings[0].backendId === 'github' && bindingsOut.bindings[0].cwd === K.repo,
      '后端绑定总览：调用方把候选目录递进来，总览按工作区文件如实答；同一个仓库只列一行，挂在工作区根那一条上（不出现「子目录一条、根一条」两份）',
      JSON.stringify(bindingsOut).slice(0, 300))
    const bindingsSibling = await wsCwd.handleBindings({ cwds: [RAW.sibling] })
    must(bindingsSibling.ok === true && bindingsSibling.bindings.length === 0,
      '后端绑定总览：兄弟目录里没有这份文件 → 它的总览是空的（不同工作区永不合并）',
      JSON.stringify(bindingsSibling).slice(0, 200))
    // 读的这条正路（#1138 起唯一判定出口）：问「子目录会话用哪个后端」→ 出口读那份文件答 github，
    //   来源写明是人选的（source:explicit / origin:user-file），写用途也凭这份文件放行（canWrite:true）。
    const selRoot = await wsCwd.handleSelection({ cwd: RAW.repo })
    const selSub = await wsCwd.handleSelection({ cwd: RAW.sub })
    const selSubDeep = await wsCwd.handleSelection({ cwd: RAW.subDeep })
    // 判定出口收的是**归一后的**工作区目录（生产里所有调用方都先过 canonicalKey/wf.selection 同一道归一），
    //   所以这里传 K.repo —— 传未归一的 RAW.subDeep 等于绕过那道闸，读文件会按未归一的路径去找，找不到是应该的。
    const picked = await outlet.decideBackend(K.repo, { registry: registry, fs: authority.fs, caller: 'verify-656' })
    must(selRoot.ok === true && selSub.ok === true && selSubDeep.ok === true &&
      selSubDeep.selection.backendId === 'github' && selSub.selection.backendId === 'github' && selRoot.selection.backendId === 'github',
      '后端绑定：根会话与它下面任意一层子目录会话问「这个工作区用哪个后端」，答案都是那一份记录里的那个后端',
      'root=' + JSON.stringify(selRoot.selection) + ' sub=' + JSON.stringify(selSub.selection) + ' deep=' + JSON.stringify(selSubDeep.selection))
    must(picked.backendId === 'github' && picked.source === 'explicit' && picked.origin === 'user-file' && picked.canWrite === true,
      '后端绑定：这个结论出自生产那一个判定出口，且来源写明是「工作区文件里人选的」（source:explicit / origin:user-file），写用途凭它放行（canWrite:true）',
      JSON.stringify(picked))
    const pickedSibling = await outlet.decideBackend(K.sibling, { registry: registry, fs: authority.fs, caller: 'verify-656' })
    must(pickedSibling.backendId === null && pickedSibling.canWrite === false,
      '后端绑定：兄弟目录没有这份记录 → 判定出口不拿别的目录的记录凑答案（backendId 为空、不放行写）',
      JSON.stringify(pickedSibling))
    // 界面这一侧的选择镜像已随 #1003 退役（真相在宿主文件里，不在本地表里）
    P.setCachedSelection(RAW.subDeep, { backendId: 'github', source: 'explicit' })
    must(P.getCachedSelection(RAW.repo) === null && P.getCachedSelection(RAW.sub) === null && P.getCachedSelection(RAW.sibling) === null,
      '后端选择镜像已退役：写了当没写，读恒为空（子目录/根/兄弟一律 null，不再分桶存选择）',
      'root=' + JSON.stringify(P.getCachedSelection(RAW.repo)) + ' sibling=' + JSON.stringify(P.getCachedSelection(RAW.sibling)))
  }

  // —— B4 仓库引用 ——
  {
    const repoRef = { backend: 'github', refId: 'acme/demo', name: 'acme/demo', url: 'https://github.com/acme/demo' }
    P.setCachedRepository(RAW.sub, repoRef)
    must(P.getCachedRepository(RAW.repo) === repoRef && P.getCachedRepository(RAW.sub) === repoRef,
      '仓库引用：子目录会话拿到的仓库引用，根会话按同一把钥匙读得到（同一个仓库一处引用）',
      'root=' + JSON.stringify(P.getCachedRepository(RAW.repo)))
    must(P.getCachedRepository(RAW.sibling) == null,
      '仓库引用：另一个工作区（兄弟目录）读不到这个引用（不同工作区永不合并）',
      'sibling=' + JSON.stringify(P.getCachedRepository(RAW.sibling)))
  }

  title('C) 写路径（子目录里不许长第二套）')

  // —— C1 本地 Markdown 的票仓与建票目录 ——
  {
    const mdPathMod = await import(url('src/tracker/rooms/markdown/path.ts'))
    const ctxAtRoot = { cwd: K.sub, platform: PLATFORM }              // 子目录会话：宿主交给后端的是工作区根
    const ctxAtSelected = { cwd: normPath(RAW.sub), platform: PLATFORM } // 对照：假如没锚根会是什么样
    const ref = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
    const made = [
      mdPathMod.getRoot(ref, ctxAtRoot),
      mdPathMod.mdPath(ref, 'map', null, ctxAtRoot),
      mdPathMod.mdPath(ref, 'issue', '01-x', ctxAtRoot),
      mdPathMod.issuesDir(ref, ctxAtRoot),
      mdPathMod.effortMapPath({ effortId: 'alpha' }, ctxAtRoot),
      mdPathMod.effortIssuePath({ effortId: 'alpha' }, '02-y', ctxAtRoot),
    ]
    const rootPrefix = K.repo + nodePath.sep
    const subPrefix = normPath(RAW.sub) + nodePath.sep
    must(made.every((p) => p.startsWith(rootPrefix)) && made.every((p) => !p.startsWith(subPrefix)),
      '本地 Markdown 的票仓与建票目录都在工作区根这一层：子目录会话读写都去根，子目录里不会长出第二套 .scratch',
      made.join(' | '))
    must(made[1] === nodePath.join(K.repo, '.scratch', 'demo', 'map.md') && made[4] === nodePath.join(K.repo, '.scratch', 'alpha', 'map.md'),
      '票仓路径就是「工作区根/.scratch/<投票目录>」这一条，扁平布局与带工作单元的布局都落在根上',
      made[1] + ' | ' + made[4])
    const ifNotRooted = mdPathMod.mdPath(ref, 'map', null, ctxAtSelected)
    must(ifNotRooted.startsWith(subPrefix) && ifNotRooted !== made[1],
      '这正是 #648 取证查到的那条岔路：若按「会话所选目录」算，同一个仓库会长出第二套 .scratch——所以这一条必须按工作区根算',
      ifNotRooted)
  }

  // —— C2 标签配色文件 ——
  {
    const lc = await import(url('src/tracker/rooms/markdown/label-colors.ts'))
    const atRoot = lc.labelColorsPath({ cwd: K.sub, platform: PLATFORM }, {})
    const atSelected = lc.labelColorsPath({ cwd: normPath(RAW.sub), platform: PLATFORM }, {})
    const want = nodePath.join(K.repo, 'docs', 'agents', 'label-colors.yaml')
    must(atRoot === want && atSelected !== want,
      '标签配色文件只有工作区根那一份（<工作区根>/docs/agents/label-colors.yaml）：子目录会话读写的都是根上那份',
      '按根=' + atRoot + ' 按所选目录=' + atSelected)
    must(lc.LABEL_COLORS_REL_PATH === 'docs/agents/label-colors.yaml',
      '配色文件在工作区里的相对位置是固定的一条，不含任何「再往上找一层」的逻辑（位置只由这一条决定）',
      lc.LABEL_COLORS_REL_PATH)
  }

  // —— C3 主锚文件：初始化产出的那一份只认工作区根 ——
  {
    const rp = await import(url('src/host/remotePredicates.js'))
    const fileExists = rp.createRemotePredicates().fileExistsChainRel
    const plat = { os: OS, path: nodePath, fs: fixtureFs }
    // 「工作区已初始化」这一步的判据就是：工作区根上有没有主锚文件
    const atRootOfSubSession = await fileExists(plat, K.sub, 'docs/agents/issue-tracker.md')
    const atSubItself = await fileExists(plat, normPath(RAW.sub), 'docs/agents/issue-tracker.md')
    must(atRootOfSubSession === true && atSubItself === false,
      '子目录会话的「工作区已初始化」看的是工作区根上那份主锚文件（根上有就绿）；子目录自己那一层查不到，也不该有',
      '按根问=' + atRootOfSubSession + ' 按子目录问=' + atSubItself)
    // 后端声明那一半：真判定函数去读，读的必须正好是根上那一条路径
    const detectExplicit = (await import(url('src/tracker/detection/explicitDetector.ts'))).detectExplicit
    const reg = (await import(url('src/tracker/registry/core.ts'))).createRegistry()
    reg.register({ id: 'github', label: 'GitHub', create: () => ({}), matches: async () => false })
    const readPaths = []
    const spyFs = Object.assign({}, fixtureFs, {
      async resolve(p, opts) {
        const abs = nodePath.isAbsolute(String(p)) ? String(p) : nodePath.resolve((opts && opts.cwd) || process.cwd(), String(p))
        if (String(p) === 'docs/agents/issue-tracker.md') readPaths.push(abs)
        return { path: abs, targetKey: abs }
      },
    })
    const det = await detectExplicit(
      { cwd: K.sub },                                  // 子目录会话：宿主交给判定的是工作区根
      { platform: { os: OS, path: nodePath, fs: spyFs } },
      reg
    )
    must(det.selection && det.selection.backendId === 'github' && det.selection.source === 'explicit',
      '子目录会话读得到工作区根上那份主锚文件里写的后端声明（不再落在「未初始化 / 没有后端」那一档）',
      JSON.stringify(det.selection))
    must(readPaths.length === 1 && readPaths[0] === nodePath.join(K.repo, 'docs', 'agents', 'issue-tracker.md'),
      '主锚文件只被读工作区根那一条路径：判定一次都没去读子目录里的同名文件（子目录里那份不会被当成这个工作区的配置）',
      readPaths.join(' | '))
    // 反过来：子目录里真的凭空多出一份，它不会被当成父工作区的配置，而是让那一层自成一套（规则里的边界②）
    const strayRoot = mkdir('stray')
    put(W('stray/docs/agents/issue-tracker.md'), '# Issue tracker: Local Markdown\n')
    const strayRes = await wm.resolveWorkspaceRoot(normPath(strayRoot), deps)
    const strayExists = await fileExists(plat, normPath(strayRoot), 'docs/agents/issue-tracker.md')
    must(strayRes.root === normPath(strayRoot) && strayRes.source === 'anchor' && strayExists === true,
      '子目录里真的多出一份主锚文件时，它是「这一层自成一套工作区」的信号（谁近听谁），不会被当作父工作区的那一份读走',
      JSON.stringify(strayRes))
  }

  title('D) 性能与体验（同一把钥匙只算一次）')

  // —— D1 同一把钥匙 30 秒内只判定一次，第二次一次盘都不读 ——
  {
    const fresh = normPath(RAW.cacheProbe)
    const before = counter.probes
    const first = await wm.resolveWorkspaceRoot(fresh, deps)
    const afterFirst = counter.probes
    const second = await wm.resolveWorkspaceRoot(fresh, deps)
    const afterSecond = counter.probes
    must(first.cache === 'miss' && afterFirst > before,
      '第一次判定真的去读了盘（不然下一句的「第二次没读」就没有意义）',
      'first=' + JSON.stringify(first) + ' 探测次数=' + (afterFirst - before))
    must(second.cache === 'hit' && afterSecond === afterFirst && second.root === first.root,
      '同一把钥匙 30 秒内只判定一次：第二次直接命中缓存，一次盘都不再读（所以也不可能重复起 git 子进程）',
      'second=' + JSON.stringify(second) + ' 第二次新增探测=' + (afterSecond - afterFirst))
  }

  // 【已删除】D2 / D3 / D4 / D5 四组原来都是读宿主源码文本、再用正则断言里面「必须出现某段写法」：
  //   D2 断言 workspaceKey.js 里不出现 child_process / spawn、repoKeys.js 里那个出口的入参形状；
  //   D3 断言 repoKeys.js 里有 canonicalKey(cwd || DEFAULT_CWD)、repoRoots[key]、repoKeys[key]；
  //   D4 断言 detectChain.js 里 handleChain / handleDetect 的入参锚根与缓存键拼法；
  //   D5 断言 sessionSnapshot.js / sessionRefresh.js / workspaceCwd.js / handoffClaim.js 四个文件里
  //      各自出现哪些函数与调用（还带「多少个字符以内必须出现」的顺序要求）。
  // 这些断言的对象都是手写源码的文本，等价重构（改名、拆函数、挪位置、换写法）就会变红，整段撤掉。
  // D3 里顺带断言的那句「子目录与根同一把钥匙、兄弟目录不同」由上面 B 组第 1 条判据守着，没有丢。

  title('E) 门禁入链与票面点名的两条对齐')

  {
    // E) 门禁入链与票面点名的两条对齐（#1125 起问规划函数，不再读 package.json 长串）
    const { isGatePlanned } = require('../scripts/lib/discover-gates.ts')
    must(isGatePlanned(ROOT, 'tests/verify-656-subworkspace-acceptance.js'),
      '本门禁已挂进 verify 链（判据不靠人记得手动跑）',
      '规划函数里没有它')
    must(isGatePlanned(ROOT, 'tests/verify-t1-getrepokey.js'),
      'tests/verify-t1-getrepokey.js 已收进 verify 链——它的场景 6 是仓库里唯一一条「cwd 是子目录」的用例，此前不在链上',
      '规划函数里没有它')
    must(isGatePlanned(ROOT, 'tests/verify-653-subworkspace.js'),
      '客户端那条落地票的门禁（verify-653-subworkspace.js）仍在链上，与本门禁一起守着这件事',
      '规划函数里没有 verify-653-subworkspace.js')
    // 【已删除】原先这里读 tests/verify-bundled-trio-matrix.js 的源码文本，断言里面有
    // `function projectRootUpward`、没有「简化为 cwd 本身」。那是钉另一个测试文件的写法，
    // 等价重构就会变红，撤掉。
  }

  title('F) 真机样本（可选；不设 DSW_VERIFY656_REAL=1 时跳过）')
  await realSamples(canon)

  // ── 收尾 ────────────────────────────────────────────────────────────────
  console.log('\n=== 汇总 ===')
  console.log(total + ' 条判据，' + (broken.length ? broken.length + ' 条不变式破了' : '全部守住'))
  if (broken.length) {
    console.log('\n破了的不变式：')
    for (const b of broken) console.log('  ' + b)
    cleanup()
    process.exit(1)
  }
  console.log('全部通过 ✅ — 子目录会话归到工作区根：判定、分桶、写路径、缓存四条都守住了')
  cleanup()
}

/**
 * 真机样本腿（可选）：本机存在样本目录时才跑，样本不在就只打一行说明。
 * 对应架构决定记录第 4 节的两条真机验收：
 *   ① 在 D:\ilife 的子目录里开会话时，算出来的工作区根就是 D:\ilife 那一层，
 *      「工作区已初始化」读的是根上那份主锚文件；
 *   ② 反着来一条：在自带 .git 的嵌套仓库里开会话，它自成一套，不被外层仓库吞掉
 *      （样本由本机现找：在 ① 那棵仓库里找一个自带 .git 的子目录；找不到就只打一行说明）。
 */
async function realSamples(canon) {
  if (process.env.DSW_VERIFY656_REAL !== '1') {
    console.log('  · 未开真机腿（设 DSW_VERIFY656_REAL=1 且本机有样本目录时会跑）；本条不参与断言，门禁不依赖任何机器上的具体路径')
    return
  }
  const samples = [{ label: '用户机的 monorepo', root: 'D:\\ilife', sub: 'D:\\ilife\\packages\\skill-calorie' }]
  let ran = 0
  const rp = await import(url('src/host/remotePredicates.js'))
  const fileExists = rp.createRemotePredicates().fileExistsChainRel
  const plat = { os: OS, path: nodePath, fs: makeFsSvc(null) }
  for (const s of samples) {
    if (!fsx.existsSync(s.root) || !fsx.existsSync(s.sub)) { console.log('  · 样本不在本机，跳过：' + s.sub); continue }
    ran++
    const kRoot = await canon(s.root)
    const kSub = await canon(s.sub)
    must(kSub === kRoot,
      '真机·' + s.label + '：子目录会话算出来的工作区根就是仓库根（' + s.root + '）',
      'root=' + kRoot + ' sub=' + kSub)
    const anchor = nodePath.join(s.root, 'docs', 'agents', 'issue-tracker.md')
    const green = await fileExists(plat, kSub, 'docs/agents/issue-tracker.md')
    must(green === true && fsx.existsSync(anchor),
      '真机·' + s.label + '：「工作区已初始化」这一步在子目录会话里是绿的（读的是根上那份主锚文件）',
      '根上有主锚=' + fsx.existsSync(anchor) + ' 检查结果=' + green)
    // 反向样本：这棵仓库里自带 .git 的子目录（嵌套仓库）
    const nested = findNestedRepo(s.root, 0)
    if (!nested) {
      console.log('  · 本机没找到「自带 .git 的嵌套仓库」样本，反向那一条这次没跑（合成夹具那一条由 A3 / A8 覆盖）')
      continue
    }
    ran++
    const kNested = await canon(nested)
    const inside = firstSubdir(nested)
    const kInside = inside ? await canon(inside) : kNested
    must(kNested !== kRoot && kInside === kNested,
      '真机·反向：自带 .git 的嵌套仓库自成一套，不被外层仓库吞掉（' + nested + '）',
      '外层根=' + kRoot + ' 嵌套根=' + kNested + ' 它里面的目录=' + kInside)
  }
  console.log(ran ? '  · 真机腿跑过 ' + ran + ' 条样本' : '  · 本机没有可用的真样本，真机腿这次什么都没跑')
}

/** 在一棵目录树里（最多往下两层、跳过 node_modules 一类）找一个自带 .git 的子目录。 */
function findNestedRepo(dir, depth) {
  if (depth > 2) return null
  let items = []
  try { items = fsx.readdirSync(dir, { withFileTypes: true }) } catch (e) { return null }
  for (const it of items) {
    if (!it.isDirectory()) continue
    if (it.name === 'node_modules' || it.name === 'dist' || it.name === 'build' || it.name === '.git') continue
    const full = nodePath.join(dir, it.name)
    if (fsx.existsSync(nodePath.join(full, '.git'))) return full
    const deeper = findNestedRepo(full, depth + 1)
    if (deeper) return deeper
  }
  return null
}

/** 这条目录下第一个子目录（没有就回空串）。 */
function firstSubdir(dir) {
  try {
    const items = fsx.readdirSync(dir, { withFileTypes: true })
    for (const it of items) { if (it.isDirectory() && it.name !== '.git') return nodePath.join(dir, it.name) }
  } catch (e) { }
  return ''
}

main().catch(function (e) { console.error('RUNNER ERROR:', e && e.stack || e); cleanup(); process.exit(2) })
