#!/usr/bin/env node
// tests/verify-730-cwd-consistent.js —— #730 门禁：同一会话两处读到同一个值。
//
// 为什么有这条门禁：宿主有时答不出这个会话在哪个目录，真机 wf.cwd 失败散列 43cbab2a
//   就是空分支。电话体（src/host/sessionLifecycle.js）与沙箱那一路
//  （src/host/workspaceCwd.js 的 sessionsOfWorkspace）各写一遍取法，前者认 11 个字段、
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

  // A 组：共用函数的真行为（第二步：只读有证据的字段——DSH 会话头里选填的目录；
  //   头的路径、worktree、projectDir、directory 与备用头、自身字段都没有证据，从第一版起删除）。
  if (sharedExists) {
    const mod = await import(pathToFileURL(sharedAbs).href)
    ok(typeof mod.resolveSessionCwd === 'function', '共用函数可调用（resolveSessionCwd）')
    const f = mod.resolveSessionCwd
    ok(f({ header: { cwd: 'D:\\ilife' } }) === 'D:\\ilife', '头目录命中（唯一有权威的字段）')
    ok(f({ header: {} }) === '', '空头回空串（真机 5 次失败就是这一支）')
    ok(f(null) === '' && f(undefined) === '' && f({}) === '', '空会话对象回空串不抛错')
    ok(f({ header: { worktree: 'D:\\ilife' } }) === '', '第二步：worktree 无证据，不认（两处同为无）')
    ok(f({ header: { directory: 'D:\\ilife' } }) === '', '第二步：directory 无证据，不认（两处同为无）')
    ok(f({ header: { path: 'D:\\ilife' } }) === '', '第二步：头的路径无证据，不认（两处同为无）')
    ok(f({ meta: { cwd: 'D:\\ilife' } }) === '', '第二步：备用头无证据，不认（两处同为无）')
    ok(f({ cwd: 'D:\\ilife' }) === '', '第二步：会话自身字段无证据，不认（两处同为无）')
    ok(f({ header: { cwd: 42 } }) === '', '非字符串目录不当目录（不误认）')
  } else {
    ok(false, '共用函数可调用（缺文件，跳过行为断言）')
  }

  // B 组：电话体真行为（走真实 createSessionLifecycle，只换 sessions 夹具）。
  //   失败四种各有机器可读种类，文案保持旧字面（旧分支一个字不改，只加种类）。
  {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'sessionLifecycle.js')).href)
    const makePhone = (sessionObj, sessionsSvc) => mod.createSessionLifecycle({
      ctx: { get: (k) => (k === 'sessions' ? (sessionsSvc || { get: () => sessionObj }) : undefined) },
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
    ok(r2 && r2.ok === false && r2.error === '会话无 cwd 信息' && r2.kind === 'no-cwd', '电话体空头会话报无目录种类（文案不变）')
    // 真机对照：空分支的错误散列就是票面 5 次失败的 43cbab2a（与宿主电话日志同一只散列函数）。
    const hash8 = (s) => { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
    ok(hash8(r2.error) === '43cbab2a', '空分支散列锚定真机现场（43cbab2a）')
    const r3 = await makePhone(null)({ sessionId: 's-ghost' })
    ok(r3 && r3.ok === false && r3.kind === 'not-found', '电话体未知会话报找不到种类（不混同无目录）')
    const r4 = await makePhone(null, undefined)({ sessionId: '' })
    ok(r4 && r4.ok === false && r4.kind === 'no-sid', '电话体缺会话号报缺号种类')
    const r5 = await mod.createSessionLifecycle({
      ctx: { get: () => undefined },
      DEFAULT_CWD: 'D:\\',
      errText: (e) => String((e && e.message) || e),
      getDetectionService: async () => null,
      getTrackerRegistry: async () => null,
      getPlatform: async () => null,
      canonicalKey: async (raw) => raw,
      logCtx: null,
    }).handleCwd({ sessionId: 's-x' })
    ok(r5 && r5.ok === false && r5.kind === 'no-service', '电话体会话服务不可用报无服务种类')
  }

  // E 组（#730 第二段）：会话不在内存里（DSH 只装活着的会话）时，要能在落盘语料里答出目录。
  //   这一段量的是「答得出」，与 A/B 两组量的「两处读得一样」互补：真机 5 天 1957 次询问里 283 次失败全落在这一支。
  {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'sessionLifecycle.js')).href)
    const DISK_CWD = 'D:\\ilife'
    // 造一部只答「这个会话在盘上、目录是这个」的会话查询服务；queries 收下它被问到的键，供形状断言。
    const makeQuery = (opts) => {
      const o = opts || {}
      const queries = []
      return {
        queries,
        svc: {
          filterSessions: async (filters) => {
            queries.push(filters)
            if (o.throw) throw new Error('persistence listing failed')
            if (o.noRecords) return []
            return [{ header: { id: o.id || 's-ghost', cwd: o.headerCwd === undefined ? DISK_CWD : o.headerCwd }, live: false, persisted: true }]
          },
        },
      }
    }
    // 一部「内存里没有这个会话」的宿主；sessionQuery 按传入的假服务挂上或干脆不挂。
    const makeHost = (sessionObj, querySvc) => mod.createSessionLifecycle({
      ctx: {
        get: (k) => {
          if (k === 'sessions') return { get: () => sessionObj }
          if (k === 'sessionQuery') return querySvc
          return undefined
        },
      },
      DEFAULT_CWD: 'D:\\',
      errText: (e) => String((e && e.message) || e),
      getDetectionService: async () => null,
      getTrackerRegistry: async () => null,
      getPlatform: async () => null,
      canonicalKey: async (raw) => raw,
      logCtx: null,
    }).handleCwd

    // E1 内存里没有、盘上有 → 答得出，且仍顺手带回工作区根（客户端早期认工作区就靠它）
    const q1 = makeQuery({})
    const e1 = await makeHost(null, q1.svc)({ sessionId: 's-ghost' })
    ok(e1 && e1.ok === true && e1.cwd === DISK_CWD, '🔴 不活跃但盘上有：答得出目录（实得 ' + JSON.stringify(e1 && e1.cwd) + '）')
    ok(e1 && e1.workspaceRoot === DISK_CWD, '不活跃会话答出时也带回工作区根（与内存那一路同一个 withRoot）')
    ok(q1.queries.length === 1 && q1.queries[0] && q1.queries[0][0] && q1.queries[0][0].kind === 'id'
      && Array.isArray(q1.queries[0][0].values) && q1.queries[0][0].values[0] === 's-ghost',
      '落盘那一问按会话号问（kind=id，问的正是客户端报上来的那个号）')

    // E2 内存在、但头里没有目录，盘上有 → 也答得出（两处取同一字段，内存答不出才轮到盘）
    const q2 = makeQuery({})
    const e2 = await makeHost({ header: {} }, q2.svc)({ sessionId: 's-empty' })
    ok(e2 && e2.ok === true && e2.cwd === DISK_CWD, '内存里没有目录但盘上有：答得出（实得 ' + JSON.stringify(e2 && e2.cwd) + '）')

    // E3 内存答得出时不许去问盘（热路径不付这笔钱）
    const q3 = makeQuery({})
    const e3 = await makeHost({ header: { cwd: 'D:\\memory' } }, q3.svc)({ sessionId: 's-live' })
    ok(e3 && e3.ok === true && e3.cwd === 'D:\\memory' && q3.queries.length === 0, '内存答得出时不问盘（热路径零额外代价）')

    // E4~E7 四种「盘上也拿不到」的情形：必须回到原本那一类失败，绝不许凭空造一个目录
    const e4 = await makeHost(null, undefined)({ sessionId: 's-ghost' })
    ok(e4 && e4.ok === false && e4.kind === 'not-found', '没有会话查询服务时：照旧如实报找不到（行为不回归）')
    const e5 = await makeHost(null, makeQuery({ throw: true }).svc)({ sessionId: 's-ghost' })
    ok(e5 && e5.ok === false && e5.kind === 'not-found', '落盘查询抛错时：照旧如实报找不到（不把异常当答案）')
    const e6 = await makeHost(null, makeQuery({ noRecords: true }).svc)({ sessionId: 's-ghost' })
    ok(e6 && e6.ok === false && e6.kind === 'not-found', '盘上没有这个会话时：照旧如实报找不到（不猜）')
    const e7 = await makeHost(null, makeQuery({ headerCwd: '' }).svc)({ sessionId: 's-ghost' })
    ok(e7 && e7.ok === false && e7.kind === 'not-found', '盘上那条头里也没有目录时：照旧如实报找不到（不造事实）')

    // E8 结构锚点：落盘那一问真的接在电话体里，而且读的是与内存同一只取法（同一个字段）。
    //   为什么锚「调用行」而不只锚函数名：只锚函数名的话，把调用删掉（等于取消这一步）门禁照样绿。
    const lifeSrcRaw = read(path.join('src', 'host', 'sessionLifecycle.js'))
    ok(/const fromDisk = await persistedCwdOf\(sid\)/.test(lifeSrcRaw), '（前提）电话体里真的调了落盘那一问（反证锚点）')
    const lifeSrcCode = stripComments(lifeSrcRaw)
    ok(lifeSrcCode.indexOf("ctx.get('sessionQuery')") >= 0, '（前提）落盘那一问走的是 ctx 上的会话查询服务')
    ok(/resolveSessionCwd\(rec\)/.test(lifeSrcCode), '落盘那一条记录仍走共用取法（不另写一套读法）')
  }

  // C 组：两处经同一只函数取值（结构不断即判红，不靠自觉）。
  //   D 组：沙箱无归属会话时不取默认政策（过去传空对象静默拿默认档，写操作落错档也不响）。
  {
    const lifeSrc = stripComments(read(path.join('src', 'host', 'sessionLifecycle.js')))
    const wsSrc = stripComments(read(path.join('src', 'host', 'workspaceCwd.js')))
    const sharedSrc = stripComments(read(SHARED_REL))
    ok(lifeSrc.indexOf('resolveSessionCwd') >= 0, '电话体调共用函数（不自写取法）')
    ok(wsSrc.indexOf('resolveSessionCwd') >= 0, '沙箱那一路调共用函数（不自写取法）')
    ok(lifeSrc.indexOf('header.worktree') < 0 && lifeSrc.indexOf('header.projectDir') < 0 && lifeSrc.indexOf('header.directory') < 0,
      '电话体无自写多字段取法（取法只活在共用函数里）')
    ok(wsSrc.indexOf('header.worktree') < 0 && wsSrc.indexOf('header.cwd || header.path') < 0,
      '沙箱那一路无自写取法（取法只活在共用函数里）')
    ok(sharedSrc.indexOf('worktree') < 0 && sharedSrc.indexOf('projectDir') < 0 && sharedSrc.indexOf('directory') < 0
      && sharedSrc.indexOf('s.meta') < 0 && sharedSrc.indexOf('s.cwd') < 0,
      '共用函数无无证据字段（只读头的目录）')
    ok(wsSrc.indexOf('sessionsOfWorkspace') >= 0, '沙箱按工作区找会话的函数仍在（只换取法，不换行为骨架）')
    ok(wsSrc.indexOf('resolve({})') < 0, '沙箱无归属会话时不调默认政策（免静默落错档）')
  }

  // D 组行为：标签电话在无归属会话时如实失败，不拿默认政策写（走真实 handleListLabels，全套夹具）。
  {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'workspaceCwd.js')).href)
    const resolveCalls = []
    let seenPolicy = 'untouched'
    const tracker = {
      listLabels: async (ref, opCtx) => {
        seenPolicy = opCtx.sandboxPolicy
        if (opCtx.sandboxPolicy === undefined) return { ok: false, error: { kind: 'env', message: '无归属会话，政策缺席' } }
        return { ok: true, data: [] }
      },
    }
    const ws = mod.createWorkspaceCwd({
      ctx: {
        get: (k) => {
          if (k === 'sessions') return { get: () => null, list: () => [] }
          if (k === 'sandboxPolicy') return { resolve: (arg) => { resolveCalls.push(arg); return { POLICY: 1 } } }
          if (k === 'fs') return null
          return undefined
        },
      },
      DEFAULT_CWD: 'D:\\',
      getPlatform: async () => ({}),
      getTrackerRegistry: async () => ({
        select: async () => ({ backendId: 'markdown' }),
        get: () => tracker,
        describe: () => ({ backend: 'markdown', refId: '', name: '', url: '' }),
      }),
      getWorkspaceStore: async () => null,
      getChoiceStore: async () => null,
      canonicalKey: async (raw) => raw,
      setCache: () => {},
      logCtx: null,
      timer: { timeout: (fn) => setTimeout(fn, 0) },
      detectionExec: async () => ({ ok: false }),
    })
    const res = await ws.handleListLabels({ cwd: 'D:\\ilife', sessionId: 'ghost-sid' })
    ok(resolveCalls.length === 0, '无归属会话时一次也不调政策服务（不拿默认档）')
    ok(seenPolicy === undefined, '后端拿到缺席政策（Undefined，不是默认档）')
    ok(res && res.ok === false, '电话如实失败（不静默成功）')
  }

  console.log(failed ? '\n存在失败 — verify-730-cwd-consistent 未通过' : '\n全部通过 — ' + total + ' 项断言（同一会话两处同值）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(2) })
