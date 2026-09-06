// verify-log-coverage.js —— #498 日志覆盖门禁（#489 附录第 4 节断言十）。
// 用法：在插件根目录执行 node tests/verify-log-coverage.js，可独立运行。
// 断言文字：每个非退役电话至少一行方法可识日志发射；每个客户端调用点可追踪；
// 五类动因无日志点即红；退役电话重现注册即红；日志电话成功行豁免、失败行不豁免。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志覆盖门禁（#498：电话必有行、调用点可追踪、五类动因无行即红）')

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
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const Q = String.fromCharCode(39)

// 电话清单：35 注册减退役 2 个，现役 33 个。增删电话必须同步改本表、附录 1.7 与计数门禁。
const PHONES = [
  'wf.detect', 'wf.chain', 'wf.cwd', 'wf.snapshot', 'wf.refresh',
  'wf.bind', 'wf.bindings', 'wf.registry', 'wf.selection',
  'wf.issueDetail', 'wf.issueComments', 'wf.commentIssue', 'wf.probe',
  'wf.handoffLatest', 'wf.handoffResolve',
  'wf.namingRegister', 'wf.registerNewSessionWatcher', 'wf.namingSignal', 'wf.namingPlan',
  'wf.namingResult', 'wf.cancelNewSessionWatcher', 'wf.awaitCreatedIssue',
  'wf.openFolder', 'wf.initPublish', 'wf.retryPush', 'wf.pickDirectory', 'wf.pickFile', 'wf.openPath',
  'wf.logBatch', 'wf.logExport', 'wf.logClear', 'wf.logGetSwitch', 'wf.logSetSwitch',
]
const RETIRED = ['wf.ping', 'wf.claim']
const PHONE_EXEMPT = ['wf.logBatch', 'wf.logGetSwitch', 'wf.logSetSwitch']
const PHONE_EVENT_COVERS = {
  'wf.snapshot': ['snapshot.request', 'snapshot.cache.miss', 'snapshot.built', 'snapshot.cache.hit'],
  'wf.refresh': ['snapshot.request', 'snapshot.cache.miss', 'snapshot.built', 'panelSync.dirty'],
}
const CALLEE_COVERS = [
  'wf.bind', 'wf.bindings', 'wf.registry', 'wf.selection',
  'wf.handoffLatest', 'wf.handoffResolve',
  'wf.namingRegister', 'wf.registerNewSessionWatcher', 'wf.namingSignal', 'wf.namingPlan',
  'wf.namingResult', 'wf.cancelNewSessionWatcher', 'wf.awaitCreatedIssue',
  'wf.openFolder', 'wf.pickDirectory', 'wf.pickFile', 'wf.openPath',
  'wf.initPublish', 'wf.retryPush', 'wf.cwd', 'wf.detect', 'wf.logExport', 'wf.logClear',
]

// 一、注册：现役全注册，退役零注册，实现留守不断链。
{
  const raw = readSrc(['src', 'host', 'index.js'].join(path.sep))
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
  const reg = new Set()
  const re = new RegExp('harness' + String.fromCharCode(46) + 'handle\\s*\\(\\s*' + Q + '(wf' + String.fromCharCode(46) + '[A-Za-z]+)' + Q, 'g')
  let m
  while ((m = re.exec(src))) reg.add(m[1])
  for (const p of PHONES) check(reg.has(p), '电话已注册 ' + p)
  for (const p of RETIRED) check(!reg.has(p), '退役电话零注册 ' + p)
  check(reg.size === PHONES.length, '注册总数恰为现役数（实得 ' + reg.size + '）')
  const life = readSrc(['src', 'host', 'sessionLifecycle.js'].join(path.sep))
  const claim = readSrc(['src', 'host', 'handoffClaim.js'].join(path.sep))
  check(life.indexOf('handlePing') >= 0 && claim.indexOf('handleClaim') >= 0, '退役实现留守不断链')
}
// 二、每电话至少一行方法可识发射（豁免表除外，无字面则看专属事件）。
{
  const all = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const perFile = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
    .map((f) => fs.readFileSync(f, 'utf8'))
  const ALIAS = { 'wf.namingRegister': 'wf.registerNewSessionWatcher' } // 双名同一本体，按规范入口记行
  const hasMethod = (p) => {
    const names = ALIAS[p] ? [p, ALIAS[p]] : [p]
    if (names.some((n) => all.indexOf('method: ' + Q + n + Q) >= 0)) return true
    return names.some((n) => perFile.some((t) => t.indexOf('loggedPhone(' + Q + n + Q) >= 0 && t.indexOf(Q + 'host.call' + Q) >= 0 && t.indexOf(Q + 'host.call.fail' + Q) >= 0))
  }
  const hasEvent = (e) => all.indexOf(Q + e + Q) >= 0
  for (const p of PHONES) {
    if (PHONE_EXEMPT.indexOf(p) >= 0) { check(true, '电话成功行豁免 ' + p); continue }
    const covers = PHONE_EVENT_COVERS[p] || []
    const ok = hasMethod(p) || covers.some(hasEvent)
    check(ok, '电话有方法可识行 ' + p)
  }
}
// 三、调用点可追踪：字面调用点相邻有行，或被调电话在宿主侧覆盖。
{
  const files = listJsFiles(path.join(ROOT, 'src', 'client'))
  const callRe = new RegExp('host' + String.fromCharCode(46) + 'call\\s*\\(\\s*' + Q + '(wf' + String.fromCharCode(46) + '[A-Za-z]+)' + Q)
  const lineRe = new RegExp('(?:log|fire)\\s*\\(\\s*' + Q + '(?:info|warn|debug)' + Q + '\\s*,\\s*' + Q + 'host' + String.fromCharCode(46) + 'call')
  const sites = []
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    if (rel.indexOf('seam') >= 0) continue
    const rawText = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
    const lines = rawText.split('\n')
    lines.forEach((line, i) => {
      const m = line.match(callRe)
      if (m) sites.push({ where: rel + ' 第 ' + (i + 1) + ' 行', phone: m[1], index: i, lines: lines })
    })
  }
  check(sites.length > 20, '字面调用点被扫到（实得 ' + sites.length + ' 处）')
  const untracked = []
  for (const s of sites) {
    if (PHONE_EXEMPT.indexOf(s.phone) >= 0) continue
    const near = s.lines.slice(Math.max(0, s.index - 8), s.index + 9).join('\n')
    if (!lineRe.test(near) && CALLEE_COVERS.indexOf(s.phone) < 0) untracked.push(s.where + ' 调 ' + s.phone)
  }
  check(untracked.length === 0, '调用点可追踪（' + sites.length + ' 处全覆盖）' + (untracked.length ? ' —— 失追：' + untracked.join('；') : ''))
}
// 四、动态透传点单列：通用透传与动态方法各一处，增减须同步本表。
{
  const panel = readSrc(['src', 'client', 'panelAssembly.js'].join(path.sep))
  const slot = readSrc(['src', 'client', 'kernel', 'slotRenderer-modal-view.js'].join(path.sep))
  check(panel.indexOf('return host.call(endpoint, args)') >= 0, '动态透传点已知其一（panelAssembly 通用透传）')
  check(slot.indexOf('host.call(method,') >= 0, '动态透传点已知其二（slotRenderer 动态方法）')
}
// 五、五类动因点名：新事件、定时器六名、解析 kind、来源键。
{
  const all = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const hasEvent = (e) => all.indexOf(Q + e + Q) >= 0
  const newEvents = ['chain.cache.miss', 'workspaceStore.miss', 'client.snapshot.hit', 'client.snapshot.miss', 'detail.cache.hit', 'host.start']
  for (const e of newEvents) check(hasEvent(e), '新事件有发射 ' + e)
  const timers = ['naming-guardian', 'naming-sweep', 'naming-persist', 'naming-poll', 'statusbar-poll', 'checks-poll']
  for (const n of timers) check(all.indexOf('name: ' + Q + n + Q) >= 0, '定时器调度有名 ' + n)
  let resolveKinds = 0
  for (const f of listJsFiles(path.join(ROOT, 'src', 'client'))) {
    if (fs.readFileSync(f, 'utf8').indexOf('log-resolve') >= 0) resolveKinds += 1
  }
  check(resolveKinds >= 2, '静默解析双链路各记各的（实得 ' + resolveKinds + ' 处含 log-resolve）')
  const regCore = readSrc(['src', 'host', 'tracker', 'registryCore.js'].join(path.sep))
  check((regCore.match(/caller\s*:/g) || []).length >= 4, '选择事件带来源键（四处发射全带 caller）')
}

console.log(failed ? '\n存在失败 — verify-log-coverage 未通过' : '\n全部通过 — 覆盖门禁生效（' + total + ' 项断言）')
if (failed) {
  console.log('')
  console.log('在“动五种东西（跨边界调用、接口方法、面板读写链路、缓存、定时器）就加日志点”之前先读总纲票 #502。')
  console.log('常驻还是按需看 docs/design/335-logging-contract.md 第 3 章，字段只取 research/489-appendix.md 白名单；补完重跑本脚本，绿了再谈功能。')
  console.log('总纲票 https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/502')
}
process.exit(failed ? 1 : 0)