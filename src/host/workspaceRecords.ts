/**
 * src/host/workspaceRecords.ts —— 工作区身份记录的维护电话（#1806 第 2、3 步）。
 *
 * 为什么要有这个文件：判定层（src/host/workspaceKey.ts）已经改成「认插件工作区记录」，
 * 但记录得有人写、也得有人能改回来。写记录有三条来源，本文件负责其中两条由宿主直接执行的动作：
 *   1. 初始化流程走完时补一份（source=setup，见 src/client/kernel/prompts-setup.ts 的调用）；
 *   2. 人在面板上显式「标为独立工作区」（source=user，电话 wf.markWorkspaceRoot）。
 * 第三条是「在面板里选定后端」——那条本来就会把 docs/agents/workspace.yaml 写到工作区根，
 * 后端记录本身就是判定层认的记录，所以不需要再补写一份身份记录。
 *
 * 第 3 步又加了三个动作，都围绕同一件事：让界面能「只陈述可验证事实、并给一键纠正」：
 *   - wf.workspaceFacts：只读，回答根是谁、凭什么、外面还套着谁、这一层有什么文件；
 *   - wf.joinParentWorkspace：把这一层「并入上级工作区」，写一份从属记录（workspace-member.yaml）。
 *     不删现有的 workspace.yaml / workspace-root.yaml：历史数据不迁移、不删除，而且动作可逆；
 *   - wf.markWorkspaceRoot 顺带删掉从属记录：人点「标为独立」时，先写的身份记录要能重新生效。
 *
 * 什么约定不能改：
 *   - 「在不在」只问路径在不在、不看内容，与判定层同一个口径（空文件、坏内容、目录都算有记录）。
 *     但“问在不在”要按真文件服务的契约读：lstat 对不存在的路径**resolve undefined（不抛异常）**，
 *     所以必须判断返回值真假，不能“调用没抛错就算在”（#1806 第 5 步真机复核发现的缺陷：
 *     原来的写法把每个路径都判成在，初始化补写与「标为独立」都因此什么都没写）。
 *   - 平台文件服务没有删除能力（真机实测：unlink / rm / delete / remove / trash / rename 全是 undefined），
 *     删记录文件按顺序退到能用的通道：文件服务自己的 unlink / rm，再到 Node 自带的 fs.unlink，
 *     最后用一次「还在不在」的探测裁决删没删掉。记录文件是插件自己写的元数据，
 *     仓库里 settingsPhones.ts、versionControlChanges.ts 等写点也直接用 Node 的文件系统删临时文件。
 *   - 一台目录已经有一份身份记录时不重写（幂等）：重复初始化、重复点「标为独立」都不该改内容，
 *     更不该把 writtenAt 刷成新时间——它记录的是「第一次成为工作区」的那一刻。
 *     “在不在”只问路径在不在、不看内容，与判定层同一个口径（空文件、坏内容、目录都算有记录）。
 *   - 写进文件通道时走与其它写点同一条正规口子：先 resolve 出 target，再 writeText(target, text, …, policy)；
 *     政策取自同一次请求的会话（由装配侧传进来的 resolveSandboxPolicy），拿不到就传 undefined，
 *     交给 DSH 按部署默认政策判，不自己拼一份宽松政策。
 *   - 写完必须读回核对，内容一致才算写成；同时清掉工作区快照缓存与根判定缓存，
 *     否则面板最多 30 秒仍在说旧话。
 *   - ensure 写在哪一层，以判定层给出的工作区根为准（#1806 第 4 步改定）：会话开在工作区的子目录里、
 *     初始化文案其实是为上面那个工作区给出的，这时记录要写到根上，下次才判得出「已经初始化过」；
 *     写到子目录上会把「上级工作区的一个目录」变成「一个独立工作区」，正好是 #1806 要避免的事。
 *     目录自己就是 git 根时也照写：.git 只证明「这是工作区」，不证明「初始化提示发出过」，
 *     而后者才是 tracker:initialized 要回答的问题（ADR 20261102 §5 否掉了「.git 或说明文件算已初始化」）。
 *     判定这一步出错时宁可当场报失败（root-unknown）也不写：最该拦住子目录的时候，不能因为“不知道”就放行。
 *
 * 反例：如果 ensure 不先问判定层、直接写，用户对着仓库里任意子目录跑一遍初始化，
 * 那个子目录就会从「仓库的一部分」变成独立工作区，后端绑定、票仓、标签配色全部另起一套。
 *
 * 本文件是自包含叶子：不引用其它 host 文件；装配在 src/host/index.ts，依赖全由装配点显式传入。
 */
// 本域 tsconfig 有意不加载任何类型包（types 为空），Node 内建模块的类型声明随 @types/node 一起被挡在门外；
// 运行时一定是 Node（宿主进程），这个模块必然存在，所以只忽略这一行导入的类型错误（纯类型层面，不影响转译）。
// @ts-expect-error
import { unlink as nodeUnlink } from 'node:fs/promises'
import {
  WORKSPACE_IDENTITY_REL,
  WORKSPACE_IDENTITY_KIND,
  WORKSPACE_IDENTITY_KNOWN_VERSION,
  stringifyIdentityRecord,
  WORKSPACE_MEMBER_REL,
  WORKSPACE_MEMBER_KIND,
  WORKSPACE_MEMBER_KNOWN_VERSION,
  stringifyMemberRecord,
} from '../shared/config-store/src/workspace.js'

type WfArgs = Record<string, any>
type LogCtx = { fire(level: string, event: string, fields?: unknown): void; isEnabled(level: string): boolean } | null
type FsSvc = {
  resolve(rel: string, opts?: unknown): Promise<any>
  readText(t: unknown): Promise<string>
  writeText(t: unknown, text: string, a?: unknown, b?: unknown, policy?: unknown): Promise<unknown>
  lstat?(p: unknown): Promise<unknown>
  unlink?(p: unknown): Promise<unknown>
}
type Deps = {
  ctx: { get(key: string): any }
  fs?: any
  getPlatform(): Promise<any>
  getWorkspaceStore(): Promise<any>
  setCache(v: unknown): void
  canonicalKey(raw: string): Promise<string>
  resolveSandboxPolicy(args: WfArgs | null, cwd: string): { policy?: unknown; sessionId?: string }
  /**
   * 只读的「判定依据」查询，由装配侧接到 workspaceKey.inspectWorkspaceFacts。
   * 写侧不能 import 判定层（宿主层文件之间不许互相引用），所以能力由装配点显式传入。
   * 拿不到或抛错时，写侧一律当「不知道」处理：不写、不猜（失败关闭）。
   */
  resolveFacts(raw: string): Promise<any>
  invalidateRootCache?(): unknown
  logCtx?: LogCtx
}

/** 日志里只记散列，不记路径原文（与 workspaceCwd / workspaceKey 同一个 djb2 写法）。 */
function hash8(s: unknown): string { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
function msgOf(e: unknown): string { try { return String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e || '') } catch (e2) { return '' } }

/**
 * 写文件失败时把原因分成四档，与 src/host/workspaceCwd.ts 的 fileWriteReasonOf 同一口径：
 * 拿不到文件通道、沙箱不给本次写许可、文件系统只读、目录不存在；判不出来归 other，不编具体原因。
 */
function fileWriteReasonOf(e: unknown): string {
  const s = String(((e as { code?: unknown }) && (e as { code?: unknown }).code) || msgOf(e) || '')
  return /EACCES|EPERM|permission|denied|permit|沙箱/i.test(s) ? 'no-permit' : (/EROFS|read-only|readonly/i.test(s) ? 'readonly' : (/ENOENT|not found|不存在/i.test(s) ? 'no-dir' : 'other'))
}

/** 一把用来比较「两条路径是不是同一个目录」的规整键：小写、正斜杠、去尾斜杠。 */
function pathKeyOf(p: unknown): string { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }

/** 看一条路径是不是绝对路径（Windows 盘符或 POSIX/UNC 开头）。相对路径连「是哪一层」都答不出来。 */
function isAbsolutePath(p: unknown): boolean {
  const s = String(p || '')
  return /^[A-Za-z]:[\\/]/.test(s) || /^[\\/]/.test(s)
}

/** 拼一层目录下的某条相对路径。入参是已归一的工作区键，所以按它自己的分隔符拼，不经过平台路径模块。 */
function joinKey(dir: unknown, rel: string): string { const s = String(dir || ''); const sep = s.indexOf('\\') >= 0 ? '\\' : '/'; return s.replace(/[\\/]+$/, '') + sep + rel }

export function createWorkspaceRecords(deps: Deps) {
  /** 取可用的文件通道：优先平台服务，缺了再看框架上下文里那一份（与 workspaceCwd 同一顺序）。 */
  async function getFs(): Promise<FsSvc | null> {
    let fsSvc: any = null
    try { const plat = await deps.getPlatform(); fsSvc = (plat && plat.fs) || null } catch (e) { fsSvc = null }
    if (!fsSvc && deps.ctx && typeof deps.ctx.get === 'function') { try { fsSvc = deps.ctx.get('fs') || null } catch (e) { fsSvc = null } }
    return fsSvc
  }

  /** 一次失败回执：kind 说明是哪一类问题，reason 是机器可判的短码，message 是给人看的一句话。 */
  function fail(kind: string, reason: string, message: string): any { return { ok: false, error: { kind: kind, reason: reason, message: message } } }

  /**
   * 记录落盘或被删掉之后，三处缓存必须一起清：工作区快照、这一层的缓存、根判定的 30 秒缓存。
   * 不清就会「事实已经变了，界面还在说旧话」，而 #1806 要的正是判定与事实一致。
   */
  async function clearCaches(cacheCwd: string): Promise<void> {
    try { const ws = await deps.getWorkspaceStore(); if (ws && typeof ws.invalidate === 'function') ws.invalidate({ cwd: cacheCwd }) } catch (e) {}
    try { deps.setCache({ ts: 0, snapshot: null, error: null, cwd: cacheCwd }) } catch (e) {}
    try { if (typeof deps.invalidateRootCache === 'function') await deps.invalidateRootCache() } catch (e) {}
  }

  /**
   * 记录“在不在”只看路径在不在，不看内容——判定层（workspaceKey.ts 的 markerOf）就是这个口径：
   * 空文件、坏内容、记录位置是个目录，都算“这一层有记录”。写侧必须同一个口径，
   * 否则写侧说“没有、我再写一份”的时候，判定层其实已经把这个目录当成工作区根了。
   */
  async function recordExistsAt(fsSvc: FsSvc, target: any): Promise<boolean> {
    // resolve 回来的是一个带 path 的描述对象；文件服务的 lstat 收的是路径本身（与其它写点传法一致）。
    const p = (target && typeof target === 'object') ? (target.path || target.targetKey || target) : target
    // 真文件服务的 lstat 对不存在的路径 resolve undefined、不抛异常（#1806 第 5 步真机实测）；
    // 所以按返回值真假判断，抛异常也按不在算，两种契约都对。
    if (typeof fsSvc.lstat === 'function') { try { return !!(await fsSvc.lstat(p)) } catch (e) { return false } }
    try { const txt = await fsSvc.readText(target); return txt !== undefined && txt !== null } catch (e) { return false }
  }

  /**
   * 往 dir 里写一份身份记录。source 只能是 'setup' 或 'user'。
   * cacheCwd 是这次状态变化要清缓存的那把键：ensure 传判定层归好的根，mark 传人指定的这一层。
   * 返回形状固定：{ ok, placed, reason, dir, path } 或 { ok:false, error:{ kind, reason, message } }。
   * placed=false 表示这次什么都没写（已经有记录），不是错误。
   */
  async function writeIdentityRecord(dir: string, source: 'setup' | 'user', args: WfArgs, cacheCwd: string): Promise<any> {
    const fsSvc = await getFs()
    if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.writeText !== 'function') {
      return fail('env', 'no-channel', '这次没拿到可用的文件通道，所以没能把这个目录写成工作区。')
    }
    let target: any = null
    try { target = await fsSvc.resolve(WORKSPACE_IDENTITY_REL, { cwd: dir }) } catch (e) { return fail('env', fileWriteReasonOf(e), '这个工作区里的记录文件路径解析不出来：' + msgOf(e).slice(0, 120)) }
    if (await recordExistsAt(fsSvc, target)) return { ok: true, placed: false, reason: 'exists', dir: dir, path: WORKSPACE_IDENTITY_REL }
    const built = stringifyIdentityRecord({ version: WORKSPACE_IDENTITY_KNOWN_VERSION, kind: WORKSPACE_IDENTITY_KIND, writtenAt: Date.now(), source: source })
    if (!built.ok) return { ok: false, error: { kind: 'record', reason: built.reason, message: built.message } }
    let policy: unknown = undefined
    try { policy = deps.resolveSandboxPolicy(args, dir).policy } catch (e) { policy = undefined }
    const write = async (): Promise<void> => { await fsSvc.writeText(target, built.text, undefined, undefined, policy) }
    try { await write() } catch (e1) { try { await write() } catch (e2) { return fail('env', fileWriteReasonOf(e2), '没能把工作区身份记录写进这个目录：' + msgOf(e2).slice(0, 120)) } }
    let back = ''
    try { back = await fsSvc.readText(target) } catch (e) { return fail('env', 'read-back-mismatch', '工作区身份记录写完之后读不回来，这次写入不能算数。') }
    if (back !== built.text) return fail('env', 'read-back-mismatch', '工作区身份记录写完读回来的内容与写下去的不一致，这次写入不能算数。')
    await clearCaches(cacheCwd)
    return { ok: true, placed: true, reason: 'created', dir: dir, path: WORKSPACE_IDENTITY_REL }
  }

  /**
   * 往 dir 里写一份从属记录（#1806 第 3 步）：表示「这一层归上面的工作区」。
   * 与身份记录同一套写入约定（先问在不在、读回核对、清三处缓存），区别只在文件与内容格式。
   * 不删这个目录里已有的 workspace.yaml / workspace-root.yaml：它们只是被这份文件盖住，
   * 人以后点「标为独立工作区」删掉从属记录，原来的记录就重新生效。
   */
  async function writeMemberRecord(dir: string, args: WfArgs, cacheCwd: string): Promise<any> {
    const fsSvc = await getFs()
    if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.writeText !== 'function') {
      return fail('env', 'no-channel', '这次没拿到可用的文件通道，所以没能把这个目录并入上级工作区。')
    }
    let target: any = null
    try { target = await fsSvc.resolve(WORKSPACE_MEMBER_REL, { cwd: dir }) } catch (e) { return fail('env', fileWriteReasonOf(e), '这个目录里的从属记录路径解析不出来：' + msgOf(e).slice(0, 120)) }
    if (await recordExistsAt(fsSvc, target)) return { ok: true, placed: false, reason: 'exists', dir: dir, path: WORKSPACE_MEMBER_REL }
    const built = stringifyMemberRecord({ version: WORKSPACE_MEMBER_KNOWN_VERSION, kind: WORKSPACE_MEMBER_KIND, writtenAt: Date.now(), source: 'user' })
    if (!built.ok) return { ok: false, error: { kind: 'record', reason: built.reason, message: built.message } }
    let policy: unknown = undefined
    try { policy = deps.resolveSandboxPolicy(args, dir).policy } catch (e) { policy = undefined }
    const write = async (): Promise<void> => { await fsSvc.writeText(target, built.text, undefined, undefined, policy) }
    try { await write() } catch (e1) { try { await write() } catch (e2) { return fail('env', fileWriteReasonOf(e2), '没能把从属记录写进这个目录：' + msgOf(e2).slice(0, 120)) } }
    let back = ''
    try { back = await fsSvc.readText(target) } catch (e) { return fail('env', 'read-back-mismatch', '从属记录写完之后读不回来，这次写入不能算数。') }
    if (back !== built.text) return fail('env', 'read-back-mismatch', '从属记录写完读回来的内容与写下去的不一致，这次写入不能算数。')
    await clearCaches(cacheCwd)
    return { ok: true, placed: true, reason: 'created', dir: dir, path: WORKSPACE_MEMBER_REL }
  }

  /**
   * 删掉 dir 里的从属记录（「标为独立工作区」的一部分）。没有就什么也不做。
   * 删不掉必须如实失败：这时身份记录可能已经写了，但「从属记录还在」会让判定继续往上，
   * 界面看到的归属与刚点的动作对不上，比直接报失败更糟。
   */
  async function deleteMemberRecord(fsSvc: FsSvc | null, dir: string): Promise<any> {
    if (!fsSvc || typeof fsSvc.resolve !== 'function') return { ok: true, removed: false }
    let target: any = null
    try { target = await fsSvc.resolve(WORKSPACE_MEMBER_REL, { cwd: dir }) } catch (e) { return { ok: true, removed: false } }
    if (!(await recordExistsAt(fsSvc, target))) return { ok: true, removed: false }
    const p = (target && typeof target === 'object') ? (target.path || target.targetKey || '') : String(target || '')
    // 删除通道按可用顺序排：文件服务自己带的 unlink / rm（有的部署与测试夹具提供），
    // 最后是 Node 自带的 fs.unlink —— DSH 的平台文件服务真机上没有删除能力，只能退到这里。
    const channels: Array<[string, (arg: any) => Promise<unknown>, any]> = []
    if (typeof fsSvc.unlink === 'function') {
      // 与 src/tracker/rooms/markdown/workspace-checks.ts 的 cleanupProbe 同一写法：
      // 先递 resolve 出来的描述对象，个别实现只认纯路径，再试一次。
      channels.push(['fs.unlink(target)', function (a) { return fsSvc.unlink!(a) }, target])
      if (p) channels.push(['fs.unlink(path)', function (a) { return fsSvc.unlink!(a) }, p])
    }
    if (typeof (fsSvc as any).rm === 'function') channels.push(['fs.rm', function (a) { return (fsSvc as any).rm(a, { force: true }) }, p])
    if (p) channels.push(['node.unlink', function (a) { return nodeUnlink(String(a)) }, p])
    let lastErr: unknown = null
    for (const c of channels) { try { await c[1](c[2]); break } catch (e) { lastErr = e } }
    // 删没删掉以探测结果为准：调用没抛错不等于文件真的没了（例如删错了对象、实现假装成功）。
    if (await recordExistsAt(fsSvc, target)) {
      const why = lastErr ? msgOf(lastErr).slice(0, 120) : '文件服务与 Node 都没有给出可用的删除通道'
      return fail('env', 'member-delete-failed', '没能删掉这个目录里的从属记录，这次「标为独立工作区」不能算数：' + why)
    }
    await clearCaches(dir)
    return { ok: true, removed: true }
  }

  /**
   * 初始化流程走完时补写身份记录（#1806 第 4 步改定写点）。
   * 写在哪一层：判定层给出的工作区根，而不是「这次会话打开的目录」。两种情况都要照这个写：
   *   ① 会话开在子目录里——初始化文案其实是为上面那个工作区给出的，写到根上才对得上；
   *      写到子目录上会把「上级工作区的一个目录」变成「一个独立工作区」，正是 #1806 要避免的事。
   *      身份不变：写这份记录只说明「初始化提示已经发出过」，判定层以后仍按 .git / 已有记录认根，
   *      这份记录落在哪一层，那一层本来就已经是这次判定的根。
   *   ② 目录自己就是 git 根——也写。.git 只证明「这是工作区」，不证明「初始化提示发出过」；
   *      后者才是 tracker:initialized 要回答的问题（ADR 20261102 §5 否掉了「.git 或说明文件算已初始化」）。
   * 判定这一步出错时仍然失败关闭（root-unknown），不拿 raw 顶替：最该拦住子目录的时候，
   * “不知道”不等于“可以写”。当场说没写成，下次初始化还会再补一次。
   */
  async function handleEnsureWorkspaceRecord(args: WfArgs): Promise<any> {
    const raw = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd.trim() : ''
    if (!raw) return fail('args', 'empty-cwd', '没拿到要写工作区记录的那个目录。')
    let root: string = raw
    try {
      const r = await deps.canonicalKey(raw)
      if (typeof r === 'string' && r) root = r
    } catch (e) {
      return { ok: false, placed: false, reason: 'root-unknown', dir: raw, error: fail('env', 'root-unknown', '这次没能确认这个目录属于哪个工作区根（判定这一步出错了），所以没有写记录。').error }
    }
    const res = await writeIdentityRecord(root, 'setup', args, root)
    // 回执同时带上「这次会话的目录」与「记录实际写到的根」：调用方只看 ok，
    // 人按日志查问题时两者都要有，才说得出这次记录写去了哪。
    if (res && typeof res === 'object') return Object.assign({}, res, { dir: raw, root: root })
    return res
  }

  /**
   * 人显式把某个目录「标为独立工作区」。这条路不经过判定层：人指定的就是这一层本身，
   * 即使它现在正属于某个上级工作区，也要在这里落一份记录、把它变成独立工作区（这正是这个动作的用途）。
   * 只接受绝对路径：相对路径连「是哪一层」都答不出来，写下去可能落在插件当前目录上。
   */
  async function handleMarkWorkspaceRoot(args: WfArgs): Promise<any> {
    const raw = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd.trim() : ''
    if (!raw) return fail('args', 'empty-cwd', '没拿到要标为独立工作区的那个目录。')
    if (!isAbsolutePath(raw)) return fail('args', 'not-absolute', '只能把一条完整的绝对路径标为独立工作区。')
    // 先写身份记录（已有就不重写），再删从属记录：这样「原来并入过上级、现在要独立」的目录
    // 能一次完成两步，而重复点击不会刷新 writtenAt（幂等）。
    const res = await writeIdentityRecord(raw, 'user', args, raw)
    if (!res || !res.ok) return res
    const del = await deleteMemberRecord(await getFs(), raw)
    if (!del || !del.ok) return del
    if (del.removed) return { ok: true, placed: true, reason: 'promoted', dir: raw, path: WORKSPACE_IDENTITY_REL }
    return res
  }

  /**
   * 只读：把「这一层凭什么算（或不算）工作区、外面还套着谁」一次说清（#1806 第 3 步）。
   * 事实由判定层算，本电话只做参数检查与失败包装；界面不许自己拿快照猜依据。
   */
  async function handleWorkspaceFacts(args: WfArgs): Promise<any> {
    const raw = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd.trim() : ''
    if (!raw) return fail('args', 'empty-cwd', '没拿到要查工作区身份的那个目录。')
    let facts: any = null
    try { facts = await deps.resolveFacts(raw) } catch (e) {
      return fail('env', 'root-unknown', '这次没能查清这个目录的工作区身份：' + msgOf(e).slice(0, 120))
    }
    if (!facts) return fail('env', 'root-unknown', '这次没能查清这个目录的工作区身份。')
    return { ok: true, facts: facts }
  }

  /**
   * 把这一层「并入上级工作区」（#1806 第 3 步）：写一份从属记录，判定继续往上找。
   * 守卫顺序就是事实的顺序：先确认这一层现在确实是工作区根（不是就先说已经在哪个工作区里），
   * 自带 .git 的目录不能并入（它是仓库边界，.git 永远优先于记录），已经在从属状态就幂等返回，
   * 外面没有工作区就明说没有可并入的上级。所有「不写」都给出机器可判的 reason，界面照实说。
   */
  async function handleJoinParentWorkspace(args: WfArgs): Promise<any> {
    const raw = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd.trim() : ''
    if (!raw) return fail('args', 'empty-cwd', '没拿到要并入上级工作区的那个目录。')
    if (!isAbsolutePath(raw)) return fail('args', 'not-absolute', '只能把一条完整的绝对路径并入上级工作区。')
    let facts: any = null
    try { facts = await deps.resolveFacts(raw) } catch (e) {
      return fail('env', 'root-unknown', '这次没能确认这个目录现在是不是工作区根（判定这一步出错了），所以没有写记录。')
    }
    if (!facts || !facts.cwd) return fail('env', 'root-unknown', '这次没能确认这个目录现在是不是工作区根，所以没有写记录。')
    if (pathKeyOf(facts.root) !== pathKeyOf(facts.cwd)) {
      return { ok: true, placed: false, reason: 'inside-workspace', dir: facts.cwd, root: facts.root }
    }
    if (facts.layer && facts.layer.hasGit) return fail('state', 'git-root', '这个目录自带 .git，它本身就是一个仓库边界，不能并进上级工作区。')
    if (facts.layer && facts.layer.hasMemberRecord) return { ok: true, placed: false, reason: 'exists', dir: facts.cwd, path: WORKSPACE_MEMBER_REL }
    if (!facts.outer) return fail('state', 'no-parent', '这个目录外面没有另一个工作区，没有可并入的上级。')
    return await writeMemberRecord(facts.cwd, args, facts.cwd)
  }

  /** 成功记常驻 host.call，失败记常驻 host.call.fail：字段与既有一族电话一致，只记散列与原因档。 */
  function logPhone(method: string, kind: string, t0: number, res: any, err: unknown, cwdRaw: unknown): void {
    try {
      const lc = deps && deps.logCtx
      if (!lc || typeof lc.fire !== 'function') return
      // 没有目录可记时整格不带 cwdHash（与同族电话一致）：不带表示「不知道是哪个目录」，不写空串冒充。
      const base: Record<string, unknown> = { method: method, kind: kind }
      if (typeof cwdRaw === 'string' && cwdRaw) base.cwdHash = hash8(cwdRaw)
      if (err !== undefined && err !== null) { lc.fire('warn', 'host.call.fail', Object.assign({}, base, { errorHash: hash8(msgOf(err)), errorKind: 'throw' })) ; return }
      if (res && res.ok) { lc.fire('info', 'host.call', Object.assign({}, base, { latencyMs: Date.now() - t0, ok: true })) ; return }
      const why = (res && res.error && res.error.reason) ? String(res.error.reason) : 'not-ok'
      lc.fire('warn', 'host.call.fail', Object.assign({}, base, { errorHash: hash8(why), errorKind: why }))
    } catch (eL) {}
  }

  /** 两条电话都经这里包一层：成功、业务失败、抛异常各落一行常驻日志。 */
  function loggedPhone(method: string, kind: string, fn: (args: WfArgs) => Promise<any>) {
    return async function (args: WfArgs): Promise<any> {
      const t0 = Date.now()
      let cwdRaw: unknown = undefined
      try { cwdRaw = (args && typeof args.cwd === 'string') ? args.cwd : undefined } catch (e) {}
      try { const r = await fn(args || {}); logPhone(method, kind, t0, r, null, cwdRaw); return r } catch (e) { logPhone(method, kind, t0, null, e, cwdRaw); throw e }
    }
  }

  return {
    handleEnsureWorkspaceRecord: loggedPhone('wf.ensureWorkspaceRecord', 'workspace-record-ensure', handleEnsureWorkspaceRecord),
    handleMarkWorkspaceRoot: loggedPhone('wf.markWorkspaceRoot', 'workspace-record-mark', handleMarkWorkspaceRoot),
    handleWorkspaceFacts: loggedPhone('wf.workspaceFacts', 'workspace-facts', handleWorkspaceFacts),
    handleJoinParentWorkspace: loggedPhone('wf.joinParentWorkspace', 'workspace-record-join', handleJoinParentWorkspace),
  }
}
