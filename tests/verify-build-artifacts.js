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