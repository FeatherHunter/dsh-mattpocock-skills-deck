// src/deck/tools/map-link.ts —— deck_map_link（#713 第六批；#1019 换到新树、#1035 转 TypeScript）
//
// 给**已经存在**的票补边或改边：父子和阻塞两种，逐条做、逐条校验。
// 「每条边在返回里标出落点」就落在这里：写完之后读回一次那张票，按它自己的结构字段与正文判，
// 判不出来就说「说不好」，绝不默认写成「原生层级」（判据与反证方向见 edge-landing.ts 的 classifyEdgeLanding）。
// 校验用计数：改完按父票列一遍子票 / 再读一次依赖，把「要几条、实际几条」对一次，对不上就说 partial。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { classifyEdgeLanding, edgeEvidence, statusOfItems, applyParentEdge, applyBlockEdges, precheckBlockBatch } from '../shell/edge-landing.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'
import { withCallScope } from '../shell/call-budget.js'
import { withKeyLock } from '../shell/write-mutex.js'

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，由调用方退自己的默认。 */
function numOpt(v: unknown): number | undefined { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
/** 钳制等待的结果：等到了给值；超时或对方自己失败都算「没等到」，调用方一律退老路。 */
type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: true }
// 沙箱许可等待上限：超时按缺席走老路（不限权），与既有 catch null 同形。
function withCap<T>(promise: Promise<T> | T, ms: number): Promise<CapResult<T>> {
  return Promise.race([
    Promise.resolve(promise).then(function (v): CapResult<T> { return { ok: true, value: v } }, function (): CapResult<T> { return { ok: false } }),
    new Promise<CapResult<T>>(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
const SANDBOX_TIMEOUT_MS = 5000

/**
 * 落点证据函数的收口形状：第四个形参（额外字段）按可选算，其余与调用处传的三个实参一致。
 * 壳层的 edgeEvidence(op, target, evidence, extra) 目前把 extra 写成必填，而本文件的五个调用点一直只传三个，
 * 函数体自己用 extra || {} 兜；strict 下那五处会被当成漏参报错。这里只给本文件一个更准的签名，
 * 断言在编译期就被擦掉，运行时一步没多；等 #1040 把壳层那个形参标成可选，这条别名可以删。
 */
type EdgeEvidenceFn = (op: unknown, target: unknown, evidence: unknown, extra?: unknown) => Record<string, unknown>

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckMapLinkDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；两个值原样传，可能还没有。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_map_link',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。给已存在的 ISSUE 补 parent 或 blockedBy 边，写完读回并逐条标出落点。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '要改的那张票（子票）' },
      parentKey: { type: 'string', description: '要挂到的父票；不传就不动父子' },
      blockedBy: { type: 'array', items: { type: 'string' }, description: '这张票被哪些票阻塞（整批替换）' },
      edges: {
        type: 'array',
        description: '一次改多张票的边；与 key/parentKey/blockedBy 二选一',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, parentKey: { type: 'string' }, blockedBy: { type: 'array', items: { type: 'string' } } },
          required: ['key'],
          additionalProperties: false,
        },
      },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    additionalProperties: false,
  },
}

/** 把一处边目标列出来：不是数组就当空表，逐项转成字符串并丢掉空值（读的是运行时真值，形状不细究）。 */
function asList(v: unknown) {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}

/**
 * 一条阻塞边写完之后读回来的结果：landed 是读回来的全集，after 是读回的原文（给重复项补明细用），
 * failed 非空表示写这一步就没成，readOk 说「写后读回这一步自己成没成」——读失败时 landed 是空的，
 * 但那是「没读到」，不是「读回来了、里面没有」，给重复项补明细时必须照它分开说（#790）。
 */
type EdgeReadback = {
  landed: unknown[]
  after: { issue: unknown; dependencies: unknown }
  failed: { kind?: string; ok?: boolean; text?: string } | null
  readOk: boolean
}

/**
 * 同一张票那一组边做完之后攒下来的东西。items / notes / touched 里装的都是运行时真值
 * （每一行的形状由下面各处现拼，这里不细究），readback 是那条阻塞边写完之后读回来的结果，
 * 没写过就是 null。
 */
type EdgeGroupOut = {
  items: Array<Record<string, unknown>>
  notes: string[]
  touched: string[]
  done: number
  readback: EdgeReadback | null
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckMapLinkDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckMapLink(deps?: DeckMapLinkDeps) {
  const d: DeckMapLinkDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数先当「未知」再逐项收口（key / edges / effortId 下面各收一次），回执形状由壳统一渲染。
   * exec 上只声明本文件真正会读的那个字段（取消信号），其余字段一律不碰、照旧整只交给壳，
   * 所以下面取 signal 的地方不必写一串断言。
   */
  async function run(exec: { signal?: unknown } | null | undefined, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const est = shell.estimateFor('deck_map_link', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_map_link', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    const jobs = Array.isArray(a.edges) && a.edges.length ? a.edges : (a.key ? [a] : [])
    if (!jobs.length) return shell.unsupported('deck_map_link', REFUSAL_REASONS.BAD_ARGS, '要改哪张票的边：给 key（可带 parentKey / blockedBy），或者给 edges 清单。', { cost: { estimated: est } })
    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_map_link', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    // exec 上那个取消信号。契约层还没给 exec 标形状（见 #1040），三处 exec.signal 各按纯类型断言收口：
    // 取值表达式一字不动，所以转译出来的 JS 与转换前逐字节一致。
    return shell.call({ tool: 'deck_map_link', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: (await (async function () { try { if (typeof d.sandboxPolicyFor !== 'function') return null; const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS); return (raced && raced.ok === true) ? raced.value : null } catch (eS) { return null } })()), signal: (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : undefined }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      // 逐条明细与给 AI 看的注记：装的都是运行时真值（每一行的形状由下面各处现拼，这里不细究）。
      const items: Array<Record<string, unknown>> = []
      const notes: string[] = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      const touched: string[] = []
      let done = 0
      // #898：设置阻塞边是整批替换语义，同一个票号在一次调用里出现多次时，
      // 先把它的阻塞目标合并成完整集合再写一次，否则后一次写会删掉前一次的边。
      // 跨次调用仍按整批替换：以每一次调用的完整集合为准。
      const mergedBlocked = new Map()
      for (const job of jobs) {
        if (job.blockedBy !== undefined && job.blockedBy !== null) {
          const k = String((job && job.key) || '').trim()
          if (!k) continue
          if (!mergedBlocked.has(k)) mergedBlocked.set(k, [])
          const arr = mergedBlocked.get(k)
          for (const target of asList(job.blockedBy)) if (arr.indexOf(target) < 0) arr.push(target)
        }
      }
      // 同一张票的边组内逐条写（同时写同一张票会丢一次改动），不同票的组同时写。
      const keyOrder = []
      const jobsByKey = new Map()
      for (const job of jobs) {
        const k = String((job && job.key) || '').trim()
        if (!k) { items.push({ key: '', status: 'failed', reason: 'edges 里有一项没写 key。' }); continue }
        if (!jobsByKey.has(k)) { jobsByKey.set(k, []); keyOrder.push(k) }
        jobsByKey.get(k).push(job)
      }
      // #929：写任何一条边之前先整批过一遍成环预检。逐组的写前检查读的是已经落盘的图，看不见同批里
      // 还没落盘的边 —— 两条互指的边同批发出时两边都会通过、盘上留下环（已用真件复现）。
      // 预检只读一次整图、串行算完；下面那份组间并行一个字不动。被拒的票只跳过阻塞边，父子边照旧做。
      const pre = mergedBlocked.size ? await precheckBlockBatch(t, repo, opCtx, keyOrder, mergedBlocked) : { ok: true, refused: new Map() }
      if (!pre.ok) notes.push('这一批的整批成环预检没读到整图（列表没回来），成环检查只有每一组自己那一份：同批里互指的边仍可能都通过。')
      const perKey = await Promise.all(keyOrder.map(async (key) => {
        const out: EdgeGroupOut = { items: [], notes: [], touched: [], done: 0, readback: null }
        // 同票分组持锁 serial：同票并发补边不再丢一次改动；不同票分组照旧并行。
        // 锁只保证“同一组内逐条”不被别笔穿插，组间并行一个字不动。
        const lockTimeoutMs = numOpt(d.keyLockTimeoutMs)
        const held = await withKeyLock(repo, key, async () => {
          for (const job of jobsByKey.get(key)) {
            if (sc.outOfBudget()) { out.items.push({ key: key, status: 'failed', reason: '剩余额度不够发这一次调用了，这张票的边这次没动：带同样参数再调一次即可。' }); continue }
          if (job.parentKey !== undefined && job.parentKey !== null) {
            const r = await applyParentEdge(t, repo, opCtx, key, String(job.parentKey))
            out.items.push(r.item)
            if (r.applied) { out.done += 1; out.touched.push(key) }
          }
          if (job.blockedBy !== undefined && job.blockedBy !== null) {
            if (pre.refused.has(key)) {
              // 整批预检说这一组边会让图成环：这条边不写，逐条如实报失败（别让 AI 当成建好了）。
              for (const target of asList(job.blockedBy)) {
                out.items.push(Object.assign({ key: key, status: 'failed' }, (edgeEvidence as EdgeEvidenceFn)('block', target, { kind: 'unknown', ok: false, text: pre.refused.get(key) })))
              }
              continue
            }
            if (out.readback) {
              // 同一票号的阻塞边已按合并后的完整集合写过并读回过，这一重复项不再重写，
              // 按当时的读回结果为它自己的目标逐个补明细（写失败时同样逐个补失败）。
              for (const target of asList(job.blockedBy)) {
                // readOk 分开看：读失败时只能说「没读回来，判不了」，绝不许说成「这条依赖没出现在票上」（#790）。
                const hit = out.readback.readOk && !out.readback.failed && out.readback.landed.indexOf(target) >= 0
                const e2 = out.readback.failed ? out.readback.failed
                  : !out.readback.readOk ? { kind: 'unknown', ok: false, text: '写后没读回来，判不了这条依赖落上了没有：这一组边已按合并后的完整集合写过一次，读回没成功，别把这条当成已建成、也别当成没建成（同组第一条明细里有后端原话）。' }
                  : hit ? classifyEdgeLanding('block', target, out.readback.after)
                  : { kind: 'unknown', ok: false, text: '写后读回：这条依赖没出现在票上（要 ' + target + '，读回来 ' + (out.readback.landed.join('、') || '空') + '）' }
                out.items.push(Object.assign({ key: key, status: hit ? 'ok' : 'failed' }, (edgeEvidence as EdgeEvidenceFn)('block', target, e2)))
                if (e2.ok) { out.done += 1; out.touched.push(key) }
              }
            } else {
              const want = mergedBlocked.get(key) || asList(job.blockedBy)
              const r = await applyBlockEdges(t, repo, opCtx, key, want, asList(job.blockedBy))
              if (r.failed) {
                out.items.push(Object.assign({ key: key, status: 'failed' }, (edgeEvidence as EdgeEvidenceFn)('block', want.join('、'), r.failed)))
                out.readback = { landed: [], after: { issue: null, dependencies: null }, failed: r.failed, readOk: false }
              } else {
                for (const item of r.items) {
                  out.items.push(item)
                  if (item.status === 'ok') { out.done += 1; out.touched.push(key) }
                }
                const extra = r.landed.filter((k) => want.indexOf(k) < 0)
                if (extra.length) out.notes.push('票 ' + key + ' 上还有计划外的阻塞边：' + extra.join('、') + '（setBlockedBy 是整批替换，后端却留下了它们，读回来核对一次）。')
                out.readback = { landed: r.landed, after: r.after, failed: null, readOk: r.readOk }
              }
            }
          }
          }
          }, { timeoutMs: lockTimeoutMs })
          if (held && held.ok === false && held.timedOut) {
            // 锁没等到：这组一条没动，逐条诚实记（形状与预检拒绝同形，调用方照既有路续跑）。
            const lockText = '这张票正被另一次调用改着，这次没动：稍后带同样参数再调一次即可。'
            for (const job of jobsByKey.get(key)) {
              if (job.parentKey !== undefined && job.parentKey !== null) {
                out.items.push(Object.assign({ key: key, status: 'failed' }, (edgeEvidence as EdgeEvidenceFn)('parent', String(job.parentKey), { kind: 'unknown', ok: false, text: lockText })))
              }
              for (const target of asList(job.blockedBy)) {
                out.items.push(Object.assign({ key: key, status: 'failed' }, (edgeEvidence as EdgeEvidenceFn)('block', target, { kind: 'unknown', ok: false, text: lockText })))
              }
            }
          }
          return out
        }))
      for (const r of perKey) {
        for (const i of r.items) items.push(i)
        for (const n of r.notes) notes.push(n)
        for (const k of r.touched) touched.push(k)
        done += r.done
      }
      const status = statusOfItems(items)
      if (status !== DECK_STATUS.OK) notes.push('有几条边没建成，逐条原因在上面的 items 里：别把它们当成已经建好。')
      // #790：顶层一句话要带失败摘要，不只报计数。原因原文仍在逐条 items 的 evidence 里，这里只摘要。
      let text = '这次要补 ' + items.length + ' 条边，建成 ' + done + ' 条。'
      const failed = items.filter((i) => i && i.status !== 'ok')
      if (failed.length) {
        const sums = failed.map((i) => {
          const t = String((i && i.target) || '')
          const e = String((i && i.evidence) || (i && i.reason) || '')
          return String((i && i.key) || '?') + '→' + t + '：' + e.slice(0, 120)
        })
        text += '失败 ' + failed.length + ' 条：' + sums.join('；').slice(0, 800)
      }
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: text,
          data: { requested: items.length, done: done, jobs: jobs },
          items: items,
          notes: notes,
          touched: touched,
        },
        claimed: { requests: est.requests, points: est.points },
      }
    })
  }

  return { definition: definition, run: run }
}
