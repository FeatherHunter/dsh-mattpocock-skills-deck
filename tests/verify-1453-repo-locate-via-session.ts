/**
 * tests/verify-1453-repo-locate-via-session.ts —— 仓库定位的 gh 兜底必须随会话走管线的门禁（票 #1453，父规格 #1439）。
 *
 * 为什么要这一条：#1439 第 5 节写的是「读 git remote 属于本地证据；需要 gh repo view 的那一级属于出站，
 * 放在会话建立之后作为操作过闸，不参与选哪个后端」。票 #1453 之前，刷新后台开会话时补仓库身份走的是
 * 宿主自己的 getRepoKey，那一份的第三级直接起 gh、不过裁决也不记账；这条门禁用假房间把「随会话走管线」
 * 钉死：仓库身份必须由会话的 getRepoKey 能力补出来，那一趟要先过裁决、再按后端口径记账。
 *
 * 三条断言：
 *   一、补身份的顺序：先选后端（注册表 select）、再开会话、最后才问会话要仓库身份；问的是会话能力，
 *       不是宿主那一份（宿主那份的 gh 第三级已经删掉，见 tests/verify-1443-static-gate.ts 的文本断言）。
 *   二、补身份要过管线：房间回包带用量时，账本按后端的两桶口径记一笔（kind 是 getRepoKey、桶是 rest）。
 *   三、定位口也在闸内：裁决拒绝时房间一次都不碰，调用方拿到的是管线造的推迟失败。
 *
 * 运行：node --import ./scripts/ts-hook.mjs tests/verify-1453-repo-locate-via-session.ts
 * （仓里的统一写法是 node --import ./scripts/ts-hook.mts tests/verify-1453-repo-locate-via-session.ts）
 */
import { createSessionOpener } from '../src/refresh/rooms/host/session-opener.ts'
import { openTracker } from '../src/tracker/session/open-tracker.ts'
import { getRepoKey as roomGetRepoKey } from '../src/tracker/rooms/github/repo.ts'

let failed = false
let passed = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) { passed += 1; console.log('  PASS ' + msg) } else { failed = true; console.log('  FAIL ' + msg) }
}

/** 这一次测试里假房间与假注册表留下的痕迹：谁先被叫、被叫时带了什么。 */
const trace: string[] = []

/** 假账本：只记「谁花了多少」，够本门禁核对口径。 */
const spends: any[] = []
const ledger = {
  spend: (entry: any): void => { spends.push(entry) },
  ensureBackend: (): void => {},
}

/** 假后端：预算声明是 GitHub 的两桶口径（请求记 rest、点数记 graphql），能力只实现本门禁要用的几条。 */
const budget = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }

/** 房间最近一次被问定位口时收到的两格参数（用来核对调用方没有把路径包成对象）。 */
let lastRoomCall: any = null

/** 房间回包带用量：契约里的定位口回裸值（{ owner, name } 或 null，没有成功信封），用量挂在裸值上自报。 */
const room = {
  describe: (): any => ({ backend: 'github', refId: '', name: '', url: '' }),
  getRepoKey: async (cwd: string, ctx: any): Promise<any> => {
    trace.push('room.getRepoKey')
    lastRoomCall = { cwd, ctx }
    return { owner: 'Octo', name: 'Repo', usage: { requests: 1, points: 0 }, cwd, ctxCwd: ctx && ctx.cwd }
  },
  readBudget: async (): Promise<any> => ({ ok: true, data: { known: false, reason: 'not-measured' } }),
}
const registry = {
  select: async (): Promise<any> => { trace.push('registry.select'); return { backendId: 'github' } },
  get: (): any => room,
  modules: (): any[] => [{ id: 'github', budget }],
}

/** 房间 gh 客户端要的三件执行桩：平台解析、起进程、出站控制面；缺一件房间按环境失败。 */
function roomCtx(exec: (cmd: string, args: string[], opts?: any) => Promise<any>): any {
  return {
    cwd: 'D:/work/repo',
    platform: {
      resolveExecutable: async (name: string): Promise<string> => name + '-on-path',
      fs: { resolve: async (): Promise<string> => '.git/config', readText: async (): Promise<string> => { throw new Error('no-file') } },
      env: { get: (): undefined => undefined, has: (): boolean => false },
    },
    exec,
    outbound: { acquire: async (): Promise<() => void> => function release(): void {}, isCancelled: (): boolean => false, noteWrite: (): void => {}, reportTransportFailure: (): void => {}, reportSuccess: (): void => {} },
    logEvent: (): void => {},
    isEnabled: (): boolean => false,
    gate: null,
  }
}

async function main(): Promise<void> {
  // —— 一、会话补身份：先选后端，再由会话的 getRepoKey 补出 refId ——
  const opener = createSessionOpener({
    getTrackerRegistry: (): any => registry,
    ledger,
    backendCtx: (): any => ({}),
    ensureBackend: (): void => {},
  })
  const opened: any = await opener('D:/work/repo', {})
  check(opened && opened.ok === true, '开会话成功（假注册表与假房间都就位）')
  check(opened.ok === true && opened.repoRef && opened.repoRef.refId === 'Octo/Repo',
    '仓库身份由会话能力补出（refId = Octo/Repo，不再问宿主那一份）')
  check(opened.ok === true && opened.repoRef && opened.repoRef.url === 'https://github.com/Octo/Repo',
    '补出的身份带上了可写的仓库地址（写操作直接用）')
  check(trace.indexOf('registry.select') >= 0 && trace.indexOf('room.getRepoKey') > trace.indexOf('registry.select'),
    '顺序是先选后端、后问仓库身份（选后端不花额度，仓库身份那一问才是出站）')
  // 参数形状也是契约的一部分：定位口第一格是仓库路径字符串（房间拿它当 git -C 的工作目录），
  // 第二格才是操作上下文。包成 { cwd } 时房间的 git/fs/gh 三路都会拿对象当目录，坏在运行时。
  check(lastRoomCall && lastRoomCall.cwd === 'D:/work/repo',
    '问会话时第一格是路径字符串（不是 { cwd } 对象）')
  check(lastRoomCall && lastRoomCall.ctx && lastRoomCall.ctx.cwd === 'D:/work/repo' && lastRoomCall.ctx.caller === 'refresh',
    '第二格是带当前目录与调用方的操作上下文（房间真起 git/gh 时要用它）')

  // —— 二、过管线并记账：房间自报的用量按后端两桶口径落成 rest 桶的一笔 ——
  check(spends.length === 1, '记账口被叫了一次（补身份这一趟没有绕过账本）')
  const spend: any = spends[0] || {}
  check(spend.account === 'plugin' && spend.backendId === 'github', '账记在 plugin 账本、github 后端名下')
  check(spend.kind === 'getRepoKey' && spend.bucket === 'rest' && spend.requests === 1 && spend.points === 0,
    '按两桶口径记成 rest 桶一笔请求（kind = getRepoKey）')

  // —— 三、定位口也在闸内：裁决拒绝时房间一次都不碰 ——
  const callsBefore = trace.filter((x) => x === 'room.getRepoKey').length
  const gated: any = await openTracker({ cwd: 'D:/work/repo' }, {
    registry: registry as any,
    getCachedReading: (): any => ({ known: false, reason: 'not-measured' }),
    admit: (): any => ({ allowed: false, kind: 'ratelimit', message: '预算不足，本次调用推迟' }),
    account: (): void => {},
    canWrite: false,
  })
  check(gated && gated.ok === true, '裁决拒绝不影响开会话本身（会话照开，只是这一趟调用被推迟）')
  const denied: any = await gated.session.getRepoKey('D:/work/repo', { cwd: 'D:/work/repo' })
  check(denied && denied.ok === false && denied.error && denied.error.kind === 'ratelimit',
    '裁决拒绝时 getRepoKey 回推迟失败（管线造的失败形状，不是 null）')
  check(trace.filter((x) => x === 'room.getRepoKey').length === callsBefore,
    '裁决拒绝时房间一次都没被碰（没发生的事不记账、也不出站）')

  // —— 四、房间那一侧真起 gh 时把用量挂在裸值上（生产形状，不是夹具编的）——
  const viaGh: any = await roomGetRepoKey('D:/work/repo', roomCtx(function (cmd: string, args: string[]): Promise<any> {
    if (cmd === 'gh' && args[0] === 'repo' && args[1] === 'view') return Promise.resolve({ stdout: 'acme/demo\n', stderr: '', code: 0 })
    return Promise.resolve({ stdout: '', stderr: '', code: 0 })
  }))
  check(viaGh && viaGh.owner === 'acme' && viaGh.name === 'demo', '房间的 gh 那一级仍能定位仓库（owner/name 原样回来）')
  check(viaGh && viaGh.usage && viaGh.usage.requests === 1 && viaGh.usage.points === 0,
    '房间在裸值上自报这一笔 gh 出站（requests 1、points 0，交给账本）')
  const viaGit: any = await roomGetRepoKey('D:/work/repo', roomCtx(function (cmd: string): Promise<any> {
    if (cmd === 'git') return Promise.resolve({ stdout: 'git@github.com:local/repo.git\n', stderr: '', code: 0 })
    return Promise.resolve({ stdout: '', stderr: '', code: 0 })
  }))
  check(viaGit && viaGit.owner === 'local' && !('usage' in viaGit),
    '只读本地 git 证据就答上来时不带 usage（没有出站就不记账）')

  console.log(failed ? ('\n' + (passed + 1) + ' 条断言，失败') : ('\n' + passed + ' 条断言，全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: any): void => { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
