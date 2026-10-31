// verify-parse-leaf.ts — dsh-mattpocock-skills-deck 阶段 1：host 纯函数叶子差分测试
// T1（#94）迁移：断言目标从「内联副本」改为「构建产物」——host.js / package/lib/index.js 现由
//   scripts/build.mts 生成（一源出两物，gitignore 可变产物），本测试验证「叶子 === 构建产物」：
//   T0 接管后构建未改变叶子行为，叶子仍为唯一真源 + 测试基准。
// 用法: node tests/verify-parse-leaf.ts（在插件根目录；先运行 node scripts/build.mts 生成产物）
// 验证：1) src/tracker/body-parse.ts 叶子可用、行为真值表
//       2) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；防止陈旧产物假绿）
//       3) 叶子 === _dev 产物（根 host.js）——「构建未改变叶子行为」探测器
//       4) 叶子 === _pkg 产物（package/lib/index.js）
//       5) 文本逐字断言：分组两函数与搬迁三函数产物文本 === src 内联（入口三函数 #1074 起是 .ts，类型擦除后逐字不可比，入口一致性改由构建的投放重算校验）
//       6) 双源镜像特征（文本镜像断言，T5 #98 统一删除）
const fs = require('fs')
const path = require('path')
// 本文件按文本求值统一走共用入口 evalWithScope：切出的五个函数都写在同一个立即执行体里，被求值的表达式不引用外部变量，所以作用域传空对象（理由与用法见 tests/lib/eval-probe.js 文件头）。
const { evalWithScope } = require('./lib/eval-probe.js')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ---- 产物清单与驱动重建的源（T1：断言目标必须是「当前构建产物」，而非磁盘任意文件）----
// 产物新鲜度判据全仓只有一份：scripts/lib/build-cache.mts 的 judgeProducts（#1326）。
// 缓存可用时比「产物内容摘要 vs 上次成功构建记录」；缓存不可用时回落按修改时间判断，
// 回落原因用 INFO 行打出来（判绿也打，不静默），失败文案直接用判据给的原因。
const { judgeProducts, reportJudgements } = require('../scripts/lib/build-cache.mts')
const PRODUCTS = ['host.js', 'package/lib/index.js']
// H2 #446：宿主侧实现分散在两处（解析三函数搬到 mapBody.js，分组两函数留守 index.js）；产物侧同理跟随，意图不变。
// #450 H6：分组两函数搬入 ticketGrouping.js（三处合流：mapBody + ticketGrouping + index）；新鲜度与抽取同理跟随。
// 2026-10-17（转 .ts 前先修）：src/host 下已有文件改成 .ts 真源（旁边留同名 .js 产物或干脆没有 .js），
//   写死 .js 路径会让新鲜度检查 existsSync 落空、静默跳过——产物明明旧了却判绿。改走共用取源入口，
//   按「同名 .ts 优先、否则原路径」解析，缺文件也会照实报出来。
const { sourcePath, sourceText } = require('./lib/source-text.ts')
// 真源转成 TypeScript 后，读文本走共用入口（同名 .ts 优先，与装载钩子同规则）；
// 要进 vm 求值的两段先剥类型（esbuild loader ts，与构建同一份转译口径），产物侧已是纯 JS 不动。
const SOURCES = [
  sourcePath('src/host/index.js'),
  sourcePath('src/host/mapBody.js'),
  sourcePath('src/host/ticketGrouping.js'),
  sourcePath('src/refresh/rooms/host/issue-list-fetch.js'),
  sourcePath('src/refresh/rooms/host/issue-detail-fetch.js'),
  // #1090：mapBody 的 parseProgress 改为从这份叶子引入，产物新鲜度要把叶子也算进来。
  sourcePath('src/tracker/body-parse.ts'),
  // #1768：分组/分层判定搬进内核，body-parse 只转出名字；新鲜度要跟到真正实现的那份。
  sourcePath('src/tracker/kernel/grouping.ts'),
  'scripts/build.mts',
  'package/package.json',
]

// 从源码抽取内联函数（parseMapBody 依赖 normalizeBody，需同作用域求值）
// 产物 = src/host/index.js 函数体逐字嵌入（scripts/build.mts 文本组合），4 空格缩进；2 空格为兼容回退
// #1090：parseProgress 不在这里抽了——它已搬去 tracker 叶子，mapBody 只 import，差分改在下面直接比模块导出。
const extractFns = (src) => {
  // #1768：computeLevels/groupTickets 依赖同作用域的阻塞判定帮手，抽的时候要一起带上，否则求值当场 ReferenceError。
  const names = ['normalizeBody', 'parseMapBody', 'computeLevels', 'groupTickets', 'refKeyOf', 'blockerBlocks']
  const grabOne = (indentSpaces) => {
    const body = names.map((n) => {
      const m = src.match(new RegExp('function\\s+' + n + '\\([\\s\\S]*?\\n {' + indentSpaces + '}\\}'))
      return m ? m[0] : ''
    }).join('\n')
    if (!body.trim()) return null
    try {
      // 六个函数在同一个括号里声明、互相调用也在其中，外层一个变量都不用：改走共用入口 evalWithScope，作用域留空。
      return evalWithScope('(function(){' + body + ';return {normalizeBody,parseMapBody,computeLevels,groupTickets}})()', {})
    } catch (e) { return null }
  }
  return grabOne(4) || grabOne(2)
}

// 文本原样抽取（Part E 逐字断言用，不做 eval）
const rawGrab = (src, n, indentSpaces) => {
  const m = src.match(new RegExp('function\\s+' + n + '\\([\\s\\S]*?\\n {' + indentSpaces + '}\\}'))
  return m ? m[0] : ''
}
const rawAll = (src) => ['normalizeBody', 'parseMapBody', 'computeLevels', 'groupTickets']
  .map((n) => rawGrab(src, n, 4) || rawGrab(src, n, 2) || rawGrab(src, n, 0)).join('\n')

async function main() {
  // ---- 产物新鲜度门禁（T1：先于一切断言，缺失/过期直接 FAIL）----
  const judged = judgeProducts({ products: PRODUCTS, sources: SOURCES })
  reportJudgements(judged, check, { label: '产物门禁 ', products: PRODUCTS })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  const host = fs.readFileSync('host.js', 'utf8')
  const pkg = fs.readFileSync('package/lib/index.js', 'utf8')
  const srcMap = sourceText('src/host/mapBody.js')
  const pkgMap = fs.readFileSync('package/lib/mapBody.js', 'utf8')
  const srcGroup = sourceText('src/host/ticketGrouping.js')
  const pkgGroup = fs.readFileSync('package/lib/ticketGrouping.js', 'utf8')
  let esbuild = null
  try { esbuild = require('esbuild') } catch (e) { check(false, 'esbuild 可用（先跑 pnpm install）：' + ((e && e.message) || e)) }
  const stripTs = (t) => esbuild.transformSync(t, { loader: 'ts' }).code
  const hostSide = stripTs(srcMap) + '\n' + stripTs(srcGroup) + '\n' + host
  const pkgSide = pkgMap + '\n' + pkgGroup + '\n' + pkg

  // ---- 加载叶子（ESM import，Windows 需 file:// URL）----
  const leaf = await import('file://' + path.resolve('src/tracker/body-parse.ts').replace(/\\/g, '/'))
  const names = ['normalizeBody', 'parseMapBody', 'computeLevels', 'groupTickets']
  names.concat(['parseProgress']).forEach((n) => check(typeof leaf[n] === 'function', 'src/tracker/body-parse.ts 导出 ' + n))

  // ---- Part A：_dev 产物差分（叶子 === 宿主侧实现，H2 后为 mapBody.js + host.js 拼回同一作用域）----
  const hostFns = extractFns(hostSide)
  names.forEach((n) => check(!!hostFns[n], '产物(_dev) host.js 含 ' + n + '（对照基准）'))

  // 差分输入集：覆盖典型 + 边界 + 脏数据
  const bodies = [
    '', null, undefined, '## Destination\n\nDSH-Waystation **v1**\n\n## Notes\n\nnote here',
    String.fromCharCode(0xfeff) + '## Destination\\n\\nX\\n\\n## Notes\\n\\nY', // BOM + 字面 \n
    '## Destination  \n## Notes\n- [a](u) g\n## Decisions so far\n- [t1](u1) g1\n<!-- c -->\n## Not yet specified\nf1\n<!-- f -->\n## Out of scope\no1',
    'plain text no sections', '## Notes\n\n## Decisions so far\n- [x](y)',
    '正文\n进度：5%\n## 进度：90%\n下一步', '## 进度: 100%', '## 进度：abc%',
  ]
  bodies.forEach((b, i) => {
    // normalizeBody
    const a = leaf.normalizeBody(b); const b_ = hostFns.normalizeBody(b)
    check(JSON.stringify(a) === JSON.stringify(b_), 'diff normalizeBody[' + i + '] 叶子===产物(_dev)')
    // parseMapBody
    check(JSON.stringify(leaf.parseMapBody(b)) === JSON.stringify(hostFns.parseMapBody(b)), 'diff parseMapBody[' + i + '] 叶子===产物(_dev)')
  })

  // computeLevels / groupTickets 差分（DAG 分层样例）
  const tickets = [
    { number: 1, title: 'root', state: 'OPEN', claimedBy: '', blockedBy: [], labels: [] },
    { number: 2, title: 'b', state: 'OPEN', claimedBy: 'A', blockedBy: [1], labels: [] },
    { number: 3, title: 'c', state: 'OPEN', claimedBy: '', blockedBy: [2], labels: [] },
    { number: 4, title: 'd', state: 'OPEN', claimedBy: '', blockedBy: [1], labels: [] },
    { number: 5, title: 'cl', state: 'CLOSED', claimedBy: '', blockedBy: [3], labels: [] },
  ]
  check(JSON.stringify(leaf.computeLevels(tickets)) === JSON.stringify(hostFns.computeLevels(tickets)), 'diff computeLevels 叶子===产物(_dev)')
  check(JSON.stringify(leaf.groupTickets(tickets)) === JSON.stringify(hostFns.groupTickets(tickets)), 'diff groupTickets 叶子===产物(_dev)')

  // ---- Part B：_pkg 产物差分（同逻辑）----
  const pkgFns = extractFns(pkgSide)
  names.forEach((n) => check(!!pkgFns[n], '产物(_pkg) package/lib/index.js 含 ' + n + '（对照基准）'))
  bodies.forEach((b, i) => {
    check(JSON.stringify(leaf.parseMapBody(b)) === JSON.stringify(pkgFns.parseMapBody(b)), 'diff parseMapBody[' + i + '] 叶子===产物(_pkg)')
  })
  check(JSON.stringify(leaf.computeLevels(tickets)) === JSON.stringify(pkgFns.computeLevels(tickets)), 'diff computeLevels 叶子===产物(_pkg)')

  // ---- Part C：行为真值表（叶子自身，防「两边一起错」）----
  const pp = leaf.parseProgress
  check(pp('## 进度：90%\n下一步：x') === 90, '真值 parseProgress ## 进度：90%')
  check(pp('## 进度: 100%') === 100, '真值 parseProgress 全角冒号')
  check(pp('## 进度：120%') === 100, '真值 parseProgress clamp 120→100')
  check(pp('## 进度：abc%') === null, '真值 parseProgress 非数字→null')
  check(pp('## 进度：-5%') === null, '真值 parseProgress -5% 不匹配（-号挡字正则）→null')
  // ---- Part C 之二：parseProgress 走模块导出比较（#1090 起 mapBody 不再有本地副本）----
  // 真源是 src/tracker/body-parse.ts；这里直接加载构建产物 package/lib/mapBody.js，
  // 拿它 createMapBody() 返回的 parseProgress 与叶子逐输入比较，确认产物里也接的是同一份实现。
  const pkgMapMod = await import('file://' + path.resolve('package/lib/mapBody.js').replace(/\\/g, '/'))
  const prodMap = typeof pkgMapMod.createMapBody === 'function' ? pkgMapMod.createMapBody() : null
  check(!!prodMap && typeof prodMap.parseProgress === 'function', '产物 package/lib/mapBody.js 的 createMapBody() 带 parseProgress')
  let progressDiff = 0
  bodies.forEach((b) => {
    if (!prodMap) { progressDiff += 1; return }
    if (JSON.stringify(prodMap.parseProgress(b)) !== JSON.stringify(leaf.parseProgress(b))) progressDiff += 1
  })
  check(progressDiff === 0, 'diff parseProgress 叶子===产物(_pkg 模块导出)，不一致 ' + progressDiff + ' 处')
  const srcMapText = sourceText('src/host/mapBody.js')
  check(!/function\s+parseProgress\s*\(/.test(srcMapText), '真源 mapBody 没有本地 parseProgress（避免又分叉出一份）')
  check(/import\s*\{[^}]*parseProgress[^}]*\}\s*from\s*['"]\.\.\/tracker\/body-parse\.js['"]/.test(srcMapText), '真源 mapBody 从 tracker 叶子引入 parseProgress')
  check(/import\s*\{[^}]*parseProgress[^}]*\}\s*from\s*['"]\.\.\/tracker\/body-parse\.js['"]/.test(pkgMap), '产物 mapBody 保留对 tracker 叶子的 import（包内可解析）')

  const cl = leaf.computeLevels(tickets)
  check(cl.byNumber['1'] === 0 && cl.byNumber['2'] === 1 && cl.byNumber['3'] === 2, '真值 computeLevels 层级 0/1/2')
  const gt = leaf.groupTickets(tickets)
  check(gt.total === 5 && gt.open === 4 && gt.closed === 1 && gt.frontier === 1 && gt.claimed === 1 && gt.blocked === 2, '真值 groupTickets 分组计数（frontier=#1, claimed=#2, blocked=#3+#4）')

  // ---- Part E：文本逐字断言（T1 新增；构建 = 文本组合，产物函数文本必须与 src 内联逐字一致）----
  // #450 H6：分组两函数搬入 ticketGrouping.js，_dev 单文件不再内嵌模块体；逐字锚到 _pkg 装配（src index+分组 === pkg index+分组合集，原样复制不变量由 build.mts 校验）。
  // 2026-10-18 #1247：两份真源转成 TypeScript，源侧先剥类型再比（与构建同一份 esbuild 口径）；
  //   判据含义是「产物函数 === 真源转译后函数」，剥离本身零行为变化由 Part A/B 的行为差分覆盖。
  const srcStay = rawAll(stripTs(srcGroup))
  const pkgStay = rawAll(pkgGroup)
  const srcMapRaw = rawAll(stripTs(srcMap))
  const pkgMapRaw = rawAll(pkgMap)
  check(!!srcStay.trim() && !!pkgStay.trim() && !!srcMapRaw.trim() && !!pkgMapRaw.trim(), '文本抽取：分组两函数在 src/pkg 均可抽取（入口三函数转成 .ts 后逐字不可比，入口一致性由构建校验）')
  check(srcStay === pkgStay, '文本逐字：package/lib/ticketGrouping.js === 真源转译后（剥类型，同一份 esbuild 口径）')
  check(srcMapRaw === pkgMapRaw, '文本逐字：package/lib/mapBody.js === 真源转译后（剥类型，同一份 esbuild 口径）')

  // ---- Part D 已移除（T5 #98：双源镜像文本断言由运行时冒烟取代；保留 Part C 真值表 + Part E src↔产物逐字）----

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
