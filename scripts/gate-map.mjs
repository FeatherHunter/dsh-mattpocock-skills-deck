#!/usr/bin/env node
// scripts/gate-map.mjs —— 门禁归属表生成器：算出「每扇门禁守着哪些源码路径」，写进 tests/gate-map.json。
//
// 为什么要有它：
//   npm run verify 是一条两百多步的长链（清单写在 package.json 的 scripts.verify 里）。
//   改一个文件就把整条链跑一遍太贵，维护者要的是「改了 E 目录的代码，就只跑守着 E、
//   守着它的父目录 B、再上一级 A 的门禁」。要按这个规则挑门禁，先得有一张表回答
//   「每扇门禁守着哪些目录」。本脚本生成这张表，scripts/lib/select-gates.mjs 用它挑门禁。
//
// 用法（在仓库根目录跑）：
//   node scripts/gate-map.mjs            重新推导并写入 tests/gate-map.json
//   node scripts/gate-map.mjs --print    只把结果打到屏幕上，不写文件
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
//   gates      每扇门禁一条：{ step, file, guards, dirs, unattributed, reason }
//   byDir      目录 → 守着这一层的门禁清单。「这一层」指门禁守的路径正好在这个目录里，不含子目录。
//              每个被守着的目录，它的祖先目录也会建键（可能是空数组），
//              所以「改了 E 要跑 E、B、A 三层」可以顺着 E 的目录一路往上查表，不会查空。
//   coverage   src/ 下每个文件和目录有没有门禁守着；没被守着的进 ungated 并写明原因
//   generatedAt / chainLength 之类的元信息

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
export const MAP_PATH = path.join(ROOT, 'tests', 'gate-map.json')

// 本仓的源码根目录：只有落在这些目录里的路径才算「守着某条源码路径」。
// 前四个是插件自己的源码与机器人脚本。
// 不用再单列几个计算核的目录：它们已按 #1023 搬到 src/shared/<功能名>/，
// 被上面的 'src' 罩住；单列反而会让人误以为它们是并列的工作区包。
export const CODE_ROOTS = [
  'src',
  'scripts',
  'tests',
]

// 能被当作「归属路径」的目录前缀，比 CODE_ROOTS 宽：门禁读构建产物（package/）、
// 读夹具（tests/fixtures/）也如实记下来，只是这些不算守住源码。
export const PATH_PREFIXES = [
  ...CODE_ROOTS,
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
export const GRAPH_ROOTS = [
  'src',
]

// 真正装插件源码的目录。只有守着这些目录里某条路径的门禁，才算「算得出它守着哪条源码路径」。
// scripts/ 与 tests/ 不算：它们是工具与门禁自己，改它们一律按横切处理（见 select-gates.mjs）。
export const SOURCE_DIRS = GRAPH_ROOTS

// 构建产物目录：package/ 下的文件是 scripts/build.mjs 从源码打出来的。
// 只读这里的门禁看不出对应哪个源码文件，按「只要动到源码就先跑它」这一条保守处理。
export const BUILD_OUTPUT_PREFIXES = ['package/']

// 明确是别的包编译产物复制过来的派生目录：不手写、不拆行、由逐字节比对的门禁钉住。
// 归属推导照常看它们（有的门禁确实读这里），但覆盖报告里会给一句能看懂的解释。
// 今天这份名单是空的：#1016 删掉了最后一项 src/host/logPkg/（宿主日志改成直接取用已安装的
// dsh-log 包，插件源码树里不再留上游副本）。将来再有别的包编译产物原样拷进 src/ 时，把前缀写这里。
export const DERIVED_PREFIXES = []

// 扫仓库时跳过的目录：依赖、临时工作区、日志、隐藏目录。
const SKIP_DIR_NAMES = new Set(['node_modules', 'logs', '__pycache__', 'dist', 'coverage'])
const SKIP_DIR_PREFIXES = ['.tmp', '.git', '.worktrees', '.dsh-tmp', '.scratch']

const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json']

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** 把磁盘路径转成仓库内相对路径，统一用正斜杠。 */
export function toPosixRel(absOrRel, base = ROOT) {
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.resolve(base, absOrRel)
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

/** 目录路径的规范化：去掉末尾斜杠与 './'，仓库根记成 '.'。 */
export function normalizeDir(rel) {
  let p = String(rel || '').replace(/\\/g, '/').trim()
  p = p.replace(/^\.\//, '').replace(/\/+$/, '')
  return p === '' ? '.' : p
}

/** 仓库相对文件路径的目录部分（仓库根下的文件记成 '.'）。 */
export function dirOfFile(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  return i < 0 ? '.' : p.slice(0, i)
}

/** 从仓库根到该目录的全部祖先目录（含自己），由浅到深。 */
export function ancestorsOf(dir) {
  const d = normalizeDir(dir)
  if (d === '.') return ['.']
  const parts = d.split('/')
  const out = ['.']
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join('/'))
  return out
}

/** 判断 rel 是否落在某个目录里（含该目录自身），用于「这一层或更深」的归属判断。 */
export function isUnder(rel, dir) {
  const r = String(rel || '').replace(/\\/g, '/')
  const d = normalizeDir(dir)
  if (d === '.') return true
  return r === d || r.startsWith(d + '/')
}

function shouldSkipDir(name) {
  if (SKIP_DIR_NAMES.has(name)) return true
  return SKIP_DIR_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * 扫一遍仓库，返回 { files, dirs }：仓库内相对路径的集合（都带正斜杠）。
 * 跳过依赖、临时目录与隐藏目录——它们不属于「能被门禁守着的源码」。
 */
export function scanRepo(root = ROOT) {
  const files = new Set()
  const dirs = new Set()
  const walk = (absDir, relDir) => {
    let entries
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

/** 读 package.json 的 scripts.verify，按 && 切成一条条命令。切法与 scripts/verify-chain.js 一致。 */
export function readChainSteps(root = ROOT) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const chain = (raw.scripts && raw.scripts.verify) || ''
  if (!chain) throw new Error('package.json 里没有 scripts.verify，无法生成归属表')
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < chain.length; i++) {
    const ch = chain[i]
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '&' && chain[i + 1] === '&') {
      out.push(cur.trim())
      cur = ''
      i += 1
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

/** 链上一条命令 → 它跑的门禁文件（仓库相对路径）。不是 `node <文件>` 形状就返回空串。 */
export function stepToGateFile(step) {
  const m = /^node\s+(\S+)/.exec(String(step || '').trim())
  if (!m) return ''
  return m[1].replace(/\\/g, '/').replace(/^\.\//, '')
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
export function scanCode(code) {
  const n = code.length
  const out = new Array(n)
  const literals = []
  let i = 0
  const copy = (from, to) => {
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

function previousMeaningful(code, i) {
  let k = i - 1
  while (k >= 0 && /\s/.test(code[k])) k--
  return k < 0 ? '' : code[k]
}

// ---------------------------------------------------------------------------
// 归属推导
// ---------------------------------------------------------------------------

const DIRECTIVE_RE = /门禁归属\s*[:：]\s*([^\s*]+)/

/** 把一个字面量解析成仓库内路径；解析不出来（不存在、不在允许的目录里）就返回 null。 */
export function resolveRepoPath(raw, fromDirRel, exists) {
  let p = String(raw || '').trim().replace(/\\/g, '/')
  if (!p) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    if (!/^file:\/\//i.test(p)) return null
    p = p.replace(/^file:\/\//i, '')
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1)
  }
  if (/^(data|node|https?):/i.test(p)) return null

  const candidates = []
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

/** 原样找；找不到就补常见后缀、补 /index.*，都找不到返回 null。 */
function lookupWithExtensions(cand, exists) {
  if (exists.files.has(cand) || exists.dirs.has(cand)) return cand
  for (const ext of SOURCE_EXTENSIONS) {
    if (exists.files.has(cand + ext)) return cand + ext
  }
  for (const ext of SOURCE_EXTENSIONS) {
    if (exists.files.has(cand + '/index' + ext)) return cand + '/index' + ext
  }
  return null
}

const TIER_ORDER = ['directive', 'read', 'module', 'static-import', 'literal']
const TIER_LABEL = {
  directive: '文件头 // 门禁归属: 注释',
  read: '读文件调用（readFileSync / readFile / path.join(ROOT, ...)）',
  module: '载入模块（require / import / pathToFileURL）',
  'static-import': '静态 import 说明符',
  literal: '源码里的路径字面量',
}

/** 看一个字符串字面量出现在什么位置，判断它属于哪一档来源。 */
function classifyLiteral(masked, lit) {
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
export function deriveGuards(gateRel, code, exists) {
  const fromDir = dirOfFile(gateRel)
  const { literals, masked } = scanCode(code)

  // 第一优先：文件头的 `// 门禁归属:` 注释写了就以它为准，别的来源全不看。
  const directiveHits = []
  const head = code.slice(0, 4000)
  for (const line of head.split(/\r?\n/)) {
    const m = DIRECTIVE_RE.exec(line)
    if (m) directiveHits.push(m[1])
  }
  if (directiveHits.length) {
    const guards = []
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

  const byTier = new Map()
  const add = (tier, raw) => {
    const hit = resolveRepoPath(raw, fromDir, exists)
    if (!hit) return
    if (!byTier.has(tier)) byTier.set(tier, new Set())
    byTier.get(tier).add(hit)
  }

  // path.join(ROOT, 'a', 'b') 这类拼法：把开头的字面量按顺序接起来，遇到变量就停。
  // 不接起来的话，'src' 和 'host' 两个孤立的字面量谁也认不出，只会记成一个过宽的 'src'。
  const joinRe = /path\s*\.\s*(?:join|resolve)\s*\(([^()]*)\)/g
  let jm
  while ((jm = joinRe.exec(masked))) {
    const argsStart = jm.index + jm[0].length - 1 - jm[1].length - 0
    const argText = jm[1]
    const parts = argText.split(',')
    let offset = argsStart
    const pieces = []
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

  const tiers = {}
  const guards = []
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

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort()
}

/** 给推不出源码归属的门禁写一句人话原因。 */
function unattributedReason(gateRel, code, guards) {
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
export function listGraphFiles(root = ROOT) {
  const out = []
  for (const rel of GRAPH_ROOTS) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    const walk = (dir) => {
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
export function extractImportSpecifiers(code, fileRel, exists) {
  const fromDir = dirOfFile(fileRel)
  const out = new Set()
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
export function buildImportGraph(root = ROOT, exists = null) {
  const index = exists || scanRepo(root)
  const files = listGraphFiles(root)
  const imports = new Map()
  const importedBy = new Map()
  for (const rel of files) imports.set(rel, new Set())
  for (const rel of files) {
    let code
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
export function transitiveClosure(seeds, edges) {
  const seen = new Set()
  const queue = []
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
export function buildGateMap(root = ROOT) {
  const exists = scanRepo(root)
  const chainSteps = readChainSteps(root)
  const graph = buildImportGraph(root, exists)

  const gates = []
  for (const step of chainSteps) {
    const file = stepToGateFile(step)
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
      reason: derived.unattributed
        ? unattributedReason(file, code, derived.guards)
        : derived.reason,
    })
  }

  // byDir：目录 → 守着这一层的门禁清单。
  // 「这一层」的口径是「门禁守的路径正好在这个目录里」，不含子目录；子目录算它自己那一层。
  // 这么分是为了对上维护者要的规则：A 目录下有 B，B 下面有 E 和 F，改了 E 就只跑
  // 守着 E、守着 B、守着 A 三层的门禁，兄弟目录 F 的门禁不跟着跑。
  // 每个被守着的目录，它的所有祖先目录也会建一个键（可能是空数组），
  // 这样「改 E → 查 E、B、A」一路查表不会查空。
  const byDir = new Map()
  const ensure = (dir) => {
    for (const anc of ancestorsOf(dir)) if (!byDir.has(anc)) byDir.set(anc, new Set())
    return byDir.get(dir)
  }
  for (const gate of gates) {
    for (const g of gate.guards) {
      const dir = exists.dirs.has(g) ? normalizeDir(g) : dirOfFile(g)
      ensure(dir).add(gate.step)
    }
  }
  const byDirObj = {}
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
    generatedBy: 'node scripts/gate-map.mjs',
    chainLength: chainSteps.length,
    gateCount: gates.length,
    attributedGates: gates.length - unattributedGates,
    unattributedGates,
    buildOutputOnlyGates: gates.filter((g) => g.buildOutputOnly).length,
    graphFileCount: graph.imports.size,
    gates,
    byDir: byDirObj,
    coverage,
  }
}

function buildCoverage(root, exists, gates, graph, chainSteps) {
  const srcFiles = Array.from(exists.files).filter((f) => isUnder(f, 'src')).sort()
  const srcDirs = Array.from(exists.dirs).filter((d) => isUnder(d, 'src')).sort()

  // 每扇门禁守着的模块，连同它们 import 到的东西，一起算作被这扇门禁覆盖。
  // 归属写成目录时（`// 门禁归属: src/client/views`）摊成这个目录下的**全部**文件（含子目录）：
  // 依赖图只有「文件→文件」的边，目录本身没有边；而归属写成目录的门禁（verify-reuse.js、
  // verify-no-title.js 这类）本来就是递归扫这个目录的，摊一层会把这些文件误报成没人守。
  const expandSeed = (guard) => (exists.dirs.has(guard) ? srcFiles.filter((f) => isUnder(f, guard)) : [guard])
  const coveredBy = new Map()
  for (const gate of gates) {
    if (!gate.guards.length) continue
    const closure = transitiveClosure(gate.guards.flatMap(expandSeed), graph.imports)
    for (const f of closure) {
      if (!exists.files.has(f)) continue
      if (!coveredBy.has(f)) coveredBy.set(f, new Set())
      coveredBy.get(f).add(gate.step)
    }
  }

  const ungated = []
  const ungatedDirs = []
  const guardedFiles = []
  const dirHasCovered = new Set()
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
  const dedicatedDirs = new Set()
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

function ungatedReasonFor(rel) {
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
export function serializeMap(map) {
  return JSON.stringify(map, null, 2) + '\n'
}

/** 同一份仓库状态下，两次推导出来的结果应当逐字节相同。generatedAt 是时间戳，比较时去掉。 */
export function normalizeForCompare(map) {
  const copy = JSON.parse(JSON.stringify(map))
  delete copy.generatedAt
  return copy
}

// ---------------------------------------------------------------------------
// 命令行入口
// ---------------------------------------------------------------------------

function main() {
  const printOnly = process.argv.includes('--print')
  const map = buildGateMap(ROOT)
  const text = serializeMap(map)
  console.log('门禁归属表：链上 ' + map.chainLength + ' 步，能推出源码归属 ' + map.attributedGates + ' 步，推不出 ' + map.unattributedGates + ' 步')
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
