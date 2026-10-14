import { createOutboundControl } from '../src/host/platform/outbound-control.ts'
// tests/verify-1053-issue-write.ts —— #1053 写路径专属门禁（不联网）
//
// 测什么：GitHub 房间三条写路径的常驻结论线真发得出来、字段就是各自登记的那几个，
//   而且「走了哪条路、为什么是这个结论」都如实：
//     · 票写 `issue.write`（附录 1.4 节 #104）：
//       - 真新建记 `fresh`，且 route 是 rest（建票走 gh api）、written 是 1；
//       - 幂等锚命中复用记 `reuse`，一条写命令都不发（written 0、route none）；
//       - 差集为空、一处没改的贴标签与改认领记 `noop`，route 还是 none；
//       - 票建成了但补挂标签没挂上记 `partial`，failed 记 1；
//       - 写命令被上游挡下记 `fail:<档位>`，ok 是 false；
//       - 评论主路走 rest、回落走 cli，两条路都算「改过已有票」（edited）。
//     · 标签定义改写 `labelDefs.write`（#105）：打算动几个、真发几条、几条没改上，
//       结论落在 edited / partial / noop，一条写命令都没发时 route 是 none。
//     · 开仓发布 `repo.init`（#106）：走的是新建仓库还是推到已有远程、这一趟一共起了几条命令、卡住了没有。
//   还守一条隐私：票面标题、评论正文、仓库名、命令原文一个字都不许出现在结论行里。
//
// 桩是一台「只认命令行的假 gh / 假 git」：读类（搜索、列票、GraphQL 单票、`gh issue view`）按场景给答案，
//   写类按开关成或败；每条命令都记下来 —— 断言既能看「发了几条写命令」，也能看「走的哪条路」。
//
// 用法：node --import ./scripts/ts-hook.mjs tests/verify-1053-issue-write.ts

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

let failed = false
let total = 0
function check(ok: boolean, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const REPO = { backend: 'github', refId: 'o/r', name: 'r', url: '' }

/** GraphQL 单票回包的节点形状（`getIssue` 主路读的就是这一格）。 */
function baseIssue(over: Record<string, unknown> = {}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    number: 5,
    title: '票面标题',
    state: 'OPEN',
    body: '正文',
    url: 'https://example.invalid/o/r/issues/5',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    closedAt: null,
    labels: { nodes: [] },
    assignees: { nodes: [] },
  }
  for (const k of Object.keys(over)) node[k] = over[k]
  return node
}

/** `gh issue view --json number,title,state,body,url,updatedAt,createdAt,closedAt,labels,assignees` 的回包形状。 */
function viewOf(node: Record<string, unknown>): Record<string, unknown> {
  const nodes = (v: unknown): any[] => ((v && (v as any).nodes) || []) as any[]
  return {
    number: node.number,
    title: node.title,
    state: String(node.state || 'OPEN').toUpperCase(),
    body: node.body,
    url: node.url,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    closedAt: node.closedAt,
    labels: nodes(node.labels).map((l: any) => ({ name: l.name, color: l.color || '#111111' })),
    assignees: nodes(node.assignees).map((a: any) => ({ login: a.login })),
  }
}

interface StubOpts {
  searchRows?: unknown[]
  listRows?: unknown[]
  gqlIssue?: Record<string, unknown>
  failCreate?: boolean
  failCommentApi?: boolean
  failLabel?: boolean
  /** 批量改标签颜色时，名字在这张表里的那几条改色命令按失败回（用来造 partial）。 */
  failLabelEditFor?: string[]
}

/** 写命令的判据：真往远端送出一次写的那几条命令行。 */
const isWrite = (line: string): boolean =>
  /^api repos\/o\/r\/issues --method POST/.test(line) ||
  /^api repos\/o\/r\/issues\/\d+\/comments --method POST/.test(line) ||
  /^api repos\/o\/r\/issues\/\d+\/sub_issues --method POST/.test(line) ||
  /^label edit /.test(line) ||
  /^issue (comment|close|reopen|edit) /.test(line)

function makeStub(o: StubOpts) {
  const calls: string[] = []
  const rawCalls: string[][] = []
  const exec = async (_cmd: string, args: string[]) => {
    const line = args.join(' ')
    calls.push(line)
    rawCalls.push(args)
    // 读类①：带锚建票的快路（搜索接口）
    if (line.startsWith('search issues ')) return { code: 0, stdout: JSON.stringify(o.searchRows || []), stderr: '' }
    // 读类②：带锚建票的慢路（列出最近更新的开票行）
    if (line.startsWith('issue list ')) return { code: 0, stdout: JSON.stringify(o.listRows || []), stderr: '' }
    // 读类③：单票（`getIssue` 主路走 GraphQL）
    if (line.startsWith('api graphql ')) return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: o.gqlIssue || baseIssue() } } }), stderr: '' }
    // 读类④：`gh issue view --json …`（关闭、重开、改票之后读回来的那一步）
    if (line.startsWith('issue view ')) return { code: 0, stdout: JSON.stringify(viewOf(o.gqlIssue || baseIssue())), stderr: '' }
    // 写类①：建票（REST）
    if (/^api repos\/o\/r\/issues --method POST/.test(line)) {
      if (o.failCreate) return { code: 1, stdout: '', stderr: 'HTTP 500: Internal Server Error' }
      return { code: 0, stdout: JSON.stringify(baseIssue({ number: 5 })), stderr: '' }
    }
    // 写类②：评论主路（REST）
    if (/^api repos\/o\/r\/issues\/\d+\/comments --method POST/.test(line)) {
      if (o.failCommentApi) return { code: 1, stdout: '', stderr: 'HTTP 500: Internal Server Error' }
      return { code: 0, stdout: JSON.stringify({ id: 1, body: 'x', user: { login: 'u' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }), stderr: '' }
    }
    // 写类③：评论回落（gh issue comment）
    if (line.startsWith('issue comment ')) return { code: 0, stdout: '', stderr: '' }
    // 写类④：关闭、重开、改票、贴标签、改认领（都是 gh issue 子命令）
    if (line.startsWith('issue close ') || line.startsWith('issue reopen ') || line.startsWith('issue edit ')) {
      const labelFlag = /--(add|remove)-label /.test(line)
      if (o.failLabel && labelFlag) return { code: 1, stdout: '', stderr: 'HTTP 403: Forbidden' }
      return { code: 0, stdout: '', stderr: '' }
    }
    // 写类⑤：挂父边（原生子票接口）—— 本门禁不测边，照成功回
    if (/^api repos\/o\/r\/issues\/\d+\/sub_issues --method POST/.test(line)) return { code: 0, stdout: '{}', stderr: '' }
    // 写类⑥：批量改标签颜色（gh label edit <名字> --repo <仓库> --color <颜色>）
    if (line.startsWith('label edit ')) {
      const name = line.split(' ')[2]
      if (o.failLabelEditFor && o.failLabelEditFor.includes(name)) return { code: 1, stdout: '', stderr: 'HTTP 422: Validation Failed' }
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '{}', stderr: '' }
  }
  return { exec, calls, rawCalls, writes: (): string[] => calls.filter(isWrite) }
}
type Stub = ReturnType<typeof makeStub>

function makeCtx(stub: Stub, log: any[]) {
  return {
    cwd: '/ws/demo',
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (n: string) => (n === 'gh' ? '/usr/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd: string, args: string[], opts: unknown) => stub.exec(cmd, args, opts),
    isEnabled: (_level: string) => true,
    logEvent: (level: string, event: string, fields: Record<string, unknown>) => { log.push({ level, event, fields }) },
    memo: { roster: { complete: true, byKey: new Map() }, dirty: new Set<string>() },
  }
}

const linesOf = (log: any[], event: string): any[] => log.filter((l) => l.event === event)
const byKind = (log: any[], kind: string): any => {
  const a = linesOf(log, 'issue.write').filter((l) => l.fields && l.fields.kind === kind)
  return a[a.length - 1]
}
const keysOf = (f: any): string => Object.keys(f || {}).sort().join(',')
const THE_SEVEN = 'failed,kind,latencyMs,ok,reason,route,written'

/** 三条结论线各取最后一行：断言只看这一趟的账。 */
const labelDefsOf = (log: any[]): any => {
  const a = linesOf(log, 'labelDefs.write')
  return a[a.length - 1]
}
const repoInitOf = (log: any[]): any => {
  const a = linesOf(log, 'repo.init')
  return a[a.length - 1]
}

/** 开仓那趟的桩：git 与 gh 两条命令行都按命令行回答；「origin 已存在」与两条失败路按开关给。 */
function makeInitStub(o: { origin?: string; failAuth?: boolean } = {}) {
  const calls: string[] = []
  const exec = async (cmd: string, args: string[]) => {
    const line = cmd + ' ' + args.join(' ')
    calls.push(line)
    if (/(^|[\\/])git(\.exe)?$/.test(cmd)) {
      const a = args.join(' ')
      if (a.includes('rev-parse --is-inside-work-tree')) return { code: 0, stdout: 'true\n', stderr: '' }
      if (a === 'remote get-url origin') {
        if (o.origin) return { code: 0, stdout: o.origin + '\n', stderr: '' }
        return { code: 1, stdout: '', stderr: "error: No such remote 'origin'" }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args[0] === 'auth' && args[1] === 'status') {
      if (o.failAuth) return { code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts' }
      return { code: 0, stdout: 'Logged in to github.com as alice\n', stderr: '' }
    }
    if (args[0] === 'api' && args[1] === 'user') return { code: 0, stdout: 'alice\n', stderr: '' }
    if (args[0] === 'repo' && args[1] === 'create') return { code: 0, stdout: 'https://github.com/alice/demo\n', stderr: '' }
    return { code: 0, stdout: '{}', stderr: '' }
  }
  return { exec, calls }
}

function makeInitCtx(stub: { exec: (cmd: string, args: string[], opts?: unknown) => Promise<unknown> }, log: any[]) {
  return {
    cwd: '/ws/demo',
    outbound: createOutboundControl(),
    platform: {
      resolveExecutable: async (n: string) => (n === 'gh' ? '/usr/bin/gh' : n === 'git' ? '/usr/bin/git' : null),
      path: path.posix,
      env: { get: () => undefined },
    },
    exec: async (cmd: string, args: string[], opts: unknown) => stub.exec(cmd, args, opts),
    isEnabled: (_level: string) => true,
    logEvent: (level: string, event: string, fields: Record<string, unknown>) => { log.push({ level, event, fields }) },
    memo: { roster: { complete: true, byKey: new Map() }, dirty: new Set<string>() },
  }
}

/** 一趟写：状态与上下文都按这一趟新造，断言只看这一趟的账。 */
function fresh(o: StubOpts) {
  const log: any[] = []
  const stub = makeStub(o)
  const ctx = makeCtx(stub, log)
  return { stub, ctx, log }
}

async function main() {
  console.log('#1053 写路径门禁：issue.write 真发得出来、字段与「走了哪条路」如实（不联网，桩照真机形状）')
  const issuesWrite = await imp('src/tracker/rooms/github/issues-write.ts')
  const comments = await imp('src/tracker/rooms/github/comments.ts')
  const labels = await imp('src/tracker/rooms/github/labels.ts')
  const labelColorsOps = await imp('src/tracker/rooms/github/label-colors-ops.ts')
  const initProjectMod = await imp('src/tracker/rooms/github/init-project.ts')

  // ── S1 不带锚建票：真新建 ──
  {
    const { stub, ctx, log } = fresh({})
    const r = await issuesWrite.createIssue(REPO, { title: '第一张' }, ctx)
    check(r.ok === true, 'S1-1 建票成功（实得 ok=' + r.ok + ' ' + String((r.error && r.error.message) || '') + '）')
    const w = byKind(log, 'create')
    check(!!w, 'S1-2 发出了一条 issue.write（kind=create）')
    check(
      !!w && w.fields.route === 'rest' && w.fields.ok === true && w.fields.written === 1 && w.fields.failed === 0 && w.fields.reason === 'fresh',
      'S1-3 结论是「真新建、走 gh api、发出一条写命令、没有补挂失败」（' + JSON.stringify(w && w.fields) + '）',
    )
    check(keysOf(w && w.fields) === THE_SEVEN, 'S1-4 字段就是登记的那七个（实得 ' + keysOf(w && w.fields) + '）')
    check(w && w.level === 'info', 'S1-5 级别是信息级（常驻：不开调试开关也记）')
    check(stub.writes().length === 1, 'S1-6 桩上真只发出一条写命令（实发 ' + stub.writes().length + '）')
    check(linesOf(log, 'issue.write').length === 1, 'S1-7 一趟只发一行（实发 ' + linesOf(log, 'issue.write').length + ' 行）')
    check(JSON.stringify(w && w.fields).includes('第一张') === false, 'S1-8 票面标题一个字都没进结论行')
  }

  // ── S2 带锚建票，两条回查路都没命中：照样真新建（两条路都走过） ──
  {
    const { stub, ctx, log } = fresh({ searchRows: [], listRows: [] })
    const r = await issuesWrite.createIssue(REPO, { title: '第二张', idempotencyKey: 'K1' }, ctx)
    check(r.ok === true, 'S2-1 建票成功（实得 ok=' + r.ok + '）')
    check(stub.calls.some((l) => l.startsWith('search issues ')), 'S2-2 快路（搜索接口）走过了')
    check(stub.calls.some((l) => l.startsWith('issue list ')), 'S2-3 慢路（列最近更新的票）走过了')
    const w = byKind(log, 'create')
    check(!!w && w.fields.reason === 'fresh' && w.fields.written === 1, 'S2-4 回查没命中就是真新建（' + JSON.stringify(w && w.fields) + '）')
    // 顺手把锚那一行的真实写法打出来：S3 用的是同一种写法，写错了这里就能看见。
    const create = stub.rawCalls.find((a) => a.join(' ').startsWith('api repos/o/r/issues --method POST'))
    const bodyArg = (create || []).find((a) => a.startsWith('body=')) || ''
    console.log('  ···· 建票正文第一行（锚的真实写法）：' + JSON.stringify(bodyArg.split('\n')[0].slice(0, 80)))
  }

  // ── S3 幂等锚命中：复用已有一张，一条写命令都不发 ──
  {
    const now = new Date().toISOString()
    const rows = [{ number: 173, body: '<!-- DSH-IDEMPOTENCY-KEY: K1 -->\n正文', state: 'open', createdAt: now, updatedAt: now }]
    const { stub, ctx, log } = fresh({ searchRows: rows })
    const r = await issuesWrite.createIssue(REPO, { title: '第三张', idempotencyKey: 'K1' }, ctx)
    check(r.ok === true && r.data && String(r.data.key) === '173', 'S3-1 命中已有一张、把它交回去（实得 ' + JSON.stringify(r.data && r.data.key) + '）')
    const w = byKind(log, 'create')
    check(!!w && w.fields.reason === 'reuse' && w.fields.written === 0 && w.fields.route === 'none', 'S3-2 结论是「复用、一条都没发」（' + JSON.stringify(w && w.fields) + '）')
    check(stub.writes().length === 0, 'S3-3 桩上确实一条写命令都没发（实发 ' + stub.writes().length + '）')
    check(keysOf(w && w.fields) === THE_SEVEN, 'S3-4 复用这一趟字段也是那七个')
  }

  // ── S4 建票被上游挡下：ok 是 false、reason 是 fail:档位，但那条命令确实发出去了 ──
  {
    const { ctx, log } = fresh({ failCreate: true })
    const r = await issuesWrite.createIssue(REPO, { title: '第四张' }, ctx)
    check(r.ok === false, 'S4-1 该失败就失败（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'create')
    check(
      !!w && w.fields.ok === false && w.fields.written === 1 && String(w.fields.reason).startsWith('fail:'),
      'S4-2 结论记「发出去了但没成」（' + JSON.stringify(w && w.fields) + '）',
    )
    check(JSON.stringify(w && w.fields.reason).includes('HTTP') === false, 'S4-3 上游报错原文不进结论行')
  }

  // ── S5 标签补挂失败：票照样建成，结论记 partial、failed 记 1 ──
  {
    const gql = baseIssue({ labels: { nodes: [] } })
    const { ctx, log } = fresh({ gqlIssue: gql, failLabel: true })
    const r = await issuesWrite.createIssue(REPO, { title: '第五张', labels: ['bug'] }, ctx)
    check(r.ok === true, 'S5-1 补挂标签没挂上，票照样建成（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'create')
    check(!!w && w.fields.reason === 'partial' && w.fields.failed === 1, 'S5-2 结论记 partial、补挂失败 1 步（' + JSON.stringify(w && w.fields) + '）')
    check(!!w && w.fields.ok === true && w.fields.written >= 1, 'S5-3 建票那一步本身是成的')
    const lw = byKind(log, 'setLabels')
    check(!!lw && lw.fields.ok === false, 'S5-4 补挂那一趟自己也有结论行，且如实记失败（' + JSON.stringify(lw && lw.fields) + '）')
  }

  // ── S6 贴标签：差集为空记 noop、有增有撤记 edited ──
  {
    const { stub, ctx, log } = fresh({ gqlIssue: baseIssue({ labels: { nodes: [{ name: 'a', color: '#111111' }] } }) })
    const r = await labels.setLabels(REPO, '5', [{ name: 'a' }], {}, ctx)
    check(r.ok === true, 'S6-1 目标就是现状时照样回成功（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'setLabels')
    check(!!w && w.fields.reason === 'noop' && w.fields.written === 0 && w.fields.route === 'none', 'S6-2 一处没改就是 noop、route none（' + JSON.stringify(w && w.fields) + '）')
    check(stub.writes().length === 0, 'S6-3 桩上一条写命令都没发（实发 ' + stub.writes().length + '）')
  }
  {
    const { stub, ctx, log } = fresh({ gqlIssue: baseIssue({ labels: { nodes: [{ name: 'a', color: '#111111' }, { name: 'c', color: '#222222' }] } }) })
    const r = await labels.setLabels(REPO, '5', [{ name: 'a' }, { name: 'b' }], {}, ctx)
    check(r.ok === true, 'S6-4 有增有撤时成功（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'setLabels')
    check(!!w && w.fields.reason === 'edited' && w.fields.written === 2 && w.fields.route === 'cli', 'S6-5 加了 b、撤了 c 记 edited、两条写命令、走 cli（' + JSON.stringify(w && w.fields) + '）')
    check(stub.writes().length === 2, 'S6-6 桩上真发出两条（实发 ' + stub.writes().length + '：' + stub.writes().join(' | ') + '）')
  }

  // ── S7 改认领：差集为空记 noop ──
  {
    const { stub, ctx, log } = fresh({ gqlIssue: baseIssue({ assignees: { nodes: [{ login: 'u' }] } }) })
    const r = await issuesWrite.setAssignees(REPO, '5', [{ login: 'u' }], {}, ctx)
    check(r.ok === true, 'S7-1 目标就是现状时照样回成功（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'setAssignees')
    check(!!w && w.fields.reason === 'noop' && w.fields.written === 0 && w.fields.route === 'none', 'S7-2 一处没改就是 noop、route none（' + JSON.stringify(w && w.fields) + '）')
    check(stub.writes().length === 0, 'S7-3 桩上一条写命令都没发（实发 ' + stub.writes().length + '）')
  }

  // ── S8 关闭一张票：走 gh 子命令、发出去了、改的是已有一张 ──
  {
    const { stub, ctx, log } = fresh({ gqlIssue: baseIssue({ state: 'CLOSED' }) })
    const r = await issuesWrite.closeIssue(REPO, '5', {}, ctx)
    check(r.ok === true, 'S8-1 关闭成功（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'close')
    check(!!w && w.fields.route === 'cli' && w.fields.written === 1 && w.fields.reason === 'edited' && w.fields.ok === true, 'S8-2 结论记「走 cli、发出一条、改了已有票」（' + JSON.stringify(w && w.fields) + '）')
    check(stub.writes().join(',') === 'issue close 5 --repo o/r', 'S8-3 真发出去的就是那条关闭命令（' + stub.writes().join(' | ') + '）')
  }

  // ── S9 评论：主路走 rest；主路失败回落 gh 子命令，两条路都算「改过已有票」 ──
  {
    const { stub, ctx, log } = fresh({})
    const r = await comments.addComment(REPO, '5', '一句话', ctx)
    check(r.ok === true, 'S9-1 评论成功（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'comment')
    check(!!w && w.fields.route === 'rest' && w.fields.written === 1 && w.fields.reason === 'edited', 'S9-2 主路记 rest、一条写命令（' + JSON.stringify(w && w.fields) + '）')
    check(JSON.stringify(w && w.fields).includes('一句话') === false, 'S9-3 评论正文一个字都没进结论行')
    check(stub.writes().length === 1, 'S9-4 主路成了就不再回落（实发 ' + stub.writes().length + '）')
  }
  {
    const { stub, ctx, log } = fresh({ failCommentApi: true })
    const r = await comments.addComment(REPO, '5', '一句话', ctx)
    check(r.ok === true, 'S9-5 主路失败后回落成功（实得 ok=' + r.ok + '）')
    const w = byKind(log, 'comment')
    check(!!w && w.fields.route === 'cli' && w.fields.written === 2 && w.fields.reason === 'edited' && w.fields.ok === true, 'S9-6 回落那趟记 cli、两条写命令、仍算改过（' + JSON.stringify(w && w.fields) + '）')
    check(stub.writes().length === 2, 'S9-7 桩上两条都发了（实发 ' + stub.writes().length + '：' + stub.writes().join(' | ') + '）')
  }

  // ── S10 批量改标签颜色：结论线 labelDefs.write（#105）——
  //    「打算动几个、真发几条、几条没改上」是这一族唯一的结论线，三档都要走一遍。
  {
    const { ctx, log } = fresh({})
    const r = await labelColorsOps.setLabelColors(REPO, [], ctx)
    check(r.ok === true, 'S10-1 一条都不改时照样回成功（实得 ok=' + r.ok + '）')
    const w = labelDefsOf(log)
    check(!!w && w.fields.planned === 0 && w.fields.written === 0 && w.fields.reason === 'noop', 'S10-2 打算动 0 个、一条没发就是 noop（' + JSON.stringify(w && w.fields) + '）')
    check(keysOf(w && w.fields) === 'failed,latencyMs,ok,planned,reason,written', 'S10-3 字段就是登记的那六个（实得 ' + keysOf(w && w.fields) + '）')
  }
  {
    const { stub, ctx, log } = fresh({})
    const r = await labelColorsOps.setLabelColors(REPO, [{ name: 'a', color: '9d7cd8' }, { name: 'b', color: '111111' }], ctx)
    check(r.ok === true && !!r.data && r.data.applied.length === 2 && r.data.failed.length === 0, 'S10-4 两个都改上了（实得 ok=' + r.ok + '）')
    const w = labelDefsOf(log)
    check(!!w && w.fields.planned === 2 && w.fields.written === 2 && w.fields.failed === 0 && w.fields.reason === 'edited', 'S10-5 打算 2 个、发了 2 条、没失败就是 edited（' + JSON.stringify(w && w.fields) + '）')
    check(stub.writes().length === 2, 'S10-6 桩上真发出两条改色命令（实发 ' + stub.writes().length + '）')
    check(JSON.stringify(w && w.fields).includes('9d7cd8') === false, 'S10-7 颜色值与标签名都不进结论行')
  }
  {
    const { ctx, log } = fresh({ failLabelEditFor: ['b'] })
    const r = await labelColorsOps.setLabelColors(REPO, [{ name: 'a', color: '9d7cd8' }, { name: 'b', color: '111111' }], ctx)
    check(r.ok === true && !!r.data && r.data.applied.length === 1 && r.data.failed.length === 1, 'S10-8 一条成一条败、两边都记账')
    const w = labelDefsOf(log)
    check(!!w && w.fields.written === 2 && w.fields.failed === 1 && w.fields.reason === 'partial', 'S10-9 有改上也有没改上的记 partial（' + JSON.stringify(w && w.fields) + '）')
  }

  // ── S11 开仓发布：结论线 repo.init（#106），走「新建仓库并推上去」那条路 ──
  {
    const log: any[] = []
    const stub = makeInitStub({})
    const ctx = makeInitCtx(stub, log)
    const r = await initProjectMod.initProject({ cwd: '/ws/demo' }, { name: 'demo', visibility: 'private' }, ctx)
    check(r.ok === true && !!r.data && r.data.refId === 'alice/demo', 'S11-1 开仓成功、仓库身份是 alice/demo（实得 ' + JSON.stringify(r.ok ? r.data.refId : r.error) + '）')
    const w = repoInitOf(log)
    check(!!w && w.fields.route === 'created' && w.fields.ok === true && w.fields.reason === 'done', 'S11-2 结论记「走新建仓库那条路、成了」（' + JSON.stringify(w && w.fields) + '）')
    check(keysOf(w && w.fields) === 'latencyMs,ok,reason,route,steps', 'S11-3 字段就是登记的那五个（实得 ' + keysOf(w && w.fields) + '）')
    check(!!w && typeof w.fields.steps === 'number' && w.fields.steps >= 4, 'S11-4 这一趟起了几条命令如实记（实得 steps=' + (w && w.fields.steps) + '）')
    check(stub.calls.some((l) => l.includes('repo create demo --private --source=. --push')), 'S11-5 桩上真发出了「建仓并推上去」那条命令')
    check(JSON.stringify(w && w.fields).includes('demo') === false, 'S11-6 仓库名不进结论行')
  }

  // ── S12 开仓发布：origin 已存在 → 走「推到已有远程」那条路 ──
  {
    const log: any[] = []
    const stub = makeInitStub({ origin: 'https://github.com/alice/demo.git' })
    const ctx = makeInitCtx(stub, log)
    const r = await initProjectMod.initProject({ cwd: '/ws/demo' }, { name: 'demo', visibility: 'private' }, ctx)
    check(r.ok === true, 'S12-1 开仓成功（实得 ok=' + r.ok + '）')
    const w = repoInitOf(log)
    check(!!w && w.fields.route === 'existing', 'S12-2 结论记「推到已有远程」（' + JSON.stringify(w && w.fields) + '）')
    check(
      stub.calls.some((l) => l.includes(' remote set-url origin ')) && stub.calls.some((l) => l.includes(' push -u origin HEAD')),
      'S12-3 桩上真走了 set-url 与 push 两步（' + stub.calls.filter((l) => l.includes('push') || l.includes('set-url')).join(' | ') + '）',
    )
  }

  // ── S13 开仓发布：前置没过（没登录）→ 早停也留一行结论 ──
  {
    const log: any[] = []
    const stub = makeInitStub({ failAuth: true })
    const ctx = makeInitCtx(stub, log)
    const r = await initProjectMod.initProject({ cwd: '/ws/demo' }, { name: 'demo', visibility: 'private' }, ctx)
    check(r.ok === false, 'S13-1 没登录就该失败（实得 ok=' + r.ok + '）')
    const w = repoInitOf(log)
    check(!!w && w.fields.ok === false && String(w.fields.reason).startsWith('fail:') && w.fields.route === 'none', 'S13-2 早停照样留一行结论、走到哪一步都记着（' + JSON.stringify(w && w.fields) + '）')
    check(!!w && w.fields.steps >= 1, 'S13-3 停在 auth 那一条上也如实记了步数（实得 steps=' + (w && w.fields.steps) + '）')
  }

  console.log(failed ? '\n存在失败 — verify-1053-issue-write 未通过' : '\n全部通过 — 写路径结论线门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main()
