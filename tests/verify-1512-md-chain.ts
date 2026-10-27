/**
 * tests/verify-1512-md-chain.ts —— 本地 Markdown 三项判据的六种真实场景，以及房间预检与链上判定一致（#1515，规格 #1512）。
 *
 * 规格 #1512 把「本地 Markdown 能不能用」从「找得到 map.md 吗」拆成三项环境判据：
 *   md:workspace（有没有能用的工作单元，或者工作区确实是空的）、
 *   md:scratchWritable（.scratch 写不写得进去）、
 *   md:containersReadable（地图与规格这些容器文件读不读得动）。
 * 本门禁钉两件事：
 *   一、六种工作区形态下，链上三项各自的结论（pass / fail / pending）与证据都对；
 *   二、同一份工作区，房间 preflight 的通过/不通过与链上三项完全一致——预检说能用，就不能有哪一项 fail；
 *       预检说不能用，那句话必须点名失败的是哪一项。
 *
 * 为什么只走外部行为、不直调判据内部函数：内部函数还能被改签名、改分解方式；真正会被看见的是
 *   「链求值回包」与「房间 preflight 回包」这两个外部入口。门禁若自己去拼内部调用，就等于把判据实现
 *   再抄一遍——实现错了、门禁跟着错。所以这里只做两件事：调外部入口、断言形状与证据。
 *
 * 六种场景（都按真实临时目录造，不打真网、不碰真实工作区，用完即删）：
 *   ① 空仓库（连 .scratch 都没有）          → 三项通过：空工作区是正常起点，不是故障
 *   ② 只有 .scratch/<名>/spec.md             → 三项通过：有规格就算有工作单元，不因没地图失败
 *   ③ 只有 .scratch/<名>/issues/             → 三项通过：普通票目录也算工作单元
 *   ④ .scratch/<名>/map.md 没有 DSH 头、正文乱 → 三项通过：手写旧文件按 md-v1 认，读得动就是读得动
 *   ⑤ 同一目录同时有 map.md 与 spec.md        → 三项通过：双容器不在本票判定范围内
 *   ⑥ 仓库根有旧布局 issues/01-*.md          → 三项通过：旧布局不在本票判定范围内（它另有一条兼容路径）
 * 再把「预检与链一致」反过来钉（量不出来的那一侧与失败那一侧都要钉住）：
 *   ⑦ 只读会话：写探测被沙箱拦住 → md:scratchWritable = pending（诚实未知，不是 fail），预检仍通过
 *   ⑧ 写探测被拒（权限不足）      → md:scratchWritable = fail，预检不通过且点名「本地数据目录能不能写」
 *   ⑨ .scratch 列不出来            → md:workspace = fail：读不出工作区不能谎报「空工作区」，容器判据也 fail，预检点名「本地工作区能不能读」
 *   ⑩ 容器文件写了不支持的版本号   → md:containersReadable = fail：md-v2 认不得，不能静默按 v1 读，预检点名「本地地图与规格文件能不能读」
 *   ⑪ 容器文件读不出来             → md:containersReadable = fail：权限坏掉要说读不出，不能当成没有容器文件，预检点名同一项
 *   ⑫ 一趟检查里 .scratch 根目录只列一次（#1528）：工作区判据与容器判据要的是同一份名字表，
 *      链上并行求值、房间预检顺序求值，两处都只许向文件服务要一次；多列一次就是重复扫描。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1512-md-chain.ts
 * 门禁归属: src/tracker/rooms/markdown/workspace-checks.ts
 * 门禁归属: src/host/remotePredicates.ts
 * 门禁归属: src/shared/tracker/check-catalog-dirs.ts
 * 门禁归属: src/tracker/rooms/markdown/index.ts
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createDetectChain } from '../src/refresh/rooms/host/check-chain-evaluation.js'
import { createRemotePredicates } from '../src/host/remotePredicates.js'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.js'

type AnyObj = { [key: string]: any }

let failed = false
const ok = (cond: boolean, label: string, detail?: unknown): void => {
  if (cond) { console.log('  PASS ' + label); return }
  failed = true
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + String(detail).slice(0, 400)))
}

/** 三项判据在链上的 id 与顺序（与 src/shared/tracker/check-catalog-dirs.ts 的 MARKDOWN_CATALOG 逐字对齐）。 */
const MD_IDS = ['md:workspace', 'md:scratchWritable', 'md:containersReadable']

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1512-chain-'))
/** Windows 上 mkdtemp 给的是反斜杠路径；本文件统一用 posix 写法拼路径，落地时 node:fs 两种都认。 */
const posixOf = (p: string): string => p.split('\\\\').join('/')
function newWs(prefix: string): string {
  return posixOf(fs.mkdtempSync(path.join(tmpRoot, prefix)))
}
/** 在临时工作区里按相对路径写文件（父目录按需创建）。 */
function writeTextAt(ws: string, rel: string, text: string): void {
  const abs = path.posix.join(ws, rel)
  fs.mkdirSync(path.posix.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text, 'utf8')
}

// 手写的旧文件：没有 DSH-FORMAT 版本行，按 md-v1 可读。
const SPEC_TEXT = '# demo 规格\n\n## Problem Statement\n\n夹具：一张规格，正文随便写。\n'
// 没有版本行、正文也乱写的地图：容器判据只问「读不读得动、版本认不认识」，不问内容好不好。
const RAGGED_MAP_TEXT = '# demo 地图\n\n这里没有 DSH-FORMAT 行，正文也是乱写的。\n'
const ISSUE_TEXT = '# 01-first\n\nStatus: ready-for-agent\n\n## Body\n\n夹具里的票\n'

// ---------------------------------------------------------------------------
// 文件服务适配器：在真实临时目录上按房间契约的文件能力造一层。
// 这样判据读到的是真文件，同时又能按场景造出「沙箱拒信」「写被拒」这两种量不出来的情形——
// 只靠真盘权限造不出稳定的沙箱拒信，跨机器一定会飘。
// ---------------------------------------------------------------------------

/** 场景要造的故障：缺省表示真盘一切正常。 */
type FsTrouble = {
  /** 列这些目录时抛 EACCES（造「读不出工作区」）。 */
  unreadableDirs?: string[]
  /** 读这些路径时抛 EACCES（造「容器文件读不出来」）。 */
  readDenied?: string[]
  /** 写这些路径（含其下级）时抛 EACCES（造「目录不可写」）。 */
  writeDenied?: string[]
  /** 只读会话的写探测抛沙箱拒信（造「被沙箱拦住」）。 */
  sandboxDenyOnReadonly?: boolean
}

function deniedError(what: string, target: string, code: string): Error {
  const e = new Error(code + ': permission denied, ' + what + ' ' + target) as Error & { code?: string }
  e.code = code
  return e
}
function underAny(list: string[], target: string): boolean {
  return list.some((one) => target === one || target.startsWith(one + '/') || target.startsWith(one + '\\\\'))
}

function makePlatform(trouble: FsTrouble = {}): AnyObj {
  /**
   * 这层文件服务被要求列过哪些路径（按发生顺序）。
   *
   * 为什么夹具要记这个：场景⑫ 钉的是「一趟检查里 .scratch 根目录只列一次」（#1528）。重复扫描看不见结论，
   *   只能从文件服务这一层看它被问了几次；记在平台对象上，场景在跑完之后自己数。
   */
  const listCalls: string[] = []
  const fsAdapter: AnyObj = {
    async resolve(p: unknown, opts?: unknown): Promise<string> {
      const raw = String(p)
      // 本文件里的工作区路径都是 posix 写法的绝对路径（含盘符）；只有真的相对路径才拼 cwd。
      if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) return raw
      const cwd = opts && typeof (opts as AnyObj).cwd === 'string' ? (opts as AnyObj).cwd : ''
      return cwd ? path.posix.join(cwd, raw) : raw
    },
    async readText(t: unknown): Promise<string> {
      const p = String(t)
      if (underAny(trouble.readDenied || [], p)) throw deniedError('open', p, 'EACCES')
      return fs.readFileSync(p, 'utf8')
    },
    async listDir(t: unknown): Promise<string[]> {
      const p = String(t)
      listCalls.push(p)
      if (underAny(trouble.unreadableDirs || [], p)) throw deniedError('scandir', p, 'EACCES')
      let st: any
      try { st = fs.statSync(p) } catch (e) { throw deniedError('scandir', p, 'ENOENT') }
      if (!st.isDirectory()) throw deniedError('scandir', p, 'ENOTDIR')
      return fs.readdirSync(p)
    },

    async exists(t: unknown): Promise<boolean> {
      try { return fs.existsSync(String(t)) } catch (e) { return false }
    },
    async stat(t: unknown): Promise<any> {
      try { return fs.statSync(String(t)) } catch (e) { return null }
    },
    async lstat(t: unknown): Promise<any> {
      try { return fs.lstatSync(String(t)) } catch (e) { return null }
    },
    async writeText(t: unknown, text: string, _enc?: unknown, _flag?: unknown, policy?: unknown): Promise<void> {
      const p = String(t)
      if (trouble.sandboxDenyOnReadonly && policy && (policy as AnyObj).mode === 'read-only') {
        // 与真实文件服务的沙箱拒信同一句话（判据按正则认它）。
        throw new Error('file access denied: workspace-write sandbox denies this write')
      }
      if (underAny(trouble.writeDenied || [], p)) throw deniedError('open', p, 'EACCES')
      fs.mkdirSync(path.posix.dirname(p), { recursive: true })
      fs.writeFileSync(p, String(text), 'utf8')
    },
    async unlink(t: unknown): Promise<void> {
      fs.unlinkSync(String(t))
    },
  }
  return {
    path: path.posix,
    fs: fsAdapter,
    listCalls: listCalls,
    env: { get: () => undefined, has: () => false },
    os: process.platform,
    getHome: () => os.homedir(),
  }
}

// ---------------------------------------------------------------------------
// 链的夹具：照 tests/verify-1483-chain-session-cache.ts 那套最小依赖形状（那一份已经在跑），
// 差别只在于 getPlatform 每次返回「当前场景」的适配器，mdPredicate 用生产实现（最贴近真实调用）。
// ---------------------------------------------------------------------------

let currentPlatform: AnyObj = makePlatform()

const detect = createDetectChain({
  canonicalKey: async (c: string) => c,
  DEFAULT_CWD: '/ws',
  resetGhCache: () => undefined,
  getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'markdown' }, explicit: null }) }),
  getPlatform: async () => currentPlatform,
  getTrackerRegistry: async () => ({ modules: () => [] }),
  getRepoKey: async () => null,
  timer: { timeout: () => new Promise(() => undefined) },
  probeSkill: async () => ({ ok: false, level: 'pending' }),
  // 生产实现：经装配点取房间那三份判据，本门禁不关心它内部怎么分派。
  mdPredicate: createRemotePredicates().mdPredicate,
  getChainCache: () => null,
  setChainCache: () => undefined,
  getChainBackoff: async () => ({
    verdict: async () => ({ needed: true, reason: 'due', waitMs: 0, cached: null }),
    note: async () => ({}),
  }),
  logCtx: { isEnabled: () => false, fire: () => undefined },
  gate: null,
  sandboxPolicyFor: async (info: AnyObj) => ({
    policy: { mode: info.sessionId === 'readonly-session' ? 'read-only' : 'workspace-write' },
    sessionId: info.sessionId,
  }),
} as any)

const stepOf = (snapshot: AnyObj | null | undefined, id: string): AnyObj | null => {
  const steps: AnyObj[] = snapshot && Array.isArray(snapshot.steps) ? snapshot.steps : []
  return steps.find((s: AnyObj) => String(s.id) === id) || null
}

/** 跑一趟链求值（markdown 后端那段），把回包原样交回。 */
async function chainRun(ws: string, sessionId = 'writable-session'): Promise<AnyObj> {
  return (await detect.handleChain({ cwd: ws, backendId: 'markdown', sessionId, lang: 'zh' } as any)) as AnyObj
}

/** 跑一趟房间 preflight：这是用户点「重查」时真正走的外部入口。 */
async function preflightRun(ws: string, sandboxPolicy?: unknown): Promise<AnyObj> {
  const events: AnyObj[] = []
  const ctx: AnyObj = {
    platform: currentPlatform,
    fs: currentPlatform.fs,
    cwd: ws,
    lang: 'zh',
    opId: 'verify-1512-md-chain',
    sandboxPolicy,
    logEvent: (level: string, event: string, fields: AnyObj) => events.push({ level, event, fields }),
    isEnabled: () => false,
    get: (name: string) => (name === 'fs' ? currentPlatform.fs : undefined),
  }
  const backend = createMarkdownBackend(ctx as never)
  const probe = (await backend.preflight({ cwd: ws } as never, ctx as never)) as AnyObj
  return { probe, events }
}

/** 链上 md 段的形状：恰好三项、顺序固定、没有 md:parseOk 这种已经被拆掉的旧项。 */
function assertMdShape(label: string, reply: AnyObj): void {
  const backendChain = reply.backendChain || {}
  const chainIds: string[] = (backendChain.chain || []).map((item: AnyObj) => String((item && (item.id || (item.check && item.check.id))) || ''))
  ok(JSON.stringify(chainIds) === JSON.stringify(MD_IDS), label + '：链上 md 段恰好三项且顺序固定 → ' + JSON.stringify(chainIds))
  ok(((backendChain.errors || []) as unknown[]).length === 0, label + '：三项都通过链校验（errors 为空）', JSON.stringify(backendChain.errors))
  const fullIds: string[] = (((reply.fullSnapshot || {}).steps || []) as AnyObj[])
    .map((s: AnyObj) => String(s.id || ''))
    .filter((id: string) => id.startsWith('md:'))
  ok(JSON.stringify(fullIds) === JSON.stringify(MD_IDS), label + '：fullSnapshot 里三项顺序与链上一致 → ' + JSON.stringify(fullIds))
  ok(JSON.stringify(reply).indexOf('md:parseOk') < 0, label + '：回包里没有已经拆掉的 md:parseOk')
}

/** 一项判据的 detail（失败信息里带上，方便一眼看到判据自己写的证据）。 */
function detailOf(resolved: AnyObj, id: string): string {
  const row = resolved && resolved[id]
  return row ? String(row.detail || '') : '（缺这一项）'
}

/** 六种场景共同的部分：三项都 pass、快照三处一致、房间预检通过。回包里的 resolved 交回给各场景补断言。 */
async function assertAllPass(label: string, ws: string): Promise<AnyObj> {
  const reply = await chainRun(ws)
  ok(reply.ok === true, label + '：链求值成功回包', JSON.stringify(reply.error))
  assertMdShape(label, reply)
  const resolved: AnyObj = (reply.backendChain || {}).resolved || {}
  for (const id of MD_IDS) {
    ok(!!resolved[id] && resolved[id].status === 'pass', label + '：' + id + ' 通过（实得 ' + (resolved[id] && resolved[id].status) + '）', detailOf(resolved, id))
    ok((stepOf((reply.backendChain || {}).snapshot, id) || {}).status === 'done', label + '：' + id + ' 在 backendChain.snapshot 里是 done')
    ok((stepOf(reply.fullSnapshot, id) || {}).status === 'done', label + '：' + id + ' 在 fullSnapshot 里是 done')
  }
  const pf = await preflightRun(ws)
  ok(pf.probe.ok === true, label + '：房间预检通过（三项无 fail）', pf.probe && pf.probe.error && pf.probe.error.message)
  return resolved
}

async function main(): Promise<void> {
  try {
    console.log('== 一、空仓库：三项都通过，空工作区是正常起点 ==')
    {
      const ws = newWs('c1-empty-')
      currentPlatform = makePlatform()
      const resolved = await assertAllPass('场景①', ws)
      const root = path.posix.join(ws, '.scratch')
      ok(detailOf(resolved, 'md:workspace').indexOf('空工作区：' + root) >= 0, '场景①：工作区判据说清「空工作区」并给出 .scratch 路径', detailOf(resolved, 'md:workspace'))
      ok(detailOf(resolved, 'md:scratchWritable').indexOf('还没有 ' + root + '；仓库根 ' + ws + ' 可写') >= 0, '场景①：写判据说清还没有 .scratch、但仓库根可写', detailOf(resolved, 'md:scratchWritable'))
      ok(detailOf(resolved, 'md:containersReadable').indexOf('没有容器文件（' + root + ' 里还没有 map.md / spec.md）') >= 0, '场景①：容器判据说清没有容器文件', detailOf(resolved, 'md:containersReadable'))
    }

    console.log('\n== 二、只有一张规格：不因没有地图失败 ==')
    {
      const ws = newWs('c2-spec-')
      writeTextAt(ws, '.scratch/demo/spec.md', SPEC_TEXT)
      currentPlatform = makePlatform()
      const resolved = await assertAllPass('场景②', ws)
      const root = path.posix.join(ws, '.scratch')
      ok(detailOf(resolved, 'md:workspace').indexOf('找到 1 个工作单元') >= 0 && detailOf(resolved, 'md:workspace').indexOf('demo（规格）') >= 0, '场景②：工作区判据认出 1 个工作单元、类型是规格', detailOf(resolved, 'md:workspace'))
      ok(detailOf(resolved, 'md:scratchWritable').indexOf(root) >= 0 && detailOf(resolved, 'md:scratchWritable').indexOf('可写') >= 0, '场景②：写判据在 .scratch 里真写过探针并给出可写结论（只钉路径与结论这类事实，不钉整句文案）', detailOf(resolved, 'md:scratchWritable'))
      ok(detailOf(resolved, 'md:containersReadable').indexOf('读到 1 个容器文件') >= 0 && detailOf(resolved, 'md:containersReadable').indexOf(path.posix.join(root, 'demo', 'spec.md')) >= 0, '场景②：容器判据读到那张 spec.md', detailOf(resolved, 'md:containersReadable'))
      ok(!fs.existsSync(path.posix.join(root, '.dsh-write-probe')), '场景②：写探针用完已删掉（不在工作区留垃圾）')
    }

    console.log('\n== 三、只有普通票目录：票目录也算工作单元 ==')
    {
      const ws = newWs('c3-issues-')
      writeTextAt(ws, '.scratch/demo/issues/01-first.md', ISSUE_TEXT)
      currentPlatform = makePlatform()
      const resolved = await assertAllPass('场景③', ws)
      ok(detailOf(resolved, 'md:workspace').indexOf('找到 1 个工作单元') >= 0 && detailOf(resolved, 'md:workspace').indexOf('demo（票目录）') >= 0, '场景③：工作区判据认出 1 个票目录', detailOf(resolved, 'md:workspace'))
      ok(detailOf(resolved, 'md:containersReadable').indexOf('没有容器文件') >= 0, '场景③：票目录不算容器文件', detailOf(resolved, 'md:containersReadable'))
    }

    console.log('\n== 四、地图文件没有 DSH 头、正文乱：读得动就是读得动 ==')
    {
      // 为什么这张「坏格式」仍算通过：格式只说文件头那行 DSH-FORMAT 声明的版本，没写版本行的手写文件按
      //   md-v1 认（见 src/tracker/rooms/markdown/original-fields.ts 的 isSupportedDshFormat）。正文乱不等于
      //   读不动：容器判据的职责是「能不能读到、版本认不认识」，不是「内容写得好不好」。
      const ws = newWs('c4-ragged-map-')
      writeTextAt(ws, '.scratch/demo/map.md', RAGGED_MAP_TEXT)
      currentPlatform = makePlatform()
      const resolved = await assertAllPass('场景④', ws)
      ok(detailOf(resolved, 'md:containersReadable').indexOf('读到 1 个容器文件') >= 0, '场景④：没有版本行的地图仍按 md-v1 读得动', detailOf(resolved, 'md:containersReadable'))
    }

    console.log('\n== 五、同一目录同时有地图与规格：双容器不在本票判定范围 ==')
    {
      const ws = newWs('c5-both-')
      writeTextAt(ws, '.scratch/demo/map.md', RAGGED_MAP_TEXT)
      writeTextAt(ws, '.scratch/demo/spec.md', SPEC_TEXT)
      currentPlatform = makePlatform()
      const resolved = await assertAllPass('场景⑤', ws)
      ok(detailOf(resolved, 'md:workspace').indexOf('找到 1 个工作单元') >= 0, '场景⑤：一个目录仍只算一个工作单元', detailOf(resolved, 'md:workspace'))
      ok(detailOf(resolved, 'md:containersReadable').indexOf('读到 2 个容器文件') >= 0, '场景⑤：两个容器文件都读得动', detailOf(resolved, 'md:containersReadable'))
    }

    console.log('\n== 六、仓库根有旧布局 issues/：三项都不受影响 ==')
    {
      const ws = newWs('c6-legacy-')
      writeTextAt(ws, 'issues/01-old.md', ISSUE_TEXT)
      currentPlatform = makePlatform()
      const resolved = await assertAllPass('场景⑥', ws)
      ok(detailOf(resolved, 'md:workspace').indexOf('找到 1 个工作单元') >= 0 && detailOf(resolved, 'md:workspace').indexOf('工作区根 issues/（旧版布局）') >= 0, '场景⑥：旧布局的票目录被认成一个工作单元', detailOf(resolved, 'md:workspace'))
      ok(detailOf(resolved, 'md:scratchWritable').indexOf('仓库根 ' + ws + ' 可写') >= 0, '场景⑥：没有 .scratch 时按仓库根量可写', detailOf(resolved, 'md:scratchWritable'))
      ok(detailOf(resolved, 'md:containersReadable').indexOf('没有容器文件') >= 0, '场景⑥：旧布局的票目录不算容器文件', detailOf(resolved, 'md:containersReadable'))
    }

    console.log('\n== 七、只读会话：写探测被沙箱拦住 → pending，不是 fail ==')
    {
      const ws = newWs('c7-sandbox-')
      writeTextAt(ws, '.scratch/demo/spec.md', SPEC_TEXT)
      currentPlatform = makePlatform({ sandboxDenyOnReadonly: true })
      const reply = await chainRun(ws, 'readonly-session')
      ok(reply.ok === true, '场景⑦：链求值成功回包（沙箱拦写不把链打成失败）', JSON.stringify(reply.error))
      assertMdShape('场景⑦', reply)
      const resolved: AnyObj = (reply.backendChain || {}).resolved || {}
      ok((resolved['md:scratchWritable'] || {}).status === 'pending', '场景⑦：写判据按 pending（诚实未知）→ 实得 ' + (resolved['md:scratchWritable'] || {}).status, detailOf(resolved, 'md:scratchWritable'))
      ok(/沙箱|sandbox/i.test(detailOf(resolved, 'md:scratchWritable')), '场景⑦：detail 说的是被沙箱拦住，不是目录不可写', detailOf(resolved, 'md:scratchWritable'))
      ok((resolved['md:workspace'] || {}).status === 'pass', '场景⑦：工作区判据不受影响，仍是 pass')
      ok((resolved['md:containersReadable'] || {}).status === 'pass', '场景⑦：容器判据不受影响，仍是 pass')
      const pf = await preflightRun(ws, { mode: 'read-only' })
      ok(pf.probe.ok === true, '场景⑦：pending 不算 fail，房间预检照旧通过', pf.probe && pf.probe.error && pf.probe.error.message)
    }

    console.log('\n== 八、写探测被拒：md:scratchWritable = fail，预检不通过且点名那一项 ==')
    {
      const ws = newWs('c8-writefail-')
      writeTextAt(ws, '.scratch/demo/spec.md', SPEC_TEXT)
      const scratchRoot = path.posix.join(ws, '.scratch')
      currentPlatform = makePlatform({ writeDenied: [scratchRoot] })
      const reply = await chainRun(ws)
      assertMdShape('场景⑧', reply)
      const resolved: AnyObj = (reply.backendChain || {}).resolved || {}
      ok((resolved['md:scratchWritable'] || {}).status === 'fail', '场景⑧：写判据判 fail（写确实被拒，不是沙箱）→ 实得 ' + (resolved['md:scratchWritable'] || {}).status, detailOf(resolved, 'md:scratchWritable'))
      ok((resolved['md:workspace'] || {}).status === 'pass', '场景⑧：工作区判据仍是 pass')
      ok((resolved['md:containersReadable'] || {}).status === 'pass', '场景⑧：容器判据仍是 pass')
      const pf = await preflightRun(ws, { mode: 'workspace-write' })
      ok(pf.probe.ok === false, '场景⑧：房间预检不通过（与链上那一项 fail 一致）')
      const message = pf.probe && pf.probe.error ? String(pf.probe.error.message) : ''
      ok(message.indexOf('预检没过：本地数据目录能不能写') >= 0, '场景⑧：预检那句话点名失败的是「本地数据目录能不能写」→ ' + message.slice(0, 160))
      ok(message.indexOf('EACCES') >= 0, '场景⑧：失败证据里带着错误原文（EACCES）', message.slice(0, 300))
    }

    console.log('\n== 九、.scratch 列不出来：md:workspace 判 fail，不能谎报空工作区 ==')
    {
      const ws = newWs('c9-unreadable-')
      writeTextAt(ws, '.scratch/demo/spec.md', SPEC_TEXT)
      const scratchRoot = path.posix.join(ws, '.scratch')
      currentPlatform = makePlatform({ unreadableDirs: [scratchRoot] })
      const reply = await chainRun(ws)
      assertMdShape('场景⑨', reply)
      const resolved: AnyObj = (reply.backendChain || {}).resolved || {}
      ok((resolved['md:workspace'] || {}).status === 'fail', '场景⑨：md:workspace 判 fail（列不出来不是空工作区）→ 实得 ' + (resolved['md:workspace'] || {}).status, detailOf(resolved, 'md:workspace'))
      ok(detailOf(resolved, 'md:workspace').indexOf('读不出工作区目录 ' + scratchRoot) >= 0, '场景⑨：证据点名读不出的那个路径', detailOf(resolved, 'md:workspace'))
      ok(detailOf(resolved, 'md:workspace').indexOf('空工作区') < 0, '场景⑨：读不出来不能当空工作区', detailOf(resolved, 'md:workspace'))
      ok((resolved['md:containersReadable'] || {}).status === 'fail', '场景⑨：容器判据也 fail（同一个目录列不出来）→ 实得 ' + (resolved['md:containersReadable'] || {}).status, detailOf(resolved, 'md:containersReadable'))
      const pf = await preflightRun(ws)
      ok(pf.probe.ok === false, '场景⑨：房间预检不通过（与链上那两项 fail 一致）')
      const message = String((pf.probe.error && pf.probe.error.message) || '')
      ok(message.indexOf('预检没过：本地工作区能不能读') >= 0, '场景⑨：预检点名「本地工作区能不能读」→ ' + message.slice(0, 160))
    }

    console.log('\n== 十、容器文件的版本号认不得：md:containersReadable 判 fail ==')
    {
      // 没写版本行的手写文件按 md-v1 认（场景④），这里换成写了版本号、但写的是插件认不得的版本：
      //   这时不能静默当 md-v1 读——容器判据要如实说「版本不是 md-v1」。
      const ws = newWs('c10-bad-format-')
      writeTextAt(ws, '.scratch/demo/map.md', '<!-- DSH-FORMAT: md-v2 -->\n\n# demo 地图\n')
      currentPlatform = makePlatform()
      const reply = await chainRun(ws)
      assertMdShape('场景⑩', reply)
      const resolved: AnyObj = (reply.backendChain || {}).resolved || {}
      ok((resolved['md:workspace'] || {}).status === 'pass', '场景⑩：工作区判据仍是 pass')
      ok((resolved['md:containersReadable'] || {}).status === 'fail', '场景⑩：容器判据判 fail（md-v2 认不得）→ 实得 ' + (resolved['md:containersReadable'] || {}).status, detailOf(resolved, 'md:containersReadable'))
      ok(detailOf(resolved, 'md:containersReadable').indexOf('声明了不支持的格式 md-v2') >= 0 && detailOf(resolved, 'md:containersReadable').indexOf('只支持 md-v1') >= 0, '场景⑩：证据说清文件声明的是 md-v2、插件只支持 md-v1', detailOf(resolved, 'md:containersReadable'))
      const pf = await preflightRun(ws)
      ok(pf.probe.ok === false, '场景⑩：房间预检不通过')
      const message = String((pf.probe.error && pf.probe.error.message) || '')
      ok(message.indexOf('预检没过：本地地图与规格文件能不能读') >= 0, '场景⑩：预检点名「本地地图与规格文件能不能读」→ ' + message.slice(0, 160))
    }

    console.log('\n== 十一、容器文件读不出来：点名那个文件，不能当成没有容器文件 ==')
    {
      const ws = newWs('c11-readfail-')
      writeTextAt(ws, '.scratch/demo/map.md', SPEC_TEXT)
      const mapPath = path.posix.join(ws, '.scratch/demo/map.md')
      currentPlatform = makePlatform({ readDenied: [mapPath] })
      const reply = await chainRun(ws)
      assertMdShape('场景⑪', reply)
      const resolved: AnyObj = (reply.backendChain || {}).resolved || {}
      ok((resolved['md:workspace'] || {}).status === 'pass', '场景⑪：工作区判据只列目录、不读文件，仍是 pass')
      ok((resolved['md:containersReadable'] || {}).status === 'fail', '场景⑪：容器判据判 fail（读不出文件不能说成没有容器文件）→ 实得 ' + (resolved['md:containersReadable'] || {}).status, detailOf(resolved, 'md:containersReadable'))
      ok(detailOf(resolved, 'md:containersReadable').indexOf('读不出容器文件 ' + mapPath) >= 0, '场景⑪：证据点名读不出的那个文件', detailOf(resolved, 'md:containersReadable'))
      const pf = await preflightRun(ws)
      ok(pf.probe.ok === false, '场景⑪：房间预检不通过')
      const message = String((pf.probe.error && pf.probe.error.message) || '')
      ok(message.indexOf('预检没过：本地地图与规格文件能不能读') >= 0, '场景⑪：预检点名「本地地图与规格文件能不能读」→ ' + message.slice(0, 160))
    }

    console.log('\n== 十二、一趟检查里 .scratch 根目录只列一次（#1528）==')
    {
      // 为什么这一条要单独量：三项判据的结论早就被上面几段钉住了，重复列盘是「结论对、活干了两遍」，
      //   只有从文件服务这一层看它被问了几次才看得见。链上三项是并行求值的，房间预检是顺序求值的，
      //   两种跑法都该让工作区判据与容器判据共用同一份名字表，而不是各列各的。
      const ws = newWs('c12-list-once-')
      writeTextAt(ws, '.scratch/demo/spec.md', SPEC_TEXT)
      const root = path.posix.join(ws, '.scratch')
      const rootListingCount = (platform: AnyObj): number =>
        ((platform.listCalls as string[]) || []).filter((one: string) => one === root).length

      currentPlatform = makePlatform()
      const reply = await chainRun(ws)
      ok(reply.ok === true, '场景⑫：链求值成功回包', JSON.stringify(reply.error))
      assertMdShape('场景⑫', reply)
      const listingCount = rootListingCount(currentPlatform)
      ok(listingCount === 1, '场景⑫：一趟链求值里 .scratch 根目录只列一次 → 实得 ' + listingCount + ' 次')

      currentPlatform = makePlatform()
      const pf = await preflightRun(ws)
      ok(pf.probe.ok === true, '场景⑫：房间预检照旧通过', pf.probe && pf.probe.error && pf.probe.error.message)
      const preflightListingCount = rootListingCount(currentPlatform)
      ok(preflightListingCount === 1, '场景⑫：一趟房间预检里 .scratch 根目录只列一次 → 实得 ' + preflightListingCount + ' 次')
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }

  assert.equal(failed, false)
  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
