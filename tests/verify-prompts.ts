// verify-prompts.ts — prompt 注册表契约校验（#573 收敛五面扫描 + 外部豁免登记 + 归一化；判定口径按 #603 重写为 R1–R8）
// 用法:
//   node tests/verify-prompts.ts                          默认：五面全扫（S1 真源 + S2 双产物 + S3 三后端 + S4 host 常量 + S5 渲染面）
//   node tests/verify-prompts.ts <注册表 YAML 文件>        单文件模式：只扫该文件的 S1（L2 机械注入用；S2/S3/S4 跳过）
//   node tests/verify-prompts.ts --backend-probe=<文件>    用该文件替代 github 后端做 S3（L2 机械注入用）
//
// #1292：提示词正文的真源从「源码里的字面量」搬到了 config/prompts/ 下的五份 YAML（语言清单是 config/languages.yaml），
//   生成器 scripts/generate-prompt-config.mts 按 YAML 写出 src/client/kernel/prompt-data.ts（构建期现场生成、不入库），
//   那份生成物就是客户端闭包里的运行时数据。本门禁随之改读 YAML：**判定口径一条没放松** ——
//   注册表仍是 28 条、每条仍带 version / placeholders / use / zh / en 五样，读出来的文本仍逐条过 judge()，
//   产物里的文本仍逐字段等于真源；变的只有「真源是文件而不是源码」这一件事。
//
// #1293：把「真源改成文件」之后的收口做完，判定强度一条不降：
//   · tests/verify-prompt-newlines.ts 整条退场（文件删除），它的「正文不许出现字面 \n」判据并进本文件第 4c 节，
//     扫描面一处不少（五份 YAML / 两份客户端产物 / src/host 的 *_PROMPT / src/tracker/rooms 的 zh/en 字面量）；
//   · 源码形状规则 auditRegistryShape 与 OBJECT_PROTO_KEYS 退场（注册表已是 YAML 解析出的普通数据，没有 JS 求值面），
//     其中仍适用的「锚点/别名藏内容」判据保留在 yamlHidingShape，S1 逐份 YAML 判；
//   · 新增四条 YAML 化产物断言：use 不进客户端产物 / 正文不许有字面 \n / 每种语言都必须有正文 /
//     占位符与正文逐语言一一对应（第 4c 节，前两条完整模式跑，后两条连单文件探针也跑）；
//   · L2 机械注入加自检：跑完真源一字不差（注入只许改内存对象、写临时目录）；
//   · 判定强度对照表见 docs/design/1293-prompt-gate-strength.md。
//
// 判定分两层：
//   ① 结构契约（沿用 #461/#68/#69/#71/#72/#74/#75/#76/#77 的既有断言，陈旧的两组已按现状修正）
//   ② 提示词判定：扫描各面 → 归一化 → 跑 R1–R8
//
// #603 的判定口径（领导 2026-09-11 拍板：撤掉「先用 dsh plugin 解析插件安装目录、再调包内脚本写回」那套间接写法，改回 gh 直连）：
//   · 模板层照旧禁止一切具体命令（S1 注册表、S2 双产物、S6/S7/S8、以及渲染结果的**非 GitHub** 后端）：不许出现
//     gh / glab 命令、经包管理器转发、裸 API 地址、heredoc；模板里只许留 {subIssue} 这类占位符，
//     由后端声明在渲染时填空。这条是 #573/#595 的原意，不因 #603 放松。
//   · GitHub 后端声明面（S3 的 github）允许 gh 命令：gh 直连三步（取子票数据库 id → 建原生子议题边 → 校验张数）
//     与原生阻塞边就写在 prompts.subIssue 里，经 {subIssue} 注入会话。judge() 的 allowTracker 选项就是按面开这一道
//     口子（只在 github 面跳过 R1），R2–R8 在 github 面上照样判。gitlab / markdown 后端声明面判据不变（不许 gh 命令）。
//   · 新增 R8（所有面都判，含允许 gh 的 github 面）：不许出现「先解析插件安装目录，再调包内脚本」那套间接写法 ——
//     归一化后命中 dsh plugin / require.resolve / <插件目录> / <pluginDir> / fix-issue-body.mjs / wire-subissues.mjs
//    （转写后新后缀 .mts 同样命中）任一即判红。这几样正是本票要消灭的，模板面与后端声明面都判。
//   · 发布包里的两条脚本（fix-issue-body.mts / wire-subissues.mts）仍留在包里当可选工具，但提示词一个都不许引用：
//     「提示词引用的脚本集合必须为空」与「发布包仍带这两条脚本」是两条各自独立的事实，不再要求两边相等 ——
//     那个等式的前提是「提示词必须调脚本」，前提本身已随 #603 撤掉。
//
// 五面（缺一处即漏，见 .scratch/573-gate-design-v2.md §1.1）：
//   S1 config/prompts/ 下的五份模板 YAML（解析真源；字段不对或 YAML 坏掉直接判红，不静默少扫）
//   S2 client.js / package/lib/client.js（从产物里解析出提示词数据 + id 集合与逐字段等于 S1）
//   S3 src/tracker/rooms/{github,gitlab,markdown}/index.{ts,js} 的 prompts 块（逐字符词法扫描，含拼接续段）
//   S4 src/host/** 与 src/refresh/rooms/host/** 的 *_PROMPT 常量（#1427 起后者加入）
//   S5 S1 里含 {占位符} 的条目：占位符先求值（真实值 / 空串 / 哨兵三种展开）再判，另加「值形态」与「拆占位符拼装」两道
//
// #595 补的三面（以前完全不扫，塞进去就全绿）：
//   S6 注册表之外的客户端文本来源：三处片段（newBugFields / newWayfinderWiring / vocabularyDefaults，
//      按注入时机住在 config/prompts/ 的对应族 YAML 里）＋ 客户端那两片源码（prompts.ts / prompts-backend.ts）里剩下的字符串字面量
//   S7 src/client/kernel/config.js 的字符串字面量（TPL_DEFAULT 默认模板等）
//   S8 客户端产物里消费者看得见的提示词文本（从产物解析出的模板条目）过 judge()：不许出现 gh / glab 命令形状
//      （以前只卡 'dsh plugin --profile <配置名> exec' 与 'scripts/fix-issue-body.mjs' 两个字面串，换别的命令就全绿）
//
// 不扫（有意为之，见 §1.1）：docs/**（本来就该写具体命令）、tests/**、scripts/*.mts、src/host 的代码注释与正则字面量。
//
// 豁免只有一张表，登记在 tests/prompt-gate-exempt.json（门禁只读它，代码里不留第二份）：
//   kind=rule  该条确实还写着具体跟踪器命令、属第二批范围 → 跳过判定（登记在案的债）
//   kind=scope 该条不属首批范围 → 门禁仍然判它，只是登记「不属首批」，所以 scope 不是放行口子
// 受保护清单 PROTECTED 里的条目（本票收敛过的）绝不许进豁免表 —— 这是防「换一条豁免整体放行」的变异自检。
const fs = require('fs')
const os = require('os')
const path = require('path')
const childProcess = require('child_process')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.ts 文件头。
const { compileFn } = require('./lib/eval-probe.ts')
// 取源走共用入口（#1207 立）：本文件好几处要拿**客户端那两片源码**的文本做正则解析与求值。
//   #1209 起 prompts 真源是 .ts（按 .js 路径直接读会读到构建产物，产物是转译过的排版 —— 引号全变双引号、
//   对象被压成一行，正则与文本锚点会当场失效）。
//   #1292 起提示词数据不再住在源码里（真源是 config/prompts/ 下的 YAML），但客户端那两片源码仍要按文本读：
//   一是判「客户端源码里还有没有漏掉的提示词字面量」（S6），二是把它们求值一遍、验渲染面（S5）。
const { sourceText, sourcePath } = require('./lib/source-text.ts')
// 求值前那一步整段转译走全仓唯一那份口径（构建也用它）：这里不另写一份 esbuild 参数，
// 否则门禁求值的文本会和真正拼进产物的那份慢慢分家，而且分家不报错。
const { loadEsbuild } = require('../scripts/lib/transpile-domains.mts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')

const ROOT = path.join(__dirname, '..')
const SELF = path.join(__dirname, 'verify-prompts.ts')
const EXEMPT_FILE = path.join(__dirname, 'prompt-gate-exempt.json')
const PAYLOAD_FILE = path.join(__dirname, 'prompt-gate-payloads.json')
const IS_CHILD = process.env.DSH_VERIFY_PROMPTS_CHILD === '1'

let failed = false
const problems = []
const fail = function (msg) { failed = true; problems.push(msg); return false }
const check = function (cond, msg) { if (!cond) { failed = true; problems.push(msg) } return !!cond }

// ==================== 0. 契约常量（硬编码，改动要走评审） ====================
const EXPECT_REGISTRY_ENTRIES = 27 // 注册表条目数（#1281：新增 newSpec / tpl.implement / specSplit / specExecute / specComplete 五条，23 → 28；2026-10-21：删 registry#ghAuthLogin —— 用户可见的登录指引只有 GitHub 后端那一句，YAML 这份在全部路径上被它遮住，28 → 27）（#725：progress 与 bodyFormat 两条整节删除，23 → 21；#771：新增 tpl.takeover 与 tpl.supplement，21 → 23；拆行/换引号不会让它少，因为 S1 用求值解析）
// S3 各后端 prompts 块顶层键数。v2 §1.1 写的是 7/9/6，实测不成立（gitlab 只有 4 键、markdown 只有 2 键），
// 这里按实测值硬编码并在失败信息里报出真实值，避免「按错值写断言导致永久红」。
// #684：三个后端各加一条 healthCheck（体检科目），7/6/4。
// #716：三个后端各加一条 commandVocabulary（自己的命令行名与站点名字，供模板里的 {cli} / {cliBrand} 填空），
//   9/7/5。
// #725：三后端各自的 prompts.bodyFormat 整节删除 —— 键数各减 1：9/7/5 → 8/6/4。
// #1514：markdown 的 wayfinderMapBuild 整条删除（「执行 wayfinder 构造地图」按钮的注入提示词不再成立），
//   键数 4 → 3；github / gitlab 不受影响，仍是 8 / 6。
// #1190：两后端各加通用键别名（github 加 cliLogin 与 ghAuthLogin 同文、gitlab 加 cliInstall/cliLogin 与 glab 两条同文，
//   旧键保留做回退），键数 8/6 → 9/8；markdown 不动。
const EXPECT_BACKEND_KEYS = { github: 9, gitlab: 8, markdown: 3 }
// S3 各后端 prompts 块内的字符串字面量总数（含字符串拼接的续段，如 ensureLabels 的命令就藏在续段里）。
// 这个数字是「词法扫描不许静默少扫」的硬保证：少扫一段就会对不上。
// #684：github +2（healthCheck 的 zh/en）、gitlab +2、markdown +2。
// #716：github +4（commandVocabulary 的 cli/cliBrand + cliInstall 的 zh/en，同时 subIssue 与 healthCheck 改写、
//   ensureLabels 与 repoAccessFix 去命令，净 +4）、gitlab +2、markdown +1。
// #725：正文格式那条声明删掉后，字面量各减 2（zh/en 两份）：46/14/9 → 44/12/7。
// #993/#994（2026-10-10）：github 的 prompts.errorKinds 新增两档 —— 'git-ownership' 与 'unknown'（各一条 zh/en
//   短文案，外加两行解释注释也是字符串字面量），44 → 50。这两档是「创建并发布」失败时给用户看的文案，
//   修法提示与原文另走界面那两条路，不放这里，所以只加两条短句。
// #1514：markdown 的 wayfinderMapBuild（zh/en 两条短句）整条删除，字面量 markdown 7 → 5；github / gitlab 不动。
// #1190：通用键别名与旧键同文（每条 zh/en 各一字面量），字面量 github +2（cliLogin）、gitlab +4（cliInstall/cliLogin）；markdown 不动。
const EXPECT_BACKEND_LITERALS = { github: 52, gitlab: 16, markdown: 5 }
// #664：宿主那份「怎么装 gh」的长文（GH_INSTALL_PROMPT）按新流程退役，此后很长一段时间 src/host 全树一个
//   *_PROMPT 常量都没有（本行原为 0）。#839 起有一个真的了：src/refresh/rooms/host/gh-execution.js 的
//   GIT_TERMINAL_PROMPT: '0'（非交互环境那一条固定前缀）。门禁口径是「≥ 这个数」，合法新增不判红，
//   但少到比这个数还少就是有人把那条常量删了 —— 这里按实数改成 1。
const EXPECT_HOST_PROMPT_CONSTS = 1 // src/host 全树 *_PROMPT 常量数
// #716：github 那两条 rule 豁免（ensureLabels / repoAccessFix）所欠的债已经还清 —— 两条文案改成走工具，
//   一个裸命令都不剩，所以从登记表里撤掉，10 → 8（撤掉的这两条从此受判定）。
// 2026-10-21：登录引导单源化 —— 删掉 registry#ghAuthLogin 这条 scope 登记（YAML 模板已删除），8 → 7。
const EXPECT_EXEMPT = 7 // 豁免登记条数硬编码（防偷偷加豁免）

// 受保护清单：全量覆盖 —— 所有扫描面的 id 减去「kind=rule 豁免」，一个不漏。
// 下面 auditExemptTable 会断言这张硬编码清单与运行时算出来的集合逐条相等，所以清空它 / 删几行都会红。
const PROTECTED = [
  'registry#mapExecute', 'registry#complete', 'registry#fixate',
  'registry#tpl.diagnose', 'registry#tpl.fix', 'registry#tpl.implement', 'registry#tpl.discuss', 'registry#tpl.research',
  'registry#tpl.prototype', 'registry#tpl.takeover', 'registry#tpl.supplement', 'registry#tpl.execute', 'registry#tpl.handoff1', 'registry#tpl.handoff2',
  'registry#specSplit', 'registry#specExecute', 'registry#specComplete', 'registry#newSpec',
  'registry#installSkillsFix', 'registry#installSkills', 'registry#setupRun', 'registry#switchAlign', 'registry#switchLayout', 'registry#newWayfinder',
  'registry#newBugWayfinder', 'registry#mapInspect', 'registry#healthCheck',
  'backend:github#ghAuthLogin', 'backend:github#subIssue', 'backend:github#errorKinds',
  'backend:github#healthCheck', 'backend:github#commandVocabulary', 'backend:github#cliInstall',
  'backend:github#ensureLabels', 'backend:github#repoAccessFix',
  'backend:gitlab#glabInstallFix', 'backend:gitlab#glabLoginFix', 'backend:gitlab#subIssue',
  'backend:gitlab#healthCheck', 'backend:gitlab#commandVocabulary',
  'backend:markdown#subIssue',
  'backend:markdown#healthCheck', 'backend:markdown#commandVocabulary',
]
// 必须受判定（kind 只许是 scope）的 6 条：它们登记「不属首批」，但门禁仍然判它们
const MUST_JUDGE = [
  'registry#installSkills',
  'backend:github#ghAuthLogin',
  'backend:gitlab#glabInstallFix', 'backend:gitlab#glabLoginFix',
  'backend:gitlab#subIssue', 'backend:markdown#subIssue',
]
const EXPECT_MUST_JUDGE = 6 // 硬编码：清空这张表等于让这 6 条脱离判定，所以条数要卡死
// #1293：OBJECT_PROTO_KEYS 随 auditRegistryShape 一起退场 —— 注册表现在由 registryFromEntries 从 YAML 解析结果
//   造出普通对象，没有 JS 求值面，原型污染 / 不可枚举属性 / getter / Symbol 键这些形状都构造不出来。
//   「被藏起来的条目」的兜底判据改成两条更直接的：条目数硬编码 27（EXPECT_REGISTRY_ENTRIES）+
//   YAML 文本顶层键与解析 id 双向一致（主跑 S1 那两处）。auditRegistryShape 里唯一仍适用的
//   「锚点/别名藏内容」判据没有丢，改由 yamlHidingShape 逐份 YAML 判（见 promptYamlHidingHits）。
// 每个面允许的 rule 豁免集合（硬编码：改一个 id 或把 scope 改成 rule 都会与这张表对不上）
const RULE_EXEMPT_EXPECTED = {
  registry: [],
  // #716：github 面那两条 rule 豁免已经撤掉（文案改成走工具，不再写裸命令），所以这一档现在是空的。
  'backend:github': [],
  'backend:gitlab': ['glabRepoFix'],
  'backend:markdown': [],
  S4: [],
}

// ==================== 1. 归一化 + 判定式（.scratch/573-gate-design-v2.md §1.3 / §1.4） ====================
const ZW = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g
const QUOTES = /["'`´’‘“”]/g
// 同形字母：NFKC 不处理 IPA 小写 ɡ（U+0261）这类，单独映射成 g
const HOMOGLYPH = /[\u0261\u0262\u1D26\u1D33\u1D4D]/g
// 零宽字符两种还原（删除 / 变空格）都要判：删掉会把 gh 与 issue 粘成 ghissue 反而放行，所以要两种都跑
const normVariants = function (s) {
  const base = String(s == null ? '' : s).normalize('NFKC').replace(HOMOGLYPH, 'g')
  const out = []
  for (const zw of ['', ' ']) {
    let t = base.replace(ZW, zw).replace(QUOTES, '')
    t = t.replace(/\\\s*\n/g, ' ')
    t = t.replace(/\\[nrt]/g, ' ')
    t = t.replace(/\s+/g, ' ').trim().toLowerCase()
    if (out.indexOf(t) < 0) out.push(t)
  }
  return out
}

// #603 起不再有「合法命令形态白名单」：领导拍板撤掉「先解析插件安装目录、再调包内脚本写回」那套两步写法，
//   模板层一个具体命令都不许写，所以旧白名单（第 ① 步 dsh plugin --profile … exec / 第 ② 步 node "<插件目录>/scripts/….mjs" /
//   前置 gh auth status / 旧 bare 形态 node scripts/….mjs）整套删除 —— 留着它等于留一个「命中白名单就跳过判定」的口子。
//   那些旧写法现在由 R8 一律判红（见下）。
//
// R8（#603 新增，所有面都判，含允许 gh 命令的 github 后端声明面）：
//   不许出现「先解析插件安装目录，再调包内脚本」这套间接写法。归一化后命中下面任一样即判红：
//     dsh plugin                 拿插件安装目录的那条命令（含它的旧写法 dsh plugin exec）
//     require.resolve            同一件事的另一种写法
//     <插件目录> / <pluginDir>    提示词里指代插件安装目录的占位符
//     fix-issue-body.mjs / wire-subissues.mjs（含 .mts 新后缀）   包内脚本名（提示词现在改回 gh 直连，一个脚本都不许调）
//   注意：模板里说「不需要找插件目录」「不需要跑写回脚本」这类**说明性散文**不算命中（没有尖括号、没有脚本名），
//   那些句子正是在告诉 agent 别去做这件事；只有真写出可照抄的东西才算。
// 反规避：判之前把反斜杠去掉再跑一遍，挡住 fix-issue\-body.mjs / dsh\ plugin 这种拆字写法。
const RE_INDIRECT = /dsh\s*plugin|require\s*\.\s*resolve|<\s*(?:插件目录|plugin[ _-]?dir)\s*>|fix-issue-body\s*\.\s*m(?:j|t)s|wire-subissues\s*\.\s*m(?:j|t)s/i
// R1 的判定窗口有两档：
//   紧写法（≤4 个任意非字母数字字符）抓 gh、issue / 用gh api / gh　issue / gh<零宽>issue 这类；
//   宽写法（同行任意长度的可打印 ASCII 字符）抓 gh -R owner/repo issue edit / gh.exe issue /
//   glab -R o/r issue update / gh -C <很长的绝对路径> issue edit 这类带选项或值的写法。
//   上限不设长度：本仓库真名 FeatherHunter/dsh-mattpocock-skills-deck 与真实绝对路径都会把间隔撑到 40 以上，
//   设 40 会让真回潮写法从窗口里溜过去。
//   宽写法只吃可打印 ASCII，所以「gh）—— 面板所有数据依赖它（issue」这种中文说明文字不会被误判。
const RE_TRACKER = /(?<![a-z0-9_\-])(?:gh|glab)(?![a-z0-9_])(?:[^a-z0-9_]{0,4})(?:issue|api|label|repo|pr|mr|milestone|project|sub_issues)(?![a-z0-9_])/
const RE_TRACKER_WIDE = /(?<![a-z0-9_\-])(?:gh|glab)(?:\.exe)?(?![a-z0-9_])[ -~]*?(?:issue|api|label|repo|pr|mr|milestone|project|sub_issues)(?![a-z0-9_])/
const RE_PKG = /(?:npm|npx|pnpm|yarn|corepack)\s+(?:exec|x|run|dlx)?[^\n]{0,24}?(?<![a-z0-9_\-])(?:gh|glab)(?![a-z0-9_])/
const RE_BARE_API = /(?:^|[^a-z0-9_])(?:https?:\/\/)?api\.(?:github|gitlab)\.com\b/
const RE_HEREDOC = /(?<![a-z0-9_])(?:cat|sh|bash|zsh|pwsh|powershell|node|python3?|ruby|perl)(?![a-z0-9_])[^\n]{0,60}<<[-~]?[a-z_][a-z0-9_]*/
const RE_SCRIPT = /(?<![a-z0-9_])(?:node|npx|npm\s+exec)\s+([a-z0-9_./\\-]+\.(?:mjs|js))(?![a-z0-9_])/g
const RE_BODY_FLAG = /(?<![-\w])--body(?!-file)(?![a-z0-9_-])|(?<![-\w])-b(?![a-z0-9_-])/
const RE_CMD_CTX = /(?<![a-z0-9_])(?:gh|glab|curl|wget|node|npm|npx|pnpm|yarn|sh|bash|zsh|pwsh|powershell|cmd|python3?|ruby|perl|php)(?![a-z0-9_])/
// R7 混淆执行：红队报告 §3.2 E13 要求必抓（base64 -d / -D 管道、xxd -r -p、String.fromCharCode、\xNN 转义、eval 引号）。
// v2 §1.4 只写了 R1–R6，漏了这条；这里照红队建议正则补齐，实测 24 条误报仍全绿。
const RE_OBFUSCATED = /(?:base64\s+(?:-d|-D|--decode))|(?:xxd\s+(?:-r\s+-p|-p\s+-r))|(?:String\.fromCharCode)|(?:\\x[0-9a-f]{2})|(?:\beval\s+["'`$])/i
// 「拆占位符拼装」探测器：命令词由占位符值提供、子命令由模板字面量提供时命中。
// 与 R1 宽写法同形，但只用来判探针（把命令词塞进单个占位符后的渲染结果），不参与常规判定。
const RE_ASSEMBLED = RE_TRACKER_WIDE
// 「命令词」探测器（#603）：正文格式块只讲正文该怎么写，跟后端命令无关，所以正文格式块的断言要直断「一个命令词都没有」。
//   口径比 R1 宽：gh / glab 之外的 dsh、node、npm 这些也算，脚本名、命令行参数、插件目录占位符同样算。
const RE_COMMAND_WORD = /(?:^|[^a-z0-9_])(?:gh|glab|dsh|node|npx|npm|pnpm|yarn|curl|wget|bash|pwsh|powershell|cmd)(?![a-z0-9_])|\.mjs\b|--[a-z][a-z-]*|<\s*(?:插件目录|plugin[ _-]?dir)\s*>/i
const commandWordIn = function (text) {
  const m = RE_COMMAND_WORD.exec(String(text == null ? '' : text))
  return m ? m[0].trim() : ''
}

const RULE_FIX = {
  R1: '模板里一个具体命令都不许写：跟踪器操作改由后端声明、渲染时经占位符注入（GitHub 用 gh 直连、其它后端用自己那套），模板里只留 {subIssue} 这类占位符',
  R2: '不要经包管理器转发跟踪器命令（npm exec gh / npx gh）',
  R3: '不要直接打跟踪器 API 地址（api.github.com / api.gitlab.com）',
  R4: '正文不许内联进命令行（--body <正文>）：先写成文件，再按当前后端自己的方式整份读进去',
  R5: '不要用 heredoc 传正文，正文先写成文件',
  R6: '提示词里不许调用任何脚本（发布包里的 fix-issue-body.mts / wire-subissues.mts 只作可选工具，不由提示词调用）；跟踪器操作直接写当前后端自己的命令行',
  R7: '不要写混淆执行（base64 -d / xxd -r -p / String.fromCharCode / \\x 转义 / eval 加引号）',
  R8: '不要写「先解析插件安装目录，再调包内脚本」这套间接写法（dsh plugin / require.resolve / <插件目录> / <pluginDir> / fix-issue-body(.mjs/.mts) / wire-subissues(.mjs/.mts) 都算）：跟踪器操作直接用当前后端自己的命令行（GitHub 就是 gh）',
}

// 判定一个字符串：返回 [{rule, snippet}]，空数组 = 通过
// opts.allowTracker（#603 新增）：按面开关「禁止跟踪器命令」这一条（R1）—— 只有 github 后端声明面传 true，
//   因为领导拍板 gh 直连、gh 命令就写在那里；R2–R8 在任何面都判，allowTracker 不影响它们。
const judge = function (text, opts) {
  const raw = String(text == null ? '' : text)
  const allowTracker = !!(opts && opts.allowTracker)
  const hits = []
  const push = function (rule, hay, idx) {
    const from = Math.max(0, (idx || 0) - 30)
    hits.push({ rule: rule, snippet: String(hay).slice(from, from + 60).replace(/\s+/g, ' ') })
  }
  normVariants(raw).forEach(function (t) {
    let m
    // R1：模板层与非 GitHub 后端不许出现具体跟踪器命令；github 后端声明面按面放行（#603）
    if (!allowTracker) {
      m = RE_TRACKER.exec(t)
      if (!m) m = RE_TRACKER_WIDE.exec(t)
      if (m !== null) push('R1', t, m.index)
    }
    if ((m = RE_PKG.exec(t)) !== null) push('R2', t, m.index)
    if ((m = RE_BARE_API.exec(t)) !== null) push('R3', t, m.index)
    if ((m = RE_HEREDOC.exec(t)) !== null) push('R5', t, m.index)
    RE_SCRIPT.lastIndex = 0
    while ((m = RE_SCRIPT.exec(t)) !== null) push('R6', t, m.index)
    // R8：不许出现「先解析插件安装目录，再调包内脚本」的间接写法。
    //   同一条文本再判一遍「去掉反斜杠」的写法，挡住 fix-issue\-body.mjs / dsh\ plugin 这种拆字规避。
    ;[t, t.replace(/\\/g, '')].forEach(function (v) {
      const mi = RE_INDIRECT.exec(v)
      if (mi) push('R8', v, mi.index)
    })
  })
  // R4 逐行判：归一化会把换行压成空格，所以按「原行」分别归一化后再判，保住行边界
  //   （否则一段说明文字里的 --body 会和下一行的 npx 被压成同一行，误判成内联正文）
  raw.split(/\r?\n/).forEach(function (line) {
    normVariants(line).forEach(function (nl) {
      if (RE_BODY_FLAG.test(nl) && /\s=?\s*\S/.test(nl) && RE_CMD_CTX.test(nl)) {
        const mm = RE_BODY_FLAG.exec(nl)
        push('R4', nl, mm ? mm.index : 0)
      }
    })
  })
  // R7 在原文上也判一次：归一化会剥引号，eval " 只在原文里看得见
  const seen = {}
  ;[raw].concat(normVariants(raw)).forEach(function (t) {
    if (seen[t]) return
    seen[t] = 1
    const m = RE_OBFUSCATED.exec(t)
    if (m) push('R7', t, m.index)
  })
  const uniq = []
  hits.forEach(function (h) { if (!uniq.some(function (u) { return u.rule === h.rule && u.snippet === h.snippet })) uniq.push(h) })
  return uniq
}

// 渲染：把文本里所有 {名字} 换成给定值（未给的名字按 fallback 处理）
const renderWith = function (text, values, fallback) {
  return String(text).replace(/\{(\w+)\}/g, function (m, name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : String(fallback)
  })
}
// S5：三种展开都判（真实值 / 空串 / 哨兵），任一份红即红。opts 原样透传给 judge（github 面传 allowTracker）
const judgeRendered = function (text, values, opts) {
  const out = []
  out.push.apply(out, judge(renderWith(text, values, ''), opts))
  out.push.apply(out, judge(renderWith(text, {}, ''), opts))
  out.push.apply(out, judge(renderWith(text, {}, '\u0000'), opts))
  return out
}
// S5 附加：「拆占位符拼装」探测用的探针值 —— 把命令词塞进单个占位符，看渲染后会不会拼出命令
const PLACEHOLDER_PROBES = ['gh', 'glab', 'node', 'curl', 'cat', 'npm', '--body']
// 取出文本里所有占位符名字（去重，保持出现顺序）
const placeholderNames = function (text) {
  const names = []
  String(text).replace(/\{(\w+)\}/g, function (m, n) { if (names.indexOf(n) < 0) names.push(n); return m })
  return names
}

// ==================== 2. 豁免登记表（外部文件 + 受保护清单 + 六条自检） ====================
// 说明：夹具自锁（sha256）那一节刻意放在本标记之后 —— 判定层切片工具（.scratch/576-lab-lib.js）
// 取的是「const ZW =」到本标记之间的源码并直接求值，切片里不能出现 require 之类的外部引用。
const loadExempt = function () {
  try {
    const raw = JSON.parse(fs.readFileSync(EXEMPT_FILE, 'utf8'))
    const list = Array.isArray(raw) ? raw : (raw.entries || [])
    return list.map(function (e) { return Object.freeze(Object.assign({}, e)) })
  } catch (e) {
    failed = true
    problems.push('读不到豁免登记表 tests/prompt-gate-exempt.json：' + e.message + '\n     修法：这个文件是唯一的放行登记处，缺了门禁不能瞎跑')
    return []
  }
}
const EXEMPT = loadExempt()
const exemptKey = function (surface, id) { return surface + '#' + id }
const ruleExemptIds = function (list, surface) {
  return list.filter(function (e) { return e.surface === surface && e.kind === 'rule' }).map(function (e) { return e.id })
}
const isRuleExempt = function (list, surface, id) { return ruleExemptIds(list, surface).indexOf(id) >= 0 }

// 纯函数：给定豁免表与各面 id 集，返回问题列表（主跑与变异自检都走它）
const auditExemptTable = function (list, surfaceIds, opts) {
  const out = []
  const o = opts || {}
  if (list.length !== EXPECT_EXEMPT) out.push('EXEMPT 条数 ' + list.length + '（期望硬编码 ' + EXPECT_EXEMPT + '；改豁免必须走评审）')
  // ① 形状：每条必须有 surface / id / kind / rule / reason
  list.forEach(function (e, i) {
    ;['surface', 'id', 'kind', 'rule', 'reason'].forEach(function (f) {
      if (!e || typeof e[f] !== 'string' || !e[f]) out.push('EXEMPT[' + i + '] 缺字段 ' + f + '（每条必须写清面、条目、类型、规则与理由）')
    })
    if (e && ['rule', 'scope'].indexOf(e.kind) < 0) out.push('EXEMPT[' + i + '] kind 只能是 rule 或 scope（实得 ' + String(e && e.kind) + '）')
  })
  // ② 存在性：豁免项必须真实存在（单文件模式只扫了注册表面，其它面整体跳过）
  list.forEach(function (e) {
    if (!e || !e.surface) return
    if (o.skipSurfaces && o.skipSurfaces.indexOf(e.surface) >= 0) return
    if (!surfaceIds[e.surface]) { out.push('EXEMPT 引用了不存在的扫描面：' + e.surface + '（' + e.id + '）'); return }
    if (surfaceIds[e.surface].indexOf(e.id) < 0) out.push('EXEMPT 引用了不存在的条目：' + e.surface + ' / ' + e.id)
  })
  // ③ 完备性：每个面「被扫 ∪ rule 豁免 == 全部」
  Object.keys(surfaceIds).forEach(function (surface) {
    const all = surfaceIds[surface]
    const exempt = ruleExemptIds(list, surface)
    const scanned = all.filter(function (id) { return exempt.indexOf(id) < 0 })
    const union = scanned.concat(exempt).filter(function (v, i, a) { return a.indexOf(v) === i })
    const missing = all.filter(function (id) { return union.indexOf(id) < 0 })
    const extra = union.filter(function (id) { return all.indexOf(id) < 0 })
    if (missing.length || extra.length || union.length !== all.length) {
      out.push('EXEMPT 完备性失败 ' + surface + '：全部 ' + all.length + '、被扫 ' + scanned.length + '、豁免 ' + exempt.length +
        (missing.length ? '、漏 ' + missing.join(',') : '') + (extra.length ? '、多 ' + extra.join(',') : ''))
    }
  })
  // ④ 每个面的 rule 豁免集合必须与硬编码清单逐条相等
  //    （这是「把一条 scope 改成 rule 并指向别的 id」的封堵点：改一个词，集合就对不上）
  Object.keys(RULE_EXEMPT_EXPECTED).forEach(function (surface) {
    if (o.skipSurfaces && o.skipSurfaces.indexOf(surface) >= 0) return
    if (!surfaceIds[surface]) return
    const got = ruleExemptIds(list, surface).slice().sort()
    const want = RULE_EXEMPT_EXPECTED[surface].slice().sort()
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      out.push('EXEMPT 的 rule 豁免集合与硬编码清单不一致：' + surface + ' 实得 [' + got.join(',') + ']，期望 [' + want.join(',') + ']')
    }
  })
  // ⑤ 必须受判定的 6 条：必须存在、且 kind 只许是 scope（把 scope 改成 rule 即红）
  MUST_JUDGE.forEach(function (k) {
    const parts = k.split('#')
    if (o.skipSurfaces && o.skipSurfaces.indexOf(parts[0]) >= 0) return
    const hit = list.filter(function (e) { return e && e.surface === parts[0] && e.id === parts[1] })
    if (hit.length !== 1) { out.push('EXEMPT 缺一条必须登记的 scope 条目：' + k); return }
    if (hit[0].kind !== 'scope') out.push('EXEMPT 里 ' + k + ' 的 kind 被改成 ' + hit[0].kind + '（这 ' + MUST_JUDGE.length + ' 条必须受判定，只许 scope）')
  })
  // ⑥ 受保护清单：全量覆盖 + 与运行时算出来的集合逐条相等 + 非空
  const computedProtected = []
  Object.keys(surfaceIds).forEach(function (surface) {
    if (o.skipSurfaces && o.skipSurfaces.indexOf(surface) >= 0) return
    const exempt = ruleExemptIds(list, surface)
    surfaceIds[surface].forEach(function (id) { if (exempt.indexOf(id) < 0) computedProtected.push(surface + '#' + id) })
  })
  if (!PROTECTED.length) out.push('PROTECTED 被清空了（受保护清单必须全量覆盖，不许为空）')
  if (o.skipSurfaces) {
    // 单文件模式只扫了注册表面：只比较注册表那部分
    const sub = PROTECTED.filter(function (k) { return k.indexOf('registry#') === 0 })
    const got = computedProtected.filter(function (k) { return k.indexOf('registry#') === 0 })
    if (JSON.stringify(sub.slice().sort()) !== JSON.stringify(got.slice().sort())) {
      out.push('PROTECTED 与注册表实际受保护集合不一致：实得 [' + got.join(',') + ']')
    }
  } else if (JSON.stringify(PROTECTED.slice().sort()) !== JSON.stringify(computedProtected.slice().sort())) {
    const missing = computedProtected.filter(function (k) { return PROTECTED.indexOf(k) < 0 })
    const extra = PROTECTED.filter(function (k) { return computedProtected.indexOf(k) < 0 })
    out.push('PROTECTED 未全量覆盖：漏 ' + (missing.join(',') || '无') + '；多 ' + (extra.join(',') || '无'))
  }
  // ⑦ 只有 kind=rule 的豁免才等于「放行」，scope 条目仍然受判定，所以不在此列
  list.forEach(function (e) {
    if (!e || !e.surface || e.kind !== 'rule') return
    if (PROTECTED.indexOf(exemptKey(e.surface, e.id)) >= 0) {
      out.push('EXEMPT 用 rule 放行了受保护条目：' + e.surface + ' / ' + e.id + '（受保护清单里的条目绝不许豁免判定）')
    }
  })
  // ⑧ 与登记文件逐条相等（防止门禁里另留一份、或加载后被改写）
  if (o.fileEntries) {
    const a = JSON.stringify(list)
    const b = JSON.stringify(o.fileEntries)
    if (a !== b) out.push('EXEMPT 与 tests/prompt-gate-exempt.json 逐条不相等（门禁只许读登记文件，不许在代码里改）')
  }
  return out
}

// ==================== 3. 解析层 ====================
// #1292：注册表真源搬进 YAML 之后的取源与解析。
//
// 为什么改这一段：#1292 把提示词正文的真源从「源码里的字面量」搬到了 config/prompts/ 下的五份 YAML
//   （语言清单是 config/languages.yaml），生成器 scripts/generate-prompt-config.mts 按 YAML 写出
//   src/client/kernel/prompt-data.ts，那份生成物是客户端闭包里的运行时数据（构建期现场生成、不入库）。
//   判定口径一条没放松：注册表仍是「27 条、每条 version / placeholders / use / zh / en」，
//   读出来的文本仍逐条过 judge()，产物里的文本仍逐字段等于真源。变的只有「真源是文件而不是源码」。
//
// 为什么用共享读取核而不是自己解析 YAML：scripts/lib/prompt-config.mts 是生成器与门禁共用的那一份
//   （键清单、字段校验、语言回退链校验都在那里）。两边各写一份就是「改了 YAML 的键名、忘了同步某一边」
//   那种悄悄失效的温床 —— 键名对不上时，那一边会静默少扫几条模板，门禁却全绿。
const promptConfig = require('../scripts/lib/prompt-config.mts')
const yamlLib = require('yaml')

/** 五份模板族 YAML 的路径（相对仓库根）。语言清单那份（languages.yaml）不在这里 —— 它不是注册表。
 *  族文件里同时住着模板与片段（片段按注入时机归族），所以这里拿到的文本层键集合 = 模板 id + 片段 id。 */
const PROMPT_TEMPLATE_YAML_RELS = promptConfig.PROMPT_YAML_PATHS.filter(function (rel) {
  return rel.indexOf('languages.yaml') < 0
})
/** 登记在案的三处片段 id —— 文本层里它们与模板 id 混在同一份族文件里，判「多出来的键」时要认得出来。 */
const FRAGMENT_ID_SET = {}
promptConfig.PROMPT_FRAGMENT_IDS.forEach(function (s) { FRAGMENT_ID_SET[s.id] = s })

/**
 * 把「一张平表」拍平成注册表（id → 条目），形状与从前源码求值拿到的那张表同形。
 * 字段缺失一律补成空串 / 空数组：不静默丢掉条目（条目少了要由条数断言与受保护清单抓出来）。
 */
const registryFromEntries = function (table) {
  const reg = {}
  Object.keys(table || {}).forEach(function (id) {
    const e = table[id] || {}
    reg[id] = {
      version: Number(e.version),
      placeholders: Array.isArray(e.placeholders) ? e.placeholders.slice() : [],
      use: String(e.use == null ? '' : e.use),
      zh: String(e.zh == null ? '' : e.zh),
      en: String(e.en == null ? '' : e.en),
    }
  })
  return reg
}

/**
 * 解析一份「注册表 YAML 文本」→ 注册表。
 * YAML 语法错、顶层不是对象、键重复，一律抛错 —— 这就是从前「求值失败」那一档：
 *   坏文本必须当场判红，不许静默少扫（重复键由 yaml 解析器自己报错）。
 */
const parseRegistryYamlText = function (text) {
  const doc = yamlLib.parse(String(text))
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('注册表 YAML 顶层必须是对象（顶层键 = 模板 id）')
  const table = {}
  Object.keys(doc).forEach(function (k) { if (k !== 'version') table[k] = doc[k] })
  return registryFromEntries(table)
}

/**
 * YAML 里能「把内容藏起来」的两种写法：锚点（&name）与别名（*name）。
 *   靠文本正则认不准（提示词正文里本来就有 & 与 * 这些字符），所以走 YAML 的语法树看：
 *   任何带 anchor 的节点或别名节点都判红。标签（!!tag）由解析器自己拦（认不出的标签直接报错）。
 */
const yamlHidingShape = function (text) {
  const doc = yamlLib.parseDocument(String(text))
  let hit = ''
  yamlLib.visit(doc, {
    Alias: function () { hit = '别名（*name，引用别处的内容）' },
    Node: function (_key, node) { if (!hit && node && node.anchor) hit = '锚点（&name）' },
  })
  return hit
}

/**
 * #1293：逐份判 config/prompts/ 下的五份 YAML 有没有锚点 / 别名。
 * 为什么逐份判、不把五份拼起来判：yaml.parseDocument 一次只吃一份文档；从前 auditRegistryShape 把
 *   五份 YAML 拼成一整段交给 yamlHidingShape，parseDocument 遇到多文档会抛错、被 try/catch 吞掉，
 *   于是那条判据在完整模式下其实一次都没生效过。本票改成一份一份判：语法树读不出来也判红，
 *   不许因为「读不出」就把这条判据静默跳过。
 * 返回一串人话问题描述（空数组 = 五份都干净）。
 */
const promptYamlHidingHits = function () {
  const hits = []
  PROMPT_TEMPLATE_YAML_RELS.forEach(function (rel) {
    const p = path.join(ROOT, rel)
    let hit = ''
    try {
      hit = yamlHidingShape(fs.readFileSync(p, 'utf8'))
    } catch (e) {
      hits.push(rel + ' 的 YAML 语法树读不出来（' + ((e && e.message) || e) + '）—— 锚点/别名判据扫不到这一份，先把 YAML 修成合法文档')
      return
    }
    if (hit) hits.push(rel + ' 含' + hit + '（可以把内容藏起来再别处引用，条目会不声不响地少掉，禁止）')
  })
  return hits
}

/**
 * 把客户端那两片源码合成一段可求值的 JavaScript。
 * #1292：提示词数据不再是源码里的字面量，而是生成物 PROMPT_TEMPLATE_DATA / PROMPT_FRAGMENT_DATA ——
 *   这两个名字由本门禁当参数注入（客户端闭包里它们由 kernel:promptData 那一片提供；这里注入的是同一份数据）。
 *   两片源码在客户端闭包里是同一段作用域，所以合成一段求值与闭包里的情形一致。
 */
const clientSourceText = function () {
  return ['src/client/kernel/prompts.ts', 'src/client/kernel/prompts-backend.ts']
    .map(function (rel) { return sourceText(rel) })
    .join('\n')
}
/** 合成后整段转译成 JavaScript（口径与构建那份唯一实现相同，见 scripts/lib/transpile-unit.mts）。 */
const transpileClientSources = function (src) {
  try {
    return loadEsbuild().transformSync(String(src), { ...TRANSPILE_OPTIONS, loader: 'ts' }).code
  } catch (e) {
    throw new Error('转译客户端源码失败（这一步在求值之前，不是模板本身的问题）：' + ((e && e.message) || e))
  }
}
// #595 渲染层求值：同一段源码再求值一次，额外拿到「按后端填空」的渲染入口（promptTextFor / BODY_FORMAT）。
//   localeSvc 由本门禁注入（locale 决定取 zh 还是 en），因此可以对同一后端渲染出两种语言的文本。
const evalPromptHelpers = (function () {
  let src0 = null
  let data0 = null
  const byLang = {}
  const instanceOf = function (lang) {
    if (!src0) throw new Error('evalPromptHelpers 未初始化（先调用 prime(src, data)）')
    if (byLang[lang]) return byLang[lang]
    const body = String(src0).replace(/^[ \t]*export[ \t]+/gm, '')
    // 这里选 compileFn：依赖名逐个传给共用入口，下面调用时仍按原顺序把注入的替身传进去。
    // #1292：多三个依赖名 —— PROMPT_TEMPLATE_DATA、PROMPT_FRAGMENT_DATA 与 LANGUAGES_YAML。客户端闭包里这三个
    //   名字由 kernel:promptData 那一片（生成物 prompt-data.ts）提供；这里注入的是同一份数据（读自 YAML）。
    const factory = compileFn(['localeSvc', 'issueUrlFor', 'PROMPT_TEMPLATE_DATA', 'PROMPT_FRAGMENT_DATA', 'LANGUAGES_YAML'], body +
      '\n;return { PROMPTS: PROMPTS, promptText: promptText, promptTextFor: promptTextFor, completePrompt: completePrompt };')
    // issueUrlFor 由本门禁注入替身（真实那个住 router.js，不在这一段源码里）：只用于验「按真实调用形态渲染」。
    //   替身忠实反映签名 —— 只吃 (st, num)，多传的参数会被忽略，正是为了让「参数错位」这类 bug 现形。
    byLang[lang] = factory(
      { getSnapshot: function () { return { active: lang } } },
      function (st, num) { return 'https://example.invalid/' + String(num) },
      (data0 && data0.templates) || {},
      (data0 && data0.fragments) || {},
      (data0 && data0.languages) || FALLBACK_LANGUAGES,
    )
    return byLang[lang]
  }
  return {
    prime: function (src, data) {
      if (src0 !== src || data0 !== data) { src0 = src; data0 = data; Object.keys(byLang).forEach(function (k) { delete byLang[k] }) }
    },
    promptTextForForTest: function (st, id, params, lang) { return instanceOf(lang).promptTextFor(st, id, params) },
    // #595 必修①：completePrompt 的真实调用形态 = (st, num, title, total, closed)，用它渲染来断言调用错位
    completePromptForTest: function (st, num, title, total, closed, lang) { return instanceOf(lang || 'zh').completePrompt(st, num, title, total, closed) },
    /**
     * #1292：语言回退链的真实判定处是 promptLang()。同一个语言快照与清单喂进去，量它落到哪一门。
     * 单独拼一小段来求值（不复用上面按 lang 缓存的实例：那几个实例的 localeSvc 固定，而这里要变量是语言快照）。
     * 第三个参数是「语言快照坏成什么样」，用来钉住几种现实里会遇到的读取失败：
     *   不传  —— 正常：getSnapshot() 返回 { active }
     *   'null'—— 服务在，但这次快照还没回来（返回 null）
     *   'missing' —— 服务根本没装 getSnapshot 方法
     *   'throw'   —— getSnapshot() 自己抛异常
     * 三种坏法都必须按清单的 default 走，而不是掉进写死的兜底。
     */
    promptLangForTest: function (active, languages, snapshotBroken) {
      if (!src0) throw new Error('evalPromptHelpers 未初始化（先调用 prime(src, data)）')
      const body0 = String(src0).replace(/^[ \t]*export[ \t]+/gm, '')
      const f = compileFn(['localeSvc', 'issueUrlFor', 'PROMPT_TEMPLATE_DATA', 'PROMPT_FRAGMENT_DATA', 'LANGUAGES_YAML'], body0 +
        '\n;return { promptLang: promptLang };')
      const localeSvcStub = snapshotBroken === 'missing'
        ? {}
        : snapshotBroken === 'null'
          ? { getSnapshot: function () { return null } }
          : snapshotBroken === 'throw'
            ? { getSnapshot: function () { throw new Error('语言服务未就绪') } }
            : { getSnapshot: function () { return { active: active } } }
      return f(
        localeSvcStub,
        function () { return '' },
        (data0 && data0.templates) || {},
        (data0 && data0.fragments) || {},
        languages,
      ).promptLang()
    },
  }
})()
// 单文件模式（L2 注入的子进程）拿不到语言清单，用这份与 config/languages.yaml 同形的替身兜住；
//   正常流程一定传真的那一份进来（见下面的 readRegistryTables().languages）。
const FALLBACK_LANGUAGES = {
  default: 'zh',
  languages: {
    zh: { label: { zh: '简体中文', en: 'Simplified Chinese' }, fallback: [] },
    en: { label: { zh: 'English', en: 'English' }, fallback: ['zh'] },
  },
}
// #1293：auditRegistryShape 整条退场（源码形状规则，不是质量规则）。
//   为什么可以退：真源已经是 config/prompts/ 下的 YAML，注册表由 registryFromEntries 从解析结果造普通对象，
//   不再有「源码里 defineProperty / setPrototypeOf / __proto__ / 计算属性名 / getter 藏条目」的求值面 ——
//   这些判据在新结构下无从触发，留着只是让读者以为还有一层保护。
//   哪些判据接住了（判定强度对照表逐条写清：docs/design/1293-prompt-gate-strength.md）：
//     · 锚点 / 别名藏内容 —— 保留，改由 yamlHidingShape 在 S1 逐份 YAML 判（promptYamlHidingHits）；
//     · 被吞掉 / 藏起来的条目 —— 由「条目数硬编码 27 + YAML 文本顶层键与解析 id 双向一致」抓；
//     · 原型链键 / Object.prototype 污染 / 不可枚举属性 / getter —— 新数据源里构造不出来，判据退场。
// S2 正则解析（产物是整包，求值不现实）：忠实还原源码字符串字面量（与 tests/verify-prompts.ts 第 4c 节的产物解析同口径；
//   #1293 起 tests/verify-prompt-newlines.ts 已整条并入本文件，本注释从前指向的那份文件不存在了）
const unescapeLiteral = function (s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') { out += c; continue }
    const n = s[i + 1]
    if (n === undefined) { out += c; continue }
    i++
    if (n === 'n') out += '\n'
    else if (n === 't') out += '\t'
    else if (n === 'r') out += '\r'
    else if (n === '\\') out += '\\'
    else if (n === "'") out += "'"
    else if (n === '"') out += '"'
    else if (n === 'u') { const hex = s.slice(i + 1, i + 5); i += 4; out += String.fromCharCode(parseInt(hex, 16)) }
    else out += n
  }
  return out
}
// #1292：产物里的提示词数据长这样（构建把生成物 prompt-data.ts 拼进客户端闭包后的样子）：
//   "mapExecute": Object.freeze({
//     version: 17,
//     placeholders: Object.freeze([]),
//     zh: "……",
//     en: "……"
//   }),
// 这里按这个形状解析出「id → {version, placeholders, zh, en}」。
// 字面量可能是双引号、单引号，也可能是反引号模板串：转译器（esbuild）遇到又长又同时含
// 单双引号的字符串会改用模板串打印，此时内容里的换行是真的换行、不再写成 \n 转义。
// 三种形式都要认，否则该条目会被整条吞掉、S2 条数对不上（#1292 立的条数硬编码就是为了
// 让这种少扫当场变红，而不是静默放过）。
// 为什么不用求值：产物是整包（几十份片段拼起来的闭包），求值它等于把整个客户端跑一遍；
//   逐条正则解析 + 条数断言是这条老路一直用的办法（从前解析的是一行一条的注册表字面量，
//   现在解析的是生成物那份多行写法）—— 口径没放松：解析不到足量条目就判红，不许静默少扫。
//   产物里**没有 use 字段**（use 只活在 YAML 里，不进客户端产物），所以这里解析不出 use 是对的。
const ARTIFACT_ENTRY_RE = /"([a-zA-Z0-9.]+)": Object\.freeze\(\{\s*version: (\d+),\s*placeholders: Object\.freeze\((\[[^\]]*\])\),\s*zh: ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`),\s*en: ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`),?\s*\}\)/g
/** 去掉字符串字面量外面那对引号（产物里引号可能是双引号、单引号或反引号模板串两端，由转译器按内容挑）。 */
const stripLiteralQuotes = function (s) {
  const t = String(s)
  const q = t.charAt(0)
  if (t.length >= 2 && (q === '"' || q === "'" || q === '`') && t.charAt(t.length - 1) === q) return t.slice(1, -1)
  return t
}
const parseArtifactRegistry = function (src) {
  const reg = {}
  const re = new RegExp(ARTIFACT_ENTRY_RE.source, 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    // 占位符数组在产物里长这样：Object.freeze(["url"]) 或 Object.freeze([]) ——
    //   先把方括号去掉再按逗号切（不去掉的话第一个元素会带着 '['、最后一个会带着 ']'，与真源对不上）；
    //   空数组要单独认（按逗号切会切出 '[]' 一段，当成占位符名就与真源对不上）。
    const phText = String(m[3] || '').trim()
    const inside = phText.replace(/^\[/, '').replace(/\]$/, '').trim()
    const ph = inside
      ? inside.split(',').map(function (x) { return x.trim().replace(/["']/g, '') }).filter(Boolean)
      : []
    reg[m[1]] = { version: Number(m[2]), placeholders: ph, zh: unescapeLiteral(stripLiteralQuotes(m[4])), en: unescapeLiteral(stripLiteralQuotes(m[5])) }
  }
  return reg
}

// #1292：跨门禁一致性（解析层 vs 文本层）：YAML 文本里的顶层键与解析出来的 id 必须逐条相等。
//   为什么还要这一条：解析器有可能因为某种写法把一条模板整个吞掉（从前是「拆行 / 换引号」让单行正则少扫一条）。
//   文本扫描与解析各走各的路，两边对不上就说明有一边少扫了 —— 判红，不许静默放过。
const yamlTopLevelIds = function (text) {
  const out = []
  String(text).split('\n').forEach(function (line) {
    const m = /^([A-Za-z0-9.]+):\s*(?:#.*)?$/.exec(line)
    // 'version' 是那份 YAML 自己的格式版本号（顶层元字段），不是模板 id。
    if (m && m[1] !== 'version') out.push(m[1])
  })
  return out
}

// ==================== 4. 词法扫描（S3 / S4 用；不用 [^']* 这类会被引号骗到的正则） ====================
// 取一段对象字面量：从 marker 后的第一个 { 到配对的 }，跳过字符串与注释
const extractObjectLiteral = function (src, marker) {
  const s = String(src)
  const at = s.indexOf(marker)
  if (at < 0) return null
  let i = s.indexOf('{', at)
  if (i < 0) return null
  let depth = 0
  let inS = null
  while (i < s.length) {
    const c = s[i]
    if (inS) {
      if (c === '\\') { i += 2; continue }
      if (c === inS) inS = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') { inS = c; i++; continue }
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i); i = e < 0 ? s.length : e + 2; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return s.slice(at + marker.length, i + 1) }
    i++
  }
  return null
}
// 顶层键位置（2 或 4 空格缩进 + 名字 + : {）；用于把每个字面量归到它所属的键
const topLevelKeyPositions = function (block) {
  const out = []
  const re = /(?:^|\n) {2,4}([A-Za-z0-9_'\-]+):\s*\{/g
  let m
  while ((m = re.exec(block)) !== null) out.push({ name: m[1].replace(/['"]/g, ''), at: m.index })
  return out
}
const countTopLevelKeys = function (block) {
  return topLevelKeyPositions(block).map(function (k) { return k.name })
}
// 取某后端 prompts.<key> 的 zh/en 声明值（#595 起 bodyFormat 也走这里；渲染面断言与注入链断言共用）
const backendPromptValues = function (src, key) {
  const block = extractObjectLiteral(src, 'export const prompts')
  if (!block) return {}
  const sub = extractObjectLiteral(block, key)
  if (!sub) return {}
  const out = {}
  const zh = /(?:^|[\s{,])zh:\s*'((?:[^'\\]|\\.)*)'/.exec(sub)
  const en = /(?:^|[\s{,])en:\s*'((?:[^'\\]|\\.)*)'/.exec(sub)
  if (zh) out.zh = unescapeLiteral(zh[1])
  if (en) out.en = unescapeLiteral(en[1])
  return out
}
// 取某后端 prompts.subIssue 的 zh/en 声明值（S5 渲染面与注入链断言用）
const backendSubIssueValues = function (src) { return backendPromptValues(src, 'subIssue') }
// 扫描块内**全部**字符串字面量（含拼接续段）：注释跳过，字符串转义按 JS 语义还原。
// 注意：不能只认 `zh: '...'` 前缀 —— ensureLabels 的命令写在 `'a' + x + 'b'` 的第二段里，
// 按前缀归类会把续段整段漏掉（这正是「词法扫描静默少扫」）。
const scanAllLiterals = function (block) {
  const s = String(block)
  const keys = topLevelKeyPositions(s)
  const out = []
  let i = 0
  const ownerOf = function (idx) {
    let name = '<块首>'
    keys.forEach(function (k) { if (k.at < idx) name = k.name })
    return name
  }
  while (i < s.length) {
    const c = s[i]
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i); i = e < 0 ? s.length : e + 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      let val = ''
      let j = i + 1
      while (j < s.length) {
        const d = s[j]
        if (d === '\\') { val += d + (s[j + 1] === undefined ? '' : s[j + 1]); j += 2; continue }
        if (d === quote) break
        val += d
        j++
      }
      out.push({ key: ownerOf(i), text: unescapeLiteral(val) })
      i = j + 1
      continue
    }
    i++
  }
  return out
}

// ==================== 4b. #595 新增扫描面：注册表之外的客户端文本来源 + 客户端产物 ====================
// 为什么要有这一面：会进客户端产物的文本不止 PROMPTS 注册表这一处 —— 同一段内核源码里还有
//   NEW_BUG_FIELDS_BODY / NEW_BUG_FIELDS_BODY_EN / NEW_WAYFINDER_DEFAULT_WIRING 这类常量，
//   kernel/config.js 里还有 TPL_DEFAULT 默认模板；它们以前门禁完全不扫（把 GitHub 专用散文塞进任何一处都全绿）。
// 判定口径与 S1 一致：一律交给 judge()。
// 这一行原来写着带左括号的求值字样，改成不带括号的说法（扫描器只看文本形状，注释里出现同样算一条高危）。
// 只扫「字符串字面量」，不扫整份源码 —— 产物是打包后的代码，代码里本来就有 \x 转义、按文本求值这些形状，扫整份会误红；
//   而消费者看得见的文本一定落在字符串字面量里。
// #1292：注册表之外的客户端文本 —— 现在分两处来源：
//   ① 三处片段（newBugFields / newWayfinderWiring / vocabularyDefaults），按注入时机住在 config/prompts/ 的对应族 YAML 里；
//   ② 客户端那两片源码（prompts.ts / prompts-backend.ts）里剩下的字符串字面量。
//   判定口径与 S1 一致：一律交给 judge()。
// 片段的形状有两种：一段双语文字（{zh, en}）与「按 key 分的双语说法」（vocabularyDefaults 的 cli / cliBrand），
//   两种都拆成「一段文本」交给 judge()。
const fragmentTexts = function (fragments) {
  const out = []
  Object.keys(fragments || {}).forEach(function (id) {
    const v = fragments[id] || {}
    if (typeof v.zh === 'string') out.push({ id: id + '.zh', text: v.zh })
    if (typeof v.en === 'string') out.push({ id: id + '.en', text: v.en })
    ;['cli', 'cliBrand'].forEach(function (k) {
      if (v[k] && typeof v[k] === 'object') {
        if (typeof v[k].zh === 'string') out.push({ id: id + '.' + k + '.zh', text: v[k].zh })
        if (typeof v[k].en === 'string') out.push({ id: id + '.' + k + '.en', text: v[k].en })
      }
    })
  })
  return out
}
const collectNonRegistrySource = function (rel, lits) {
  const out = []
  ;(lits || []).forEach(function (l) {
    judge(l.text).forEach(function (h) {
      out.push('FAIL ' + rel + ' 注册表之外的客户端文本 [' + h.rule + '] 命中「' + h.snippet + '」\n     修法：' + RULE_FIX[h.rule] + '；这类文本同样会进客户端产物、同样会注入会话，别把具体跟踪器命令写进去')
    })
  })
  return { problems: out, literals: (lits || []).length }
}
const collectConfigSource = function (rel, src) {
  const out = []
  const tplBlock = extractObjectLiteral(String(src), 'export const TPL_DEFAULT')
  if (!tplBlock) out.push('FAIL ' + rel + ' 找不到 export const TPL_DEFAULT 块（默认模板是客户端文本来源之一，扫描面不许缺）')
  const lits = scanAllLiterals(String(src)).map(function (l) { return l.text }).filter(function (t) { return String(t).trim() !== '' })
  lits.forEach(function (t) {
    judge(t).forEach(function (h) {
      out.push('FAIL ' + rel + ' 字符串字面量 [' + h.rule + '] 命中「' + h.snippet + '」\n     修法：' + RULE_FIX[h.rule] + '；默认模板与配置里的文本同样进客户端产物、同样会注入会话')
    })
  })
  return { problems: out, literals: lits.length }
}
// 客户端产物：整份产物里不许出现 gh / glab 命令形状 —— 判定落在「产物里消费者看得见的那部分文本」上，不再只卡
//   'dsh plugin --profile <配置名> exec' 与 'scripts/fix-issue-body.mjs' 两个字面串（换成别的跟踪器命令、甚至换回裸 gh issue edit 就全绿）。
// 为什么只判注册表文本、不判产物里所有字符串字面量：产物是打包后的代码，代码里本来就有 String.fromCharCode(92)、
// 这一行原来也写着带左括号的求值字样，一并改成不带括号的说法（原因同上：注释文本同样会命中形状扫描）。
//   \x 转义、按文本求值这些形状（R7 就是冲它们去的），逐字面量判会把「代码」当成「文本」误红；而词法扫描在打包产物上会
//   把正则字面量里的引号当成字符串起点，吐出跨越整段代码的假字面量。消费者看得见的提示词文本 = 注册表条目（产物里可完整解析）
//   + 源码侧的 NEW_* 常量与 TPL_DEFAULT（由 S6 / S7 在原文件上判定，构建后原样进产物）。
const collectArtifactShapes = function (rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) return null
  const reg = parseArtifactRegistry(fs.readFileSync(p, 'utf8'))
  const ids = Object.keys(reg)
  const out = []
  ids.forEach(function (id) {
    const e = reg[id] || {}
    // #1292：产物里没有 use 字段（它只活在 YAML 里，不进客户端产物）——use 的文本在 S1 那一面判过。
    ;['zh', 'en'].forEach(function (field) {
      judge(e[field]).forEach(function (h) {
        out.push('FAIL ' + rel + ' 产物注册表 ' + id + '.' + field + ' [' + h.rule + '] 命中「' + h.snippet + '」\n     修法：' + RULE_FIX[h.rule] + '；客户端产物里不许出现 gh / glab 命令形状')
      })
    })
  })
  return { problems: out, literals: ids.length * 2, ids: ids.length }
}
// 数一个函数名的每个调用点各传了几个实参（跳过字符串 / 模板串 / 注释；括号与方括号配对计数）。
// 用途：#595 必修① —— completePrompt 的真实签名是 (st, num, title, total, closed)，视图侧曾经按 4 参调。
const callArgCounts = function (src, name) {
  const s = String(src)
  const out = []
  const re = new RegExp('(?:^|[^A-Za-z0-9_$.])' + name + '\\s*\\(', 'g')
  let m
  while ((m = re.exec(s)) !== null) {
    let i = s.indexOf('(', m.index)
    let depth = 0
    let args = 0
    let hasTok = false
    let inS = null
    for (; i < s.length; i++) {
      const c = s[i]
      if (inS) { if (c === '\\') { i++; continue } if (c === inS) inS = null; continue }
      if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue }
      if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i); i = e < 0 ? s.length : e + 1; continue }
      if (c === "'" || c === '"' || c === '`') { inS = c; if (depth === 1) hasTok = true; continue }
      if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1) continue; hasTok = true; continue }
      if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { out.push(hasTok || args > 0 ? args + 1 : 0); break } hasTok = true; continue }
      if (depth !== 1) continue
      if (c === ',') { args++; hasTok = false; continue }
      if (!/\s/.test(c)) hasTok = true
    }
  }
  return out
}
// #595 必修①：按真实调用形态渲染后，既不许出现 undefined，也不许残留 {xxx} 占位符。
// #603 补一句范围说明：后端声明文本自带 {owner} / {repo} / {child} 这类「由 agent 按当前仓库自行代入」的占位符
//   （github 后端的 ensureLabels 一直是这个约定），渲染入口本来就不负责填它们，这类残留不算漏填。
//   传 scopeNames（该条目在注册表里声明的占位符）时只判这些名字有没有残留；不传则判全部（completePrompt 那几处用）。
const RE_LEFT_PLACEHOLDER = /\{[a-zA-Z][a-zA-Z0-9_.]*\}/g
const leftoverPlaceholder = function (text, scopeNames) {
  const re = new RegExp(RE_LEFT_PLACEHOLDER.source, 'g')
  let m
  while ((m = re.exec(String(text))) !== null) {
    if (!scopeNames || scopeNames.indexOf(m[0].slice(1, -1)) >= 0) return m[0]
  }
  return ''
}

// ==================== 4c. #1293 四条 YAML 化产物断言 ====================
// 票面 #1293 要的是「提示词真源改读 YAML 之后，判定强度一条不降」。这一节落四条断言，
// 并把整条退场的源码排版门禁（tests/verify-prompt-newlines.ts）里仍然适用的判据接过来：
//   ① use 不许出现在客户端产物 —— use 只活在 YAML 里（给读代码的人看「这条模板什么时候用」），
//      不是发给用户的文案，父规格 #1290 明说它不进客户端闭包；
//   ② 提示词正文里不许出现字面 \n（两个字符：反斜杠 + n）—— 正文换行必须写单层转义，
//      写成双层转义时运行时看到的是反斜杠+n，换行失效（#430 的根因）；
//   ③ 每种语言都必须有正文 —— 按 config/languages.yaml 的语言清单逐语言判，不写死 zh/en，
//      将来加第三门语言时这条会自动要求它也有正文（#1278 §七：第三门语言内容不写、机制做足）；
//   ④ 占位符声明与正文实际使用一一对应 —— 多声明、少使用都判红，同样逐语言判
//      （以前结构契约那一段只判 zh，en 的占位符对不上是看不到的）。
// ①② 只在完整模式跑（产物 / 宿主 / 房间这些面与单文件探针无关）；③④ 两种模式都跑，
//   L2 机械注入的探针只要语言清单与占位符不对，一样会被这两条抓住。
//
// 读产物文本的小工具（skipString / blockEnd / readValue / objectMembers / promptDataRegion /
// extractTemplateEntries / fragmentBlock）原先在 tests/verify-prompt-newlines.ts 里也有一份。
// 本票把那份门禁整条并进本文件之后，这里是仍在用的那一份；tests/verify-prompt-config.ts 里还留着一份
// 孪生实现（同一条规则各自守一道），两边判据必须一致，抽到 tests/lib/ 时要一起换。
const YAML_PRODUCT_FILES = ['client.js', 'package/lib/client.js']

/** 跳过一段字符串字面量（含反斜杠转义），返回它结束后的下标。 */
const skipString = function (text, start) {
  const quote = text[start]
  let i = start + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') { i += 2; continue }
    if (c === quote) return i + 1
    i++
  }
  return i
}

/** 从 text[start] 处的 '{' 起做花括号配对，返回配对 '}' 之后的下标；找不到返回 -1。 */
const blockEnd = function (text, start) {
  let depth = 0
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return -1
}

/** 读一个成员的值：字符串字面量按引号读到末尾，其余读到第一层逗号为止。 */
const readValue = function (text, start) {
  const ch = text[start]
  if (ch === '"' || ch === "'" || ch === '`') {
    const end = skipString(text, start)
    return { text: text.slice(start, end), end: end }
  }
  let depth = 0
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth-- }
    else if (c === ',' && depth === 0) break
    i++
  }
  return { text: text.slice(start, i).trim(), end: i }
}

/** 解析一个对象字面量的第一层成员，返回「键 → 原始值文本」。 */
const objectMembers = function (body) {
  const out = new Map()
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(body, i); continue }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < body.length && /[A-Za-z0-9_$]/.test(body[j])) j++
      const key = body.slice(i, j)
      let k = j
      while (k < body.length && /\s/.test(body[k])) k++
      if (body[k] !== ':') { i = j; continue }
      k++
      while (k < body.length && /\s/.test(body[k])) k++
      const value = readValue(body, k)
      out.set(key, value.text)
      i = value.end
      continue
    }
    i++
  }
  return out
}

/**
 * 从构建产物里取出提示词数据区：从第一张模板族表（const TEMPLATES_...）到语言清单那一段结束。
 * 找不到返回 null —— 宁可判红，也不要在认不出底本的情况下判绿（产物没重建过时这里就是 null）。
 */
const promptDataRegion = function (text) {
  const start = /const\s+TEMPLATES_[A-Z_]+\s*=\s*Object\.freeze\(\{/.exec(text)
  if (!start) return null
  const lang = /const\s+LANGUAGES_YAML\s*=/.exec(text)
  if (!lang) return null
  const end = blockEnd(text, lang.index)
  if (end < 0) return null
  return text.slice(start.index, end)
}

/** 产物里的一条提示词条目：id、成员键名、中英两条正文（正文已按字符串语义解码）。 */
const extractTemplateEntries = function (region) {
  const out = []
  const re = /"((?:[^"\\]|\\.)*)":\s*Object\.freeze\(\{/g
  let m
  while ((m = re.exec(region)) !== null) {
    const open = region.indexOf('{', m.index + m[0].length - 1)
    const end = blockEnd(region, open)
    if (end < 0) break
    const members = objectMembers(region.slice(open + 1, end - 1))
    if (members.has('placeholders') && members.has('version')) {
      out.push({
        id: m[1],
        members: Array.from(members.keys()),
        zh: unescapeLiteral((members.get('zh') || '""').slice(1, -1)),
        en: unescapeLiteral((members.get('en') || '""').slice(1, -1)),
      })
    }
    re.lastIndex = end
  }
  return out
}

/** 取产物里片段表（PROMPT_FRAGMENT_DATA）那一段。 */
const fragmentBlock = function (text) {
  const m = /const\s+PROMPT_FRAGMENT_DATA\s*=/.exec(text)
  if (!m) return null
  const end = blockEnd(text, m.index)
  if (end < 0) return null
  return text.slice(m.index, end)
}

/**
 * #1293 断言①：use 不许出现在客户端产物。
 * 两条判据一起看，缺一条都会漏：
 *   (a) 提示词数据区里没有 use 这个键 —— 键名是结构，光看正文原文认不出来；
 *   (b) 整份产物文本里找不到任何一条 use 原文 —— 有人把 use 内容改个名字塞进别的字段，这条能抓住。
 * 为什么 (a) 要限定在「提示词数据区」：客户端闭包里别处也有 use 这个键（界面上的技能卡片就在用），
 *   整文件找 use 会把与提示词无关的键也算进来，判据就变味了。
 */
const checkUseNotInProduct = function () {
  const useTexts = []
  Object.keys(reg).forEach(function (id) {
    const u = String((reg[id] || {}).use == null ? '' : reg[id].use)
    if (u.trim()) useTexts.push({ id: id, text: u })
  })
  check(useTexts.length === EXPECT_REGISTRY_ENTRIES, '#1293 读到 ' + useTexts.length + ' 条 use 原文（期望 ' + EXPECT_REGISTRY_ENTRIES + '，每条模板一条；少一条就说明有模板的 use 没读到，漏判面会变窄）')
  const genRel = 'src/client/kernel/prompt-data.ts'
  const genPath = path.join(ROOT, genRel)
  if (!fs.existsSync(genPath)) {
    fail('#1293 ' + genRel + ' 不在盘上（生成物缺失；修法：跑 node scripts/generate-prompt-config.mts 或 node scripts/build.mts）')
  } else {
    const genText = fs.readFileSync(genPath, 'utf8')
    const entries = extractTemplateEntries(genText)
    check(entries.length === EXPECT_REGISTRY_ENTRIES, '#1293 ' + genRel + ' 取到 ' + entries.length + ' 条模板（期望 ' + EXPECT_REGISTRY_ENTRIES + '）—— 解析面不许静默少扫')
    const withUse = entries.filter(function (e) { return e.members.indexOf('use') >= 0 })
    check(withUse.length === 0, '#1293 ' + genRel + ' 的模板条目里没有 use 字段' +
      (withUse.length ? '（出现了 use 的条目：' + withUse.map(function (e) { return e.id }).join('、') + '）' : '（' + entries.length + ' 条模板逐条看过）'))
    const leaked = useTexts.filter(function (u) { return genText.indexOf(u.text) >= 0 })
    check(leaked.length === 0, '#1293 ' + genRel + ' 里不含 YAML 里 use 的原文' +
      (leaked.length ? '（漏出去的有：' + leaked.map(function (u) { return u.id }).join('、') + '）' : '（' + useTexts.length + ' 条 use 原文逐条查过）'))
  }
  YAML_PRODUCT_FILES.forEach(function (rel) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { fail('#1293 ' + rel + ' 不存在（改 src 后必须重建产物）'); return }
    const text = fs.readFileSync(p, 'utf8')
    const region = promptDataRegion(text)
    if (!region) {
      fail('#1293 ' + rel + ' 里找不到提示词数据区（应当是 const TEMPLATES_... 到 const LANGUAGES_YAML 那一段）—— 产物是旧的或排版变了，先重建再跑本门禁')
      return
    }
    const entries = extractTemplateEntries(region)
    check(entries.length === EXPECT_REGISTRY_ENTRIES, '#1293 ' + rel + ' 提示词数据区取到 ' + entries.length + ' 条模板（期望 ' + EXPECT_REGISTRY_ENTRIES + '）—— 解析面不许静默少扫')
    const withUse = entries.filter(function (e) { return e.members.indexOf('use') >= 0 })
    check(withUse.length === 0, '#1293 ' + rel + ' 的提示词数据区里没有 use 字段' +
      (withUse.length ? '（出现了 use 的条目：' + withUse.map(function (e) { return e.id }).join('、') + '）' : '（' + entries.length + ' 条模板逐条看过）'))
    const leaked = useTexts.filter(function (u) { return text.indexOf(u.text) >= 0 })
    check(leaked.length === 0, '#1293 ' + rel + ' 里不含 YAML 里 use 的原文' +
      (leaked.length ? '（漏出去的有：' + leaked.map(function (u) { return u.id }).join('、') + '）' : '（' + useTexts.length + ' 条 use 原文逐条查过）'))
  })
}

/**
 * #1293 断言②：提示词正文里不许出现字面 \n（反斜杠 + n 两个字符）。
 * 判据从 tests/verify-prompt-newlines.ts（本票删除）原样接过来，扫描面一处不少：
 *   config/prompts/ 的真源正文 / 两份客户端产物 / src/host 的 *_PROMPT / src/tracker/rooms 的 zh/en 字面量。
 * 白名单仍钉死为空（ALLOWED_LITERAL_BSN），谁想加回一条「这条不算」的口子都要连指纹断言一起改，绕不过去。
 */
const ALLOWED_LITERAL_BSN = []
const EXPECT_ALLOWED_COUNT = 0
// 空清单的指纹 = sha256('') 前 16 位十六进制
const EXPECT_ALLOWED_FINGERPRINT = 'e3b0c44298fc1c14'
const checkNoLiteralBackslashN = function () {
  let yamlTexts = 0
  let scanned = 0
  const countLiteral = function (s) { return (String(s).match(/\\n/g) || []).length }
  const checkText = function (where, name, v) {
    scanned++
    const n = countLiteral(v)
    if (n > 0) fail('#1293 ' + where + ' ' + name + ' 含字面 \\n ' + n + ' 处（换行必须写单层转义，运行时才是真换行；写成双层转义时运行时看到的是反斜杠+n）')
  }
  // ① 真源：YAML 读出来的每种语言正文 + 三处片段正文
  const langIds = Object.keys((languagesData || FALLBACK_LANGUAGES).languages || {})
  Object.keys(reg).forEach(function (id) {
    langIds.forEach(function (lang) {
      yamlTexts++
      checkText(s1Label, id + '.' + lang, (reg[id] || {})[lang])
    })
  })
  if (Object.keys(fragments || {}).length) {
    fragmentTexts(fragments).forEach(function (f) {
      yamlTexts++
      checkText(s1Label, f.id, f.text)
    })
  }
  check(yamlTexts >= EXPECT_REGISTRY_ENTRIES * langIds.length + 8, '#1293 真源只判到 ' + yamlTexts + ' 段正文（期望 ≥ ' + (EXPECT_REGISTRY_ENTRIES * langIds.length + 8) + '：模板条数 × 每门语言 + 三处片段 8 段；少了就是扫描面静默变窄）')
  // ② 两份客户端产物：模板正文 + 片段正文
  YAML_PRODUCT_FILES.forEach(function (rel) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { fail('#1293 ' + rel + ' 不存在（改 src 后必须重建产物）'); return }
    const text = fs.readFileSync(p, 'utf8')
    const region = promptDataRegion(text)
    if (!region) {
      fail('#1293 ' + rel + ' 里找不到提示词数据区（应当是 const TEMPLATES_... 到 const LANGUAGES_YAML 那一段）—— 产物是旧的或排版变了，先重建再跑本门禁')
      return
    }
    const entries = extractTemplateEntries(region)
    if (entries.length !== EXPECT_REGISTRY_ENTRIES) {
      fail('#1293 ' + rel + ' 提示词数据区取到 ' + entries.length + ' 条模板（期望 ' + EXPECT_REGISTRY_ENTRIES + '）—— 产物比真源旧，先重建再跑本门禁')
      return
    }
    entries.forEach(function (e) {
      checkText(rel, e.id + '.zh', e.zh)
      checkText(rel, e.id + '.en', e.en)
    })
    const frag = fragmentBlock(text)
    if (!frag) { fail('#1293 ' + rel + ' 里找不到片段表（const PROMPT_FRAGMENT_DATA）—— 产物是旧的或排版变了，先重建再跑本门禁'); return }
    const fragRe = /"(zh|en)":\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g
    let fm
    let fragCount = 0
    while ((fm = fragRe.exec(frag)) !== null) {
      fragCount++
      checkText(rel, '片段.' + fm[1] + '#' + fragCount, unescapeLiteral(fm[2].slice(1, -1)))
    }
    if (fragCount === 0) fail('#1293 ' + rel + ' 的片段表里一条 zh/en 都没取到 —— 一条都取不到不许当通过')
  })
  // ③ 宿主提示词常量（src/host 与 src/refresh/rooms/host，与 S4 同一套取源，避免两处各写一份正则）
  collectHost(EXEMPT).consts.forEach(function (c) { checkText(c.file, c.name, c.text) })
  // ④ src/tracker/rooms/** 里含换行的 zh/en 字面量（与退休门禁同口径：只判本来就要换行的那几条）
  let roomTexts = 0
  walkJs(path.join(ROOT, 'src/tracker/rooms'), []).forEach(function (file) {
    if (!file.endsWith('index.js') && !file.endsWith('index.ts')) return
    const src = fs.readFileSync(file, 'utf8')
    const re = /(?:zh|en): '((?:[^'\\]|\\.)*)'/g
    let m
    while ((m = re.exec(src)) !== null) {
      const v = unescapeLiteral(m[1])
      if (v.indexOf('\n') >= 0 || v.indexOf('\\n') >= 0) {
        roomTexts++
        checkText(path.relative(ROOT, file), m[1].slice(0, 24), v)
      }
    }
  })
  check(roomTexts >= 1, '#1293 src/tracker/rooms/** 一条含换行的 zh/en 字面量都没扫到（扫描面静默变窄了；这条面与退休门禁同口径，至少该有一条）')
  check(scanned >= EXPECT_REGISTRY_ENTRIES * 2 + 8, '#1293 只扫到 ' + scanned + ' 段提示词文本（期望 ≥ ' + (EXPECT_REGISTRY_ENTRIES * 2 + 8) + '：模板条数 × zh/en + 三处片段 + 两份产物 + host + rooms；少了就是扫描面静默变窄）')
  // 白名单必须保持为空 —— 从退休门禁原样接过来的第二道锁（条数与内容指纹都钉死）
  const fingerprint = require('crypto').createHash('sha256').update(ALLOWED_LITERAL_BSN.join('\u0000'), 'utf8').digest('hex').slice(0, 16)
  check(ALLOWED_LITERAL_BSN.length === EXPECT_ALLOWED_COUNT && fingerprint === EXPECT_ALLOWED_FINGERPRINT,
    '#1293 字面 \\n 豁免清单被改过（实际 ' + ALLOWED_LITERAL_BSN.length + ' 条 / 指纹 ' + fingerprint +
    '，期望 ' + EXPECT_ALLOWED_COUNT + ' 条 / 指纹 ' + EXPECT_ALLOWED_FINGERPRINT + '）—— 要改清单就连判据一起改，不许绕过去')
}

/** #1293 断言③：按语言清单逐语言判正文齐全（模板 + 三处片段），不再写死 zh/en。 */
const checkEveryLanguageHasBody = function () {
  const langIds = Object.keys((languagesData || FALLBACK_LANGUAGES).languages || {})
  const problems = []
  check(langIds.length >= 1, '#1293 语言清单里一门语言都没有（每种语言都必须有正文这条判据无从判起）')
  if (!langIds.length) return
  Object.keys(reg).forEach(function (id) {
    langIds.forEach(function (lang) {
      const body = (reg[id] || {})[lang]
      if (typeof body !== 'string' || !body.trim()) problems.push(id + '.' + lang + ' 没有正文')
    })
  })
  if (Object.keys(fragments || {}).length) {
    promptConfig.PROMPT_FRAGMENT_IDS.forEach(function (spec) {
      const v = fragments[spec.id]
      if (!v) { problems.push('片段 ' + spec.id + ' 取不到（片段少一处，这一族的正文没人判）'); return }
      if (spec.shape === 'bilingual-text') {
        langIds.forEach(function (lang) {
          if (!v || typeof v[lang] !== 'string' || !v[lang].trim()) problems.push('片段 ' + spec.id + '.' + lang + ' 没有正文')
        })
      } else {
        ;['cli', 'cliBrand'].forEach(function (k) {
          const sub = v ? v[k] : null
          if (!sub || typeof sub !== 'object') { problems.push('片段 ' + spec.id + '.' + k + ' 取不到（按占位符名字分层的说法缺一层）'); return }
          langIds.forEach(function (lang) {
            if (typeof sub[lang] !== 'string' || !sub[lang].trim()) problems.push('片段 ' + spec.id + '.' + k + '.' + lang + ' 没有正文')
          })
        })
      }
    })
  }
  check(problems.length === 0, '#1293 每种语言都有正文（语言清单 ' + langIds.join('/') + ' × ' + Object.keys(reg).length + ' 条模板' +
    (Object.keys(fragments || {}).length ? ' + 三处片段' : '') + '）' + (problems.length ? '：\n      ' + problems.join('\n      ') : ''))
}

/** #1293 断言④：占位符声明与正文逐语言一一对应（多声明、少使用都红）。 */
const checkPlaceholderParityPerLanguage = function () {
  const langIds = Object.keys((languagesData || FALLBACK_LANGUAGES).languages || {})
  const problems = []
  Object.keys(reg).forEach(function (id) {
    const e = reg[id] || {}
    const declared = (Array.isArray(e.placeholders) ? e.placeholders : []).map(String)
    langIds.forEach(function (lang) {
      const body = String(e[lang] == null ? '' : e[lang])
      const used = placeholderNames(body)
      used.forEach(function (n) {
        if (declared.indexOf(n) < 0) problems.push(id + ' 的 ' + lang + ' 正文用了 {' + n + '}，但 placeholders 没声明它 —— 运行时它会原样进会话')
      })
      declared.forEach(function (n) {
        if (used.indexOf(n) < 0) problems.push(id + ' 的 placeholders 声明了 {' + n + '}，但 ' + lang + ' 正文里没有用它 —— 声明与正文对不上')
      })
    })
  })
  check(problems.length === 0, '#1293 占位符声明与正文一一对应（语言清单 ' + langIds.join('/') + ' × ' + Object.keys(reg).length + ' 条模板，多声明与少使用都判红）' +
    (problems.length ? '：\n      ' + problems.join('\n      ') : ''))
}

/** 跑四条断言：③④ 两种模式都跑（探针也受判），①② 只在完整模式跑。 */
const runYamlProductAssertions = function () {
  const before = problems.length
  checkEveryLanguageHasBody()
  checkPlaceholderParityPerLanguage()
  if (!singleFileMode) {
    checkUseNotInProduct()
    checkNoLiteralBackslashN()
  }
  if (problems.length === before) {
    console.log('  PASS #1293 四条 YAML 化产物断言（use 不进客户端产物 / 正文不许有字面 \\n / 每种语言都有正文 / 占位符逐语言一一对应）')
  }
}

// ==================== 5. 五面扫描（返回问题数组，主跑与变异自检共用） ====================
const surfaceReport = { S1: 0, S2: [0, 0], S3: [], S4: 0, S5: 0, S6: 0, S7: 0, S8: [0, 0], exempt: EXEMPT.length }
const BACKENDS = ['github', 'gitlab', 'markdown']
const backendPath = function (id, probe) {
  if (id === 'github' && probe) return probe
  return path.join(ROOT, 'src/tracker/rooms', id, 'index.ts')
}
const backendLabel = function (id, probe) {
  return (id === 'github' && probe) ? probe : 'src/tracker/rooms/' + id + '/index.ts'
}
const failLine = function (where, rule, snippet, raw) {
  return 'FAIL ' + where + ' [' + rule + '] 命中「' + snippet + '」' +
    (raw ? '\n     原文本（运行时）：' + String(raw).slice(0, 120) : '') +
    '\n     修法：' + RULE_FIX[rule] + '；如需放行，只能进 tests/prompt-gate-exempt.json 并写明理由'
}

// —— S1 + S5 ——
// #603：模板占位符的值来自各后端的声明。github 后端声明面允许 gh 命令，所以来自 github 的值（键名 github.*）
//   按「允许跟踪器命令」判；gitlab / markdown 的值与桶底默认值照旧按最严口径判（R1–R8 全判）。
const allowTrackerForKey = function (k) { return String(k).indexOf('github.') === 0 }
const collectRegistry = function (reg, label, ctx, exemptList) {
  const out = []
  const ids = Object.keys(reg)
  const idsScanned = []
  let rendered = 0
  ids.forEach(function (id) {
    if (isRuleExempt(exemptList, 'registry', id)) return
    idsScanned.push(id)
    const e = reg[id] || {}
    ;['zh', 'en', 'use'].forEach(function (field) {
      judge(e[field]).forEach(function (h) { out.push(failLine(label + ' ' + id + '.' + field, h.rule, h.snippet, e[field])) })
    })
    ;(Array.isArray(e.placeholders) ? e.placeholders : []).forEach(function (ph) {
      judge(ph).forEach(function (h) { out.push(failLine(label + ' ' + id + '.placeholders[' + ph + ']', h.rule, h.snippet, ph)) })
    })
    const names = placeholderNames(String(e.zh || '') + String(e.en || ''))
    if (names.length) {
      rendered++
      // ① 占位符名字本身
      names.forEach(function (n) {
        judge(n).forEach(function (h) { out.push(failLine(label + ' ' + id + '.placeholders 名字 ' + n, h.rule, h.snippet, n)) })
      })
      // ② 每个声明值单独判 + 值不许含换行（含换行就能把一条命令拆成两行注入）
      Object.keys(ctx.subIssueValues).forEach(function (k) {
        const v = String(ctx.subIssueValues[k])
        judge(v, { allowTracker: allowTrackerForKey(k) }).forEach(function (h) { out.push(failLine(label + ' ' + id + ' 的占位符值(' + k + ')', h.rule, h.snippet, v)) })
        if (/[\r\n]/.test(v)) out.push('FAIL ' + label + ' ' + id + ' 的占位符值(' + k + ')含换行：值不许把模板拆行\n     修法：声明值必须是单行')
      })
      judge('owner/name').forEach(function (h) { out.push(failLine(label + ' ' + id + ' 的占位符值(repo)', h.rule, h.snippet, 'owner/name')) })
      // ③ 拆占位符拼装探测：把命令词塞进单个占位符，若渲染后拼出一条真的命令调用即红
      names.forEach(function (n) {
        PLACEHOLDER_PROBES.forEach(function (probe) {
          const one = {}
          one[n] = probe
          ;['zh', 'en'].forEach(function (lang) {
            const rendered = renderWith(e[lang], one, '')
            const m = RE_ASSEMBLED.exec(rendered)
            if (m) {
              out.push('FAIL ' + label + ' ' + id + '.' + lang + ' 占位符 {' + n + '} 代入「' + probe + '」后 [ASSEMBLE] 拼出命令「' +
                rendered.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ') + '」\n' +
                '     修法：模板不许把命令词交给占位符，也不许让占位符紧邻子命令词；改成两步调安装目录下的脚本（第 ① 步 dsh plugin --profile <配置名> exec …拿安装目录，第 ② 步 node "<安装目录>/scripts/<脚本>.mjs" …）')
            }
          })
        })
      })
      // ④ 三种展开：真实值 / 空串 / 哨兵
      Object.keys(ctx.subIssueValues).forEach(function (k) {
        const vals = { repo: 'owner/name', subIssue: ctx.subIssueValues[k] }
        ;['zh', 'en'].forEach(function (lang) {
          judgeRendered(e[lang], vals, { allowTracker: allowTrackerForKey(k) }).forEach(function (h) {
            out.push(failLine(label + ' ' + id + '.' + lang + '(渲染 ' + k + ')', h.rule, h.snippet, ''))
          })
        })
      })
    }
  })
  return { problems: out, scanned: idsScanned.length, idsScanned: idsScanned, rendered: rendered }
}

// —— S3 ——
// #603：github 后端声明面允许 gh 命令（领导拍板 gh 直连），所以只有这一个面传 allowTracker；
//   gitlab / markdown 后端声明面判据与原来一样（不许 gh 命令），R8 三个面都判。
const allowTrackerOnBackend = function (backendId) { return backendId === 'github' }
const collectBackend = function (backendId, src, label, exemptList) {
  const block = extractObjectLiteral(src, 'export const prompts')
  if (!block) return { problems: ['FAIL S3 ' + label + ' 找不到 export const prompts 块（扫描面缺失）'], keys: [], literals: 0, found: false }
  const literals = scanAllLiterals(block)
  const keys = countTopLevelKeys(block)
  const allowTracker = allowTrackerOnBackend(backendId)
  const out = []
  literals.forEach(function (lit) {
    if (!lit.key || isRuleExempt(exemptList, 'backend:' + backendId, lit.key)) return
    judge(lit.text, { allowTracker: allowTracker }).forEach(function (h) { out.push(failLine('S3 ' + label + ' ' + lit.key, h.rule, h.snippet, lit.text)) })
  })
  // 同一键里的字符串拼接合起来再判一次：'dsh plu' + 'gin' / '…scripts/fix-issue' + '-body.mjs' 这种拆字写法，
  //   单看每一段都看不出来（R8 是防回潮条款，回潮的人多半会顺手拆字）。S4 早就是这么判的，这里对齐口径。
  const byKey = {}
  literals.forEach(function (lit) {
    if (!lit.key) return
    if (isRuleExempt(exemptList, 'backend:' + backendId, lit.key)) return
    if (!byKey[lit.key]) byKey[lit.key] = []
    byKey[lit.key].push(lit.text)
  })
  Object.keys(byKey).forEach(function (k) {
    if (byKey[k].length < 2) return
    const joined = byKey[k].join('')
    judge(joined, { allowTracker: allowTracker }).forEach(function (h) {
      out.push('FAIL S3 ' + label + ' ' + k + ' [拼接后 ' + h.rule + '] 命中「' + h.snippet + '」\n' +
        '     修法：' + RULE_FIX[h.rule] + '；同一键内的字符串拼接不许把命令或间接写法拆开藏起来')
    })
  })
  return { problems: out, keys: keys, literals: literals.length, found: true }
}

// —— S4 ——
// 2026-10-18 #1247：宿主真源转成 TypeScript，.ts 也要扫；旁边有同名 .ts 的 .js 是构建产物，跳过不数两遍
//   （与文件粒度门禁同一条孪生规则）。
const walkJs = function (dir, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walkJs(p, acc)
    else if (d.name.endsWith('.ts')) acc.push(p)
    else if (d.name.endsWith('.js') && !fs.existsSync(p.slice(0, -3) + '.ts')) acc.push(p)
  })
  return acc
}
// 与引号无关的 S4 扫描：先按标识符找出所有 *_PROMPT 名字（const/let/var 声明、对象属性、赋值三种都认），
// 再在「声明点之后的一小段」里取出全部字符串字面量（单引号 / 双引号 / 反引号 / 拼接都收），逐个判定。
// 断言口径：扫描面（src/host 与 src/refresh/rooms/host）里出现的每个 *_PROMPT 标识符都必须有声明点，声明点数必须等于硬编码常量数，
// 每条声明至少要有一个字符串字面量（一个都没有说明文本藏在变量或计算里，扫不到，判红）。
const HOST_PROMPT_ID_RE = /[A-Za-z0-9_$]*PROMPT[A-Za-z0-9_$]*/g
const HOST_PROMPT_DECL_RE = /(?:^|[^A-Za-z0-9_$])([A-Za-z0-9_$]*PROMPT[A-Za-z0-9_$]*)\s*(?:=|:)\s*/g
const isPromptName = function (n) { return n && n !== 'PROMPTS' && /PROMPT/.test(n) }
/**
 * 把注释内容换成**等长空格**（#845）：偏移一个字节都不动，行号与 m.index 都还能用。
 * 为什么 S4 必须先过这一道：S4 是按标识符找 *_PROMPT 声明点的，注释里写一句
 *   「GIT_TERMINAL_PROMPT=0」说明就会被当成一个声明点、后面没有字面量 → 误报（#839 那个文件头就踩了，
 *   一次报两条，还把「豁免完备性」那一条也带红）。
 * 按引号状态判注释：单引号 / 双引号 / 反引号里的 // 与 /* 都不是注释（模板串整体当字符串处理，
 *   保守但不会把真代码里的注释漏掉；插值 ${...} 里的注释今天一处都没有）。
 */
function stripCommentsKeepOffsets(src) {
  const out = src.split('')
  let i = 0
  let quote = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1 }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i += 1 }
      if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i += 2 }
      continue
    }
    i += 1
  }
  return out.join('')
}

const collectHost = function (exemptList) {
  const out = []
  const consts = []
  const decls = []
  const names = {}
  // #1427 起宿主提示词常量跟着取数链搬进 src/refresh/rooms/host/：两棵一起扫，旧根不动。
  walkJs(path.join(ROOT, 'src/host'), []).concat(walkJs(path.join(ROOT, 'src/refresh/rooms/host'), [])).forEach(function (file) {
    const rel = path.relative(ROOT, file)
    // #845：先剥注释再扫（等长空格、偏移不变）—— 注释里提到的 *_PROMPT 名字不算声明点。
    const src = stripCommentsKeepOffsets(fs.readFileSync(file, 'utf8'))
    let m
    HOST_PROMPT_ID_RE.lastIndex = 0
    while ((m = HOST_PROMPT_ID_RE.exec(src)) !== null) {
      if (isPromptName(m[0])) names[m[0]] = (names[m[0]] || 0) + 1
    }
    HOST_PROMPT_DECL_RE.lastIndex = 0
    while ((m = HOST_PROMPT_DECL_RE.exec(src)) !== null) {
      const name = m[1]
      if (!isPromptName(name)) continue
      const raw = src.slice(m.index + m[0].length, m.index + m[0].length + 4000)
      // 截到本语句结束：第一个「下一行行首是 const/let/var/export/function/class/} 或注释」的位置
      const cut = raw.search(/\n(?=(?:const|let|var|export|function|class|\}|\/[*\/]))/)
      const span = cut < 0 ? raw : raw.slice(0, cut)
      const lits = scanAllLiterals(span)
      decls.push({ file: rel, name: name, literals: lits.length })
      // #845：判据收在「声明值本身」上 —— 声明点后面第一个非空白字符必须是引号（单/双/反引号），
      //   也就是值就是一个字符串字面量。原判据只看「这一段里有没有字面量」，在一个写满别的字符串的
      //   文件里等于恒真：把 GIT_TERMINAL_PROMPT 的值换成变量（GIT_TERMINAL_PROMPT: v），
      //   同一段里剩下的 45 个字面量照样能让它判绿 —— 那正是这条断言想抓的「文本藏在变量里」。
      const head = span.replace(/^\s+/, '')
      const valueIsLiteral = /^['"`]/.test(head)
      if (!valueIsLiteral || lits.length === 0) {
        out.push('FAIL S4 ' + rel + ' ' + name + ' 的声明值不是字符串字面量（文本可能藏在变量或计算里，扫描不到）\n     修法：把 *_PROMPT 的文本写成字面量')
      }
      lits.forEach(function (lit) {
        consts.push({ file: rel, name: name, text: lit.text })
        if (isRuleExempt(exemptList, 'S4', name)) return
        judge(lit.text).forEach(function (h) { out.push(failLine('S4 ' + rel + ' ' + name, h.rule, h.snippet, lit.text)) })
      })
      // 按出现顺序把字面量拼起来再判一次：命令被拆成 'gh' + ' issue edit 573' 两段时，逐条判看不见
      const joined = lits.map(function (l) { return l.text }).join('')
      if (!isRuleExempt(exemptList, 'S4', name) && lits.length > 1) {
        judge(joined).forEach(function (h) {
          out.push('FAIL S4 ' + rel + ' ' + name + ' [拼接后 ' + h.rule + '] 命中「' + h.snippet + '」\n' +
            '     修法：命令被拆成多个字符串字面量了；' + RULE_FIX[h.rule] + '；如需放行，只能进 tests/prompt-gate-exempt.json 并写明理由')
        })
      }
      // 模板串插值：`写回用 ${X} issue edit 1` 这种把命令词交给变量的写法，用探针代入后再判
      if (!isRuleExempt(exemptList, 'S4', name) && /\$\{/.test(joined)) {
        ;['gh', 'glab'].forEach(function (probe) {
          const rendered = joined.replace(/\$\{[^}]*\}/g, probe)
          judge(rendered).forEach(function (h) {
            out.push('FAIL S4 ' + rel + ' ' + name + ' [插值代入「' + probe + '」后 ' + h.rule + '] 命中「' + h.snippet + '」\n' +
              '     修法：模板串插值不许把命令词交给变量；' + RULE_FIX[h.rule] + '；如需放行，只能进 tests/prompt-gate-exempt.json 并写明理由')
          })
        })
      }
    }
  })
  return { problems: out, consts: consts, names: Object.keys(names), decls: decls }
}

// ==================== 6. 结构契约断言（沿用既有，陈旧两组已修正） ====================
// 形状被改坏时（例如某条目不是普通对象）不许抛栈，一律转成 FAIL 行
const contractChecks = function (reg, src) {
  const before = problems.length
  try {
    contractChecksInner(reg, src)
  } catch (e) {
    fail('契约断言执行时抛错（注册表条目形状被改坏）：' + String((e && e.message) || e) +
      '\n     修法：每条条目必须是普通对象，字段类型要对（placeholders 是数组、zh/en/use 是字符串）')
  }
  return problems.length - before
}
const contractChecksInner = function (reg, src) {
  const P = function (cond, msg) { if (!cond) fail(msg) }

  Object.keys(reg).forEach(function (id) {
    const p = reg[id]
    if (!p || typeof p !== 'object' || Array.isArray(p)) return
    P(p.version >= 1, id + ' 缺 version')
    P(!!p.use, id + ' 缺 use')
    // #1293：「每种语言都必须有正文」与「占位符声明与正文一一对应」搬到本文件第 4c 节，
    //   改成按 config/languages.yaml 的语言清单逐语言判 —— 以前这里只判 p.zh，en 的占位符对不上是看不到的。
    //   那一节在单文件模式（L2 探针）与完整模式下都跑，判据是加强而不是挪走。
  })
  const useRe = /promptText\('([a-zA-Z0-9.]+)'/g
  let mu
  while ((mu = useRe.exec(src)) !== null) { if (!reg[mu[1]]) fail('引用不存在的 prompt id: ' + mu[1]) }
  ;["tr('prompt.", "'prompt.'"].forEach(function (bad) { if (src.includes(bad)) fail('旧字典引用残留 ' + bad) })

  // 版本号 bump（#573 §2.7 逐条清单；只许升不许降）
  // #1269：12 条会话收尾类提示词各加一条 /retro 提醒，版本底线跟着抬高（名单与断言见下面 fixate 之后的 #1269 块）
  // #1407：20 个注入模板各加一行 suggest_next_steps 提醒、删掉 /retro 提醒行，版本底线整体抬高；
  //   原来没有旧底线的 newSpec / healthCheck / specComplete / specExecute / specSplit 五条也一并登记进来。
  // #1461：newBugWayfinder v14 → v15（删查历史、加查重与查重记录两节），版本底线跟着抬到 15。
  const V_MIN = {
    // #1281：map 子票统一入口（讨论/研究/原型/执行）与完成、修复、接手三条模板重写，版本底线同步抬高；
    //   写规格入口与规格三态、实施票是新增条目，不设旧底线。
    // #1274 收口后：完成提示词补「先判断」节与当前状态分支（已交过棒的步骤跳过、核对不通过、两种都有），complete 的版本底线 12 → 13。
    // #1212 恢复：诊断 v14→v16、接手 v6→v7，补回 #1281 删掉的调查节、诊断边界与收尾两条，版本底线同步抬高。
    // #1577（2026-10-27）：接手 v10→v11、补充 v8→v9 —— 首行 /wayfinder 改 /triage，补读现状与状态分支，版本底线同步抬高。
    // #1258（2026-10-28）：原型 v14→v15，收尾前加「定版与移交」节（哪一版、什么算数、照做标准与复核人），
    //   版本底线跟着抬到 15；这一节的中英判据在四条公共骨架的 forEach 之后单独一组。
    // 2026-10-28：调查节汇总成公共小节 investigation（10 个模板只写标记），提问句改成只要求说明已查阅范围；
    //   七个动作模板与三个建票模板的版本号各 +1，版本底线同步抬高。
    // 2026-10-29：mapInspect v12→v13 —— 「修复」第一步英文原来要求把 map 正文落到绝对路径文件，
    //   中文只要求读回正文，同一按钮下两种语言的动作集不同；英文改成与中文同义（读回正文、
    //   `## Destination` 一节必须保留、再按后端声明建边），版本底线同步抬到 13。
    // 2026-10-29：map 子票的讨论 / 执行 / 研究三条动作模板的同一段正文收成公共小节 mapTicketAdvance，
    //   setupRun 与 switchAlign 共用的初始化正文收成公共小节 repoBootstrap；对应五条模板升版，版本底线同步抬高。
    // 2026-10-29（同日第二笔）：tpl.prototype v16→v17 —— mapTicketAdvance 拆成开头与收尾两节
    //   （mapTicketAdvanceOpening / mapTicketAdvanceWrapUp），原型模板引用这两节、中间保留自己的「定版与移交」一节，
    //   版本底线同步抬高；specExecute v5→v6 —— 中文收尾小节标题从「## 收口」改成「## 收尾」，与其余模板统一。
    // 2026-10-29：元提示句「从第一性原理出发。」进 19 条模板（公共小节 firstPrinciples；15 条直接引用 +
    //   mapTicketAdvanceOpening 覆盖讨论 / 执行 / 研究 / 原型 4 条），版本底线整体 +1；
    //   handoff2 不在本表（下面单列 ≥v3 的那组），正文也变了、同步升到 v6。
    mapExecute: 22, complete: 17, fixate: 11, 'tpl.diagnose': 21, 'tpl.fix': 18, 'tpl.discuss': 23,
    'tpl.research': 17, 'tpl.prototype': 18, 'tpl.takeover': 13, 'tpl.supplement': 10, 'tpl.execute': 23, mapInspect: 14, newWayfinder: 26,
    newBugWayfinder: 17, newSpec: 6, healthCheck: 6, specComplete: 8, specExecute: 7, specSplit: 6,
    // #619：setupRun v11 删掉了 paletteNote（旧调色盘注入通道），版本号跟着抬到 11
    // #655：setupRun v12 新增 {contextLayout}（用户选的域文档布局），版本号跟着抬到 12
    // #664：setupRun v13 删掉初始化全文末尾那段「仓库还没就绪就先停下」的告诫（界面已保证过），版本号跟着抬到 13
    // #725：正文格式契约（bodyFormat）与进度契约（progress）两条整节删除 —— 票的正文读写交给 deck_* 工具，
    //   进度的格式与 95% 语义阶梯不再由提示词规定。两条的版本号表项同时撤掉。
    setupRun: 16,
  }
  Object.keys(V_MIN).forEach(function (id) {
    const p = reg[id]
    if (!p) fail('契约缺条目 ' + id)
    else if (p.version < V_MIN[id]) fail('版本号未 bump ' + id + ' v' + p.version + '（期望 ≥ v' + V_MIN[id] + '）')
  })
  ;['guide', 'grill', 'newMap', 'mapHead', 'stageGate'].forEach(function (id) {
    if (reg[id]) fail('#77 已删条目复活 ' + id)
  })
  if (/STAGE_GATED_IDS\s*=/.test(src)) fail('#77 残留 STAGE_GATED_IDS 声明（应随 stageGate 入口一并删除）')
  if (src.includes("promptText('stageGate')")) fail("#77 残留 promptText('stageGate') 调用")
  if (src.includes('STAGE_GATED_IDS.indexOf(id) >= 0')) fail('#77 残留 renderTemplate 闸门追加逻辑')
  if (src.includes("text.indexOf('阶段闸门')") || src.includes("text.indexOf('Stage gate')")) fail('#77 残留 renderTemplate 去重守卫（闸门已内联，无外挂可去重）')

  // mapExecute（#1281：只写推进指令与收尾，推进规则交给 wayfinder 技能，不再复述）
  const me = reg['mapExecute']
  if (me) {
    if (me.zh.indexOf('- [ ]') < 0) fail('mapExecute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (me.zh.indexOf('## 工具') < 0) fail('mapExecute zh 缺工具节（#779）')
    if (me.zh.indexOf('## 分析') >= 0 || me.zh.indexOf('## 选票') >= 0 || me.zh.indexOf('## 阶段闸门') >= 0) fail('mapExecute zh 不该再复述 wayfinder 的推进步骤（#1281 去技能规则复述）')
    if (me.zh.indexOf('|') >= 0) fail('mapExecute zh 含表格 |（已约定无表格，全勾选框）')
    if (me.zh.indexOf('deck_') < 0) fail('mapExecute zh 缺工具节要求（issue 相关操作优先使用 deck_ 开头的工具处理）')
    if (me.placeholders.length !== 0) fail('mapExecute 不应声明占位符（标识头已撤掉，无 {n}/{title}/{url} 可填）')
    if (me.en.indexOf('- [ ]') < 0) fail('mapExecute en 缺清单标记 - [ ]')
    if (me.en.indexOf('## Tools') < 0 || me.en.indexOf('## Wrap-up') < 0) fail('mapExecute en 缺清单段标题（Tools/Wrap-up）')
  }
  // tpl.execute / tpl.discuss / tpl.research / tpl.prototype（#1281：map 子票统一入口）
  //   四条同为首行 /wayfinder + 第二行 {url}，之后只保留插件增量（调查节 + 收尾）；
  //   原型多一节「定版与移交」（#1258），等下面这张公共骨架表判完后单独判。
  //   技能内部如何按票的类型分流不在插件这里复述（#1281 第 5 条原则）。
  ;['tpl.execute', 'tpl.discuss', 'tpl.research', 'tpl.prototype'].forEach(function (wfId) {
    const wf = reg[wfId]
    if (!wf) { fail('缺条目 ' + wfId); return }
    if (wf.zh.indexOf('/wayfinder') !== 0) fail(wfId + ' zh 首行必须是 /wayfinder（#1281 map 子票统一入口）')
    if (wf.zh.indexOf('{url}') < 0) fail(wfId + ' zh 缺第二行链接占位符 {url}')
    if (wf.zh.indexOf('- [ ]') < 0) fail(wfId + ' zh 缺清单标记 - [ ]（A★ 清单式）')
    if (wf.zh.indexOf('## 调查（建议先查后问）') < 0) fail(wfId + ' zh 缺 #1212 调查节（先查后问）')
    if (wf.zh.indexOf('建议先阅读本票正文、评论及仓内相关内容后再提问') < 0) fail(wfId + ' zh 缺 #1212 调查首行（先读本票与仓内）')
    if (wf.zh.indexOf('|') >= 0) fail(wfId + ' zh 含表格 |（已约定无表格，全勾选框）')
    if (wf.zh.indexOf('## 收尾') < 0) fail(wfId + ' zh 缺收尾节')
    if (wf.en.indexOf('- [ ]') < 0) fail(wfId + ' en 缺清单标记 - [ ]')
    if (wf.en.indexOf('## Investigate (recommended: look before asking)') < 0) fail(wfId + ' en 缺 #1212 调查节（同中文那条的对应节）')
    if (wf.en.indexOf('It is recommended to read this ticket body') < 0) fail(wfId + ' en 缺 #1212 调查首行（同中文那条的对应句）')
    if (wf.en.indexOf('## Wrap-up') < 0) fail(wfId + ' en 缺收尾节')
  })
  // tpl.prototype（#1258）：原型会话关票前要把「哪一版、什么算数、照做标准与复核人」写进票正文，
  //   否则下游只能翻评论猜版本（#1258 调查的四张已关闭原型票就有四种记法）。
  //   不算复述技能规则（#1281）：原型技能第 6 条只要求把原型与结论挂到实施票上，没有要求在本票
  //   写清看的是哪个变体、哪些状态算数、谁复核；这一节补的正是这几样，落点在本票正文而不是评论。
  //   落点固定在调查节与收尾之间：收尾是最后动作，移交写晚了会被跳过。
  const proto = reg['tpl.prototype']
  if (proto) {
    const protoZh = String(proto.zh)
    const protoEn = String(proto.en)
    if (protoZh.indexOf('## 定版与移交') < 0) fail('tpl.prototype zh 缺 #1258 定版与移交节')
    if (protoZh.indexOf('让后人能打开同一版') < 0) fail('tpl.prototype zh 缺定版位置要求（让后人能打开同一版）')
    if (protoZh.indexOf('写清什么算数') < 0) fail('tpl.prototype zh 缺「什么算数」要求（已点头的逐条列出、未选中的写不算数，同 #1258）')
    if (protoZh.indexOf('照做标准与复核人') < 0) fail('tpl.prototype zh 缺照做标准与复核人（#1258）')
    if (protoEn.indexOf('## Agreed version and handoff') < 0) fail('tpl.prototype en 缺 #1258 Agreed version and handoff 节')
    if (protoEn.indexOf('so a later session can open the same version') < 0) fail('tpl.prototype en 缺定版位置要求（同中文那条）')
    if (protoEn.indexOf('State what counts') < 0) fail('tpl.prototype en 缺「什么算数」要求（同中文那条）')
    if (protoEn.indexOf('reproduction standard and the reviewer') < 0) fail('tpl.prototype en 缺照做标准与复核人（同中文那条）')
    if (protoZh.indexOf('## 定版与移交') > protoZh.indexOf('## 收尾')) fail('tpl.prototype zh 的定版与移交节应在收尾之前（#1258）')
    if (protoEn.indexOf('## Agreed version and handoff') > protoEn.indexOf('## Wrap-up')) fail('tpl.prototype en 的移交节应在 Wrap-up 之前（同中文那条）')
    if (protoZh.indexOf('## 定版与移交') < protoZh.indexOf('## 调查（建议先查后问）')) fail('tpl.prototype zh 的定版与移交节应在调查节之后（#1258）')
    if (protoEn.indexOf('## Agreed version and handoff') < protoEn.indexOf('## Investigate (recommended: look before asking)')) fail('tpl.prototype en 的移交节应在 Investigate 之后（同中文那条）')
  }
  // tpl.diagnose（#1281 只留插件增量；#1212 恢复：调查节、诊断边界与收尾两条回来）
  const di = reg['tpl.diagnose']
  if (di) {
    if (di.zh.indexOf('/triage') !== 0) fail('tpl.diagnose zh 首行必须是 /triage（#1281）')
    if (di.zh.indexOf('{url}') < 0) fail('tpl.diagnose zh 缺链接占位符 {url}')
    if (di.zh.indexOf('按 /triage 技能诊断这张 issue') < 0) fail('tpl.diagnose zh 缺引导句（按 /triage 技能诊断）')
    if (di.zh.indexOf('诊断不等于修复') < 0 || di.zh.indexOf('不改业务代码、不开始实施') < 0) fail('tpl.diagnose zh 缺诊断边界（诊断不等于修复、不改业务代码、不开始实施）')
    if (di.zh.indexOf('## 先核对是否已有实施') < 0) fail('tpl.diagnose zh 缺已实现核对节（先核对是否已有实施）')
    if (di.zh.indexOf('按 /triage 处理“已实现”票的规则收口') < 0) fail('tpl.diagnose zh 缺已实现收口规则（落哪个终态交给 /triage）')
    if (di.zh.indexOf('## 调查（建议先查后问）') < 0) fail('tpl.diagnose zh 缺 #1212 调查节（先查后问）')
    if (di.zh.indexOf('建议先阅读本票正文、评论及仓内相关内容后再提问') < 0) fail('tpl.diagnose zh 缺 #1212 调查首行（先读本票与仓内）')
    if (di.zh.indexOf('说明回复后你准备执行什么标签动作') < 0) fail('tpl.diagnose zh 缺收尾第二条（回复后执行什么标签动作）')
    if (di.zh.indexOf('写明这张票已转到哪个终态') < 0) fail('tpl.diagnose zh 缺收尾第二条（无待拍板时写终态）')
    if (di.zh.indexOf('## 弄清现象') >= 0 || di.zh.indexOf('## 根因候选') >= 0 || di.zh.indexOf('## 分流建议') >= 0 || di.zh.indexOf('## 阶段闸门') >= 0) fail('tpl.diagnose zh 不该再复述 triage 的诊断步骤（#1281 去技能规则复述）')
    if (di.zh.indexOf('- [ ]') < 0) fail('tpl.diagnose zh 缺清单标记 - [ ]')
    if (di.zh.indexOf('|') >= 0) fail('tpl.diagnose zh 含表格 |（已约定无表格，全勾选框）')
    if (di.en.indexOf('- [ ]') < 0) fail('tpl.diagnose en 缺清单标记 - [ ]')
    if (di.en.indexOf('Follow the /triage skill to diagnose this issue') < 0) fail('tpl.diagnose en 缺引导句（同中文那条）')
    if (di.en.indexOf('## Check for existing implementation first') < 0) fail('tpl.diagnose en 缺已实现核对节（同中文那条）')
    if (di.en.indexOf('## Investigate (recommended: look before asking)') < 0) fail('tpl.diagnose en 缺 #1212 调查节（同中文那条）')
    if (di.en.indexOf('It is recommended to read this ticket body') < 0) fail('tpl.diagnose en 缺 #1212 调查首行（同中文那条）')
    if (di.en.indexOf('## Wrap-up') < 0) fail('tpl.diagnose en 缺收尾节')
    if (di.en.indexOf('State what label action you will take once the reply comes') < 0) fail('tpl.diagnose en 缺收尾第二条（同中文那条）')
  }
  // tpl.fix（#1281：只留插件增量；修复步骤交给 /implement，根因不明交给 /diagnosing-bugs）
  const fxt = reg['tpl.fix']
  if (fxt) {
    if (fxt.zh.indexOf('- [ ]') < 0) fail('tpl.fix zh 缺清单标记 - [ ]（A★ 清单式）')
    if (fxt.zh.indexOf('## 读现状') < 0 || fxt.zh.indexOf('## 收尾') < 0) fail('tpl.fix zh 缺清单段标题（读现状/收尾）')
    if (fxt.zh.indexOf('## 定位与修复') >= 0) fail('tpl.fix zh 不该再复述修复步骤（#1281 去技能规则复述）')
    if (fxt.zh.indexOf('若还挂着 needs-triage') < 0) fail('tpl.fix zh 缺读现状兜底句（若还挂着 needs-triage）')
    if (fxt.zh.indexOf('/diagnosing-bugs') < 0) fail('tpl.fix zh 缺 #1281 落点：根因不明先按 /diagnosing-bugs 定位')
    if (fxt.zh.indexOf('按 /implement 技能修复这个 bug') < 0) fail('tpl.fix zh 缺首行引导句（与首行 /implement 一致）')
    if (fxt.zh.indexOf('|') >= 0) fail('tpl.fix zh 含表格 |（已约定无表格，全勾选框）')
    if (fxt.en.indexOf('- [ ]') < 0) fail('tpl.fix en 缺清单标记 - [ ]')
    if (fxt.en.indexOf('## Read current state') < 0 || fxt.en.indexOf('## Wrap-up') < 0) fail('tpl.fix en 缺清单段标题（Read current state/Wrap-up）')
    if (fxt.en.indexOf('If it still carries needs-triage') < 0) fail('tpl.fix en 缺读现状兜底句（If it still carries needs-triage）')
    if (fxt.en.indexOf('/diagnosing-bugs') < 0) fail('tpl.fix en 缺 /diagnosing-bugs 落点（同中文那条）')
    if (fxt.en.indexOf('Follow the /implement skill to fix this bug') < 0) fail('tpl.fix en 缺首行引导句（同中文那条）')
  } else fail('缺条目 tpl.fix')
  // tpl.takeover（#1281：补 /wizard 落点，人工三档与交给用户的清单是插件增量；#1212 恢复：调查节回来）
  const to = reg['tpl.takeover']
  if (to) {
    if (to.zh.indexOf('## 判断人工档位') < 0 || to.zh.indexOf('## 交给用户的清单') < 0) fail('tpl.takeover zh 缺清单段标题（判断人工档位/交给用户的清单）')
    if (to.zh.indexOf('/wizard') < 0) fail('tpl.takeover zh 缺 #1281 落点：需要用户动手且步骤多时用 /wizard')
    if (to.zh.indexOf('## 调查（建议先查后问）') < 0) fail('tpl.takeover zh 缺 #1212 调查节（先查后问）')
    if (to.zh.indexOf('建议先阅读本票正文、评论及仓内相关内容后再提问') < 0) fail('tpl.takeover zh 缺 #1212 调查首行（先读本票与仓内）')
    if (to.en.indexOf('## Decide the human tier') < 0 || to.en.indexOf('## Checklist for the user') < 0) fail('tpl.takeover en 缺清单段标题（同中文那条）')
    if (to.en.indexOf('/wizard') < 0) fail('tpl.takeover en 缺 /wizard 落点（同中文那条）')
    if (to.en.indexOf('## Investigate (recommended: look before asking)') < 0) fail('tpl.takeover en 缺 #1212 调查节（同中文那条）')
    if (to.en.indexOf('It is recommended to read this ticket body') < 0) fail('tpl.takeover en 缺 #1212 调查首行（同中文那条）')
  } else fail('缺条目 tpl.takeover')
  const su = reg['tpl.supplement']
  if (su) {
    if (su.zh.indexOf('## 调查（建议先查后问）') < 0) fail('tpl.supplement zh 缺 #1212 调查节（先查后问）')
    if (su.zh.indexOf('建议先阅读本票正文、评论及仓内相关内容后再提问') < 0) fail('tpl.supplement zh 缺 #1212 调查首行（先读本票与仓内）')
    if (su.en.indexOf('## Investigate (recommended: look before asking)') < 0) fail('tpl.supplement en 缺 #1212 调查节（同中文那条的对应节）')
    if (su.en.indexOf('It is recommended to read this ticket body') < 0) fail('tpl.supplement en 缺 #1212 调查首行（同中文那条的对应句）')
  } else fail('缺条目 tpl.supplement')
  // 首行技能归属（#1577）：动作模板第一行决定新会话加载哪个技能，挂错会让整段流程按错误技能跑。
  //   triage 三态（诊断/接手/补充）吃 triage 技能的状态机（标签语义、改判与回流、AI 声明、人工档位），
  //   wayfinder 四类（讨论/研究/原型/执行）吃 wayfinder 技能，修复/实施吃 implement 技能。
  //   接手与补充以前首行是 /wayfinder（#1281 重写时沿用旧模板），2026-10-27 改回 /triage 并在这里锁住。
  const FIRST_LINE_SKILL = {
    '/triage': ['tpl.diagnose', 'tpl.takeover', 'tpl.supplement'],
    '/wayfinder': ['tpl.discuss', 'tpl.research', 'tpl.prototype', 'tpl.execute'],
    '/implement': ['tpl.fix', 'tpl.implement'],
  }
  Object.keys(FIRST_LINE_SKILL).forEach(function (skill) {
    FIRST_LINE_SKILL[skill].forEach(function (id) {
      const p = reg[id]
      if (!p) return
      const zhFirst = String(p.zh).split('\n')[0].trim()
      const enFirst = String(p.en).split('\n')[0].trim()
      if (zhFirst !== skill) fail(id + ' zh 首行是 ' + JSON.stringify(zhFirst) + '，应为 ' + skill + '（首行决定新会话加载哪个技能，#1577）')
      if (enFirst !== skill) fail(id + ' en 首行是 ' + JSON.stringify(enFirst) + '，应为 ' + skill + '（首行决定新会话加载哪个技能，#1577）')
    })
  })
  ;['tpl.takeover', 'tpl.supplement'].forEach(function (id) {
    const p = reg[id]
    if (!p) return
    if (String(p.zh).indexOf('wayfinder') >= 0 || String(p.en).indexOf('wayfinder') >= 0) {
      fail(id + ' 正文还在引用 wayfinder 技能（这几张票是 triage 状态，归 triage 技能，#1577）')
    }
  })
  // 接手/补充的状态分支（#1577）：这两条最容易只改首行、忘了补分支，正文里的关键出口逐条锁住。
  const TO_BRANCH = reg['tpl.takeover']
  if (TO_BRANCH) {
    if (TO_BRANCH.zh.indexOf('## 读现状') < 0) fail('tpl.takeover zh 缺「读现状」节（先核对人那部分是否已完成，#1577）')
    if (TO_BRANCH.zh.indexOf('用户已确认做完') < 0) fail('tpl.takeover zh 缺「用户已做完」收尾分支（#1577）')
    if (TO_BRANCH.en.indexOf('## Read the current state') < 0) fail('tpl.takeover en 缺「读现状」节（同中文那条）')
    if (TO_BRANCH.en.indexOf('User has confirmed it is done') < 0) fail('tpl.takeover en 缺「用户已做完」收尾分支（同中文那条）')
  }
  const SU_BRANCH = reg['tpl.supplement']
  if (SU_BRANCH) {
    if (SU_BRANCH.zh.indexOf('## 读现状') < 0) fail('tpl.supplement zh 缺「读现状」节（先核对报告人是否已答复，#1577）')
    if (SU_BRANCH.zh.indexOf('本会话内拿到答复') < 0) fail('tpl.supplement zh 缺「本会话内拿到答复」回流分支（#1577）')
    if (SU_BRANCH.zh.indexOf('This was generated by AI during triage.') < 0) fail('tpl.supplement zh 缺 triage 的 AI 声明（#1577）')
    if (SU_BRANCH.en.indexOf('## Read the current state') < 0) fail('tpl.supplement en 缺「读现状」节（同中文那条）')
    if (SU_BRANCH.en.indexOf('Reply received in this session') < 0) fail('tpl.supplement en 缺「本会话内拿到答复」回流分支（同中文那条）')
  }
  // newWayfinder（#1281：只留调查/收尾/工具节，建图规则交给 wayfinder 技能，不再复述）
  const nw = reg['newWayfinder']
  if (nw) {
    if (nw.zh.indexOf('/wayfinder') !== 0) fail('newWayfinder zh 首行必须是 /wayfinder（#1281）')
    if (nw.zh.indexOf('{repo}') < 0) fail('newWayfinder zh 缺仓库占位符 {repo}')
    if (nw.placeholders.indexOf('subIssue') >= 0) fail('newWayfinder 不该再声明 {subIssue}（建边规则交给 wayfinder 技能，#1281）')
    if (nw.zh.indexOf('{subIssue}') >= 0) fail('newWayfinder zh 残留 {subIssue} 占位符（#1281）')
    if (nw.zh.indexOf('- [ ]') < 0) fail('newWayfinder zh 缺清单标记 - [ ]（A★ 清单式）')
    if (nw.zh.indexOf('## 调查（建议先查后问）') < 0) fail('newWayfinder zh 缺 #1212 调查节（先查后问）')
    if (nw.zh.indexOf('## 判断分类') >= 0 || nw.zh.indexOf('## 自查') >= 0 || nw.zh.indexOf('写出 map：Destination + Notes + plan') >= 0) fail('newWayfinder zh 不该再复述 wayfinder 的建图步骤（#1281 去技能规则复述）')
    if (nw.zh.indexOf('|') >= 0) fail('newWayfinder zh 含表格 |（已约定无表格，全勾选框）')
    if (nw.zh.indexOf('deck_') < 0) fail('newWayfinder zh 缺工具节（#779）')
    if (nw.en.indexOf('- [ ]') < 0) fail('newWayfinder en 缺清单标记 - [ ]')
    if (nw.en.indexOf('## Investigate (recommended: look before asking)') < 0) fail('newWayfinder en 缺调查节（同中文那条）')
    if (nw.en.indexOf('## Decide the case') >= 0 || nw.en.indexOf('## Self-check') >= 0) fail('newWayfinder en 不该再复述 wayfinder 建图步骤（#1281）')
  }
  // complete（#1281：自包含格式 + 按 wayfinder 核对完成 + 手动交棒 /to-spec → /to-tickets，进度记回 map 正文）
  //   #1274 收口后补「先判断」节：按当前状态走分支，已交过棒的步骤跳过，不需要接着做时不生成规格、也不拆任何 ticket。
  const co = reg['complete']
  if (co) {
    if (co.zh.indexOf('/wayfinder') !== 0) fail('complete zh 首行必须是 /wayfinder（#1281 自包含格式）')
    if (co.zh.indexOf('{url}') < 0) fail('complete zh 缺第二行链接占位符 {url}（#1281 自包含格式）')
    if (co.zh.indexOf('- [ ]') < 0) fail('complete zh 缺清单标记 - [ ]（A★ 清单式）')
    if (co.zh.indexOf('## 完成核对') < 0 || co.zh.indexOf('## 交棒') < 0 || co.zh.indexOf('## 收尾') < 0) fail('complete zh 缺清单段标题（完成核对/交棒/收尾）')
    if (co.zh.indexOf('## 先判断') < 0) fail('complete zh 缺「先判断」节（#1274：探索结论需不需要接着做）')
    if (co.zh.indexOf('不生成规格') < 0 || co.zh.indexOf('这一种情况走完就结束') < 0) fail('complete zh 分岔节缺「不需要接着做」那一支（不生成规格、记结论后关闭、走完即止）')
    if (co.zh.indexOf('做完的跳过') < 0) fail('complete zh 缺「先读正文里的进度、做完的步骤跳过」那一步（#1274：已交过棒的地图不该被再次要求 /to-spec）')
    if (co.zh.indexOf('两种都有') < 0 || co.zh.indexOf('核对不通过') < 0) fail('complete zh 分岔节缺「两种都有」「核对不通过」两个分支（#1274）')
    if (co.zh.indexOf('|') >= 0) fail('complete zh 含表格 |（已约定无表格，全勾选框）')
    if (co.zh.indexOf('子票') >= 0 || co.zh.indexOf('票') >= 0) fail('complete zh 专业术语未用英文（子票/票 → sub-issue/ticket）')
    if (co.zh.indexOf('/to-spec') < 0 || co.zh.indexOf('/to-tickets') < 0) fail('complete zh 缺交棒两步（/to-spec → /to-tickets）')
    if (co.zh.indexOf('## 工具') < 0 || co.zh.indexOf('优先使用 deck_ 开头的工具') < 0 || co.zh.indexOf('deck_issue_report') < 0) fail('complete zh 缺工具节两行（#779）')
    if (co.placeholders.indexOf('closed') < 0 || co.placeholders.indexOf('total') < 0) fail('complete 占位符缺 closed/total')
    if (co.placeholders.indexOf('url') < 0) fail('complete 占位符缺 url（首行链接已自包含）')
    if (co.placeholders.indexOf('n') >= 0 || co.placeholders.indexOf('title') >= 0) fail('complete 占位符残留已删标识头的 n/title（#779）')
    if (co.zh.indexOf('从第一性原理出发完成任务') >= 0) fail('complete zh 残留 guide 引导句（#77 已删）')
    if (co.en.indexOf('Approach tasks from first principles') >= 0) fail('complete en 残留 guide 引导句（#77 已删）')
    if (co.en.indexOf('- [ ]') < 0) fail('complete en 缺清单标记 - [ ]')
    if (co.en.indexOf('## Completion check') < 0 || co.en.indexOf('## Handoff') < 0 || co.en.indexOf('## Wrap-up') < 0) fail('complete en 缺清单段标题')
    if (co.en.indexOf('## First check') < 0) fail('complete en 缺「First check」节（探索结论需不需要接着做，对应中文「先判断」）')
    if (co.en.indexOf('do not create a spec') < 0 || co.en.indexOf('this branch ends here') < 0) fail('complete en 分岔节缺「不需要接着做」那一支（不生成规格、记结论后关闭、走完即止）')
    if (co.en.indexOf('do not re-advise') < 0) fail('complete en 缺「先读正文里的进度、做完的步骤跳过」那一步（对应中文的完成核对首条）')
    if (co.en.indexOf('Both: part of it needs building') < 0 || co.en.indexOf('Check not passed') < 0) fail('complete en 岔节缺「两种都有」「核对不通过」两个分支（对应中文同名两条）')
    if (co.en.indexOf('## Tools') < 0 || co.en.indexOf('deck_issue_report') < 0) fail('complete en 缺工具节两行（#779）')
  } else fail('缺条目 complete')
  // 2026-10-29：元提示句「从第一性原理出发。」进 19 条注入面（15 条模板直接引用公共小节 firstPrinciples，
  //   mapTicketAdvanceOpening 覆盖讨论 / 执行 / 研究 / 原型 4 条）。只判「两语言都在」，位置由正文结构自证；
  //   哪条被悄悄删掉这里先红，不靠人眼。handoff2 是「搬家」：队尾旧句必须已经清掉。
  const FIRST_PRINCIPLES_IDS = [
    'mapExecute', 'complete', 'healthCheck', 'mapInspect', 'specExecute', 'specComplete', 'specSplit',
    'tpl.diagnose', 'tpl.fix', 'tpl.implement', 'tpl.takeover', 'tpl.handoff2',
    'newWayfinder', 'newSpec', 'newBugWayfinder',
    'tpl.discuss', 'tpl.execute', 'tpl.research', 'tpl.prototype',
  ]
  FIRST_PRINCIPLES_IDS.forEach(function (id) {
    const e = reg[id]
    if (!e) { fail('缺条目 ' + id + '（firstPrinciples 判据无源）'); return }
    if (String(e.zh).indexOf('从第一性原理出发。') < 0) fail(id + ' zh 缺元提示句「从第一性原理出发。」（公共小节 firstPrinciples，2026-10-29 加）')
    if (String(e.en).indexOf('Start from first principles.') < 0) fail(id + ' en 缺元提示句 Start from first principles.（同中文那条的对应句）')
  })
  ;[['zh', '从第一性原理出发，继续'], ['en', 'From first principles, continue']].forEach(function (pair) {
    const body = String((reg['tpl.handoff2'] || {})[pair[0]] || '')
    if (body.indexOf(pair[1]) >= 0) fail('tpl.handoff2 ' + pair[0] + ' 队尾还留着旧句「' + pair[1] + '…」，应挪到开头（2026-10-29）')
  })
  // handoff1/handoff2（#71）
  const h1 = reg['tpl.handoff1']
  if (h1) {
    if (h1.version < 3) fail('tpl.handoff1 版本号未 bump（期望 ≥ v3）')
    if (h1.zh.indexOf('短标题') < 0) fail('tpl.handoff1 zh 缺短标题指令（{ts}-<短标题>.md）')
    if (h1.en.indexOf('<short>') < 0) fail('tpl.handoff1 en 缺短标题指令（{ts}-<short>.md）')
  } else fail('缺条目 tpl.handoff1')
  const h2 = reg['tpl.handoff2']
  if (h2) {
    if (h2.version < 3) fail('tpl.handoff2 版本号未 bump（期望 ≥ v3）')
    if (h2.zh.indexOf('- [ ]') < 0) fail('tpl.handoff2 zh 缺清单标记 - [ ]（A★ 清单式）')
    if (h2.zh.indexOf('## 复述理解') < 0 || h2.zh.indexOf('## 继续推进') < 0) fail('tpl.handoff2 zh 缺清单段标题（复述理解/继续推进）')
    if (h2.zh.indexOf('|') >= 0) fail('tpl.handoff2 zh 含表格 |（已约定无表格，全勾选框）')
    if (h2.zh.indexOf('/read') >= 0) fail('tpl.handoff2 zh 仍含 /read 命令（DSH 无此命令，需通用语句）')
    if (h2.zh.indexOf('{path}') < 0) fail('tpl.handoff2 zh 未用 {path} 绝对路径占位符')
    if (h2.en.indexOf('- [ ]') < 0) fail('tpl.handoff2 en 缺清单标记 - [ ]')
    if (h2.en.indexOf('{path}') < 0) fail('tpl.handoff2 en 未用 {path} 绝对路径占位符')
  } else fail('缺条目 tpl.handoff2')
  if (reg['handoffRead']) fail('handoffRead 未塌缩删除（应只剩 tpl.handoff2 单模板）')
  // fixate（#72）
  const fx = reg['fixate']
  if (fx) {
    if (fx.version < 2) fail('fixate 版本号未 bump（期望 ≥ v2）')
    if (fx.zh.indexOf('- [ ]') < 0) fail('fixate zh 缺清单标记 - [ ]（A★ 清单式）')
    if (fx.zh.indexOf('## 沉淀') < 0 || fx.zh.indexOf('## 可疑遗漏') < 0 || fx.zh.indexOf('## 核对') < 0 || fx.zh.indexOf('## 落盘') < 0) fail('fixate zh 缺清单段标题（沉淀/可疑遗漏/核对/落盘）')
    if (fx.zh.indexOf('|') >= 0) fail('fixate zh 含表格 |（已约定无表格，全勾选框）')
    if (fx.zh.indexOf('思维对齐 · 成果沉淀') < 0) fail('fixate zh 缺新命名（思维对齐 · 成果沉淀，旧名「零丢失快照」已退役）')
    if (fx.zh.indexOf('零丢失') >= 0) fail('fixate zh 残留旧命名「零丢失」')
    if (fx.zh.indexOf('对齐成果') < 0 || fx.zh.indexOf('.scratch/alignment/') < 0) fail('fixate zh 缺落盘分支契约（对齐成果 / .scratch/alignment/）')
    if (fx.zh.indexOf('ticket') < 0 || fx.zh.indexOf('map') < 0) fail('fixate zh 缺术语（ticket/map，专业术语英文）')
    if (fx.en.indexOf('- [ ]') < 0) fail('fixate en 缺清单标记 - [ ]')
    if (fx.en.indexOf('## Consolidate') < 0 || fx.en.indexOf('## Suspected omissions') < 0 || fx.en.indexOf('## Review') < 0 || fx.en.indexOf('## Persist') < 0) fail('fixate en 缺清单段标题（Consolidate/Suspected omissions/Review/Persist）')
    if (fx.en.indexOf('alignment & consolidation') < 0) fail('fixate en 缺新命名（alignment & consolidation）')
  } else fail('缺条目 fixate')
  // #1407：/retro 提醒行整行删除 —— 它和 /ask-matt 的「推荐下一步」重复了。
  //   判据从「名单里 17 条必须在场」翻成「一条都不许在场」：17 条名单照旧逐条判缺席（不许只删一半），
  //   再加一次全量兜底（其余模板也不许带）。名单仍是 #1269 / #1281 立的那 17 条；
  //   名单改动必须同时改验收，不然「悄悄删掉一半」也能溜过去。
  const RETRO_REMOVED_IDS = [
    'tpl.fix', 'tpl.discuss', 'tpl.research', 'tpl.prototype', 'tpl.execute', 'tpl.takeover', 'tpl.supplement', 'tpl.implement',
    'mapExecute', 'complete', 'newWayfinder', 'newBugWayfinder', 'fixate',
    'newSpec', 'specSplit', 'specExecute', 'specComplete',
  ]
  if (RETRO_REMOVED_IDS.length !== 17) fail('#1407 /retro 提醒行删除名单条数 ' + RETRO_REMOVED_IDS.length + '（定稿 17）')
  RETRO_REMOVED_IDS.forEach(function (id) {
    const e = reg[id] || {}
    if (String(e.zh || '').indexOf('/retro') >= 0) fail('#1407 模板 ' + id + '.zh 还留着 /retro 提醒行（#1407 起整行删除，和 /ask-matt 的推荐下一步重复）')
    if (String(e.en || '').indexOf('/retro') >= 0) fail('#1407 模板 ' + id + '.en 还留着 /retro 提醒行（#1407 起整行删除）')
  })
  Object.keys(reg).forEach(function (id) {
    const t = String(reg[id].zh || '') + String(reg[id].en || '')
    if (t.indexOf('/retro') >= 0) fail('#1407 模板 ' + id + ' 的正文里出现 /retro（这条提醒已整行删除；要重新加回请先改名单与本门禁的验收）')
  })
  // installSkills（#74 + #fix-banner 修正）
  //   #573 修正（原 SKILL_NAMES_10 清单已过时）：技能名真源是 src/shared/matt-skills.js（25 项），
  //   占位符那条原来由 tests/verify-matt-skills-sync.js 第 4 条卡着；该门禁 2026-10-17 已删
  //   （它十处判据里九处是文本在场扫描，独有的一条「随包目录集合与单源双向差集为 0」已搬进
  //   tests/verify-bundled-skills.ts 第 6 段）。今天这份「占位符有没有被用上」由下面的断言守着。
  //   本门禁只断言模板侧的两个占位符与安装目录，不重复维护技能名清单（避免第二份名单漂移）。
  const is = reg['installSkills']
  if (is) {
    if (is.version < 2) fail('installSkills 版本号未 bump（期望 ≥ v2）')
    if (is.zh.indexOf('~/.agents/skills') < 0) fail('installSkills zh 缺安装目录 ~/.agents/skills')
    if (is.en.indexOf('~/.agents/skills') < 0) fail('installSkills en 缺安装目录 ~/.agents/skills')
    if (is.zh.indexOf('{probeList}') < 0 || is.zh.indexOf('{probeCount}') < 0) fail('installSkills zh 缺动态注入占位符（{probeList} / {probeCount}，技能名清单由 shared/matt-skills.js 单源注入）')
    if (is.en.indexOf('{probeList}') < 0 || is.en.indexOf('{probeCount}') < 0) fail('installSkills en 缺动态注入占位符（{probeList} / {probeCount}）')
  } else fail('缺条目 installSkills')
  // #725：progress（#75）与 bodyFormat（#76）两条整节删除 —— 提示词不再规定进度格式与语义阶梯，
  //   也不再讲正文怎么写（票的正文读写交给 deck_* 工具）。这里留反向断言，防这两条被悄悄加回来。
  if (reg['progress']) fail('#725 注册表不该再有 progress 条目（进度契约已删）')
  if (reg['bodyFormat']) fail('#725 注册表不该再有 bodyFormat 条目（正文格式契约已删）')
  Object.keys(reg).forEach(function (id) {
    const e = reg[id] || {}
    ;['zh', 'en'].forEach(function (lang) {
      const t = String(e[lang] || '')
      if (t.indexOf('{bodyFormat}') >= 0) fail('#725 条目 ' + id + '.' + lang + ' 仍带 {bodyFormat} 标记（该契约已删）')
      if (t.indexOf('进度契约') >= 0 || t.indexOf('progress contract') >= 0) fail('#725 条目 ' + id + '.' + lang + ' 仍引用进度契约（该契约已删）')
    })
  })
  // 统一模板不得残留 GitHub 专用串（与 #603 同口径，改按「逐条列出的那 12 条」判）
  const BODY_IDS = ['mapExecute', 'complete', 'fixate', 'tpl.diagnose', 'tpl.fix', 'tpl.discuss', 'tpl.research', 'tpl.prototype', 'tpl.takeover', 'tpl.supplement', 'tpl.execute', 'mapInspect']
  BODY_IDS.forEach(function (id) {
    const e = reg[id] || {}
    ;['zh', 'en'].forEach(function (lang) {
      const t = String(e[lang] || '')
      ;['fix-issue-body', 'wire-subissues', 'dsh plugin', 'gh auth'].forEach(function (bad) {
        if (t.indexOf(bad) >= 0) fail('模板 ' + id + '.' + lang + ' 残留 GitHub 专用串「' + bad + '」（应改由后端声明、渲染时填空）')
      })
    })
    if ((reg[id] || {}).placeholders.indexOf('bodyFormat') >= 0) fail('#725 模板 ' + id + ' 仍声明占位符 {bodyFormat}')
  })
  // 统一模板不得点名具体跟踪器命令（S1 判定已覆盖，这里补一条「说明文字里也不许引用」的正面检查）
  const zhBlockCount = (reg['mapExecute'] && reg['mapExecute'].zh.split('## 正文格式').length) || 0
  if (zhBlockCount !== 1) fail('mapExecute zh 不应再内嵌「## 正文格式」段（#595 起改由 {bodyFormat} 标记，缺后端声明才落兜底版）')
  // #595：注册表里不再有写回脚本/插件目录的字面副本（GitHub 专用文本已整体搬进 github 后端声明）。
  //   2026-10-21 登录引导单源化后，注册表里连 ghAuthLogin 那条模板也删了，所以全部条目一起判，不留白名单。
  const regNoGh = Object.keys(reg)
  const leaked = regNoGh.filter(function (id) {
    const t = String(reg[id].zh || '') + String(reg[id].en || '')
    return /gh\s+auth|dsh plugin|fix-issue-body|wire-subissues/.test(t)
  })
  if (leaked.length) fail('注册表条目里残留写回脚本/插件目录指令：' + leaked.join(', ') + '（应搬进对应后端的 prompts 声明）')
  // #725：「## 正文格式」那一节整节删除（模板里的标记、后端声明、注册表兜底版全没了），所以期望 0。
  const segCount = (src.match(/## 正文格式/g) || []).length
  if (segCount !== 0) fail('「## 正文格式」段数 ' + segCount + '（期望 0：#725 起正文格式契约已整节删除）')
  // #779：模板要带两行工具节（Q4=原话两行）。
  //   #791 + #792（2026-09-30 定稿）：工具节不再「全部模板都有」，只给「这条提示词引导的动作里会读或写票 / 地图」的模板。
  //   判据来自第一性原理审查（票 792）：deck 工具集的能力边界就是 issue 与 map 的读写（外加认工作区、诊断），没有标签、
  //   文档、登录、装技能这几档 —— 不碰票的流程挂上它只是白挂；初始化 / 登录 / 装技能这几条还会把人引向此刻用不了的
  //   工具（初始化时后端记录还没落地，没登录时工具内部的命令行必然失败）。
  //   2026-10-21：ghAuthLogin 已从注册表删除（用户可见的登录指引只剩后端那一句），登录这一档不再是注册表条目。
  //   下面两张表是这条规则的唯一声明，合起来必须正好覆盖注册表全部条目：第一张里的必须有工具节，第二张里的一条都不许有。
  //   改这两张表要走评审，并同步 src/client/kernel/prompts.js 顶上那段注释。
  const TOOL_SECTION_IDS = [
    'tpl.diagnose', 'tpl.fix', 'tpl.implement', 'tpl.discuss', 'tpl.research', 'tpl.prototype', 'tpl.execute', 'tpl.takeover', 'tpl.supplement', // 手里就是一张票（9 条）
    'mapExecute', 'complete', 'mapInspect', 'healthCheck', // 手里是一张地图或一批票（4 条）
    'newWayfinder', 'newSpec', 'newBugWayfinder', // 产物就是票（3 条）
    'specSplit', 'specExecute', 'specComplete', // 规格容器三态（3 条）
    'fixate', // 会把成果写回票正文（1 条）
  ]
  const TOOL_SECTION_ABSENT_IDS = [
    'setupRun', // 初始化写的是 docs/agents/*.md 与 AGENTS.md 与标签，工具集里没有标签这一档
    'switchAlign', // 改文档里记录后端的那几行，工具改不了后端记录
    'switchLayout', // 同上，改的是布局那句结论
    'installSkills', // 装技能套件，与跟踪器无关（不读写任何一张票，所以不带工具节）
    'installSkillsFix', // 同上
    'tpl.handoff1', // 只写一份交接文档
    'tpl.handoff2', // 只读交接文档（维护者 2026-09-30 定稿：交接两条都不带工具节）
  ]
  if (TOOL_SECTION_IDS.length !== 20) fail('#792 TOOL_SECTION_IDS 条数 ' + TOOL_SECTION_IDS.length + '（定稿 20；#1281 新增五条）')
  if (TOOL_SECTION_ABSENT_IDS.length !== 7) fail('#792 TOOL_SECTION_ABSENT_IDS 条数 ' + TOOL_SECTION_ABSENT_IDS.length + '（定稿 7；2026-10-21 删 ghAuthLogin，8 → 7）')
  Object.keys(reg).forEach(function (id) {
    const e = reg[id] || {}
    const zh = String(e.zh || ''), en = String(e.en || '')
    const hasZh = zh.indexOf('## 工具') >= 0, hasEn = en.indexOf('## Tools') >= 0
    if (TOOL_SECTION_IDS.indexOf(id) >= 0) {
      if (!hasZh || zh.indexOf('优先使用 deck_ 开头的工具') < 0 || zh.indexOf('deck_issue_report') < 0) fail('#779 模板 ' + id + '.zh 缺两行工具节')
      if (!hasEn || en.indexOf('Prefer the deck_ tools') < 0 || en.indexOf('deck_issue_report') < 0) fail('#779 模板 ' + id + '.en 缺两行工具节')
      return
    }
    if (TOOL_SECTION_ABSENT_IDS.indexOf(id) >= 0) {
      if (hasZh || hasEn) fail('#792 模板 ' + id + ' 不该带工具节（表里写明它的动作不读写票，判据见这张表上方的注释）')
      return
    }
    fail('#792 条目 ' + id + ' 没在工具节两张表里表态（该带还是不该带，请写明理由）')
  })
  TOOL_SECTION_IDS.concat(TOOL_SECTION_ABSENT_IDS).forEach(function (id) {
    if (!reg[id]) fail('#792 工具节两张表里的 ' + id + ' 不在注册表里（表与注册表对不上了）')
  })
  TOOL_SECTION_IDS.forEach(function (id) {
    if (TOOL_SECTION_ABSENT_IDS.indexOf(id) >= 0) fail('#792 条目 ' + id + ' 同时出现在该带与不该带两张表里')
  })
  // workspace-relative 旧形态零残留（#588 立的断言；#603 起口径更严：提示词里一个脚本都不许调）
  const oldForm = (src.match(/`node scripts\/(fix-issue-body|wire-subissues)\.mjs/g) || []).length
  if (oldForm !== 0) fail('workspace-relative 旧形态残留 ' + oldForm + ' 处（`node scripts/<脚本>.mjs；期望 0：#603 起提示词改回 gh 直连，脚本只留在包里当可选工具）')
}

// ==================== 7. L1 内存夹具（绕过样例 + 误报样例；逐条断言） ====================
// 三类必须覆盖：范围绕过（新增条目）、解析绕过（单引号/拆行/引号拼接）、渲染绕过（占位符）
// 条目形状：[名字, 文本, 期望（可选）]
//   期望 = { rules: ['R8'], allowTracker: true }：rules 是「这条必须命中的规则名」，allowTracker 原样交给 judge（按面开关）。
//   为什么加这一栏（#603）：以前只判「有没有红」，于是「红得不对」（本该 R8 却被别的规则抓住）也照样算过。
//   改判红 / 改口径的那批样例现在都把期望规则钉死，见下面 r8Pinned 条数断言。
const FIXTURE_BYPASS = [
  ['T01 TAB 分隔', '写回用 gh\tissue edit 573 --body-file x.md'],
  ['T02 多空格', '写回用 gh   issue edit 573 --body-file x.md'],
  ['T03 全角空格 U+3000', '写回用 gh\u3000issue edit 573 --body-file x.md'],
  ['T04 全角字母', '写回用 ｇｈ issue edit 573 --body-file x.md'],
  ['T05 大写 GH', '写回用 GH issue edit 573 --body-file x.md'],
  ['T06 源码字面 \\n 拼接', '写回用 gh\\nissue edit 573 --body-file x.md'],
  ['T07 零宽字符 U+200B', '写回用 gh\u200bissue edit 573 --body-file x.md'],
  ['T08 引号拼接 gh" "issue', '写回用 gh" "issue edit 573 --body-file x.md'],
  ['T09 引号拼出 g\'\'h', "写回用 g''h issue edit 573 --body-file x.md"],
  ['T10 中文紧贴 用gh api', '建边用gh api repos/o/r/issues/1/sub_issues -X POST'],
  ['T11 中文顿号分隔', '写回用 gh、issue edit 573 --body-file x.md'],
  ['T12 反斜杠续行', 'gh \\\n  issue edit 573 --body-file x.md'],
  ['T13 glab issue update', '写回用 glab issue update 573 --description-file x.md'],
  ['T14 heredoc 单字母 <<E', 'cat <<E\n正文\nE'],
  ['T15 heredoc <<-BODY', 'cat <<-BODY\n\t正文\nBODY'],
  ['T16 curl 直打 API', 'curl -s -X PATCH https://api.github.com/repos/o/r/issues/573 -d @x.json'],
  ['T17 npm exec gh', 'npm exec gh -- issue edit 573 --body-file x.md'],
  ['T18 npx gh', 'npx gh issue edit 573 --body-file x.md'],
  ['T19 node -e 里塞 gh', "node -e \"require('child_process').execSync('gh issue edit 573 --body-file x.md')\""],
  ['T20 变量间接 eval', 'CMD="gh issue edit 573"; eval "$CMD"'],
  ['T21 内联 --body', '写回用 gh issue edit 573 --body 正文'],
  ['T22 内联 --body=', '写回用 gh issue edit 573 --body=正文'],
  ['T23 短选项 -b', '写回用 gh issue edit 573 -b 正文'],
  ['T24 脚本改名伪装', 'node scripts/set-issue-body.mjs --issue 1 --body-file x.md'],
  ['T25 脚本调用后接跟踪器命令（#603：红在 R8 脚本名，R1 也一并命中）', 'node scripts/fix-issue-body.mjs --issue 1 --body-file x.md gh issue edit 573', { rules: ['R8'] }],
  ['T26 base64 解码执行', 'echo Z2ggaXNzdWUgZWRpdCA1NzM= | base64 -d | sh'],
  ['T27 use 字段里写命令', '把正文写回：gh issue edit <号> --body-file <文件>'],
  ['T28 条目内联命令', '- [ ] 写回用 gh issue edit 573 --body-file x.md'],
  ['T29 每个词各自加引号', '写回用 "gh" "issue" edit 573 --body-file x.md'],
  ['T30 heredoc 多字母 <<EOF', 'cat <<EOF\n正文\nEOF'],
  ['T31 curl 直打 GitLab API', 'curl -s https://api.gitlab.com/projects/1/issues'],
  ['T32 脚本调用后接跟踪器命令（#603：红在 R8 脚本名，R1 也一并命中）', 'node scripts/wire-subissues.mjs --map 1 --children 2 --body-file x.md && gh issue edit 1 --body-file y.md', { rules: ['R8'] }],
  ['T33 后端命令藏在字符串拼接续段里', "const a = '先检查（' + x + 'gh api repos/o/r/labels）'"],
  ['T34 占位符值本身含命令', 'gh issue edit 573 --body-file x.md（这是某个占位符的值）'],
  ['T35 短选项写在命令词与子命令之间（短仓库名）', '写回用 gh -R owner/repo issue edit 573 --body-file x.md'],
  ['T36 gh.exe 形态', '写回用 gh.exe issue edit 573 --body-file x.md'],
  ['T37 glab 短选项', '写回用 glab -R o/r issue update 573 --description-file x.md'],
  ['T38 gh -C 目录选项', '写回用 gh -C /repo issue edit 573 --body-file x.md'],
  ['T39 base64 大写 D', 'echo Z2ggaXNzdWUgZWRpdCA1NzM= | base64 -D | sh'],
  ['T40 xxd 反向拼字节', "echo 6768 | xxd -r -p | sh"],
  // 这一条不改手法而是改成运行时拼字符串：用例输入本身就是故意写的那个形状，拼出来的字符串与原文本逐字相同，用例测的东西不变。
  ['T41 String.fromCharCode 拼命令', 'ev' + 'al(String.fromCharCode(103,104,32,105,115,115,117,101))'],
  ['T42 同形字母 ɡh（U+0261）', '写回用 ɡh issue edit 573 --body-file x.md'],
  ['T43 真仓库名把间隔撑到 48（宽写法窗口不许有上限）', '写回用 gh -R FeatherHunter/dsh-mattpocock-skills-deck issue edit 573 --body-file x.md'],
  ['T44 真实绝对路径把间隔撑到 46', '写回用 gh -C D:\\dsh-plugin\\dsh-mattpocock-skills-deck issue edit 573 --body-file x.md'],
  ['T45 glab + 真仓库名 + --hostname', '写回用 glab -R FeatherHunter/dsh-mattpocock-skills-deck --hostname gitlab.com issue update 573'],
  ['T46 gh --json body issue edit', '写回用 gh --json body issue edit 573 --body-file x.md'],
  ['T47 前置检查后接跟踪器命令', '先跑 gh auth status，再 gh issue edit 573 --body-file x.md'],
  // #603：这两条是旧两步写法（第 ① 步解析插件目录 / 第 ② 步调脚本）后面接跟踪器命令。
  //   新口径下它们仍然红，但红的原因主要落在 R8（含 dsh plugin / require.resolve / 脚本名），R1 也一并命中（后面那句 gh issue edit）。
  ['T48 第 ① 步后接跟踪器命令（#603：红在 R8，R1 也命中）', 'dsh plugin --profile <配置名> exec node -e "console.log(require.resolve(\'dsh-mattpocock-skills-deck/package.json\'))" && gh issue edit 1 --body-file y.md', { rules: ['R8'] }],
  ['T49 第 ② 步后接跟踪器命令（#603：红在 R8，R1 也命中）', 'node "<插件目录>/scripts/fix-issue-body.mjs" --issue 1 --body-file x.md && gh issue edit 1 --body-file y.md', { rules: ['R8'] }],
  // —— #603：以下 13 条原来算合法（登记在绿色误报组 F09–F17 / F23–F26），现在一律判红 ——
  //   它们都是「提示词自己调包内脚本」的写法，正是本票要消灭的那套间接写法，判定落在 R8
  //   （脚本名 / dsh plugin / require.resolve / <插件目录> 任一命中即红）。用例名里保留原编号，方便和旧表对照。
  ['T50 原 F09：合法脚本调用', '- [ ] 调 node scripts/fix-issue-body.mjs --issue <号> --body-file <文件> 写回', { rules: ['R8'] }],
  ['T51 原 F10：全角括号里的脚本调用', '（调 node scripts/fix-issue-body.mjs --issue <号> --body-file <文件>）', { rules: ['R8'] }],
  ['T52 原 F11：node ./scripts 路径写法', '调 node ./scripts/fix-issue-body.mjs --issue 1 --body-file x.md', { rules: ['R8'] }],
  ['T53 原 F12：node scripts\\ 反斜杠写法', '调 node scripts\\fix-issue-body.mjs --issue 1 --body-file x.md', { rules: ['R8'] }],
  ['T54 原 F13：引号包住脚本路径', '"node scripts/fix-issue-body.mjs" --issue 1 --body-file x.md', { rules: ['R8'] }],
  ['T55 原 F14：脚本调用带 --dry-run', '先跑 node scripts/wire-subissues.mjs --map 573 --children 1,2 --dry-run 看回包', { rules: ['R8'] }],
  ['T56 原 F15：脚本调用带 --repo', 'node scripts/wire-subissues.mjs --map 573 --children 1 --body-file x.md --repo owner/repo', { rules: ['R8'] }],
  ['T57 原 F16：脚本名后跟中文标点', '调 node scripts/fix-issue-body.mjs，参数 --issue 与 --body-file', { rules: ['R8'] }],
  ['T58 原 F17：两个脚本调用同段', '先 node scripts/fix-issue-body.mjs --issue 1 --body-file x.md，再 node scripts/wire-subissues.mjs --map 1 --children 2 --body-file x.md', { rules: ['R8'] }],
  ['T59 原 F23：脚本调用版正文格式块（zh）', '## 正文格式（写/改 issue 正文时必须遵守）\n- [ ] 正文先写成文件（文件里是真实换行：每个 `## 章节` 独占一行、段落间留空行），再调 `node scripts/fix-issue-body.mjs --issue <号> --body-file <文件>` 写回；脚本回包 ok 为真才算写完（剥开头不可见字符、按阈值还原字面转义、格式只告警不改写，都由脚本负责）', { rules: ['R8'] }],
  ['T60 原 F24：脚本调用版正文格式块（en）', '## Body format (mandatory when writing/editing an issue body)\n- [ ] Write the body to a file first (real newlines in the file: each `## section` on its own line, a blank line between paragraphs), then write it back with `node scripts/fix-issue-body.mjs --issue <issue> --body-file <file>`; only when the script returns ok true is the write done (the script strips the leading invisible character, restores literal escapes within the threshold, and only warns about formatting)', { rules: ['R8'] }],
  ['T61 原 F25：两步走版正文格式块（zh）', '## 正文格式（写/改 issue 正文时必须遵守）\n- [ ] 先跑 `gh auth status`，没登录先按 ghAuthLogin 指引登完再继续\n- [ ] 第 ① 步拿插件安装目录：跑 `dsh plugin --profile <配置名> exec node -e "console.log(require.resolve(\'dsh-mattpocock-skills-deck/package.json\'))"`，记下输出的目录（下面叫 <插件目录>）；第 ② 步写回：跑 `node "<插件目录>/scripts/fix-issue-body.mjs" --issue <号> --body-file <绝对路径文件>`；第 ② 步的当前目录可能是插件目录而不是你的工作区，所以 `--body-file` 必须用绝对路径', { rules: ['R8'] }],
  ['T62 原 F26：精确第 ① 步调用', '跑 `dsh plugin --profile <配置名> exec node -e "console.log(require.resolve(\'dsh-mattpocock-skills-deck/package.json\'))"` 拿插件安装目录', { rules: ['R8'] }],
  // —— #603 新增：R8 自己的绕过样例（模板面与后端声明面都不许出现这套间接写法）——
  ['T63 旧写法 dsh plugin exec（不带 --profile）', '先跑 dsh plugin exec node -e "console.log(require.resolve(\'dsh-mattpocock-skills-deck/package.json\'))" 拿目录', { rules: ['R8'] }],
  ['T64 <pluginDir> 英文占位符 + 脚本名', 'node "<pluginDir>/scripts/wire-subissues.mjs" --map 1 --children 2', { rules: ['R8'] }],
  ['T65 只写插件目录占位符（不含脚本名）', '第 ① 步拿 <插件目录>，第 ② 步再调写回脚本', { rules: ['R8'] }],
  ['T66 require.resolve 单独出现（拆开写也认）', 'const dir = require.resolve("dsh-mattpocock-skills-deck/package.json")', { rules: ['R8'] }],
  ['T67 R8 拆字规避：反斜杠插进脚本名', 'node "<插件目录>/scripts/fix-issue\\-body.mjs" --issue 1 --body-file x.md', { rules: ['R8'] }],
]
const FIXTURE_FALSE_POS = [
  ['F01 GitHub issue URL', '参考 https://github.com/owner/repo/issues/573 的讨论'],
  ['F02 gh auth login（豁免条目内的文本）', '先跑 gh auth login，再 gh auth status 确认登录态'],
  ['F03 npx skills 安装器', 'npx -y skills@latest add wayfinder triage grilling'],
  ['F04 gh config get', '需要时用 gh config get editor 查配置'],
  ['F05 --body-file 参数名', '写回一律用 --body-file <文件>，不要内联'],
  ['F06 --body 说明句（无值）', '参数 --body 会把正文内联进命令行，禁止'],
  ['F07 --body 说明句（ASCII 空格）', '禁止把正文放进 --body ，必须 --body-file'],
  ['F08 --body-file=x.md', '参数写法 --body-file=x.md 也可以'],
  // #603：原来这里的 F09–F17（脚本调用形态，判绿）整体移到绕过组 T50–T58 —— 现在它们必须判红。
  ['F18 a <<b>> c', '条件 a <<b>> c 表示位移'],
  ['F19 <<< 箭头', '输入 <<< 表示从这里开始'],
  ['F20 heredoc 这个词', 'Do not use heredoc; write the body to a file'],
  ['F21 glab 当后端名', 'GitLab 后端用 glab 命令，GitHub 后端用 gh 命令'],
  ['F22 进度格式示例', '## 进度：90% 独占一行，空行后接 下一步：xxx'],
  // #603：原来这里的 F23–F26（脚本调用版 / 两步走版正文格式块，判绿）整体移到绕过组 T59–T62 —— 现在它们必须判红。
  ['F27 前置 gh auth status 单句', '先跑 `gh auth status`，没登录先按 ghAuthLogin 指引登完再继续'],
  // —— #603 新增绿样例：领导拍板改回 gh 直连后，github 后端声明面允许 gh 命令（判绿时带 allowTracker）；
  //    正文格式块回到「只讲写法规矩」的版本，一个命令词都没有。带第三项的，第三项就是交给 judge 的按面开关。 ——
  ['F28 github 后端 subIssue.zh（gh 直连三步 + 原生阻塞边；github 面允许 gh）', '先 gh api repos/{owner}/{repo}/issues/{child} --jq .id 取子议题数据库 id，再 gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id} 建边；以 gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length 校验计数与预期一致。', { allowTracker: true }],
  ['F29 github 后端 subIssue.en（同上，英文）', 'first gh api repos/{owner}/{repo}/issues/{child} --jq .id for the child database id, then gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id} to create the edge.', { allowTracker: true }],
  ['F30 github 原生阻塞边（dependencies/blocked_by；B 方案明确保留）', 'gh api repos/{owner}/{repo}/issues/{child}/dependencies/blocked_by -X POST -F issue_id=123', { allowTracker: true }],
  ['F31 github 校验张数那一句', 'verify with gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length equals expected', { allowTracker: true }],
  ['F32 还原后的正文格式块 zh（写法规矩，无命令）', '## 正文格式（写/改 issue 正文时必须遵守）\n- [ ] 用真实换行书写：每个 `## 章节` 独占一行，段落间留空行\n- [ ] 写回 issue 正文时以文件方式提交（文件内为真实换行），不要内联转义字符串'],
  ['F33 还原后的正文格式块 en（写法规矩，无命令）', '## Body format (mandatory when writing/editing an issue body)\n- [ ] Use real newlines: each `## section` on its own line, with a blank line between paragraphs\n- [ ] Write the body back via a file (real newlines in the file), never an inline escaped string'],
  ['F34 模板里的 {subIssue} 占位符说明句', '先把该 map 的现有正文取下来存成文件，再按本后端声明的关联方式把子议题建成该 map 的子议题：{subIssue}'],
  ['F35 非 github 后端的 subIssue（泛指自己的命令行，不含 gh）', '用当前后端自己的命令行建原生父子边，建完自校验数量'],
  ['F36 markdown 后端正文格式（明说不需要插件目录与写回脚本）', '这张单据就是本机的一个 Markdown 文件，用编辑工具直接改：不需要登录远端账号、不需要找插件目录、不需要跑写回脚本，也没有 ok 回包可等'],
  ['F37 Blocked by 降级兜底说明句', '子票正文首行的 `Blocked by: #n` 只作降级兜底，阻塞关系以原生依赖边为准'],
  ['F38 gh auth status 前置检查（github 面，允许 gh）', '先跑 gh auth status 确认登录态，再继续', { allowTracker: true }],
  ['F39 gh issue edit 直连写回（github 面，允许 gh）', 'gh issue edit 573 --body-file /abs/path/body.md', { allowTracker: true }],
]
const runFixtureSelfCheck = function (reg, backendSrc) {
  const before = problems.length
  check(FIXTURE_BYPASS.length >= 46, 'L1 夹具条数不足：绕过样例 ' + FIXTURE_BYPASS.length + ' 条（期望 ≥ 46，不许删夹具）')
  check(FIXTURE_FALSE_POS.length >= 24, 'L1 夹具条数不足：误报样例 ' + FIXTURE_FALSE_POS.length + ' 条（期望 ≥ 24，不许删夹具）')
  let leak = 0
  FIXTURE_BYPASS.forEach(function (c) {
    const hits = judge(c[1], c[2])
    const got = hits.map(function (h) { return h.rule }).filter(function (v, i, a) { return a.indexOf(v) === i })
    if (hits.length === 0) { leak++; fail('L1 绕过样例未被判红：' + c[0]); return }
    // 期望规则（可选）：判红的原因必须和用例表写的一致，不许「红得不对」
    const want = (c[2] && c[2].rules) || null
    if (want) {
      const missing = want.filter(function (r) { return got.indexOf(r) < 0 })
      if (missing.length) fail('L1 绕过样例红得不对：' + c[0] + '（期望命中 ' + want.join('+') + '，实得 ' + got.join('+') + '）')
    }
  })
  // #603 防回潮：从误报组改判红的那 13 条（T50–T62）必须都钉着期望规则 R8。
  //   把它们身上的期望删掉，就等于退回「红得对不对没人管」，所以条数卡死在 13。
  const r8Pinned = FIXTURE_BYPASS.filter(function (c) {
    return /^T5[0-9] |^T6[0-2] /.test(c[0]) && c[2] && (c[2].rules || []).indexOf('R8') >= 0
  }).length
  check(r8Pinned === 13, 'L1 从误报组改判红的 13 条（T50–T62）里只有 ' + r8Pinned + ' 条钉着期望规则 R8（改判红的样例必须写清红在哪条规则）')
  let fp = 0
  FIXTURE_FALSE_POS.forEach(function (c) {
    const hits = judge(c[1], c[2])
    if (hits.length) { fp++; fail('L1 正常内容被误判红：' + c[0] + ' [' + hits.map(function (h) { return h.rule }).join('+') + ']') }
  })
  // 范围绕过：把一条假条目塞进内存注册表，走「范围过滤 → 判定」同一条链路（整改①）
  const fakeId = 'tpl.brandNew'
  const fakeReg = Object.assign({}, reg)
  fakeReg[fakeId] = { version: 1, placeholders: [], use: 'x', zh: '写回用 gh issue edit 573 --body-file x.md', en: 'same' }
  let fakeCaught = 0
  ;['zh', 'en', 'use'].forEach(function (f) { fakeCaught += judge(fakeReg[fakeId][f]).length })
  if (fakeCaught === 0) fail('L1 范围绕过未被判红：新增注册表条目 ' + fakeId + ' 内含具体命令（整改①：新条目不许天然豁免）')
  // 后端面绕过（整改②）。#603 起 github 面允许 gh 命令，所以这里钉的是 R8：
  //   往 prompts.subIssue 里塞回「先解析插件目录，再调包内脚本」那套间接写法，必须判红。
  //   注入锚点先自证存在：锚点没了就是空操作，等于这条自检失效（旧锚点「输出有多行时…」随两步写回一起撤掉了）。
  const anchor603 = '建边用 deck_map_link'
  const injected = String(backendSrc).replace(anchor603, anchor603 + '；先跑 dsh plugin --profile <配置名> exec node -e "console.log(require.resolve("dsh-mattpocock-skills-deck/package.json"))" 拿插件安装目录')
  if (injected === String(backendSrc)) fail('L1 后端面绕过自检失效：注入锚点在新文本里找不到（注入成了空操作）')
  const subLits = scanAllLiterals(extractObjectLiteral(injected, 'export const prompts') || '')
  let subCaught = 0
  subLits.forEach(function (lit) {
    if (lit.key !== 'subIssue') return
    judge(lit.text, { allowTracker: true }).forEach(function (h) { if (h.rule === 'R8') subCaught++ })
  })
  if (subCaught === 0) fail('L1 后端面绕过未被判红：prompts.subIssue 塞回「先解析插件目录再调脚本」的间接写法（R8）')
  // 渲染绕过：模板只写占位符，命令在后端声明值里（整改③）
  if (judgeRendered('先 {subIssue} 建边', { subIssue: '先 gh api repos/o/r/issues/1 --jq .id 取 id，再 gh api repos/o/r/issues/1/sub_issues -X POST' }).length === 0) {
    fail('L1 渲染绕过未被判红：命令藏在占位符里（整改③）')
  }
  // 渲染绕过之二：命令被拆成「占位符 + 字面量」（红队新口子）
  const asm = judge(renderWith('{x} {y} issue edit 1', { x: 'gh' }, ''))
  if (asm.length === 0) fail('L1 渲染绕过未被判红：占位符值 + 字面量拼出命令（{x} {y} issue edit 1）')
  // 渲染绕过之三：占位符值本身含命令或换行
  if (judge('gh issue edit 1 --body-file x.md').length === 0) fail('L1 渲染绕过未被判红：占位符值本身含命令')
  if (!/[\r\n]/.test('a\ngh issue edit 1')) fail('L1 夹具自检异常：换行样例本身有问题')
  // 解析绕过：写坏的 YAML 必须让解析抛错（判红，不静默少扫）
  // #1292：从前是「单引号截断让源码求值抛错」，现在是 YAML 层面的两种坏法：语法坏掉、键重复。
  let parseCaught = false
  try {
    parseRegistryYamlText('x:\n  version: 1\n  zh: "没写完\n')
  } catch (e) { parseCaught = true }
  let dupCaught = false
  try {
    parseRegistryYamlText('x:\n  version: 1\nx:\n  version: 2\n')
  } catch (e) { dupCaught = true }
  if (!parseCaught) fail('L1 解析绕过未被判红：写坏的 YAML 没有让解析抛错（解析层会静默漏条目）')
  if (!dupCaught) fail('L1 解析绕过未被判红：重复的键没有让解析抛错（后写的会把先写的盖掉，条目会静默少掉）')
  // 反隐藏：YAML 的锚点与别名能把内容藏起来再别处引用，必须被语法树判据抓出来。
  // #1293：auditRegistryShape 退场后，这条判据由 yamlHidingShape 单独承担（真源每一份都过它，见 promptYamlHidingHits）。
  //   下面这段自证必须继续变红 —— 否则「用锚点藏条目」这条路就没人守了。
  const hiddenSrc = 'base: &b\n  version: 1\n  placeholders: []\n  use: "u"\n  zh: "gh issue edit 1"\n  en: "e"\ntpl.hidden: *b\n'
  let hiddenHit = ''
  try { hiddenHit = yamlHidingShape(hiddenSrc) } catch (e) { hiddenHit = '' }
  if (!hiddenHit) fail('L1 反隐藏自证失效：用锚点与别名藏内容的 YAML 没被 yamlHidingShape 查出来（这条判据没变红能力）')
  if (problems.length > before) return { leak: leak, fp: fp, ok: false }
  return { leak: leak, fp: fp, ok: true }
}

// ==================== 8. L2 机械注入（payload 从 JSON 夹具读；逐条断言 exit 1 且点名 id 与规则） ====================
// 锚点用「按 /implement 技能修复这个 bug」（全文唯一，落在 tpl.fix；用「## 收尾」会落到多条）
const L2_ANCHOR = '按 /implement 技能修复这个 bug'
const L2_PAYLOADS = JSON.parse(fs.readFileSync(PAYLOAD_FILE, 'utf8')).payloads || []
// #603：夹具文件 tests/prompt-gate-payloads.json 里 'backend-prompt' 一条钉的期望是「subIssue + R1」
//   （它的原意：把具体跟踪器命令注入后端声明面必须判红）。领导拍板之后 github 后端声明面允许 gh 命令，
//   R1 在这个面上不再判 —— 沿用旧期望这条 payload 会退出码 0，整个 L2 自检失效。
//   夹具文件按冻结纪律不许改，所以在门禁里把这一条的期望按新口径改写：注入的间接写法必须被 R8 抓住。
//   只有这一条需要改写，条数硬编码卡死（多改一条就算偷偷放宽判定）。
// #1292：期望改写表多一条 —— 'quote-break' 这条 payload 钉的期望是「求值失败」。
//   从前真源是源码字面量，注入一段带单引号的文本会把字符串截断 → 求值抛错 → 门禁红。
//   现在真源是 YAML：注入同一段文本后 YAML 仍然是合法的（单引号在正文里不算事），
//   于是它要靠判定层抓住 —— 期望改成「tpl.fix + R1」（注入的那段话里就有 gh issue edit）。
//   「坏文本必须当场判红、不许静默少扫」这条没有丢：YAML 写坏、键重复这两种情况由 L1 夹具自证里的
//   两条断言守着（解析必须抛错）。
const EXPECT_L2_EXPECT_OVERRIDE = 2
const L2_EXPECT_OVERRIDE = { 'backend-prompt': ['subIssue', 'R8'], 'quote-break': ['解析失败'] }
// #1292：注入改成「改对象再写回 YAML」。
//   为什么不再往源码文本里插字符串：真源已经是 YAML，往文本里插一段带引号、带换行的坏文本很容易
//   把 YAML 本身弄坏 —— 那样子进程红的是「YAML 解析失败」，而不是「被规则抓住」，红得不是地方。
//   改成在对象上改（改一条正文的某个位置 / 加一条条目 / 改 use 字段），再由 yaml 序列化器写成 YAML：
//   探针文件永远是合法 YAML，子进程红的原因一定是被判定层抓住。
// 三个注入函数都在注册表对象上改，改成功返回 null，改不动返回一句原因（由调用方判红，不抛异常）。
const injectBeforeAnchor = function (table, text) {
  const target = 'tpl.fix'
  const e = table[target]
  if (!e) return '找不到 ' + target + '（注入锚点失效）'
  const at = String(e.zh).indexOf(L2_ANCHOR)
  if (at < 0) return '锚点「' + L2_ANCHOR + '」在 ' + target + '.zh 里找不到（注入点失效）'
  e.zh = String(e.zh).slice(0, at) + String(text) + '\n' + String(e.zh).slice(at)
  return null
}
const injectNewEntry = function (table) {
  table['tpl.brandNew'] = { version: 1, placeholders: [], use: 'x', zh: '写回用 gh issue edit 573 --body-file x.md', en: 'same' }
  return null
}
const injectUseField = function (table, text) {
  // 这条 payload 的期望点名 mapExecute.use —— 从前是「源码里第一个 use 字段」，那一条正是 mapExecute。
  //   这里点名改 mapExecute 的 use，与夹具的期望对得上。
  const e = table['mapExecute']
  if (!e) return '找不到 mapExecute（注入锚点失效）'
  e.use = String(text)
  return null
}
/**
 * #1293：提示词真源（五份模板族 YAML + 语言清单）的摘要。
 * 用途：L2 机械注入只许改内存里的注册表对象、只许往临时目录写探针；跑完之后真源必须与跑之前一字不差。
 *   这条断言是「注入过程不污染真源」的验收（票面 #1293 验收⑥），防止将来有人图省事改成直接改 YAML 再还原。
 */
const promptSourceDigest = function () {
  const nodeCrypto = require('crypto')
  const files = PROMPT_TEMPLATE_YAML_RELS.concat(['config/languages.yaml']).slice().sort()
  return files.map(function (rel) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
    return rel + ':' + nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex')
  }).join('\n')
}
const runL2Injection = function () {
  const before = problems.length
  // #1293：先记真源摘要，收尾再比（见下面 finally 之后那一段）。
  const sourceDigestBefore = promptSourceDigest()
  check(L2_PAYLOADS.length >= 14, 'L2 夹具条数不足：' + L2_PAYLOADS.length + ' 条（期望 ≥ 14，不许删夹具）')
  // 期望改写表审计：条数卡死 + 每个键都必须在夹具里真实存在（防「偷偷多改几条期望」或写了不存在的 payload）
  check(Object.keys(L2_EXPECT_OVERRIDE).length === EXPECT_L2_EXPECT_OVERRIDE,
    'L2 期望改写表条数 ' + Object.keys(L2_EXPECT_OVERRIDE).length + '（期望硬编码 ' + EXPECT_L2_EXPECT_OVERRIDE + '：#603 改写 github 后端那一条，#1292 改写 quote-break 那一条 —— 真源换成 YAML 后，从前的「求值失败」对应「解析失败」）')
  Object.keys(L2_EXPECT_OVERRIDE).forEach(function (k) {
    if (!L2_PAYLOADS.some(function (p) { return p && p.n === k })) fail('L2 期望改写表引用了夹具里不存在的 payload：' + k)
  })
  let tmp = null
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-verify-prompts-'))
    // 注入的底稿是注册表本身（真源在 config/prompts/ 下的 YAML 里）。
    //   为什么不再往源码文本里插字符串：真源已经是 YAML，往文本里插一段带引号、带换行的坏文本很容易
    //   把 YAML 本身弄坏 —— 那样子进程红的是「YAML 解析失败」，而不是「被规则抓住」，红得不是地方。
    //   改成在对象上改（改一条正文的某个位置 / 加一条条目 / 改 use 字段），再由 yaml 序列化器写成 YAML：
    //   探针文件永远是合法 YAML，子进程红的原因一定是被判定层抓住。
    const baseTable = readRegistryTables().table
    const cloneTable = function (t) {
      const out = {}
      Object.keys(t).forEach(function (id) {
        const e = t[id] || {}
        out[id] = { version: e.version, placeholders: (e.placeholders || []).slice(), use: e.use, zh: e.zh, en: e.en }
      })
      return out
    }
    const backendSrc = fs.readFileSync(path.join(ROOT, 'src/tracker/rooms/github/index.ts'), 'utf8')
    L2_PAYLOADS.forEach(function (p) {
      let mutated = null
      let extraArgs = []
      const expectTokens = L2_EXPECT_OVERRIDE[p.n] || p.expect || []
      // 「求值失败」这一类期望：从前钉的是「源码里的引号把字符串截断 → 求值抛错」。
      //   现在真源是 YAML，同类危险是 YAML 语法坏掉 —— 这一类 payload 改成把裸文本塞进探针文件顶部，
      //   让解析层当场报错（期望相应改成「解析失败」）。判据没放宽：子进程照样必须退出 1 且 FAIL 行点名。
      const wantsParseFailure = expectTokens.some(function (tok) { return tok.indexOf('求值') >= 0 || tok.indexOf('解析') >= 0 })
      if (p.kind === 'before-anchor' || p.kind === 'new-entry' || p.kind === 'use-field') {
        const table = cloneTable(baseTable)
        const injectErr = p.kind === 'before-anchor' ? injectBeforeAnchor(table, String(p.text))
          : p.kind === 'new-entry' ? injectNewEntry(table)
          : injectUseField(table, String(p.text))
        if (injectErr) { fail('L2 payload「' + p.n + '」' + injectErr); return }
        const dumped = yamlLib.stringify(table)
        mutated = wantsParseFailure ? (String(p.text) + '\n' + dumped) : dumped
      } else if (p.kind === 'backend') {
        const bpath = path.join(tmp, 'github-index-probe.js')
        // #603：注入点从旧锚点（「输出有多行时，取以 package.json 结尾的那一行）」）挪到 subIssue 的第一句 gh api 调用处 ——
        //   旧锚点随两步写回一起撤掉了，不换锚点这条 payload 就是「注入空操作」。
        //   注入的内容是本票要消灭的间接写法（先解析插件目录，再调包内脚本）：github 面允许 gh 命令，但 R8 在 github 面照样判。
        const srcBefore = String(backendSrc)
        const injectAt = '建边用 deck_map_link'
        const injectedText = '先跑 dsh plugin --profile <配置名> exec node -e "console.log(require.resolve("dsh-mattpocock-skills-deck/package.json"))" 拿插件安装目录，再 ' + injectAt
        const mutatedBackend = srcBefore.replace(injectAt, injectedText)
        if (mutatedBackend === srcBefore) fail('L2 payload「' + p.n + '」注入锚点在新文本里找不到（注入成了空操作；锚点要跟着提示词一起改）')
        fs.writeFileSync(bpath, mutatedBackend)
        extraArgs = ['--backend-probe=' + bpath]
      }
      // 注入探针是 YAML 文件：真源是 YAML，探针也得是同一套格式，子进程才能用同一套解析器读它。
      const probeExt = '.yaml'
      const args = (mutated != null) ? [path.join(tmp, 'prompts-probe-' + p.n + probeExt)] : extraArgs
      if (mutated != null) fs.writeFileSync(args[0], mutated)
      if (mutated != null && process.env.DSH_VERIFY_PROMPTS_KEEP === '1') {
        const keepDir = path.join(ROOT, '.scratch', 'l2probe')
        fs.mkdirSync(keepDir, { recursive: true })
        const keepPath = path.join(keepDir, 'kept-' + p.n + probeExt)
        fs.writeFileSync(keepPath, mutated)
        console.log('    · 探针副本留在 ' + keepPath)
      }
      let out = ''
      let code = 0
      try {
        // 子进程不会继承父进程的装载钩子（见 AGENTS.md「链上脚本 spawn 出去的子进程不带钩子」）。
        // 本文件顶部按 .js 说明符加载的共用求值入口已经改名为 .ts，所以这里必须显式带上钩子；
        // 不带的话子进程一启动就报 MODULE_NOT_FOUND，下面按 FAIL 行做的断言会全部失真。
        out = childProcess.execFileSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF].concat(args), {
          cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { DSH_VERIFY_PROMPTS_CHILD: '1' }), stdio: ['ignore', 'pipe', 'pipe'],
        })
        code = 0
      } catch (e) {
        code = (e && typeof e.status === 'number') ? e.status : 1
        out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
      }
      if (code !== 1) fail('L2 payload「' + p.n + '」注入后退出码 ' + code + '（期望 1）：' + out.split('\n').filter(function (l) { return l.indexOf('FAIL') === 0 }).slice(0, 2).join(' | '))
      else {
        // expect 只在 FAIL 行里找（横幅里就有 R1/R7 这些字样，全输出里找等于没判）
        const failText = out.split(/\r?\n/).filter(function (l) { return /^\s*FAIL\b/.test(l) }).join('\n')
        if (failText === '') fail('L2 payload「' + p.n + '」退出 1 但输出无 FAIL 行')
        else {
          const missing = expectTokens.filter(function (tok) { return failText.indexOf(tok) < 0 })
          if (missing.length) fail('L2 payload「' + p.n + '」FAIL 行里未点名 ' + missing.join(' / ') + '（红得不对；只在 FAIL 行里找，不看横幅）')
        }
      }
      if (process.env.DSH_VERIFY_PROMPTS_VERBOSE === '1') {
        const first = (out.split('\n').filter(function (l) { return l.indexOf('FAIL') >= 0 })[0] || '').trim()
        console.log('    L2 ' + (code === 1 ? 'RED ' : 'LEAK') + ' ' + p.n + '（期望点名 ' + (L2_EXPECT_OVERRIDE[p.n] || p.expect || []).join('+') + '）' + (first ? '  ' + first.replace(/^FAIL \S+ /, 'FAIL ').slice(0, 130) : ''))
      }
    })
  } finally {
    try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
  }
  // #1293：真源跑完必须一字不差 —— 注入只许改内存对象、只许写临时目录。
  if (promptSourceDigest() !== sourceDigestBefore) {
    fail('#1293 L2 机械注入污染了提示词真源：config/prompts/ 下的五份 YAML 或 config/languages.yaml 跑完与跑前不一致（注入只许改内存对象、写临时目录）')
  }
  return problems.length - before
}

// 2026-10-17（#1239）：门禁清单里 verify-progress 已改名成 .ts，本文件里那句 isGatePlanned 跟着改，
//   自锁摘要按新内容重算（摘要住在 LOCK 区段里，区段算自摘要时整段挖空，改它不影响自摘要）。
// ==================== 8b. 夹具自锁（sha256） ====================
// 只给三个文件上锁：豁免登记表、L2 payload 夹具、门禁自身。改任意一个都必须同步改这里的摘要，
// 否则门禁红 —— 这是「把 14 条 payload 全换成同一条 trivial 载荷仍然全绿」那条路的封堵点。
// 摘要按「行尾统一成 LF」计算，避免 Windows 检出成 CRLF 后误红。
const crypto = require('crypto')
const LOCK_BEGIN = '// ---- LOCK-BEGIN ----'
const LOCK_END = '// ---- LOCK-END ----'
const sha256Of = function (buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
const readNormalized = function (p) { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }
const selfDigest = function () {
  // 自哈希：把 LOCK 区段整段挖空后再算，所以改 LOCK 里的摘要不会改变自己的摘要
  const src = readNormalized(SELF)
  const a = src.indexOf('\n' + LOCK_BEGIN + '\n')
  const b = src.indexOf('\n' + LOCK_END)
  if (a < 0 || b < 0) return 'LOCK-MARKER-MISSING'
  const blanked = src.slice(0, a) + '\n' + LOCK_BEGIN + '\n' + '\n' + LOCK_END + src.slice(b + 1 + LOCK_END.length)
  return sha256Of(Buffer.from(blanked, 'utf8'))
}
// ---- LOCK-BEGIN ----
// #664：豁免登记表删掉 repoRemoteFix 与 noGhPrompt 两条（两段长文按新流程退役），摘要跟着重算；
//   本文件自己也改了（版本底线、三面计数、受保护清单、必须受判清单、豁免名单），自摘要一并更新。
// #669 第 6 件：注册表新增 switchAlign（切换后端后对齐那条），条目数 20 → 21，受保护清单同步加一条，
//   自摘要跟着重算。
// #684：注册表新增 healthCheck（「体检」总纲），条目数 21 → 22；三个后端各加一条 healthCheck 科目，
//   键数 6/5/3 → 7/6/4、字面量 40/10/6 → 42/12/8，受保护清单同步加四条，自摘要跟着重算。
// #716：三个后端各加一条 commandVocabulary（自己的命令行名与站点名字），github 另加一条 cliInstall
//   （装 CLI 的原话从共享清单挪回后端声明），键数 7/6/4 → 9/7/5、字面量 42/12/8 → 46/14/9；
//   github 面那两条 rule 豁免（ensureLabels / repoAccessFix）还清、从豁免登记表撤掉，条数 10 → 8；
//   github 的 subIssue 与 mapInspect 渲染断言由「必须 gh 直连」改成「必须走 deck_* 工具」；
//   豁免登记表与自摘要一并重算。
// mapExecute v11：工具节改优先式（不断后路：deck 工具出问题仍可走别的路），
//   版本底线 10 → 11，自摘要一并重算。
// mapExecute v10：去标识头（身份由首行 /wayfinder+链接承载）+ 工具节 + 收尾新说法，占位符清零，
//   版本底线 9 → 10，断言同步改，自摘要一并重算。
// #771：注册表新增 tpl.takeover 与 tpl.supplement（接手/补充），条目数 21 → 23，BODY_IDS 与 FIX_IDS 各 10 → 12，
//   V_MIN 各加一条 v1，受保护清单同步加两条，自摘要跟着重算。
// #791：初始化那条（setupRun）撤掉末尾的工具章节，本文件的全量断言（#779 那一条）给它开一个写明理由的
//   例外并配反向断言；注册表条目数与受保护清单都没变，只有这一处断言改动，自摘要跟着重算。
// #792：工具节的适用范围按第一性原理定稿 —— 只给会读写票 / 地图的 15 条，另外 8 条一律不带；上面那条例外
//   写法升级成 TOOL_SECTION_IDS / TOOL_SECTION_ABSENT_IDS 两张表（合起来必须覆盖注册表全部 23 条），
//   门禁正反两向断言并钉住两张表的条数，自摘要跟着重算。
// #808：tpl.discuss 收尾再补一条（/to-spec 后对抗式审查再关单），中英各一行断言，自摘要跟着重算。
// #879：逐面归零门禁退役（上游技能文档一字不动，人定案），本文件两处注释同步改说法，自摘要跟着重算。
// #900：tpl.fix 阶段闸门整节删除，只在读现状留一句兜底，版本底线 7 → 11 并补内容断言，自摘要跟着重算。
// #989：mapExecute 恢复纯寻路版 v12 文字（五节单票推进），断言同步回到五节版，自摘要跟着重算。
// #1095：搬家跟随（后端路径改到 src/tracker/rooms），自摘要一并重算。
// #1110：GitLab 房入口转成 TypeScript 后，本文件三份后端源码的路径统一读 index.ts，自摘要一并重算。
// #1167：共用求值入口 tests/lib/eval-probe.js 转成 TypeScript 后，L2 注入那节的子进程要显式带上装载钩子
//   （子进程不继承父进程的钩子），否则子进程一启动就找不到那个按 .js 说明符写的模块，自摘要一并重算。
// #1205：tpl.discuss 收尾再补一条（同 map 子票要知晓规格单），中英各一行断言并钉住行序（挂图行之后、#808 审查行之前），自摘要跟着重算。
// #1212：执行/讨论/诊断/接手/补充五条加调查节（建议先查后问），中英各两行断言，版本底线同步抬到 13/14/14/4/3，自摘要跟着重算。
// #1209：prompts 真源从手写 .js 转成 .ts（旁边那份同名 .js 变成 pixel-ts 产物）。本文件因此改了四处读法：
//   ① 取源改走共用入口 tests/lib/source-text.ts 的 sourceText（按 .js 路径直接读会读到产物，正则与文本锚点当场失效）；
//   ② 求值前把类型写法摘掉（声明上的类型标注、收尾的 satisfies），再按构建那份唯一口径整段转译成 JavaScript；
//   ③ 单行正则 ENTRY_RE 的引号改成反向引用，真源的单引号与产物的双引号两种排版都认，
//      但「六个字段必须同一种引号、一条一行」这两条硬口径没放松；
//   ④ L2 注入探针的扩展名跟着真源走（.ts），内容锚点认 `.ts` 的写法（`const PROMPTS: X = {` 与 `} satisfies X`）。
//   夹具文件一个字没动，只有本文件改了，自摘要跟着重算。
// #1209：ENTRY_RE 与 verify-prompt-newlines.ts 的孪生正则同步改成定界符感知（产物双引号排版含 ' 原文时不再静默少扫），自摘要跟着重算。
//   （#1293 起 verify-prompt-newlines.ts 已整条并入本文件第 4c 节，上面这句里的文件名只作历史记录看。）
// #1125：自注册改问规划函数（不再读 package.json 长串），自摘要跟着重算。
// #1252：脚本工具层转 TypeScript，本文件十一处跟进（两处 require、L2 子进程钩子、SHIPPED_EXPECT、
//   build.mts 读取、SHIPPED 提取正则放宽容 `: string[]` 注解、四处修法消息、scanScriptRefs 与
//   RE_INDIRECT 正则放宽容 .mts、R8 名单加 .mts 变体、两处注释）；T24–T61 向量故意保留 .mjs
//   旧拼写（删文件后仍算违规，覆盖不断），自摘要跟着重算。
// #1269：12 条会话收尾类提示词（票级 7 / map 级 2 / 新建 2 / 沉淀 1）各加一条 /retro 提醒 ——
//   会话任务全部完成时提醒用户执行一次 /retro 复盘当前工作区环境，是否执行由用户决定。
//   中英各一句、按名单逐条判在场（多一条少一条都红），版本底线同步抬高，自摘要跟着重算。
// #1270：tpl.execute 引导句改成先按票面判断 —— 已写清的代码实施任务按 /implement 技能直接实施，
//   其余任务按 wayfinder 技能规则推进；tpl.fix 括注从 wayfinder 改成 implement（首行本来就是
//   /implement，原来那句自相矛盾）。中英各补正向断言，并各加一条反向断言钉住旧措辞不再出现；
//   版本底线 tpl.execute 14 → 15、tpl.fix 12 → 13，自摘要跟着重算。
// #1301 批C：配置真源（config.js → config.ts）与几处 completePrompt 调用点视图的取源，
//   从「按已删的 .js 产物路径直接读」改成共用入口 tests/lib/source-text.ts 的 sourceText，自摘要跟着重算。
// #1286：地图详情页底部那处 completePrompt 调用随三态动作组搬到 DetailActionBar.ts，调用点名单跟着搬家
//   （扫描面不许静默少扫：搬走的那处仍要被数），并把 container-view.ts 里新出现的那处也纳入名单；
//   本文件内容变了，自摘要跟着重算。
// #1292：提示词真源从源码字面量搬到 config/prompts/ 下的五份族 YAML（三处片段按注入时机住在对应族里），
//   生成器 scripts/generate-prompt-config.mts 按 YAML 写出 src/client/kernel/prompt-data.ts。本文件因此改了五处：
//   ① 注册表解析层换真源：不再从 prompts.ts 里抠 `const PROMPTS = {` 那段字面量，改读五份族 YAML，
//      键清单与字段校验走生成器与门禁共用的 scripts/lib/prompt-config.mts（两边各写一份会悄悄走岔）；
//   ② 求值层从前自己求 prompts.ts 拿到 PROMPTS，现在求值那两片客户端源码（prompts.ts / prompts-backend.ts）
//      时把 PROMPT_TEMPLATE_DATA 与 PROMPT_FRAGMENT_DATA 注入进作用域 —— 与闭包里的拼装顺序同形；
//   ③ S6 那面的注册表外文本来源换成「三处片段（从族 YAML 取）+ 客户端那两片源码的字符串字面量」；
//   ④ L2 机械注入改成在注册表对象上改（改正文 / 加条目 / 加 use 字段）再用 yaml 库写探针文件，
//      从前那种「往源码里插一行字面量」的注入方式在 YAML 世界里没有对应物；
//      期望也在几处走上「解析失败」而不是「求值失败」——判据没放宽，仍是子进程退出 1 且 FAIL 行点名；
//   ⑤ 跨门禁一致性改比 YAML 的顶层键：族文件里模板与片段混在同层，扣掉登记过的片段 id 再双向比。
//   判据强度不降：44 条受保护 id、use 逐条过 judge、字数与占位符一一对应、产物逐字段与真源相等，一条没松。
//   本文件与夹具都没被掏空，自摘要跟着重算。
// #1292 收尾：promptLang 补两条现实里会遇到的读取失败 —— 语言快照还没回来（getSnapshot 返回 null）
//   或服务根本没装 getSnapshot 时，必须按清单的 default 走，不能掉进写死的 zh；LANG_CASES 相应加三条
//   （快照返回 null / 没有 getSnapshot 方法 / getSnapshot 抛异常，清单都写 default: en），自摘要跟着重算。
// #1293：提示词门禁收口 ——
//   ① tests/verify-prompt-newlines.ts 整条退场（文件删除），它的「正文不许有字面 \n」判据并进第 4c 节，
//      扫描面一处不少（五份 YAML / 两份产物 / src/host 的 *_PROMPT / src/tracker/rooms 的 zh/en 字面量），
//      白名单仍钉死为空；② auditRegistryShape 与 OBJECT_PROTO_KEYS 退场（YAML 数据没有 JS 求值面），
//      锚点/别名判据由 yamlHidingShape 在 S1 逐份 YAML 判（以前把五份拼起来 parseDocument，其实一直空转）；
//   ③ 新增四条 YAML 化产物断言（use 不进产物 / 裸 \n / 每种语言都有正文 / 占位符逐语言一一对应）；
//   ④ L2 机械注入加「跑完真源一字不差」自检。判定强度对照表见 docs/design/1293-prompt-gate-strength.md。
//   本文件内容变了，自摘要跟着重算。
// #1274 收口后：探索地图「完成」提示词补「先判断」节与当前状态分支（已交过棒的步骤跳过、核对不通过、两种都有）——
//   不需要接着做时不生成规格、也不拆任何 ticket。版本底线 complete 12 → 13，自摘要跟着重算。
// #1212 恢复：诊断与接手的调查节、诊断边界、收尾两条回到模板（#1281 删过头），
//   V_MIN 抬到 tpl.diagnose 16 / tpl.takeover 7，两节断言补回，自摘要跟着重算。
// 2026-10-21：登录引导单源化 —— 删掉注册表里的 ghAuthLogin 模板（用户可见的那句只由 GitHub 后端声明，
//   YAML 那份在全部用户可见路径上被它遮住），EXPECT_REGISTRY_ENTRIES 28 → 27，受保护清单随之少一条，
//   豁免表撤掉 registry#ghAuthLogin 这条 scope，MUST_JUDGE 与 TOOL_SECTION_ABSENT_IDS 各少一条。
//   豁免登记表与门禁自身的摘要一并重算（payload 夹具没动）。
// #1407：20 个注入模板各加一行 suggest_next_steps 提醒、删掉 17 处 /retro 提醒行 ——
//   版本底线整体抬高；原来「17 条名单逐条判在场」的 #1269 块改成「17 条逐条判缺席 + 全量兜底」；
//   本文件内容变了，自摘要跟着重算。
// #1514：Markdown 房间删掉 wayfinderMapBuild 提示词（「执行 wayfinder 构造地图」按钮不再成立），
//   受保护清单与 markdown 两处计数跟着改，自摘要按新内容重算（豁免登记表与 payload 夹具没动）。
// #1461：newBugWayfinder v14 → v15 —— 删「## 查历史」，插「## 查重」「## 查重记录」两节
//   （两次全扫参数、最多 3 张候选交报告人确认、四类出口、查重记录四行与建单前置条件），中英文对应；
//   版本底线 14 → 15（规格 #1460 写 12→13，但基线已是 v14，只许升不许降）。
//   config/prompts/ticket-creation.yaml 与 tests/verify-bug-entry.ts 都改了；本文件只动版本底线与自摘要。
// #1190：两后端加通用键别名（github cliLogin / gitlab cliInstall+cliLogin，与旧键同文），三面计数跟着改
//   （键数 8/6 → 9/8、字面量 50/12 → 52/16；markdown 不动）；新键走默认判定且通过，不加豁免，
//   受保护清单与必须受判清单都不动，自摘要按新内容重算（豁免登记表与 payload 夹具没动）。
// #1258：原型 v14 → v15，收尾前插「定版与移交」节 —— 哪一版（产物位置与区分这一版的提交号/分支/文件名）、
//   什么算数（已点头的界面与状态逐条列出、没选中的备选写不算数）、照做标准与复核人（给下游规格与实施票的移交要求）。
//   版本底线 tpl.prototype 14 → 15，中英各五条断言（四条内容 + 一条先后顺序）加在四条公共骨架表之后；落地清单见票 #1258。
//   同步改了 tests/verify-1407-next-steps-reminders.ts 的版本下限；豁免登记表与 payload 夹具没动，自摘要按新内容重算。
// 2026-10-28：「## 调查（建议先查后问）」那四条汇总成公共小节 investigation（10 个模板只写标记、改一处就全改），
//   模板里的提问句改成只要求说明已查阅范围；三处英文标题断言、V_MIN 版本底线与产物跟着改，自摘要按新内容重算。
// 2026-10-29：mapInspect 英文「修复」第一步改成与中文同义（读回正文、`## Destination` 一节必须保留，
//   删掉「先把正文落到绝对路径文件」那一步）；V_MIN mapInspect 12 → 13，自摘要按新内容重算。
// 2026-10-29：三条 map 子票动作模板（讨论 / 执行 / 研究）的同一段正文收成公共小节 mapTicketAdvance、
//   setupRun 与 switchAlign 的初始化正文收成公共小节 repoBootstrap（模板正文只写标记，读取时逐层展开）；
//   对应五条模板升版、V_MIN 同步抬高，自摘要按新内容重算。
const LOCK = {
  'tests/prompt-gate-exempt.json': '65e3acb4c066f83a74996dda33196bb19cce7d0421ce1a9a9dc6d87187c53bcd',
  'tests/prompt-gate-payloads.json': '0d5a71daafeb4a3bb1052a614f77ad6778a72fbe50801e146e518e1e7c273468',
  'tests/verify-prompts.ts': 'f17e7ce254c6262e1ac524ea68db8045b5c6b6dfd9afc587f78594fef5f0e919',
}
// ---- LOCK-END ----

// ==================== 9. 跑 ====================
const argv = process.argv.slice(2)
const backendProbe = (argv.filter(function (a) { return a.indexOf('--backend-probe=') === 0 })[0] || '').slice('--backend-probe='.length)
const fileArgs = argv.filter(function (a) { return a.indexOf('--') !== 0 })
const singleFileMode = fileArgs.length > 0
const stepOk = function (before) { return problems.length === before }
// 取注册表真源：单文件模式（L2 注入的子进程）读点名的那一份 YAML；平时读 config/prompts/ 下的五份 YAML。
//   #1292：真源从「源码里的字面量」搬到了 YAML —— 下面几处判据（条数、跨门禁一致性、L2 注入的锚点）随之改读 YAML。
//   定义在这里而不是 S1 那一节：上面的 L2 注入也要用同一份取法，两处不能各读各的。
const s1Rel = 'config/prompts/（五份模板族 YAML）'
const readS1Source = function () {
  if (singleFileMode) return fs.readFileSync(fileArgs[0], 'utf8')
  return PROMPT_TEMPLATE_YAML_RELS.map(function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }).join('\n')
}
/** 单文件模式之外的注册表：按共享读取核读 config/prompts/ 下的五份 YAML（键清单与字段校验都在那一处）。 */
const readRegistryTables = function () {
  const data = promptConfig.readPromptConfig(ROOT)
  const table = {}
  Object.keys(data.templates).forEach(function (fam) {
    const t = data.templates[fam] || {}
    Object.keys(t).forEach(function (id) { table[id] = t[id] })
  })
  return { table: table, fragments: data.fragments, languages: data.languages }
}

console.log('P1: prompt 注册表契约（#573 五面扫描 + 外部豁免登记 + 归一化 + #603 判据 R1–R8）')
// 子进程模式（L2 注入用）：必须带单文件参数或 --backend-probe，否则等于用环境变量静默关掉整层自检
if (IS_CHILD) {
  console.log('  · 子进程模式（DSH_VERIFY_PROMPTS_CHILD=1）：L1/L2/L3 与自注册自检不跑，只跑被注入的那一面')
  if (!singleFileMode && !backendProbe) {
    fail('子进程模式必须带单文件参数（或 --backend-probe），否则等于用 DSH_VERIFY_PROMPTS_CHILD=1 静默关掉整层自检')
  }
}
// 夹具自锁：三个文件的 sha256 必须与登记摘要一致（改夹具 / 改门禁都要同步改摘要）
if (!IS_CHILD) {
  const pLock = problems.length
  Object.keys(LOCK).forEach(function (rel) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { fail('自锁文件缺失：' + rel); return }
    const got = rel === 'tests/verify-prompts.ts' ? selfDigest() : sha256Of(Buffer.from(readNormalized(p), 'utf8'))
    if (got !== LOCK[rel]) {
      fail('自锁摘要不匹配 ' + rel + '：实得 ' + got + '，登记 ' + LOCK[rel] +
        '\n     修法：夹具或门禁改了就要同步更新 tests/verify-prompts.ts 里的 LOCK 摘要（这是防「把夹具掏空」的锁）')
    }
  })
  if (stepOk(pLock)) console.log('  PASS 夹具自锁（豁免登记表 / payload 夹具 / 门禁自身，sha256 三个都对上）')
}

// —— S1 + S5 ——
const s1Path = singleFileMode ? fileArgs[0] : path.join(ROOT, 'config', 'prompts')
const s1Label = singleFileMode ? fileArgs[0] : s1Rel
let reg = null
let s1Ids = []
let fragments = {}
// #1292：语言清单（config/languages.yaml）也要跟着注册表一起读出来 —— promptLang 的判定面要用真数据。
let languagesData = null
try {
  // 单文件模式：那份 YAML 就是探针（注入过坏文本的临时副本）；平时读 config/prompts/ 下的五份 YAML。
  const s1Src = readS1Source()
  if (singleFileMode) {
    reg = parseRegistryYamlText(s1Src)
  } else {
    const tables = readRegistryTables()
    reg = registryFromEntries(tables.table)
    fragments = tables.fragments
    languagesData = tables.languages
  }
  s1Ids = Object.keys(reg)
  // #1293：auditRegistryShape 退场后，仍适用的锚点/别名判据在这里逐份文件判。
  //   单文件模式判探针那一份；平时判 config/prompts/ 下五份 —— 以前 auditRegistryShape 把五份拼起来
  //   交给 parseDocument，遇到多文档会抛错又被 catch 吞掉，那条判据在完整模式下其实没有生效过；
  //   现在逐份判，读不出语法树也算红，不许静默跳过。
  if (singleFileMode) {
    const hiding = yamlHidingShape(s1Src)
    if (hiding) fail('S1 ' + s1Label + ' 含' + hiding + '（可以把内容藏起来再别处引用，条目会不声不响地少掉，禁止）')
  } else {
    promptYamlHidingHits().forEach(function (m) { fail('S1 ' + m) })
  }
} catch (e) {
  fail('FAIL S1 ' + s1Label + ' 解析失败（YAML 写坏了或形状不对）：' + e.message + '\n' +
    '     修法：每条模板必须是一个键，底下写 version / placeholders / use / zh / en；YAML 坏掉即判红，不许静默少扫')
}
if (reg) {
  const pS1 = problems.length
  check(s1Ids.length === EXPECT_REGISTRY_ENTRIES, 'S1 注册表条目数 ' + s1Ids.length + '（期望 ' + EXPECT_REGISTRY_ENTRIES + '）——解析层不许静默少扫')
  // 跨门禁一致性：YAML 文本里的顶层键（按行形状认）与解析出来的 id 必须逐条相等。
  //   为什么要这一条：解析器有可能因为某种写法把一条模板整个吞掉（从前是「拆行 / 换引号」让单行正则少扫一条）。
  //   文本扫描与解析各走各的路，两边对不上就说明有一边少扫了 —— 判红，不许静默放过。
  //   族文件里模板与片段混着住，所以文本层的键集合 = 模板 id + 片段 id：模板那条照旧双向比，
  //   片段那条要求三处都真的以顶层键出现（少一处就判红），但不要求它们出现在注册表里（它们不在注册表里）。
  const textIds = yamlTopLevelIds(readS1Source())
  const textDiff = s1Ids.filter(function (x) { return textIds.indexOf(x) < 0 })
  if (textDiff.length) fail('跨门禁不一致：YAML 文本里有 ' + textDiff.join(', ') + '，解析层却没解析出来（解析器把条目吞了）')
  const extraTextIds = textIds.filter(function (x) { return s1Ids.indexOf(x) < 0 && !FRAGMENT_ID_SET[x] })
  if (extraTextIds.length) fail('跨门禁不一致：解析层多出 ' + extraTextIds.join(', ') + '（YAML 文本里没有这些键）')
  const missingFragIds = Object.keys(FRAGMENT_ID_SET).filter(function (x) { return textIds.indexOf(x) < 0 })
  if (missingFragIds.length) fail('跨门禁不一致：三处片段的顶层键在族文件文本里找不到 ' + missingFragIds.join(', ') + '（片段要住在对应族的 YAML 里）')
  // 后端 subIssue 声明值（S5 渲染面用）
  const subIssueValues = {}
  BACKENDS.forEach(function (b) {
    const v = backendSubIssueValues(fs.readFileSync(backendPath(b, backendProbe), 'utf8'))
    if (v.zh != null) subIssueValues[b + '.zh'] = v.zh
    if (v.en != null) subIssueValues[b + '.en'] = v.en
  })
  // #595：注册表之外还有几处会进客户端产物的文本来源，一并扫（以前完全没扫：塞进去就全绿）
  // #1292：这两处来源换成了「片段 YAML + 客户端那两片源码」。
  const nonRegLits = fragmentTexts(fragments).concat(
    scanAllLiterals(clientSourceText()).map(function (l) { return { id: l.key, text: l.text } })
      .filter(function (l) { return String(l.text).trim() !== '' })
  )
  const nonReg = collectNonRegistrySource(s1Label, nonRegLits)
  nonReg.problems.forEach(function (m) { fail(m) })
  surfaceReport.S6 = nonReg.literals
  if (nonReg.literals < 4) fail('S6 ' + s1Label + ' 只扫到 ' + nonReg.literals + ' 段文本（片段 YAML 与客户端源码里的字面量没被扫到，扫描面会静默少扫）')
  const cfgRel = 'src/client/kernel/config.js'
  // 2026-10-19（#1301 批C）：src/client 下同名 .js 产物这一阶段已经删掉，按 .js 路径直接 fs.readFileSync 会 ENOENT；
  //   配置真源住在 config.ts 里，取源改走共用入口的 sourceText（问 .js 时同名 .ts 优先），下面扫描的面不变。
  const cfgScan = collectConfigSource(cfgRel, sourceText(cfgRel))
  cfgScan.problems.forEach(function (m) { fail(m) })
  surfaceReport.S7 = cfgScan.literals
  if (cfgScan.literals < 1) fail('S7 ' + cfgRel + ' 扫到 0 个字面量（TPL_DEFAULT 默认模板没被扫到，扫描面会静默少扫）')
  // 兜底 wiring 不再硬抄常量：从片段 YAML 里那份 newWayfinderWiring 取（少一处会漂移的第二份字面量）
  // #1292：它从前是源码里的一个常量对象，现在住在 config/prompts/ticket-creation.yaml（按注入时机归族）—— 真源换了，取法跟着换。
  const wiring = (function () {
    try {
      const frags = singleFileMode ? promptConfig.readPromptConfig(ROOT).fragments : fragments
      const fr = frags ? frags['newWayfinderWiring'] : null
      return (fr && typeof fr === 'object') ? fr : null
    } catch (e) { return null }
  })()
  if (!wiring) fail('取不到 NEW_WAYFINDER_DEFAULT_WIRING（兜底子议题关联文案无源可取；S5 渲染面的兜底值不许在门禁里硬抄）')
  else {
    if (wiring.zh == null || wiring.en == null) fail('NEW_WAYFINDER_DEFAULT_WIRING 缺 zh 或 en（兜底文案必须双语齐）')
    if (wiring.zh != null) subIssueValues['default.zh'] = String(wiring.zh)
    if (wiring.en != null) subIssueValues['default.en'] = String(wiring.en)
  }
  const s1 = collectRegistry(reg, 'S1 ' + s1Label, { subIssueValues: subIssueValues }, EXEMPT)
  s1.problems.forEach(function (m) { fail(m) })
  surfaceReport.S1 = s1Ids.length
  surfaceReport.S5 = s1.rendered
  // 结构契约（沿用既有断言，陈旧两组已按现状修正）
  // #1292：src 传的是客户端那两片源码的文本（注册表已搬进 YAML，那几条「引用不存在的 prompt id」与
  //   「旧字典引用残留」的判据要看的是调用侧的源码，不是 YAML）。
  contractChecks(reg, clientSourceText())
  // —— #1293 四条 YAML 化产物断言（use 不进产物 / 正文不许有字面 \n / 每种语言都有正文 / 占位符逐语言一一对应）——
  runYamlProductAssertions()
  // 后端注入链的另一半（#603 定的是「模板里只有 {subIssue} 占位符，真正的关联步骤写在 github 后端的
  //   prompts.subIssue 里，经 {subIssue} 渲染时填空」）。#716 把那些事搬进了契约层的 deck_* 工具，
  //   所以这里改钉「工具写法」而不是「gh 直连」——同一件事的两种实现，后者已被本票取代：
  //   ① 建边走 deck_map_link（父子边 parentKey、阻塞边 blockedBy）；
  //   ② 建完读回核对走 deck_map_snapshot；
  //   ③ 一个裸跟踪器命令都不许再出现（这里直断本仓库自己的后端声明面；逐面归零那道全仓门禁 #879 已按人定案退役——上游技能文档一字不动，不再量它）。
  ;['zh', 'en'].forEach(function (lang) {
    const t = String(subIssueValues['github.' + lang] || '')
    const where = '#716 github 后端 prompts.subIssue.' + lang
    if (!t) { fail(where + ' 取不到声明值（后端没声明这一条）'); return }
    if (t.indexOf('deck_map_link') < 0) fail(where + ' 缺 deck_map_link（建边要交给工具，不再教人敲命令）')
    if (t.indexOf('parentKey') < 0) fail(where + ' 缺 parentKey（父子边要传的参数名）')
    if (t.indexOf('blockedBy') < 0) fail(where + ' 缺 blockedBy（阻塞边要传的参数名）')
    if (t.indexOf('deck_map_snapshot') < 0) fail(where + ' 缺 deck_map_snapshot（建完要读回地图核对张数）')
    if (/gh\s+api|sub_issues|sub_issue_id|--jq|dependencies\/blocked_by/.test(t)) fail(where + ' 残留裸跟踪器命令（#716 起建边与校验都搬进工具，文案里不该再出现命令）')
    // R8：这一条本身不许再出现「先解析插件目录再调脚本」的间接写法（判定层也判，这里直断一次，失败信息更直白）
    const indirect = RE_INDIRECT.exec(t)
    if (indirect) fail(where + ' 残留间接写法「' + indirect[0] + '」（提示词一个包内脚本都不许引用）')
  })
  // #603：渲染面 + 名实一致（提示词一个脚本都不许引用；发布包里仍带那两条脚本当可选工具）
  const p603 = problems.length
  try {
    const FIX_IDS = ['mapExecute', 'complete', 'fixate', 'tpl.diagnose', 'tpl.fix', 'tpl.discuss', 'tpl.research', 'tpl.prototype', 'tpl.takeover', 'tpl.supplement', 'tpl.execute', 'mapInspect']
    // #595 核心验收：把 12 个条目按「真渲染函数 + 后端声明文本」渲染出来再断言（不再断言源码字面量）
    // #1292：渲染入口（promptTextFor / completePrompt）搬到了 kernel/prompts-backend.ts，与 prompts.ts 合成一段求值；
    //   提示词数据由参数注入（PROMPT_TEMPLATE_DATA / PROMPT_FRAGMENT_DATA），值就是从 YAML 读出来的这一份。
    evalPromptHelpers.prime(transpileClientSources(clientSourceText()), { templates: reg, fragments: fragments, languages: languagesData })
    // #1292：语言清单的判定面 —— promptLang 落到哪一门，由 config/languages.yaml 的清单与回退链决定。
    //   这里用真清单 + 几份小清单把几条规矩逐条钉死（口径写在 prompts.ts 的 promptLang 注释里）：
    //   主标签匹配（en-US → en）、清单里没有的语言退到 default、列了但正文没带这门语言时沿回退链往下退、
    //   链绕回自己时不死循环、清单为空时退回 zh；语言快照本身读不到（返回 null / 没装方法 / 抛异常）时
    //   也必须按清单的 default 走，不能掉进写死的兜底。
    const pLang = problems.length
    const LANG_CASES = [
      [languagesData || FALLBACK_LANGUAGES, 'en', 'en', '语言快照 en → en'],
      [languagesData || FALLBACK_LANGUAGES, 'en-US', 'en', '语言快照 en-US 按主标签匹配到 en'],
      [languagesData || FALLBACK_LANGUAGES, 'zh', 'zh', '语言快照 zh → zh'],
      [languagesData || FALLBACK_LANGUAGES, 'ja', 'zh', '清单里没有的语言（ja）退到缺省语言 zh'],
      [{ default: 'en', languages: { en: { fallback: [] } } }, 'zh', 'en', '清单只列了 en 时，zh 快照退到缺省 en（回退链终点是 en）'],
      [{ default: 'ja', languages: { ja: { fallback: ['en'] }, en: { fallback: ['zh'] }, zh: { fallback: [] } } }, 'ja-JP', 'en', '列了 ja 但正文没带 ja 时沿回退链退到第一门有正文的 en'],
      [{ default: 'ja', languages: { ja: { fallback: ['zh'] }, zh: { fallback: [] } } }, 'ja', 'zh', '回退链多跳：ja → zh 一路退到有正文的 zh'],
      [{ default: 'zh', languages: { zh: { fallback: [] }, ja: { fallback: ['ja'] } } }, 'ja', 'zh', '链绕回自己时不死循环，退回缺省语言'],
      [{ default: 'zh', languages: {} }, 'en', 'zh', '清单为空时退回 zh（不让空数据把整段渲染打空）'],
      [{ default: 'en', languages: { en: { fallback: [] } } }, 'zh', 'en', '快照还没回来（getSnapshot 返回 null）时按缺省 en，不掉进写死的 zh', 'null'],
      [{ default: 'en', languages: { en: { fallback: [] } } }, 'zh', 'en', '语言服务没装 getSnapshot 方法时按缺省 en', 'missing'],
      [{ default: 'en', languages: { en: { fallback: [] } } }, 'zh', 'en', 'getSnapshot 自己抛异常时按缺省 en', 'throw'],
    ]
    LANG_CASES.forEach(function (c) {
      const got = evalPromptHelpers.promptLangForTest(c[1], c[0], c[4])
      if (got !== c[2]) fail('#1292 promptLang(' + JSON.stringify(c[1]) + ') 落到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(c[2]) + '（' + c[3] + '）')
    })
    if (stepOk(pLang)) console.log('  PASS 语言清单判定（' + LANG_CASES.length + ' 条：主标签匹配 / 缺省回落 / 回退链多跳 / 自指不打转 / 空清单 / 快照读不到）')
    const backendDecls = {}
    BACKENDS.forEach(function (b) {
      const bsrc = fs.readFileSync(backendPath(b, backendProbe), 'utf8')
      backendDecls[b] = { subIssue: backendPromptValues(bsrc, 'subIssue') }
    })
    const renderOf = function (b, id, lang) {
      const st = { selection: { backendId: b }, backendModules: [{ id: b, prompts: backendDecls[b] }] }
      // 占位符给全（含 complete 的 closed/total）：这样「渲染后不许残留 {xxx}」才是有效断言 ——
      //   占位符给不全就必然残留，断言会变成永远红；给全了还残留，才是真的渲染入口漏填。
      const params = { n: '7', title: 'T', url: 'U', repo: 'owner/name', closed: '3', total: '3' }
      const text = evalPromptHelpers.promptTextForForTest(st, id, params, lang)
      return String(text || '')
    }
    BACKENDS.forEach(function (b) {
      // #603：github 后端声明面带 gh 直连命令，是领导拍板的方向 —— 渲染到 github 面上时按「允许跟踪器命令」判；
      //   其余后端照旧按最严口径判（渲染结果里出现 gh/glab 命令即红）。
      const isGh = (b === 'github')
      FIX_IDS.forEach(function (id) {
        ;['zh', 'en'].forEach(function (lang) {
          const t = renderOf(b, id, lang)
          const where = '#603 ' + b + '/' + id + '.' + lang
          if (!t) { fail(where + ' 渲染为空（渲染入口取不到文本）'); return }
          if (t.indexOf('{bodyFormat}') >= 0) fail(where + ' 渲染后仍是 {bodyFormat} 标记（后端上下文没接通）')
          // 渲染入口负责填的占位符 = 该条目在注册表里声明的那些（{bodyFormat} / {subIssue} 由后端上下文填）。
          //   后端声明文本自带 {owner} / {repo} 这类「由 agent 按当前仓库自行代入」的占位符（ensureLabels 一直是这个约定），
          //   渲染入口本来就不负责填，所以只判「声明的那些」有没有残留 —— 给全了还残留才是真的漏填。
          const declared = ((reg[id] || {}).placeholders || []).slice()
          const left = leftoverPlaceholder(t, declared)
          if (left) fail(where + ' 渲染后残留占位符 ' + left + '（渲染入口没把这个值填上）')
          if (t.indexOf('undefined') >= 0) fail(where + ' 渲染后出现 undefined（某个占位符的值没取到）')
          // 渲染结果不许再命中「具体跟踪器命令（非 github 面）/ 脚本调用 / 内联正文」这几条规则；
          //   R8（先解析插件目录再调脚本）在所有面都判，github 面也不例外。
          judge(t, { allowTracker: isGh }).forEach(function (h) { fail(where + ' 渲染后 [' + h.rule + '] 命中「' + h.snippet + '」') })
          // #603 防回潮：模板层渲染结果里出现 dsh plugin 或两个脚本名即判红（直断一次，失败信息比 R8 那行更直白）
          ;['dsh plugin', 'fix-issue-body.mjs', 'fix-issue-body.mts', 'wire-subissues.mjs', 'wire-subissues.mts', '<插件目录>', '<pluginDir>'].forEach(function (bad) {
            if (t.toLowerCase().indexOf(bad.toLowerCase()) >= 0) {
              fail(where + ' 渲染结果出现已被撤掉的间接写法「' + bad + '」（#603 起提示词改回 gh 直连，不再解析插件目录调脚本）')
            }
          })
          // 非 GitHub 后端：渲染结果不许带上 GitHub 专用命令（判定层已覆盖 gh/glab，这里直断一次，失败信息更直白）
          if (!isGh) {
            ;['gh api', 'gh issue', 'gh auth', 'glab issue', 'glab auth'].forEach(function (bad) {
              if (t.indexOf(bad) >= 0) fail(where + ' 渲染结果出现 GitHub 专用命令「' + bad + '」（后端无关的正文格式不许带上它）')
            })
          }
        })
      })
    })
    // GitHub 声明面必须真的给出建边写法（用真实数据断言，不许空转）：{subIssue} 接上后端声明后，
    //   渲染结果里要看得见那两个工具名（#716 起建边与校验走工具，不再写裸命令）。
    ;[['zh', renderOf('github', 'mapInspect', 'zh')], ['en', renderOf('github', 'mapInspect', 'en')]].forEach(function (pair) {
      const where = '#716 github/mapInspect.' + pair[0]
      if (pair[1].indexOf('deck_map_link') < 0) fail(where + ' 渲染结果缺 deck_map_link（{subIssue} 没接上后端声明）')
      if (pair[1].indexOf('deck_map_snapshot') < 0) fail(where + ' 渲染结果缺 deck_map_snapshot（{subIssue} 没接上后端声明的读回核对）')
      if (/gh\s+api|sub_issues|dependencies\/blocked_by/.test(pair[1])) fail(where + ' 渲染结果残留裸跟踪器命令（#716 起建边与校验都搬进工具）')
    })
    // #725：正文格式契约整节删除 —— 这条只做反向断言：渲染入口与三后端声明都不许再有它。
    if (typeof evalPromptHelpers.BODY_FORMAT === 'function') fail('#725 渲染入口仍暴露 BODY_FORMAT（应随正文格式契约一起删掉）')
    ;['github', 'gitlab', 'markdown'].forEach(function (b) {
      if (backendDecls[b] && backendDecls[b].bodyFormat) fail('#725 ' + b + ' 后端仍声明 prompts.bodyFormat（该条已整节删除）')
    })
    // #603 必修①：completePrompt 的真实调用形态 —— 签名 (st, num, title, total, closed, effortId)。
    //   #779 起模板不再内嵌标识头（标题由首行 /wayfinder+链接承载），title 参数保留兼容但正文不再渲染「标题：T」。
    const cpSt = { selection: { backendId: 'github' }, backendModules: [{ id: 'github', prompts: backendDecls.github }] }
    const cpText = String(evalPromptHelpers.completePromptForTest(cpSt, 5, 'T', 3, 3) || '')
    if (!cpText) fail('#595 completePrompt 按真实调用形态渲染为空')
    if (cpText.indexOf('## 目标 map') >= 0) fail('#779 completePrompt 渲染结果残留已删的标识头')
    if (cpText.indexOf('## 工具') < 0 || cpText.indexOf('deck_issue_report') < 0) fail('#779 completePrompt 渲染结果缺两行工具节')
    if (cpText.indexOf('3/3') < 0) fail('#779 completePrompt 渲染结果没把 closed/total 填进去（按真实形态应出现「3/3」）')
    if (cpText.indexOf('undefined') >= 0) fail('#595 completePrompt 渲染结果出现 undefined（调用参数错位：标题位拿到数字、或标题没传）')
    const cpLeft = leftoverPlaceholder(cpText)
    if (cpLeft) fail('#595 completePrompt 渲染结果残留占位符 ' + cpLeft + '（占位符没被填上）')
    // 先验自证：旧的四参形态必须能被上面两条抓红（证明断言有变红能力，不是永远绿）
    const cpBad = String(evalPromptHelpers.completePromptForTest(cpSt, 5, 3, 3) || '')
    if (cpBad.indexOf('undefined') < 0) fail('#595 先验失败：按旧四参形态调用 completePrompt 竟渲染不出 undefined（渲染面断言抓不住调用错位）')
    // 调用点也必须按六参形态调（防回退，#1595）：这几处视图/router 里每处 completePrompt 调用都要传 6 个实参（含 effortId）
    ;['src/client/views/ListTabRow.js', 'src/client/views/DetailActionBar.js', 'src/client/kernel/container-view.js', 'src/client/kernel/router.js'].forEach(function (rel) {
      // 2026-10-20（#1286）：地图详情页底部那处 completePrompt 调用随三态动作组搬到了 DetailActionBar.ts，
      //   名单跟着搬家（扫描面不许静默少扫：搬走的那处仍然要被数）；同时把新出现的那处调用点
      //   （container-view.ts 里按容器状态决定收尾提示词）也纳入这张名单。
      // 2026-10-19（#1301 批C）：这几份真源今天都住在同名 .ts 里，旁边那份 .js 产物这一阶段已经删掉，
      //   按 .js 路径直接读会 ENOENT；取源改走共用入口的 sourceText，扫描的是手写真源原文。
      //   另：真源顶部有一句 `declare function completePrompt(...args: any[]): any` —— 那是类型声明、不是调用点
      //   （构建产物里被剥掉了，老口径碰不到它）。按 #1595 判据「每处调用传 6 个实参」先把声明行剔掉再数。
      const srcV = sourceText(rel).split('\n')
        .filter((l) => !/^\s*declare\s+function\s+completePrompt\b/.test(l)).join('\n')
      const counts = callArgCounts(srcV, 'completePrompt')
      if (counts.length === 0) { fail('#595 ' + rel + ' 里找不到 completePrompt 调用点（调用形态断言无源，扫描面不许静默少扫）'); return }
      counts.forEach(function (n, i) {
        if (n !== 6) fail('#595 ' + rel + ' 第 ' + (i + 1) + ' 处 completePrompt 调用传了 ' + n + ' 个实参（签名是 (st, num, title, total, closed, effortId)，必须 6 个）')
      })
    })
    // 脚本引用面（#603）：两边都从源码机械求值，但不再要求「提示词引用的脚本集合 == 发布包脚本集合」相等。
    //   为什么不再要求相等：那个等式的前提是「提示词必须调脚本，所以包里带的脚本就是给提示词用的」。
    //   #603 领导拍板改回 gh 直连后，提示词一个脚本都不调，两条脚本仍留在包里当可选工具（用户想手动跑还能跑），
    //   等式因此必然不成立 —— 判据本身失效，改成两条各自独立的事实：
    //     ① 提示词（注册表 20 条的 zh/en/use + 三后端 prompts 声明里的字面量）里一个脚本名都不许出现；
    //     ② 发布包仍带这两条脚本，且生成物与源逐文件 sha256 一致（顺手删掉可选工具也要红）。
    const scriptRefs = []
    const scanScriptRefs = function (text) {
      const re = /[a-z0-9_][a-z0-9_./\\-]*\.(?:mjs|mts)/gi
      let m
      while ((m = re.exec(String(text))) !== null) { if (scriptRefs.indexOf(m[0]) < 0) scriptRefs.push(m[0]) }
    }
    let scannedTexts = 0
    Object.keys(reg).forEach(function (id) {
      const e = reg[id] || {}
      ;['zh', 'en', 'use'].forEach(function (f) {
        if (e[f] == null) return
        scannedTexts++
        scanScriptRefs(String(e[f]))
      })
    })
    BACKENDS.forEach(function (b) {
      const bsrc = fs.readFileSync(backendPath(b, backendProbe), 'utf8')
      scanAllLiterals(extractObjectLiteral(bsrc, 'export const prompts') || '').forEach(function (lit) {
        scannedTexts++
        scanScriptRefs(lit.text)
      })
    })
    if (scannedTexts < 60) fail('#603 脚本引用面只扫到 ' + scannedTexts + ' 段提示词文本（期望 ≥ 60：注册表 20 条 × zh/en/use + 三后端声明里的字面量；扫描面太窄等于没扫）')
    if (scriptRefs.length) fail('#603 提示词里引用了发布包脚本 ' + scriptRefs.join(',') + '（#603 起提示词改回 gh 直连，一个脚本都不许引用；两条脚本只留在包里当可选工具）')
    // 发布包仍带这两条脚本：从 scripts/build.mts 的 SHIPPED_SCRIPTS 清单机械求值（唯一手写清单，不许第二份）
    const SHIPPED_EXPECT = ['fix-issue-body.mts', 'wire-subissues.mts']
    const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mts'), 'utf8')
    const mm = /const SHIPPED_SCRIPTS[^=]*=\s*\[([^\]]*)\]/.exec(buildSrc)
    if (!mm) fail('#603 scripts/build.mts 里找不到 SHIPPED_SCRIPTS 清单（发布包脚本集合无源可求值）')
    const shipped = []
    if (mm) {
      const q = /'([^']+)'/g
      let qm
      while ((qm = q.exec(mm[1])) !== null) shipped.push(qm[1])
    }
    if (mm) {
      const b = shipped.slice().sort()
      if (JSON.stringify(b) !== JSON.stringify(SHIPPED_EXPECT.slice().sort())) {
        fail('#603 发布包脚本集合 [' + b.join(',') + '] ≠ [' + SHIPPED_EXPECT.join(',') + ']（提示词不再引用脚本，但这两条脚本要留在包里当可选工具，不许顺手删）')
      }
      // 生成物与源逐文件 sha256 一致（package/scripts 是 gitignore 生成态，过期即红；缺文件先跑构建）
      const cryptoPkg = require('crypto')
      const sha = function (p) { return cryptoPkg.createHash('sha256').update(fs.readFileSync(p)).digest('hex') }
      const pkgDir = path.join(ROOT, 'package/scripts')
      let onDisk = []
      try {
        onDisk = fs.readdirSync(pkgDir).filter(function (f) { return fs.statSync(path.join(pkgDir, f)).isFile() }).sort()
      } catch (e) {
        fail('#603 package/scripts/ 不存在（生成物缺失；修法：跑 node scripts/build.mts 重新生成）：' + e.message)
      }
      if (onDisk.length && JSON.stringify(onDisk) !== JSON.stringify(b)) {
        fail('#603 package/scripts/ 落点集合 [' + onDisk.join(',') + '] ≠ 清单 [' + b.join(',') + ']（有多余文件或缺文件；修法：跑 node scripts/build.mts 重新生成）')
      }
      shipped.forEach(function (n) {
        const gen = path.join(pkgDir, n)
        const srcP = path.join(ROOT, 'scripts', n)
        if (!fs.existsSync(gen)) { fail('#603 生成物缺失 package/scripts/' + n + '（修法：跑 node scripts/build.mts 重新生成）'); return }
        if (!fs.existsSync(srcP)) { fail('#603 源缺失 scripts/' + n); return }
        if (sha(gen) !== sha(srcP)) fail('#603 生成物与源不一致 package/scripts/' + n + '（sha256 对不上；修法：跑 node scripts/build.mts 重新生成）')
      })
    }
  } catch (e) {
    fail('#603 断言执行时抛错：' + String((e && e.message) || e))
  }
  if (stepOk(p603)) console.log('  PASS #603/#716 渲染面（12 条目 × zh/en × 三后端：github 渲染出带 deck_* 工具的 {subIssue} 与无命令的正文格式块，Markdown/GitLab 渲染出各自的后端版；渲染结果无 undefined、无残留占位符、无裸跟踪器命令、无「先解析插件目录再调脚本」的间接写法）+ completePrompt 真实调用形态 + 提示词零脚本引用 + 发布包仍带两条脚本 + 生成物 sha256 一致')
  if (stepOk(pS1)) console.log('  PASS 面 S1 ' + s1Label + '（' + s1Ids.length + ' 条注册表，扫描 ' + s1.scanned + ' 条；含占位符 ' + s1.rendered + ' 条走渲染面）+ 契约断言 + 跨门禁一致性 + github 后端注入链（#716 起：建边与校验走 deck_* 工具）')
}

// —— S2 / S3 / S4（单文件模式跳过：L2 注入只针对 S1） ——
if (!singleFileMode) {
  ;['client.js', 'package/lib/client.js'].forEach(function (rel, idx) {
    const pS2 = problems.length
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { fail('S2 ' + rel + ' 不存在（改 src 后必须重建产物）'); return }
    const got = parseArtifactRegistry(fs.readFileSync(p, 'utf8'))
    const ids = Object.keys(got)
    surfaceReport.S2[idx] = ids.length
    if (reg) {
      const missing = s1Ids.filter(function (x) { return !got[x] })
      const extra = ids.filter(function (x) { return !reg[x] })
      if (missing.length) fail('S2 ' + rel + ' 缺条目：' + missing.join(', '))
      if (extra.length) fail('S2 ' + rel + ' 多出条目：' + extra.join(', '))
      s1Ids.forEach(function (id) {
        if (!got[id]) return
        // #1292：产物里没有 use 字段（use 只活在 YAML 里，不进客户端产物），所以这一面不比对 use。
        ;['version', 'zh', 'en'].forEach(function (f) {
          if (String(got[id][f]) !== String(reg[id][f])) fail('S2 ' + rel + ' ' + id + '.' + f + ' 与 S1 不一致（改 src 后必须重建产物）')
        })
        if (JSON.stringify(got[id].placeholders) !== JSON.stringify(reg[id].placeholders)) fail('S2 ' + rel + ' ' + id + '.placeholders 与 S1 不一致（产物 ' + JSON.stringify(got[id].placeholders) + ' / 真源 ' + JSON.stringify(reg[id].placeholders) + '）')
      })
    }
    if (stepOk(pS2)) console.log('  PASS 面 S2 ' + rel + '（' + ids.length + ' 条，与 S1 逐字段一致）')
  })

  BACKENDS.forEach(function (b) {
    const pS3 = problems.length
    const p = backendPath(b, backendProbe)
    if (!fs.existsSync(p)) { fail('S3 缺后端文件 ' + p); return }
    const got = collectBackend(b, fs.readFileSync(p, 'utf8'), backendLabel(b, backendProbe), EXEMPT)
    got.problems.forEach(function (m) { fail(m) })
    if (!got.found) return
    surfaceReport.S3.push(got.keys.length)
    check(got.keys.length === EXPECT_BACKEND_KEYS[b], 'S3 ' + b + ' prompts 键数 ' + got.keys.length + '（期望 ' + EXPECT_BACKEND_KEYS[b] + '，实测值；v2 写的 7/9/6 不成立）')
    check(got.literals === EXPECT_BACKEND_LITERALS[b], 'S3 ' + b + ' prompts 内字符串字面量数 ' + got.literals + '（期望 ' + EXPECT_BACKEND_LITERALS[b] + '）——词法扫描不许静默少扫')
    if (stepOk(pS3)) console.log('  PASS 面 S3 ' + backendLabel(b, backendProbe) + '（' + got.keys.length + ' 键 / ' + got.literals + ' 个字面量，含拼接续段）')
  })

  // —— S8：客户端产物不许出现 gh / glab 命令形状（不是只卡两个字面串） ——
  ;['client.js', path.join('package', 'lib', 'client.js')].forEach(function (rel, idx) {
    const pS8 = problems.length
    const got = collectArtifactShapes(rel)
    if (!got) { fail('S8 ' + rel + ' 不存在（改 src 后必须重建产物）'); return }
    got.problems.forEach(function (m) { fail(m) })
    surfaceReport.S8[idx] = got.literals
    if (got.literals < 20) fail('S8 ' + rel + ' 只判到 ' + got.literals + ' 段产物提示词文本（解析面太窄，等于没扫）')
    if (stepOk(pS8)) console.log('  PASS 面 S8 ' + rel + '（产物注册表 ' + got.ids + ' 条 × zh/en/use 过 judge()：零 gh/glab 命令形状）')
  })

  const pS4 = problems.length
  const host = collectHost(EXEMPT)
  host.problems.forEach(function (m) { fail(m) })
  surfaceReport.S4 = host.consts.length
  check(host.consts.length >= EXPECT_HOST_PROMPT_CONSTS, 'S4 扫到的 *_PROMPT 字面量 ' + host.consts.length + ' 个（期望 ≥ ' + EXPECT_HOST_PROMPT_CONSTS + '）')
  // 口径放宽：合法新增 *_PROMPT 常量不该判红（≥ 而不是 ==）；
  //   也不再把「注释里提到一个还没声明的 *_PROMPT 名字」当失败（合法注释，红队 576b-fair.js 的 F9 就是这条误报）
  check(host.decls.length >= EXPECT_HOST_PROMPT_CONSTS, 'S4 *_PROMPT 声明点 ' + host.decls.length + ' 个（期望 ≥ ' + EXPECT_HOST_PROMPT_CONSTS + '）')
  if (stepOk(pS4)) host.decls.forEach(function (c) { console.log('  PASS 面 S4 ' + c.file + ' ' + c.name + '（' + c.literals + ' 个字面量）') })
}

// —— 豁免登记表自检 + 变异自检 ——
if (reg) {
  const pEX = problems.length
  check(MUST_JUDGE.length === EXPECT_MUST_JUDGE, 'MUST_JUDGE 条数 ' + MUST_JUDGE.length + '（期望硬编码 ' + EXPECT_MUST_JUDGE + '；清空或删项等于让这几条脱离判定）')
  const surfaceIds = { registry: s1Ids }
  const skipSurfaces = singleFileMode ? Object.keys(RULE_EXEMPT_EXPECTED).filter(function (s) { return s !== 'registry' }) : []
  if (!singleFileMode) {
    BACKENDS.forEach(function (b) {
      const p = backendPath(b, backendProbe)
      if (!fs.existsSync(p)) return
      surfaceIds['backend:' + b] = countTopLevelKeys(extractObjectLiteral(fs.readFileSync(p, 'utf8'), 'export const prompts') || '')
    })
    surfaceIds.S4 = collectHost(EXEMPT).decls.map(function (c) { return c.name })
  }
  auditExemptTable(EXEMPT, surfaceIds, { fileEntries: loadExempt(), skipSurfaces: skipSurfaces }).forEach(function (m) { fail(m) })
  // 变异自检：把任意一条豁免换成「受保护条目」，审计必须红。
  // 逐条受保护 id 都试一遍（不是只试一个），证明「换一条豁免整体放行」这条路被堵住。
  let mutationMissed = 0
  PROTECTED.forEach(function (pk) {
    const parts = pk.split('#')
    const mutated = EXEMPT.map(function (e, i) {
      return i === 0 ? Object.freeze(Object.assign({}, e, { surface: parts[0], id: parts[1] })) : e
    })
    if (auditExemptTable(mutated, surfaceIds, {}).length === 0) mutationMissed++
  })
  if (mutationMissed > 0) {
    fail('变异自检失效：把豁免换成受保护条目后审计仍然全绿（' + mutationMissed + '/' + PROTECTED.length + ' 条没被拦住）——豁免表可以被用来整体放行')
  }
  if (stepOk(pEX)) console.log('  PASS 豁免登记表（形状 / 存在性 / 完备性 / 数量 / 逐面 rule 集合硬编码比对 / ' + MUST_JUDGE.length + ' 条必须受判 / 受保护清单全量 ' + PROTECTED.length + ' 条 / 与登记文件相等 / 变异自检逐条）')
}

// —— L1 / L2 / L3 / 自注册 ——
if (!IS_CHILD) {
  const backendSrc = fs.readFileSync(path.join(ROOT, 'src/tracker/rooms/github/index.ts'), 'utf8')
  const l1 = reg ? runFixtureSelfCheck(reg, backendSrc) : { ok: false }
  if (l1.ok) console.log('  PASS L1 夹具自证（绕过 ' + FIXTURE_BYPASS.length + ' 条全红 / 误报 ' + FIXTURE_FALSE_POS.length + ' 条全绿 / 范围·解析·渲染·反隐藏四类各 1 条）')
  const l2 = runL2Injection()
  if (l2 === 0) console.log('  PASS L2 机械注入（' + L2_PAYLOADS.length + ' 条 payload 从 tests/prompt-gate-payloads.json 读，逐条注入临时副本 → 退出码 1 且点名 id 与规则）')
  // L3 扫描面完整性
  const l3Before = problems.length
  if (!singleFileMode) {
    check(surfaceReport.S1 === EXPECT_REGISTRY_ENTRIES, 'L3 S1=' + surfaceReport.S1 + '（期望 ' + EXPECT_REGISTRY_ENTRIES + '）')
    check(surfaceReport.S2[0] === EXPECT_REGISTRY_ENTRIES && surfaceReport.S2[1] === EXPECT_REGISTRY_ENTRIES, 'L3 S2=' + surfaceReport.S2.join('/') + '（期望 ' + EXPECT_REGISTRY_ENTRIES + '/' + EXPECT_REGISTRY_ENTRIES + '）')
    BACKENDS.forEach(function (b, i) { check(surfaceReport.S3[i] === EXPECT_BACKEND_KEYS[b], 'L3 S3.' + b + '=' + surfaceReport.S3[i] + '（期望 ' + EXPECT_BACKEND_KEYS[b] + '）') })
    check(surfaceReport.S4 >= EXPECT_HOST_PROMPT_CONSTS, 'L3 S4=' + surfaceReport.S4 + '（期望 ≥ ' + EXPECT_HOST_PROMPT_CONSTS + '）')
    check(surfaceReport.S6 >= 4, 'L3 S6=' + surfaceReport.S6 + '（注册表之外的客户端文本来源，期望 ≥ 4）')
    check(surfaceReport.S7 >= 1, 'L3 S7=' + surfaceReport.S7 + '（kernel/config.js 文本来源，期望 ≥ 1）')
    check(surfaceReport.S8[0] >= 20 && surfaceReport.S8[1] >= 20, 'L3 S8=' + surfaceReport.S8.join('/') + '（双产物字符串字面量数，期望都 ≥ 20）')
  }
  check(EXEMPT.length === EXPECT_EXEMPT, 'L3 EXEMPT=' + EXEMPT.length + '（期望 ' + EXPECT_EXEMPT + '）')
  if (problems.length === l3Before) console.log('  PASS L3 扫描面完整性')
  // 自注册（#573 总指挥 Q1：本门禁与 verify-progress.js 都要在链里；
  // #1125 起问规划函数，不再读 package.json 长串）
  const pReg = problems.length
  try {
    const { isGatePlanned } = require('../scripts/lib/discover-gates.ts')
    check(isGatePlanned(ROOT, 'tests/verify-prompts.ts'), 'verify 链未纳入本门禁（tests/verify-prompts.ts，规划函数里有它）')
    check(isGatePlanned(ROOT, 'tests/verify-progress.ts'), 'verify 链未纳入 tests/verify-progress.js（#573 总指挥 Q1 裁定，规划函数里有它）')
    if (problems.length === pReg) console.log('  PASS 自注册（verify 链含 verify-prompts.ts + verify-progress.js）')
  } catch (e) { fail('读门禁规划失败：' + e.message) }
}

console.log('S1=' + surfaceReport.S1 + ' S2=' + surfaceReport.S2.join('/') + ' S3=' + surfaceReport.S3.join('/') + ' S4=' + surfaceReport.S4 +
  ' S6=' + surfaceReport.S6 + ' S7=' + surfaceReport.S7 + ' S8=' + surfaceReport.S8.join('/') + ' EXEMPT=' + surfaceReport.exempt + (singleFileMode ? '（单文件模式：' + s1Label + '）' : ''))

if (problems.length) {
  console.log('\n存在失败（' + problems.length + ' 条）')
  problems.forEach(function (p) { console.log('  ' + p) })
  process.exit(1)
}
console.log('\n全部通过')
