// tests/verify-contract-types.js — 契约层类型门禁（deck 重构第二批 B 落地；#1026 收尾重定口径）
//
// 门禁归属: src/tracker/contract
// 门禁归属: src/tracker/contract/index.ts
// 为什么显式写这两条：契约目录的路径是 resolveInRoot(process.env.DSH_CONTRACT_DIR || 'src/tracker/contract')
// 拼出来的，归属表按字面量路径认不出它，会把这些契约文件算成「没人守」。这两条把归属钉死。
//
// 这个门禁替契约层守八件事，八件都过才算绿：
//   零、缺件即红：契约目录、tsconfig、operations.ts、两份贴合探针，少任何一样都判红。
//   一、类型检查：用仓库 devDependencies 里的 typescript 跑一遍 `tsc -p tsconfig.contract.json`，
//       零错误才算过；tsc 的输出原样透出，看错在哪一行不用再自己跑一遍。
//   二、契约目录的文件一个都没漏编：自己列出契约目录下全部 .ts（`listTsFiles`），再拿
//       `tsc -p … --listFiles` 那份「这次真的编了哪些文件」的清单逐一对账，姓名与数量对不上就判红。
//       为什么要有这一条：第一件只说「编过的文件里没有错」，它管不住「某个文件根本没进编译」——
//       tsconfig 的 include 被改窄、文件放进没被圈到的子目录、名字打成 `*.tsx`，都会让一个偷偷
//       写错的类型文件全程隐身而门禁照样绿。这一条把「在不在编译范围里」变成可判定的。
//   三、接口清单齐：读 operations.ts 与 operations-catalog.ts 两份文本，断言 19 个契约操作名
//       全部出现，缺哪个报哪个（名字清单与 research/1010-deck-contract-surface.md 表 E2 的 19 项逐字一致）。
//       为什么要读两份：拆分工把操作名改成「名录单源」——名字住在 operations-catalog.ts，
//       operations.ts 只从它生类型；只扫一份会漏掉真正的住处。
//   四、没有运行时实现：契约目录只许有类型与数据。禁六种：`function` 关键字、
//       `class` 关键字、箭头函数赋值（`const f = (…) => …`）、顶层 `new`（只有
//       `Object.freeze` 与字面量是合法的数据写法）、`require(`、动态 `import(`；
//       值引用只许目录内互引（数据引数据，目标文件自己也过这一条，所以不形成行为入口），
//       指到目录外的、包名的、裸副作用引用的，一律判红。发现就判红，并指出文件与行号。
//   五、贴合探针能编译：两份探针（GitHub / Markdown 后端）用宽松开关直编，探针文件自己
//       一条报错都不能有（成员缺了、形状写歪了，第一落点就是这里）；后端文件内部自己的
//       报错（旧语言时代的联合收窄、参数个数这类）另行计数，必须与本文件记的基线逐字相等——
//       多了是新增债务，少了是有人修了实现面（那要先把基线数改过来，并考虑把探针收紧）。
//   六、反面证明：现拼一个缺 `matches` 的假后端，拿同一套严格开关编它，必须编不过、
//       且报错里点名 `matches`。这条验的是「探针不是摆设」——它断得了缺少成员，真后端
//       哪天丢了一个必填，探针一定红。
//   七、运行时腿：把三个后端模块对象真加载起来，断三件事——`openRepository` 只能是
//       `'url'` / `'folder'` / 不声明（静态探针断不了被加宽的字面量，这里断真值）；
//       `checks` 的种类如实记录（数组 / 函数 / 不声明）；模块对象的键集合必须与本文件
//       记的快照逐字相等（加一个成员、删一个成员，都先回答「契约里有没有它」再登记）。
//
// 撤掉的两项（决定人与理由见 #1026 正文：维护者拍板，两条同集断言归 #1026，随本次改写撤掉）：
//   旧五、旧六（名录与运行时真源同集、OpName 与运行时同集）是迁移期的临时脚手架——
//   当时契约名录与运行时各有一份操作清单，要人眼对齐。#1026 把运行时的值收进契约目录
//   （`index.ts` 的 `OPERATIONS` 改成从名录转出，同一份数组、同一个引用），没有第二份
//   手写副本之后，这两项就没有东西可比了，留着只会永远红。决定人与理由见 #1026 正文。
//
// 缺件即红（2026-10-12 改口径，旧口径见下）：契约目录、tsconfig、operations.ts 三样输入少任何一样，
//   都当场 `check(false, …)` 并走到非零退出。旧口径是打印一行「等 A 落地后再跑」然后 `exit(0)`，
//   理由是当时与写契约真源的另一路子任务并行开发、不想阻塞别人；代价是缺件在验证链里等于一条绿，
//   而「真源没写完」与「真源写完且都对」在链上看不出区别。并行期已经过去，这个口子必须堵上：
//   缺件本身就是要人看见的事故，不是可以跳过的等待。缺件时后续依赖它的判断会一并跳过，
//   但第 0 步那条 FAIL 已经把退出码钉在非零上，链不会绿。
//
// 自测钩子（只给门禁自己验证「判红能力」用，正常跑不要传）：
//   DSH_CONTRACT_DIR      覆盖契约目录，缺省 src/tracker/contract
//   DSH_CONTRACT_TSCONFIG 覆盖 tsconfig 路径，缺省仓库根的 tsconfig.contract.json
//   相对路径按仓库根解析，绝对路径原样用。
//
// 已知边界（如实写在文件头，免得以后有人以为它什么都管得住）：
//   第四件事是行级扫描：`function` / `class` 关键字、`const f = (…) => …` 形的箭头赋值、
//   `= new …` 形的顶层构造、`require(`、动态 `import(`、指到目录外的值引用。
//   跨行写的箭头（`=` 与 `=>` 不在同一行）扫不到——真要管住得靠类型检查与代码审查。
//   `new` 只认 `=` 之后的（值初始化形状），构造器类型（`new (x: …): T`，冒号形状）不在此列。
//   第二件事只保证「契约目录里的 .ts 都进了这次编译」，管不住「tsconfig 里圈了目录外的文件」——
//   那不是本门禁的辖区（但本门禁跑的那次 tsc 会把圈到的目录外文件一起检查，错了一样红）。
//   第五件事不审后端实现内部：旧语言文件的内部报错只计数（基线在下面），审它们是迁移批次的事；
//   探针弱化的三处（`create` 返回深层、`openRepository` 字面量、`checks` 种类）各有去处——
//   前两处一个留后续专票、一个由第七项断真值，`checks` 数组还是工厂也由第七项如实记录。
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
const OPERATIONS_REL = 'operations.ts'
/** 操作名录的住处（拆分工起的单源文件）：操作名真正写在这里，operations.ts 只从它生类型。 */
const CATALOG_REL = 'operations-catalog.ts'
/** 两份贴合探针：静态腿的输入。缺了它们，第五项没法编，缺件即红。 */
const PROBE_GITHUB_REL = 'tests/contract-probe-github.ts'
const PROBE_MARKDOWN_REL = 'tests/contract-probe-markdown.ts'
/**
 * 探针直编时，后端文件内部自己的报错数（旧语言时代的联合收窄、参数个数这类，
 * 实现面的债，不归本门禁审）。必须逐字相等：多了是新增债务，少了是有人动了实现面。
 *
 * 2026-10-14 由 200 改到 156（#1111「报错判据收成一源，失败结果带原文」）：那一票把各后端的失败构造
 * 从「手写 message 字面量」换成跟踪器层统一的 fail(kind, message, raw) 与各房带类型的辅助函数，
 * 旧语言时代那种「对象字面量对不上联合类型」的内部报错随之减少——这是实现面真的动了，不是门禁放松。
 * 同日又由 156 改到 155：关闭后那轮对抗式审查发现两个后端的逐条改色失败没带原文，把 GitHub 房那条
 * 逐条失败改成走 fail()、其余各条补上第三段，实现面再动一处，内部报错又少一条。
 * 探针要不要跟着收紧（把弱化面收掉、让这个数继续降）归 #1095 那条测试跟随线，本票不动它。
 */
const PROBE_NONPROBE_ERROR_BASELINE = 155
/** 探针直编的开关（与探针文件头写的口径一致，改一处两处一起改）。 */
const PROBE_TSC_ARGS = [
  '--noEmit', '--target', 'es2020', '--lib', 'es2020,dom', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--allowJs', '--checkJs', 'false',
  '--skipLibCheck', '--strict', 'false',
]
/**
 * 运行时腿的快照（#1026 实测；GitLab 一份按 #1110 实现决定第 15 条补上）：三个模块对象的键集合
 * 与两个断不了字面量的真值。键加了、减了、真值变了，都先回答「契约里有没有它」（`BackendModule`），
 * 确认后把新快照记进来；若契约要跟着改，改完再记。快照比较不看顺序（键按字母排过再比）。
 * 别名窗口（#1110 实现决定第 14 条）：契约层与注册表今天已经同时认新名字
 * （`issueAddress`/`issueRefPattern`/`repoSearchAddress`）与老名字。三家各自迁到新名字是分房进行的小票
 * （房间纪律：一次会话只改一房），谁迁完谁把自己这一份快照加上新键。
 * 现况：三家都已迁完（#1133 GitHub、#1134 本地 Markdown、#1135 GitLab，2026-10-14），
 * 三份快照因此六个名字都在——三个新名字是主，三个老名字是同一份实现的别名。
 */
const RUNTIME_SNAPSHOTS = {
  github: {
    keys: ['capabilities', 'checks', 'create', 'describe', 'fixes', 'id', 'issueAddress', 'issueRefPattern', 'issueUrl', 'label', 'linkPattern', 'links', 'matches', 'openRepository', 'presentation', 'prompts', 'repoSearchAddress', 'searchUrl', 'setupPrompt'],
    openRepository: 'url',
    checksKind: 'function',
  },
  markdown: {
    keys: ['create', 'describe', 'fixes', 'id', 'issueAddress', 'issueRefPattern', 'issueUrl', 'label', 'labelPalette', 'linkPattern', 'links', 'matches', 'openRepository', 'presentation', 'prompts', 'repoSearchAddress', 'searchUrl', 'setupPrompt'],
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
    keys: ['create', 'describe', 'fixes', 'id', 'issueAddress', 'issueRefPattern', 'issueUrl', 'label', 'linkPattern', 'links', 'matches', 'openRepository', 'presentation', 'prompts', 'repoSearchAddress', 'searchUrl', 'setupPrompt'],
    openRepository: 'url',
    checksKind: 'absent',
  },
}

/** 19 个契约操作名（逐字照 research/1010-deck-contract-surface.md 表 E2 与 contract.js 的 OPERATIONS）。 */
const OPERATION_NAMES = [
  'preflight', 'list', 'get', 'getDependencies', 'create', 'close', 'reopen', 'comment', 'update',
  'setLabels', 'setAssignees', 'setParent', 'setBlockedBy', 'getCurrentUser', 'initProject',
  'listLabels', 'setLabelColors', 'counts', 'listPage',
]

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

/** 名字出现判定：前后不能是标识符字符，免得 list 命中 listPage、get 命中 getDependencies。 */
function hasName(text, name) {
  return new RegExp('(^|[^A-Za-z0-9_$])' + name + '([^A-Za-z0-9_$]|$)').test(text)
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

/**
 * 从 `tsc --listFiles` 的输出里挑出「这次真的编了哪些 .ts」，回绝对路径数组。
 * 那份输出是每行一个路径，还混着 lib.*.d.ts 这些语言库；报错行长得不一样（带 `(行,列)`），
 * 所以只认「整行就是一个以 .ts 收尾的绝对路径」这一种，其余一律不当文件：
 * 误把报错行当文件会让对账多出一个幽灵条目、把好好的状态判成红，宁可漏认也不误认。
 */
function parseListedTsFiles(out) {
  const seen = new Set()
  for (const raw of String(out || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || !line.endsWith('.ts')) continue
    if (/\(\d+,\d+\)/.test(line)) continue              // 报错行：path(行,列): error TS…
    if (/\s/.test(line)) continue                        // 路径里不该有空白（有就说明这行是别的东西）
    if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(line)) continue   // 只认绝对路径（tsc 给的就是绝对路径）
    seen.add(line)
  }
  return Array.from(seen)
}

/** 路径归一成比较用的键：反斜杠换正斜杠、去末尾斜杠；Windows 的盘符不分大小写。 */
function normPathKey(p) {
  const s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/** 这个路径是不是落在某个目录里（按归一后的键比，含该目录自己）。 */
function inDir(file, dir) {
  const f = normPathKey(file)
  const d = normPathKey(dir)
  return f === d || f.startsWith(d + '/')
}

function main() {
  console.log('契约层类型门禁（缺件即红 + tsc 零错误 + 没漏编 + 19 操作名齐 + 无运行时实现 + 探针编译 + 反面证明 + 运行时腿）')

  // ---- 0) 缺件即红：契约目录、tsconfig、operations.ts、两份探针，少任何一样都判红 ----
  // 旧写法是打印「等 A 落地后再跑」并 exit(0)：那在验证链里就是一条绿，与「真源写完且都对」看不出区别。
  // 现在缺件当场记一条 FAIL，退出码由文件末尾统一按 failed 收口；下面各步再按「手上有什么」决定做不做。
  const dirExists = fs.existsSync(CONTRACT_DIR) && fs.statSync(CONTRACT_DIR).isDirectory()
  const tsconfigExists = fs.existsSync(TSCONFIG)
  const opsExists = fs.existsSync(path.join(CONTRACT_DIR, OPERATIONS_REL))
  const probeGithubExists = fs.existsSync(path.join(ROOT, PROBE_GITHUB_REL))
  const probeMarkdownExists = fs.existsSync(path.join(ROOT, PROBE_MARKDOWN_REL))
  const missing = []
  if (!dirExists) missing.push(path.relative(ROOT, CONTRACT_DIR) + '（目录）')
  if (!tsconfigExists) missing.push(path.relative(ROOT, TSCONFIG))
  if (dirExists && !opsExists) missing.push(path.relative(ROOT, path.join(CONTRACT_DIR, OPERATIONS_REL)))
  if (!probeGithubExists) missing.push(PROBE_GITHUB_REL)
  if (!probeMarkdownExists) missing.push(PROBE_MARKDOWN_REL)
  check(
    missing.length === 0,
    '五样输入齐（契约目录 ' + path.relative(ROOT, CONTRACT_DIR) + '、' + path.relative(ROOT, TSCONFIG) + '、' + OPERATIONS_REL + '、两份探针）' +
      (missing.length ? '，缺：' + missing.join('、') + '——缺件不是「等它落地」，是这里判红' : '，五样都在'),
  )

  // ---- 1) 类型检查：tsc 零错误 ----
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
  if (tscBin && !tsconfigExists) {
    // 第 0 步已经判红；这里不再跑 tsc（没有配置可指），也不重复报同一件事。
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

  // ---- 2) 契约目录的文件一个都没漏编 ----
  // 第 1 步只说「这次编过的文件里没有错」，它管不住「某个文件根本没进这次编译」。
  // 这里另跑一次 tsc 要 `--listFiles` 的清单（与第 1 步分开跑：清单会把报错区淹掉，一次求错一次求清单各管一头），
  // 拿它与自己列出来的契约目录 .ts 逐一对账；名字或数量对不上都判红。
  const tsFiles = dirExists ? listTsFiles(CONTRACT_DIR) : []
  if (!tsFiles.length) {
    check(false, '契约目录下有 .ts 文件（一个都没有：第 0 步的缺件判红之外，这里也没什么可对账的）')
  } else if (!tscBin) {
    // tsc 起不来（已在上一步判红）：没有清单可对账，如实记一条，不静默跳过。
    check(false, '契约目录 ' + tsFiles.length + ' 个 .ts 都能对账（tsc 起不来，这一项没做：见上一条 FAIL）')
  } else {
    const rl = spawnSync(process.execPath, [tscBin, '-p', TSCONFIG, '--listFiles'], { encoding: 'utf8' })
    if (rl.error) {
      check(false, 'tsc --listFiles 能跑起来（起进程失败）：' + (rl.error.message || String(rl.error)))
    } else {
      const listed = parseListedTsFiles((rl.stdout || '') + (rl.stderr || ''))
      // 只比契约目录那一部分（tsc 还会列 lib.*.d.ts 这些语言库；它们不在本门禁辖区）。
      // 与本门禁自己的 listTsFiles 同口径：都排除 .d.ts，只收 .ts。
      const listedHere = listed.filter((p) => inDir(p, CONTRACT_DIR) && !p.endsWith('.d.ts'))
      const listedKeys = new Set(listedHere.map(normPathKey))
      const notCompiled = tsFiles.filter((abs) => !listedKeys.has(normPathKey(abs)))
      const extraInList = listedHere.filter((abs) => !tsFiles.some((f) => normPathKey(f) === normPathKey(abs)))
      check(
        notCompiled.length === 0 && extraInList.length === 0,
        '契约目录 ' + tsFiles.length + ' 个 .ts 全部进了这次编译（tsc 清单里本目录 ' + listedHere.length + ' 个）' +
          (notCompiled.length ? '；没进编译：' + notCompiled.map((p) => path.relative(ROOT, p)).join('、') : '') +
          (extraInList.length ? '；只在清单里：' + extraInList.map((p) => path.relative(ROOT, p)).join('、') : ''),
      )
    }
  }

  // ---- 3) 接口清单齐：19 个操作名一个不少 ----
  // 名字的**住处**是名录件 operations-catalog.ts，operations.ts 只从它生类型，
  // 所以两份合起来查：只扫 operations.ts 会在「名录单源」之后漏掉真正写名字的地方。
  // operations.ts 缺席时（第 0 步已判红）这里不读文件、只走名录件那一半，免得抛异常打断整趟检查。
  const catalogPath = path.join(CONTRACT_DIR, CATALOG_REL)
  const catalogCode = fs.existsSync(catalogPath) ? stripComments(fs.readFileSync(catalogPath, 'utf8')) : ''
  const opsPath = path.join(CONTRACT_DIR, OPERATIONS_REL)
  const opsText = fs.existsSync(opsPath) ? stripComments(fs.readFileSync(opsPath, 'utf8')) : ''
  const opsCode = opsText + '\n' + catalogCode
  const missingOps = OPERATION_NAMES.filter((n) => !hasName(opsCode, n))
  check(missingOps.length === 0, '19 个契约操作名全部出现' + (missingOps.length ? '，缺：' + missingOps.join('、') : '（' + OPERATION_NAMES.length + ' 个逐个查过，含名录件 ' + CATALOG_REL + '）'))

  // ---- 4) 没有运行时实现：契约目录只许类型与数据，目录内数据互引除外 ----
  if (!tsFiles.length) {
    // 第 2 步已经为「一个 .ts 都没有」判过红，这里不再重复同一条。
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

  // ---- 5) 贴合探针能编译：探针文件自己零报错，后端内部报错数与基线相等 ----
  // 探针直编不经任何 tsconfig（命令行开关）：后端入口会把半个房间拖进编译程序，
  // 经配置编会触发覆盖对账的重复归属；开关与探针文件头写的口径一致，改一处两处一起改。
  if (!probeGithubExists || !probeMarkdownExists) {
    // 第 0 步已经为缺探针判过红，这里不再重复同一条。
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
        '后端文件内部报错 ' + nonProbeCount + ' 条，与基线 ' + PROBE_NONPROBE_ERROR_BASELINE + ' 条相等' +
          (nonProbeCount === PROBE_NONPROBE_ERROR_BASELINE
            ? '（实现面的债，审它们是迁移批次的事）'
            : '——多了是新增债务，少了是有人动了实现面：先把基线数改过来，并考虑把探针收紧'),
      )
      if (nonProbeCount !== PROBE_NONPROBE_ERROR_BASELINE) failed = true
    }
  }

  // ---- 6) 反面证明：现拼一个缺 matches 的假后端，必须编不过且点名 matches ----
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

  // ---- 7) 运行时腿：模块对象真加载，断真值与键快照 ----
  // 静态探针断不了被加宽的字面量（openRepository）与数组/工厂之争（checks），这里断真值；
  // 键集合与快照逐字比：加减成员都先回答「契约里有没有它」再登记。
  {
    const hookAbs = path.join(ROOT, 'scripts', 'ts-hook.mjs')
    // --import 吃的是模块说明符，Windows 绝对路径要先转成 file://，裸盘符路径会被 ESM 加载器拒收。
    const hookUrl = require('url').pathToFileURL(hookAbs).href
    // 三家现在都是 .ts 真源（GitHub #1133、本地 Markdown #1134、GitLab #1135，2026-10-14 同日收口），
    // 所以这里三家都直接点 .ts：走的是真源，不是构建产物，也不必依赖加载钩子的「同名 .ts 优先」那一步。
    const evalScript = `Promise.all([import('./src/tracker/rooms/github/index.ts'), import('./src/tracker/rooms/markdown/index.ts'), import('./src/tracker/rooms/gitlab/index.ts')]).then(([g, m, l]) => {` +
      ` const kind = (v) => v === undefined ? 'absent' : (Array.isArray(v) ? 'array' : (typeof v === 'function' ? 'function' : typeof v));` +
      ` console.log(JSON.stringify({` +
      ` github: { keys: Object.keys(g.githubModule).sort(), openRepository: g.githubModule.openRepository, checksKind: kind(g.githubModule.checks) },` +
      ` markdown: { keys: Object.keys(m.markdownModule).sort(), openRepository: m.markdownModule.openRepository, checksKind: kind(m.markdownModule.checks) },` +
      ` gitlab: { keys: Object.keys(l.gitlabBackend).sort(), openRepository: l.gitlabBackend.openRepository, checksKind: kind(l.gitlabBackend.checks) }}))` +
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
          const keysOk = JSON.stringify(got.keys) === JSON.stringify(want.keys)
          const repoOk = got.openRepository === undefined || got.openRepository === 'url' || got.openRepository === 'folder'
          const repoSame = got.openRepository === want.openRepository
          const kindSame = got.checksKind === want.checksKind
          check(
            keysOk && repoOk && repoSame && kindSame,
            name + ' 模块对象与快照一致（键 ' + got.keys.length + ' 个、openRepository=' + showRepo(got.openRepository) + '、checks=' + got.checksKind + ')' +
              (!keysOk ? '；键集合变了：先确认增减的成员有没有契约覆盖，确认后把新快照记进本门禁' : '') +
              (!repoOk ? '；openRepository 不是 url/folder/不声明：判红' : '') +
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
