/**
 * tests/tracker-contract/sections/registry.ts — registry.js 行为段（票 #132 Q2=B）。
 *
 * 第一性原理（#125 定版）：
 *  - 注册只验模块形状（id/label/create/matches），不因缺 op 拒绝；缺方法由 Proxy 补 unsupported 桩。
 *  - id 冲突默认抛 duplicate-id（replace 供 HMR）；'other' 弃用不注册；create 说谎（id 不一致/非对象）拒绝。
 *  - select 两级联三态（matches > fallback；matches 超时→pending:true 排除决策集；
 *    平局=注册序 + multiHit 暴露；无 match/pending 才 fallback→null 且 ref 省略；
 *    pending:true = 仲裁未决（UI 显示等待/请人自己选，不静默 OtherCard））。
 *  - on(unsubscribe) / Disposable（按代隔离：replace 后旧代 dispose 不误杀新代）/ 监听抛错隔离 /
 *    describe / MIGRATE_KEY；unregister 发一条带 id 的 unregister 事件（缓存失效由订阅方按它判）。
 *  - #1138 起注册表只有这些口子：register / unregister / get / has / modules / select / describe /
 *    issueAddress / repoSearchAddress / issueRefPattern / on。
 *    原来那张「这个工作区绑了谁」的进程内副本连同 bind / bound / allBindings 三个口子整段删掉了，
 *    本节最后三条断言就是「它们确实不在」——人选住在工作区文件 docs/agents/workspace.yaml 里。
 *    #1141 又把链接三件的网页口吻老名字连同别名兜底删净，本节也留了一条「确实不在」的断言。
 *  - 链接三件事只转发、不代造（#1112）：后端自己给了就原样转出（模块静态属性与实例旁路两条来源都算），
 *    没给、抛错、或没注册这个 id 就诚实回空——拼票地址与按名搜仓库回 ''，认票写法回 null。
 *    反例（必须被逮）：任何按 backendId 写死的 github / gitlab 网址与正则，一旦回到注册表，这一组立刻变红。
 */

import { createRegistry } from '../../../src/tracker/registry/core.ts' // V1 #461：registry.js 已拆为三块
import { TrackerRegistryError, MIGRATE_KEY } from '../../../src/tracker/registry/shape.ts' // V1 #461：错误类与迁移键随形状文件搬出
import type { BackendModule } from '../../../src/tracker/contract/backend-module.ts'
import type { OpContext, RepoHandle } from '../../../src/tracker/contract/contexts.ts'
import type { RepositoryRef } from '../../../src/tracker/contract/entities.ts'

/**
 * 造一个测试用后端模块：必填五件套给全（规格 1439 起预算口径必填，缺了注册表当场拒绝），缺的操作由注册表按 OPERATIONS 自动补桩。
 * 假模块不断言额度，一律按离网口径声明。
 * over 只覆盖顶层字段（label、create、matches、链接三件），调用方传什么形状，运行时就是什么形状——
 * 类型上按 Partial 收，类型故意写坏的两个地方（nonobj 的 create、slow 的 matches）在各自调用点断言。
 */
const mkModule = (id: string, over: Partial<BackendModule> = {}): BackendModule => Object.assign({
  id,
  label: id,
  budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
  create: () => ({ list: async () => ({ ok: true, data: [] }) }),
  matches: async () => false,
}, over)

const handle: RepoHandle = { cwd: '/workspace' }
const ref0: RepositoryRef = { backend: 'fake', refId: 'r0', name: 'R0', url: '' }
// 测试故意传的空上下文：下面两处调用（被补桩的 update、只回空表的 list）运行时都不读它，
// 但操作签名要求完整的 OpContext（cwd 与 signal 必填），这里断言一次，运行时还是这个空对象。
const noCtx = {} as unknown as OpContext

/** 单条 registry 断言的结果：ok 为判定，detail 留现场。 */
export interface RegistryAssertResult {
  name: string
  ok: boolean
  detail: string
}

export async function run(): Promise<RegistryAssertResult[]> {
  const out: RegistryAssertResult[] = []
  const P = 'registry · '
  const assert = async (name: string, cond: unknown, detail?: string): Promise<void> => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }
  const threw1 = (fn: () => unknown, code?: string): string => {
    try { fn(); return '(no throw)' } catch (e) {
      if (e instanceof TrackerRegistryError && (code == null || e.code === code)) return 'ok'
      // 走到这里说明抛的不是预期的注册表错误：把实际抛出的东西原样拼进返回值，
      // 调用方拿它跟 'ok' 比对，不相等就是一条失败的断言（行为与原来一字不差）。
      const codePart = e ? (e as { code?: unknown }).code : e
      const msgPart = e instanceof Error ? e.message : (e as { message?: unknown })?.message
      return `wrong:${String(codePart)}:${String(msgPart)}`
    }
  }

  // ── 注册 / 形状 ──
  {
    const r = createRegistry()
    const d = r.register(mkModule('alpha'))
    await assert('register 返回 Disposable(dispose)', d && typeof d.dispose === 'function')
    await assert('get(id).id === 模块 id', r.get('alpha')!.id === 'alpha')
    await assert('命中未实现 op → unsupported 桩（返回不抛）', (async () => {
      const res = await r.get('alpha')!.update(ref0, 'k', {}, noCtx)
      return res && res.ok === false && res.error.kind === 'unsupported'
    })(), 'stub must return unsupported')
    await assert('已实现 op 原样可用', (async () => {
      const res = await r.get('alpha')!.list(ref0, {}, noCtx)
      return res && res.ok === true && Array.isArray(res.data)
    })(), 'implemented list must work')
  }

  await assert('duplicate-id 默认抛错', (() => {
    const r = createRegistry()
    r.register(mkModule('dup'))
    return threw1(() => r.register(mkModule('dup')), 'duplicate-id') === 'ok'
  })(), 'duplicate without replace must throw')
  await assert('replace:true 允许 HMR 覆盖', (() => {
    const r = createRegistry()
    r.register(mkModule('rep'))
    const d2 = r.register(mkModule('rep', { label: 'REP2' }), { replace: true })
    return !!(d2 && r.get('rep')) && r.modules().length === 1
  })(), 'replace must not duplicate entries')
  await assert("'other' 弃用不注册", (() => {
    const r = createRegistry()
    return threw1(() => r.register(mkModule('other')), 'other-not-registrable') === 'ok'
  })(), "'other' must be rejected")
  await assert('形状违规拒绝：缺 create', (() => {
    const r = createRegistry()
    return threw1(() => r.register({ id: 'x', label: 'x', matches: async () => false }), 'shape') === 'ok'
  })(), 'missing create must throw shape')
  await assert('形状违规拒绝：缺 matches', (() => {
    const r = createRegistry()
    return threw1(() => r.register({ id: 'x', label: 'x', create: () => ({}) }), 'shape') === 'ok'
  })(), 'missing matches must throw shape')
  await assert('形状违规拒绝：空 id', (() => {
    const r = createRegistry()
    return threw1(() => r.register({ id: '', label: 'x', create: () => ({}), matches: async () => false }), 'shape') === 'ok'
  })(), 'empty id must throw shape')
  await assert('create 说谎拒绝：返回非对象', (() => {
    const r = createRegistry()
    // 故意造坏形状：create 返回数字 42，注册表必须当场拒绝。类型上先断言过去，
    // 运行时流进 register 的还是这个坏模块，测的就是「形状检查拦得住它」。
    return threw1(() => r.register(mkModule('nonobj', { create: (() => 42) as unknown as BackendModule['create'] })), 'shape') === 'ok'
  })(), 'create() returning non-object must throw shape')
  await assert('create 说谎拒绝：id 不一致', (() => {
    const r = createRegistry()
    return threw1(() => r.register(mkModule('liar', { create: () => ({ id: 'OTHER', list: async () => ({ ok: true, data: [] }) }) })), 'shape') === 'ok'
  })(), 'inconsistent id must throw shape (契约说真话)')

  // ── 卸载 / 事件 ──
  await assert('unregister 幂等 + modules 移除', (() => {
    const r = createRegistry()
    r.register(mkModule('gone'))
    r.unregister('gone')
    r.unregister('gone')
    return r.get('gone') === undefined && !r.has('gone') && r.modules().every((m) => m.id !== 'gone')
  })(), 'unregister must be idempotent')
  await assert('Disposable.dispose 触发卸载', (() => {
    const r = createRegistry()
    const d = r.register(mkModule('dp'))
    d.dispose()
    return r.get('dp') === undefined
  })(), 'dispose must unregister')
  await assert('replace 后旧代 dispose 不误杀新代（按代隔离）', (() => {
    const r = createRegistry()
    const d1 = r.register(mkModule('gen'))
    const t1 = r.get('gen')
    const d2 = r.register(mkModule('gen', { label: 'GEN2' }), { replace: true })
    const t2 = r.get('gen')
    d1.dispose()
    return t2 !== t1 && r.get('gen') === t2 && r.modules().length === 1
  })(), 'dispose of a replaced generation must not kill the new tracker')
  await assert('unregister 发一条带 id 的 unregister 事件（#1138 新口径）', (() => {
    const r = createRegistry()
    r.register(mkModule('st'))
    // 监听荷载运行时是 {id} 形状，这里只取 id 一格：标注够取这一格，运行时还是监听器收到的原对象。
    let got: { id?: unknown } | null = null
    r.on('unregister', (p) => { got = p as { id?: unknown } })
    r.unregister('st')
    return got !== null && got.id === 'st'
  })(), 'unregister must notify subscribers with the removed id (缓存失效的判据)')
  await assert('on(register) 触发 + 取消订阅', (() => {
    const r = createRegistry()
    let n = 0
    const off = r.on('register', () => n++)
    r.register(mkModule('e1'))
    off()
    r.register(mkModule('e2'))
    return n === 1
  })(), 'listener must fire once and stop after unsubscribe')
  await assert('监听抛错隔离', (() => {
    const r = createRegistry()
    let n = 0
    r.on('register', () => { throw new Error('listener boom') })
    r.on('register', () => n++)
    r.register(mkModule('iso'))
    return n === 1
  })(), 'a throwing listener must not block others')
  await assert('非法事件名抛 bad-event', (() => {
    const r = createRegistry()
    // 故意传注册表不认的事件名，测的就是「它当场抛 bad-event」。类型上把字面量收窄到合法事件名，
    // 运行时流进 on 的还是 'unknown' 这个原串。
    return threw1(() => r.on('unknown' as 'register', () => {}), 'bad-event') === 'ok'
  })(), 'unknown event must throw')

  // ── select 两级联三态 ──
  // 「explicit」这一档今天不归注册表管：人选住在工作区文件里，由统一判定出口
  // （src/tracker/detection/backendDecision.ts 的 decideBackend）读文件后给出，注册表只答「谁认得这个仓库」。
  await assert('matches 单命中 → source matches + ref', (async () => {
    const r = createRegistry()
    r.register(mkModule('m1', { matches: async () => true }))
    r.register(mkModule('m2', { matches: async () => false }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === 'm1' && sel.source === 'matches' && sel.ref && sel.ref.backend === 'm1' && sel.multiHit === undefined
  })(), 'single matches must choose the hit')
  await assert('multiHit：平局=注册序 + multiHit 暴露', (async () => {
    const r = createRegistry()
    r.register(mkModule('a', { matches: async () => true }))
    r.register(mkModule('b', { matches: async () => true }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === 'a' && Array.isArray(sel.multiHit) && sel.multiHit.join(',') === 'a,b'
  })(), 'tie must pick first registered and expose multiHit')
  await assert('fallback：无 explicit/match/pending → null + 无 ref', (async () => {
    const r = createRegistry()
    r.register(mkModule('n1', { matches: async () => false }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === null && sel.source === 'fallback' && !('ref' in sel) && !sel.pending
  })(), 'no match must fallback to null (ref omitted)')
  await assert('pending：matches 超时 → pending:true + backendId:null', (async () => {
    const r = createRegistry({}, { matchesTimeout: 15 })
    // 故意让 matches 永远不回（模拟卡住的识别），注册表必须按超时判 pending，而不是一直等。
    r.register(mkModule('slow', { matches: () => new Promise<boolean>(() => {}) }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === null && sel.pending === true
  })(), 'timeout must surface pending:true (仲裁未决), not silently OtherCard')
  await assert('pending 被排除：有命中时选命中但保留 pending:true', (async () => {
    const r = createRegistry({}, { matchesTimeout: 15 })
    r.register(mkModule('slow', { matches: () => new Promise<boolean>(() => {}) }))
    r.register(mkModule('fast', { matches: async () => true }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === 'fast' && sel.pending === true
  })(), 'pending must not join decision set')
  await assert('matches 抛错 → 按 false（不炸 select）', (async () => {
    const r = createRegistry()
    r.register(mkModule('boom', { matches: async () => { throw new Error('boom') } }))
    const sel = await r.select(handle, { cwd: handle.cwd })
    return sel.backendId === null
  })(), 'throwing matches must degrade to false')
  await assert('OpContext.signal 传给 matches（AbortSignal）', (async () => {
    let seen: unknown = null
    const r = createRegistry()
    r.register(mkModule('sig', { matches: async (h, ctx) => { seen = ctx && ctx.signal; return false } }))
    await r.select(handle, { cwd: handle.cwd })
    return seen !== null && typeof seen === 'object' && typeof (seen as { aborted?: unknown }).aborted === 'boolean'
  })(), 'signal must be injected into matches ctx')

  // ── #1138：bind / bound / allBindings 三个口子确实不在（不是漏了，是有意删的）──
  // 注册表原来存着一份「这个工作区绑了谁」的进程内副本，与工作区文件
  // docs/agents/workspace.yaml 记的是同一件事的两份记录（宿主重启即消失）。整段删掉之后，
  // 问「这个工作区用哪个后端」只有一条路：统一判定出口 decideBackend 读那份工作区文件。
  // 下面两处把注册表外观转成键值表再读：类型上没有这三个键，读到的 undefined 正是「确实不在」的证据。
  await assert('#1138：注册表不再答「这个工作区绑了谁」（bind/bound/allBindings 三个口子都没有）', (() => {
    const r = createRegistry()
    const facade = r as unknown as Record<string, unknown>
    return typeof facade.bind === 'undefined' && typeof facade.bound === 'undefined' && typeof facade.allBindings === 'undefined'
  })(), 'bind/bound/allBindings must be gone (人选住在工作区文件里)')
  await assert('#1138：三个口子不在，注册表本身照常成立（注册、拿后端、列名单、仲裁都还在）', (() => {
    const r = createRegistry()
    r.register(mkModule('still-works'))
    const hasAll = ['register', 'unregister', 'get', 'has', 'modules', 'select', 'describe', 'on']
      .every((k) => typeof (r as unknown as Record<string, unknown>)[k] === 'function')
    return hasAll && r.has('still-works') && r.get('still-works')!.id === 'still-works' && r.modules().length === 1
  })(), 'the registry must keep answering what it still owns')
  // ── describe / 链接转发（#1112：注册表不替后端拼地址、不造正则） ──
  await assert('describe 出 RepositoryRef（markdown refId=cwd）', (() => {
    const r = createRegistry()
    const ref = r.describe({ cwd: '/a/b' }, 'markdown')
    return ref.backend === 'markdown' && ref.refId === '/a/b' && typeof ref.name === 'string' && ref.url === ''
  })(), 'describe must yield backend/refId/name/url')
  // 这一组用 github / gitlab / 中立三个 id：写死的按名字兜底一旦回来，头两个立刻变红。
  // 探针自证：测试里现注册不带任何静态属性的模块，注册表没有别的来源可抄。
  await assert('后端没给链接能力 → 拼票地址回空（github 房也不许替它拼）', (() => {
    const r = createRegistry()
    r.register(mkModule('github', { create: () => ({}) }))
    return r.issueAddress('github', ref0, '7') === ''
  })(), 'must not assemble https://github.com/<refId>/issues/<key>')
  await assert('后端没给链接能力 → 拼票地址回空（gitlab 房也不许替它拼）', (() => {
    const r = createRegistry()
    r.register(mkModule('gitlab', { create: () => ({}) }))
    return r.issueAddress('gitlab', ref0, '7') === ''
  })(), 'must not assemble the gitlab issue url')
  await assert('后端没给链接能力 → 拼票地址回空（中立 id 一位）', (() => {
    const r = createRegistry()
    r.register(mkModule('nolink', { create: () => ({}) }))
    return r.issueAddress('nolink', ref0, '7') === ''
  })(), 'empty means empty')
  await assert('后端没给链接能力 → 认票写法回 null（github 房也不许造正则）', (() => {
    const r = createRegistry()
    r.register(mkModule('github', { create: () => ({}) }))
    return r.issueRefPattern('github') === null
  })(), 'must not mint a github link pattern')
  await assert('后端没给链接能力 → 认票写法回 null（gitlab 房也不许造正则）', (() => {
    const r = createRegistry()
    r.register(mkModule('gitlab', { create: () => ({}) }))
    return r.issueRefPattern('gitlab') === null
  })(), 'must not mint a gitlab link pattern')
  await assert('后端没给链接能力 → 按名搜仓库回空（github 房也不许拼搜索页）', (() => {
    const r = createRegistry()
    r.register(mkModule('github', { create: () => ({}) }))
    return r.repoSearchAddress('github', 'deck') === ''
  })(), 'must not assemble the github search page')
  await assert('后端自己给了链接能力 → 原样转发（模块静态属性）', (() => {
    const r = createRegistry()
    const pattern = /mine\.example\/issues\/(\d+)/g
    r.register(mkModule('ownlinks', {
      create: () => ({}),
      issueAddress: (ref, key) => 'https://mine.example/' + ref.refId + '/i/' + key,
      repoSearchAddress: (name) => 'https://mine.example/find?q=' + name,
      issueRefPattern: pattern,
    }))
    return r.issueAddress('ownlinks', ref0, '7') === 'https://mine.example/r0/i/7'
      && r.repoSearchAddress('ownlinks', 'deck') === 'https://mine.example/find?q=deck'
      && r.issueRefPattern('ownlinks') === pattern
  })(), 'backend-provided links must be forwarded untouched')
  await assert('后端把三个链接口实现成「实例旁路」 → 也原样转发', (() => {
    const r = createRegistry()
    const pattern = '#(\\d+)'
    r.register(mkModule('instlinks', {
      create: () => ({
        issueAddress: (ref, key) => '/tmp/' + key + '.md',
        repoSearchAddress: (name) => 'https://mine.example/find?q=' + name,
        issueRefPattern: pattern,
      }),
    }))
    return r.issueAddress('instlinks', ref0, '7') === '/tmp/7.md'
      && r.repoSearchAddress('instlinks', 'deck') === 'https://mine.example/find?q=deck'
      && r.issueRefPattern('instlinks') === pattern
  })(), 'tracker-instance link methods must be forwarded too')
  await assert('后端自己抛错 → 回空、不炸调用方（不退回按名字拼地址）', (() => {
    const r = createRegistry()
    r.register(mkModule('boomlinks', {
      create: () => ({}),
      issueAddress: () => { throw new Error('boom') },
      repoSearchAddress: () => { throw new Error('boom') },
    }))
    return r.issueAddress('boomlinks', ref0, '7') === '' && r.repoSearchAddress('boomlinks', 'deck') === ''
  })(), 'a throwing backend must degrade to empty, never to a guessed url')
  await assert('未注册的后端 id → 同样回空（不按名字猜）', (() => {
    const r = createRegistry()
    return r.issueAddress('github', ref0, '7') === '' && r.repoSearchAddress('github', 'deck') === '' && r.issueRefPattern('github') === null
  })(), 'unregistered id must not produce a link out of thin air')
  // ── #1141：链接三件只剩新名字这一套（老名字连别名兜底一起删净） ──
  // 下面第一条是「确实不在」的证据：老名字的口子从注册表上消失了（是有意删的，不是漏了）。
  // 第二条验新名字照旧原样转发——改名与删旧名都不许影响这一条主路。
  await assert('#1141：链接三件的老名字口子确实不在（是有意删的，不是漏了）', (() => {
    const r = createRegistry()
    const facade = r as unknown as Record<string, unknown>
    return typeof facade.issueUrl === 'undefined' && typeof facade.searchUrl === 'undefined' && typeof facade.linkPattern === 'undefined'
  })(), 'legacy link method names must be gone from the registry facade')
  await assert('新名字「给票地址 / 认票写法 / 按名找仓库地址」原样转发', (() => {
    const r = createRegistry()
    const pattern = /mine\.example\/a\/(\d+)/g
    r.register(mkModule('newnames', {
      create: () => ({}),
      issueAddress: (ref, key) => 'https://mine.example/' + ref.refId + '/a/' + key,
      repoSearchAddress: (name) => 'https://mine.example/find?q=' + name,
      issueRefPattern: pattern,
    }))
    return r.issueAddress('newnames', ref0, '7') === 'https://mine.example/r0/a/7'
      && r.repoSearchAddress('newnames', 'deck') === 'https://mine.example/find?q=deck'
      && r.issueRefPattern('newnames') === pattern
  })(), 'backend-neutral link names must be forwarded untouched')
  await assert('MIGRATE_KEY = {other:null} 先落地', MIGRATE_KEY && MIGRATE_KEY.other === null, JSON.stringify(MIGRATE_KEY))

  // ✗ probe：未实现 op 冒充成功必须被逮（Proxy 桩不说谎）
  await assert('✗ probe: 未实现 op 冒充成功被逮', (async () => {
    const r = createRegistry()
    r.register(mkModule('probe'))
    const res = await r.get('probe')!.setBlockedBy(ref0, 'k', [], {}, noCtx)
    return res.ok === false && res.error.kind === 'unsupported'
  })(), 'missing op must NOT lie ok:true')

  return out
}

export default { name: 'registry', run }
