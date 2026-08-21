// verify-parse-leaf.js — dsh-mattpocock-skills-deck 阶段 1：host 纯函数叶子差分测试
// T1（#94）迁移：断言目标从「内联副本」改为「构建产物」——host.js / package/lib/index.js 现由
//   scripts/build.mjs 生成（一源出两物，gitignore 可变产物），本测试验证「叶子 === 构建产物」：
//   T0 接管后构建未改变叶子行为，叶子仍为唯一真源 + 测试基准。
// 用法: node tests/verify-parse-leaf.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）
// 验证：1) src/shared/parser.js 叶子可用、行为真值表
//       2) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；防止陈旧产物假绿）
//       3) 叶子 === _dev 产物（根 host.js）——「构建未改变叶子行为」探测器
//       4) 叶子 === _pkg 产物（package/lib/index.js）
//       5) 文本逐字断言：产物内函数文本 === src/host/index.js 内联（构建为文本组合，函数体逐字保留）
//       6) 双源镜像特征（文本镜像断言，T5 #98 统一删除）
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ---- 产物清单与驱动重建的源（T1：断言目标必须是「当前构建产物」，而非磁盘任意文件）----
const PRODUCTS = ['host.js', 'package/lib/index.js']
const SOURCES = ['src/host/index.js', 'scripts/build.mjs', 'package/package.json']

function productStale(prod) {
  if (!fs.existsSync(prod)) return '缺失（请先运行 node scripts/build.mjs）'
  const pm = fs.statSync(prod).mtimeMs
  for (const s of SOURCES) {
    if (fs.existsSync(s) && fs.statSync(s).mtimeMs > pm + 1000) {
      return '过期（' + s + ' 比产物新，请重新运行 node scripts/build.mjs）'
    }
  }
  return null
}

// 从源码抽取内联函数（沿用 verify-progress 的提取法；parseMapBody 依赖 normalizeBody，需同作用域求值）
// 产物 = src/host/index.js 函数体逐字嵌入（scripts/build.mjs 文本组合），4 空格缩进；2 空格为兼容回退
const extractFns = (src) => {
  const names = ['normalizeBody', 'parseMapBody', 'parseProgress', 'computeLevels', 'groupTickets']
  const grabOne = (indentSpaces) => {
    const body = names.map((n) => {
      const m = src.match(new RegExp('function\\s+' + n + '\\([\\s\\S]*?\\n {' + indentSpaces + '}\\}'))
      return m ? m[0] : ''
    }).join('\n')
    if (!body.trim()) return null
    try {
      return eval('(function(){' + body + ';return {normalizeBody,parseMapBody,parseProgress,computeLevels,groupTickets}})()')
    } catch (e) { return null }
  }
  return grabOne(4) || grabOne(2)
}

// 文本原样抽取（Part E 逐字断言用，不做 eval）
const rawGrab = (src, n, indentSpaces) => {
  const m = src.match(new RegExp('function\\s+' + n + '\\([\\s\\S]*?\\n {' + indentSpaces + '}\\}'))
  return m ? m[0] : ''
}
const rawAll = (src) => ['normalizeBody', 'parseMapBody', 'parseProgress', 'computeLevels', 'groupTickets']
  .map((n) => rawGrab(src, n, 4) || rawGrab(src, n, 2) || rawGrab(src, n, 0)).join('\n')

async function main() {
  // ---- 产物新鲜度门禁（T1：先于一切断言，缺失/过期直接 FAIL）----
  PRODUCTS.forEach((p) => {
    const why = productStale(p)
    check(!why, '产物门禁 ' + p + (why ? '：' + why : '（存在且新鲜）'))
  })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  const host = fs.readFileSync('host.js', 'utf8')
  const pkg = fs.readFileSync('package/lib/index.js', 'utf8')
  const srcHost = fs.readFileSync('src/host/index.js', 'utf8')

  // ---- 加载叶子（ESM import，Windows 需 file:// URL）----
  const leaf = await import('file://' + path.resolve('src/shared/parser.js').replace(/\\/g, '/'))
  const names = ['normalizeBody', 'parseMapBody', 'parseProgress', 'computeLevels', 'groupTickets']
  names.forEach((n) => check(typeof leaf[n] === 'function', 'src/shared/parser.js 导出 ' + n))

  // ---- Part A：_dev 产物差分（叶子 === 构建产物 host.js）----
  const hostFns = extractFns(host)
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
    // parseProgress
    check(JSON.stringify(leaf.parseProgress(b)) === JSON.stringify(hostFns.parseProgress(b)), 'diff parseProgress[' + i + '] 叶子===产物(_dev)')
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
  const pkgFns = extractFns(pkg)
  names.forEach((n) => check(!!pkgFns[n], '产物(_pkg) package/lib/index.js 含 ' + n + '（对照基准）'))
  bodies.forEach((b, i) => {
    check(JSON.stringify(leaf.parseMapBody(b)) === JSON.stringify(pkgFns.parseMapBody(b)), 'diff parseMapBody[' + i + '] 叶子===产物(_pkg)')
    check(JSON.stringify(leaf.parseProgress(b)) === JSON.stringify(pkgFns.parseProgress(b)), 'diff parseProgress[' + i + '] 叶子===产物(_pkg)')
  })
  check(JSON.stringify(leaf.computeLevels(tickets)) === JSON.stringify(pkgFns.computeLevels(tickets)), 'diff computeLevels 叶子===产物(_pkg)')

  // ---- Part C：行为真值表（叶子自身，防「两边一起错」）----
  const pp = leaf.parseProgress
  check(pp('## 进度：90%\n下一步：x') === 90, '真值 parseProgress ## 进度：90%')
  check(pp('## 进度: 100%') === 100, '真值 parseProgress 全角冒号')
  check(pp('## 进度：120%') === 100, '真值 parseProgress clamp 120→100')
  check(pp('## 进度：abc%') === null, '真值 parseProgress 非数字→null')
  check(pp('## 进度：-5%') === null, '真值 parseProgress -5% 不匹配（-号挡字正则）→null')
  const cl = leaf.computeLevels(tickets)
  check(cl.byNumber['1'] === 0 && cl.byNumber['2'] === 1 && cl.byNumber['3'] === 2, '真值 computeLevels 层级 0/1/2')
  const gt = leaf.groupTickets(tickets)
  check(gt.total === 5 && gt.open === 4 && gt.closed === 1 && gt.frontier === 1 && gt.claimed === 1 && gt.blocked === 2, '真值 groupTickets 分组计数（frontier=#1, claimed=#2, blocked=#3+#4）')

  // ---- Part E：文本逐字断言（T1 新增；构建 = 文本组合，产物函数文本必须与 src 内联逐字一致）----
  const srcRaw = rawAll(srcHost)
  const devRaw = rawAll(host)
  const pkgRaw = rawAll(pkg)
  check(!!srcRaw.trim() && !!devRaw.trim() && !!pkgRaw.trim(), '文本抽取：src/两产物均含 5 个函数文本')
  check(srcRaw === devRaw, '文本逐字：产物(_dev) 函数文本 === src/host/index.js 内联')
  check(srcRaw === pkgRaw, '文本逐字：产物(_pkg) 函数文本 === src/host/index.js 内联')

  // ---- Part D 已移除（T5 #98：双源镜像文本断言由运行时冒烟取代；保留 Part C 真值表 + Part E src↔产物逐字）----

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
