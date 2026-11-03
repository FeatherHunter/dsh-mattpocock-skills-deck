/**
 * src/host/workspaceKey.ts —— 宿主侧工作区键单源（地图 #278 A 方案 · #279 落地；
 * #652 起多一步「锚到工作区根」；2026-11-03 起这一步改成「往上找工作区记录」）。
 *
 * 以后谁改它：改「哪个目录算这个会话的工作区」这条规则的人。规则全文见
 *   docs/adr/20261103-workspace-root-upward-search.md（维护者 2026-11-03 定版）；
 *   被它取代的两版见 docs/adr/20260918-subworkspace-identity-root.md（票 #649）与
 *   docs/adr/20261102-workspace-identity-records.md（票 #1806）。
 *
 * 这里有两步，一步都不能省：
 *   第一步 归一：把同一条目录的几种写法（盘符大小写、斜杠方向、尾斜杠）洗成同一把钥匙；
 *   第二步 锚根：把会话所选的那条目录往上找，找到真正代表这个工作区的那条目录（工作区根）。
 * 第二步是 #652 加的。为什么必须有：工作区级的东西（后端声明、标签配色文件、本地 Markdown 的票仓、
 *   后端绑定、检查链快照）物理上只有一份、只可能落在仓库那一级；按「会话所选目录」分桶，会让同一个
 *   仓库在界面上被切成互不相认的几份——子目录会话读不到根上的声明，还会往子目录里长出第二套。
 *
 * 判定规则（维护者 2026-11-03 定版，取代 #649 与 #1806 的两版口径）：
 *   从所选目录逐层向上，第一个「自己带一份插件工作区记录」的目录就是工作区根。
 *   记录只有一份：docs/agents/workspace.yaml（用户为这个工作区选定后端时写下，是后端绑定的唯一去处）。
 *   找到在所选目录之上，说明所选目录是那个工作区的子目录；一路到盘符根、POSIX 根或 UNC 共享根都没有，
 *   就把所选目录本身当作工作区根（一个还没初始化过的新工作区）。
 *   判定只问「这份记录在不在」，不读任何文件内容：内容会变、会被翻译、会带 BOM，把内容当身份，
 *   每一种写法都是一条会猜错的岔路——#1806 的来路正是子目录里一份手写说明被当成了独立工作区。
 *   旧 docs/agents/workspace.json 不算记录：它是 #652 之前的旧版本写在「会话所选目录」上的，
 *   子目录里可能残留，按记录算会把旧版本留下的假身份重新扶正。
 *
 * 为什么不再把 .git 当根标记（2026-11-03 修正）：
 *   git 库的边界和插件工作区的边界是两件事。本地 Markdown 工作区可以完全没有 git；GitLab 的同一个项目
 *   可以有多份本地副本（clone、worktree），每份都有自己的 .git，但它们只是同一工作区的不同副本；
 *   子目录里任何一个 .git（嵌套仓库、工具生成的仓库）还会把上溯截断在那一层。
 *   所以判定只看 workspace.yaml；没初始化过的目录里在子目录打开，工作区就落在那一层，不猜上级——
 *   等那一层有了记录，再在子目录打开自然就归它了。
 *
 * 为什么「是不是子工作区」不写进文件：打开的人事先不知道将来会不会有人在子目录里开工作区，
 *   任何 parent 字段都会过期。归属是打开时算出来的，不是存下来的；子目录里也不需要写任何文件。
 *
 * 缓存与失败：判定结果按所选目录的规整键存在宿主内存里，30 秒后重算（记录可能后来才出现——用户刚建仓、
 *   刚在面板选定后端，都会往根上放记录，永久缓存会让子目录会话一直停在旧结论上）；
 *   30 秒这个值住在 config/ttl.yaml 的 workspaceRootTtlMs，调时间改 YAML，一致性由 tests/verify-time-config.ts 看守；
 *   探测失败（目录不存在、文件服务不可用）一律回退所选目录，并且不写进缓存。
 *
 * 为什么这样标注：
 * 1. 相对导入说明符保留 `.js` 后缀（`../shared/time-config/src/values.js` 不改成 `.ts`），
 *    改了会绕过钩子的同名解析约定，所以不能动。
 * 2. 文件服务与平台路径的形状由宿主框架决定，本文件只读 `resolve`、`stat`、`lstat`、
 *    `listDir`、`exists` 与 `isAbsolute` 等少数成员，所以全部按 `any` 收，
 *    类型不替代运行时的能力检测。
 * 3. 缓存表的类型参数（键是规整钥匙、值是判定结果）只存在于类型层面，转译时整体剥离。
 * 4. 判定只查一条记录在不在，不读内容，也不起 git 子进程；跨层 import 两条，都来自 shared 的纯函数
 *    模块：中央 TTL 常量与 config-store 里的记录路径。记录路径不在本文件抄字面量，避免写侧再抄一份。
 */
import { WORKSPACE_ROOT_TTL_MS } from '../shared/time-config/src/values.js'
import { WORKSPACE_YAML_REL } from '../shared/config-store/src/workspace.js'

export function normalizeWorkspacePath(raw: any, platform: any): string {
  if (raw == null) return '';
  let s: string = String(raw).trim();
  if (!s) return s;
  try {
    if (platform && platform.path && typeof platform.path.normalize === 'function') {
      let n: string = platform.path.normalize(s);
      const sep: string = platform.path.sep;
      // 根保持原样：盘符根（D:\，normalize 恒带尾反斜杠）、裸斜杠、POSIX 根。
      // UNC 共享根（\\srv\share）不进根白名单——带尾斜杠与不带必须洗成同一把钥匙，
      // 统一落到"去尾斜杠后的共享形态"，否则同工作区两种写法仍会分桶（verify-3-workspace-switch P1 在案）。
      let keepAsIs: boolean = false;
      if (platform.os === 'win32') {
        keepAsIs = /^[A-Za-z]:\\$/.test(n) || n === '\\' || n === '/';
      } else {
        keepAsIs = n === '/';
      }
      if (!keepAsIs) {
        const otherSep: string = sep==='\\' ? '/' : '\\';
        while (n.length>1 && (n.endsWith(sep) || n.endsWith(otherSep))) n=n.slice(0,-1);
      }
      // #1498：Windows 的小写折叠只对真正大小写不敏感的卷（盘符路径）做，UNC 一律保留原始大小写。
      // 为什么：UNC 背后可能是 WSL 里的 ext4（\\wsl.localhost\… 、\\wsl$\…），也可能是 Windows 共享，
      // 光看字符串分不出是哪一种；在区分大小写的盘上小写化会洗出一条根本不存在的路径，于是锚根探测、
      // 说明文件读取、gh 命令全部失败（界面一直显示「未识别仓库」），写工作区文件时还会在父目录里真的
      // 建出一个只有大小写不同的假目录。
      // 为什么拿规整后的 n 判「是不是 UNC」而不是拿原始入参：调用方可能把 UNC 写成正斜杠的
      // //wsl.localhost/… ，只有 path.normalize 之后才变成反斜杠开头的共享写法；拿原文判会漏掉它。
      // 两个反斜杠开头不全是 UNC：\\?\D:\Work\Alpha（长路径写法）与 \\.\C:\Work（设备前缀）
      // 后面跟的是盘符，仍是大小写不敏感的卷，必须照旧折叠，所以把它们从 UNC 里排掉；
      // \\?\Volume{…} 这类看不出卷的大小写规矩，跟 UNC 一样保留原样。裸斜杠根没有字母，折叠与否无差别。
      if(platform.os==='win32'){
        const isUnc: boolean = /^\\\\/.test(n) && !/^\\\\[?.]\\[A-Za-z]:/.test(n);
        if(!isUnc) n=n.toLowerCase();
      }
      return n;
    }
  } catch {}
  return s;
}
// ── 工作区根判定（#652 落地；2026-11-03 按维护者定版改为「往上找 workspace.yaml」）──
// 记录路径真源在 src/shared/config-store/src/workspace.ts（一个值只有一处定义），本文件只消费；
// 换记录、改路径都只改真源。判定只问在不在，不读内容。
const workspaceRootCache = new Map<string, any>()   // 所选目录规整键 → { root, source, at }
let rootLogSampleN: number = 0

// #491 房外埋点同款：日志里只记散列，不记路径原文。
function hash8(s: any): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }

/**
 * 判定结果的来源值。取值集合就是 resolveWorkspaceRoot 可能回的全部结果，用联合类型锁死：
 * record 是找到工作区记录的那一层，self 是一路到顶都没有记录（所选目录自己就是根）。
 * 没有了旧口径的 'git' 与 'anchor'（2026-11-03 起 .git 不参与认根，判定也不读说明文件）。
 */
export type WorkspaceRootSource = 'record' | 'self' | 'fail' | 'no-fs' | 'no-probe' | 'empty' | 'relative'

/** 根判定结果的形状：算出来的工作区根、停在哪种标记、这一次是命中缓存还是现算。 */
export interface WorkspaceRootResult {
  root: string
  source: WorkspaceRootSource
  cache: string
}

/**
 * 上一层目录。入参是规整后的钥匙，所以用字符串切，不经过平台路径模块。
 * 两种分隔符都要认：Windows 的规整键是反斜杠形态（normalizeWorkspacePath 走 path.normalize），POSIX 是正斜杠；
 * 切完按输入本来的分隔符还原，返回值与调用方手上的钥匙同形，两边才拼得起来。
 * 已经到顶（盘符根如 d:/ 或 d:\、POSIX 根 /、UNC 共享根如 \\srv\share）时返回 null——调用方据此停下。
 * @param {string} key
 * @returns {string|null}
 */
export function parentWorkspaceDir(key: any): string | null {
  const s: string = String(key || '')
  if (!s) return null
  const sep: string = s.indexOf('\\') >= 0 ? '\\' : '/'
  const up: string | null = parentSlashForm(s.replace(/\\/g, '/'))
  if (!up) return null
  return sep === '/' ? up : up.replace(/\//g, sep)
}

/** parentWorkspaceDir 的正斜杠内核：只处理正斜杠形态，到顶返回 null。 */
function parentSlashForm(s: any): string | null {
  if (s === '/' || /^[a-z]:\/$/i.test(s)) return null            // 文件系统根与盘符根
  if (s.indexOf('//') === 0) {                                    // UNC：//srv/share 是顶，不再往上
    const segs: string[] = s.slice(2).split('/').filter(function (x: any) { return x !== '' })
    if (segs.length <= 2) return null
    return '//' + segs.slice(0, -1).join('/')
  }
  if (/^[a-z]:\//i.test(s)) {                                     // d:/a/b → d:/a ；d:/a → d:/
    const rest: string = s.slice(3)
    const i: number = rest.lastIndexOf('/')
    return i < 0 ? s.slice(0, 3) : s.slice(0, 3 + i)
  }
  const i: number = s.lastIndexOf('/')                                    // /a/b → /a ；/a → /
  if (i < 0) return null
  if (i === 0) return '/'
  return s.slice(0, i)
}

/** 用 dir 自己的分隔符拼一条相对路径（Windows 规整键下拼出的是反斜杠，与钥匙同形）。 */
function joinKey(dir: any, rel: any): string {
  const s: string = String(dir || '')
  const sep: string = s.indexOf('\\') >= 0 ? '\\' : '/'
  const tail: string = s.replace(/[\\/]+$/, '')
  return tail + sep + String(rel).replace(/\//g, sep)
}

/** 文件服务有没有「问某条路径在不在」的能力。三样任一可用即可；一样都没有时判定整体跳过（诚实回退，不猜）。 */
function hasProbe(fsSvc: any): boolean {
  return !!(fsSvc && (typeof fsSvc.lstat === 'function' || typeof fsSvc.stat === 'function' || typeof fsSvc.listDir === 'function' || typeof fsSvc.exists === 'function'))
}

/**
 * 这条路径在不在。形状按 DSH 文件服务的契约：lstat 收路径，stat/listDir 收 resolve 出来的 target；
 * 逐个试，任一证明存在即为真，全都不行就是「不在」（探测异常也按不在算，让上溯继续往上走一层）。
 */
async function existsAt(fsSvc: any, abs: any): Promise<boolean> {
  if (!fsSvc) return false
  if (typeof fsSvc.lstat === 'function') { try { if (await fsSvc.lstat(abs)) return true } catch (e) {} }
  if (typeof fsSvc.resolve === 'function' && (typeof fsSvc.stat === 'function' || typeof fsSvc.listDir === 'function')) {
    let t: any = null
    try { t = await fsSvc.resolve(abs) } catch (e) { t = null }
    if (t) {
      if (typeof fsSvc.stat === 'function') { try { if (await fsSvc.stat(t)) return true } catch (e) {} }
      if (typeof fsSvc.listDir === 'function') { try { await fsSvc.listDir(t); return true } catch (e) {} }
    }
  }
  if (typeof fsSvc.exists === 'function') { try { if ((await fsSvc.exists(abs)) === true) return true } catch (e) {} }
  return false
}

/**
 * 这一层有没有工作区记录（docs/agents/workspace.yaml）。
 * 只问路径在不在，不打开文件：记录是插件自己写下、随仓库提交的凭据，它回答的只有「这一层算不算一个工作区」；
 * 路径本身是目录、内容空、写坏了都按「在」算——判定不替人猜记录的有效性，也不读内容。
 */
async function hasWorkspaceRecord(fsSvc: any, dir: any): Promise<boolean> {
  return existsAt(fsSvc, joinKey(dir, WORKSPACE_YAML_REL))
}

/**
 * 把起始目录换到真实路径，防御 junction / 软链（沿链接路径上溯看不到真实上级的记录，会把自己误判成根）。
 * 按文件服务的能力做事：服务提供 realpath 就先用它换掉起点；DSH 当前透传给插件的文件服务只有
 * lstat / readText / writeText / resolve / listDir / stat，没有 realpath，这时按字面路径上溯。
 * 两条路都不会死循环：字面路径每层都在变短，另有 64 层上限兜底；差别只在「经 junction 打开的子目录
 * 能不能看见真实上级的记录」——服务没有真实路径能力时看不见（这是宿主文件服务的能力缺口，不是判定口径变化）。
 */
async function realStartKey(fsSvc: any, key: any): Promise<string> {
  try {
    if (fsSvc && typeof fsSvc.realpath === 'function') {
      const real: any = await fsSvc.realpath(String(key))
      const s: string = (typeof real === 'string') ? real : (real && typeof real.path === 'string' ? real.path : '')
      if (s) return s
    }
  } catch (e) {}
  return String(key)
}

/**
 * 工作区根判定（含 30 秒缓存）。deps 与 canonicalWorkspaceKey 同形，多一个可选的 logCtx。
 * @param {string} selectedKey 已归一的所选目录
 * @param {{ getPlatform?: Function, getFs?: Function, logCtx?: Object }} [deps]
 * @returns {Promise<{ root: string, source: string, cache: string }>}
 *   source：record 停在自带工作区记录的那一层、self 一路到顶都没有记录（所选目录自己就是根）、
 *           fail 探测失败回退所选目录、no-fs 与 no-probe 是连探测能力都没有；另两种没有进入探测：
 *           empty 是空路径、relative 是相对路径（两者原样返回、不缓存）。
 *   cache：hit 用的是缓存、miss 与 expired 是这次真算的、skip 没算（空路径、相对路径、没有探测能力、
 *           探测失败这几种都不写缓存）。
 */
export async function resolveWorkspaceRoot(selectedKey: any, deps?: any): Promise<WorkspaceRootResult> {
  const key: string = String(selectedKey || '')
  if (!key) return { root: '', source: 'empty', cache: 'skip' }
  let platform: any = (deps && deps.platform) ? deps.platform : null
  if (!platform) { try { platform = deps && deps.getPlatform ? await deps.getPlatform() : null } catch (e) { platform = null } }
  if (!isAbsoluteKey(key, platform)) return { root: key, source: 'relative', cache: 'skip' }
  const now: number = Date.now()
  const hit: any = workspaceRootCache.get(key)
  let out: any = null
  if (hit && (now - hit.at) < WORKSPACE_ROOT_TTL_MS) {
    out = { root: hit.root, source: hit.source, cache: 'hit' }
  } else {
    const missKind: string = hit ? 'expired' : 'miss'
    const fsSvc: any = (deps && typeof deps.getFs === 'function') ? deps.getFs() : null
    if (!fsSvc || !hasProbe(fsSvc)) {
      out = { root: key, source: fsSvc ? 'no-probe' : 'no-fs', cache: 'skip' }
    } else {
      try {
        // 有真实路径能力就先把起点换过去（junction / 软链），再沿真实目录往上找。
        const startKey: string = await realStartKey(fsSvc, key)
        // 逐层向上：第一层带工作区记录就停在这里；一路到顶都没有，工作区根就是所选目录自己。
        // 层数上限只是兜底（真有环也不至于转不出来）。每层只问一条固定路径（workspace.yaml）。
        let cursor: any = startKey
        let root: string = startKey
        let source: WorkspaceRootSource = 'self'
        for (let i: number = 0; i < 64; i++) {
          if (await hasWorkspaceRecord(fsSvc, cursor)) { root = cursor; source = 'record'; break }
          const up: string | null = parentWorkspaceDir(cursor)
          if (!up) break
          cursor = up
        }
        workspaceRootCache.set(key, { root: root, source: source, at: Date.now() })
        out = { root: root, source: source, cache: missKind }
      } catch (e) {
        // 探测失败：回退所选目录（与旧行为一致，绝不让整个面板因此失败），且不写进缓存——下次重问。
        out = { root: key, source: 'fail', cache: 'skip' }
      }
    }
  }
  // 高频路径的守卫：同一行先判调试开关再组装字段；缓存命中按百分之一采样，判定本身（miss/expired/fail）每次都记。
  const logCtx: any = deps && deps.logCtx
  if (logCtx && typeof logCtx.isEnabled === 'function' && logCtx.isEnabled('debug') && (out.cache !== 'hit' || (++rootLogSampleN % 100) === 0)) logCtx.fire('debug', 'workspaceRoot.resolve', function () { return { cwdHash: hash8(key), rootHash: hash8(out.root), source: out.source, cache: out.cache } })
  return out
}

/**
 * 清掉根判定的 30 秒缓存。写入一份新的工作区记录之后必须调用：
 * 记录刚落盘时旧结论还在缓存里，从「自己」变成「某个根」或反过来都要立刻生效，
 * 否则面板最多 30 秒仍在说旧话（要的是判定与事实一致，不是「等一会儿就一致」）。
 *
 * 只清整个表、不做前缀筛选：记录落盘是低频动作（初始化、面板绑定），一次清空代价可忽略；
 * 按前缀清反而容易漏掉「父目录的缓存结论也变了」这一层。
 */
export function forgetWorkspaceRootCache(): void {
  workspaceRootCache.clear()
}

/**
 * 把调用方递进来的目录洗成「所选目录本身」的规整钥匙（不锚根）。
 * 与 canonicalWorkspaceKey 同一套三步归一：绝对路径直接用；相对路径先问文件服务它指向哪；
 * 最后按 home 拼。抽出来是为了让读路径与写路径用同一把尺子量调用方给的目录，
 * 而不是各写一份归一逻辑——两处口径一旦分叉，面板说的根就会和实际归属对不上。
 * 返回空钥匙表示连默认目录都没有。
 */
async function normalizeSelectedKey(raw: any, deps: any): Promise<{ key: string; platform: any }> {
  const getPlatform: any = deps && deps.getPlatform;
  const getFs: any = deps && deps.getFs;
  const getDefaultCwd: any = deps && deps.getDefaultCwd;
  let input: any = raw;
  if (input == null || (typeof input === 'string' && !input.trim())) {
    try { input = getDefaultCwd ? getDefaultCwd() : ''; } catch (e) { input = ''; }
    if (!input) return { key: '', platform: null };
  }
  if (typeof input !== 'string') input = String(input);
  input = input.trim();
  if (!input) {
    try { input = getDefaultCwd ? getDefaultCwd() : ''; } catch (e) {}
    if (!input) return { key: '', platform: null };
  }
  let platform: any = null;
  try { platform = getPlatform ? await getPlatform() : null; } catch (e) { platform = null; }
  try {
    if (platform && platform.path && typeof platform.path.isAbsolute === 'function' && platform.path.isAbsolute(input)) {
      return { key: normalizeWorkspacePath(input, platform), platform: platform };
    }
  } catch (e) {}
  try {
    const fss: any = getFs ? getFs() : null;
    if (fss && typeof fss.resolve === 'function') {
      const t: any = await fss.resolve(input);
      const target: any = (t && typeof t === 'object') ? (t.path || t.target || t.displayPath || '') : t;
      if (typeof target === 'string' && target) {
        const isAbs: boolean = (platform && platform.path && typeof platform.path.isAbsolute === 'function')
          ? platform.path.isAbsolute(target) === true
          : (target.charAt(1) === ':' || target.charAt(0) === '/' || target.charAt(0) === '\\');
        if (isAbs) return { key: normalizeWorkspacePath(target, platform), platform: platform };
      }
    }
  } catch (e) {}
  try {
    if (platform && typeof platform.getHome === 'function') {
      const home: any = await platform.getHome();
      if (home && platform.path) {
        const joined: any = platform.path.join(home, input);
        return { key: normalizeWorkspacePath(joined, platform), platform: platform };
      }
    }
  } catch (e) {}
  if (platform) return { key: normalizeWorkspacePath(input, platform), platform: platform };
  return { key: input, platform: platform };
}

/** 规整后的钥匙看起来是不是一条绝对路径（只有绝对路径才谈得上往上找）。 */
function isAbsoluteKey(key: any, platform: any): boolean {
  try { if (platform && platform.path && typeof platform.path.isAbsolute === 'function') return platform.path.isAbsolute(key) === true } catch (e) {}
  return /^[a-z]:[\\/]/i.test(key) || /^[\\/]/.test(key)
}

export async function canonicalWorkspaceKey(raw: any, deps: any): Promise<any> {
  const sel: any = await normalizeSelectedKey(raw, deps || {});
  const key: string = (sel && sel.key) ? sel.key : '';
  if (!key) return '';
  try {
    const r: any = await resolveWorkspaceRoot(key, { platform: sel.platform, getFs: deps && deps.getFs, logCtx: deps && deps.logCtx });
    return (r && r.root) ? r.root : key;
  } catch (e) { return key }
}
export default { normalizeWorkspacePath, canonicalWorkspaceKey, resolveWorkspaceRoot, parentWorkspaceDir }
