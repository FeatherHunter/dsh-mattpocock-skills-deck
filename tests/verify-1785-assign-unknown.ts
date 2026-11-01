/**
 * tests/verify-1785-assign-unknown.ts —— GitLab 改认领：用户名查不到 id 时必须整步失败，不许把已有认领清空（#1785，P0）。
 *
 * 病根（#1785 真机复现）：把票 20 认领给 FeatherHunter 成功之后，再认领给一个不存在的用户名
 * no-such-user-j6-06-verify，工具回 exitCode=1、status=unsupported、回执「票 20：这次点了 1 步，
 * 成了 0 步。」；独立读回认领人已经是空的，GitLab 上多出一条 unassigned @FeatherHunter 的系统记录。
 * 原因是 setAssignees 先把每个用户名换成用户 id，换不到的就当场吞掉接着走，末了照旧发
 * PUT assignee_ids=<换到的 id 列表>。列表刚好为空时，这条 PUT 在 GitLab 那边就是「明确要求清空认领」，
 * 于是别人的认领被删了，而人看到的却是「成了 0 步」。
 *
 * 本门禁钉住五件事：
 *   ① 有一个用户名查不到 id → 整步失败（not-found），一个写请求都不发，回执说清「用户名不存在」与「原认领没有改动」；
 *   ② 多个用户名查不到时，回执把它们都点名；
 *   ③ 查人这一步本身没跑成（glab 退出码非 0）也算换不出 id，同样不写；
 *   ④ 全部查得到 → 照旧成功，且只发一次 PUT，参数里是换到的用户 id；
 *   ⑤ 传空数组是「明确清空」，PUT 的 assignee_ids 是空串，照旧允许（不许被 ① 的拦截误伤）。
 * 另加一条自检：本文件必须按目录约定挂在 verify 链上（不挂在链上就等于没跑）。
 *
 * 假 glab 按要求路由：users?username= 按名单回 [{id, username}] 或 []，单票路径回一张票面。
 * 每条命令都记下来，断言既能看「发了几次写」，也能看「写的是什么」。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1785-assign-unknown.ts
 *
 * 门禁归属: src/tracker/rooms/gitlab
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setAssignees } from '../src/tracker/rooms/gitlab/graph-membership.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE_FILE = 'tests/verify-1785-assign-unknown.ts'

let failed = false
let total = 0
function check(ok: boolean, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 目标仓库：GitLab 房只认 refId 与 name，其余留空。 */
const REPO = { backend: 'gitlab', refId: 'group/proj', name: 'group/proj', url: 'https://gitlab.com/group/proj' }
/** 票号按真机那一份来（issues/20），回包里的 iid 用它。 */
const ISSUE_KEY = '20'
/** 真机上认领给它的那个用户名；本门禁里它是「查得到」的那一个。 */
const EXISTING_LOGIN = 'FeatherHunter'
const EXISTING_ID = 7
/** 真机上被认领给它的那个不存在的用户名。 */
const UNKNOWN_LOGIN = 'no-such-user-j6-06-verify'

/** 查得到 id 的用户名。FeatherHunter 只是票面上原有的认领人，不参与「换 id」这一步。 */
const USERS: Record<string, number> = { alice: EXISTING_ID }

/** 单票 PUT 的回包：一张带认领人的票面（normalizeIssue 只认这些字段）。 */
function issueJson(iid: string): string {
  return JSON.stringify({
    iid: Number(iid),
    title: '票 ' + iid,
    state: 'opened',
    description: '',
    labels: [],
    assignees: [{ id: EXISTING_ID, username: EXISTING_LOGIN }],
    web_url: 'https://gitlab.com/group/proj/-/issues/' + iid,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-21T00:00:00Z',
  })
}

interface GlabReply { stdout: string; stderr: string; code: number }

/** 假 glab：按命令行路由，每条都记下来。lookupCode 非 0 时模拟「查人这一步没跑成」。 */
function makeGlab(options: { users?: Record<string, number>; lookupCode?: number } = {}) {
  const users = options.users || USERS
  const calls: string[][] = []
  async function exec(_cmd: string, args: string[]): Promise<GlabReply> {
    const argv = (Array.isArray(args) ? args : []).slice()
    calls.push(argv)
    if (argv[0] === 'api') {
      const target = String(argv[1] || '')
      const base = target.split('?')[0]
      if (base === 'users') {
        // 「查人那一步没跑成」与「查到了空数组」是两种现场，但都换不出 id，调用方结论应当一样。
        if (options.lookupCode !== undefined && options.lookupCode !== 0) {
          return { stdout: '', stderr: 'glab: 查用户没跑成', code: options.lookupCode }
        }
        const name = decodeURIComponent(target.slice(target.indexOf('username=') + 'username='.length))
        const id = users[name]
        return { stdout: id === undefined ? '[]' : JSON.stringify([{ id, username: name }]), stderr: '', code: 0 }
      }
      if (/\/issues\/\d+$/.test(base)) {
        return { stdout: issueJson(base.slice(base.lastIndexOf('/') + 1)), stderr: '', code: 0 }
      }
    }
    return { stdout: '{}', stderr: '', code: 0 }
  }
  return { calls, exec }
}

/** 递给 setAssignees 的上下文：平台解析（glab 在 PATH 上）加执行器。 */
function makeCtx(execFn: (cmd: string, args: string[], opts?: unknown) => Promise<unknown>) {
  return {
    cwd: 'C:/ws-test-1785',
    platform: { resolveExecutable: async () => 'glab' },
    exec: execFn,
    logEvent: () => {},
    isEnabled: () => false,
  }
}

/** 一条命令是不是「改票的 PUT」（发到单票路径、方法 PUT）。 */
function isIssuePut(argv: string[]): boolean {
  if (argv[0] !== 'api') return false
  if (!/\/issues\/\d+$/.test(String(argv[1] || ''))) return false
  const at = argv.indexOf('--method')
  return at >= 0 && argv[at + 1] === 'PUT'
}

/** 这些命令里所有改票的 PUT。 */
function putsOf(calls: string[][]): string[][] {
  return calls.filter(isIssuePut)
}

/** 从一条 PUT 里取出 assignee_ids 的值；没有这个参数就回 null。 */
function assigneeIdsOf(argv: string[]): string | null {
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '-f' && argv[i + 1].indexOf('assignee_ids=') === 0) return argv[i + 1].slice('assignee_ids='.length)
  }
  return null
}

interface AssignOutcome {
  ok: boolean
  data?: Record<string, unknown>
  error: { kind: string; message: string; raw: string }
  puts: string[][]
  calls: string[][]
}

/** 跑一次改认领，把回执与发出的命令一起交回。 */
async function assign(wanted: string[], options: { users?: Record<string, number>; lookupCode?: number } = {}): Promise<AssignOutcome> {
  const glab = makeGlab(options)
  const ctx = makeCtx(glab.exec)
  const reply = (await setAssignees(ctx as never, REPO as never, ISSUE_KEY, wanted as never, {} as never, ctx as never)) as {
    ok: boolean
    data?: Record<string, unknown>
    error?: { kind: string; message: string; raw: string }
  }
  const error = reply.error || { kind: '', message: '', raw: '' }
  return { ok: reply.ok === true, data: reply.data, error, puts: putsOf(glab.calls), calls: glab.calls }
}

async function main(): Promise<void> {
  console.log('GitLab 改认领：用户名查不到 id 时不许清空已有认领（#1785）')

  // ── ① 一个查得到、一个查不到：整步失败，一个写请求都不发 ──
  console.log('\n== ① 有用户名查不到 id → 整步失败、不写、说清原认领没动 ==')
  {
    // alice 查得到 id，另一个查不到：只要有一个查不到，整步就不许写。
    const run = await assign(['alice', UNKNOWN_LOGIN])
    check(run.ok === false, '回执 ok=false（实际 ok=' + run.ok + '）')
    check(run.error.kind === 'not-found', '失败档位是 not-found（实际 ' + JSON.stringify(run.error.kind) + '）')
    check(run.error.message.indexOf(UNKNOWN_LOGIN) >= 0, '失败说明里点名了查不到的用户名「' + UNKNOWN_LOGIN + '」：' + run.error.message)
    check(
      run.error.message.indexOf('原认领') >= 0 || run.error.message.indexOf('没有改动') >= 0,
      '失败说明里写清了原认领没有改动：' + run.error.message,
    )
    check(run.puts.length === 0, '一个写请求都没发（改票 PUT 次数 ' + run.puts.length + '）')
    check(run.data === undefined, '失败回执里没有编造一张「已经改好了」的票')
    check(String(run.error.raw || '').trim() === '', '原文是空串：这一步一个外部请求都没写成，没有原文可引（实际 ' + JSON.stringify(run.error.raw) + '）')
  }

  // ── ② 两个查不到：回执把两个名字都点出来 ──
  console.log('\n== ② 多个用户名查不到 → 回执逐个点名 ==')
  {
    const run = await assign(['ghost-one', 'alice', 'ghost-two'])
    check(run.ok === false && run.error.kind === 'not-found', '两个查不到的用户名 → 整步失败（ok=' + run.ok + '，档位 ' + JSON.stringify(run.error.kind) + '）')
    check(
      run.error.message.indexOf('ghost-one') >= 0 && run.error.message.indexOf('ghost-two') >= 0,
      '两个查不到的用户名都写进了失败说明：' + run.error.message,
    )
    check(run.puts.length === 0, '仍然一个写请求都不发（改票 PUT 次数 ' + run.puts.length + '）')
  }

  // ── ③ 查人那一步没跑成：同样换不出 id，同样不写 ──
  console.log('\n== ③ 查人命令本身失败（退出码 1）→ 也算换不出 id、不写 ==')
  {
    const run = await assign(['alice'], { lookupCode: 1 })
    check(run.ok === false && run.error.kind === 'not-found', '查人失败 → 整步失败（ok=' + run.ok + '，档位 ' + JSON.stringify(run.error.kind) + '）')
    check(run.error.message.indexOf('alice') >= 0, '失败说明里点名了没换出 id 的用户名：' + run.error.message)
    check(run.puts.length === 0, '一个写请求都不发（改票 PUT 次数 ' + run.puts.length + '）')
  }

  // ── ④ 全部查得到：照旧成功，只发一次 PUT，参数是换到的 id ──
  console.log('\n== ④ 用户名都查得到 → 照旧成功，只发一次 PUT ==')
  {
    const run = await assign(['alice'])
    const ids = run.puts.length === 1 ? assigneeIdsOf(run.puts[0]) : null
    check(run.ok === true, '回执 ok=true（实际 ok=' + run.ok + '）')
    check(run.puts.length === 1, '有且只有一次改票 PUT（实际 ' + run.puts.length + ' 次）')
    check(ids === String(EXISTING_ID), 'PUT 参数里是换到的用户 id（assignee_ids=' + JSON.stringify(ids) + '）')
  }

  // ── ⑤ 传空数组：明确清空，照旧允许 ──
  console.log('\n== ⑤ 传空数组 → 明确清空照旧允许，assignee_ids 是空串 ==')
  {
    const run = await assign([])
    const ids = run.puts.length === 1 ? assigneeIdsOf(run.puts[0]) : null
    check(run.ok === true, '空数组不算失败（实际 ok=' + run.ok + '）')
    check(run.puts.length === 1, '空数组照旧发出一次改票 PUT（实际 ' + run.puts.length + ' 次）')
    check(ids === '', 'PUT 的 assignee_ids 是空串（实际 ' + JSON.stringify(ids) + '）')
  }

  // ── ⑥ 本门禁得在链上：不挂进链就等于没跑 ──
  console.log('\n== ⑥ 本门禁按目录约定登记进链 ==')
  {
    const mine = planGates(ROOT).filter((s: { file: string }) => s.file === GATE_FILE)
    check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
  }

  console.log('\nverify-1785-assign-unknown: ' + (failed ? '有失败项' : '全部通过（' + total + ' 条断言）'))
  if (failed) process.exit(1)
  console.log('GITLAB ASSIGN UNKNOWN USER OK')
}

main().catch((e) => {
  console.log('  FAIL 门禁抛错：' + String((e && (e as Error).message) || e))
  process.exit(1)
})
