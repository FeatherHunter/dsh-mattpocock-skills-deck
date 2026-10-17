/**
 * tracker/sync.ts — 契约层 · 面板增量同步求值器（#232 · 纯函数 + 跨端常量单源）。
 *
 * 五层职责落位（CONTEXT.md 后端感知架构词条基线）：
 *   - 本模块 = 契约层：「远端索引已变更」谓词的形状定义与求值器（纯函数；host 与 client 共用，
 *     经 SHARED_SPLICE 拼回 client 闭包 / host 半运行时 import()，与 naming-guardian 同模式）。
 *   - host：把 gh 探测原语的真实结果喂入谓词（平台原语封装归平台/宿主层），推进只来自重求值；
 *   - client：按 SYNC 里的节拍常量决定何时发起探针；UI 不分支 backendId、不乐观插入行。
 *
 * #719 删掉的四个事件源常量（SOURCE_GH_CREATE / SOURCE_GH_EDIT / SOURCE_CLAIM /
 * SOURCE_INDEX_DIRTY）与它们的判定函数 needProbeSource：这四个值对应的是
 * issuePath 面包屑事件队列那套通道，那套通道已随 #345 整块移除，今天没有任何代码会产出这四个值
 *（只有那条判定函数自己在读），所以它们是「没有生产者的常量」——留在契约层会让后来人以为
 * 这条触发路还在。定稿第十四章把这类词列为要清的死词汇，门禁 tests/verify-contract-vocabulary.js
 * 从此守着契约层：字符串型常量必须有生产者的字面量在场，否则判红。
 * 下面那些节拍常量是另一回事：它们是「调一次多久」的旋钮，读它们的人在生产代码里。
 *
 * 重求值触发语义（历史口径，保留供追溯）：写后事件与 index-dirty 都只是**调度提示**；
 * 最终 UI 更新必须经既有 wf.probe 的 changed 判定 + 静默快照重算 + diffSnapshots 产出闪烁。
 * 动作不承诺修复，检查才判定状态 —— 本模块不引入任何回调式乐观更新通道。
 *
 * #232 节拍口径：同步链路的全部时间常数（轮询栅格 / 探针长短窗 / 兜底周期）在这里被读出，
 * client 内核只允许派生引用（字面量仅可作防御性兜底形态存在）——UI 层不得硬编码知道
 * 「底层几秒刷一次」，五层职责以此固化。
 *
 * #1215 起，这些时间值的唯一书写处是 config/ 下的三份时间参数 YAML（单次等待上限 timeouts.yaml、
 * 节拍间隔 intervals.yaml、有效期 ttl.yaml）：本文件的时间属性真引中央时间参数，
 * 每个常量住哪份 YAML、哪个键，写在它自己那一行上，一致性由 tests/verify-time-config.ts 看守。
 */
import { SYNC_EVAL_GAP_MS, SYNC_DIRTY_PROBE_DEBOUNCE_MS, SYNC_OVERLAP_SKEW_MS, SYNC_FAILURE_BACKOFF_MS, SYNC_DIRTY_ECHO_TTL_MS, SYNC_POLL_GRID_MS, SYNC_ACTION_PROBE_WINDOW_MS, SYNC_FALLBACK_PROBE_MS, SYNC_FOCUS_PROBE_MIN_MS, SYNC_SNAP_FRESH_MS, ATTENTION_HEARTBEAT_MS, SYNC_ISSUE_CACHE_TTL_MS } from '../time-config/values.js'

/** 远端索引形状：键是票号的字符串，值是 `STATE|updatedAt` 比较串（与 fetchIssueIndex 同构）。 */
type IndexEntries = Record<string, string>

/** 求值态：baseline 为 null 表示还没建档（首看），建档后才参与脏判断。 */
type SyncState = {
  baseline: IndexEntries | null
  maxUpd: string
  lastEvalAt: number
  failures: number
  suspendedUntil: number
  resolving: boolean
}

/** 同步节拍常量表（值一个字没改，要调时间请改对应的 YAML）。
 *  #1215 起 12 个时间属性真引中央时间参数：顶上那一行单行 import 提供绑定，
 *  拼进界面闭包时构建会剥掉这一行（名字由闭包里另一片 timeConfig 提供，单行是硬要求）；
 *  对象形状与冻结保持不变，非时间的四个计数项原样保留。
 *  值与中央 YAML 的一致性仍由 tests/verify-time-config.ts 逐条看守。
 *  本对象里 EVALS_PER_TICK、FAILURE_SUSPEND_AT、DIRTY_MAP_CAP、MAX_POLLED_CWDS 四项是次数与个数，
 *  不是时间旋钮，不入三份 YAML；注释里也已各自标明。 */
export const SYNC = Object.freeze({
  version: 1,
  /** 同一 repoKey 两次增量求值的最小间隔（配额闸；实际周期 = POLL_GRID_MS 的整数倍向上取整）。
   *  住 config/intervals.yaml 的 syncEvalGapMs。 */
  EVAL_GAP_MS: SYNC_EVAL_GAP_MS,
  /** 每个 poll tick 至多求值的 cwd 数（多工作区轮转公平性上限）。 */
  EVALS_PER_TICK: 2,
  /** 已验证脏信号进入探针的短窗合并（区别于 #213 动作长窗 8s —— 真值已由重求值验证过）。
   *  住 config/intervals.yaml 的 syncDirtyProbeDebounceMs。 */
  DIRTY_PROBE_DEBOUNCE_MS: SYNC_DIRTY_PROBE_DEBOUNCE_MS,
  /** since 边界回看重叠（updated_at 秒级精度 + 远端时钟偏差兜底）。
   *  住 config/ttl.yaml 的 syncOverlapSkewMs。 */
  OVERLAP_SKEW_MS: SYNC_OVERLAP_SKEW_MS,
  /** 连续失败熔断阈值：连续失败到几次就暂停重试（次数，不是时间旋钮，不入 YAML）。 */
  FAILURE_SUSPEND_AT: 3,
  /** 熔断时长：暂停多久之后自然重试（错误风暴保护）。
   *  住 config/intervals.yaml 的 syncFailureBackoffMs。 */
  FAILURE_BACKOFF_MS: SYNC_FAILURE_BACKOFF_MS,
  /** 脏 cwd 回执的存活窗（确认式消费：未过期者每轮回执、被上报方取走即清；超时自愈防堆积）。
   *  住 config/ttl.yaml 的 syncDirtyEchoTtlMs。 */
  DIRTY_ECHO_TTL_MS: SYNC_DIRTY_ECHO_TTL_MS,
  /** 回执表容量上限（按 cwd 计；超限裁最旧，防御异常膨胀）。 */
  DIRTY_MAP_CAP: 50,
  /** 单会话上报 cwd 上限（client 与 host 共用的唯一截断真源；#232 视线门控下 = 打开会话所属工作区数，含多面板并列场景）。 */
  MAX_POLLED_CWDS: 12,

  // ---- #232 追加 · 同步链路节拍真源（client 内核禁止出现第二份字面量真相）----
  /** 面板→宿主 issuePath 拉取网格（视线门控轮询的唯一节拍来源）。
   *  住 config/intervals.yaml 的 syncPollGridMs。 */
  POLL_GRID_MS: SYNC_POLL_GRID_MS,
  /** 动作后探针长窗（#213「一次轻量 REST」语义的词汇表升级为常量单源）。
   *  住 config/ttl.yaml 的 syncActionProbeWindowMs。 */
  ACTION_PROBE_WINDOW_MS: SYNC_ACTION_PROBE_WINDOW_MS,
  /** 兜底全量探针周期（无脏信号时的最低频安全网；页签隐藏时跳过发起——#232 R3）。与 FOCUS_PROBE_MIN_MS 数值相同纯属巧合，语义独立、调参不得隐式联动。
   *  住 config/intervals.yaml 的 syncFallbackProbeMs。 */
  FALLBACK_PROBE_MS: SYNC_FALLBACK_PROBE_MS,
  /** 回到前台触发的探针限流间隔（切换工作区回来的恢复通道——#232 R2）。
   *  住 config/intervals.yaml 的 syncFocusProbeMinMs。 */
  FOCUS_PROBE_MIN_MS: SYNC_FOCUS_PROBE_MIN_MS,
  /** 打开面板的快照即时新鲜阈值（超阈才发起一次加载；≤阈纯展示零请求）。
   *  住 config/ttl.yaml 的 syncSnapFreshMs。 */
  SNAP_FRESH_MS: SYNC_SNAP_FRESH_MS,
  /** #707：面板可见时「我还在看这个工作区」的本地心跳间隔（零配额、不出网，只上报事实）。
   *  与 refresh-core/src/budget.ts 的 ATTENTION_HEARTBEAT_MS 同一个数：那边是宿主与核心用的唯一真源，
   *  这里给客户端用（客户端半边今天不 import 核心产物，跨端常量一律落在契约层，见本文件头）。
   *  住 config/intervals.yaml 的 attentionHeartbeatMs——两份消费处锁在同一把 YAML 键上。 */
  ATTENTION_HEARTBEAT_MS: ATTENTION_HEARTBEAT_MS,
  /** Issue 详情单条缓存 TTL（列表新鲜度之外的独立维度；写后 bump 由宿主失效路径承接）。
   *  住 config/ttl.yaml 的 syncIssueCacheTtlMs。 */
  ISSUE_CACHE_TTL: SYNC_ISSUE_CACHE_TTL_MS,
})

/** 求值态工厂（Data Clumps 收敛：字段形状与 noteEval* 纯转移同住契约层）。 */
export function createSyncState(): SyncState {
  return { baseline: null, maxUpd: '', lastEvalAt: 0, failures: 0, suspendedUntil: 0, resolving: false }
}

/**
 * 解析 `gh api ... --jq '{number, state, updatedAt}'` JSON-Lines 输出 → 索引形状
 * { '42': 'OPEN|2026-08-27T04:43:54Z' }（与 fetchIssueIndex 的比较串同构）。
 */
export function parseIndexEntries(text: unknown): IndexEntries {
  const out: IndexEntries = {}
  const lines = String(text || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    try {
      const item = JSON.parse(line)
      if (item && item.number !== undefined && item.number !== null) {
        out[String(item.number)] = String(item.state || '').toUpperCase() + '|' + String(item.updatedAt || '')
      }
    } catch (e) { /* 坏行跳过：差值判断宁可漏报也不误报 */ }
  }
  return out
}

/**
 * 差值谓词：prevIndex 为 null = 首看建档（不判脏，#266「prev 缺失仅建档」同原则）；
 * nextEntries 是 since 视图的**增量集**而非全量 —— 禁止条目数对比，只检查
 * 「有票的 state|updatedAt 相对基线发生变化」。删除票的发现仍由 60s 全量探针兜底（有意保留）。
 */
export function deriveDirty(prevIndex: IndexEntries | null | undefined, nextEntries: IndexEntries): boolean {
  if (!prevIndex) return false
  const keys = Object.keys(nextEntries || {})
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (prevIndex[k] !== nextEntries[k]) return true
  }
  return false
}

/** 合并增量进基线（返回新对象不改入参；键覆盖即更新，updatedAt 以远端为准单调）。 */
export function advanceBaseline(prevIndex: IndexEntries | null | undefined, nextEntries: IndexEntries): IndexEntries {
  const merged = Object.assign({}, prevIndex || {})
  const keys = Object.keys(nextEntries || {})
  for (let i = 0; i < keys.length; i++) merged[keys[i]] = nextEntries[keys[i]]
  return merged
}

/**
 * 由最近一次成功求值的最大 updatedAt 推出本轮 since 下界（回看重叠消除边界漏检）。
 * 无基线/不可解析 → ''（调用方走全量建档路径）。
 */
export function sinceFloor(maxUpdatedAt: string | null | undefined, overlapSkewMs?: number): string {
  if (!maxUpdatedAt) return ''
  const t = Date.parse(String(maxUpdatedAt))
  if (!isFinite(t)) return ''
  const skew = typeof overlapSkewMs === 'number' ? overlapSkewMs : SYNC.OVERLAP_SKEW_MS
  return new Date(Math.max(0, t - skew)).toISOString()
}

/** 从 entries（值形如 'STATE|updatedAt'）提取最大 updatedAt 并推进水位（空集保持不变；
 *  坏/不可解析时刻不参与比较 —— 防止 'bad' 之类串按字典序把合法 ISO 水位顶掉）。 */
export function bumpMaxUpdated(prevMax: string, entries: IndexEntries): string {
  let max = prevMax || ''
  const keys = Object.keys(entries || {})
  for (let i = 0; i < keys.length; i++) {
    const v = String(entries[keys[i]])
    const p = v.indexOf('|')
    if (p >= 0) {
      const upd = v.slice(p + 1)
      if (upd && upd > max && isFinite(Date.parse(upd))) max = upd
    }
  }
  return max
}

/** 失败记账的纯转移（连续失败达阈值进入熔断窗口；宿主负责写回状态表）。 */
// 返回名义上是完整 SyncState：空状态进来时只有三个记账字段（原来行为，宿主写回时合并补全，
// 不是本函数造出 baseline）；as 只过类型层，运行时一字不动。
export function noteEvalFailure(st: SyncState | null | undefined, now: number): SyncState {
  const failures = ((st && st.failures) || 0) + 1
  const suspendedUntil = failures >= SYNC.FAILURE_SUSPEND_AT ? now + SYNC.FAILURE_BACKOFF_MS : 0
  return Object.assign({}, st || {}, { failures: failures, suspendedUntil: suspendedUntil, lastEvalAt: now }) as SyncState
}

/** 成功记账的纯转移（失败计数清零、解除熔断）。 */
export function noteEvalSuccess(st: SyncState | null | undefined, now: number): SyncState {
  return Object.assign({}, st || {}, { failures: 0, suspendedUntil: 0, lastEvalAt: now }) as SyncState
}

/**
 * 选出本 tick 允许求值的 cwd（决策全在纯函数内收敛，宿主零分支逻辑）：
 *   - items 形如 [{ cwd, id }]（id = repoKey 或任意稳定工作区标识）；
 *   - stateById[id] 无记录 = 首看候选（建档优先，次序稳定）；
 *   - resolving / 熔断中 / gap 内 → 本轮跳过；cap 限流；
 *   - 输出去重保序。混合了首看与常规候选时首看自然排前（输入顺序保证）。
 */
export function pickSyncCandidates(
  items: Array<{ cwd: string; id: string }> | null | undefined,
  stateById: Record<string, SyncState> | null | undefined,
  now: number,
  opts?: { evalGapMs?: number; evalsPerTick?: number } | null,
): string[] {
  const gap = (opts && opts.evalGapMs) || SYNC.EVAL_GAP_MS
  const cap = (opts && opts.evalsPerTick) || SYNC.EVALS_PER_TICK
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  const list = Array.isArray(items) ? items : []
  for (let i = 0; i < list.length && out.length < cap; i++) {
    const it = list[i]
    const cwd = it && typeof it.cwd === 'string' ? it.cwd : ''
    if (!cwd || seen[cwd]) continue
    seen[cwd] = true
    const st = stateById ? stateById[it.id] : null
    if (!st) { out.push(cwd); continue }                          // 首看：建档优先
    if (st.resolving) continue                                     // 上轮建档仍在途
    if ((st.suspendedUntil || 0) > now) continue                   // 失败熔断中
    if ((now - (st.lastEvalAt || 0)) < gap) continue               // 配额闸内静默
    out.push(cwd)
  }
  return out
}
