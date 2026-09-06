// verify-log-count.js —— #494 第三件事：日志门禁之计数（#489 附录第 4 节断言六，#499 自监控 5 条并入）。
// 用法：在插件根目录执行 node tests/verify-log-count.js，可独立运行。
// 断言文字：常驻 29 条、按需 20 条、自监控 5 条、总数 54（#22、#34 已退役）；
// 增删事件必须同步更新附录对照表，否则红。
// 做法：读工作区本地附录修订版，核对 counts 字面与编号清单；
// 再扫描源码里加引号的事件名，逐个点名，退役的两条出现即红。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志计数门禁（#494/#498/#499：常驻 29、按需 20、自监控 5、总数 54，与附录修订版字面一致）')

// 附录对照表里的现行清单（1.3 落定后常驻 27 条，#498 增补 #51 与 #55 成 29 条；另有 2 条已退役只作追溯）。
const RESIDENT = ['snapshot.request', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec', 'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback', 'snapshot.built', 'panelSync.dirty', 'registry.select', 'detection.detect', 'skill.probe', 'skill.pending.cap', 'host.call', 'host.call.fail', 'snapshot.hydrate', 'backend.switch', 'naming.guard', 'naming.lock', 'settings.save', 'panel.open', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail', 'chain.derive.error', 'fallback.chain', 'client.snapshot.miss', 'host.start']
// 按需 20 条编号（#498 增补 #52、#53、#54、#56）：含 #45，不含已退役。
const ONDEMAND = ['snapshot.cache.hit', 'probe.eval', 'panelSync.eval', 'registry.stub', 'workspaceStore.hit', 'chain.cache.hit', 'chain.predicate', 'workspaceKey.canonical', 'platform.resolve', 'naming.sweep', 'snapshot.fanout', 'dedup.hit', 'statusbar.hydrate', 'error.normalize', 'timer.schedule', 'privacy.scrub', 'chain.cache.miss', 'workspaceStore.miss', 'client.snapshot.hit', 'detail.cache.hit']
const RETIRED = ['issuePath.push', 'issuePath.record']
// 自监控 5 条（#499，附录 1.6 节，编号 46～50，错误与告警级、始终落盘）。
const SELFMON = ['host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail']

// 一、附录修订版字面：读工作区本地文件（退役线已合入主线，附录随主线走，不再引用分支）。
let appendix = ''
try {
  const appendixPath = path.join(ROOT, 'research', '489-appendix.md')
  check(fs.existsSync(appendixPath), '附录修订版存在（工作区 research/489-appendix.md）')
  appendix = fs.readFileSync(appendixPath, 'utf8')
  check(appendix.length > 1000, '附录修订版非空')
} catch (e) {
  check(false, '附录修订版存在（工作区缺 research/489-appendix.md：' + ((e && e.message) || e) + '）')
}
if (appendix) {
  check(appendix.includes('常驻 29 条、按需 20 条、自监控 5 条、总数 54 条'), '附录 counts 字面为常驻 29 条、按需 20 条、自监控 5 条、总数 54 条')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、35、36、38、39、40、41、42、51、55'), '附录常驻编号清单 29 个（不含已退役的 22、34，不含 45；#498 增补 51、55）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56'), '附录按需编号清单 20 个（含 45；#498 增补 52、53、54、56）')
  check(appendix.includes('#22') && appendix.includes('#34') && appendix.includes('退役'), '附录记明 #22 与 #34 已退役（行保留只作追溯）')
  check(appendix.includes('46、47、48、49、50') || appendix.includes('46～50'), '附录记明自监控编号 46～50（1.6 节）')
}

// 二、源码点名：常驻 29、按需 20、自监控 5 逐个出现（单双引号都算），退役 2 条不许出现。
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
}
function collectQuotedNames() {
  const found = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.js')) {
        const text = stripComments(fs.readFileSync(p, 'utf8'))
        for (const m of text.matchAll(/['"]([A-Za-z]+(?:\.[A-Za-z][A-Za-z0-9]*)+)['"]/g)) {
          const n = m[1]
          found[n] = found[n] || []
          if (found[n].length < 5) found[n].push(path.relative(ROOT, p))
        }
      }
    }
  }
  walk(path.join(ROOT, 'src', 'host'))
  walk(path.join(ROOT, 'src', 'client'))
  return found
}
const quoted = collectQuotedNames()
for (const name of RESIDENT) {
  check(!!quoted[name], '常驻事件有埋点 ' + name + (quoted[name] ? '（' + quoted[name].length + ' 处以上）' : ''))
}
for (const name of ONDEMAND) {
  check(!!quoted[name], '按需事件有埋点 ' + name + (quoted[name] ? '（' + quoted[name].length + ' 处以上）' : ''))
}
for (const name of RETIRED) {
  check(!quoted[name], '已退役事件无埋点 ' + name + (quoted[name] ? ' —— 残留于 ' + quoted[name].join('、') : ''))
}
for (const name of SELFMON) {
  check(!!quoted[name], '自监控事件有埋点 ' + name + (quoted[name] ? '（' + quoted[name].length + ' 处以上）' : ''))
}

// 三、总数：已知事件恰为 54 个（常驻 29 加按需 20 加自监控 5），退役的不计入。
{
  const known = RESIDENT.concat(ONDEMAND).concat(SELFMON)
  const missing = known.filter((n) => !quoted[n])
  const hitKnown = known.filter((n) => quoted[n])
  check(RESIDENT.length === 29 && ONDEMAND.length === 20 && SELFMON.length === 5 && known.length === 54, '清单总数 54（常驻 29、按需 20、自监控 5）')
  check(missing.length === 0, '54 个事件全部落点无缺口' + (missing.length ? ' —— 缺口：' + missing.join('、') : '（命中 ' + hitKnown.length + ' 个）'))
}

console.log(failed ? '\n存在失败 — verify-log-count 未通过' : '\n全部通过 — 计数门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
