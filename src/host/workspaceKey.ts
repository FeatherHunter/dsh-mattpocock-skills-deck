/**
 * src/host/workspaceKey.ts —— 宿主侧工作区键单源（地图 #278 A 方案 · #279 落地；
 * #652 起多一步「锚到工作区根」；#1806 起这一步改成「认插件工作区记录」）。
 *
 * 以后谁改它：改「哪个目录算这个会话的工作区」这条规则的人。规则全文见
 *   docs/adr/20261102-workspace-identity-records.md（票 #1806 定版，2026-11-02）；
 *   上一版规则见 docs/adr/20260918-subworkspace-identity-root.md（票 #649，其中根标记的定义已被前者取代）。
 *
 * 这里有两步，一步都不能省：
 *   第一步 归一：把同一条目录的几种写法（盘符大小写、斜杠方向、尾斜杠）洗成同一把钥匙；
 *   第二步 锚根：把会话所选的那条目录往上找，找到真正代表这个工作区的那条目录（工作区根）。
 * 第二步是 #652 加的。为什么必须有：工作区级的东西（后端声明、标签配色文件、本地 Markdown 的票仓、
 *   后端绑定、检查链快照）物理上只有一份、只可能落在仓库那一级；按「会话所选目录」分桶，会让同一个
 *   仓库在界面上被切成互不相认的几份——子目录会话读不到根上的声明，还会往子目录里长出第二套。
 *
 * 判定规则（2026-11-02 #1806 定版，取代 #649 的「主锚文件在不在」口径）：
 *   从所选目录逐层向上，第一个「自带 .git（文件或目录都算）」或「自带一份插件工作区记录」的目录就是
 *   工作区根；两种标记同等优先、谁近听谁；一路到盘符根、POSIX 根或 UNC 共享根都没有，就用所选目录本身。
 *   插件工作区记录只有两份，都是插件自己写下、随仓库提交的「这一层是工作区」的凭据：
 *     - docs/agents/workspace.yaml：用户为这个工作区选定后端时写下（#1138 起是后端绑定的唯一去处）；
 *     - docs/agents/workspace-root.yaml：只表示「这个目录是一个工作区」、不表示后端；由初始化流程或
 *       人显式「标为独立工作区」写下（写入侧是 #1806 的后续步骤，判定侧先认它）。
 *   判定只问「记录在不在」，不读任何文件内容。这是第一性原理上的分界：人写的
 *   docs/agents/issue-tracker.md 回答的是「这个工作区用哪个后端」，不是「这一层是不是独立工作区」。
 *   文件内容会变、会被翻译、会带 BOM、会在正文里引用别的标题；把内容当身份，每一种写法都是一条会
 *   猜错的岔路——#1806 的来路正是子目录里一份手写的子协议说明被当成了独立工作区。
 *   旧 docs/agents/workspace.json 不算记录：它是 #652 之前的旧版本写在「会话所选目录」上的，子目录里
 *   可能残留；按记录算会把旧版本留下的假身份重新扶正，所以只认上面两份。
 *
 * 为什么不用 git rev-parse --show-toplevel：本地 Markdown 工作区可以完全不是 git 仓库，而「记录」
 *   这一半标记 git 根本不认识；纯文件探测一次覆盖两种标记，也不起任何子进程。
 * 与旧口径的差别（#1806）：子目录里那份 docs/agents/issue-tracker.md 不再让那一层自成一套；它仍然
 *   回答「这个工作区用哪个后端」，只读工作区根上那一份。历史遗留：子目录里只有说明文件、没有任何
 *   记录时按上级工作区处理，界面会给一次性的「标为独立工作区」入口（写入侧与界面是后续步骤）。
 * 缓存与失败：判定结果按所选目录的规整键存在宿主内存里，30 秒后重算（记录可能后来才出现——用户刚
 *   建仓、刚跑完初始化、刚在面板选定后端，都会往根上放记录，永久缓存会让子目录会话一直停在旧结论上）；
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
 * 4. 判定只查两条记录在不在，不读内容，也不起 git 子进程；跨层 import 两条，都来自 shared 的纯函数
 *    模块：中央 TTL 常量与 config-store 里的两份记录路径。旧版把记录路径直接写在本文件，
 *    #1806 把它们收进各自真源，避免写侧再抄一份字面量。
 */
import { WORKSPACE_ROOT_TTL_MS } from '../shared/time-config/src/values.js'
import { WORKSPACE_YAML_REL, WORKSPACE_IDENTITY_REL, WORKSPACE_MEMBER_REL, WORKSPACE_TRACKER_DOC_REL } from '../shared/config-store/src/workspace.js'

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
      // .git 读取、gh 命令全部失败（界面一直显示「未识别仓库」），写工作区文件时还会在父目录里真的
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
// ── 工作区根判定（#652 落地；2026-11-02 按 #1806 改为认插件记录）────────────────
// 标记只有两类：自带 .git、自带插件工作区记录。两份记录的路径真源都在
// src/shared/config-store/src/workspace.ts（一个值只有一处定义），本文件只消费、组成下面这张表；
// 换记录、改路径都只改真源。判定只问在不在，不读内容。身份记录（workspace-root.yaml）的
// 写入侧是 #1806 的后续步骤，判定侧先认它，这样「初始化 / 人显式标独立」两条记录产生路径的
// 门禁可以先行落地。
const WORKSPACE_RECORD_RELS: string[] = [WORKSPACE_YAML_REL, WORKSPACE_IDENTITY_REL]
// 从属记录（#1806 第 3 步）不在这张表里：它不是「这一层是工作区」的凭据，而是「这一层归上面」的遮罩，
// 判定顺序见 markerOf：.git 永远优先，从属记录其次（跳过本层），最后才看上面两份记录。
const workspaceRootCache = new Map<string, any>()   // 所选目录规整键 → { root, source, at }
let rootLogSampleN: number = 0

// #491 房外埋点同款：日志里只记散列，不记路径原文。
function hash8(s: any): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }

/**
 * 判定结果的来源值。取值集合就是 resolveWorkspaceRoot 可能回的全部结果，用联合类型锁死，
 * 其中没有旧口径的 'anchor'（#1806 起判定不读声明文件，也就不可能停在它上面）。
 */
export type WorkspaceRootSource = 'git' | 'record' | 'self' | 'fail' | 'no-fs' | 'no-probe' | 'empty' | 'relative'

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
 * 这一层有没有工作区标记：'git'（自带 .git，文件或目录都算）、'record'（自带插件工作区记录）、
 * 'member'（自带从属记录，明确「这一层归上面的工作区」）或 ''（没有任何标记）。
 * 只问路径在不在，不打开文件：.git 本身就是仓库边界；几份记录都是插件写下、随仓库提交的凭据，
 * 它们回答的只有「这一层算不算一个工作区」这一件事，内容由别的读取方按各自的需要解释。
 * 记录路径本身是目录、内容空、写坏了都按「在」算——判定不替人猜记录的有效性，也不读内容（#1806）。
 *
 * 顺序是判定语义的一部分：.git 永远优先（人 clone 出来的仓库不可能被一份记录降级成子目录）；
 * 从属记录其次，它只遮住同一层的两份工作区记录，让判定继续往上找（#1806 第 3 步「并入上级」）；
 * 最后才看两份工作区记录。人写的说明文件从来不在这个顺序里，它只回答「用哪个后端」。
 */
async function markerOf(fsSvc: any, dir: any): Promise<'git' | 'member' | 'record' | ''> {
  if (await existsAt(fsSvc, joinKey(dir, '.git'))) return 'git'
  if (await existsAt(fsSvc, joinKey(dir, WORKSPACE_MEMBER_REL))) return 'member'
  for (const rel of WORKSPACE_RECORD_RELS) {
    if (await existsAt(fsSvc, joinKey(dir, rel))) return 'record'
  }
  return ''
}

// ── 把判定依据说清楚（#1806 第 3 步）────────────────────────────────────────────
// 面板与设置页只陈述可验证事实：根是谁、凭什么、外面还套着谁、这一层有没有别的记录。
// 这些事实全部从探测结果推出来，界面不自己猜，也不把「看起来初始化过」当成依据。

/** 一层目录里与工作区身份有关的事实；判定层只问「在不在」，界面拿它陈述依据。 */
export interface WorkspaceLayerFacts {
  hasGit: boolean
  hasBackendRecord: boolean
  hasIdentityRecord: boolean
  hasMemberRecord: boolean
  hasTrackerDoc: boolean
}

/** 一次「判定依据」查询的结果；面板与设置页都只读它，不各自再探一遍。 */
export interface WorkspaceFacts {
  cwd: string
  root: string
  source: WorkspaceRootSource
  cache: string
  probe: boolean
  outer: { root: string; source: 'git' | 'record' } | null
  layer: WorkspaceLayerFacts
  rootLayer: WorkspaceLayerFacts | null
  noRecord: boolean
  canMerge: boolean
  canMarkIndependent: boolean
  canUnjoin: boolean
}

/** 一层目录的事实初值：没探测成功时全部按「没有」，界面据此什么都不说，而不是瞎说。 */
function emptyLayerFacts(): WorkspaceLayerFacts {
  return { hasGit: false, hasBackendRecord: false, hasIdentityRecord: false, hasMemberRecord: false, hasTrackerDoc: false }
}

/** 探测一层目录的五件事。逐项 try：任意一项问不了都按「没有」算，不影响其它项。 */
async function probeLayer(fsSvc: any, dir: any): Promise<WorkspaceLayerFacts> {
  const out: WorkspaceLayerFacts = emptyLayerFacts()
  try { out.hasGit = await existsAt(fsSvc, joinKey(dir, '.git')) } catch (e) {}
  try { out.hasBackendRecord = await existsAt(fsSvc, joinKey(dir, WORKSPACE_YAML_REL)) } catch (e) {}
  try { out.hasIdentityRecord = await existsAt(fsSvc, joinKey(dir, WORKSPACE_IDENTITY_REL)) } catch (e) {}
  try { out.hasMemberRecord = await existsAt(fsSvc, joinKey(dir, WORKSPACE_MEMBER_REL)) } catch (e) {}
  try { out.hasTrackerDoc = await existsAt(fsSvc, joinKey(dir, WORKSPACE_TRACKER_DOC_REL)) } catch (e) {}
  return out
}

/** 比较两条规整键是不是同一个目录（小写、正斜杠、去尾斜杠；与写侧 pathKeyOf 同一口径）。 */
function sameKeyOf(a: any, b: any): boolean {
  return String(a || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 从 root 的上一层继续往上找「另一个工作区」（用于「本工作区位于 X 内」这句事实）。
 * 跳过从属记录层（那一层明确说自己不算工作区），第一个 .git 或工作区记录就是外面的工作区。
 * 到顶没有就是 null——不猜。
 */
async function findOuterWorkspace(fsSvc: any, root: any): Promise<{ root: string; source: 'git' | 'record' } | null> {
  let cursor: string | null = parentWorkspaceDir(root)
  for (let i: number = 0; i < 64 && cursor; i++) {
    const kind: 'git' | 'member' | 'record' | '' = await markerOf(fsSvc, cursor)
    if (kind === 'git' || kind === 'record') return { root: cursor, source: kind }
    cursor = parentWorkspaceDir(cursor)
  }
  return null
}

/** 规整后的钥匙看起来是不是一条绝对路径（只有绝对路径才谈得上往上找）。 */
function isAbsoluteKey(key: any, platform: any): boolean {
  try { if (platform && platform.path && typeof platform.path.isAbsolute === 'function') return platform.path.isAbsolute(key) === true } catch (e) {}
  return /^[a-z]:[\\/]/i.test(key) || /^[\\/]/.test(key)
}

/**
 * 工作区根判定（含 30 秒缓存）。deps 与 canonicalWorkspaceKey 同形，多一个可选的 logCtx。
 * @param {string} selectedKey 已归一的所选目录
 * @param {{ getPlatform?: Function, getFs?: Function, logCtx?: Object }} [deps]
 * @returns {Promise<{ root: string, source: string, cache: string }>}
 *   source：git 停在自带 .git 的那一层、record 停在自带插件工作区记录的那一层、self 一路到顶都没有标记、
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
        // 逐层向上：第一层有工作区标记（.git 或工作区记录）就停在这里；从属记录层明确说自己不算工作区，
        // 跳过它继续往上；一路到顶都没有标记，工作区根就是所选目录自己。
        // 层数上限只是兜底（真有环也不至于转不出来）。每层最多问四条固定路径（.git、从属记录与两份记录）。
        let cursor: any = key
        let root: string = key
        let source: WorkspaceRootSource = 'self'
        for (let i: number = 0; i < 64; i++) {
          const kind: 'git' | 'member' | 'record' | '' = await markerOf(fsSvc, cursor)
          if (kind === 'git' || kind === 'record') { root = cursor; source = kind; break }
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
 * 清掉根判定的 30 秒缓存（#1806 第 2 步）。写入一份新的工作区记录之后必须调用：
 * 记录刚落盘时旧结论还在缓存里，从「自己」变成「某个根」或反过来都要立刻生效，
 * 否则面板最多 30 秒仍在说旧话（#1806 要的是判定与事实一致，不是「等一会儿就一致」）。
 *
 * 只清整个表、不做前缀筛选：记录落盘是低频动作（初始化、面板绑定、人显式标注），
 * 一次清空代价可忽略；按前缀清反而容易漏掉「父目录的缓存结论也变了」这一层。
 */
export function forgetWorkspaceRootCache(): void {
  workspaceRootCache.clear()
}

/**
 * 把调用方递进来的目录洗成「所选目录本身」的规整钥匙（不锚根）。
 * 与 canonicalWorkspaceKey 同一套三步归一：绝对路径直接用；相对路径先问文件服务它指向哪；
 * 最后按 home 拼。抽出来是为了让「判定依据」查询用同一把尺子量调用方给的目录，
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

/**
 * 一次「把工作区身份说清楚」的查询（#1806 第 3 步）：根是谁、凭什么、外面还套着谁、
 * 这一层有没有说明文件与各种记录。面板与设置页只读它，不各自再探一遍、也不自己猜。
 *
 * 为什么是宿主电话而不是客户端自己算：判定与记录的口径只在宿主这一处；客户端拿快照里的
 * workspaceRoot 只能知道「根是谁」，answer 不了「凭 .git 还是凭插件记录」「外面还有没有工作区」。
 * 返回里的 canMerge / canMarkIndependent 是给界面用的「这个纠正动作现在做不做得了」，
 * 判断依据全部来自上面这些事实，不额外加启发式。
 */
export async function inspectWorkspaceFacts(selectedKey: any, deps?: any): Promise<WorkspaceFacts> {
  const d: any = deps || {};
  let key: string = '';
  let platform: any = null;
  try {
    const sel: any = await normalizeSelectedKey(selectedKey, d);
    key = (sel && sel.key) ? sel.key : '';
    platform = sel ? sel.platform : null;
  } catch (e) { key = ''; platform = null; }
  const facts: WorkspaceFacts = {
    cwd: key, root: key, source: 'self', cache: 'skip', probe: false,
    outer: null, layer: emptyLayerFacts(), rootLayer: null,
    noRecord: true, canMerge: false, canMarkIndependent: false, canUnjoin: false,
  };
  if (!key) { facts.source = 'empty'; return facts; }
  if (!isAbsoluteKey(key, platform)) { facts.source = 'relative'; return facts; }
  const fsSvc: any = (typeof d.getFs === 'function') ? d.getFs() : null;
  facts.probe = !!fsSvc && hasProbe(fsSvc);
  let res: WorkspaceRootResult = { root: key, source: 'fail', cache: 'skip' };
  try { res = await resolveWorkspaceRoot(key, { platform: platform, getFs: d.getFs, logCtx: d.logCtx }) } catch (e) {}
  facts.root = res.root || key;
  facts.source = res.source;
  facts.cache = res.cache;
  facts.noRecord = facts.source === 'self';
  if (!facts.probe) return facts;
  try {
    const layer: WorkspaceLayerFacts = await probeLayer(fsSvc, key);
    facts.layer = layer;
    facts.rootLayer = sameKeyOf(facts.root, key) ? layer : await probeLayer(fsSvc, facts.root);
    if (facts.source === 'git' || facts.source === 'record') facts.outer = await findOuterWorkspace(fsSvc, facts.root);
    facts.canMerge = facts.source === 'record' && sameKeyOf(facts.root, key) && !layer.hasGit && facts.outer !== null;
    // 历史遗留：这一层有说明文件、却没有任何工作区记录（也不自带 .git），按上级工作区看待；
    // 界面只提示「可以标为独立」，点了才写记录——系统不替人猜。
    facts.canMarkIndependent = !sameKeyOf(facts.root, key) && layer.hasTrackerDoc && !layer.hasGit
      && !layer.hasBackendRecord && !layer.hasIdentityRecord && !layer.hasMemberRecord;
    // 撤销「并入上级」（#1806 第 5 步真机复核发现）：并进去的时候，这一层的两份工作区记录被删了、只剩从属记录，
    // 判定继续往上，所以 canMarkIndependent 是假——设置页上再没有任何入口把记录写回来，可并入时的提示却承诺
    // 「以后还能改回来」。有从属记录、根在上面、自己不自带 .git，就是这个状态；给同一个动作一个撤销的说法。
    facts.canUnjoin = !sameKeyOf(facts.root, key) && layer.hasMemberRecord && !layer.hasGit;
  } catch (e) {}
  return facts;
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
export default { normalizeWorkspacePath, canonicalWorkspaceKey, resolveWorkspaceRoot, parentWorkspaceDir, inspectWorkspaceFacts };
