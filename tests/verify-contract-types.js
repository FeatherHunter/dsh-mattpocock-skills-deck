// tests/verify-contract-types.js — 契约层类型门禁（deck 重构第二批 B 落地；#1026 收尾重定口径）
//
// 门禁归属: src/tracker/contract
// 门禁归属: src/tracker/contract/index.ts
// 为什么显式写这两条：契约目录的路径是 resolveInRoot(process.env.DSH_CONTRACT_DIR || 'src/tracker/contract')
// 拼出来的，归属表按字面量路径认不出它，会把这些契约文件算成「没人守」。这两条把归属钉死。
//
// 这个门禁替契约层守五件事，五件都过才算绿：
//   一、类型检查：用仓库 devDependencies 里的 typescript 跑一遍 `tsc -p tsconfig.contract.json`，
//       零错误才算过；tsc 的输出原样透出，看错在哪一行不用再自己跑一遍。
//       tsconfig 缺席也在自己门口判红（原来靠已撤的第零项数文件，现在缺谁谁说话）。
//   二、没有运行时实现：契约目录只许有类型与数据。禁六种：`function` 关键字、
//       `class` 关键字、箭头函数赋值（`const f = (…) => …`）、顶层 `new`（只有
//       `Object.freeze` 与字面量是合法的数据写法）、`require(`、动态 `import(`；
//       值引用只许目录内互引（数据引数据，目标文件自己也过这一条，所以不形成行为入口），
//       指到目录外的、包名的、裸副作用引用的，一律判红。发现就判红，并指出文件与行号。
//   三、贴合探针能编译：两份探针（GitHub / Markdown 后端）用宽松开关直编，探针文件自己
//       一条报错都不能有（成员缺了、形状写歪了，第一落点就是这里）；后端文件内部自己的
//       报错（旧语言时代的联合收窄、参数个数这类）另行计数，必须与本文件记的基线逐字相等——
//       多了是新增债务，少了是有人修了实现面（那要先把基线数改过来，并考虑把探针收紧）。
//       探针缺席也在自己门口判红。两份探针退休之日（后端转 TypeScript 后直接对真实现检查），
//       这一项跟着退休。
//   四、反面证明：现拼一个缺 `matches` 的假后端，拿同一套严格开关编它，必须编不过、
//       且报错里点名 `matches`。这条验的是「探针不是摆设」——它断得了缺少成员，真后端
//       哪天丢了一个必填，探针一定红。第二条走探针同款开关、断探针真用的弱化形状，同样齐了才算过。
//   五、运行时腿：把三个后端模块对象真加载起来（加载失败就红），断两档真值——
//       `openRepository` 必须是 `'url'` 或 `'folder'`：内置三家一律要声明
//       （契约里那个成员对第三方后端仍可选）。
//       这条口径是 #1139 收紧的：旧写法把「不声明」也算合法，那道口子正是 #1117 能长期躲在绿里的
//       地方（值只挂在文件级导出上、模块对象上没有该键时，界面把内置后端当成「没读到开仓动作」）；
//       `checks` 的种类如实记录（数组 / 函数 / 不声明）。
//
// 再撤四项（2026-10-14 #1147 决策 8：类型检查接管后撤掉。顺序是先立后撤——
//   跟踪器配置落地、三条断言写好、三种错故意造出确认变红之后，才动手删）：
//   旧零、缺件即红：缺文件时 tsc 与下游步骤本来就会红（配不起来、引不到、编不了），
//     不再需要一条专门数文件的；删它不能删出静默跳过，所以 tsconfig 缺席改由第一项判、
//     探针缺席改由第三项与第四项判（缺谁谁说话，见各步门口）。
//   旧二、漏编对账（拿 tsc 清单数文件）：「每个域都被配置圈住」由覆盖对账
//    （scripts/typecheck.mts）统一管，一个门禁不养两套账。
//   旧三、接口清单齐（读文本数 25 个名字）：名录与 Tracker 的同集由断言 2 守（编译期），
//     工厂交没交齐、多没多带由 satisfies + 断言 1、断言 3 守（编译期），文本数名字退休。
//     红证明（2026-10-14 同日现测）：故意删成员、往名录加脏名、往工厂加多余成员，
//     三次都当场红且点名，证据在 #1147 进度评论。
//   旧七里的键快照：模块对象的键集合比对撤掉——工厂交出来的键由 satisfies + 三条断言守；
//     「能真加载」与 openRepository / checksKind 真值保留（静态检查看不见真值，
//     探针也断不了被加宽的字面量，这两档还得跑起来看）。
//
// 撤掉的两项（决定人与理由见 #1026 正文：维护者拍板，两条同集断言归 #1026，随本次改写撤掉）：
//   旧五、旧六（名录与运行时真源同集、OpName 与运行时同集）是迁移期的临时脚手架——
//   当时契约名录与运行时各有一份操作清单，要人眼对齐。#1026 把运行时的值收进契约目录
//   （`index.ts` 的 `OPERATIONS` 改成从名录转出，同一份数组、同一个引用），没有第二份
//   手写副本之后，这两项就没有东西可比了，留着只会永远红。决定人与理由见 #1026 正文。
//
// 缺件口径史（2026-10-12 改口径，2026-10-14 #1147 决策 8 随旧第零项一起退休，细则见上）：
//   缺件本身就是要人看见的事故，不是可以跳过的等待；退休后缺谁谁在自己门口说话。
//
// 自测钩子（只给门禁自己验证「判红能力」用，正常跑不要传）：
//   DSH_CONTRACT_DIR      覆盖契约目录，缺省 src/tracker/contract
//   DSH_CONTRACT_TSCONFIG 覆盖 tsconfig 路径，缺省仓库根的 tsconfig.contract.json
//   相对路径按仓库根解析，绝对路径原样用。
//
// 已知边界（如实写在文件头，免得以后有人以为它什么都管得住）：
//   第二项是行级扫描：`function` / `class` 关键字、`const f = (…) => …` 形的箭头赋值、
//   `= new …` 形的顶层构造、`require(`、动态 `import(`、指到目录外的值引用。
//   跨行写的箭头（`=` 与 `=>` 不在同一行）扫不到——真要管住得靠类型检查与代码审查。
//   `new` 只认 `=` 之后的（值初始化形状），构造器类型（`new (x: …): T`，冒号形状）不在此列。
//   「契约目录里的 .ts 是不是都进了编译」本门禁不管了（旧第二项已撤），由覆盖对账
//   （scripts/typecheck.mts）统一管——但本门禁跑的那次 tsc 会把配置圈到的文件一起检查，错了一样红。
//   第三项不审后端实现内部：旧语言文件的内部报错只计数（基线在下面），审它们是迁移批次的事；
//   探针弱化的三处（`create` 返回深层、`openRepository` 字面量、`checks` 种类）各有去处——
//   前两处一个留后续专票、一个由第五项断真值，`checks` 数组还是工厂也由第五项如实记录。
//
// 用法：node tests/verify-contract-types.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { createRequire } = require('module')

const ROOT = path.resolve(__dirname, '..')
const resolveInRoot = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p))
const CONTRACT_DIR = resolveInRoot(process.env.DSH_CONTRACT_DIR || 'src/tracker/contract')
const TSCONFIG = resolveInRoot(process.env.DSH_CONTRACT_TSCONFIG || 'tsconfig.contract.json')
/** 两份贴合探针：静态腿的输入。缺了它们，第三项在自己门口判红，不静默跳过。 */
const PROBE_GITHUB_REL = 'tests/contract-probe-github.ts'
const PROBE_MARKDOWN_REL = 'tests/contract-probe-markdown.ts'
/**
 * 静态腿的观察面：只有这两房进探针编译，第三项数的「后端文件内部报错」也只数它们。
 * GitLab 房不在里面，原因与替代的那条腿写在文件头「第二段，少掉的那 1 条不是还债」那一段；
 * 将来要给 GitLab 房补一份探针，改这里与那一段两处（#1172）。
 */
const PROBE_ROOMS = ['github', 'markdown']
/**
 * 探针直编时，后端文件内部自己的报错数（旧语言时代的联合收窄、参数个数这类，
 * 实现面的债，不归本门禁审）。必须逐字相等：多了是新增债务，少了是有人动了实现面。
 *
 * 2026-10-14 由 200 改到 156（#1111「报错判据收成一源，失败结果带原文」）：那一票把各后端的失败构造
 * 从「手写 message 字面量」换成跟踪器层统一的 fail(kind, message, raw) 与各房带类型的辅助函数，
 * 旧语言时代那种「对象字面量对不上联合类型」的内部报错随之减少——这是实现面真的动了，不是门禁放松。
 * 同日又由 156 改到 155：关闭后那轮对抗式审查发现两个后端的逐条改色失败没带原文，把 GitHub 房那条
 * 逐条失败改成走 fail()、其余各条补上第三段，实现面再动一处，内部报错又少一条。
 *
 * 2026-10-14 由 155 改到 183（#1051「契约层补齐能力上限」，同一个 10-14 的第二笔）：
 * 这一次**不是新债，是把原先看不见的债照出来了**。那三个后端工厂的 `create` 返回对象
 * （`createGithubBackend` / `createMarkdownBackend` / `createGitlabBackend`）原先没有写返回类型，
 * 对象字面量按自己的形状推断，对不上契约也看不出来；#1051 给三家都标上了 `: RoomOperations`
 * （`src/tracker/contract/operations.ts` 的 `Tracker` 子集），于是「这个对象到底合不合契约」
 * 第一次有了编译期判据，原先隐身的 28 条当场现形。
 * 这 28 条的归类与去处：绝大多数是**辅助函数把 `ok` 收窄成 `boolean`**（`OpResult` 要求可辨识联合），
 * 修它要给后端内部几十个函数补返回标注——那是后端实现面的改动，归地图 08 / 09 的三张转写票
 * （#1052 读路径、#1053 写路径、#1054 关系与边）。本门禁只如实计数，不拦住这三张票之外的东西。
 * 把这个数往回降的办法只有一条：把那三张票做完，再回来改这个数。
 * 探针要不要跟着收紧（把弱化面收掉、让这个数继续降）归 #1095 那条测试跟随线，本票不动它。
 *
 * 2026-10-14 由 183 改到 162（#1147 三房转制收口 + 工厂挂 satisfies）：
 * 三个工厂的返回字面量挂上形状后，回调参数从契约签名拿到上下文类型，
 * 加上转制时补的标注，实现面又还了 21 条。这是还债，不是放松。
 *
 * 2026-10-14 由 162 改到 161（#1147 收尾补上 graph.ts:242 缺的 listIssues 导入）：
 * 整仓回退分支从 ReferenceError 变成真实现，探针口径下少了一条报错。同样是还债。
 *
 * 2026-10-14 由 161 改到 152（收口地图 08 时还掉的那笔：这个写法先被照出来，再被还清）。
 * 先说这一天里数怎么动的：161（79b069ba 17:21 定下的基线，当时实测就是 161）
 * → 160（0bd83612，见下面第二段，观察面少了一个房）
 * → 172（16885485 18:40 给读路径补结论线：往下游那个类型已经烂掉的局部变量上又挂了 12 个调用点）
 * → 152（同日收口地图 08 时改掉那一行写法，见第一段）。
 * 第一段，还债 20 条：`src/tracker/rooms/github/preflight.ts` 的 opCtx 原先写
 * `Object.assign({}, ctx || {}, cwd ? { cwd } : {})`，推出来的类型只有 `{ cwd: string } | { cwd?: undefined }`，
 * OpContext 的成员一个不剩；凡把它当 OpContext / ClassifyCtx 传下去的地方（读路径的日志钩子、ghClient、
 * ghVerdictOf）全报 TS2345。改成带标注的对象展开 `const opCtx: OpContext = { ...ctx, ...(cwd ? { cwd } : {}) }`
 * 之后，该文件从 22 条降到 2 条（剩下那两条是读 GhExecResult 的旧账，属存量），全池 172 → 152。
 * 这 20 条里 16 条是同一个毛病的不同调用点：其中 4 条在基线里已有，12 条是 16885485 新挂的。
 * 注意这个数不是「新增债务」，是**旧写法被新调用点照出来**（与上面 183 那次同一性质），
 * 只是一行就能还清，所以当场还了。
 * 第二段，少掉的那 1 条不是还债：0bd83612（#1136）摘掉各房对 capability-assertions 的 import type 之后，
 * `src/tracker/capability-assertions.ts` 退出本探针的编译程序，而它是全仓唯一静态 import 了
 * `./rooms/gitlab/index.js` 的文件 —— 整个 GitLab 房随之离开静态腿（少的那条是 gitlab 房 issues.ts 的 TS2322）。
 * 也就是说静态腿今天只看 GitHub 与 Markdown 两房，而运行时腿仍在看三个房的模块对象。
 * #1172 把这条边界写成了代码里的 `PROBE_ROOMS`（两房），并指定替代的那条腿：GitLab 房的形态由
 * src/tracker/tsconfig.json（include 写的是目录通配，新增文件自动进检查）与覆盖对账
 * scripts/typecheck.mts（门禁 tests/verify-typecheck.mts 跑它）守着。将来要给 GitLab 房补探针，
 * 改 `PROBE_ROOMS` 与这一段两处。
 * 读这段数的时候请把两件事分开：152 是「还清之后剩下的存量」，不是「债务变少了」的证据。
 *
 * 2026-10-15 由 152 改到 154（#1174 收尾实测）。这个数中间先涨后落，来历要写清：
 * 152 是 2026-10-14 收口地图 08 时记下的；在那之后、到 f3c16cb7（#1064 把 GitLab 房补齐到 25 条）
 * 那一笔为止，别的开发提交又把它顶回 161，而门禁从那时起一直红着、没有人登记这个数。
 * 所以本次开工实测到的起点不是 152，是 161（另抽一份 06b1b975 的干净树实测，同为 161）。
 * #1174 重写 Markdown 房若干失败分支与列目录的写法，把这 9 条还掉 7 条，落到 154。
 *
 * 2026-10-15 由 154 改到 167（还是 #1174，同一笔改动的后半段）。多出来的 13 条不是新毛病，
 * 是**同一类存量债被新代码照出来的**：本地 Markdown 房把「列目录的三种结果」写成了带判别字段的
 * 联合类型（`read.ts` 的 `DirListing`），在 `--strict false` 这套探针参数下，`ok` 这个判别字段
 * 不参与收窄，于是 `listed.missing` / `listed.error` 一律报 TS2339——与这 154 条里绝大多数
 * （`Property 'error' does not exist on type ...`）是同一种报错、同一个成因。
 * 具体分布：`issues-create.ts` 8 条（建票回查与取号那两段三态分支）、`issues-read.ts` 3 条、
 * `read.ts` 2 条。**没有为了把数字压回去而改成强制转换或 `any`**：那种写法过得了这个探针，
 * 却会把真实的类型收窄一起丢掉，而真正在守类型的是 `src/tracker/tsconfig.json` 与
 * `scripts/typecheck.mts`（门禁 `tests/verify-typecheck.mts`）——那两处今天都是绿的。
 * 要真正还清这一笔，得把探针的 `--strict false` 收紧（那是另一张票的事）。
 *
 * 下一次动这个数，请沿用同一条规矩——写清「谁改的、从多少到多少、为什么」，
 * 并说明这一笔是还债还是新欠的。
 */
const PROBE_NONPROBE_ERROR_BASELINE = 167
/** 探针直编的开关（与探针文件头写的口径一致，改一处两处一起改）。 */
const PROBE_TSC_ARGS = [
  '--noEmit', '--target', 'es2020', '--lib', 'es2020,dom', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--allowJs', '--checkJs', 'false',
  '--skipLibCheck', '--strict', 'false',
]
/**
 * 运行时腿的真值快照（#1026 实测；GitLab 一份按 #1110 实现决定第 15 条补上）：
 * 只剩两个断不了字面量的真值（openRepository 与 checks 种类），真值变了先确认再登记；
 * 若契约要跟着改，改完再记。
 * 键集合比对已撤（2026-10-14 #1147 决策 8）：工厂交出来的键由 satisfies + 三条断言守，
 * 不再数模块对象的键。改名（#1110 实现决定第 14 条）与旧名退役（#1141，2026-10-14）：三家模块对象先各自迁到与后端无关的
 * 新名字（#1133 GitHub、#1134 本地 Markdown、#1135 GitLab），老名字作为同义别名留了一轮；
 * 客户端与宿主都不再读它们之后，那三个网址口吻的老名字连同契约里的同名成员一起删净，
 * 所以下面三份快照今天只列新名字：`issueAddress` / `issueRefPattern` / `repoSearchAddress`。
 */
const RUNTIME_SNAPSHOTS = {
  github: {
    openRepository: 'url',
    checksKind: 'function',
  },
  markdown: {
    openRepository: 'folder',
    checksKind: 'absent',
  },
  /**
   * GitLab 这一份是 2026-10-14 实测补上的（#1110 实现决定第 15 条要求本图把缺的这份补齐）。
   * 当时实测发现它和另外两家不一样：`openRepository` 的值只以文件级导出的形式存在
   * （`src/tracker/rooms/gitlab/index.ts` 顶上的 `export const openRepository = 'url'`），没有挂进模块对象
   * ——这与 #620 给 GitHub 修掉的那处是同一个形状（`src/tracker/rooms/github/index.ts` 记着那次为什么补）。
   * 契约里这个成员本来就可选（`src/tracker/contract/backend-module.ts` 的 `openRepository?`），
   * 所以「模块对象上没有」当时不算违约，快照如实记「没有」，没替它补值。
   * 该缺口已由 #1117 补齐（2026-10-14）：模块对象上现在挂 `openRepository`（取值与文件级导出同一个 `'url'`），
   * 本快照随之从「不声明」改成 `'url'`，键集合多一个 `openRepository`。
   * 这次的行为变化只在界面那一处分类：按「后端自己声明的开仓动作」分套的
   * `src/client/views/labels/labelColorErrors.js` 的 lcCopyPlanOf 从「没读到开仓动作、这一次不生成方案」
   * 改判成 url 型那一套（远端仓库版文案）。网址本身照旧能开（走 `repoRef.url`，`src/client/panel/Dock.js`
   * 那一条）——这次改的是声明，不是开仓这个动作本身。
   * 改名（#1135，2026-10-14）：模块对象迁到三个与后端无关的新名字，老名字按别名窗口留着，
   * 所以下面这份键快照今天是 17 个（那 16 个名字，加上这次新挂的 `openRepository`）。
   */
  gitlab: {
    openRepository: 'url',
    checksKind: 'absent',
  },
}

let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 去掉块注释与整行注释，避免把注释里写的示例当成真的实现（写法沿用 tests/verify-build-artifacts.js）。
 * 块注释按换行数原样垫回空行（#1103）：不垫的话，下面的行号全是错的，人只能对着错行号跳代码。
 * 行号错了不只是难看——指出「第几行有问题」本身就是这道门禁的交付物，行号必须是文件里的真行号。 */
const stripComments = (text) =>
  text
    .replace(/\/\*([\s\S]*?)\*\//g, (m, inner) => String(inner).split('\n').map(() => '').join('\n'))
    .replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

/** 递归收 .ts 文件（含子目录）；跳过 node_modules 与 .d.ts（声明文件本来就只放类型）。 */
function listTsFiles(dir) {
  const out = []
  const walk = (abs) => {
    let entries = []
    try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules') continue
      const child = path.join(abs, e.name)
      if (e.isDirectory()) { walk(child); continue }
      if (!e.isFile()) continue
      if (!e.name.endsWith('.ts')) continue
      if (e.name.endsWith('.d.ts')) continue
      out.push(child)
    }
  }
  walk(dir)
  return out.sort()
}

/** 把引用串解成仓库相对路径（只解相对引用；包名引用回 null，由调用方按目录外处理）。 */
function resolveImportSpec(fromAbs, spec) {
  if (!spec.startsWith('.')) return null
  const abs = path.resolve(path.dirname(fromAbs), spec)
  return path.relative(ROOT, abs).replace(/\\/g, '/')
}

/**
 * 找出「指到目录外的值引用」，回 [{line, text}]。
 * 允许两种：`import type ...` 整句类型引；以及命名清单里每一项都带内联 `type ` 前缀的写法
 * （`import { type A, type B } from '...'`）——它转译后不留运行时引用，是契约层合法的写法。
 * 值引用（默认绑定、命名绑定、命名空间绑定、`export … from`）只许指到契约目录里面
 * （数据引数据：目标文件自己也过第四项，不形成行为入口）；指到外面、包名、裸副作用引用的，
 * 一律算运行时引用。动态 `import(` 另由 findRuntimeImpl 盯，这里不管。
 */
function findRuntimeImports(abs, code) {
  const hits = []
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const im = /^\s*import\b([\s\S]*)$/.exec(raw)
    const ex = /^\s*export\b([\s\S]*)$/.exec(raw)
    const m = im || ex
    if (!m) continue
    const clause = m[1].trim()
    if (/^type\b/.test(clause)) continue                                   // import/export type …：允许
    if (im && !/\bfrom\s*['"]/.test(clause)) {
      hits.push({ line: i + 1, text: raw.trim() })                          // 裸副作用引用：不允许
      continue
    }
    const named = /^(?:\{([\s\S]*?)\}|(\*)\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{([\s\S]*?)\})?)\s*from\s*['"]([^'"]*)['"]/.exec(clause)
    if (!named) {
      if (/\bfrom\s*['"]/.test(clause)) hits.push({ line: i + 1, text: raw.trim() })
      continue
    }
    const listText = named[1] !== undefined ? named[1] : named[3]
    if (listText !== undefined) {
      const parts = listText.split(',').map((s) => s.trim()).filter(Boolean)
      const allType = parts.length > 0 && parts.every((p) => /^type\s+[A-Za-z_$][\w$]*$/.test(p))
      if (allType) continue                                                 // 全内联 type：允许
    }
    const spec = named[4]
    const rel = resolveImportSpec(abs, spec)
    if (rel === null || !(rel === path.relative(ROOT, CONTRACT_DIR).replace(/\\/g, '/') || rel.startsWith(path.relative(ROOT, CONTRACT_DIR).replace(/\\/g, '/') + '/'))) {
      hits.push({ line: i + 1, text: raw.trim() })
    }
  }
  return hits
}

/**
 * 找出「像运行时实现」的写法，回 [{line, text, why}]。
 * 七种：function 关键字（`declare function` 是声明，放过）、class 关键字（`declare class` 放过）、
 * 箭头函数赋值（`const f = (…) => …`，接口里的函数类型是冒号形状，不在这里）、
 * 顶层 `new`（只有 `Object.freeze` 与字面量是合法的数据写法）、运行时 import、
 * require(、动态 import(。
 */
function findRuntimeImpl(abs, code) {
  const hits = []
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const text = raw.trim()
    const fn = /\bfunction\b/.exec(raw)
    if (fn) {
      const before = raw.slice(0, fn.index).trim()
      if (!/\bdeclare$/.test(before)) hits.push({ line: i + 1, text, why: '出现 function 关键字（契约目录只许有类型与数据）' })
    }
    const cl = /\bclass\b/.exec(raw)
    if (cl) {
      const before = raw.slice(0, cl.index).trim()
      if (!/\bdeclare$/.test(before)) hits.push({ line: i + 1, text, why: '出现 class 关键字（契约目录只许有类型与数据）' })
    }
    if (/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(raw)) {
      hits.push({ line: i + 1, text, why: '出现箭头函数赋值（行为要搬出契约目录）' })
    }
    // 顶层 new：只有 `Object.freeze(…)` 是合法的数据定型写法（数组/对象字面量不含 new）。
    // 构造器类型（`new (…): T`）后面跟的是左括号不是名字，到不了这里；`type F = new…` 这种行里，
    // 只要还出现了 `Object.freeze(` 就当数据放过——两样同时出现本身就是怪味道，靠代码审查盯。
    if (/\bnew\s+[A-Za-z_$][\w$]*/.test(raw) && !/Object\s*\.\s*freeze\s*\(/.test(raw)) {
      hits.push({ line: i + 1, text, why: '出现顶层 new（数据只许字面量与 Object.freeze）' })
    }
    if (/\brequire\s*\(/.test(raw)) hits.push({ line: i + 1, text, why: '出现 require(（运行时取值）' })
    if (/\bimport\s*\(/.test(raw)) hits.push({ line: i + 1, text, why: '出现动态 import(（运行时取值）' })
  }
  for (const h of findRuntimeImports(abs, code)) hits.push({ line: h.line, text: h.text, why: '值引用指到契约目录外（目录内数据互引除外）' })
  return hits.sort((a, b) => a.line - b.line)
}

function main() {
  console.log('契约层类型门禁（tsc 零错误 + 无运行时实现 + 探针编译 + 两条反面证明 + 运行时腿）')

  // ---- 1) 类型检查：tsc 零错误 ----
  // 缺谁谁说话：tsconfig 缺席不再由已撤的第零项数，这里自己判（没有配置可指，也不静默跳过）。
  const tsconfigExists = fs.existsSync(TSCONFIG)
  const probeGithubExists = fs.existsSync(path.join(ROOT, PROBE_GITHUB_REL))
  const probeMarkdownExists = fs.existsSync(path.join(ROOT, PROBE_MARKDOWN_REL))
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'))
  let tscBin = null
  try {
    tscBin = path.join(path.dirname(requireFromRoot.resolve('typescript/package.json')), 'bin', 'tsc')
  } catch (e) {
    check(false, 'typescript 已安装（找不到 typescript/package.json：请先跑 pnpm install，devDependencies 里含 typescript）：' + ((e && e.message) || e))
  }
  if (tscBin && !fs.existsSync(tscBin)) {
    check(false, 'typescript 命令行入口存在（按包内 bin/tsc 找，实际没有这个文件）：' + tscBin)
    tscBin = null
  }
  if (!tsconfigExists) {
    // 第零项已撤：tsconfig 缺席在这里自己判，不静默跳过（没有配置可指，也不跑 tsc）。
    check(false, 'tsconfig 存在（' + path.relative(ROOT, TSCONFIG) + ' 不在）：没有配置可指，类型检查这一步没做')
    tscBin = null
  }
  if (tscBin) {
    const r = spawnSync(process.execPath, [tscBin, '-p', TSCONFIG], { encoding: 'utf8' })
    if (r.error) {
      check(false, 'tsc 能跑起来（起进程失败）：' + (r.error.message || String(r.error)))
    } else {
      const out = (r.stdout || '') + (r.stderr || '')
      if (out.trim()) console.log('--- tsc 输出原样透出 ---\n' + out.replace(/\s+$/, '') + '\n--- tsc 输出结束 ---')
      check(r.status === 0, 'tsc -p ' + path.relative(ROOT, TSCONFIG) + ' 零错误' + (r.status === 0 ? '' : '（退出码 ' + r.status + '，错误见上面原样透出）'))
    }
  }

  // ---- 2) 没有运行时实现：契约目录只许类型与数据，目录内数据互引除外 ----
  // 缺谁谁说话：目录空（或目录不在）在这里自己判，不静默跳过。
  const tsFiles = (fs.existsSync(CONTRACT_DIR) && fs.statSync(CONTRACT_DIR).isDirectory()) ? listTsFiles(CONTRACT_DIR) : []
  if (!tsFiles.length) {
    check(false, '契约目录下有 .ts 文件可查（' + path.relative(ROOT, CONTRACT_DIR) + ' 空或不在）：无运行时实现这一项没做')
  } else {
    let bad = 0
    for (const abs of tsFiles) {
      const code = stripComments(fs.readFileSync(abs, 'utf8'))
      const hits = findRuntimeImpl(abs, code)
      const rel = path.relative(ROOT, abs)
      if (!hits.length) continue
      bad += 1
      for (const h of hits) console.log('  FAIL ' + rel + ':' + h.line + ' ' + h.why + ' → ' + h.text.slice(0, 160))
      failed = true
    }
    check(bad === 0, '契约目录下 ' + tsFiles.length + ' 个 .ts 文件都没有运行时实现（只许类型与数据，目录内数据互引除外）')
  }

  // ---- 3) 贴合探针能编译：探针文件自己零报错，后端内部报错数与基线相等 ----
  // 探针直编不经任何 tsconfig（命令行开关）：后端入口会把半个房间拖进编译程序，
  // 经配置编会触发覆盖对账的重复归属；开关与探针文件头写的口径一致，改一处两处一起改。
  {
    // 观察面如实写出来（#1172）：这条腿只看两房这件事，光写在文件头里别人还得自己读一遍；
    // 同时把「不看的那个房由谁守」钉在盘上——替代的那条腿被撤掉时这里要红，那句话才有落点。
    const altGate = path.join(ROOT, 'scripts', 'typecheck.mts')
    const altConfig = path.join(ROOT, 'src', 'tracker', 'tsconfig.json')
    const altOk = fs.existsSync(altGate) && fs.existsSync(altConfig)
    check(
      altOk,
      '静态腿观察面只有两房（' + PROBE_ROOMS.join('、') + '）：GitLab 房的形态由 src/tracker/tsconfig.json 与覆盖对账 scripts/typecheck.mts 守，两处都在盘上' +
        (!fs.existsSync(altGate) ? '；scripts/typecheck.mts 不在：替代的那条腿没了' : '') +
        (!fs.existsSync(altConfig) ? '；src/tracker/tsconfig.json 不在：GitLab 房没有类型检查' : ''),
    )
  }
  if (!probeGithubExists || !probeMarkdownExists) {
    // 第零项已撤：探针缺席在这里自己判，不静默跳过。
    check(false, '两份贴合探针存在（缺：' + (!probeGithubExists ? PROBE_GITHUB_REL + ' ' : '') + (!probeMarkdownExists ? PROBE_MARKDOWN_REL : '') + '）：探针直编这一步没做')
  } else if (!tscBin) {
    check(false, '两份探针能直编（tsc 起不来，这一项没做：见第一项的 FAIL）')
  } else {
    const pr = spawnSync(
      process.execPath,
      [tscBin, ...PROBE_TSC_ARGS, path.join(ROOT, PROBE_GITHUB_REL), path.join(ROOT, PROBE_MARKDOWN_REL)],
      { encoding: 'utf8' },
    )
    if (pr.error) {
      check(false, '探针直编能跑起来（起进程失败）：' + (pr.error.message || String(pr.error)))
    } else {
      const out = (pr.stdout || '') + (pr.stderr || '')
      const errLines = out.split(/\r?\n/).filter((l) => /\(\d+,\d+\)\s*:\s*error\s+TS\d+/.test(l))
      const fileOf = (l) => l.slice(0, l.indexOf('(')).replace(/\\/g, '/')
      const probeErrs = errLines.filter((l) => {
        const f = fileOf(l)
        return f.endsWith('/' + PROBE_GITHUB_REL) || f.endsWith('/' + PROBE_MARKDOWN_REL)
      })
      for (const l of probeErrs) console.log('  FAIL 探针自己报错（成员缺了或形状歪了，第一落点）：' + l.trim().slice(0, 300))
      if (probeErrs.length) failed = true
      const nonProbeCount = errLines.length - probeErrs.length
      check(
        probeErrs.length === 0,
        '两份探针文件自己零报错（' + probeErrs.length + ' 条；有报错先看探针指出的成员，再看后端是不是改了形状）',
      )
      check(
        nonProbeCount === PROBE_NONPROBE_ERROR_BASELINE,
        // 这句提示要按两种结果分开说：相等时才说「两边相等」，不等时先把「不相等」说出来，
        // 再解释往哪边偏是什么意思。原先无论哪一边都写着「与基线 X 条相等」，
        // 判红的时候等于自己给出一个自相矛盾的数字，看日志的人得先怀疑是不是门禁写错了。
        '后端文件内部报错 ' + nonProbeCount + ' 条，基线 ' + PROBE_NONPROBE_ERROR_BASELINE + ' 条' +
          (nonProbeCount === PROBE_NONPROBE_ERROR_BASELINE
            ? '，两边相等（实现面的债，审它们是迁移批次的事）'
            : '，两边不相等——多了是新增债务，少了是有人动了实现面：先把基线数改过来，并考虑把探针收紧'),
      )
      if (nonProbeCount !== PROBE_NONPROBE_ERROR_BASELINE) failed = true
    }
  }

  // ---- 4) 反面证明：现拼一个缺 matches 的假后端，必须编不过且点名 matches ----
  // 验的是「探针不是摆设」。假文件写进系统临时目录（不进仓库，不污染覆盖对账），编完就删。
  if (!tscBin) {
    check(false, '反面证明能跑（tsc 起不来，这一项没做：见第一项的 FAIL）')
  } else {
    const os = require('os')
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-contract-neg-'))
    try {
      const relToContract = path.relative(tmpDir, path.join(CONTRACT_DIR, 'backend-module.ts')).replace(/\\/g, '/')
      const negFile = path.join(tmpDir, 'negative.ts')
      fs.writeFileSync(
        negFile,
        `import type { BackendModule } from '${relToContract}'\n` +
          `export const bad: BackendModule = { id: 'neg', label: 'neg', ` +
          `create: (() => { throw new Error('neg') }) as unknown as BackendModule['create'] }\n`,
        'utf8',
      )
      const nr = spawnSync(
        process.execPath,
        [tscBin, '--noEmit', '--strict', '--target', 'es2020', '--lib', 'es2020,dom',
          '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck', negFile],
        { encoding: 'utf8' },
      )
      const nout = (nr.stdout || '') + (nr.stderr || '')
      const mentionsMatches = /matches/.test(nout)
      check(
        nr.status !== 0 && mentionsMatches,
        '缺 matches 的假后端编不过、且报错点名 matches' +
          (nr.status !== 0 && mentionsMatches ? '' : '（退出码 ' + nr.status + '，' + (mentionsMatches ? '没点名' : '输出里没见到 matches') + '：探针可能断不了缺少成员，速查）'),
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  // ---- 4b) 反面证明第二条：走探针那条路，缺 matches 的假后端也必须编不过 ----
  // 第一条反面证明走的是**严格开关 + 完整 `BackendModule`**，那证明的不是探针这条路：探针自己
  // 跑在宽松开关（`--strict false`）下，断的是弱化过的 `ProbeShape`。弱化之后还抓不抓得住缺成员，
  // 在 #1051 讨论之前没有任何自动化证明（这正是那张票要补的两条之一）。
  // 这一条就是补上的证明：用**探针同款开关**、断**探针真用的那份 ProbeShape**，现拼一个缺 matches 的假后端。
  // 只认「报错落在假文件自己身上」，不认别的文件里冒出来的 matches —— 后端内部本来就有报错，
  // 不筛文件的话这条证明谁都能过（那就成了摆设）。
  if (!tscBin) {
    check(false, '第二条反面证明能跑（tsc 起不来，这一项没做：见第一项的 FAIL）')
  } else if (!probeGithubExists) {
    // 第零项已撤：探针缺席在这里自己判，不静默跳过。
    check(false, '第二条反面证明的探针输入存在（' + PROBE_GITHUB_REL + ' 不在）：这一条没做')
  } else {
    const os2 = require('os')
    const tmpDir2 = fs.mkdtempSync(path.join(os2.tmpdir(), 'dsh-contract-neg2-'))
    try {
      const relToProbe = path.relative(tmpDir2, path.join(ROOT, PROBE_GITHUB_REL)).replace(/\\/g, '/')
      const neg2 = path.join(tmpDir2, 'negative-probe-shape.ts')
      fs.writeFileSync(
        neg2,
        `import type { ProbeShape } from '${relToProbe}'\n` +
          `export const bad: ProbeShape = { id: 'neg', label: 'neg', create: () => ({}) }\n`,
        'utf8',
      )
      const nr2 = spawnSync(process.execPath, [tscBin, ...PROBE_TSC_ARGS, neg2], { encoding: 'utf8' })
      const nout2 = (nr2.stdout || '') + (nr2.stderr || '')
      // 按文件名认「假文件自己身上」的报错：tsc 打印的路径是相对当前目录的，拿绝对路径前缀对不上。
      // 文件名带随机目录名，不会与仓库里的任何文件重名。
      // 还要往后读几行：`Property 'matches' is missing …` 这一句落在报错块的续行上，
      // 只看首行会得出「没点名 matches」的错误结论（这条断言刚上线时就是这么误判过一次）。
      const neg2Name = path.basename(neg2)
      const all2 = nout2.split(/\r?\n/)
      const selfIdx = all2.findIndex((l) => /\(\d+,\d+\)\s*:\s*error\s+TS\d+/.test(l) && l.replace(/\\/g, '/').includes('/' + neg2Name + '('))
      const selfBlock = selfIdx >= 0 ? all2.slice(selfIdx, selfIdx + 4).join('\n') : ''
      const selfLines = selfIdx >= 0 ? [all2[selfIdx]] : []
      const mentions = /matches/.test(selfBlock)
      check(
        selfLines.length > 0 && mentions,
        '探针那条路也断得住缺成员：缺 matches 的假后端在 ProbeShape 上编不过、且报错点名 matches' +
          (selfLines.length > 0 && mentions
            ? '（宽松开关 + 弱化形状，证明' + PROBE_GITHUB_REL + ' 的 ProbeShape 不是摆设）'
            : '（假文件自己身上 ' + selfLines.length + ' 条报错' + (mentions ? '' : '，没点名 matches') + '：探针的弱化形状可能断不了缺少成员，速查）'),
      )
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true })
    }
  }

  // ---- 4c) 基线来历：数字变了，就必须在同一次提交里把来历写上（#1172）----
  // 规矩：这个常量上面那段注释里，最后一条「由 X 改到 Y」的 Y 必须正好是今天的基线，且相邻两条首尾相接
  // （200→156→155→183→162→161→152 这条链）。只改数字不写来历，这里当场红——那正是 2026-10-14
  // 门禁红了七个多小时没人当次拉回绿的成因：数动了，却没人留下「哪次改动、多了几条、为什么」。
  {
    const self = fs.readFileSync(__filename, 'utf8')
    const pairs = [...self.matchAll(/由\s*(\d+)\s*改到\s*(\d+)/g)].map((m) => ({ from: Number(m[1]), to: Number(m[2]) }))
    const last = pairs[pairs.length - 1]
    const broken = pairs.filter((p, i) => i > 0 && pairs[i - 1].to !== p.from)
    const ok = pairs.length > 0 && broken.length === 0 && !!last && last.to === PROBE_NONPROBE_ERROR_BASELINE
    check(
      ok,
      '基线数的来历齐全（注释里最后一条「由 X 改到 Y」的 Y＝今天的基线 ' + PROBE_NONPROBE_ERROR_BASELINE +
        ' 条；链上 ' + pairs.length + ' 条首尾相接）' +
        (ok
          ? ''
          : '：' +
            (pairs.length === 0
              ? '注释里一条来历都没找到'
              : last && last.to !== PROBE_NONPROBE_ERROR_BASELINE
                ? '最后一条记的是 ' + last.to + '，与常量 ' + PROBE_NONPROBE_ERROR_BASELINE + ' 不一致——改了数字就把来历补上'
                : '链断了：' + broken.map((p) => p.from + '→' + p.to).join('、'))),
    )
  }

  // ---- 5) 运行时腿：模块对象真加载，断两档真值 ----
  // 静态探针断不了被加宽的字面量（openRepository）与数组/工厂之争（checks），这里断真值。
  // 键快照已撤（见文件头「再撤四项」）：工厂交出来的键由 satisfies + 三条断言守，这里只看真值。
  {
    const hookAbs = path.join(ROOT, 'scripts', 'ts-hook.mjs')
    // --import 吃的是模块说明符，Windows 绝对路径要先转成 file://，裸盘符路径会被 ESM 加载器拒收。
    const hookUrl = require('url').pathToFileURL(hookAbs).href
    // 三家现在都是 .ts 真源（GitHub #1133、本地 Markdown #1134、GitLab #1135，2026-10-14 同日收口），
    // 所以这里三家都直接点 .ts：走的是真源，不是构建产物，也不必依赖加载钩子的「同名 .ts 优先」那一步。
    const evalScript = `Promise.all([import('./src/tracker/rooms/github/index.ts'), import('./src/tracker/rooms/markdown/index.ts'), import('./src/tracker/rooms/gitlab/index.ts')]).then(([g, m, l]) => {` +
      ` const kind = (v) => v === undefined ? 'absent' : (Array.isArray(v) ? 'array' : (typeof v === 'function' ? 'function' : typeof v));` +
      ` console.log(JSON.stringify({` +
      ` github: { openRepository: g.githubModule.openRepository, checksKind: kind(g.githubModule.checks) },` +
      ` markdown: { openRepository: m.markdownModule.openRepository, checksKind: kind(m.markdownModule.checks) },` +
      ` gitlab: { openRepository: l.gitlabBackend.openRepository, checksKind: kind(l.gitlabBackend.checks) }}))` +
      ` })`
    const rr = spawnSync(process.execPath, ['--import', hookUrl, '--eval', evalScript], { encoding: 'utf8', timeout: 120000 })
    if (rr.error) {
      check(false, '运行时腿能跑起来（起进程失败）：' + (rr.error.message || String(rr.error)))
    } else if (rr.status !== 0) {
      check(false, '三个后端模块对象能真加载（退出码 ' + rr.status + '）：' + String(rr.stderr || '').slice(-300))
    } else {
      let snap = null
      try { snap = JSON.parse(String(rr.stdout || '').trim().split(/\r?\n/).pop()) } catch (e) { snap = null }
      if (!snap || !snap.github || !snap.markdown || !snap.gitlab) {
        check(false, '运行时快照读得出来（输出解析失败）：' + String(rr.stdout || '').slice(-200))
      } else {
        // 快照里「不声明」写成 undefined，打印时要能一眼看出来是「不声明」而不是漏填，所以这里换个写法。
        const showRepo = (v) => (v === undefined ? '不声明' : JSON.stringify(v))
        for (const name of ['github', 'markdown', 'gitlab']) {
          const want = RUNTIME_SNAPSHOTS[name]
          const got = snap[name]
          // #1139 起：内置三家必须声明。旧写法把「不声明」也算合法，那道口子正是 #1117 能长期存活的
          // 地方——值只挂在文件级导出上时，模块对象上没有这个键，界面就把它读成「没读到开仓动作」。
          const repoOk = got.openRepository === 'url' || got.openRepository === 'folder'
          const repoSame = got.openRepository === want.openRepository
          const kindSame = got.checksKind === want.checksKind
          check(
            repoOk && repoSame && kindSame,
            name + ' 模块对象真值如初（openRepository=' + showRepo(got.openRepository) + '、checks=' + got.checksKind + ')' +
              (!repoOk ? '；openRepository 必须是 url 或 folder（内置三家一律要声明，可选只对第三方后端可选）：判红' : '') +
              (repoOk && !repoSame ? '；openRepository 真值变了（' + showRepo(want.openRepository) + '→' + showRepo(got.openRepository) + '）：确认后登记' : '') +
              (!kindSame ? '；checks 种类变了（' + want.checksKind + '→' + got.checksKind + '）：数组还是工厂的专票有结论了就按结论办，没结论先登记' : ''),
          )
        }
      }
    }
  }

  console.log(failed ? '\n存在失败 — 契约层类型门禁没通过' : '\n全部通过 — 契约层类型门禁生效')
  process.exit(failed ? 1 : 0)
}

try {
  main()
} catch (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
}
