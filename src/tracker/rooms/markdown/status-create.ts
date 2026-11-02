// status-create.ts —— 建票时「Status 行该写什么」的判定（#1790 缺陷 A）。
//
// 为什么单独一层：状态值的来源有四处（正文里写的、调用方给的、标签里唯一的一枚 triage、票型默认值），
// 判定顺序只有这里一份；create-render.ts 只负责把结果写进模板，不自己挑值。
// 不能改的约定：
//   1. 标签里出现两枚以上 triage 状态时直接拒绝（RenderStatusConflict），不能替调用方挑一个静默丢标签。
//   2. 票型默认值的唯一来源是 format/original-skills.yaml 与 status.ts，这里不写字面量。
//   3. 普通票（plain-issue）没有默认状态，返回空串：渲染时连可见 Status 行都不写。
import { defaultStatusOf, isTriageStatus, normalizeStatus } from './status.js'
import type { IssueFileKind } from './status.js'
import type { CreateView, ObjectShape, OriginalKind } from './create-render.js'

/** 建票输入里的 triage 标签超过一枚：可见 Status 行只能写一个状态，不能替调用方挑一个悄悄丢掉其余。 */
export class RenderStatusConflict extends Error {
  readonly kind = 'parse'
  constructor(message: string) {
    super(message)
    this.name = 'RenderStatusConflict'
  }
}

/** 票型对应的状态默认值：容器（规格/地图）读模板默认；四种票按 fileKind 取 status.ts 的同一份默认值。
 *  plain-issue 没有默认值（普通票可以没有状态），返回空串，渲染时连可见 Status 行都不写。 */
function defaultStatusFor(kind: OriginalKind, shape: ObjectShape): string {
  if (kind === 'spec' || kind === 'map') return String((shape.status && shape.status.default) || '').trim()
  if (kind === 'issue') return ''
  const fileKind: IssueFileKind = kind === 'bug' ? 'bug' : kind
  return String(defaultStatusOf(fileKind) || '')
}

/**
 * 状态值的唯一来源（#1507 / #1790 缺陷 A）。顺序：正文里写的 > 调用方给的 > 标签里唯一的一枚 triage > 票型默认值。
 *
 * 为什么要兜到默认值：读侧（parse.ts）把「没有状态」读成 open，也就是未开始；一张刚建出来的票
 * 不该一出生就是「未开始」。但普通票是例外：它本来就可以没有状态，默认值留空，渲染时不写
 * `**Status:**` 行（写一行空的读回来仍然等于没有状态，只是多一行噪音）。
 */
export function statusFor(kind: OriginalKind, shape: ObjectShape, input: CreateView, fromBody: string, labels: readonly string[] = []): string {
  const bodyStatus = String(fromBody || '').trim()
  if (bodyStatus) return bodyStatus
  const given = String(input.status == null ? '' : input.status).trim()
  if (given) return given
  const triage: string[] = []
  for (const label of labels) {
    const status = normalizeStatus(label)
    if (status && isTriageStatus(status) && triage.indexOf(status) < 0) triage.push(status)
  }
  if (triage.length > 1) {
    throw new RenderStatusConflict('这次给了多枚 triage 状态标签（' + triage.join('、') + '）：可见 Status 行只能写一个状态，请只留一枚，或改用 status 明确指定。')
  }
  if (triage.length === 1) return triage[0]
  return defaultStatusFor(kind, shape)
}
