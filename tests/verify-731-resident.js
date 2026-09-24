// tests/verify-731-resident.js —— #731 门禁：常驻放行一次修好（开关关着也能回答慢问题）。
// 用法：在插件根目录执行 node tests/verify-731-resident.js，可独立运行。
// 为什么单开这一个文件：既有字段门禁只查不多记，删掉耗时不会红；既有外层门禁只查调试级，
// 常驻信息的放行没有人锁。这个文件只锁三件事，不碰既有断言：四处常驻名单一致、
// 建成行与成功调用行必须带耗时、开关关着时常驻放行而按需拦掉。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('常驻放行门禁（#731：开关关着也能回答这次取数花了多久、成功还是失败）')

const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 从常驻名单字面里取出事件名：只收 RESIDENT_EVENTS 那一对方括号以内、引号引起来的虚线名。
// 单双引号都收：手写真源用单引号，派生副本用双引号，两边拼出来必须是一张表。
// 为什么不能放宽到附近 4000 字：名单后面跟着的逻辑里还有别的事件名（例如落盘失败行），
// 放宽会把它们误收进来，四处收到的还各不相同，一致检查就永远对不上。
const pickEvents = (text) => {
  const out = []
  for (const m of text.matchAll(/['"]([a-z][a-zA-Z0-9.]*?)['"]/g)) {
    const name = m[1]
    if (name.includes('.') && out.indexOf(name) < 0) out.push(name)
  }
  return out
}
// 某文件的常驻名单字面：从 RESIDENT_EVENTS 起找第一对方括号，只取括号以内。
const residentOf = (text) => {
  const at = text.indexOf('RESIDENT_EVENTS')
  if (at < 0) return []
  const open = text.indexOf('[', at)
  if (open < 0) return []
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth += 1
    else if (text[i] === ']') {
      depth -= 1
      if (depth === 0) return pickEvents(text.slice(open, i + 1))
    }
  }
  return []
}

// 一、四处名单一致，且与计数门禁的常驻 38 条一致（只许一致，不许各写各的）。
// 锁的是真正生效的四处：包宿主真源、包客户端真源、宿主派生副本、客户端派生副本。
// 旧文件 src/host/logStore.js 与 src/client/kernel/log.js 是只读留存（#564 留而不搬），
// 运行时不走它们，这里不锁它们，免得把派生口径与留存文件混成一谈。
{
  const pkgHost = readSrc(path.join('packages', 'dsh-log', 'src', 'store.ts'))
  const pkgClient = readSrc(path.join('packages', 'dsh-log', 'src', 'client.ts'))
  const derivedHost = readSrc(path.join('src', 'host', 'logPkg', 'store.js'))
  const derivedKernel = readSrc(path.join('scripts', 'generated', 'logKernel.derived.js'))
  const sets = [pkgHost, pkgClient, derivedHost, derivedKernel].map(residentOf)
  const base = sets[0].slice().sort().join(',')
  check(sets.every((s) => s.slice().sort().join(',') === base), '四处常驻名单一字一致（包宿主、包客户端、宿主派生、客户端派生）')
  check(sets[0].indexOf('snapshot.request') >= 0 && sets[0].indexOf('snapshot.built') >= 0 && sets[0].indexOf('host.call') >= 0, '名单含这张票点名的三项（请求、建成、成功调用）')
  check(sets[0].length === 38, '名单共 38 条，与附录常驻数一致（实得 ' + sets[0].length + ' 条）')
  const countSrc = readSrc(path.join('tests', 'verify-log-count.js'))
  const missing = sets[0].filter((n) => countSrc.indexOf("'" + n + "'") < 0)
  check(missing.length === 0, '名单每条都在计数门禁里（无私自加项）' + (missing.length ? ' —— 多出：' + missing.join('、') : ''))
}

// 二、放行判断看事件名，不只看级别；记日志时把事件名透进去。
{
  const pkgHost = readSrc(path.join('packages', 'dsh-log', 'src', 'store.ts'))
  check(/function isEnabled\(level:\s*string,\s*event\?:\s*string\)/.test(pkgHost) && pkgHost.indexOf('RESIDENT_EVENTS.has(event)') >= 0, '包宿主放行看事件名（常驻信息关着也过）')
  check(/if\s*\(!isEnabled\(level,\s*event\)\)\s*return/.test(pkgHost), '包宿主记日志透事件名')
  const pkgClient = readSrc(path.join('packages', 'dsh-log', 'src', 'client.ts'))
  check(pkgClient.indexOf('RESIDENT_EVENTS.has(event)') >= 0, '包客户端放行看事件名')
  check(/if\s*\(!isEnabled\(level,\s*event\)\)\s*return/.test(pkgClient), '包客户端记日志透事件名')
  const derivedHost = readSrc(path.join('src', 'host', 'logPkg', 'store.js'))
  check(derivedHost.indexOf('RESIDENT_EVENTS.has(event)') >= 0 && /if\s*\(!isEnabled\(level,\s*event\)\)\s*return/.test(derivedHost), '宿主派生副本同一放行（派生必须新鲜，旧了就重跑派生脚本）')
  const derivedKernel = readSrc(path.join('scripts', 'generated', 'logKernel.derived.js'))
  check(derivedKernel.indexOf('RESIDENT_EVENTS.has(event)') >= 0 && /if\s*\(!isEnabled\(level,\s*event\)\)\s*return/.test(derivedKernel), '客户端派生副本同一放行（运行时走派生，不走留存旧文件）')
  const indexSrc = readSrc(path.join('src', 'host', 'index.js'))
  check(indexSrc.indexOf('h.isEnabled(level, event)') >= 0, '宿主入口透事件名给包（不透则包里无法判常驻）')
}

// 三、建成行与成功调用行必须带耗时；删掉耗时这里变红（票面反证）。
{
  const envelope = readSrc(path.join('src', 'host', 'snapshotEnvelope.js'))
  check(envelope.indexOf("'snapshot.built'") >= 0 && envelope.indexOf('latencyMs') >= 0, '建成行带耗时（snapshot.built 含 latencyMs）')
  const refresh = readSrc(path.join('src', 'host', 'sessionRefresh.js'))
  check(refresh.indexOf("'snapshot.built'") >= 0 && refresh.indexOf('latencyMs') >= 0, '刷新那条建成行也带耗时（两条路同一口径）')
  const probe = readSrc(path.join('src', 'client', 'kernel', 'probe-snapshot.js'))
  check(probe.indexOf("'host.call'") >= 0 && probe.indexOf('latencyMs') >= 0, '成功调用行带耗时（host.call 含 latencyMs）')
}

// 四、房间外层本票不动：gh.exec 那道外层判断照旧由标签配色门禁拥有。
// 为什么不动：verify-github-label-colors.js 明确要求信息级开关关着时不记，
// 改它等于改既有断言，按纪律另开一票。本票只修三行取数证据经过的内层放行，
// 房间外层保持原形状，这里反向锁死（谁顺手改了这里，这里变红）。
{
  const room = readSrc(path.join('src', 'host', 'tracker', 'backends', 'github', 'client.js'))
  check(/function roomInfoEnabled\(ctx\)/.test(room), '房间外层保持原形状（单参数，不断言事件名）')
  check(room.indexOf('roomInfoEnabled(ctx)') >= 0, 'gh.exec 落点保持原调用形状（本票不碰房间外层）')
}

// 五、行为仿真：开关关着时常驻过、按需拦；开关开着时都过（逻辑与实现同字面）。
{
  const resident = residentOf(readSrc(path.join('packages', 'dsh-log', 'src', 'store.ts')))
  const fakeEnabled = (level, event, switchOn) => {
    if (level === 'error' || level === 'warn') return true
    if (typeof event === 'string' && resident.indexOf(event) >= 0) return true
    return switchOn === true
  }
  check(fakeEnabled('info', 'snapshot.request', false) === true, '开关关着请求行照过')
  check(fakeEnabled('info', 'snapshot.built', false) === true, '开关关着建成行照过')
  check(fakeEnabled('info', 'host.call', false) === true, '开关关着成功调用行照过')
  check(fakeEnabled('debug', 'snapshot.cache.hit', false) === false, '开关关着按需行照拦（采样不去掉）')
  check(fakeEnabled('debug', 'snapshot.cache.hit', true) === true, '开关开着按需行照过')
  check(fakeEnabled('warn', 'host.call.fail', false) === true, '失败行告警级照过（与从前一致）')
}

console.log(failed ? '\n存在失败 — verify-731-resident 未通过' : '\n全部通过 — 常驻放行门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
