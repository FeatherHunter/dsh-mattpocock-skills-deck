/**
 * tests/tracker-contract/sections/idempotency.js — 创建幂等锚段（#711）。
 *
 * 第一性原理：这一段的对手不是「有没有实现一个函数」，而是一种最难查的错：**票已经建成了、
 * 只是调用方没收到回答**（超时、EOF、退出码非 0 但票已经写进去了）。这种时候调用方一定会重试，
 * 光靠进程内的一张 Map 挡不住 —— 进程重启、插件重载、换个会话回来，Map 就空了，而票还在。
 * 所以这一段盯的是三件事：
 *   一、同一个锚提交两次，只多出一张票、返回同一个 key；
 *   二、两次提交之间把全部进程内状态丢掉（换一个全新的后端实例 + 释放旧注册表），复用必须照样成立；
 *   三、不带锚时行为与加这个字段之前完全一样（每次新建，两张票）—— 既有行为不许被改坏。
 * 不锁实现细节：断言里不出现「用了哪条命令、锚拼成什么形状」，换实现而行为不变，这一段不该红。
 *
 * 三块位置各验一遍，判据都是**盘上/远端的真实内容**，不是「它说它记住了」：
 *   甲 · 假身：按**锚**（不是按内存里的调用计数）判重，用来看住契约层那条形状。
 *       它的查表键是票面里写着的锚 —— 后面「✗ probe: 只认内存」那一条就是把这个位置做坏之后
 *       必须变红的反证。
 *   乙 · 真实本地 Markdown 后端：给一个临时工作区。这一段最硬，因为票就是文件：
 *       建完直接把文件读出来看锚在不在，第二次提交再看盘上的文件数与文件内容有没有变。
 *   丙 · 真实 GitHub / GitLab 后端模块：给脚本化的 gh / glab，验锚确实写进了远端请求的正文里，
 *       以及第二次提交在**搜索没命中**（模拟索引滞后）时靠「按创建时间/更新时间列出来逐张读正文」照样复用。
 *
 * 每条正例都配反证（✗ probe）：把「回查」这一步做坏，这一段必须变红。
 * 反证分两层：纯函数那一层（matchAnchor 的四种不命中）在这里当场断言；
 * 「把回查做坏整段必须变红」这一层是独立的现场实验，输出原文见交付报告。
 */

import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'
import * as nodeOs from 'node:os'
import { createRegistry } from '../../../src/host/tracker/registryCore.js'
import { ERROR_KIND } from '../../../src/shared/tracker/constants.js'
import { githubModule } from '../../../src/host/tracker/backends/github/index.js'
import { gitlabBackend } from '../../../src/host/tracker/backends/gitlab/index.js'
import { markdownModule } from '../../../src/host/tracker/backends/markdown/index.js'
import { normalizeIssue as ghNormalize } from '../../../src/host/tracker/backends/github/normalize.js'
import {
  anchorLineFor,
  checkIdempotencyKey,
  idempotencyKeyOf,
  matchAnchor,
  isAnchorHit,
} from '../../../src/shared/refresh/idempotency.js'

const KNOWN_KINDS = Object.values(ERROR_KIND)

// ─────────────────────────────────────────────────────────────────────────────
// 一、纯逻辑那一层：锚长什么样、认不认得回来、算不算命中
// ─────────────────────────────────────────────────────────────────────────────

/** 锚形状检查器：返回违规清单（空 = 合规）。 */
export function anchorLineCheck(line) {
  const bad = []
  if (typeof line !== 'string') return ['锚那一行要是字符串，实得 ' + typeof line]
  if (line.indexOf('<!--') !== 0) bad.push('锚要以 HTML 注释开头（这样渲染后看不见），实得 ' + JSON.stringify(line.slice(0, 20)))
  if (!/-->\n$/.test(line)) bad.push('锚要以注释收尾符加一个换行结尾（拼在正文前面就是一个独立成行的注释），实得 ' + JSON.stringify(line.slice(-12)))
  if (line.indexOf('\n') !== line.length - 1) bad.push('锚那一行里不许出现换行（多行锚会让回查读回来的键不是一个整串）')
  return bad
}

/** 回查命中判据的检查器：这一份是不是「找到了、可以复用」。 */
export function hitCheck(match) {
  const bad = []
  if (!match || typeof match !== 'object') return ['回查结论要是一个对象，实得 ' + JSON.stringify(match)]
  if (match.status !== 'hit') return ['这一份是命中样本，status 应为 hit，实得 ' + JSON.stringify(match.status)]
  if (isAnchorHit(match) !== true) bad.push('isAnchorHit 对命中样本要返回 true')
  if (typeof match.key !== 'string' || !match.key) bad.push('命中要带回复用的那张票的 key，实得 ' + JSON.stringify(match.key))
  if (typeof match.reason !== 'string' || !match.reason.trim()) bad.push('命中要给一句给人看的原因')
  return bad
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、假身：按「票面里的锚」判重的一套最小后端
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一批票，存在一个**独立于后端实例**的小仓库里（模拟票真正待的地方：盘上、远端）。
 *
 * 这一点是这段测试的要害：票面里的锚写在那个仓库里，而后端实例的**内存**里什么都不留。
 * 所以「第二次提交换个全新实例」时，能不能复用完全取决于票面上的锚有没有写在仓库里、
 * 回查有没有去仓库里按锚找。哪一步做坏，它就会重复建票（下面那两条 ✗ probe 与现场实验都盯这件事）。
 */
export function createTicketStore() {
  const tickets = []
  return {
    tickets,
    /** 按锚找票：键是**从票面里读回来的锚**，不是调用方递进来的那个键。 */
    findByAnchor(key) {
      for (const t of tickets) if (idempotencyKeyOf(t.body) === key) return t
      return null
    },
    add(title, body) {
      const t = { key: String(tickets.length + 1).padStart(2, '0'), title: String(title || ''), body: String(body || '') }
      tickets.push(t)
      return t
    },
  }
}

/** 一个按锚判重的后端实例：票存在 share.store 里，自己只留一张薄薄的壳（不留任何票的内存副本）。
 *  share.lookupWorks=false 的那一份是**反证用的坏实现**：它的「回查」查的是自己实例里的一张临时表，
 *  票面寄存器根本不看 —— 同一个实例里连着调两次会显得像幂等，换个实例立刻重复建票。 */
export function newAnchorFakeBackend(share) {
  const store = share.store
  // 坏实现的表必须挂在**实例**上（挂在 share 上就成了跨实例的共享记忆，反证就不成立了）
  const memoryOnlyTable = share.lookupWorks === false ? new Map() : null
  const create = async (repo, input) => {
    const key = input && input.idempotencyKey ? String(input.idempotencyKey) : ''
    if (key) {
      if (memoryOnlyTable) {
        const t = memoryOnlyTable.get(key)
        if (t) return { ok: true, data: { key: t.key, title: t.title, state: 'open', body: t.body } }
      } else {
        const hit = store.findByAnchor(key)
        if (hit) return { ok: true, data: { key: hit.key, title: hit.title, state: 'open', body: hit.body } }
      }
    }
    const t = store.add(input.title, key ? anchorLineFor(key) + String(input.body || '') : String(input.body || ''))
    if (memoryOnlyTable && key) memoryOnlyTable.set(key, t)
    return { ok: true, data: { key: t.key, title: t.title, state: 'open', body: t.body } }
  }
  return { id: share.id || 'anchor-fake', list: async () => ({ ok: true, data: [] }), create }
}

/** 一个假身模块：同一条 create 定义，可以被注册表包成 Tracker（也可以直接调）。 */
export function createAnchorFake(id, share) {
  const s = share || { id: id || 'anchor-fake', store: createTicketStore() }
  s.lookupWorks = s.lookupWorks !== false
  if (id) s.id = id
  return {
    id: s.id,
    label: '按锚判重的假身',
    matches: async () => false,
    create: () => newAnchorFakeBackend(s),
    _share: s,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、真实本地 Markdown 后端的临时工作区（与 sections/counts.js 同一套做法）
// ─────────────────────────────────────────────────────────────────────────────

function makeMarkdownWorkspace() {
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'dsws-idem-'))
  const dir = nodePath.join(root, '.scratch', 'demo')
  nodeFs.mkdirSync(nodePath.join(dir, 'issues'), { recursive: true })
  nodeFs.writeFileSync(nodePath.join(dir, 'map.md'), '# Demo\n\nStatus: ready-for-agent\n', 'utf8')
  const plat = {
    path: nodePath.posix,
    fs: {
      async resolve(p) { return String(p).replace(/\\/g, '/') },
      async readText(t) { return nodeFs.readFileSync(t, 'utf8') },
      async writeText(t, c) { nodeFs.mkdirSync(nodePath.dirname(t), { recursive: true }); nodeFs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return nodeFs.statSync(t) } catch (e) { return null } },
      async listDir(t) { try { return nodeFs.readdirSync(t) } catch (e) { return [] } },
      async stat(t) { try { return nodeFs.statSync(t) } catch (e) { return null } },
    },
  }
  const issuesDir = nodePath.join(dir, 'issues').replace(/\\/g, '/')
  return {
    root,
    issuesDir,
    repo: { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' },
    ctx: { platform: plat, fs: plat.fs, cwd: root.replace(/\\/g, '/'), get(name) { return name === 'fs' ? plat.fs : undefined } },
    ticketsOnDisk() { try { return nodeFs.readdirSync(issuesDir).filter((f) => f.endsWith('.md')) } catch (e) { return [] } },
    readTicket(name) { return nodeFs.readFileSync(nodePath.join(issuesDir, name), 'utf8') },
    readTicketMtime(name) { return nodeFs.statSync(nodePath.join(issuesDir, name)).mtimeMs },
    writeTicket(name, text) { nodeFs.writeFileSync(nodePath.join(issuesDir, name), text, 'utf8') },
    cleanup() { try { nodeFs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 用一份**全新**的注册表与后端实例去建票：模拟「进程重启之后再来一次」。 */
async function markdownCreate(fx, input) {
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const d = reg.register(markdownModule)
  try {
    return await reg.get('markdown').create(fx.repo, input, fx.ctx)
  } finally {
    d.dispose()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、脚本化的 gh / glab（真实远端后端模块的探针）
// ─────────────────────────────────────────────────────────────────────────────

/** 脚本化的 gh：记住每一次命令与建出来的票；搜索可以按 seed 做成「索引还没建好」。 */
function makeScriptedGh(opts) {
  const o = opts || {}
  const created = []
  const calls = []
  const argLine = (a) => (a || []).join(' ')
  const exec = async (cmd, args) => {
    const line = argLine(args)
    calls.push(line)
    if (o.failOn && o.failOn(line)) return { code: 1, stdout: '', stderr: o.failMessage || 'probe 脚本里这一条是失败的' }
    if (line.startsWith('search issues')) {
      // 索引还没建好（默认）时搜索回空列表；真建好了才回命中的那一行。
      if (!o.searchReady) return { code: 0, stdout: '[]', stderr: '' }
      return { code: 0, stdout: JSON.stringify(created), stderr: '' }
    }
    if (line.startsWith('issue list')) {
      if (o.listFails) return { code: 1, stdout: '', stderr: '列出票时报错（探针脚本）' }
      return { code: 0, stdout: JSON.stringify(created), stderr: '' }
    }
    if (line.startsWith('api repos/')) {
      // gh api --input - 这条路永远失败（房里的注释自己承认了），这里照真实情况回失败。
      return { code: 1, stdout: '', stderr: 'gh api: stdin 没接上（探针脚本照真实行为回失败）' }
    }
    if (line.startsWith('issue create')) {
      const title = (args[args.indexOf('--title') + 1]) || ''
      const body = (args[args.indexOf('--body') + 1]) || ''
      const number = created.length + 1
      const row = {
        number,
        title,
        body,
        state: 'open',
        url: 'https://github.com/acme/demo/issues/' + number,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      created.push(row)
      return { code: 0, stdout: JSON.stringify(row), stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + line }
  }
  return { exec, created, calls }
}

/** 脚本化的 glab：记住建出来的票；搜索与列表都可以按 seed 做成坏的。 */
function makeScriptedGlab(opts) {
  const o = opts || {}
  const created = []
  const calls = []
  const run = async (args) => {
    const s = Array.isArray(args) ? args.join(' ') : String(args)
    calls.push(s)
    const a = Array.isArray(args) ? args : []
    if (o.failOn && o.failOn(s)) return { code: 1, stdout: '', stderr: o.failMessage || 'probe 脚本里这一条是失败的' }
    if (s.indexOf('issues?') >= 0 && s.indexOf('search=') >= 0) {
      if (!o.searchReady) return { code: 0, stdout: '[]', stderr: '' }
      return { code: 0, stdout: JSON.stringify(created), stderr: '' }
    }
    if (s.indexOf('issues?') >= 0 && s.indexOf('order_by=created_at') >= 0) {
      if (o.listFails) return { code: 1, stdout: '', stderr: '列出票时报错（探针脚本）' }
      return { code: 0, stdout: JSON.stringify(created), stderr: '' }
    }
    if (s.indexOf('/issues') >= 0 && (s.indexOf('--method PUT') >= 0 || s.indexOf('--method POST') >= 0)) {
      const find = (n) => { const i = a.indexOf('-' + n); return i >= 0 ? String(a[i + 1] || '') : '' }
      const title = find('f').replace(/^title=/, '')
      const descParts = []
      for (let i = 0; i < a.length; i++) if (a[i] === '-f' && String(a[i + 1] || '').indexOf('description=') === 0) descParts.push(String(a[i + 1]).replace(/^description=/, ''))
      const iid = created.length + 1
      const row = { iid, title, description: descParts.join(''), state: 'opened' }
      created.push(row)
      return { code: 0, stdout: JSON.stringify(row), stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + s }
  }
  return { run, created, calls }
}

/** 远端后端探针用的调用上下文（platform + 脚本化的命令行）。
 *  gh 与 glab 两间房取 exec 的方式不同：github 的客户端要 `exec('gh', args, opts)`，
 *  gitlab 的客户端要 `exec('glab', args, opts)`，所以这里一个 exec 同时伺候两边（按命令名分派）。 */
function remoteCtx(scripted) {
  return {
    cwd: '/ws/fake',
    platform: {
      resolveExecutable: async (n) => ((n === 'gh' || n === 'glab') ? '/usr/local/bin/' + n : null),
      path: nodePath.posix,
      env: { get: () => undefined },
    },
    exec: async (cmd, args) => {
      if (cmd === 'glab') return scripted.run(args)
      if (scripted.exec) return scripted.exec(cmd, args)
      return { code: 1, stdout: '', stderr: 'probe 没脚本化这条命令: ' + cmd + ' ' + (args || []).join(' ') }
    },
    isEnabled: () => false,
    logEvent: () => {},
  }
}

const GH_REPO = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
const GL_REPO = { backend: 'gitlab', refId: 'acme/demo', name: 'demo', url: '' }

// ─────────────────────────────────────────────────────────────────────────────
// 五、这一段
// ─────────────────────────────────────────────────────────────────────────────

export async function run() {
  const out = []
  const P = 'idempotency · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String((e && e.stack) || e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  // ── 一、锚的形状与认锚（纯逻辑，含 ✗ probe 反证）──
  {
    const key = '01J-abc.deadbeef_feed:3/7'
    const line = anchorLineFor(key)
    await assert('锚那一行是一行看不见的注释、以换行结尾', anchorLineCheck(line).length === 0, anchorLineCheck(line).join('；') || JSON.stringify(line))
    await assert('锚写进正文之后能原样读回来', idempotencyKeyOf('正文第一行\n' + line + '正文在后面') === key, JSON.stringify(idempotencyKeyOf(line + '正文')))
    // 认锚按「一整行」认：这是它为什么不做模糊匹配 —— 下面第一种写法只是**正文里提到**了这个标记的名字，
    // 不该被认成锚（认错了回查就会指向一张不相干的票）；第二种是把锚写在一行里、前后还有别的字，
    // 仍然按行认得出来（写成独立一行本来就是后端统一的做法，这一条只是说认法不挑位置）。
    await assert('✗ probe: 正文里提到的标记名字（一整行只有名字、缺 <!-- 那半截）不许被认成锚', idempotencyKeyOf('DSH-IDEMPOTENCY-KEY: 别人在正文里提到这个标记') === '', '检查器把「正文里提到标记名字」当成了锚')
    await assert('标记前面还写着别的字的那一行不算锚（认锚只认整行开头）', idempotencyKeyOf('别人写的字 ' + line.trim() + ' 后面还有字') === '', JSON.stringify(idempotencyKeyOf('别人写的字 ' + line.trim() + ' 后面还有字')))
    await assert('锚那一行前面有缩进（空格或制表符）时照样认得出来', idempotencyKeyOf('\t  ' + line) === key, JSON.stringify(idempotencyKeyOf('\t  ' + line)))
    await assert('正文里没有锚时读回空串（不猜、不发明一个键）', idempotencyKeyOf('# 标题\n\n普通正文\n') === '', JSON.stringify(idempotencyKeyOf('# 标题\n\n普通正文\n')))

    // 认锚按「一整行」认，这就是它为什么不做模糊匹配：下面第二种写法是**正文里提到**这个标记名字，
    // 不该被认成锚 —— 认错了回查就会指向一张不相干的票。
    await assert('整行只写成这个标记名（缺 <!-- 那半截）不算锚', idempotencyKeyOf('DSH-IDEMPOTENCY-KEY: 别人写的') === '', JSON.stringify(idempotencyKeyOf('DSH-IDEMPOTENCY-KEY: 别人写的')))
    await assert('✗ probe: 注释没写收尾符的写法不许被认成锚', idempotencyKeyOf('<!-- DSH-IDEMPOTENCY-KEY: 半截') === '', '检查器放过了没有收尾符的写法')

    const good = checkIdempotencyKey('  run-2026.09.24_01  ')
    await assert('合规的幂等键过检查，并要求两头空白只去不改成别的串', good.ok === true && good.key === 'run-2026.09.24_01', JSON.stringify(good))
    await assert('✗ probe: 空键被逮', checkIdempotencyKey('   ').ok === false, JSON.stringify(checkIdempotencyKey('   ')))
    await assert('✗ probe: 带换行的键被逮（不许写坏正文）', checkIdempotencyKey('a\nb').ok === false, JSON.stringify(checkIdempotencyKey('a\nb')))
    await assert('✗ probe: 超长键被逮（不许截断成别的键）', checkIdempotencyKey('x'.repeat(201)).ok === false, '超长键被放过了')
    await assert('✗ probe: 注释收尾符写进键里被逮', checkIdempotencyKey('a-->b').ok === false, '带 --> 的键被放过了')
  }

  // ── 二、命中判据：四种不命中（纯逻辑，含 ✗ probe 反证）──
  {
    const key = 'K-1'
    const body = anchorLineFor(key) + '# 标题\n'
    const hit = matchAnchor([{ key: '7', body, state: 'open' }], 'acme/demo', key)
    await assert('票面里写着同一个锚、票还开着 → 命中，带回那张票的 key', hitCheck(hit).length === 0, hitCheck(hit).join('；') || JSON.stringify(hit))
    await assert('一个候选都没有 → 不命中（不是错误，是「还没建过」）', matchAnchor([], 'acme/demo', key).status === 'miss', JSON.stringify(matchAnchor([], 'acme/demo', key)))
    await assert('✗ probe: 候选票面写的是另一个锚 → 不许算命中', matchAnchor([{ key: '7', body: anchorLineFor('别的键') + 'x', state: 'open' }], 'acme/demo', key).status === 'mismatch', '判据放过了「锚对不上」的候选')
    await assert('✗ probe: 候选票面根本没有锚 → 不许算命中（内存里说是它不算数）', matchAnchor([{ key: '7', body: '# 只有正文\n', state: 'open' }], 'acme/demo', key).status === 'mismatch', '判据放过了「票面上没有锚」的候选')
    await assert('✗ probe: 已经关闭的票 → 不许算命中（锚已经用过一轮了）', matchAnchor([{ key: '7', body, state: 'closed' }], 'acme/demo', key).status === 'mismatch', '判据把已关闭的票当成了命中')
    await assert('✗ probe: 另一个仓库里的同锚票 → 不许算命中', matchAnchor([{ key: '7', body, state: 'open', refId: 'other/repo' }], 'acme/demo', key).status === 'mismatch', '判据跨仓库复用了票')
    await assert('没给锚时判据如实说「无从回查」，绝不回一个 miss', matchAnchor([{ key: '7', body: anchorLineFor(key) + 'x', state: 'open' }], 'acme/demo', '').status === 'unsupported', JSON.stringify(matchAnchor([], '', '')))
  }

  // ── 三、假身：同一个锚两次 → 只多出一张票、返回同一个 key；两次之间丢掉全部进程内状态 ──
  {
    const base = { backend: 'anchor-fake', refId: 'acme/demo', name: 'demo', url: '' }
    const ctx = { cwd: '/ws/fake' }

    // 第一次：一个新实例（新的注册表、新的 create 产物）
    const share = { id: 'anchor-fake', store: createTicketStore(), lookupWorks: true }
    const reg1 = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    reg1.register(createAnchorFake('anchor-fake', share))
    const r1 = await reg1.get('anchor-fake').create(base, { title: '第一张', idempotencyKey: 'KEY-A' }, ctx)
    try { reg1.dispose() } catch (e) {} // 注册表与第一个后端实例整体丢掉

    // 第二次：**全部进程内状态都是新的**（新注册表、新实例，实例里没有任何上一路留下的东西）
    const reg2 = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    reg2.register(createAnchorFake('anchor-fake', share))
    const r2 = await reg2.get('anchor-fake').create(base, { title: '第一张', idempotencyKey: 'KEY-A' }, ctx)
    try { reg2.dispose() } catch (e) {}

    await assert('同一个锚提交两次：返回的是同一个 key', r1.ok === true && r2.ok === true && r1.data.key === '01' && r2.data.key === '01', JSON.stringify({ r1, r2 }))
    await assert('同一个锚提交两次：总共只建出一张票（换掉全部内存状态之后仍然成立）', share.store.tickets.length === 1, '票数 ' + share.store.tickets.length)
    await assert('不带锚提交两次：仍然建出两张（既有行为不许被改坏）', await (async () => {
      const s2 = { id: 'anchor-fake', store: createTicketStore(), lookupWorks: true }
      const f = newAnchorFakeBackend(s2)
      const r3 = await f.create(base, { title: '没锚' }, ctx)
      const r4 = await f.create(base, { title: '没锚' }, ctx)
      return r3.data.key === '01' && r4.data.key === '02' && s2.store.tickets.length === 2
    })(), '不带锚的两次提交没有各建一张')

    // ✗ probe（反证的方向）：把回查那一步做坏 —— 改成「按调用方给的键记在实例自己的表里」（假幂等）。
    //   同一个实例里用两次它会看起来是幂等的；只要换个实例（进程重启模拟）就必须重复建票。
    //   这一段必须看得见这件事，否则第一段的判据就形同虚设。
    const broken = { id: 'anchor-broken', store: createTicketStore(), lookupWorks: false }
    const b1 = await newAnchorFakeBackend(broken).create(base, { title: 'x', idempotencyKey: 'KEY-A' }, ctx)
    const b2 = await newAnchorFakeBackend(broken).create(base, { title: 'x', idempotencyKey: 'KEY-A' }, ctx)
    await assert('✗ probe: 回查只在实例内存里查 → 换一个实例就重复建票（这正是本票要防的那一半）', broken.store.tickets.length === 2 && b1.data.key !== b2.data.key, '坏实例居然也复用了，检查器看不见「假幂等」：' + JSON.stringify({ b1, b2, tickets: broken.store.tickets.length }))
  }

  // ── 四、真实本地 Markdown 后端：锚落在票文件里、按锚复用 ──
  {
    const fx = makeMarkdownWorkspace()
    try {
      const key = 'md-2026.09.24-a1'
      const r1 = await markdownCreate(fx, { title: '第一张票', body: '正文在这里', idempotencyKey: key })
      const files1 = fx.ticketsOnDisk()
      const text1 = files1.length === 1 ? fx.readTicket(files1[0]) : ''
      const mtime1 = files1.length === 1 ? fx.readTicketMtime(files1[0]) : 0
      await assert('真实 markdown：第一次带锚建票成功', r1.ok === true && !!r1.data.key, JSON.stringify(r1).slice(0, 300))
      // 文件名由题意里的 slugify 生成，它只保留 a-z0-9 与连字符，所以中文标题的文件名部分是 untitled
      // （这是本仓库既有行为，与锚无关）。这里断言的是「盘上确实多了这一张」，不去碰文件名规则。
      await assert('真实 markdown：盘上多出一张票文件（编号 01）', files1.length === 1 && files1[0] === '01-untitled.md', JSON.stringify(files1))
      await assert('真实 markdown：把票文件直接读出来，锚就在文件里（回查读的是文件，不是内存）', idempotencyKeyOf(text1) === key, '文件开头是 ' + JSON.stringify(text1.slice(0, 80)))
      await assert('真实 markdown：锚是文件的第一行（手改正文的人看得见它）', text1.split('\n')[0] === anchorLineFor(key).trim(), JSON.stringify(text1.split('\n')[0]))

      // 第二次：全新实例（模拟进程重启），同一个锚
      const r2 = await markdownCreate(fx, { title: '第一张票', body: '正文在这里', idempotencyKey: key })
      const files2 = fx.ticketsOnDisk()
      const text2 = files2.length === 1 ? fx.readTicket(files2[0]) : ''
      const mtime2 = files2.length === 1 ? fx.readTicketMtime(files2[0]) : 0
      await assert('真实 markdown：第二次提交返回同一个 key', r2.ok === true && r2.data.key === r1.data.key, JSON.stringify({ k1: r1.data && r1.data.key, k2: r2.data && r2.data.key }))
      await assert('真实 markdown：第二次是「复用」而不是「新建」——盘上文件数不变', files2.length === 1 && files2[0] === files1[0], JSON.stringify(files2))
      await assert('真实 markdown：第二次连文件都没改写（修改时间没变）', mtime1 === mtime2 && text1 === text2, JSON.stringify({ mtime1, mtime2 }))

      // 不带锚的两次：既有行为不许被改坏
      const r3 = await markdownCreate(fx, { title: '没锚的一张' })
      const r4 = await markdownCreate(fx, { title: '没锚的一张' })
      await assert('真实 markdown：不带锚提交两次 → 建出两张（key 不同、盘上是两张）', fx.ticketsOnDisk().length === 3 && r3.data.key !== r4.data.key, JSON.stringify(fx.ticketsOnDisk()))

      // 键不合规：当场失败，绝不落盘
      const bad = await markdownCreate(fx, { title: '坏键的一张', idempotencyKey: '坏\n键' })
      await assert('真实 markdown：键里有换行 → 当场失败、盘上不多出文件', bad.ok === false && bad.error.kind === 'parse' && fx.ticketsOnDisk().length === 3, JSON.stringify(bad))
    } finally { fx.cleanup() }
  }

  // ── 五、真实本地 Markdown 后端 · 反证：把「锚」从票文件里拿掉，复用必须失效 ──
  {
    const fx = makeMarkdownWorkspace()
    try {
      const key = 'md-drop-anchor'
      const r1 = await markdownCreate(fx, { title: '被动手脚的票', idempotencyKey: key })
      const name = fx.ticketsOnDisk()[0]
      // 模拟「别人手改了这张票、把锚那一行删掉了」：回查只能靠票面，锚没了就该找不着。
      fx.writeTicket(name, fx.readTicket(name).split('\n').filter((l) => idempotencyKeyOf(l) === '').join('\n'))
      const r2 = await markdownCreate(fx, { title: '被动手脚的票', idempotencyKey: key })
      await assert('✗ probe: 把锚从票文件里删掉之后，同一个键再提交会另建一张（证明复用真的靠票面上的锚）', r1.ok === true && r2.ok === true && r2.data.key !== r1.data.key && fx.ticketsOnDisk().length === 2, JSON.stringify({ k1: r1.data && r1.data.key, k2: r2.data && r2.data.key, files: fx.ticketsOnDisk() }))
    } finally { fx.cleanup() }
  }

  // ── 六、真实 GitHub 后端模块：锚进正文；搜索没命中时靠「列出来逐张读正文」照样复用 ──
  {
    const gh = makeScriptedGh({ searchReady: false }) // 搜索索引还没建好：快路必然空手而归
    const ctx = remoteCtx(gh)
    const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    const d = reg.register(githubModule)
    const t = reg.get('github')
    const key = 'gh-2026.09.24-a1'
    const r1 = await t.create(GH_REPO, { title: '远端第一张', body: '正文', idempotencyKey: key }, ctx)
    await assert('真实 github：第一次带锚建票成功', r1.ok === true && !!r1.data.key, JSON.stringify(r1).slice(0, 300))
    await assert('真实 github：锚确实进了建票请求的正文里（第一行）', gh.created.length === 1 && gh.created[0].body.split('\n')[0] === anchorLineFor(key).trim(), JSON.stringify(gh.created.map((x) => String(x.body).slice(0, 60))))
    await assert('真实 github：建票前确实做了回查（搜索 + 列出最近更新的票两条路都走过）', gh.calls.some((c) => c.startsWith('search issues')) && gh.calls.some((c) => c.startsWith('issue list')), JSON.stringify(gh.calls).slice(0, 300))

    const r2 = await t.create(GH_REPO, { title: '远端第一张', body: '正文', idempotencyKey: key }, ctx)
    await assert('真实 github：搜索没搜到（索引滞后）时，第二次提交仍然复用同一张票', r2.ok === true && r2.data.key === r1.data.key, JSON.stringify({ k1: r1.data && r1.data.key, k2: r2.data && r2.data.key }))
    await assert('真实 github：第二次没有再多建一张（远端只有一张）', gh.created.length === 1, JSON.stringify(gh.created.map((x) => x.number)))
    // 搜索真建好了的那条路
    const gh3 = makeScriptedGh({ searchReady: true })
    const ctx3 = remoteCtx(gh3)
    const reg3 = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    const d3 = reg3.register(githubModule)
    const t3 = reg3.get('github')
    const a3 = await t3.create(GH_REPO, { title: '搜索路', idempotencyKey: 'gh-search-path' }, ctx3)
    const b3 = await t3.create(GH_REPO, { title: '搜索路', idempotencyKey: 'gh-search-path' }, ctx3)
    await assert('真实 github：搜索路命中时也复用同一张票', a3.ok === true && b3.ok === true && a3.data.key === b3.data.key && gh3.created.length === 1, JSON.stringify({ a: a3.data && a3.data.key, b: b3.data && b3.data.key, created: gh3.created.length }))
    d3.dispose()

    // 回查拿不准（两条路都没跑通）→ 如实失败，绝不建票
    const ghBad = makeScriptedGh({ searchReady: false, listFails: true, failOn: (l) => l.startsWith('search issues'), failMessage: '搜索接口报错（探针脚本）' })
    const ctxBad = remoteCtx(ghBad)
    const rBad = await t.create(GH_REPO, { title: '拿不准的一张', idempotencyKey: 'gh-uncertain' }, ctxBad)
    await assert('真实 github：两条回查路都没跑通 → 如实失败、一张票都不建', rBad.ok === false && KNOWN_KINDS.includes(rBad.error.kind) && /回查/.test(rBad.error.message) && ghBad.created.length === 0, JSON.stringify(rBad).slice(0, 300))

    // 幂等键当场检查
    const rBadKey = await t.create(GH_REPO, { title: '坏键', idempotencyKey: 'bad key with space' }, ctx)
    await assert('真实 github：键里有空格 → 当场失败（不许落进正文）', rBadKey.ok === false && rBadKey.error.kind === 'parse' && gh.created.length === 1, JSON.stringify(rBadKey).slice(0, 200))
    d.dispose()
  }

  // ── 七、真实 GitLab 后端模块：同一套判据 ──
  {
    const gl = makeScriptedGlab({ searchReady: false })
    const ctx = remoteCtx(gl)
    const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    const d = reg.register(gitlabBackend)
    const t = reg.get('gitlab')
    const key = 'gl-2026.09.24-a1'
    const r1 = await t.create(GL_REPO, { title: 'gitlab 第一张', body: '正文', idempotencyKey: key }, ctx)
    await assert('真实 gitlab：第一次带锚建票成功', r1.ok === true && !!r1.data.key, JSON.stringify(r1).slice(0, 300))
    await assert('真实 gitlab：锚确实进了 description 的第一行', gl.created.length === 1 && gl.created[0].description.split('\n')[0] === anchorLineFor(key).trim(), JSON.stringify(gl.created.map((x) => String(x.description).slice(0, 60))))
    const r2 = await t.create(GL_REPO, { title: 'gitlab 第一张', body: '正文', idempotencyKey: key }, ctx)
    await assert('真实 gitlab：搜索没搜到时，第二次提交靠「按创建时间倒序列出来逐张看」复用同一张票', r2.ok === true && r2.data.key === r1.data.key && gl.created.length === 1, JSON.stringify({ k1: r1.data && r1.data.key, k2: r2.data && r2.data.key, created: gl.created.length }))

    const gl3 = makeScriptedGlab({ searchReady: true })
    const ctx3 = remoteCtx(gl3)
    const reg3 = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    const d3 = reg3.register(gitlabBackend)
    const t3 = reg3.get('gitlab')
    const a3 = await t3.create(GL_REPO, { title: 'gitlab 搜索路', idempotencyKey: 'gl-search-path' }, ctx3)
    const b3 = await t3.create(GL_REPO, { title: 'gitlab 搜索路', idempotencyKey: 'gl-search-path' }, ctx3)
    await assert('真实 gitlab：搜索路命中时复用同一张票', a3.ok === true && b3.ok === true && a3.data.key === b3.data.key && gl3.created.length === 1, JSON.stringify({ a: a3.data && a3.data.key, b: b3.data && b3.data.key, created: gl3.created.length }))
    d3.dispose()

    const glBad = makeScriptedGlab({ searchReady: false, listFails: true })
    const ctxBad = remoteCtx(glBad)
    const rBad = await t.create(GL_REPO, { title: '拿不准的一张', idempotencyKey: 'gl-uncertain' }, ctxBad)
    await assert('真实 gitlab：两条回查路都没跑通 → 如实失败、一张票都不建', rBad.ok === false && KNOWN_KINDS.includes(rBad.error.kind) && glBad.created.length === 0, JSON.stringify(rBad).slice(0, 300))
    d.dispose()
  }

  // ── 八、这一段故意不判的东西（写下来免得以后有人以为已经守住了）──
  //   远端后端的「锚写下去了」这一步，判据是**脚本化命令行收到的请求内容**（见上面第六、七段）。
  //   真机上的 github 搜索索引延迟、GitLab 搜索服务对刚建好的票有没有延迟，这一段判不了 ——
  //   那是服务端行为，不是实现行为。实现里对这两处都留了退路（列出来逐张读票面）与如实失败那一档，
  //   但「真机上多长时间内一定搜得到」这句话没有任何自动检查能替它担保。

  return out
}

export default { name: 'idempotency', run }
