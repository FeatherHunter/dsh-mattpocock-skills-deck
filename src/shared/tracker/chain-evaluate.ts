// src/shared/tracker/chain-evaluate.ts —— S1（#451）从 chain.js 拆出之求值器与快照汇总，纯结构、行为零变化。
// 以后谁改它：改求值推进、快照汇总、进度口径的人。预估约260行，超 350 打回。
// 接线：不引用类型与校验文件（墙要求）；检查状态、形状版本、小助手与类型、校验文件同源，改动时一起改。

/** 与 chain-types.ts 同源的最小形状（墙要求不互相引用；改动时两处同改）。 */
type EvalCheckObject = {
  id?: string
  kind?: string
  primitive?: string
  command?: string
  path?: string
  key?: string
  skill?: string
}

/** 检查谓词：string 标识是 backend kind 的简写，对象形态按 kind 区分三种来源。 */
type EvalCheck = string | EvalCheckObject

/** 展示数据：只读 fallback 与 title 做胶囊回落，多余字段透传不解读。 */
type EvalShow = {
  fallback?: string
  title?: string
  [key: string]: unknown
}

/** 动作声明：求值器只看「有没有动作」定 current 还是 fail，不解读动作内容。 */
type EvalAction = {
  [key: string]: unknown
}

/** 检查项：onPass/onFail 缺失按「无展示无动作」处理，不抛错。 */
type EvalCheckItem = {
  id?: unknown
  check?: EvalCheck
  onPass?: { show?: EvalShow | null; actions?: EvalAction[] }
  onFail?: { show?: EvalShow | null; actions?: EvalAction[] }
}

/** 有序检查项序列（前步通过才进入下一步）。 */
type EvalChain = EvalCheckItem[]

/** 单步快照：detail 只在畸形项降级时出现，正常步骤没有该字段。 */
type EvalStepSnapshot = {
  id: string
  check: unknown
  status: string
  show: EvalShow | null
  actions: EvalAction[]
  isApplicable: boolean
  blockedBy: string | null
  isCurrent?: boolean
  isBlocking?: boolean
  detail?: string
}

/** 链整体态：四态无 na，空链是 'empty' 而不是 'allDone'。 */
type EvalChainState = 'allDone' | 'hasCurrent' | 'pending' | 'empty'

/** 整条链的求值快照（含票面兼容别名，failedIndex 与 currentIndex 同值）。 */
type EvalChainSnapshot = {
  steps: EvalStepSnapshot[]
  currentIndex: number | null
  failedIndex: number | null
  doneCount: number
  applicableCount: number
  totalCount: number
  chainState: EvalChainState
  version: string
  isComplete: boolean
  hasBlockingFailure: boolean
  blockingCheck: string | null
}

/** 已求值的谓词结果：对象按 id 查，Map 按键查，函数按 id 调；缺位一律按 pending 处理。 */
type PredicateResults = Record<string, unknown> | Map<string, unknown> | ((id: string) => unknown)

// 与 chain-types.js 同源（墙要求不互相引用；改动时两处同改）。
/** 契约形状版本（供日志/审计）。 */
const CHAIN_VERSION = 1

// 与 chain-types.js 同源（墙要求不互相引用；改动时两处同改）。
/** 检查项状态集（链条求值输出）。枚举值小写短横线，契约层稳定。2026-08-27 起删 NA，四态。 */
const CHECK_STATE = Object.freeze({
  DONE: 'done',       // 检查通过，链条前进
  CURRENT: 'current', // 链头未通过且有可执行动作（需用户/ AI 立即处理）—— 高亮态
  FAIL: 'fail',       // 链头未通过且无可执行动作（ terminal 失败，需人工介入）—— 红态
  PENDING: 'pending', // 探测中（输入为 null/缺位）或被前步阻塞—— 灰态/ spinner
})

// ---------- 内部辅助 ----------

function isPlainObject(v: unknown): v is Record<string, unknown> { return v != null && typeof v === 'object' && !Array.isArray(v) }

function deriveCheckId(item: EvalCheckItem | null | undefined): string {
  if (!item) throw new Error('CheckItem 必须为对象')
  if (typeof item.id === 'string' && item.id.trim()) return item.id.trim()
  // 回退用 check 字符串（票面简化形态）
  const c = item.check
  if (typeof c === 'string' && c.trim()) return c.trim()
  if (c && typeof c === 'object' && typeof c.id === 'string' && c.id.trim()) return c.id.trim()
  if (c && typeof c === 'object' && typeof c.kind === 'string') {
    // 对象形态无 id 时，用 kind:id 或 kind:primitive:xxx 拼装
    if (c.id) return String(c.kind) + ':' + String(c.id)
    if (c.primitive) return 'primitive:' + String(c.primitive) + ':' + String(c.command || c.path || c.key || c.skill || '')
  }
  throw new Error('CheckItem 需 id 或 string check 标识（链内唯一键）')
}

function normalizeResult(v: { status?: unknown; ok?: unknown } | string | boolean | null | undefined): string {
  if (v === true || v === 'pass' || v === 'done' || v === 'PASS') return 'pass'
  if (v === false || v === 'fail' || v === 'FAIL') return 'fail'
  if (v == null) return 'pending'
  if (typeof v === 'object' && v !== null) {
    if (v.status === 'pass' || v.status === 'done' || v.ok === true) return 'pass'
    if (v.status === 'fail' || v.ok === false) return 'fail'
    if (v.status === 'pending') return 'pending'
  }
  return String(v)
}

// ---------- 求值器（纯函数，宿主喂「已求值的状态」→ 出步骤快照） ----------

/**
 * 契约层纯函数求值器（2026-08-27 起删 na，四态）。
 * 输入：静态 chain + 已 resolve 的 predicateResults（Record<id|check, 'pass'|'fail'|null>，null=pending）；
 * 输出：每步 StepSnapshot + 链整体 ChainSnapshot。
 * 约束：
 *  - 顺序求值：前步非 done 则后步一律 pending（被前步阻塞），与真实宿主探测一致；
 *  - 推进只来自重求值（调用方需重新 resolve predicateResults 再调本函数，动作回调不直接改 status）；
 *  - 诚实失败：枚举外 action type 在此不拦（留给 UI dispatcher 报 unsupported），求值器只定 status。
 *
 * @param {Chain} chain
 * @param {Record<string, 'pass'|'fail'|null|boolean|Object>|Map<string, any>|Function} predicateResults
 * @param {{backendId?: string}} [opts]
 * @returns {ChainSnapshot}
 */
export function evaluateChain(chain: EvalChain, predicateResults: PredicateResults = {}, opts: { backendId?: string } = {}): EvalChainSnapshot {
  if (!Array.isArray(chain)) throw new Error('evaluateChain: chain must be array')
  const results = predicateResults

  // 统一取结果：支持 Map、对象、函数；键按 item.id 回退 check 字符串
  const getVal = (item: EvalCheckItem | null | undefined): unknown => {
    try {
      if (typeof results === 'function') {
        const id = deriveCheckId(item)
        try { const v = results(id); if (v !== undefined) return v } catch {}
        // 回退按 check 字符串
        const c = item && item.check
        if (typeof c === 'string') {
          try { const v2 = results(c); if (v2 !== undefined) return v2 } catch {}
        }
        return undefined
      }
      if (results instanceof Map) {
        const id = deriveCheckId(item)
        if (results.has(id)) return results.get(id)
        const c = item && item.check
        if (typeof c === 'string' && results.has(c)) return results.get(c)
        if (c && typeof c === 'object' && c.id && results.has(c.id)) return results.get(c.id)
        return undefined
      }
      if (results && typeof results === 'object') {
        const id = deriveCheckId(item)
        if (Object.prototype.hasOwnProperty.call(results, id)) return results[id]
        const c = item && item.check
        if (typeof c === 'string' && Object.prototype.hasOwnProperty.call(results, c)) return results[c]
        if (c && typeof c === 'object' && c.id && Object.prototype.hasOwnProperty.call(results, c.id)) return results[c.id]
        // 兼容 check 作为键的字符串形态（对象 check 无 id 时）
        if (typeof c === 'string' && results[c] !== undefined) return results[c]
        return undefined
      }
    } catch {}
    return undefined
  }

  const steps: EvalStepSnapshot[] = []
  let currentIndex: number | null = null
  let doneCount = 0
  let foundHead = false
  let headBlockedBy: string | null = null

  for (let i=0;i<chain.length;i++) {
    const item = chain[i]
    let id: string
    try { id = deriveCheckId(item) } catch (e) {
      // B5 fix: 畸形项不抛崩整链，降级为 pending 单步，detail 透传供日志二分
      const badIdx = i
      steps.push({ id: '__bad_'+badIdx, check: item && item.check || null, status: CHECK_STATE.PENDING, show: null, actions: [], isApplicable: true, blockedBy: foundHead ? headBlockedBy : null, detail: String(((e as { message?: unknown }) || {}).message || e) })
      // 首个畸形即视为链头（pending），后续一律 pending
      if (!foundHead) { currentIndex = badIdx; foundHead = true; headBlockedBy = '__bad_'+badIdx }
      continue
    }
    const raw = getVal(item)
    // 归一化（2026-08-27 起无 na）
    let norm: unknown = raw
    if (raw === true) norm = 'pass'
    else if (raw === false) norm = 'fail'
    else if (raw == null) norm = 'pending'
    else if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase()
      if (s === 'pass' || s === 'done' || s === 'true' || s === 'ok') norm = 'pass'
      else if (s === 'fail' || s === 'false' || s === 'bad') norm = 'fail'
      else if (s === 'pending' || s === '') norm = 'pending'
      else norm = 'pending'
    } else if (isPlainObject(raw)) {
      if (raw.status === 'pass' || raw.status === 'done' || raw.ok === true) norm = 'pass'
      else if (raw.status === 'fail' || raw.ok === false) norm = 'fail'
      else norm = 'pending'
    } else {
      norm = 'pending'
    }

    let status: string
    let show: EvalShow | null = null
    let actions: EvalAction[] = []
    let isApplicable = true
    let blockedBy: string | null = foundHead ? headBlockedBy : null
    let isCurrent = false
    let isBlocking = false

    if (!foundHead) {
      if (norm === 'pass') {
        status = CHECK_STATE.DONE
        show = item.onPass && item.onPass.show ? item.onPass.show : null
        actions = item.onPass && Array.isArray(item.onPass.actions) ? item.onPass.actions : []
        doneCount++
      } else if (norm === 'fail') {
        const hasActions = item.onFail && Array.isArray(item.onFail.actions) && item.onFail.actions.length > 0
        status = hasActions ? CHECK_STATE.CURRENT : CHECK_STATE.FAIL
        show = item.onFail && item.onFail.show ? item.onFail.show : null
        actions = item.onFail && Array.isArray(item.onFail.actions) ? item.onFail.actions : []
        currentIndex = i
        foundHead = true
        headBlockedBy = id
        isCurrent = true
        isBlocking = true
      } else { // pending
        status = CHECK_STATE.PENDING
        show = (item.onFail && item.onFail.show) || (item.onPass && item.onPass.show) || null
        actions = (item.onFail && Array.isArray(item.onFail.actions) && item.onFail.actions.length ? item.onFail.actions : (item.onPass && item.onPass.actions) || [])
        currentIndex = i
        foundHead = true
        headBlockedBy = id
        isCurrent = true
        isBlocking = true
      }
    } else {
      status = CHECK_STATE.PENDING
      show = null
      actions = []
      isApplicable = true
      blockedBy = headBlockedBy
      isCurrent = false
      isBlocking = false
    }

    // 兼容票面 SHOW 的 {title,desc,level} 与 i18n 形态的透传：保留原 show 原样，仅归一 level 字段供后续
    steps.push({ id, check: item.check, status, show, actions, isApplicable, blockedBy, isCurrent, isBlocking })
  }

  const totalCount = chain.length
  const applicableCount = totalCount
  let chainState: EvalChainState = 'empty'
  if (totalCount === 0) chainState = 'empty'
  else if (currentIndex === null) chainState = 'allDone'
  else {
    const cur = steps[currentIndex]
    if (cur.status === CHECK_STATE.PENDING) chainState = 'pending'
    else chainState = 'hasCurrent'
  }

  const isComplete = chainState === 'allDone'
  const hasBlockingFailure = currentIndex !== null
  // headIdx 与 currentIndex 同值：const 才能把「非空」收窄带进下面那个立即执行函数里
  // （currentIndex 是 let，闭包里收窄会丢）。三目条件与 hasBlockingFailure 同义，行为不变。
  const headIdx: number | null = currentIndex
  const blockingCheck = headIdx === null ? null : (steps[headIdx]?.id || (() => { try { return deriveCheckId(chain[headIdx]) } catch { return '__bad_' + headIdx } })())

  return {
    steps,
    currentIndex,
    failedIndex: currentIndex,
    doneCount,
    applicableCount,
    totalCount,
    chainState,
    version: String(CHAIN_VERSION),
    // 兼容别名
    isComplete,
    hasBlockingFailure,
    blockingCheck,
  }
}

/**
 * 便捷：判断链是否完成（全部 done，无阻塞，2026-08-27 起无 na）。
 * 只看快照结论不重跑谓词：pending 的链在这里是 false，想推进必须重求值后再调 evaluateChain。
 * @param {ChainSnapshot} snap
 * @returns {boolean}
 */
export function isChainComplete(snap: EvalChainSnapshot | null | undefined): boolean {
  return !!(snap && (snap.isComplete || snap.chainState === 'allDone'))
}

/**
 * 取当前需展示的失败步（首个 isCurrent），无则 null。
 * currentIndex 越界时回 null 而不是抛错：快照与链长度对不上说明调用处拼错了，这里只诚实回空。
 * @param {ChainSnapshot} snap
 * @returns {StepSnapshot|null}
 */
export function currentStepOf(snap: EvalChainSnapshot | null | undefined): EvalStepSnapshot | null {
  if (!snap || !Array.isArray(snap.steps) || snap.currentIndex == null || snap.currentIndex < 0) return null
  return snap.steps[snap.currentIndex] || null
}

/**
 * 就绪计数口径（契约层统一，供状态栏/胶囊/面板共用，2026-08-27 起无 na）。
 *  - 分子 = doneCount（不计 pending、fail/current）
 *  - 分母 = applicableCount（= total）
 * 分母恒为适用项总数：删 na 之后分母等于全长，total 为 0 时 percent 直接给 100 而不是除零。
 * @param {ChainSnapshot} snap
 * @returns {{done:number, total:number, percent:number|null}}
 */
export function chainProgress(snap: EvalChainSnapshot | null | undefined): { done: number; total: number; percent: number | null } {
  if (!snap || typeof snap.applicableCount !== 'number') return { done:0, total:0, percent:null }
  const done = snap.doneCount || 0
  const total = snap.applicableCount || 0
  if (total === 0) return { done, total, percent: 100 }
  return { done, total, percent: Math.round((done/total)*100) }
}

/**
 * 胶囊汇总口径：返回链状态的人读摘要（供 UI 胶囊/ badge 消费，纯数据）。
 * 空链与判不出链头的链都走「检测中…」：胶囊只做展示，真正的推进状态以 evaluateChain 的 chainState 为准。
 * @param {ChainSnapshot} snap
 * @returns {{kind:'done'|'current'|'fail'|'pending'|'empty', labelKey:string, fallback:string}}
 */
export function capsuleSummary(snap: EvalChainSnapshot | null | undefined): { kind: string; labelKey: string; fallback: string } {
  if (!snap || snap.totalCount===0) return { kind:'empty', labelKey:'chain.empty', fallback:'无检查' }
  if (snap.chainState==='allDone') return { kind:'done', labelKey:'chain.done', fallback:'全部就绪' }
  if (snap.chainState==='pending') return { kind:'pending', labelKey:'chain.pending', fallback:'检测中…'}
  // currentIndex 为 null 时原来 steps[null] 得 undefined，走下面 !cur 那一支；
  // 这里把同一分支显式写出来，行为不变（null 索引本来也只在类型层被禁，运行时就是 undefined）。
  const cur = snap.currentIndex === null ? undefined : snap.steps[snap.currentIndex]
  if (!cur) return { kind:'pending', labelKey:'chain.pending', fallback:'检测中…'}
  // 展示文案取 show.fallback 否则 show.title（两处都缺回默认串）：先把「有没有」算进 showText，
  // 再用它选分支——原来是同一表达式在条件与分支里各写一遍，运行时值一样，类型层第二遍收不窄。
  const showText: string | null | undefined = cur.show && (cur.show.fallback || cur.show.title)
  if (cur.status===CHECK_STATE.CURRENT) return { kind:'current', labelKey:'chain.current', fallback: showText ? showText : '待处理' }
  if (cur.status===CHECK_STATE.FAIL) return { kind:'fail', labelKey:'chain.fail', fallback: showText ? showText : '未通过' }
  return { kind: cur.status, labelKey:'chain.'+cur.status, fallback: showText ? showText : String(cur.status) }
}
