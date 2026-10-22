/**
 * tests/tracker-contract/sections/object-kind.ts — 三个后端对「正文文件头标记」读成同一个对象类型（#1403 T1 读侧统一 / #1408）。
 *
 * 守的东西（不是某一家的读法，是三家的同一份结论）：
 *  - 一张票的正文里，幂等锚占第一行、规格标记 <!-- DSH-ISSUE-KIND: spec --> 占第二行时，
 *    GitHub 房、GitLab 房、本地 Markdown 房归一化后的契约类型都必须判成 spec；
 *  - 判据是「第一个一级标题之前」（共享包 src/shared/issue-file/src/marker.ts 的 markerKindInHeader）：
 *    标记落在首个标题之后（例如接在正文后面）不算数，三家都判 issue；
 *  - 标记必须独占一行：同一行里夹着别的字不算数，三家都判 issue。
 *
 * 为什么把三家放进同一段断言：读侧统一这件事的验收点就是「同一份正文、三个后端同一结论」。
 * 分散到各房自己的门禁里，两个房间各改一半、各绿各的，谁都发现不了结论已经不一致。
 */
import { normalizeIssue as normalizeGithub } from '../../../src/tracker/rooms/github/normalize.ts'
import { normalizeIssue as normalizeGitlab } from '../../../src/tracker/rooms/gitlab/normalize.ts'
import { parseMd } from '../../../src/tracker/rooms/markdown/parse.ts'

/** 单条断言的结果：ok 为判定，detail 留现场。 */
export interface ObjectKindResult {
  name: string
  ok: boolean
  detail: string
}

/**
 * 幂等锚那一行。写法照抄写侧真正落的锚（<!-- DSH-IDEMPOTENCY-KEY: 值 -->），
 * 因为这条判据要证明的正是「锚在最前面时，紧跟其后第二行的规格标记仍然读得出来」。
 */
const ANCHOR = '<!-- DSH-IDEMPOTENCY-KEY: spec-with-anchor -->'
/** 规格标记（与契约 vocabulary.ts 的 SPEC_BODY_MARKER 同一串）。 */
const MARKER = '<!-- DSH-ISSUE-KIND: spec -->'

/** 首行锚、第二行标记，再往下才是七段标题：验收点要的就是这一份。 */
const ANCHORED_SPEC_BODY = [
  ANCHOR,
  MARKER,
  '',
  '# 规格标题',
  '',
  '## 问题陈述',
  '现在改一处规格要翻三个文件。',
  '',
  '## 解决方案',
  '把规格正文按七段切开存。',
].join('\n')

/** 标记落在首个标题之后：不算规格（文件头判据只认标题之前那一段）。 */
const MARKER_AFTER_HEADING = [
  '# 规格标题',
  '',
  '## 问题陈述',
  '一段正文。',
  '',
  MARKER,
].join('\n')

/** 标记与别的字挤在同一行：不算规格（整行精确匹配才作数）。 */
const MARKER_INLINE = [
  ANCHOR,
  '正文里提到 ' + MARKER + ' 这一串字，但它不独占一行。',
  '',
  '# 规格标题',
].join('\n')

/** 三个后端对同一份正文的归一化结果，统一按契约类型读出来。 */
function typeOf(body: string): { github: string; gitlab: string; markdown: string } {
  return {
    github: normalizeGithub({ number: 501, title: '规格', body }).type,
    gitlab: normalizeGitlab({ iid: 501, title: '规格', description: body }).type,
    markdown: parseMd(body, {}).type,
  }
}

export async function run(): Promise<ObjectKindResult[]> {
  const out: ObjectKindResult[] = []
  const P = 'object-kind · '
  const assert = (name: string, cond: unknown, detail?: string): void => {
    out.push({ name: P + name, ok: !!cond, detail: detail || '' })
  }

  const anchored = typeOf(ANCHORED_SPEC_BODY)
  assert('GitHub 房：首行锚、第二行规格标记 → spec', anchored.github === 'spec', 'got=' + anchored.github)
  assert('GitLab 房：首行锚、第二行规格标记 → spec', anchored.gitlab === 'spec', 'got=' + anchored.gitlab)
  assert('本地 Markdown 房：首行锚、第二行规格标记 → spec', anchored.markdown === 'spec', 'got=' + anchored.markdown)
  assert('同一份带首行锚的规格正文，三个后端归一化后的对象类型一致',
    anchored.github === anchored.gitlab && anchored.gitlab === anchored.markdown,
    JSON.stringify(anchored))

  const afterHeading = typeOf(MARKER_AFTER_HEADING)
  assert('标记落在首个标题之后 → 三家都判 issue（GitHub）', afterHeading.github === 'issue', 'got=' + afterHeading.github)
  assert('标记落在首个标题之后 → 三家都判 issue（GitLab）', afterHeading.gitlab === 'issue', 'got=' + afterHeading.gitlab)
  assert('标记落在首个标题之后 → 三家都判 issue（Markdown）', afterHeading.markdown === 'issue', 'got=' + afterHeading.markdown)

  const inline = typeOf(MARKER_INLINE)
  assert('标记不独占一行 → 三家都判 issue（GitHub）', inline.github === 'issue', 'got=' + inline.github)
  assert('标记不独占一行 → 三家都判 issue（GitLab）', inline.gitlab === 'issue', 'got=' + inline.gitlab)
  assert('标记不独占一行 → 三家都判 issue（Markdown）', inline.markdown === 'issue', 'got=' + inline.markdown)

  return out
}

export default { name: 'object-kind', run }
