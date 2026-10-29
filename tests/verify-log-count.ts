// verify-log-count.ts —— #494 第三件事：日志门禁之计数（#489 附录第 4 节断言六，#499 自监控 5 条并入，#548 安装执行 1 条并入，#606 按需 2 条并入，#635 按需 1 条并入，#652 按需 1 条并入，#655 按需 1 条并入，#663 常驻 1 条并入，#66 按需 1 条并入，#67 按需 1 条并入，#685 常驻 1 条并入，#690 常驻 1 条并入，#706 第二批按需 3 条并入，#714 常驻 1 条并入，#710 第二批按需 1 条并入，#707 第三批按需 2 条并入，#708 第三批按需 1 条并入，#709 登记收口 5 条并入：常驻 1 条 chain.backoff、按需 4 条 chain.cache.write / chain.event / naming.guard.event / chain.preflight.reuse，#817 版本管理宿主侧 git 适配器常驻 2 条并入：git.exec / git.exec.fail，#1054 关系与边常驻 1 条并入：edge.write，按需 3 条并入：edge.cycle / edge.roster / edge.repair，#1053 写路径常驻 1 条并入：issue.write，#1048 收口补做按需 1 条并入：detection.fallback，#1053 同日增补常驻 2 条并入：labelDefs.write / repo.init，#1083 退役常驻 1 条：sessionTickets.chain、增补常驻 2 条：workRoute.write / workRoute.read，#1294 新增按需 1 条：locale.registration、新增常驻 1 条：locale.registration.fail，#1295 新增按需 1 条：container.split、并给常驻 #10 snapshot.built 增补一格 specs，#1296 新增按需 1 条：container.accent；2026-10-29 #1627 新增常驻 8 条并入：quota.window / quota.incident / quota.detail / quota.recover / quota.sync / quota.pressure / quota.op / tool.receipt（配额与限流诊断，其中 incident 为告警级、常驻数仍按现行口径计入）。
// 用法：在插件根目录执行 node tests/verify-log-count.ts，可独立运行。
// 断言文字：常驻 60 条、按需 62 条、自监控 5 条、总数 127（2026-10-26 #1007 新增常驻 #132 gh.transport：通路失败后的冷却，设上 / 挡回 / 清零三件事各一行；2026-10-26 #1475 新增常驻 #133 chain.predicate.timeout：外层等待预算先到点、被放弃的内层谓词后来回话各一行；2026-10-21 #1101 排查新增常驻 #125 gh.lane.wait：排队放行时等到三秒以上就按桶节流记一行，回答「慢在门口还是慢在命令」；此前 2026-10-21 map 1010 wayfinder 逐票复核 新增常驻 #120 gh.auth.env、#122 guide.banner 与按需 #121 gh.lane.saturated、#123 probe.loop、#124 prompt.link；2026-10-21 本次界面反馈需求 新增按需 #119 ui.action：记用户点了页面上哪一颗按钮，target 为同屏唯一枚举、kind 为按压形状；此前 2026-10-21 #1314 排查时新增按需 #118 write.sent：每一趟取数走到闸之后的结论与花费，用 cycle 与 write.event 串起来；并给 #76 refresh.decide 增 cycle、keyHash，#78 attention.report 增 deduped，#81 write.event 增 tool、cycle、result、waitedMs；2026-10-20 #1296 新增按需 #115 container.accent（启动时按调试档记一行界面实际取到的两色：explore 是中央色表 map 值、spec 是中央色表 spec 值，用来分清「改了中央色表却没生效」是色表没改对，还是浏览器里跑的还是旧构建产物）；2026-10-20 #1295 新增按需 #114 container.split（列表页容器分拣这一趟：探索地图、规格、普通未关闭票、已关闭各几条，以及容器种类判定有没有退回文件内兜底），并给常驻 #10 snapshot.built 增补一格 specs（这一份快照里判成规格容器的几个；条数不变）；2026-10-20 #1294 新增按需 #112 locale.registration 与常驻 #113 locale.registration.fail，号位接在 #111 之后；2026-10-19 #1083 退役常驻 #80 sessionTickets.chain、增补常驻 #110 workRoute.write 与 #111 workRoute.read，号位接在 #109 之后；2026-10-14 #1053 同日增补常驻 #106 labelDefs.write 与 #107 repo.init，号位接在同日 #1048 的 #105 之后；#22、#34、#35 已退役；#618 增补常驻 #60 与按需 #61，#635 增补按需 #62，#652 增补按需 #63，#655 增补按需 #64，#663 增补常驻 #65，#67 为同日新增 snapshot.stale.drop；2026-09-22 #685 增补常驻 #68 healthCheck.inject、#683 增补 #69/#70 与按需 #71/#72/#73、#690 增补常驻 #74 issues.page；2026-09-23 #706 第二批增补按需 #75 quota.spend、#76 refresh.decide、#77 refresh.skipped；2026-09-23 #707 第三批增补按需 #78 attention.report、#79 attention.sweep —— 视野模型的两条轨迹；2026-09-23 #714 增补常驻 #80 sessionTickets.chain —— 号位接在 #707 的 79 之后；2026-09-23 #710 第二批增补按需 #81 write.event —— 号位接在 #714 的 80 之后；2026-09-23 #708 第三批增补按需 #82 refresh.patch —— 号位接在 #710 的 81 之后；2026-09-25 #709 登记收口增补常驻 #83 chain.backoff 与按需 #84 chain.cache.write、#85 chain.event、#86 naming.guard.event、#87 chain.preflight.reuse —— 号位接在 #708 的 82 之后；2026-09-25 #724 增补常驻 #88 host.dispatch.empty —— 号位接在 #709 的 83 之后；2026-09-27 #727 增补按需 #89 snapshot.late.install（迟到的快照回包里那一小块补装上了没有）—— 号位接在 #724 的 88 之后；#746 增补常驻 #90 naming.summary（首轮全文摘要的结论）—— 号位接在 #727 的 89 之后；2026-09-28 #776 增补按需 #91 input.observe（六组嫌疑的统一观测口）—— 号位接在 #746 的 90 之后；#782 增补常驻 #92 cwd.persisted（落盘补问的命中、耗时与结果）—— 号位接在 #776 的 91 之后；2026-10-01 新增常驻 #93 update.install.manifestSync（装完身份证补写，号位接在 #782 的 92 之后）；2026-10-04 #817 新增常驻 #94 git.exec 与 #95 git.exec.fail（版本管理宿主侧 git 适配器每一次 git 外部命令一行：成功与非零退出记信息级，等超时与起进程失败记告警级；号位接在 #93 之后）。这几条是「代码里早就在发、登记没跟上」或本票新加的，只补登记与埋点，不改别的事件；2026-10-14 #1048 增补按需 #98 detection.step（判定链每一步一行），#1131 增补按需 #99 detection.cache.hit（缓存命中那一行：这一次没重算，直接把上一次的判定回给了调用方），#1054 增补常驻 #100 edge.write（关系边写没写下去、走的哪条路、为什么）、按需 #101 edge.cycle、#102 edge.roster、#103 edge.repair（成环检查、邻接关系来源、REST 树边修复三条调试线）；2026-10-14 #1053 增补常驻 #104 issue.write（票的增删改评论贴标签：写没写下去、走的哪条路、为什么））；
// 增删事件必须同步更新附录对照表，否则红。
// 做法：读工作区本地附录修订版，核对 counts 字面与编号清单；
// 再扫描源码里加引号的事件名，逐个点名，退役的事件出现即红。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志计数门禁（#494/#498/#499/#548/#606/#618/#635/#652/#655/#663/#66/#67/#685/#690/#706/#707/#714/#710/#708/#709/#724/#727/#746/#776/#782/2026-10-01 新增 #93/2026-10-04 #817 新增 #94、#95/2026-10-14 #1048 新增 #98、#1131 新增 #99、#1054 新增 #100～#103、#1053 新增 #104、2026-10-14 #1048 收口补做新增 #105、同日 #1053 增补新增 #106、#107、2026-10-14 #1052 补做新增 #108、#109、2026-10-19 #1083 退役 #80 并新增 #110、#111、2026-10-20 #1294 新增 #112、#113、2026-10-20 #1295 新增 #114 container.split 并给 #10 snapshot.built 增补 specs 一格；2026-10-20 #1296 新增 #115 container.accent：常驻 53、按需 55、自监控 5、总数 113；2026-10-21 map 1010 逐票复核新增常驻 #120、#122 与按需 #121、#123、#124：常驻 55、按需 59、自监控 5、总数 119；2026-10-21 #1101 排查新增常驻 #125 gh.lane.wait 之后为常驻 56、按需 59、自监控 5、总数 120，与附录修订版字面一致；2026-10-22 #1363/#1220 增常驻 #126 chain.flow 并把 #123 probe.loop 提升为常驻后为常驻 58、按需 58、自监控 5、总数 121；2026-10-23 #1409 新增按需 #127 suggest.bind、#128 suggest.call、#129 suggest.ready 后为常驻 58、按需 61、自监控 5、总数 124；2026-10-25 #1514 新增按需 #131 preflight.check（Markdown 三项环境判据 md:workspace / md:scratchWritable / md:containersReadable 各一行）后为常驻 58、按需 62、自监控 5、总数 125；2026-10-26 #1007 新增常驻 #132 gh.transport 后为常驻 59、按需 62、自监控 5、总数 126；2026-10-26 #1475 新增常驻 #133 chain.predicate.timeout（外层等待预算先到点、被放弃的内层谓词后来回话各一行）后为常驻 60、按需 62、自监控 5、总数 127；2026-10-29 #1627 新增常驻 #136～#143 配额与限流诊断八条后为常驻 69、按需 63、自监控 5、总数 137；2026-10-29 #1640 新增常驻 #144 settings.merge 后为常驻 70、按需 63、自监控 5、总数 138；2026-10-29 #1642 新增常驻 #145 settings.toggle 与 #146 settings.merge.fail 后为常驻 72、按需 63、自监控 5、总数 140）')

// 附录对照表里的现行清单（1.3 落定后常驻 27 条，#498 增补 #51 与 #55 成 29 条，#548 增补 #57 成 30 条，#618 增补 #60 成 31 条，
// #663 增补 #65 成 32 条；2026-09-21 #35 settings.save 退役成 31 条，#685 增补 #68 成 32 条，#683 增补 #69、#70 成 34 条，
// #690 增补 #74 issues.page 成 35 条，#714 增补 #80 sessionTickets.chain 成 36 条，
// 2026-09-25 #709 登记收口增补 #83 chain.backoff 成 37 条；#724 增补 #88 host.dispatch.empty 成 38 条；2026-10-04 #817 增补 #94 git.exec 与 #95 git.exec.fail 成 43 条（版本管理宿主侧 git 适配器每一次 git 外部命令一行）；2026-10-14 #1054 增补 #100 edge.write 成 44 条（关系边写没写下去、走的哪条路、为什么，一趟一行）；2026-10-14 #1053 增补 #104 issue.write 成 45 条（票的增删改评论贴标签：写没写下去、走的哪条路、为什么，一趟一行）；2026-10-14 #1053 同日增补 #106 labelDefs.write 与 #107 repo.init 成 47 条（标签定义改写与开仓发布各自的结论线，三条事件共用同一份机制 write-log.ts）；2026-10-14 #1052 补做增补 #108 read.degraded 与 #109 preflight.gate 成 49 条（读路径「本来能成、这一趟没成或成得不完整」的结论线，与探测三项门禁每过一关一行的过关门线；2026-10-19 #1083 再退役 #80 sessionTickets.chain 并增补 #110 workRoute.write、#111 workRoute.read 之后为 50 条；2026-10-20 #1294 增补 #113 locale.registration.fail 之后为 51 条；2026-10-20 #1295 给 #10 snapshot.built 增补 specs 一格，条数不变；2026-10-21 map 1010 逐票复核增补 #120 gh.auth.env、#122 guide.banner 之后为 55 条；2026-10-21 #1101 排查增补 #125 gh.lane.wait 之后为 56 条）。另有 3 条已退役只作追溯；加上 #1083 的 #80 共 4 条只作追溯）。
// 2026-10-22（#1363/#1220）：新增常驻 #126 chain.flow，并把按需 #123 probe.loop 提升为常驻（编号与字段
//   表不变，新增 timerOk 一格）。两条都服务同一件事：查「状态栏该出条却没出、初始化完了条还在」。
const RESIDENT = ['snapshot.request', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec', 'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback', 'snapshot.built', 'panelSync.dirty', 'registry.select', 'detection.detect', 'skill.probe', 'skill.pending.cap', 'host.call', 'host.call.fail', 'snapshot.hydrate', 'backend.switch', 'naming.guard', 'naming.lock', 'panel.open', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail', 'chain.derive.error', 'fallback.chain', 'client.snapshot.miss', 'host.start', 'update.install.exec', 'labelColors.write', 'guide.inject', 'healthCheck.inject', 'choiceStore.file.bad', 'choiceStore.write.fail', 'issues.page', 'chain.backoff', 'host.dispatch.empty', 'naming.summary', 'cwd.persisted', 'update.install.manifestSync', 'git.exec', 'git.exec.fail', 'edge.write', 'issue.write', 'labelDefs.write', 'repo.init', 'read.degraded', 'preflight.gate', 'workRoute.write', 'workRoute.read', 'locale.registration.fail', 'entry.open', 'entry.pick', 'gh.auth.env', 'guide.banner', 'gh.lane.wait', 'chain.flow', 'probe.loop', 'gh.transport', 'chain.predicate.timeout', 'newsession.decide', 'quota.window', 'quota.incident', 'quota.detail', 'quota.recover', 'quota.sync', 'quota.pressure', 'quota.op', 'tool.receipt', 'settings.merge', 'settings.toggle', 'settings.merge.fail']
// 按需 63 条编号（#498 增补 #52、#53、#54、#56，#606 增补 #58、#59，#618 增补 #61，#635 增补 #62，#652 增补 #63，#655 增补 #64，#66 为 2026-09-21 新增 chain.stale.drop，#67 为同日新增 snapshot.stale.drop，#71、#72、#73 为 2026-09-22 #683 新增，#75、#76、#77 为 2026-09-23 #706 第二批新增，#78、#79 为同一天 #707 第三批新增 attention.report / attention.sweep，#81 为同一天 #710 第二批新增 write.event，#82 为同一天 #708 第三批新增 refresh.patch，#84、#85、#86、#87 为 2026-09-25 #709 登记收口新增，#89 为 2026-09-27 #727 新增 snapshot.late.install，#91 为 2026-09-28 #776 新增 input.observe，#96 为 2026-10-05 #864 新增 vc.cache.screen，#97 为 2026-10-09 #958 新增 labelColors.listed，#98 为 2026-10-14 #1048 新增 detection.step，#99 为 2026-10-14 #1131 新增 detection.cache.hit，#101、#102、#103 为 2026-10-14 #1054 新增 edge.cycle / edge.roster / edge.repair，#105 为 2026-10-14 #1048 收口补做新增 detection.fallback —— 号位避让同票的常驻 #100 edge.write 与 #1053 的 #104 issue.write；2026-10-20 #1294 增补 #112 locale.registration；2026-10-20 #1295 增补 #114 container.split；2026-10-20 #1296 增补 #115 container.accent；2026-10-21 #1314 排查时新增 #118 write.sent；2026-10-21 map 1010 逐票复核增补 #121 gh.lane.saturated、#123 probe.loop、#124 prompt.link；2026-10-23 #1409 新增 #127 suggest.bind、#128 suggest.call、#129 suggest.ready；2026-10-25 #1514 新增 #131 preflight.check）：含 #45，不含已退役。
const ONDEMAND = ['snapshot.cache.hit', 'probe.eval', 'panelSync.eval', 'registry.stub', 'workspaceStore.hit', 'chain.cache.hit', 'chain.predicate', 'workspaceKey.canonical', 'platform.resolve', 'naming.sweep', 'snapshot.fanout', 'dedup.hit', 'statusbar.hydrate', 'error.normalize', 'timer.schedule', 'privacy.scrub', 'chain.cache.miss', 'workspaceStore.miss', 'client.snapshot.hit', 'detail.cache.hit', 'exec.run', 'panel.render', 'labelColors.read', 'labelColors.panelPatch', 'workspaceRoot.resolve', 'inject.decision', 'chain.stale.drop', 'snapshot.stale.drop', 'choiceStore.read', 'choiceStore.evict', 'quota.spend', 'refresh.decide', 'refresh.skipped', 'attention.report', 'attention.sweep', 'write.event', 'refresh.patch', 'chain.cache.write', 'chain.event', 'naming.guard.event', 'chain.preflight.reuse', 'snapshot.late.install', 'input.observe', 'vc.cache.screen', 'labelColors.listed', 'detection.step', 'detection.cache.hit', 'edge.cycle', 'edge.roster', 'edge.repair', 'detection.fallback', 'locale.registration', 'container.split', 'container.accent', 'write.sent', 'ui.action', 'gh.lane.saturated', 'prompt.link', 'suggest.bind', 'suggest.call', 'suggest.ready', 'preflight.check', 'chain.auto.retry']
// 2026-10-22（#1363/#1220）：#123 probe.loop 从这张表提升为常驻，按需清单不再含它。
// 2026-10-23（#1409）：新增 #127 suggest.bind、#128 suggest.call、#129 suggest.ready 三条按需调试线。
// 退役三条 + 2026-10-12 起的第四条：choiceStore.hint.reject（#1003 删掉上报优先与修订号仲裁之后，这一档在代码里不再存在）；2026-10-19 #1083 起的第五条：sessionTickets.chain（工作路线改成新的存档之后，旧链落盘那一路不再发日志）。
const RETIRED = ['issuePath.push', 'issuePath.record', 'settings.save', 'choiceStore.hint.reject', 'sessionTickets.chain']
// 自监控 5 条（#499，附录 1.6 节，编号 46～50，错误与告警级、始终落盘）。
const SELFMON = ['host.dispatch.error', 'log.persist.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail']
// #1143 包拥有事件白名单：dsh-log 升到 0.4.1 后，旧实现三件套（src/host/logStore.ts、src/host/logPhones.ts、src/client/kernel/log.ts）已删除，
// 这四个事件的发射点搬进了已安装的 dsh-log 包内，全仓扫不到是正常的，不算缺口；白名单之外的事件仍按老口径全仓扫。
// 包内发射点实测（dsh-log 0.4.1，亲手 grep 到发射行）：
// · host.start —— node_modules/dsh-log/dist/store.js 第 364 行 log('info', 'host.start', fields)，字段由同文件第 333 行 writeStartupHeader 组装，入口 node_modules/dsh-log/dist/node.js 第 91 行建库时自动调用；
// · log.forward.summary —— node_modules/dsh-log/dist/client/forward.js 第 40 行 logDiagnostic('warn', 'log.forward.summary', fields)（maybeForwardSummary，有新增丢弃才记一行）；
// · log.switch.watchdog —— 同文件第 92 行 logDiagnostic('warn', 'log.switch.watchdog', { op, timeoutMs, stage })（watchSwitchOp 看门狗 5 秒先到才记）；
// · log.export.fail —— 同文件第 66 行 logDiagnostic('warn', 'log.export.fail', { op, reason, errorHash })（logExportFail 失败分支才记，只散列不记原文）。
const PACKAGE_OWNED = ['host.start', 'log.forward.summary', 'log.switch.watchdog', 'log.export.fail']

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
  // 本次界面反馈需求：全清单控件点击定位日志新增按需 #119 ui.action（条数 113 → 114）
  check(appendix.includes('常驻 53 条、按需 56 条、自监控 5 条、总数 114 条'), '附录 counts 字面为常驻 53 条、按需 56 条、自监控 5 条、总数 114 条（2026-10-21 本次界面反馈需求 新增按需 #119 ui.action）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112、114、115、118、119'), '附录按需编号清单 57 个（2026-10-21 本次界面反馈需求 增补 119 ui.action，号位接在 #118 之后；含已退役的 72 只作追溯，现行 56 条）')
  check(appendix.includes('#119') && appendix.includes('ui.action'), '附录记明 #119 ui.action 一条新增按需事件（1.5 表行保留）')
  // 2026-10-21 map 1010 逐票复核：新增常驻 #120 gh.auth.env、#122 guide.banner 与按需 #121 gh.lane.saturated、#123 probe.loop、#124 prompt.link（条数 114 → 119）
  check(appendix.includes('常驻 55 条、按需 59 条、自监控 5 条、总数 119 条'), '附录 counts 字面为常驻 55 条、按需 59 条、自监控 5 条、总数 119 条（2026-10-21 map 1010 逐票复核 新增常驻 #120、#122 与按需 #121、#123、#124）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、83、88、90、92、93、94、95、100、104、106、107、108、109、110、111、113、116、117、120、122'), '附录常驻编号清单 55 个（2026-10-21 map 1010 逐票复核 增补 120 gh.auth.env 与 122 guide.banner，号位接在 #117 之后）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112、114、115、118、119、121、123、124'), '附录按需编号清单 59 个（2026-10-21 map 1010 逐票复核 增补 121 gh.lane.saturated、123 probe.loop、124 prompt.link，号位接在 #119 之后；含已退役的 72 只作追溯，现行 59 条）')
  check(appendix.includes('#120') && appendix.includes('gh.auth.env') && appendix.includes('#122') && appendix.includes('guide.banner') && appendix.includes('#121') && appendix.includes('gh.lane.saturated') && appendix.includes('#123') && appendix.includes('probe.loop') && appendix.includes('#124') && appendix.includes('prompt.link'), '附录记明 #120 gh.auth.env、#122 guide.banner、#121 gh.lane.saturated、#123 probe.loop、#124 prompt.link 五条新增事件（1.4/1.5 表行保留）')
  // 2026-10-21 #1101 排查：新增常驻 #125 gh.lane.wait（排队等到三秒以上、按桶节流），条数 119 → 120
  check(appendix.includes('常驻 56 条、按需 59 条、自监控 5 条、总数 120 条'), '附录 counts 字面为常驻 56 条、按需 59 条、自监控 5 条、总数 120 条（2026-10-21 #1101 排查新增常驻 #125 gh.lane.wait）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、83、88、90、92、93、94、95、100、104、106、107、108、109、110、111、113、116、117、120、122、125'), '附录常驻编号清单 56 个（2026-10-21 #1101 排查增补 125 gh.lane.wait，号位接在 #122 之后）')
  check(appendix.includes('#125') && appendix.includes('gh.lane.wait'), '附录记明 #125 gh.lane.wait 一条新增常驻事件（1.4 表行保留）')
  // 2026-10-22（#1363/#1220）：新增常驻 #126 chain.flow，并把按需 #123 probe.loop 提升为常驻（编号与字段
  //   表不变、新增 timerOk 一格），总数 120 → 121（常驻 56 → 58，按需 59 → 58）。
  check(appendix.includes('常驻 58 条、按需 58 条、自监控 5 条、总数 121 条'), '附录 counts 字面为常驻 58 条、按需 58 条、自监控 5 条、总数 121 条（2026-10-22 #1363/#1220 新增常驻 #126 chain.flow，并把按需 #123 probe.loop 提升为常驻）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、83、88、90、92、93、94、95、100、104、106、107、108、109、110、111、113、116、117、120、122、123、125、126'), '附录常驻编号清单 58 个（2026-10-22 #1363/#1220 增补 126 chain.flow，并把 123 probe.loop 从按需提升为常驻）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112、114、115、118、119、121、124'), '附录按需编号清单 58 个（2026-10-22 #1363/#1220 起 #123 probe.loop 提升为常驻；共 59 个编号，其中 72 已退役、行保留只作追溯，现行 58 条）')
  check(appendix.includes('#126') && appendix.includes('chain.flow') && appendix.includes('timerOk'), '附录记明 #126 chain.flow 一条新增常驻，并给 #123 probe.loop 增补 timerOk（1.4 表行）')
  // 2026-10-23 #1409：界面借会话事件流取数的三条按需调试线 #127 suggest.bind、#128 suggest.call、
  //   #129 suggest.ready，总数 121 → 124（常驻 58 不变、按需 58 → 61、自监控 5 条不动）。
  check(appendix.includes('常驻 58 条、按需 61 条、自监控 5 条、总数 124 条'), '附录 counts 字面为常驻 58 条、按需 61 条、自监控 5 条、总数 124 条（2026-10-23 #1409 新增按需 #127 suggest.bind、#128 suggest.call、#129 suggest.ready）')
  check(appendix.includes('2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64、66、67、71、72、73、75、76、77、78、79、81、82、84、85、86、87、89、91、96、97、98、99、101、102、103、105、112、114、115、118、119、121、124、127、128、129'), '附录按需编号清单 61 个（2026-10-23 #1409 增补 127 suggest.bind、128 suggest.call、129 suggest.ready，号位接在 #124 之后；含已退役的 72 只作追溯）')
  check(appendix.includes('#127') && appendix.includes('suggest.bind') && appendix.includes('#128') && appendix.includes('suggest.call') && appendix.includes('#129') && appendix.includes('suggest.ready'), '附录记明 #127 suggest.bind、#128 suggest.call、#129 suggest.ready 三条新增按需事件（1.5 表行保留）')
  // 2026-10-25 #1514：Markdown 三项环境判据各落一行的按需调试线 #131 preflight.check，总数 124 → 125
  //   （常驻 58 不变、按需 61 → 62、自监控 5 条不动）。它不并进常驻 #109 preflight.gate：那条 gate 是 GitHub
  //   三项门禁、reason 过了一律 'ok'，装不下别的房的判据与证据；三项判据每次识别都跑，常驻就是每拍三行心跳。
  check(appendix.includes('常驻 58 条、按需 62 条、自监控 5 条、总数 125 条'), '附录 counts 字面为常驻 58 条、按需 62 条、自监控 5 条、总数 125 条（2026-10-25 #1514 新增按需 #131 preflight.check）')
  check(appendix.includes('127、128、129、131'), '附录按需编号清单接续到 131（2026-10-25 #1514 新增 preflight.check；#130 read.session 由上一票 #1444 单独登记在 1.5 表，不进这份清单）')
  check(appendix.includes('#131') && appendix.includes('preflight.check'), '附录记明 #131 preflight.check 一条新增按需事件（1.5 表行保留）')
  // 2026-10-26 #1007：新增常驻 #132 gh.transport（通路失败后设冷却、冷却里挡回、拿到退出码清零），
  //   总数 125 → 126（常驻 58 → 59、按需 62 不动、自监控 5 条不动）。
  check(appendix.includes('常驻 59 条、按需 62 条、自监控 5 条、总数 126 条'), '附录 counts 字面为常驻 59 条、按需 62 条、自监控 5 条、总数 126 条（2026-10-26 #1007 新增常驻 #132 gh.transport）')
  check(appendix.includes('1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、36、38、39、40、41、42、51、55、57、60、65、68、69、70、74、83、88、90、92、93、94、95、100、104、106、107、108、109、110、111、113、116、117、120、122、123、125、126、132'), '附录常驻编号清单 59 个（2026-10-26 #1007 增补 132 gh.transport，号位接在 #126 之后）')
  check(appendix.includes('#132') && appendix.includes('gh.transport'), '附录记明 #132 gh.transport 一条新增常驻事件（1.4 表行保留）')
  // 2026-10-26 #1475：外层等待预算到点与被放弃的内层谓词迟到回话各记一行常驻事件；事件号原定 #132，合入时 #132 已由先合入 main 的 #1007 gh.transport 占用，本事件改用 #133。
  const counts1475 = appendix.includes('常驻 60 条、按需 62 条、自监控 5 条、总数 127 条')
  check(counts1475, '附录 counts 字面为常驻 60 条、按需 62 条、自监控 5 条、总数 127 条（2026-10-26 #1475 新增常驻 #133 chain.predicate.timeout）')
  const list1475 = appendix.includes('125、126、132、133') && appendix.includes('（共 60 条')
  check(list1475, '附录常驻编号清单 60 个（2026-10-26 #1475 增补 133 chain.predicate.timeout；#132 号位由先合入的 #1007 gh.transport 占用）')
  const event1475 = appendix.includes('#133') && appendix.includes('chain.predicate.timeout')
  check(event1475, '附录记明 #133 chain.predicate.timeout 一条新增常驻事件（1.4 表行保留）')
  // 2026-10-27 #1580：新增常驻 #134 newsession.decide（新会话决策链：入口、cwd 来源、工作区解析出处、
  //   复用还是新建、草稿落点、成败）。这一行就是「新会话没选中工作区、注入丢失」下次复发时的取证锚点，
  //   总数 127 → 128（常驻 60 → 61、按需 62 不动、自监控 5 条不动）。
  const counts1580 = appendix.includes('常驻 61 条、按需 62 条、自监控 5 条、总数 128 条')
  check(counts1580, '附录 counts 字面为常驻 61 条、按需 62 条、自监控 5 条、总数 128 条（2026-10-27 #1580 新增常驻 #134 newsession.decide）')
  const list1580 = appendix.includes('125、126、132、133、134') && appendix.includes('（共 61 条')
  check(list1580, '附录常驻编号清单 61 个（2026-10-27 #1580 增补 134 newsession.decide，号位接在 #133 之后）')
  const event1580 = appendix.includes('#134') && appendix.includes('newsession.decide')
  check(event1580, '附录记明 #134 newsession.decide 一条新增常驻事件（1.4 表行保留）')
  // 2026-10-28 #1474：新增按需 #135 chain.auto.retry（自动复查被冷却窗挡下、或被同一把链键上的上一轮
  //   自动复查挡下各记一行），总数 128 → 129（常驻 61 不动、按需 62 → 63、自监控 5 条不动）。
  const counts1474 = appendix.includes('常驻 61 条、按需 63 条、自监控 5 条、总数 129 条')
  check(counts1474, '附录 counts 字面为常驻 61 条、按需 63 条、自监控 5 条、总数 129 条（2026-10-28 #1474 新增按需 #135 chain.auto.retry）')
  const list1474 = appendix.includes('127、128、129、131、135')
  check(list1474, '附录按需编号清单接续到 135（2026-10-28 #1474 新增 chain.auto.retry，号位接在 #131 之后）')
  const event1474 = appendix.includes('#135') && appendix.includes('chain.auto.retry')
  check(event1474, '附录记明 #135 chain.auto.retry 一条新增按需事件（1.5 表行保留）')
  // 2026-10-29 #1627：配额与限流诊断一次加到位。五条核心常驻（quota.window / quota.incident / quota.recover /
  //   quota.sync / quota.pressure）在调试开关关着时就能回答五问；另外三条（quota.detail / quota.op /
  //   tool.receipt）是逐笔明细，出事时提升到信息级。总数 129 → 137（常驻 61 → 69、按需 63 不动）。
  const counts1627 = appendix.includes('常驻 69 条、按需 63 条、自监控 5 条、总数 137 条')
  check(counts1627, '附录 counts 字面为常驻 69 条、按需 63 条、自监控 5 条、总数 137 条（2026-10-29 #1627 新增常驻 #136～#143 八条）')
  const list1627 = appendix.includes('134、136、137、138、139、140、141、142、143') && appendix.includes('（共 69 条')
  check(list1627, '附录常驻编号清单 69 个（2026-10-29 #1627 增补 136～143，号位接在 #134 之后；#135 是按需事件不算常驻）')
  const events1627 = appendix.includes('#136') && appendix.includes('quota.window') && appendix.includes('#137') && appendix.includes('quota.incident') && appendix.includes('#138') && appendix.includes('quota.detail') && appendix.includes('#139') && appendix.includes('quota.recover') && appendix.includes('#140') && appendix.includes('quota.sync') && appendix.includes('#141') && appendix.includes('quota.pressure') && appendix.includes('#142') && appendix.includes('quota.op') && appendix.includes('#143') && appendix.includes('tool.receipt')
  check(events1627, '附录记明 #136～#143 八条新增常驻事件（配额与限流诊断，1.4 表行保留）')
  // 2026-10-29 #1640：设置页名单上的临时记录在认出工作区根以后合并到根那一条。合并这一行日志等写成功才发，
  //   写失败时磁盘上仍是两处分家、日志里也不留假话。总数 137 → 138（常驻 69 → 70、按需 63 不动）。
  const counts1640 = appendix.includes('常驻 70 条、按需 63 条、自监控 5 条、总数 138 条')
  check(counts1640, '附录 counts 字面为常驻 70 条、按需 63 条、自监控 5 条、总数 138 条（2026-10-29 #1640 新增常驻 #144 settings.merge）')
  const list1640 = appendix.includes('142、143、144（共 70 条')
  check(list1640, '附录常驻编号清单 70 个（2026-10-29 #1640 增补 144，号位接在 #143 之后）')
  const events1640 = appendix.includes('#144') && appendix.includes('settings.merge')
  check(events1640, '附录记明 #144 settings.merge 一条新增常驻事件（临时记录合并到根那一条的结论，1.4 表行保留）')
  // 2026-10-29 #1642：设置页两格文字开关（胶囊状态栏 / deck 工具箱）点一下的路径补常驻结论线；合并这一趟写失败时
  //   另发一条告警，回答「盘上为什么还留着一处分家」。总数 138 → 140（常驻 70 → 72、按需 63 不动）。
  const counts1642 = appendix.includes('常驻 72 条、按需 63 条、自监控 5 条、总数 140 条')
  check(counts1642, '附录 counts 字面为常驻 72 条、按需 63 条、自监控 5 条、总数 140 条（2026-10-29 #1642 新增常驻 #145 settings.toggle 与 #146 settings.merge.fail）')
  const list1642 = appendix.includes('144、145、146（共 72 条')
  check(list1642, '附录常驻编号清单 72 个（2026-10-29 #1642 增补 145、146，号位接在 #144 之后）')
  const events1642 = appendix.includes('#145') && appendix.includes('settings.toggle') && appendix.includes('#146') && appendix.includes('settings.merge.fail')
  check(events1642, '附录记明 #145 settings.toggle 与 #146 settings.merge.fail 两条新增常驻事件（点按路径与合并失败，1.4 表行保留）')
}

// 二、源码点名：常驻 61、按需 63、自监控 5 逐个出现（单双引号都算），退役 5 条不许出现。
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
  // #1426：刷新埋点跟着宿主房搬进 src/refresh/rooms/host/，扫描根一起跟上；旧根不动。
  walk(path.join(ROOT, 'src', 'refresh'))
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
// #1143 包拥有事件核对：白名单里的四个事件到 dsh-log 包内编译产物里核对发射点（读包文件文本断言，不调用包）。
// 缺口只认“全仓扫不到 + 又不在白名单里”；白名单事件在这里补上包内落点后，后面按名单逐个点的断言与总数断言照旧全过。
for (const name of PACKAGE_OWNED) {
  if (quoted[name]) continue
  try {
    const storeText = fs.readFileSync(path.join(ROOT, 'node_modules', 'dsh-log', 'dist', 'store.js'), 'utf8')
    const forwardText = fs.readFileSync(path.join(ROOT, 'node_modules', 'dsh-log', 'dist', 'client', 'forward.js'), 'utf8')
    if (name === 'host.start' && storeText.includes("'host.start'") && storeText.includes('writeStartupHeader')) {
      quoted[name] = ['node_modules/dsh-log/dist/store.js（包内发射，writeStartupHeader 写启动头）']
    } else if (name === 'log.forward.summary' && forwardText.includes("'log.forward.summary'")) {
      quoted[name] = ['node_modules/dsh-log/dist/client/forward.js（包内发射，maybeForwardSummary 汇总行）']
    } else if (name === 'log.switch.watchdog' && forwardText.includes("'log.switch.watchdog'")) {
      quoted[name] = ['node_modules/dsh-log/dist/client/forward.js（包内发射，watchSwitchOp 看门狗）']
    } else if (name === 'log.export.fail' && forwardText.includes("'log.export.fail'")) {
      quoted[name] = ['node_modules/dsh-log/dist/client/forward.js（包内发射，logExportFail 失败分支）']
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

// 三、总数：已知事件恰为 140 个（常驻 72 加按需 63 加自监控 5），退役的不计入（#1003 起 choiceStore.hint.reject 退役，2026-10-19 #1083 起 sessionTickets.chain 退役）。
{
  const known = RESIDENT.concat(ONDEMAND).concat(SELFMON)
  const missing = known.filter((n) => !quoted[n] && !PACKAGE_OWNED.includes(n))
  const hitKnown = known.filter((n) => quoted[n])
  check(RESIDENT.length === 72 && ONDEMAND.length === 63 && SELFMON.length === 5 && known.length === 140, '清单总数 140（常驻 72、按需 63、自监控 5）')
  check(missing.length === 0, '140 个事件全部落点无缺口' + (missing.length ? ' —— 缺口：' + missing.join('、') : '（命中 ' + hitKnown.length + ' 个）'))
}

console.log(failed ? '\n存在失败 — verify-log-count 未通过' : '\n全部通过 — 计数门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
