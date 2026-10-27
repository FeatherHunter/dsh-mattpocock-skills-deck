/**
 * tests/verify-1584-repo-ref-for-cwd.ts —— 四条自己造仓库身份的取数电话，必须向会话要身份（#1584）。
 *
 * 病根（审计 F1–F4）：面板首屏快照（wf.snapshot / wf.refresh）、地图子票（wf.mapTickets）、
 * 按页取历史票（wf.issuesPage）、探针（wf.probe）这四条电话都先 `reg.describe({ cwd }, backendId)`
 * 自己造仓库身份，而且只判「回包是不是对象」。GitHub / GitLab 的 describe 在只给目录时回的是
 * refId 为空的壳，于是：空 refId 被当成「已经答出来了」直达后端操作，房间内部再以
 * 「refId missing」失败。GitHub 恰好被 composer 分流与宿主 getRepoKey 掩盖，Markdown 天然回 cwd。
 *
 * 修法：新增共享入口 src/tracker/session/repo-ref.ts 的 resolveRepoRefForCwd（describe 给不出
 * refId 就向会话要，都答不上回 null），四条电话改调它。本门禁钉两层：
 *   一、共享入口的判定：空 refId 的壳不算身份；后端编号对不上、开会话失败都算「拿不到」；
 *   二、两条端到端：wf.mapTickets 与 wf.issuesPage 在「describe 只回空壳、会话能给出 GitLab 身份」
 *      的场景下，必须把带 refId 的身份交给后端操作，不能拿 cwd 冒充身份。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1584-repo-ref-for-cwd.ts
 *
 * 门禁归属: src/tracker/session/repo-ref.ts
 * 门禁归属: src/host/mapTickets.ts
 * 门禁归属: src/host/issuePage.ts
 * 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
 * 门禁归属: src/refresh/rooms/host/session-refresh-schedule.ts
 * 门禁归属: src/refresh/rooms/host/probe-handler.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRepoRefForCwd } from '../src/tracker/session/repo-ref.ts'
import { createMapTickets } from '../src/host/mapTickets.ts'
import { createIssuePage } from '../src/host/issuePage.ts'

let failed = false
let passed = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) { passed += 1; console.log('  PASS ' + msg) } else { failed = true; console.log('  FAIL ' + msg) }
}

/** GitLab 口径的一次会话回包：后端编号对得上、身份完整。 */
const OPENED_GITLAB = {
  ok: true,
  backendId: 'gitlab',
  repoRef: { backend: 'gitlab', refId: 'group/project', name: 'group/project', url: 'https://gitlab.com/group/project' },
}

/** 只给目录时 GitHub / GitLab 的 describe 回包：有显示名、refId 为空。 */
const EMPTY_SHELL = { backend: 'gitlab', refId: '', name: 'ws', url: '' }

/** 记录 openSession 被问了几次、入参是什么。 */
function makeOpener(opened: unknown): { openSession: any; calls: any[] } {
  const calls: any[] = []
  const openSession = async (cwd: string, options?: unknown): Promise<unknown> => {
    calls.push({ cwd, options })
    return opened
  }
  return { openSession, calls }
}

async function main(): Promise<void> {
  // —— 一、共享入口的判定 ——
  {
    const describe = (): any => ({ backend: 'gitlab', refId: 'group/project', name: 'group/project', url: 'https://gitlab.com/group/project' })
    const { openSession, calls } = makeOpener(OPENED_GITLAB)
    const ref: any = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab', describe, openSession })
    check(ref && ref.refId === 'group/project', 'describe 直接答出 refId 时用它（实得 ' + JSON.stringify(ref) + '）')
    check(calls.length === 0, 'describe 答得出身份时不开会话（实得 ' + calls.length + ' 次）')
  }
  {
    const describe = (): any => EMPTY_SHELL
    const { openSession, calls } = makeOpener(OPENED_GITLAB)
    const ref: any = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab', describe, openSession })
    check(ref && ref.refId === 'group/project', 'describe 只回空壳时向会话要身份（实得 ' + JSON.stringify(ref) + '）')
    check(calls.length === 1 && calls[0].options && calls[0].options.write === false,
      '开会话用的是只读口径（实得 ' + JSON.stringify(calls) + '）')
  }
  {
    const describe = (): any => { throw new Error('describe 坏了') }
    const { openSession } = makeOpener(OPENED_GITLAB)
    const ref: any = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab', describe, openSession })
    check(ref && ref.refId === 'group/project', 'describe 抛错时继续向会话要身份（实得 ' + JSON.stringify(ref) + '）')
  }
  {
    const { openSession } = makeOpener({ ok: false, reason: 'multi-match', repoRef: null })
    const ref = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab', describe: () => EMPTY_SHELL, openSession })
    check(ref === null, '会话没开成时回 null，不编造身份（实得 ' + JSON.stringify(ref) + '）')
  }
  {
    const { openSession } = makeOpener({ ok: true, backendId: 'github', repoRef: { backend: 'github', refId: 'acme/box', name: 'acme/box', url: '' } })
    const ref = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab', describe: () => EMPTY_SHELL, openSession })
    check(ref === null, '会话开成了别的后端时不算数（实得 ' + JSON.stringify(ref) + '）')
  }
  {
    const { openSession } = makeOpener({ ok: true, backendId: 'gitlab', repoRef: EMPTY_SHELL })
    const ref = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab', describe: () => EMPTY_SHELL, openSession })
    check(ref === null, '会话回的身份也没有 refId 时回 null（实得 ' + JSON.stringify(ref) + '）')
  }
  {
    const openSession = async (): Promise<unknown> => { throw new Error('开会话炸了') }
    const ref = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab', describe: () => EMPTY_SHELL, openSession })
    check(ref === null, '开会话抛错时回 null、不把异常漏出去（实得 ' + JSON.stringify(ref) + '）')
  }
  {
    const ref = await resolveRepoRefForCwd({ cwd: '/ws', backendId: 'gitlab' })
    check(ref === null, '没有任何身份来源时回 null（实得 ' + JSON.stringify(ref) + '）')
  }

  // —— 二、wf.mapTickets 端到端：空壳 describe + 会话给身份 → 后端操作拿到 refId ——
  {
    const gotRefs: any[] = []
    const fakeReg = {
      describe: (): any => EMPTY_SHELL,
      get: (): any => ({
        listSubIssues: async (ref: any): Promise<any> => { gotRefs.push(ref); return { ok: true, data: { items: [] } } },
      }),
      modules: (): any[] => [],
    }
    const { openSession } = makeOpener(OPENED_GITLAB)
    const handle: any = createMapTickets({
      canonicalKey: async (c: string): Promise<string> => c,
      selectEarly: async (): Promise<any> => ({ backendId: 'gitlab' }),
      isComposerSelection: (sel: any): boolean => !!(sel && sel.backendId),
      getTrackerRegistry: async (): Promise<any> => fakeReg,
      getPlatform: async (): Promise<any> => ({}),
      ctx: { get: (): unknown => null },
      DEFAULT_CWD: '/ws',
      logCtx: null,
      groupTickets: undefined,
      getMapBody: async (): Promise<any> => null,
      detectionExec: (): any => ({}),
      openSession,
    })
    const r: any = await handle.handleMapTickets({ cwd: '/ws', key: '1' })
    check(r && r.ok === true, 'wf.mapTickets 在 GitLab 式空壳 describe 下取子票成功（实得 ' + JSON.stringify(r && r.error) + '）')
    check(gotRefs.length === 1 && gotRefs[0].refId === 'group/project', 'wf.mapTickets 把会话身份交给 listSubIssues（实得 ' + JSON.stringify(gotRefs) + '）')
  }

  // —— 三、wf.issuesPage 端到端：空壳 describe + 会话给身份 → listPage 拿到 refId ——
  {
    const gotRefs: any[] = []
    const fakeReg = {
      describe: (): any => EMPTY_SHELL,
      get: (): any => ({
        listPage: async (ref: any): Promise<any> => { gotRefs.push(ref); return { ok: true, data: { items: [], nextCursor: null, total: 0 } } },
      }),
      modules: (): any[] => [],
    }
    const { openSession } = makeOpener(OPENED_GITLAB)
    const handle: any = createIssuePage({
      normCwd: async (c: string): Promise<string> => c,
      selectEarly: async (): Promise<any> => ({ backendId: 'gitlab' }),
      getTrackerRegistry: async (): Promise<any> => fakeReg,
      getPlatform: async (): Promise<any> => ({}),
      getRepoKey: async (): Promise<any> => null,
      ctx: { get: (): unknown => null },
      DEFAULT_CWD: '/ws',
      detectionExec: (): any => ({}),
      logCtx: null,
      openSession,
    })
    const r: any = await handle.handleIssuesPage({ cwd: '/ws' })
    check(r && r.ok === true, 'wf.issuesPage 在 GitLab 式空壳 describe 下翻页成功（实得 ' + JSON.stringify(r && r.error) + '）')
    check(gotRefs.length === 1 && gotRefs[0].refId === 'group/project', 'wf.issuesPage 把会话身份交给 listPage（实得 ' + JSON.stringify(gotRefs) + '）')
  }

  // —— 四、接线静态断言：六处现场都调共享入口，三个宿主装配点都传了 openSession ——
  {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8')
    const sites = [
      'src/refresh/rooms/host/session-snapshot-cache.ts',
      'src/refresh/rooms/host/session-refresh-schedule.ts',
      'src/host/mapTickets.ts',
      'src/host/issuePage.ts',
      'src/refresh/rooms/host/probe-handler.ts',
    ]
    for (const site of sites) {
      const src = read(site)
      check(src.includes('resolveRepoRefForCwd(') && src.includes('!repoRef') && /\.refId/.test(src),
        site + ' 在空 refId 时调共享入口（不再把空壳当身份）')
    }
    const hostIndex = read('src/host/index.ts')
    const wiring = hostIndex.match(/openSession: openSessionFor/g) || []
    check(wiring.length >= 5, 'src/host/index.ts 至少五个装配点传了 openSession（实得 ' + wiring.length + ' 处）')
  }

  if (failed) {
    console.log('\nREPO REF FOR CWD FAILED')
    process.exitCode = 1
    return
  }
  console.log('\nREPO REF FOR CWD OK (' + passed + ' checks)')
}

await main()
