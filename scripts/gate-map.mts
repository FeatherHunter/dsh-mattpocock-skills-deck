#!/usr/bin/env node
// scripts/gate-map.mts —— 门禁归属表生成器（#1252 由同名 .mjs 转写而来），运行时行为零变化。
//
// 迁移说明（#1252）：原文件为 scripts/gate-map.mjs，本文件只加类型、行为零变化，运行时语义与原文件完全一致。
// 切口已完成：generatedBy 写 'node scripts/gate-map.mts'，用法注释里的文件名已同步翻新。
// scripts/gate-map.mts —— 门禁归属表生成器：算出「每扇门禁守着哪些源码路径」，写进 tests/gate-map.json。
//
// 为什么要有它：
//   主链是三百来步的长链（名单走规划函数：目录约定加显式排除表，#1125）。
//   改一个文件就把整条链跑一遍太贵，维护者要的是「改了 E 目录的代码，就只跑守着 E、
//   守着它的父目录 B、再上一级 A 的门禁」。要按这个规则挑门禁，先得有一张表回答
//   「每扇门禁守着哪些目录」。本脚本生成这张表，scripts/lib/select-gates.mts 用它挑门禁。
//
// 用法（在仓库根目录跑）：
//   node scripts/gate-map.mts            重新推导并写入 tests/gate-map.json
//   node scripts/gate-map.mts --print    只把结果打到屏幕上，不写文件
//
// 归属的来源，按可信度从高到低：
//   1. 文件头写了 `// 门禁归属: <相对路径>` 这类注释——以它为准，其它来源一律不看；
//   2. 读文件：readFileSync(...)、readFile(...)，含 path.join(ROOT, 'a', 'b') 这种拼接写法；
//   3. 载入模块：require('...')、import('...')、import(pathToFileURL(path.join(ROOT, ...)).href)；
//   4. 静态 import / export ... from 的说明符里指向本仓源码的路径；
//   5. 兜底：文件里出现的、指向本仓源码目录、而且磁盘上真实存在的字符串字面量。
//      很多门禁用数组列出它要检查的文件，例如 'src/client/views/versionControl/vcRows.js'，
//      只有这一条能认出它们。
//   上面五条都推不出指向源码的路径时，这扇门禁记成 unattributed，并在 reason 里写明原因。
//
// 产物 tests/gate-map.json 的字段：
//   gates      主链（规划函数给的名单）每步一条：{ step, file, guards, dirs, unattributed, reason,
//                              completionRecord, expectedAssertions }
//              completionRecord 为 true 表示这扇门禁已开闸：它收尾时会交一行 GATE-RESULT，
//              expectedAssertions 是它该有多少条断言（0 表示还没开闸，执行器只看退出码）。
//              这两格是给执行器判「完成证据」用的（#1158），名单见 COMPLETION_RECORDED_GATES。
//   smokeGates 冒烟链（scripts.smoke，今天五条）每步一条：{ step, file, gate, completionRecord, expectedAssertions }。
//              冒烟链不在主链上，所以它不参与归属与覆盖面（那两样只看 gates）；这几条只是把
//              「冒烟里哪几扇开闸了、该有多少条断言」也写进同一张表，好让 test:smoke 那条路
//              （#1178 起走 scripts/verify-chain.ts --script smoke）拿同一份判据对数。
//              名单见 SMOKE_COMPLETION_RECORDED_GATES。
//   byDir      目录 → 守着这一层的门禁清单。「这一层」指门禁守的路径正好在这个目录里，不含子目录。
//              每个被守着的目录，它的祖先目录也会建键（可能是空数组），
//              所以「改了 E 要跑 E、B、A 三层」可以顺着 E 的目录一路往上查表，不会查空。
//   coverage   src/ 下每个文件和目录有没有门禁守着；没被守着的进 ungated 并写明原因
//   generatedAt / chainLength 之类的元信息

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { planGates, readSmokeCommands, commandTestFile } from './lib/discover-gates.ts'

// 类型声明只在转译时剥掉，不产生运行时代码。
type RepoIndex = { files: Set<string>; dirs: Set<string> }
interface CodeLiteral { value: string; start: number; end: number }
interface ScanResult { literals: CodeLiteral[]; masked: string }
interface DeriveResult { guards: string[]; tiers: Record<string, number>; directive: boolean; unattributed: boolean; reason: string }
interface GateEntry { step: string; file: string; guards: string[]; dirs: string[]; unattributed: boolean; buildOutputOnly: boolean; completionRecord: boolean; expectedAssertions: number; reason: string }
interface SmokeGateEntry { step: string; file: string; gate: string; completionRecord: boolean; expectedAssertions: number }
interface CoverageUngated { path: string; reason: string }
interface CoverageDirInfo { path: string; fileCount: number }
interface CoverageResult { sourceRoot: string; fileCount: number; dirCount: number; coveredFileCount: number; ungatedFileCount: number; ungatedDirCount: number; dedicatedDirCount: number; guardedFiles: string[]; guardedDirs: string[]; dedicatedDirs: string[]; dirsWithoutDedicated: CoverageDirInfo[]; ungated: CoverageUngated[]; ungatedDirs: CoverageUngated[] }
interface GateMap { version: number; generatedAt: string; generatedBy: string; chainLength: number; gateCount: number; attributedGates: number; unattributedGates: number; buildOutputOnlyGates: number; completionRecordedGates: number; smokeLength: number; smokeCompletionRecordedGates: number; graphFileCount: number; gates: GateEntry[]; smokeGates: SmokeGateEntry[]; byDir: Record<string, string[]>; coverage: CoverageResult }
interface ImportGraph { imports: Map<string, any>; importedBy: Map<string, any> }

export const ROOT: string = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
export const MAP_PATH: string = path.join(ROOT, 'tests', 'gate-map.json')

// ---------------------------------------------------------------------------
// 完成证据（#1158）：已经开闸的门禁，以及它该有多少条断言
// ---------------------------------------------------------------------------
// 开闸 = 这扇门禁收尾时会交一行 GATE-RESULT（写法见 tests/lib/gate-result.ts），
// 三条执行器据此判它「跑完了没有」——只看退出码会被「跑到一半就收摊、退出码仍是 0」骗过去。
//
// 这一格就是进度表本身，不另建基线文件：写在这里 = 已开闸，值 = 期望条数。
// 值必须是实测出来的（把门禁单跑一遍，读它收尾那一行的计数），不是估的：
//   期望比实际大 = 门禁提前收摊，判红（这正是这条判据要抓的那类故障）；
//   期望比实际小 = 有人加了断言却忘了改这里，也判红，顺手把数字改准。
// 还没开闸的门禁一律不许写在这里 —— 编一个数字出来，真红就会变假绿。
export const COMPLETION_RECORDED_GATES: Record<string, number> = {
  // 2026-10-31 #1737（规格 #1586 T02）：能力账本 162 条单一数据源 + 生成器对账 + 反证组，
  // 分四组：生成物新鲜 5、账本形状 27、版本可用性 1、反证 9，单跑实测 42 条。
  'verify-1586-capability-ledger': 42,
  // 2026-10-31 #1738（规格 #1586 T03）：版本管理页骨架的真浏览器门禁——管理页九分区、命令面板、
  // 四档宽（300/380/460/520）× 两皮肤（深/浅）逐档渲染，量横向溢出、页签单行、每页主入口数、
  // 关键句不被截断；最后用「根节点强加 640px 最小宽度后 300 宽必须量出溢出」的反证证明量尺有效。
  // 2026-10-31 #1744（规格 #1586 T09）：同一扇门禁扩了提交历史页的列表、详情、逐文件差异与图形视图，
  // 单跑实测从 118 条涨到 202 条，期望值跟着改。
  'verify-1586-vc-visual-browser': 202,
  // 2026-10-31 #1739（规格 #1586 T04）：首屏一次取全——七片一份版本化快照、一次聚合调用、单片失败
  // 各自独立态与重试、刷新三时机；真宿主聚合与反证组也在这一扇里，单跑实测 85 条。
  'verify-1586-first-screen': 85,
  // 2026-10-31 #1740（规格 #1586 T05）：长任务通道——开始/查询/取消三件宿主电话、四类结论、
  // 阶段与进度（解析不出百分比就显示不确定）、软取消与残留、重启后如实说中断、在途去重、
  // fast-import 输入文件引用走宿主真校验、七个登记点与 4 条反证，单跑实测 136 条。
  'verify-1586-task-channel': 136,
  // 2026-10-29 #1600：词表里 gate.wipNotice 已退役（GitLab 可用后不再有「筹备中」注解），
  // 这扇改成先钉「键已不在词表里」、再钉「初始化小卡上不再出现该文案」，单跑实测 31 条。
  'verify-669-collapsed-recoverable': 31,
  'verify-deck-no-hang': 19,
  'verify-log-selfmon': 27,
  // 2026-10-23 #1432：调试日志开关只认 settings.yaml 一处真源（静态面查代码里只剩一处读写，行为面查开关来源按设置文件四个状态回值）；37 条是单跑实测得出的。
  // 2026-10-26 #1143：旧日志实现退役，删掉读已删 logStore.ts 的两条断言（剩 35 条，单跑实测）。
  'verify-log-switch-single-source': 35,
  'verify-settings-templates': 65,
  // 2026-10-29 #1612：删掉旧 bannerFolded 迁移后改写这一扇的采样格，单跑实测 217 条。
  'verify-settings-view': 217,
  // 2026-10-29 #1643：加了八条冒烟阶段的断言（并行执行器里冒烟跑没跑、跳过时明说原因、
  // 冒烟红而主链绿时整体仍红且分得清是哪段红，--list 在抽查档位下提前说明冒烟会被跳过），
  // 58 条是单跑实测得出的。
  'verify-1158-completion-evidence': 58,
  'verify-1407-next-steps-reminders': 87,
  // 2026-10-24 #1451：下一步建议加了简介这一格（工具侧新增 intro、界面侧新增简介上限常量、
  // 选项按条数均分宽度），相关五扇门禁各自加了断言；下面五个数字都是单跑实测得出的。
  // 2026-10-24 #1464 后续：工具参数说明与 /ask-matt 规则节补「技能优先、prompt 开头写 /xxxx」。
  // 2026-10-24 #1412 反向（维护者拍板撤机制）：规则从 /ask-matt 正文搬进工具说明；1412 那扇门禁
  // 改成「技能正文原样返回、不追加」的守卫，断言数随之变化。下面两个数字都是单跑实测得出的。
  // 2026-10-29 #1620：兜底口改读 src/shared/host-log-slot.ts（键只定义一处），8d 加「槽晚到」「槽始终不出现」
  // 两组断言，单跑实测 167 条。
  // 2026-10-30 #1666：工具说明补上「等用户补充的半句话模板」这一分支，加了 8 条断言钉住新写法，
  // 单跑实测 175 条，期望数同步改准。
  // 2026-10-31 简介上限从 10 字改成按显示宽度算的 30 格（15 个汉字 / 30 个英文字符）：说明里的上限
  // 文字与常量一起改，另加 15 个汉字、30 个英文、16 个汉字、31 个英文四处边界断言，单跑实测 178 条。
  // 2026-10-31 理由拆成 reason/gain/cost 三格、priority 改必填：schema 六格与说明、三格各 30 码点上限、
  // 缺 gain/缺 cost/缺 priority 与推荐分不是数字四条整次拒绝，单跑实测 184 条。
  // 2026-10-31 参数说明按「每格答一个读者问题」重写（理由答时机、优点答收益、缺点答成本、推荐分排先后），
  // 另加一条分工断言，单跑实测 185 条。
  'verify-suggest-next-steps': 185,
  // 2026-10-26 规格收尾提示词落地：模板里的「## 工具」节收进公共小节 shared-sections.yaml，
  // 这扇的 ⑤ 从「扫三份 YAML 原文数提醒行」改成「经共享读取核展开后数」，少了两条文件存在性断言，
  // 单跑实测 29 条，期望数同步改准。
  'verify-1412-ask-matt-next-steps': 29,
  // 2026-10-23 #1409：界面借会话事件流取数通路（两叶子 + 源码守卫）；113 条是单跑实测得出的。
  // 2026-10-23 #1441 修红灯：这扇加了断言，单跑实测是 140 条，按加了断言就改期望的口径把期望改准（门禁本身全绿）。
  // 2026-10-31 简介上限改成按显示宽度算的 30 格：加了 15 个汉字、30 个英文、16 个汉字、31 个英文
  // 与「非字符串不收」五条宽度截断断言，单跑实测 158 条。
  // 2026-10-31 理由拆成 reason/gain/cost 三格：条目键位、三格各 30 码点截断与字面量守卫三条断言，单跑实测 161 条。
  'verify-1409-suggest-stream': 161,
  // 2026-10-24 #1451 后续：悬停浮层里的评分泡改贴理由第一行开头（理由折行后从评分下方接着排），
  // 这扇加了一条 DOM 顺序断言与三条样式断言，单跑实测是 102 条。
  // 2026-10-24 #1451 后续（浮层底色）：浮层背景不能与选项框完全同色，深浅两套主题各加一档更淡的底色，
  // 这扇加了两条样式断言，单跑实测是 104 条。
  // 2026-10-30 #1665 现象二：位置重算的观察对象补上输入框（输入框长高把状态栏整体顶起、状态栏尺寸不变也要
  // 重算），这扇加了 8 条重算触发断言，单跑实测是 115 条。
  // 2026-10-30 #1665 复核整改：折叠态真的不建状态栏外框（+1）、输入框顶边跑到视口上方时退回视口中央兜底（+2），
  // 单跑实测是 118 条，期望数同步改准。
  // 2026-10-31 理由浮层改四行（推荐分/理由/优点/缺点）：行序、标签、0 分照印与旧事件缺行跳过另加两条断言，
  // 单跑实测 120 条。
  'verify-1411-suggest-bubble': 120,
  // 2026-10-23 #1411 第二次提交：小泡动效与外观（纯函数时间线 + 假 DOM 驱动执行器 + 旋钮钉值）；
  // 2026-10-24 #1451 后续（浮层底色）：加了浮层底色与浅色浮层底色的旋钮断言，单跑实测是 151 条。
  // 2026-10-30 #1665 复核整改：钉死 === 0 之后，>= 0 与 < 2147483000 两条永远通过，删掉它们，
  // 单跑实测 150 条，期望数同步改准。
  // 2026-10-31 理由浮层改四行：宽度旋钮 340、行距与标签间距两个新旋钮、旧分数泡旋钮退役，单跑实测 152 条。
  'verify-1411-suggest-appearance': 152,
  // 2026-10-24 #1456：账号认领写路径新开闸（假会话钉住只经写会话认领、并集不撤别人等）；27 条是单跑实测得出的。
  'verify-1456-handoff-claim-write': 27,
  // 2026-10-24 #1451 后续：建议气泡按会话保留（切走再切回放回原组、关掉的不复活、缓存有上限、
  // 不落盘不加定时器）；31 条是单跑实测得出的。
  'verify-1451-suggest-session-keep': 31,
  // 2026-10-25 #1526：切回后台会话时从历史重放补出最后一组已收尾的建议（规格 #1525）；
  // 2026-10-28 #1420 第五项：补出改成扫整个事件窗口、窗口装载完成的那次 replace 再补一次，
  // 并补上「已热会话最后一次变更是 append」、结束原因非 completed 两组场景；68 条是单跑实测得出的。
  // 2026-10-28 #1420 复审：9c 钉住「个别条目缺提示词时界面沿用宽松解析、丢掉坏条目后仍整组上屏」，
  // 把「不会半组」收窄成「交付不拆组」；73 条是单跑实测得出的。
  'verify-1526-suggest-replay-restore': 73,
  // 2026-10-27 #1571：GitHub 房间调用点的 -F/-f 写法（20 处 owner/name 逐文件点名、整型字段仍走 -F）；
  // 15 条是单跑实测得出的。
  'verify-1571-gh-flag-writing': 15,
  // 2026-10-28 #1242：面板统计数字与 GitHub 现场的端到端对账。两条真路径都从原始回包走到六格：
  // 面板主路径 wf.mapTickets（点开地图现取子票）与快照兜底路径；唯一替身是 gh 可执行程序，
  // 注册表、GitHub 房间、会话管线、快照装配都是真件；95 条是单跑实测得出的。
  'verify-1242-panel-numbers': 95,
  // 2026-10-28 #1607：UNC 工作区里 gh 的当前目录不许绕道 shell 的守卫（静态扫四个起进程点，加生产 preflight
  // 走一趟 UNC / 盘符 / 失败三条路）；42 条是单跑实测得出的。
  'verify-1607-gh-unc-cwd': 42,
  // 2026-10-29 #1612：设置文件两个按工作区开关（胶囊状态栏 / deck 工具箱）的 schema 与落盘；
  // 旧字段迁移删掉之后按新语义改写采样格，53 条是单跑实测得出的。
  'verify-1612-settings-switches': 53,
  // 2026-10-29 #1641：设置页名单上还没打开过的工作区点开关也能存住（临时记录带 unopened 标记，
  // 认得出根的行行为不变，deck-state 与设置页渲染都把 listed 一路传到写口）；42 条是单跑实测得出的。
  'verify-1641-listed-workspace-flags': 42,
  // 2026-10-29 #1640：设置页名单上的临时记录在认出工作区根以后合并到根那一条（稀疏记录只存点过的格、
  // 合并按「格在不在」判点过、写成功才发 settings.merge 一行日志、两条触发路 load/root）；36 条是单跑实测得出的。
  'verify-1640-unopened-merge': 36,
  // 2026-10-29 #1642：设置页两个文字开关点按与临时记录合并两条路都留常驻日志（每一步一个 reason、
  // 写失败时补一行 settings.merge.fail 告警）；54 条是单跑实测得出的。
  'verify-1642-toggle-logs': 54,
  // 2026-10-29 #1654：没点开过的工作区行显示「已存住，打开该工作区后生效」；
  // 名单上、认不出根的行画小字，点开过与兜底行不画，真内核走一遍存临时、认出根、合并；20 条是单跑实测得出的。
  'verify-1654-ws-pending-hint': 20,
  // 2026-10-29 全屏误判收口：有头验证必须真全屏，固定视口不能拿来做遮挡类结论；
  // 判据与源码约定各占一组断言，21 条是单跑实测得出的（真全屏探针另在批次证据里验过一次）。
  'verify-real-machine-fullscreen': 21,
  // 2026-10-29 三款窗口尺寸定版：全屏宽 / 窄窗（外框 800，面板 300–359）/ 宽矮窗（高 600）；
  // 数据换算、browser.mts 实现约定与两份文档各占一组断言，32 条是单跑实测得出的（真机探针另在批次证据里跑过）。
  'verify-real-machine-size-presets': 32,
  // 2026-10-31 #1685：读结果的来源与按字段组完整度（从操作百科枚举 12 条读操作逐条对账、
  // 两套协议形状互不引用、十二种坏来源负例、stub 执行器真调三条读路径）；
  // 251 条是单跑实测得出的。
  // 2026-10-31 #1687：两条白名单清零（getCurrentUser 与 readBudget 接上来源与完整度），
  // 补了这四组接缝断言（成功带身份组/未登录失败不挂、读预算成功带计数组/量不到不挂），
  // 再加「旧平铺路径已删除」两条，294 条是单跑实测得出的。
  // 2026-10-31 #1688：单票声明扩成八个字段组（父子边、依赖、子票计数、评审、合并时间），
  // 补两通道完整度判据边角、字段三态与来源信息的同批印证，316 条是单跑实测得出的。
  // 2026-10-31 #1681 复审修复：整仓 REST 枚举补第 11 页空页探测（恰好满十页不再永远判截断），
  // D2b 改准并补探测非空/探测失败两条负例、完整度纯函数加三条，341 条是单跑实测得出的。
  'verify-read-result-provenance': 341,
  // 2026-10-31 #1688：字段三态进读结果契约与归一化去未知回落（缺边记未表达、缺计数保持未知、
  // 非 GitHub 后端整块省略走旧口径），65 条是单跑实测得出的。
  'verify-field-tri-state': 65,
  // 2026-10-31 #1690：快照合并服务（字段组级唯一合并 + 版本门 + 只有完整来源允许删清），
  // 覆盖四类合并结果、九组字段掩码、版本门与 etag 互不干扰、删清判据、存储顺序不动，
  // 以及读/写两条集成路径「完整查询后接降级不缩数据」；80 条是单跑实测得出的。
  // 2026-10-31 #1681 复审修复：版本门改按字段组判（表达组上次写入版本更晚才丢、不表达的组不拦）、
  // 起读合并版本改名并校验非法值（绝不写 NaN），补四组正负例，89 条是单跑实测得出的。
  'verify-panel-snapshot-merge': 89,
  // 2026-10-31 #1692：磁盘回放带格式版本与整仓级来源（旧格式按「来源未知」照读、文件字段一个不删），
  // 按需细节按 200 条 / 512KB 两把尺子上限做 LRU 淘汰并留「曾取过」记号（骨架、父子边、依赖边、
  // 子票计数不淘汰的负例逐个断言），回放提示与详情页「未取（曾在某时）」的落点，
  // 以及读写两拍真的挂了清理、没有新增定时器；85 条是单跑实测得出的。
  'verify-1692-disk-replay-eviction': 85,
  // 2026-10-31 #1691：REST 列表降级补齐父票边、依赖边与子票计数（真机夹具钉住零请求父边、
  // 依赖只对计数大于零的票逐票拉、已关闭容器不取子票、字段缺失记未知）；46 条是单跑实测得出的。
  'verify-rest-fallback-completion': 46,
  // 2026-10-31 #1691：REST 单票降级按需补评论正文、依赖边、评审与合并时间（每类最多一次请求、
  // 补不到记未知不写空、满一页评论总数保持未知）；61 条是单跑实测得出的。
  'verify-rest-detail-completion': 61,
  // 2026-10-31 #1693：通知事件库（四类事件、事件身份与恢复配对、去重与清理只动历史、当前状态仍按快照、
  // 三个漏斗的真实接线）。
  // 2026-10-31 #1681 复审修复：宿主接线搬进 src/host/notifications.ts（宿主入口只留薄 loader、只读断言）；
  // 119 条单跑实测。
  'verify-notification-events': 119,
  // 2026-10-31 #1694：详情读结果并进面板快照的增量合并（完整详情只改这一行、信封版本不动；
  // 降级不缩父边/依赖边/子票计数/评论/评审；版本门整份丢过期；失败不清空；无基线不凭空造）；31 条单跑实测。
  'verify-detail-incremental': 31,
  // 2026-10-31 #1694：详情只读一个来源（快照投影），读投影开关两条路都能跑、失败不清空且标上次数据，
  // 产物里投影实现只有一份、详情合并只经 mergeSnapshot 写快照；#1695 起成功取回不再写旧详情缓存、
  // 改记 detailSeenAt 并静默刷新快照；25 条单跑实测。
  'verify-single-read-source': 25,
  // 2026-10-31 #1694：规格四条验收联合门禁（降级不缩数据、图里点开先显示已知阻塞、
  // 关票后列表与地图同一份快照一致、详情永久增量合并），每条一正例一负例；27 条单跑实测。
  'verify-acceptance-four': 27,
  // 2026-10-31 #1695：旧详情缓存与地图子票桶退役为投影（快照投影优先、snapshot 模式不读写 issueCache、
  // 短回包按编号增量合并不清空已知行、快照顶层字段白名单与会话呈现态不进快照、TTL 只决定何时重取、
  // 排序只在投影层、legacy 开关旧路仍能跑）；39 条单跑实测。
  'verify-retire-client-caches': 39,
  // 2026-10-31 #1696：地图详情首帧用快照已知的本容器内阻塞关系与计数（子票行归一化：数字票号、
  // 阻塞者转数字、反推「我挡住谁」、层级与五组计数）；列表被截断或 REST 降级时按编号补回上次已知
  // 子票与计数（只补不删，已关闭容器口径不动）；41 条单跑实测。
  'verify-map-first-frame': 41,
  // 2026-10-31 #1696：真投影驱动渲染（react-dom/server 渲染真 MapDetailV2Page）：首帧画出被挡关系
  // 与四枚计数、加载与失败不覆盖已知、降级快照不缩水、未归一原始行必须判红（负例）、
  // 构建产物里有投影函数；文件名带 freshness，按阶段表排在构建之后；39 条单跑实测。
  'verify-map-first-frame-freshness': 39,
  // 2026-10-31 #1697：面板内通知中心（四类事件只做历史、当前降级仍按快照派生并标对不上、
  // 未读徽标并入头部折叠阶梯且窄面板先保仓库名与时间、真投影渲染带负例、文案进词表）。
  // 2026-10-31 #1681 复审修复：时间阶梯收进 truthLines 一份、事件说明按机器码走词条（旧中文直出与旧文案
  // 都有负例）、未读清零但有历史时入口仍留（空历史才不画）、宿主接线只读断言；104 条单跑实测。
  'verify-notification-center': 104,
  // 2026-10-31 #1698：计数诚实（完整枚举时本地重算并标来源、拿不到保留上次已知并标待校准、
  // 行数据与后端数字冲突时以行为准并留痕、界面不显示假 0、增量路径只标待校准不重算）；
  // 52 条单跑实测。
  'verify-counts-honesty': 52,
  // 2026-10-31 #1698：企业版运行时能力回答（GHES 上子票不支持、依赖 3.19 起部分支持、
  // 探测失败不回答、成功调用不挂不支持、运行时模块不读构建期能力登记）；39 条单跑实测。
  'verify-ghes-runtime-capability': 39,
  // 2026-10-31 #1699：退役列表内降级横幅（当前状态改成列表头部行内小标识、历史改由通知中心承载、
  // 旧横幅组件与关闭钮词条一并删除）；门禁由扫源码字符串改成真投影渲染，断言小标识在 KPI 行里不占行、
  // 说哪一句由 restFallbackView 决定（超一小时改口「上次…」、只有配额才提配额）、
  // 历史与当前对不上时仍按快照说。
  // 2026-10-31 #1681 复审修复：小标识可以按会话关掉（只写 sessionStorage、下一次降级更晚重新出现、
  // 坏数据当没关过、别的工作区各记各的），打开路径不写会话态；47 条单跑实测。
  'verify-rest-fallback-banner': 47,
  // 2026-10-31 #1700：规格收口验收矩阵（30 条验收逐条有判据门禁与负例、编号 1..30 连续、七个阶段齐全、
  // 引用门禁 30/30 在链；已知红清零且三类处置齐全；收口文档、两份 ADR 与迁移计划的真数一致——
  // 30 条、七个阶段、实测 1659 工单 + 64 PR、检索时刻、真红 0，旧数不再出现；含 5 种坏矩阵负例自测）；
  // 20 条单跑实测。
  'verify-closeout-acceptance': 20,
  // 2026-10-31 #1700：五类输入（降级、截断、部分失败、并发、重启）各一趟真实流程，按「起点输入摘要、
  // 分支原因、外部调用结果加耗时、状态变化、终点结论」五段逐段核对，缺段即红；
  // 截断趟的状态段由回执承载（成功回包不记错误行），文档写明；34 条单跑实测。
  'verify-closeout-log-trips': 34,
  // 2026-10-31 #1741：写路径执行层补齐新增两扇。write-contracts 覆盖 stdinFile 窄例外（命令白名单、路径守卫、
  // 大小与摘要、送入字节数、EPIPE 分类、传输层不支持时显式失败）、票据绑定字段扩张（篡改每个格子都要拒且零写命令、
  // requestId 重放、120 秒票只做预检新鲜度）与 refspec/路径守卫，单跑实测 40 条。
  'verify-1586-write-contracts': 40,
  // 2026-10-31 #1741：write-registration 守「一条写命令七个登记点一处不漏」（操作枚举、判定分支、检查白名单、
  // 写处理函数、宿主注册、电话表、超时配置），并用故意删两条记号的副本反证判据会报缺，单跑实测 44 条。
  'verify-1586-write-registration': 44,
}

// 冒烟链（scripts.smoke）上已经开闸的门禁，写法与上面那张表一样：写在这里 = 已开闸，值 = 期望条数。
// 为什么单独一张：#1178 之前 test:smoke 是一条裸的 && 串，判据在那条路上无事可做；
// 现在它走 scripts/verify-chain.ts --script smoke，判据能生效了，但冒烟的门禁不在主链上，
// 不能混进 COMPLETION_RECORDED_GATES —— 那张表按名字与 gates（主链）逐条对账，混进来会对不上。
export const SMOKE_COMPLETION_RECORDED_GATES: Record<string, number> = {
  'smoke-host-dispatch': 40,
  'smoke-naming-persistence': 37,
}

/**
 * 门禁名：文件名去扩展名。执行器判完成证据时按这个名字对，别在别处另起一套写法。
 * 冒烟那几条长这样：`smoke-host-dispatch.test.js` —— `.test` 是这类文件的命名习惯，不是门禁名的一部分，
 * 所以也去掉，名字才与 verify-* 那些一致（`smoke-host-dispatch`，而不是 `smoke-host-dispatch.test`）。
 */
export function gateNameOf(file: unknown): string {
  return path
    .basename(String(file || ''))
    .replace(/\.(test|spec)\.(js|mjs|cjs|ts|mts|cts)$/, '')
    .replace(/\.(js|mjs|cjs|ts|mts|cts)$/, '')
}

/** 这一扇该有多少条断言：0 表示还没开闸（没交完成记录，执行器只看退出码）。 */
export function completionExpectationOf(file: unknown): number {
  const name = gateNameOf(file)
  return Object.prototype.hasOwnProperty.call(COMPLETION_RECORDED_GATES, name) ? COMPLETION_RECORDED_GATES[name] : 0
}

/** 冒烟链上的那一扇该有多少条断言：0 表示还没开闸。口径与 completionExpectationOf 一样。 */
export function smokeExpectationOf(file: unknown): number {
  const name = gateNameOf(file)
  return Object.prototype.hasOwnProperty.call(SMOKE_COMPLETION_RECORDED_GATES, name) ? SMOKE_COMPLETION_RECORDED_GATES[name] : 0
}

// 本仓的源码根目录：只有落在这些目录里的路径才算「守着某条源码路径」。
// 前四个是插件自己的源码与机器人脚本。
// 不用再单列几个计算核的目录：它们已按 #1023 搬到 src/shared/<功能名>/，
// 被上面的 'src' 罩住；单列反而会让人误以为它们是并列的工作区包。
export const CODE_ROOTS: string[] = [
  'src',
  'scripts',
  'tests',
]

// 能被当作「归属路径」的目录前缀，比 CODE_ROOTS 宽：门禁读构建产物（package/）、
// 读夹具（tests/fixtures/）也如实记下来，只是这些不算守住源码。
// config/ 是配置真源目录（#1292 起提示词与语言清单的真源住在这里，门禁按路径归属守它们），
// 它不算手写源码，所以只进这份宽名单、不进 CODE_ROOTS。
export const PATH_PREFIXES: string[] = [
  ...CODE_ROOTS,
  'config',
  'package',
  'wizard',
  'examples',
  'assets',
  'specs',
  'docs',
  'research',
  'test',
  'acceptance',
]

// 建反向依赖图时扫哪些目录：手写源码所在的地方（派生目录不进去，见上）。
export const GRAPH_ROOTS: string[] = [
  'src',
]

// 真正装插件源码的目录。只有守着这些目录里某条路径的门禁，才算「算得出它守着哪条源码路径」。
// scripts/ 与 tests/ 不算：它们是工具与门禁自己，改它们一律按横切处理（见 select-gates.mts）。
export const SOURCE_DIRS: string[] = GRAPH_ROOTS

// 构建产物目录：package/ 下的文件是 scripts/build.mts 从源码打出来的。
// 只读这里的门禁看不出对应哪个源码文件，按「只要动到源码就先跑它」这一条保守处理。
export const BUILD_OUTPUT_PREFIXES: string[] = ['package/']

// 明确是别的包编译产物复制过来的派生目录：不手写、不拆行、由逐字节比对的门禁钉住。
// 归属推导照常看它们（有的门禁确实读这里），但覆盖报告里会给一句能看懂的解释。
// 今天这份名单是空的：#1016 删掉了最后一项 src/host/logPkg/（宿主日志改成直接取用已安装的
// dsh-log 包，插件源码树里不再留上游副本）。将来再有别的包编译产物原样拷进 src/ 时，把前缀写这里。
export const DERIVED_PREFIXES: string[] = []

// 扫仓库时跳过的目录：依赖、临时工作区、日志、隐藏目录。
const SKIP_DIR_NAMES: Set<string> = new Set(['node_modules', 'logs', '__pycache__', 'dist', 'coverage'])
const SKIP_DIR_PREFIXES: string[] = ['.tmp', '.git', '.worktrees', '.dsh-tmp', '.scratch']

const SOURCE_EXTENSIONS: string[] = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json']

// 手写 JavaScript 转 TypeScript 时文件名会换后缀，而引用它的地方往往还写着旧后缀
// （迁移期的常规写法，靠 scripts/ts-hook.mts 把说明符改指到新文件）。归属推导要认得出这种情况，
// 否则每转一个文件，引用它的那几扇门禁就会静默地从归属表里掉出去。
// 只认「同一家族」的四个替换，不做任意后缀互换：不然 './x.js' 会被错认成 x.json。
const MIGRATED_EXTENSION_ALIASES: Record<string, string[]> = {
  '.js': ['.ts'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
  '.jsx': ['.tsx'],
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** 把磁盘路径转成仓库内相对路径，统一用正斜杠。 */
export function toPosixRel(absOrRel: string, base: string = ROOT): string {
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.resolve(base, absOrRel)
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

/** 目录路径的规范化：去掉末尾斜杠与 './'，仓库根记成 '.'。 */
export function normalizeDir(rel: unknown): string {
  let p = String(rel || '').replace(/\\/g, '/').trim()
  p = p.replace(/^\.\//, '').replace(/\/+$/, '')
  return p === '' ? '.' : p
}

/** 仓库相对文件路径的目录部分（仓库根下的文件记成 '.'）。 */
export function dirOfFile(rel: unknown): string {
  const p = String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  return i < 0 ? '.' : p.slice(0, i)
}

/** 从仓库根到该目录的全部祖先目录（含自己），由浅到深。 */
export function ancestorsOf(dir: unknown): string[] {
  const d = normalizeDir(dir)
  if (d === '.') return ['.']
  const parts = d.split('/')
  const out = ['.']
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join('/'))
  return out
}

/** 判断 rel 是否落在某个目录里（含该目录自身），用于「这一层或更深」的归属判断。 */
export function isUnder(rel: unknown, dir: unknown): boolean {
  const r = String(rel || '').replace(/\\/g, '/')
  const d = normalizeDir(dir)
  if (d === '.') return true
  return r === d || r.startsWith(d + '/')
}

function shouldSkipDir(name: string): boolean {
  if (SKIP_DIR_NAMES.has(name)) return true
  return SKIP_DIR_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * 扫一遍仓库，返回 { files, dirs }：仓库内相对路径的集合（都带正斜杠）。
 * 跳过依赖、临时目录与隐藏目录——它们不属于「能被门禁守着的源码」。
 */
export function scanRepo(root: string = ROOT): RepoIndex {
  const files: Set<string> = new Set()
  const dirs: Set<string> = new Set()
  const walk = (absDir: string, relDir: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue
        const rel = relDir ? relDir + '/' + entry.name : entry.name
        dirs.add(rel)
        walk(path.join(absDir, entry.name), rel)
      } else if (entry.isFile()) {
        files.add(relDir ? relDir + '/' + entry.name : entry.name)
      }
    }
  }
  walk(root, '')
  return { files, dirs }
}

/** 名单（#1125）：规划函数是归属表的唯一输入，不再读 package.json 长串。 */
export function readChainSteps(root: string = ROOT): string[] {
  return planGates(root).map((s) => s.cmd)
}

/**
 * 读 package.json 的 scripts.smoke（冒烟链，今天五条），按 && 切开。
 * 这一串从 #1178 起单独住在 scripts.smoke 里：scripts['test:smoke'] 改成走
 * `scripts/verify-chain.ts --script smoke`，所以清单不能再放在 test:smoke 那一格（会自己套自己）。
 * 读法与切法不在这里重写：两个执行器与本生成器共用 scripts/lib/discover-gates.ts 那份（#1643）。
 * 缺这一格时返回空数组而不是抛错：冒烟链不是归属表的必需输入，缺了只是 smokeGates 为空。
 */
export function readSmokeSteps(root: string = ROOT): string[] {
  return readSmokeCommands(root)
}

/**
 * 链上一条命令 → 它跑的测试文件（仓库相对路径）。不是 `node <文件>` 形状就返回空串。
 * 主链一步长这样：`node tests/verify-x.js`（第二个参数就是文件）；
 * 冒烟链一步长这样：`node --import ./scripts/ts-hook.mts tests/smoke-x.test.js`（前面多一层钩子），
 * 所以取「第一个落在 tests/ 下的参数」，找不到再退回第二个 —— 写法与两个执行器共用同一份（#1643）。
 */
export function stepToGateFile(step: unknown): string {
  return commandTestFile(String(step || '').trim())
}

// ---------------------------------------------------------------------------
// 源码扫描：注释与字符串字面量
// ---------------------------------------------------------------------------

/**
 * 扫一遍源码，返回：
 *   literals  每个字符串字面量：{ value, start, end }，start 是左引号的位置
 *   masked    与源码等长的一份副本，注释内容与字符串内容都换成空格（引号保留）
 * masked 存在的意义：判断「这个字面量出现在哪个调用里」时不会把注释里的话当成代码，
 * 而且位置和原文一一对应，可以按位置把字面量还原出来。
 */
export function scanCode(code: string): ScanResult {
  const n = code.length
  const out = new Array(n)
  const literals: CodeLiteral[] = []
  let i = 0
  const copy = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) out[k] = code[k] === '\n' ? '\n' : code[k]
  }
  while (i < n) {
    const ch = code[i]
    // 行注释
    if (ch === '/' && code[i + 1] === '/') {
      const start = i
      while (i < n && code[i] !== '\n') i++
      copy(start, start)
      for (let k = start; k < i; k++) out[k] = ' '
      continue
    }
    // 块注释
    if (ch === '/' && code[i + 1] === '*') {
      const start = i
      i += 2
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(n, i + 2)
      for (let k = start; k < i; k++) out[k] = code[k] === '\n' ? '\n' : ' '
      continue
    }
    // 单/双引号字符串：引号留下，内容抹成空格
    if (ch === "'" || ch === '"') {
      const quote = ch
      const start = i
      let value = ''
      i++
      let closed = false
      while (i < n) {
        if (code[i] === '\\') {
          const esc = code[i + 1]
          value += esc === undefined ? '' : esc
          i += 2
          continue
        }
        if (code[i] === quote) {
          closed = true
          break
        }
        if (code[i] === '\n') break
        value += code[i]
        i++
      }
      if (closed) {
        const end = i + 1
        literals.push({ value, start, end })
        out[start] = quote
        for (let k = start + 1; k < i; k++) out[k] = ' '
        out[i] = quote
        i = end
      } else {
        // 没闭合（多半是被正则或除法骗了）：原样保留，别把后面整段吃掉
        copy(start, Math.min(n, i + 1))
        i = Math.min(n, i + 1)
      }
      continue
    }
    // 模板串：整段跳掉（含 ${} 里的嵌套），里面的路径多是拼出来的，认不准就不认
    if (ch === '`') {
      const start = i
      i++
      let depth = 0
      while (i < n) {
        const c = code[i]
        if (c === '\\') {
          i += 2
          continue
        }
        if (depth === 0 && c === '`') {
          i++
          break
        }
        if (c === '$' && code[i + 1] === '{') {
          depth++
          i += 2
          continue
        }
        if (depth > 0 && c === '}') {
          depth--
          i++
          continue
        }
        i++
      }
      for (let k = start; k < i; k++) out[k] = code[k] === '\n' ? '\n' : ' '
      continue
    }
    // 正则字面量：粗略识别 `/.../ ` 开头的形态，避免里面的 // 被当注释
    if (ch === '/') {
      const prev = previousMeaningful(code, i)
      if (prev === '' || /[=(,:;[!&|?{}+\-*%<>~^]/.test(prev)) {
        let j = i + 1
        let inClass = false
        let closed = false
        while (j < n) {
          const c = code[j]
          if (c === '\\') {
            j += 2
            continue
          }
          if (c === '\n') break
          if (c === '[') inClass = true
          else if (c === ']') inClass = false
          else if (c === '/' && !inClass) {
            closed = true
            break
          }
          j++
        }
        if (closed) {
          for (let k = i; k <= j; k++) out[k] = code[k]
          i = j + 1
          continue
        }
      }
    }
    out[i] = ch
    i++
  }
  let masked = ''
  for (let k = 0; k < n; k++) masked += out[k] === undefined ? code[k] : out[k]
  return { literals, masked }
}

function previousMeaningful(code: string, i: number): string {
  let k = i - 1
  while (k >= 0 && /\s/.test(code[k])) k--
  return k < 0 ? '' : code[k]
}

// ---------------------------------------------------------------------------
// 归属推导
// ---------------------------------------------------------------------------

const DIRECTIVE_RE = /门禁归属\s*[:：]\s*([^\s*]+)/

/** 把一个字面量解析成仓库内路径；解析不出来（不存在、不在允许的目录里）就返回 null。 */
export function resolveRepoPath(raw: unknown, fromDirRel: string, exists: RepoIndex): string | null {
  let p = String(raw || '').trim().replace(/\\/g, '/')
  if (!p) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    if (!/^file:\/\//i.test(p)) return null
    p = p.replace(/^file:\/\//i, '')
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1)
  }
  if (/^(data|node|https?):/i.test(p)) return null

  const candidates: string[] = []
  if (p.startsWith('/')) {
    const abs = p.replace(/\//g, path.sep)
    candidates.push(path.relative(ROOT, abs).split(path.sep).join('/'))
  } else if (p.startsWith('./') || p.startsWith('../')) {
    candidates.push(path.posix.normalize(path.posix.join(fromDirRel === '.' ? '' : fromDirRel, p)))
    candidates.push(path.posix.normalize(p))
  } else {
    candidates.push(path.posix.normalize(p))
  }

  for (const cand of candidates) {
    if (!cand || cand.startsWith('..')) continue
    const first = cand.split('/')[0]
    if (!PATH_PREFIXES.includes(first)) continue
    const hit = lookupWithExtensions(cand, exists)
    if (hit) return hit
  }
  return null
}

/** 原样找；找不到就把迁移期换过后缀的名字找来（foo.js → foo.ts），共享层产物再回落到同目录 src/ 下的同名 .ts；再找不到就补 /index.*，都找不到返回 null。 */
function lookupWithExtensions(cand: string, exists: RepoIndex): string | null {
  if (exists.files.has(cand) || exists.dirs.has(cand)) return cand
  const ext = path.posix.extname(cand)
  for (const alias of MIGRATED_EXTENSION_ALIASES[ext] || []) {
    const swapped = cand.slice(0, cand.length - ext.length) + alias
    if (exists.files.has(swapped)) return swapped
  }
  // 2026-10-19 第三阶段：共享层产物搬出源码树（.build/shared/<相对路径>.js），源码树里只剩真源。
  // 说明符仍然写 `shared/<域>/<名>.js`（运行时按发布包与 .build 的几何解析，不能改成指真源），
  // 而真源住在 `<域>/src/<名>.ts`。归属表要记「人下次该去改哪份文件」，所以这里补一条回落：
  // 同目录找不到同名 .ts 时，再看同目录的 src/ 下有没有同名 .ts。不补这条，归属表里记的全是
  // 磁盘上已经不存在（或本来就不该出现在源码树）的产物路径，verify-gate-map 的
  // 「归属表里记的每个路径都在磁盘上真实存在」那一条会判红。
  if (ext === '.js') {
    const dir = path.posix.dirname(cand)
    const base = path.posix.basename(cand, ext)
    const underSrc = path.posix.join(dir, 'src', base + '.ts')
    if (exists.files.has(underSrc)) return underSrc
  }
  for (const e of SOURCE_EXTENSIONS) {
    if (exists.files.has(cand + e)) return cand + e
  }
  for (const e of SOURCE_EXTENSIONS) {
    if (exists.files.has(cand + '/index' + e)) return cand + '/index' + e
  }
  return null
}

const TIER_ORDER: string[] = ['directive', 'read', 'module', 'static-import', 'literal']
const TIER_LABEL: Record<string, string> = {
  directive: '文件头 // 门禁归属: 注释',
  read: '读文件调用（readFileSync / readFile / path.join(ROOT, ...)）',
  module: '载入模块（require / import / pathToFileURL）',
  'static-import': '静态 import 说明符',
  literal: '源码里的路径字面量',
}

/** 看一个字符串字面量出现在什么位置，判断它属于哪一档来源。 */
function classifyLiteral(masked: string, lit: CodeLiteral): string {
  const before = masked.slice(Math.max(0, lit.start - 160), lit.start)
  if (/(?:^|[^\w.])readFileSync\s*\([^()]*$/.test(before)) return 'read'
  if (/(?:^|[^\w.])readFile\s*\([^()]*$/.test(before)) return 'read'
  if (/(?:^|[^\w.])path\s*\.\s*(?:join|resolve)\s*\([^()]*$/.test(before)) return 'read'
  if (/(?:^|[^\w.])require\s*\([^()]*$/.test(before)) return 'module'
  if (/(?:^|[^\w.])import\s*\([^()]*$/.test(before)) return 'module'
  if (/(?:^|[^\w.])pathToFileURL\s*\([^()]*$/.test(before)) return 'module'
  if (/(?:^|[^\w.$])from\s*$/.test(before)) return 'static-import'
  if (/(?:^|[^\w.])import\s*$/.test(before)) return 'static-import'
  return 'literal'
}

/**
 * 推出一扇门禁守着哪些路径。
 * 返回 { guards, tiers, directive, unattributed, reason }，guards 是排好序的仓库相对路径。
 */
export function deriveGuards(gateRel: string, code: string, exists: RepoIndex): DeriveResult {
  const fromDir = dirOfFile(gateRel)
  const { literals, masked } = scanCode(code)

  // 第一优先：文件头的 `// 门禁归属:` 注释写了就以它为准，别的来源全不看。
  const directiveHits: string[] = []
  const head = code.slice(0, 4000)
  for (const line of head.split(/\r?\n/)) {
    const m = DIRECTIVE_RE.exec(line)
    if (m) directiveHits.push(m[1])
  }
  if (directiveHits.length) {
    const guards: string[] = []
    for (const raw of directiveHits) {
      const hit = resolveRepoPath(raw, fromDir, exists)
      if (hit) guards.push(hit)
    }
    if (guards.length) {
      return {
        guards: uniqueSorted(guards),
        tiers: { directive: guards.length },
        directive: true,
        unattributed: !guards.some((g) => SOURCE_DIRS.some((r) => isUnder(g, r))),
        reason: '归属来自 ' + TIER_LABEL.directive + '（共 ' + guards.length + ' 条）',
      }
    }
  }

  const byTier: Map<string, any> = new Map()
  const add = (tier: string, raw: string): void => {
    const hit = resolveRepoPath(raw, fromDir, exists)
    if (!hit) return
    if (!byTier.has(tier)) byTier.set(tier, new Set())
    byTier.get(tier).add(hit)
  }

  // path.join(ROOT, 'a', 'b') 这类拼法：把开头的字面量按顺序接起来，遇到变量就停。
  // 不接起来的话，'src' 和 'host' 两个孤立的字面量谁也认不出，只会记成一个过宽的 'src'。
  const joinRe = /path\s*\.\s*(?:join|resolve)\s*\(([^()]*)\)/g
  let jm: any
  while ((jm = joinRe.exec(masked))) {
    const argsStart = jm.index + jm[0].length - 1 - jm[1].length - 0
    const argText = jm[1]
    const parts = argText.split(',')
    let offset = argsStart
    const pieces: string[] = []
    for (const part of parts) {
      const partStart = offset
      offset += part.length + 1
      const trimmed = part.trim()
      if (/^['"]\s*['"]$/.test(trimmed)) {
        const lit = literals.find((l) => l.start >= partStart && l.end <= partStart + part.length + 1)
        if (lit) pieces.push(lit.value)
        else break
      } else if (pieces.length === 0) {
        // 第一个参数通常是 ROOT / __dirname 这类基址，跳过
        continue
      } else {
        break
      }
    }
    if (pieces.length) add('read', pieces.join('/'))
  }

  for (const lit of literals) {
    if (!/[/\\]/.test(lit.value)) continue
    add(classifyLiteral(masked, lit), lit.value)
  }

  const tiers: Record<string, number> = {}
  const guards: string[] = []
  for (const tier of TIER_ORDER) {
    if (tier === 'directive') continue
    const set = byTier.get(tier)
    if (!set || !set.size) continue
    tiers[tier] = set.size
    for (const g of set) guards.push(g)
  }
  const sorted = uniqueSorted(guards)
  const looksAtSource = sorted.some((g) => SOURCE_DIRS.some((r) => isUnder(g, r)))
  const reasonParts = TIER_ORDER.filter((t) => t !== 'directive' && tiers[t]).map(
    (t) => TIER_LABEL[t] + ' ' + tiers[t] + ' 条',
  )
  return {
    guards: sorted,
    tiers,
    directive: false,
    unattributed: !looksAtSource,
    reason: sorted.length
      ? '归属来自：' + reasonParts.join('；') + (looksAtSource ? '' : '；这些路径都不在插件源码目录里')
      : '',
  }
}

function uniqueSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort()
}

/** 给推不出源码归属的门禁写一句人话原因。 */
function unattributedReason(gateRel: string, code: string, guards: string[]): string {
  if (guards.length) {
    const onlyBuildOutput = guards.every((g) => BUILD_OUTPUT_PREFIXES.some((p) => isUnder(g, p)))
    if (onlyBuildOutput) {
      return (
        '它读的是构建产物（package/ 下的打包结果）。产物由整份源码打出来，脚本里看不出产物跟哪个源码文件对应，' +
        '所以算不出它守着哪条源码路径；挑选门禁时按「只要动到源码就先跑它」保守处理'
      )
    }
    const roots = uniqueSorted(guards.map((g) => g.split('/')[0]))
    return (
      '读到的路径都落在 ' + roots.join('、') + '/ 下（夹具、文档、工具脚本之类），不指向插件源码，' +
      '所以算不出它守着哪条源码路径'
    )
  }
  const readsPkg = /(?:readFileSync|readFile)\s*\([^)]*package\.json/.test(code) || /package\.json/.test(code)
  const readsAnything = /(?:readFileSync|readFile)\s*\(/.test(code)
  if (readsAnything && readsPkg) {
    return '只读 package.json（检查自己有没有挂在 npm run verify 链上、发布字段对不对），没有读也没有导入任何源码，算不出它守着哪条源码路径'
  }
  if (readsAnything) {
    return '它读的文件都用变量拼出来、或者读的是自己造的临时夹具，脚本里没有出现能认出来的路径字面量，算不出它守着哪条源码路径'
  }
  return (
    '它没有读也没有导入本仓库的文件，只用自己带的夹具或真机页面自检，算不出它守着哪条源码路径；' +
    '这类门禁在挑选时不会被选中，真实例子见 docs/agents/verification.md 的「已知漏洞」一节'
  )
}

// ---------------------------------------------------------------------------
// 模块依赖图（给反向依赖与覆盖面用）
// ---------------------------------------------------------------------------

/** 列出要建图的手写源码文件（仓库相对路径）。 */
export function listGraphFiles(root: string = ROOT): string[] {
  const out: string[] = []
  for (const rel of GRAPH_ROOTS) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (shouldSkipDir(entry.name)) continue
          walk(path.join(dir, entry.name))
        } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
          out.push(toPosixRel(path.join(dir, entry.name)))
        }
      }
    }
    walk(abs)
  }
  return uniqueSorted(out)
}

/**
 * 从一份源码里抠出它导入了哪些本地文件（只要能解析成仓库内路径的都算）。
 * 认的是 import ... from '...'、export ... from '...'、require('...')、import('...')
 * 里的字符串字面量；拼出来的路径认不出来，这也是这套规则已知的漏洞之一。
 */
export function extractImportSpecifiers(code: string, fileRel: string, exists: RepoIndex): string[] {
  const fromDir = dirOfFile(fileRel)
  const out: Set<string> = new Set()
  const { literals, masked } = scanCode(code)
  for (const lit of literals) {
    const before = masked.slice(Math.max(0, lit.start - 160), lit.start)
    const isImport =
      /(?:^|[^\w.$])from\s*$/.test(before) ||
      /(?:^|[^\w.])import\s*\([^()]*$/.test(before) ||
      /(?:^|[^\w.])require\s*\([^()]*$/.test(before)
    if (!isImport) continue
    const hit = resolveRepoPath(lit.value, fromDir, exists)
    if (hit && exists.files.has(hit)) out.add(hit)
  }
  return Array.from(out).sort()
}

/** 建依赖图：返回 { imports, importedBy }，键是仓库相对路径。 */
export function buildImportGraph(root: string = ROOT, exists: RepoIndex | null = null): ImportGraph {
  const index = exists || scanRepo(root)
  const files = listGraphFiles(root)
  const imports: Map<string, any> = new Map()
  const importedBy: Map<string, any> = new Map()
  for (const rel of files) imports.set(rel, new Set())
  for (const rel of files) {
    let code: string
    try {
      code = fs.readFileSync(path.join(root, rel), 'utf8')
    } catch {
      continue
    }
    for (const dep of extractImportSpecifiers(code, rel, index)) {
      if (!imports.has(dep)) continue
      imports.get(rel).add(dep)
      if (!importedBy.has(dep)) importedBy.set(dep, new Set())
      importedBy.get(dep).add(rel)
    }
  }
  return { imports, importedBy }
}

/** 传递闭包：从 seeds 出发沿 edges 一直走，返回含 seeds 自己在内的集合。 */
export function transitiveClosure(seeds: Iterable<string>, edges: Map<string, any>): Set<string> {
  const seen: Set<string> = new Set()
  const queue: any[] = []
  for (const s of seeds) {
    if (!seen.has(s)) {
      seen.add(s)
      queue.push(s)
    }
  }
  while (queue.length) {
    const cur = queue.shift()
    const next = edges.get(cur)
    if (!next) continue
    for (const n of next) {
      if (seen.has(n)) continue
      seen.add(n)
      queue.push(n)
    }
  }
  return seen
}

// ---------------------------------------------------------------------------
// 生成归属表
// ---------------------------------------------------------------------------

/** 生成整张归属表。除 generatedAt 外，同样的仓库状态一定得到同样的结果。 */
export function buildGateMap(root: string = ROOT): GateMap {
  const exists = scanRepo(root)
  const chainSteps = readChainSteps(root)
  const graph = buildImportGraph(root, exists)

  const gates: GateEntry[] = []
  for (const step of chainSteps) {
    const file = stepToGateFile(step)
    // 完成证据的两格：这一扇开闸了没有、该有多少条断言（没开闸就是 0，执行器只看退出码）。
    const expectedAssertions = completionExpectationOf(file)
    const completionRecord = expectedAssertions > 0
    let code = ''
    let missing = false
    if (!file) missing = true
    else {
      try {
        code = fs.readFileSync(path.join(root, file), 'utf8')
      } catch {
        missing = true
      }
    }
    if (missing) {
      gates.push({
        step,
        file,
        guards: [],
        dirs: [],
        unattributed: true,
        buildOutputOnly: false,
        completionRecord: false,
        expectedAssertions: 0,
        reason: file
          ? '链上的 ' + file + ' 读不到（文件不存在或路径不对），无法推导归属'
          : '链上这一步不是 `node <文件>` 的形状，无法推导归属：' + step,
      })
      continue
    }
    const derived = deriveGuards(file, code, exists)
    const dirs = uniqueSorted(
      derived.guards.map((g) => (exists.dirs.has(g) ? normalizeDir(g) : dirOfFile(g))),
    )
    // 只读构建产物的门禁：产物是整份源码打出来的，看不出对应哪个源码文件，
    // 所以单独标出来，交给挑选规则按「只要动到源码就先跑它」处理（保守优先）。
    const buildOutputOnly =
      derived.unattributed &&
      !derived.guards.some((g) => SOURCE_DIRS.some((r) => isUnder(g, r))) &&
      derived.guards.some((g) => BUILD_OUTPUT_PREFIXES.some((p) => isUnder(g, p)))
    gates.push({
      step,
      file,
      guards: derived.guards,
      dirs,
      unattributed: derived.unattributed,
      buildOutputOnly,
      completionRecord,
      expectedAssertions,
      reason: derived.unattributed
        ? unattributedReason(file, code, derived.guards)
        : derived.reason,
    })
  }

  // 冒烟链的完成证据（#1178）：冒烟不在主链上，所以不进 gates —— 那一批是归属与覆盖面的输入。
  // 这里只把五条冒烟各记一行，好让 test:smoke 那条路（#1178 起走同一个执行器）拿同一份判据对数。
  const smokeSteps = readSmokeSteps(root)
  const smokeGates = smokeSteps.map((step) => {
    const file = stepToGateFile(step)
    const expectedAssertions = smokeExpectationOf(file)
    return {
      step,
      file,
      gate: gateNameOf(file),
      completionRecord: expectedAssertions > 0,
      expectedAssertions,
    }
  })

  // byDir：目录 → 守着这一层的门禁清单。
  // 「这一层」的口径是「门禁守的路径正好在这个目录里」，不含子目录；子目录算它自己那一层。
  // 这么分是为了对上维护者要的规则：A 目录下有 B，B 下面有 E 和 F，改了 E 就只跑
  // 守着 E、守着 B、守着 A 三层的门禁，兄弟目录 F 的门禁不跟着跑。
  // 每个被守着的目录，它的所有祖先目录也会建一个键（可能是空数组），
  // 这样「改 E → 查 E、B、A」一路查表不会查空。
  const byDir: Map<string, any> = new Map()
  const ensure = (dir: string): Set<string> => {
    for (const anc of ancestorsOf(dir)) if (!byDir.has(anc)) byDir.set(anc, new Set())
    return byDir.get(dir)
  }
  for (const gate of gates) {
    for (const g of gate.guards) {
      const dir = exists.dirs.has(g) ? normalizeDir(g) : dirOfFile(g)
      ensure(dir).add(gate.step)
    }
  }
  const byDirObj: Record<string, string[]> = {}
  for (const dir of Array.from(byDir.keys()).sort()) {
    const steps = byDir.get(dir)
    byDirObj[dir] = steps.size ? chainSteps.filter((s) => steps.has(s)) : []
  }

  // 覆盖面：src/ 下每个文件要么被某扇门禁直接守着，要么被某扇门禁守着的模块 import 到。
  const coverage = buildCoverage(root, exists, gates, graph, chainSteps)

  const unattributedGates = gates.filter((g) => g.unattributed).length
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: 'node scripts/gate-map.mts',
    chainLength: chainSteps.length,
    gateCount: gates.length,
    attributedGates: gates.length - unattributedGates,
    unattributedGates,
    buildOutputOnlyGates: gates.filter((g) => g.buildOutputOnly).length,
    completionRecordedGates: gates.filter((g) => g.completionRecord).length,
    smokeLength: smokeSteps.length,
    smokeCompletionRecordedGates: smokeGates.filter((g) => g.completionRecord).length,
    graphFileCount: graph.imports.size,
    gates,
    smokeGates,
    byDir: byDirObj,
    coverage,
  }
}

function buildCoverage(root: string, exists: RepoIndex, gates: GateEntry[], graph: ImportGraph, chainSteps: string[]): CoverageResult {
  const srcFiles = Array.from(exists.files).filter((f) => isUnder(f, 'src')).sort()
  const srcDirs = Array.from(exists.dirs).filter((d) => isUnder(d, 'src')).sort()

  // 每扇门禁守着的模块，连同它们 import 到的东西，一起算作被这扇门禁覆盖。
  // 归属写成目录时（`// 门禁归属: src/client/views`）摊成这个目录下的**全部**文件（含子目录）：
  // 依赖图只有「文件→文件」的边，目录本身没有边；而归属写成目录的门禁（verify-reuse.js、
  // verify-no-title.js 这类）本来就是递归扫这个目录的，摊一层会把这些文件误报成没人守。
  const expandSeed = (guard: string): string[] => (exists.dirs.has(guard) ? srcFiles.filter((f) => isUnder(f, guard)) : [guard])
  const coveredBy: Map<string, any> = new Map()
  for (const gate of gates) {
    if (!gate.guards.length) continue
    const closure = transitiveClosure(gate.guards.flatMap(expandSeed), graph.imports)
    for (const f of closure) {
      if (!exists.files.has(f)) continue
      if (!coveredBy.has(f)) coveredBy.set(f, new Set())
      coveredBy.get(f).add(gate.step)
    }
  }

  const ungated: CoverageUngated[] = []
  const ungatedDirs: CoverageUngated[] = []
  const guardedFiles: string[] = []
  const dirHasCovered: Set<string> = new Set()
  for (const f of srcFiles) {
    const direct = coveredBy.has(f)
    if (direct) {
      guardedFiles.push(f)
      for (const anc of ancestorsOf(dirOfFile(f))) dirHasCovered.add(anc)
      continue
    }
    ungated.push({ path: f, reason: ungatedReasonFor(f) })
  }
  const guardedDirs = srcDirs.filter((d) => dirHasCovered.has(d))
  for (const d of srcDirs) {
    if (dirHasCovered.has(d)) continue
    const fileCount = srcFiles.filter((f) => isUnder(f, d)).length
    ungatedDirs.push({
      path: d,
      reason:
        '这个目录（含子目录）下 ' +
        fileCount +
        ' 个文件没有任何门禁覆盖：门禁没有直接读它们，门禁守着的模块也没有 import 它们',
    })
  }

  // 「专属门禁」与「有没有门禁」是两件事，分开报：
  //   有门禁：`// 门禁归属: src/client/views` 这种宽口径归属也算——它递归扫这个目录，改动会被拦下；
  //   专属门禁：这一层自己有没有被点名（归属直接写成这个目录，或写成直接装在这个目录里的文件）。
  // 只报前者会让人以为「每个目录都有专属门禁」，只报后者又看不出「谁在守」。
  const dedicatedDirs: Set<string> = new Set()
  for (const gate of gates) {
    for (const guard of gate.guards) {
      if (!isUnder(guard, 'src')) continue
      dedicatedDirs.add(exists.dirs.has(guard) ? guard : dirOfFile(guard))
    }
  }
  const dirsWithoutDedicated = srcDirs
    .filter((d) => !dedicatedDirs.has(d))
    .map((d) => ({ path: d, fileCount: srcFiles.filter((f) => isUnder(f, d)).length }))
    .filter((d) => d.fileCount > 0)

  return {
    sourceRoot: 'src',
    fileCount: srcFiles.length,
    dirCount: srcDirs.length,
    coveredFileCount: guardedFiles.length,
    ungatedFileCount: ungated.length,
    ungatedDirCount: ungatedDirs.length,
    dedicatedDirCount: srcDirs.filter((d) => dedicatedDirs.has(d)).length,
    guardedFiles,
    guardedDirs,
    dedicatedDirs: srcDirs.filter((d) => dedicatedDirs.has(d)),
    dirsWithoutDedicated,
    ungated,
    ungatedDirs,
  }
}

function ungatedReasonFor(rel: string): string {
  const derived = DERIVED_PREFIXES.find((p) => rel.startsWith(p))
  if (derived) {
    return (
      '这是 ' + derived + ' 下的派生文件：由外部包（dsh-log / dsh-plugin-update）的编译产物原样复制进来，' +
      '本仓库不手写它，正确性由逐字节比对发布包的门禁钉住，所以这里不另设门禁'
    )
  }
  if (/(^|\/)contract\//.test(rel)) {
    return (
      '这是契约层文件（src/**/contract/）：改它会影响上下两端，挑选门禁时一律按横切处理、直接跑全链，' +
      '所以不单独设门禁。改动前请按 docs/agents/verification.md 的口径跑全链'
    )
  }
  if (rel.endsWith('.d.ts') || rel.endsWith('.ts')) {
    return (
      '这是类型声明或 TypeScript 源文件：本仓的门禁目前几乎都直接读 .js 产物或无后缀入口，' +
      '没有一扇盯着它，也没有被门禁守着的模块 import 它；改动它之前请跑全链'
    )
  }
  if (rel.endsWith('.html')) {
    return '这是原型或演示用的页面文件，不是插件运行时加载的代码；仓库里没有门禁盯着它'
  }
  return (
    '没有门禁直接读它，也没有门禁守着的模块 import 它：' +
    '要么它只被运行时按名字取用、要么它的正确性目前只靠人工验收；改动它之前请跑全链'
  )
}

/** 把归属表序列化成写进文件的文本（带末尾换行，方便 diff）。 */
export function serializeMap(map: unknown): string {
  return JSON.stringify(map, null, 2) + '\n'
}

/** 同一份仓库状态下，两次推导出来的结果应当逐字节相同。generatedAt 是时间戳，比较时去掉。 */
export function normalizeForCompare(map: unknown): Record<string, any> {
  const copy: Record<string, any> = JSON.parse(JSON.stringify(map))
  delete copy.generatedAt
  return copy
}

// ---------------------------------------------------------------------------
// 命令行入口
// ---------------------------------------------------------------------------

function main(): void {
  const printOnly = process.argv.includes('--print')
  const map = buildGateMap(ROOT)
  const text = serializeMap(map)
  console.log('门禁归属表：链上 ' + map.chainLength + ' 步，能推出源码归属 ' + map.attributedGates + ' 步，推不出 ' + map.unattributedGates + ' 步，已开闸（交完成记录）' + map.completionRecordedGates + ' 扇')
  console.log('冒烟链：' + map.smokeLength + ' 步，已开闸（交完成记录）' + map.smokeCompletionRecordedGates + ' 扇')
  console.log(
    'src/ 覆盖：' +
      map.coverage.coveredFileCount +
      '/' +
      map.coverage.fileCount +
      ' 个文件有门禁覆盖，' +
      map.coverage.ungatedFileCount +
      ' 个文件没有，' +
      map.coverage.ungatedDirCount +
      ' 个目录整目录没有覆盖',
  )
  if (map.coverage.ungated.length) {
    console.log('没有门禁覆盖的文件（最多列 20 个）：')
    for (const item of map.coverage.ungated.slice(0, 20)) console.log('  - ' + item.path)
    if (map.coverage.ungated.length > 20) console.log('  …… 其余 ' + (map.coverage.ungated.length - 20) + ' 个见 tests/gate-map.json')
  }
  if (printOnly) return
  fs.writeFileSync(MAP_PATH, text)
  console.log('已写入 tests/gate-map.json（' + text.length + ' 字节）')
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))
if (invokedDirectly) main()
