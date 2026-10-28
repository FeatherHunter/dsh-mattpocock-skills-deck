/**
 * src/host/deckToolGate.ts —— #1612 宿主侧闸门：按工作区关掉 deck 工具箱时，把 deck 工具从该工作区会话身上收走。
 *
 * 为什么要有它：设置文件里每个工作区多了一条 deckTools（on / off，缺省 on）。用户在某个工作区把 deck 工具箱
 * 关掉之后，光把界面藏起来还不够 —— 该工作区里已经开着的会话、以及之后新开的会话，工具表里也不该再出现
 * deck_* 工具与 suggest_next_steps，否则 agent 还能自己拐回去用一套「已经关掉的工具」。这一步只能在宿主做。
 *
 * 平台能力（2026-10-29 在 node_modules/@deepseek-ai/dsh-tools 里核对过，下面每一条都有出处，改代码前先复核）：
 * 1. tools.restrict({ deny }) 只接受 agent 作用域（agent.ctx 那一层），在全局 ctx 上调会抛
 *    「requires a scoped context」；allow / deny 里出现 run_code 会抛（PTC 传输模式保留），名字不在当前
 *    全局工具表里也会抛「names unknown global tool」。所以调用必须排在 deck 工具注册完成之后。
 * 2. restrict 返回的是一个可调用的 disposer 函数，调一下就撤销这一层限制；它只过滤继承来的全局工具层，
 *    不碰 scoped 注册，也不碰别的插件 —— 所以这里只传 deny，绝不传 allow（传 allow 等于把别的工具也挡了）。
 * 3. 限制挂在该 agent 的 ctx 上，对该 agent 的后续调用生效；对「已经开着的那一轮」不做中断（做不到，
 *    也不该做强杀）。也就是说：新 agent 立即生效；已开着的会话从下一轮工具调用起生效，不需要重载插件，
 *    但当前正在跑的那一轮不会半路丢工具。这一条是为平台边界写的，别指望改成「同轮即时」。
 *
 * 设置怎么进来：settingsPhones 在每次成功读 / 写本机设置之后，把那份归一后的设置文档投到进程级槽位
 * （globalThis[DECK_SETTINGS_BUS_SLOT]，形状 { value, at, listeners[] }）。槽位名定义在核里
 * （src/shared/config-store/src/settings.ts），发布方与订阅方都 import 同一个常量，不各写一份。
 * 本文件挂载时先看槽位里有没有值；没有就试一次懒读（装配层能注入 loadSettings 就用它，
 * 否则经宿主日志单例上的设置电话入口读一次），之后靠订阅跟着变化走。
 * 工作区归属：agent.session.header.cwd 是会话工作目录的绝对路径，经装配层给的 canonicalKey 归到工作区根，
 * 再和设置里各工作区的键按共享层 keyOf 折算比对。认不出归属就按「不挡」处理 —— 宁可少挡，不可误挡。
 *
 * 日志：只复用既有事件 host.call / host.call.fail，method 固定 deck.toolGate、kind 固定 deck-tool，不新增事件名。
 * 失败一律只记日志，绝不把异常抛回刷新挂载流程（挂不上闸门最多是开关不灵，不能让宿主起不来）。
 */
import { keyOf } from '../shared/workspaceKey.js'
import { DECK_SETTINGS_BUS_SLOT } from '../shared/config-store/src/settings.js'

/**
 * 要收走的十二个工具名：十个 deck_* 业务工具（与 src/deck/tools/ 下真实定义、src/deck/rules/tool-order.ts
 * 的 DECK_TOOL_ORDER 一一对应），加上同样属于 deck 工具箱的 deck_probe 与 suggest_next_steps。
 * 门禁 tests/verify-1612-deck-tool-gate.ts 会拿这十二个名字和真实定义文件逐个比对，多一个少一个都红。
 */
export const DECK_GATED_TOOL_NAMES: string[] = [
  'deck_context',
  'deck_issue_create',
  'deck_issue_get',
  'deck_issue_patch',
  'deck_issue_list',
  'deck_issue_report',
  'deck_map_link',
  'deck_map_plan_create',
  'deck_map_snapshot',
  'deck_work_route',
  'deck_probe',
  'suggest_next_steps',
]

/** 设置发布槽位的名字：只在核里定义一次，这里导入后照旧转出去，测试与装配层仍从这个模块取。 */
export { DECK_SETTINGS_BUS_SLOT }
// 同一份宿主 ctx 只该挂一次闸门：装配层若因刷新重跑挂载（makeRefreshLoader 理论上只跑一次，这里仍兜住），
// 重复订阅会让设置一变就多扫一遍、限制也会叠层。重复调用直接交回第一次那个壳，卸载时按同一个壳收尾。
const hookedContexts = new WeakMap<any, any>()

// 宿主日志单例槽位（src/host/index.ts 的 _log() 建的进程单例）：槽位上的 svc.st 是设置电话的懒加载器。
// 只用它做一次「闸门挂载时设置还没被读过」的兜底初读，读不到就跳过，绝不因此报错。
const HOST_LOG_SLOT = '__dsh_mattskillsdeck_host_log__'

const GATE_LOG_METHOD = 'deck.toolGate'
const GATE_LOG_KIND = 'deck-tool'
// restrict 因「名字不在已知全局工具表」失败时的重试：deck 工具注册是异步的，闸门可能抢在前面。
// 五轮、每轮两秒，足够等注册完成；还不行就记日志放弃（注册本身失败时 register-options 那边也会记账）。
const RESTRICT_RETRY_ROUNDS = 5
const RESTRICT_RETRY_WAIT_MS = 2000
// 取 agents 服务（宿主 ctx 上的注册表）失败时只记日志：之后每次设置发布都会再扫一遍，事件也会补上新建的会话。

type AnyRecord = Record<string, any>

function isRecord(v: any): v is AnyRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

// 与仓里其它模块同一套 djb2 短散列：日志里只放工作目录与错误原文的散列，不放原文。
function hash8(raw: any): string {
  try {
    const text = String(raw == null ? '' : raw)
    let h = 5381
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) {
    return '00000000'
  }
}

/** 设置文档里「哪些工作区的 deck 工具箱被关掉了」：返回 { known, offKeys }，键一律经共享层 keyOf 折算。 */
export function deckSwitchesOf(value: any): { known: boolean; offKeys: string[] } {
  if (!isRecord(value) || !isRecord(value.workspaces)) return { known: false, offKeys: [] }
  const workspaces = value.workspaces
  const offKeys: string[] = []
  const seen: AnyRecord = {}
  for (const rawKey of Object.keys(workspaces)) {
    const rec = workspaces[rawKey]
    // 只认显式写下的 off：缺格、旧文件、别的东西都按缺省 on 处理（维护者拍板：缺省开着）。
    if (!isRecord(rec) || rec.deckTools !== 'off') continue
    const norm = keyOf(rawKey)
    if (!norm || seen[norm]) continue
    seen[norm] = true
    offKeys.push(norm)
  }
  return { known: true, offKeys: offKeys }
}

/**
 * 一个 agent 该不该被挡：cwd 属于某个 deckTools=off 的工作区就返回 true。
 * 判定顺序：先按 cwd 本身折算的键直接比；再试装配层给的 canonicalKey 把 cwd 归到工作区根后比。
 * 任一环节失败都按「不挡」处理 —— 认不出归属时把工具收走是最坏的误伤。
 */
export async function shouldGateAgent(cwd: any, switches: { known: boolean; offKeys: string[] } | null, deps?: AnyRecord): Promise<boolean> {
  if (!switches || switches.known !== true || !switches.offKeys || !switches.offKeys.length) return false
  const cwdKey = keyOf(cwd)
  if (!cwdKey) return false
  if (switches.offKeys.indexOf(cwdKey) >= 0) return true
  const canonical = deps && typeof deps.canonicalKey === 'function' ? deps.canonicalKey : null
  if (!canonical) return false
  let root: any = null
  try {
    root = await canonical(cwd)
  } catch (e) {
    return false
  }
  const rootKey = keyOf(root)
  if (!rootKey) return false
  return switches.offKeys.indexOf(rootKey) >= 0
}

// 取一次已经发布过的设置值；没有就回 null（不是空文档 —— 空文档是合法值，缺席才是 null）。
function publishedSettingsValue(): any {
  try {
    const bus = (globalThis as any)[DECK_SETTINGS_BUS_SLOT]
    if (!isRecord(bus)) return null
    return bus.value === undefined ? null : bus.value
  } catch (e) {
    return null
  }
}

// 读 agent 的会话工作目录：没有 session 或 cwd 不是字符串都回 ''，后续按「认不出归属」处理。
function agentCwdOf(agent: any): any {
  try {
    const session = agent && agent.session
    const header = session && session.header
    const cwd = header && header.cwd
    return typeof cwd === 'string' ? cwd : ''
  } catch (e) {
    return ''
  }
}

// 拿 agent 作用域的 tools 服务：优先 ctx.get('tools')（那是绑好作用域的服务代理），再退直接属性。
// 两条路都可能因为上下文没注入而抛错，一律由调用方按「拿不到」处理，不向外抛。
function agentToolsOf(agent: any): any {
  try {
    const agentCtx = agent && agent.ctx
    if (!agentCtx) return null
    if (typeof agentCtx.get === 'function') {
      const viaGet = agentCtx.get('tools')
      if (viaGet) return viaGet
    }
    return agentCtx.tools || null
  } catch (e) {
    return null
  }
}

/**
 * 挂上闸门：host 层在 deck 工具注册完成之后调用一次，返回 { dispose } 交给宿主生命周期。
 * 装载失败绝不抛错：任何一步没装成，最坏结果是开关不生效，宿主照常启动。
 */
export function hookDeckToolGate(hostCtx: any, deps?: any): { dispose: () => void } {
  const noop = function (): void {}
  const shell: { dispose: () => void } = { dispose: noop }
  try {
    if (!hostCtx || typeof hostCtx !== 'object') return shell
    const previousShell = hookedContexts.get(hostCtx)
    if (previousShell) return previousShell
    const d: AnyRecord = isRecord(deps) ? deps : {}
    const retryRounds = typeof d.retries === 'number' ? d.retries : RESTRICT_RETRY_ROUNDS
    const retryWait = typeof d.wait === 'function' ? d.wait : null

    // 日志出口：宿主注入的 logCtx（fire(level, event, fields)）缺席时静默，所有失败都不许冒泡。
    const fireLog = function (level: string, event: string, fields: AnyRecord): void {
      try {
        const logCtx = d.logCtx
        if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields)
      } catch (e) {}
    }
    const logOk = function (reason: string, cwd: any): void {
      fireLog('info', 'host.call', { method: GATE_LOG_METHOD, kind: GATE_LOG_KIND, ok: true, reason: reason, cwdHash: hash8(cwd) })
    }
    const logFail = function (reason: string, cwd: any, err: any): void {
      fireLog('warn', 'host.call.fail', { method: GATE_LOG_METHOD, kind: GATE_LOG_KIND, errorKind: reason, errorHash: hash8(err), cwdHash: hash8(cwd) })
    }

    let switches = deckSwitchesOf(publishedSettingsValue())
    let settingsKnown = switches.known
    let stopped = false
    const entries = new Map<any, AnyRecord>()
    const cleanups: Array<() => void> = []
    let scanTimer: any = null

    // 撤销某个 agent 身上的限制：只动我们自己挂上去的那一层，没挂过就什么都不做。
    const releaseAgent = function (agent: any): void {
      try {
        const entry = entries.get(agent)
        if (!entry) return
        if (entry.timer) {
          try { clearTimeout(entry.timer) } catch (e) {}
          entry.timer = null
        }
        if (typeof entry.disposer === 'function') {
          try { entry.disposer() } catch (e) { logFail('release-failed', agentCwdOf(agent), e) }
          entry.disposer = null
          logOk('released', agentCwdOf(agent))
        }
        entry.tries = 0
      } catch (e) {}
    }

    // 给一个 agent 挂限制：只传 deny（绝不传 allow —— 那会连别的工具一起挡掉）。名字还不认识时按轮重试。
    const applyGate = function (agent: any, entry: AnyRecord, cwd: any): void {
      if (entry.disposer || entry.timer) return
      const tools = agentToolsOf(agent)
      if (!tools || typeof tools.restrict !== 'function') {
        logFail('no-tools-service', cwd, 'tools.restrict missing')
        return
      }
      let disposer: any = null
      try {
        disposer = tools.restrict({ deny: DECK_GATED_TOOL_NAMES.slice() })
      } catch (e: any) {
        const message = String((e && e.message) || e)
        // 闸门可能比 deck 工具注册更早跑到：平台这时会说这些名字还不是已知全局工具。等注册完成再试。
        if (message.indexOf('unknown global tool') >= 0 && entry.tries < retryRounds) {
          entry.tries += 1
          const scheduled = function (): void {
            try {
              entry.timer = null
              if (!stopped && entries.get(agent) === entry) applyGate(agent, entry, cwd)
            } catch (eTick) {}
          }
          if (retryWait) entry.timer = retryWait(RESTRICT_RETRY_WAIT_MS)
          else {
            entry.timer = setTimeout(scheduled, RESTRICT_RETRY_WAIT_MS)
            try { if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref() } catch (eU) {}
          }
          if (retryWait) {
            Promise.resolve(entry.timer).then(function () { if (!stopped) scheduled() }).catch(function () {})
          }
          logOk('retry', cwd)
          return
        }
        logFail('restrict-failed', cwd, e)
        return
      }
      entry.disposer = typeof disposer === 'function' ? disposer : null
      entry.tries = 0
      logOk(entry.disposer ? 'restricted' : 'restrict-returned-noop', cwd)
    }

    // 重新判一次某个 agent：该挡就挡、不该挡就撤。判定是异步的（canonicalKey 可能读盘），用序号防串号。
    const refreshAgent = function (agent: any): void {
      try {
        const entry = entries.get(agent)
        if (!entry || stopped) return
        const seq = entry.seq = (Number(entry.seq) || 0) + 1
        if (!entry.disposer && !entry.timer) entry.tries = 0
        const cwd = agentCwdOf(agent)
        Promise.resolve()
          .then(function () { return shouldGateAgent(cwd, switches, d) })
          .then(function (gate: boolean) {
            try {
              if (stopped || entries.get(agent) !== entry || entry.seq !== seq) return
              if (gate) applyGate(agent, entry, cwd)
              else releaseAgent(agent)
            } catch (e) {}
          })
          .catch(function (e: any) { logFail('decide-failed', cwd, e) })
      } catch (e) {}
    }

    // 记一个 agent 进跟踪表（重复调用只刷新，不重复挂限制）。
    const trackAgent = function (agent: any): void {
      try {
        if (stopped || !agent) return
        if (!entries.has(agent)) entries.set(agent, { disposer: null, timer: null, tries: 0, seq: 0 })
        refreshAgent(agent)
      } catch (e) {}
    }

    // agent 被销毁：先撤限制再丢掉跟踪记录，别把 disposer 留在表里。
    const forgetAgent = function (agent: any): void {
      try {
        releaseAgent(agent)
        entries.delete(agent)
      } catch (e) {}
    }

    const refreshAll = function (): void {
      entries.forEach(function (_entry: AnyRecord, agent: any): void { try { refreshAgent(agent) } catch (e) {} })
    }

    // 设置值变了：缓存新值并让所有已跟踪的 agent 重新判一次。
    const applySettingsValue = function (value: any): void {
      try {
        const next = deckSwitchesOf(value)
        if (!next.known) return
        switches = next
        settingsKnown = true
        refreshAll()
        // 再扫一遍注册表：生命周期事件万一没送到，这里把新建的会话补上。
        scanAgents()
      } catch (e) {}
    }

    // 宿主 ctx 上的 agents 服务（AgentRegistry）：先 get('agents')，再退直接属性。
    const agentsServiceOf = function (): any {
      try {
        if (typeof hostCtx.get === 'function') {
          const viaGet = hostCtx.get('agents')
          if (viaGet) return viaGet
        }
        return hostCtx.agents || null
      } catch (e) {
        return null
      }
    }

    // 扫一遍现有 agent：注册表服务缺席时只记日志（之后设置发布与 agent/created 事件都会把会话补进来）。
    const scanAgents = function (): void {
      if (stopped) return
      let list: any[] | null = null
      try {
        const svc = agentsServiceOf()
        const got = svc && typeof svc.list === 'function' ? svc.list() : null
        if (Array.isArray(got)) list = got
      } catch (e) {
        list = null
      }
      if (!list) { logFail('no-agents-service', '', 'agents registry unavailable'); return }
      list.forEach(function (agent: any): void { try { trackAgent(agent) } catch (e) {} })
    }

    // 槽位订阅：settingsPhones 每次成功读 / 写设置都会往这里推一份最新文档。
    let bus: any = null
    try {
      bus = (globalThis as any)[DECK_SETTINGS_BUS_SLOT]
      if (!isRecord(bus)) {
        bus = { value: null, at: 0, listeners: [] }
        ;(globalThis as any)[DECK_SETTINGS_BUS_SLOT] = bus
      }
    } catch (e) { bus = null }
    if (isRecord(bus) && Array.isArray(bus.listeners)) {
      const listener = function (value: any): void { try { applySettingsValue(value) } catch (e) {} }
      bus.listeners.push(listener)
      cleanups.push(function (): void {
        try {
          const now: any = (globalThis as any)[DECK_SETTINGS_BUS_SLOT]
          if (isRecord(now) && Array.isArray(now.listeners)) {
            const at = now.listeners.indexOf(listener)
            if (at >= 0) now.listeners.splice(at, 1)
          }
        } catch (e) {}
      })
    }

    // 生命周期事件：监听器必须同步吞掉所有异常并返回 undefined（'agent/created' 是 serial 事件，
    // 返回 rejected Promise 会把 agent 创建拖垮；这里用 try/catch 包住整段，绝不让它冒出去）。
    const subscribe = function (name: string, listener: (payload: any) => void): void {
      try {
        if (typeof hostCtx.on !== 'function') return
        const off = hostCtx.on(name, function (payload: any): void {
          try {
            listener(payload)
          } catch (e) {}
        })
        if (typeof off === 'function') cleanups.push(function (): void { try { off() } catch (e) {} })
      } catch (e) {}
    }
    subscribe('agent/created', function (payload: any): void {
      const agent = payload && payload.agent
      if (agent) trackAgent(agent)
    })
    subscribe('agent/disposed', function (payload: any): void {
      const agent = payload && payload.agent
      if (agent) forgetAgent(agent)
    })

    // 兜底初读：闸门挂载时设置还没被读过（槽位空）就试一次懒读，让「文件里已经关掉」在没人打开设置页时也生效。
    const bootstrap = function (): void {
      if (settingsKnown) return
      const published = publishedSettingsValue()
      if (published != null) {
        applySettingsValue(published)
        return
      }
      if (typeof d.loadSettings === 'function') {
        Promise.resolve()
          .then(function () { return d.loadSettings() })
          .then(function (value: any) { applySettingsValue(value) })
          .catch(function (e: any) { logFail('bootstrap-failed', '', e) })
        return
      }
      try {
        const g: any = globalThis as any
        const singleton = g[HOST_LOG_SLOT]
        const settingsLoader = singleton && singleton.svc && singleton.svc.st
        if (typeof settingsLoader !== 'function') return
        Promise.resolve()
          .then(function () { return settingsLoader() })
          .then(function (phones: any) { return phones && typeof phones.handleGetSettings === 'function' ? phones.handleGetSettings({}) : null })
          .then(function (res: any) { if (res && res.ok === true) applySettingsValue(res.value) })
          .catch(function (e: any) { logFail('bootstrap-failed', '', e) })
      } catch (e) {}
    }

    // 卸载壳：撤订阅、停定时器、把每个 agent 的限制都撤掉；重复调用安全。
    shell.dispose = function (): void {
      if (stopped) return
      stopped = true
      try { if (scanTimer) clearTimeout(scanTimer) } catch (e) {}
      scanTimer = null
      for (const cleanup of cleanups) { try { cleanup() } catch (e) {} }
      cleanups.length = 0
      entries.forEach(function (entry: AnyRecord): void {
        try {
          if (entry.timer) clearTimeout(entry.timer)
          entry.timer = null
          if (typeof entry.disposer === 'function') entry.disposer()
          entry.disposer = null
        } catch (e) {}
      })
      entries.clear()
    }

    // 卸载之后允许重新挂载同一份 ctx：先记住这个壳，dispose 时再把它从表里拿掉。
    const disposeShell = shell.dispose
    shell.dispose = function (): void {
      try { disposeShell() } catch (e) {}
      try { hookedContexts.delete(hostCtx) } catch (e) {}
    }
    hookedContexts.set(hostCtx, shell)
    bootstrap()
    scanAgents()
    return shell
  } catch (e) {
    return shell
  }
}
