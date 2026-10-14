/**
 * verify-detection-evidence.ts —— #1048 验收：判定「收全证据再合成」，且每一步都能从日志读出为什么这么判
 *
 * 这张票要说清的事（原文要点）：①正确输入下判定结论逐例与今天一致；②本次讨论发现的缺陷逐条修、
 * 各附一条回归断言；③对外可见的三样（对上层返回结构、落盘字节、门禁通过集合）除有意修正外不变；
 * ④相关门禁全绿、全仓红点数不增。它不新增界面入口，也不改「人选」的写法。
 *
 * 本文件钉住下面七件：
 *  A 三层顺序与来源：工作区文件 > 声明文件 > 各房认领（结论与 #1003 期逐例一致）。
 *  B 内部三态说实话：decided（有结论）/ undetermined（判不出来，缺什么写在 missing 与 gap 里）/
 *    no-backend（问过了，确实没有）。**回归断言：没问过各房时不许说「确实没有后端」**——
 *    这正是本次讨论发现的缺陷：从前「没看成 / 没问成」与「问过没人认领」会写成同一句话。
 *  C 一次读取、一份结论：声明文件只读一次，且与探测器、工具壳共用 parseIssueTracker
 *    （出口原来自带那套只看标题、优先级还相反，已删）。
 *  D 多命中按明文顺序裁剪：MULTI_CLAIM_ORDER（GitHub > Markdown > GitLab）与装配顺序一致。
 *  E 证据矛盾带出来：「我选的」（工作区文件）与「项目里写的」（声明文件）不一致时，结论仍按顺序取，
 *    但矛盾进结果与日志，不静默吞掉。
 *  F 日志分层：平时一条结论（常驻事件 detection.detect，含来源、三态、档位、覆盖度、耗时、矛盾）；
 *    调试开关打开才逐层记一步（按需事件 detection.step），并且**证据范围同时放宽成「三层全问」**——
 *    平时省掉的是「要起外部命令」的各房认领那一层，排查时宁可多问几家，也要把矛盾与覆盖度看全。
 *    守门人断言：放宽范围只多出诊断信息，对外五字段、写权限、原因、三态、档位逐格不差。
 *  G 对外五个字段一个不动：上层经 selectionFromOutlet 拿到的仍只有 backendId/source/ref/multiHit/pending。
 *
 * 用法：node --import ./scripts/ts-hook.mjs tests/verify-detection-evidence.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MULTI_CLAIM_ORDER,
  abstainEvidence,
  decideBackend,
  decidePure,
  decisionGapOf,
  formatCoverage,
  normalizeClaim,
  orderClaims,
  pickVerdict,
  resolveEvidenceScope,
  selectionFromOutlet,
  skippedEvidence,
  synthesize,
  verdictEvidence,
} from '../src/tracker/detection/backendDecision.ts'
import { parseIssueTracker } from '../src/tracker/detection/parseIssueTracker.ts'
import type { DecideRegistry } from '../src/tracker/detection/backendDecision.ts'
import type { SandboxFs } from '../src/tracker/contract/contexts.ts'

/** 交进判定出口的文件服务这一格（就是沙箱文件服务里用得着的那两个方法）。 */
type FsLike = Pick<SandboxFs, 'resolve' | 'readText'>

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

let passed = 0
let failed = 0
/**
 * 一条断言。第三个参数是「实得什么」，失败时必须打出来：
 * 门禁不能只说「不对」，得让人当场看见实际值，否则排查还要回去加打印（#1048 复核补齐）。
 */
function ok(cond: unknown, msg: string, evidence?: unknown): void {
  if (cond) { console.log('  PASS ' + msg); passed++ }
  else { console.log('  FAIL ' + msg + (evidence === undefined ? '' : '  —— 实得：' + String(evidence))); failed++ }
}
function title(t: string): void { console.log('\n== ' + t + ' ==') }

/** 一条日志行（本文件自己记的假日志，不需要真日志器）。 */
interface LogRow { level: string; event: string; fields: Record<string, unknown> }

/**
 * 假日志出口：两个口子与真日志器同形（fire 记一行，isEnabled 说这一档开没开）。
 * debugOn 对应「面板上把调试开关打开」；关着时按需事件一条都不该发，结论线照发。
 */
function fakeLog(debugOn: boolean): { rows: LogRow[]; ctx: { fire(l: string, e: string, f: Record<string, unknown>): boolean; isEnabled(l: string): boolean } } {
  const rows: LogRow[] = []
  return {
    rows,
    ctx: {
      fire(level: string, event: string, fields: Record<string, unknown>): boolean { rows.push({ level, event, fields }); return true },
      isEnabled(level: string): boolean { return debugOn && level === 'debug' },
    },
  }
}

/** 假沙箱文件服务：只有给进来的路径有内容，其余一律说「没有这份文件」；reads 记下每一次读取。 */
interface FakeFsTarget { rel?: string; cwd?: string }
function fakeFs(files: Record<string, string | null>): { reads: string[]; fs: FsLike } {
  const reads: string[] = []
  return {
    reads,
    fs: {
      async resolve(rel: string, opts?: { cwd?: string }): Promise<unknown> {
        return { rel: String(rel), cwd: String((opts && opts.cwd) || '') }
      },
      async readText(target: unknown): Promise<string> {
        const t = (target || {}) as FakeFsTarget
        const rel = String(t.rel || '')
        reads.push(rel)
        const text = Object.prototype.hasOwnProperty.call(files, rel) ? files[rel] : null
        if (text == null) throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
        return text
      },
    } as unknown as FsLike,
  }
}

/**
 * 只读注册表：谁在名单里算装上了；select 可选（不给就是「这一层问不了」）。
 * 出口是防御式读法（`typeof registry.select === 'function'`），所以这里允许交出没有 select 的那一份，
 * 类型上照实断言一次（真调用方给的注册表都带 select）。
 */
function fakeRegistry(ids: string[], select?: (handle: unknown, ctx: unknown) => Promise<unknown>): DecideRegistry {
  const has = (id: string): boolean => ids.indexOf(String(id)) >= 0
  return (select ? { has, select } : { has }) as unknown as DecideRegistry
}

/**
 * 读装配处那一段源码：文件今天是 .js，将来转成 .ts 也照样读得到。
 */
function readAssembly(): string {
  for (const rel of ['src/host/platformChannel.js', 'src/host/platformChannel.ts']) {
    try { return readFileSync(join(repoRoot, rel), 'utf8') } catch (e) { /* 换下一个后缀试 */ }
  }
  return ''
}

/**
 * 从装配源码里读出三个后端**注册调用的先后**：每个 `reg.register(` 之前最近提到的那个房间名，
 * 就是这一次注册的是谁。看注册调用而不是 import 文本，是因为两者可以各自改动。
 */
function registerOrderOf(src: string): string[] {
  const order: string[] = []
  let at = src.indexOf('reg.register(')
  while (at >= 0) {
    const head = src.slice(0, at)
    const re = /rooms\/([a-z]+)\/index/g
    let last = ''
    let hit = re.exec(head)
    while (hit) { last = hit[1]; hit = re.exec(head) }
    if (last) order.push(last)
    at = src.indexOf('reg.register(', at + 1)
  }
  return order
}

const CWD = '/tmp/ws-1048'
const DECL = 'docs/agents/issue-tracker.md'
const WS_FILE = 'docs/agents/workspace.yaml'
const wsFile = (backendId: string, source = 'user'): string => JSON.stringify({ version: 2, backendId, pickedAt: 1, source })

async function main(): Promise<void> {
  title('A 三层顺序与来源（结论逐例与 #1003 期一致）')
  {
    const f1 = fakeFs({ [WS_FILE]: wsFile('markdown') })
    const r1 = await decideBackend(CWD, { fs: f1.fs, registry: fakeRegistry(['markdown', 'github']), skipAutodetect: true })
    ok(r1.backendId === 'markdown' && r1.origin === 'user-file' && r1.canWrite === true && r1.state === 'decided',
      '工作区文件命中：人选优先、有写权限、三态 decided', JSON.stringify({ id: r1.backendId, origin: r1.origin, state: r1.state }))

    const f2 = fakeFs({ [DECL]: '# Issue tracker: GitHub\n' })
    const r2 = await decideBackend(CWD, { fs: f2.fs, registry: fakeRegistry(['markdown', 'github']), skipAutodetect: true })
    ok(r2.backendId === 'github' && r2.origin === 'declaration' && r2.canWrite === false && r2.reason === 'needs-generate',
      '只有声明文件：按声明走、无写权限、reason 仍是 needs-generate', JSON.stringify({ id: r2.backendId, origin: r2.origin, reason: r2.reason }))

    const f3 = fakeFs({})
    const r3 = await decideBackend(CWD, {
      fs: f3.fs,
      registry: fakeRegistry(['github'], async () => ({ backendId: 'github', source: 'matches', ref: { refId: 'R1' } })),
    })
    ok(r3.backendId === 'github' && r3.origin === 'autodetect' && r3.source === 'matches',
      '两个文件都没有：落在各房认领上（source 仍是 matches）', JSON.stringify({ id: r3.backendId, origin: r3.origin, source: r3.source }))

    const r4 = await decideBackend('', { fs: f3.fs, registry: fakeRegistry(['github']) })
    ok(r4.backendId === null && r4.source === 'unknown' && r4.origin === 'unknown-workspace' && r4.reason === 'workspace-not-ready',
      '空根：如实说工作区还没就绪（不读文件、不起命令）', JSON.stringify({ source: r4.source, reason: r4.reason }))

    const p1 = decidePure({ fileParsed: { backendId: 'markdown', source: 'user' }, declarationId: 'github', registry: { has: (id: string) => id === 'github' || id === 'markdown' } })
    ok(p1.backendId === 'markdown', '纯核：文件胜声明（未注册的文件名不算数）')
    const p2 = decidePure({ fileParsed: { backendId: 'x', source: 'user' }, declarationId: 'github', registry: { has: (id: string) => id === 'github' } })
    ok(p2.backendId === 'github', '纯核：文件里的后端没装时退到声明文件')
  }

  title('B 内部三态说实话：没问过各房，不许说「确实没有后端」（回归）')
  {
    // 两个文件都明确没有，且各房真问过了、谁都没认领 —— 这才是「确实没有」。
    const fA = fakeFs({})
    const a = await decideBackend(CWD, { fs: fA.fs, registry: fakeRegistry(['github'], async () => ({ backendId: null, source: 'fallback' })) })
    ok(a.state === 'no-backend' && a.backendId === null && a.reason === 'no-backend',
      '两个文件都没有 + 各房问过没人认领 → no-backend（确实没有）', JSON.stringify({ state: a.state, reason: a.reason }))
    ok(a.gap !== null && a.gap.id === 'no-claim' && a.gap.fix.indexOf('面板上选定') >= 0,
      '这一档说清「补什么就能确定」', a.gap ? a.gap.id + ' / ' + a.gap.fix : '(没有档位)')

    // 同一个场景，但这一次没问各房（调用方自己关了这一层）—— 只能说没定下来。
    const b = await decideBackend(CWD, { fs: fA.fs, registry: fakeRegistry(['github']), skipAutodetect: true })
    ok(b.state === 'undetermined' && b.backendId === null && b.reason === 'no-backend',
      '没问过各房 → undetermined（对外 reason 照旧不变）', JSON.stringify({ state: b.state, reason: b.reason }))
    ok(b.gap !== null && b.gap.id === 'autodetect-unavailable' && b.missing.indexOf('这次没问') >= 0,
      '这一档如实说「这一层没问成」，不说成没人认领', b.gap ? b.gap.id + ' / ' + b.gap.text : '(没有档位)')
    ok(a.reason === b.reason && a.source === b.source && a.origin === b.origin,
      '两种情况对外可见的那几格完全一样（三态只在内部说实话）', JSON.stringify({ sourceA: a.source, originA: a.origin }))

    // 文件在、但读不出内容：不能当成「没有这条记录」。
    const fC = fakeFs({ [WS_FILE]: 'not a workspace file at all' })
    const c = await decideBackend(CWD, { fs: fC.fs, registry: fakeRegistry(['github'], async () => null) })
    ok(c.state === 'undetermined' && c.gap !== null && c.gap.id === 'file-unreadable',
      '工作区文件读不出 → undetermined + file-unreadable', c.gap ? c.gap.id : '(没有档位)')

    // 文件里写的后端没装上：说清是哪个名字没装。
    const fD = fakeFs({ [WS_FILE]: wsFile('gitlab') })
    const d = await decideBackend(CWD, { fs: fD.fs, registry: fakeRegistry(['github'], async () => null) })
    ok(d.state === 'undetermined' && d.gap !== null && d.gap.id === 'file-unknown-backend' && d.gap.detail === 'gitlab',
      '文件里写的后端没装 → 档位点名是哪个后端', d.gap ? d.gap.id + ' / ' + d.gap.detail : '(没有档位)')
    ok(d.gap !== null && d.gap.text.indexOf('gitlab') >= 0, '给人看的那句话里带上了这个名字', d.gap ? d.gap.text : '')

    // 认领超时未决 / 认领抛错：各有各的档位。
    const fE = fakeFs({})
    const e = await decideBackend(CWD, { fs: fE.fs, registry: fakeRegistry(['github'], async () => ({ backendId: null, source: 'fallback', pending: true })) })
    ok(e.state === 'undetermined' && e.reason === 'pending' && e.gap !== null && e.gap.id === 'autodetect-pending',
      '有房间认领超时 → undetermined + autodetect-pending', e.gap ? e.gap.id : '(没有档位)')
    const fF = await decideBackend(CWD, { fs: fE.fs, registry: fakeRegistry(['github'], async () => { throw new Error('boom-1048') }) })
    ok(fF.state === 'undetermined' && fF.gap !== null && fF.gap.id === 'autodetect-error',
      '认领这一步抛错 → undetermined + autodetect-error', fF.gap ? fF.gap.id : '(没有档位)')

    // 读文件时抛的是别的错（不是「没有这份文件」）：同样不能说成「没有这条记录」。
    const fsBoom = {
      async resolve(rel: string, opts?: { cwd?: string }): Promise<unknown> { return { rel: String(rel), cwd: String((opts && opts.cwd) || '') } },
      async readText(): Promise<string> { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) },
    } as unknown as FsLike
    const g1 = await decideBackend(CWD, { fs: fsBoom, registry: fakeRegistry(['github'], async () => null) })
    ok(g1.state === 'undetermined' && g1.gap !== null && g1.gap.id === 'file-read-failed',
      '工作区文件读的时候报错（不是不存在）→ undetermined + file-read-failed', g1.gap ? g1.gap.id : '(没有档位)')

    // 各房报了一个本机没装的后端名：说清是哪个名字不认识，不冒充「没人认领」。
    const g2 = await decideBackend(CWD, { fs: fakeFs({}).fs, registry: fakeRegistry(['github'], async () => ({ backendId: 'gitlab', source: 'matches' })) })
    ok(g2.state === 'undetermined' && g2.gap !== null && g2.gap.id === 'claim-unknown-backend' && g2.gap.detail === 'gitlab',
      '认领到的后端本机没装 → undetermined + claim-unknown-backend（点名是哪个）', g2.gap ? g2.gap.id + ' / ' + g2.gap.detail : '(没有档位)')

    // 日志里的三态与档位必须就是结果里的那一份。这是本票复核修掉的一处缺陷：
    // 从前结论线按「最后赢的那条」现推一遍，于是四类「判不出来」的场景日志写 no-backend、结果写 undetermined。
    const cases = [
      { name: '文件读不成（EACCES）', want: 'file-read-failed', run: async () => { const log1 = fakeLog(false); const r1 = await decideBackend(CWD, { fs: fsBoom, registry: fakeRegistry(['github'], async () => null), logCtx: log1.ctx }); return { log1: log1, r1: r1 } } },
      { name: '这一层没问（skipAutodetect）', want: 'autodetect-unavailable', run: async () => { const log1 = fakeLog(false); const r1 = await decideBackend(CWD, { fs: fakeFs({}).fs, registry: fakeRegistry(['github']), skipAutodetect: true, logCtx: log1.ctx }); return { log1: log1, r1: r1 } } },
      { name: '认领抛错', want: 'autodetect-error', run: async () => { const log1 = fakeLog(false); const r1 = await decideBackend(CWD, { fs: fakeFs({}).fs, registry: fakeRegistry(['github'], async () => { throw new Error('boom-log') }), logCtx: log1.ctx }); return { log1: log1, r1: r1 } } },
      { name: '认领到没装的后端', want: 'claim-unknown-backend', run: async () => { const log1 = fakeLog(false); const r1 = await decideBackend(CWD, { fs: fakeFs({}).fs, registry: fakeRegistry(['github'], async () => ({ backendId: 'gitlab', source: 'matches' })), logCtx: log1.ctx }); return { log1: log1, r1: r1 } } },
    ]
    for (const one of cases) {
      const { log1, r1 } = await one.run()
      const line = log1.rows.filter((x) => x.event === 'detection.detect').pop()
      ok(!!line && line.fields.state === r1.state && line.fields.gap === (r1.gap ? r1.gap.id : '') && line.fields.coverage === formatCoverage(r1.coverage),
        '日志与结果说的是同一件事：' + one.name + '（' + one.want + '）',
        line ? JSON.stringify({ 日志三态: line.fields.state, 结果三态: r1.state, 日志档位: line.fields.gap, 结果档位: r1.gap ? r1.gap.id : '' }) : '(没有结论线)')
      ok(r1.state === 'undetermined' && !!r1.gap && r1.gap.id === one.want,
        '这一类该判成「没定下来」并给出对应档位：' + one.name + ' → ' + one.want, r1.gap ? r1.gap.id : '(没有档位)')
    }

    ok(decisionGapOf('nope-not-a-gap') === null, '不认识的档位名回 null（宁可少说，不编一档出来）')
    const g = decisionGapOf('file-unknown-backend', 'gitlab')
    ok(g !== null && g.looked.length >= 1 && g.missing.indexOf('gitlab') >= 0 && g.fix.length > 0,
      '每一档都写清「看了哪些地方、缺什么、补什么」', g ? g.missing : '')
  }

  title('C 一次读取、一份结论（声明文件只读一次，与探测器同一套解析器）')
  {
    const f = fakeFs({ [DECL]: '# Issue tracker: GitHub\n' })
    const reads0 = f.reads.length
    const r = await decideBackend(CWD, { fs: f.fs, registry: fakeRegistry(['github']), skipAutodetect: true })
    const declReads = f.reads.filter((x) => x === DECL).length
    ok(declReads === 1, '一次判定只读声明文件一次（实得 ' + declReads + ' 次）', f.reads.slice(reads0).join(','))
    ok(r.backendId === 'github' && r.origin === 'declaration', '读到的这一份直接就是结论', String(r.backendId))

    // 声明文件里写了好几行标题：结论必须与 parseIssueTracker 一模一样（出口不再自带第二套优先级）。
    const multi = '# Issue tracker: GitLab\n# Issue tracker: GitHub\n# Issue tracker: Markdown\n'
    const f2 = fakeFs({ [DECL]: multi })
    const r2 = await decideBackend(CWD, { fs: f2.fs, registry: fakeRegistry(['github', 'gitlab', 'markdown']), skipAutodetect: true })
    const parsed = parseIssueTracker(multi)
    ok(r2.backendId === parsed.explicitBackendId && r2.backendId === 'gitlab',
      '多行标题时与 parseIssueTracker 同一答案（GitLab > Markdown > GitHub，出口那套 Markdown 优先的已删）',
      JSON.stringify({ outlet: r2.backendId, parser: parsed.explicitBackendId }))

    // 出口从前自带一套「只看标题行」的解析器；那套已删。声明文件里只有正文关键词、没有标题行时，
    // 今天与探测器同一答案 —— 这是本票的有意修正：一句话说清用哪个后端的地方，不该被出口漏看。
    const bodyOnly = '本仓库的票记在 GitHub 上，用 gh 命令读写。\n'
    const f3 = fakeFs({ [DECL]: bodyOnly })
    const r3 = await decideBackend(CWD, { fs: f3.fs, registry: fakeRegistry(['github']), skipAutodetect: true })
    const parsed3 = parseIssueTracker(bodyOnly)
    ok(r3.backendId === parsed3.explicitBackendId && r3.backendId === 'github' && r3.origin === 'declaration',
      '正文关键词（没有标题行）也认，与探测器同一答案（旧的只看标题那套已删）',
      JSON.stringify({ outlet: r3.backendId, parser: parsed3.explicitBackendId, origin: r3.origin }))
  }

  title('D 多命中按明文顺序裁剪（GitHub > Markdown > GitLab）')
  {
    ok(JSON.stringify(MULTI_CLAIM_ORDER) === JSON.stringify(['github', 'markdown', 'gitlab']),
      '明文顺序常量就是 GitHub > Markdown > GitLab', JSON.stringify(MULTI_CLAIM_ORDER))
    ok(JSON.stringify(orderClaims(['gitlab', 'markdown', 'github'])) === JSON.stringify(['github', 'markdown', 'gitlab']),
      '倒着给的名单按明文顺序排好')
    ok(JSON.stringify(orderClaims(['gitlab', 'scratch', 'github'])) === JSON.stringify(['github', 'gitlab', 'scratch']),
      '名单里没有的房间排在三个之后、保持自己的相对次序')

    const f = fakeFs({})
    const r = await decideBackend(CWD, {
      fs: f.fs,
      registry: fakeRegistry(['github', 'gitlab', 'markdown'], async () => ({ backendId: 'gitlab', source: 'matches', multiHit: ['gitlab', 'markdown', 'github'] })),
    })
    ok(r.backendId === 'github', '三家同时认领时取 GitHub', String(r.backendId))
    ok(JSON.stringify(r.multiHit) === JSON.stringify(['github', 'markdown', 'gitlab']),
      '对外带出的 multiHit 也按明文顺序（调用方看得懂谁被裁掉了）', JSON.stringify(r.multiHit))
    ok(r.steps.some((s) => s.step === 'claim-order' && s.outcome === 'hit'),
      '裁剪这一步记进了轨迹（事后读得出是「按明文顺序裁的」）', JSON.stringify(r.steps.map((s) => s.step + ':' + s.outcome)))

    // 装配顺序与明文顺序必须一致，而且要看**真的注册调用**（reg.register(谁)），
    // 不是看 import 文本出现的位置——两件事今天碰巧同序，改起来却可以不一致（#1048 复核指出上一版只看了位置）。
    const assembly = readAssembly()
    const order = registerOrderOf(assembly)
    ok(JSON.stringify(order) === JSON.stringify(['github', 'markdown', 'gitlab']),
      '装配处三个后端是按 github → markdown → gitlab 注册的（读真的注册调用）', JSON.stringify(order))
    ok(JSON.stringify(order) === JSON.stringify(MULTI_CLAIM_ORDER),
      '装配顺序与明文裁剪顺序逐位一致：改一处就得同时改另一处',
      JSON.stringify({ 装配: order, 明文: MULTI_CLAIM_ORDER }))
  }

  title('E 证据矛盾带出来（人选与项目里写的不一致）')
  {
    const f = fakeFs({ [WS_FILE]: wsFile('markdown'), [DECL]: '# Issue tracker: GitHub\n' })
    const log = fakeLog(true)
    const r = await decideBackend(CWD, { fs: f.fs, registry: fakeRegistry(['markdown', 'github']), skipAutodetect: true, logCtx: log.ctx })
    ok(r.backendId === 'markdown' && r.origin === 'user-file', '结论仍按顺序取人选（矛盾只记录、不翻案）', String(r.backendId))
    ok(r.conflict !== null && r.conflict.kind === 'user-vs-declaration' && JSON.stringify(r.conflict.ids) === JSON.stringify(['markdown', 'github']) && r.conflict.used === 'markdown',
      '矛盾写进结果：哪两层在打架、各报的是谁、最后用了谁', r.conflict ? JSON.stringify(r.conflict) : '(没有矛盾)')
    const line = log.rows.filter((x) => x.event === 'detection.detect').pop()
    ok(!!line && line.fields.conflict === 'user-vs-declaration', '矛盾也进结论线（不开调试开关也看得见）', line ? String(line.fields.conflict) : '(没有结论线)')

    const fSame = fakeFs({ [WS_FILE]: wsFile('markdown'), [DECL]: '# Issue tracker: Markdown\n' })
    const r2 = await decideBackend(CWD, { fs: fSame.fs, registry: fakeRegistry(['markdown']), skipAutodetect: true })
    ok(r2.conflict === null, '两层说的是同一个后端时不算矛盾', JSON.stringify(r2.conflict))
  }

  title('F 日志分层：平时一条结论，开关打开才逐层记步骤')
  {
    const f = fakeFs({})
    const on = fakeLog(true)
    const r = await decideBackend(CWD, {
      fs: f.fs,
      registry: fakeRegistry(['github'], async () => ({ backendId: 'github', source: 'matches' })),
      logCtx: on.ctx,
    })
    const conclusions = on.rows.filter((x) => x.event === 'detection.detect')
    ok(conclusions.length === 1, '一次判定只发一条结论线（实得 ' + conclusions.length + ' 条）')
    const c = conclusions[0]
    ok(!!c && c.level === 'info' && typeof c.fields.latencyMs === 'number' && c.fields.state === 'decided' && c.fields.origin === 'autodetect',
      '结论线含来源、三态与耗时', c ? JSON.stringify(c.fields) : '')
    ok(!!c && String(c.fields.cwdHash).length === 8 && String(JSON.stringify(c.fields)).indexOf(CWD) < 0,
      '结论线只记工作区散列，不记路径原文', c ? String(c.fields.cwdHash) : '')

    const steps = on.rows.filter((x) => x.event === 'detection.step')
    ok(steps.length === r.steps.length && steps.length >= 3,
      '调试开关打开时每一步各一行（决策 + 声明 + 认领）', 'N=' + steps.length)
    ok(JSON.stringify(steps.map((x) => x.fields.step)) === JSON.stringify(['workspace-file', 'declaration', 'autodetect']),
      '步骤线按层序排列，读得出「先看了什么、后看了什么」', JSON.stringify(steps.map((x) => x.fields.step)))
    ok(steps.every((x) => x.level === 'debug' && typeof x.fields.ms === 'number' && String(x.fields.reason) !== ''),
      '每一步都带结论、耗时与「为什么」', JSON.stringify(steps.map((x) => x.fields.outcome + '/' + x.fields.reason)))

    // 平时（开关关着）走到结论就停：更确凿的证据在先时，各房那一层不问，并记下为什么跳过。
    const f2 = fakeFs({ [WS_FILE]: wsFile('markdown') })
    let asked = 0
    const reg2 = fakeRegistry(['markdown', 'github'], async () => { asked++; return { backendId: 'github', source: 'matches' } })
    const quiet = fakeLog(false)
    const rQuiet = await decideBackend(CWD, { fs: f2.fs, registry: reg2, logCtx: quiet.ctx })
    ok(asked === 0, '平时不问各房（省一次外部命令）：注册表 select 没被调用（实得 ' + asked + ' 次）')
    // 省的只是「要起外部命令」的那一层；两个本地文件照读——不读就发现不了「我选的 vs 项目里写的」这条矛盾。
    ok(JSON.stringify(rQuiet.steps.map((s) => s.step + ':' + s.outcome)) === JSON.stringify(['workspace-file:hit', 'declaration:miss', 'autodetect:skipped']),
      '轨迹如实记下「哪一层有意没看」', JSON.stringify(rQuiet.steps.map((s) => s.step + ':' + s.outcome)))
    ok(rQuiet.steps.every((s) => s.reason !== ''), '每一步都写了「为什么」', JSON.stringify(rQuiet.steps.map((s) => s.reason)))
    ok(rQuiet.coverage.scope === 'decisive' && JSON.stringify(rQuiet.coverage.checked) === JSON.stringify(['workspace-file', 'declaration'])
      && rQuiet.coverage.skipped.length === 1 && rQuiet.coverage.skipped[0].tier === 'autodetect',
      '覆盖度说清「看了哪两层、哪一层有意没看、为什么」', JSON.stringify(rQuiet.coverage))

    // 开关打开是排查模式：证据范围同时放宽成「三层全问」，把矛盾与覆盖度看全。
    const loud = fakeLog(true)
    let askedLoud = 0
    const reg3 = fakeRegistry(['markdown', 'github'], async () => { askedLoud++; return { backendId: 'github', source: 'matches' } })
    const rLoud = await decideBackend(CWD, { fs: f2.fs, registry: reg3, logCtx: loud.ctx })
    ok(askedLoud === 1, '排查模式三层全问：各房认领这一步真问了（实得 ' + askedLoud + ' 次）')
    ok(rLoud.coverage.scope === 'exhaustive' && rLoud.coverage.skipped.length === 0 && rLoud.coverage.checked.length === 3,
      '覆盖度如实写「三层都看了」', JSON.stringify(rLoud.coverage))
    ok(rLoud.conflict !== null && rLoud.conflict.kind === 'user-vs-autodetect' && rLoud.conflict.used === 'markdown',
      '排查模式才看得见「我选的 vs 各房认到的」这条矛盾', rLoud.conflict ? JSON.stringify(rLoud.conflict) : '(没有矛盾)')
    // 守门人：放宽范围只多出诊断信息，对外那几格与平时逐格相同。
    ok(rQuiet.backendId === rLoud.backendId && rQuiet.source === rLoud.source && rQuiet.origin === rLoud.origin
      && rQuiet.canWrite === rLoud.canWrite && rQuiet.reason === rLoud.reason && rQuiet.state === rLoud.state
      && JSON.stringify(rQuiet.gap) === JSON.stringify(rLoud.gap),
      '放宽证据范围不改结论：对外五字段 + 写权限 + 原因 + 三态 + 档位逐格相同',
      JSON.stringify({ 平时: [rQuiet.backendId, rQuiet.source, rQuiet.origin, rQuiet.reason], 排查: [rLoud.backendId, rLoud.source, rLoud.origin, rLoud.reason] }))
    const stepsLoud = loud.rows.filter((x) => x.event === 'detection.step')
    ok(JSON.stringify(stepsLoud.map((x) => x.fields.step)) === JSON.stringify(['workspace-file', 'declaration', 'autodetect'])
      && stepsLoud.filter((x) => x.fields.step === 'autodetect')[0].fields.outcome === 'hit',
      '排查模式下各房那一步记的是真去问了、问到了什么',
      JSON.stringify(stepsLoud.map((x) => x.fields.step + ':' + x.fields.outcome)))

    // 开关关着：只有结论线，一条步骤线都没有。
    const off = fakeLog(false)
    await decideBackend(CWD, { fs: fakeFs({}).fs, registry: fakeRegistry(['github'], async () => null), logCtx: off.ctx })
    ok(off.rows.filter((x) => x.event === 'detection.step').length === 0, '开关关着时一条步骤线都不发')
    ok(off.rows.filter((x) => x.event === 'detection.detect').length === 1, '开关关着时结论线照发（常驻）')

    // 连日志出口都没有（首帧那条路今天还没接）：判定照做，不抛。
    const r3 = await decideBackend(CWD, { fs: fakeFs({}).fs, registry: fakeRegistry(['github'], async () => null) })
    ok(r3.state === 'no-backend' && r3.steps.length === 3, '没有日志出口时判定照做，轨迹仍在结果里', JSON.stringify(r3.steps.map((s) => s.step)))
  }

  title('G 对外五个字段一个不动')
  {
    const hit = selectionFromOutlet({ backendId: 'github', source: 'explicit', ref: { refId: 'R' } })
    ok(!!hit && JSON.stringify(Object.keys(hit).sort()) === JSON.stringify(['backendId', 'ref', 'source']),
      '命中时只有 backendId/source/ref（multiHit 与 pending 缺席就不出现）', JSON.stringify(Object.keys(hit || {})))
    const multi = selectionFromOutlet({ backendId: 'github', source: 'matches', multiHit: ['github', 'markdown'], pending: true })
    ok(!!multi && JSON.stringify(Object.keys(multi).sort()) === JSON.stringify(['backendId', 'multiHit', 'pending', 'ref', 'source']),
      '多命中与待定照旧原样带出', JSON.stringify(Object.keys(multi || {})))
    const none = selectionFromOutlet(null)
    ok(none === null, '出口没答案时回 null（调用方走老路或诚实失败）')
    const pend = selectionFromOutlet({ backendId: null, source: 'fallback', pending: true })
    ok(!!pend && pend.backendId === null && pend.pending === true && pend.source === 'fallback', '待定那一格形状照旧')
  }

  title('H 纯核自己就能跑：政策是数据，判断函数不碰 IO（架构面）')
  {
    // 这一节直接对证据行下判断，不经过文件、注册表与外部命令：
    // 说明「收证据」与「下判断」是两件独立的事，判断那半可以单独测。
    const picked = pickVerdict([
      abstainEvidence('workspace-file', 'file-missing'),
      verdictEvidence('declaration', 'github', 'declaration-hit'),
      verdictEvidence('autodetect', 'gitlab', 'matches-hit'),
    ])
    ok(!!picked && picked.backendId === 'github',
      '文件层没结论时取声明文件，哪怕各房也认到了别的（顺序即政策）', picked ? String(picked.backendId) : '(没有结论)')

    const ev = [
      verdictEvidence('workspace-file', 'markdown', 'file-hit', { fileSource: 'user' }),
      verdictEvidence('declaration', 'github', 'declaration-hit'),
      skippedEvidence('autodetect', 'skipped-stronger-evidence'),
    ]
    const sQuiet = synthesize({ evidence: ev, scope: 'decisive' })
    const sLoud = synthesize({ evidence: ev.map((e) => (e.tier === 'autodetect' ? verdictEvidence('autodetect', 'github', 'matches-hit') : e)), scope: 'exhaustive' })
    ok(sQuiet.state === 'decided' && sLoud.state === 'decided' && sQuiet.selection.backendId === sLoud.selection.backendId && sQuiet.canWrite === sLoud.canWrite,
      '同一份前两层证据，范围收窄或放宽都得同一个结论')
    ok(sQuiet.conflict !== null && sQuiet.conflict.kind === 'user-vs-declaration' && sLoud.conflict !== null && sLoud.conflict.kind === 'user-vs-declaration-vs-autodetect',
      '矛盾按实际参与的层命名（放宽范围后多一层就多一个名字）',
      JSON.stringify({ 平时: sQuiet.conflict ? sQuiet.conflict.kind : '', 排查: sLoud.conflict ? sLoud.conflict.kind : '' }))
    ok(formatCoverage(sQuiet.coverage) === 'checked=workspace-file,declaration;skipped=autodetect:skipped-stronger-evidence',
      '覆盖度文本把「哪层有意没看、为什么」写全（日志里就一个字段，方便 grep）', formatCoverage(sQuiet.coverage))
    ok(formatCoverage(sLoud.coverage) === 'checked=workspace-file,declaration,autodetect',
      '三层都看了时只有前半段', formatCoverage(sLoud.coverage))

    const sNothing = synthesize({
      evidence: [abstainEvidence('workspace-file', 'file-missing'), abstainEvidence('declaration', 'declaration-missing'), abstainEvidence('autodetect', 'matches-no-claim')],
      scope: 'decisive',
    })
    ok(sNothing.state === 'no-backend' && sNothing.gap !== null && sNothing.gap.id === 'no-claim',
      '三处都干净地说没有 → no-backend（问过了，确实没有）', sNothing.gap ? sNothing.gap.id : '(没有档位)')
    const sNotAsked = synthesize({
      evidence: [abstainEvidence('workspace-file', 'file-missing'), abstainEvidence('declaration', 'declaration-missing'), skippedEvidence('autodetect', 'skipped-stronger-evidence')],
      scope: 'decisive',
    })
    ok(sNotAsked.state === 'undetermined' && sNotAsked.gap !== null && sNotAsked.gap.id === 'autodetect-unavailable',
      '同样两处干净地说没有、但各房没问过 → undetermined（这条就是本票修的那个缺陷的纯核断言）',
      sNotAsked.gap ? sNotAsked.gap.id : '(没有档位)')

    const norm = normalizeClaim({ backendId: 'gitlab', source: 'matches', multiHit: ['gitlab', 'scratch', 'github'] })
    // 认领多家时，谁赢也按明文顺序重裁：注册顺序与明文顺序今天一致（D 节钉着这一点），
    // 但政策以明文那份为准 —— 装配顺序改了而没改明文顺序时，结论不会跟着悄悄变。
    ok(norm.backendId === 'github' && JSON.stringify(norm.multiHit) === JSON.stringify(['github', 'gitlab', 'scratch']) && norm.reordered === true,
      '多命中一律按明文顺序排好，谁赢也在明文顺序里裁，排过就如实说排过', JSON.stringify(norm))
    ok(resolveEvidenceScope({}) === 'decisive', '没有日志出口时按平时模式走（不多问）')
    ok(resolveEvidenceScope({ logCtx: { fire: () => true, isEnabled: (l: string) => l === 'debug' } }) === 'exhaustive',
      '调试开关开着时按排查模式走（三层全问）')
    ok(resolveEvidenceScope({ logCtx: { fire: () => true, isEnabled: () => { throw new Error('boom-scope') } } }) === 'decisive',
      '连「开关开没开」都问不出来时退回平时模式，不抛')
  }

  title('H 证据范围是判定的入参，不是日志的私产（#1048 收口补做）')
  {
    // 纯函数那一层：调用方点名要哪一档就听它的；没点名才去看调试开关。
    ok(resolveEvidenceScope({ scope: 'exhaustive' }) === 'exhaustive',
      '没有日志出口、调用方点名要诊断 → 照样三层全问（这个能力不挂在日志开关上）')
    ok(resolveEvidenceScope({ logCtx: { fire: () => true, isEnabled: () => true }, scope: 'decisive' }) === 'decisive',
      '开关开着、调用方点名只要结论 → 就只要结论（点名的入参压过默认入口）')

    // 行为那一层：范围只改「问哪几层」，裁决与对外那几样一格不差。
    const wsOnly: Record<string, string | null> = { [WS_FILE]: wsFile('markdown') }
    let asks = 0
    const regOf = (): DecideRegistry => fakeRegistry(['markdown', 'github'], async () => { asks++; return { backendId: 'github', source: 'matches' } })

    const fD = fakeFs(wsOnly); const loud = fakeLog(true)
    const sDecisive = await decideBackend(CWD, { fs: fD.fs, registry: regOf(), logCtx: loud.ctx, scope: 'decisive' })
    ok(asks === 0, '点名只要结论：前两层已经给出人选，就不问各房（一次 matches 都不起）', '起过 ' + asks + ' 次')
    const fE = fakeFs(wsOnly); const quiet = fakeLog(false)
    const sExhaustive = await decideBackend(CWD, { fs: fE.fs, registry: regOf(), logCtx: quiet.ctx, scope: 'exhaustive' })
    ok(asks === 1, '点名要诊断：前两层已经有结论，也照样问各房（跨层矛盾只有问过才看得见）', '起过 ' + asks + ' 次')
    ok(sDecisive.backendId === sExhaustive.backendId && sDecisive.source === sExhaustive.source && sDecisive.canWrite === sExhaustive.canWrite
      && sDecisive.reason === sExhaustive.reason && sDecisive.state === sExhaustive.state,
      '同一份输入、两档范围：对外那几样与状态、原因逐格不差（放宽范围只多诊断信息）',
      JSON.stringify({ 平时: [sDecisive.backendId, sDecisive.source, sDecisive.canWrite, sDecisive.reason, sDecisive.state], 排查: [sExhaustive.backendId, sExhaustive.source, sExhaustive.canWrite, sExhaustive.reason, sExhaustive.state] }))
    ok(sExhaustive.coverage.scope === 'exhaustive' && sExhaustive.coverage.checked.indexOf('autodetect') >= 0,
      '覆盖度如实写「这次真看了三层」', JSON.stringify(sExhaustive.coverage))
    ok(sDecisive.coverage.scope === 'decisive' && sDecisive.coverage.skipped.length === 1 && sDecisive.coverage.skipped[0].tier === 'autodetect',
      '覆盖度也如实写「这次有意没看哪一层、为什么」', JSON.stringify(sDecisive.coverage))
  }

  console.log('\n共 ' + (passed + failed) + ' 项，' + (failed ? ('破 ' + failed + ' 项') : '全部通过'))
  process.exitCode = failed ? 1 : 0
}

main().catch((e: unknown) => {
  console.error('SCRIPT-ERROR', (e && (e as Error).stack) || e)
  process.exitCode = 2
})
