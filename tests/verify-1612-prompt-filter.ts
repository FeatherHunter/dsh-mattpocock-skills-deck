/**
 * tests/verify-1612-prompt-filter.ts —— deck 关掉的工作区里，注入的提示词不再出现 deck 工具提醒行。
 *
 * 票面（#1612）验收第 ⑧ 条：deck 工具箱关闭的工作区，提示词里不再出现 deck_* / suggest_next_steps 的提醒行。
 * 这批提醒行来自构建期烘进客户端的模板（config/prompts/ 的「## 工具」小节），本票不动模板生成链，
 * 只在注入那一刻按当前工作区过滤；过滤函数住 src/client/kernel/deck-prompt-filter.ts。
 *
 * 本文件钉三件事：
 *   ① 过滤口径：只删「勾选提醒行」里提到 deck_ / suggest_next_steps 的那些；普通句子里顺口提到 deck 不动；
 *      一条不剩的小节连标题一起删；deck 没关或没有可删行时原样返回同一个字符串。
 *   ② 拿真实模板逐份过滤：生成物里每条模板的中英正文过滤后，提醒行一条不剩、别的小节（尤其「## 调查」）还在。
 *      这样 JAML 改文案、共享小节改名之后，只要过滤器口径还接得上，本门禁就不会因为文案改了而白红。
 *   ③ 三处注入漏斗都真的接上了过滤器：api-io 的 inject、api-new-session 的 openTextInNewSession、
 *      api-naming 的 createPTCSession（新建会话唯一出口，接手/交接都经过它）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1612-prompt-filter.ts
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { deckPromptFiltered } from '../src/client/kernel/deck-prompt-filter.ts'

const requireHere = createRequire(import.meta.url)
const { sourceText } = requireHere('./lib/source-text.ts')
const { ensurePromptData, promptDataSpliceable } = requireHere('./lib/prompt-data.ts')
const { compileFn } = requireHere('./lib/eval-probe.ts')
const root = path.resolve(import.meta.dirname, '..')

let failed = false
let total = 0
const same = (a: unknown, b: unknown) => a === b
const check = (ok: unknown, msg: string) => {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg) }
}

// 测试自己判「哪种行算 deck 提醒行」：刻意不调生产代码里那两个正则，免得判据和实现一起错。
const isCheckLine = (line: string) => /^\s*[-*]\s+\[[ xX]?\]\s/.test(line)
const mentionsDeck = (line: string) => /deck_[A-Za-z0-9_]*|suggest_next_steps/.test(line)
const deckReminderLines = (text: string) => String(text || '').split('\n').filter(l => isCheckLine(l) && mentionsDeck(l))

/** 一段文本里「指定小节的正文是否一条不剩」（判断空小节标题该不该删时用）。 */
function sectionHasBody(text: string, heading: string): boolean {
  const lines = String(text || '').split('\n')
  const start = lines.findIndex(l => l.trim() === heading)
  if (start < 0) return false
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{0,3}#{1,6}\s/.test(lines[i])) break
    if (lines[i].trim()) return true
  }
  return false
}

console.log('== ① 过滤口径 ==')
{
  const zh = [
    '## 调查（建议先查后问）',
    '- [ ] 先读票正文与评论。',
    '- [ ] 仓内既有笔记答不了再新查一次。',
    '',
    '## 工具',
    '- [ ] issue 相关操作优先使用 deck_ 开头的工具处理。',
    '- [ ] 及时使用 deck_issue_report 工具上报处理过的编号。',
    '- [ ] 回复前调用 suggest_next_steps 推荐下一步。',
    '',
    '## 收尾',
    '- [ ] 把真实状态写进正文。',
  ].join('\n')
  const out = deckPromptFiltered(zh, true)
  check(deckReminderLines(out).length === 0, '① 中文模板过滤后不剩任何 deck 提醒行')
  check(out.indexOf('## 工具') < 0, '① 工具小节被删空后连标题一起删掉')
  check(out.indexOf('## 调查') >= 0 && out.indexOf('- [ ] 先读票正文与评论。') >= 0, '① 「## 调查」小节原样保留')
  check(out.indexOf('## 收尾') >= 0 && out.indexOf('- [ ] 把真实状态写进正文。') >= 0, '① 其它小节原样保留')
  check(!/^\n|\n$/.test(out) && !/\n\n\n/.test(out), '① 删完不留首尾空行、不留连着两行空行（' + JSON.stringify(out.slice(0, 20)) + '）')

  const en = [
    '## Tools',
    '- [ ] Prefer tools whose names start with deck_ when working on issues.',
    '- [ ] Report processed issues with deck_issue_report.',
    '- [ ] Call suggest_next_steps before replying.',
    '',
    '## Closing',
    '- [ ] Write the real status back into the issue.',
  ].join('\n')
  const outEn = deckPromptFiltered(en, true)
  check(deckReminderLines(outEn).length === 0 && outEn.indexOf('## Tools') < 0, '① 英文模板同样：提醒行与空掉的 Tools 标题都删掉')
  check(outEn.indexOf('## Closing') >= 0 && outEn.indexOf('- [ ] Write the real status back into the issue.') >= 0, '① 英文模板的其它小节保留')

  const prose = '这一票和 deck_issue_report 无关，正文里顺口提了一句；不调用 suggest_next_steps 也完全可以。'
  check(same(deckPromptFiltered(prose, true), prose), '① 普通句子（非勾选行）里提到 deck / suggest_next_steps 一个字不动')

  const mixed = ['## 工具', '- [ ] 先读 GLOSSARY.md。', '- [ ] issue 相关操作优先使用 deck_ 开头的工具处理。', '', '## 收尾', '- [ ] 收口。'].join('\n')
  const outMixed = deckPromptFiltered(mixed, true)
  check(outMixed.indexOf('## 工具') >= 0 && outMixed.indexOf('- [ ] 先读 GLOSSARY.md。') >= 0 && deckReminderLines(outMixed).length === 0, '① 工具小节还有别的内容时只删提醒行、标题留下')

  const zhTight = ['## 工具', '- [ ] 用的deck_工具要优先。', '', '## 收尾', '- [ ] 收口。'].join('\n')
  check(deckReminderLines(deckPromptFiltered(zhTight, true)).length === 0, '① 中文里紧贴汉字的 deck_ 也认（「用的deck_工具」）')

  check(same(deckPromptFiltered(zh, false), zh), '① deck 没关时原样返回同一个字符串')
  check(deckPromptFiltered(null, true) === '' && deckPromptFiltered(undefined, true) === '' && deckPromptFiltered('', true) === '', '① null / undefined / 空串都回空串，不抛')
}

console.log('\n== ② 真实模板（构建期烘进客户端的那一份）逐份过滤 ==')
{
  ensurePromptData(root)
  const src = promptDataSpliceable(root) + '\n;return { T: PROMPT_TEMPLATE_DATA, F: PROMPT_FRAGMENT_DATA }'
  const data = compileFn([], src)()
  const tpls = data && data.T ? data.T : {}
  const ids = Object.keys(tpls)
  check(ids.length > 0, '② 生成物里有模板表（' + ids.length + ' 条）')

  let withTools = 0
  let rawReminderTotal = 0
  let badLeft = 0
  let badSame = 0
  let badSection = 0
  for (const id of ids) {
    const entry = tpls[id] || {}
    for (const lang of ['zh', 'en']) {
      const body = entry[lang]
      if (typeof body !== 'string' || !body) continue
      const rawLines = deckReminderLines(body)
      if (rawLines.length) { withTools++; rawReminderTotal += rawLines.length }
      const out = deckPromptFiltered(body, true)
      if (deckReminderLines(out).length) badLeft++
      if (deckPromptFiltered(body, false) !== body) badSame++
      // 「## 工具」小节本来就只有提醒行时，过滤后标题不该还留着（留一个空标题比删掉更难读）。
      const heading = lang === 'en' ? '## Tools' : '## 工具'
      if (body.indexOf(heading) >= 0 && !sectionHasBody(body, heading) && out.indexOf(heading) >= 0) badSection++
      // 调查小节不含 deck 字样，过滤前后必须在不在这一点上一致。
      if (body.indexOf('## 调查') >= 0 && out.indexOf('## 调查') < 0) badSection++
      if (body.indexOf('## Investigate') >= 0 && out.indexOf('## Investigate') < 0) badSection++
    }
  }
  check(withTools > 0 && rawReminderTotal > 0, '② 真实模板里确实有 deck 提醒行（' + withTools + ' 份模板、共 ' + rawReminderTotal + ' 行；过滤器有活干）')
  check(badLeft === 0, '② 每份模板过滤后都不剩 deck 提醒行（违规 ' + badLeft + ' 份）')
  check(badSame === 0, '② deck 没关时每份模板都原样返回（违规 ' + badSame + ' 份）')
  check(badSection === 0, '② 空掉的工具标题被删、「## 调查」不被误删（违规 ' + badSection + ' 处）')
}

console.log('\n== ③ 三处注入漏斗都接上了过滤器 ==')
{
  const sliceExport = (file: string, marker: string): string => {
    const text = sourceText(file)
    const at = text.indexOf(marker)
    if (at < 0) return ''
    const next = text.indexOf('\nexport ', at + marker.length)
    return text.slice(at, next < 0 ? undefined : next)
  }
  const io = sliceExport('src/client/kernel/api-io.ts', 'export const inject')
  check(io.indexOf('deckPromptFiltered(') >= 0 && io.indexOf('isDeckClosed(') >= 0, '③ api-io 的 inject（旧任务/handoff 注入）先按 deck 状态过滤')
  const ns = sliceExport('src/client/kernel/api-new-session.ts', 'export const openTextInNewSession')
  check(ns.indexOf('deckPromptFiltered(') >= 0 && ns.indexOf('isDeckClosed(') >= 0, '③ api-new-session 的 openTextInNewSession（新建会话入口）先过滤')
  const naming = sliceExport('src/client/kernel/api-naming.ts', 'export const createPTCSession')
  check(naming.indexOf('deckPromptFiltered(') >= 0 && naming.indexOf('isDeckClosed(') >= 0, '③ api-naming 的 createPTCSession（唯一建会话出口，接手/交接都走它）先过滤')
  check(sourceText('src/client/kernel/api-io.ts').indexOf('declare const deckPromptFiltered') >= 0
    && sourceText('src/client/kernel/api-new-session.ts').indexOf('declare const deckPromptFiltered') >= 0
    && sourceText('src/client/kernel/api-naming.ts').indexOf('declare const deckPromptFiltered') >= 0, '③ 三个文件都按仓里规矩补了 declare（闭包内共享同一份实现）')
}

if (failed) {
  console.log('\n存在失败 — verify-1612-prompt-filter 未通过（失败项见上）')
  process.exit(1)
}
console.log('\n' + total + ' 条断言全部通过 — deck 关闭的工作区里，注入的提示词不再出现 deck 工具提醒行（#1612 验收 ⑧）')
