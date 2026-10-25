// tests/verify-916-ghauth-crosscheck.ts —— #916 门禁：判成「没登录」之前，先用 gh api user 核对一次
//
// 为什么要有这一页（2026-10-25 在本机 gh 2.97.0 上实测）：把 HTTPS_PROXY 指向一个没人听的端口后，
// gh auth status 打印的仍然是「Failed to log in … The token … is invalid … To re-authenticate,
// run: gh auth refresh」，和凭据真的失效时一字不差，原文里一个网络字样都没有。判档表只能按认证字样
// 归成 auth，链上于是判 fail、界面弹出登录指引 —— 报告里的人被要求重走一遍浏览器授权，可凭据其实是好的，
// 坏的只是网络。这一页钉住「房间预检第二关 + 链档位反推 + 界面横幅」这一整条判断链：
//   一、auth status 说认证失败、核对时接口也连不上 → 只能算「暂时确认不了」：中性横幅、按钮只重新检查，
//       一处都不注入登录指引（修复前这里判 fail，界面出缺登录那句，本页会红）；
//   二、核对接口也明确说凭据不行（401 / 需要登录）→ 才是真的没登录，保留登录指引；
//   三、auth status 只是闪了一下、核对接口通 → 登录是好的，第二关按过处理，这条横幅根本不该出现；
//   四、auth status 本身已是网络档（超时）→ 不再多问一次接口（离线时不能白等一个读档超时）；
//   五、三关全过时也不多问一次接口（正常路径不多花一条请求）。
//
// 样本是 2026-10-25 在本机真跑 gh 抓到的原文（把用户目录换成 /home/user 脱敏）。判档、阶段映射与
// 横幅分发全部用生产代码，不另抄一份判断逻辑：房间 preflight 是真的 src/tracker/rooms/github/preflight.ts，
// 档位反推到第几关由 probeChainEnv 做（src/refresh/rooms/host/chain-env-map.ts），
// 登录态判 pass/fail/pending 由 ghAuthVerdict 做，横幅与按钮去向由 guide-steps.ts 做。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-916-ghauth-crosscheck.ts
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'
import { ghPreflight } from '../src/tracker/rooms/github/preflight.ts'
import { probeChainEnv, ghAuthVerdict } from '../src/refresh/rooms/host/chain-env-map.ts'
import { GUIDE_STEPS, guideBannerOf, guideMissingOf, guideStepState } from '../src/shared/tracker/guide-steps.ts'

/** 一段 gh 输出的样本：正常退出给 stdout/stderr/code，起进程失败或本地超时给 Error（走 execGh 的 catch 那一路）。 */
type ExecSample = { stdout?: string; stderr?: string; code: number } | Error

/** 假执行器按参数决定回哪一份样本；参数表原样记下来，用来断言「这一趟到底问了几次、问了什么」。 */
type FakeGh = (args: string[]) => ExecSample

const SAMPLES = {
  /** 坏代理时 gh auth status 的原话：说法与「凭据真失效」完全一样，一个字都没提网络。 */
  proxyAuthStatus: 'github.com\n' +
    '  X Failed to log in to github.com account FeatherHunter (/home/user/.config/gh/hosts.yml)\n' +
    '  - Active account: true\n' +
    '  - The token in /home/user/.config/gh/hosts.yml is invalid.\n' +
    '  - To re-authenticate, run: gh auth refresh -h github.com\n' +
    '  - To forget about this account, run: gh auth logout -h github.com -u FeatherHunter\n',
  /** 坏代理时 gh api user 的原话：连接层的报错，判档应归网络。 */
  proxyApiUser: 'Get "https://api.github.com/user": proxyconnect tcp: dial tcp 127.0.0.1:1: connectex: No connection could be made because the target machine actively refused it.\n',
  /** 坏代理时第三关 gh api repos/… 的原话：同样是连接层。 */
  proxyApiRepos: 'Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:1: connectex: No connection could be made because the target machine actively refused it.\n',
  /** 确实没登录时 gh auth status 的原话（退出码是 1，不是 4；gh 只对「需要登录才能干活」的命令用 4）。 */
  noLoginAuthStatus: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n',
  /** 确实没登录时 gh api user 的原话：gh 用退出码 4 表达「需要登录」。 */
  noLoginApiUser: 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n',
  /** 凭据真的失效时 gh api user 的样子：401 加 bad credentials。 */
  badCredentialsApiUser: 'HTTP 401: Bad credentials (https://api.github.com/user)\n',
} as const

let failed = false
let total = 0
function check(ok: unknown, label: string, detail?: unknown): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' — ' + String(detail)))
  if (!ok) failed = true
}

/**
 * 跑一趟生产判断链：房间 preflight → probeChainEnv 的档位反推 → ghAuthVerdict → 横幅与按钮去向。
 *
 * 会话是假的，但能力面是真的：openSession 交回来的 call 把生产 ghPreflight 原样跑一遍，
 * 于是房间判档（execGh 的退出码 + 原文 → 档位表）走的都是生产代码；执行器换成按参数回样本的假 gh。
 */
async function runChain(handler: FakeGh) {
  const calls: string[][] = []
  const events: Array<{ level: string; event: string; fields: Record<string, unknown> }> = []
  const outbound = createOutboundControl()
  const exec = async (_cmd: string, args: string[]) => {
    calls.push([...args])
    const sample = handler(args)
    if (sample instanceof Error) throw sample
    return { stdout: sample.stdout || '', stderr: sample.stderr || '', code: sample.code }
  }
  const baseCtx = {
    outbound,
    platform: { resolveExecutable: async () => 'gh' },
    exec,
    cwd: '.',
    logEvent: (level: string, event: string, fields: Record<string, unknown>) => { events.push({ level, event, fields }) },
    isEnabled: () => true,
  }
  const fakeSession = {
    preflight: (handle: unknown, ctx: unknown) => ghPreflight(handle as never, ctx as never),
    getCurrentUser: async () => ({ ok: false }),
  }
  const deps = {
    getRepoKey: async () => ({ owner: 'FeatherHunter', name: 'dsh-mattpocock-skills-deck' }),
    openSession: async () => ({ ok: true, call: async (fn: (s: unknown, c: unknown) => Promise<unknown>) => fn(fakeSession, baseCtx) }),
  }
  const probe = probeChainEnv(deps as never, '.')
  const reply = await probe.preflightOnce()
  const verdict = ghAuthVerdict(reply, true)
  const status = verdict.status === 'fail' ? 'fail' : verdict.status === 'pending' ? 'pending' : 'done'
  const chainSteps = [{ id: 'gh:authed', status }]
  const step = GUIDE_STEPS.find((s) => s.id === 'gh:authed') || null
  return {
    calls,
    events,
    reply,
    verdict,
    state: guideStepState(step, chainSteps),
    banner: guideBannerOf(step, chainSteps),
    missing: guideMissingOf(step, chainSteps),
    viaOfGhExec: events.filter((e) => e.event === 'gh.exec').map((e) => String(e.fields.via || '')),
    reasonsOfReadDegraded: events.filter((e) => e.event === 'read.degraded').map((e) => String(e.fields.reason || '')),
  }
}

async function main(): Promise<void> {
  console.log('== 一、auth status 说认证失败、核对接口也连不上（坏代理）→ 暂时确认不了，只给重新检查 ==')
  {
    const r = await runChain((args) => {
      if (args[0] === 'auth') return { stderr: SAMPLES.proxyAuthStatus, code: 1 }
      if (args[0] === 'api' && args[1] === 'user') return { stderr: SAMPLES.proxyApiUser, code: 1 }
      if (args[0] === 'api') return { stderr: SAMPLES.proxyApiRepos, code: 1 }
      return new Error('unexpected gh command: ' + args.join(' '))
    })
    check(!!r.calls.find((c) => c[0] === 'api' && c[1] === 'user'), '一、判成登录态问题之后拿 gh api user 核对了一次', JSON.stringify(r.calls))
    check(r.reply.stage === 'auth' && r.reply.kind === 'network', '一、核对时接口连不上 → 结论是网络档，不是确定没登录', JSON.stringify(r.reply))
    check(r.verdict.status === 'pending', '一、链上登录态判「暂时确认不了」，不是 fail', r.verdict.detail)
    check(r.state === 'pending', '一、引导步骤状态是 pending（不是 failed）', r.state)
    check(!!r.banner && r.banner.text === 'banner.ghauthUnknown', '一、横幅换成中性文案（登录状态暂时确认不了）', JSON.stringify(r.banner))
    check(!!r.banner && r.banner.text !== 'banner.ghauth', '一、不再用「缺登录」那句文案', JSON.stringify(r.banner && r.banner.text))
    check(!!r.missing && r.missing.type === 'recheck', '一、按钮只做重新检查', JSON.stringify(r.missing))
    check(!(r.missing && r.missing.prompt), '一、一个字都不注入登录指引（没有提示词键）', JSON.stringify(r.missing))
    check(r.viaOfGhExec.includes('preflight.auth') && r.viaOfGhExec.includes('preflight.auth-crosscheck'), '一、日志里两次调用各有短标签，事后看得出发生过核对', JSON.stringify(r.viaOfGhExec))
  }

  console.log('== 二、核对接口明确说凭据不行 → 真的没登录，保留登录指引 ==')
  {
    const r = await runChain((args) => {
      if (args[0] === 'auth') return { stderr: SAMPLES.noLoginAuthStatus, code: 1 }
      if (args[0] === 'api' && args[1] === 'user') return { stderr: SAMPLES.noLoginApiUser, code: 4 }
      if (args[0] === 'api') return { stderr: SAMPLES.noLoginApiUser, code: 4 }
      return new Error('unexpected gh command: ' + args.join(' '))
    })
    check(r.reply.kind === 'auth', '二、结论仍是确定没登录（auth）', JSON.stringify(r.reply))
    check(r.verdict.status === 'fail', '二、链上登录态判 fail', r.verdict.detail)
    check(!!r.banner && r.banner.text === 'banner.ghauth', '二、横幅仍是缺登录那句', JSON.stringify(r.banner))
    check(!!r.missing && r.missing.type === 'inject' && r.missing.prompt === 'ghAuthLogin', '二、按钮仍注入登录指引', JSON.stringify(r.missing))
  }

  console.log('== 三、auth status 只是闪了一下、核对接口通 → 登录是好的，横幅不该出现 ==')
  {
    const r = await runChain((args) => {
      if (args[0] === 'auth') return { stderr: SAMPLES.proxyAuthStatus, code: 1 }
      if (args[0] === 'api' && args[1] === 'user') return { stdout: 'FeatherHunter\n', code: 0 }
      if (args[0] === 'api') return { stdout: '{"id":1,"name":"dsh-mattpocock-skills-deck"}', code: 0 }
      return new Error('unexpected gh command: ' + args.join(' '))
    })
    check(r.reply.stage === 'pass', '三、第二关按过处理，三关全过', JSON.stringify(r.reply))
    check(r.verdict.status === 'pass' && r.state === 'done', '三、链上登录态判 pass', r.verdict.detail)
    // guide-banner 只在 step 还没做完时展示：登录那一步判完成（done）之后上游不再画横幅，
    // 所以这里断言的是步骤状态而不是 guideBannerOf 的返回值（它对已完成的步骤仍会交出配好的那条）。
    check(r.state === 'done', '三、登录那一步判完成 —— 做完了的步骤不展示横幅，这条黄条不会出现', r.state)
    check(r.reasonsOfReadDegraded.indexOf('preflight:auth') < 0, '三、第二关过了就不记「登录态没读成」的降级行（它不算失败）', JSON.stringify(r.reasonsOfReadDegraded))
  }

  console.log('== 四、auth status 本身已是网络档（本地超时）→ 不再多问一次接口 ==')
  {
    const r = await runChain((args) => {
      if (args[0] === 'auth') return new Error('timeout of 15000ms exceeded')
      if (args[0] === 'api' && args[1] === 'user') return { stdout: 'FeatherHunter\n', code: 0 }
      if (args[0] === 'api') return { stdout: '{"id":1}', code: 0 }
      return new Error('unexpected gh command: ' + args.join(' '))
    })
    check(r.reply.kind === 'network', '四、结论是网络档', JSON.stringify(r.reply))
    check(r.verdict.status === 'pending', '四、链上判「暂时确认不了」', r.verdict.detail)
    check(!!r.banner && r.banner.text === 'banner.ghauthUnknown', '四、中性横幅', JSON.stringify(r.banner))
    check(r.calls.length === 1, '四、网络档不再多问一次接口（离线时不白等一个读档超时）', JSON.stringify(r.calls))
  }

  console.log('== 五、核对接口回 401 bad credentials → 仍是真凭据失效 ==')
  {
    const r = await runChain((args) => {
      if (args[0] === 'auth') return { stderr: SAMPLES.proxyAuthStatus, code: 1 }
      if (args[0] === 'api' && args[1] === 'user') return { stderr: SAMPLES.badCredentialsApiUser, code: 1 }
      if (args[0] === 'api') return { stderr: SAMPLES.badCredentialsApiUser, code: 1 }
      return new Error('unexpected gh command: ' + args.join(' '))
    })
    check(r.reply.kind === 'auth', '五、结论是确定没登录（auth）', JSON.stringify(r.reply))
    check(r.verdict.status === 'fail' && !!r.banner && r.banner.text === 'banner.ghauth', '五、仍出缺登录那句与登录指引', JSON.stringify(r.banner))
  }

  console.log('== 六、三关全过时不多花一条请求 ==')
  {
    const r = await runChain((args) => {
      if (args[0] === 'auth') return { code: 0 }
      if (args[0] === 'api') return { stdout: '{"id":1}', code: 0 }
      return new Error('unexpected gh command: ' + args.join(' '))
    })
    check(r.reply.stage === 'pass' && r.verdict.status === 'pass', '六、登录态判 pass', JSON.stringify(r.reply))
    check(!r.calls.find((c) => c[0] === 'api' && c[1] === 'user'), '六、auth status 成功时不做核对（正常路径不多一条请求）', JSON.stringify(r.calls))
  }

  if (failed) {
    console.log('\n916 AUTH CROSSCHECK TESTS FAILED（共 ' + total + ' 条断言）')
    process.exit(1)
  }
  console.log('\n916 AUTH CROSSCHECK TESTS PASSED（共 ' + total + ' 条断言）')
}

main().catch((e) => { console.log('FAIL 判断链跑不起来：' + String((e && e.stack) || e)); process.exit(1) })
