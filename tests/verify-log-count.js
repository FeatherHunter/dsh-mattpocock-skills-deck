// verify-log-count.js —— #494 第三件事：日志门禁之计数（#489 附录第 4 节断言六，#499 自监控 5 条并入，#548 安装执行 1 条并入，#606 按需 2 条并入，#635 按需 1 条并入，#652 按需 1 条并入，#655 按需 1 条并入，#663 常驻 1 条并入，#66 按需 1 条并入，#67 按需 1 条并入，#685 常驻 1 条并入，#690 常驻 1 条并入，#706 第二批按需 3 条并入，#714 常驻 1 条并入，#710 第二批按需 1 条并入，#707 第三批按需 2 条并入，#708 第三批按需 1 条并入，#709 登记收口 5 条并入：常驻 1 条 chain.backoff、按需 4 条 chain.cache.write / chain.event / naming.guard.event / chain.preflight.reuse）。
// 用法：在插件根目录执行 node tests/verify-log-count.js，可独立运行。
// 断言文字：常驻 38 条、按需 42 条、自监控 5 条、总数 85（#22、#34、#35 已退役；#618 增补常驻 #60 与按需 #61，#635 增补按需 #62，#652 增补按需 #63，#655 增补按需 #64，#663 增补常驻 #65，#67 为同日新增 snapshot.stale.drop；2026-09-22 #685 增补常驻 #68 healthCheck.inject、#683 增补 #69/#70 与按需 #71/#72/#73、#690 增补常驻 #74 issues.page；2026-09-23 #706 第二批增补按需 #75 quota.spend、#76 refresh.decide、#77 refresh.skipped；2026-09-23 #707 第三批增补按需 #78 attention.report、#79 attention.sweep —— 视野模型的两条轨迹；2026-09-23 #714 增补常驻 #80 sessionTickets.chain —— 号位接在 #707 的 79 之后；2026-09-23 #710 第二批增补按需 #81 write.event —— 号位接在 #714 的 80 之后；2026-09-23 #708 第三批增补按需 #82 refresh.patch —— 号位接在 #710 的 81 之后；2026-09-25 #709 登记收口增补常驻 #83 chain.backoff 与按需 #84 chain.cache.write、#85 chain.event、#86 naming.guard.event、#87 chain.preflight.reuse —— 号位接在 #708 的 82 之后；2026-09-25 #724 增补常驻 #88 host.dispatch.empty —— 号位接在 #709 的 83 之后。这几条是「代码里早就在发、登记没跟上」或本票新加的，只补登记与埋点，不改别的事件）；
// 增删事件必须同步更新附录对照表，否则红。
// 做法：读工作区本地附录修订版，核对 counts 字面与编号清单；
// 再扫描源码里加引号的事件名，逐个点名，退役的三条出现即红。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志计数门禁（#494/#498/#499/#548/#606/#618/#635/#652/#655/#663/#66/#67/#685/#690/#706/#707/#714/#710/#708/#709/#724：常驻 38、按需 42、自监控 5、总数 85，与附录修订版字面一致）')

// 附录对照表里的现行清单（1.3 落定后常驻 27 条，#498 增补 #51 与 #55 成 29 条，#548 增补 #57 成 30 条，#618 增补 #60 成 31 条，
// #663 增补 #65 成 32 条；2026-09-21 #35 settings.save 退役成 31 条，#685 增补 #68 成 32 条，#683 增补 #69、#70 成 34 条，
// #690 增补 #74 issues.page 成 35 条，#714 增补 #80 sessionTickets.chain 成 36 条，
// 2026-09-25 #709 登记收口增补 #83 chain.backoff 成 37 条；#724 增补 #88 host.dispatch.empty 成 38 条；另有 3 条已退役只作追溯）。
const RESIDENT = ['snapshot.request', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec', 'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback', 'snapshot.built', 'panelSync.dirty', 'registry.select', 'detection.detect', 'skill.probe', 'skill.pending.cap', 'host.call', 'host.call.fail', 'snapshot.hydrate', 'backend.switch', 'naming.guard', 'naming.lock', 'panel.open', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail', 'chain.derive.error', 'fallback.chain', 'client.snapshot.miss', 'host.start', 'update.install.exec', 'labelColors.write', 'guide.inject', 'healthCheck.inject', 'choiceStore.file.bad', 'choiceStore.write.fail', 'issues.page', 'sessionTickets.chain', 'chain.backoff', 'host.dispatch.empty']
// 按需 42 条编号（#498 增补 #52、#53、#54、#56，#606 增补 #58、#59，#618 增补 #61，#635 增补 #62，#652 增补 #63，#655 增补 #64，#66 为 2026-09-21 新增 chain.stale.drop，#67 为同日新增 snapshot.stale.drop，#71、#72、#73 为 2026-09-22 #683 新增，#75、#76、#77 为 2026-09-23 #706 第二批新增，#78、#79 为同一天 #707 第三批新增 attention.report / attention.sweep，#81 为同一天 #710 第二批新增 write.event，#82 为同一天 #708 第三批新增 refresh.patch，#84、#85、#86、#87 为 2026-09-25 #709 登记收口新增）：含 #45，不含已退役。
const ONDEMAND = ['snapshot.cache.hit', 'probe.eval', 'panelSync.eval', 'registry.stub', 'workspaceStore.hit', 'chain.cache.hit', 'chain.predicate', 'workspaceKey.canonical', 'platform.resolve', 'naming.sweep', 'snapshot.fanout', 'dedup.hit', 'statusbar.hydrate', 'error.normalize', 'timer.schedule', 'privacy.scrub', 'chain.cache.miss', 'workspaceStore.miss', 'client.snapshot.hit', 'detail.cache.hit', 'exec.run', 'panel.render', 'labelColors.read', 'labelColors.panelPatch', 'workspaceRoot.resolve', 'inject.decision', 'chain.stale.drop', 'snapshot.stale.drop', 'choiceStore.read', 'choiceStore.hint.reject', 'choiceStore.evict', 'quota.spend', 'refresh.decide', 'refresh.skipped', 'attention.report', 'attention.sweep', 'write.event', 'refresh.patch', 'chain.cache.write', 'chain.event', 'naming.guard.event', 'chain.preflight.reuse']
const RETIRED = ['issuePath.push', 'issuePath.record', 'settings.save']
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
  check(appendix.includes('常驻 38 条、按需 42 条、自监控 5 条、总数 85 条'), '附录 counts 字面为常驻 38 条、按需 42 条、自监控 5 条、总数 85 条')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、80、83、88'), '附录常驻编号清单 38 个（不含已退役的 22、34、35，不含 45；#498 增补 51、55，#548 增补 57，#618 增补 60，#663 增补 65，#685 增补 68，#683 增补 69、70，#690 增补 74；2026-09-23 #714 增补 80 sessionTickets.chain，号位避让 #707 的 78、79；2026-09-25 #709 登记收口增补 83 chain.backoff；2026-09-25 #724 增补 88 host.dispatch.empty）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87'), '附录按需编号清单 42 个（不含已退役的 8、22、34、35 等；含 45；#498 增补 52、53、54、56；#606 增补 58、59；#618 增补 61；#635 增补 62；#652 增补 63；#655 增补 64；2026-09-21 增补 66、67；#683 增补 71、72、73；2026-09-23 #706 第二批增补 75、76、77；#707 第三批增补 78 attention.report、79 attention.sweep；#710 第二批增补 81 write.event；#708 第三批增补 82 refresh.patch；2026-09-25 #709 登记收口增补 84 chain.cache.write、85 chain.event、86 naming.guard.event、87 chain.preflight.reuse）')
  check(appendix.includes('#22') && appendix.includes('#34') && appendix.includes('#35') && appendix.includes('退役'), '附录记明 #22、#34 与 #35 已退役（行保留只作追溯）')
  check(appendix.includes('46、47、48、49、50') || appendix.includes('46～50'), '附录记明自监控编号 46～50（1.6 节）')
}

// 二、源码点名：常驻 37、按需 42、自监控 5 逐个出现（单双引号都算），退役 3 条不许出现。
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

// 三、总数：已知事件恰为 85 个（常驻 38 加按需 42 加自监控 5），退役的不计入。
{
  const known = RESIDENT.concat(ONDEMAND).concat(SELFMON)
  const missing = known.filter((n) => !quoted[n])
  const hitKnown = known.filter((n) => quoted[n])
  check(RESIDENT.length === 38 && ONDEMAND.length === 42 && SELFMON.length === 5 && known.length === 85, '清单总数 85（常驻 38、按需 42、自监控 5）')
  check(missing.length === 0, '85 个事件全部落点无缺口' + (missing.length ? ' —— 缺口：' + missing.join('、') : '（命中 ' + hitKnown.length + ' 个）'))
}

console.log(failed ? '\n存在失败 — verify-log-count 未通过' : '\n全部通过 — 计数门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
