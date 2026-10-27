/**
 * tests/verify-1583-repo-ref-fallback.ts —— 会话仓库身份补齐的四步级联必须对每一种后端都成立（#1583）。
 *
 * 病根：#1581 修好本地 Markdown 之后，刷新后台补仓库身份的那段代码仍把「远端定位」写死成
 * 「只给 GitHub 问」（src/refresh/rooms/host/session-opener.ts 旧代码 `if (backendId !== 'github') return ref`），
 * 而 GitLab 的 describe 在只给目录时同样答不出 refId。结果手动选过 GitLab 的工作区开会话拿到的身份
 * refId 为空，详情页报「无法解析目标仓库（refId missing）」——与 #1581 是同一个缺口在另一种后端上的暴露。
 * 同时 deck 工具的接线层（src/deck/tools/tracker-session.ts）各写了一份补全：只问 getRepoKey、
 * 自己把域名拼成 github.com。两份实现都偏离了契约：仓库身份只该由后端回答。
 *
 * 本门禁钉住共享实现 src/tracker/session/repo-ref.ts 的四步级联（用假会话逐支验证，不需要注册表）：
 *   ① 判定出口自带 refId → 原样交回，不花任何额外动作；
 *   ② describe 能答出 refId（Markdown 口径）→ 用它，不问远端；
 *   ③ describe 只答出壳（GitHub / GitLab 口径）→ 问会话 getRepoKey，拿到 owner/name 后再问 describe，
 *      最终 url 与 backend 由后端自己写（GitHub 得 github.com、GitLab 得 gitlab.com，装配层不拼域名）；
 *   ④ 任何一步抛错 / 远端答不上 / 后端根本没有 getRepoKey → 收成 steps 里的诊断与诚实空值，不抛异常。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1583-repo-ref-fallback.ts
 *
 * 门禁归属: src/tracker/session/repo-ref.ts
 * 门禁归属: src/refresh/rooms/host/session-opener.ts
 * 门禁归属: src/deck/tools/tracker-session.ts
 */
import { resolveSessionRepoRef } from '../src/tracker/session/repo-ref.ts'

let failed = false
let passed = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) { passed += 1; console.log('  PASS ' + msg) } else { failed = true; console.log('  FAIL ' + msg) }
}

/** 假会话：只装本门禁要用的两步定位口，并记下每次被问时的入参。 */
function makeSession(parts: {
  describe?: (handle: any, backendId: string) => any
  getRepoKey?: (cwd: string, ctx: any) => Promise<any>
}): { session: any; calls: { describe: any[]; remote: any[] } } {
  const calls = { describe: [] as any[], remote: [] as any[] }
  const session: any = {}
  if (parts.describe) session.describe = (handle: any, backendId: string): any => { calls.describe.push({ handle, backendId }); return parts.describe!(handle, backendId) }
  if (parts.getRepoKey) session.getRepoKey = async (cwd: string, ctx: any): Promise<any> => { calls.remote.push({ cwd, ctx }); return parts.getRepoKey!(cwd, ctx) }
  return { session, calls }
}

/** 每一步的名字与成功与否，拼成一行便于在失败信息里直接看出走到哪一步。 */
function stepsLine(resolved: any): string {
  return (resolved.steps || []).map((s: any) => s.step + ':' + (s.ok ? 'ok' : 'fail') + (s.error ? '(' + s.error + ')' : '')).join(',')
}

async function main(): Promise<void> {
  // —— ① 判定出口自带 refId：直接用，连 describe 都不问 ——
  {
    const { session, calls } = makeSession({
      describe: () => { throw new Error('不该被叫：判定已经带了身份') },
    })
    const selectionRef = { backend: 'gitlab', refId: 'group/project', name: 'group/project', url: 'https://gitlab.com/group/project' }
    const resolved: any = await resolveSessionRepoRef({
      session, cwd: '/ws/repo', backendId: 'gitlab', fromSelection: selectionRef as any, caller: 'deck-tool',
    })
    check(resolved.via === 'selection' && resolved.ref && resolved.ref.refId === 'group/project' && resolved.steps.length === 0,
      '判定自带 refId 时原样交回、零步骤（实得 via=' + resolved.via + ' / steps=' + stepsLine(resolved) + '）')
    check(calls.describe.length === 0, '判定自带身份时不再问 describe（实得 ' + calls.describe.length + ' 次）')
  }

  // —— ② describe 能答出 refId（本地 Markdown 口径）：用它，不问远端 ——
  {
    const workspace = '/ws/deck-md'
    const { session, calls } = makeSession({
      describe: (handle: any, backendId: string) => ({
        backend: backendId, refId: handle.cwd, name: 'deck-md', url: '',
      }),
    })
    const resolved: any = await resolveSessionRepoRef({ session, cwd: workspace, backendId: 'markdown', caller: 'refresh' })
    check(resolved.via === 'describe', 'Markdown 口径：describe 答出目录身份（实得 via=' + resolved.via + ' / ' + stepsLine(resolved) + '）')
    check(resolved.ref && resolved.ref.refId === workspace && resolved.ref.backend === 'markdown',
      'Markdown 身份来自 describe，refId 是工作区目录，backend 原样（实得 ' + JSON.stringify(resolved.ref) + '）')
    check(calls.remote.length === 0, 'describe 已经答出 refId 时不再问远端（实得 ' + calls.remote.length + ' 次）')
    check(calls.describe.length === 1 && calls.describe[0].backendId === 'markdown',
      'describe 只问一次，第二格缺省成选中的后端（实得 ' + JSON.stringify(calls.describe) + '）')
  }

  // —— ③ GitHub 口径：describe 只给壳 → getRepoKey 出 owner/name → 再 describe 得完整身份（url 由后端写） ——
  {
    const cwd = '/ws/github-repo'
    const { session, calls } = makeSession({
      describe: (handle: any, backendId: string) => {
        const refId = (handle && typeof handle.refId === 'string') ? handle.refId : ''
        return { backend: backendId, refId, name: refId || 'repo', url: refId ? 'https://github.com/' + refId : '' }
      },
      getRepoKey: async () => ({ owner: 'Octo', name: 'Repo', usage: { requests: 1, points: 0 } }),
    })
    const resolved: any = await resolveSessionRepoRef({
      session, cwd, backendId: 'github', baseCtx: { marker: 'base-ctx' }, caller: 'deck-tool',
    })
    check(resolved.via === 'remote-locate' && resolved.ref && resolved.ref.refId === 'Octo/Repo',
      'GitHub 口径：远端定位拿到 owner/name 并补齐 refId（实得 ' + JSON.stringify(resolved.ref) + ' / ' + stepsLine(resolved) + '）')
    check(resolved.ref && resolved.ref.url === 'https://github.com/Octo/Repo' && resolved.ref.backend === 'github',
      '完整身份的 url 与 backend 由 GitHub 后端自己写（实得 ' + JSON.stringify(resolved.ref) + '）')
    check(stepsLine(resolved) === 'describe:fail,remote-locate:ok,describe-after-remote:ok',
      '三步诊断按顺序记下（实得 ' + stepsLine(resolved) + '）')
    check(calls.remote.length === 1 && calls.remote[0].cwd === cwd,
      '远端定位口第一格是仓库路径字符串（实得 ' + JSON.stringify(calls.remote[0] || null) + '）')
    check(calls.remote[0] && calls.remote[0].ctx && calls.remote[0].ctx.cwd === cwd && calls.remote[0].ctx.caller === 'deck-tool' && calls.remote[0].ctx.marker === 'base-ctx',
      '远端定位口的操作上下文带 cwd / caller，并继承调用方给的基础上下文（实得 ' + JSON.stringify(calls.remote[0] && calls.remote[0].ctx) + '）')
    check(calls.describe.length === 2 && calls.describe[1].handle && calls.describe[1].handle.refId === 'Octo/Repo',
      '第二次 describe 把 owner/name 当 handle.refId 再问一次（实得 ' + JSON.stringify(calls.describe[1] || null) + '）')
  }

  // —— ④ GitLab 口径：同样三步，但 url 是 gitlab.com —— 证明装配层没有写死哪家域名 ——
  {
    const { session } = makeSession({
      describe: (handle: any, backendId: string) => {
        const refId = (handle && typeof handle.refId === 'string') ? handle.refId : ''
        return { backend: backendId, refId, name: refId || 'project', url: refId ? 'https://gitlab.com/' + refId : '' }
      },
      getRepoKey: async () => ({ owner: 'example', name: 'project' }),
    })
    const resolved: any = await resolveSessionRepoRef({ session, cwd: '/ws/gl', backendId: 'gitlab', caller: 'refresh' })
    check(resolved.via === 'remote-locate' && resolved.ref && resolved.ref.refId === 'example/project',
      'GitLab 口径：远端定位同样被允许，不再被「只给 GitHub 问」挡住（实得 ' + JSON.stringify(resolved.ref) + ' / ' + stepsLine(resolved) + '）')
    check(resolved.ref && resolved.ref.url === 'https://gitlab.com/example/project',
      'GitLab 的 url 由 GitLab 后端自己写，装配层没有拼成 github.com（实得 ' + JSON.stringify(resolved.ref && resolved.ref.url) + '）')
  }

  // —— ⑤ describe 抛错：收成一步失败诊断，继续往下走；后面没有远端就诚实回「没补全」 ——
  {
    const { session } = makeSession({
      describe: () => { throw new Error('describe 实现坏了') },
    })
    const resolved: any = await resolveSessionRepoRef({ session, cwd: '/ws/broken', backendId: 'github', caller: 'refresh' })
    check(resolved.via === 'none' && resolved.ref === null,
      'describe 抛错时如实回「没补全」、ref 为 null（实得 via=' + resolved.via + ' / ref=' + JSON.stringify(resolved.ref) + '）')
    const step: any = (resolved.steps || [])[0] || {}
    check(step.step === 'describe' && step.ok === false && typeof step.error === 'string' && step.error.indexOf('describe 实现坏了') >= 0,
      '抛错原因写进 describe 那一步的诊断（实得 ' + JSON.stringify(step) + '）')
  }

  // —— ⑥ 远端定位抛错：同样只记诊断，不把异常漏给调用方 ——
  {
    const { session } = makeSession({
      describe: () => ({ backend: 'gitlab', refId: '', name: 'project', url: '' }),
      getRepoKey: async () => { throw new Error('glab 起不来') },
    })
    const resolved: any = await resolveSessionRepoRef({ session, cwd: '/ws/gl-broken', backendId: 'gitlab', caller: 'refresh' })
    check(resolved.via === 'none', '远端定位抛错时回「没补全」（实得 via=' + resolved.via + '）')
    check(stepsLine(resolved).indexOf('remote-locate:fail(glab 起不来)') >= 0,
      '抛错原因写进 remote-locate 那一步（实得 ' + stepsLine(resolved) + '）')
    check(resolved.ref && resolved.ref.refId === '' && resolved.ref.name === 'project',
      '失败时仍把 describe 拿到的壳交回去（refId 为空，调用方照旧诚实失败，实得 ' + JSON.stringify(resolved.ref) + '）')
  }

  // —— ⑦ 远端被管线拒绝（ok:false 的失败形状）：按「没定位到」处理，不当成 owner 是对象 ——
  {
    const { session, calls } = makeSession({
      describe: () => ({ backend: 'github', refId: '', name: 'repo', url: '' }),
      getRepoKey: async () => ({ ok: false, error: { kind: 'ratelimit', message: '预算不足，本次调用推迟' } }),
    })
    const resolved: any = await resolveSessionRepoRef({ session, cwd: '/ws/gated', backendId: 'github', caller: 'refresh' })
    check(resolved.via === 'none' && resolved.ref && resolved.ref.refId === '',
      '远端被管线拒绝时按「没定位到」处理（实得 via=' + resolved.via + ' / ' + stepsLine(resolved) + '）')
    check(calls.remote.length === 1 && calls.describe.length === 1,
      '拒绝后不再问第二次 describe（实得 describe ' + calls.describe.length + ' 次 / 远端 ' + calls.remote.length + ' 次）')
  }

  // —— ⑧ 再问 describe 仍答不出完整身份：退最小身份，url 留空，不拿别的域名冒充 ——
  {
    const { session } = makeSession({
      describe: (handle: any, backendId: string) => ({ backend: backendId, refId: '', name: 'project', url: '' }),
      getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
    })
    const resolved: any = await resolveSessionRepoRef({ session, cwd: '/ws/min', backendId: 'gitlab', caller: 'refresh' })
    check(resolved.via === 'remote-locate' && resolved.ref && resolved.ref.refId === 'acme/demo',
      '后端答不上完整身份时仍交出 refId（实得 ' + JSON.stringify(resolved.ref) + ' / ' + stepsLine(resolved) + '）')
    check(resolved.ref && resolved.ref.url === '' && resolved.ref.name === 'acme/demo',
      '最小身份 url 留空、不拼别人域名（实得 ' + JSON.stringify(resolved.ref) + '）')
    check(stepsLine(resolved).indexOf('describe-after-remote:fail') >= 0,
      '第二次 describe 的失败也记进诊断（实得 ' + stepsLine(resolved) + '）')
  }

  // —— ⑨ 会话根本没有 getRepoKey 这条能力（本地 Markdown 口径）：不假装问过 ——
  {
    const { session } = makeSession({
      describe: () => ({ backend: 'markdown', refId: '', name: 'ws', url: '' }),
    })
    const resolved: any = await resolveSessionRepoRef({ session, cwd: '/ws/md-no-key', backendId: 'markdown', caller: 'refresh' })
    check(resolved.via === 'none' && resolved.ref && resolved.ref.refId === '',
      '没有 getRepoKey 时诚实回「没补全」（实得 via=' + resolved.via + ' / ' + JSON.stringify(resolved.ref) + '）')
    check(stepsLine(resolved) === 'describe:fail', '不假装问过远端：steps 里只有 describe 一步（实得 ' + stepsLine(resolved) + '）')
  }

  // —— ⑩ 永不抛：连属性读取都炸的会话也只收成诊断 ——
  {
    const throwingSession: any = new Proxy({}, {
      get: () => { throw new Error('会话对象的读取被炸掉了') },
    })
    let threw = false
    let resolved: any = null
    try {
      resolved = await resolveSessionRepoRef({ session: throwingSession, cwd: '/ws/boom', backendId: 'github', caller: 'refresh' })
    } catch (e) {
      threw = true
    }
    check(!threw, '会话对象连属性读取都抛错时，补齐函数仍不抛（实得 ' + (threw ? '抛了' : '没抛') + '）')
    check(resolved && resolved.via === 'none' && (resolved.steps || []).length >= 1,
      '这种情况下如实回「没补全」并留下诊断（实得 ' + JSON.stringify(resolved) + '）')
  }

  console.log(failed ? ('\n' + (passed + 1) + ' 条断言，失败') : ('\n' + passed + ' 条断言，全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: any): void => { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
