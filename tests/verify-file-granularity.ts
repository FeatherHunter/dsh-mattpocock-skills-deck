// verify-file-granularity.ts — src/ 文件粒度门禁（地图 #336 首批·尺子 #438；#1017 换轨：两种源码一起读）
// 规则（G1 #339 + G2 #340 第 3 条，零增长基线锁形态）：
//   1) 每个 src/ 下的源文件都不超 350 有效行；超 500 有效行的失败信息多写一句严重并阻断发布。
//   2) 谁算源文件：.ts/.mts/.cts（含 .d.ts）一律算；.js/.mjs/.cjs 只在**旁边没有同名新语言文件**时才算。
//      旁边有同名 .ts 的那种 .js 是构建产物（逐文件转译的产物树，另有新鲜度门禁盯着），
//      读它等于把同一段代码数两遍，而且它总是比真源旧——#1017 之前只扫 .js，于是 .ts 真源是空窗：
//      一份几百行的 .ts 真源可以随便长，门禁一声不响。
//   3) 行数口径 = 有效行（注释与空行都不计入），实现住在 scripts/lib/effective-lines.mts，
//      与 tests/verify-leaves.js 的叶子行数判定共用同一份——同一把尺子只许有一处实现。
//   4) 零增长基线锁：门禁落地时已超标的文件把当时**有效行数**记进 tests/file-granularity-baseline.json，
//      只许减不许增——增了失败；不在基线里的新超标直接失败。全部达标后基线自然清空，
//      门禁自动退化为纯 350 行失败。基线里记的口径写在 metric 字段里，读到旧口径的数字直接判红，
//      理由见注释尾部「为什么口径要记在文件里」。
//   5) 防假绿：扫到的源文件数低于 MIN_FILES 直接失败。原门禁扫到 0 个文件也照样打「共扫 0 个 src/ 文件」
//      然后判绿——树被改名、被搬走、扫描根写错，全会静默变成「没有超标文件」。这是 #1017 点名要修的洞。
//   6) 拆分票让某个文件达标后，必须同票重录基线把它移出，否则门禁会失败提醒。
// 用法: node tests/verify-file-granularity.ts（在插件根目录）
//      node tests/verify-file-granularity.ts --record-baseline（重录基线：只记录当前超标文件）
//
// 为什么口径要记在文件里：基线是「一批数字 + 一个口径」的合体。数字换了口径还接着用，
// 就会出现「359 行的文件在新口径下只有 233 行」这种条目——门禁会把它当成「已达标」清理掉，
// 而它其实从没冻结过。所以基线必须自报 metric，读到不认识的口径就停下让人重录。
const fs = require('fs')
const path = require('path')
const { countEffectiveLines, EFFECTIVE_LINES_METRIC } = require('../scripts/lib/effective-lines.mts')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const BASELINE_FILE = path.join(__dirname, 'file-granularity-baseline.json')
const LIMIT = 350
const SEVERE = 500
// 扫到的源文件数下限。2026-10-13 实测 464 个（.ts 81 个 + 手写 .js 383 个，另 34 个同名产物 .js 被跳过）。
// 取 400 是留出正常增删的余量，但「整棵树扫不到了」这种量级的塌陷一定抓得住。
// 树真的缩到这个数以下时，把这行改小是一次有意的动作（连同理由写在提交信息里），不是顺手删个数字。
const MIN_FILES = 400

let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 派生目录不进本门禁：这些文件是别的包编译产物原样复制过来的，人手不能拆、
// 拆了也会被下一次派生覆盖回去，所以「拆到 350 行以内」这条要求对它无解。
// 它们的正确性由逐字节门禁钉住（与发布包一致），不受这里放宽的影响。
// 今天 src/ 下没有这种目录：#1016 删掉了最后一份上游副本 src/host/logPkg/（宿主日志改成
// 直接取用已安装的 dsh-log 包）。名单留着——将来再有别的包编译产物原样拷进 src/，把前缀写这里。
const DERIVED_DIRS = []

// 生成源码同样不进本门禁（理由与上面那条并列）：这类文件的内容是「配置文件里的数据逐条展开」，
// 行数由键的个数决定，不是人手写出来的结构；本门禁要的“拆到 350 行以内”对它无解——
// 它只有一个可拆的维度，就是拆生成器，那属于改生成方案，不属于顺手拆文件。
// 名单里的文件都自带「人手不改：本文件由某脚本写出」的头注释，正确性由各自的生成新鲜度门禁钉住：
//   src/shared/time-config/src/values.ts → tests/verify-time-config.ts 第一节（生成物与三份 YAML 一致）
//   .build/shared/time-config/values.js → 同一份生成物的构建产物（2026-10-19 第三阶段起域产物落
//     仓库根的 .build/shared/<域>/ 下，不再是源码树里的同名 .js），同上
//   src/client/kernel/prompt-data.ts → tests/verify-prompt-config.ts（#1292 起：生成物与
//     config/prompts/ 五份族 YAML 加 config/languages.yaml 一字不差，且 --check 新鲜度绿）
// 新增生成源码时把相对路径加进来，并把对应的新鲜度门禁写在下面一行注释里。
const GENERATED_FILES = ['src/shared/time-config/src/values.ts', '.build/shared/time-config/values.js', 'src/client/kernel/prompt-data.ts']

/** 同名产物判定表：右列存在时，左列那份文件不算源文件。 */
const PRODUCT_TWINS = { '.js': '.ts', '.mjs': '.mts', '.cjs': '.cts' }

function listSourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      const ext = entry.name.endsWith('.d.ts') ? '.ts' : path.extname(entry.name)
      if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
        // 新语言源码一律算。
      } else if (PRODUCT_TWINS[ext]) {
        // 旧语言文件：旁边有同名新语言文件就跳过（那份是产物），否则算源码。
        const twin = entry.name.slice(0, -ext.length) + PRODUCT_TWINS[ext]
        if (fs.existsSync(path.join(dir, twin))) continue
      } else {
        continue
      }
      const rel = path.relative(ROOT, full).split(path.sep).join('/')
      if (DERIVED_DIRS.some((prefix) => rel.startsWith(prefix))) continue
      if (GENERATED_FILES.includes(rel)) continue
      out.push(rel)
    }
  }
  walk(SRC)
  return out.sort()
}

function countLines(rel) {
  return countEffectiveLines(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
}

if (process.argv.includes('--record-baseline')) {
  const files = {}
  for (const rel of listSourceFiles()) {
    const n = countLines(rel)
    if (n > LIMIT) files[rel] = n
  }
  const data = {
    version: 2,
    metric: EFFECTIVE_LINES_METRIC,
    recordedAt: new Date().toISOString().slice(0, 10),
    note: '零增长基线：按有效行（注释与空行都不计）记，只许减不许增；达标文件由各自拆分票移出。',
    files,
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n')
  console.log('基线已重录：' + Object.keys(files).length + ' 个超标文件记进 tests/file-granularity-baseline.json（口径 '
    + EFFECTIVE_LINES_METRIC + '，共扫 ' + listSourceFiles().length + ' 个 src/ 源文件）')
  process.exit(0)
}

function main() {
  const baseline = loadBaseline()
  if (!baseline || !baseline.files) {
    check(false, '基线文件缺失：请先运行 node tests/verify-file-granularity.ts --record-baseline')
    process.exit(1)
  }
  if (baseline.metric !== EFFECTIVE_LINES_METRIC) {
    check(false, '基线口径过期：文件里记的是 ' + JSON.stringify(baseline.metric) + '，本门禁按 '
      + EFFECTIVE_LINES_METRIC + ' 判（注释与空行不计）。请运行 node tests/verify-file-granularity.ts --record-baseline 重录')
    process.exit(1)
  }
  const files = listSourceFiles()
  const tsCount = files.filter((f) => /\.(ts|mts|cts)$/.test(f)).length
  const jsCount = files.length - tsCount
  const current = {}
  for (const rel of files) current[rel] = countLines(rel)

  // ---- 防假绿：扫不到文件就直接停下，不给出「全部通过」----
  if (files.length < MIN_FILES) {
    check(false, '扫到的源文件太少：只有 ' + files.length + ' 个（下限 ' + MIN_FILES + ' 个）——'
      + 'src/ 树被改名、被搬走，或扫描根写错了。这种情况不能判绿')
    console.log('\n存在失败')
    process.exit(1)
  }

  // ---- 基线完整性：过期条目必须清理，不许留着装样子 ----
  for (const rel of Object.keys(baseline.files).sort()) {
    if (!(rel in current)) {
      check(false, '基线过期：' + rel + ' 已不存在（删除或改名），请重录基线')
    } else if (current[rel] <= LIMIT) {
      check(false, '基线过期：' + rel + ' 已降到 ' + current[rel] + ' 有效行（达标），请重录基线把它移出')
    }
  }
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 逐文件判定 ----
  let compliant = 0
  for (const rel of files) {
    const n = current[rel]
    if (n <= LIMIT) { compliant++; continue }
    const base = baseline.files[rel]
    const severe = n > SEVERE ? '（严重：超 500 有效行，阻断发布）' : ''
    if (base === undefined) {
      check(false, rel + ' 新增超标：' + n + ' 有效行（上限 ' + LIMIT + '）' + severe)
    } else if (n > base) {
      check(false, rel + ' 继续膨胀：基线 ' + base + ' → 现 ' + n + ' 有效行，只许减不许增' + severe)
    } else {
      check(true, rel + ' 冻结中：基线 ' + base + '，现 ' + n + ' 有效行（未增长）' + severe)
    }
  }
  console.log('  INFO 其余 ' + compliant + ' 个文件全部 ≤' + LIMIT + ' 有效行（注释与空行不计），共扫 '
    + files.length + ' 个 src/ 源文件：.ts/.mts/.cts ' + tsCount + ' 个 + 手写 .js 一档 ' + jsCount + ' 个')

  if (failed) console.log('\n存在失败')
  else console.log('\n全部通过')
  process.exit(failed ? 1 : 0)
}

main()
