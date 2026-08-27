/**
 * tests/tracker-contract/sections/contract.js — contract.js 形状段（#132 Q2=B）。
 *
 * 第一性原理：OpName 是唯一真源——无 detect（身份=matches+select+describe）、
 * 含 getDependencies、snapshot 不是 op；ERROR_KIND 为新枚举（rate-limit/not-found/conflict）。
 * 每段含「✗ probe」：planted 违规必须被检查器逮住（自证测试会逮，否则本段形同虚设）。
 */

import * as contractMod from '../../../src/host/tracker/contract.js'
import { OPERATIONS, TRACKER_CONTRACT } from '../../../src/host/tracker/contract.js'
import { ERROR_KIND } from '../../../src/shared/tracker/constants.js'

const EXPECTED_OPNAMES = [
  'preflight', 'list', 'get', 'getDependencies',
  'create', 'close', 'reopen', 'comment',
  'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy',
  'getCurrentUser',
  'initProject',
]
const LEGACY_OPS = ['detect', 'label', 'subIssue', 'blockedBy', 'syncSnapshot']

/**
 * OpName 检查器：返回违规清单（空 = 合规）。
 * @param {string[]} list
 * @returns {string[]}
 */
export function opListCheck(list) {
  const bad = []
  if (list.includes('detect')) bad.push('detect must not exist (identity = matches+select+describe)')
  for (const op of LEGACY_OPS) if (list.includes(op)) bad.push(`legacy op '${op}' must not exist`)
  if (!list.includes('getDependencies')) bad.push('getDependencies must exist')
  if (list.includes('snapshot')) bad.push("'snapshot' must not be an op (host convenience only)")
  for (const op of list) if (!EXPECTED_OPNAMES.includes(op)) bad.push(`unexpected op '${op}'`)
  return bad
}

export async function run() {
  const out = []
  const P = 'contract · '
  const assert = async (name, cond, detail) => {
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

  return out
}

export default { name: 'contract', run }