// scripts/lib/select-gates.mjs —— 按「这次改了哪些文件」挑出该跑哪些门禁。
//
// 为什么要有它：
//   npm run verify 是一条两百多步的长链，改一个文件就全跑一遍太贵。
//   维护者要的规则是：「A 目录下有 B C D，B 下面有 E 和 F；改了 E 的代码，
//   门禁只跑守着 E、守着 B、守着 A 这三层的；只改了 B 目录的代码，就跑守着 B 和 A 的」。
//   本文件按这条规则挑门禁，并且处处往「宁可多跑，不许漏跑」的一侧偏。
//
// 挑选规则（按判断顺序，前一条命中就不再往下走）：
//   1. 改的是横切文件 —— 仓库根目录下的文件、package.json 等清单、任何 tsconfig*.json、
//      scripts/**、tests/**、docs/**、research/**、specs/**、任何 *.md、package/** 构建产物、
//      src/**/contract/** 契约层 —— 直接跑全链。这类文件影响面铺满全仓，按目录挑一定漏。
//   2. 改的是有归属的源码文件 —— 取它所在目录，一路上溯到仓库根，把这些目录守住的门禁全选上；
//      再加反向依赖：谁的 import 图里能走到这个文件（直接或传递），守着那些文件的门禁也要跑。
//      这一步是关键：改了底层共享模块（例如 src/shared/refresh/budget.js），
//      上层消费者的门禁如果不跑，就在本地看不到它们坏掉。
//   3. 改的文件没有归属（它所在目录没有任何门禁守着）—— 跑全链。
//      没有归属就说明没人看着它，猜不出影响面，只能全跑。
//   4. 改的是门禁或测试自己（tests/**）—— 按规则 1 已经跑全链，本门禁一定在其中。
//   5. 另外：只验构建产物（package/）的门禁（gate-map 里 buildOutputOnly 为 true）看不出
//      产物跟哪个源码文件对应，只要这次动到了源码，就一并跑上，同样是为了不漏。
//
// 已知漏洞（详细说明见 docs/agents/verification.md 的「已知漏洞」一节）：
//   · import 路径是拼出来的（变量、模板串）时认不出来，认不出就走规则 3 兜底成全链；
//   · 构建产物与源码的对应关系看不出来，只能按 buildOutputOnly 一刀切；
//   · 跨目录的公共约定没有专属目录（例如后端适配的字段约定散在几个目录里），
//     改一处可能同时影响几个包，靠目录加反向依赖也未必兜住。
//   所以提交前仍然要跑一次全链：node scripts/verify-chain.js。
//
// 用法：
//   import { selectGates } from './lib/select-gates.mjs'
//   const out = selectGates({ changedPaths, map, chainSteps })

import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT,
  ancestorsOf,
  buildImportGraph,
  dirOfFile,
  isUnder,
  normalizeDir,
  scanRepo,
  transitiveClosure,
} from '../gate-map.mjs'

// 横切文件：改它们一律跑全链。每一条都写清为什么，方便后来人判断该不该往里加。
const CROSS_CUTTING_RULES = [
  {
    test: (rel) => dirOfFile(rel) === '.',
    reason: '它是仓库根目录下的文件（构建入口、发布清单、仓库配置），根目录的东西谁都在用，影响面铺满全仓',
  },
  {
    test: (rel) => /^package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$/.test(rel),
    reason: '它是包清单或依赖锁定文件，改了它等于改了整条链的安装与执行环境',
  },
  {
    test: (rel) => /(^|\/)tsconfig[^/]*\.json$/.test(rel),
    reason: '它是 TypeScript 编译配置，决定哪些文件进构建，影响面铺满全仓',
  },
  {
    test: (rel) => isUnder(rel, 'scripts'),
    reason: '它在 scripts/ 下（构建脚本、发布脚本、门禁链的执行器），改一处可能影响所有产物',
  },
  {
    test: (rel) => isUnder(rel, 'tests'),
    reason: '它在 tests/ 下（门禁与测试自己），改门禁等于改判定标准，必须全跑一遍才知道有没有误伤',
  },
  {
    test: (rel) => isUnder(rel, 'docs') || isUnder(rel, 'research') || isUnder(rel, 'specs'),
    reason: '它是文档或规格文件，仓库里的门禁会拿它当契约来校验',
  },
  {
    test: (rel) => /\.md$/.test(rel),
    reason: '它是 Markdown 文档，仓库里有门禁会校验正文格式与内容',
  },
  {
    test: (rel) => isUnder(rel, 'package'),
    reason: '它是 package/ 下的构建产物，产物变了说明源码或构建流程变了，看不出具体影响面',
  },
  {
    test: (rel) => isUnder(rel, 'src') && /(^|\/)contract\//.test(rel),
    reason: '它是 src/**/contract/ 下的契约层文件，上下两端都按它对齐，改一处两边都要跟着动',
  },
]

/** 判断一个仓库相对路径是不是横切文件。返回 { crossCutting, reason }。 */
export function isCrossCutting(rel) {
  const p = normalizeRel(rel)
  for (const rule of CROSS_CUTTING_RULES) {
    if (rule.test(p)) return { crossCutting: true, reason: rule.reason }
  }
  return { crossCutting: false, reason: '' }
}

/** 把各种写法（绝对路径、反斜杠、./ 前缀）统一成仓库相对路径。 */
export function normalizeRel(rel) {
  let p = String(rel == null ? '' : rel).trim().replace(/\\/g, '/')
  if (!p) return ''
  if (path.isAbsolute(p) || /^[a-zA-Z]:\//.test(p)) {
    p = path.relative(ROOT, p.replace(/\//g, path.sep)).split(path.sep).join('/')
  }
  p = p.replace(/^\.\//, '')
  return p
}

// 反向依赖图按仓库根缓存一份：同一趟里挑很多次不该反复扫全仓。
const graphCache = new Map()
function graphFor(root) {
  const key = path.resolve(root)
  if (!graphCache.has(key)) {
    const exists = scanRepo(key)
    graphCache.set(key, { exists, graph: buildImportGraph(key, exists) })
  }
  return graphCache.get(key)
}

/** 一个路径所在目录（含所有祖先目录）守住的门禁，按链上顺序返回。 */
export function gatesForPath(map, rel) {
  const dir = dirOfFile(rel)
  const out = new Set()
  for (const anc of ancestorsOf(dir).reverse()) {
    const steps = map.byDir && map.byDir[anc]
    if (steps) for (const s of steps) out.add(s)
  }
  return out
}

/**
 * 挑门禁。
 * @param {object}   args
 * @param {string[]} args.changedPaths 这次改了哪些文件（仓库相对路径，绝对路径也认）
 * @param {object}   args.map          门禁归属表，即 tests/gate-map.json 的内容
 * @param {string[]} [args.chainSteps] 链上全部门禁命令，按顺序；不给就从 map.gates 里取
 * @param {string}   [args.root]       仓库根目录，默认取 gate-map.mjs 算出根
 * @returns {{steps: string[], reasons: {step: string, reason: string}[], fullChain: boolean, fullChainReason: string|null}}
 *   steps            这次该跑哪些门禁，按链上顺序
 *   reasons          每扇被选中的门禁一条，说明它为什么被选上
 *   fullChain        是不是退化成跑全链
 *   fullChainReason  fullChain 为 true 时写明是哪条规则、哪个文件触发的；否则 null
 */
export function selectGates({ changedPaths, map, chainSteps, root = ROOT } = {}) {
  if (!map || !map.gates) throw new Error('selectGates 需要门禁归属表（tests/gate-map.json 的内容）')
  const chain =
    Array.isArray(chainSteps) && chainSteps.length
      ? chainSteps.slice()
      : map.gates.map((g) => g.step)
  const onChain = new Set(chain)

  const paths = Array.from(
    new Set((changedPaths || []).map(normalizeRel).filter((p) => p && !p.startsWith('..'))),
  ).sort()

  const finishFullChain = (reason) => ({
    steps: chain.slice(),
    reasons: chain.map((step) => ({ step, reason })),
    fullChain: true,
    fullChainReason: reason,
  })

  if (!paths.length) {
    return finishFullChain('没有给出任何变更文件，猜不出影响面，按最保守的方式跑全链')
  }

  // 规则 1：横切文件直接全链。
  for (const p of paths) {
    const hit = isCrossCutting(p)
    if (hit.crossCutting) {
      return finishFullChain('改了横切文件 ' + p + '：' + hit.reason)
    }
  }

  const { exists, graph } = graphFor(root)
  const picked = new Map() // step -> 为什么选它

  const pick = (step, reason) => {
    if (!onChain.has(step)) return
    if (!picked.has(step)) picked.set(step, reason)
  }

  for (const p of paths) {
    // 规则 3：所在目录这一层没有任何门禁守着，就没有归属，只能全链。
    // 这里只看「同一层」，不看祖先目录：祖先那层的门禁是给祖先那层的改动准备的，
    // 拿它当「这个文件有人看着」的证据太弱，宁可退成全链。
    const ownLevel = map.byDir ? map.byDir[dirOfFile(p)] : null
    if (!ownLevel || !ownLevel.length) {
      return finishFullChain(
        '改的 ' + p + ' 没有任何门禁守着（它所在目录这一层不在归属表里，或者这一层没有门禁），' +
          '猜不出影响面，只能跑全链',
      )
    }

    // 规则 2 前半：按目录上溯，把守着这一层和上面每一层的门禁全选上。
    const dir = dirOfFile(p)
    for (const anc of ancestorsOf(dir).reverse()) {
      const steps = map.byDir[anc]
      if (!steps) continue
      for (const s of steps) {
        pick(s, anc === dir ? '它守着 ' + p + ' 所在目录 ' + dir : '它守着 ' + p + ' 的上级目录 ' + anc)
      }
    }

    // 规则 2 后半：反向依赖。谁的 import 图里能走到这个文件，守着那些文件的门禁也要跑。
    const dependents = transitiveClosure([p], graph.importedBy)
    dependents.delete(p)
    for (const dep of Array.from(dependents).sort()) {
      for (const s of gatesForPath(map, dep)) {
        pick(s, dep + ' 直接或间接 import 了 ' + p + '，改了 ' + p + ' 会连带影响它')
      }
    }
  }

  // 补充规则：只验构建产物的门禁，看不出对应哪个源码文件，这次动到源码就一并跑上。
  // 几个计算核已按 #1023 搬进 src/shared/<功能名>/，'src' 一条就罩得住，不再单列。
  const touchedSource = paths.some((p) => isUnder(p, 'src'))
  if (touchedSource) {
    for (const gate of map.gates) {
      if (gate.buildOutputOnly) {
        const buildGuard = (gate.guards || []).find((g) => isUnder(g, 'package')) || gate.guards[0] || 'package/'
        pick(gate.step, '它验的是构建产物 ' + buildGuard + '，看不出产物跟哪个源码文件对应，动到源码就先跑它')
      }
    }
  }

  const steps = chain.filter((s) => picked.has(s))
  return {
    steps,
    reasons: steps.map((s) => ({ step: s, reason: picked.get(s) })),
    fullChain: false,
    fullChainReason: null,
  }
}

/** 给命令行用：node scripts/lib/select-gates.mjs <改了哪些文件...> */
function main() {
  const argv = process.argv.slice(2)
  const mapPath = path.join(ROOT, 'tests', 'gate-map.json')
  if (!fs.existsSync(mapPath)) {
    console.error('缺少 tests/gate-map.json，请先跑 node scripts/gate-map.mjs')
    process.exit(1)
  }
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.verify
  const chainSteps = chain.split(' && ').map((s) => s.trim())
  const out = selectGates({ changedPaths: argv, map, chainSteps })
  console.log(out.fullChain ? '跑全链：' + out.fullChainReason : '只跑 ' + out.steps.length + ' / ' + chainSteps.length + ' 步')
  if (out.fullChain) {
    console.log('（全链共 ' + out.steps.length + ' 步）')
    return
  }
  for (const r of out.reasons) console.log('  ' + r.step.replace(/^node\s+/, '') + '  ←  ' + r.reason)
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('lib', 'select-gates.mjs'))) main()
