// verify-log-artifacts.js —— #494 第三件事：日志门禁之双产物（#489 附录第 4 节断言八）。
// 用法：在插件根目录执行 node tests/verify-log-artifacts.js，可独立运行，
// 运行前先执行 node scripts/build.mjs 生成产物。
// 断言文字：新增电话名在开发产物与打包产物同时存在，只改一处即红。
// 做法：客户端事件在两个客户端产物里逐个点名；宿主事件在打包镜像里逐个点名
// 且镜像不比真源旧；构建脚本的日志接线逐项锁死。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志双产物门禁（#494：开发产物与打包产物同时含新增埋点，只改一处即红）')

function listJsFiles(dir) {
  const out = []
  const walk = (d) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.js')) out.push(p)
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
const KNOWN = ['snapshot.request', 'snapshot.cache.hit', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec', 'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback', 'snapshot.built', 'probe.eval', 'panelSync.eval', 'panelSync.dirty', 'registry.select', 'registry.stub', 'detection.detect', 'workspaceStore.hit', 'chain.cache.hit', 'chain.predicate', 'skill.probe', 'skill.pending.cap', 'workspaceKey.canonical', 'platform.resolve', 'naming.sweep', 'host.call', 'host.call.fail', 'snapshot.hydrate', 'snapshot.fanout', 'dedup.hit', 'backend.switch', 'naming.guard', 'naming.lock', 'settings.save', 'panel.open', 'statusbar.hydrate', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail', 'chain.derive.error', 'fallback.chain', 'error.normalize', 'timer.schedule', 'privacy.scrub']
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
  for (const f of listJsFiles(path.join(ROOT, 'src', 'client'))) {
    for (const n of quotedEvents(fs.readFileSync(f, 'utf8'))) if (KNOWN.includes(n)) clientEvents.add(n)
  }
  check(clientEvents.size > 0, '客户端源码含日志事件（实得 ' + clientEvents.size + ' 个）')
  if (exists('client.js') && exists(path.join('package', 'lib', 'client.js'))) {
    const dev = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
    const pkg = fs.readFileSync(path.join(ROOT, 'package', 'lib', 'client.js'), 'utf8')
    const devMiss = Array.from(clientEvents).filter((n) => !dev.includes("'" + n + "'"))
    const pkgMiss = Array.from(clientEvents).filter((n) => !pkg.includes("'" + n + "'"))
    check(devMiss.length === 0, '开发产物含全部客户端事件（' + clientEvents.size + ' 个）' + (devMiss.length ? ' —— 缺：' + devMiss.join('、') : ''))
    check(pkgMiss.length === 0, '打包产物含全部客户端事件（' + clientEvents.size + ' 个）' + (pkgMiss.length ? ' —— 缺：' + pkgMiss.join('、') : ''))
    const markerLine = (t) => t.split('\n').filter((l) => /^\s*\/\/ ==== (kernel|leaf|shared):[^=]+\(spliced by build\) ====\s*$/.test(l))
    check(markerLine(dev).length === 0, '开发产物无未替换的拼接标记行' + (markerLine(dev).length ? ' —— ' + markerLine(dev).slice(0, 3).join('；') : ''))
    check(markerLine(pkg).length === 0, '打包产物无未替换的拼接标记行' + (markerLine(pkg).length ? ' —— ' + markerLine(pkg).slice(0, 3).join('；') : ''))
  }
}

// 三、宿主事件：打包镜像与真源逐个一致，且镜像不比真源旧。
// 宿主半是原样复制（方案 C），开发产物只含入口，真源与镜像一一对应。
{
  const hostFiles = listJsFiles(path.join(ROOT, 'src', 'host'))
  let mirrorOk = 0
  let mirrorChecked = 0
  const problems = []
  for (const f of hostFiles) {
    const rel = path.relative(path.join(ROOT, 'src', 'host'), f)
    const names = Array.from(quotedEvents(fs.readFileSync(f, 'utf8'))).filter((n) => KNOWN.includes(n))
    if (!names.length) continue
    mirrorChecked += 1
    const mirror = path.join(ROOT, 'package', 'lib', rel)
    if (!fs.existsSync(mirror)) { problems.push(rel + ' 无打包镜像'); continue }
    const mirrorNames = quotedEvents(fs.readFileSync(mirror, 'utf8'))
    const miss = names.filter((n) => !mirrorNames.has(n))
    if (miss.length) { problems.push(rel + ' 镜像缺 ' + miss.join('、')); continue }
    if (fs.statSync(mirror).mtimeMs + 1000 < fs.statSync(f).mtimeMs) { problems.push(rel + ' 镜像比真源旧（请重跑 node scripts/build.mjs）'); continue }
    mirrorOk += 1
  }
  check(mirrorChecked > 0, '宿主源码含日志事件的文件有 ' + mirrorChecked + ' 个')
  check(problems.length === 0, '打包镜像与真源事件一致且新鲜' + (problems.length ? ' —— ' + problems.join('；') : '（' + mirrorOk + ' 个文件）'))
}

// 四、构建接线：日志模块在内核清单里，叶子登记覆盖四个渲染落点文件。
{
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8')
  check(build.includes("name: 'log'") && build.includes('src/client/kernel/log.js'), '构建内核清单含日志模块')
  for (const leaf of ['BackendSelector.js', 'SettingsPage.js', 'DockSync.js', 'StatusBar.js']) {
    check(build.includes(leaf), '构建叶子清单含 ' + leaf)
  }
  check(build.includes('src/host') && build.includes('package/lib') && build.includes('cpSync'), '构建原样复制宿主树到打包目录')
}

console.log(failed ? '\n存在失败 — verify-log-artifacts 未通过' : '\n全部通过 — 双产物门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
