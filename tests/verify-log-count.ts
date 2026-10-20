// verify-log-count.ts —— #494 第三件事：日志门禁之计数（#489 附录第 4 节断言六，#499 自监控 5 条并入，#548 安装执行 1 条并入，#606 按需 2 条并入，#635 按需 1 条并入，#652 按需 1 条并入，#655 按需 1 条并入，#663 常驻 1 条并入，#66 按需 1 条并入，#67 按需 1 条并入，#685 常驻 1 条并入，#690 常驻 1 条并入，#706 第二批按需 3 条并入，#714 常驻 1 条并入，#710 第二批按需 1 条并入，#707 第三批按需 2 条并入，#708 第三批按需 1 条并入，#709 登记收口 5 条并入：常驻 1 条 chain.backoff、按需 4 条 chain.cache.write / chain.event / naming.guard.event / chain.preflight.reuse，#817 版本管理宿主侧 git 适配器常驻 2 条并入：git.exec / git.exec.fail，#1054 关系与边常驻 1 条并入：edge.write，按需 3 条并入：edge.cycle / edge.roster / edge.repair，#1053 写路径常驻 1 条并入：issue.write，#1048 收口补做按需 1 条并入：detection.fallback，#1053 同日增补常驻 2 条并入：labelDefs.write / repo.init，#1083 退役常驻 1 条：sessionTickets.chain、增补常驻 2 条：workRoute.write / workRoute.read，#1294 新增按需 1 条：locale.registration、新增常驻 1 条：locale.registration.fail，#1295 新增按需 1 条：container.split、并给常驻 #10 snapshot.built 增补一格 specs，#1296 新增按需 1 条：container.accent）。
// 用法：在插件根目录执行 node tests/verify-log-count.ts，可独立运行。
// 断言文字：常驻 53 条、按需 55 条、自监控 5 条、总数 113（2026-10-21 #1314 排查时新增按需 #118 write.sent：每一趟取数走到闸之后的结论与花费，用 cycle 与 write.event 串起来；并给 #76 refresh.decide 增 cycle、keyHash，#78 attention.report 增 deduped，#81 write.event 增 tool、cycle、result、waitedMs；2026-10-20 #1296 新增按需 #115 container.accent（启动时按调试档记一行界面实际取到的两色：explore 是中央色表 map 值、spec 是中央色表 spec 值，用来分清「改了中央色表却没生效」是色表没改对，还是浏览器里跑的还是旧构建产物）；2026-10-20 #1295 新增按需 #114 container.split（列表页容器分拣这一趟：探索地图、规格、普通未关闭票、已关闭各几条，以及容器种类判定有没有退回文件内兜底），并给常驻 #10 snapshot.built 增补一格 specs（这一份快照里判成规格容器的几个；条数不变）；2026-10-20 #1294 新增按需 #112 locale.registration 与常驻 #113 locale.registration.fail，号位接在 #111 之后；2026-10-19 #1083 退役常驻 #80 sessionTickets.chain、增补常驻 #110 workRoute.write 与 #111 workRoute.read，号位接在 #109 之后；2026-10-14 #1053 同日增补常驻 #106 labelDefs.write 与 #107 repo.init，号位接在同日 #1048 的 #105 之后；#22、#34、#35 已退役；#618 增补常驻 #60 与按需 #61，#635 增补按需 #62，#652 增补按需 #63，#655 增补按需 #64，#663 增补常驻 #65，#67 为同日新增 snapshot.stale.drop；2026-09-22 #685 增补常驻 #68 healthCheck.inject、#683 增补 #69/#70 与按需 #71/#72/#73、#690 增补常驻 #74 issues.page；2026-09-23 #706 第二批增补按需 #75 quota.spend、#76 refresh.decide、#77 refresh.skipped；2026-09-23 #707 第三批增补按需 #78 attention.report、#79 attention.sweep —— 视野模型的两条轨迹；2026-09-23 #714 增补常驻 #80 sessionTickets.chain —— 号位接在 #707 的 79 之后；2026-09-23 #710 第二批增补按需 #81 write.event —— 号位接在 #714 的 80 之后；2026-09-23 #708 第三批增补按需 #82 refresh.patch —— 号位接在 #710 的 81 之后；2026-09-25 #709 登记收口增补常驻 #83 chain.backoff 与按需 #84 chain.cache.write、#85 chain.event、#86 naming.guard.event、#87 chain.preflight.reuse —— 号位接在 #708 的 82 之后；2026-09-25 #724 增补常驻 #88 host.dispatch.empty —— 号位接在 #709 的 83 之后；2026-09-27 #727 增补按需 #89 snapshot.late.install（迟到的快照回包里那一小块补装上了没有）—— 号位接在 #724 的 88 之后；#746 增补常驻 #90 naming.summary（首轮全文摘要的结论）—— 号位接在 #727 的 89 之后；2026-09-28 #776 增补按需 #91 input.observe（六组嫌疑的统一观测口）—— 号位接在 #746 的 90 之后；#782 增补常驻 #92 cwd.persisted（落盘补问的命中、耗时与结果）—— 号位接在 #776 的 91 之后；2026-10-01 新增常驻 #93 update.install.manifestSync（装完身份证补写，号位接在 #782 的 92 之后）；2026-10-04 #817 新增常驻 #94 git.exec 与 #95 git.exec.fail（版本管理宿主侧 git 适配器每一次 git 外部命令一行：成功与非零退出记信息级，等超时与起进程失败记告警级；号位接在 #93 之后）。这几条是「代码里早就在发、登记没跟上」或本票新加的，只补登记与埋点，不改别的事件；2026-10-14 #1048 增补按需 #98 detection.step（判定链每一步一行），#1131 增补按需 #99 detection.cache.hit（缓存命中那一行：这一次没重算，直接把上一次的判定回给了调用方），#1054 增补常驻 #100 edge.write（关系边写没写下去、走的哪条路、为什么）、按需 #101 edge.cycle、#102 edge.roster、#103 edge.repair（成环检查、邻接关系来源、REST 树边修复三条调试线）；2026-10-14 #1053 增补常驻 #104 issue.write（票的增删改评论贴标签：写没写下去、走的哪条路、为什么））；
// 增删事件必须同步更新附录对照表，否则红。
// 做法：读工作区本地附录修订版，核对 counts 字面与编号清单；
// 再扫描源码里加引号的事件名，逐个点名，退役的事件出现即红。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志计数门禁（#494/#498/#499/#548/#606/#618/#635/#652/#655/#663/#66/#67/#685/#690/#706/#707/#714/#710/#708/#709/#724/#727/#746/#776/#782/2026-10-01 新增 #93/2026-10-04 #817 新增 #94、#95/2026-10-14 #1048 新增 #98、#1131 新增 #99、#1054 新增 #100～#103、#1053 新增 #104、2026-10-14 #1048 收口补做新增 #105、同日 #1053 增补新增 #106、#107、2026-10-14 #1052 补做新增 #108、#109、2026-10-19 #1083 退役 #80 并新增 #110、#111、2026-10-20 #1294 新增 #112、#113、2026-10-20 #1295 新增 #114 container.split 并给 #10 snapshot.built 增补 specs 一格；2026-10-20 #1296 新增 #115 container.accent：常驻 53、按需 55、自监控 5、总数 113，与附录修订版字面一致）')

// 附录对照表里的现行清单（1.3 落定后常驻 27 条，#498 增补 #51 与 #55 成 29 条，#548 增补 #57 成 30 条，#618 增补 #60 成 31 条，
// #663 增补 #65 成 32 条；2026-09-21 #35 settings.save 退役成 31 条，#685 增补 #68 成 32 条，#683 增补 #69、#70 成 34 条，
// #690 增补 #74 issues.page 成 35 条，#714 增补 #80 sessionTickets.chain 成 36 条，
// 2026-09-25 #709 登记收口增补 #83 chain.backoff 成 37 条；#724 增补 #88 host.dispatch.empty 成 38 条；2026-10-04 #817 增补 #94 git.exec 与 #95 git.exec.fail 成 43 条（版本管理宿主侧 git 适配器每一次 git 外部命令一行）；2026-10-14 #1054 增补 #100 edge.write 成 44 条（关系边写没写下去、走的哪条路、为什么，一趟一行）；2026-10-14 #1053 增补 #104 issue.write 成 45 条（票的增删改评论贴标签：写没写下去、走的哪条路、为什么，一趟一行）；2026-10-14 #1053 同日增补 #106 labelDefs.write 与 #107 repo.init 成 47 条（标签定义改写与开仓发布各自的结论线，三条事件共用同一份机制 write-log.ts）；2026-10-14 #1052 补做增补 #108 read.degraded 与 #109 preflight.gate 成 49 条（读路径「本来能成、这一趟没成或成得不完整」的结论线，与探测三项门禁每过一关一行的过关门线；2026-10-19 #1083 再退役 #80 sessionTickets.chain 并增补 #110 workRoute.write、#111 workRoute.read 之后为 50 条；2026-10-20 #1294 增补 #113 locale.registration.fail 之后为 51 条；2026-10-20 #1295 给 #10 snapshot.built 增补 specs 一格，条数不变）。另有 3 条已退役只作追溯；加上 #1083 的 #80 共 4 条只作追溯）。
const RESIDENT = ['snapshot.request', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec', 'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback', 'snapshot.built', 'panelSync.dirty', 'registry.select', 'detection.detect', 'skill.probe', 'skill.pending.cap', 'host.call', 'host.call.fail', 'snapshot.hydrate', 'backend.switch', 'naming.guard', 'naming.lock', 'panel.open', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail', 'chain.derive.error', 'fallback.chain', 'client.snapshot.miss', 'host.start', 'update.install.exec', 'labelColors.write', 'guide.inject', 'healthCheck.inject', 'choiceStore.file.bad', 'choiceStore.write.fail', 'issues.page', 'chain.backoff', 'host.dispatch.empty', 'naming.summary', 'cwd.persisted', 'update.install.manifestSync', 'git.exec', 'git.exec.fail', 'edge.write', 'issue.write', 'labelDefs.write', 'repo.init', 'read.degraded', 'preflight.gate', 'workRoute.write', 'workRoute.read', 'locale.registration.fail', 'entry.open', 'entry.pick']
// 按需 55 条编号（#498 增补 #52、#53、#54、#56，#606 增补 #58、#59，#618 增补 #61，#635 增补 #62，#652 增补 #63，#655 增补 #64，#66 为 2026-09-21 新增 chain.stale.drop，#67 为同日新增 snapshot.stale.drop，#71、#72、#73 为 2026-09-22 #683 新增，#75、#76、#77 为 2026-09-23 #706 第二批新增，#78、#79 为同一天 #707 第三批新增 attention.report / attention.sweep，#81 为同一天 #710 第二批新增 write.event，#82 为同一天 #708 第三批新增 refresh.patch，#84、#85、#86、#87 为 2026-09-25 #709 登记收口新增，#89 为 2026-09-27 #727 新增 snapshot.late.install，#91 为 2026-09-28 #776 新增 input.observe，#96 为 2026-10-05 #864 新增 vc.cache.screen，#97 为 2026-10-09 #958 新增 labelColors.listed，#98 为 2026-10-14 #1048 新增 detection.step，#99 为 2026-10-14 #1131 新增 detection.cache.hit，#101、#102、#103 为 2026-10-14 #1054 新增 edge.cycle / edge.roster / edge.repair，#105 为 2026-10-14 #1048 收口补做新增 detection.fallback —— 号位避让同票的常驻 #100 edge.write 与 #1053 的 #104 issue.write；2026-10-20 #1294 增补 #112 locale.registration；2026-10-20 #1295 增补 #114 container.split；2026-10-20 #1296 增补 #115 container.accent；2026-10-21 #1314 排查时新增 #118 write.sent）：含 #45，不含已退役。
const ONDEMAND = ['snapshot.cache.hit', 'probe.eval', 'panelSync.eval', 'registry.stub', 'workspaceStore.hit', 'chain.cache.hit', 'chain.predicate', 'workspaceKey.canonical', 'platform.resolve', 'naming.sweep', 'snapshot.fanout', 'dedup.hit', 'statusbar.hydrate', 'error.normalize', 'timer.schedule', 'privacy.scrub', 'chain.cache.miss', 'workspaceStore.miss', 'client.snapshot.hit', 'detail.cache.hit', 'exec.run', 'panel.render', 'labelColors.read', 'labelColors.panelPatch', 'workspaceRoot.resolve', 'inject.decision', 'chain.stale.drop', 'snapshot.stale.drop', 'choiceStore.read', 'choiceStore.evict', 'quota.spend', 'refresh.decide', 'refresh.skipped', 'attention.report', 'attention.sweep', 'write.event', 'refresh.patch', 'chain.cache.write', 'chain.event', 'naming.guard.event', 'chain.preflight.reuse', 'snapshot.late.install', 'input.observe', 'vc.cache.screen', 'labelColors.listed', 'detection.step', 'detection.cache.hit', 'edge.cycle', 'edge.roster', 'edge.repair', 'detection.fallback', 'locale.registration', 'container.split', 'container.accent', 'write.sent']
// 退役三条 + 2026-10-12 起的第四条：choiceStore.hint.reject（#1003 删掉上报优先与修订号仲裁之后，这一档在代码里不再存在）；2026-10-19 #1083 起的第五条：sessionTickets.chain（工作路线改成新的存档之后，旧链落盘那一路不再发日志）。
const RETIRED = ['issuePath.push', 'issuePath.record', 'settings.save', 'choiceStore.hint.reject', 'sessionTickets.chain']
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
  check(appendix.includes('常驻 43 条、按需 44 条、自监控 5 条、总数 92 条'), '附录 counts 字面为常驻 43 条、按需 44 条、自监控 5 条、总数 92 条')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、80、83、88、90、92、93、94、95'), '附录常驻编号清单 43 个（不含已退役的 22、34、35，不含 45；#498 增补 51、55，#548 增补 57，#618 增补 60，#663 增补 65，#685 增补 68，#683 增补 69、70，#690 增补 74；2026-09-23 #714 增补 80 sessionTickets.chain，号位避让 #707 的 78、79；2026-09-25 #709 登记收口增补 83 chain.backoff；2026-09-25 #724 增补 88 host.dispatch.empty；#746 增补 90 naming.summary；2026-10-01 新增 93 manifest-sync；2026-10-04 #817 增补 94 git.exec 与 95 git.exec.fail —— 版本管理宿主侧 git 适配器的两条常驻事件）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91'), '附录按需编号清单 44 个（不含已退役的 8、22、34、35 等；含 45；#498 增补 52、53、54、56；#606 增补 58、59；#618 增补 61；#635 增补 62；#652 增补 63；#655 增补 64；2026-09-21 增补 66、67；#683 增补 71、72、73；2026-09-23 #706 第二批增补 75、76、77；#707 第三批增补 78 attention.report、79 attention.sweep；#710 第二批增补 81 write.event；#708 第三批增补 82 refresh.patch；2026-09-25 #709 登记收口增补 84 chain.cache.write、85 chain.event、86 naming.guard.event、87 chain.preflight.reuse；2026-09-27 #727 增补 89 snapshot.late.install；2026-09-28 #776 增补 91 input.observe）')
  check(appendix.includes('#22') && appendix.includes('#34') && appendix.includes('#35') && appendix.includes('退役'), '附录记明 #22、#34 与 #35 已退役（行保留只作追溯）')
  check(appendix.includes('46、47、48、49、50') || appendix.includes('46～50'), '附录记明自监控编号 46～50（1.6 节）')
  check(appendix.includes('常驻 43 条、按需 45 条、自监控 5 条、总数 93 条'), '附录 counts 字面为常驻 43 条、按需 45 条、自监控 5 条、总数 93 条（#864 新增 #96）')
  check(appendix.includes('89、91、96'), '附录按需编号清单含 96（#864 新增 vc.cache.screen）')
  check(appendix.includes('常驻 43 条、按需 46 条、自监控 5 条、总数 94 条'), '附录 counts 字面为常驻 43 条、按需 46 条、自监控 5 条、总数 94 条（#958 新增 #97）')
  check(appendix.includes('89、91、96、97'), '附录按需编号清单含 97（#958 新增 labelColors.listed）')
  check(appendix.includes('89、91、96、97、98'), '附录按需编号清单含 98（#1048 新增 detection.step）')
  check(appendix.includes('常驻 43 条、按需 47 条、自监控 5 条、总数 95 条'), '附录 counts 字面为常驻 43 条、按需 47 条、自监控 5 条、总数 95 条（#1131 新增 #99 detection.cache.hit）')
  check(appendix.includes('89、91、96、97、98、99'), '附录按需编号清单含 99（#1131 新增 detection.cache.hit）')
  check(appendix.includes('常驻 44 条、按需 50 条、自监控 5 条、总数 99 条'), '附录 counts 字面为常驻 44 条、按需 50 条、自监控 5 条、总数 99 条（#1054 新增 #100～#103）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、80、83、88、90、92、93、94、95、100'), '附录常驻编号清单 44 个（#1054 增补 100 edge.write，号位接在 #817 的 95 之后）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103'), '附录按需编号清单 50 个（#1054 增补 101 edge.cycle、102 edge.roster、103 edge.repair）')
  check(appendix.includes('89、91、96、97、98、99、101、102、103'), '附录按需编号清单含 101、102、103（#1054 新增三条调试线）')
  check(appendix.includes('常驻 45 条、按需 50 条、自监控 5 条、总数 100 条'), '附录 counts 字面为常驻 45 条、按需 50 条、自监控 5 条、总数 100 条（#1053 新增 #104 issue.write）')
  check(appendix.includes('常驻 45 条、按需 51 条、自监控 5 条、总数 101 条'), '附录 counts 字面为常驻 45 条、按需 51 条、自监控 5 条、总数 101 条（#1048 收口补做新增 #105 detection.fallback）')
  check(appendix.includes('101、102、103、105'), '附录按需编号清单含 105（#1048 收口补做新增 detection.fallback；号位避让同日 #1054 的 #100～#103 与 #1053 的 #104）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、80、83、88、90、92、93、94、95、100、104、106、107'), '附录常驻编号清单 47 个（#1053 增补 106 labelDefs.write 与 107 repo.init，号位接在 #104 之后）')
  check(appendix.includes('常驻 47 条、按需 51 条、自监控 5 条、总数 103 条'), '附录 counts 字面为常驻 47 条、按需 51 条、自监控 5 条、总数 103 条（#1053 增补 #106 labelDefs.write 与 #107 repo.init）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、80、83、88、90、92、93、94、95、100、104、106、107、108、109'), '附录常驻编号清单 49 个（2026-10-14 #1052 补做增补 108 read.degraded 与 109 preflight.gate，号位接在 #107 之后）')
  check(appendix.includes('常驻 49 条、按需 51 条、自监控 5 条、总数 105 条'), '附录 counts 字面为常驻 49 条、按需 51 条、自监控 5 条、总数 105 条（#1052 补做新增 #108 read.degraded 与 #109 preflight.gate）')
  check(appendix.includes('常驻 50 条、按需 51 条、自监控 5 条、总数 106 条'), '附录 counts 字面为常驻 50 条、按需 51 条、自监控 5 条、总数 106 条（2026-10-19 #1083 退役 #80 sessionTickets.chain 并增补 #110 workRoute.write 与 #111 workRoute.read）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、83、88、90、92、93、94、95、100、104、106、107、108、109、110、111'), '附录常驻编号清单 50 个（2026-10-19 #1083 退役 80、增补 110 workRoute.write 与 111 workRoute.read，号位接在 #109 之后）')
  check(appendix.includes('#110') && appendix.includes('#111') && appendix.includes('workRoute.write') && appendix.includes('workRoute.read'), '附录记明 #110 workRoute.write 与 #111 workRoute.read 两条新增常驻事件（1.4 表行保留）')
  check(appendix.includes('#80') && appendix.includes('sessionTickets.chain') && appendix.includes('已退役'), '附录记明 #80 sessionTickets.chain 已退役（行保留只作追溯）')
  check(appendix.includes('常驻 51 条、按需 52 条、自监控 5 条、总数 108 条'), '附录 counts 字面为常驻 51 条、按需 52 条、自监控 5 条、总数 108 条（2026-10-20 #1294 新增按需 #112 locale.registration 与常驻 #113 locale.registration.fail）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、83、88、90、92、93、94、95、100、104、106、107、108、109、110、111、113'), '附录常驻编号清单 51 个（2026-10-20 #1294 增补 113 locale.registration.fail，号位接在 #111 之后）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112'), '附录按需编号清单 53 个（2026-10-20 #1294 增补 112 locale.registration，号位接在 #111 之后；含已退役的 72 只作追溯，现行 52 条）')
  check(appendix.includes('#112') && appendix.includes('locale.registration') && appendix.includes('#113') && appendix.includes('locale.registration.fail'), '附录记明 #112 locale.registration 与 #113 locale.registration.fail 两条新增事件（1.4 表行保留）')
  check(appendix.includes('常驻 51 条、按需 53 条、自监控 5 条、总数 109 条'), '附录 counts 字面为常驻 51 条、按需 53 条、自监控 5 条、总数 109 条（2026-10-20 #1295 新增按需 #114 container.split，并给常驻 #10 snapshot.built 增补 specs 一格：条数不变）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112、114'), '附录按需编号清单 54 个（2026-10-20 #1295 增补 114 container.split，号位接在 #112 之后；含已退役的 72 只作追溯，现行 53 条）')
  check(appendix.includes('#114') && appendix.includes('container.split') && appendix.includes('specs 其中判成规格（实施地图）的几个'), '附录记明 #114 container.split 一条新增按需事件，并给常驻 #10 snapshot.built 增补 specs 一格（1.4 表行保留）')
check(appendix.includes('常驻 51 条、按需 54 条、自监控 5 条、总数 110 条'), '附录 counts 字面为常驻 51 条、按需 54 条、自监控 5 条、总数 110 条（2026-10-20 #1296 新增按需 #115 container.accent）')
check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112、114、115'), '附录按需编号清单 55 个（2026-10-20 #1296 增补 115 container.accent，号位接在 #114 之后；含已退役的 72 只作追溯，现行 54 条）')
check(appendix.includes('#115') && appendix.includes('container.accent'), '附录记明 #115 container.accent 一条新增按需事件（1.5 表行保留）')
// #1297：入口浮层新增两条常驻事件（一个入口 → 两张卡，打开与选卡各一行）
check(appendix.includes('常驻 53 条、按需 54 条、自监控 5 条、总数 112 条'), '附录 counts 字面为常驻 53 条、按需 54 条、自监控 5 条、总数 112 条（2026-10-20 #1297 新增常驻 #116 entry.open 与 #117 entry.pick）')
check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、83、88、90、92、93、94、95、100、104、106、107、108、109、110、111、113、116、117'), '附录常驻编号清单 53 个（2026-10-20 #1297 增补 116 entry.open 与 117 entry.pick，号位接在 #113 之后）')
check(appendix.includes('#116') && appendix.includes('entry.open') && appendix.includes('#117') && appendix.includes('entry.pick'), '附录记明 #116 entry.open 与 #117 entry.pick 两条新增常驻事件（1.4 表行保留）')
  // #1314：排查刷新日志时新增按需 #118 write.sent，并给 #76/#78/#81 三条既有事件增补字段（条数 112 → 113）
  check(appendix.includes('常驻 53 条、按需 55 条、自监控 5 条、总数 113 条'), '附录 counts 字面为常驻 53 条、按需 55 条、自监控 5 条、总数 113 条（2026-10-21 #1314 新增按需 #118 write.sent）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112、114、115、118'), '附录按需编号清单 56 个（2026-10-21 #1314 增补 118 write.sent，号位接在 #115 之后；含已退役的 72 只作追溯，现行 55 条）')
  check(appendix.includes('#118') && appendix.includes('write.sent'), '附录记明 #118 write.sent 一条新增按需事件（1.5 表行保留）')
}

// 二、源码点名：常驻 53、按需 55、自监控 5 逐个出现（单双引号都算），退役 5 条不许出现。
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
}
function collectQuotedNames() {
  const found = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      // #1095：搬家后埋点文件有 .ts（只扫 .js 会漏掉整棵新树）。存在性点名不怕同名双生（.ts 与产物 .js 各算一次命中，不影响「有没有」）。
      else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.ts'))) {
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
  // #1095：埋点跟着搬家走了（src/deck、src/tracker 新树），扫描根一起跟上；旧根不动。
  walk(path.join(ROOT, 'src', 'deck'))
  walk(path.join(ROOT, 'src', 'tracker'))
  return found
}
const quoted = collectQuotedNames()
// #1016 起的委托核对：宿主侧日志库改成直接取用已安装的 dsh-log 包之后，插件不再自带
// src/host/logPkg/ 那份副本，而 update.install.exec 这个事件名在本仓 src/ 下已无落点
// （它不是本仓代码发出的，发射器在已安装的更新包里）。本仓找不到时，到更新包的编译产物里核对
// 事件名常量与五字段用法 —— 与 tests/verify-log-fields.ts 里 #875 对该事件的委托口径一致；
// 包内也找不到仍然红，不放过。
// 2026-10-17 修：原先读 dsh-log/dist/store.js 找事件名，0.3.x 的 store.js 已是通用库、
// 不再是本插件的事件白名单，那条路找不到就静默吞掉，门禁因此假红。改读更新包的 log-events.js。
if (!quoted['update.install.exec']) {
  try {
    const evtDef = fs.readFileSync(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'shared', 'log-events.js'), 'utf8')
    const store = fs.readFileSync(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'core', 'executor.js'), 'utf8')
    if (evtDef.includes('"update.install.exec"') && store.includes('LOG_EVENT_INSTALL_EXEC')) {
      quoted['update.install.exec'] = ['node_modules/dsh-plugin-update/dist/core/executor.js（包内发射，常量名 LOG_EVENT_INSTALL_EXEC）']
    }
  } catch {}
}
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

// 三、总数：已知事件恰为 113 个（常驻 53 加按需 55 加自监控 5），退役的不计入（#1003 起 choiceStore.hint.reject 退役，2026-10-19 #1083 起 sessionTickets.chain 退役）。
{
  const known = RESIDENT.concat(ONDEMAND).concat(SELFMON)
  const missing = known.filter((n) => !quoted[n])
  const hitKnown = known.filter((n) => quoted[n])
  check(RESIDENT.length === 53 && ONDEMAND.length === 55 && SELFMON.length === 5 && known.length === 113, '清单总数 113（常驻 53、按需 55、自监控 5）')
  check(missing.length === 0, '113 个事件全部落点无缺口' + (missing.length ? ' —— 缺口：' + missing.join('、') : '（命中 ' + hitKnown.length + ' 个）'))
}

console.log(failed ? '\n存在失败 — verify-log-count 未通过' : '\n全部通过 — 计数门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
