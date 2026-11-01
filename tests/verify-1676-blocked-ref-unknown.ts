/**
 * tests/verify-1676-blocked-ref-unknown.ts —— 阻塞目标读不到时，引用必须是「状态未知」，不得伪造 open（#1676）
 *
 * 现象：本地 Markdown 工作区里，一张票写着 `Blocked by: 99`，但 99 这张票文件不在（被删了、还没建、
 * 或者编号写错）。详情页顶栏两颗动作按钮因此永久置灰 —— 解析那层把「读不到目标」写成了
 * state:'open'，之后的宿主与界面就再也分不清「确实还开着」与「压根不知道」。
 *
 * 修法（维护者已拍板的 agent brief）：契约 IssueRef.state 改可选（缺省 = 状态未知），
 * markdown 解析与回填不再伪造 open，宿主把未知如实传成「不带 state」的节点，界面判据保持不动：
 * 未知按可点处理，只有明确读到 open 才置灰。
 *
 * 本门禁只走外部入口（markdown 适配器的 get/list/getDependencies、宿主 handleIssueDetail、
 * 界面 detailTopGate、deck 派生 deriveDeck），不抄实现：
 *  ① 目标票不存在：适配器 get/list/getDependencies 的引用都不带 state；
 *  ② 同一现场：宿主详情回包 blockedBy.nodes 不带 state，界面判据可点、不点名任何阻塞票；
 *  ③ 同一现场：deck 派生对读不到目标的边仍按 blocked（未知不等于可开工）；
 *  ④ 目标票补成 open：引用与宿主节点都是 OPEN，界面置灰并点名 99；
 *  ⑤ 目标票改成 done：引用与宿主节点都是 CLOSED，界面恢复可点。
 *
 * 修前 ①② 必红（引用与宿主节点都伪造 open，按钮被永久置灰），修后全绿。
 * 全程在系统临时目录里造工作区，不打真网、不碰真实工作区（用完即删）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1676-blocked-ref-unknown.ts
 * 门禁归属: src/tracker/contract/entities.ts
 * 门禁归属: src/shared/tracker/shape.ts
 * 门禁归属: src/tracker/rooms/markdown/parse.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-read.ts
 * 门禁归属: src/tracker/rooms/markdown/graph.ts
 * 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts
 * 门禁归属: src/client/kernel/detail-top-gate.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import { detailTopGate } from '../src/client/kernel/detail-top-gate.ts'
import { deriveDeck } from '../src/tracker/deck-derive.ts'

type Ctx = {
  platform: { path: typeof path.posix; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  opId: string
  events: unknown[]
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  isEnabled: (level: string) => boolean
  get: (name: string) => unknown
}

let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown) => {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (detail === undefined || ok ? '' : ' — ' + String(detail).slice(0, 300)))
  if (!ok) failed = true
}
/** 引用/节点上有没有 state 这一格：缺省与 undefined 都算「没有」；空串是另一种东西，也要抓出来。 */
const hasState = (x: any): boolean => x != null && Object.prototype.hasOwnProperty.call(x, 'state')

/** 与 tests/verify-1537-blocked-ref-title.ts 同一套适配器形状：path.posix + 真实文件系统读写。 */
function makeCtx(cwd: string): Ctx {
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1676',
    events: [],
    logEvent() {},
    isEnabled() { return true },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
}

const REPO = { backend: 'markdown', refId: '', name: '', url: '' }
const EFFORT = 'ticket-convention'
const OPTS = { effortId: EFFORT } as never

function writeTicket(dir: string, file: string, title: string, status: string, blockedBy?: string) {
  fs.mkdirSync(dir, { recursive: true })
  let text = '# ' + title + '\n\nStatus: ' + status + '\n'
  if (blockedBy) text += '\nBlocked by: ' + blockedBy + '\n'
  text += '\n## Body\n\n夹具里的票\n'
  fs.writeFileSync(path.join(dir, file), text, 'utf8')
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1676-unknown-'))
const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-'))
const unit = path.join(ws, '.scratch', EFFORT)
const issuesDir = path.join(unit, 'issues')
writeTicket(unit, 'map.md', '本组地图', 'ready-for-agent')
writeTicket(issuesDir, '01-blocked.md', '等一张读不到的票', 'ready-for-agent', '99')

const ctx = makeCtx(ws)
const be = createMarkdownBackend(ctx as never) as any

/** 宿主详情电话：只读会话直接转发到 markdown 适配器，不碰真实后端分发。 */
function makeHost() {
  const deps: any = {
    openSession: async function () {
      return {
        ok: true,
        backendId: 'markdown',
        budget: {},
        canWrite: false,
        repoRef: { backend: 'markdown', refId: 'ws', name: 'ws', url: '' },
        call: async function (fn: any) {
          const session = {
            get: async function (_repoRef: any, key: string) { return be.get(REPO as never, key, OPTS, ctx as never) },
          }
          return fn(session, { cwd: ws, caller: 'refresh' })
        },
      }
    },
    normCwd: async function (x: string) { return x },
    errText: function (e: any) { return String((e && e.message) || e) },
    execProc: async function () { throw new Error('详情读路径不应直调执行口') },
    setCache: function () {},
    getTrackerRegistry: async function () { return { describe: function () { return null } } },
    getPlatform: async function () { return {} },
    ctx: { get: function () { return undefined } },
    timer: { timeout: function () { return function () {} } },
    DEFAULT_CWD: '',
    isRateLimitError: function () { return false },
    getRepoKey: async function () { return null },
    fetchIssueDetail: async function () { throw new Error('读路径不应回退旧详情路') },
    fetchIssueIndex: async function () { throw new Error('读路径不应回退旧索引路') },
    issueIndexFromSnapshot: function () { return { ok: false } },
    logCtx: { fire: function () {} },
  }
  return createCommentThreads(deps)
}

async function adapterRefs(via: string): Promise<any[]> {
  if (via === 'get') {
    const got = await be.get(REPO as never, '01', OPTS, ctx as never) as any
    check(got && got.ok === true, 'get 01 成功', JSON.stringify(got && got.error))
    return got && got.ok && Array.isArray(got.data.blockedBy) ? got.data.blockedBy : []
  }
  if (via === 'list') {
    const listed = await be.list(REPO as never, OPTS, ctx as never) as any
    check(listed && listed.ok === true, 'list 成功', JSON.stringify(listed && listed.error))
    const row = (listed && listed.ok ? listed.data : []).find((it: any) => String(it.key) === '01')
    return row && Array.isArray(row.blockedBy) ? row.blockedBy : []
  }
  const dp = await be.getDependencies(REPO as never, '01', OPTS, ctx as never) as any
  check(dp && dp.ok === true, 'getDependencies 01 成功', JSON.stringify(dp && dp.error))
  return dp && dp.ok && Array.isArray(dp.data.blockedBy) ? dp.data.blockedBy : []
}

async function hostNodes(host: any): Promise<any[]> {
  const out = await host.handleIssueDetail({ number: 1, cwd: ws, effortId: EFFORT })
  check(out && out.ok === true, '宿主详情电话成功', JSON.stringify(out && out.error))
  const nodes = out && out.ok && out.issue && out.issue.blockedBy && Array.isArray(out.issue.blockedBy.nodes) ? out.issue.blockedBy.nodes : []
  return nodes
}

async function main() {
  const host = makeHost()

  console.log('== ① 目标票不存在：三条读路的引用都不带 state（不是 open） ==')
  for (const via of ['get', 'list', 'getDependencies']) {
    const refs = await adapterRefs(via)
    const ref = refs[0] || {}
    check(refs.length === 1 && String(ref.key) === '99', via + ' 里 99 这条引用还在（got ' + JSON.stringify(refs) + '）')
    check(!hasState(ref), via + ' 的 99 引用不带 state（读不到就是不知道）', JSON.stringify(ref))
  }

  console.log('== ② 同一现场：宿主节点不带 state，界面按钮保持可点 ==')
  const nodesA = await hostNodes(host)
  check(nodesA.length === 1 && Number(nodesA[0] && nodesA[0].number) === 99, '宿主回包里有 99 这个节点（got ' + JSON.stringify(nodesA) + '）')
  check(!hasState(nodesA[0] || {}), '宿主节点不带 state（按未知传下去）', JSON.stringify(nodesA[0]))
  const gateA = detailTopGate({ state: 'open' }, nodesA)
  check(gateA.clickable === true && gateA.reason === 'none' && gateA.blockedNumbers.length === 0,
    '界面判据可点、不点名任何阻塞票（未知不等于没做完）', JSON.stringify(gateA))

  console.log('== ③ 同一现场：deck 派生对读不到目标的边仍按 blocked（未知不等于可开工） ==')
  // 就在目标票仍不存在时取一次真实回包：引用已由 ① 证明不带 state，用它派生 deck。
  const issueUnknown = (await be.get(REPO as never, '01', OPTS, ctx as never) as any).data
  const deck = deriveDeck({ maps: [], issues: [issueUnknown] } as never) as any
  check(deck && deck.stats && deck.stats.total === 1, 'derived deck 统计到这张票', JSON.stringify(deck && deck.stats))
  check(deck && deck.stats && deck.stats.blocked === 1 && deck.stats.frontier === 0,
    '读不到目标的票仍算 blocked、不当成可开工', JSON.stringify(deck && deck.stats))

  console.log('== ④ 目标票补成 open：引用与宿主节点都是 OPEN，界面置灰并点名 99 ==')
  writeTicket(issuesDir, '99-target.md', '目标99', 'ready-for-agent')
  for (const via of ['get', 'list', 'getDependencies']) {
    const refs = await adapterRefs(via)
    const ref = refs[0] || {}
    check(String(ref.state) === 'open', via + ' 的 99 引用 state 是 open（got ' + JSON.stringify(ref.state) + '）', JSON.stringify(ref))
  }
  const nodesB = await hostNodes(host)
  check(String((nodesB[0] || {}).state) === 'OPEN', '宿主节点 99 是 OPEN（got ' + JSON.stringify((nodesB[0] || {}).state) + '）', JSON.stringify(nodesB[0]))
  const gateB = detailTopGate({ state: 'open' }, nodesB)
  check(gateB.clickable === false && gateB.reason === 'blocked' && gateB.blockedNumbers.join(',') === '99',
    '界面判据置灰并点名 99', JSON.stringify(gateB))

  console.log('== ⑤ 目标票改成 done：引用与宿主节点都是 CLOSED，界面恢复可点 ==')
  writeTicket(issuesDir, '99-target.md', '目标99', 'done')
  const refsC = await adapterRefs('get')
  check(String((refsC[0] || {}).state) === 'closed', 'get 的 99 引用 state 是 closed', JSON.stringify(refsC[0]))
  const nodesC = await hostNodes(host)
  check(String((nodesC[0] || {}).state) === 'CLOSED', '宿主节点 99 是 CLOSED', JSON.stringify(nodesC[0]))
  const gateC = detailTopGate({ state: 'open' }, nodesC)
  check(gateC.clickable === true && gateC.reason === 'none', '界面判据恢复可点', JSON.stringify(gateC))

  fs.rmSync(tmpRoot, { recursive: true, force: true })
  if (failed) { console.log('\n门禁结果：FAIL（#1676 未修复：引用仍在伪造 open）'); process.exit(1) }
  console.log('\n门禁结果：PASS（' + total + ' 条断言，#1676 已修复）')
}

await main()
