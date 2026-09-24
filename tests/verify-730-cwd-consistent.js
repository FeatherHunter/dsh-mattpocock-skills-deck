#!/usr/bin/env node
// tests/verify-730-cwd-consistent.js —— #730 门禁：同一会话两处读到同一个值。
//
// 为什么有这条门禁：宿主有时答不出这个会话在哪个目录，真机 wf.cwd 失败散列 43cbab2a
//   就是空分支。电话体（src/host/sessionLifecycle.js）与沙箱那一路
//  （src/host/workspaceCwd.js 的 sessionsOfWorkspace）各写一遍取法，前者认 11 个槽位、
//   后者只认 2 个，同一份会话两处答案不同，写操作的沙箱政策静默落错档。
//   本门禁只锁一件事：两处经同一只共用函数取值，分歧结构上不可能再出现。
//   反证：把两处改回各写一遍（或删掉共用引用），本门禁必须变红。
//
// 用法：node tests/verify-730-cwd-consistent.js（插件根目录，可独立运行）
// 接线说明：本文件暂不进 package.json 的 verify 链（接线由统筹者统一做），
//   验收与全链时由统筹者接线，平时单跑本文件。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const SHARED_REL = path.join('src', 'shared', 'session-cwd.js')
let failed = false
let total = 0
const ok = (cond, msg) => { total += 1; if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 注释不算数：只查代码里的取法，注释里提到字段名不算分歧。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '')

async function main() {
  console.log('== #730 同一会话两处同值门禁 ==')
  const sharedAbs = path.join(ROOT, SHARED_REL)
  const sharedExists = fs.existsSync(sharedAbs)
  ok(sharedExists, '共用函数文件存在（src/shared/session-cwd.js）')

  // A 组：共用函数的真行为（第一步收敛时与旧电话体同语义：11 个槽位全认）。
  if (sharedExists) {
    const mod = await import(pathToFileURL(sharedAbs).href)
    ok(typeof mod.resolveSessionCwd === 'function', '共用函数可调用（resolveSessionCwd）')
    const f = mod.resolveSessionCwd
    ok(f({ header: { cwd: 'D:\\ilife' } }) === 'D:\\ilife', '头目录命中')
    ok(f({ header: {} }) === '', '空头回空串（真机 5 次失败就是这一支）')
    ok(f(null) === '' && f(undefined) === '' && f({}) === '', '空会话对象回空串不抛错')
    ok(f({ header: { worktree: 'D:\\ilife' } }) === 'D:\\ilife', '第一步：worktree 与旧电话体同语义（收敛不断行）')
    ok(f({ header: { directory: 'D:\\ilife' } }) === 'D:\\ilife', '第一步：directory 与旧电话体同语义（收敛不断行）')
    ok(f({ meta: { cwd: 'D:\\ilife' } }) === 'D:\\ilife', '第一步：备用头与旧电话体同语义（收敛不断行）')
    ok(f({ cwd: 'D:\\ilife' }) === 'D:\\ilife', '第一步：会话自身字段与旧电话体同语义（收敛不断行）')
    ok(f({ header: { cwd: 42 } }) === '', '非字符串目录不当目录（不误认）')
  } else {
    ok(false, '共用函数可调用（缺文件，跳过行为断言）')
  }

  // B 组：电话体真行为（走真实 createSessionLifecycle，只换 sessions 夹具）。
  {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'sessionLifecycle.js')).href)
    const makePhone = (sessionObj) => mod.createSessionLifecycle({
      ctx: { get: (k) => (k === 'sessions' ? { get: () => sessionObj } : undefined) },
      DEFAULT_CWD: 'D:\\',
      errText: (e) => String((e && e.message) || e),
      getDetectionService: async () => null,
      getTrackerRegistry: async () => null,
      getPlatform: async () => null,
      canonicalKey: async (raw) => raw,
      logCtx: null,
    }).handleCwd
    const r1 = await makePhone({ header: { cwd: 'D:\\ilife' } })({ sessionId: 's-ok' })
    ok(r1 && r1.ok === true && r1.cwd === 'D:\\ilife', '电话体正常会话成功')
    const r2 = await makePhone({ header: {} })({ sessionId: 's-empty' })
    ok(r2 && r2.ok === false && r2.error === '会话无 cwd 信息', '电话体空头会话走失败分支（文案不变）')
  }

  // C 组：两处经同一只函数取值（结构不断即判红，不靠自觉）。
  {
    const lifeSrc = stripComments(read(path.join('src', 'host', 'sessionLifecycle.js')))
    const wsSrc = stripComments(read(path.join('src', 'host', 'workspaceCwd.js')))
    ok(lifeSrc.indexOf('resolveSessionCwd') >= 0, '电话体调共用函数（不自写取法）')
    ok(wsSrc.indexOf('resolveSessionCwd') >= 0, '沙箱那一路调共用函数（不自写取法）')
    ok(lifeSrc.indexOf('header.worktree') < 0 && lifeSrc.indexOf('header.projectDir') < 0 && lifeSrc.indexOf('header.directory') < 0,
      '电话体无自写多槽位取法（取法只活在共用函数里）')
    ok(wsSrc.indexOf('header.worktree') < 0 && wsSrc.indexOf('header.cwd || header.path') < 0,
      '沙箱那一路无自写取法（取法只活在共用函数里）')
    ok(wsSrc.indexOf('function sessionsOfWorkspace') >= 0, '沙箱按工作区找会话的函数仍在（只换取法，不换行为骨架）')
  }

  console.log(failed ? '\n存在失败 — verify-730-cwd-consistent 未通过' : '\n全部通过 — ' + total + ' 项断言（同一会话两处同值）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(2) })
