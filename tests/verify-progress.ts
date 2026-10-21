// verify-progress.ts — dsh-waystation v1.5 T12/T16：进度块解析 + 正文容错 + 渲染契约校验
// 2026-10-17 从 .js 转成 TypeScript：只改文件名、用法这行与几处类型标注，判据与断言一条没动。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-progress.ts（在插件根目录）
// 验证：1) parseProgress 变体解析 2) normalizeBody 容错（字面 \n + BOM） 3) parseMapBody 端到端（真跑 src/host/mapBody.ts 里那三个函数）
// 2026-10-12 修订：原来还有「host/package 均带 progress 字段」与「client/package 均含进度渲染符号」两条，
//   那是读 host.js / package/lib/index.js / client.js / package/lib/client.js 的文本钉字段名与符号名，已删。
// 2026-10-21 #1090：进度解析不再由 mapBody 自己留一份实现，读写统一走 src/tracker/body-parse.ts；
//   parseProgress 直接测叶子，mapBody 直接 import 真模块跑（不再从源码文本里抽函数求值——它现在带 import）。
const path = require('path')
const { pathToFileURL } = require('url')
const { sourceText } = require('./lib/source-text.ts')
let failed = false
const check = (ok: boolean, msg: string) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const FENCE = String.fromCharCode(96).repeat(3)

async function main() {
  // 1) parseProgress 单元测试（叶子真源；#1090 起 mapBody 不再自带副本）
  const leaf = await import(pathToFileURL(path.resolve('src/tracker/body-parse.ts')).href)
  check(typeof leaf.parseProgress === 'function', 'src/tracker/body-parse.ts 导出 parseProgress')
  const parseProgress = leaf.parseProgress
  const cases: Array<[string, number | null]> = [
    ['## 进度：90%\n下一步：x', 90],
    ['## 进度: 100%', 100],
    ['正文\n进度：5%', 5],
    ['## 进度：120%', 100],
    ['## 进度：abc%', null],
    ['无进度内容', null],
    ['## 进度：0%', 0],
    ['## 进度：95%', 95],
    // B4 回归：标题行与行首两级兼容 —— 正文示例/规则文本不劫持标题行进度区（#459/#460 实证）
    ['## 已对齐决定\n3. 每张新票写 ## 进度：0% 基准。\n## 进度：90%', 90],
    ['## 待 grill 点\n- 宽容：## 进度：90% 主格式\n## 进度：95%', 95],
    ['Progress: 40%', 40],
    // #1090：规范写法（一条一行，最新在最上）读第一条就是当前值
    ['## 进度\n\n- 进度：63%（2026-10-21T20:00:00+08:00）：写完了', 63],
    ['## 进度\n\n- 进度：90%（2026-10-21T20:00:00+08:00）：新记录\n- 进度：80%（时间未记录）：旧记录', 90],
    // #1090：删掉「全文兜底」——正文别处提到的数字不算进度
    ['正文提到 进度：7% 而已', null],
    // #1090：代码块里的示例标题不算真进度区
    [FENCE + '\n## 进度：90%\n' + FENCE, null],
  ]
  cases.forEach(function (c: [string, number | null]) {
    const got = parseProgress(c[0])
    check(got === c[1], 'parseProgress(' + JSON.stringify(c[0]) + ') = ' + got + '（期望 ' + c[1] + '）')
  })
  const mapSrc = sourceText('src/host/mapBody.js')
  check(!/function\s+parseProgress\s*\(/.test(mapSrc), 'mapBody 里不再有本地 parseProgress 实现（避免又分叉出一份）')
  check(/import\s*\{[^}]*parseProgress[^}]*\}\s*from\s*['"]\.\.\/tracker\/body-parse\.js['"]/.test(mapSrc), 'mapBody 从 tracker 叶子引入 parseProgress')

  // 2) 直接加载 mapBody 真模块（#1090 起它带 import，不再从源码文本抽函数求值）
  const mapMod = await import(pathToFileURL(path.resolve('src/host/mapBody.ts')).href)
  check(typeof mapMod.createMapBody === 'function', 'src/host/mapBody.ts 导出 createMapBody')
  const mb = mapMod.createMapBody()
  check(typeof mb.normalizeBody === 'function' && typeof mb.parseMapBody === 'function' && typeof mb.parseProgress === 'function', 'mapBody 实例带 normalizeBody / parseMapBody / parseProgress')
  check(mb.parseProgress('## 进度：90%') === leaf.parseProgress('## 进度：90%'), 'mapBody 的 parseProgress 与叶子同一份实现（读数一致）')

  // T16: normalizeBody 容错测试（字面 \\n 还原 + 剥 BOM）
  const normalizeBody = mb.normalizeBody
  // 坏格式：BOM + 整篇字面 \n（无真实换行）
  const badBody = String.fromCharCode(0xfeff) + '## Destination\\n\\nDSH-Waystation **v1.5**\\n\\n## Notes\\n\\nnote here'
  const normBad = normalizeBody(badBody)
  check(!normBad.startsWith(String.fromCharCode(0xfeff)), 'normalizeBody 剥 BOM')
  check(normBad.indexOf('\n') >= 0, 'normalizeBody 字面 \\n 还原为真实换行')
  check(normBad.indexOf('\\n') < 0, 'normalizeBody 不再含字面 \\\\n')
  check(normalizeBody('正常\n正文\n带真实换行') === '正常\n正文\n带真实换行', 'normalizeBody 不误伤正常正文')
  check(normalizeBody('') === '', 'normalizeBody 空串安全')
  // T16 端到端回归（#463/#445）：parseMapBody 必须经 normalizeBody 接线 —— 坏格式 body（BOM + 字面 \\n）恢复 Destination
  const e2eOut = mb.parseMapBody(badBody)
  check(e2eOut.destination === 'DSH-Waystation **v1.5**', 'parseMapBody 端到端恢复 Destination（BOM+字面 \\n · #445 场景）')
  check(e2eOut.notes === 'note here', 'parseMapBody 端到端恢复 Notes（#445 场景）')

  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
