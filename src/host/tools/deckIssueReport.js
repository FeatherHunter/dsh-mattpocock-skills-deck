// src/host/tools/deckIssueReport.js —— deck_issue_report（#775 落地）
//
// AI 主动上报自己在办哪张票：票号必填、可选带一句备注；写入同一份处理链并去重，
// 与被动推断互补；在原来展示处理链的地方能看到；三后端诚实失败。
//
// 薄壳四条照旧（shell.js）：过闸、走注册表选后端、只从会话取工作区、永不抛。
// 链写入同一份 sessionTickets（wiring.js 经 chainNote 递进来），动作类别 report，
// 去重与留存沿用 chain.js 的 mergeEntries（每会话 20 张、时间倒序、去重）。
// 票存在性经 tracker.get 校验一遍：读不到就诚实失败，不记链。
// 本地后端多工作单元时用 effortId 指到那一个目录（根目录的不填）；远端后端忽略它。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { sessionContextOfAsync } from '../../shared/deck-tools/session-resolve.js'
import { withCallScope } from '../../shared/deck-tools/call-scope.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

function numOpt(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
function withCap(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).then(function (v) { return { ok: true, value: v } }, function () { return { ok: false } }),
    new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
const SANDBOX_TIMEOUT_MS = 5000
const HOOK_TIMEOUT_MS = 5000
// 执行层失败与后端诚实失败的分界（见 deckIssueCreate.js 同名注释）：前者抛给壳走
// backend-threw（可重试），后者走 BACKEND_UNSUPPORTED。钳制只管超时，不改判。
const TRANSPORT_KINDS = ['backend-threw', 'timeout', 'aborted', 'over-budget']
function transportMessage(result) {
  const e = result && result.error
  if (e && TRANSPORT_KINDS.indexOf(e.kind) >= 0) return String(e.message || '执行层没回来')
  return null
}

export const definition = {
  name: 'deck_issue_report',
  description: '同属插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；先调 deck_context 确认 workspace 与 backend。开始处理、切换或完成一个 ISSUE 时都必须调用：开始前报一次，关闭时再报一次，这条是必选。职责划分：deck_issue_patch 负责变更 issue 内容，deck_issue_report 负责上报处理关系；用前者关闭 issue 不等价于已完成上报。key 填你要上报的 ISSUE 编号；只有本地后端需要填 effortId，填票所在目录名，根目录不填。有没有记上、记在哪里，看返回里的结果。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '你要上报的那个 ISSUE 的编号' },
      note: { type: 'string', description: '可选带一句备注（只回显，不进链）' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['key'],
    additionalProperties: false,
  },
}

function normKey(raw) {
  const t = String(raw === undefined || raw === null ? '' : raw).trim().replace(/^#/, '')
  if (!/^\d{1,10}$/.test(t)) return ''
  return t.replace(/^0+(?=\d)/, '')
}

function normEffort(raw) {
  if (raw === undefined || raw === null) return ''
  return String(raw).trim()
}

export function createDeckIssueReport(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const a = args || {}
    const key = normKey(a.key)
    const est = shell.estimateFor('deck_issue_report', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    if (!s.ok) return shell.unsupported('deck_issue_report', s.reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_issue_report', REFUSAL_REASONS.BAD_ARGS, '要上报哪一张票：把票号写在 key 里（例如 775）。', { cost: { estimated: est } })
    const effortId = normEffort(a.effortId)
    const note = typeof a.note === 'string' ? a.note.trim().slice(0, 200) : ''

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_report', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    if (effortId) repo.effortId = effortId
    const callerSignal = (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : undefined
    let sandbox = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_issue_report', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox, signal: callerSignal }, async (c) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), now: (typeof d.now === 'function') ? d.now : Date.now })
      const t = sc.tracker
      const opCtx = sc.opCtx
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      if (note) notes.push('备注只回显，不进链（链上每条只留票键、时间与动作类别）。')
      const got = typeof t.get === 'function' ? await t.get(repo, key, { comments: { first: 0 } }, opCtx) : null
      const gotTransport = transportMessage(got)
      if (gotTransport) throw new Error(gotTransport)
      if (!got || got.ok !== true) {
        const msg = String((got && got.error && got.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '这张票没上报（票 ' + key + ' 没读回来，后端原话：' + msg + '）。',
            data: { key: key, backendId: pick.backendId, effortId: effortId, error: { kind: String((got && got.error && got.error.kind) || ''), message: msg } },
            notes: notes,
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const issue = got.data || {}
      let chain = { recorded: false, reason: '', count: 0 }
      try {
        if (typeof d.chainNote === 'function') {
          const chainEffort = (issue && typeof issue.effortId === 'string' && issue.effortId) ? String(issue.effortId) : effortId
          // 记链加竞速：超时按没记进走老路（被动推断仍会记），与既有 not-recorded 同形。
          const raced = await withCap(d.chainNote({
            sessionId: s.sessionId, rootKey: s.cwd, backend: pick.backendId,
            tool: 'deck_issue_report', source: 'tool-args', tier: 'write-confirmed',
            reason: 'tool.deck-write', verb: 'report', ticketKey: key, effortId: chainEffort, args: { key: key },
          }), HOOK_TIMEOUT_MS)
          const r = (raced && raced.ok === true) ? raced.value : null
          if (r && typeof r === 'object') chain = { recorded: !!r.recorded, reason: String(r.reason || ''), count: Number(r.count || 0) }
          else chain = { recorded: false, reason: (raced && raced.timedOut) ? 'chain-note-timeout' : 'no-chain-note', count: 0 }
        } else {
          chain = { recorded: false, reason: 'no-chain-note', count: 0 }
        }
      } catch (e) { chain = { recorded: false, reason: 'chain-note-threw', count: 0 } }
      if (!chain.recorded) notes.push('这次没显式记进链（' + (chain.reason || '没给记链的口子') + '）：被动推断那一路仍会按参数里的票号记一次，去重后同一张票只留一条。')
      const title = typeof issue.title === 'string' ? issue.title.slice(0, 80) : ''
      return {
        value: {
          status: DECK_STATUS.OK,
          text: '票 ' + key + ' 已上报（' + (title || '没取到标题') + '）' + (note ? '：' + note.slice(0, 80) : '') + '。' + (chain.recorded ? '链上能看到（这格现在 ' + chain.count + ' 张）。' : '链上看不看得到以展示面读数为准。'),
          data: {
            key: key, title: title, state: issue.state || '', url: issue.url || '',
            backendId: pick.backendId, effortId: effortId || (issue.effortId !== undefined ? issue.effortId : ''),
            chain: chain, note: note,
          },
          notes: notes,
          touched: [],
        },
        claimed: { requests: 1, points: 3 },
      }
    })
  }

  return { definition: definition, run: run }
}
