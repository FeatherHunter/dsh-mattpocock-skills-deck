/**
 * tests/verify-glossary-terms.ts —— 通知中心/通知事件与按需细节淘汰例外门禁（#1683）
 *
 * 门禁归属: GLOSSARY.md
 *
 * 这个门禁回答三个问题：
 *   一、「面板共享语义词条」这一节的标题写着本轮日期（2026-10-31）与票号（#1683）；
 *   二、节里有「通知中心」「通知事件」两个词条，各恰好一条，而且不是只有名字（正文至少 60 字）；
 *   三、「按需细节」词条里写着淘汰例外：超出上限按最近使用淘汰、界面显示「未取」、
 *       行与边永不因容量淘汰。
 *
 * 为什么要有它：术语表是本仓的领域词典，新词条落在哪一节、有没有写日期、旧词条有没有补例外，
 * 全靠人记得。这一条把 #1683 要求的三处改动变成判据。词条正文只判「写没写清楚」，
 * 不逐字比对措辞——措辞可以改，只要三件事还在。
 *
 * 负例是判据的证据：从内存文本里删掉一条词条、复制出一条重名词条、把「淘汰」二字拿掉，
 * 检查函数都必须当场报红。
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
const TERMS = ['通知中心', '通知事件']
/** 「按需细节」的淘汰例外里必须出现的四件事：上限、按最近使用淘汰、未取标记、行与边永不淘汰。 */
const EVICTION_MARKERS = ['上限', '最近使用', '淘汰', '未取', '永不']

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
  if (!section.heading.includes(SECTION_DATE)) problems.push('「' + SECTION_MARK + '」节标题没写本轮日期 ' + SECTION_DATE)
  if (!section.heading.includes(SECTION_TICKET)) problems.push('「' + SECTION_MARK + '」节标题没写票号 ' + SECTION_TICKET)
  for (const term of TERMS) {
    const hits = section.body.filter((line) => line.startsWith('- **' + term + '（'))
    if (hits.length === 0) problems.push('节里缺词条「' + term + '」')
    else if (hits.length > 1) problems.push('词条「' + term + '」重复 ' + hits.length + ' 次（同一节只许一条）')
    else if (termBodyLength(hits[0]) < 60) problems.push('词条「' + term + '」只有名字、没有把定义写清楚（正文 ' + termBodyLength(hits[0]) + ' 字）')
  }
  const detail = section.body.find((line) => line.startsWith('- **按需细节（'))
  if (!detail) {
    problems.push('节里缺「按需细节」词条，淘汰例外没有落点')
  } else {
    for (const marker of EVICTION_MARKERS) {
      if (!detail.includes(marker)) problems.push('「按需细节」的淘汰例外没写到「' + marker + '」')
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
report('术语表里通知中心、通知事件两条齐全，按需细节补了淘汰例外', glossaryProblems(text))

// ---- 负例：判据真能咬住 ----
const withoutFirst = text.split(/\r?\n/).filter((line) => !line.startsWith('- **' + TERMS[0] + '（')).join('\n')
const missingTermProblems = glossaryProblems(withoutFirst)
check(missingTermProblems.some((p) => p.includes('缺词条') && p.includes(TERMS[0])), '负例：删掉「' + TERMS[0] + '」词条，检查函数当场判红（' + (missingTermProblems[0] || '没报') + '）')

const termLine = text.split(/\r?\n/).find((line) => line.startsWith('- **' + TERMS[1] + '（')) || ''
const duplicated = mapLine(text, '- **' + TERMS[1] + '（', (line) => line + '\n' + termLine)
const duplicateProblems = glossaryProblems(duplicated)
check(duplicateProblems.some((p) => p.includes('重复')), '负例：复制出第二条「' + TERMS[1] + '」，检查函数当场判红（' + (duplicateProblems[0] || '没报') + '）')

const noEviction = mapLine(text, '- **按需细节（', (line) => line.replace(/淘汰/g, ''))
const noEvictionProblems = glossaryProblems(noEviction)
check(noEvictionProblems.some((p) => p.includes('按需细节')), '负例：把「按需细节」里的「淘汰」拿掉，检查函数当场判红（' + (noEvictionProblems[0] || '没报') + '）')

console.log(failed ? '\n存在失败 — 术语表词条门禁没通过' : '\n全部通过 — 术语表词条门禁生效')
process.exit(failed ? 1 : 0)