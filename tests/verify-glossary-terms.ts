/**
 * tests/verify-glossary-terms.ts —— 通知中心/通知事件与按需细节「不设上限、不淘汰」门禁（#1683 立，#1922 改）
 *
 * 门禁归属: GLOSSARY.md
 *
 * 这个门禁回答三个问题：
 *   一、「面板共享语义词条」这一节的标题写着两轮修订的日期与票号：2026-10-31 / #1683（通知中心与通知事件）
 *      与 2026-11-05 / #1922（按需细节改成不设上限、不淘汰）；
 *   二、节里有「通知中心」「通知事件」两个词条，各恰好一条，而且不是只有名字（正文至少 60 字）；
 *   三、「按需细节」词条写的是新决定：2026-11-05 起不设上限、不淘汰，数据只在源头删除时消失，
 *      增长在诊断读数里看得见（字节数）；旧口径的「按最近使用淘汰」与「曾取过」记号不许再出现。
 *
 * 为什么改这道门禁（#1922）：它原来守的是旧规则（按上限淘汰、界面显示「未取（曾在某时）」）。
 * 维护者 2026-11-05 拍板「我们就不限制上限了，也不要淘汰了。数据库里面存的数据，除非源头被删除，
 * 否则不会再消失。」——门禁不能跟着规则一起删掉，必须改成守新决定，否则术语表写错也没人拦。
 *
 * 负例是判据的证据：从内存文本里删掉一条词条、复制出一条重名词条、把「不设上限」拿掉、
 * 把旧口径「按最近使用淘汰」塞回去，检查函数都必须当场报红。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-glossary-terms.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const GLOSSARY = path.join(ROOT, 'GLOSSARY.md')
const SECTION_MARK = '面板共享语义词条'
const SECTION_DATE = '2026-10-31'
const SECTION_TICKET = '#1683'
const REVISION_DATE = '2026-11-05'
const REVISION_TICKET = '#1922'
const TERMS = ['通知中心', '通知事件']
/** 「按需细节」的新决定里必须出现的五件事：变更日期、不设上限、不淘汰、只在源头删除时消失、诊断里的字节数。 */
const DECISION_MARKERS = [REVISION_DATE, '不设上限', '不淘汰', '源头', '字节数']
/** 旧口径的词：一个都不许再留在按需细节词条里。 */
const RETIRED_MARKERS = ['按最近使用淘汰', '曾取过']

let failed = false
const check = (ok: boolean, msg: string): void => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 找到「面板共享语义词条」那一节的标题行下标与正文行；找不到标题回 null。 */
function findSection(lines: readonly string[]): { heading: string; body: string[] } | null {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ') && lines[i].includes(SECTION_MARK)) { start = i; break }
  }
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  return { heading: lines[start], body: lines.slice(start + 1, end) }
}

/** 一行词条的正文长度（去掉 markdown 记号），用来判「不是只有名字」。 */
function termBodyLength(line: string): number {
  return line.replace(/[*_`]/g, '').trim().length
}

/** 检查一段 GLOSSARY 文本；返回人话问题清单，空数组才是通过。负例直接拿它跑改坏的副本。 */
function glossaryProblems(text: string): string[] {
  const problems: string[] = []
  const section = findSection(text.split(/\r?\n/))
  if (!section) return ['找不到「' + SECTION_MARK + '」这一节']
  if (!section.heading.includes(SECTION_DATE)) problems.push('「' + SECTION_MARK + '」节标题没写第一轮修订日期 ' + SECTION_DATE)
  if (!section.heading.includes(SECTION_TICKET)) problems.push('「' + SECTION_MARK + '」节标题没写票号 ' + SECTION_TICKET)
  if (!section.heading.includes(REVISION_DATE)) problems.push('「' + SECTION_MARK + '」节标题没写按需细节改口径的日期 ' + REVISION_DATE)
  if (!section.heading.includes(REVISION_TICKET)) problems.push('「' + SECTION_MARK + '」节标题没写按需细节改口径的票号 ' + REVISION_TICKET)
  for (const term of TERMS) {
    const hits = section.body.filter((line) => line.startsWith('- **' + term + '（'))
    if (hits.length === 0) problems.push('节里缺词条「' + term + '」')
    else if (hits.length > 1) problems.push('词条「' + term + '」重复 ' + hits.length + ' 次（同一节只许一条）')
    else if (termBodyLength(hits[0]) < 60) problems.push('词条「' + term + '」只有名字、没有把定义写清楚（正文 ' + termBodyLength(hits[0]) + ' 字）')
  }
  const detail = section.body.find((line) => line.startsWith('- **按需细节（'))
  if (!detail) {
    problems.push('节里缺「按需细节」词条，不设上限与不淘汰的决定没有落点')
  } else {
    for (const marker of DECISION_MARKERS) {
      if (!detail.includes(marker)) problems.push('「按需细节」的新决定没写到「' + marker + '」')
    }
    for (const marker of RETIRED_MARKERS) {
      if (detail.includes(marker)) problems.push('「按需细节」里还留着旧口径「' + marker + '」')
    }
  }
  return problems
}

/** 把文本里第一行以 prefix 开头的行替换成 transform 的结果；找不到就原样返回。 */
function mapLine(text: string, prefix: string, transform: (line: string) => string): string {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(prefix)) { lines[i] = transform(lines[i]); break }
  }
  return lines.join('\n')
}

function report(label: string, problems: readonly string[]): void {
  check(problems.length === 0, label + (problems.length ? '：' + problems.join('；') : ''))
}

const text = fs.readFileSync(GLOSSARY, 'utf8')
const section = findSection(text.split(/\r?\n/))
check(section !== null, 'GLOSSARY.md 里有「' + SECTION_MARK + '」这一节')
report('术语表里通知中心、通知事件两条齐全，按需细节写的是不设上限、不淘汰', glossaryProblems(text))

// ---- 负例：判据真能咬住 ----
const withoutFirst = text.split(/\r?\n/).filter((line) => !line.startsWith('- **' + TERMS[0] + '（')).join('\n')
const missingTermProblems = glossaryProblems(withoutFirst)
check(missingTermProblems.some((p) => p.includes('缺词条') && p.includes(TERMS[0])), '负例：删掉「' + TERMS[0] + '」词条，检查函数当场判红（' + (missingTermProblems[0] || '没报') + '）')

const termLine = text.split(/\r?\n/).find((line) => line.startsWith('- **' + TERMS[1] + '（')) || ''
const duplicated = mapLine(text, '- **' + TERMS[1] + '（', (line) => line + '\n' + termLine)
const duplicateProblems = glossaryProblems(duplicated)
check(duplicateProblems.some((p) => p.includes('重复')), '负例：复制出第二条「' + TERMS[1] + '」，检查函数当场判红（' + (duplicateProblems[0] || '没报') + '）')

const noDecision = mapLine(text, '- **按需细节（', (line) => line.replace(/不设上限/g, ''))
const noDecisionProblems = glossaryProblems(noDecision)
check(noDecisionProblems.some((p) => p.includes('按需细节')), '负例：把「按需细节」里的「不设上限」拿掉，检查函数当场判红（' + (noDecisionProblems[0] || '没报') + '）')

const oldRuleBack = mapLine(text, '- **按需细节（', (line) => line + '旧口径：超出时按最近使用淘汰。')
const oldRuleProblems = glossaryProblems(oldRuleBack)
check(oldRuleProblems.some((p) => p.includes('旧口径')), '负例：把旧口径「按最近使用淘汰」塞回去，检查函数当场判红（' + (oldRuleProblems[0] || '没报') + '）')

console.log(failed ? '\n存在失败 — 术语表词条门禁没通过' : '\n全部通过 — 术语表词条门禁生效')
process.exit(failed ? 1 : 0)
