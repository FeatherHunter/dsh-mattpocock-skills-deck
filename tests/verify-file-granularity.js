// verify-file-granularity.js — src/ 文件粒度门禁（地图 #336 首批·尺子 #438）
// 规则（G1 #339 + G2 #340 第 3 条，零增长基线锁形态）：
//   1) 每个 src/ 下的 .js 文件都不超 350 行；超 500 行的失败信息多写一句严重并阻断发布。
//   2) 行数口径 = 总行数（含空行注释），与 verify-leaves 同口径：源码按换行符切分计数。
//   3) 零增长基线锁：门禁落地时已超标的文件把当时行数记进 tests/file-granularity-baseline.json，
//      只许减不许增——增了失败；不在基线里的新超标直接失败。全部达标后基线自然清空，
//      门禁自动退化为纯 350 行失败。直接照 G2 字面全失败会让主分支当场红 12 处，
//      忠于意图「防止再次膨胀」才用此形态（偏离已记进 #438 与地图）。
//   4) 拆分票让某个文件达标后，必须同票重录基线把它移出，否则门禁会失败提醒。
// 用法: node tests/verify-file-granularity.js（在插件根目录）
//      node tests/verify-file-granularity.js --record-baseline（重录基线：只记录当前超标文件）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const BASELINE_FILE = path.join(__dirname, 'file-granularity-baseline.json')
const LIMIT = 350
const SEVERE = 500

let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

function listJsFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) out.push(path.relative(ROOT, full).split(path.sep).join('/'))
    }
  }
  walk(SRC)
  return out.sort()
}

function countLines(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  return src.split(/\r?\n/).length
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
}

if (process.argv.includes('--record-baseline')) {
  const files = {}
  for (const rel of listJsFiles()) {
    const n = countLines(rel)
    if (n > LIMIT) files[rel] = n
  }
  const data = {
    version: 1,
    recordedAt: new Date().toISOString().slice(0, 10),
    note: '零增长基线：只许减不许增；达标文件由各自拆分票移出。',
    files,
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n')
  console.log('基线已重录：' + Object.keys(files).length + ' 个超标文件记进 tests/file-granularity-baseline.json')
  process.exit(0)
}

function main() {
  const baseline = loadBaseline()
  if (!baseline || !baseline.files) {
    check(false, '基线文件缺失：请先运行 node tests/verify-file-granularity.js --record-baseline')
    process.exit(1)
  }
  const files = listJsFiles()
  const current = {}
  for (const rel of files) current[rel] = countLines(rel)

  // ---- 基线完整性：过期条目必须清理，不许留着装样子 ----
  for (const rel of Object.keys(baseline.files).sort()) {
    if (!(rel in current)) {
      check(false, '基线过期：' + rel + ' 已不存在（删除或改名），请重录基线')
    } else if (current[rel] <= LIMIT) {
      check(false, '基线过期：' + rel + ' 已降到 ' + current[rel] + ' 行（达标），请重录基线把它移出')
    }
  }
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 逐文件判定 ----
  let compliant = 0
  for (const rel of files) {
    const n = current[rel]
    if (n <= LIMIT) { compliant++; continue }
    const base = baseline.files[rel]
    const severe = n > SEVERE ? '（严重：超 500 行，阻断发布）' : ''
    if (base === undefined) {
      check(false, rel + ' 新增超标：' + n + ' 行（上限 ' + LIMIT + '）' + severe)
    } else if (n > base) {
      check(false, rel + ' 继续膨胀：基线 ' + base + ' → 现 ' + n + ' 行，只许减不许增' + severe)
    } else {
      check(true, rel + ' 冻结中：基线 ' + base + '，现 ' + n + ' 行（未增长）' + severe)
    }
  }
  console.log('  INFO 其余 ' + compliant + ' 个文件全部 ≤' + LIMIT + ' 行，共扫 ' + files.length + ' 个 src/ 文件')

  if (failed) console.log('\n存在失败')
  else console.log('\n全部通过')
  process.exit(failed ? 1 : 0)
}

main()
