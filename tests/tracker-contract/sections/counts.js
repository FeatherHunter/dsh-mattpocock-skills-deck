/**
 * tests/tracker-contract/sections/counts.js — 计数契约段（#689）。
 *
 * 第一性原理：这一条操作（counts）是「面板上那几个数字从哪来」在契约层的接缝。原来数字由客户端数手上
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
 * 另有两条不是对着假身自说自话，而是对着真实的东西断言：
 *   三 · 真实 GitLab 与本地 Markdown 后端模块：首期一行不改，注册表自动补桩，这条操作落到「做不到」。
 *   四 · 真实 GitHub 后端模块：给一个脚本化的 gh，要求它要么诚实地失败、要么把三个数给对；
 *        再单独验一件事 —— gh 回了个带 errors / 缺 totalCount 的响应时，它必须整体失败，不许猜。
 *
 * 每段自带反例（✗ probe）：检查器是纯函数，把故意写错的样本喂给它必须逮住；逮不住这一段就形同虚设。
 */

import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'
import * as nodeOs from 'node:os'
import { createRegistry } from '../../../src/host/tracker/registryCore.js'
import { ERROR_KIND } from '../../../src/shared/tracker/constants.js'
import { gitlabBackend } from '../../../src/host/tracker/backends/gitlab/index.js'
import { githubModule } from '../../../src/host/tracker/backends/github/index.js'
import { markdownModule } from '../../../src/host/tracker/backends/markdown/index.js'
import { unsupportedAnswerCheck } from './labels.js'

const KNOWN_KINDS = Object.values(ERROR_KIND)

/**
 * 造一个临时工作区（系统临时目录里的 `.scratch/demo`），用完即删：给「真实 markdown 后端」的探针用。
 * 两个工作单元形态与 tests/verify-691-markdown-counts.js 同一套：2 张开着的票 + 3 张已关闭的票
 * （已关闭的判据是票里 `Status:` 行落进 resolved / completed / closed / done 四者之一，见 #688 的实测结论）。
 */
function makeMarkdownFixture() {
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'dsws-counts-'))
  const dir = nodePath.join(root, '.scratch', 'demo')
  nodeFs.mkdirSync(nodePath.join(dir, 'issues'), { recursive: true })
  nodeFs.writeFileSync(nodePath.join(dir, 'map.md'), '# Demo\n\nStatus: ready-for-agent\n', 'utf8')
  const rows = [['01-a.md', 'in-progress'], ['02-b.md', 'ready-for-agent'], ['03-c.md', 'resolved'], ['04-d.md', 'done'], ['05-e.md', 'completed']]
  for (const [file, status] of rows) nodeFs.writeFileSync(nodePath.join(dir, 'issues', file), '# ' + file + '\n\nStatus: ' + status + '\n', 'utf8')
  const plat = {
    path: nodePath.posix,
    fs: {
      async resolve(p) { return p },
      async readText(t) { return nodeFs.readFileSync(t, 'utf8') },
      async writeText(t, c) { nodeFs.mkdirSync(nodePath.dirname(t), { recursive: true }); nodeFs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return nodeFs.statSync(t) } catch (e) { return null } },
      async listDir(t) { try { return nodeFs.readdirSync(t) } catch (e) { return [] } },
      async stat(t) { try { return nodeFs.statSync(t) } catch (e) { return null } },
    },
  }
  return {
    repo: { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' },
    ctx: { platform: plat, fs: plat.fs, cwd: root, get(name) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { nodeFs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 计数回答检查器：返回违规清单（空 = 合规）。三个数必须是非负整数，且 open + closed = total。 */
export function countsShapeCheck(res) {
  const bad = []
  if (!res || typeof res !== 'object') return ['计数要返回 {ok:true, data:{open,closed,total}} 或 {ok:false, error:{kind,message}}']
  if (res.ok !== true) return ['这一份是成功样本，ok 应为 true，实得 ' + JSON.stringify(res.ok)]
  const d = res.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['data 要是对象 {open,closed,total}']
  const keys = Object.keys(d).sort().join(',')
  if (keys !== 'closed,open,total') bad.push('data 只许有 open、closed、total 三个键，实得 ' + keys)
  for (const k of ['open', 'closed', 'total']) {
    const v = d[k]
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v) bad.push(k + ' 要是不小于 0 的整数，实得 ' + JSON.stringify(v))
  }
  if (typeof d.open === 'number' && typeof d.closed === 'number' && typeof d.total === 'number' && d.open + d.closed !== d.total) {
    bad.push('三个数要自洽：open + closed 应等于 total，实得 ' + d.open + ' + ' + d.closed + ' ≠ ' + d.total)
  }
  return bad
}

/** 「数不全就该失败」检查器：整条操作必须失败，档位是契约里列的那几种，且消息里说得清为什么。 */
export function countsFailureCheck(res) {
  const bad = []
  if (!res || typeof res !== 'object') return ['数不全时要以 {ok:false, error:{kind,message}} 整体失败，实得 ' + JSON.stringify(res)]
  if (res.ok !== false) return ['数不全时必须整体失败（不许猜一个数出来），实得 ok=' + JSON.stringify(res.ok) + ' data=' + JSON.stringify(res.data)]
  const err = res.error
  if (!err || typeof err !== 'object') return ['失败要给 error 对象说清为什么', JSON.stringify(res)]
  if (!KNOWN_KINDS.includes(err.kind)) bad.push('error.kind 必须是既有错误分类之一，实得 ' + JSON.stringify(err.kind))
  if (typeof err.message !== 'string' || !err.message.trim()) bad.push('error.message 要是能看懂的一句话')
  return bad
}

/** 真实后端探针的判据：要么诚实地说做不到（unsupported 桩），要么把三个数给对。 */
export function countsProbeCheck(res) {
  if (res && typeof res === 'object' && res.ok === false) return unsupportedAnswerCheck('counts', res)
  return countsShapeCheck(res)
}

// ── 三个假身（只活在测试里）──────────────────────────────────────────────────

/** 做不到的假身：create() 只给 list，计数这条由注册表按 OPERATIONS 自动补桩。 */
export function createUnsupportedFake(id) {
  return {
    id: id || 'counts-unsupported-fake',
    label: '做不到的假身',
    create: () => ({ list: async () => ({ ok: true, data: [] }) }),
    matches: async () => false,
  }
}

/** 能计数的假身：数字由 seed 给；failure 可让某一次整体失败（演配额耗尽 / 连不通）。 */
export function createCountingFake(seed) {
  const calls = { n: 0 }
  return {
    id: (seed && seed.id) || 'counts-fake',
    label: '能计数的假身',
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      counts: async (repo, filter) => {
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
  }
}

/** 数不全却照样回一个数的假身：只数了第一页，把那一页的条数当成全量交出去。 */
export function createGuessingFake() {
  return {
    id: 'counts-guessing-fake',
    label: '数不全却回数的假身',
    create: () => ({
      list: async () => ({ ok: true, data: [] }),
      // 契约要求「返回里带 errors 或数据不完整时一律失败」；它偏不 —— 直接拿第一页的数当全量。
      counts: async () => ({ ok: true, data: { open: 100, closed: 100, total: 200 } }),
    }),
    matches: async () => false,
  }
}

export async function run() {
  const out = []
  const P = 'counts · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const ref = (backend) => ({ backend: backend, refId: backend === 'markdown' ? '/ws/fake' : 'acme/demo', name: 'demo', url: '' })
  const ctx = { cwd: '/ws/fake' }

  // ── 一、做不到的假身：注册表自动补桩，它必须诚实地说做不到 ──
  {
    const d = reg.register(createUnsupportedFake())
    const tracker = reg.get('counts-unsupported-fake')
    await assert('注册表包桩后 counts 可调（不抛）', typeof tracker.counts === 'function', 'Proxy 没按 OPERATIONS 补桩')
    const r = await tracker.counts(ref('github'), {}, ctx)
    await assert('做不到的假身：counts 诚实说做不到', unsupportedAnswerCheck('counts', r).length === 0, unsupportedAnswerCheck('counts', r).join('；') || JSON.stringify(r))
    await assert('✗ probe: 假装能用的回答被逮（回一个漂亮的 0）', unsupportedAnswerCheck('counts', { ok: true, data: { open: 0, closed: 0, total: 0 } }).length > 0, '检查器放过了「假装能」')
    await assert('✗ probe: 说错了错误档也被逮', unsupportedAnswerCheck('counts', { ok: false, error: { kind: 'network', message: 'counts-unsupported-fake does not implement op counts' } }).length > 0, '检查器放过了错误的 error.kind')
    d.dispose()
  }

  // ── 二、能计数的假身：形状、自洽、state 收窄 ──
  {
    const fake = createCountingFake({ counts: { open: 12, closed: 643, total: 655 } })
    const d = reg.register(fake)
    const tracker = reg.get('counts-fake')
    const r = await tracker.counts(ref('github'), {}, ctx)
    await assert('能计数的假身：三个数是整数、open + closed = total', countsShapeCheck(r).length === 0, countsShapeCheck(r).join('；') || JSON.stringify(r))
    await assert('能计数的假身：数字原样交出（不当成 0、不自己再数一遍）', r.ok === true && r.data.open === 12 && r.data.closed === 643 && r.data.total === 655, JSON.stringify(r))
    const rOpen = await tracker.counts(ref('github'), { state: 'open' }, ctx)
    await assert('filter.state=open 收窄口径（另一种状态计 0）', countsShapeCheck(rOpen).length === 0 && rOpen.data.open === 12 && rOpen.data.closed === 0 && rOpen.data.total === 12, JSON.stringify(rOpen))
    const rClosed = await tracker.counts(ref('github'), { state: 'closed' }, ctx)
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
    const r = await reg.get('counts-failing-fake').counts(ref('github'), {}, ctx)
    await assert('数不出来 → 整体失败，档位与消息都合规（界面据此退回按池子派生）', countsFailureCheck(r).length === 0, countsFailureCheck(r).join('；') || JSON.stringify(r))
    await assert('✗ probe: 数不出来却退回一个数被逮', countsFailureCheck({ ok: true, data: { open: 0, closed: 0, total: 0 } }).length > 0, '检查器放过了「失败时给 0」')
    await assert('✗ probe: 失败却不说是哪一档被逮', countsFailureCheck({ ok: false, error: { kind: 'whatever', message: 'x' } }).length > 0, '检查器放过了自造的错误档')
    await assert('✗ probe: 失败却没有一句能看懂的话被逮', countsFailureCheck({ ok: false, error: { kind: 'network', message: '' } }).length > 0, '检查器放过了空消息')
    d.dispose()
  }

  // ── 四、真实后端模块探针：诚实地做不到，或者把数字给对 ──
  //   GitLab 与本地 Markdown 这一轮一行不改（实现排在阶段 3），注册表按 OPERATIONS 自动补桩。
  //   GitHub 这一轮真实现（一次 GraphQL 的 totalCount）；给它一个脚本化的 gh，让它走得通「真去做」这条路。
  //   判据一个字没放宽：检查器检查的是**真实模块的输出**。
  {
    // 脚本化的 gh：按命令给不同的应答；可以通过 seed 换成「带 errors」「缺 totalCount」等坏响应。
    const mkScriptedGh = (payload, opts) => async (cmd, args) => {
      const a = (args || []).join(' ')
      if (opts && opts.fail) return { code: 1, stdout: '', stderr: opts.fail }
      if (a.includes('api graphql')) return { code: 0, stdout: typeof payload === 'string' ? payload : JSON.stringify(payload), stderr: '' }
      return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + a }
    }
    const GOOD = { data: { repository: { openIssues: { totalCount: 31 }, closedIssues: { totalCount: 649 } } } }
    const probeCtx = (ghPayload, opts) => ({ cwd: '/ws/fake', platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null) }, exec: mkScriptedGh(ghPayload, opts), isEnabled: () => false, logEvent: () => {} })

    for (const rb of [{ id: 'gitlab', mod: gitlabBackend }]) {
      const regReal = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
      const d = regReal.register(rb.mod)
      const r = await regReal.get(rb.id).counts(ref(rb.id), {}, ctx)
      await assert('真实 ' + rb.id + ' 后端：counts 自动落到「做不到」（不碰它一行代码）', unsupportedAnswerCheck('counts', r).length === 0, unsupportedAnswerCheck('counts', r).join('；') || JSON.stringify(r))
      d.dispose()
    }

    // 本地 Markdown 这一轮真实现了（#691 第四件）：给它一个临时工作区，要求它把三个数给对。
    // 判据一个字没放宽 —— 检查的还是**真实模块的输出**，只是这次它应当回一个数而不是「做不到」。
    {
      const fx = makeMarkdownFixture() // 2 张开着 + 3 张已关闭
      try {
        const regMd = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
        const dMd = regMd.register(markdownModule)
        const rMd = await regMd.get('markdown').counts(fx.repo, {}, fx.ctx)
        await assert('真实 markdown 后端：数字给对（2 开 3 关，数的是临时工作区里真实的票文件）', countsShapeCheck(rMd).length === 0 && rMd.ok === true && rMd.data.open === 2 && rMd.data.closed === 3 && rMd.data.total === 5, countsShapeCheck(rMd).join('；') || JSON.stringify(rMd))
        dMd.dispose()
      } finally {
        fx.cleanup()
      }
    }

    const regGh = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    const dGh = regGh.register(githubModule)
    const gh = regGh.get('github')
    const good = await gh.counts(ref('github'), {}, probeCtx(GOOD))
    await assert('真实 github 后端：数字给对（三个数形状与自洽都对，值来自脚本化的 gh）', countsShapeCheck(good).length === 0 && good.data.open === 31 && good.data.closed === 649 && good.data.total === 680, countsShapeCheck(good).join('；') || JSON.stringify(good))
    const goodFiltered = await gh.counts(ref('github'), { state: 'open' }, probeCtx(GOOD))
    await assert('真实 github 后端：filter.state 收窄（另一个状态计 0）', countsShapeCheck(goodFiltered).length === 0 && goodFiltered.data.open === 31 && goodFiltered.data.closed === 0, JSON.stringify(goodFiltered))

    // 带 errors 的响应 → 必须整体失败，不许拿 totalCount 里可能有的半边数凑一个出来
    const withErrors = await gh.counts(ref('github'), {}, probeCtx({ data: { repository: { openIssues: { totalCount: 31 }, closedIssues: { totalCount: 649 } } }, errors: [{ message: 'Something went wrong while executing your query' }] }))
    await assert('真实 github 后端：响应里带 errors → 整体失败（不许猜一个数出来）', countsFailureCheck(withErrors).length === 0, countsFailureCheck(withErrors).join('；') || JSON.stringify(withErrors))
    // 缺 totalCount → 同样整体失败
    const missing = await gh.counts(ref('github'), {}, probeCtx({ data: { repository: { openIssues: { totalCount: 31 }, closedIssues: {} } } }))
    await assert('真实 github 后端：缺 totalCount → 整体失败（不许把缺的那个当 0）', countsFailureCheck(missing).length === 0, countsFailureCheck(missing).join('；') || JSON.stringify(missing))
    // 坏 JSON → 解析档
    const badJson = await gh.counts(ref('github'), {}, probeCtx('{not json'))
    await assert('真实 github 后端：坏 JSON → 解析档', badJson.ok === false && badJson.error && badJson.error.kind === 'parse', JSON.stringify(badJson))
    // gh 起不来（没登录 / 网络）→ 如实报，不退化成 0
    const ghDown = await gh.counts(ref('github'), {}, probeCtx(GOOD, { fail: 'gh: Not logged in' }))
    await assert('真实 github 后端：gh 报错 → 如实失败（档位来自既有分类，不退化成 0）', countsFailureCheck(ghDown).length === 0 && ghDown.error.kind !== undefined, countsFailureCheck(ghDown).join('；') || JSON.stringify(ghDown))
    // 仓库地址写坏 → 找不到档（不静默回 0）
    const badRef = await gh.counts({ backend: 'github', refId: 'no-slash', name: 'x', url: '' }, {}, probeCtx(GOOD))
    await assert('真实 github 后端：仓库地址不合法 → 找不到档', badRef.ok === false && badRef.error && badRef.error.kind === 'not-found', JSON.stringify(badRef))
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
    const r = await reg.get('counts-guessing-fake').counts(ref('github'), {}, ctx)
    await assert('已知边界：形状合规的「猜出来的数」靠形状检查器逮不住（所以责任在后端自报失败 + 编排层核对）', countsShapeCheck(r).length === 0, countsShapeCheck(r).join('；') || JSON.stringify(r))
    d.dispose()
  }

  return out
}

export default { name: 'counts', run }
