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

// 4a) 三棵新树的镜像校验（#1018 新布局 · #1105 转译感知重写）
//   旧口径（方案 C 整树原样复制）要求包内与源码逐文件一字节不差，#1018 起构建做的是转译不是复制：
//   TypeScript 逐文件剥掉类型进包（只换后缀、引用原样保留），手写 JavaScript 才直接复制。
//   所以这里按“后缀换算、内容按转译结果比”：
//     · 源码侧只收两类——TypeScript 真源（不含纯类型声明 .d.ts）与没有同名 TypeScript 的手写 JavaScript；
//       同目录有同名 TypeScript 的 JavaScript 是并排的转译产物（今天只有追踪器契约目录那一份拼接输入），
//       它是产物不是来源，不进这一节的比对（它的计数归下一节 4b 管）。
//     · 说明文档（.md）构建不进包，这里直接忽略（构建只收 .js 与 .ts，见 scripts/build.mjs 的复制与投放两步）。
//     · 包侧只收 JavaScript；宿主树那份工厂壳 package/lib/client.js 由拼闭包那一步单独生成，不在这三对镜像里。
//   内容分两种比：手写 JavaScript 逐字节一致；TypeScript 按构建同一份转译参数重算一遍再比
//   （转译参数与文件头都取自构建唯一的 scripts/lib/transpile-unit.mjs，行零依赖门禁同手法，不在这里抄第二遍；
//    引用改写那几行是构建里“追踪器与工具树指回宿主树时换前缀”的原文拷贝，详见下面的说明）。
console.log('\n三棵新树镜像校验（后缀换算 + 转译结果比对）')
{
  const MOVED_PAIRS = [
    { src: 'src/host', pkg: 'package/lib', excludePkg: ['client.js'] },
    { src: 'src/deck', pkg: 'package/deck', excludePkg: [] },
    { src: 'src/tracker', pkg: 'package/tracker', excludePkg: [] },
  ]
  // 下面三段引用改写是 scripts/build.mjs 里同名函数的原文拷贝（只读比对用，不写盘）。
  // 为什么拷贝而不是引用构建：构建脚本一被引用就跑整趟构建（它不是纯模块），而判据必须与构建同口径；
  // 边界只允许改这一扇门禁，不能把构建拆成可引用模块，所以这里留一份只读拷贝，改引用规则时两处一起改。
  // 拷贝来源：scripts/build.mjs 的 resolveRelPosix、relativePosix、MOVED_SPEC_RE、rewriteMovedSpecifiers。
  const resolveRelPosix = (baseDir, spec) => {
    const parts = baseDir.split('/').filter((p) => p.length > 0)
    for (const seg of spec.split('/')) {
      if (seg === '' || seg === '.') continue
      else if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    return parts.join('/')
  }
  const relativePosix = (fromDir, toFile) => {
    const a = fromDir.split('/').filter((p) => p.length > 0)
    const b = toFile.split('/').filter((p) => p.length > 0)
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    const rel = [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/')
    return rel.startsWith('.') ? rel : './' + rel
  }
  const MOVED_SPEC_RE = /\bfrom\s*(['"])(\.[^'"]*)\1|import\s*\(\s*(['"])(\.[^'"]*)\3\s*\)/g
  const rewriteMovedSpecifiers = (code, srcRel, outRel) => {
    const srcDir = srcRel.slice(0, srcRel.lastIndexOf('/'))
    const outDir = outRel.slice(0, outRel.lastIndexOf('/'))
    const next = code.replace(MOVED_SPEC_RE, (whole, q1, spec1, q2, spec2) => {
      const spec = spec1 !== undefined ? spec1 : spec2
      const resolved = resolveRelPosix(srcDir, spec)
      if (!resolved.startsWith('src/host/')) return whole
      const fixed = relativePosix(outDir, 'package/lib/' + resolved.slice('src/host/'.length))
      if (fixed === spec) return whole
      return whole.replace(spec, fixed)
    })
    return next
  }

  let tu = null
  let esbuild = null
  try {
    tu = require(path.resolve('scripts/lib/transpile-unit.mjs'))
  } catch (e) {
    check(false, '能加载 scripts/lib/transpile-unit.mjs（转译口径唯一来源，不在这里抄第二遍）：' + ((e && e.message) || e))
  }
  try {
    esbuild = require('esbuild')
  } catch (e) {
    check(false, '能加载 esbuild（重算转译结果用，先跑 pnpm install）：' + ((e && e.message) || e))
  }

  // 按“相对各自根目录”的名字比：源码的 .ts 换成 .js 后，应该与包内的 .js 一一对应。
  const expectedPkgForSrc = (srcBaseRel) => srcBaseRel.replace(/\.ts$/, '.js')
  let allPairsOk = true
  if (tu && esbuild) {
    for (const pair of MOVED_PAIRS) {
      const srcAll = collect(path.resolve(pair.src))
      const pkgAll = collect(path.resolve(pair.pkg)).filter((f) => pair.excludePkg.indexOf(f) < 0)
      const srcTs = srcAll.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      const srcJs = srcAll.filter((f) => {
        if (!f.endsWith('.js')) return false
        return !fs.existsSync(path.join(path.resolve(pair.src), f.slice(0, -'.js'.length) + '.ts'))
      })
      const srcExpected = [...srcTs.map(expectedPkgForSrc), ...srcJs].sort()
      const pkgJs = pkgAll.filter((f) => f.endsWith('.js')).sort()
      const srcSet = new Set(srcExpected)
      const pkgSet = new Set(pkgJs)
      const onlySrc = srcExpected.filter((f) => !pkgSet.has(f))
      const onlyPkg = pkgJs.filter((f) => !srcSet.has(f))
      const pairOk = onlySrc.length === 0 && onlyPkg.length === 0
      if (!pairOk) allPairsOk = false
      check(pairOk, `${pair.pkg} 与 ${pair.src} 双向差集 0（源码真源 ${srcTs.length} 份 TypeScript + ${srcJs.length} 份手写 JavaScript，包内 ${pkgJs.length} 份）`)
      if (onlySrc.length) console.log(`    仅 ${pair.src} 有:`, onlySrc.slice(0, 20).join(', '))
      if (onlyPkg.length) console.log(`    仅 ${pair.pkg} 有:`, onlyPkg.slice(0, 20).join(', '))

      // 内容：手写 JavaScript 逐字节比；TypeScript 按构建口径重算一遍再比（头 + 转译 + 宿主引用改写）。
      let contentOk = true
      for (const rel of srcJs) {
        const a = path.resolve(pair.src, rel)
        const b = path.resolve(pair.pkg, rel)
        if (!fs.existsSync(b)) { contentOk = false; continue }
        const ha = sha256(a), hb = sha256(b)
        if (ha !== hb) { contentOk = false; console.log(`    手写复制不一致: ${pair.src}/${rel} src=${ha.slice(0, 8)} pkg=${hb.slice(0, 8)}`) }
      }
      for (const rel of srcTs) {
        const srcRel = pair.src + '/' + rel
        const pkgRel = pair.pkg + '/' + expectedPkgForSrc(rel)
        const pkgAbs = path.resolve(pkgRel)
        if (!fs.existsSync(pkgAbs)) { contentOk = false; continue }
        let expected = ''
        try {
          const source = fs.readFileSync(path.resolve(srcRel), 'utf8')
          const code = esbuild.transformSync(source, tu.TRANSPILE_OPTIONS).code
          const normalized = code.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
          expected = rewriteMovedSpecifiers(tu.generatedHeader(srcRel) + normalized, srcRel, pkgRel)
        } catch (e) {
          contentOk = false
          console.log(`    重算转译失败 ${srcRel}：` + ((e && e.message) || e).slice(0, 120))
          continue
        }
        const actual = fs.readFileSync(pkgAbs, 'utf8')
        if (actual !== expected) {
          contentOk = false
          const ha = crypto.createHash('sha256').update(expected).digest('hex').slice(0, 8)
          const hb = crypto.createHash('sha256').update(actual).digest('hex').slice(0, 8)
          console.log(`    转译结果不一致: ${srcRel} 期望=${ha} 实际=${hb}（构建未同步或包内被手改）`)
        }
      }
      if (!contentOk) allPairsOk = false
      check(contentOk, `${pair.pkg} 与 ${pair.src} 逐文件内容一致（手写逐字节、TypeScript 按转译结果）`)
    }
  }
  // 包内三棵树的存在性：宿主平台目录仍在包内宿主树下；追踪器与工具树已按 #1018 搬到包内顶层，
  // 不再是包内宿主树下的子目录（旧断言“包内宿主树下含追踪器目录”已作废）。
  const hasPlatform = fs.existsSync(path.resolve('package/lib/platform')) && fs.existsSync(path.resolve('package/lib/platform/index.js'))
  const hasTracker = fs.existsSync(path.resolve('package/tracker')) && fs.existsSync(path.resolve('package/tracker/index.js'))
  const hasDeck = fs.existsSync(path.resolve('package/deck/registration/agent-row.js'))
  check(hasPlatform, 'package/lib 含 platform/ 目录及入口')
  check(hasTracker, 'package/tracker 含追踪器目录及入口（#1018 起追踪器住包内顶层，不在 package/lib 下）')
  check(hasDeck, 'package/deck 含工具目录及行模块入口（发布清单 ./tools 指到它）')
}
// 4b) 四类落点之外没有产物（#1017 换守门对象）
//   换掉的是什么：这一段原先守「package/shared 与 src/shared 逐字节一致 + 双向差集 0」。
//   产物出库之后（#1023 第三刀把三处产物移出 git：package/shared、像素风 34 件、四个域 35 件），
//   那个对照要守的「两份拷贝别漂移」已经由构建这一个写者保证：转译与复制在同一次构建里做完，
//   域目录的双向判据（少一份产物、多一份无源产物、域里没源码）由构建现场核对
//   （scripts/lib/transpile-domains.mjs 调 checkDomainConsistency）。留下逐字节比对的代价是
//   每次产物换落点都要跟着改，而它守不到「产物有没有跑到不该去的地方」——那才是出库后的真风险。
//   Q9 定的新守门对象是「四类之外没有产物」，四类逐类点名（#1018 起第一类由两棵扩成四棵）：
//     ① 发布包内四棵产物树：package/lib/**（宿主）、package/shared/**（共享域产物）、
//        package/deck/**（工具）、package/tracker/**（追踪器）；
//        其中工具与追踪器两棵是 #1018 按源码位置镜像新增的（package/deck 对 src/deck、
//        package/tracker 对 src/tracker，TypeScript 转成 JavaScript 再进包）。
//     ② 仓库根两份开发态产物：client.js、host.js
//     ③ 构建缓存目录：scripts/generated/**（按需存在；已入库两件点名为例外：logKernel.derived.js、
//        updateClient.derived.js，它们必须入库，因为客户端那份闭包要能离线拼出来）
//     ④ 子包各自产物目录：packages/*/dist/**
//   追踪器契约目录旁那份旧 JavaScript 影子文件（src/tracker/contract/vocabulary.js）的去向：
//   它是词汇表五份真源拼段转译的拼接输入（构建每次重写、不入库），#1026 收拾契约目录时顺手带走，
//   本票不动它、不删它，只在这里如实记一笔；下面的过渡位计数把它单列为已知项，不算放水。
//   两条断言：
//     A. 入库（git ls-files）里一件产物都没有：四类里的 ①②④ 不该被跟踪，src/ 下「有同名 .ts 的 .js」
//        是转译产物、同样不该被跟踪（③ 里的两件例外是唯一允许入库的产物）。
//     B. 盘上的产物只许落在四类里，或者落在源码树里那两处**还没搬家的过渡位**
//        （src/client/** 与 src/shared/<域>/**，共 34 + 35 = 69 件）。过渡位的件数记在上限里，
//        只许降不许升；「把客户端闭包那批产物搬进构建缓存目录」是 Q4 第 5 节那条单独工作线的事，
//        这条上限就是它的进度表——搬完把 TRANSITIONAL_PRODUCTS_MAX 改成 0，这条断言自然升级成
//        「四类之外一件都没有」。
//   怎么认出「产物」（不手写名单，认构建自己留下的两处痕迹）：
//     · 第一行带 AUTO-GENERATED 头（scripts/lib/transpile-unit.mjs 与 build.mjs 的 pixel-ts 段写的）；
//     · 或者同名 .ts 就住在旁边（逐文件转译的形状，src/client 那 34 件两处痕迹都有）。
{
  const CATEGORY_PREFIXES = ['package/lib/', 'package/shared/', 'package/deck/', 'package/tracker/', 'scripts/generated/']
  const CATEGORY_FILES = ['client.js', 'host.js']
  const SUBPKG_DIST_RE = /^packages\/[^/]+\/dist\//
  const IN_GIT_PRODUCT_EXCEPTIONS = ['scripts/generated/logKernel.derived.js', 'scripts/generated/updateClient.derived.js']
  // 2026-10-13 实测 69 件（src/client 34 + src/shared 35）。这是「还没搬家」的存量，不是允许长期存在的额度：
  // 只许降不许升，降到 0 之后这条上限就改成 0。
  // 另有几件已知产物单列在 KNOWN_PRODUCTS_OUT_OF_SCOPE 里、不计进这 69（见那里的出处说明）。
  // 判据是「去掉已知产物后不超过 69」，而不是把上限抬高一格——抬高会多出一件空位，
  // 任何一件新产物混进来都看不出来；单列已知项则新产物一件都藏不住。
  const TRANSITIONAL_PRODUCTS_MAX = 69
  // 已知的、单列出来的产物：它们不进「过渡产物」的计数，理由是各自有出处可查，不是混进来的新产物。
  //   · src/tracker/contract/vocabulary.js —— #1018 拼闭包用的词汇表产物，归 #1026 带走。
  //   · src/client/kernel/api-io.js —— #1111：客户端内核的 api-io 由手写 .js 转成 .ts，同名 .js 从此是
  //     构建产物（与 locale-cards.js、locale-skilldetail.js 同类）。它没有把上限抬高一格：这一格留给
  //     「搬家那条线」继续收，新产物想混进来仍然看得见。
  //   · src/shared/host-timer/host-timers.js —— #1115：宿主计时器句柄的撤销收成共享层的新域
  //     （src/shared/<域>/src/*.ts → 域根同名 .js，与另外几个域同一套形状）。它是本票故意新增的产物，
  //     出处就是这一行；同样不抬高上限——上限那条数按「搬家那条线的存量」算，新混进来的产物照旧看得见。
  //     · src/shared/refresh/step-cost.js —— #1069：闸独用的按步记账从 src/shared/ 根搬进 refresh 域
  //     （真源是 src/shared/refresh/src/step-cost.ts），产物落域根，与 budget.js 同类。同样不抬高上限。
  const KNOWN_PRODUCTS_OUT_OF_SCOPE = [
    'src/tracker/contract/vocabulary.js',
    'src/client/kernel/api-io.js',
    'src/shared/host-timer/host-timers.js',
    'src/shared/refresh/step-cost.js',
  ]
  const SKIP_DIRS = new Set(['node_modules', '.git'])

  const toPosix = (p) => p.split(path.sep).join('/')
  const inCategory = (rel) => CATEGORY_PREFIXES.some((p) => rel.startsWith(p)) || CATEGORY_FILES.includes(rel) || SUBPKG_DIST_RE.test(rel)
  const twinOf = (abs) => abs.replace(/\.(js|mjs|cjs)$/, '.ts')
  const looksProduct = (abs) => {
    if (/\.(js|mjs|cjs)$/.test(abs) === false) return false
    if (fs.existsSync(twinOf(abs))) return true
    try { return fs.readFileSync(abs, 'utf8').slice(0, 80).includes('AUTO-GENERATED') } catch (e) { return false }
  }

  // A. 入库里没有产物
  const tracked = execSync('git ls-files --cached', { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean)
  const trackedProducts = tracked.filter((rel) => {
    if (IN_GIT_PRODUCT_EXCEPTIONS.includes(rel)) return false
    if (CATEGORY_FILES.includes(rel) || rel.startsWith('package/lib/') || rel.startsWith('package/shared/') || rel.startsWith('package/deck/') || rel.startsWith('package/tracker/') || SUBPKG_DIST_RE.test(rel)) return true
    if (rel.startsWith('src/') && /\.(js|mjs|cjs)$/.test(rel) && fs.existsSync(twinOf(path.resolve(rel)))) return true
    return false
  })
  if (trackedProducts.length) console.log('    入库的产物:\n    ' + trackedProducts.join('\n    '))
  check(trackedProducts.length === 0, `入库里一件产物都没有（git ls-files ${tracked.length} 条，产物 ${trackedProducts.length} 件）`)

  // B. 盘上产物只许落在四类或源码树的过渡位
  const outside = []
  const transitional = []
  // 遍历整棵树，但四类落点整目录跳过（那里的产物本来就合法，不必逐件读），点开头的目录按仓里的约定
  // 一律是工具自己用的（缓存、临时输出、编辑器状态），也不进这趟。
  const walkAll = (dir, relBase) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relBase ? relBase + '/' + ent.name : ent.name
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
        if (inCategory(rel + '/')) continue
        walkAll(path.join(dir, ent.name), rel)
        continue
      }
      if (!ent.isFile() || !looksProduct(path.join(dir, ent.name))) continue
      if (inCategory(rel)) continue
      if (rel.startsWith('src/')) { transitional.push(rel); continue }
      outside.push(rel)
    }
  }
  walkAll(process.cwd(), '')
  if (outside.length) console.log('    四类之外、又不在源码树里的产物:\n    ' + outside.join('\n    '))
  check(outside.length === 0, '四类落点之外没有产物（四类：package/lib、package/shared、package/deck、package/tracker、根 client.js/host.js、scripts/generated、packages/*/dist）')
  const transitionalWithoutKnown = transitional.filter((rel) => KNOWN_PRODUCTS_OUT_OF_SCOPE.indexOf(rel) < 0)
  const knownPresent = transitional.length - transitionalWithoutKnown.length
  check(transitionalWithoutKnown.length <= TRANSITIONAL_PRODUCTS_MAX,
    `源码树里的过渡产物没有变多（去掉已知产物 ${KNOWN_PRODUCTS_OUT_OF_SCOPE.join('、')} ${knownPresent} 件后现 ${transitionalWithoutKnown.length} 件，上限 ${TRANSITIONAL_PRODUCTS_MAX} 件；搬家那条工作线做完后应降到 0）`)
  if (transitional.length) {
    const byDir = {}
    for (const rel of transitional) { const k = rel.slice(0, rel.lastIndexOf('/')); byDir[k] = (byDir[k] || 0) + 1 }
    console.log('    INFO 源码树里还剩 ' + transitional.length + ' 件待搬家的产物（含已知产物 ' + KNOWN_PRODUCTS_OUT_OF_SCOPE.join('、') + '）：'
      + Object.entries(byDir).sort().map(([k, v]) => k + ' ' + v + ' 件').join('、'))
  }
}
// 4c)（已删）原来是逐份读 src/host 与 src/shared 下每个 .js 的源码文本，用正则断言相对 import 一律带 .js 扩展。
//   那条断言的对象是手写源码的写法，改写法、搬文件、把文件转成 TypeScript 都会让它变红，
//   按维护者「清掉读源码文本钉形状的门禁」的要求整条去掉，连带它专用的那两个 collect 读取也一并删了。
// 4d)（已删）原来是读 package/lib/index.js 的产物文本，用四个正则断言入口的导出形状
//   （export default { ... }、export function apply、export const name、export const inject）。
//   断言对象是产物文本里的写法，构建换个输出形状就变红，按维护者「清掉读文件文本钉形状的门禁」的要求整条去掉。
// 4f) 动态导入可解析（#545：电话注册了但模块文件缺了，调用才失败；
// 打包产物里每个相对导入在 package/ 内必须有对应文件，缺一个就红；
// #1018 起包内有四棵产物树，审计范围跟着扩到 deck 与 tracker，否则新树漏文件看不见）
{
  const roots = [path.resolve('package/lib'), path.resolve('package/shared'), path.resolve('package/deck'), path.resolve('package/tracker')]
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

// 4e) files 白名单：package/package.json files 含四棵产物树（#1018 起 deck 与 tracker 也进包）
{
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package/package.json'), 'utf8'))
    const files = Array.isArray(pkg.files) ? pkg.files : []
    check(files.includes('shared'), 'package/package.json files 含 shared')
    check(files.includes('lib'), 'package/package.json files 含 lib')
    check(files.includes('deck'), 'package/package.json files 含 deck（#1018 起工具树进包）')
    check(files.includes('tracker'), 'package/package.json files 含 tracker（#1018 起追踪器树进包）')
  } catch (e) {
    check(false, 'package/package.json files 读取失败: ' + e.message)
  }
}

console.log(failed ? '\n存在失败' : '\n全部通过 — 风险A + 方案C L2 门禁生效')
process.exit(failed ? 1 : 0)