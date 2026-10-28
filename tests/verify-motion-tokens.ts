// tests/verify-motion-tokens.ts —— 门禁：界面动效时长只有一个真源（#1236）
//
// 为什么要有这扇门禁：界面上的过渡与动画时长（.12s、1.1s、2.4s……）以前散在 11 个文件的样式字符串里，
//   78 处、24 种值。没有门禁的时候它会持续长回来：#1215 开票时底账记的是 42 处、8 个文件，
//   到 2026-10-28 复核时已经变成 51 条声明行、11 个文件，还冒出「注释说从旋钮取、实际写死数字」这种漂移。
//   收敛之后，数字只许住在 src/client/kernel/motion.ts 的 MOTION 对象里；别处再写一个字面时长就判红。
//
// 本门禁守五件事：
//   ① MOTION 的形状：唯一一个对象、键名以 Ms 结尾、值是正整数毫秒、键数够用；
//   ② 每个键都至少被引用一次；引用过的名字都必须有定义（拼错键名会让界面挂上 undefined 时长，这里提前抓）；
//   ③ 全仓只有一份 MOTION 定义，且它自身是纯常量（不许 import、require、export default）；
//   ④ 它确实接进了构建：scripts/build.mts 的模块清单、src/client/index.ts 的拼接标记（排在 kernel:styles 之前，
//      且每个读 MOTION 的模块都排在 kernel:motion 之后——排前面就是 const 暂时性死区）、tests/verify-kernel.ts 的模块档案；
//   ⑤ src/client 下（motion.ts 除外）任何一行只要同时出现 transition/animation 关键字与写死的时长就判红：
//      数字紧贴单位（.12s、120ms）、数字与单位分开拼（' + 200 + 'ms'）、别的变量与单位分开拼（i + 's'）三种形态都算。
//      真要留一处写死的时长，必须去 ⑤ 节的 EXEMPTS 表登记文件、片段与理由——没有理由的豁免不算落点。
//
// 为什么把「无字面时长」判据写成「同一行同时出现关键字 + 时长」而不是「全树禁数字」：
//   样式时长在 CSS 文本与内联样式字符串里，关键字是它唯一的上下文标记；这样既不会误伤 SVG 路径、
//   文案里的秒数、注释里的历史数字，也正好覆盖旧的 42 处判据（research/1236-style-durations.md）。
//   已知边界：字面时长跨行书写（关键字一行、数值另一行）看不见——当前代码形态没有这种写法，
//   真出现时先补「跨行拼接」判据，别在别处另写一套。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-motion-tokens.ts
// 门禁归属: src/client/kernel/motion.ts
const fs = require('fs')
const path = require('path')
const { blankComments } = require('../scripts/lib/effective-lines.mts')

const ROOT = path.resolve(__dirname, '..')
const MOTION_REL = 'src/client/kernel/motion.ts'
const MOTION_FILE = path.join(ROOT, MOTION_REL)
const CLIENT_DIR = path.join(ROOT, 'src/client')

let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 递归收集 src/client 下的 .ts 真源（跳过类型声明文件与构建产物目录）。 */
function clientSources (): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
        walk(full)
        continue
      }
      if (!ent.name.endsWith('.ts') || ent.name.endsWith('.d.ts')) continue
      out.push(full)
    }
  }
  walk(CLIENT_DIR)
  return out.sort()
}

function relOf (file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

// ---------- ① MOTION 的形状 ----------
console.log('== ① MOTION 的形状 ==')
let motionSrc = ''
let motionKeys: string[] = []
let motionValues: Record<string, number> = {}
{
  const exists = fs.existsSync(MOTION_FILE)
  check(exists, MOTION_REL + ' 存在（界面动效时长的唯一真源）')
  if (exists) {
    motionSrc = fs.readFileSync(MOTION_FILE, 'utf8')
    const decls = motionSrc.match(/export const MOTION = \{/g) || []
    check(decls.length === 1, 'motion.ts 里 export const MOTION 对象定义恰好一处（实得 ' + decls.length + ' 处）')
    const start = motionSrc.indexOf('export const MOTION = {')
    const end = motionSrc.indexOf('\n}', start)
    check(start >= 0 && end > start, 'MOTION 对象有明确的收尾大括号')
    const body = start >= 0 && end > start ? motionSrc.slice(start, end) : ''
    const lines = body.split(/\r?\n/).slice(1)
    let badLine: string | null = null
    let dupKey: string | null = null
    const seen: Record<string, boolean> = {}
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      const m = /^([A-Za-z][A-Za-z0-9]*):\s*(\d+),?\s*(?:\/\/.*)?$/.exec(line)
      if (!m) {
        if (!line.startsWith('//')) badLine = line
        continue
      }
      const name = m[1]
      const value = Number(m[2])
      if (seen[name]) dupKey = name
      seen[name] = true
      motionKeys.push(name)
      motionValues[name] = value
    }
    check(badLine === null, '对象体里每一行都是「键: 整数毫秒,」或注释（不合规的行：' + String(badLine) + '）')
    check(dupKey === null, '键名没有重复（重复的：' + String(dupKey) + '）')
    // 键数下限 30 不是目标值，是「对象被截断或误删」的防线：落地时 45 个，低于 30 说明大段丢了。
    check(motionKeys.length >= 30, '键数够用：至少 30 个（实得 ' + motionKeys.length + ' 个）')
    const badName = motionKeys.filter((k) => !/^[a-z][A-Za-z0-9]*Ms$/.test(k))
    check(badName.length === 0, '键名全部以 Ms 结尾、首字母小写（违规：' + (badName.length ? badName.join('、') : '无') + '）')
    // 1~10000 是「像界面动效时长」的范围：现有最长 3 秒，留到 10 秒给以后的大动效；为 0、负数或更大，多半是单位写错。
    const badValue = motionKeys.filter((k) => !Number.isInteger(motionValues[k]) || motionValues[k] < 1 || motionValues[k] > 10000)
    check(badValue.length === 0, '值全是 1~10000 之间的整数毫秒（违规：' + (badValue.length ? badValue.join('、') : '无') + '）')
    // 个别令牌的具体数值被别处测试拿来算边界（tests/verify-ui-feedback.ts 的 B9 用 inkMoveMs 做墨块滑动断言）；
    // 把「名字 → 必须保持的值」钉在这里：改这些值必须同时改消费方测试，这里红一次提醒。
    const PINNED_VALUES: Record<string, number> = { inkMoveMs: 240 }
    const pinBad = Object.keys(PINNED_VALUES).filter((k) => motionValues[k] !== PINNED_VALUES[k])
    check(pinBad.length === 0, '被别处依赖具体数值的令牌保持原值（违规：' + (pinBad.length ? pinBad.join('、') : '无') + '）')
  }
}

// ---------- ② 每个键都被引用、引用名都有定义 ----------
console.log('== ② 引用完整 ==')
{
  const sources = clientSources()
  const refs: Record<string, number> = {}
  const refRe = /MOTION\.([A-Za-z][A-Za-z0-9]*)/g
  for (const file of sources) {
    if (file === MOTION_FILE) continue
    // 先剥注释：注释里写「MOTION.suggest*」这种说明不是真引用，也不能让拼错的键名混进来。
    const code = blankComments(fs.readFileSync(file, 'utf8'))
    for (const m of code.matchAll(refRe)) refs[m[1]] = (refs[m[1]] || 0) + 1
  }
  const unused = motionKeys.filter((k) => !refs[k])
  check(unused.length === 0, '每个键至少被引用一次（没被引用的：' + (unused.length ? unused.join('、') : '无') + '）')
  const unknown = Object.keys(refs).filter((k) => motionValues[k] === undefined)
  check(unknown.length === 0, '引用过的键名都有定义（拼错的：' + (unknown.length ? unknown.join('、') : '无') + '）')
}

// ---------- ③ 唯一真源、纯常量 ----------
console.log('== ③ 唯一真源 ==')
{
  const offenders: string[] = []
  for (const file of clientSources()) {
    if (file === MOTION_FILE) continue
    const code = blankComments(fs.readFileSync(file, 'utf8'))
    // 只认真定义（const MOTION = ...）；`declare const MOTION: any;` 是闭包内跨片引用必需的声明，不是第二份真源。
    if (/\bconst\s+MOTION\s*=/.test(code)) offenders.push(relOf(file))
  }
  check(offenders.length === 0, 'MOTION 只在 motion.ts 里定义（别处又定义了的：' + (offenders.length ? offenders.join('、') : '无') + '）')
  const blanked = blankComments(motionSrc)
  check(!/^\s*import\s/m.test(blanked) && !/\brequire\s*\(/.test(blanked), 'motion.ts 不自带 import/require（闭包内由构建拼接提供）')
  check(!/export default/.test(blanked), 'motion.ts 不用 export default（客户端闭包契约）')
}

// ---------- ④ 接进了构建 ----------
console.log('== ④ 构建登记 ==')
{
  const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mts'), 'utf8')
  check(buildSrc.indexOf("{ name: 'motion', file: 'src/client/kernel/motion.ts' }") >= 0,
    'scripts/build.mts 的 KERNEL_MODULES 登记了 motion 片')
  const indexSrc = fs.readFileSync(path.join(ROOT, 'src/client/index.ts'), 'utf8')
  const marker = indexSrc.indexOf('// ==== kernel:motion (spliced by build) ====')
  const stylesMarker = indexSrc.indexOf('// ==== kernel:styles (spliced by build) ====')
  check(marker >= 0, 'src/client/index.ts 留了 kernel:motion 拼接标记')
  check(marker >= 0 && stylesMarker >= 0 && marker < stylesMarker,
    'motion 标记排在 kernel:styles 之前（样式字符串在模块求值时就拼好，const 有暂时性死区）')
  const kernelGate = fs.readFileSync(path.join(ROOT, 'tests/verify-kernel.ts'), 'utf8')
  check(/\{ name: 'motion'[^}]*exports: \['MOTION'\] \}/.test(kernelGate),
    'tests/verify-kernel.ts 的模块档案登记了 motion（否则「改了没重建」没人拦）')

  // 只查「motion 排在 styles 前面」不够：另外 12 个模块也会在求值时读 MOTION（11 个样式叶子与内联样式的视图），
  // 任何一个被挪到 kernel:motion 之前，闭包里就是 const 暂时性死区，整块面板不加载。所以把 build.mts 的
  // 模块清单（kernel 用 name、leaf 用 id）与 index.ts 的标记顺序对起来，逐个检查引用方。
  const buildEntries: { name: string; file: string }[] = []
  const entryRe = /\{\s*(?:name|id):\s*'([^']+)',\s*file:\s*'(src\/client\/[^']+)'\s*\}/g
  for (const m of buildSrc.matchAll(entryRe)) buildEntries.push({ name: m[1], file: m[2] })
  const entryOfFile = new Map(buildEntries.map((e) => [e.file, e.name]))
  const markerRe = /\/\/ ==== (kernel|leaf|shared):([A-Za-z0-9_]+) \(spliced by build\) ====/g
  const markerPos = new Map<string, number>()
  let order = 0
  let motionPos = -1
  for (const m of indexSrc.matchAll(markerRe)) {
    markerPos.set(m[1] + ':' + m[2], order)
    if (m[1] === 'kernel' && m[2] === 'motion') motionPos = order
    order++
  }
  const refFiles: string[] = []
  for (const file of clientSources()) {
    if (file === MOTION_FILE) continue
    if (/MOTION\./.test(blankComments(fs.readFileSync(file, 'utf8')))) refFiles.push(file)
  }
  const lateRefs: string[] = []
  const unplacedRefs: string[] = []
  for (const file of refFiles) {
    const rel = relOf(file)
    const modName = entryOfFile.get(rel)
    if (!modName) {
      unplacedRefs.push(rel)
      continue
    }
    const pos = markerPos.get('kernel:' + modName) ?? markerPos.get('leaf:' + modName)
    if (pos === undefined) unplacedRefs.push(rel)
    else if (pos < motionPos) lateRefs.push(rel)
  }
  check(motionPos >= 0 && lateRefs.length === 0,
    '读 MOTION 的模块都排在 kernel:motion 之后（排前面的：' + (lateRefs.length ? lateRefs.join('、') : '无') + '）')
  check(unplacedRefs.length === 0,
    '读 MOTION 的模块都能在 build.mts 与 index.ts 里找到拼接位置（找不到的：' + (unplacedRefs.length ? unplacedRefs.join('、') : '无') + '）')
}

// ---------- ⑤ 除真源外不许再写死时长 ----------
console.log('== ⑤ 无裸时长 ==')
{
  const KEYWORD_RE = /transition|animation/i
  // 写法一：数字紧贴单位（.12s、120ms、1s、2.4s）。前面不是标识符字符、后面不是标识符字符，
  //   所以 steps(2,end)、30% 不算。
  const DURATION_RE = /(?:^|[^A-Za-z0-9_.])[0-9]*\.?[0-9]+(?:ms|s)(?![A-Za-z0-9_])/
  // 写法二：数字与单位分开拼（' + 200 + 'ms steps(...)'）。改造完成之后最容易出现的回退写法就是它，必须抓。
  const NUMBER_CONCAT_RE = /(?:\+|=)\s*\d+\s*\+\s*['"](?:ms|s)\b/
  // 写法三：别的变量与单位分开拼（animationDelay: i + 's'）。先把合法的「MOTION.键 + 'ms…」整段剥掉，
  //   再看剩下还有没有「标识符 + 'ms…」；这样每一次正常拼接不会被误报。
  //   注意单位字符串往往是一段长 CSS 的开头（'ms steps(2,end)…'），所以引号后只要求紧跟 ms/s 边界，不要求右引号。
  const MOTION_UNIT_RE = /MOTION\.[A-Za-z][A-Za-z0-9]*\s*\+\s*['"](?:ms|s)\b/g
  const VARIABLE_CONCAT_RE = /(?:^|[^.\w$])[A-Za-z_$][\w$]*\s*\+\s*['"](?:ms|s)\b/
  // 豁免落点：每一行都必须写明「这个写死的时长为什么可以留在源码里」。没有理由的豁免不算落点。
  // 典型场景：第三方 CSS 原样搬运、必须写 0s 才能关掉动画、运行时派生值的外部约定。
  const EXEMPTS: { file: string; snippet: string; reason: string }[] = []

  const hits: { file: string; lineNo: number; text: string; kind: string }[] = []
  for (const file of clientSources()) {
    if (file === MOTION_FILE) continue
    const lines = blankComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!KEYWORD_RE.test(line)) continue
      let kind = ''
      if (DURATION_RE.test(line)) kind = '字面时长'
      else if (NUMBER_CONCAT_RE.test(line)) kind = '数字拼单位'
      else if (VARIABLE_CONCAT_RE.test(line.replace(MOTION_UNIT_RE, ''))) kind = '变量拼单位'
      if (!kind) continue
      hits.push({ file: relOf(file), lineNo: i + 1, text: line.trim().slice(0, 160), kind })
    }
  }

  // 豁免表自检：理由必须写；登记过的行必须仍能对上现在的违例（对不上说明码已经改了，删掉这行）。
  for (const row of EXEMPTS) {
    check(row.reason.trim().length > 0, 'EXEMPTS 行写明了理由（' + row.file + '：“' + row.snippet + '”）')
    check(hits.some((h) => h.file === row.file && h.text.indexOf(row.snippet) >= 0),
      'EXEMPTS 行仍能对上现码（' + row.file + '：“' + row.snippet + '”）')
  }
  const offenders = hits.filter((h) => !EXEMPTS.some((row) => row.file === h.file && h.text.indexOf(row.snippet) >= 0))
  check(offenders.length === 0,
    'src/client 里没有写死的 transition/animation 时长（三种形态都算；真需要留一处就来 EXEMPTS 登记理由。实得 ' + offenders.length + ' 处）')
  if (offenders.length) {
    for (const h of offenders.slice(0, 80)) console.log('    - ' + h.file + ':' + h.lineNo + ' [' + h.kind + ']  ' + h.text)
    if (offenders.length > 80) console.log('    …还有 ' + (offenders.length - 80) + ' 处')
  }
}

console.log('')
console.log('verify-motion-tokens：' + total + ' 条断言，' + (failed ? '有失败项' : '全部通过'))
process.exit(failed ? 1 : 0)
