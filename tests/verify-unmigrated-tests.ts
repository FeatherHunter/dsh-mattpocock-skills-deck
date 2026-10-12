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
// 判据只有一条：**「现在这棵树上的旧语言手写文件」必须是「基线那份清单」的子集**。多出来的就是新的。
//
// 反例（写这条的时候亲手验过）：放一个 tests/xxx.js 再跑，它判红并点名那个文件；把基线重录一遍，
// 它就绿了——重录是一次有意的动作，会出现在提交 diff 里，而不是被悄悄放宽。
//
// 用法：node tests/verify-unmigrated-tests.ts（挂在 verify 长串上）
//       node tests/verify-unmigrated-tests.ts --record-baseline（迁移之后重录；同时会把「迁走了哪几条」打出来）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** verify 长串里那几条的读数：链上一共几步、其中还有几条是旧语言。 */
function chainReadout(): { steps: number; oldSteps: number } {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const steps = String(pkg.scripts.verify).split('&&').map((s) => s.trim()).filter(Boolean)
  const files = steps.map((s) => (/^node\s+(\S+)$/.exec(s) || [])[1]).filter(Boolean)
  const oldSteps = files.filter((f) => OLD_LANG_RE.test(f) && fs.existsSync(path.join(ROOT, f))).length
  return { steps: steps.length, oldSteps }
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

  const known = new Set(baseline.files)
  const added = current.filter((f) => !known.has(f))
  const migrated = baseline.files.filter((f) => !current.includes(f))
  const chain = chainReadout()

  if (added.length) console.log('    新出现的旧语言测试文件:\n    ' + added.join('\n    '))
  check(added.length === 0, '没有新写的旧语言测试文件（新写的测试一律 .ts；'
    + '确有必要时重录基线并在提交信息里写清理由）')

  console.log('  INFO 未迁移的旧语言测试文件还有 ' + current.length + ' 个（基线 ' + baseline.files.length + ' 个，'
    + '相对基线已少 ' + migrated.length + ' 个）；其中挂在 verify 长串上的旧语言步骤 ' + chain.oldSteps + ' 条（长串共 ' + chain.steps + ' 步）')
  if (migrated.length && migrated.length <= 20) console.log('    已迁走：' + migrated.join('、'))

  console.log(failed ? '\n存在失败' : '\n全部通过 — 未迁移旧测试数棘轮生效（只降不升）')
  process.exit(failed ? 1 : 0)
}

main()
