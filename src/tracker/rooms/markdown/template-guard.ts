// template-guard.ts —— 建票与整份改写正文时，正文不能带远端跟踪器的四段模板（#1507 建票、#1509 改写，父规格 #1506）。
//
// 为什么要有这一件：本地 Markdown 后端按随包原文（to-tickets、wayfinder）的形状落盘。
// 人从 GitHub / Linear 复制过来的正文常带着远端那套二级标题：
//   ## Parent、## What to build、## Acceptance criteria、## Blocked by
// 直接写进去，一张票里就会同时存在两套模板，读的人和读的工具都分不清哪套算数。
// 所以新建时当场拒绝，并用大白话告诉人本地该写成什么样。
//
// 判据只有一条：正文里出现这四个二级标题（比较时忽略大小写与多余空白），并且不在代码围栏里。
// 代码围栏里举例说明「远端模板长什么样」是正文内容，不是这次要写的模板，不能判成错——
// 文档与说明里经常要贴反例，把反例判成错会让人没法写文档。
// 「哪一行算围栏、哪一行算二级标题」不在这里定义，统一从 markdown-scan.ts 取，
// 免得同一条渲染管线里出现两份各说各话的扫描判据。
// 拒绝时不做自动归一化：不把 ## Parent 改写成 DSH-PARENT，也不丢正文，原文原样退回调用方，
// 改了就等于替人猜「他其实想写的是哪一段」，猜错了更难查。
// 规格（spec）与地图（map）不走这条判据：它们是容器，原文模板本来就是另外几段。
// 建票（本票 #1507）与整份改写（#1509）共用本文件，不要在别处再写第二份判据。
//
// 本文件是纯计算：只收正文文本，不读写文件、不看时钟。

import type { OriginalKind } from './create-render.js'
import type { TicketForm } from './original-fields.js'
import { headingTwoText, isFenceLine } from './markdown-scan.js'
// 本地模板长什么样，字段名一律从原文派生表里取，不在本文件手抄一遍：
// 「What to build / Blocked by / Status」的真源是 format/field-values.ts 的 IMPL_TICKET_FIELD_LABELS，
// 地图子票标题下那三行（Type / Status / Blocked by）的真源是同文件的 WAYFINDER_TOP_LINE_LABELS。
import { IMPL_TICKET_FIELD_LABELS, WAYFINDER_TOP_LINE_LABELS } from './format/field-values.js'

/** 远端四段模板的段落名，按远端原文的大小写写一次；比对时两边都转小写。 */
const REMOTE_SECTIONS: readonly string[] = ['Parent', 'What to build', 'Acceptance criteria', 'Blocked by']

/** 两种本地模板拒绝语的共同结尾：围栏里贴反例不算错。 */
const FENCE_EXAMPLE_NOTE = '如果这些段只是写在 ``` 代码块里举例，不算错。'

/**
 * 正文里出现的远端四段模板标题，按出现顺序去重；没有就返回空数组。
 * `body` 不是字符串（没给正文、给了别的东西）时按「没有正文」处理，返回空数组，不抛错。
 */
export function remoteTemplateSections(body: unknown): string[] {
  const text = typeof body === 'string' ? body : ''
  const found: string[] = []
  let inFence = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (isFenceLine(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const title = headingTwoText(line).replace(/\s+/g, ' ').trim().toLowerCase()
    if (!title) continue
    const hit = REMOTE_SECTIONS.find((name) => name.toLowerCase() === title)
    if (hit && found.indexOf(hit) < 0) found.push(hit)
  }
  return found
}

/**
 * 实施票/普通票/旧布局票该说哪句话：本地模板是 `# NN: 标题` + 三条加粗字段行 + `- [ ]` 验收项。
 * 字段行名字从 IMPL_TICKET_FIELD_LABELS 派生——原文改了字段名，这句人话跟着变，不会各说各话。
 */
function implTicketRefusal(quoted: string): string {
  const fields = IMPL_TICKET_FIELD_LABELS.map((label) => '「**' + label + ':** …」').join('')
  return '正文里有远端跟踪器的模板段落' + quoted + '，本地 Markdown 票不收这种写法。'
    + '本地票要写成「# NN: 标题」，下面依次写' + fields + '，验收项写成「- [ ] …」；'
    + FENCE_EXAMPLE_NOTE
}

/**
 * 地图子票该说哪句话：本地模板是 `# NN: 问题` + 标题下三条裸行 + 一段 `## Question`。
 * 三条裸行名字从 WAYFINDER_TOP_LINE_LABELS 派生，理由同上。
 */
function mapTicketRefusal(quoted: string): string {
  const lines = WAYFINDER_TOP_LINE_LABELS.map((label) => '「' + label + ': …」').join('')
  return '正文里有远端跟踪器的模板段落' + quoted + '，本地地图子票不收这种写法。'
    + '本地地图子票要写成「# NN: 问题」，标题下用' + lines + '记类型与关系，正文只有一段「## Question」；'
    + FENCE_EXAMPLE_NOTE
}

/**
 * 哪些物件受这条判据管，只有这一张表。
 * 不在表里的种类（规格 spec、地图 map 两个容器）一律放行——它们的原文模板本来就是另外几段，
 * 拿「本地票模板」去要求容器，等于用错的尺子量。新增受管种类改这里，不要在别处再写第二个 if。
 */
const REFUSAL_BUILDERS: Record<string, ((quoted: string) => string) | undefined> = {
  'spec-ticket': implTicketRefusal,
  issue: implTicketRefusal,
  bug: implTicketRefusal,
  'map-ticket': mapTicketRefusal,
}

/**
 * 给这次请求的拒绝语（新建与整份改写共用）；这种物件不受这条判据管（规格、地图）或没发现违规段落时返回空串。
 *
 * 拒绝语固定两句话：第一句说错在哪几段（原文的段名，带 `##` 前缀，人能直接对照自己的正文），
 * 第二句说本地模板长什么样。地图子票的本地形状与实施票不同，所以按种类换第二句，免得给错模板。
 */
export function remoteTemplateRefusalFor(kind: OriginalKind, sections: readonly string[]): string {
  if (!sections.length) return ''
  const build = REFUSAL_BUILDERS[kind]
  if (!build) return ''
  return build(sections.map((name) => '「## ' + name + '」').join('、'))
}

/**
 * 整份正文替换（#1509）该说哪一套本地模板：按盘上这张票的形状挑，分派规则也只放在本文件。
 *
 * 为什么要多这一个入口：新建时「这张票是什么」来自请求参数（originalKindOf），改写时来自盘上那份文件
 * （00 号容器的 spec/map，或票文件自己的 TicketForm）。两条路的输入不同，但「哪类文件配哪段话」
 * 是同一件事；让改写路径自己 if/else 挑文案，就等于在写路径里又抄了一份对应关系。
 *
 * 分派口径（与 #1506 的实现决策一致）：
 *  - 规格（spec）与地图（map）是容器，正文模板本来就是另外几段，不受这条判据管，返回空串；
 *  - 地图子票（原文问句形态）用问句模板那一句：`# NN: 问题` + `Type:` 行 + 一段 `## Question`；
 *  - 其余票（实施票、普通票、旧布局票）用本地票模板那一句：`# NN: 标题` + 三条加粗字段行 + `- [ ]`。
 *    旧布局票也走这一句：它没有另一套本地模板，重写时正好把人引到现在这一套；这里不猜兼容。
 */
export function remoteTemplateRefusalForLocalFile(
  container: 'spec' | 'map' | null | undefined,
  form: TicketForm,
  sections: readonly string[],
): string {
  if (!sections.length) return ''
  // 容器不算「一张票」，交给同一个函数按它自己的档位判（spec/map 在 REFUSAL_BUILDERS 里没有条目，
  // 于是返回空串），这样「哪些形状受管」依旧只有一处判断。
  if (container === 'spec') return remoteTemplateRefusalFor('spec', sections)
  if (container === 'map') return remoteTemplateRefusalFor('map', sections)
  return remoteTemplateRefusalFor(form === 'map-ticket' ? 'map-ticket' : 'issue', sections)
}
