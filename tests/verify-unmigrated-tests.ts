// verify-unmigrated-tests.ts —— 「未迁移旧测试数」棘轮（#1017 立；#1021 关闭小结点名要立的那把尺子）
//
// 尺子管什么：tests/ 下还有多少**旧语言**（.js / .mjs / .cjs）的手写测试文件。这个数只许降不许升：
// 每迁一条（改名成 .ts）就少一个，新写的一律用 .ts，所以不许出现新的旧语言文件。
//
// 为什么要有这条：迁移是一件要跨越很多张票的事（Q6：旧长串按条迁移、13 号收口清空）。没有尺子的时候，
// 「迁了几条」只能靠人去数 package.json 里那条长串——数漏一条不报错，新写的 .js 测试也没人拦。
// 有尺子之后，每一次「少了一个」都能在提交里看见，每一次「多了一个」都当场判红。
//
// 为什么按文件数而不是按长串条数：长串条目就是文件（`node tests/xxx.js`），按文件数能顺带盖住没挂链的
// 那些（诊断脚本、临时复现、夹具、tests/lib 下的工具）。它们同样是要迁的旧语言文件，只是不在 `npm test`
// 这一趟里跑。另有两处不算的，写在下面「边界」一节。
//
// 边界（这几类不计入分子，也不该为它们判红）：
//   · 新语言文件（.ts / .mts / .cts）——迁完的形状，正是目标。
//   · 旁边有同名 .ts 的 .js——那是构建产物，不是手写源。
//   · 基线里已有的文件：它们算存量，可以继续躺在那儿，直到各自的迁移票动手。
// 判据有两条，方向相反，缺一个就会出现「登记永不匹配却判绿」：
//   ① **「现在这棵树上的旧语言手写文件」必须是「基线那份清单」的子集**。多出来的就是新的。
//   ② **「基线那份清单」里的每一条，今天都必须在树上找得到**（#1154 加的）。迁走、删掉或改名之后
//      没重录基线，那一条就成了失效条目——留着它等于给那个路径预留了豁免：将来在那里重新写一个
//      .js 测试，判据①认不出它是新的。所以失效条目判红，修法是跑 --record-baseline 重录。
//
// 反例（写这条的时候亲手验过）：放一个 tests/xxx.js 再跑，它判红并点名那个文件；把基线重录一遍，
// 它就绿了——重录是一次有意的动作，会出现在提交 diff 里，而不是被悄悄放宽。
// 判据②的反例同理：往基线里塞一条树上没有的路径（例如已经删掉的 tests/verify-deck-tools-host-wiring.js），
// 它判红并点名那一条；重录之后绿。两条判据的内存自查写在下面 selfCheck() 里，不靠人去记。
//
// 用法：node tests/verify-unmigrated-tests.ts（挂在 verify 长串上）
//       node tests/verify-unmigrated-tests.ts --record-baseline（迁移之后重录；同时会把「迁走了哪几条」打出来）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = path.join(ROOT, 'tests')
const BASELINE_FILE = path.join(TESTS, 'unmigrated-tests-baseline.json')
const METRIC = 'unmigrated-old-language-test-files'

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const OLD_LANG_RE = /\.(js|mjs|cjs)$/

/** 今天树上的旧语言手写测试文件（仓库相对路径，斜杠统一）。同名 .ts 存在时那份 .js 是产物，不算。 */
function listOldLanguageTestFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        // 点开头的目录按仓里的约定一律是工具自己用的（缓存、临时仓库副本），不进这趟。
        if (ent.name.startsWith('.')) continue
        walk(full)
        continue
      }
      if (!OLD_LANG_RE.test(ent.name)) continue
      if (fs.existsSync(full.replace(OLD_LANG_RE, '.ts'))) continue
      out.push(path.relative(ROOT, full).split(path.sep).join('/'))
    }
  }
  walk(TESTS)
  return out.sort()
}

/**
 * 对账：把「今天树上的清单」与「基线清单」比一遍。
 *
 * 两个方向都要看，缺一个就会出现「登记永不匹配却判绿」：
 *   · added —— 树上多出来的旧语言测试文件（新写的），只许减不许增的那一半；
 *   · stale —— 只留在基线里、树上已经没有的（迁走、删掉、改名），
 *     留着它等于给那个路径预留豁免：将来在那里重新写一个 .js 测试，added 认不出它是新的。
 *
 * 抽成纯函数是为了让下面的判据与内存自查共用同一份实现，不各写一套。
 */
function compareBaseline(current: string[], baselineFiles: string[]): { added: string[]; stale: string[] } {
  const known = new Set(baselineFiles)
  const currentSet = new Set(current)
  return {
    added: current.filter((f) => !known.has(f)),
    stale: baselineFiles.filter((f) => !currentSet.has(f)),
  }
}

/**
 * 判据自查：两个方向各自判红、两边一致时放行。
 *
 * 为什么要自查：这两条判据用真仓库只能验出「今天不红」，验不出「该红时真会红」——
 * 真仓库今天两条都不该红。三组内存夹具把「多出来」与「只留在基线里」各自钉一遍。
 */
function selfCheck(): void {
  const grown = compareBaseline(['tests/a.js', 'tests/b.js'], ['tests/a.js'])
  check(grown.added.length === 1 && grown.added[0] === 'tests/b.js' && grown.stale.length === 0,
    '判据自查：树上多出来的旧语言文件被 added 点到，且不误报失效条目')

  const stale = compareBaseline(['tests/a.js'], ['tests/a.js', 'tests/b.js'])
  check(stale.stale.length === 1 && stale.stale[0] === 'tests/b.js' && stale.added.length === 0,
    '判据自查：只留在基线里、树上没有的路径被 stale 点到，且不误报新增')

  const same = compareBaseline(['tests/a.js'], ['tests/a.js'])
  check(same.added.length === 0 && same.stale.length === 0, '判据自查：两边一致时不报任何一条')
}

/** 规划名单里那几条的读数：链上一共几步、其中还有几条是旧语言（#1125 起问规划函数）。 */
function chainReadout(): { steps: number; oldSteps: number } {
  const files = planGates(ROOT).map((s) => s.file)
  const oldSteps = files.filter((f) => OLD_LANG_RE.test(f) && fs.existsSync(path.join(ROOT, f))).length
  return { steps: files.length, oldSteps }
}

function loadBaseline(): { metric?: string; files?: string[] } | null {
  if (!fs.existsSync(BASELINE_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  } catch (e) {
    return null
  }
}

if (process.argv.includes('--record-baseline')) {
  const files = listOldLanguageTestFiles()
  const before = loadBaseline()
  const migrated = before && Array.isArray(before.files) ? before.files.filter((f) => !files.includes(f)) : []
  const data = {
    version: 1,
    metric: METRIC,
    recordedAt: new Date().toISOString().slice(0, 10),
    note: '未迁移的旧语言手写测试文件清单（tests/ 下 .js/.mjs/.cjs，旁边没有同名 .ts）。只许减不许增：'
      + '新写的测试一律 .ts；确有必要新增旧语言文件（例如给门禁造 .js 夹具）时，重录本文件并把理由写进提交信息。',
    files,
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n')
  console.log('基线已重录：' + files.length + ' 个旧语言测试文件记进 tests/unmigrated-tests-baseline.json')
  if (migrated.length) console.log('  相对上一次基线，这次少掉的（已迁走或已删除）：' + migrated.length + ' 个')
  process.exit(0)
}

function main() {
  // 先跑判据自查：真仓库今天两条判据都不该红，光跑真仓库证明不了「该红时会红」。
  selfCheck()

  const baseline = loadBaseline()
  if (!baseline || !Array.isArray(baseline.files)) {
    check(false, '基线缺失或读不动：请运行 node tests/verify-unmigrated-tests.ts --record-baseline')
    process.exit(1)
  }
  if (baseline.metric !== METRIC) {
    check(false, '基线口径不认识（记的是 ' + JSON.stringify(baseline.metric) + '，本门禁按 ' + METRIC + ' 判）：请重录')
    process.exit(1)
  }
  if (baseline.files.length === 0) {
    check(false, '基线是空的：这份棘轮会变成永远判绿的空壳，必须先把当时的清单记进去')
    process.exit(1)
  }

  const current = listOldLanguageTestFiles()
  if (current.length === 0) {
    check(false, '一个测试文件都没扫到：tests/ 树被改名、被搬走，或扫描根写错了。这种情况不能判绿')
    process.exit(1)
  }

  const { added, stale } = compareBaseline(current, baseline.files)
  const chain = chainReadout()

  if (added.length) console.log('    新出现的旧语言测试文件:\n    ' + added.join('\n    '))
  check(added.length === 0, '没有新写的旧语言测试文件（新写的测试一律 .ts；'
    + '确有必要时重录基线并在提交信息里写清理由）')

  if (stale.length) console.log('    基线里留着、树上已经没有的路径:\n    ' + stale.join('\n    '))
  check(stale.length === 0, '基线里没有失效条目（迁走、删掉或改名之后跑一次 --record-baseline 重录；'
    + '留着这些路径等于给它们预留豁免：将来在那里重新写 .js 测试时棘轮不会判红）')

  console.log('  INFO 未迁移的旧语言测试文件还有 ' + current.length + ' 个（基线 ' + baseline.files.length + ' 个，'
    + '相对基线已少 ' + stale.length + ' 个）；其中挂在 verify 规划名单上的旧语言步骤 ' + chain.oldSteps + ' 条（规划名单共 ' + chain.steps + ' 步）')

  console.log(failed ? '\n存在失败' : '\n全部通过 — 未迁移旧测试数棘轮生效（只降不升）')
  process.exit(failed ? 1 : 0)
}

main()
