/**
 * tests/tracker-contract/sections/counts.ts — 计数契约段（#689）。
 *
 * 第一性原理：这一条操作（counts）是「面板上那个数字从哪来」在契约层的接缝。原来数字由客户端数手上
 * 那份票池得到，而票池被后端悄悄截断过（GitHub 500 条上限、GitLab 只取一页），数字于是跟着偏
 * （缺陷票 #677）。这一段只断言它答应的事有没有做到：
 *   只回数字不回行；三个数都是非负整数、且 open + closed = total；
 *   拿不全（返回里带 errors、或数不对）一律整体失败，**绝不用别的数凑一个出来**；
 *   做不到的后端由注册表自动补桩，必须诚实地说做不到。
 * 不锁实现细节：断言里不出现「用了哪条命令、查询怎么拼」（换命令、换计数口，这一段都不该红）。
 *
 * 三个假身只活在测试里，各代表一种位置：
 *   unsupported-fake —— 没实现这条操作的后端：注册表按 OPERATIONS 自动补桩（走真注册表包一层）。
 *   counting-fake    —— 能计数的后端：数字是它自己给的（本地 Markdown 数文件、GitLab 用它的计数口都是这个位置）。
 *   guessing-fake    —— 数不全却照样回一个数的后端：这一段必须把它逮住（它正是 #677 要消灭的那种行为）。
 *
 * 另有三条不是对着假身自说自话，而是对着真实的东西断言：
 *   四之一 · 真实 GitLab 后端模块：给一个脚本化的 glab，要求它拿到（假的）issues_statistics 回话之后
 *          把三个数给对 —— 这一条 2026-10-14 起真实现（地图 10 / #1062），所以判据是正向的行为断言。
 *   四之二 · 真实本地 Markdown 后端模块（#691 第四件）：给它一个临时工作区，要求它把三个数给对。
 *   四之三 · 真实 GitHub 后端模块：给一个脚本化的 gh，要求它要么诚实地失败、要么把三个数给对；
 *          再单独验一件事 —— gh 回了个带 errors / 缺 totalCount 的响应时，它必须整体失败，不许猜。
 *
 * 2026-10-15 返工（对抗式审查报告 research/1063-adversarial-review.md 的发现 1）：GitLab 那一段原来只
 * 断言「失败得好看就算过」（ok:false、档位不是 unsupported、消息非空）—— 把真实现换成一律
 * fail(env, '还没做') 的空壳，它照样绿。现在改成 `countsAnswerCheck`：拿脚本化的远端回话核对三个数。
 * 每一条新判据都自带「空壳必须被逮住」的 ✗ probe，理由写在那个 ✗ probe 旁边。
 *
 * 每段自带反例（✗ probe）：检查器是纯函数，把故意写错的样本喂给它必须逮住；逮不住这一段就形同虚设。
 */

import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'
import * as nodeOs from 'node:os'
import { createRegistry } from '../../../src/tracker/registry/core.js'
import { ERROR_KIND } from '../../../src/tracker/contract/vocabulary.js'
import { gitlabBackend } from '../../../src/tracker/rooms/gitlab/index.js'
import { githubModule } from '../../../src/tracker/rooms/github/index.js'
import { markdownModule } from '../../../src/tracker/rooms/markdown/index.js'
import { unsupportedAnswerCheck } from './labels.js'
import { createOutboundControl } from '../../../src/refresh/rooms/host/outbound-control.js'
import type { BackendContext, OpContext } from '../../../src/tracker/contract/contexts.js'
import type { BackendModule } from '../../../src/tracker/contract/backend-module.js'
import type { RepositoryRef } from '../../../src/tracker/contract/entities.js'

/** 单条 counts 断言的结果：ok 为判定，detail 留现场。 */
export interface CountsAssertResult {
  name: string
  ok: boolean
  detail: string
}

/** 计数回答的宽形状：测试只关心 ok/data/error 三格，不展开房间内部类型。 */
export interface CountsResponse {
  ok?: unknown
  data?: unknown
  error?: unknown
}

/**
 * 房间一次计数的返回（测试消费视角）：data 按「三个数」宽形状收。
 * 失败分支运行时没有 data——本文件碰 data 的地方，形状检查器都在同一条 && 里先验过
 * （rDown 那处除外，那里有 && 守着，和原来一样短路过去）。
 */
export interface CountsResult {
  ok?: unknown
  data: CountsNumbers & Record<string, unknown>
  error?: unknown
}

/** 计数三个数的宽形状：✗ probe 会喂错形状，键值都按未知收。 */
export interface CountsNumbers {
  open?: unknown
  closed?: unknown
  total?: unknown
}

/** 能计数假身的种子：数字、整体失败、写坏的形状三选一。 */
export interface CountingFakeSeed {
  id?: string
  failure?: { kind: string; message: string }
  broken?: CountsNumbers
  counts?: { open: number; closed: number; total: number }
}

const KNOWN_KINDS: readonly unknown[] = Object.values(ERROR_KIND)

/**
 * 房间返回按契约宽形状消费：测试只看 ok/data/error，不碰房间内部类型。
 * 类型断言只在编译期生效，运行时还是房间原来回的那个对象。
 */
function loose(p: Promise<unknown>): Promise<CountsResult> {
  return p as unknown as Promise<CountsResult>
}

/**
 * 造一个临时工作区（系统临时目录里的 `.scratch/demo`），用完即删：给「真实 markdown 后端」的探针用。
 * 两个工作单元形态与 tests/verify-691-markdown-counts.js 同一套：2 张开着的票 + 3 张已关闭的票
 * （已关闭的判据是票里 `Status:` 行落进 resolved / completed / closed / done 四者之一，见 #688 的实测结论）。
 */
function makeMarkdownFixture(): { repo: RepositoryRef; ctx: OpContext; cleanup(): void } {
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'dsws-counts-'))
  const dir = nodePath.join(root, '.scratch', 'demo')
  nodeFs.mkdirSync(nodePath.join(dir, 'issues'), { recursive: true })
  nodeFs.writeFileSync(nodePath.join(dir, 'map.md'), '# Demo\n\nStatus: ready-for-agent\n', 'utf8')
  const rows = [['01-a.md', 'in-progress'], ['02-b.md', 'ready-for-agent'], ['03-c.md', 'resolved'], ['04-d.md', 'done'], ['05-e.md', 'completed']]
  for (const [file, status] of rows) nodeFs.writeFileSync(nodePath.join(dir, 'issues', file), '# ' + file + '\n\nStatus: ' + status + '\n', 'utf8')
  const plat = {
    path: nodePath.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return nodeFs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { nodeFs.mkdirSync(nodePath.dirname(t), { recursive: true }); nodeFs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return nodeFs.statSync(t) } catch (e) { return null } },
      async listDir(t: string) { try { return nodeFs.readdirSync(t) } catch (e) { return [] } },
      async stat(t: string) { try { return nodeFs.statSync(t) } catch (e) { return null } },
    },
  }
  return {
    repo: { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' },
    // 测试桩上下文只给房间会摸到的几格（platform/fs/cwd），类型上按完整 OpContext 断言一次，
    // 运行时还是这个对象——缺的定时器/信号/出站控制面本段用不到。
    ctx: { platform: plat, fs: plat.fs, cwd: root, get(name: string) { return name === 'fs' ? plat.fs : undefined } } as unknown as OpContext,
    cleanup() { try { nodeFs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 计数回答检查器：返回违规清单（空 = 合规）。三个数必须是非负整数，且 open + closed = total。 */
export function countsShapeCheck(res: CountsResponse): string[] {
  const bad: string[] = []
  if (!res || typeof res !== 'object') return ['计数要返回 {ok:true, data:{open,closed,total}} 或 {ok:false, error:{kind,message}}']
  if (res.ok !== true) return ['这一份是成功样本，ok 应为 true，实得 ' + JSON.stringify(res.ok)]
  const d = res.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['data 要是对象 {open,closed,total}']
  const dd = d as CountsNumbers
  const keys = Object.keys(dd).sort().join(',')
  if (keys !== 'closed,open,total') bad.push('data 只许有 open、closed、total 三个键，实得 ' + keys)
  for (const k of ['open', 'closed', 'total'] as const) {
    const v = dd[k]
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v) bad.push(k + ' 要是不小于 0 的整数，实得 ' + JSON.stringify(v))
  }
  if (typeof dd.open === 'number' && typeof dd.closed === 'number' && typeof dd.total === 'number' && dd.open + dd.closed !== dd.total) {
    bad.push('三个数要自洽：open + closed 应等于 total，实得 ' + dd.open + ' + ' + dd.closed + ' ≠ ' + dd.total)
  }
  return bad
}

/** 「数不全就该失败」检查器：整条操作必须失败，档位是契约里列的那几种，且消息里说得清为什么。 */
export function countsFailureCheck(res: CountsResponse): string[] {
  const bad: string[] = []
  if (!res || typeof res !== 'object') return ['数不全时要以 {ok:false, error:{kind,message}} 整体失败，实得 ' + JSON.stringify(res)]
  if (res.ok !== false) return ['数不全时必须整体失败（不许猜一个数出来），实得 ok=' + JSON.stringify(res.ok) + ' data=' + JSON.stringify(res.data)]
  const err = res.error
  if (!err || typeof err !== 'object') return ['失败要给 error 对象说清为什么', JSON.stringify(res)]
  const e = err as { kind?: unknown; message?: unknown }
  if (!KNOWN_KINDS.includes(e.kind)) bad.push('error.kind 必须是既有错误分类之一，实得 ' + JSON.stringify(e.kind))
  if (typeof e.message !== 'string' || !e.message.trim()) bad.push('error.message 要是能看懂的一句话')
  return bad
}

/** 真实后端探针的判据：要么诚实地说做不到（unsupported 桩），要么把三个数给对。 */
export function countsProbeCheck(res: CountsResponse): string[] {
  if (res && typeof res === 'object' && res.ok === false) return unsupportedAnswerCheck('counts', res)
  return countsShapeCheck(res)
}

/**
 * 对着**真实现**的计数探针判据（2026-10-15 返工新增）：必须真的把三个数给对，不是「失败得好看」。
 *
 * 为什么要有它：`countsProbeCheck` 把「ok:false 且形状齐全」也算合规 —— 那是给「这一条还是注册表补的桩」
 * 那个阶段写的。GitLab 这一条真实现之后，拿它来验真实现就等于没验：一律 `fail(env, '还没做')` 的空壳
 * 照样过（对抗式审查的发现 1）。凡是对着真实现的探针，都要要求它做到契约要求的那件事。
 */
export function countsAnswerCheck(res: CountsResponse, want?: { open?: number; closed?: number; total?: number }): string[] {
  const bad = countsShapeCheck(res)
  if (bad.length) return bad
  const w: { open?: number; closed?: number; total?: number } = want || {}
  // 形状已验过（三个数都是非负整数），这里只是把类型收窄成可下标的记录。
  const rd = res.data as Record<string, unknown>
  for (const k of ['open', 'closed', 'total'] as const) {
    if (typeof w[k] === 'number' && rd[k] !== w[k]) {
      bad.push('counts.' + k + ' 应为 ' + w[k] + '（脚本化的回话给的就是这个数），实得 ' + JSON.stringify(rd[k]))
    }
  }
  return bad
}

// ── 三个假身（只活在测试里）──────────────────────────────────────────────────

/**
 * 做不到的假身：create() 只给 list，计数这条由注册表按 OPERATIONS 自动补桩。
 * 返回按完整后端模块断言一次（只影响编译期，运行时还是这个只给四格的假身）。
 */
export function createUnsupportedFake(id?: string): BackendModule {
  return {
    id: id || 'counts-unsupported-fake',
    label: '做不到的假身',
    create: () => ({ list: async () => ({ ok: true, data: [] }) }),
    matches: async () => false,
  } as unknown as BackendModule
}

/**
 * 能计数的假身：数字由 seed 给；failure 可让某一次整体失败（演配额耗尽 / 连不通）。
 * 返回按完整后端模块断言一次（只影响编译期，运行时还是这个假身）。
 */
export function createCountingFake(seed?: CountingFakeSeed): BackendModule {
  const calls = { n: 0 }
  return {
    id: (seed && seed.id) || 'counts-fake',
    label: '能计数的假身',
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      counts: async (_repo: unknown, filter?: { state?: unknown }) => {
        calls.n++
        if (seed && seed.failure) return { ok: false, error: seed.failure }
        if (seed && seed.broken) return { ok: true, data: seed.broken }
        const d = (seed && seed.counts) || { open: 3, closed: 7, total: 10 }
        const state = filter && filter.state
        if (state === 'open') return { ok: true, data: { open: d.open, closed: 0, total: d.open } }
        if (state === 'closed') return { ok: true, data: { open: 0, closed: d.closed, total: d.closed } }
        return { ok: true, data: { open: d.open, closed: d.closed, total: d.total } }
      },
    }),
    matches: async () => false,
    _calls: calls,
  } as unknown as BackendModule
}

/**
 * 数不全却照样回一个数的假身：只数了第一页，把那一页的条数当成全量交出去。
 * 返回按完整后端模块断言一次（只影响编译期，运行时还是这个假身）。
 */
export function createGuessingFake(): BackendModule {
  return {
    id: 'counts-guessing-fake',
    label: '数不全却回数的假身',
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      // 契约要求「返回里带 errors 或数据不完整时一律失败」；它偏不 —— 直接拿第一页的数当全量。
      counts: async () => ({ ok: true, data: { open: 100, closed: 100, total: 200 } }),
    }),
    matches: async () => false,
  } as unknown as BackendModule
}

export async function run(): Promise<CountsAssertResult[]> {
  const out: CountsAssertResult[] = []
  const P = 'counts · '
  const assert = async (name: string, cond: unknown, detail?: string): Promise<void> => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }
  // 注册表上下文只给日志两格就够了：本段的 matches 都不摸上下文，真后端的 counts 走各自探针的 ctx。
  // 类型上按完整 BackendContext 断言一次，运行时还是这个两格对象。
  const regCtx = { logEvent: () => {}, isEnabled: () => false } as unknown as BackendContext
  const reg = createRegistry(regCtx, { matchesTimeout: 200 })
  const ref = (backend: string): RepositoryRef => ({ backend: backend, refId: backend === 'markdown' ? '/ws/fake' : 'acme/demo', name: 'demo', url: '' })
  // 顶层探针上下文只给工作区一格：假身的 counts 不摸上下文，真后端的走各自探针的 ctx。
  const ctx = { cwd: '/ws/fake' } as unknown as OpContext

  // ── 一、做不到的假身：注册表自动补桩，它必须诚实地说做不到 ──
  // get 前刚 register 过，不可能缺席；! 只是把 undefined 从类型里去掉，
  // 运行时还是原来那个 tracker（真缺席了照样在 .counts 上抛出来被 assert 接住，和原来一致）。
  {
    const d = reg.register(createUnsupportedFake())
    const tracker = reg.get('counts-unsupported-fake')!
    const r = await loose(tracker.counts(ref('github'), {}, ctx))
    await assert('注册表包桩后 counts 可调（不抛）', typeof tracker.counts === 'function', 'Proxy 没按 OPERATIONS 补桩')
    await assert('做不到的假身：counts 诚实说做不到', unsupportedAnswerCheck('counts', r).length === 0, unsupportedAnswerCheck('counts', r).join('；') || JSON.stringify(r))
    await assert('✗ probe: 假装能用的回答被逮（回一个漂亮的 0）', unsupportedAnswerCheck('counts', { ok: true, data: { open: 0, closed: 0, total: 0 } }).length > 0, '检查器放过了「假装能」')
    await assert('✗ probe: 说错了错误档也被逮', unsupportedAnswerCheck('counts', { ok: false, error: { kind: 'network', message: 'counts-unsupported-fake does not implement op counts' } }).length > 0, '检查器放过了错误的 error.kind')
    d.dispose()
  }

  // ── 二、能计数的假身：形状、自洽、state 收窄 ──
  {
    const fake = createCountingFake({ counts: { open: 12, closed: 643, total: 655 } })
    const d = reg.register(fake)
    const tracker = reg.get('counts-fake')!
    const r = await loose(tracker.counts(ref('github'), {}, ctx))
    await assert('能计数的假身：三个数是整数、open + closed = total', countsShapeCheck(r).length === 0, countsShapeCheck(r).join('；') || JSON.stringify(r))
    await assert('能计数的假身：数字原样交出（不当成 0、不自己再数一遍）', r.ok === true && r.data.open === 12 && r.data.closed === 643 && r.data.total === 655, JSON.stringify(r))
    const rOpen = await loose(tracker.counts(ref('github'), { state: 'open' }, ctx))
    await assert('filter.state=open 收窄口径（另一种状态计 0）', countsShapeCheck(rOpen).length === 0 && rOpen.data.open === 12 && rOpen.data.closed === 0 && rOpen.data.total === 12, JSON.stringify(rOpen))
    const rClosed = await loose(tracker.counts(ref('github'), { state: 'closed' }, ctx))
    await assert('filter.state=closed 收窄口径（另一种状态计 0）', countsShapeCheck(rClosed).length === 0 && rClosed.data.closed === 643 && rClosed.data.open === 0, JSON.stringify(rClosed))
    d.dispose()

    // ✗ probe：检查器必须逮得住形状写错的回答（否则这一段等于没写）
    await assert('✗ probe: 漏了 total 被逮', countsShapeCheck({ ok: true, data: { open: 1, closed: 2 } }).length > 0, '检查器放过了缺键')
    await assert('✗ probe: 三个数不自洽被逮', countsShapeCheck({ ok: true, data: { open: 1, closed: 2, total: 99 } }).length > 0, '检查器放过了 open + closed ≠ total')
    await assert('✗ probe: 负数被逮', countsShapeCheck({ ok: true, data: { open: -1, closed: 2, total: 1 } }).length > 0, '检查器放过了负数')
    await assert('✗ probe: 小数被逮', countsShapeCheck({ ok: true, data: { open: 1.5, closed: 2, total: 3.5 } }).length > 0, '检查器放过了小数')
    await assert('✗ probe: 数字写成字符串被逮', countsShapeCheck({ ok: true, data: { open: '1', closed: '2', total: '3' } }).length > 0, '检查器放过了字符串')
    await assert('✗ probe: 多带了一个键被逮', countsShapeCheck({ ok: true, data: { open: 1, closed: 2, total: 3, partial: true } }).length > 0, '检查器放过了多余字段')
    await assert('✗ probe: 只回一个数被逮（不是三个数的形状）', countsShapeCheck({ ok: true, data: 10 }).length > 0, '检查器放过了非对象')
  }

  // ── 三、数不全就该整体失败（假身演配额耗尽 / 数不出来）──
  {
    const d = reg.register(createCountingFake({ id: 'counts-failing-fake', failure: { kind: 'rate-limit', message: '配额用完了，等一会儿再试' } }))
    const r = await loose(reg.get('counts-failing-fake')!.counts(ref('github'), {}, ctx))
    await assert('数不出来 → 整体失败，档位与消息都合规（界面据此退回按池子派生）', countsFailureCheck(r).length === 0, countsFailureCheck(r).join('；') || JSON.stringify(r))
    await assert('✗ probe: 数不出来却退回一个数被逮', countsFailureCheck({ ok: true, data: { open: 0, closed: 0, total: 0 } }).length > 0, '检查器放过了「失败时给 0」')
    await assert('✗ probe: 失败却不说是哪一档被逮', countsFailureCheck({ ok: false, error: { kind: 'whatever', message: 'x' } }).length > 0, '检查器放过了自造的错误档')
    await assert('✗ probe: 失败却没有一句能看懂的话被逮', countsFailureCheck({ ok: false, error: { kind: 'network', message: '' } }).length > 0, '检查器放过了空消息')
    d.dispose()
  }

  // ── 四、真实后端模块探针：三个真后端各给一个「能跑起来」的上下文 ──
  //   GitLab（地图 10 / #1062）与本地 Markdown（#691）这一轮真实现了 counts；GitHub 更早实现。
  //   三段各自桩掉外部命令或给一个临时工作区，让「真去做」这条路走得通。
  //   判据一个字没放宽：检查器检查的是**真实模块的输出**，而且对真实现只收「做到」这一种答案。
  {
    // 脚本化的 gh：按命令给不同的应答；可以通过 seed 换成「带 errors」「缺 totalCount」等坏响应。
    // 发出去的实参记在 lastGhArgs 里：#1183 要看「空数组有没有进查询」，只看返回的数字看不出来。
    let lastGhArgs = ''
    const mkScriptedGh = (payload: unknown, opts?: { fail?: string }) => async (cmd: string, args?: string[]) => {
      const a = (args || []).join(' ')
      lastGhArgs = a
      if (opts && opts.fail) return { code: 1, stdout: '', stderr: opts.fail }
      if (a.includes('api graphql')) return { code: 0, stdout: typeof payload === 'string' ? payload : JSON.stringify(payload), stderr: '' }
      return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + a }
    }
    const GOOD = { data: { repository: { openIssues: { totalCount: 31 }, closedIssues: { totalCount: 649 } } } }
    // #1159 起房间要求宿主注入出站控制面（ctx.outbound）；夹具自带生产那一份（只做转发），
    // 否则脚本化的 gh 连被调用的机会都没有（#1183 补夹具时发现整段 github 探针都红在这里）。
    const probeCtx = (ghPayload: unknown, opts?: { fail?: string }): OpContext => ({ cwd: '/ws/fake', outbound: createOutboundControl(), platform: { resolveExecutable: async (n: string) => (n === 'gh' ? 'gh' : null) }, exec: mkScriptedGh(ghPayload, opts), isEnabled: () => false, logEvent: () => {} }) as unknown as OpContext

    // ── 四之一、真实 GitLab 后端：给它一个脚本化的 glab，要求它拿到回话之后把三个数给对 ──
    //   2026-10-14（地图 10 / #1062）这一房真实现了 counts；2026-10-15 返工（对抗式审查发现 1）把这一段
    //   从「失败得好看就算过」改成正向行为断言。
    //   这一段的 ctx 与下面 github 探针同一个形状：cwd、platform（resolveExecutable 认得 glab）、
    //   exec（脚本化的桩）、isEnabled 与 logEvent。有 exec 有 platform，glabClient 才会走「真去做」那条路
    //   —— 不再靠「没有运行环境所以失败」来验这条能力。
    {
      // 脚本化的 glab：按命令名分派（本房读路径都走 execGlab → exec('glab', args)）。
      // 只脚本化 issues_statistics 一条；别的路径一律回失败，好让「多发了一次没脚本化的请求」当场露出来。
      const mkScriptedGlab = (opts?: { statFail?: string; statPayload?: unknown }) => {
        const o: { statFail?: string; statPayload?: unknown } = opts || {}
        const calls: string[] = []
        const exec = async (cmd: string, args?: string[]) => {
          const line = (args || []).join(' ')
          calls.push(line)
          if (cmd !== 'glab') return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + cmd }
          if (line.indexOf('/issues_statistics?') >= 0) {
            if (o.statFail) return { code: 1, stdout: '', stderr: o.statFail }
            return { code: 0, stdout: typeof o.statPayload === 'string' ? o.statPayload : JSON.stringify(o.statPayload), stderr: '' }
          }
          return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + line }
        }
        return { exec: exec, calls: calls }
      }
      // 官方文档那个回包形状：statistics.counts 里是 all / closed / opened。
      const STATS = { statistics: { counts: { all: 20, closed: 5, opened: 15 } } }
      const glProbeCtx = (s: ReturnType<typeof mkScriptedGlab>): OpContext => ({ cwd: '/ws/fake', platform: { resolveExecutable: async (n: string) => (n === 'glab' ? 'glab' : null) }, exec: s.exec, isEnabled: () => false, logEvent: () => {} }) as unknown as OpContext

      const regGl = createRegistry(regCtx, { matchesTimeout: 200 })
      const dGl = regGl.register(gitlabBackend)
      const gl = regGl.get('gitlab')!

      const s1 = mkScriptedGlab({ statPayload: STATS })
      const rAll = await loose(gl.counts(ref('gitlab'), {}, glProbeCtx(s1)))
      await assert('真实 gitlab 后端：拿到 issues_statistics 回话后把三个数给对（opened→open、all→total）', countsAnswerCheck(rAll, { open: 15, closed: 5, total: 20 }).length === 0, countsAnswerCheck(rAll, { open: 15, closed: 5, total: 20 }).join('；') || JSON.stringify(rAll))
      await assert('真实 gitlab 后端：请求打到 issues_statistics，且显式带 scope=all（不赌远端没写出来的默认值）', s1.calls.length === 1 && /projects\/acme%2Fdemo\/issues_statistics\?/.test(s1.calls[0]) && /[?&]scope=all(&|$)/.test(s1.calls[0]), JSON.stringify(s1.calls))
      // #1183：空数组与省略同结果（都是不过滤）。桩不看筛条件，所以数字相等之外，还要看新发的那条
      //   请求里没有 labels 这一格 —— 空数组进了 URL 才是真的走样。
      const callsBeforeEmpty = s1.calls.length
      const rEmpty = await loose(gl.counts(ref('gitlab'), { labels: [] }, glProbeCtx(s1)))
      await assert('真实 gitlab 后端：labels 空数组与省略同结果（opened→open、all→total，三个数一样）', countsAnswerCheck(rEmpty, { open: 15, closed: 5, total: 20 }).length === 0, countsAnswerCheck(rEmpty, { open: 15, closed: 5, total: 20 }).join('；') || JSON.stringify(rEmpty))
      await assert('真实 gitlab 后端：空数组不进 URL（远端没写清空数组的含义，不赌它）', s1.calls.length === callsBeforeEmpty + 1 && !/[?&]labels=/.test(s1.calls[callsBeforeEmpty]), JSON.stringify(s1.calls))

      const beforeOpen = s1.calls.length
      const rOpen = await loose(gl.counts(ref('gitlab'), { state: 'open' }, glProbeCtx(s1)))
      await assert('真实 gitlab 后端：filter.state=open 在本地收窄（打开的那个数、关闭归零）', countsAnswerCheck(rOpen, { open: 15, closed: 0, total: 15 }).length === 0, countsAnswerCheck(rOpen, { open: 15, closed: 0, total: 15 }).join('；') || JSON.stringify(rOpen))
      await assert('真实 gitlab 后端：filter.state 不进 URL（这个端点没有 state 这一格，收窄只能在本地做）', s1.calls.length === beforeOpen + 1 && s1.calls[beforeOpen] === s1.calls[0], JSON.stringify(s1.calls))
      const rClosed = await loose(gl.counts(ref('gitlab'), { state: 'closed' }, glProbeCtx(s1)))
      await assert('真实 gitlab 后端：filter.state=closed 同样只在本地收窄（关闭的那个数、打开归零）', countsAnswerCheck(rClosed, { open: 0, closed: 5, total: 5 }).length === 0, countsAnswerCheck(rClosed, { open: 0, closed: 5, total: 5 }).join('；') || JSON.stringify(rClosed))

      // 数不出来 → 整体失败，不许拿三个零顶上（远端报错原文里带 401，档位走既有分类）
      const s2 = mkScriptedGlab({ statFail: 'glab: HTTP 401: Bad credentials' })
      const rDown = await loose(gl.counts(ref('gitlab'), {}, glProbeCtx(s2)))
      await assert('真实 gitlab 后端：issues_statistics 报错 → 整体失败，不许给三个零', countsFailureCheck(rDown).length === 0 && !(rDown.data && rDown.data.open === 0 && rDown.data.closed === 0 && rDown.data.total === 0), countsFailureCheck(rDown).join('；') || JSON.stringify(rDown))

      // ✗ probe：这一段的新判据必须逮得住「一律返回失败」的空壳 —— 这正是 2026-10-15 返工要堵的洞。
      //   为什么要专门写这几条：原来那一条断言只看「ok:false、档位不是 unsupported、消息非空」，
      //   把真实现换成 `fail(env, '还没做')` 的空壳照样绿。判据放不放空壳过去，只能靠喂空壳来证明。
      const SHELL = { ok: false, error: { kind: 'env', message: '还没做' } }
      await assert('✗ probe: 「一律返回失败」的空壳回答过不了新判据', countsAnswerCheck(SHELL, { open: 15, closed: 5, total: 20 }).length > 0, '判据给出的违规清单：' + JSON.stringify(countsAnswerCheck(SHELL, { open: 15, closed: 5, total: 20 })))
      await assert('✗ probe: 空壳改回一个漂亮的 0 也过不了（三个数必须来自远端回话）', countsAnswerCheck({ ok: true, data: { open: 0, closed: 0, total: 0 } }, { open: 15, closed: 5, total: 20 }).length > 0, '判据给出的违规清单：' + JSON.stringify(countsAnswerCheck({ ok: true, data: { open: 0, closed: 0, total: 0 } }, { open: 15, closed: 5, total: 20 })))
      dGl.dispose()
    }

    // 本地 Markdown 这一轮真实现了（#691 第四件）：给它一个临时工作区，要求它把三个数给对。
    // 判据一个字没放宽 —— 检查的还是**真实模块的输出**，只是这次它应当回一个数而不是「做不到」。
    {
      const fx = makeMarkdownFixture() // 2 张开着 + 3 张已关闭
      try {
        const regMd = createRegistry(regCtx, { matchesTimeout: 200 })
        const dMd = regMd.register(markdownModule)
        const rMd = await loose(regMd.get('markdown')!.counts(fx.repo, {}, fx.ctx))
        await assert('真实 markdown 后端：数字给对（2 开 3 关，数的是临时工作区里真实的票文件）', countsShapeCheck(rMd).length === 0 && rMd.ok === true && rMd.data.open === 2 && rMd.data.closed === 3 && rMd.data.total === 5, countsShapeCheck(rMd).join('；') || JSON.stringify(rMd))
        // #1183：空数组与省略同结果（都是不过滤）。这一房在内存里筛，数字相等就是行为相等。
        const rMdEmpty = await loose(regMd.get('markdown')!.counts(fx.repo, { labels: [] }, fx.ctx))
        await assert('真实 markdown 后端：labels 空数组与省略同结果（2 开 3 关，一个不少）', rMdEmpty.ok === true && rMdEmpty.data.open === 2 && rMdEmpty.data.closed === 3 && rMdEmpty.data.total === 5, JSON.stringify(rMdEmpty))
        dMd.dispose()
      } finally {
        fx.cleanup()
      }
    }

    const regGh = createRegistry(regCtx, { matchesTimeout: 200 })
    const dGh = regGh.register(githubModule)
    const gh = regGh.get('github')!
    const good = await loose(gh.counts(ref('github'), {}, probeCtx(GOOD)))
    await assert('真实 github 后端：数字给对（三个数形状与自洽都对，值来自脚本化的 gh）', countsShapeCheck(good).length === 0 && good.data.open === 31 && good.data.closed === 649 && good.data.total === 680, countsShapeCheck(good).join('；') || JSON.stringify(good))
    // #1183：空数组与省略同结果（都是不过滤）。桩不看筛条件，数字相等之外，还要看走的是不带
    //   filterBy 的那一版查询、且一个 labels[] 都没传 —— 空数组进了查询才是真的走样。
    const goodEmpty = await loose(gh.counts(ref('github'), { labels: [] }, probeCtx(GOOD)))
    await assert('真实 github 后端：labels 空数组与省略同结果（三个数与不筛时一样）', countsShapeCheck(goodEmpty).length === 0 && goodEmpty.data.open === 31 && goodEmpty.data.closed === 649 && goodEmpty.data.total === 680, JSON.stringify(goodEmpty))
    await assert('真实 github 后端：空数组不进远端查询（走不带 filterBy 的那一版，一个 labels[] 都不传）', !/labels\[\]=/.test(lastGhArgs) && !/filterBy/.test(lastGhArgs), lastGhArgs.slice(0, 220))
    const goodFiltered = await loose(gh.counts(ref('github'), { state: 'open' }, probeCtx(GOOD)))
    await assert('真实 github 后端：filter.state 收窄（另一个状态计 0）', countsShapeCheck(goodFiltered).length === 0 && goodFiltered.data.open === 31 && goodFiltered.data.closed === 0, JSON.stringify(goodFiltered))

    // 带 errors 的响应 → 必须整体失败，不许拿 totalCount 里可能有的半边数凑一个出来
    const withErrors = await loose(gh.counts(ref('github'), {}, probeCtx({ data: { repository: { openIssues: { totalCount: 31 }, closedIssues: { totalCount: 649 } } }, errors: [{ message: 'Something went wrong while executing your query' }] })))
    await assert('真实 github 后端：响应里带 errors → 整体失败（不许猜一个数出来）', countsFailureCheck(withErrors).length === 0, countsFailureCheck(withErrors).join('；') || JSON.stringify(withErrors))
    // 缺 totalCount → 同样整体失败
    const missing = await loose(gh.counts(ref('github'), {}, probeCtx({ data: { repository: { openIssues: { totalCount: 31 }, closedIssues: {} } } })))
    await assert('真实 github 后端：缺 totalCount → 整体失败（不许把缺的那个当 0）', countsFailureCheck(missing).length === 0, countsFailureCheck(missing).join('；') || JSON.stringify(missing))
    // 坏 JSON → 解析档
    const badJson = await loose(gh.counts(ref('github'), {}, probeCtx('{not json')))
    await assert('真实 github 后端：坏 JSON → 解析档', badJson.ok === false && badJson.error && (badJson.error as { kind?: unknown }).kind === 'parse', JSON.stringify(badJson))
    // gh 起不来（没登录 / 网络）→ 如实报，不退化成 0
    const ghDown = await loose(gh.counts(ref('github'), {}, probeCtx(GOOD, { fail: 'gh: Not logged in' })))
    await assert('真实 github 后端：gh 报错 → 如实失败（档位来自既有分类，不退化成 0）', countsFailureCheck(ghDown).length === 0 && ghDown.error !== undefined && (ghDown.error as { kind?: unknown }).kind !== undefined, countsFailureCheck(ghDown).join('；') || JSON.stringify(ghDown))
    // 仓库地址写坏 → 找不到档（不静默回 0）
    const badRef = await loose(gh.counts({ backend: 'github', refId: 'no-slash', name: 'x', url: '' }, {}, probeCtx(GOOD)))
    await assert('真实 github 后端：仓库地址不合法 → 找不到档', badRef.ok === false && badRef.error && (badRef.error as { kind?: unknown }).kind === 'not-found', JSON.stringify(badRef))
    dGh.dispose()

    // ✗ probe：探针判据本身要逮得住「既不诚实、也没做到契约」的回答
    await assert('✗ probe: 真实后端把数字写成字符串被逮', countsProbeCheck({ ok: true, data: { open: '31', closed: '649', total: '680' } }).length > 0, '探针放过了字符串数字')
    await assert('✗ probe: 真实后端失败却用了自造的档被逮', countsProbeCheck({ ok: false, error: { kind: 'unsupported-ish', message: 'backend github does not implement op counts' } }).length > 0, '探针放过了自造错误档')
  }

  // ── 五、这一段故意不判的东西（写下来免得以后有人以为已经守住了）──
  //   一个形状完全合规、数字却是猜出来的回包（比如只数了第一页就拿它当全量），光看回包形状挑不出毛病。
  //   契约因此把责任放在后端自己身上：数不全时必须整体失败 —— 上面第四段拿真 github 模块验过两次
  //   （响应里带 errors、以及缺 totalCount，两次都必须整体失败，不许回数）。编排层另有一道判据：
  //   池子里的工单行数比 counts.total 还多，说明这个数字不可信（见 sections/snapshot.js 的 partial 一段）。
  {
    const d = reg.register(createGuessingFake())
    const r = await loose(reg.get('counts-guessing-fake')!.counts(ref('github'), {}, ctx))
    await assert('已知边界：形状合规的「猜出来的数」靠形状检查器逮不住（所以责任在后端自报失败 + 编排层核对）', countsShapeCheck(r).length === 0, countsShapeCheck(r).join('；') || JSON.stringify(r))
    d.dispose()
  }

  return out
}

export default { name: 'counts', run }

