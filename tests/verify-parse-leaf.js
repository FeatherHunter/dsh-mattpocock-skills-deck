// verify-parse-leaf.js — dsh-mattpocock-skills-deck 阶段 1：host 纯函数叶子差分测试
// 用法: node tests/verify-parse-leaf.js（在插件根目录）
// 验证：1) src/shared/parser.js 叶子可用、行为真值表
//       2) 叶子版 === host.js 内联版（同一批输入逐字节一致）——「搬坏」探测器
//       3) 叶子版 === package/lib/index.js 内联版 同逻辑
//       4) 双源镜像特征：叶子与 host.js 均有这些导出
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const host = fs.readFileSync('host.js', 'utf8')
const pkg = fs.readFileSync('package/lib/index.js', 'utf8')

// 从源码抽取内联函数（沿用 verify-progress 的提取法；parseMapBody 依赖 normalizeBody，需同作用域求值）
// host.js（动态版）= 4 空格缩进；package/lib/index.js（ESM 版）= 2 空格缩进，两种都尝试
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

async function main() {
  // ---- 加载叶子（ESM import，Windows 需 file:// URL）----
  const leaf = await import('file://' + path.resolve('src/shared/parser.js').replace(/\\/g, '/'))
  const names = ['normalizeBody', 'parseMapBody', 'parseProgress', 'computeLevels', 'groupTickets']
  names.forEach((n) => check(typeof leaf[n] === 'function', 'src/shared/parser.js 导出 ' + n))

  // ---- Part A：host.js 差分（叶子 === 生产内联）----
  const hostFns = extractFns(host)
  names.forEach((n) => check(!!hostFns[n], 'host.js 含内联 ' + n + '（对照基准）'))

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
    check(JSON.stringify(a) === JSON.stringify(b_), 'diff normalizeBody[' + i + '] 叶子===host')
    // parseMapBody
    check(JSON.stringify(leaf.parseMapBody(b)) === JSON.stringify(hostFns.parseMapBody(b)), 'diff parseMapBody[' + i + '] 叶子===host')
    // parseProgress
    check(JSON.stringify(leaf.parseProgress(b)) === JSON.stringify(hostFns.parseProgress(b)), 'diff parseProgress[' + i + '] 叶子===host')
  })

  // computeLevels / groupTickets 差分（DAG 分层样例）
  const tickets = [
    { number: 1, title: 'root', state: 'OPEN', claimedBy: '', blockedBy: [], labels: [] },
    { number: 2, title: 'b', state: 'OPEN', claimedBy: 'A', blockedBy: [1], labels: [] },
    { number: 3, title: 'c', state: 'OPEN', claimedBy: '', blockedBy: [2], labels: [] },
    { number: 4, title: 'd', state: 'OPEN', claimedBy: '', blockedBy: [1], labels: [] },
    { number: 5, title: 'cl', state: 'CLOSED', claimedBy: '', blockedBy: [3], labels: [] },
  ]
  check(JSON.stringify(leaf.computeLevels(tickets)) === JSON.stringify(hostFns.computeLevels(tickets)), 'diff computeLevels 叶子===host')
  check(JSON.stringify(leaf.groupTickets(tickets)) === JSON.stringify(hostFns.groupTickets(tickets)), 'diff groupTickets 叶子===host')

  // ---- Part B：package/lib 差分（同逻辑）----
  const pkgFns = extractFns(pkg)
  names.forEach((n) => check(!!pkgFns[n], 'package/lib/index.js 含内联 ' + n + '（对照基准）'))
  bodies.forEach((b, i) => {
    check(JSON.stringify(leaf.parseMapBody(b)) === JSON.stringify(pkgFns.parseMapBody(b)), 'diff parseMapBody[' + i + '] 叶子===package')
    check(JSON.stringify(leaf.parseProgress(b)) === JSON.stringify(pkgFns.parseProgress(b)), 'diff parseProgress[' + i + '] 叶子===package')
  })
  check(JSON.stringify(leaf.computeLevels(tickets)) === JSON.stringify(pkgFns.computeLevels(tickets)), 'diff computeLevels 叶子===package')

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

  // ---- Part D：双源镜像特征（src 叶子与两端同存）----
  names.forEach((n) => check(host.includes('function ' + n), 'host.js 含函数 ' + n))
  names.forEach((n) => check(pkg.includes('function ' + n), 'package/lib/index.js 含函数 ' + n))

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
