#!/usr/bin/env node
// tests/verify-1612-deck-tool-gate.ts —— 门禁：#1612 宿主侧按工作区收掉 deck 工具（闸门纯逻辑 + 两处接线契约）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1612-deck-tool-gate.ts
//
// 这一段盯五件事（对应验收 ② 与 ⑧ 的工具侧）：
//   ① 要挡的十二个工具名与 src/deck/tools/ 下真实定义、注册帮助里的 probeDefinition、suggest_next_steps 一字不差；
//   ② 设置文档里 deckTools=off 的工作区会被认出来，on / 缺格一律按开处理；工作区键两侧都按共享层 keyOf 折算；
//   ③ 闸门对「off 工作区的 agent」只传 deny 挂限制、绝不传 allow（别的插件工具不受影响），
//      on 的工作区、看不出工作区的 agent 一律不动；设置改回 on 时 disposer 被调用；
//   ④ agent 销毁时清理、挂载失败不掀翻宿主、restrict 因「名字还不是已知全局工具」失败时会重试；
//   ⑤ settingsPhones 成功读 / 写设置后真的把文档发布到了闸门认的那个槽位（发布方与订阅方都导入核里同一个常量）。
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DECK_SETTINGS_BUS_SLOT as BUS_SLOT } from '../src/shared/config-store/src/settings.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

let total = 0
let failed = 0
const check = (ok: any, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed += 1
}

// 槽位名只有一个定义处（核里 src/shared/config-store/src/settings.ts 导出，settingsPhones 与 deckToolGate 都导入）；
// 这里也导入它，不手写字符串。下面还会断言两边真的走导入而不是各自写一份字面量。

function resetBus(): void {
  try { delete (globalThis as any)[BUS_SLOT] } catch (e) {}
}

// 模拟 settingsPhones 的发布动作：写值再逐个叫醒监听器（与真实实现同一形状）。
function publishSettings(value: any): void {
  const g: any = globalThis as any
  let bus = g[BUS_SLOT]
  if (!bus || typeof bus !== 'object') {
    bus = { value: null, at: 0, listeners: [] }
    g[BUS_SLOT] = bus
  }
  if (!Array.isArray(bus.listeners)) bus.listeners = []
  bus.value = value
  bus.at = Date.now()
  for (const listener of bus.listeners.slice()) {
    try { if (typeof listener === 'function') listener(value) } catch (e) {}
  }
}

const tick = (): Promise<void> => new Promise<void>(function (resolve) { setImmediate(resolve) })
async function settle(rounds?: number): Promise<void> {
  const n = rounds || 40
  for (let i = 0; i < n; i++) await tick()
}

// 假 agent：session.header.cwd 是会话目录；ctx.get('tools') 交出可记录调用的 restrict。
// restrict 的行为由 behaviour 决定（正常返回 disposer / 抛指定错误 / 前几次抛错后成功）。
function fakeAgent(id: string, cwd: any, behaviour?: any): any {
  const stats = { restrictCalls: [] as any[], releaseCount: 0, successfulRestricts: 0 }
  const behaviourFn = behaviour && typeof behaviour.restrict === 'function' ? behaviour.restrict : null
  const tools = {
    restrict: function (filter: any): any {
      stats.restrictCalls.push(filter)
      if (behaviourFn) return behaviourFn(filter, stats)
      stats.successfulRestricts += 1
      return function (): void { stats.releaseCount += 1 }
    },
  }
  const header = typeof cwd === 'string' ? { cwd: cwd } : {}
  return {
    id: id,
    session: { header: header },
    ctx: { get: function (name: string): any { return name === 'tools' ? tools : undefined } },
    stats: stats,
  }
}

// 假宿主 ctx：带 on/emit 与 agents 注册表（list 返回固定数组），可选让 agents 服务缺席。
function fakeHostCtx(agents: any[], opts?: any): any {
  const handlers: any = { 'agent/created': [], 'agent/disposed': [] }
  const registry = { list: function (): any[] { return agents.slice() } }
  const hostCtx: any = {
    handlers: handlers,
    on: function (name: string, fn: any): any {
      if (!handlers[name]) handlers[name] = []
      handlers[name].push(fn)
      return function (): boolean {
        const at = handlers[name].indexOf(fn)
        if (at >= 0) handlers[name].splice(at, 1)
        return true
      }
    },
    get: function (name: string): any {
      if (name !== 'agents') return undefined
      if (opts && opts.noAgentsService) return undefined
      return registry
    },
  }
  return hostCtx
}

function fire(hostCtx: any, name: string, payload: any): void {
  for (const fn of (hostCtx.handlers[name] || []).slice()) {
    try { fn(payload) } catch (e) {}
  }
}

// 假 canonicalKey：把会话目录归到工作区根；映射表外的原样返回（模拟「认不出归属」的保守档）。
function makeDeps(extra?: any): any {
  const roots: any = {
    'D:/work/off/sub': 'D:/work/off',
    'D:/work/on/sub': 'D:/work/on',
  }
  const deps: any = {
    canonicalKey: async function (cwd: any): Promise<any> { return roots[String(cwd)] || String(cwd) },
    logCtx: { events: [] as any[], fire: function (level: string, event: string, fields: any): void { this.events.push({ level: level, event: event, fields: fields }) } },
    retries: 5,
    wait: function (): Promise<void> { return Promise.resolve() },
  }
  if (extra) {
    for (const k of Object.keys(extra)) deps[k] = extra[k]
  }
  return deps
}

// 一份归一后的设置文档：off 工作区关掉、on 工作区开着、第三格缺 deckTools（缺省按开）。
function settingsOff(): any {
  return {
    version: 1,
    workspaces: {
      'D:/work/off': { statusBar: 'hide', deckTools: 'off' },
      'D:/work/on': { statusBar: 'show', deckTools: 'on' },
      'D:/work/default': { statusBar: 'hide' },
    },
  }
}
function settingsOn(): any {
  return {
    version: 1,
    workspaces: {
      'D:/work/off': { statusBar: 'hide', deckTools: 'on' },
      'D:/work/on': { statusBar: 'show', deckTools: 'on' },
    },
  }
}

async function main(): Promise<void> {
  console.log('#1612 宿主侧 deck 工具闸门：名字一致、只挡 off 工作区、只 deny、可撤销、可清理、能重试')

  // ── 0. 模块装载与槽位名 ──
  let gate: any = null
  try {
    gate = await imp('src/host/deckToolGate.ts')
  } catch (e) {
    check(false, '闸门模块可加载（src/host/deckToolGate.ts）：' + String((e as any) && (e as any).message || e))
    console.log('\n' + total + ' 条断言，失败')
    process.exit(1)
  }
  check(typeof gate.hookDeckToolGate === 'function', '交出 hookDeckToolGate（宿主挂载口）')
  check(typeof gate.shouldGateAgent === 'function', '交出 shouldGateAgent（工作区归属判定，可注入 deps）')
  check(typeof gate.deckSwitchesOf === 'function', '交出 deckSwitchesOf（设置文档 → 关掉的工作区键）')
  check(Array.isArray(gate.DECK_GATED_TOOL_NAMES), '交出 DECK_GATED_TOOL_NAMES 名单')
  check(gate.DECK_SETTINGS_BUS_SLOT === BUS_SLOT, '闸门转出的槽位名与核里定义的是同一个：' + BUS_SLOT)
  const readSource = async (rel: string) => await (await import('node:fs/promises')).readFile(path.join(ROOT, rel), 'utf8')
  const gateSrc = await readSource('src/host/deckToolGate.ts')
  const phonesSrc = await readSource('src/host/settingsPhones.ts')
  check(gateSrc.indexOf("from '../shared/config-store/src/settings.js'") >= 0, '闸门从核里导入槽位常量（编译器连得起来就用导入，不各写一遍）')
  check(phonesSrc.indexOf("from '../shared/config-store/src/settings.js'") >= 0, '发布方 settingsPhones 也从核里导入同一个常量')
  check(gateSrc.indexOf("'__dsh_mattskillsdeck_settings_bus__'") < 0 && phonesSrc.indexOf("'__dsh_mattskillsdeck_settings_bus__'") < 0, '两边都没有第二份槽位字符串字面量（一份定义，不会改一处漏一处）')
  const { keyOf } = await imp('src/shared/workspaceKey.ts')
  check(typeof keyOf === 'function', '共享层 keyOf 可用（工作区键唯一折算口径）')

  // ── 1. 十二个名字与真实定义文件逐个对上 ──
  const toolFiles = [
    'src/deck/tools/context.ts',
    'src/deck/tools/issue-get.ts',
    'src/deck/tools/map-snapshot.ts',
    'src/deck/tools/issue-list.ts',
    'src/deck/tools/issue-create.ts',
    'src/deck/tools/map-plan-create.ts',
    'src/deck/tools/map-link.ts',
    'src/deck/tools/issue-patch.ts',
    'src/deck/tools/issue-report.ts',
    'src/deck/tools/work-route.ts',
  ]
  const realNames: string[] = []
  for (const rel of toolFiles) realNames.push((await imp(rel)).definition.name)
  const registerOptions = await imp('src/deck/registration/register-options.ts')
  check(registerOptions && registerOptions.probeDefinition && registerOptions.probeDefinition.name === 'deck_probe', 'deck_probe 的真定义在注册帮助里（name = deck_probe）')
  realNames.push(registerOptions.probeDefinition.name)
  const suggest = await imp('src/deck/tools/suggest-next-steps.ts')
  check(suggest.SUGGEST_TOOL_NAME === 'suggest_next_steps' && suggest.definition.name === suggest.SUGGEST_TOOL_NAME, 'suggest_next_steps 的真定义与常量同名')
  realNames.push(suggest.definition.name)

  const gated = gate.DECK_GATED_TOOL_NAMES.slice()
  check(gated.length === 12, '要挡的名字正好十二个（实际 ' + gated.length + '）')
  check(new Set(gated).size === gated.length, '名单里没有重复名字')
  check(realNames.length === 12, '真实定义文件凑出十二个名字（实际 ' + realNames.length + '）')
  check(gated.slice().sort().join(',') === realNames.slice().sort().join(','), '闸门名单与真实定义集合完全一致（多一个少一个都算失败）')

  // ── 2. 设置文档 → 关掉的工作区：只认显式 off，键按 keyOf 折算 ──
  const parsed = gate.deckSwitchesOf(settingsOff())
  check(parsed.known === true, '形状正确的设置文档被认出来（known = true）')
  check(parsed.offKeys.length === 1 && parsed.offKeys[0] === keyOf('D:/work/off'), '只有 deckTools=off 的那个工作区进 offKeys，键已按 keyOf 折算')
  check(gate.deckSwitchesOf(null).known === false, 'null 文档按「说不清」处理（不挡）')
  check(gate.deckSwitchesOf({ version: 1 }).known === false, '没有 workspaces 的文档按「说不清」处理（不挡）')
  check(gate.deckSwitchesOf({ workspaces: {} }).known === true && gate.deckSwitchesOf({ workspaces: {} }).offKeys.length === 0, '空工作区表是合法文档：一个都不关')

  // ── 3. 工作区归属判定（纯逻辑） ──
  const deps = makeDeps()
  check((await gate.shouldGateAgent('D:/work/off', parsed, deps)) === true, '会话目录正好是 off 工作区根 → 该挡')
  check((await gate.shouldGateAgent('D:/work/off/sub', parsed, deps)) === true, '会话目录是 off 工作区的子目录 → 经 canonicalKey 归一后该挡')
  check((await gate.shouldGateAgent('D:/work/on', parsed, deps)) === false, 'on 工作区 → 不挡')
  check((await gate.shouldGateAgent('D:/work/default', parsed, deps)) === false, '缺 deckTools 一格的工作区按缺省开 → 不挡')
  check((await gate.shouldGateAgent('', parsed, deps)) === false, '没有会话目录 → 不挡（宁可少挡，不可误挡）')
  check((await gate.shouldGateAgent('', { known: false, offKeys: ['d:/work/off'] }, deps)) === false, '设置还没读到时 → 不挡')
  const throwDeps = makeDeps({ canonicalKey: async function (): Promise<any> { throw new Error('canonical failed') } })
  check((await gate.shouldGateAgent('D:/work/off/sub', parsed, throwDeps)) === false, 'canonicalKey 失败时装不认识这个目录 → 不挡')

  // ── 4. 挂闸门：只挡 off 工作区、只传 deny、设置改回 on 时撤销 ──
  resetBus()
  publishSettings(settingsOff())
  const offAgent = fakeAgent('off-1', 'D:/work/off/sub')
  const onAgent = fakeAgent('on-1', 'D:/work/on')
  const unknownAgent = fakeAgent('unknown-1', 'D:/elsewhere')
  const noCwdAgent = fakeAgent('no-cwd', undefined)
  const hostCtx = fakeHostCtx([offAgent, onAgent, unknownAgent, noCwdAgent])
  let shell: any = null
  try {
    shell = gate.hookDeckToolGate(hostCtx, makeDeps())
  } catch (e) {
    check(false, '挂载不抛错：' + String((e as any) && (e as any).message || e))
  }
  check(shell && typeof shell.dispose === 'function', '挂载返回带 dispose 的壳')
  await settle()
  check(offAgent.stats.restrictCalls.length === 1, 'off 工作区的 agent 拿到一条限制（实际 ' + offAgent.stats.restrictCalls.length + '）')
  const filter = offAgent.stats.restrictCalls[0]
  check(filter && Object.keys(filter).join(',') === 'deny', '限制里只有 deny，没有 allow（别的插件工具不受影响）')
  check(Array.isArray(filter.deny) && filter.deny.slice().sort().join(',') === gate.DECK_GATED_TOOL_NAMES.slice().sort().join(','), 'deny 名单就是那十二个工具名')
  check(filter.deny !== gate.DECK_GATED_TOOL_NAMES, '传给平台的名单是副本，不是导出的那份数组')
  check(onAgent.stats.restrictCalls.length === 0, 'on 工作区的 agent 不动')
  check(unknownAgent.stats.restrictCalls.length === 0, '看不出工作区的 agent 不动（不误挡）')
  check(noCwdAgent.stats.restrictCalls.length === 0, '没有会话目录的 agent 不动')

  publishSettings(settingsOn())
  await settle()
  check(offAgent.stats.releaseCount === 1, '设置改回 on：原来挂上的限制被撤销（disposer 被调用）')
  check(offAgent.stats.restrictCalls.length === 1, '撤销动作本身不会重复挂限制')

  publishSettings(settingsOff())
  await settle()
  check(offAgent.stats.restrictCalls.length === 2, '再关一次：重新挂上限制（设置变化两个方向都跟随）')

  if (shell) shell.dispose()
  check(offAgent.stats.releaseCount === 2, '卸载壳时把限制也撤掉')
  publishSettings(settingsOn())
  publishSettings(settingsOff())
  await settle()
  check(offAgent.stats.restrictCalls.length === 2, '卸载后槽位里的变化不再动这个 agent（监听器已退订）')

  // ── 5. 新建 agent 走 agent/created 事件；销毁走 agent/disposed ──
  resetBus()
  publishSettings(settingsOff())
  const liveCtx = fakeHostCtx([])
  const liveShell = gate.hookDeckToolGate(liveCtx, makeDeps())
  await settle()
  const createdAgent = fakeAgent('created-off', 'D:/work/off')
  fire(liveCtx, 'agent/created', { agent: createdAgent, source: 'test' })
  await settle()
  check(createdAgent.stats.restrictCalls.length === 1, '闸门挂载后新建的 off 工作区 agent 立即拿到限制')
  const createdOn = fakeAgent('created-on', 'D:/work/on')
  fire(liveCtx, 'agent/created', { agent: createdOn, source: 'test' })
  await settle()
  check(createdOn.stats.restrictCalls.length === 0, '新建的 on 工作区 agent 不受影响')
  fire(liveCtx, 'agent/disposed', { agent: createdAgent })
  await settle()
  check(createdAgent.stats.releaseCount === 1, 'agent 销毁时清理：限制的 disposer 被调用')
  fire(liveCtx, 'agent/disposed', { agent: createdOn })
  await settle()
  check(createdOn.stats.releaseCount === 0, '销毁没挂过限制的 agent 不会误伤')

  // ── 6. restrict 说「名字还不是已知全局工具」时重试（deck 工具注册可能比闸门晚） ──
  resetBus()
  publishSettings(settingsOff())
  let retryAttempts = 0
  const retryAgent = fakeAgent('retry-off', 'D:/work/off', {
    restrict: function (): any {
      retryAttempts += 1
      if (retryAttempts <= 2) throw new Error('tools.restrict() names unknown global tool "suggest_next_steps"; known global tools: deck_context')
      return function (): void { retryAgent.stats.releaseCount += 1 }
    },
  })
  const retryCtx = fakeHostCtx([retryAgent])
  const retryDeps = makeDeps({ retries: 5, wait: function (): Promise<void> { return Promise.resolve() } })
  let retryShell: any = null
  try {
    retryShell = gate.hookDeckToolGate(retryCtx, retryDeps)
  } catch (e) {
    check(false, '重试路径挂载不抛错：' + String((e as any) && (e as any).message || e))
  }
  await settle(80)
  check(retryAttempts === 3, '未知工具名失败后重试，第三次成功（实际尝试 ' + retryAttempts + ' 次）')
  check(retryAgent.stats.restrictCalls.length === 3, 'restrict 被调了三次（一次原始 + 两次重试）')
  publishSettings(settingsOn())
  await settle()
  check(retryAgent.stats.releaseCount === 1, '重试成功后挂上的限制，同样能在设置改回 on 时撤销')
  if (retryShell) retryShell.dispose()

  // ── 7. 重试用尽只记日志、不掀翻宿主；平台作用域错误不重试 ──
  resetBus()
  publishSettings(settingsOff())
  const exhaustedAgent = fakeAgent('exhausted', 'D:/work/off', {
    restrict: function (): any { throw new Error('tools.restrict() names unknown global tool "deck_probe"') },
  })
  const exhaustedLog = { events: [] as any[], fire: function (level: string, event: string, fields: any): void { this.events.push({ level: level, event: event, fields: fields }) } }
  const exhaustedDeps = makeDeps({ retries: 2, wait: function (): Promise<void> { return Promise.resolve() }, logCtx: exhaustedLog })
  let exhaustedShell: any = null
  try {
    exhaustedShell = gate.hookDeckToolGate(fakeHostCtx([exhaustedAgent]), exhaustedDeps)
  } catch (e) {
    check(false, '重试用尽也不抛错：' + String((e as any) && (e as any).message || e))
  }
  await settle(80)
  check(exhaustedAgent.stats.restrictCalls.length === 3, '重试用尽后停在 三次尝试（不无限重试，实际 ' + exhaustedAgent.stats.restrictCalls.length + '）')
  const failEvents = exhaustedLog.events.filter(function (e: any): boolean { return e.event === 'host.call.fail' && e.fields && e.fields.method === 'deck.toolGate' })
  check(failEvents.length >= 1, '最终失败落既有 host.call.fail 事件（method = deck.toolGate）')
  check(exhaustedLog.events.every(function (e: any): boolean { return e.event === 'host.call' || e.event === 'host.call.fail' }), '闸门只复用既有事件名，不新增事件')
  if (exhaustedShell) exhaustedShell.dispose()

  resetBus()
  publishSettings(settingsOff())
  let scopedAttempts = 0
  const scopedAgent = fakeAgent('scoped', 'D:/work/off', {
    restrict: function (): any { scopedAttempts += 1; throw new Error('tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent') },
  })
  const scopedShell = gate.hookDeckToolGate(fakeHostCtx([scopedAgent]), makeDeps())
  await settle()
  check(scopedAttempts === 1, '平台作用域错误不重试（重试也解决不了，只记日志，实际 ' + scopedAttempts + ' 次）')
  if (scopedShell) scopedShell.dispose()

  // ── 8. 服务缺席 / ctx 残缺：挂载与卸载都不炸宿主 ──
  resetBus()
  const bareCtx: any = { get: function (): any { return undefined } }
  let bareShell: any = null
  try {
    bareShell = gate.hookDeckToolGate(bareCtx, makeDeps())
  } catch (e) {
    check(false, 'ctx 没有 on 也没有 agents 服务时不抛错：' + String((e as any) && (e as any).message || e))
  }
  check(bareShell && typeof bareShell.dispose === 'function', '残缺 ctx 也返回可卸载的壳')
  if (bareShell) bareShell.dispose()
  let nullShell: any = gate.hookDeckToolGate(null, null)
  check(nullShell && typeof nullShell.dispose === 'function', 'ctx 为空串时返回空壳')
  nullShell.dispose()
  check(true, '空壳重复 dispose 不抛错')

  // ── 9. 挂载时设置槽位还空着：deps.loadSettings 兜底初读 ──
  resetBus()
  let loadCalls = 0
  const bootstrapCtx = fakeHostCtx([])
  const bootstrapShell = gate.hookDeckToolGate(bootstrapCtx, makeDeps({ loadSettings: async function (): Promise<any> { loadCalls += 1; return settingsOff() } }))
  await settle()
  check(loadCalls === 1, '槽位空时经 deps.loadSettings 读一次设置（实际 ' + loadCalls + ' 次）')
  const bootAgent = fakeAgent('boot-off', 'D:/work/off')
  fire(bootstrapCtx, 'agent/created', { agent: bootAgent, source: 'test' })
  await settle()
  check(bootAgent.stats.restrictCalls.length === 1, '兜底初读拿到的 off 设置，对之后新建的 agent 生效')
  if (bootstrapShell) bootstrapShell.dispose()

  // ── 10. settingsPhones 真的把文档发到闸门认的槽位（常量定义在核里，发布方与订阅方都导入它） ──
  resetBus()
  const phones = await imp('src/host/settingsPhones.ts')
  check(phones && typeof phones.createSettingsPhones === 'function', 'settingsPhones 模块可加载（发布那一侧）')
  check(phones.DECK_SETTINGS_BUS_SLOT === undefined, 'settingsPhones 不再自己定义槽位常量（要取就从核里取）')
  const instance = phones.createSettingsPhones({
    getPlatform: async function (): Promise<any> { return { getHome: async function (): Promise<string> { return 'C:/home' } } },
    readLocalSettings: async function (): Promise<any> { return { ok: true, value: settingsOff(), from: 'yaml', readonly: false, warnings: [] } },
    writeLocalSettings: async function (): Promise<any> { return { ok: true, from: 'yaml', warnings: [] } },
  })
  const integrationCtx = fakeHostCtx([])
  const integrationShell = gate.hookDeckToolGate(integrationCtx, makeDeps({ wait: function (): Promise<void> { return Promise.resolve() } }))
  await settle()
  const readRes = await instance.handleGetSettings({})
  check(readRes && readRes.ok === true && readRes.value && readRes.value.workspaces, '设置电话读回的返回形状不变（ok + value 还在）')
  const busNow: any = (globalThis as any)[BUS_SLOT]
  check(busNow && busNow.value && busNow.value.workspaces, '读设置成功后文档出现在闸门认的槽位上')
  const integrationAgent = fakeAgent('integration-off', 'D:/work/off/sub')
  fire(integrationCtx, 'agent/created', { agent: integrationAgent, source: 'test' })
  await settle()
  check(integrationAgent.stats.restrictCalls.length === 1, '经设置电话发布的值驱动闸门：off 工作区的新 agent 拿到限制')
  const writeRes = await instance.handleSetSettings({ value: settingsOn() })
  check(writeRes && writeRes.ok === true && writeRes.from === 'yaml', '设置电话写回的返回形状不变（ok + from）')
  await settle()
  check(integrationAgent.stats.releaseCount === 1, '写设置成功后闸门立刻跟随：限制被撤销')
  const busAfterWrite: any = (globalThis as any)[BUS_SLOT]
  check(busAfterWrite && busAfterWrite.value && busAfterWrite.value.workspaces && busAfterWrite.value.workspaces['D:/work/off'].deckTools === 'on', '写设置成功后槽位里是最新那份文档')
  if (integrationShell) integrationShell.dispose()

  // ── 11. 刷新接线契约：闸门必须排在 deck 工具注册之后（源码层面看调用顺序） ──
  const wiringSource = await (await import('node:fs/promises')).readFile(path.join(ROOT, 'src/refresh/rooms/host/refresh-runtime.ts'), 'utf8')
  const atRegister = wiringSource.indexOf('hookDeckAgentTools(')
  const atGate = wiringSource.indexOf('hookDeckToolGate(')
  check(atRegister >= 0 && atGate >= 0, '刷新接线里既有 deck 工具注册、也有闸门挂载')
  check(atGate > atRegister, '闸门挂载排在 deck 工具注册之后（否则平台会说名字还不是已知全局工具）')

  console.log('\n' + total + ' 条断言，' + (failed ? failed + ' 条失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any) {
  console.log('  FAIL 门禁本体抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
