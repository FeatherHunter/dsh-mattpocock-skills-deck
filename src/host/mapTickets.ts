/**
 * src/host/mapTickets.ts —— 宿主电话 wf.mapTickets（来源：src/host/mapTickets.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：按父票翻页拉全子票、解析进度、组装行数据与分层统计；只调后端契约 listSubIssues，不做能力表。
 *
 * 三条不能改的约定（改之前先看原 mapTickets.js 头注释与调用点 index.ts）：
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

// src/host/mapTickets.js —— 宿主电话 wf.mapTickets：按需取一张地图的全部子票（#691 阶段 3）。
//
// 为什么会有这条电话：快照首屏不再装**已关闭地图**的子票（见 tracker/snapshot.js 的 assembleSnapshot），
// 用户点开一张地图时由这条电话现去后端把那张地图的子票一次拉全（开放与已关闭都在）。开放地图点开时
// 也走同一条路 —— 首屏那份行数据可能被列表的 500 条上限截断，而这条路是按「父票 → 子票」的原生关系
// 翻页拉到底，能保证「打开一张地图看到的就是它的全部子票」。
//
// 这条电话在宿主侧还做三件事（都是界面拿不到的信息）：
//   1. 调后端的 listSubIssues（契约操作，`Tracker.listSubIssues`；没实现它的后端回 unsupported，
//      由界面退回快照里那份行数据 —— 不做能力表，这是 G5 红线）；
//   2. 把子票正文里的「## 进度：N%」解析成数字带上，正文本身剥掉 —— 正文不随行数据发给界面；
//   3. 补上客户端要的两样：`number`（后端只给 key）与**大写的** `state`（客户端多处按 'CLOSED' 比较）。
//
// 接线的纪律：本文件由 index.js 动态 import 加载（D7：新文件不静态 import）；依赖全部由 index 显式传入；
// #1584 起只额外静态引用 tracker 层的共享补齐入口（同一把工作区→仓库身份的尺子），不引其它新文件。
// 日志沿用既有的 host.call / host.call.fail 两个事件（不新增事件名）。
import { resolveRepoRefForCwd } from '../tracker/session/repo-ref.js'
export function createMapTickets(deps?: any): any {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, DEFAULT_CWD, logCtx, groupTickets, getMapBody, detectionExec, openSession } = deps

  function hash8(s?: any) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  // #1052 续：这一趟操作的编号，用来把宿主这一层的日志行与房间那一层的日志行串起来。
  // 形状 `<base36 毫秒时间戳>-<base36 计数器>`（例如 mg8xk1p-3）。为什么两半都要：
  //   前半是这一趟开始的那一刻，能把编号还原成时间、同一趟里各行的先后也就有了个绝对参照；
  //   后半是同一个进程内的递增序号，同一毫秒里起两趟（比如面板同时拉两张地图的子票）也不会重号。
  // 为什么不写随机数：随机会让「同一个编号出现两次」变成需要验证的事；递增序号在同一进程里必然不重。
  // 为什么不带目录或电话名：编号只负责串起来，它是什么操作由同一批行里的 method 交代，重复记一份只会让编号变长。
  let opSeq = 0
  function newOpId() { opSeq += 1; try { return Date.now().toString(36) + '-' + opSeq.toString(36) } catch (e) { return '' } }
  // 电话体记一行日志（与仓库里其它电话同一条纪律：沿用既有事件，电话名写在 method，kind 是归一类别）。
  // #1052 续：这一行同时记下这一趟操作的编号（opId）与工作区短散列（cwdHash）。为什么要记 cwdHash：
  //   房间那一层的 gh.exec 早就记着它，宿主这一层从前不记，于是同一个工作区在两层里的键对不上；
  //   补上之后「这一趟是给哪个目录干的」在宿主这一层也读得出来，两层靠 opId 串、靠 cwdHash 认地方。
  //   两者都只记散列与编号，路径原文一个字都不记。
  function phoneLog(method?: any, kind?: any, t0?: any, res?: any, err?: any) { try {
    // 编号与目录从这一趟的返回值里取（`handleMapTickets` 把 opId 与 cwd 一起带回来）。
    // 为什么不让出口那层自己再生成一个：那样宿主侧会有一个编号、房间侧有另一个，两层就对不上了；
    // 编号必须与随 ctx2 进房的那个是同一个，所以只有生成它的那层说得出来，这里只能取。
    const logged = (res && res.logged) ? res.logged : null
    const opId = String((logged && logged.opId) || '')
    const cwdHash = logged && logged.cwd ? hash8(logged.cwd) : hash8('')
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)), opId: opId, cwdHash: cwdHash }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind, opId: opId, cwdHash: cwdHash }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && ((res.error && res.error.message) || res.error)) || 'map-tickets-not-ok')), opId: opId, cwdHash: cwdHash }) } catch (eL) {} }

  const unsupported = function(message?: any, logged?: any) { return { ok: false, error: { kind: 'unsupported', message: message }, logged: logged } }

  // 房内埋点：与 src/host/issuePage.js 给 listPage 的那一份同一形状（拿不到 logCtx 时静默/只放行告警）。
  // 为什么必须有这两个：房间那层的日志全是「没有 logEvent 就跳过」，不挂上去，房内一行都不落。
  function backendLogEvent(level?: any, event?: any, fields?: any) {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e) {}
  }
  function backendLogEnabled(level?: any) {
    try { return logCtx ? logCtx.isEnabled(level) : (level === 'error' || level === 'warn') } catch (e) { return level === 'error' || level === 'warn' }
  }

  /**
   * 把后端回来的一行子票收拾成界面直接能画的样子。
   * 口径与快照那条路（sessionSnapshot.js 的组装）保持一致：编号从 key 补、状态转大写、
   * 阻塞引用压成键字符串、认领人从指派人里取第一个；进度从正文解析出来之后，正文与评论都剥掉。
   */
  function prepareRow(raw?: any, parseProgress?: any) {
    const t = Object.assign({}, raw)
    if (t.key != null && t.number == null) { const nn = parseInt(t.key, 10); if (!isNaN(nn)) t.number = nn }
    if (t.key != null) t.key = String(t.key)
    t.state = String(t.state || '').toUpperCase()
    if (Array.isArray(t.blockedBy)) {
      t.blockedBy = t.blockedBy.map(function(ref?: any) {
        if (typeof ref === 'number' || typeof ref === 'string') return ref
        if (ref && typeof ref === 'object' && ref.key != null) return String(ref.key)
        return ref
      })
    } else t.blockedBy = []
    if (t.claimedBy == null) {
      const owners = t.assignees
      t.claimedBy = (Array.isArray(owners) && owners.length) ? ((owners[0] && owners[0].login) || '') : ''
    }
    // 「有读者没来源」的那一个字段（#687 的结论）：界面画进度条要 t.progress，而新路今天一条都没有值。
    // 这里从正文解析，解析不出给 null（= 未表达），界面对 null 画「—」而不是假装 0%。
    const body = typeof t.body === 'string' ? t.body : ''
    t.progress = (typeof parseProgress === 'function') ? parseProgress(body) : null
    delete t.body
    delete t.comments
    return t
  }

  async function handleMapTickets(args?: any) {
    // #1052 续：这一趟操作的编号，一次调用生成一个，越早越好 —— 下面每条返回路径都要把它带回去，
    // 迟生成就会漏掉「还没认出目录就失败」这类路。为什么要在这里生成、而不是在电话外面生成：
    //   编号要串的是「这一趟操作」，一趟就是这条电话的一次调用；放在出口那层也能拿到，
    //   但那条出口下面还挂着别的电话，编号的含义就会随电话变；放在这条电话自己的入口最准。
    //   房间那一层拿不到宿主侧的任何标识，所以它只能靠上下文递进去：这一格随 ctx2 一起进房，
    //   房间发 gh.exec 时原样取出来记，两层因此能靠同一个键对上（宿主侧由 phoneLog 记同一个编号）。
    const opId = newOpId()
    // 编号与目录都随返回值带回去给 phoneLog —— 它要记的是同一个编号，不能自己另生成一个。
    const logged = { opId: opId, cwd: '' }
    // #1003 空目录闸：不拿进程目录冒充去取子票，诚实失败等就绪。
    const _rawMapCwd = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawMapCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。', logged: logged }
    const cwd = await canonicalKey(_rawMapCwd)
    logged.cwd = cwd
    const key = String((args && (args.key != null ? args.key : args.number)) || '').trim()
    if (!key) return { ok: false, error: { kind: 'parse', message: '缺少地图编号（key）' }, logged: logged }
    const sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
    // #1636：只放开门卫对 GitHub 的排除，其余拦法原样不动。
    // isComposerSelection 是快照、刷新、探针、评论四条路共用的通道选择，今天对 backendId=github 永远返回假；
    // 但首屏快照本来就不装已关闭容器的已关闭子票，而 GitHub 有按需取子票的读路径，所以这里给 github 单独开口。
    // 有没有取子票的能力仍由后端自己回答：注册表里没这条读路径就回不支持（下一句），后端自己说不支持也如实透出。
    if ((!sel || sel.backendId !== 'github') && !isComposerSelection(sel)) return unsupported('这个后端不能按需取一张地图的子票（在它自己的网页上看全部）', logged)
    const reg = await getTrackerRegistry()
    const backendId = sel.backendId
    const tracker = reg.get(backendId)
    if (!tracker || typeof tracker.listSubIssues !== 'function') return unsupported('这个后端不支持按需取一张地图的子票', logged)
    let repoRef: any = null
    try { repoRef = reg.describe({ cwd }, backendId) } catch (e) { repoRef = null }
    // #1584 F2：空 refId 的壳不算身份（GitHub / GitLab 只给目录时 describe 只回显示名）；
    // 给不出就问会话（身份真源），拿不到再走原来的兜底。
    if (!repoRef || !repoRef.refId) {
      const identified = await resolveRepoRefForCwd({ cwd, backendId, describe: reg.describe, openSession })
      if (identified) repoRef = identified
    }
    if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
    // effort 维度：地图的身份是 (effortId, key)，同号地图在不同工作单元里是两张 —— 调用方给就带上。
    if (args && args.effortId !== undefined && args.effortId !== null) repoRef = Object.assign({}, repoRef, { effortId: String(args.effortId) })
    // 房间那一层拿不到宿主侧的任何标识，所以编号只能靠上下文递进去：这一格随 ctx2 一起进房，
    // 房间发 gh.exec / read.degraded / preflight.gate 时原样取出来记，两层因此靠同一个键对上。
    // #1052 续补的一处真缺口：这一格 ctx2 从前只带 cwd / platform / fs / exec，**没带 logEvent 与 isEnabled**，
    // 而房间那层的 ghClient 与 read-log 都是「拿不到 logEvent 就静默跳过」——于是 wf.mapTickets 这条电话
    // 进房之后一条房内日志都落不了（gh.exec、read.degraded、preflight.gate 全静默）。实测：宿主那层
    // host.call 记下了 opId，房间那层 0 行。两个钩子的形状与 src/host/issuePage.js 给 listPage 的那一份一致
    // （没有 logCtx 时：logEvent 静默、isEnabled 只放行错误与告警）。
    const ctx2 = { cwd, opId: opId, platform: await getPlatform(), fs: ctx.get('fs'), exec: function(c?: any, a?: any, o?: any) { return detectionExec(c, a, o, 'map-tickets') }, logEvent: backendLogEvent, isEnabled: backendLogEnabled }
    const res = await tracker.listSubIssues(repoRef, key, {}, ctx2)
    if (!res || res.ok !== true) {
      const err = (res && res.error) || { kind: 'network', message: '子票没取回来' }
      // 「这个后端不做这件事」要给人一句能读的话：注册表补的桩与后端自己回的那条都是内部英文
      // （`backend X does not implement op Y`），直接端到界面上没人看得懂在说什么。
      if (err.kind === 'unsupported') return unsupported('这个后端不支持按需取一张地图的子票', logged)
      return { ok: false, error: err, logged: logged }
    }
    const d = res.data || {}
    const mb = (typeof getMapBody === 'function') ? await getMapBody() : null
    const parseProgress = mb && typeof mb.parseProgress === 'function' ? mb.parseProgress : null
    const items = (Array.isArray(d.items) ? d.items : []).map(function(raw?: any) { return prepareRow(raw, parseProgress) })
    // 分层与统计由宿主算好一起带回去（与快照里 m.stats 同一套纯函数）；界面不自己算层级。
    let stats = { total: items.length, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }
    try { if (typeof groupTickets === 'function') stats = groupTickets(items) } catch (e) {}
    return {
      ok: true,
      key: key,
      items: items,
      stats: stats,
      total: (typeof d.total === 'number') ? d.total : items.length, // 后端说的总数（连接上的 totalCount）
      fetched: (typeof d.fetched === 'number') ? d.fetched : items.length, // 这次真的拉回来的张数
      capped: d.capped === true, // 撞到 1000 张硬上限
      missing: (typeof d.missing === 'number' && d.missing > 0) ? d.missing : 0, // 与总数对不上的差额（0 = 对上了）
      // logged 只给 phoneLog 用，界面不读它：编号与目录都不该往界面上跑。
      logged: logged,
    }
  }

  // 电话体记一行日志（与仓库里其它电话同一条纪律：沿用既有事件，电话名写在 method，kind 是归一类别）。
  const handleMapTicketsLogged = async function(args?: any) {
    const t0 = Date.now()
    try { const r = await handleMapTickets(args); phoneLog('wf.mapTickets', 'map-tickets', t0, r); return r } catch (e) { phoneLog('wf.mapTickets', 'map-tickets', t0, null, e); throw e }
  }

  return { handleMapTickets: handleMapTicketsLogged }
}
