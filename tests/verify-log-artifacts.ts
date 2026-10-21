// verify-log-artifacts.ts —— #494 第三件事：日志门禁之双产物（#489 附录第 4 节断言八）。
// 用法：在插件根目录执行 node tests/verify-log-artifacts.ts，可独立运行，
// 运行前先执行 node scripts/build.mts 生成产物。
// 断言文字：新增电话名在开发产物与打包产物同时存在，只改一处即红。
// 做法：客户端事件在两个客户端产物里逐个点名；宿主事件在打包镜像里逐个点名
// 且镜像不比真源旧；构建脚本的日志接线逐项锁死。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// 产物新鲜度判据全仓只有一份：scripts/lib/build-cache.mts 的 judgeProducts（#1326）。缓存可用时比内容摘要；
// 缓存不可用时回落按修改时间判断，原因用 INFO 行打出来（判绿也打，不静默），失败文案直接用判据给的原因。
const { judgeProducts } = require('../scripts/lib/build-cache.mts')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志双产物门禁（#494：开发产物与打包产物同时含新增埋点，只改一处即红）')

function listJsFiles(dir, withTs) {
  const out = []
  const walk = (d) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.js') && !(withTs && fs.existsSync(p.slice(0, -3) + '.ts'))) out.push(p)
      else if (withTs && e.name.endsWith('.ts')) out.push(p)
    }
  }
  walk(dir)
  return out
}
// 源码里加引号的事件名（驼峰前缀也算；注释里的不算）。
function quotedEvents(text) {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
  const out = new Set()
  for (const m of noComments.matchAll(/['"]([A-Za-z]+(?:\.[A-Za-z][A-Za-z0-9]*)+)['"]/g)) out.add(m[1])
  return out
}
const KNOWN = ['snapshot.request', 'snapshot.cache.hit', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec', 'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback', 'snapshot.built', 'probe.eval', 'panelSync.eval', 'panelSync.dirty', 'registry.select', 'registry.stub', 'detection.detect', 'workspaceStore.hit', 'chain.cache.hit', 'chain.predicate', 'skill.probe', 'skill.pending.cap', 'workspaceKey.canonical', 'workspaceRoot.resolve', 'inject.decision', 'platform.resolve', 'naming.sweep', 'host.call', 'host.call.fail', 'snapshot.hydrate', 'snapshot.fanout', 'dedup.hit', 'backend.switch', 'naming.guard', 'naming.lock', 'panel.open', 'panel.render', 'statusbar.hydrate', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail', 'chain.derive.error', 'fallback.chain', 'error.normalize', 'timer.schedule', 'privacy.scrub', 'exec.run', 'host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail', 'container.split', 'container.accent', 'entry.open', 'entry.pick']
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

// 一、产物都在（构建生成，人手不碰）。
{
  check(exists('client.js'), '开发产物存在（client.js，由构建生成）')
  check(exists('host.js'), '开发产物存在（host.js，由构建生成）')
  check(exists(path.join('package', 'lib', 'client.js')), '打包产物存在（package/lib/client.js，由构建生成）')
  check(exists(path.join('package', 'lib', 'index.js')), '打包产物存在（package/lib/index.js，由构建生成）')
}

// 二、客户端事件：两个客户端产物同时含（拼接一源两物，只改一处即红）。
{
  const clientEvents = new Set()
  // 源侧读真源：加了 withTs 之后，同名 .js 是构建产物就跳过、直接读 .ts（#1251 起 src/client 下
  //   kernel/panel/statusbar/floating 都是这个形态），没转 TS 的文件仍按 .js 读。今天两种读法
  //   得到同一份事件集合（19 个），但只有读真源才不会被某份过期产物带偏。
  for (const f of listJsFiles(path.join(ROOT, 'src', 'client'), true)) {
    for (const n of quotedEvents(fs.readFileSync(f, 'utf8'))) if (KNOWN.includes(n)) clientEvents.add(n)
  }
  check(clientEvents.size > 0, '客户端源码含日志事件（实得 ' + clientEvents.size + ' 个）')
  if (exists('client.js') && exists(path.join('package', 'lib', 'client.js'))) {
    const dev = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
    const pkg = fs.readFileSync(path.join(ROOT, 'package', 'lib', 'client.js'), 'utf8')
    // 产物里的事件名走同一套 quotedEvents：它剥掉注释、两种引号都认。判据没变 —— 仍是「产物里真有
    //   这个事件名的字符串字面量」；换掉只认单引号的老写法，是因为 esbuild 统一输出双引号（#1251 起
    //   同名 .js 是构建产物），而旧写法在双引号产物里一条都匹配不上、把 13 个事件全判成「缺」。
    const devEvents = quotedEvents(dev)
    const pkgEvents = quotedEvents(pkg)
    const devMiss = Array.from(clientEvents).filter((n) => !devEvents.has(n))
    const pkgMiss = Array.from(clientEvents).filter((n) => !pkgEvents.has(n))
    check(devMiss.length === 0, '开发产物含全部客户端事件（' + clientEvents.size + ' 个）' + (devMiss.length ? ' —— 缺：' + devMiss.join('、') : ''))
    check(pkgMiss.length === 0, '打包产物含全部客户端事件（' + clientEvents.size + ' 个）' + (pkgMiss.length ? ' —— 缺：' + pkgMiss.join('、') : ''))
    const markerLine = (t) => t.split('\n').filter((l) => /^\s*\/\/ ==== (kernel|leaf|shared):[^=]+\(spliced by build\) ====\s*$/.test(l))
    check(markerLine(dev).length === 0, '开发产物无未替换的拼接标记行' + (markerLine(dev).length ? ' —— ' + markerLine(dev).slice(0, 3).join('；') : ''))
    check(markerLine(pkg).length === 0, '打包产物无未替换的拼接标记行' + (markerLine(pkg).length ? ' —— ' + markerLine(pkg).slice(0, 3).join('；') : ''))
  }
}

// 三、宿主事件：打包镜像与真源逐个一致，且镜像不比真源旧。
// 宿主半是原样复制（方案 C），开发产物只含入口，真源与镜像一一对应。
// 2026-10-18 #1247：宿主真源转成 TypeScript，源侧扫 .ts（同名 .js 产物跳过不数两遍），
//   镜像侧把 .ts 换回 .js 再比（构建把真源逐文件转译进包）。
{
  const hostFiles = listJsFiles(path.join(ROOT, 'src', 'host'), true)
  let mirrorOk = 0
  let mirrorChecked = 0
  const problems = []
  // 先把「有点名事件的宿主真源」收成清单：真源与镜像都换成仓库相对、正斜杠形式，事件名一起留着。
  const entries = []
  for (const f of hostFiles) {
    const rel = path.relative(path.join(ROOT, 'src', 'host'), f)
    const names = Array.from(quotedEvents(fs.readFileSync(f, 'utf8'))).filter((n) => KNOWN.includes(n))
    if (!names.length) continue
    mirrorChecked += 1
    const relPosix = rel.split(path.sep).join('/')
    entries.push({
      rel,
      names,
      mirrorRel: 'package/lib/' + relPosix.replace(/\.ts$/, '.js'),
      sourceRel: 'src/host/' + relPosix,
    })
  }
  // 产物新鲜度一次判完整批镜像：镜像是与上次成功构建记录比；真源与镜像的对应关系由本段前面的事件名断言兜底。
  // 逐个调判据会在缓存回落时把同一段长 INFO 刷几十遍（无变化的心跳重复记，AGENTS.md 日志纪律），所以整批只判一次、
  // notices 只打一遍。
  const judged = judgeProducts({
    products: entries.map((e) => e.mirrorRel),
    sources: entries.map((e) => e.sourceRel),
  })
  for (const n of judged.notices) console.log('  INFO ' + n)
  for (const e of entries) {
    const mirror = path.join(ROOT, e.mirrorRel)
    if (!fs.existsSync(mirror)) { problems.push(e.rel + ' 无打包镜像'); continue }
    const mirrorNames = quotedEvents(fs.readFileSync(mirror, 'utf8'))
    const miss = e.names.filter((n) => !mirrorNames.has(n))
    if (miss.length) { problems.push(e.rel + ' 镜像缺 ' + miss.join('、')); continue }
    const judgedMirror = judged.products.find((p) => p.product === e.mirrorRel)
    if (!judgedMirror || judgedMirror.freshness !== 'fresh') {
      problems.push(e.rel + ' ' + (judgedMirror ? judgedMirror.reason : '判据没有给出这个产物的结论'))
      continue
    }
    mirrorOk += 1
  }
  check(mirrorChecked > 0, '宿主源码含日志事件的文件有 ' + mirrorChecked + ' 个')
  check(problems.length === 0, '打包镜像与真源事件一致且新鲜' + (problems.length ? ' —— ' + problems.join('；') : '（' + mirrorOk + ' 个文件）'))
}

// 四、构建接线：日志模块在内核清单里，叶子登记覆盖四个渲染落点文件。
{
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mts'), 'utf8')
  // 日志模块的两种合法落点：派生文件（#564 起沿用）或新真源 log.ts（#1251 把旧手写真源 log.js 删了，
  //   读源由 readSpliceFragmentSource 按扩展名分派，.ts 先转译再拼）。两种都算接线在；条目被删、
  //   路径换成别处、或指向的文件不在盘上，都掀红。
  const LOG_KERNEL_FILES = ['scripts/generated/logKernel.derived.js', 'src/client/kernel/log.ts']
  const logEntry = /\{\s*name:\s*'log'\s*,\s*file:\s*'([^']+)'\s*\}/.exec(build)
  const logEntryFile = logEntry ? logEntry[1] : ''
  check(LOG_KERNEL_FILES.indexOf(logEntryFile) >= 0 && exists(logEntryFile),
    '构建内核清单含日志模块（指向 ' + (logEntryFile || '（清单里找不到 name: log 条目）') + '）')
  // 叶子登记逐个点名，扩展名两种都认：真源是 .ts（#1251 起 DockSync / StatusBar 就是），产物是 .js
  //   （BackendSelector / SettingsPage 走「先转出同名 .js 产物再拼」那一支）。判据仍然是「这个叶子
  //   文件在清单里登记过」，只是不再写死扩展名。
  for (const leaf of ['BackendSelector', 'SettingsPage', 'DockSync', 'StatusBar']) {
    const entry = new RegExp("file:\\s*'[^']*[/\\\\]" + leaf + "\\.(?:ts|js)'").exec(build)
    check(entry !== null, '构建叶子清单含 ' + leaf + '（' + (entry ? entry[0] : '清单里找不到 file: …/' + leaf + '.(ts|js)') + '）')
  }
  check(build.includes('src/host') && build.includes('package/lib') && build.includes('cpSync'), '构建原样复制宿主树到打包目录')
}

console.log(failed ? '\n存在失败 — verify-log-artifacts 未通过' : '\n全部通过 — 双产物门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
