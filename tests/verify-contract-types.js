// tests/verify-contract-types.js — 契约层类型门禁（deck 重构第二批 B 落地；拆分工加第四项，补判别力加第五、六项）
//
// 门禁归属: src/tracker/contract
// 门禁归属: src/host/tracker/contract.js
// 为什么显式写这两条：契约目录的路径是 resolveInRoot(process.env.DSH_CONTRACT_DIR || 'src/tracker/contract')
// 拼出来的，归属表按字面量路径认不出它，会把这 9 个契约文件算成「没人守」。这两条把归属钉死。
//
// 这个门禁替契约层守六件事，六件都过才算绿：
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
//   四、没有运行时实现：契约层只许有类型与数据，不许出现函数体实现、也不许引运行时模块
//       （只许 `import type` 与逐项 `type` 前缀的内联写法）。发现就判红，并指出文件与行号。
//   五、名录与运行时真源同集（迁移期临时项）：契约层的 OPERATIONS 名录与运行时
//       src/host/tracker/contract.js 的 OPERATIONS 数组必须同集 —— 注册表按后者给没实现的后端补桩，
//       两边不一致就会出现「类型说有、注册表不补桩」，那种错只在运行时才炸。
//       等 contract.js 退休（退休时点由迁移批次定）时，这一项与它一起撤掉。
//   六、`OpName` 声明的成员与运行时真源同集（迁移期临时项，与第五项同生共死）：第五项比的是两份
//       **数组文本**，它盯不住「operations.ts 里那份操作名集合自己跑偏」——例如有人把
//       `export type OpName = (typeof OPERATIONS)[number]` 改回手抄的字面量联合，抄的时候漏一个名字，
//       此时名录数组与运行时仍然同集（第五项绿），而类型层少了一条操作。这一项直接解析 `OpName`
//       自己声明的成员（手写联合就逐个读名字，从名录生成的就照着名录取），与 contract.js 的
//       OPERATIONS 双向求差，差集不为空即判红并列出差异。读不出 `OpName` 的形状也判红，不静默放过。
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
// 已知边界（如实写在文件头，免得以后有人以为它什么都管得住）：第四件事只扫 `function` 关键字、
//   运行时 import、`require(` 与动态 `import(` 四种写法；箭头函数赋值（`const f = () => {}`）与
//   模块顶层表达式（如 `[...].map(...)`）不在扫描范围内——它们在类型文件里正常不该出现，真要管住
//   得靠类型检查与代码审查，写在这里免得门禁给人「全都管住了」的错觉。
//   第二件事只保证「契约目录里的 .ts 都进了这次编译」，管不住「tsconfig 里圈了目录外的文件」——
//   那不是本门禁的辖区。
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
/** 运行时真源的路径：它的 OPERATIONS 数组是注册表补桩的依据，第五、六项都要拿它比同集。 */
const RUNTIME_CONTRACT_REL = 'src/host/tracker/contract.js'

/** 19 个契约操作名（逐字照 research/1010-deck-contract-surface.md 表 E2 与 contract.js 的 OPERATIONS）。 */
const OPERATION_NAMES = [
  'preflight', 'list', 'get', 'getDependencies', 'create', 'close', 'reopen', 'comment', 'update',
  'setLabels', 'setAssignees', 'setParent', 'setBlockedBy', 'getCurrentUser', 'initProject',
  'listLabels', 'setLabelColors', 'counts', 'listPage',
]

let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 去掉块注释与整行注释，避免把注释里写的示例当成真的实现（写法沿用 tests/verify-build-artifacts.js）。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

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

/**
 * 从一段源码里抽出「某个字符串数组里写了哪些名字」。
 * 起止标记由调用方给，因为两份 OPERATIONS 的写法不同：契约层名录用 `as const` 收尾，
 * 运行时那份是 `Object.freeze([...])`。读不出来（标记不见了）回 null，由调用方判红 ——
 * 形状变了要让人看见，不许静默按空集处理（那会把「读不到」说成「两边都空、同集」）。
 */
function namesInArray(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker)
  if (start < 0) return null
  const from = start + startMarker.length
  const end = text.indexOf(endMarker, from)
  if (end < 0) return null
  const body = text.slice(from, end)
  const out = []
  const re = /'([A-Za-z][A-Za-z0-9]*)'/g
  let m
  while ((m = re.exec(body))) out.push(m[1])
  return out
}

/**
 * 找出「引了运行时模块」的 import 行，回 [{line, text}]。
 * 允许两种：`import type ...` 整句类型引；以及命名清单里每一项都带内联 `type ` 前缀的写法
 * （`import { type A, type B } from '...'`）——它转译后不留运行时引用，是契约层合法的写法。
 * 其余一律算运行时引用：带默认绑定、命名空间绑定、裸副作用引、动态 import()。
 */
function findRuntimeImports(code) {
  const hits = []
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const m = /^\s*import\b([\s\S]*)$/.exec(raw)
    if (!m) continue
    const clause = m[1].trim()
    if (/^type\b/.test(clause)) continue                                   // import type ...：允许
    const named = /^\{([\s\S]*?)\}\s*from\s*['"][^'"]*['"]/.exec(clause)   // import { ... } from '...'
    if (named) {
      const parts = named[1].split(',').map((s) => s.trim()).filter(Boolean)
      const allType = parts.length > 0 && parts.every((p) => /^type\s+[A-Za-z_$][\w$]*$/.test(p))
      if (allType) continue
    }
    hits.push({ line: i + 1, text: raw.trim() })
  }
  return hits
}

/**
 * 找出「像运行时实现」的写法，回 [{line, text, why}]。
 * 四种：function 关键字（`declare function` 是声明，放过）、运行时 import、require(、动态 import(。
 */
function findRuntimeImpl(code) {
  const hits = []
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const text = raw.trim()
    const fn = /\bfunction\b/.exec(raw)
    if (fn) {
      const before = raw.slice(0, fn.index).trim()
      if (!/\bdeclare$/.test(before)) hits.push({ line: i + 1, text, why: '出现 function 关键字（契约层只许有类型与数据）' })
    }
    if (/\brequire\s*\(/.test(raw)) hits.push({ line: i + 1, text, why: '出现 require(（运行时取值）' })
    if (/\bimport\s*\(/.test(raw)) hits.push({ line: i + 1, text, why: '出现动态 import(（运行时取值）' })
  }
  for (const h of findRuntimeImports(code)) hits.push({ line: h.line, text: h.text, why: '引了运行时模块（只许 import type）' })
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

/**
 * 从 operations.ts 的文本里解析 `OpName` **自己声明**的成员，回 `{ok:true, names, how}` 或 `{ok:false, why}`。
 * 两种真实写法都要认：
 *  - `(typeof OPERATIONS)[number]`：成员就是名录数组那一份（名录读不出来就判红，不拿它当空集）；
 *  - 手写的字面量联合：逐个把带引号的名字读出来。
 * 别的表达式一律回 ok:false 让调用方判红 —— 形状变了要让人看见，静默按空集处理会把
 * 「读不到」说成「两边都空、同集」，那正是这道门禁最不该犯的错。
 */
function opNameMembers(opsText, catalogNames) {
  const at = opsText.indexOf('export type OpName')
  if (at < 0) return { ok: false, why: '在 ' + OPERATIONS_REL + ' 里找不到 `export type OpName`' }
  const eq = opsText.indexOf('=', at)
  if (eq < 0) return { ok: false, why: '`export type OpName` 后面没有等号，读不出它是什么' }
  const rest = opsText.slice(eq + 1)
  const stop = rest.search(/\n\s*\n/)                    // 声明写到空行为止
  const body = (stop < 0 ? rest : rest.slice(0, stop)).trim()
  if (/^\(\s*typeof\s+OPERATIONS\s*\)\s*\[\s*number\s*\]$/.test(body)) {
    if (!catalogNames) return { ok: false, why: 'OpName 由名录数组生成，但名录件 ' + CATALOG_REL + ' 里的 OPERATIONS 读不出来' }
    return { ok: true, names: catalogNames, how: '按名录数组生成（(typeof OPERATIONS)[number]，成员即名录 ' + catalogNames.length + ' 条）' }
  }
  const quoted = body.match(/'[A-Za-z][A-Za-z0-9]*'/g)
  if (quoted && quoted.length && /^[|'"\sA-Za-z0-9]+$/.test(body)) {
    return { ok: true, names: quoted.map((s) => s.slice(1, -1)), how: '手写的字面量联合（' + quoted.length + ' 条）' }
  }
  return { ok: false, why: 'OpName 既不是 (typeof OPERATIONS)[number]，也不是一串带引号的名字，读不出来：' + body.slice(0, 160) }
}

function main() {
  console.log('契约层类型门禁（tsc 零错误 + 契约目录没漏编 + 19 个操作名齐 + 无运行时实现 + 名录与运行时同集 + OpName 与运行时同集）')

  // ---- 0) 缺件即红：契约目录、tsconfig、operations.ts 三样少任何一样都判红 ----
  // 旧写法是打印「等 A 落地后再跑」并 exit(0)：那在验证链里就是一条绿，与「真源写完且都对」看不出区别。
  // 现在缺件当场记一条 FAIL，退出码由文件末尾统一按 failed 收口；下面各步再按「手上有什么」决定做不做。
  const dirExists = fs.existsSync(CONTRACT_DIR) && fs.statSync(CONTRACT_DIR).isDirectory()
  const tsconfigExists = fs.existsSync(TSCONFIG)
  const opsExists = fs.existsSync(path.join(CONTRACT_DIR, OPERATIONS_REL))
  const missing = []
  if (!dirExists) missing.push(path.relative(ROOT, CONTRACT_DIR) + '（目录）')
  if (!tsconfigExists) missing.push(path.relative(ROOT, TSCONFIG))
  if (dirExists && !opsExists) missing.push(path.relative(ROOT, path.join(CONTRACT_DIR, OPERATIONS_REL)))
  check(
    missing.length === 0,
    '三样输入齐（契约目录 ' + path.relative(ROOT, CONTRACT_DIR) + '、' + path.relative(ROOT, TSCONFIG) + '、' + OPERATIONS_REL + '）' +
      (missing.length ? '，缺：' + missing.join('、') + '——缺件不是「等它落地」，是这里判红' : '，三样都在'),
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

  // ---- 4) 没有运行时实现：只许类型与数据 ----
  if (!tsFiles.length) {
    // 第 2 步已经为「一个 .ts 都没有」判过红，这里不再重复同一条。
  } else {
    let bad = 0
    for (const abs of tsFiles) {
      const code = stripComments(fs.readFileSync(abs, 'utf8'))
      const hits = findRuntimeImpl(code)
      const rel = path.relative(ROOT, abs)
      if (!hits.length) continue
      bad += 1
      for (const h of hits) console.log('  FAIL ' + rel + ':' + h.line + ' ' + h.why + ' → ' + h.text.slice(0, 160))
      failed = true
    }
    check(bad === 0, '契约目录下 ' + tsFiles.length + ' 个 .ts 文件都没有运行时实现（只许类型与数据）')
  }

  // ---- 5) 名录与运行时真源同集（迁移期临时项，contract.js 退休时撤） ----
  const runtimePath = path.join(ROOT, RUNTIME_CONTRACT_REL)
  if (!fs.existsSync(catalogPath)) {
    check(false, '名录件在（缺 ' + path.relative(ROOT, catalogPath) + '：操作名没地方写，第五项比不了）')
  } else if (!fs.existsSync(runtimePath)) {
    check(false, '运行时真源在（缺 ' + RUNTIME_CONTRACT_REL + '：第五项没法比同集；若它已退休，本项与该分支一起删）')
  } else {
    const catNames = namesInArray(catalogCode, 'export const OPERATIONS = [', '] as const')
    const rtNames = namesInArray(
      stripComments(fs.readFileSync(runtimePath, 'utf8')),
      'export const OPERATIONS = Object.freeze([',
      '])',
    )
    if (!catNames || !rtNames) {
      check(false, '两份 OPERATIONS 都读得出来（有一份的写法变了、起止标记没命中：' +
        (catNames ? '' : '名录件 ') + (rtNames ? '' : '运行时真源 ') + '读不出来，请先核对写法再改本门禁）')
    } else {
      const rtSet = new Set(rtNames)
      const catSet = new Set(catNames)
      const onlyCat = catNames.filter((n) => !rtSet.has(n))
      const onlyRt = rtNames.filter((n) => !catSet.has(n))
      check(
        onlyCat.length === 0 && onlyRt.length === 0,
        '名录与运行时 contract.js 的 OPERATIONS 同集（名录 ' + catNames.length + ' 条、运行时 ' + rtNames.length + ' 条' +
          (onlyCat.length || onlyRt.length
            ? '；只在名录里：' + (onlyCat.join('、') || '无') + '；只在运行时里：' + (onlyRt.join('、') || '无')
            : '，逐条比过') + '）',
      )
    }
  }

  // ---- 6) `OpName` 声明的成员与运行时真源同集（迁移期临时项，contract.js 退休时与第五项一起撤） ----
  // 第五项比的是两份**数组文本**；它盯不住「operations.ts 里那份操作名集合自己跑偏」：
  // 把 `export type OpName = (typeof OPERATIONS)[number]` 改回手抄的字面量联合、抄漏一个名字，
  // 名录数组与运行时仍然同集（第五项绿），而类型层少了一条操作。这一项直接读 `OpName` 自己声明的成员。
  if (!fs.existsSync(runtimePath)) {
    // 第五项已经为「运行时真源不在」判过红，这里不重复同一条。
  } else if (!opsText) {
    // operations.ts 缺席（第 0 步已判红）：没有 OpName 可读，如实记一条，不静默跳过。
    check(false, 'OpName 声明的成员能读出来（' + OPERATIONS_REL + ' 不在，这一项没做：见第 0 步的 FAIL）')
  } else {
    const catalogNames = namesInArray(catalogCode, 'export const OPERATIONS = [', '] as const')
    const parsed = opNameMembers(opsText, catalogNames)
    const rtNames6 = namesInArray(
      stripComments(fs.readFileSync(runtimePath, 'utf8')),
      'export const OPERATIONS = Object.freeze([',
      '])',
    )
    if (!parsed.ok) {
      check(false, 'OpName 声明的成员读得出来（' + parsed.why + '）')
    } else if (!rtNames6) {
      check(false, '运行时 contract.js 的 OPERATIONS 读得出来（起止标记没命中：读不出来就没法比同集，请先核对写法再改本门禁）')
    } else {
      const rtSet6 = new Set(rtNames6)
      const opSet6 = new Set(parsed.names)
      const onlyOp = parsed.names.filter((n) => !rtSet6.has(n))
      const onlyRt6 = rtNames6.filter((n) => !opSet6.has(n))
      check(
        onlyOp.length === 0 && onlyRt6.length === 0,
        'OpName 声明的成员与运行时 contract.js 的 OPERATIONS 同集（' + parsed.how + '；运行时 ' + rtNames6.length + ' 条' +
          (onlyOp.length || onlyRt6.length
            ? '；只在 OpName 里：' + (onlyOp.join('、') || '无') + '；只在运行时里：' + (onlyRt6.join('、') || '无')
            : '，双向逐条比过，两个差集都空') + '）',
      )
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
