// tests/verify-contract-types.ts — 契约层类型门禁（deck 重构第二批 B 落地；#1026 收尾重定口径）
// （本文件 2026-10-15 由同名 .js 转成 TypeScript，#1027：类型标注只是标注，判据一条没动。）
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
//   三、后端自己声明了对上契约：三个后端的模块对象都用 `satisfies BackendModule` 挂上契约
//       （去掉注释后按文本找这三处），且这份声明真会被编译检查——看它的是域配置
//       `src/tracker/tsconfig.json`（strict，include 是目录通配，三个后端目录都在里面）与
//       覆盖对账 `scripts/typecheck.mts`（门禁 `tests/verify-typecheck.mts`），两处都必须在盘上。
//       3b、入口不断言：装配点 `src/tracker/registry/builtins.ts` 里不许出现对 BackendModule
//       的 as 断言（单写多写都算）——#1192 起，交模块的形状由 `backendModuleOf` 的
//       `Promise<BackendModule>` 返回值类型检查，断言会把检查点 bypass 掉；
//       这个返回值类型本身也必须在位（改成 any 等于拆掉检查点，一并钉住），
//       尖括号断言与检查器静默（`@ts-ignore` / `@ts-expect-error`）同样是 bypass，一并钉死。
//       唯一的形状断言函数是 `registry/shape.ts` 的 `validateMod`（它内部那一处单写
//       是断言函数自己收窄未知输入，不在 3b 范围内；3b 只查入口文件）。
//       为什么按文本找：把 `satisfies BackendModule` 这一句摘掉之后，普通 `tsc` 不会红
//       （没有声明就没有检查），所以「声明还在不在」只能自己钉住。这一项的前身是两份「贴合探针」，
//       它们的去处由 #1025 第 7 条定死（后端转成 TypeScript 之后，由后端自己写对上契约的声明），
//       #1027（2026-10-15）执行到位之后退休。
//   四、反面证明：现拼一个缺 `matches` 的假后端，拿同一套严格开关编它，必须编不过、
//       且报错里点名 `matches`。这条验的是「契约不是摆设」——它断得了缺少成员，真后端
//       哪天丢了一个必填，编译一定红。（第二条反面证明原本走探针那条路、断探针真用的弱化形状，
//       随探针在 #1027 一起退休：探针没了，就没有第二条路可验。）
//       4b、反面证明·入口姿势：同一个残模块改走「函数返回 BackendModule」姿势
//       （装配点交模块的姿势）再编一次，同样必须编不过且点名 `matches`——
//       只删声明、形状又走样时，拦住它的就是入口这个检查点。（#1192 新加，
//       与上面退休的那条旧 4b 同名不同物，不要混。）
//   五、运行时腿：把三个后端模块对象真加载起来（加载失败就红），断两档真值——
//       `openRepository` 必须是 `'url'` 或 `'folder'`：内置三家一律要声明
//       （契约里那个成员对第三方后端仍可选）。
//       这条口径是 #1139 收紧的：旧写法把「不声明」也算合法，那道口子正是 #1117 能长期躲在绿里的
//       地方（值只挂在文件级导出上、模块对象上没有该键时，界面把内置后端当成「没读到开仓动作」）；
//       `checks` 的种类如实记录（数组 / 函数 / 不声明）。#1027（2026-10-15）把「数组还是工厂」
//       这件事定死了：后端交出来的是写死的常量表（GitHub 后端挂的就是 `checks.ts` 的 `GITHUB_CHECKS`），
//       契约那一格跟着收成只读的 `readonly RoomCheckEntry[]`，所以下面 github 那份快照从 `function` 改成 `array`。
//       5b、运行时反面证明：真建一个注册表，残模块试注册必须被拒（理由是形状），
//       有效最小模块试注册必须能进（正控）。这条验的是「入口断言没被拿掉」——
//       `register` 里调 `validateMod` 是运行时唯一的形状入口，删了它编译不会说话。（#1192 新加。）
//
// 再撤四项（2026-10-14 #1147 决策 8：类型检查接管后撤掉。顺序是先立后撤——
//   跟踪器配置落地、三条断言写好、三种错故意造出确认变红之后，才动手删）：
//   旧零、缺件即红：缺文件时 tsc 与下游步骤本来就会红（配不起来、引不到、编不了），
//     不再需要一条专门数文件的；删它不能删出静默跳过，所以 tsconfig 缺席改由第一项判、
//     探针缺席改由第三项与第四项判（缺谁谁说话，见各步门口）。这一句里点名的探针已在
//     #1027 退休（见下一段），口径不变：第三项缺声明、第四项缺输入时，各自在自己门口判红。
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
// #1027（2026-10-15）退休的两件（前身与去向见第三项的说明）：
//   一、两份贴合探针：`tests/contract-probe-github.ts`、`tests/contract-probe-markdown.ts`，
//     以及它们 `/// <reference>` 引的 `tests/contract-probe-env.d.ts`。三份文件随之删除。
//     探针原本要做的事（「后端到底合不合契约」）现在由后端自己在编译期回答：
//     三家模块对象各自挂 `satisfies BackendModule`，操作面挂 `satisfies <后端>BackendShape`。
//   二、「后端文件内部报错数与基线相等」那一半（基线常量的来历见下一段留档）。探针用
//     `--strict false` 直编，数的不是「有没有违约」，而是旧写法在新调用点上投影出来的存量报错；
//     这个数一路漂，到 #1027 开工时已经与实测不符（基线 172、实测 170），门禁因此常红——
//     它红的不是契约有问题，是这本人情账没人记得记。真正在守类型的是 `src/tracker/tsconfig.json`
//     与覆盖对账 `scripts/typecheck.mts`（门禁 `tests/verify-typecheck.mts`），那两处今天都绿；
//     一个门禁不养两套账（#1147 决策 8），所以这一半随探针一起退休。
//   留档：那条基线的来历链是 200→156→155→183→162→161→152→154→167→172（每一笔的「谁改的、
//   为什么」原先写在常量上面，随常量一起删）。留这一行只为说明「这个数曾经存在、谁要追溯去哪找」：
//   逐笔理由见 #1147、#1174、#1058、#1111、#1051 的进度评论与本文件的历史版本。
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
//   第三项是文本查找，不是类型检查：它只认 `satisfies BackendModule` 这个写法。有人换成
//   标注（`const x: BackendModule = {…}`）这类等价写法、或把模块对象挪到别的文件时，本项要按
//   新落点改上面的 `BACKEND_DECLARATIONS`；反过来，只把那一句删掉、别的不动，本项一定红。
//   第三项不审三个后端内部的类型债：那是 `src/tracker/tsconfig.json` 的账（strict、零错误），
//   本门禁不另数一份（#1147 决策 8：一个门禁不养两套账）。
//   3b 只查入口文件（`src/tracker/registry/builtins.ts`），且只认 as 断言写法；
//   `validateMod` 自己内部那一处收窄（`shape.ts`）是断言函数分内的事，不在 3b 范围内。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-contract-types.ts（在仓库根目录；
//   npm test / npm run verify:parallel / node scripts/verify-all.mts 三个入口会自动挂装载钩子）。
//   装载钩子见 scripts/ts-hook.mts。本文件是 .ts 真源：Node 的类型剥离只删类型标注，ESM 里没有
//   `__dirname`，所以按 `import.meta.url` 算回仓库根目录。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resolveInRoot = (p: string): string => (path.isAbsolute(p) ? p : path.join(ROOT, p))
const CONTRACT_DIR = resolveInRoot(process.env.DSH_CONTRACT_DIR || 'src/tracker/contract')
const TSCONFIG = resolveInRoot(process.env.DSH_CONTRACT_TSCONFIG || 'tsconfig.contract.json')
/**
 * 三处「后端自己声明对上契约」的落点（第三项去掉注释后按文本找它们）。
 * 为什么不用类型检查找：这是「声明本身在不在」的问题——把 `satisfies BackendModule` 摘掉，
 * 普通 tsc 不会红（没有声明就没有检查），所以只能自己按文本钉住。
 * 换写法（改成标注、或把模块对象挪到别的文件）要同步改这张表，并把 what 写成那个对象的新名字。
 */
const BACKEND_DECLARATIONS = [
  { rel: 'src/tracker/rooms/github/index.ts', what: 'githubModule' },
  { rel: 'src/tracker/rooms/markdown/index.ts', what: 'markdownModule' },
  { rel: 'src/tracker/rooms/gitlab/index.ts', what: 'gitlabBackend' },
]
/** 声明必须长成这样（第三项的正则；大小写与空格宽松，只认这个挂法）。 */
const BACKEND_DECLARATION_RE = /satisfies\s+BackendModule\b/
/**
 * 替代贴合探针的那条腿（第三项要确认它在盘上）：域配置给三个后端做 strict 类型检查，
 * 覆盖对账统一管「有没有源码没人检查」。两者缺一，这句声明就没有腿去检查。
 */
const ALT_DOMAIN_CONFIG_REL = 'src/tracker/tsconfig.json'
const ALT_COVERAGE_GATE_REL = 'scripts/typecheck.mts'
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
    // #1027（2026-10-15）：原先如实记的是 `function`——模块对象挂的是 `checks.ts` 里的零参工厂 `checks()`，
    // 而契约那一格写的是数组。定死成「后端交出来的是一张写死的常量表」之后，模块对象挂的是
    // `GITHUB_CHECKS` 本身（那把无人调用的工厂已删），契约跟着收成 `readonly RoomCheckEntry[]`，此处记 `array`。
    checksKind: 'array',
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

/** 门禁自查出来的「一处可疑写法」：行号、原文，以及为什么算可疑（第 2 项用 why 说明落点）。 */
interface GateHit {
  line: number
  text: string
  why?: string
}

let failed = false
const check = (ok: boolean, msg: string): void => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 去掉块注释与整行注释，避免把注释里写的示例当成真的实现（写法沿用 tests/verify-build-artifacts.js）。
 * 块注释按换行数原样垫回空行（#1103）：不垫的话，下面的行号全是错的，人只能对着错行号跳代码。
 * 行号错了不只是难看——指出「第几行有问题」本身就是这道门禁的交付物，行号必须是文件里的真行号。 */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*([\s\S]*?)\*\//g, (m, inner) => String(inner).split('\n').map(() => '').join('\n'))
    .replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

/** 递归收 .ts 文件（含子目录）；跳过 node_modules 与 .d.ts（声明文件本来就只放类型）。 */
function listTsFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (abs: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = []
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
function resolveImportSpec(fromAbs: string, spec: string): string | null {
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
function findRuntimeImports(abs: string, code: string): GateHit[] {
  const hits: GateHit[] = []
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
function findRuntimeImpl(abs: string, code: string): GateHit[] {
  const hits: GateHit[] = []
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

function main(): void {
  // 起点输入摘要（日志埋点纪律第 3 条）：这一趟查的是哪个目录、拿哪份配置编、仓库根在哪。
  // 事后只看日志就能回答「它到底查了什么」，不必回头翻代码或猜环境变量。
  console.log(
    '契约层类型门禁（tsc 零错误 + 无运行时实现 + 后端声明对上契约与入口不断言 + 两条反面证明 + 运行时腿与运行时反面证明）' +
      '｜仓库根 ' + ROOT + '｜契约目录 ' + path.relative(ROOT, CONTRACT_DIR) + '｜配置 ' + path.relative(ROOT, TSCONFIG),
  )

  // ---- 1) 类型检查：tsc 零错误 ----
  // 缺谁谁说话：tsconfig 缺席不再由已撤的第零项数，这里自己判（没有配置可指，也不静默跳过）。
  const tsconfigExists = fs.existsSync(TSCONFIG)
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'))
  let tscBin: string | null = null
  try {
    tscBin = path.join(path.dirname(requireFromRoot.resolve('typescript/package.json')), 'bin', 'tsc')
  } catch (e) {
    check(false, 'typescript 已安装（找不到 typescript/package.json：请先跑 pnpm install，devDependencies 里含 typescript）：' + ((e as Error)?.message || String(e)))
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

  // ---- 3) 后端自己声明了对上契约：三处声明在盘上，替代探针的那条腿也在 ----
  // 这一项的前身是两份贴合探针的编译（探针自己零报错 + 后端文件内部报错数等于基线），#1027 退休。
  // 留下的问题只有一个：「声明还在不在」——把 `satisfies BackendModule` 摘掉，tsc 不会红。
  for (const d of BACKEND_DECLARATIONS) {
    const abs = path.join(ROOT, d.rel)
    if (!fs.existsSync(abs)) {
      check(false, d.what + ' 自己声明了对上契约（' + d.rel + ' 不在盘上）：这一项没做')
      continue
    }
    const code = stripComments(fs.readFileSync(abs, 'utf8'))
    const found = BACKEND_DECLARATION_RE.test(code)
    check(
      found,
      d.what + ' 自己声明了对上契约（' + d.rel + ' 里挂着 `satisfies BackendModule`）' +
        (found ? '' : '：这一句摘掉之后 tsc 不会红，所以本项按文本钉住它；换写法就同步改上面的 BACKEND_DECLARATIONS'),
    )
  }
  {
    // 声明要真被编译检查才算数：看它的是域配置（strict，include 是目录通配，三个后端目录都在里面）
    // 与覆盖对账。本门禁不另养一套账（#1147 决策 8），只确认那条腿还在盘上——腿没了，
    // 这句声明就只是一行文字，不是「编译器是唯一检查者」。
    const altConfig = path.join(ROOT, ALT_DOMAIN_CONFIG_REL)
    const altGate = path.join(ROOT, ALT_COVERAGE_GATE_REL)
    const altConfigOk = fs.existsSync(altConfig)
    const altGateOk = fs.existsSync(altGate)
    check(
      altConfigOk && altGateOk,
      '三个后端的形态由 ' + ALT_DOMAIN_CONFIG_REL + '（strict 域配置，include 是目录通配）与覆盖对账 ' +
        ALT_COVERAGE_GATE_REL + ' 守，两处都在盘上' +
        (!altConfigOk ? '；' + ALT_DOMAIN_CONFIG_REL + ' 不在：三个后端没有类型检查' : '') +
        (!altGateOk ? '；' + ALT_COVERAGE_GATE_REL + ' 不在：覆盖对账那条腿没了' : ''),
    )
  }

  // ---- 3b) 入口不断言：装配点交模块时不许自己断言形状 ----
  // 为什么有这一项：#1192 把 `backendModuleOf` 交模块那三处断言删了，改由它的
  // `Promise<BackendModule>` 返回值类型当检查点——交出来的模块对象形状走样，编译当场报错。
  // 谁在这里重新写下形状断言，就等于把检查点 bypass 掉：之后形状再怎么走样，编译都不会说话。
  // 所以入口文件里一个形状断言也不许有；唯一的形状断言函数是 `registry/shape.ts` 的
  // `validateMod`（注册表在 `core.ts` 里调它，那是运行时那道口）。
  {
    const entryRel = 'src/tracker/registry/builtins.ts'
    const entryAbs = path.join(ROOT, entryRel)
    if (!fs.existsSync(entryAbs)) {
      check(false, '入口文件在盘上（' + entryRel + ' 不在）：入口不断言这一项没做')
    } else {
      const raw = fs.readFileSync(entryAbs, 'utf8')
      const code = stripComments(raw)
      const assertionRe = /\bas\s+(unknown\s+as\s+)?BackendModule\b/
      const hit = assertionRe.exec(code)
      check(
        !hit,
        '入口文件不断言形状（' + entryRel + ' 里没有对 BackendModule 的断言，检查点是返回值类型）' +
          (hit ? '：在「' + hit[0] + '」附近又写下了断言，删掉它，让返回值类型当检查点' : ''),
      )
      // 检查点本身也得在：返回值类型被改成 any / 断言以外的旁路写法，照样等于没检查。
      const checkpointRe = /function\s+backendModuleOf\s*\([^)]*\)\s*:\s*Promise<BackendModule>/
      const checkpoint = checkpointRe.test(code)
      check(
        checkpoint,
        '入口检查点在位（' + entryRel + ' 里 `backendModuleOf` 声明返回 `Promise<BackendModule>`）' +
          (checkpoint ? '' : '：返回值类型被改动过，交错形状编译不再报错，先恢复它'),
      )
      // 旁路写法一并钉死：尖括号断言（`<BackendModule>…`，去掉注释后找）与
      // 检查器静默（`@ts-ignore` / `@ts-expect-error`，注释里找，所以看原文）。
      // 检查点那一行自己的 `Promise<BackendModule>` 是唯一的合法尖括号，先摘掉它再数。
      const withoutCheckpoint = code.replace(checkpointRe, '')
      const angleHit = /<\s*BackendModule\s*>/.test(withoutCheckpoint)
      check(
        !angleHit,
        '入口文件没有尖括号断言（`' + entryRel + '` 里除检查点外不许再出现 `<BackendModule`）' +
          (angleHit ? '：换了种断言写法，同样等于 bypass 检查点，删掉它' : ''),
      )
      const suppressHit = /@ts-(ignore|expect-error)/.test(raw)
      check(
        !suppressHit,
        '入口文件不静默检查器（`' + entryRel + '` 里不许出现 `@ts-ignore` / `@ts-expect-error`，静默等于拆检查点）' +
          (suppressHit ? '：把静默指令删掉，有报错就修形状，不要捂住检查器' : ''),
      )
    }
  }

  // ---- 4) 反面证明：现拼一个缺 matches 的假后端，必须编不过且点名 matches ----
  // 验的是「契约不是摆设」。假文件写进系统临时目录（不进仓库，不污染覆盖对账），编完就删。
  if (!tscBin) {
    check(false, '反面证明能跑（tsc 起不来，这一项没做：见第一项的 FAIL）')
  } else {
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
          (nr.status !== 0 && mentionsMatches ? '' : '（退出码 ' + nr.status + '，' + (mentionsMatches ? '没点名' : '输出里没见到 matches') + '：契约可能断不了缺少成员，速查）'),
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  // 这里原本还有两条：4b「走探针那条路再证一次缺成员」与 4c「基线数的来历链必须首尾相接」。
  // 两条都随贴合探针与那条基线在 #1027 退休（理由见文件头「#1027 退休的两件」）：
  // 探针没了，就没有第二条路可验；基线没了，也就没有来历可对。
  // 注意编号：下面这条是 #1192 新加的「4b」，与上面退休的那条同名不同物——
  // 退休那条走的是探针，这条走的是装配点入口姿势，不要混。

  // ---- 4b) 反面证明·入口姿势：残模块走「函数返回 BackendModule」这个姿势，同样编不过 ----
  // 第四项是「标注姿势」（`const bad: BackendModule = …`）；这一项是「入口姿势」——
  // 装配点 `backendModuleOf` 就是这个姿势（返回值类型是 `Promise<BackendModule>`，交出去靠 `return`）。
  // 两个姿势都要咬得住，缺成员才没有第二条路可走：只删 `satisfies`、形状又走样时，
  // 拦住它的就是这一条所证的检查点（门禁 3b 保证检查点不被断言 bypass）。
  // 残法与第四项同集（缺 matches），报错必须点名 matches。
  if (!tscBin) {
    check(false, '入口姿势反面证明能跑（tsc 起不来，这一项没做：见第一项的 FAIL）')
  } else {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-contract-neg-entry-'))
    try {
      const relToContract = path.relative(tmpDir, path.join(CONTRACT_DIR, 'backend-module.ts')).replace(/\\/g, '/')
      const negFile = path.join(tmpDir, 'negative-entry.ts')
      fs.writeFileSync(
        negFile,
        `import type { BackendModule } from '${relToContract}'\n` +
          `function loadEntry(): BackendModule {\n` +
          `  return { id: 'neg-entry', label: 'neg-entry', ` +
          `create: (() => { throw new Error('neg-entry') }) as unknown as BackendModule['create'] }\n` +
          `}\n` +
          `export const entry = loadEntry\n`,
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
        '缺 matches 的残模块走入口姿势（函数返回 BackendModule）同样编不过、且报错点名 matches' +
          (nr.status !== 0 && mentionsMatches ? '' : '（退出码 ' + nr.status + '，' + (mentionsMatches ? '没点名' : '输出里没见到 matches') + '：入口检查点可能断不了缺少成员，速查）'),
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  // ---- 5) 运行时腿：模块对象真加载，断两档真值 ----
  // 静态检查看不见两样东西：被加宽的字面量（openRepository 的真实取值）与运行时装上去的
  // 检查目录（是数组、是函数、还是没有），所以这两档还得真跑起来看。
  // 键快照已撤（见文件头「再撤四项」）：工厂交出来的键由 satisfies + 三条断言守，这里只看真值。
  {
    const hookAbs = path.join(ROOT, 'scripts', 'ts-hook.mts')
    // --import 吃的是模块说明符，Windows 绝对路径要先转成 file://，裸盘符路径会被 ESM 加载器拒收。
    const hookUrl = pathToFileURL(hookAbs).href
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
      let snap: Record<string, { openRepository?: unknown; checksKind?: string }> | null = null
      try { snap = JSON.parse(String(rr.stdout || '').trim().split(/\r?\n/).pop()) } catch { snap = null }
      if (!snap || !snap.github || !snap.markdown || !snap.gitlab) {
        check(false, '运行时快照读得出来（输出解析失败）：' + String(rr.stdout || '').slice(-200))
      } else {
        // 快照里「不声明」写成 undefined，打印时要能一眼看出来是「不声明」而不是漏填，所以这里换个写法。
        const showRepo = (v: unknown): string => (v === undefined ? '不声明' : JSON.stringify(v))
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
              (!kindSame ? '；checks 种类变了（' + want.checksKind + '→' + got.checksKind + '）：这一档在 #1027 有结论——契约把检查目录定义成一组数据（数组），GitHub 交的是 GITHUB_CHECKS，另两家不声明；再变就是有人动了真源，确认后登记' : ''),
          )
        }
      }
    }
  }

  // ---- 5b) 运行时反面证明：真走一遍注册，垃圾模块必须被拒，有效模块必须能进 ----
  // 验的是「入口断言没被拿掉」。`register` 里调 `validateMod`（`core.ts`）是运行时唯一的
  // 形状入口：谁把这一句删了，缺 `create`/`matches` 的垃圾模块就能注册进去，
  // 编译还不会说话（运行时形状，类型检查看不见）。所以这里真建一个注册表，
  // 拿一个残模块试注册——必须被拒（且理由是形状）；同时拿一个有效最小模块试注册——
  // 必须能进（正控：证明探针自己能建表能注册，拒掉残模块是真咬住了，不是探针坏了啥都拒）。
  {
    const hookAbs = path.join(ROOT, 'scripts', 'ts-hook.mts')
    const hookUrl = pathToFileURL(hookAbs).href
    const evalScript = `import('./src/tracker/registry/core.ts').then((core) => {` +
      ` const reg = core.createRegistry();` +
      ` let garbageRejected = false;` +
      ` try { reg.register({ id: 'neg-entry', label: 'neg-entry' }); } catch (e) { garbageRejected = !!(e && e.code === 'shape'); }` +
      ` let validAccepted = false;` +
      ` try { const d = reg.register({ id: 'pos-entry', label: 'pos-entry', create: () => ({}), matches: () => false }); validAccepted = !!d; } catch (e) { validAccepted = false; }` +
      ` console.log(JSON.stringify({ garbageRejected, validAccepted }));` +
      ` }).catch((e) => { console.log(JSON.stringify({ loadError: String((e && e.message) || e) })); })`
    const rr = spawnSync(process.execPath, ['--import', hookUrl, '--eval', evalScript], { encoding: 'utf8', timeout: 120000 })
    if (rr.error) {
      check(false, '运行时反面证明能跑起来（起进程失败）：' + (rr.error.message || String(rr.error)))
    } else if (rr.status !== 0) {
      check(false, '运行时反面证明能跑起来（退出码 ' + rr.status + '）：' + String(rr.stderr || '').slice(-300))
    } else {
      let got: { garbageRejected?: unknown; validAccepted?: unknown; loadError?: unknown } | null = null
      try { got = JSON.parse(String(rr.stdout || '').trim().split(/\r?\n/).pop()) } catch { got = null }
      if (!got || got.loadError) {
        check(false, '注册表真建得起来（加载 core 失败）：' + String((got && got.loadError) || rr.stdout || '').slice(-200))
      } else {
        check(
          got.garbageRejected === true,
          '缺 create/matches 的残模块真注册时被拒（理由是形状）' +
            (got.garbageRejected === true ? '' : '：注册竟然通过了——`register` 里的形状入口可能被拿掉，速查'),
        )
        check(
          got.validAccepted === true,
          '有效最小模块真注册时能进（正控：探针自己没坏）' +
            (got.validAccepted === true ? '' : '：有效模块都没进去，是探针写法坏了，不是注册表坏了，先修探针'),
        )
      }
    }
  }

  console.log(failed ? '\n存在失败 — 契约层类型门禁没通过' : '\n全部通过 — 契约层类型门禁生效')
  process.exit(failed ? 1 : 0)
}

try {
  main()
} catch (e) {
  console.error('门禁执行异常：' + ((e as Error)?.stack || String(e)))
  process.exit(1)
}
