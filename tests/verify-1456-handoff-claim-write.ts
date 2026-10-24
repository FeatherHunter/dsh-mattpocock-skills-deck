/**
 * tests/verify-1456-handoff-claim-write.ts —— 门禁：「确认开始」的认领只走写会话（票 #1456 第 5 条）。
 *
 * 门禁归属: src/host/handoffClaim.ts
 *
 * 为什么要这一条：#1445 把认领从「自己起 gh」改成「开会话、让会话去写」，但 src/host/handoffClaim.ts
 * 的写路径一直没有门禁覆盖：它要是退回直调 gh、把别人的指派人撤掉、或者在会话没接上时抛异常，
 * 现有门禁都看不见。这一条用假会话把这条写路径的行为钉住，不联网、不碰真仓库。
 *
 * 钉住的是这些行为：
 *   ① 认领只经 openSession(cwd, { write: true })：目录先归一，写标志必须带上；
 *   ② 成功回执带票号、会话问出的认领人与 GitHub 链接，并清掉自己的快照根；
 *   ③ 改指派人做并集：先读现有名单、去重（不分大小写）、不撤别人；票号按后端取（GitHub 纯数字）；
 *   ④ 问不到「我是谁」时退回 me / @me，认领本身不因此失败；
 *   ⑤ 读现有指派人失败时只传自己（并集下限），不静默撤掉别人；
 *   ⑥ 会话没接上、没开成、仓库身份不全：都回 kind:'env' 的失败信封，不抛；
 *   ⑦ 空工作区先拒绝，写操作不冒充；后端写失败原样交回且不清快照；会话调用抛错收成 unknown；
 *   ⑧ 静态：本文件不直调 gh（源码里没有 runGh，也不起子进程）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1456-handoff-claim-write.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHandoffClaim } from '../src/host/handoffClaim.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 假会话：三个方法各记一笔调用，行为按 opts 拨；认领只用到这三个。 */
function fakeSession(opts: any = {}): any {
  const seen: any[] = []
  const session = {
    getCurrentUser: async (...args: any[]) => {
      seen.push({ method: 'getCurrentUser', args })
      if (opts.userThrows) throw new Error('问不到当前用户')
      return { ok: true, data: { login: opts.login || 'me-login' } }
    },
    get: async (...args: any[]) => {
      seen.push({ method: 'get', args })
      if (opts.getThrows) throw new Error('读不到现有指派人')
      return { ok: true, data: { assignees: opts.assignees || [] } }
    },
    setAssignees: async (...args: any[]) => {
      seen.push({ method: 'setAssignees', args })
      if (opts.setThrows) throw new Error('会话调用炸了')
      return opts.setResult || { ok: true, data: { tag: 'set-ok' } }
    },
  }
  return { session, seen }
}

/** 装一世界：假会话 + 记下开会话与清缓存的调用；over 用来拨失败分支。 */
function makeWorld(over: any = {}, sessionOpts: any = {}): any {
  const opened: any[] = []
  const cacheWrites: any[] = []
  const { session, seen } = fakeSession(sessionOpts)
  const deps: any = {
    fs: undefined,
    DEFAULT_CWD: '/default',
    normCwd: async (c: string) => 'N/' + c,
    openSession: async (cwd: any, opts: any) => {
      opened.push({ cwd, opts })
      if (over.openFails) return over.openFails
      const repoRef = Object.prototype.hasOwnProperty.call(over, 'repoRef')
        ? over.repoRef
        : { backend: 'github', refId: 'o/r' }
      return { ok: true, repoRef, call: async (fn: any) => fn(session, { tag: 'op-ctx' }) }
    },
    setCache: (v: any) => { cacheWrites.push(v) },
    logCtx: null,
  }
  if (over.noOpenSession) delete deps.openSession
  return { api: createHandoffClaim(deps), opened, seen, cacheWrites }
}

async function main(): Promise<void> {
  console.log('== 认领只走写会话（票 #1456 第 5 条） ==')
  // —— ①②③ 正常路：归一目录、带写标志、并集去重、回执与清快照 ——
  const w1 = makeWorld({}, { assignees: [{ login: 'alice' }, { login: 'Me-Login' }] })
  const r1 = await w1.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  check(w1.opened.length === 1, '认领只开一次会话（实得 ' + w1.opened.length + ' 次）')
  check(w1.opened[0] && w1.opened[0].cwd === 'N/D:/ws', '开会话前先归一路径（实得 ' + JSON.stringify(w1.opened[0] && w1.opened[0].cwd) + '）')
  check(w1.opened[0] && w1.opened[0].opts && w1.opened[0].opts.write === true, '带写标志开会话（opts.write 必须为 true）')
  check(r1.ok === true, '认领成功回 ok:true（实得 ' + JSON.stringify(r1) + '）')
  check(r1.ok === true && r1.number === 7 && r1.assignedTo === 'me-login' && r1.url === 'https://github.com/o/r/issues/7',
    '回执带票号、会话问出的认领人与 GitHub 链接（实得 ' + JSON.stringify(r1) + '）')
  const set1 = w1.seen.filter((x: any) => x.method === 'setAssignees')
  check(set1.length === 1, '成功路径只发一次改指派人（实得 ' + set1.length + ' 次）')
  const call1 = set1[0] && set1[0].args
  check(call1 && call1[1] === '7', 'GitHub 票号用纯数字（实得 ' + JSON.stringify(call1 && call1[1]) + '）')
  check(call1 && same(call1[2], ['me-login', 'alice']),
    '先读现有名单再做并集、大小写去重、不撤别人（实得 ' + JSON.stringify(call1 && call1[2]) + '）')
  check(w1.cacheWrites.length === 1 && w1.cacheWrites[0].ts === 0, '认领成功后清掉自己的快照根（实得 ' + JSON.stringify(w1.cacheWrites) + '）')

  // —— ④ 问不到「我是谁」：退回 me / @me ——
  const w4 = makeWorld({}, { userThrows: true, assignees: [{ login: 'alice' }] })
  const r4 = await w4.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  const set4 = w4.seen.filter((x: any) => x.method === 'setAssignees')[0]
  check(r4.ok === true && r4.assignedTo === 'me', '问不到当前用户时认领照常成功、展示名退回 me（实得 ' + JSON.stringify(r4) + '）')
  check(set4 && same(set4.args[2], ['@me', 'alice']), 'GitHub 的认领目标退回 @me，别人的名字仍在（实得 ' + JSON.stringify(set4 && set4.args[2]) + '）')

  // —— ⑤ 读现有指派人失败：并集下限只有自己 ——
  const w5 = makeWorld({}, { getThrows: true })
  const r5 = await w5.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  const set5 = w5.seen.filter((x: any) => x.method === 'setAssignees')[0]
  check(r5.ok === true && set5 && same(set5.args[2], ['me-login']), '读现有指派人失败时只传自己（实得 ' + JSON.stringify(set5 && set5.args[2]) + '）')

  // —— ⑥ 会话没接上：不抛、不假装发过请求 ——
  const w6 = makeWorld({ noOpenSession: true })
  let threw6 = false
  let r6: any = null
  try { r6 = await w6.api.handleClaim({ cwd: 'D:/ws', number: 7 }) } catch (e) { threw6 = true }
  check(!threw6, '写会话没接上时不抛异常')
  check(r6 && r6.ok === false && r6.error && r6.error.kind === 'env',
    '写会话没接上回 kind:env 的失败信封（实得 ' + JSON.stringify(r6) + '）')
  check(w6.opened.length === 0, '写会话没接上时一次会话都没开')

  // —— ⑥ 会话没开成：把原因写进失败信封 ——
  const w7 = makeWorld({ openFails: { ok: false, reason: 'pending' } })
  const r7 = await w7.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  check(r7 && r7.ok === false && r7.error && r7.error.kind === 'env' && String(r7.error.error).indexOf('pending') >= 0,
    '会话没开成回 env 且写明原因（实得 ' + JSON.stringify(r7) + '）')

  // —— ⑥ 仓库身份不全：不让写落到猜出来的仓库上 ——
  const w8a = makeWorld({ repoRef: { refId: 'o/r' } })
  const r8a = await w8a.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  check(r8a && r8a.ok === false && r8a.error && r8a.error.kind === 'env', '仓库身份缺后端时回 env（实得 ' + JSON.stringify(r8a) + '）')
  const w8b = makeWorld({ repoRef: { backend: 'github', refId: 'o-r' } })
  const r8b = await w8b.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  check(r8b && r8b.ok === false && r8b.error && r8b.error.kind === 'env', 'GitHub 仓库身份不是 owner/repo 时回 env（实得 ' + JSON.stringify(r8b) + '）')

  // —— ⑦ 空工作区：写操作不冒充 ——
  const w9 = makeWorld()
  const r9 = await w9.api.handleClaim({ cwd: '   ', number: 7 })
  check(r9 && r9.ok === false && typeof r9.error === 'string', '空工作区回可读的失败（error 是字符串，实得 ' + JSON.stringify(r9) + '）')
  check(w9.opened.length === 0, '空工作区时不开会话（不往猜出来的仓库上写）')

  // —— ⑦ 别的后端：票号两位补零，认领目标用 me，不给 GitHub 链接 ——
  const w10 = makeWorld({ repoRef: { backend: 'markdown', refId: 'notes' } }, { userThrows: true, assignees: [{ login: 'alice' }] })
  const r10 = await w10.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  const set10 = w10.seen.filter((x: any) => x.method === 'setAssignees')[0]
  check(r10.ok === true && r10.number === 7 && r10.assignedTo === 'me' && r10.url === '', '非 GitHub 后端回执不带链接、展示名仍是 me（实得 ' + JSON.stringify(r10) + '）')
  check(set10 && set10.args[1] === '07' && same(set10.args[2], ['me', 'alice']),
    '非 GitHub 后端票号两位补零、认领目标用 me（实得 ' + JSON.stringify(set10 && set10.args) + '）')

  // —— ⑦ 后端写失败：原样交回，不清快照 ——
  const w11 = makeWorld({}, { setResult: { ok: false, error: { kind: 'rate-limit', message: '预算耗尽，本次调用推迟' } } })
  const r11 = await w11.api.handleClaim({ cwd: 'D:/ws', number: 7 })
  check(r11 && r11.ok === false && r11.error && r11.error.kind === 'rate-limit', '后端写失败时原样交回失败信封（实得 ' + JSON.stringify(r11) + '）')
  check(w11.cacheWrites.length === 0, '写失败时不清快照（没发生的变化不通知面板）')

  // —— ⑦ 会话调用抛错：收成 unknown，不抛出到调用点 ——
  const w12 = makeWorld({}, { setThrows: true })
  let threw12 = false
  let r12: any = null
  try { r12 = await w12.api.handleClaim({ cwd: 'D:/ws', number: 7 }) } catch (e) { threw12 = true }
  check(!threw12 && r12 && r12.ok === false && r12.error && r12.error.kind === 'unknown' && String(r12.error.error).indexOf('写会话调用失败') >= 0,
    '会话调用抛错收成 unknown，不抛给调用点（实得 ' + JSON.stringify(r12) + '）')

  // —— ⑧ 静态：写路径不直调 gh ——
  const src = fs.readFileSync(path.join(ROOT, 'src/host/handoffClaim.ts'), 'utf8')
  check(src.indexOf('runGh') < 0, 'handoffClaim 源码里没有 runGh（认领不再自己起 gh）')
  check(src.indexOf('child_process') < 0, 'handoffClaim 源码里没有 child_process（写只经会话）')

  console.log(failed ? '\n存在失败 — verify-1456-handoff-claim-write 未通过' : '\n全部通过 — 认领写路径门禁生效（' + total + ' 项断言）')
  printGateResult('verify-1456-handoff-claim-write', total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && (e as Error).stack) || String(e)))
  process.exit(1)
})
