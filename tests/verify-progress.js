// verify-progress.js — dsh-waystation v1.5 T12/T16：进度块解析 + 正文容错 + 渲染契约校验
// 用法: node tests/verify-progress.js（在插件根目录）
// 验证：1) parseProgress 变体解析 2) normalizeBody 容错（字面 \n + BOM） 3) parseMapBody 端到端（真跑 src/host/mapBody.js 里那三个函数）
// 2026-10-12 修订：原来还有「host/package 均带 progress 字段」与「client/package 均含进度渲染符号」两条，
//   那是读 host.js / package/lib/index.js / client.js / package/lib/client.js 的文本钉字段名与符号名，已删。
const fs = require('fs')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { evalWithScope } = require('./lib/eval-probe.js')
// H2 #446：解析三函数搬到 mapBody.js、详情拼装搬到 issueDetail.js（行为零变化）；断言跟随位置，意图不变。
const hostMap = fs.readFileSync('src/host/mapBody.js', 'utf8')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 1) parseProgress 单元测试（从 host 提取函数）
const fm = hostMap.match(/function parseProgress\(body\) \{[\s\S]*?\n    \}/)
check(!!fm, 'host 含 parseProgress 定义')
const parseProgress = fm ? evalWithScope(fm[0], {}) : function () { return null }
const cases = [
  ['## 进度：90%\n下一步：x', 90],
  ['## 进度: 100%', 100],
  ['正文\n进度：5%', 5],
  ['## 进度：120%', 100],
  ['## 进度：abc%', null],
  ['无进度内容', null],
  ['## 进度：0%', 0],
  ['## 进度：95%', 95],
  // B4 回归：三级锚定 —— 正文示例/规则文本不劫持标题行进度区（#459/#460 实证）
  ['## 已对齐决定\n3. 每张新票写 ## 进度：0% 基准。\n## 进度：90%', 90],
  ['## 待 grill 点\n- 宽容：## 进度：90% 主格式\n## 进度：95%', 95],
  ['Progress: 40%', 40],
]
cases.forEach(function (c) {
  const got = parseProgress(c[0])
  check(got === c[1], 'parseProgress(' + JSON.stringify(c[0]) + ') = ' + got + '（期望 ' + c[1] + '）')
})

// T16: normalizeBody 容错测试（从 host 提取；字面 \\n 还原 + 剥 BOM）
const nfm = hostMap.match(/function normalizeBody\(raw\) \{[\s\S]*?\n    \}/)
check(!!nfm, 'host 含 normalizeBody 定义（T16）')
const normalizeBody = nfm ? evalWithScope(nfm[0], {}) : function (s) { return String(s || '') }
// 坏格式：BOM + 整篇字面 \\n（无真实换行）
const badBody = String.fromCharCode(0xfeff) + '## Destination\\n\\nDSH-Waystation **v1.5**\\n\\n## Notes\\n\\nnote here'
const normBad = normalizeBody(badBody)
check(!normBad.startsWith(String.fromCharCode(0xfeff)), 'normalizeBody 剥 BOM')
check(normBad.indexOf('\n') >= 0, 'normalizeBody 字面 \\n 还原为真实换行')
check(normBad.indexOf('\\n') < 0, 'normalizeBody 不再含字面 \\\\n')
check(normalizeBody('正常\n正文\n带真实换行') === '正常\n正文\n带真实换行', 'normalizeBody 不误伤正常正文')
check(normalizeBody('') === '', 'normalizeBody 空串安全')
// T16 端到端回归（#463/#445）：parseMapBody 必须经 normalizeBody 接线 —— 坏格式 body（BOM + 字面 \n）恢复 Destination
const pfm = hostMap.match(/function parseMapBody\(body\) \{[\s\S]*?\n    \}/)
check(!!pfm, 'host 含 parseMapBody 定义（T16 端到端）')
// parseMapBody 内部要调 normalizeBody，直接求值原本靠外层作用域看得见它；这里改成显式给出。
const parseMapBody = pfm ? evalWithScope(pfm[0], { normalizeBody }) : function () { return { destination: '', notes: '' } }
const e2eOut = parseMapBody(badBody)
check(e2eOut.destination === 'DSH-Waystation **v1.5**', 'parseMapBody 端到端恢复 Destination（BOM+字面 \\n · #445 场景）')
check(e2eOut.notes === 'note here', 'parseMapBody 端到端恢复 Notes（#445 场景）')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
