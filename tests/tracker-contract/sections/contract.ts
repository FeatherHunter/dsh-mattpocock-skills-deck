/**
 * tests/tracker-contract/sections/contract.ts — contract.js 形状段（#132 Q2=B）。
 *
 * 第一性原理：OpName 是唯一真源——无 detect（身份=matches+select+describe）、
 * 含 getDependencies、snapshot 不是 op；ERROR_KIND 为新枚举（rate-limit/not-found/conflict）。
 * 每段含「✗ probe」：planted 违规必须被检查器逮住（自证测试会逮，否则本段形同虚设）。
 */

import * as contractMod from '../../../src/tracker/contract/index.js'
import { OPERATIONS, TRACKER_CONTRACT } from '../../../src/tracker/contract/index.js'
import { ERROR_KIND } from '../../../src/tracker/contract/vocabulary.js'

/** 单条 contract 断言的结果：ok 为判定，detail 留现场。 */
export interface ContractAssertResult {
  name: string
  ok: boolean
  detail: string
}

const EXPECTED_OPNAMES: string[] = [
  'preflight', 'list', 'get', 'getDependencies',
  'create', 'close', 'reopen', 'comment',
  'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy',
  'getCurrentUser',
  'initProject',
  'listLabels', 'setLabelColors',   // #627 标签配色两条（精确清单：多一个名字或漏一个名字都判红）
  'counts',                          // #689 后端计数（只回数字不回行；语义见 contract.js 的「计数契约」）
  'listPage',                        // #690 按页取票（创建时间倒序的薄片段；语义见 contract-page.js 的「分页契约」）
  // #1051（2026-10-14）：三条原先挂在单个后端「私有扩展」名下的操作收进契约。
  // 收进来的理由都是同一条：它们的读者在后端之外，后端之外有读者就不是某一家的细节。
  'getRepoPermissions',              // #992 问仓库写权限（push/triage 两个布尔）；原先只是 GitHub 的只读旁路
  'listSubIssues',                   // #691 取一张地图的全部子票；原先挂在 GitHub 的房内扩展上，读者是宿主电话
  'ensureLabelColorsFile',           // #618 往工作区放一份用户可手改的标签配色文件；原先挂在本地 Markdown 的房内扩展上
]
const LEGACY_OPS: string[] = ['detect', 'label', 'subIssue', 'blockedBy', 'syncSnapshot']

/**
 * OpName 检查器：返回违规清单（空 = 合规）。只读入清单，不改动它。
 */
export function opListCheck(list: readonly string[]): string[] {
  const bad: string[] = []
  if (list.includes('detect')) bad.push('detect must not exist (identity = matches+select+describe)')
  for (const op of LEGACY_OPS) if (list.includes(op)) bad.push(`legacy op '${op}' must not exist`)
  if (!list.includes('getDependencies')) bad.push('getDependencies must exist')
  if (list.includes('snapshot')) bad.push("'snapshot' must not be an op (host convenience only)")
  for (const op of list) if (!EXPECTED_OPNAMES.includes(op)) bad.push(`unexpected op '${op}'`)
  return bad
}

export async function run(): Promise<ContractAssertResult[]> {
  const out: ContractAssertResult[] = []
  const P = 'contract · '
  const assert = async (name: string, cond: unknown, detail?: string): Promise<void> => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  await assert('OPERATIONS 与定版 OpName 完全一致',
    JSON.stringify(OPERATIONS) === JSON.stringify(EXPECTED_OPNAMES),
    'got=' + JSON.stringify(OPERATIONS))
  await assert('无 detect/legacy/snapshot 混入', opListCheck(OPERATIONS).length === 0, opListCheck(OPERATIONS).join('; '))
  await assert('TRACKER_CONTRACT.operations 与 OPERATIONS 同一引用', TRACKER_CONTRACT.operations === OPERATIONS)
  await assert('OPERATIONS 冻结', Object.isFrozen(OPERATIONS))

  const keys = Object.keys(contractMod)
  await assert('模块导出不泄露 detect/旧检测面', !keys.includes('detect'), keys.join(','))

  await assert('ERROR_KIND 新枚举值（rate-limit/not-found/conflict）',
    ERROR_KIND.RATELIMIT === 'rate-limit' && ERROR_KIND.NOTFOUND === 'not-found' && ERROR_KIND.CONFLICT === 'conflict',
    JSON.stringify(ERROR_KIND))
  await assert('TRACKER_CONTRACT.errorKind 含 conflict', TRACKER_CONTRACT.errorKind.CONFLICT === 'conflict')

  // ✗ probe：planted 违规必须被 opListCheck 逮住
  await assert('✗ probe: planted detect+legacy 被逮', opListCheck(['detect', 'label', 'list', 'getDependencies']).length > 0, 'checker missed detect/label')
  await assert('✗ probe: planted snapshot-as-op 被逮', opListCheck(['snapshot', 'list']).length > 0, 'checker missed snapshot')
  await assert('✗ probe: planted 意外 op 被逮', opListCheck(['list', 'dance']).length > 0, 'checker missed unknown op')
  await assert('✗ probe: 缺 getDependencies 被逮', opListCheck(['list', 'get']).length > 0, 'checker missed missing getDependencies')
  // #627：标签配色两条做了手写的假身也不算数——清单以 OPERATIONS 为准，多一个少一个都在上面那条比对里判红。
  await assert('✗ probe: 标签配色之外的自造操作名被逮', opListCheck(['list', 'getDependencies', 'setLabelColor']).length > 0, 'checker missed a near-miss op name')

  return out
}

export default { name: 'contract', run }
