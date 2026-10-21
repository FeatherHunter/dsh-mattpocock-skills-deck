// verify-908-progress-replace.ts —— #908 回归：写进度只换一处、不留重复的进度区
// 2026-10-17 从 .js 转成 TypeScript：只改文件名与用法行，判据与断言一条没动。
//
// 为什么要有这一条：deck_issue_patch 写进度时用的正则在多行模式下只匹配到标题行，
// 旧进度块留在正文末尾，票面上出现两段进度记录，而且调用回执是成功，调用方发现不了。
// 本文件把票里提到的六种正文形态钉死：有进度段的四种必须整体替换成一段、标题恰好一条；
// 没有进度段的两种必须追加（不报错、标题恰好一条）。外加三条历史教训：带百分比的标题也要认、
// 英文 Progress 标题也要认、之前写坏留下的双进度区要一次清干净。
//
// 2026-10-21 #1090 改写：写进度的函数从 deck_issue_patch 搬到 src/tracker/body-parse.ts，
// 收的参数也从「一段自由文字」改成结构化记录 {percent, note, updatedAt}；语义按 #1089 定稿：
// 新记录放区首、旧记录与自由文字原样保留（不再清掉旧进度——那是历史，不能丢），
// 重复的进度区仍然只留一个。另加两条今天踩过的坑：代码块里的示例标题不能被当真的进度区改掉、
// 老票标题里的百分比第一次写入时要搬成一条「时间未记录」的记录。
//
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-908-progress-replace.ts（不挂钩子会在加载 .ts 真源时 ERR_MODULE_NOT_FOUND）。
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

function countProgressHeaders(s: string): number {
  // 只数真正的进度标题：## 进度计划这种只是名字带进度两个字，不算。
  const m = String(s).match(/^##\s*(?:进度|Progress)(?:\s*[：:]\s*\d{1,3}\s*%?)?\s*$/gm)
  return m ? m.length : 0
}
const FENCE = String.fromCharCode(96).repeat(3)
const NEW = { percent: 90, note: '新内容', updatedAt: '2026-10-21T20:00:00+08:00' }
const NEW_LINE = '- 进度：90%（2026-10-21T20:00:00+08:00）：新内容'

async function main() {
  console.log('#908 / #1090 写进度替换回归')
  const leaf = await imp('src/tracker/body-parse.ts')
  const replaceProgressSection = leaf.replaceProgressSection
  const parseProgressDetail = leaf.parseProgressDetail
  const stripProgressSections = leaf.stripProgressSections
  const planMod = await imp('src/deck/shell/minimal-spec.ts')
  const ensureBody = planMod.ensureBody
  check(typeof replaceProgressSection === 'function', '读到替换函数 replaceProgressSection（tracker 叶子）')
  check(typeof parseProgressDetail === 'function', '读到结构化解析 parseProgressDetail（tracker 叶子）')
  check(typeof stripProgressSections === 'function', '读到剥进度区函数 stripProgressSections（tracker 叶子）')
  check(typeof ensureBody === 'function', '读到补正文函数 ensureBody')

  // 票里给的六种形态：A 进度在文末、B 后面还有标题、C 同上但换行是 CRLF、D 标题带百分比、E 无进度段、F 空正文。
  // A 区里那两行认不出是进度记录，按自由文字原样保留（#1089：旧内容不删不改）。
  const A = '## Question\n\nx\n\n## 进度\n\n<!-- marker -->\n2026-10-06 旧内容\n'
  const B = '## Question\n\nx\n\n## 进度\n\n- 进度：40%（时间未记录）：旧记录\n\n## 其他\n\ny\n'
  const C = '## Question\r\nx\r\n\r\n## 进度\r\n\r\n- 进度：40%（时间未记录）：旧记录\r\n\r\n## 其他\r\ny\r\n'
  const D = '## Question\n\nx\n\n## 进度：80%\n\nold\n'
  const E = '## Question\n\nx\n'
  const F = ''

  const outA = replaceProgressSection(A, NEW)
  check(outA.includes(NEW_LINE), 'A 进度在文末：新记录写进去了')
  check(outA.includes('<!-- marker -->') && outA.includes('2026-10-06 旧内容'), 'A 进度在文末：区里的旧文字原样保留（不删历史）')
  check(countProgressHeaders(outA) === 1, 'A 进度在文末：进度标题恰好一条（实际 ' + countProgressHeaders(outA) + ' 条）')
  const aDetail = parseProgressDetail(outA)
  check(aDetail.percent === 90 && aDetail.entries[0].note === '新内容', 'A 进度在文末：读回第一条就是新记录')

  const outB = replaceProgressSection(B, NEW)
  check(outB.includes(NEW_LINE) && outB.includes('- 进度：40%（时间未记录）：旧记录'), 'B 后面还有标题：新记录在区首，旧记录原样保留')
  check(countProgressHeaders(outB) === 1, 'B 后面还有标题：进度标题恰好一条')
  check(outB.includes('\n\n## 其他'), 'B 后面还有标题：新块与下一个标题之间留一个空行')
  check(outB.indexOf(NEW_LINE) < outB.indexOf('旧记录'), 'B 后面还有标题：新记录排在旧记录之前（最新在最上）')

  const outC = replaceProgressSection(C, NEW)
  check(outC.includes(NEW_LINE), 'C CRLF 正文：新记录写进去了')
  check(outC.includes('\r\n'), 'C CRLF 正文：原有换行符保留')
  check(countProgressHeaders(outC) === 1, 'C CRLF 正文：进度标题恰好一条')

  const outD = replaceProgressSection(D, NEW)
  check(outD.includes(NEW_LINE) && outD.includes('- 进度：80%（时间未记录）'), 'D 标题带百分比：旧百分比搬成一条「时间未记录」的记录')
  check(outD.includes('old'), 'D 标题带百分比：区里旧文字原样保留')
  check(countProgressHeaders(outD) === 1, 'D 标题带百分比：进度标题恰好一条，不再另起一段')

  const outE = replaceProgressSection(E, NEW)
  check(outE.includes(NEW_LINE) && outE.includes('## 进度'), 'E 无进度段：追加一段进度而不是报错')
  check(countProgressHeaders(outE) === 1, 'E 无进度段：进度标题恰好一条')

  const outF = replaceProgressSection(F, NEW)
  check(outF.includes(NEW_LINE) && outF.includes('## 进度'), 'F 空正文：追加一段进度而不是报错')
  check(countProgressHeaders(outF) === 1, 'F 空正文：进度标题恰好一条')

  // 历史教训 1：补正文也要认带百分比的标题，否则先补一段再换一段，越修越多。
  const ensured = ensureBody('## 进度：80%\nold\n', 'task')
  check(ensured.added.length === 0, '补正文认带百分比的标题：不再重复追加进度区')
  check(countProgressHeaders(ensured.body) === 1, '补正文认带百分比的标题：正文里进度标题仍是一条')

  // 历史教训 2：英文 Progress 标题也要认，认出来后统一写成中文标题，避免中英两段并存。
  const outEn = replaceProgressSection('## Progress: 40%\n\nold\n', NEW)
  check(outEn.includes(NEW_LINE) && outEn.includes('- 进度：40%（时间未记录）'), '英文标题：旧百分比保留成记录')
  check(countProgressHeaders(outEn) === 1, '英文标题：进度标题恰好一条')
  check(!/^##\s*Progress/m.test(outEn), '英文标题：写回统一成中文「## 进度」')

  // 历史教训 3：之前写坏留下的双进度区，一次写进度就清干净，不用人工再删一段。
  const outDouble = replaceProgressSection('## Question\nx\n\n## 进度\n\n- 进度：30%（时间未记录）：old1\n\n## 进度\n\n- 进度：20%（时间未记录）：old2\n', NEW)
  check(outDouble.includes(NEW_LINE) && outDouble.includes('old1') && outDouble.includes('old2'), '双进度脏数据：两段旧记录都保留成一条条记录')
  check(countProgressHeaders(outDouble) === 1, '双进度脏数据：进度标题恰好一条')

  // 反向保护：名字里带进度的别的标题不是进度区，不能误伤。
  const outOther = replaceProgressSection('## 进度计划\nxxx\n', NEW)
  check(outOther.includes('## 进度计划\nxxx'), '别的标题：## 进度计划原样保留')
  check(outOther.includes(NEW_LINE) && countProgressHeaders(outOther) === 1, '别的标题：在后面追加真正的进度区')

  // #1090 新坑：代码块里的示例标题不是真进度区，写进度不能改到示例。
  const fencedOnly = '## Question\n\n' + FENCE + '\n## 进度：90%\n' + FENCE + '\n'
  const outFenced = replaceProgressSection(fencedOnly, NEW)
  check(outFenced.includes(FENCE + '\n## 进度：90%\n' + FENCE), '代码块示例：示例标题原样保留')
  check(outFenced.includes('## 进度\n\n' + NEW_LINE), '代码块示例：真正的进度区追加在文末')
  check(parseProgressDetail(outFenced).percent === 90 && outFenced.split('\n').filter((l: string) => l === '## 进度').length === 1, '代码块示例：真进度区只有一个（示例那个不算）')
  const fencedBeforeReal = '## 进度\n\n' + FENCE + '\n## 进度\n\n- 进度：30%（时间未记录）：示例里的旧行\n' + FENCE + '\n'
  const outFencedBeforeReal = replaceProgressSection(fencedBeforeReal, NEW)
  check(outFencedBeforeReal.includes(FENCE + '\n## 进度\n\n- 进度：30%（时间未记录）：示例里的旧行\n' + FENCE), '代码块示例：真区前面的围栏内容不被当记录搬走')
  check(outFencedBeforeReal.includes(NEW_LINE), '代码块示例：真区里的新记录写进去了')

  // #1002：整份文件形态（之前只喂片段，所以一直绿着放过了这条缺陷）。
  // G 整份有进度区：替换后字段行还在骨架之前，不被吞掉再补到文末。
  const fullWith = '<!-- DSH-IDEMPOTENCY-KEY: g -->\n# 标题\n\n## Question\n\nx\n\n## 进度\n\n- 进度：30%（时间未记录）：old\n\nStatus: ready-for-agent\nBlocked by:\nLabels: bug\n\n## Comments\n\n\n## Answer\n\n'
  const outG = replaceProgressSection(fullWith, NEW)
  check(outG.includes(NEW_LINE) && outG.includes('- 进度：30%（时间未记录）：old'), 'G 整份有进度：新记录写入、旧记录保留')
  check(countProgressHeaders(outG) === 1, 'G 整份有进度：进度标题恰好一条')
  check(outG.indexOf('Status:') < outG.indexOf('## Comments'), 'G 整份有进度：字段行还在骨架之前（被吞到文末就失败）')
  // H 整份无进度区：插在字段行之前，不落到 Answer 之后。
  const fullWithout = '<!-- DSH-IDEMPOTENCY-KEY: h -->\n# 标题\n\n## Question\n\nx\n\nStatus: ready-for-agent\nBlocked by:\nLabels: bug\n\n## Comments\n\n\n## Answer\n\n'
  const outH = replaceProgressSection(fullWithout, NEW)
  check(outH.includes(NEW_LINE) && countProgressHeaders(outH) === 1, 'H 整份无进度：追加一段进度')
  check(outH.indexOf('## 进度') < outH.indexOf('Status:'), 'H 整份无进度：进度插在字段行之前（落到 Answer 之后就失败）')
  check(outH.indexOf('Status:') < outH.indexOf('## Answer'), 'H 整份无进度：字段行还在 Answer 之前')

  // #1090：写后核对靠 stripProgressSections —— 剥掉进度区，其余正文与写前逐字相同。
  const beforeRest = stripProgressSections(fullWith).trim()
  const afterRest = stripProgressSections(outG).trim()
  check(beforeRest === afterRest, '写后核对：剥掉进度区后，正文其余部分逐字未动')

  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
