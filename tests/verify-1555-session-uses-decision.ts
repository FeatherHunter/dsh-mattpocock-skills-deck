/**
 * tests/verify-1555-session-uses-decision.ts —— 开会话时必须复用统一判定，不许再裸问注册表（#1555）。
 *
 * 病根：v1.9.0-beta.12 的 #1444 把详情/评论的读路径改成“开一个只读会话”，但开会话时没有把
 * 统一判定的结论带过去，直接调 registry.select 重跑各家 matches。结果是：工作区文件 / 声明文件
 * 明明已经定了后端（面板上那颗绿色 markdown 芯片就是它），只要有两家后端同时举手，详情与评论
 * 一律 multi-match 失败，整批子票的正文与评论都读不到（#1555 截图）。
 *
 * 修法口径（第一性原理）：同一个问题“这个工作区用哪个后端”只有一份答案 —— 统一判定出口
 * （工作区文件 > 声明文件 > 自动识别）。开会话的人没显式给选择时，先问那份结论；判定服务
 * 不可用时才退回今天的行为（裸问注册表）。判定自己都说 multi-hit 时不许替人挑。
 *
 * 本门禁钉住（会话装配口 src/refresh/rooms/host/session-opener.ts 这个缝）：
 *   ① 判定给出确定的后端时，开会话用它，注册表的裸认领一次都不参与选择；
 *   ② 详情电话（comment-thread-fetch 的 handleIssueDetail）经这个会话能读回正文（#1555 的症状本身）；
 *   ③ 调用方显式给了选择时，判定层不被叫（不抢调用方的答案）；
 *   ④ 判定自己带着 multi-hit 时，会话照旧拒绝（不擅自挑赢家）；
 *   ⑤ 判定层缺席或抛错时，退回裸问注册表（与改动前一致，不把老宿主带崩）；
 *   ⑥ 判定与裸认领不一致时听判定的；
 *   ⑦ 判定出口拿得到宿主补充的现场能力（autodetectContext），自动识别仍由判定出口自己跑
 *      —— 刷新机制一处 registry.select 都不写（#1443 静态门禁的纪律）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1555-session-uses-decision.ts
 *
 * 门禁归属: src/refresh/rooms/host/session-opener.ts
 * 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts
 */
import path from 'node:path'
import { createSessionOpener } from '../src/refresh/rooms/host/session-opener.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import { createSessionDecisionResolver } from '../src/refresh/rooms/host/session-decision.ts'
import { decideBackend } from '../src/tracker/detection/backendDecision.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const BUDGET_MD = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }
const BUDGET_GL = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }

const DETAIL_ISSUE = {
  key: '24',
  title: 'T24 · 演示票',
  body: '这是 #1555 里读不到的正文',
  state: 'open',
  comments: [],
}

/** 一趟会话里要用的房间桩：markdown 房能 get 一张票，两个房都能 describe。 */
function makeRoom(backendId: string, detail: any) {
  return {
    describe: () => ({ backend: backendId, refId: '/ws', name: 'ws', url: '' }),
    get: async () => ({ ok: true, data: detail }),
  }
}

interface Fixture {
  opener: any
  calls: { select: number; decide: number; describe: number }
}

/** 造一个“两家同时举手、判定已定 markdown”的注册表与判定口。 */
function makeFixture(opts?: {
  decision?: any
  decisionThrows?: boolean
  omitDecision?: boolean
  rawSelection?: any
}): Fixture {
  const calls = { select: 0, decide: 0, describe: 0 }
  const rawSelection = opts && opts.rawSelection
    ? opts.rawSelection
    : { backendId: 'markdown', source: 'matches', multiHit: ['markdown', 'gitlab'], ref: null }
  const mdRoom = makeRoom('markdown', DETAIL_ISSUE)
  const glRoom = makeRoom('gitlab', { key: '24', title: 'GitLab 上的另一张票', comments: [] })
  const registry = {
    select: async () => { calls.select += 1; return rawSelection },
    get: (id: string) => (id === 'markdown' ? mdRoom : id === 'gitlab' ? glRoom : undefined),
    modules: () => [
      { id: 'markdown', budget: BUDGET_MD },
      { id: 'gitlab', budget: BUDGET_GL },
    ],
  }
  const ledger = { spend: () => {}, ensureBackend: () => {} }
  const deps: any = {
    getTrackerRegistry: async () => registry,
    ledger,
    backendCtx: () => ({
      cwd: '/ws',
      platform: { fs: { resolve: async (r: string) => r, readText: async () => { throw new Error('no-file') } } },
      fs: null,
      timers: { setTimeout, clearTimeout },
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    }),
    ensureBackend: () => {},
    logCtx: null,
  }
  if (!(opts && opts.omitDecision)) {
    deps.decideSelection = async () => {
      calls.decide += 1
      if (opts && opts.decisionThrows) throw new Error('判定服务这次不可用')
      return opts && opts.decision !== undefined
        ? opts.decision
        : { backendId: 'markdown', source: 'explicit', ref: { backend: 'markdown', refId: '/ws', name: 'ws', url: '' } }
    }
  }
  return { opener: createSessionOpener(deps), calls }
}

function makeCommentThreads(opener: any) {
  return createCommentThreads({
    openSession: opener,
    normCwd: async (c: any) => c,
    errText: (e: any) => String((e && e.message) || e),
    execProc: async () => ({ ok: true, text: '', code: 0 }),
    setCache: () => {},
    getTrackerRegistry: async () => ({ describe: () => null }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    timer: {},
    DEFAULT_CWD: '',
    getRepoKey: async () => null,
    fetchIssueDetail: async () => ({ ok: false }),
    fetchIssueIndex: async () => ({ ok: false }),
    issueIndexFromSnapshot: () => null,
    logCtx: null,
  } as never)
}

async function main() {
  console.log('开会话复用统一判定（#1555：详情/评论不再裸问注册表）')

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ① 判定给出确定后端：开会话用它，裸认领不参与选择 ==')
  {
    const f = makeFixture()
    const opened: any = await f.opener('/ws', {})
    check(opened && opened.ok === true, '开会话成功（判定已定 markdown，裸认领是多命中也不影响）')
    check(opened.ok === true && opened.backendId === 'markdown', '会话绑定的正是判定给出的 markdown（不是裸认领第一个）')
    check(f.calls.decide === 1, '判定层被问了一次（实得 ' + f.calls.decide + ' 次）')
    check(f.calls.select === 0, '裸问注册表 select 一次都没发生（实得 ' + f.calls.select + ' 次）')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ② 详情电话经这个会话能读回正文（#1555 的症状本身）==')
  {
    const f = makeFixture()
    const threads = makeCommentThreads(f.opener)
    const r: any = await threads.handleIssueDetail({ number: 24, cwd: '/ws' })
    check(r && r.ok === true, '详情电话回 ok（旧代码在这里回的是“只读会话没开成（multi-match）”红条）')
    check(r && r.ok === true && r.issue && r.issue.title === DETAIL_ISSUE.title, '读回的是 markdown 房里那张票')
    check(r && r.ok === true && r.issue && r.issue.body === DETAIL_ISSUE.body, '正文原样读回（截图里缺的就是它）')
    check(r && r.ok === true && r.issue && r.issue.comments && Array.isArray(r.issue.comments.nodes), '评论装回界面认的连接形状')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ③ 调用方显式给了选择：判定层不被叫 ==')
  {
    const f = makeFixture()
    const opened: any = await f.opener('/ws', {
      resolveSelection: async () => ({ backendId: 'gitlab', source: 'explicit', ref: { backend: 'gitlab', refId: '/ws', name: 'ws', url: '' } }),
    })
    check(opened && opened.ok === true && opened.backendId === 'gitlab', '调用方给的选择优先（gitlab）')
    check(f.calls.decide === 0, '调用方已给选择时判定层一次都不问（实得 ' + f.calls.decide + ' 次）')
    check(f.calls.select === 0, '也不问注册表裸认领（实得 ' + f.calls.select + ' 次）')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ④ 判定自己带 multi-hit：会话照旧拒绝，不替人挑 ==')
  {
    const f = makeFixture({ decision: { backendId: 'markdown', source: 'matches', multiHit: ['markdown', 'gitlab'] } })
    const opened: any = await f.opener('/ws', {})
    check(opened && opened.ok === false && opened.reason === 'multi-match', '判定没说死是哪家时回 multi-match（不擅自挑赢家）')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ⑤ 判定层缺席 / 抛错：退回裸问注册表（与改动前一致）==')
  {
    const f = makeFixture({ omitDecision: true })
    const opened: any = await f.opener('/ws', {})
    check(opened && opened.ok === false && opened.reason === 'multi-match', '没有判定口时维持旧行为（裸认领多命中 → multi-match）')
    check(f.calls.select === 1, '旧行为下注册表被问了一次（实得 ' + f.calls.select + ' 次）')
  }
  {
    const f = makeFixture({ decisionThrows: true })
    const opened: any = await f.opener('/ws', {})
    check(opened && opened.ok === false && opened.reason === 'multi-match', '判定口抛错时也退回旧行为（不把宿主带崩）')
    check(f.calls.select === 1, '退回后注册表被问了一次（实得 ' + f.calls.select + ' 次）')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ⑥ 判定与裸认领不一致时，听判定的 ==')
  {
    const f = makeFixture({ rawSelection: { backendId: 'gitlab', source: 'matches', ref: null } })
    const opened: any = await f.opener('/ws', {})
    check(opened && opened.ok === true && opened.backendId === 'markdown', '裸认领只指向 gitlab 时，会话仍按判定的 markdown 开')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ⑦ 判定出口拿得到宿主补充的现场能力（刷新机制不自己调 select）==')
  {
    const sentinelExec = async () => ({ stdout: '', stderr: '', code: 0 })
    const PREFIX = 'dsh-target:'
    const makeLayerFs = (files: Record<string, string>) => ({
      async resolve(rel: string, opts?: { cwd?: string }) { return PREFIX + path.join((opts && opts.cwd) || '', String(rel)) },
      async readText(target: unknown) {
        if (typeof target !== 'string' || target.indexOf(PREFIX) !== 0) throw new TypeError('readText 要 resolve 给的 target')
        const key = target.slice(PREFIX.length)
        if (Object.prototype.hasOwnProperty.call(files, key)) return files[key]
        const e = new Error('ENOENT'); (e as any).code = 'ENOENT'; throw e
      },
    })
    // ⑦ a：工作区文件已经定了 markdown → 自动识别整段被跳过（select 一次都不问）
    {
      const fsLike = makeLayerFs({ [path.join('/ws', 'docs/agents/workspace.yaml')]: 'version: 2\nbackendId: markdown\npickedAt: 1\nsource: user\nlayout: single\n' })
      let selectCalls = 0
      const registry = {
        has: () => true,
        select: async () => { selectCalls += 1; return { backendId: 'markdown', source: 'matches', multiHit: ['markdown', 'gitlab'], ref: null } },
        selectCalls: () => selectCalls,
      }
      const resolve = createSessionDecisionResolver({
        getDecisionFn: async () => ({ decideBackend }),
        getTrackerRegistry: async () => registry,
        backendCtx: () => ({ platform: { fs: fsLike }, fs: fsLike, exec: sentinelExec, timers: { setTimeout, clearTimeout } }),
      })
      const sel: any = await resolve('/ws')
      check(sel && sel.backendId === 'markdown', '判定出口按工作区文件给出 markdown（走的是真 decideBackend）')
      check(selectCalls === 0, '工作区文件已经定案时，自动识别一次都不问（实得 ' + selectCalls + ' 次）')
    }
    // ⑦ b：没有工作区文件与声明文件 → 自动识别被问一次，且它的 ctx 带着宿主补的 exec
    {
      const fsLike = makeLayerFs({})
      const seen: any[] = []
      const registry = {
        has: () => true,
        select: async (_handle: any, ctx: any) => { seen.push(ctx); return { backendId: 'markdown', source: 'matches', multiHit: ['markdown', 'gitlab'], ref: null } },
      }
      const resolve = createSessionDecisionResolver({
        getDecisionFn: async () => ({ decideBackend }),
        getTrackerRegistry: async () => registry,
        backendCtx: () => ({ platform: { fs: fsLike }, fs: fsLike, exec: sentinelExec, timers: { setTimeout, clearTimeout } }),
      })
      const sel: any = await resolve('/ws')
      check(seen.length === 1, '没有更权威的层时，自动识别被问一次（实得 ' + seen.length + ' 次）')
      check(seen[0] && seen[0].exec === sentinelExec, '自动识别的 ctx 带着宿主补充的 exec（读 .git/config 之外的兜底还跑得动）')
      check(seen[0] && seen[0].caller === 'refresh-session', '自动识别的 ctx 调用方是这次会话装配口（排查时认得出是谁问的）')
      check(sel && sel.backendId === 'markdown' && Array.isArray(sel.multiHit) && sel.multiHit.length === 2, '判定结论原样交回（两家候选清单也如实带出，不在这里挑）')
    }
  }

  // ── 本门禁必须在 verify 链里（不挂进链就等于没跑）──
  {
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const mine = planGates(ROOT).filter((s: { file: string }) => s.file.indexOf('verify-1555-session-uses-decision') >= 0)
    check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
  }

  console.log('\nverify-1555-session-uses-decision: ' + (failed ? '有失败项' : '全部通过'))
  if (failed) process.exit(1)
  console.log('SESSION USES DECISION OK')
}

main().catch((e) => {
  console.log('  FAIL 门禁抛错：' + String((e && (e as Error).message) || e))
  process.exit(1)
})