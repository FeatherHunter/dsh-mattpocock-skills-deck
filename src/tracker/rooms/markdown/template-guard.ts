// template-guard.ts —— 新建一张票时，正文不能带远端跟踪器的四段模板（#1507，父规格 #1506）。
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
// 拒绝时不做自动归一化：不把 ## Parent 改写成 DSH-PARENT，也不丢正文，原文原样退回调用方，
// 改了就等于替人猜「他其实想写的是哪一段」，猜错了更难查。
// 规格（spec）与地图（map）不走这条判据：它们是容器，原文模板本来就是另外几段。
// 建票（本票 #1507）与整份改写（#1509）共用本文件，不要在别处再写第二份判据。
//
// 本文件是纯计算：只收正文文本，不读写文件、不看时钟。

import type { OriginalKind } from './create-render.js'

/** 远端四段模板的段落名，按远端原文的大小写写一次；比对时两边都转小写。 */
const REMOTE_SECTIONS: readonly string[] = ['Parent', 'What to build', 'Acceptance criteria', 'Blocked by']

/** 围栏行：行首（可带空白）三个以上反引号或波浪号。这里只关心「在不在围栏里」，
 *  不解析围栏后面的语言名，也不要求关闭围栏与打开围栏等长——与同一渲染管线的
 *  firstHeadingOutsideFence（create-render.ts）用同一条简化口径，两处判据不许各说各话。 */
const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})/

/** 二级标题行：最多三个前导空格（CommonMark 的写法），`##` 之后至少一个空白。 */
const HEADING_LINE = /^[ \t]{0,3}##[ \t]+(.*?)[ \t]*$/

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
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = HEADING_LINE.exec(line)
    if (!heading) continue
    const title = heading[1].replace(/\s+/g, ' ').trim().toLowerCase()
    const hit = REMOTE_SECTIONS.find((name) => name.toLowerCase() === title)
    if (hit && found.indexOf(hit) < 0) found.push(hit)
  }
  return found
}

/**
 * 给这次新建请求的拒绝语；这种物件不受这条判据管（规格、地图）或没发现违规段落时返回空串。
 *
 * 拒绝语固定两句话：第一句说错在哪几段（原文的段名，带 `##` 前缀，人能直接对照自己的正文），
 * 第二句说本地模板长什么样。地图子票的本地形状与实施票不同，所以单独一句，免得给错模板。
 */
export function remoteTemplateRefusalFor(kind: OriginalKind, sections: readonly string[]): string {
  if (!sections.length) return ''
  const guarded = kind === 'spec-ticket' || kind === 'issue' || kind === 'bug' || kind === 'map-ticket'
  if (!guarded) return ''
  const quoted = sections.map((name) => '「## ' + name + '」').join('、')
  if (kind === 'map-ticket') {
    return '正文里有远端跟踪器的模板段落' + quoted + '，本地地图子票不收这种写法。'
      + '本地地图子票要写成「# NN: 问题」，标题下用「Type: …」「Status: …」「Blocked by: …」记类型与关系，正文只有一段「## Question」；'
      + '如果这些段只是写在 ``` 代码块里举例，不算错。'
  }
  return '正文里有远端跟踪器的模板段落' + quoted + '，本地 Markdown 票不收这种写法。'
    + '本地票要写成「# NN: 标题」，下面依次写「**What to build:** …」「**Blocked by:** …」「**Status:** …」，验收项写成「- [ ] …」；'
    + '如果这些段只是写在 ``` 代码块里举例，不算错。'
}
