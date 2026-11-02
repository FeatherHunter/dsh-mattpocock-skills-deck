// src/deck/rules/triage-state.ts —— 「一张票同一时刻只有一枚 triage 状态」的纯判断（#1832）
//
// 这个文件回答三个问题，答案都只有一处：
//   一、这个名字是不是 triage 状态（五选一：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）；
//   二、这批标签里出现了哪几枚 triage 状态（按出现顺序、大小写不敏感去重，保留第一次出现的拼写）；
//   三、一次给两枚以上时，那句拒绝的话怎么写（建票与改标签共用，免得两处文案各说各的）。
//
// 状态名单是数据，住在契约层 src/tracker/contract/triage-states.ts：本地 Markdown 房从配置里读同一份，
// deck 与各后端也认同一套词。判断是行为，不能住契约层（那一层只许类型与数据），所以收在这里。
// 本文件不 import 任何后端房间：依赖图不许 deck 摸 rooms，所以词表真源放契约层而不是房间侧。
import { TRIAGE_STATE_LABELS } from '../../tracker/contract/triage-states.js'
import { labelNames } from './label-names.js'

/** 五枚 triage 状态拼成一句人话用的菜单，拒绝文案里反复用，只写这一处（不对外导出，只用来拼文案）。 */
const TRIAGE_STATE_MENU: string = TRIAGE_STATE_LABELS.join(' / ')

/** 这枚标签是不是 triage 状态。大小写不敏感：GitHub 的标签名不分大小写，`NEEDS-TRIAGE` 算同一枚。 */
export function isTriageStateLabel(one: unknown): boolean {
  const names = labelNames([one])
  if (!names.length) return false
  const name = names[0].toLowerCase()
  for (let i = 0; i < TRIAGE_STATE_LABELS.length; i += 1) {
    if (TRIAGE_STATE_LABELS[i].toLowerCase() === name) return true
  }
  return false
}

/**
 * 这批标签里出现的 triage 状态：按出现顺序、大小写不敏感去重，返回第一次出现的原拼写。
 * 重复给同一枚（例如 `needs-triage` 与 `NEEDS-TRIAGE`）只算一枚 —— 数的是「几枚状态」，不是「几行字」。
 */
export function triageStatesIn(labels: unknown): string[] {
  const list = labelNames(labels)
  const out: string[] = []
  for (const one of list) {
    if (!isTriageStateLabel(one)) continue
    if (out.map((seen) => seen.toLowerCase()).indexOf(one.toLowerCase()) >= 0) continue
    out.push(one)
  }
  return out
}

/**
 * 一次给了两枚以上 triage 状态时的拒绝原因；不超过一枚时回空串。
 * field 是参数名（`labels` / `addLabels`），让回执能点到具体那一格参数。
 * 口径：状态是「切换」不是「叠加」—— 要换状态就只带要切到的那一枚，旧的那枚由工具自动摘掉。
 */
export function triageStateProblem(labels: unknown, field: string): string {
  const states = triageStatesIn(labels)
  if (states.length <= 1) return ''
  return field + ' 里同时给了 ' + states.length + ' 枚 triage 状态标签（' + states.join('、') + '）：'
    + '一张票同一时刻只能有一枚 triage 状态（' + TRIAGE_STATE_MENU + ' 五选一），请只留一枚 —— '
    + '改状态是替换：带要切到的那一枚，旧状态由工具自动摘掉。'
}
