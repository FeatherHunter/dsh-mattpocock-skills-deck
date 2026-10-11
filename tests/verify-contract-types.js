// tests/verify-contract-types.js — 契约层类型门禁（deck 重构第二批 B 落地）
//
// 这个门禁替契约层守三件事，三件都过才算绿：
//   一、类型检查：用仓库 devDependencies 里的 typescript 跑一遍 `tsc -p tsconfig.contract.json`，
//       零错误才算过；tsc 的输出原样透出，看错在哪一行不用再自己跑一遍。
//   二、接口清单齐：读 src/tracker/contract/operations.ts 的文本，断言 19 个契约操作名全部出现，
//       缺哪个报哪个（名字清单与 research/1010-deck-contract-surface.md 表 E2 的 19 项逐字一致）。
//   三、没有运行时实现：契约层只许有类型与数据，不许出现函数体实现、也不许引运行时模块
//       （只许 `import type` 与逐项 `type` 前缀的内联写法）。发现就判红，并指出文件与行号。
//
// 并行期规则（为什么文件不存在时退出码是 0 而不是 1）：本门禁与写契约真源的那一路子任务并行开发，
//   真源目录、tsconfig 与操作清单三样都可能还没落地。缺任何一样就打印一行「等 A 落地后再跑」、
//   把缺的东西逐个列出来、退出 0，不阻塞别人的验证。三样齐了才按正式规则判红：
//   tsc 有错、清单里缺名字、出现运行时实现，三种都判红。
//   注意这条口径的代价（如实写在这里）：只要 operations.ts 一直不落地，第二件事就一直是「跳过」而不是
//   「失败」；所以缺件时打印的那一行会点名它，谁看到都该知道契约真源还没写完，而不是以为已经绿了。
//
// 自测钩子（只给门禁自己验证「判红能力」用，正常跑不要传）：
//   DSH_CONTRACT_DIR      覆盖契约目录，缺省 src/tracker/contract
//   DSH_CONTRACT_TSCONFIG 覆盖 tsconfig 路径，缺省仓库根的 tsconfig.contract.json
//   相对路径按仓库根解析，绝对路径原样用。
//
// 已知边界（如实写在文件头，免得以后有人以为它什么都管得住）：第三件事只扫 `function` 关键字、
//   运行时 import、`require(` 与动态 `import(` 四种写法；箭头函数赋值（`const f = () => {}`）与
//   模块顶层表达式（如 `[...].map(...)`）不在扫描范围内——它们在类型文件里正常不该出现，真要管住
//   得靠类型检查与代码审查，写在这里免得门禁给人「全都管住了」的错觉。
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

/** 19 个契约操作名（逐字照 research/1010-deck-contract-surface.md 表 E2 与 contract.js 的 OPERATIONS）。 */
const OPERATION_NAMES = [
  'preflight', 'list', 'get', 'getDependencies', 'create', 'close', 'reopen', 'comment', 'update',
  'setLabels', 'setAssignees', 'setParent', 'setBlockedBy', 'getCurrentUser', 'initProject',
  'listLabels', 'setLabelColors', 'counts', 'listPage',
]

let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 去掉块注释与整行注释，避免把注释里写的示例当成真的实现（写法沿用 verify-label-color-freshness.js）。 */
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

function main() {
  console.log('契约层类型门禁（tsc 零错误 + 19 个操作名齐 + 无运行时实现）')

  // ---- 0) 并行期：三样输入缺任何一样就不阻塞 ----
  const dirExists = fs.existsSync(CONTRACT_DIR) && fs.statSync(CONTRACT_DIR).isDirectory()
  const tsconfigExists = fs.existsSync(TSCONFIG)
  const opsExists = fs.existsSync(path.join(CONTRACT_DIR, OPERATIONS_REL))
  if (!dirExists || !tsconfigExists || !opsExists) {
    const missing = []
    if (!dirExists) missing.push(path.relative(ROOT, CONTRACT_DIR) + '（目录）')
    if (!tsconfigExists) missing.push(path.relative(ROOT, TSCONFIG))
    if (dirExists && !opsExists) missing.push(path.relative(ROOT, path.join(CONTRACT_DIR, OPERATIONS_REL)))
    console.log('等 A 落地后再跑：还缺 ' + missing.join('、') + '。契约真源由并行的另一路子任务写，本门禁此刻不判红、退出码 0。')
    process.exit(0)
  }

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
  if (tscBin) {
    const r = spawnSync(process.execPath, [tscBin, '-p', TSCONFIG], { encoding: 'utf8' })
    if (r.error) {
      check(false, 'tsc 能跑起来（起进程失败）：' + (r.error.message || String(r.error)))
    } else {
      const out = (r.stdout || '') + (r.stderr || '')
      if (out.trim()) console.log('--- tsc 输出原样透出 ---\n' + out.replace(/\s+$/, '') + '\n--- tsc 输出结束 ---')
      check(r.status === 0, 'tsc -p ' + path.relative(ROOT, TSCONFIG) + ' 零错误' + (r.status === 0 ? '' : '（退出码 ' + r.status + '，错误见上面原样输出）'))
    }
  }

  // ---- 2) 接口清单齐：19 个操作名一个不少 ----
  // 到这里 operations.ts 一定在（第 0 步的并行期检查已经拦下缺件的情况），所以直接读、直接查名字。
  const opsCode = stripComments(fs.readFileSync(path.join(CONTRACT_DIR, OPERATIONS_REL), 'utf8'))
  const missingOps = OPERATION_NAMES.filter((n) => !hasName(opsCode, n))
  check(missingOps.length === 0, '19 个契约操作名全部出现' + (missingOps.length ? '，缺：' + missingOps.join('、') : '（' + OPERATION_NAMES.length + ' 个逐个查过）'))

  // ---- 3) 没有运行时实现：只许类型与数据 ----
  const tsFiles = listTsFiles(CONTRACT_DIR)
  if (!tsFiles.length) {
    check(false, '契约目录下有 .ts 文件（一个都没有，说明真源还没写进来）')
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

  console.log(failed ? '\n存在失败 — 契约层类型门禁没通过' : '\n全部通过 — 契约层类型门禁生效')
  process.exit(failed ? 1 : 0)
}

try {
  main()
} catch (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
}
