/**
 * src/host/workspaceKey.ts —— 宿主侧工作区键单源（地图 #278 A 方案 · #279 落地；#652 起多一步「锚到工作区根」）。
 *
 * 来源与零变化：本文件由同目录 workspaceKey.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./workspaceKey.js`，
 * 由 scripts/ts-hook.mjs 在加载时改指到同名 .ts。
 *
 * 以后谁改它：改「哪个目录算这个会话的工作区」这条规则的人。规则全文见
 *   docs/adr/20260918-subworkspace-identity-root.md（票 #649 定版，2026-09-18）。
 *
 * 这里有两步，一步都不能省：
 *   第一步 归一：把同一条目录的几种写法（盘符大小写、斜杠方向、尾斜杠）洗成同一把钥匙；
 *   第二步 锚根：把会话所选的那条目录往上找，找到真正代表这个工作区的那条目录（工作区根）。
 * 第二步是 #652 加的。为什么必须有：工作区级的东西（后端声明、标签配色文件、本地 Markdown 的票仓、
 *   后端绑定、检查链快照）物理上只有一份、只可能落在仓库那一级；按「会话所选目录」分桶，会让同一个
 *   仓库在界面上被切成互不相认的几份——子目录会话读不到根上的声明，还会往子目录里长出第二套。
 *
 * 判定规则（维护者 2026-09-18 确认，票 #649）：
 *   从所选目录逐层向上，第一个「自带 .git（文件或目录都算）」或「自带 docs/agents/issue-tracker.md」的
 *   目录就是工作区根；两种标记同等优先、谁近听谁；一路到盘符根或文件系统根都没有，就用所选目录本身。
 *   于是三条边界不用任何特例：子目录自带 .git（嵌套仓库）停在自己那一层；子目录自带主锚文件
 *   （别人在这里初始化过）同样停在自己那一层；一路到仓库根才遇到标记就归到仓库根。
 * 为什么不用 git rev-parse --show-toplevel：本地 Markdown 工作区可以完全不是 git 仓库，而「主锚文件」
 *   这一半标记 git 根本不认识；纯文件探测一次覆盖两种标记，也不起任何子进程。
 * 缓存与失败：判定结果按所选目录的规整键存在宿主内存里，30 秒后重算（标记可能后来才出现——用户刚建仓、
 *   刚跑完初始化，都会往根上放标记，永久缓存会让子目录会话一直停在没有根的旧结论上）；探测失败
 *   （目录不存在、文件服务不可用）一律回退所选目录，并且不写进缓存。
 *
 * 为什么这样标注：
 * 1. 相对导入说明符保留 `.js` 后缀（`../shared/time-config/values.js` 不改成 `.ts`），
 *    改了会绕过钩子的同名解析约定，所以不能动。
 * 2. 文件服务与平台路径的形状由宿主框架决定，本文件只读 `resolve`、`stat`、`lstat`、
 *    `listDir`、`exists` 与 `isAbsolute` 等少数成员，所以全部按 `any` 收，
 *    类型不替代运行时的能力检测。
 * 3. 缓存表的类型参数（键是规整钥匙、值是判定结果）只存在于类型层面，转译时整体剥离。
 * 4. 没有新增任何 import 边：只给已有引用加类型，不引入新模块依赖。
 */
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
      if(platform.os==='win32') n=n.toLowerCase();
      return n;
    }
  } catch {}
  return s;
}
// ── 工作区根判定（#652 落地）──────────────────────────────────────────────
// 标记写在这里（换标记只改下面这一行）；根判定的缓存存活时间住中央 YAML（config/ttl.yaml 的
// workspaceRootTtlMs 键），下面只留别名，调时间改 YAML。
const WORKSPACE_ANCHOR_REL: string = 'docs/agents/issue-tracker.md'
// 根判定结果按所选目录的规整键缓存多久（30 秒）后重算：标记（自带 .git 或自带主锚文件）可能后来才出现
// —— 用户刚建仓、刚跑完初始化都会往根上放标记，永久缓存会让子目录会话一直停在「没有根」的旧结论上；
// 但每次读都往上探一层又白读盘，所以留一个短窗。
// 值住中央 YAML（config/ttl.yaml 的 workspaceRootTtlMs 键）：这里直接引用中央常量，调时间改 YAML。
// 中央常量与本文件的常量同名，直接 import 原名。
// 路径走域构建产物写法，值由 tests/verify-time-config.ts 看守一致。
import { WORKSPACE_ROOT_TTL_MS } from '../shared/time-config/values.js'
const workspaceRootCache = new Map<string, any>()   // 所选目录规整键 → { root, source, at }
let rootLogSampleN: number = 0

// #491 房外埋点同款：日志里只记散列，不记路径原文。
function hash8(s: any): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }

/** 根判定结果的形状：算出来的工作区根、停在哪种标记、这一次是命中缓存还是现算。 */
export interface WorkspaceRootResult {
  root: string
  source: string
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

/** 这一层有没有工作区标记：返回 'git'（自带 .git，文件或目录都算）、'anchor'（自带主锚文件）或 ''（没有）。 */
async function markerOf(fsSvc: any, dir: any): Promise<string> {
  if (await existsAt(fsSvc, joinKey(dir, '.git'))) return 'git'
  if (await existsAt(fsSvc, joinKey(dir, WORKSPACE_ANCHOR_REL))) return 'anchor'
  return ''
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
 *   source：git 停在自带 .git 的那一层、anchor 停在自带主锚文件的那一层、self 一路到顶都没有标记、
 *           fail 探测失败回退所选目录、no-fs 与 no-probe 是连探测能力都没有。
 *   cache：hit 用的是缓存、miss 与 expired 是这次真算的、skip 没算。
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
        let cursor: any = key
        let found: any = ''
        let stopAt: any = ''
        // 逐层向上：这一层有标记就停在这里；走到顶都没有就用所选目录本身。层数上限只是兜底（真有环也不至于转不出来）。
        for (let i: number = 0; i < 64; i++) {
          const m: string = await markerOf(fsSvc, cursor)
          if (m) { found = m; stopAt = cursor; break }
          const up: string | null = parentWorkspaceDir(cursor)
          if (!up) break
          cursor = up
        }
        const root: string = found ? stopAt : key
        workspaceRootCache.set(key, { root: root, source: found || 'self', at: Date.now() })
        out = { root: root, source: found || 'self', cache: missKind }
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

export async function canonicalWorkspaceKey(raw: any, deps: any): Promise<any> {
  const getPlatform: any = deps && deps.getPlatform;
  const getFs: any = deps && deps.getFs;
  const getDefaultCwd: any = deps && deps.getDefaultCwd;
  let input: any = raw;
  if (input == null || (typeof input==='string' && !input.trim())) {
    try { input = getDefaultCwd ? getDefaultCwd() : ''; } catch { input = ''; }
    if (!input) return '';
  }
  if (typeof input!=='string') input=String(input);
  input=input.trim();
  if(!input){
    try{ input = getDefaultCwd ? getDefaultCwd() : ''; }catch{}
  }
  let platform: any=null;
  try{ platform = getPlatform ? await getPlatform() : null; }catch{}
  // 三步归一都落在同一条出口上：洗出规整钥匙之后，再锚到工作区根（#652）。
  // 只有绝对路径能锚根（相对路径连「在哪一层」都答不出来）；锚不了就原样返回，与旧行为一致。
  async function rooted(norm: any): Promise<any>{
    try{
      const r: any = await resolveWorkspaceRoot(norm, { platform: platform, getFs: deps && deps.getFs, logCtx: deps && deps.logCtx });
      return (r && r.root) ? r.root : norm;
    }catch(e){ return norm }
  }
  try{
    if(platform && platform.path && typeof platform.path.isAbsolute==='function' && platform.path.isAbsolute(input)){
      return await rooted(normalizeWorkspacePath(input, platform));
    }
  }catch{}
  try{
    const fss: any = getFs ? getFs() : null;
    if(fss && typeof fss.resolve==='function'){
      const t: any = await fss.resolve(input);
      const target: any = (t && typeof t==='object') ? (t.path || t.target || t.displayPath || '') : t;
      if(typeof target==='string' && target){
        const isAbs: boolean = (platform && platform.path && typeof platform.path.isAbsolute==='function')
          ? platform.path.isAbsolute(target)
          : (/^[A-Za-z]:[\\\/]/.test(target) || /^\//.test(target) || /^\\\\/.test(target));
        if(isAbs) return await rooted(normalizeWorkspacePath(target, platform));
      }
    }
  }catch{}
  try{
    if(platform && typeof platform.getHome==='function'){
      const home: any = await platform.getHome();
      if(home && platform.path){
        const joined: any = platform.path.join(home, input);
        return await rooted(normalizeWorkspacePath(joined, platform));
      }
    }
  }catch{}
  if(platform) return await rooted(normalizeWorkspacePath(input, platform));
  return input;
}
export default { normalizeWorkspacePath, canonicalWorkspaceKey, resolveWorkspaceRoot, parentWorkspaceDir };
