// verify-log-count.js —— #494 第三件事：日志门禁之计数（#489 附录第 4 节断言六）。
// 用法：在插件根目录执行 node tests/verify-log-count.js，可独立运行。
// 断言文字：常驻 27 条、按需 16 条、总数 43（#22、#34 已退役）；
// 增删事件必须同步更新附录对照表，否则红。
// 做法：用 git show 只读退役分支上的附录修订版，核对 counts 字面与编号清单；
// 再扫描源码里加引号的事件名，逐个点名，退役的两条出现即红。
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志计数门禁（#494：常驻 27、按需 16、总数 43，与退役附录修订版字面一致）')

// 附录对照表里的现行清单（1.3 落定后：常驻 27 条编号，另有 2 条已退役只作追溯）。
const RESIDENT = ['snapshot.request', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec', 'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback', 'snapshot.built', 'panelSync.dirty', 'registry.select', 'detection.detect', 'skill.probe', 'skill.pending.cap', 'host.call', 'host.call.fail', 'snapshot.hydrate', 'backend.switch', 'naming.guard', 'naming.lock', 'settings.save', 'panel.open', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail', 'chain.derive.error', 'fallback.chain']
// 按需 16 条编号（纠偏与落定后均不变）：含 #45，不含已退役。
const ONDEMAND = ['snapshot.cache.hit', 'probe.eval', 'panelSync.eval', 'registry.stub', 'workspaceStore.hit', 'chain.cache.hit', 'chain.predicate', 'workspaceKey.canonical', 'platform.resolve', 'naming.sweep', 'snapshot.fanout', 'dedup.hit', 'statusbar.hydrate', 'error.normalize', 'timer.schedule', 'privacy.scrub']
const RETIRED = ['issuePath.push', 'issuePath.record']

// 一、附录修订版字面：只读退役分支，不切换分支，不碰工作区。
let appendix = ''
try {
  appendix = execFileSync('git', ['show', 'origin/feat/494-retire:research/489-appendix.md'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  check(appendix.length > 1000, '附录修订版可读（退役分支 research/489-appendix.md）')
} catch (e) {
  check(false, '附录修订版可读（git show origin/feat/494-retire:research/489-appendix.md 失败：' + ((e && e.message) || e) + '）')
}
if (appendix) {
  check(appendix.includes('常驻 27 条、按需 16 条、总数 43 条'), '附录 counts 字面为常驻 27 条、按需 16 条、总数 43 条')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、35、36、38、39、40、41、42'), '附录常驻编号清单 27 个（不含已退役的 22、34，不含 45）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45'), '附录按需编号清单 16 个（含 45）')
  check(appendix.includes('#22') && appendix.includes('#34') && appendix.includes('退役'), '附录记明 #22 与 #34 已退役（行保留只作追溯）')
}

// 二、源码点名：常驻 27 与按需 16 逐个出现（单双引号都算），退役 2 条不许出现。
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

// 三、总数：已知事件恰为 43 个（常驻 27 加按需 16），退役的不计入。
{
  const known = RESIDENT.concat(ONDEMAND)
  const missing = known.filter((n) => !quoted[n])
  const hitKnown = known.filter((n) => quoted[n])
  check(RESIDENT.length === 27 && ONDEMAND.length === 16 && known.length === 43, '清单总数 43（常驻 27、按需 16）')
  check(missing.length === 0, '43 个事件全部落点无缺口' + (missing.length ? ' —— 缺口：' + missing.join('、') : '（命中 ' + hitKnown.length + ' 个）'))
}

console.log(failed ? '\n存在失败 — verify-log-count 未通过' : '\n全部通过 — 计数门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
