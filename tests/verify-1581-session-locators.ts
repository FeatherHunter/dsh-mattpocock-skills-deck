/**
 * tests/verify-1581-session-locators.ts —— 本地 Markdown 工作区的详情读路径必须拿到仓库身份（#1581）。
 *
 * 病根：详情 / 评论读路径改经会话取数（#1444 / #1445）之后，会话装配口
 * （src/tracker/session/open-tracker.ts）把两条同步定位口 describe / issueAddress 只从「注册实例」上取；
 * 而本地 Markdown 后端按契约只把这两条写在模块对象上（见 src/tracker/rooms/markdown/index.ts 的成员集合注释）。
 * 实例上没有这两个方法，session.describe 调用当场抛 TypeError，被 session-opener 的 try/catch 吞成
 * 「没拿到身份」，详情页就报「无法解析目标仓库（refId missing）」——#1581 截图里的红条与「还没拿到」。
 *
 * 本门禁钉住（用真实 markdown 模块 + 真实注册表 + 真实开会话，统一判定只给 backendId、不带仓库身份）：
 *   ① 统一判定在这份工作区上给出 markdown，且 ref 是空（workspace.yaml 里人选过后端的现场口径）；
 *   ② 开会话成功，opened.repoRef.refId 就是工作区目录，不再是 null；
 *   ③ 会话上的 describe 能拿到同一份身份、issueAddress 叫得到（不再把 TypeError 吞成“没身份”）；
 *   ④ 详情电话能读回地图容器与普通票的正文，不再回 not-found「refId missing」；
 *   ⑤ 评论读电话走同一道身份闸，也能通过。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1581-session-locators.ts
 *
 * 门禁归属: src/tracker/session/open-tracker.ts
 * 门禁归属: src/refresh/rooms/host/session-opener.ts
 * 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts
 */
import fsPromises from 'node:fs/promises'
import nodeOs from 'node:os'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../src/tracker/registry/core.ts'
import { loadBuiltinBackendModules } from '../src/tracker/registry/builtins.ts'
import { createSessionOpener } from '../src/refresh/rooms/host/session-opener.ts'
import { createSessionDecisionResolver } from '../src/refresh/rooms/host/session-decision.ts'
import { decideBackend } from '../src/tracker/detection/backendDecision.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const MAP_TITLE = '本地票务约定 v1（第一性原理重建）'
const CHILD_TITLE = '现状事实清单：本地票面格式与工具实际行为'

/** 真实现场要一整套平台能力：房间读文件、写文件都从这里拿，测试里直接用 Node 的 fs。 */
function makePlatformLike(workspace: string): any {
  const fsLike = {
    resolve: async (p: unknown, opts?: { cwd?: string }) => nodePath.resolve((opts && opts.cwd) || workspace, String(p)),
    readText: async (target: unknown) => fsPromises.readFile(String(target), 'utf8'),
    lstat: async (p: unknown) => fsPromises.lstat(String(p)),
    stat: async (p: unknown) => fsPromises.stat(String(p)),
    access: async (p: unknown) => { await fsPromises.access(String(p)); return true },
    listDir: async (p: unknown) => fsPromises.readdir(String(p)),
    readdir: async (p: unknown) => fsPromises.readdir(String(p)),
    readFile: async (p: unknown, enc?: string) => fsPromises.readFile(String(p), (enc as BufferEncoding) || 'utf8'),
  }
  const exec = async (cmd: unknown, args: unknown, opts?: { cwd?: string }) => ({
    ok: false, code: 1, text: 'gate: exec disabled', stdout: '', stderr: 'gate: exec disabled',
    cwd: (opts && opts.cwd) || workspace, cmd: String(cmd), args: args,
  })
  const timers = { setTimeout, clearTimeout, setInterval, clearInterval }
  return {
    fsLike,
    platform: { path: nodePath, fs: fsLike, os: nodeOs },
    exec,
    timers,
  }
}

/** 造一个只靠 workspace.yaml 认作本地 Markdown 的工作区（没有 .git，也没有任何别的后端证据）。 */
async function makeWorkspace(): Promise<string> {
  const ws = await fsPromises.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'dsh-1581-'))
  const effort = nodePath.join(ws, '.scratch', 'ticket-convention')
  await fsPromises.mkdir(nodePath.join(ws, 'docs', 'agents'), { recursive: true })
  await fsPromises.mkdir(nodePath.join(effort, 'issues'), { recursive: true })
  await fsPromises.writeFile(nodePath.join(ws, 'docs', 'agents', 'workspace.yaml'),
    'version: 2\nbackendId: markdown\npickedAt: 1\nsource: user\n', 'utf8')
  await fsPromises.writeFile(nodePath.join(effort, 'map.md'),
    '<!-- DSH-FORMAT: md-v1 -->\n'
    + '<!-- DSH-TITLE: ' + MAP_TITLE + ' -->\n'
    + '<!-- DSH-STATUS: ready-for-agent -->\n'
    + '<!-- DSH-LABELS: wayfinder:map -->\n\n'
    + '## Destination\n\n'
    + '这是 #1581 门禁造出来的地图容器正文，详情读路径必须能把它读回来。\n', 'utf8')
  await fsPromises.writeFile(nodePath.join(effort, 'issues', '01-现状事实清单.md'),
    '<!-- DSH-FORMAT: md-v1 -->\n'
    + '<!-- DSH-PARENT: 00 -->\n'
    + '<!-- DSH-LABELS: wayfinder:research -->\n\n'
    + '# 01: ' + CHILD_TITLE + '\n\n'
    + '## Question\n\n'
    + '这是 #1581 门禁造出来的子票正文，详情读路径必须能把它读回来。\n', 'utf8')
  return ws
}

async function main(): Promise<void> {
  console.log('本地 Markdown 的详情读路径必须拿到仓库身份（#1581）')

  const ws = await makeWorkspace()
  const { fsLike, platform, exec, timers } = makePlatformLike(ws)
  const backendCtx: any = { platform, fs: fsLike, exec, timers, logEvent: () => {}, isEnabled: () => false }

  try {
    // ── 真实注册表 + 三个内置后端模块（与宿主用同一份装配）──
    const registry: any = createRegistry({ logEvent: () => {}, isEnabled: () => false, outbound: { noteOutbound: () => {} } } as any)
    const mods: any[] = await loadBuiltinBackendModules()
    for (const m of mods) registry.register(m)

    // ══════════════════════════════════════════════════════════════════════
    console.log('\n== ① 现场口径：统一判定给 markdown，但不带仓库身份 ==')
    const decision: any = await decideBackend(ws, {
      registry,
      platform,
      fs: fsLike,
      caller: 'verify-1581',
      autodetectContext: { exec, timers },
    } as any)
    check(decision && decision.backendId === 'markdown', '统一判定认出本地 Markdown（实得 ' + (decision && decision.backendId) + '）')
    check(!decision.ref || !decision.ref.refId, '判定结论只给 backendId、不带 refId（这就是会话要自己补身份的那一格）')

    // ── 真实开会话：与 refresh-runtime 同一份装配口（先统一判定，再补仓库身份）──
    const decideSelection = createSessionDecisionResolver({
      getDecisionFn: async () => ({ decideBackend }),
      getTrackerRegistry: async () => registry,
      backendCtx: () => backendCtx,
    } as any)
    const ledger = {
      spend: () => undefined, view: () => ({}), snapshot: () => ({ buckets: {} }),
      ensureBackend: () => undefined, noteOutbound: () => undefined,
    }
    const opener = createSessionOpener({
      getTrackerRegistry: async () => registry,
      ledger,
      backendCtx: () => backendCtx,
      logCtx: null,
      decideSelection,
    } as any)

    // ══════════════════════════════════════════════════════════════════════
    console.log('\n== ② 开会话：仓库身份补回来了 ==')
    const opened: any = await opener(ws, {})
    check(opened && opened.ok === true, '开会话成功（旧的装配缺陷会导致身份为空，但会话本身还是开得成）')
    check(opened.ok === true && opened.backendId === 'markdown', '会话绑定的后端是 markdown')
    const refId: string = String((opened && opened.repoRef && opened.repoRef.refId) || '')
    check(refId !== '', 'opened.repoRef 有 refId（旧代码这里是 null，详情页随即报 refId missing）')
    check(refId !== '' && nodePath.resolve(refId).toLowerCase() === nodePath.resolve(ws).toLowerCase(), 'refId 就是工作区目录（实得 ' + refId + '）')

    // ══════════════════════════════════════════════════════════════════════
    console.log('\n== ③ 会话上的两条定位口叫得到、答得对 ==')
    const byDescribe: any = await opened.call((session: any) => session.describe({ cwd: ws }))
    check(byDescribe && String(byDescribe.refId || '') !== '', 'session.describe 回得出仓库身份（旧代码在这抛 TypeError，被吞成“没身份”）')
    check(byDescribe && String(byDescribe.backend || '') === 'markdown', 'describe 的 backend 格写的是 markdown（省略第二参时也要按选中后端补上）')
    const byDescribe2: any = await opened.call((session: any) => session.describe({ cwd: ws }, 'markdown'))
    check(byDescribe2 && nodePath.resolve(String(byDescribe2.refId || '')).toLowerCase() === nodePath.resolve(ws).toLowerCase(),
      '显式给第二参时 describe 仍回同一份身份')
    const address: any = await opened.call((session: any) => session.issueAddress(byDescribe, '01'))
    check(typeof address === 'string', 'session.issueAddress 叫得到且回字符串（本地 Markdown 按设计回空串，不抛错）')

    // ══════════════════════════════════════════════════════════════════════
    console.log('\n== ④ 详情电话：读回地图容器与普通票的正文 ==')
    const threads: any = createCommentThreads({
      openSession: opener,
      normCwd: async (c: unknown) => c,
      errText: (e: any) => String((e && e.message) || e),
      execProc: exec,
      setCache: () => {},
      getTrackerRegistry: async () => registry,
      getPlatform: async () => platform,
      ctx: { get: () => null, set: () => {} },
      timer: timers,
      DEFAULT_CWD: '',
      getRepoKey: async () => null,
      fetchIssueDetail: async () => ({ ok: false }),
      fetchIssueIndex: async () => ({ ok: false }),
      issueIndexFromSnapshot: () => null,
      logCtx: null,
    } as any)
    const mapDetail: any = await threads.handleIssueDetail({ number: 0, effortId: 'ticket-convention', cwd: ws })
    check(mapDetail && mapDetail.ok === true, '地图容器详情报 ok（旧代码回 not-found「无法解析目标仓库（refId missing）」）')
    check(mapDetail && mapDetail.ok === true && mapDetail.issue && mapDetail.issue.title === MAP_TITLE, '读回的是地图容器的标题')
    check(mapDetail && mapDetail.ok === true && mapDetail.issue && String(mapDetail.issue.body || '').length > 0, '地图容器正文不是空（截图里写的是「正文还没拿到」）')
    const childDetail: any = await threads.handleIssueDetail({ number: 1, effortId: 'ticket-convention', cwd: ws })
    check(childDetail && childDetail.ok === true, '普通票详情报 ok（同一个身份闸）')
    check(childDetail && childDetail.ok === true && childDetail.issue && childDetail.issue.title === CHILD_TITLE, '读回的是子票的标题')
    check(childDetail && childDetail.ok === true && childDetail.issue && Array.isArray(childDetail.issue.comments && childDetail.issue.comments.nodes), '评论装回界面认的连接形状')

    // ══════════════════════════════════════════════════════════════════════
    console.log('\n== ⑤ 评论读电话：同一道身份闸也通过 ==')
    const comments: any = await threads.handleIssueComments({ number: 1, effortId: 'ticket-convention', cwd: ws })
    check(comments && comments.ok === true, '评论读电话回 ok（旧代码同一句 refId missing 从这里出来）')
    check(comments && comments.ok === true && Array.isArray(comments.nodes), '评论回包是界面认的节点数组')

    // ── 本门禁必须在 verify 链里（不挂进链就等于没跑）──
    const mine = planGates(ROOT).filter((s: { file: string }) => s.file.indexOf('verify-1581-session-locators') >= 0)
    check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
  } finally {
    await fsPromises.rm(ws, { recursive: true, force: true }).catch(() => undefined)
  }

  console.log('\nverify-1581-session-locators: ' + (failed ? '有失败项' : '全部通过'))
  if (failed) process.exit(1)
  console.log('SESSION LOCATORS OK')
}

main().catch((e) => {
  console.log('  FAIL 门禁抛错：' + String((e && (e as Error).message) || e))
  process.exit(1)
})
