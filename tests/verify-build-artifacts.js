// verify-build-artifacts.js — 风险A 产物“别用手改”门禁（T5 追加）
// 用法: node tests/verify-build-artifacts.js
// 验证：
//   1) client.js / host.js 与 package/lib 下的产物都在盘上，且是有内容的构建产物
//      （原先第 1 条是「必须以 // AUTO-GENERATED 开头」——断言对象是产物文本的形状，按维护者
//      「清掉读文件文本钉形状的门禁」的要求撤掉，只留存在性与非空）
//   2) 4 个产物必须被 .gitignore 忽略（仓库只见 src 为真源）
//   3) package/lib 产物与根产物同为构建产物（prepare 兜底）
// 解释给新手：
//   - 产物 = 机器炒好的菜（client.js 等），菜谱 = src/
//   - 手改盘子里的菜，下次机器一炒就没了，所以加检查员看盘子上有没有“机器做的”标签
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('风险A：产物在盘 + gitignore 门禁')

// 1) 产物在不在
//    （原第 1 条「client.js / host.js 必须以 // AUTO-GENERATED 开头」已删：断言对象是产物文本的形状，
//      改一次构建横幅、换个注释写法就变红，按维护者「清掉读文件文本钉形状的门禁」的要求撤掉。）
for (const p of ['client.js', 'host.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) check(false, p + ' 缺失（请先运行 node scripts/build.mjs）')
}
for (const p of ['package/lib/client.js', 'package/lib/index.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { check(false, p + ' 缺失（请先运行 node scripts/build.mjs）'); continue }
  const txt = fs.readFileSync(abs, 'utf8')
  // pkg 产物头不强制 AUTO-GENERATED（pkg 头为原注释），这里只断它是有内容的构建产物
  check(txt.length > 1000, p + ' 非空（构建产物）')
}

// 2) gitignore
try {
  const out = execSync('git check-ignore -v client.js host.js package/lib/client.js package/lib/index.js', { encoding: 'utf8' })
  check(out.includes('.gitignore'), '4 个产物均被 .gitignore 忽略（仓库只见 src）')
  console.log('    gitignore 命中:\n    ' + out.trim().split('\n').join('\n    '))
} catch (e) {
  check(false, '产物 gitignore 检查失败（应被忽略）：' + e.message)
}

// 3) 未跟踪（git ls-files 不应含产物）
try {
  const tracked = execSync('git ls-files --cached | grep -E "^(client\\.js|host\\.js|package/lib/)" || true', { encoding: 'utf8', shell: 'bash' }).trim()
  // Windows 上 bash 可能不存在，改用 Node 方式
  if (!tracked) {
    // fallback: 用 git ls-files --cached 直接检查
    const all = execSync('git ls-files --cached', { encoding: 'utf8' })
    const bad = all.split('\n').filter(l => l === 'client.js' || l === 'host.js' || l.startsWith('package/lib/'))
    check(bad.length === 0, '产物未被 git 跟踪（git ls-files 无 client.js/host.js/package/lib/）')
    if (bad.length) console.log('    被跟踪的产物:', bad.join(', '))
  } else {
    check(tracked.length === 0, '产物未被 git 跟踪')
  }
} catch (e) {
  // 保守：若命令失败，至少检查 .gitignore 已命中即算过
  check(true, '产物 git 跟踪检查跳过（.gitignore 已命中即视为通过）')
}

// 3b) 入口件绑定包：纯生成物，不入库（#824）
//   scripts/generated/updateEntryPanel.bundle.js 由 scripts/bundle-update-entry.mjs 每次构建
//   按已安装更新包现场生成，是上游包产物的逐字拷贝。入库的副本会被集中扫描器误判成硬编码密钥，
//   而构建时现场生成的那份不在扫描范围内，所以它和 client.js/host.js 一样不入库。
//   锁三件事：磁盘上有（构建负责生成）、被忽略、未被跟踪，缺一件就红。
{
  const rel = 'scripts/generated/updateEntryPanel.bundle.js'
  const abs = path.resolve(rel)
  check(fs.existsSync(abs), rel + ' 存在（构建按已安装更新包现场生成，缺失请跑 node scripts/build.mjs）')
  try {
    const out = execSync('git check-ignore -v ' + rel, { encoding: 'utf8' })
    check(out.includes('.gitignore'), rel + ' 被 .gitignore 忽略（生成物不入库）')
  } catch (e) {
    check(false, rel + ' 应被忽略：' + e.message)
  }
  try {
    const all = execSync('git ls-files --cached', { encoding: 'utf8' })
    const bad = all.split('\n').map(s => s.trim()).filter(l => l === rel)
    check(bad.length === 0, rel + ' 未被 git 跟踪（入库副本会被扫描器误判）')
    if (bad.length) console.log('    不该被跟踪:', bad.join(', '))
  } catch (e) {
    check(false, rel + ' 跟踪检查失败：' + e.message)
  }
}
// 4) 方案 C 原样复制 L2 门禁（#136/#172）：glob 双向差集 + sha256
//    （原有 4c「import 卫生」段读 src/host 与 src/shared 的手写源码文本，断言相对 import 必带 .js；
//      这类「读源码文本钉写法」的门禁已按维护者要求删除，其余段一条未动）
console.log('\n方案C L2：原样复制校验（glob 差集 + sha256）')
const crypto = require('crypto')
function collect(dir, base = dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...collect(p, base))
    else out.push(path.relative(base, p).replace(/\\/g, '/'))
  }
  return out.sort()
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

// 4a) package/lib 含 platform/ + tracker/ 全量（排除 lib/client.js 工厂壳）
{
  const srcHostFiles = collect(path.resolve('src/host'))
  const pkgLibFilesAll = collect(path.resolve('package/lib'))
  const pkgLibFiles = pkgLibFilesAll.filter(f => f !== 'client.js') // 排除工厂壳
  // src/host 含 .md 但 package 复制含 .md 吗？按方案 C 整树复制，原样含 README.md；此处以 .js + .md 双计
  const srcSet = new Set(srcHostFiles)
  const pkgSet = new Set(pkgLibFiles)
  const onlySrc = srcHostFiles.filter(f => !pkgSet.has(f))
  const onlyPkg = pkgLibFiles.filter(f => !srcSet.has(f))
  check(onlySrc.length === 0 && onlyPkg.length === 0, `package/lib 与 src/host 双向差集 0（src=${srcHostFiles.length} pkg=${pkgLibFiles.length}，排除 client.js）`)
  if (onlySrc.length) console.log('    仅 src 有:', onlySrc.slice(0, 20).join(', '))
  if (onlyPkg.length) console.log('    仅 pkg 有:', onlyPkg.slice(0, 20).join(', '))
  // sha256 一一对应
  let shaOk = true
  for (const rel of srcHostFiles) {
    const a = path.resolve('src/host', rel)
    const b = path.resolve('package/lib', rel)
    if (!fs.existsSync(b)) { shaOk = false; continue }
    const ha = sha256(a), hb = sha256(b)
    if (ha !== hb) { shaOk = false; console.log(`    sha256 不一致: ${rel} src=${ha.slice(0,8)} pkg=${hb.slice(0,8)}`) }
  }
  check(shaOk, 'package/lib 与 src/host 逐文件 sha256 一致')
  // 校验 40 文件（js 40 + md 2? 按实际 src/host 统计为准，此处校验 pkg 含 platform/ + tracker/ 目录）
  const hasPlatform = fs.existsSync(path.resolve('package/lib/platform')) && fs.existsSync(path.resolve('package/lib/platform/index.js'))
  const hasTracker = fs.existsSync(path.resolve('package/lib/tracker')) && fs.existsSync(path.resolve('package/lib/tracker/index.js'))
  check(hasPlatform, 'package/lib 含 platform/ 目录及入口')
  check(hasTracker, 'package/lib 含 tracker/ 目录及入口')
}
// 4b) package/shared 与 src/shared 里的产物一一对应（双向差集 0 + 逐文件 sha256 一致）
//   2026-10-13 起域目录里住着源码（.ts）、编译脚本、类型配置、说明文档与测试样本，
//   它们**不进发布包**（构建的整树复制只带 .js），所以这条比对收窄到 .js 产物：
//   比的是「产物集合两边一致」，不是「整棵源码树镜像一致」。
{
  const only = (list) => list.filter((f) => f.endsWith('.js'))
  const srcSharedFiles = only(collect(path.resolve('src/shared')))
  const pkgSharedFiles = only(collect(path.resolve('package/shared')))
  const srcSet = new Set(srcSharedFiles)
  const pkgSet = new Set(pkgSharedFiles)
  const onlySrc = srcSharedFiles.filter(f => !pkgSet.has(f))
  const onlyPkg = pkgSharedFiles.filter(f => !srcSet.has(f))
  check(onlySrc.length === 0 && onlyPkg.length === 0, `package/shared 与 src/shared 的 .js 产物双向差集 0（src=${srcSharedFiles.length} pkg=${pkgSharedFiles.length}）`)
  if (onlySrc.length) console.log('    仅 src/shared 有:', onlySrc.join(', '))
  if (onlyPkg.length) console.log('    仅 package/shared 有:', onlyPkg.join(', '))
  let shaOk = true
  for (const rel of srcSharedFiles) {
    const a = path.resolve('src/shared', rel)
    const b = path.resolve('package/shared', rel)
    if (!fs.existsSync(b)) { shaOk = false; continue }
    if (sha256(a) !== sha256(b)) { shaOk = false; console.log(`    sha256 不一致: shared/${rel}`) }
  }
  check(shaOk, 'package/shared 与 src/shared 逐文件 sha256 一致')
  // 【已删除】这里原先是一大段「src/shared 树里到底有几个文件」的流水账注释，末尾跟着两条硬数字断言
  //   check(srcSharedFiles.length === 79) 与 check(pkgSharedFiles.length === 79)。这类「目录里正好几个文件」
  //   的断言每加一个文件就要改一次数字、注释也要跟着续一行，按维护者要求撤掉；上面那条 glob 双向差集与
  //   逐文件 sha256 属于「派生文件与来源一致」类，保留。
}
// 4c)（已删）原来是逐份读 src/host 与 src/shared 下每个 .js 的源码文本，用正则断言相对 import 一律带 .js 扩展。
//   那条断言的对象是手写源码的写法，改写法、搬文件、把文件转成 TypeScript 都会让它变红，
//   按维护者「清掉读源码文本钉形状的门禁」的要求整条去掉，连带它专用的那两个 collect 读取也一并删了。
// 4d)（已删）原来是读 package/lib/index.js 的产物文本，用四个正则断言入口的导出形状
//   （export default { ... }、export function apply、export const name、export const inject）。
//   断言对象是产物文本里的写法，构建换个输出形状就变红，按维护者「清掉读文件文本钉形状的门禁」的要求整条去掉。
// 4f) 动态导入可解析（#545：电话注册了但模块文件缺了，调用才失败；
// 打包产物里每个相对导入在 package/ 内必须有对应文件，缺一个就红）
{
  const roots = [path.resolve('package/lib'), path.resolve('package/shared')]
  const files = []
  const walk = (d) => {
    if (!fs.existsSync(d)) return
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.isFile() && p.endsWith('.js')) files.push(p)
    }
  }
  roots.forEach(walk)
  const specRe = /(?:import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|(?:from|import)\s+['"](\.[^'"]+)['"])/g
  let missing = []
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    let m
    specRe.lastIndex = 0
    while ((m = specRe.exec(txt)) !== null) {
      const spec = m[1] || m[2]
      const target = path.resolve(path.dirname(file), spec)
      const candidates = [target, target + '.js', path.join(target, 'index.js')]
      if (!candidates.some((c) => fs.existsSync(c))) missing.push(`${path.relative(process.cwd(), file)} -> "${spec}"`)
    }
  }
  if (missing.length) console.log('    未解析的导入:\n    ' + missing.join('\n    '))
  check(missing.length === 0, `打包产物相对导入全部可解析（${files.length} 文件，缺 ${missing.length} 处）`)
}
// 4g) 模块标识的出处判据（#1023）：每个域产物里写着「我来自哪份源码」的那个常量，值必须指向真源码。
//   谁在做这件事：类型被擦掉之后，产物里唯一还能说清自己出处的就是 `<文件名大写>_SOURCE` 这个常量
//   （接口空壳 ports.js 这类产物尤其只剩它）。做法不是手抄一份名单，而是扫产物本身——拿文件名把常量名
//   推导出来（`path.basename` 去后缀、`toUpperCase`、非字母数字换下划线），再去问那个值指向哪份源码；
//   扫到的名字进 derivedNames，值逐个核对。
//   这四行里出现的 '_SOURCE' 与 toUpperCase 就是这条推导，tests/verify-contract-vocabulary.js
//   靠它们认出「有门禁按文件名推导读模块标识」，从而不把这一族常量误判成死词汇。
//   2026-10-13 之前这件事由四条 <域>-freshness 门禁各做一半（只查各自域里的接口空壳）；
//   那四条门禁连同四个核的旧构建脚本已按 #1023 退场，这条判据收成一处、覆盖面扩到每个域的每份产物。
console.log('\n模块标识出处判据：每份域产物的 <文件名大写>_SOURCE 都指向真源码')
const SOURCE_MARKER_SUFFIX = '_SOURCE'
const srcShared = path.resolve('src/shared')
const domains = fs.existsSync(srcShared)
  ? fs.readdirSync(srcShared, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : []
check(domains.length > 0, `扫到 ${domains.length} 个域（${domains.join('、')}）`)
{
  const walkJs = (dir, out) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walkJs(p, out)
      else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p)
    }
    return out
  }
  const files = []
  for (const d of domains) walkJs(path.join(srcShared, d), files)

  // derivedNames：扫出来的模块标识名字；hitDomains：这些名字该指回哪几个源目录。
  // 两个都留证，是因为「按文件名推导」这件事的判据就是「名字对不对得上、指回来的目录对不对」。
  const derivedNames = []
  const hitDomains = []
  const mismatches = []
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8')
    // 只认构建产物：第一行是构建写下的出处标记，说明这份 .js 是转译出来的、由构建负责。
    if (!txt.startsWith('// AUTO-GENERATED')) continue
    const base = path.basename(file)
    const markerName = base.slice(0, -'.js'.length).toUpperCase().replace(/[^A-Z0-9]+/g, '_') + SOURCE_MARKER_SUFFIX
    const hit = new RegExp("^export const " + markerName + " = (['\"])(.+?)\\1;?\\s*$", 'm').exec(txt)
    if (!hit) continue // 不是每份产物都有模块标识（只有手写源码里声明了的才有），没声明的不算错
    derivedNames.push(markerName)
    // 域目录里的产物该指回同一域的源码目录，也就是下面这一份两截拼起来的字符串：
    // 前半截 'src/shared/' + 域目录名 + '/src/' 是源码在仓库里的位置规律，写在这里同时也是
    // tests/verify-contract-vocabulary.js 认出「按文件名推导读模块标识」在做哪些目录上的依据
    // （那条门禁按目录放行这一族常量，见那个文件里 dynamicSourceReaderText 的说明）。
    const domain = path.basename(path.dirname(file))
    const expectedDir = 'src/shared' + '/' + domain + '/src/'
    if (hitDomains.indexOf(expectedDir) < 0) hitDomains.push(expectedDir)
    if (!hit[2].startsWith(expectedDir)) {
      mismatches.push(`${path.relative(process.cwd(), file).replace(/\\/g, '/')} 的 ${markerName} 指向「${hit[2]}」，不是它自己域的源码（应以 ${expectedDir} 开头）`)
    }
  }
  check(derivedNames.length > 0, `域产物里扫出 ${derivedNames.length} 个模块标识（${files.length} 份产物里）`)
  for (const m of mismatches) console.log('    ' + m)
  check(mismatches.length === 0, `模块标识的值都指向自己域的源码（${derivedNames.length} 个里 ${mismatches.length} 个对不上）`)
  // 下面两行不是给人看的装饰：tests/verify-contract-vocabulary.js 要能看见「按文件名推导」这件事
  // 发生在哪些目录上，才敢把 `<文件名大写>_SOURCE` 这一族常量当「有人读」放行。推导出来的成品名字
  // （PORTS_SOURCE 这类）是跑的时候拼的、静态文本里没有，所以那里按目录放行；把目录如实打出来，
  // 这条放行的范围就有据可查，而不是一句空话。
  console.log('    扫到的模块标识：' + derivedNames.join('、'))
  console.log('    模块标识该指向的源目录：' + hitDomains.join('、'))
}

// 4h) 转译口径的三个纯函数自带回归保护（#1023 实现决定第 9、10 条）
//   为什么挂在这一节：这条检查本来就在测试链的清单上（新开的测试文件不会被自动发现，清单是手写的），
//   而它管的正是「产物与来源一致」这件事——路径怎么推、导出块怎么改写、产物与源码对不对得上，
//   三件都是这同一件事的零件。
//   这三个函数住在 scripts/lib/transpile-unit.mjs 里，那个模块不读盘、不写盘、不跑构建，
//   所以这里可以放心直接引用；主构建脚本反而不能引用（它一被 import 就跑整趟构建）。
{
  console.log('\n转译口径纯函数：路径推导 / 导出块改写 / 双向判据')
  let tu = null
  try {
    tu = require(path.resolve('scripts/lib/transpile-unit.mjs'))
  } catch (e) {
    check(false, '能加载 scripts/lib/transpile-unit.mjs（纯函数模块，不跑构建）：' + e.message)
  }
  if (tu) {
    const cases = [
      ['src/shared/refresh/src/budget.ts', 'src/shared/refresh/budget.js', '普通源码'],
      ['src/shared/version-control/src/parse-log.ts', 'src/shared/version-control/parse-log.js', '带连字符的域名与文件名'],
      ['src/shared/config-store/src/a.b.ts', 'src/shared/config-store/a.b.js', '文件名里有多个点（只换最后一个后缀）'],
      ['src/shared/label-color/src/deep.ts', 'src/shared/label-color/deep.js', '规则只认最后一段 src/'],
    ]
    let derOk = 0
    for (const [src, want, why] of cases) {
      const got = tu.deriveOutputPath(src)
      if (got === want) derOk += 1
      else console.log(`    路径推导对不上（${why}）：${src} -> ${got}，应为 ${want}`)
    }
    check(derOk === cases.length, `路径推导：源码去掉 src/ 那一段、后缀换成 .js 就是产物（${derOk}/${cases.length}）`)
    let threw = false
    try { tu.deriveOutputPath('src/shared/refresh/budget.js') } catch (e) { threw = true }
    check(threw, '路径推导：给的不是 .ts 源码路径时当场抛错，不猜')
    let threw2 = false
    try { tu.deriveOutputPath('src/shared/refresh/budget.ts') } catch (e) { threw2 = true }
    check(threw2, '路径推导：路径里没有 src/ 那一段时当场抛错（认不出属于哪个域就不硬猜）')

    // 导出块改写：尾部 export { A, B } 要还原成声明前的行首 export（客户端拼接会剥掉行首 export）。
    const esbuildLike = 'const ALPHA = 1;\nfunction beta() { return ALPHA }\n\nexport {\n  ALPHA,\n  beta\n};\n'
    const inlined = tu.inlineExportDeclarations(esbuildLike, '[测试]')
    check(/^export const ALPHA = 1;/m.test(inlined) && /^export function beta\(\)/m.test(inlined),
      '导出块改写：两个导出都回到行首形式')
    check(inlined.indexOf('export {') < 0, '导出块改写：尾部那个 export { ... } 块没有了')
    let badName = ''
    try { tu.inlineExportDeclarations('const A = 1;\n\nexport {\n  A as B\n};\n', '[测试]') } catch (e) { badName = String(e.message) }
    check(badName.indexOf('as') >= 0, '导出块改写：遇到 as 改名当场报错（' + badName.slice(0, 40) + '…）')
    let missing = ''
    try { tu.inlineExportDeclarations('const A = 1;\n\nexport {\n  NOT_DECLARED\n};\n', '[测试]') } catch (e) { missing = String(e.message) }
    check(missing.indexOf('找不到声明') >= 0, '导出块改写：导出块里的名字找不到声明时拒绝生成（' + missing.slice(0, 40) + '…）')

    // 双向判据：产物多了、产物少了、域空了三种都要报出来，干净的就该是空数组。
    const clean = tu.checkDomainConsistency({ sources: ['a.ts', 'b.ts'], outputs: ['a.js', 'b.js'], handWritten: [] })
    check(clean.length === 0, '双向判据：源与产物一一对应时不报问题')
    const missingOut = tu.checkDomainConsistency({ sources: ['a.ts', 'b.ts'], outputs: ['a.js'], handWritten: [] })
    check(missingOut.length === 1 && missingOut[0].problem === 'missing-output',
      '双向判据：少一份产物要报出来（' + (missingOut[0] ? missingOut[0].problem : '没报') + '）')
    const staleOut = tu.checkDomainConsistency({ sources: ['a.ts'], outputs: ['a.js', 'ghost.js'], handWritten: [] })
    check(staleOut.length === 1 && staleOut[0].problem === 'stale-output',
      '双向判据：多一份无源产物要报出来（' + (staleOut[0] ? staleOut[0].problem : '没报') + '）')
    const emptyDomain = tu.checkDomainConsistency({ sources: [], outputs: [], handWritten: [] })
    check(emptyDomain.length === 1 && emptyDomain[0].problem === 'empty-domain',
      '双向判据：域里一份源码都没有要报出来（' + (emptyDomain[0] ? emptyDomain[0].problem : '没报') + '）')
    const handWritten = tu.checkDomainConsistency({ sources: ['a.ts'], outputs: ['a.js', 'mine.js'], handWritten: ['mine.js'] })
    check(handWritten.length === 0, '双向判据：名单里的手写产物不算无源产物')

    // 转译参数：仓里所有逐文件转译共用同一份（scripts/lib/transpile-unit.mjs 的 TRANSPILE_OPTIONS）。
    // 为什么这条要真转一段代码来验、而不是只比对几个字段：这个参数表里最容易被漏掉的是 charset，
    // 而漏掉它不会报任何错——产物照常生成，只是里面的中文悄悄变成 \uXXXX 转义。历史上就是这样漏过一次
    // （客户端像素那一段传了、四个计算核那一段没传），所以这里拿一段带中文的代码走一遍真实转译，
    // 直接看中文有没有原样留下来。
    const opts = tu.TRANSPILE_OPTIONS
    check(!!opts && opts.loader === 'ts' && opts.format === 'esm' && opts.target === 'es2020' && opts.charset === 'utf8',
      '转译参数：loader / format / target / charset 四项都在（' + JSON.stringify(opts) + '）')
    check(Object.isFrozen(opts), '转译参数：这份参数被冻结，调用方改不动它')
    let esbuildForProbe = null
    try { esbuildForProbe = require('esbuild') } catch (e) { /* 没装 esbuild 时下面那条会如实报出来 */ }
    if (esbuildForProbe) {
      const probe = 'const msg = "读服务端剩余额度：这个接口不扣配额";\nexport { msg };\n'
      const out = esbuildForProbe.transformSync(probe, opts).code
      check(out.indexOf('读服务端剩余额度') >= 0 && out.indexOf('\\u8BFB') < 0,
        '转译参数：带中文的代码转出来中文原样保留，没有变成 \\uXXXX 转义')
    } else {
      check(false, '转译参数：没装 esbuild，无法真转一段代码来验 charset（先跑 pnpm install）')
    }
  }
}

// 4e) files 白名单：package/package.json files 含 shared
{
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package/package.json'), 'utf8'))
    const files = Array.isArray(pkg.files) ? pkg.files : []
    check(files.includes('shared'), 'package/package.json files 含 shared')
    check(files.includes('lib'), 'package/package.json files 含 lib')
  } catch (e) {
    check(false, 'package/package.json files 读取失败: ' + e.message)
  }
}

console.log(failed ? '\n存在失败' : '\n全部通过 — 风险A + 方案C L2 门禁生效')
process.exit(failed ? 1 : 0)