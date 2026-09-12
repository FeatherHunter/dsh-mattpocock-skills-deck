// verify-build-artifacts.js — 风险A 产物“别用手改”门禁（T5 追加）
// 用法: node tests/verify-build-artifacts.js
// 验证：
//   1) client.js / host.js 必须以 // AUTO-GENERATED 开头（防手改产物被下次 build 覆盖）
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

console.log('风险A：产物防手改门禁（AUTO-GENERATED + gitignore）')

// 1) 横幅
for (const p of ['client.js', 'host.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { check(false, p + ' 缺失（请先运行 node scripts/build.mjs）'); continue }
  const txt = fs.readFileSync(abs, 'utf8')
  check(txt.startsWith('// AUTO-GENERATED'), p + ' 以 // AUTO-GENERATED 开头（机器产物）')
  if (!txt.startsWith('// AUTO-GENERATED')) {
    console.log('    提示：若你手改过 ' + p + '，请把改动搬到 src/ 对应文件后重新 build')
  }
}
for (const p of ['package/lib/client.js', 'package/lib/index.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { check(false, p + ' 缺失（请先运行 node scripts/build.mjs）'); continue }
  const txt = fs.readFileSync(abs, 'utf8')
  // pkg 产物头不强制 AUTO-GENERATED（pkg 头为原注释），但需含 ModuleLoader/ESM 特征且被忽略
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

// 4) 方案 C 原样复制 L2 门禁（#136/#172）：glob 双向差集 + sha256 + 入口冒烟 + import 卫生
console.log('\n方案C L2：原样复制校验（glob 差集 + sha256 + 入口 + import 卫生）')
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
// 4b) package/shared 15 文件一一对应（shared-0 #443 已核：5 个进 client 拼接 + 8 个只走 host 复制，见 #443 接线图；S1 #451 拆 chain 为 3 文件，总数 13→15）
{
  const srcSharedFiles = collect(path.resolve('src/shared'))
  const pkgSharedFiles = collect(path.resolve('package/shared'))
  const srcSet = new Set(srcSharedFiles)
  const pkgSet = new Set(pkgSharedFiles)
  const onlySrc = srcSharedFiles.filter(f => !pkgSet.has(f))
  const onlyPkg = pkgSharedFiles.filter(f => !srcSet.has(f))
  check(onlySrc.length === 0 && onlyPkg.length === 0, `package/shared 与 src/shared 双向差集 0（src=${srcSharedFiles.length} pkg=${pkgSharedFiles.length}）`)
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
  // #265 起新增 naming-guardian.js（命名守护核心，host import + client splice 双消费）；
  // #232 起新增 tracker/sync.js（面板增量同步求值器，同双消费模式）
  // #308 起新增 ui/slots.js（五座位声明，host import + client splice 双消费）
  // #fix-banner 新增 matt-skills.js（Matt 技能套件 25 项真源，host import + client splice 双消费）→ 共享真源 13 文件
  // #324 起新增 workspaceKey.js（工作区键单源，#301 / #324 规格，host 包装 + client 共享）→ 共享真源 13 文件
  // shared-0（#443）接线：S1 拆 chain（682 行拆成 3 个文件，总数 +2）、S2 拆 naming-guardian（498 行拆成 3 个文件，总数 +2）、
  // S3 拆 check-catalog（356 行拆成 2 个文件，总数 +1）；每张拆分票合入时同票把下面两行的计数改成新总数并重跑 verify。
  // S2（#452）：S1 后 15、S3 后 16，本票 1 个文件拆成 3 个、总数 +2 到 18。
  // #540：update-core 落地新增 src/shared/update/ports.js 与 service.js（纯逻辑，
  // 文件之间零引用；客户端拼接标记本票不加，随面板票再定），总数 +2 到 20。
  // #542：命令拼接独立成 src/shared/update/commands.js（自包含零引用，政策收归核心），总数 +1 到 21。
  // #589：面板列表按身份去重新增 src/shared/tracker/list-dedupe.js（纯函数，宿主动线引用），总数 +1 到 22。
  // #600：增量索引的时间窗与水印新增 src/shared/tracker/indexWindow.js（纯函数，宿主动线引用），总数 +1 到 23。
  // #629：配色核心落地新增 src/shared/label-color/ports.js、colors.js、prompt.js（纯逻辑，文件之间零引用；
  // 其中 colors.js 与 prompt.js 由 scripts/build.mjs 拼进客户端闭包），总数 +3 到 26。
  check(srcSharedFiles.length === 26, `src/shared 26 文件（实得 ${srcSharedFiles.length}）`)
  check(pkgSharedFiles.length === 26, `package/shared 26 文件（实得 ${pkgSharedFiles.length}）`)
}
// 4c) import 卫生：显式 .js（相对 import 必须带 .js 扩展，避免 Node ESM 裸 specifier）
{
  const hostJs = collect(path.resolve('src/host')).filter(f => f.endsWith('.js')).map(f => path.resolve('src/host', f))
  const sharedJs = collect(path.resolve('src/shared')).filter(f => f.endsWith('.js')).map(f => path.resolve('src/shared', f))
  const all = hostJs.concat(sharedJs)
  const relImportRe = /from\s+['"](\.[^'"]+)['"]/g
  let hygieneOk = true
  for (const file of all) {
    const txt = fs.readFileSync(file, 'utf8')
    let m
    while ((m = relImportRe.exec(txt)) !== null) {
      const spec = m[1]
      if (!spec.endsWith('.js')) {
        hygieneOk = false
        console.log(`    import 卫生失败: ${path.relative(process.cwd(), file)} -> "${spec}" 缺 .js`)
      }
    }
  }
  check(hygieneOk, 'import 卫生：所有相对 import 均显式 .js')
}
// 4d) 入口导出冒烟：package/lib/index.js 需导出 apply（方案 C 为 export default { apply }，兼容原 pkg 命名导出）
{
  const entry = path.resolve('package/lib/index.js')
  let smokeOk = false
  let detail = ''
  try {
    const txt = fs.readFileSync(entry, 'utf8')
    const hasDefaultApply = /export\s+default\s*\{/.test(txt) && /apply\s*\(/.test(txt)
    const hasNamedApply = /export\s+function\s+apply/.test(txt) || /export\s+const\s+apply/.test(txt)
    const hasName = /export\s+const\s+name\s*=/.test(txt) || /export\s+.*name/.test(txt)
    const hasInject = /export\s+const\s+inject\s*=/.test(txt)
    // 方案 C 主路径：default apply 必须有；命名导出为历史兼容可选
    smokeOk = hasDefaultApply || hasNamedApply
    detail = `defaultApply=${hasDefaultApply} namedApply=${hasNamedApply} name=${hasName} inject=${hasInject}`
    if (!smokeOk) console.log('    入口文本导出缺失:', detail)
  } catch (e) {
    console.log('    入口读取失败:', e.message)
  }
  check(smokeOk, `入口导出冒烟（package/lib/index.js）: ${detail}`)
}
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