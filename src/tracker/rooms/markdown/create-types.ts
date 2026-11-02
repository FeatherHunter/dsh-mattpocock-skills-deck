// src/tracker/rooms/markdown/create-types.ts —— 建票渲染的三个纯类型（#1790 缺陷 A 从 create-render.ts 拆出）
//
// 为什么单独一份：status-create.ts 判定「建票时 Status 行写什么」要用 CreateView / ObjectShape / OriginalKind，
// 而 create-render.ts 又要用 status-create.ts 的 statusFor。两边互相 import（import type 也算边）
// 会被依赖图门禁判成循环。纯类型搬到本文件后，依赖变成单向的 create-render → status-create → create-types；
// create-render.ts 仍原样再导出这三个类型，原来从它 import 的文件（template-guard / map-render /
// create-layout）不必改一行。
//
// 本文件只放类型，不放运行时代码：类型没有依赖方向的问题，住哪儿都不会改变谁加载谁。
import type { CreateInput, LabelInput } from '../../contract/inputs.js'

/** 建票落盘的六种原文对象。规格与实施票/普通票先落（#1486）；探索地图与地图子票后来接上（#1487）。 */
export type OriginalKind = 'spec' | 'spec-ticket' | 'issue' | 'bug' | 'map' | 'map-ticket'

/** 建票输入的实际形状：契约只收小写子集，运行时还会带大小写写法、状态行与阻塞行。 */
export type CreateView = Omit<CreateInput, 'labels'> & {
  labels?: LabelInput[] | string
  Type?: unknown
  Labels?: unknown
  status?: unknown
  blockedBy?: unknown
  kind?: unknown
  typeLine?: unknown
}

/**
 * 原文模板里与建票有关的字段。模板文字只从 generated.ts 的 MD_FORMAT 取，
 * 代码里不再抄一份标题形状与字段行；模板改了这里自动跟着改。
 */
export interface ObjectShape {
  /** 可见一级标题形状：只有票形（实施票、地图子票）有；规格与地图的原文模板没有标题行。 */
  'title-shape'?: string
  /** 规格与地图的标题落在哪条文件头隐藏注释里（原文模板没有标题行，标题是 tracker 的 issue 上的）。 */
  'title-comment'?: string
  sections?: readonly string[]
  fields?: readonly { label: string; 'line-shape': string }[]
  acceptance?: string
  status?: { 'visible-line'?: boolean; 'hidden-comment'?: string; default?: string }
  reuse?: string
  /** 地图子票的正文只有一个问题段，段名从模板取（原文是 Question）。 */
  'body-section'?: string
  /** 地图子票标题下要写的裸行：Type / Status / Blocked by；值位只出现在 line-shape 里。 */
  'top-lines'?: readonly { label: string; values?: readonly string[]; 'line-shape'?: string }[]
}
