/**
 * src/host/handoffClaim.ts —— 交接文档扫描与认领（来源：src/host/handoffClaim.js，H6 #450 从 host/index.js 324–477 搬出电话体，纯结构、行为零变化；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：交接文档住在工作区的 .scratch/handoff/ 里，面板要知道最新的是哪一份、用户点名要哪一份时能不能给，而「确认开始」那一下的认领（给自己加 assignee）也收在这里，调用点只按名取。
 *
 * 三条不能改的约定（改之前先看原来文件头那两段注释与调用点 index.js）：
 * 1. 由 index.js 动态引用加载，依赖全显式传入（normCwd 与单票分发前奏经 index 转供给复用，不各留一份拷贝），本文件不引用其它新文件。
 * 2. 最新文档的挑选是修改时间倒序加文件名倒序兜底（时间戳文件名本身字典序即时间序），交接目录读不到时按「还没有交接文档」处理，不抛错。
 * 3. 客户端带期望文件名时只做精确匹配或前缀匹配，找不到就回空，不许退回最新那份（退回会引用到上一次的老文档，与修复目标相悖）。
 */

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全是函数与服务（文件服务、目录归一、探测与注册表等），形状按本文件实际用到的成员写成最小，
// 全部用 any 接住；交接条目只有文件名与毫秒时间两样；回包沿用原来三档（成功带 file、失败带 error 字符串、
// 不支持的后端带 kind 错误），运行时形状一字不变。
// ---------------------------------------------------------------------------

/** 组装函数收到的依赖：文件服务、目录归一、开会话的口、快照失效与日志口，全由调用点显式传入。 */
interface HandoffClaimDeps {
  fs: any
  DEFAULT_CWD: any
  normCwd: any
  /** #1445 起认领走写会话：由宿主注入开会话的函数。缺省时认领如实回环境失败，不抛、也不退回直调 gh。 */
  openSession?: any
  setCache: any
  logCtx: any
}

/** 交接目录里的一条：文件名与毫秒时间（读不到时间的按 0 算，见下面挑选函数的注释）。 */
interface HandoffEntry {
  name: string
  mtime: number
}

/**
 * 组装交接文档电话与认领电话（依赖全显式传入）。
 *
 * 为什么：扫描排序与认领流程各自独立，收在一个组装函数里只是为了与原来 index.js 的电话体一一对应。
 * 什么约定不能改：返回对象的三个字段名是调用点按名取的，改名调用点就拿不到。
 */
export function createHandoffClaim(deps: HandoffClaimDeps): any {
  const { fs, DEFAULT_CWD, normCwd, openSession, setCache, logCtx } = deps as any
  // ============ 交接文档（issue #12 BUG4 · 双重防御 · 副路径）============
  // DSH 沙箱里 fs.stat 返回的 info.mtime 形态不可控（Date / ISO 串 / 秒级 Unix / 本地化串 / null / NaN）；
  // 原 `typeof number ? mt : Date.parse(String(mt))` 在 Date 对象或不可 parse 形态都得 NaN；
  // 原 sort 单键 `b.mtime - a.mtime` 在 mtime 相等/NaN 时 Array.sort 视为 equal → 原顺序保留 →
  // fs.listDir 按名字典序返回 → 老文件天然排第一 → mds[0].name = 字典序最小 = 上一次写入（BUG）。
  //
  // 加固（副路径 · 治本）：
  //   - parseHandoffMtime：isFinite 严格校验 + Date 实例 getTime 优先；任何无法 parse 的形态安全归 0
  //     （NaN/null/undefined/0/不可 parse 串 → 0）
  //   - pickLatestHandoff：mtime desc 主键 + name desc 兜底（时间戳文件名 = 字典序 = 时间序）；
  //     mtime 退化为 0 的退化形态（NaN/null/全 0/全等 finite）一律走 name desc 返回字典序最大
  //
  // 注：混合退化形态（new=NaN+old=valid）的 mtime 倒挂，sort 加固无法区分 —— 由主路径
  //     `wf.handoffResolve(args.name)` 在客户端已点过第一击时直接返回该 name 保障。
  const parseHandoffMtime = function (raw: any): number {
    if (typeof raw === 'number') return isFinite(raw) ? raw : 0
    if (raw instanceof Date) { const t: number = raw.getTime(); return isFinite(t) ? t : 0 }
    if (raw) { const p: number = Date.parse(String(raw)); return isFinite(p) ? p : 0 }
    return 0
  }
  const pickLatestHandoff = function (mds: any): string | null {
    if (!Array.isArray(mds) || !mds.length) return null
    const sorted: any[] = (mds as any[]).slice().sort(function (a: any, b: any) {
      const dt: number = (b.mtime || 0) - (a.mtime || 0)
      if (dt !== 0) return dt
      // name desc 兜底：时间戳文件名（YYYYMMDD-HHMMSS-mmm，#787 起带毫秒）字典序 = 时间序
      if (b.name < a.name) return -1
      if (b.name > a.name) return 1
      return 0
    })
    return sorted[0].name
  }
  // 共享目录扫描（handoffLatest + handoffResolve 共用）—— 任何 fs 调用异常都降级为空数组
  const scanHandoffDir = async function (cwd: any): Promise<any> {
    if (fs === undefined) return { error: 'fs 服务不可用', mds: [] }
    try {
      const dir: any = await fs.resolve('.scratch/handoff', { cwd: cwd })
      const entries: any = await fs.listDir(dir)
      const mds: HandoffEntry[] = []
      for (let i: number = 0; i < entries.length; i++) {
        const e: any = entries[i]
        const name: string = (e && (e.name || e.path || '')) || ''
        if (!name || !/\.md$/i.test(name)) continue
        let mtime: number = 0
        try {
          const info: any = await fs.stat(await fs.resolve('.scratch/handoff/' + name, { cwd: cwd }))
          if (info) mtime = parseHandoffMtime(info.mtime)
        } catch (e2: any) { mtime = 0 }
        mds.push({ name: name, mtime: mtime })
      }
      return { mds: mds }
    } catch (e: any) {
      return { mds: [] }  // 目录不存在/不可读 = 还没有交接文档
    }
  }

  // v19：查询 .scratch/handoff/ 下最新的交接文档（按 mtime 倒序 + name desc 兜底 · 加固后），供「交接给新会话」预填 + 复制
  // #652：交接文档住在工作区的 .scratch/ 里（票仓那一级），所以先按工作区根归一再去读——
  //   会话开在子目录里时，旧写法会去子目录下找一份并不存在的 .scratch/handoff，永远答「还没有交接文档」。
  async function handleHandoffLatest(args: any): Promise<any> {
    // #1003 空目录闸：不拿进程目录冒充去读交接目录，诚实失败等就绪。
    const _rawLatestCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawLatestCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawLatestCwd)
    const r: any = await scanHandoffDir(cwd)
    if (r.error) return { ok: false, error: r.error }
    return { ok: true, file: pickLatestHandoff(r.mds) }
  }

  // issue #12 BUG4 · 主路径：客户端带期望文件名（第一击模板渲染出的 handoffFile）时严格返回该文件：
  //   在目录里 → 返回它；不在 → 返回 null（不退回 mtime 最新，避免 fallback 到老文件误导用户）。
  //   无 args.name（用户从未点过第一击，如刷新后 / 直接点右半）→ 走 mtime 最新（与 handoffLatest 同语义）。
  // 区别于初版：初版「name 不在目录也 fallback 到 mtime 最新」在实际场景下被验证为反模式 —— 当 AI 还没写完
  // 文档时（handoffFile 设了但文件未落盘），fallback 会让右半亮蓝且点开后错误引用上次的老文档，与修复目标相悖。
  async function handleHandoffResolve(args: any): Promise<any> {
    // #1003 空目录闸：同上。
    const _rawResolveCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawResolveCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawResolveCwd)
    const r: any = await scanHandoffDir(cwd)
    if (r.error) return { ok: false, error: r.error }
    const want: any = args && args.name
    if (!want) return { ok: true, file: pickLatestHandoff(r.mds) }
    // 前缀匹配（#71 短标题文件名：{ts}-<短标题>.md）：want 以 * 结尾 → 匹配 name 以该前缀开头，取最新
    if (want.slice(-1) === '*') {
      const prefix: string = want.slice(0, -1)
      const m: any[] = r.mds.filter(function (x: any) { return x.name.indexOf(prefix) === 0 })
      if (m.length) return { ok: true, file: pickLatestHandoff(m) }
      return { ok: true, file: null }
    }
    // 精确匹配：在目录里 → 返回它；不在 → 返回 null（不退回 mtime 最新，避免 fallback 到老文件误导用户）。
    if (r.mds.some(function (m: any) { return m.name === want })) return { ok: true, file: want }
    return { ok: true, file: null }
  }

  // ============ 认领（开始此 Issue 流程 · T5 #347）============
  // 用户在 UI 点击「确认开始」且勾选认领后调用：把这张票指派给自己。
  // #1445 起整步走写会话 —— 认领是一次写（改指派人），后端选择、预算闸与操作上下文都归会话，
  //   本文件不再自己探测后端、不再区分 GitHub 与别的后端、也不再直调 gh（旧的 GitHub 支正是这一票要拆掉的重影）。
  // 写操作前 UI 已二次确认（用户点击即同意），不走 approval 服务（RESEARCH-NOTES §3 结论）。
  async function handleClaim(args: any): Promise<any> {
    const n: any = args && args.number
    // #1003 空目录闸：写操作不冒充（会写到错的仓库），直接拒绝等就绪。
    const _rawClaimCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawClaimCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await normCwd(_rawClaimCwd)
    if (!n) return { ok: false, error: '缺少参数 number（ticket 号）' }
    // 写会话没接上时如实回环境失败（调用点按 kind:'env' 提示），不抛、也不退回直调 gh 的老路。
    if (typeof openSession !== 'function') {
      return { ok: false, error: { kind: 'env', error: '写会话没接上（宿主没有注入 openSession），这次认领没有发出。' } }
    }
    let opened: any = null
    try { opened = await openSession(cwd, { write: true }) } catch (eOpen: any) { opened = null }
    if (!opened || !opened.ok) {
      const why: string = (opened && opened.reason) ? String(opened.reason) : 'unknown'
      return { ok: false, error: { kind: 'env', error: '写会话没开起来（' + why + '），这次认领没有发出。' } }
    }
    // 仓库身份以会话交过来的为准。GitHub 房必须给出 owner/repo：认领要落到具体那张票上，认不出仓库就不发写。
    const repoRef: any = opened.repoRef
    if (!repoRef || typeof repoRef !== 'object' || !repoRef.backend) {
      return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（写会话没有给出仓库身份）' } }
    }
    if (repoRef.backend === 'github' && String(repoRef.refId || '').indexOf('/') < 0) {
      return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（写会话没有给出仓库身份）' } }
    }
    // 票号按后端取：GitHub 的票号就是纯数字（旧实现两位补零只服务于本地 Markdown 房的文件名约定，
    //   对 GitHub 传 '07' 会查不到票）；其它后端沿用两位补零，不要因为这次统一口径把它们改坏。
    const key: string = repoRef.backend === 'github' ? String(n) : String(n).padStart(2, '0')
    // 面板展示用的名字默认 'me'（旧口径）；真正发给房间的认领目标另算一份：
    //   gh 认 @me 这个写法，直接传 'me' 会被当成一个不存在的登录名；别的后端沿用 'me'。
    let assignedTo: string = 'me'
    let claimAs: string = repoRef.backend === 'github' ? '@me' : 'me'
    let r: any = null
    try {
      r = await opened.call(async function (session: any, c: any) {
        // ① 先问会话「我是谁」；拿不到就按上面那份兜底（与旧实现同档，认领本身不因为拿不到名字而失败）。
        try {
          const ur: any = await session.getCurrentUser(repoRef, c)
          if (ur && ur.ok && ur.data && ur.data.login) { assignedTo = String(ur.data.login); claimAs = assignedTo }
        } catch (e1: any) { /* 取名字失败不改认领 */ }
        // ② 先读现有指派人再并集：房间的 setAssignees 是「最终集合 = 传入数组」的整批覆盖语义
        //   （src/tracker/rooms/github/write/issues.ts:395 会把不在名单里的人逐条 --remove-assignee），
        //   照旧实现只传 [自己] 会把别人从票上撤掉；读失败就只传自己，等价于旧的「只加不减」。
        const next: string[] = [claimAs]
        try {
          const cur: any = await session.get(repoRef, key, {}, c)
          if (cur && cur.ok && cur.data && Array.isArray(cur.data.assignees)) {
            const seen: any = {}
            seen[String(claimAs).toLowerCase()] = true
            for (let i: number = 0; i < cur.data.assignees.length; i++) {
              const a: any = cur.data.assignees[i]
              const l: string = (a && a.login) ? String(a.login) : ''
              if (!l || seen[l.toLowerCase()]) continue
              seen[l.toLowerCase()] = true
              next.push(l)
            }
          }
        } catch (e2: any) { /* 读失败时只传自己，保持旧的并集下限 */ }
        return await session.setAssignees(repoRef, key, next, {}, c)
      })
    } catch (e: any) {
      const msg: string = String((e && e.message) || e).slice(0, 200)
      return { ok: false, error: { kind: 'unknown', error: '写会话调用失败：' + msg } }
    }
    if (!r || !r.ok) {
      const errObj: any = (r && r.error) ? r.error : { kind: 'unknown', error: '认领失败（写会话没有给出原因）' }
      return { ok: false, error: errObj }
    }
    // 认领成功 → 只清自己根（#696），让面板下次快照拉到新的指派人。
    setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
    // 链接只在 GitHub 上给（旧口径）；别的后端沿用空串。
    const url: string = repoRef.backend === 'github' ? ('https://github.com/' + String(repoRef.refId) + '/issues/' + String(n)) : ''
    return { ok: true, number: n, assignedTo: assignedTo, url: url }
  }

  function hash8(s: any): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e: any) { return '00000000' } }
  // 尾参 err 标成可选：原 .js 里成功路径只传四个实参（见 loggedPhone 成功分支），少传在运行时就是 undefined，函数体开头用 `err !== undefined && err !== null` 守住；标成必选 tsc 会报 2554，改成 `?` 不产生任何运行时代码。
  function phoneLog(method: any, kind: any, t0: any, res: any, err?: any): void { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && (res.error || res.errorKind)) || 'handoff-not-ok')) }) } catch (eL: any) {} }
  function loggedPhone(method: any, kind: any, fn: any): any { return async function (): Promise<any> { const t0: number = Date.now(); try { const r: any = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e: any) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { handleHandoffLatest: loggedPhone('wf.handoffLatest', 'handoff', handleHandoffLatest), handleHandoffResolve: loggedPhone('wf.handoffResolve', 'handoff', handleHandoffResolve), handleClaim: handleClaim }
}
