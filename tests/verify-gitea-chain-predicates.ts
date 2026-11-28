#!/usr/bin/env node
// tests/verify-gitea-chain-predicates.ts —— 门禁：Gitea 检查链的四行在宿主里真的注册了、判定也对（2026-11-11 补齐 gitea 后端环境检查）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-gitea-chain-predicates.ts
//
// 这一票修的现象：GitHub 后端环境检查 10/10、Gitea 后端只有 6/6 —— 检查目录里 Gitea 缺了
// 四项后端专属检查（已关联仓库 / 已安装 / 已登录 / 仓库可达），宿主里对应谓词一条没注册。
//
// 门禁盯七件事：
//   ① Gitea 目录里每一项 backend/preflight 检查，宿主都得有对应的注册键 —— 以后再加检查项忘了注册直接判红；
//   ② 判定函数的分档：网络类失败 / 命令找不到不许判成「未登录」，本地认不出仓库地址时不许说「仓库可达」，
//     远端列表读不到时按 pending「读不到本地仓库信息」处理，不冒充「没有远端」；
//   ③ 真跑一遍链求值（假会话 + 假 tea）：未装、未登录、仓库 404、网络超时、全过，五种情形四行的状态与文案；
//   ④ 失败行带着修复入口（安装指引 / 登录指引），提示词已解析成正文而不是内部键名；
//   ⑤ 仓库身份走会话的 getRepoKey 能力，handle 带上 backend 与 refId；
//   ⑥ 「已关联 Gitea 仓库」的判据是远端地址里有指向 gitea/forgejo 的那一条（与房间 matches 同源）；
//   ⑦ 会话没接上时四行都 pending，求值本身照旧成功（只降级不抛）。
// 门禁归属: src/refresh/rooms/host/check-chain-evaluation.ts
// 门禁归属: src/refresh/rooms/host/gitea-chain-predicates.ts
// 门禁归属: src/refresh/rooms/host/chain-env-map.ts
// 门禁归属: src/refresh/rooms/host/git-execution.ts
// 门禁归属: src/shared/tracker/check-catalog-dirs.ts
// 门禁归属: src/tracker/rooms/gitea/index.ts
// 门禁归属: src/tracker/rooms/gitea/preflight.ts
const nodePath = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total += 1
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

/** 本次求值的目录（假的即可：链求值不要求目录真的存在）。 */
const DEMO_CWD = 'D:/demo-gitea'
/** 假平台：Gitea 四行的第一关是「找得到 tea 吗」，这里按场景决定答案。 */
function makePlatform(exe) {
  return {
    marker: 'session-platform',
    os: 'win32',
    path: nodePath,
    async getHome() { return 'C:/Users/fake' },
    async resolveExecutable(name) { return name === 'tea' ? exe : null },
  }
}
/** 假 tea 执行器：记下每次调用，按场景给回包（抛异常也算一种回包）。 */
function makeTeaExec(handler) {
  const calls = []
  const exec = async function (cmd, args, opts) {
    calls.push({ cmd: cmd, args: args, opts: opts })
    return handler(cmd, args)
  }
  Object.assign(exec, { marker: 'session-exec' })
  return { exec: exec, calls: calls }
}
/** 假会话：preflight 直接交给 Gitea 房间的真实现（假的是它拿到的平台与执行器）。 */
function makeSession(preflightFn, repoKeyReply) {
  const stats = { preflight: 0, getRepoKey: 0, getCurrentUser: 0 }
  const handles = []
  const ctxs = []
  const repoKeyCalls = []
  const session = {
    async preflight(handle, ctx) {
      stats.preflight += 1
      handles.push(handle)
      ctxs.push(ctx)
      return preflightFn(handle, ctx)
    },
    async getRepoKey(cwd, ctx) {
      stats.getRepoKey += 1
      repoKeyCalls.push({ cwd: cwd, ctx: ctx })
      return repoKeyReply
    },
    async getCurrentUser(repo, ctx) {
      stats.getCurrentUser += 1
      return { ok: false }
    },
  }
  return { session: session, stats: stats, handles: handles, ctxs: ctxs, repoKeyCalls: repoKeyCalls }
}
/** 开会话成功那一份：call(fn) 把假会话与这次的操作上下文交给能力函数（与 session-opener 的回包同形）。 */
function openReplyOf(session, ctx) {
  return async function () {
    return { ok: true, backendId: 'gitea', budget: {}, call: function (fn) { return fn(session, ctx) } }
  }
}
/** 一条最小检查链：探测直接回 Gitea，退避恒说「该算」，其余依赖都按测试口径给最少的答复。 */
function makeChain(mods, opts) {
  const o = opts || {}
  return mods.chainMod.createDetectChain({
    canonicalKey: async (raw) => String(raw || ''),
    DEFAULT_CWD: DEMO_CWD,
    resetGhCache: () => {},
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'gitea', source: 'auto' } }) }),
    getPlatform: async () => o.platform,
    getTrackerRegistry: async () => ({ modules: () => [{ id: 'gitea', fixes: mods.giteaMod.fixes, prompts: mods.giteaMod.prompts }] }),
    getRepoKey: async () => null,
    getRemoteUrls: (o.getRemoteUrls === undefined) ? null : o.getRemoteUrls,
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
    probeSkill: async () => ({ ok: true, level: 'ok', detail: 'fake' }),
    mdPredicate: async () => ({ status: 'pass', detail: 'fake' }),
    getChainCache: () => null,
    setChainCache: () => {},
    getChainBackoff: async () => ({
      verdict: async () => ({ needed: true, reason: 'test-always-due', waitMs: 0, cached: null }),
      note: async () => ({}),
    }),
    logCtx: null,
    gate: null,
    openSession: o.openSession === undefined ? null : o.openSession,
  })
}

/** 取后端链上某一项的判定与步骤视图（行 id 就是检查目录里的 id）。 */
function resolvedOf(out, id) {
  const pack = out && out.backendChain
  const r = pack && pack.resolved && pack.resolved[id]
  return r || null
}
function stepOf(out, id) {
  const pack = out && out.backendChain
  const steps = (pack && pack.snapshot && pack.snapshot.steps) || []
  return steps.find(function (s) { return s.id === id }) || null
}
/** 这一趟回包里不许出现那句英文内部串（界面不能再见到 predicate not registered）。 */
function hasInternalString(out) {
  try { return JSON.stringify([out && out.backendChain, out && out.fullSnapshot]).indexOf('predicate not registered') >= 0 } catch (e) { return true }
}

/** 跑一次链求值：按场景拼平台、执行器、会话与远端读法，返回回包与记录下来的调用。 */
async function evaluateScenario(mods, opts) {
  const o = opts || {}
  const exe = o.teaPath === undefined ? 'C:/fake/tea' : o.teaPath
  const platform = makePlatform(exe)
  const execPack = makeTeaExec(o.execHandler || function () {
    // 2026-11-11 实测：tea 有登录时 `login list` 打印的是一张带一条数据行的表格（不是裸单行）。
    return { code: 0, stdout: '┌─────────┬────────────────────────┬──────────┬───────┬─────────┐\n│ NAME    │ URL                    │ SSH HOST │ USER  │ DEFAULT │\n├─────────┼────────────────────────┼──────────┼───────┼─────────┤\n│ server-1 │ https://gitea.example.com │          │ demo  │ true    │\n└─────────┴────────────────────────┴──────────┴───────┴─────────┘\n', stderr: '' }
  })
  const sessionCtx = { cwd: 'C:/stale', caller: 'refresh', platform: platform, exec: execPack.exec }
  const repoKey = o.repoKeyReply === undefined ? { owner: 'group', name: 'proj' } : o.repoKeyReply
  const fx = makeSession(mods.teaPreflight, repoKey)
  const chain = makeChain(mods, {
    platform: platform,
    getRemoteUrls: (o.getRemoteUrls === undefined) ? async function () { return null } : o.getRemoteUrls,
    openSession: o.openSession === null ? null : openReplyOf(fx.session, sessionCtx),
  })
  const out = await chain.handleChain({ cwd: DEMO_CWD, backendId: 'gitea', lang: 'zh', force: true })
  return { out: out, fx: fx, exec: execPack, sessionCtx: sessionCtx }
}

/** 有登录时 `login list` 的真实形状：一张带一条数据行的表格（2026-11-11 实测）。 */
const TABLE_WITH_LOGIN = '┌──────────┬─────────────────────────┬──────────┬───────┬─────────┐\n│ NAME     │ URL                     │ SSH HOST │ USER  │ DEFAULT │\n├──────────┼─────────────────────────┼──────────┼───────┼─────────┤\n│ server-1 │ https://gitea.example.com │          │ demo  │ true    │\n└──────────┴─────────────────────────┴──────────┴───────┴─────────┘\n'

async function main() {
  const mods = {
    catMod: await import(url('src/shared/tracker/check-catalog-dirs.ts')),
    envMod: await import(url('src/refresh/rooms/host/chain-env-map.ts')),
    chainMod: await import(url('src/refresh/rooms/host/check-chain-evaluation.ts')),
    preflightMod: await import(url('src/tracker/rooms/gitea/preflight.ts')),
    giteaMod: await import(url('src/tracker/rooms/gitea/index.ts')),
  }
  mods.teaPreflight = mods.preflightMod.teaPreflight

  title('① Gitea 目录里每一项 backend/preflight 检查，宿主都有对应的注册键')
  {
    // 2026-11-11 起 gitea 三条谓词拆在 gitea-chain-predicates.ts（行数颗粒度门禁挤不进主文件），
    //   扫描范围跟着改为两份源文件拼起来，防漏口径不变。
    const src = ['src/refresh/rooms/host/check-chain-evaluation.ts', 'src/refresh/rooms/host/gitea-chain-predicates.ts']
      .map(function (rel) { return fs.readFileSync(nodePath.join(ROOT, rel), 'utf8') }).join('\n')
    const registered = new Set()
    const re = /registry\.register\(\s*['"]([^'"]+)['"]/g
    let m = re.exec(src)
    while (m) { registered.add(m[1]); m = re.exec(src) }
    must(registered.size >= 11, '从求值文件与谓词文件里至少认出 11 条注册（解析失效时本节其余断言会假绿）', '只认出 ' + registered.size + ' 条')
    const items = mods.catMod.catalogFor('gitea').filter(function (c) { return c.scope === 'backend' })
    must(items.length === 4, 'gitea 的后端目录有四项（与其他后端对称）', '只有 ' + items.length + ' 项')
    for (const it of items) {
      const check = it.check || {}
      let key = null
      if (check.kind === 'backend') key = 'backend:' + check.backendId + ':' + check.id
      else if (check.kind === 'preflight') key = 'preflight:' + check.id
      if (!key) continue // primitive 由原语执行器直接跑，不需要注册键
      must(registered.has(key), 'gitea 的 ' + it.id + ' 有注册键 ' + key, '注册表里没有 ' + key)
    }
    must(mods.catMod.catalogFor('gitea').length === 9, 'gitea 的完整目录是 9 项（5 通用 + 4 后端专属）', String(mods.catMod.catalogFor('gitea').length))
    must(registered.has('preflight:teaAuth'), '「已登录 Gitea」那一项的键 preflight:teaAuth 已注册', '没注册')
    must(registered.has('backend:gitea:repoAccess'), '「仓库在 Gitea 上可访问」那一项的键 backend:gitea:repoAccess 已注册', '没注册')
    must(registered.has('backend:gitea:repoRemote'), '「已关联 Gitea 仓库」那一项的键 backend:gitea:repoRemote 已注册', '没注册')
  }

  title('② 判定函数：网络故障不误报未登录，读不到远端不说没有远端')
  {
    const envMod = mods.envMod
    must(envMod.teaAuthVerdict({ stage: 'auth', kind: 'auth', message: 'no token' }, true).status === 'fail', '明确未登录（kind=auth）才判失败', JSON.stringify(envMod.teaAuthVerdict({ stage: 'auth', kind: 'auth', message: 'no token' }, true)))
    must(envMod.teaAuthVerdict({ stage: 'auth', kind: 'network', message: 'ETIMEDOUT' }, true).status === 'pending', '网络档（kind=network）判 pending，不判未登录', 'fail')
    must(envMod.teaAuthVerdict({ stage: 'gh' }, true).status === 'pending', '没找到 tea 可执行时判 pending', 'fail')
    must(envMod.teaRepoAccessVerdict({ stage: 'pass', refId: 'group/proj' }, true).status === 'pass', '接口调通且拿 refId 核对过才判可达', 'pending')
    must(envMod.teaRepoAccessVerdict({ stage: 'pass', refId: '' }, true).status === 'pending', '没 refId 时房间会跳过第三关回成功，判定要如实 pending', 'pass')
    must(String(envMod.teaRepoAccessVerdict({ stage: 'pass', refId: '' }, true).detail || '').indexOf('本地认不出') >= 0, 'pending 说明写明「本地认不出」', String(envMod.teaRepoAccessVerdict({ stage: 'pass', refId: '' }, true).detail))
    must(envMod.teaRepoAccessVerdict({ stage: 'repo', kind: 'not-found' }, true).status === 'fail', '确定 404 才判失败', 'pending')
    must(envMod.teaRepoAccessVerdict({ stage: 'auth', kind: 'auth' }, true).status === 'pending', '登录失败不把仓库显示成不可达', 'fail')
    const failText = String((envMod.teaAuthVerdict({ stage: 'auth', kind: 'auth', message: 'no token' }, true).detail) || '')
    must(/[\u4e00-\u9fa5]/.test(failText), '中文界面的失败文案是中文', failText)
    must(failText.indexOf('predicate not registered') < 0, '失败文案里没有那句英文内部串', failText)
    // 远端证据读法：null 两条路都读不到 → read 回 null（调用方 pending）；有 gitea 地址 → identity；没有 → none。
    const ev = envMod.createGiteaRemoteEvidence({ getRemoteUrls: async function () { return null } })
    must((await ev.read(DEMO_CWD)) === null, '远端列表读不到时证据回 null（调用方按 pending 处理）', JSON.stringify(await ev.read(DEMO_CWD)))
    const evHit = envMod.createGiteaRemoteEvidence({ getRemoteUrls: async function () { return ['https://gitea.example.com/group/proj.git'] } })
    const hit = await evHit.read(DEMO_CWD)
    must(!!hit && hit.kind === 'identity' && hit.owner === 'group' && hit.name === 'proj', 'gitea 地址解析出 owner/name', JSON.stringify(hit))
    const evMiss = envMod.createGiteaRemoteEvidence({ getRemoteUrls: async function () { return ['https://github.com/group/proj.git'] } })
    const miss = await evMiss.read(DEMO_CWD)
    must(!!miss && miss.kind === 'none', '只有 github 地址时判「没有 gitea 远端」', JSON.stringify(miss))
    must(String(evMiss.failDetail(miss, true)).indexOf('Gitea/Forgejo') >= 0, 'fail 话术说清查过 git remote 与 .git/config', String(evMiss.failDetail(miss, true)))
    must(String(ev.unknownDetail(true)).indexOf('读不到本地仓库信息') >= 0, 'pending 话术是「读不到本地仓库信息」，不冒充没有远端', String(ev.unknownDetail(true)))
  }

  title('③ 真跑链求值：没装 tea → 登录与可达两行 pending，「已安装」行红并带安装指引')
  {
    const r = await evaluateScenario(mods, { teaPath: null })
    must(resolvedOf(r.out, 'tea:authed') && resolvedOf(r.out, 'tea:authed').status === 'pending', '没装 tea 时「已登录 Gitea」pending（诚实未知）', JSON.stringify(resolvedOf(r.out, 'tea:authed')))
    must(resolvedOf(r.out, 'tea:repoAccess') && resolvedOf(r.out, 'tea:repoAccess').status === 'pending', '没装 tea 时「仓库在 Gitea 上可访问」pending', JSON.stringify(resolvedOf(r.out, 'tea:repoAccess')))
    must(!hasInternalString(r.out), '整个回包里没有 predicate not registered 那句英文内部串')
    const inst = stepOf(r.out, 'tea:installed')
    must(inst && inst.status === 'current', '「tea 已安装」行判红并带修复动作（current）', JSON.stringify(inst && inst.status))
    must(inst && String((inst.show || {}).hint || '').indexOf('PATH') >= 0, '失败说明解释了找不到 tea 的原因（继承的 PATH）', JSON.stringify(inst && inst.show))
    const instInject = ((inst && inst.actions) || []).find(function (a) { return a && a.type === 'inject-prompt' }) || null
    must(instInject && instInject.label === '安装指引', '这一行挂着「安装指引」按钮', JSON.stringify(instInject))
    must(instInject && String(instInject.prompt || '').indexOf('gitea.com/gitea/tea') >= 0, '安装指引提示词已解析成正文（官方安装页地址），不是内部键名', String(instInject && instInject.prompt).slice(0, 80))
    must(r.exec.calls.length === 0, '没装 tea 时没有起过任何 tea 进程', '起了 ' + r.exec.calls.length + ' 次')
    must(r.fx.stats.preflight === 1, '三行共用一次 preflight（一次求值只问一次环境）', 'preflight=' + r.fx.stats.preflight)
  }

  title('④ 装了没登录（login list 空）→ 登录行红并带登录指引，仓库那行仍 pending')
  {
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'list') return { code: 0, stdout: '', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    must(resolvedOf(r.out, 'tea:authed') && resolvedOf(r.out, 'tea:authed').status === 'fail', 'login list 为空（无凭据）时「已登录 Gitea」判失败', JSON.stringify(resolvedOf(r.out, 'tea:authed')))
    must(resolvedOf(r.out, 'tea:repoAccess') && resolvedOf(r.out, 'tea:repoAccess').status === 'pending', '登录失败不把仓库显示成不可达', JSON.stringify(resolvedOf(r.out, 'tea:repoAccess')))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
    const step = stepOf(r.out, 'tea:authed')
    must(step && step.status === 'current', '失败行带修复动作（current）', JSON.stringify(step && step.status))
    must(step && String((step.show || {}).hint || '').indexOf('重新登录') >= 0, '失败说明写明登录态不可用要重新登录', JSON.stringify(step && step.show))
    const actions = (step && step.actions) || []
    const inject = actions.find(function (a) { return a && a.type === 'inject-prompt' }) || null
    must(!!inject, '带一个注入提示词的动作（登录指引按钮）', JSON.stringify(actions.map(function (a) { return a && a.type })))
    must(inject && inject.label === '登录指引', '按钮标签是中文「登录指引」', JSON.stringify(inject && inject.label))
    must(inject && String(inject.prompt || '').indexOf('tea login add') >= 0, '提示词已解析成正文（含 tea login add），不是内部键名', String(inject && inject.prompt).slice(0, 80))
    must(stepOf(r.out, 'tea:installed') && stepOf(r.out, 'tea:installed').status === 'done', 'tea 已装那一行是绿的', JSON.stringify(stepOf(r.out, 'tea:installed') && stepOf(r.out, 'tea:installed').status))
  }

  title('④b 登出后的真实形状（login list 打印空表边框、issues ls 说 no available login）→ 登录行红并带登录指引，不许误报网络异常')
  {
    // 2026-11-11 实测：tea 零登录时 `login list` 退出码 0、打印只有表头边框的空表格；
    //   后续 `issues ls` 退出码 1、原话 `Error: no available login`。两条都要接住：
    //   空表不许算「有登录」（假绿），`no available login` 不许落兜底网络档（面板才会出登录按钮）。
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'list') {
          return { code: 0, stdout: '┌──────┬─────┬──────────┬──────┬─────────┐\n│ NAME │ URL │ SSH HOST │ USER │ DEFAULT │\n└──────┴─────┴──────────┴──────┴─────────┘\n', stderr: '' }
        }
        return { code: 1, stdout: '', stderr: 'Error: no available login' }
      },
    })
    must(resolvedOf(r.out, 'tea:authed') && resolvedOf(r.out, 'tea:authed').status === 'fail', 'login list 只打印空表边框时「已登录 Gitea」仍判失败（不许假绿）', JSON.stringify(resolvedOf(r.out, 'tea:authed')))
    must(String(resolvedOf(r.out, 'tea:authed').detail || '').indexOf('网络异常') < 0, '失败说明不许写成网络异常', String(resolvedOf(r.out, 'tea:authed').detail))
    const step = stepOf(r.out, 'tea:authed')
    must(step && step.status === 'current', '登录失败行带修复动作（current）', JSON.stringify(step && step.status))
    const actions = (step && step.actions) || []
    const inject = actions.find(function (a) { return a && a.type === 'inject-prompt' }) || null
    must(!!inject, '带登录指引按钮（inject-prompt）', JSON.stringify(actions.map(function (a) { return a && a.type })))
    must(inject && inject.label === '登录指引', '按钮标签是中文「登录指引」', JSON.stringify(inject && inject.label))
    must(resolvedOf(r.out, 'tea:repoAccess') && resolvedOf(r.out, 'tea:repoAccess').status === 'pending', '登录失败不把仓库显示成不可达', JSON.stringify(resolvedOf(r.out, 'tea:repoAccess')))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
  }

  title('⑤ 仓库 404（issues ls 失败）→ 登录行绿，仓库行红')
  {
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'ls') return { code: 1, stdout: '', stderr: '404 repository does not exist' }
        return { code: 0, stdout: TABLE_WITH_LOGIN, stderr: '' }
      },
    })
    must(resolvedOf(r.out, 'tea:authed') && resolvedOf(r.out, 'tea:authed').status === 'pass', '仓库不可达说明前两关已过：登录行判通过', JSON.stringify(resolvedOf(r.out, 'tea:authed')))
    must(resolvedOf(r.out, 'tea:repoAccess') && resolvedOf(r.out, 'tea:repoAccess').status === 'fail', '确定 404 时仓库行判失败', JSON.stringify(resolvedOf(r.out, 'tea:repoAccess')))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
  }

  title('⑥ 网络超时（issues ls 抛错）→ 登录与仓库两行都 pending，不许误报未登录')
  {
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'ls') throw new Error('dial tcp: connection refused')
        return { code: 0, stdout: TABLE_WITH_LOGIN, stderr: '' }
      },
    })
    must(resolvedOf(r.out, 'tea:authed') && resolvedOf(r.out, 'tea:authed').status === 'pending', '网络超时时整个 preflight 失败在 network 档，登录行 pending（不判未登录）', JSON.stringify(resolvedOf(r.out, 'tea:authed')))
    must(resolvedOf(r.out, 'tea:repoAccess') && resolvedOf(r.out, 'tea:repoAccess').status === 'pending', '网络超时时仓库行 pending', JSON.stringify(resolvedOf(r.out, 'tea:repoAccess')))
    must(String(resolvedOf(r.out, 'tea:authed').detail || '').indexOf('网络异常') >= 0, 'pending 的说明写明网络异常', String(resolvedOf(r.out, 'tea:authed').detail))
    must(resolvedOf(r.out, 'tea:authed').status !== 'fail', '网络抖动不许把登录行判红', '判成了 fail')
    must(!hasInternalString(r.out), '回包里没有英文内部串')
  }

  title('⑦ 全过 + 远端有关联 → 四行全绿，身份走会话 getRepoKey')
  {
    const r = await evaluateScenario(mods, {
      getRemoteUrls: async function () { return ['git@gitea.example.com:group/proj.git'] },
    })
    must(resolvedOf(r.out, 'tea:authed') && resolvedOf(r.out, 'tea:authed').status === 'pass', '全过时登录行判通过', JSON.stringify(resolvedOf(r.out, 'tea:authed')))
    must(resolvedOf(r.out, 'tea:repoAccess') && resolvedOf(r.out, 'tea:repoAccess').status === 'pass', '全过时仓库行判通过（有 refId 核对过）', JSON.stringify(resolvedOf(r.out, 'tea:repoAccess')))
    must(resolvedOf(r.out, 'tea:remote') && resolvedOf(r.out, 'tea:remote').status === 'pass', '远端有 gitea 地址时「已关联 Gitea 仓库」判通过', JSON.stringify(resolvedOf(r.out, 'tea:remote')))
    must(String(resolvedOf(r.out, 'tea:remote').detail || '').indexOf('group/proj') >= 0, 'pass 的 detail 写明解析出的 owner/name', String(resolvedOf(r.out, 'tea:remote').detail))
    must(stepOf(r.out, 'tea:authed').status === 'done' && stepOf(r.out, 'tea:repoAccess').status === 'done', '两行在快照里都是 done', JSON.stringify([stepOf(r.out, 'tea:authed').status, stepOf(r.out, 'tea:repoAccess').status]))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
    must(r.fx.stats.preflight === 1, '三行共用一次 preflight', 'preflight=' + r.fx.stats.preflight)
    must(r.fx.stats.getCurrentUser === 0, 'Gitea 不预取当前登录名（只有 GitHub 修复合约要 {owner}）', 'getCurrentUser=' + r.fx.stats.getCurrentUser)
    const handle = r.fx.handles[0] || {}
    must(handle.refId === 'group/proj', 'preflight 的 handle 带上会话认出的 refId', JSON.stringify(handle))
    must(handle.backend === 'gitea', 'preflight 的 handle 标了 gitea 后端（否则房间按 GitHub 口径回话）', JSON.stringify(handle))
    must(r.exec.calls.length === 2, '这一趟只起两次 tea（login list 与 issues ls 探活）', '起了 ' + r.exec.calls.length + ' 次')
    const first = r.exec.calls[0] || {}
    must(first.args && first.args[0] === 'login' && first.args[1] === 'list', '登录判据是 tea login list', JSON.stringify(first.args))
    const second = r.exec.calls[1] || {}
    must(second.args && second.args[0] === 'issues' && second.args[1] === 'ls', '可达判据是 tea issues ls 探活', JSON.stringify(second.args))
  }

  title('⑦之二 本地没有 gitea 远端 → 「已关联」行红；远端读不到 → pending（不说没有）')
  {
    const miss = await evaluateScenario(mods, {
      getRemoteUrls: async function () { return ['https://github.com/group/proj.git'] },
    })
    must(resolvedOf(miss.out, 'tea:remote') && resolvedOf(miss.out, 'tea:remote').status === 'fail', '只有 github 远端时「已关联 Gitea 仓库」判失败', JSON.stringify(resolvedOf(miss.out, 'tea:remote')))
    must(String(resolvedOf(miss.out, 'tea:remote').detail || '').indexOf('Gitea/Forgejo') >= 0, '失败说明说清「没有指向 Gitea/Forgejo 的远端」', String(resolvedOf(miss.out, 'tea:remote').detail))
    const blind = await evaluateScenario(mods, { getRemoteUrls: async function () { return null } })
    must(resolvedOf(blind.out, 'tea:remote') && resolvedOf(blind.out, 'tea:remote').status === 'pending', '远端列表读不到时「已关联」行 pending（不冒充没有远端）', JSON.stringify(resolvedOf(blind.out, 'tea:remote')))
    must(String(resolvedOf(blind.out, 'tea:remote').detail || '').indexOf('读不到本地仓库信息') >= 0, 'pending 说明写明「读不到本地仓库信息」', String(resolvedOf(blind.out, 'tea:remote').detail))
    must(!hasInternalString(blind.out), '回包里没有英文内部串')
  }

  title('⑧ 会话没接上 → 三行都 pending，求值本身照旧成功')
  {
    const r = await evaluateScenario(mods, { openSession: null })
    must(!!r.out && r.out.ok === true, '开会话失败时链求值照旧回 ok:true（只降级不抛）', 'ok=' + (r.out && r.out.ok))
    must(resolvedOf(r.out, 'tea:authed') && resolvedOf(r.out, 'tea:authed').status === 'pending', '会话没接上时登录行 pending', JSON.stringify(resolvedOf(r.out, 'tea:authed')))
    must(resolvedOf(r.out, 'tea:repoAccess') && resolvedOf(r.out, 'tea:repoAccess').status === 'pending', '会话没接上时仓库行 pending', JSON.stringify(resolvedOf(r.out, 'tea:repoAccess')))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
  }

  console.log('\n共 ' + total + ' 项，' + (broken.length ? ('破 ' + broken.length + ' 项') : '全绿'))
  if (broken.length) process.exit(1)
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.stack) || e)); process.exit(1) })
