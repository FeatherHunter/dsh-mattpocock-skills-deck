// verify-log-fields.js —— #494 第三件事：日志门禁之字段白名单（#489 附录第 4 节断言一）。
// 用法：在插件根目录执行 node tests/verify-log-fields.js，可独立运行。
// 断言文字：扫描全部埋点调用，每个事件只含第 1 节允许字段；出现工作区原始路径、
// 仓库地址原文、令牌原文、模板正文、快照全文即红。
// 做法：从宿主与客户端源码里找出全部日志调用，逐个事件收拢实际字段键，
// 与下面这张允许表逐项比对；未知事件名、未知字段键都算失败并打印清单。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志字段白名单门禁（#494/#498/#548/#618/#652/#655/#690/#709/#724：84 事件逐个只记已知安全字段，未知字段默认不记）')

// 允许表：事件名对应它能记的全部字段键，之外的键一律不许出现。
// 键名取自实现原文，语义与 #489 附录 1.4、1.5 节对照表一致。
// 其中 error.normalize 的 httpCode 只在归一出状态码时才带，其余两键常带。
const ALLOWED = {
  'snapshot.request': ['cwdHash', 'backend', 'force'],
  'snapshot.cache.hit': ['kind', 'ageMs'],
  'snapshot.cache.miss': ['reason'],
  'repo.resolve.tier': ['tier', 'ok', 'latencyMs'],
  'gh.exec': ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode'],
  'gh.timeout': ['argv0', 'timeoutMs'],
  'gh.resolve.fail': ['hasDSH_GH_PATH', 'errorHash'],
  'graphql.fallback': ['scope', 'reason'],
  'issues.fallback': ['from', 'to', 'reason'],
  'snapshot.built': ['maps', 'issues', 'labels', 'fallback', 'latencyMs', 'open', 'closed', 'partial'],
  'probe.eval': ['repoKeyHash', 'since', 'count', 'changed'],
  'panelSync.eval': ['repoKeyHash', 'baseline', 'dirty', 'failures'],
  'panelSync.dirty': ['cwdHash', 'ageMs'],
  'registry.select': ['cwdHash', 'backendId', 'source', 'latencyMs', 'caller'],
  'registry.stub': ['op', 'backendId'],
  'detection.detect': ['cwdHash', 'explicit', 'matches', 'pending', 'selection'],
  'workspaceStore.hit': ['keyHash', 'fresh', 'ttlMs'],
  // 2026-09-25 登记订正（#709 · T5）：这一条的落点已经变成「被退避挡下，直接把上一份快照回给界面」，
  //   实现记的是 keyHash、lang、deferred、reason、waitMs 五个键；从前的 ageMs 早已不再发射，
  //   按「允许字段就是能记的全部字段」的口径把它从白名单里去掉（落点：src/host/detectChain.js）。
  'chain.cache.hit': ['keyHash', 'lang', 'deferred', 'reason', 'waitMs'],
  'chain.predicate': ['id', 'status', 'latencyMs'],
  'skill.probe': ['name', 'level', 'via'],
  'skill.pending.cap': ['name', 'attempts', 'max'],
  'workspaceKey.canonical': ['rawHash', 'normalizedHash', 'fallback'],
  'platform.resolve': ['name', 'ok', 'latencyMs'],
  'naming.sweep': ['trigger', 'count'],
  'host.call': ['method', 'latencyMs', 'ok', 'kind', 'pluginId'],
  'host.call.fail': ['method', 'kind', 'errorHash', 'pluginId', 'errorKind'],
  'snapshot.hydrate': ['cwdHash', 'fresh', 'latencyMs', 'source', 'winnerVersion', 'loserVersion', 'outcome'],
  'snapshot.fanout': ['sessionIdHash', 'stale', 'force', 'count'],
  'dedup.hit': ['scope', 'keyHash'],
  'backend.switch': ['from', 'to', 'cwdHash'],
  'naming.guard': ['sidHash', 'outcome', 'hintHash'],
  'naming.lock': ['sidHash', 'reason'],
  // 2026-09-21：settings.save 随设置页的「打开位置」一项退役（那是它唯一的落点）；
  //   panel.open 去掉 mode 字段（面板只有 DSH 原生右侧边栏一条路，形态不再有第二种取值）。
  'panel.open': ['hasCache', 'snapFresh', 'keyHash', 'snapVersion', 'backendId'],
  'statusbar.hydrate': ['cwdSource'],
  'statusbar.fallback': ['reason'],
  'dock.rehydrate': ['sidHash', 'cwdChanged', 'polluted'],
  'storage.fail': ['key', 'op'],
  'chain.derive.error': ['stepId', 'errorHash'],
  'fallback.chain': ['in', 'out', 'latencyMs'],
  'error.normalize': ['rawKind', 'mappedKind', 'httpCode'],
  'timer.schedule': ['name', 'intervalMs'],
  'chain.cache.miss': ['keyHash', 'lang', 'reason'],
  'workspaceStore.miss': ['keyHash', 'reason'],
  'client.snapshot.hit': ['keyHash', 'ageMs', 'kind'],
  'client.snapshot.miss': ['keyHash', 'reason'],
  'detail.cache.hit': ['numHash', 'ageMs'],
  // #606 新增两条按需事件（附录 1.5 节）：exec.run 记经 ctx.exec 起的外部命令，panel.render 记面板打开各阶段耗时。
  'exec.run': ['argv0', 'cwdHash', 'latencyMs', 'exitCode', 'via'],
  // mode 仍在白名单里，但只剩更新面板那条线在用（views/useUpdatePanel.js 记 mode:'update'，
  //   用来把它自己的阶段推进与「打开面板那一路的阶段」分开）；面板打开那一路（kernel/router.js 的
  //   logPanelStage）自 2026-09-21 起不再记 mode —— 面板只有一条路之后它没有第二种取值。
  'panel.render': ['stage', 'ms', 'mode'],
  'host.start': ['pid', 'startedAt', 'dir'],
  'update.install.exec': ['route', 'ok', 'exitCode', 'durationMs', 'pluginId'],
  'privacy.scrub': ['field', 'rule', 'hit'],
  // #618 新增两条（附录 1.4 / 1.5 节）：本地配色文件的写入记常驻、读取记按需。
  'labelColors.write': ['cwdHash', 'count', 'ok', 'reason', 'via'],
  'labelColors.read': ['cwdHash', 'present', 'count', 'ok', 'reason'],
  // #635 新增一条按需事件（附录 1.5 节）：保存成功后写进面板那份快照的颜色记录，只记工作区键散列、枚举与条数。
  'labelColors.panelPatch': ['cwdHash', 'kind', 'count'],
  // #652 新增一条按需事件（附录 1.5 节）：工作区根判定与它那层 30 秒缓存，只记两个散列与两个枚举。
  'workspaceRoot.resolve': ['cwdHash', 'rootHash', 'source', 'cache'],
  // #655 新增一条按需事件（附录 1.5 节）：初始化这段文案「这次该不该注入、按哪种布局注入」这个决定的结果，只记三个枚举。
  'inject.decision': ['prompt', 'kind', 'layout'],
  // #663 新增一条常驻事件（附录 1.4 节）：首开引导链那颗横幅按钮点下去给出去的是哪一类东西，只记两个短枚举（哪一步、哪一类）。
  'guide.inject': ['step', 'outcome'],
  // #685 新增一条常驻事件（附录 1.3 节）：KPI 那一行右边缘那颗「体检」按钮点下去，开一个新会话并把当前后端的体检提示词
  //   带过去 —— 照 #662 为横幅注入定的先例（用户点一下、插件往会话里写字），只记两个短枚举：哪个后端、注入成功还是失败。
  'healthCheck.inject': ['backend', 'outcome'],
  // 2026-09-21 新增一条按需事件（附录 1.5 节）：链快照回包时晚到的旧结果被丢弃（这一段里已经又发过新请求），只记一个散列。
  'chain.stale.drop': ['keyHash'],
  // 2026-09-21 新增一条按需事件（附录 1.5 节）：面板快照回包时这一次已经不算数（换过后端，或这个工作区上又发过更新的一次），只记一个散列。
  'snapshot.stale.drop': ['keyHash'],
  // 2026-09-27 新增一条按需事件（#727，附录 1.5 节 #89）：那次快照已经等超时了、可它后来还是回到了
  //   （客户端那条 30 秒死线只结束「这一次等待」，不判「这份结果作废」），这条轨迹记的是「这一小块补装上了没有」。
  //   两个键都好查也不会泄露东西：keyHash 是请求发出时那条目录的短散列，installed 是布尔（真的装上了才算）。
  'snapshot.late.install': ['keyHash', 'installed'],
  // 2026-09-22 新增五条（#683 F1 · 宿主侧那份「用户选的后端按工作区记着」的记忆）：读它命中/未命中按需记；
  //   文件坏与写失败是「出事了」的两档，告警级始终落盘；淘汰与「被更旧的顶回」按需记。都只记散列、枚举与数字。
  'choiceStore.read': ['keyHash', 'outcome'],
  'choiceStore.file.bad': ['reason'],
  'choiceStore.write.fail': ['keyHash', 'reason'],
  'choiceStore.hint.reject': ['keyHash', 'baseRev', 'rev'],
  'choiceStore.evict': ['count', 'max'],
  // 2026-09-22 新增一条常驻事件（#690，附录 1.4 节）：界面向后端要一页历史票（展开折叠行 / 筛到已关闭 / 滚到底）。
  //   只记这一页要的是哪一档状态、筛了几个标签、取回几行、后端说一共多少行，以及耗时、成没成与失败散列。
  'issues.page': ['state', 'labelsCount', 'returned', 'total', 'latencyMs', 'ok', 'errorHash'],
  // 2026-09-23 #706（T2 第二批）新增三条按需事件（附录 1.5 节 #75～#77）：闸与账本自己产生的三条轨迹 ——
  //   一笔花费（哪一档、哪个桶、几条真实出站请求、几点、记完还剩多少）、一次裁决（类别、种类、结论、原因代号、档位）、
  //   一次跳过（工作区键散列、种类、原因、推迟队列里现在几条）。都只记枚举、散列与数字，不记路径原文与命令原文。
  'quota.spend': ['account', 'bucket', 'requests', 'points', 'remaining'],
  'refresh.decide': ['category', 'kind', 'verdict', 'reason', 'tier'],
  'refresh.skipped': ['keyHash', 'kind', 'reason', 'pending'],
  // 2026-09-23 #708（T4 第三批）新增一条按需事件（附录 1.5 节 #82）：一次行级增量跑完之后的结论 ——
  //   这一次走的是哪一档（补那几条薄查询 / 该整池 / 没变 / 被推迟 / 过期丢弃）、为什么、变了几行、
  //   真发出去几条薄查询、水印推没推、待办里现在几条。只记短散列、枚举与数字，不记路径与命令原文。
  'refresh.patch': ['keyHash', 'mode', 'reason', 'changed', 'queries', 'watermark', 'pending'],
  // 2026-09-23 #707（T3 第二批）新增两条按需事件（附录 1.5 节 #78～#79）：视野模型自己产生的两条轨迹 ——
  //   一次上报（哪一种信号、窗口散列、工作区根散列、面板可不可见、这一笔算不算数）、
  //   一次收摊结论（活跃几个、保留几个定时器、停掉几个、有没有一个收尾节拍、整桌收没收、正在看的几个）。
  //   都只记枚举、散列与数字：心跳每 20 秒一次，所以上报那条按十取一采样。
  'attention.report': ['kind', 'windowHash', 'rootHash', 'visible', 'accepted'],
  'attention.sweep': ['active', 'keep', 'cancel', 'linger', 'collaped', 'keepers'],
  // 2026-09-23 #714（T10）新增一条常驻事件（附录 1.4 节 #80）：会话↔票 处理链自己产生的轨迹 ——
  //   一次写记进了哪个会话的链、这一次落盘成没成、重启后从落盘读回了没有。只记两个散列、三个枚举与一个数字，
  //   不记路径原文、不记命令原文、不记票标题；读那一路一条都不记（顺手看一眼不进链，所以这一族不会刷屏）。
  'sessionTickets.chain': ['sidHash', 'rootHash', 'kind', 'ok', 'action', 'count'],
  // 2026-09-23 #710（T6 第二批）新增一条按需事件（附录 1.5 节 #81 `write.event`）：写事件订阅自己产生的轨迹 ——
  //   一次成功的工具调用被判成哪一档、凭什么判的、接下来要做什么、票号认没认出来、从哪条订阅路来的。
  //   只记一个散列、三个枚举与一个布尔：**命令原文一个字都不记**（参数只做瞬时匹配），也不记票号本身。
  'write.event': ['keyHash', 'shape', 'tier', 'reason', 'action', 'hasTicket'],
  // 2026-09-25 登记收口（#709 · T5 与并行各票新增的埋点，附录 1.4 / 1.5 节 #83～#87）：这五条在代码里
  //   早就发出去了，只是登记没跟上，本票把它们如实补进白名单。字段是各落点的并集（本表的既有口径：
  //   允许字段就是「这个事件名能记的全部字段」）：
  //   · chain.backoff 定常驻 —— 那条 8 秒自续循环拆掉之后，宿主侧不再有任何自续定时器，「这次为什么
  //     没查 / 还在等多久」只能靠这一条回答，而查它的人不会先打开调试开关；另外两处同族落点记的是
  //     它的子集，且都在同一行先判调试开关。
  //   · 其余四条都是调试级按需，同一行先判开关，字段只取散列、枚举、数字与布尔。
  'chain.backoff': ['keyHash', 'decision', 'reason', 'waitMs', 'step', 'trigger'],
  'chain.cache.write': ['keyHash', 'allGreen', 'doneCount', 'step', 'progressed'],
  'chain.event': ['reason'],
  'naming.guard.event': ['reason'],
  'chain.preflight.reuse': ['cwdHash', 'checks', 'reused', 'userAction'],
  // 2026-09-25 #724 新增一条常驻事件（附录 1.4 节 #88 `host.dispatch.empty`）：处理函数回话了、回话里却没有
  //   可用内容 —— 分发这一层唯一看得见这种形状的地方。三个键都是短的：哪条电话（method）、哪一种形状
  //   （shape：no-value / null-value / no-error，也就是缺的是哪一个键）、服务这一份的版本（version，
  //   读不到就是 unknown）。不记入参原文、不记回话内容、不记路径；业务性的正常失败回参不触发它。
  'host.dispatch.empty': ['method', 'shape', 'version'],
  // 自监控 4 条（#499，附录 1.6 节；#46 走宿主防火发射器 fireLog，调用形状不在本门禁扫描口径内，由 verify-log-selfmon.js 覆盖）。
  'log.persist.fail': ['op', 'reason', 'dirHash'],
  'log.forward.summary': ['droppedDelta', 'totalDropped', 'reason', 'windowMs'],
  'log.switch.watchdog': ['op', 'timeoutMs', 'stage'],
  'log.export.fail': ['op', 'reason', 'errorHash'],
}
// 房内三点六个事件的精确字段形状（#494 房内落点，附录 1.4 原文）：
// gh.exec 五键、gh.timeout 两键、gh.resolve.fail 两键，
// graphql.fallback 与 issues.fallback 各自两键与三键，error.normalize 两键加可选状态码。
const ROOM_SHAPES = {
  'gh.exec': ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode'],
  'gh.timeout': ['argv0', 'timeoutMs'],
  'gh.resolve.fail': ['hasDSH_GH_PATH', 'errorHash'],
  'graphql.fallback': ['scope', 'reason'],
  'issues.fallback': ['from', 'to', 'reason'],
  'error.normalize': ['rawKind', 'mappedKind'],
}

function listJsFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.js')) out.push(p)
    }
  }
  walk(dir)
  return out
}

// 取对象字面量最外层全部键：跳过字符串与模板里的冒号，跳过三元问号冒号。
function topKeys(objText) {
  const keys = []
  let depth = 0
  let ternary = 0
  let instr = null
  let esc = false
  let buf = ''
  for (let i = 0; i < objText.length; i++) {
    const c = objText[i]
    if (instr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === instr) instr = null
      continue
    }
    if (c === '"' || c === "'" || c === '\u0060') { instr = c; continue }
    if (c === '{') { depth += 1; continue }
    if (c === '}') {
      depth -= 1
      if (depth === 0) break
      if (depth === 1) ternary = 0
      continue
    }
    if (depth !== 1) continue
    if (c === '?') { ternary += 1; continue }
    if (c === ':' && ternary > 0) { ternary -= 1; buf = ''; continue }
    if (c === ':' && ternary === 0) {
      const m = buf.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)
      if (m) keys.push(m[1])
      buf = ''
      continue
    }
    if (c === ',' || c === ';') { buf = ''; continue }
    buf += c
  }
  return keys
}

// 调用点之后第一段字段对象体的起点：
// 直接对象取第一个大括号；包在取值函数里的取 return 后面的大括号。
function fieldsObjectStart(rest) {
  const lazy = rest.match(/function\s*\([^)]*\)\s*\{\s*return\s*\{/)
  if (lazy) return rest.indexOf('{', lazy.index + lazy[0].length - 1)
  const i = rest.search(/\{/)
  return i
}

function collectCalls() {
  const found = {}
  const rooms = ['github' + path.sep + 'client.js', 'github' + path.sep + 'issues.js', 'github' + path.sep + 'errors.js']
  const files = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
  const mainRe = /(?:^|[^A-Za-z0-9_$])(?:log|fire|rlog|logEvent|backendLogEvent|roomLogEvent)\s*\(\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*)?['"](error|warn|info|debug)['"]\s*,\s*['"]([a-z][a-zA-Z0-9.]*?)['"]\s*,/g
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const rel = path.relative(ROOT, f)
    const isRoom = rooms.some((r) => rel.endsWith(r))
    const patterns = [mainRe]
    if (isRoom) patterns.push(/(?:^|[^A-Za-z0-9_$])f\s*\(\s*['"](error|warn|info|debug)['"]\s*,\s*['"]([a-z][a-zA-Z0-9.]*?)['"]\s*,/g)
    for (const re of patterns) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) {
        const name = m[2]
        const after = text.slice(m.index + m[0].length)
        // 只看紧跟调用的头 120 字：直接对象、取值函数或变量三选一，不向后跨行借对象。
        const head120 = after.slice(0, 120)
        let keys = []
        const lazyHead = head120.match(/^\s*function\s*\([^)]*\)\s*\{\s*return\s*\{/)
        if (lazyHead) {
          const start = after.indexOf('{', lazyHead.index + lazyHead[0].length - 1)
          if (start >= 0) keys = topKeys(after.slice(start))
        } else if (/^\s*\{/.test(head120)) {
          keys = topKeys(after.slice(after.search(/\{/)))
        } else {
          // 字段先装进变量再传入：回头找该变量的对象字面量，并收拢后续逐个点赋的键。
          // 只有裸变量名（后面紧跟逗号或右括号）才走这条路，其余形状直接记空键。
          const varName = (head120.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[,)]/) || [])[1]
          if (varName) {
            const before = text.slice(0, m.index)
            const decls = Array.from(before.matchAll(new RegExp('(?:const|let|var)?\\s*' + varName + '\\s*=\\s*\\{', 'g')))
            if (decls.length) {
              const d = decls[decls.length - 1]
              keys = topKeys(before.slice(d.index + d[0].length - 1))
            }
            const scope = text.slice(m.index, m.index + 2500)
            for (const pm of scope.matchAll(new RegExp(varName + '\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*=', 'g'))) {
              if (!keys.includes(pm[1])) keys.push(pm[1])
            }
          }
        }
        if (!found[name]) found[name] = { keys: {}, sites: [] }
        for (const k of keys) found[name].keys[k] = (found[name].keys[k] || 0) + 1
        found[name].sites.push(rel + '（第 ' + (text.slice(0, m.index).split('\n').length) + ' 行）')
      }
    }
  }
  return found
}

const found = collectCalls()
const names = Object.keys(found).sort()

// 一、允许表里每个事件都有埋点落点（83 个事件里自监控 #46 由 verify-log-selfmon.js 覆盖，退役的 3 个不在源码里）。
for (const name of Object.keys(ALLOWED).sort()) {
  check(!!found[name], '事件有埋点落点 ' + name + (found[name] ? '（' + found[name].sites.length + ' 处）' : '（全仓未找到）'))
}
for (const name of names) {
  if (!ALLOWED[name]) check(false, '未知事件名须先更新附录与本门禁 ' + name + ' @ ' + found[name].sites.slice(0, 3).join('、'))
}
check(!found['issuePath.push'] && !found['issuePath.record'], '已退役两事件无埋点残留（issuePath.push、issuePath.record 只在附录追溯）')

// 二、每个事件的实际字段键都在允许表内（只许少记、不过多记）。
for (const name of Object.keys(ALLOWED).sort()) {
  if (!found[name]) continue
  const allowed = ALLOWED[name]
  const actual = Object.keys(found[name].keys).sort()
  const extra = actual.filter((k) => !allowed.includes(k))
  check(extra.length === 0, '事件只含允许字段 ' + name + '（实得 ' + (actual.join('、') || '空') + '）' + (extra.length ? ' —— 多出：' + extra.join('、') : ''))
}

// 三、房内三点六个事件字段形状一字不差（附录 1.4 原文）。
for (const name of Object.keys(ROOM_SHAPES).sort()) {
  if (!found[name]) continue
  const want = ROOM_SHAPES[name].slice().sort()
  if (name === 'error.normalize') {
    const actual = Object.keys(found[name].keys).sort()
    const ok = ROOM_SHAPES[name].every((k) => actual.includes(k)) && actual.every((k) => k === 'httpCode' || ROOM_SHAPES[name].includes(k))
    check(ok, '房内事件字段形状 ' + name + '（实得 ' + actual.join('、') + '，httpCode 仅归一出状态码时带）')
    continue
  }
  const actual = Object.keys(found[name].keys).sort()
  check(JSON.stringify(actual) === JSON.stringify(want), '房内事件字段形状 ' + name + '（实得 ' + (actual.join('、') || '空') + '，应得 ' + want.join('、') + '）')
}

// 四、全局禁令抽查：全部事件的字段键并集里没有原文类键。
const allKeys = {}
for (const name of names) for (const k of Object.keys(found[name].keys)) allKeys[k] = true
// 原文类键精确名单：与这些一字相同的键名不许出现在任何事件里
// （是否配备用路径这类布尔键、带 Hash 后缀的散列键不在此列）。
const RAW_KEYS = ['token', 'password', 'passwd', 'pwd', 'secret', 'authorization', 'bearer', 'url', 'path', 'cwd', 'message', 'error', 'err', 'stack', 'text', 'title', 'body', 'content', 'template', 'snapshot', 'stdout', 'stderr', 'args', 'argv', 'query', 'cookie', 'session', 'hint', 'repo', 'owner']
const rawLike = Object.keys(allKeys).filter((k) => RAW_KEYS.includes(k))
check(rawLike.length === 0, '字段键无原文类键（令牌、路径、地址、文本原文都不许作键名）' + (rawLike.length ? ' —— 命中：' + rawLike.join('、') : '（共 ' + Object.keys(allKeys).length + ' 个键）'))

console.log(failed ? '\n存在失败 — verify-log-fields 未通过' : '\n全部通过 — 字段白名单门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
