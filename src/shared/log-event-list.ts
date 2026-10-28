/**
 * src/shared/log-event-list.ts —— 日志常驻事件清单（#960 收尾接线）。
 *
 * 为什么要有这个文件：日志包 dsh-log 3.x 的「常驻」事件要由插件建日志库时自己申报，申报在
 * eventList 参数里；插件过去从没申报，于是附录写着常驻、但不在日志包内置 43 条里的事件，
 * 调试开关关着时就不会落盘（#1101 新增的 gh.lane.wait 也在其中）。这个文件就是那份申报清单的
 * 唯一真源，宿主与客户端两半都从这里取，免得两处各写一份、日后改一处漏一处。
 *
 * 谁在用：
 *   - 宿主：src/host/logFromPackage.ts 建库时把 LOG_EVENT_LIST 当成 eventList 递进去；
 *   - 客户端：scripts/derive-log-from-package.mts 把它序列化进 scripts/generated/logKernel.derived.js
 *     的建日志器那一段（客户端那半不能运行时 import 本仓源码，所以只有这一次打包期注入）。
 *
 * 收哪些事件（口径）：
 *   - 只收「信息级 + 附录 1.4 表标成常驻」的事件。错误与告警级本来就永远落盘（日志包按级别兜底），
 *     申报不申报都一样，所以 read.degraded、preflight.gate、locale.registration.fail、gh.auth.env
 *     四条告警级常驻事件故意不写在这里；2026-10-29 #1627 新增的 quota.incident 也是告警级，同样不登记（附录 1.4 表里有它一行）。
 *   - 字段表从 tests/verify-log-fields.ts 的 ALLOWED 抄来：那份表是埋点字段的尺子，两边必须一致；
 *     日志包运行期只原样透传字段、不按这份表裁剪，所以这里写错的后果是自查对不上，不是丢日志。
 *   - gh.lane.wait 带 guard：附录 1.4 表里写明的守卫「排队放行时先看等了多久：三秒以上才记；
 *     同一只桶五分钟最多一行」，搬到这里是为了清单自解释。
 *
 * 什么约定不能改：
 *   - pluginId 与建库配置里的 pluginId 都是 wf，改了日志包当场拒收；
 *   - version 现在只认 1；
 *   - kind 只能是 resident / ondemand / selfmon，这里全是 resident；
 *   - 新增一条之前先确认它已经在 research/489-appendix.md 1.4 表里登记为常驻信息级事件，
 *     并按附录的编号顺序想清楚它属于哪类（清单本身不写编号，真源仍是附录）。
 *
 * 事件清单格式来自日志包的 event-list 模板：level / kind / fields 必填，codes / rules / guard 可选。
 */

/** 日志包认的事件级别与归类（只写本文件用到的两个，写窄一点，避免误用）。 */
interface ResidentInfoEvent {
  level: 'info'
  kind: 'resident'
  fields: string[]
  guard?: string
}

/**
 * 要申报的常驻信息级事件：事件名 → 级别、归类与允许字段。
 *
 * 为什么用普通对象而不是 as const：宿主那边的建库配置收的是 Record<string, unknown>，
 * 普通对象可以直接递；客户端那半是在构建期 JSON.stringify 之后注入，同样不需要字面量类型。
 */
export const LOG_EVENT_LIST: {
  version: 1
  pluginId: string
  events: Record<string, ResidentInfoEvent>
} = {
  version: 1,
  pluginId: 'wf',
  events: {
    // gh 写的三类（edge.write / issue.write / labelDefs.write）与仓库初始化：都只记结果与耗时。
    'edge.write': { level: 'info', kind: 'resident', fields: ['kind', 'route', 'ok', 'added', 'removed', 'kept', 'reason', 'latencyMs'] },
    'issue.write': { level: 'info', kind: 'resident', fields: ['kind', 'route', 'ok', 'written', 'failed', 'reason', 'latencyMs'] },
    'labelDefs.write': { level: 'info', kind: 'resident', fields: ['planned', 'written', 'failed', 'ok', 'reason', 'latencyMs'] },
    'repo.init': { level: 'info', kind: 'resident', fields: ['route', 'steps', 'ok', 'reason', 'latencyMs'] },
    // workRoute 的读写：记会话与工作区短指纹、动作与条数，不含正文。
    'workRoute.write': { level: 'info', kind: 'resident', fields: ['sidHash', 'rootHash', 'kind', 'ok', 'action', 'count', 'why', 'detail'] },
    'workRoute.read': { level: 'info', kind: 'resident', fields: ['sidHash', 'rootHash', 'ok', 'why', 'detail'] },
    // 界面入口与引导横幅：一次打开记一条，不会被高频路径刷爆。
    'entry.open': { level: 'info', kind: 'resident', fields: ['from', 'cards'] },
    'entry.pick': { level: 'info', kind: 'resident', fields: ['from', 'card', 'ok', 'textLen'] },
    // #1363 增补：横幅为什么是这一条（或为什么一条都没有）——reason/decideStep 回答判定原因，
    //   backendId/steps 是当时的后端与快照行数，wsHash/sidHash 让它与 chain.flow 那两行按工作区、会话对上。
    'guide.banner': { level: 'info', kind: 'resident', fields: ['step', 'banner', 'tone', 'outcome', 'ageMs', 'reason', 'decideStep', 'backendId', 'steps', 'wsHash', 'sidHash'] },
    // #1363 新增：检查链的请求与回包各一行（谁发起、带没带人的动作、结果写没写进会话、回的是不是旧快照）。
    //   这是「界面为什么还是旧状态」这一问的唯一常驻落点，两幕故障的取证都靠它。
    'chain.flow': { level: 'info', kind: 'resident', fields: ['side', 'outcome', 'reason', 'bypass', 'backendId', 'lang', 'steps', 'done', 'ageMs', 'wsHash', 'sidHash'] },
    // #1220 新增：正在看时那条 5 秒探测节拍排上没排上（reason=no-timer 即「宿主没给 interval 出口」）。
    //   从前这是按需级，调试开关关着就看不见；#891 的自动重算从没跑过，真机取证就卡在这一行上。
    'probe.loop': { level: 'info', kind: 'resident', fields: ['reason', 'intervalMs', 'visible', 'timerOk'] },
    // 出站 gh 排队太久（#1101）：等多久、桶里在飞与排队多少；守卫文字取自附录 1.4 表。
    'gh.lane.wait': {
      level: 'info',
      kind: 'resident',
      fields: ['bucket', 'waitedMs', 'inflight', 'max', 'queued'],
      guard: '排队放行时先看等了多久：三秒以上才记；同一只桶五分钟最多一行，风暴期间也不逐条刷',
    },
    // #1580：每次「在新会话打开」记一行决策链——入口、cwd 来源、工作区解析结果（查到的/新建的/没有）、
    //   复用还是新建、草稿写进哪条会话、最终成败。下次再出现「新会话没选中工作区」时，
    //   按这一行就能分出卡在查找 / 复用 / 创建哪一层，不用再到现场猜。
    'newsession.decide': {
      level: 'info',
      kind: 'resident',
      fields: ['entry', 'textLen', 'curSidHash', 'cwdHash', 'cwdSource', 'wsResolved', 'wsSource', 'wsItems', 'branch', 'reuseFrom', 'reuseSidHash', 'allowReuse', 'createOpts', 'reuseSkip', 'sidHash', 'outcome', 'errorHash'],
    },
    // 2026-10-29 #1627：配额与限流诊断的五问要在调试开关关着时也能回答（真配额还是二级限流、谁在抢、
    //   靠什么恢复、损失多少、重试放大几倍），所以下面七条都定信息级常驻。每一行都是低频结论：
    //   窗口每分钟至多一行、事故与恢复按次、同步按服务端读数、压力按滚动阈值，不是心跳。
    //   quota.incident 是告警级（始终落盘），按本文件口径不登记，只在附录 1.4 表留一行。
    // 每分钟一行的窗口汇总：这一分钟花了多少、失败几次、在飞与排队峰值、软超与降载几次、
    //   服务端读数多新，以及其中命名索引那一路占了多少 —— 回答「损失多少」与「谁在抢」。
    'quota.window': {
      level: 'info',
      kind: 'resident',
      fields: ['requests', 'points', 'estPoints', 'restRequests', 'aiPoints', 'pluginPoints', 'userPoints', 'failCount', 'limitCount', 'inflightPeak', 'inflightMax', 'queuedPeak', 'oldestWaitMs', 'allowUser', 'allowAi', 'softOver', 'allowBg', 'deferCount', 'gqlRemain', 'resetSec', 'syncAgeMs', 'tier', 'namingPages', 'namingPoints', 'suppressed'],
      guard: '每分钟最多一行；只有真发生了事的分钟才写（跨分钟收尾时写上一分钟，空分钟零落行）',
    },
    // 事故当下的逐笔明细：事故期间每次限流失败或慢操作一行，回答「真配额还是二级限流、
    //   重试放大几倍」；每次事故最多 40 行，超限只在窗口行的 suppressed 上加一。
    'quota.detail': {
      level: 'info',
      kind: 'resident',
      fields: ['via', 'opId', 'account', 'points', 'waitedMs', 'latencyMs', 'kind'],
    },
    // 每次恢复一行：事故持续多久、期间几次事故、被压掉几行、窗口内失败几次、失败操作几次、
    //   在飞峰值与恢复后第一个成功操作来自哪一路，回答「靠什么恢复」。
    'quota.recover': {
      level: 'info',
      kind: 'resident',
      fields: ['durationMs', 'incidents', 'suppressed', 'failsInWindow', 'opsFailed', 'maxInflightDuring', 'firstOkVia', 'resetPast'],
    },
    // 每次读到服务端额度一行：触发来源、服务端上限与剩余、重置还有多久、本地记账花掉多少、
    //   与上一次次读数比漂移多少、是不是见到重置前进、这份读数多旧 —— 回答「真配额还是二级限流」。
    'quota.sync': {
      level: 'info',
      kind: 'resident',
      fields: ['trigger', 'serverLimit', 'serverRemaining', 'resetSec', 'allowance', 'spentSinceSync', 'driftPoints', 'resetSeen', 'ageMs'],
    },
    // 压力档：滚动一小时至少 4000 点、或单分钟至少 1000 点时每分钟至多一行，
    //   回答「谁在抢、还能撑多久」；阈值没到一行都不写，不制造心跳。
    'quota.pressure': {
      level: 'info',
      kind: 'resident',
      fields: ['pointsLastMin', 'pointsLastHour', 'projectedHour', 'capacity', 'inflightPeak', 'top'],
    },
    // 逐笔操作只在坏 / 慢 / 贵时写一行（失败、耗时至少 10 秒、至少 3 点、至少 3 次请求），
    //   其余落调试档；这是回答「谁在抢」的逐笔证据，正常操作不占常驻额度。
    'quota.op': {
      level: 'info',
      kind: 'resident',
      fields: ['op', 'opId', 'caller', 'account', 'bucket', 'ok', 'requests', 'points', 'pointSource', 'latencyMs', 'remaining', 'tier', 'backendId'],
    },
    // 工具回执同样只在坏 / 慢 / 贵时写一行（失败、耗时至少 3 秒、至少 3 点），
    //   回答「AI 工具这一趟花了多少、重试放大几倍」；正常回执落调试档。
    'tool.receipt': {
      level: 'info',
      kind: 'resident',
      fields: ['tool', 'opId', 'status', 'estRequests', 'estPoints', 'requests', 'points', 'latencyMs', 'remaining', 'tier', 'backendId', 'note'],
    },
  },
}
