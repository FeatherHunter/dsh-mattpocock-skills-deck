/**
 * src/host/sessionLifecycle.ts —— 会话启停电话与共享早选判据（来源：src/host/sessionLifecycle.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：ping、cwd（含落盘直读与单飞）与快照、刷新共用的早选判据；目录取法调 shared 共用函数。
 *
 * 三条不能改的约定（改之前先看原 sessionLifecycle.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

// ---------------------------------------------------------------------------
// 类型（#1247 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；
// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，
// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */
type Deps = any;

/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */
type WfArgs = any;

// src/host/sessionLifecycle.js —— 会话启停电话与共享早选判据（H4 #448 从 host/index.js 273–275/288–307 搬出电话体，早选判据为快照与刷新两处前奏的同一逻辑收敛，纯结构、行为零变化）。
// 以后谁改它：改会话启停电话或早选与 force 判据的人。预估约230行，超 350 打回。
// 接线：由 index.js 动态 import 加载；ctx 与探测服务显式注入，快照与刷新经 index 转供给复用；本文件不引用其他新文件；目录取法调 shared 共用函数（#730），内存答不出再问一次落盘语料（同票第二段）。
import { resolveSessionCwd } from '../shared/session-cwd.js'
export function createSessionLifecycle(deps?: any): any {
  const { ctx, DEFAULT_CWD, errText, getDetectionService, getTrackerRegistry, getPlatform, canonicalKey, logCtx } = deps
  // #491 房外埋点：hash8 只记散列不记原文；探测结论低频常驻，直接落盘（库体内兜底）。
  function hash8(s?: any) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  async function handlePing() {
      return { ok: true, ts: Date.now() }
  }
  // #782 落盘直读缓存与单飞：会话头不可变（换了目录就是另一个会话），命中可常驻内存；
  //   未命中不缓存（会话稍后可能落盘）；同号并发共用同一趟读取，只读一次盘。
  const diskCache = new Map()
  const diskInflight = new Map()
  const DISK_CACHE_MAX = 2000
  function diskCacheGet(sid?: any) { try { return diskCache.get(String(sid)) } catch (e) { return undefined } }
  function diskCacheSet(sid?: any, cwd?: any) {
    try {
      const k = String(sid)
      if (diskCache.has(k)) diskCache.delete(k)
      diskCache.set(k, cwd)
      while (diskCache.size > DISK_CACHE_MAX) diskCache.delete(diskCache.keys().next().value)
    } catch (e) {}
  }
  // #782 日志点（常驻信息，直发不判开关）：只记命中与否、耗时、哪条路、结果枚举，不记路径原文、
  //   不记会话号原文。问一次盘记一行；内存答得出时不走到这里，一行也不记。
  //   查法：这一步今天走了几次看行数，命中几次看 hit:true，慢不慢看 latencyMs。
  function emitDiskLog(row?: any) {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'cwd.persisted', row) } catch (e) {}
  }
  function isNotFoundErr(e?: any) {
    try {
      if (!e) return false
      if ((e as any).name === 'SessionPersistenceNotFoundError') return true
      const code = (e as any).code || (e as any).errorKind
      if (code === 'SESSION_QUERY_SESSION_NOT_FOUND') return true
      return /not found/i.test(String((e && (e as any).message) || e))
    } catch (err) { return false }
  }
  // 单趟落盘读取（不记日志、不抛错）：按号只读一条，不列全量。
  //   首选持久化服务的按号打开（一次目录定位加读一个文件）；该服务缺席才回退旧的按号过滤
  //   （列全量，老 DSH 兼容）；两处都没有时如实返回空，由调用方按原样失败。
  async function readDiskOnce(sid?: any) {
    const key = String(sid)
    try {
      let ps: any = null
      try { ps = ctx.get('sessionPersistence') } catch (e) { ps = null }
      if (ps && typeof ps.open === 'function') {
        let handle: any = null
        try {
          handle = await ps.open(key, 'read')
          const header = handle && handle.header
          const cwd = resolveSessionCwd({ header: header })
          if (cwd) { diskCacheSet(key, cwd); return { cwd: cwd, via: 'persist-open', outcome: 'hit' } }
          return { cwd: '', via: 'persist-open', outcome: 'not-found' }
        } catch (e) {
          return { cwd: '', via: 'persist-open', outcome: isNotFoundErr(e) ? 'not-found' : 'error' }
        } finally {
          try { if (handle && typeof handle.close === 'function') await handle.close() } catch (eC) {}
        }
      }
    } catch (eOuter) {}
    try {
      const q = ctx.get('sessionQuery')
      if (!q || typeof q.filterSessions !== 'function') return { cwd: '', via: 'unavailable', outcome: 'no-service' }
      const records = await q.filterSessions([{ kind: 'id', values: [key] }])
      if (!Array.isArray(records)) return { cwd: '', via: 'query-filter', outcome: 'error' }
      for (const rec of records) {
        const cwd = resolveSessionCwd(rec) // 语料记录与「会话对象」同形（头放在 header 里），所以共用同一只取法
        if (cwd) { diskCacheSet(key, cwd); return { cwd: cwd, via: 'query-filter', outcome: 'hit' } }
      }
      return { cwd: '', via: 'query-filter', outcome: 'not-found' }
    } catch (e) {}
    return { cwd: '', via: 'query-filter', outcome: 'error' }
  }
  // #730 第二段：内存里答不出时，去落盘问一次同一个字段（会话头里的目录）。
  //   为什么必须有这一步：DSH 的会话仓库只装「活着的」会话，会话所属的执行单元一释放就把会话移出仓库，
  //   于是「刚才还在看的会话，过一会儿就问不到了」。可真机实测 4187 个落盘会话头里 4187 个都记着目录，
  //   一个不缺——答案一直在盘上，原先只问了内存那一个来源（真机 5 天 1957 次询问失败 283 次，全落在这一支）。
  //   #782 起按号只读一条（持久化服务的按号打开），不再列全量：旧实现经会话查询服务的按号过滤，
  //   而那条查询内部先列一遍全部落盘会话头（4187 个），面板打开又要等这条电话回来才加载数据，
  //   于是这一步成了面板打开的秒级等待。失败一律回空串，由调用方按原本那一类如实失败——
  //   绝不在插件这边自己拼一个目录出来。
  async function persistedCwdOf(sid?: any) {
    const key = String(sid)
    const t0 = Date.now()
    try {
      const cached = diskCacheGet(key)
      if (typeof cached === 'string' && cached) {
        emitDiskLog({ hit: true, latencyMs: Date.now() - t0, via: 'cache', outcome: 'hit' })
        return cached
      }
    } catch (e) {}
    try {
      let p: any = null
      try { p = diskInflight.get(key) } catch (e) { p = null }
      if (!p) {
        p = readDiskOnce(key).catch(function() { return { cwd: '', via: 'persist-open', outcome: 'error' } })
        try { diskInflight.set(key, p) } catch (e) {}
        const drop = function() { try { if (diskInflight.get(key) === p) diskInflight.delete(key) } catch (e) {} }
        p.then(drop, drop)
      }
      const r = await p
      const cwd = (r && typeof r.cwd === 'string') ? r.cwd : ''
      emitDiskLog({ hit: cwd !== '', latencyMs: Date.now() - t0, via: (r && r.via) || 'persist-open', outcome: (r && r.outcome) || (cwd ? 'hit' : 'not-found') })
      return cwd
    } catch (e) {}
    return ''
  }
  async function handleCwd(args?: any) {
      const sid = args && args.sessionId
      // 失败四种各有机器可读种类（#730：无目录与找不到会话必须分开，否则排查分不清哪一类现场；旧文案一个字不改）。
      if (!sid) return { ok: false, error: '缺少 sessionId', kind: 'no-sid' }
      const sessions = ctx.get('sessions')
      if (sessions === undefined || typeof sessions.get !== 'function') return { ok: false, error: 'sessions 服务不可用', kind: 'no-service' }
      let liveMissing = false
      try {
        const s = sessions.get(sid)
        if (!s) liveMissing = true
        else {
          const cwd = resolveSessionCwd(s) // #730：与沙箱同一套取法，只读 header.cwd
          if (cwd) return await withRoot({ ok: true, cwd: cwd }, cwd)
        }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
      const fromDisk = await persistedCwdOf(sid) // #730 第二段：内存答不出就问落盘；两处都答不出才按原样失败
      if (fromDisk) return await withRoot({ ok: true, cwd: fromDisk }, fromDisk)
      if (liveMissing) return { ok: false, error: '找不到这个会话', kind: 'not-found' }
      return { ok: false, error: '会话无 cwd 信息', kind: 'no-cwd' }
  }
  // 顺手把「这个会话的工作区根」也带回给客户端（2026-09-19 加，维护者报「面板打开后几十秒才出现归属标志」）。
  //   为什么加在这里：面板头部那枚归属标志只要工作区根这一个值，原先却只能等一整份仓库快照（含全部票与地图）
  //   拿回来才画得出来，缓存没命中时就是几十秒。而工作区根是一条很便宜的信息，这条电话（wf.cwd）在面板打开时
  //   本来就会被调用，顺路带回来客户端几百毫秒内就有根了，与快照什么时候到无关。
  //   取法与快照里那个 workspaceRoot 完全同一把尺子（canonicalKey）：同源才不会出现「两处算出两个根」。
  //   失败一律只当「这次没带这个值」：这条电话原本只答 cwd，不能因为算根出问题就把它的行为改坏。
  //   （这里不记日志：算根失败是个安静的可选增强，这条电话本身的成败已经由 host.call / host.call.fail 记着了。）
  async function withRoot(res?: any, rawCwd?: any) {
    try {
      if (typeof canonicalKey !== 'function') return res
      const root = await canonicalKey(rawCwd)
      if (typeof root === 'string' && root) res.workspaceRoot = root
    } catch (e) {}
    return res
  }
  // 两处前奏的同一判据收敛：显式绑定优先，否则实时探测。快照与刷新经显式参数复用本函数，不各留一份拷贝。
  async function selectEarly(selCtx?: any) {
    const cwd = selCtx.cwd
    let sel: any = null
    let svcSaid = false // 探测服务给没给出结论（「它说没有后端」也算给了结论）
    let why = ''        // 兜底的原因码，落在下面那条日志里
    let errHash = ''
    try {
      const svc = await getDetectionService()
      if (svc && typeof svc.detect === 'function') {
        // 上报已退役不传：刚选的经写入口直达文件（落盘 + 清缓存），本轮即读到。
        const det = await svc.detect({ cwd }, { skipSkillProbes: true })
        if (det && det.selection) { sel = det.selection; svcSaid = true } else why = 'service-no-selection'
      } else why = 'service-missing'
    } catch (eSvc) { why = 'service-threw'; try { errHash = hash8(String((eSvc && (eSvc as any).message) || eSvc)) } catch (eH) {} }
    // 兜底只留给「探测服务根本没给出结论」这一种。服务内部走的就是统一判定出口，出口已经把三层
    //   （工作区文件、声明文件、各房认领）都问过了；它回「没有后端」是一个结论，不是失败。
    //   收窄的两条理由：
    //   ① 旧写法会在出口已经答过之后再直问一次注册表，把同一批 matches 重扫一遍（Markdown 房还要再列
    //      一次 .scratch 目录），白花钱；
    //   ② 更要紧的是它可能给出与出口不同的答案，于是早快照用了一个统一判定没认可的结局——那正是 #1138
    //      要收掉的「两条路两个答案」。它原先还兼着捞「注册表里那份进程内绑定」，那份绑定在 #1138 已经
    //      删掉（人选的真源只剩工作区文件），所以兜底只剩「服务缺席 / 抛错」这一种用途。
    if (!svcSaid) {
      const t1 = Date.now()
      try {
        const regTmp = await getTrackerRegistry()
        const tmpHandle = { cwd }
        const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'snapshot-early' }
        const sel2 = await regTmp.select(tmpHandle, tmpCtx)
        if (sel2) sel = sel2
      } catch (eReg) { why = (why || 'service-threw') + '+registry-threw'; try { errHash = hash8(String((eReg && (eReg as any).message) || eReg)) } catch (eH2) {} }
      // 这一趟不在统一判定出口里，所以它自己留一条记录：按需事件，只有排查装配与时序问题时才需要。
      //   为什么不借用出口那条常驻结论线（detection.detect）：那不是同一件事，硬塞进去会让读日志的
      //   人以为出口答了两遍；而出口那条线在自己的路径上照发（探测服务把日志出口一路递到了出口）。
      //   开关在调用处先判一次（高频守卫的口径）：关着就连字段对象都不组装。
      try {
        if (logCtx && typeof logCtx.fire === 'function' && typeof logCtx.isEnabled === 'function' && logCtx.isEnabled('debug')) {
          logCtx.fire('debug', 'detection.fallback', { cwdHash: hash8(cwd), backendId: String((sel && sel.backendId) || ''), source: String((sel && sel.source) || ''), pending: !!(sel && sel.pending), why: why || 'service-no-selection', errorHash: errHash, latencyMs: Date.now() - t1 })
        }
      } catch (eL) {}
    }
    return sel
  }
  function isComposerSelection(sel?: any) {
    return !!(sel && sel.backendId && sel.backendId !== 'github' && sel.backendId !== '' && sel.backendId !== 'other')
  }
  function phoneLog(method?: any, kind?: any, t0?: any, res?: any, err?: any) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && (err as any).message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && (res.error || res.errorKind)) || 'cwd-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method?: any, kind?: any, fn?: any) { return async function() { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { handlePing: handlePing, handleCwd: loggedPhone('wf.cwd', 'cwd', handleCwd), selectEarly: selectEarly, isComposerSelection: isComposerSelection }
}
