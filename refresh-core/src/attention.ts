/**
 * refresh-core/src/attention.ts —— 视野模型的纯逻辑：谁在活跃、谁该被淘汰、什么时候全部收摊
 *
 * 这个文件只回答五个问题，一行读盘、联网、看时钟的代码都没有（时间由调用方当参数传进来），
 * 所以它能在单测里把「切窗口、切工作区、心跳断了、窗口崩了」这些情形一次性穷举干净：
 *   1. 一次上报之后，哪些工作区根算「活跃」（名额怎么分、超了淘汰谁）；
 *   2. 「同一个工作区根只占一个名额」——多个会话、多个窗口指向同一个仓库时合成一个；
 *   3. 谁是「刚离开的那个」，它保留多久的收尾节拍（最多一个，30 秒后必然归零）；
 *   4. 90 秒内没有任何上报时全部收摊（不变量 I2 的兜底方向：宁可更省，不许更快）；
 *   5. 每个活跃工作区该按什么间隔去探测（正在看的 5 秒、刚离开的 15 秒）。
 *
 * 依据：docs/architecture/refresh-budget-architecture.html 第三章「调度层 · 视野模型」与
 * 第四章第 02 件（活跃的定义、两个活跃怎么分额度、心跳、信号失效怎么办、多窗口的兜底），
 * 以及第一章不变量 I2（后台零定时器，只留限时收尾）与 I4（用量与工作区数量无关）。
 *
 * 数字一个都不在这里：全部来自 budget.ts，由调用方取好装进 AttentionLimits 传进来。
 * 为什么不直接 import budget.ts：产物文件之间同层互引会被 tests/verify-no-same-layer-import.js
 * 判红（src/shared/ 内部不许互相引用），所以照 policy.ts 的先例，数字由调用方注入。
 *
 * **两条设计上要命的取舍，先说清：**
 *   ① 键是「工作区根」，不是窗口，也不是会话。界面上报的就是工作区根，而窗口与会话都不止一个
 *      （同一个仓库开两个窗口、同一个仓库里子目录会话与根会话各一份 store）。按窗口发名额的话，
 *      两个窗口看同一个仓库会花两份钱、各自探测同一份数据 —— 正是定稿要消掉的浪费。
 *   ② 全部结论都由「窗口 + 它最近一次上报时刻」现算出来，**不存任何历史状态**。为什么这一条这么重要：
 *      如果「刚离开」的起算是存下来的，那么每收一次摊就要顺手续一次时，收尾定时器永远等不到归零，
 *      「30 秒后必然收摊」这条不变量就成了一句空话。现算之后，同一份输入收一百次，结论完全一样。
 */

/** 这份文件定义在哪个文件里。产物里留着它，用来证明「产物确实来自这份源码」。 */
export const ATTENTION_SOURCE = 'refresh-core/src/attention.ts'

/** 活跃集合的硬上限取不到调用方给的数字时用它兜底（真源是 budget.ts 的 MAX_ACTIVE_WORKSPACES）。 */
export const ATTENTION_ACTIVE_CAP_FALLBACK = 2

/** 一次上报是什么让界面「在看」这个工作区。枚举写死：取值表就是这一串。 */
export type AttentionSignalKind =
  | 'focus' // 窗口重新获得焦点
  | 'panel-open' // 面板刚打开
  | 'session-switch' // 会话切换（切到了另一个工作区根）
  | 'heartbeat' // 面板可见时每 20 秒一次的本地心跳（零配额、不出网）
  | 'window-blur' // 窗口失去焦点：如实说「我不再活跃了」，不猜别人
  | 'panel-hidden' // 面板被藏起来或页签切走

/** 全部取值，顺序与上面一致（门禁按它核对有没有漏项）。 */
export const ATTENTION_SIGNAL_KINDS: readonly AttentionSignalKind[] = [
  'focus', 'panel-open', 'session-switch', 'heartbeat', 'window-blur', 'panel-hidden',
]

/** 「我正在看谁」这三种信号才算数：心跳只续时，失焦与隐藏只改可见性。 */
export const ATTENTION_HUMAN_SIGNALS: readonly AttentionSignalKind[] = ['focus', 'panel-open', 'session-switch']

/**
 * 一次上报。窗口标识由客户端自己造（平台不提供窗口身份与焦点信号），
 * 所以这里只当一个不透明的字符串用，不解释它的内容。
 */
export interface AttentionReport {
  /** 客户端自造的窗口标识。区分「这个窗口」与「另一个窗口」全靠它。 */
  windowId: string
  /** 这个窗口现在看的是哪个工作区根。空串表示「这个会话还没算出工作区根」，这一笔不上报。 */
  workspaceRoot: string
  /** 这一次是哪种上报。 */
  kind: AttentionSignalKind
  /** 面板此刻可不可见。不可见的上报不算「正在看」，只帮助淘汰别人。 */
  visible: boolean
  /** 窗口最近一次收到人类输入的毫秒时刻（没记录过就不传）。 */
  lastHumanInputMs?: number
  /** 上报时刻。不传就用调用方给的 nowMs。 */
  atMs?: number
}

/** 裁决要用的那套数字，全部由调用方从 budget.ts 取来传入。 */
export interface AttentionLimits {
  /** 活跃集合的硬上限（budget.ts 的 MAX_ACTIVE_WORKSPACES）。 */
  maxActive: number
  /** 「刚离开的那个」还算活跃多久（budget.ts 的 ACTIVE_LINGER_MS）。 */
  lingerMs: number
  /** 没有任何上报多久就全部收摊（budget.ts 的 ATTENTION_EXPIRY_MS）。 */
  expiryMs: number
  /** 正在看的那个的探测间隔（budget.ts 的 PROBE_INTERVAL_MS）。 */
  probeIntervalMs: number
  /** 刚离开的那个的探测间隔（budget.ts 的 PROBE_INTERVAL_LINGER_MS）。 */
  probeIntervalLingerMs: number
  /** 面板可见时本地心跳的间隔（budget.ts 的 ATTENTION_HEARTBEAT_MS）。 */
  heartbeatMs: number
}

/** 一个窗口现在盯着的根，以及那个根最近一次上报是什么时候。 */
export interface AttentionWindow {
  /** 这个窗口盯着的根（空串 = 还没定）。 */
  root: string
  /** 这个根最近一次上报的时刻（毫秒）。 */
  lastSeenMs: number
  /** 最近一次上报时面板可不可见。 */
  visible: boolean
  /** 最近一次收到人类输入的时刻（没记录过就是 0）。 */
  lastHumanInputMs: number
}

/** 视野模型的全部状态。它是整份模型里唯一存下来的东西，只有两张「时刻表」，不存任何判定结论。 */
export interface AttentionState {
  /** 窗口标识 → 它现在盯着谁。 */
  windows: Record<string, AttentionWindow>
  /**
   * 工作区根 → 它最近一次被人看是什么时候。这张表比窗口那张长命：一个窗口从 A 切到 B 之后，
   * A 在这张表里还留着它的最后一笔 —— 「刚离开的那个」的 30 秒收尾节拍正是从这一笔算起。
   * 没有这张表的话，切走一瞬间 A 的历史就跟着窗口没了，收尾节拍永远挂不上去。
   */
  seen: Record<string, { at: number; visible: boolean }>
}

/** 一份空状态。调用方起步时用它。 */
export function createAttentionState(): AttentionState {
  return { windows: {}, seen: {} }
}

/** 一次上报的处理结论：这一笔算不算「我正在看」的新信号，以及处理后的状态。 */
export interface ReportOutcome {
  /** 这一笔算不算新信号。心跳只在窗口已经盯着某个根时算；失焦与隐藏、以及不可见的心跳都不算。 */
  accepted: boolean
  /** 处理后的完整状态（调用方拿它替换自己那份）。 */
  state: AttentionState
}

/**
 * 收一笔上报，算出下一份状态。
 *
 * 三种信号真的更新「我正在看谁」：窗口获焦、面板打开、会话切换。心跳只在窗口已经盯着某个根、
 * 而且面板可见的时候续时（它证明「界面还看着」，不证明「刚换到了哪」）；窗口失焦与面板隐藏
 * 把那个根这次的可见性改成 false —— 它仍算「有人在看这个根」，但接下来的收摊判定会把它算进去。
 * 不可见的心跳既不算新信号、也不把上报时刻往后推：否则一个藏起来的窗口能靠心跳无限期霸着
 * 活跃名额，90 秒收摊那条线就永远等不到了。
 */
export function report(state: AttentionState, input: AttentionReport, nowMs: number): ReportOutcome {
  const s = cloneState(state)
  const windowId = String((input && input.windowId) || '')
  const root = String((input && input.workspaceRoot) || '').trim()
  const kind = kindOf(input && input.kind)
  const visible = !!(input && input.visible)
  const at = numOr(input && input.atMs, nowMs)
  const human = numOr(input && input.lastHumanInputMs, 0)
  // 没有窗口标识：这一笔不上报（回执里 accepted=false），界面上什么都不发生。
  if (!windowId) return { accepted: false, state: s }
  const prev = s.windows[windowId]
  const prevRoot = prev ? String(prev.root || '') : ''
  const keepRoot = root || prevRoot
  if (!keepRoot) {
    // 「这个会话还没算出工作区根」这一类：窗口先记下来（窗口标识有效就够了），后面的心跳续得上。
    s.windows[windowId] = { root: '', lastSeenMs: at, visible: visible, lastHumanInputMs: human }
    return { accepted: false, state: s }
  }
  const isHuman = ATTENTION_HUMAN_SIGNALS.indexOf(kind) >= 0
  const heartbeatOk = kind === 'heartbeat' && !!prev && prevRoot !== '' && visible
  const accepted = isHuman || heartbeatOk
  const advance = accepted && (isHuman || visible)
  s.windows[windowId] = {
    root: keepRoot,
    lastSeenMs: advance ? at : (prev ? prev.lastSeenMs : at),
    visible: visible,
    lastHumanInputMs: human || (prev ? prev.lastHumanInputMs : 0),
  }
  // 两张时刻表一起维护：窗口那张记「它现在盯着谁」，根那张记「这个根最近一次被人看是什么时候」。
  //   只有真的算数的信号（advance）才推进根的那一笔 —— 不可见的心跳、以及「只改可见性」的那两种信号
  //   都不推进，否则一个藏起来的窗口能靠心跳把这笔时间一直往后推，90 秒收摊那条线就永远等不到。
  const known = s.seen[keepRoot]
  if (advance) s.seen[keepRoot] = { at: at, visible: visible }
  else if (!known) s.seen[keepRoot] = { at: prev ? prev.lastSeenMs : at, visible: visible }
  return { accepted: accepted, state: s }
}

/** 一个此刻算活跃的根。 */
export interface ActiveRoot {
  /** 工作区根。 */
  root: string
  /** 'probe' 正在看的那个；'linger' 刚离开 30 秒内的那个。 */
  audience: 'probe' | 'linger'
  /** 这个根该按什么间隔探测（毫秒）：正在看的 5 秒、刚离开的 15 秒。 */
  intervalMs: number
}

/** 一次收摊的结论。调用方据此重启/停掉定时器，别的什么都不用猜。 */
export interface AttentionPlan {
  /** 现在真的算活跃的根（长度 ≤ 上限；正在看的排在最前）。 */
  active: ActiveRoot[]
  /** 这些根上该有定时器：活跃的那些，加上最多一个收尾的。 */
  keep: string[]
  /** 这些根上不该再有任何定时器，调用方得停掉它们。 */
  cancel: string[]
  /** 最多一个：收尾定时器该挂在哪个根上（没有就是空串）。 */
  lingerRoot: string
  /** 最多一个：那个收尾定时器离归零还剩多少毫秒（没有就是 0）。 */
  lingerDelayMs: number
  /** 整桌收摊了吗（90 秒没信号，或曾经看过的根都过了收尾窗口）。 */
  collaped: boolean
  /** 这一刻「正在看」的根有几个（不含刚离开的那个）。 */
  keepers: number
}

/**
 * 把整份状态收一遍：谁是活跃、谁留一个收尾定时器、谁该被停掉。
 *
 * 判定顺序（从上到下就是「谁更值得留下」的顺序）：
 *   ① 90 秒内没有任何上报 → 全部收摊（不变量 I2 的兜底：前端崩了也不会有人偷偷烧配额）；
 *   ② 每个窗口只认它盯着的那个根，同一根的多窗口、多会话合成一份名额；
 *   ③ 正在看（可见）的根优先占名额，名额超了丢最近没上报过的那个；
 *   ④ 落选的那些里，只有「最近刚走的那一个」保留 30 秒收尾定时器，更早离开的一次都不留。
 *
 * 这个函数是纯的：不改传进来的 state，同一份输入连收一百次结论完全一样。
 */
export function collect(state: AttentionState, nowMs: number, limits: AttentionLimits): AttentionPlan {
  const maxActive = Math.max(1, Math.floor(numOr(limits && limits.maxActive, ATTENTION_ACTIVE_CAP_FALLBACK)))
  const lingerMs = Math.max(0, numOr(limits && limits.lingerMs, 0))
  const expiryMs = Math.max(0, numOr(limits && limits.expiryMs, 0))
  const probeMs = Math.max(0, numOr(limits && limits.probeIntervalMs, 0))
  const lingerProbeMs = Math.max(0, numOr(limits && limits.probeIntervalLingerMs, probeMs))
  const s = state || createAttentionState()
  const cand = candidatesOf(s)
  const tracked = trackedRoots(s)

  // ① 有没有「最近一次上报」；没有、或者已经过了收摊线，整桌收摊。
  //    收摊这一跳要覆盖两拨根：现在还挂在窗口上的那些（candidatesOf），加上窗口已经没了但可能还留着一个
  //    收尾定时器的那些（trackedRoots）。只清前者的那一版把后者漏在了盘上 —— 那一刻整桌已经收了，
  //    却又有一个根还在按 15 秒响，正好撞上「后台零定时器」这条不变量（verify-attention-model 抓到的）。
  //
  //    顺手做上界淘汰：那张时刻表最多留 64 条（每 128 次收摊做一遍）。不做的话两件事会坏：
  //    ① 根的时刻表跟着开过的窗口数一路长大；② 一个早就走掉的根还能把「刚离开的那一个」的名额占住。
  let newest = 0
  for (let i = 0; i < cand.length; i++) if (cand[i].lastSeenMs > newest) newest = cand[i].lastSeenMs
  pruneSeen(s)
  if (!newest || (nowMs - newest) > expiryMs) {
    const all: string[] = tracked.slice()
    for (let i = 0; i < cand.length; i++) if (all.indexOf(cand[i].root) < 0) all.push(cand[i].root)
    return { active: [], keep: [], cancel: all, lingerRoot: '', lingerDelayMs: 0, collaped: true, keepers: 0 }
  }

  // ② 最近上报过的排序（每个根只留最晚那一条）：先看这一次报的时候可不可见，再看上报时刻。
  //    可见性一变（藏起来或者过了收尾窗口），排序结果就跟着变 —— 所以先说清「正在看的」这一档怎么排：
  //    正在看的（还有窗口在看着它的根）优先占名额，它们内部按最近上报排；快档名额满了之后，
  //    落选的可见根与「已经没人看的根」合成一档，按最近上报排，只留最前面那一个的收尾节拍。
  cand.sort(compareCandidates)

  // ③ 分名额：正在看的、最近上报过的那些里，取前 maxActive 个。它们按快档探测。
  const active: ActiveRoot[] = []
  const keep: Record<string, true> = {}
  for (let i = 0; i < cand.length; i++) {
    if (active.length >= maxActive) break
    const c = cand[i]
    if (!c.visible) break
    active.push({ root: c.root, audience: 'probe', intervalMs: probeMs })
    keep[c.root] = true
  }
  const keepers = active.length

  // ④ 落选的那些里，只有最近刚走的那一个保留收尾定时器（从它最后一次上报起算 30 秒）。
  //    更早离开的一次都不留：不变量 I2 允许的例外只有「一个、且限时」。
  //
  //    这一档是**所有**落选者一起排的（名额挤掉的可见根 + 已经没人看的根），不是只排「没人看的根」：
  //    ① 一个窗口从 A 切到 B、而 B 也看得见的时候，A 是被名额挤掉的那一个，它同样属于「刚离开」，
  //       收尾节拍就该挂在它身上（第一版只排后者，于是单窗口切走时收尾永远挂不上去）；
  //    ② 整桌都藏起来的时候（没人正在看），最近刚走的那个同样保留它自己那 30 秒——
  //       不变量 I2 说的例外是「最多一个、且限时」，并没有说必须有人正看着才允许收尾。
  const lingerCand = firstUnkept(cand, keep)
  let lingerRoot = ''
  let lingerDelayMs = 0
  if (lingerCand) {
    const remaining = lingerMs - (nowMs - lingerCand.lastSeenMs)
    // 落选者已经排过序（最近上报在前），所以第一个还没过收尾窗口的就是「刚离开的那一个」；
    // 它已经过了窗口就说明一个都不在窗口里，这一轮谁都不留。
    if (remaining > 0) { lingerRoot = lingerCand.root; lingerDelayMs = remaining }
  }
  if (lingerRoot) {
    keep[lingerRoot] = true
    active.push({ root: lingerRoot, audience: 'linger', intervalMs: lingerProbeMs })
  }

  // 剩下的落选者（不在收尾窗口里、或者被名额挤掉的那些）都要出现在 cancel 里：
  // 调用方按它停掉那些根上的定时器，这就是「后台零定时器」这句不变量的机械保证。
  const cancel: string[] = []
  for (let i = 0; i < tracked.length; i++) if (!keep[tracked[i]]) cancel.push(tracked[i])

  return {
    active: active,
    keep: Object.keys(keep),
    cancel: cancel,
    lingerRoot: lingerRoot,
    lingerDelayMs: lingerDelayMs,
    collaped: false,
    keepers: keepers,
  }
}

/** 一个根上该不该有定时器，该按什么间隔。没有就是 null（调用方把那个定时器停掉）。 */
export function timerPlanFor(plan: AttentionPlan, root: string, nowMs: number): { intervalMs: number } | null {
  const key = String(root || '')
  const list = (plan && plan.active) || []
  for (let i = 0; i < list.length; i++) if (list[i].root === key) return { intervalMs: list[i].intervalMs }
  return null
}

/**
 * 这一刻的候选表：每一行是「一个工作区根 + 它最后一次被人看是什么时候 + 现在还有没有人在看它」。
 * 对外暴露只有一个用途：出问题时能把「模型眼里的世界」原样打出来对账，不必去猜。
 * 判定本身不看它（collect 内部走的是同一份实现），所以它不会成为第二套口径。
 */
export function candidatesAt(state: AttentionState): Array<{ root: string; lastSeenMs: number; visible: boolean }> {
  return candidatesOf(state || createAttentionState()).map(function (c) {
    return { root: c.root, lastSeenMs: c.lastSeenMs, visible: c.visible }
  })
}

/** 那个收尾定时器现在这一跳离归零还有多少毫秒；不是它、或者它已经归零，返回 null。 */
export function lingerDelayAt(plan: AttentionPlan, root: string): number | null {
  if (!plan || !plan.lingerRoot || plan.lingerRoot !== String(root || '')) return null
  return plan.lingerDelayMs > 0 ? plan.lingerDelayMs : null
}

/** 面板可见时本地心跳的间隔（毫秒），值来自调用方传进来的 limits。 */
export function heartbeatIntervalMs(limits: AttentionLimits): number {
  return Math.max(0, numOr(limits && limits.heartbeatMs, 0))
}

/** 有没有任何窗口还盯着某个根（用来判「界面还活着吗」）。 */
export function hasAnyWindow(state: AttentionState): boolean {
  const w = (state && state.windows) || {}
  for (const id of Object.keys(w)) if (w[id] && w[id].root) return true
  const seen = (state && state.seen) || {}
  for (const r of Object.keys(seen)) if (r) return true
  return false
}

// ---------- 下面都是小的内部工具（只算，不改任何状态） ----------

interface Candidate {
  root: string
  lastSeenMs: number
  visible: boolean
  lastHumanInputMs: number
}

/** 排序之后第一个不在 keep 里的候选 —— 它就是「刚离开的那一个」的候选。 */
function firstUnkept(cand: Candidate[], keep: Record<string, true>): Candidate | null {
  for (let i = 0; i < cand.length; i++) if (!keep[cand[i].root]) return cand[i]
  return null
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.visible !== b.visible) return a.visible ? -1 : 1
  if (a.lastSeenMs !== b.lastSeenMs) return b.lastSeenMs - a.lastSeenMs
  if (a.lastHumanInputMs !== b.lastHumanInputMs) return b.lastHumanInputMs - a.lastHumanInputMs
  return a.root < b.root ? -1 : (a.root > b.root ? 1 : 0)
}

function candidatesOf(s: AttentionState): Candidate[] {
  // 候选来自「根的时刻表」，不是「窗口表」：一个窗口从 A 切到 B 之后 A 还在这张表里，
  // 「刚离开 30 秒内」才算得出来。
  //
  // 「现在还有没有人在看」这条判据只看一件事：**有没有哪个窗口此刻正盯着这个根**（看窗口表）。
  //   第一版读的是时刻表里那一笔自带的可见性，于是「窗口切走之后，旧根留下的那一笔」还写着
  //   visible=true —— 切走的旧根与正在看的根一起占两个快档名额，收尾节拍永远挂不上去
  //   （verify-attention-model 抓到的正是这一条）。时刻表那一笔只用来记「最后一次被人看是什么时候」。
  const seen = (s && s.seen) || {}
  const liveWindows: Record<string, { newest: number; visible: boolean; human: number }> = {}
  const wins = (s && s.windows) || {}
  for (const id of Object.keys(wins)) {
    const w = wins[id]
    if (!w || !w.root) continue
    const cur = liveWindows[w.root]
    const at = numOr(w.lastSeenMs, 0)
    if (!cur || at > cur.newest) {
      liveWindows[w.root] = { newest: at, visible: !!w.visible, human: numOr(w.lastHumanInputMs, 0) }
    }
  }
  const out: Candidate[] = []
  for (const root of Object.keys(seen)) {
    const hit = seen[root]
    if (!root || !hit) continue
    const live = liveWindows[root]
    out.push({
      root: root,
      lastSeenMs: numOr(hit.at, 0),
      visible: !!(live && live.visible),
      lastHumanInputMs: live ? live.human : 0,
    })
  }
  return out
}

function trackedRoots(s: AttentionState): string[] {
  const seen: Record<string, true> = {}
  const out: string[] = []
  const add = function (r: string) { if (r && !seen[r]) { seen[r] = true; out.push(r) } }
  const wins = (s && s.windows) || {}
  for (const id of Object.keys(wins)) add(wins[id] && wins[id].root)
  const hist = (s && s.seen) || {}
  for (const r of Object.keys(hist)) add(r)
  return out
}

function kindOf(kind: unknown): AttentionSignalKind {
  const k = String(kind || '')
  return ATTENTION_SIGNAL_KINDS.indexOf(k as AttentionSignalKind) >= 0 ? (k as AttentionSignalKind) : 'focus'
}

function numOr(v: unknown, fallback: number): number {
  return (typeof v === 'number' && isFinite(v)) ? v : fallback
}

/**
 * 上界淘汰：把「根的时刻表」压到最多 64 条，多出来的按最近上报从旧到新丢。
 *
 * 为什么要它：那张表记的是「每个根最近一次被人看是什么时候」，一天不关页面就会跟着开过的窗口数长大。
 * 更要紧的是，一个早就走掉的根只要那一笔还留在表里，就可能占住「刚离开的那一个」那一档的名额。
 * 上界取 64：比任何一次真实使用里「同时开过的窗口数」都宽得多，只有长跑才会碰到它。
 * 每 128 次收摊做一遍（读取路径上几乎零成本），窗口表那一张不动 —— 还挂着窗口的根在这里面永远是最新的那几个。
 */
const SEEN_ROOTS_MAX = 64
let pruneCounter = 0
function pruneSeen(s: AttentionState): void {
  const all = Object.keys(s.seen)
  if (all.length <= SEEN_ROOTS_MAX) return
  pruneCounter += 1
  if ((pruneCounter % 128) !== 0) return
  const rows: Array<{ root: string; at: number }> = []
  for (let i = 0; i < all.length; i++) rows.push({ root: all[i], at: numOr(s.seen[all[i]].at, 0) })
  rows.sort(function (a, b) { return b.at - a.at })
  for (let i = SEEN_ROOTS_MAX; i < rows.length; i++) delete s.seen[rows[i].root]
}

function cloneState(s: AttentionState): AttentionState {
  const out: AttentionState = { windows: {}, seen: {} }
  const wins = (s && s.windows) || {}
  for (const id of Object.keys(wins)) {
    const w = wins[id]
    if (!w) continue
    out.windows[id] = {
      root: String(w.root || ''),
      lastSeenMs: numOr(w.lastSeenMs, 0),
      visible: !!w.visible,
      lastHumanInputMs: numOr(w.lastHumanInputMs, 0),
    }
  }
  const hist = (s && s.seen) || {}
  for (const r of Object.keys(hist)) {
    const h = hist[r]
    if (!h) continue
    out.seen[r] = { at: numOr(h.at, 0), visible: !!h.visible }
  }
  return out
}
