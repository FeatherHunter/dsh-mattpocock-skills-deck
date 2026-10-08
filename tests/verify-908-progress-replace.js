// verify-908-progress-replace.js —— #908 回归：写进度只换标题、旧内容残留
//
// 为什么要有这一条：deck_issue_patch 写进度时用的正则在多行模式下只匹配到标题行，
// 旧进度块留在正文末尾，票面上出现两段进度记录，而且调用回执是成功，调用方发现不了。
// 本文件把票里提到的六种正文形态钉死：有进度段的四种必须整体替换（旧内容不残留、标题恰好一条），
// 没有进度段的两种必须追加（不报错、标题恰好一条）。外加三条历史教训：带百分比的标题也要认、
// 英文 Progress 标题也要认、之前写坏留下的双进度区要一次清干净。
//
// 用法：在插件根目录执行 node tests/verify-908-progress-replace.js，可独立运行。
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

function countProgressHeaders(s) {
  // 只数真正的进度标题：## 进度计划这种只是名字带进度两个字，不算。
  const m = String(s).match(/^##\s*(?:进度|Progress)(?:\s*[：:]\s*\d{1,3}\s*%?)?\s*$/gm)
  return m ? m.length : 0
}

async function main() {
  console.log('#908 写进度替换回归')
  const patchMod = await imp('src/host/tools/deckIssuePatch.js')
  const planMod = await imp('src/shared/deck-tools/plan.js')
  const replaceProgressSection = patchMod.replaceProgressSection
  const ensureBody = planMod.ensureBody
  check(typeof replaceProgressSection === 'function', '读到替换函数 replaceProgressSection')
  check(typeof ensureBody === 'function', '读到补正文函数 ensureBody')

  const NEW = '2026-10-08 新内容'
  // 票里给的六种形态：A 进度在文末、B 后面还有标题、C 同上但换行是 CRLF、D 标题带百分比、E 无进度段、F 空正文。
  const A = '## Question\n\nx\n\n## 进度\n\n<!-- marker -->\n2026-10-06 旧内容\n'
  const B = '## Question\n\nx\n\n## 进度\n\nold\n\n## 其他\n\ny\n'
  const C = '## Question\r\nx\r\n\r\n## 进度\r\n\r\nold\r\n\r\n## 其他\r\n\ry\r\n'
  const D = '## Question\n\nx\n\n## 进度：80%\n\nold\n'
  const E = '## Question\n\nx\n'
  const F = ''

  const outA = replaceProgressSection(A, NEW)
  check(outA.includes(NEW), 'A 进度在文末：新内容写进去了')
  check(!outA.includes('旧内容') && !outA.includes('marker'), 'A 进度在文末：旧内容与旧标记都不残留')
  check(countProgressHeaders(outA) === 1, 'A 进度在文末：进度标题恰好一条（实际 ' + countProgressHeaders(outA) + ' 条）')

  const outB = replaceProgressSection(B, NEW)
  check(outB.includes(NEW) && !outB.includes('old\n\n##'), 'B 后面还有标题：旧段被整段换掉')
  check(countProgressHeaders(outB) === 1, 'B 后面还有标题：进度标题恰好一条')
  check(outB.includes(NEW + '\n\n## 其他'), 'B 后面还有标题：新块与下一个标题之间留一个空行')

  const outC = replaceProgressSection(C, NEW)
  check(outC.includes(NEW), 'C CRLF 正文：新内容写进去了')
  check(!/(?:^|\n)old(?:\r?\n)/.test(outC), 'C CRLF 正文：旧内容不残留')
  check(countProgressHeaders(outC) === 1, 'C CRLF 正文：进度标题恰好一条')

  const outD = replaceProgressSection(D, NEW)
  check(outD.includes(NEW) && !outD.includes('old'), 'D 标题带百分比：旧段被整段换掉')
  check(countProgressHeaders(outD) === 1, 'D 标题带百分比：进度标题恰好一条，不再另起一段')

  const outE = replaceProgressSection(E, NEW)
  check(outE.includes(NEW) && outE.includes('## 进度'), 'E 无进度段：追加一段进度而不是报错')
  check(countProgressHeaders(outE) === 1, 'E 无进度段：进度标题恰好一条')

  const outF = replaceProgressSection(F, NEW)
  check(outF.includes(NEW) && outF.includes('## 进度'), 'F 空正文：追加一段进度而不是报错')
  check(countProgressHeaders(outF) === 1, 'F 空正文：进度标题恰好一条')

  // 历史教训 1：补正文也要认带百分比的标题，否则先补一段再换一段，越修越多。
  const ensured = ensureBody('## 进度：80%\nold\n', 'task')
  check(ensured.added.length === 0, '补正文认带百分比的标题：不再重复追加进度区')
  check(countProgressHeaders(ensured.body) === 1, '补正文认带百分比的标题：正文里进度标题仍是一条')

  // 历史教训 2：英文 Progress 标题也要认，认出来后统一写成中文标题，避免中英两段并存。
  const outEn = replaceProgressSection('## Progress: 40%\nold\n', NEW)
  check(outEn.includes(NEW) && !outEn.includes('old'), '英文标题：旧段被整段换掉')
  check(countProgressHeaders(outEn) === 1, '英文标题：进度标题恰好一条')

  // 历史教训 3：之前写坏留下的双进度区，一次写进度就清干净，不用人工再删一段。
  const outDouble = replaceProgressSection('## Question\nx\n\n## 进度\n\nold1\n\n## 进度\nold2\n', NEW)
  check(outDouble.includes(NEW) && !outDouble.includes('old1') && !outDouble.includes('old2'), '双进度脏数据：两段旧内容都不残留')
  check(countProgressHeaders(outDouble) === 1, '双进度脏数据：进度标题恰好一条')

  // 反向保护：名字里带进度的别的标题不是进度区，不能误伤。
  const outOther = replaceProgressSection('## 进度计划\nxxx\n', NEW)
  check(outOther.includes('## 进度计划\nxxx'), '别的标题：## 进度计划原样保留')
  check(outOther.includes(NEW) && countProgressHeaders(outOther) === 1, '别的标题：在后面追加真正的进度区')

  // 保命栏：旧正文没读回来时只写进度必须被拦下，不能拿空正文覆盖整张票（#908 处理中亲历：一次空写把整票冲成只剩进度段）。
  const fs = require('fs')
  const patchSrc = fs.readFileSync(require('path').join(ROOT, 'src/host/tools/deckIssuePatch.js'), 'utf8')
  check(patchSrc.includes('progressBlocked'), '防冲掉：读不到旧正文时拦下进度写（progressBlocked 分支存在）')
  check(patchSrc.indexOf("a.body : \u0027\u0027") < 0, '防冲掉：不再用空串兜底旧正文')

  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
