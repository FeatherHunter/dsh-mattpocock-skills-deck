#!/usr/bin/env node
// tests/verify-1187-gitlab-chain-predicates.ts —— 门禁：GitLab 检查链的两行谓词在宿主里真的注册了、判定也对（票 #1187）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1187-gitlab-chain-predicates.ts
//
// 这一票修的现象：GitLab 后端工作区里「glab 已登录」「GitLab 仓库可达」两行永远 pending，
// 行描述是一句英文内部串 predicate not registered: glabAuth / repoAccess，也没有登录指引与修复指引按钮。
// 根因是检查目录要的两个谓词键（preflight:glabAuth、backend:gitlab:repoAccess）在宿主里一条都没注册。
//
// 门禁盯五件事：
//   ① 目录里每一项 backend/preflight 检查，宿主都得有对应的注册键 —— 以后再加后端检查项却忘了注册，
//      这一节直接判红，而不是等界面显示那句英文内部串；
//   ② 两个判定函数的分档：网络类失败 / 命令找不到不许判成「未登录」，认不出仓库地址时不许说「仓库可达」；
//   ③ 真跑一遍链求值（假会话 + 假 glab）：未装、未登录、仓库 404、网络超时、全过，五种情形两行的状态与文案；
//   ④ 失败行带着后端声明的修复入口（安装 / 登录 / 修复指引），提示词已解析成正文而不是内部键名；
//   ⑤ 仓库身份走会话的 getRepoKey 能力，handle 带上 backend 与 refId，GitLab 不预取登录名。
// 门禁归属: src/refresh/rooms/host/check-chain-evaluation.ts
// 门禁归属: src/refresh/rooms/host/chain-env-map.ts
// 门禁归属: src/shared/tracker/check-catalog-dirs.ts
// 门禁归属: src/tracker/rooms/gitlab/index.ts
// 门禁归属: src/tracker/rooms/gitlab/preflight.ts
// 门禁归属: src/tracker/rooms/gitlab/repo.ts
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
const DEMO_CWD = 'D:/demo'
/** 假平台：GitLab 两行要的第一关是「找得到 glab 吗」，这里按场景决定答案。 */
function makePlatform(exe) {
  return {
    marker: 'session-platform',
    os: 'win32',
    path: nodePath,
    async getHome() { return 'C:/Users/fake' },
    async resolveExecutable(name) { return name === 'glab' ? exe : null },
  }
}
/** 假 glab 执行器：记下每次调用，按场景给回包（抛异常也算一种回包）。 */
function makeGlabExec(handler) {
  const calls = []
  const exec = async function (cmd, args, opts) {
    calls.push({ cmd: cmd, args: args, opts: opts })
    return handler(cmd, args)
  }
  Object.assign(exec, { marker: 'session-exec' })
  return { exec: exec, calls: calls }
}
/** 假会话：preflight 直接交给 GitLab 房间的真实现（假的是它拿到的平台与执行器）。 */
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
    return { ok: true, backendId: 'gitlab', budget: {}, call: function (fn) { return fn(session, ctx) } }
  }
}
/** 一条最小检查链：探测直接回 GitLab，退避恒说「该算」，其余依赖都按测试口径给最少的答复。 */
function makeChain(mods, opts) {
  const o = opts || {}
  return mods.chainMod.createDetectChain({
    canonicalKey: async (raw) => String(raw || ''),
    DEFAULT_CWD: DEMO_CWD,
    resetGhCache: () => {},
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'gitlab', source: 'auto' } }) }),
    getPlatform: async () => o.platform,
    getTrackerRegistry: async () => ({ modules: () => [{ id: 'gitlab', fixes: mods.gitlabMod.fixes, prompts: mods.gitlabMod.prompts }] }),
    getRepoKey: async () => null,
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
/** 这一趟回包里不许出现那句英文内部串（现象 2：界面不能再见到 predicate not registered）。 */
function hasInternalString(out) {
  try { return JSON.stringify([out && out.backendChain, out && out.fullSnapshot]).indexOf('predicate not registered') >= 0 } catch (e) { return true }
}

/** 跑一次链求值：按场景拼平台、执行器与会话，返回回包与记录下来的调用。 */
async function evaluateScenario(mods, opts) {
  const o = opts || {}
  const exe = o.glabPath === undefined ? 'C:/fake/glab' : o.glabPath
  const platform = makePlatform(exe)
  const execPack = makeGlabExec(o.execHandler || function () { return { code: 0, stdout: '', stderr: '' } })
  const sessionCtx = { cwd: 'C:/stale', caller: 'refresh', platform: platform, exec: execPack.exec }
  const repoKey = o.repoKeyReply === undefined ? { owner: 'group', name: 'proj' } : o.repoKeyReply
  const fx = makeSession(mods.glabPreflight, repoKey)
  const chain = makeChain(mods, {
    platform: platform,
    openSession: o.openSession === null ? null : openReplyOf(fx.session, sessionCtx),
  })
  const out = await chain.handleChain({ cwd: DEMO_CWD, backendId: 'gitlab', lang: 'zh', force: true })
  return { out: out, fx: fx, exec: execPack, sessionCtx: sessionCtx }
}

async function main() {
  const mods = {
    catMod: await import(url('src/shared/tracker/check-catalog-dirs.ts')),
    envMod: await import(url('src/refresh/rooms/host/chain-env-map.ts')),
    chainMod: await import(url('src/refresh/rooms/host/check-chain-evaluation.ts')),
    preflightMod: await import(url('src/tracker/rooms/gitlab/preflight.ts')),
    gitlabMod: await import(url('src/tracker/rooms/gitlab/index.ts')),
  }
  mods.glabPreflight = mods.preflightMod.glabPreflight

  title('① 目录里每一项 backend/preflight 检查，宿主都有对应的注册键')
  {
    const src = fs.readFileSync(nodePath.join(ROOT, 'src/refresh/rooms/host/check-chain-evaluation.ts'), 'utf8')
    const registered = new Set()
    const re = /registry\.register\(\s*['"]([^'"]+)['"]/g
    let m = re.exec(src)
    while (m) { registered.add(m[1]); m = re.exec(src) }
    must(registered.size >= 8, '从求值文件里至少认出 8 条注册（解析失效时本节其余断言会假绿）', '只认出 ' + registered.size + ' 条')
    const backends = ['github', 'markdown', 'gitlab']
    for (const backendId of backends) {
      const items = mods.catMod.catalogFor(backendId).filter(function (c) { return c.scope === 'backend' })
      must(items.length > 0, backendId + ' 的后端目录非空', '空目录')
      for (const it of items) {
        const check = it.check || {}
        let key = null
        if (check.kind === 'backend') key = 'backend:' + check.backendId + ':' + check.id
        else if (check.kind === 'preflight') key = 'preflight:' + check.id
        if (!key) continue // primitive 由原语执行器直接跑，不需要注册键
        must(registered.has(key), backendId + ' 的 ' + it.id + ' 有注册键 ' + key, '注册表里没有 ' + key)
      }
    }
    must(registered.has('preflight:glabAuth'), '「glab 已登录」那一项的键 preflight:glabAuth 已注册', '没注册')
    must(registered.has('backend:gitlab:repoAccess'), '「GitLab 仓库可达」那一项的键 backend:gitlab:repoAccess 已注册', '没注册')
  }

  title('② 两个判定函数：网络故障不误报未登录，认不出仓库不说可达')
  {
    const envMod = mods.envMod
    must(envMod.glabAuthVerdict({ stage: 'auth', kind: 'auth', message: 'not logged in' }, true).status === 'fail', '明确未登录（kind=auth）才判失败', JSON.stringify(envMod.glabAuthVerdict({ stage: 'auth', kind: 'auth', message: 'not logged in' }, true)))
    must(envMod.glabAuthVerdict({ stage: 'auth', kind: 'network', message: 'ETIMEDOUT' }, true).status === 'pending', '网络档（kind=network）判 pending，不判未登录', 'fail')
    must(envMod.glabAuthVerdict({ stage: 'auth', kind: 'auth', message: 'timeout of 30000ms exceeded' }, true).status === 'pending', '即使档位是 auth，原文是超时也不判未登录（房间把起进程失败也归 auth 档）', 'fail')
    must(envMod.glabAuthVerdict({ stage: 'gh' }, true).status === 'pending', '没找到 glab 可执行时判 pending', 'fail')
    must(envMod.glabRepoAccessVerdict({ stage: 'pass', refId: 'group/proj' }, true).status === 'pass', '接口调通且拿 refId 核对过才判可达', 'pending')
    must(envMod.glabRepoAccessVerdict({ stage: 'pass', refId: '' }, true).status === 'pending', '没 refId 时房间会跳过第三关回成功，判定要如实 pending', 'pass')
    must(envMod.glabRepoAccessVerdict({ stage: 'repo', kind: 'not-found' }, true).status === 'fail', '确定 404 才判失败', 'pending')
    must(envMod.glabRepoAccessVerdict({ stage: 'auth', kind: 'auth' }, true).status === 'pending', '登录失败不把仓库显示成不可达', 'fail')
    // #1571：env 档不只有「没找到可执行文件」一种；出站控制面/执行器没接上时不能继续说「没找到 glab」。
    const detached: any = { stage: 'gh', kind: 'env', message: '出站控制面没有接上：名额闸、取消判定与搭车账本都拿不到，这一笔不发出去。' }
    const detachedAuth = String((envMod.glabAuthVerdict(detached, true).detail) || '')
    const detachedRepo = String((envMod.glabRepoAccessVerdict(detached, true).detail) || '')
    must(detachedAuth.indexOf('没找到 glab') < 0, '出站控制面没接上时登录态文案不再说「没找到 glab」', detachedAuth)
    must(detachedAuth.indexOf('环境检查没通过') >= 0, '非缺 glab 的 env 失败如实说「环境检查没通过」', detachedAuth)
    must(detachedRepo.indexOf('没找到 glab') < 0 && detachedRepo.indexOf('环境检查没通过') >= 0, '仓库可达那一行按同一口径分流', detachedRepo)
    const blankGlab = String((envMod.glabAuthVerdict({ stage: 'gh' }, true).detail) || '')
    must(blankGlab.indexOf('没找到 glab') < 0 && blankGlab.indexOf('环境检查没通过') >= 0, '只给 stage 不给原文时只说环境检查没过，不断言缺 glab（#1571）', blankGlab)
    const missingGlab = String((envMod.glabAuthVerdict({ stage: 'gh', kind: 'env', message: 'glab not found' }, true).detail) || '')
    must(missingGlab.indexOf('没找到 glab') >= 0, '原文确实是 glab not found 时仍说没找到 glab（旧文案保住）', missingGlab)
    const failText = String((envMod.glabAuthVerdict({ stage: 'auth', kind: 'auth', message: 'not logged in' }, true).detail) || '')
    must(/[\u4e00-\u9fa5]/.test(failText), '中文界面的失败文案是中文', failText)
    must(failText.indexOf('predicate not registered') < 0, '失败文案里没有那句英文内部串', failText)
  }

  title('③ 真跑链求值：没装 glab → 两行 pending，「已安装」行红并带安装指引')
  {
    const r = await evaluateScenario(mods, { glabPath: null })
    must(resolvedOf(r.out, 'glab:authed') && resolvedOf(r.out, 'glab:authed').status === 'pending', '没装 glab 时「glab 已登录」pending（诚实未知）', JSON.stringify(resolvedOf(r.out, 'glab:authed')))
    must(resolvedOf(r.out, 'glab:repoAccess') && resolvedOf(r.out, 'glab:repoAccess').status === 'pending', '没装 glab 时「GitLab 仓库可达」pending', JSON.stringify(resolvedOf(r.out, 'glab:repoAccess')))
    must(String(resolvedOf(r.out, 'glab:authed').detail || '').indexOf('没找到 glab') >= 0, 'pending 的说明写明「没找到 glab」', String(resolvedOf(r.out, 'glab:authed').detail))
    must(!hasInternalString(r.out), '整个回包里没有 predicate not registered 那句英文内部串')
    const inst = stepOf(r.out, 'glab:installed')
    must(inst && inst.status === 'current', '「glab 已安装」行判红并带修复动作（current）', JSON.stringify(inst && inst.status))
    must(inst && String((inst.show || {}).hint || '').indexOf('安装指引') >= 0, '这一行挂着安装指引', JSON.stringify(inst && inst.show))
    must(r.exec.calls.length === 0, '没装 glab 时没有起过任何 glab 进程', '起了 ' + r.exec.calls.length + ' 次')
    must(r.fx.stats.preflight === 1, '两行共用一次 preflight（一次求值只问一次环境）', 'preflight=' + r.fx.stats.preflight)
  }

  title('④ 装了没登录 → 第二行红并带登录指引，仓库那行仍 pending')
  {
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'status') return { code: 1, stdout: '', stderr: 'not logged in' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    must(resolvedOf(r.out, 'glab:authed') && resolvedOf(r.out, 'glab:authed').status === 'fail', '明确未登录时「glab 已登录」判失败', JSON.stringify(resolvedOf(r.out, 'glab:authed')))
    must(resolvedOf(r.out, 'glab:repoAccess') && resolvedOf(r.out, 'glab:repoAccess').status === 'pending', '登录失败不把仓库显示成不可达', JSON.stringify(resolvedOf(r.out, 'glab:repoAccess')))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
    const step = stepOf(r.out, 'glab:authed')
    must(step && step.status === 'current', '失败行带修复动作（current）', JSON.stringify(step && step.status))
    must(step && String((step.show || {}).hint || '').indexOf('登录指引') >= 0, '行提示写明点「登录指引」', JSON.stringify(step && step.show))
    const actions = (step && step.actions) || []
    const inject = actions.find(function (a) { return a && a.type === 'inject-prompt' }) || null
    must(!!inject, '带一个注入提示词的动作（登录指引按钮）', JSON.stringify(actions.map(function (a) { return a && a.type })))
    must(inject && inject.label === '登录指引', '按钮标签是中文「登录指引」', JSON.stringify(inject && inject.label))
    must(inject && String(inject.prompt || '').indexOf('glab auth login') >= 0, '提示词已解析成正文（含 glab auth login），不是内部键名', String(inject && inject.prompt).slice(0, 80))
    must(inject && inject.prompt !== 'glabLoginFix', '提示词不再是 glabLoginFix 这个键名', String(inject && inject.prompt))
    must(stepOf(r.out, 'glab:installed') && stepOf(r.out, 'glab:installed').status === 'done', 'glab 已装那一行是绿的', JSON.stringify(stepOf(r.out, 'glab:installed') && stepOf(r.out, 'glab:installed').status))
  }

  title('⑤ 仓库 404 → 登录行绿，仓库行红并带修复指引')
  {
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'status') return { code: 0, stdout: 'Logged in to gitlab.com as tester\n', stderr: '' }
        return { code: 1, stdout: '', stderr: '404 Not Found' }
      },
    })
    must(resolvedOf(r.out, 'glab:authed') && resolvedOf(r.out, 'glab:authed').status === 'pass', '仓库不可达说明前两关已过：登录行判通过', JSON.stringify(resolvedOf(r.out, 'glab:authed')))
    must(resolvedOf(r.out, 'glab:repoAccess') && resolvedOf(r.out, 'glab:repoAccess').status === 'fail', '确定 404 时仓库行判失败', JSON.stringify(resolvedOf(r.out, 'glab:repoAccess')))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
    const step = stepOf(r.out, 'glab:repoAccess')
    must(step && step.status === 'current', '失败行带修复动作（current）', JSON.stringify(step && step.status))
    must(step && String((step.show || {}).hint || '').indexOf('修复指引') >= 0, '行提示写明点「修复指引」', JSON.stringify(step && step.show))
    const inject = ((step && step.actions) || []).find(function (a) { return a && a.type === 'inject-prompt' }) || null
    must(inject && inject.label === '修复指引', '按钮标签是中文「修复指引」', JSON.stringify(inject && inject.label))
    must(inject && String(inject.prompt || '').indexOf('glab repo create') >= 0, '修复提示词已解析成正文（含 glab repo create）', String(inject && inject.prompt).slice(0, 80))
    must(inject && inject.prompt !== 'glabRepoFix', '提示词不再是 glabRepoFix 这个键名', String(inject && inject.prompt))
  }

  title('⑥ 网络超时 → 两行都 pending，不许误报未登录')
  {
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'status') throw new Error('timeout of 30000ms exceeded')
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    must(resolvedOf(r.out, 'glab:authed') && resolvedOf(r.out, 'glab:authed').status === 'pending', '网络超时时登录行 pending（不判未登录）', JSON.stringify(resolvedOf(r.out, 'glab:authed')))
    must(resolvedOf(r.out, 'glab:repoAccess') && resolvedOf(r.out, 'glab:repoAccess').status === 'pending', '网络超时时仓库行也 pending', JSON.stringify(resolvedOf(r.out, 'glab:repoAccess')))
    must(resolvedOf(r.out, 'glab:authed').status !== 'fail', '网络抖动不许出现红牌（否则会误导人重新登录）', '判成了 fail')
    must(String(resolvedOf(r.out, 'glab:authed').detail || '').indexOf('网络异常') >= 0, 'pending 的说明写明网络异常', String(resolvedOf(r.out, 'glab:authed').detail))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
  }

  title('⑦ 全过 → 两行都绿；仓库身份走会话 getRepoKey，handle 带 backend 与 refId')
  {
    const r = await evaluateScenario(mods, {
      execHandler: function (cmd, args) {
        if (args && args[1] === 'status') return { code: 0, stdout: 'Logged in to gitlab.com as tester\n', stderr: '' }
        return { code: 0, stdout: '{}', stderr: '' }
      },
    })
    must(resolvedOf(r.out, 'glab:authed') && resolvedOf(r.out, 'glab:authed').status === 'pass', '全过时登录行判通过', JSON.stringify(resolvedOf(r.out, 'glab:authed')))
    must(resolvedOf(r.out, 'glab:repoAccess') && resolvedOf(r.out, 'glab:repoAccess').status === 'pass', '全过时仓库行判通过（有 refId 核对过）', JSON.stringify(resolvedOf(r.out, 'glab:repoAccess')))
    must(stepOf(r.out, 'glab:authed').status === 'done' && stepOf(r.out, 'glab:repoAccess').status === 'done', '两行在快照里都是 done', JSON.stringify([stepOf(r.out, 'glab:authed').status, stepOf(r.out, 'glab:repoAccess').status]))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
    must(r.fx.stats.preflight === 1, '两行共用一次 preflight', 'preflight=' + r.fx.stats.preflight)
    must(r.fx.stats.getRepoKey === 1, '仓库身份只问会话 getRepoKey 一次（解析结果在探针里复用）', 'getRepoKey=' + r.fx.stats.getRepoKey)
    must(r.fx.stats.getCurrentUser === 0, 'GitLab 不预取当前登录名（只有 GitHub 修复合约要 {owner}）', 'getCurrentUser=' + r.fx.stats.getCurrentUser)
    const handle = r.fx.handles[0] || {}
    must(handle.refId === 'group/proj', 'preflight 的 handle 带上会话认出的 refId', JSON.stringify(handle))
    must(handle.backend === 'gitlab', 'preflight 的 handle 标了 gitlab 后端（否则房间按 GitHub 口径回话）', JSON.stringify(handle))
    const keyCall = r.fx.repoKeyCalls[0] || {}
    must(keyCall.cwd === DEMO_CWD, '问仓库身份时带的目录是本次求值目录', JSON.stringify(keyCall.cwd))
    must(r.exec.calls.length === 2, '这一趟只起两次 glab（auth status 与 api 探活）', '起了 ' + r.exec.calls.length + ' 次')
    const second = r.exec.calls[1] || {}
    must(second.args && second.args[0] === 'api' && second.args[1] === 'projects/group%2Fproj', '第二关按 refId 拼 api 路径并编码斜杠', JSON.stringify(second.args))
    const pfCtx = r.fx.ctxs[0] || {}
    must(!!(pfCtx.platform && pfCtx.platform.marker === 'session-platform'), 'preflight 收到会话 ctx 里的平台对象（缺了房间第一关就判找不到 glab）', 'platform.marker=' + String(pfCtx.platform && pfCtx.platform.marker))
    must(!!(pfCtx.exec && pfCtx.exec.marker === 'session-exec'), 'preflight 收到会话 ctx 里的起进程口', String(typeof pfCtx.exec))
    must(pfCtx.cwd === DEMO_CWD, 'preflight 的操作上下文按本次求值目录给 cwd', JSON.stringify(pfCtx.cwd))
  }

  title('⑧ 本地认不出仓库身份 → 登录行绿，仓库行 pending（不说可达），也不再探活')
  {
    const r = await evaluateScenario(mods, {
      repoKeyReply: null,
      execHandler: function (cmd, args) {
        if (args && args[1] === 'status') return { code: 0, stdout: 'Logged in to gitlab.com as tester\n', stderr: '' }
        return { code: 0, stdout: '{}', stderr: '' }
      },
    })
    must(resolvedOf(r.out, 'glab:authed') && resolvedOf(r.out, 'glab:authed').status === 'pass', '认不出仓库不影响登录行', JSON.stringify(resolvedOf(r.out, 'glab:authed')))
    must(resolvedOf(r.out, 'glab:repoAccess') && resolvedOf(r.out, 'glab:repoAccess').status === 'pending', '认不出仓库时仓库行 pending（房间跳过了第三关）', JSON.stringify(resolvedOf(r.out, 'glab:repoAccess')))
    must(String(resolvedOf(r.out, 'glab:repoAccess').detail || '').indexOf('本地认不出') >= 0, 'pending 的说明写明「本地认不出 GitLab 仓库地址」', String(resolvedOf(r.out, 'glab:repoAccess').detail))
    must(r.exec.calls.length === 1, '没有 refId 时不发 api 探活（只跑过 auth status）', '起了 ' + r.exec.calls.length + ' 次')
    must(!r.fx.handles[0].refId, 'handle 不带 refId', JSON.stringify(r.fx.handles[0]))
  }

  title('⑨ 会话没接上 → 两行都 pending，求值本身照旧成功')
  {
    const r = await evaluateScenario(mods, { openSession: null })
    must(!!r.out && r.out.ok === true, '开会话失败时链求值照旧回 ok:true（只降级不抛）', 'ok=' + (r.out && r.out.ok))
    must(resolvedOf(r.out, 'glab:authed') && resolvedOf(r.out, 'glab:authed').status === 'pending', '会话没接上时登录行 pending', JSON.stringify(resolvedOf(r.out, 'glab:authed')))
    must(resolvedOf(r.out, 'glab:repoAccess') && resolvedOf(r.out, 'glab:repoAccess').status === 'pending', '会话没接上时仓库行 pending', JSON.stringify(resolvedOf(r.out, 'glab:repoAccess')))
    must(String(resolvedOf(r.out, 'glab:authed').detail || '').indexOf('读会话还没接上') >= 0, 'pending 的说明写明读会话还没接上', String(resolvedOf(r.out, 'glab:authed').detail))
    must(!hasInternalString(r.out), '回包里没有英文内部串')
  }

  console.log('\n共 ' + total + ' 项，' + (broken.length ? ('破 ' + broken.length + ' 项') : '全绿'))
  if (broken.length) process.exit(1)
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.stack) || e)); process.exit(1) })
