// src/host/platform/deckExec.js —— 宿主代执行电话 wf.deckExec（#758）
//
// 这一条电话只做一件事：替 agent 层把七个 deck 工具真正跑一次，
// 跑的还是宿主里那同一张表、同一份闸、同一个账本，不另起一本账。
// 行模块能直发这条电话之前，七个工具在对话里只能回诚实占位；
// 有了它，行模块把参数递过来，拿回去的是真结果。
//
// 住在平台区的原因与装配点一样：宿主层的文件之间不许互相引用，
// 平台区是被排除的位置，新电话住这里不新增宿主层引用边。
// 由入口动态引入接线，依赖全部显式传入。
// 日志沿用既有的 host.call / host.call.fail，不新增事件名。
// 工具永不抛：入参不对、表没装好、后端炸了，一律回做不到的三态，不把异常抛给调用方。

import { DECK_TOOL_ORDER } from '../../shared/deck-tools/plan.js'

function hash8(text) {
  let h = 5381
  const t = String(text || '')
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

function isRecord(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

/** 从工具跑完的回包里取出要交回的那一份（三态那一份）。 */
function pickValue(back) {
  const direct = back && back.value !== undefined ? back.value : back
  if (direct && typeof direct.status === 'string' && typeof direct.text === 'string') return direct
  return null
}

function unsupported(tool, reason, text) {
  return { status: 'unsupported', reason: reason, text: text }
}

export function createDeckExec(deps) {
  const d = deps || {}
  const getTable = d.getTable
  const logCtx = d.logCtx || null

  function fireOk(ms) {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: 'wf.deckExec', latencyMs: ms, ok: true, kind: 'deck-tool' }) } catch (e) {}
  }
  function fireFail(reason) {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'host.call.fail', { method: 'wf.deckExec', kind: 'deck-tool', errorHash: hash8(reason) }) } catch (e2) {}
  }

  async function handleDeckExec(args) {
    const t0 = Date.now()
    const a = (args && typeof args === 'object') ? args : {}
    const tool = typeof a.tool === 'string' ? a.tool : ''
    const toolArgs = a.args !== undefined ? a.args : {}
    const hint = (a.session && typeof a.session === 'object') ? a.session : {}
    const cwd = typeof hint.cwd === 'string' ? hint.cwd.trim() : ''
    const sessionId = typeof hint.sessionId === 'string' ? hint.sessionId : (typeof hint.id === 'string' ? hint.id : '')

    if (DECK_TOOL_ORDER.indexOf(tool) < 0) {
      fireFail('bad-tool:' + tool)
      return unsupported(tool || 'deck', 'bad-args', '工具名不对，我没法做：请按七个 deck 工具的名字重调一次。')
    }
    if (toolArgs === null || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
      fireFail('bad-args')
      return unsupported(tool, 'bad-args', '参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。')
    }
    if (!cwd) {
      fireFail('no-session')
      return unsupported(tool, 'no-session-context', '这次没拿到当前会话的工作区目录，所以我不动任何票。请换一个会话再来。')
    }

    let table = null
    try { table = typeof getTable === 'function' ? await getTable() : null } catch (e) { table = null }
    if (!table || !table.tools || typeof table.tools[tool] !== 'object' || typeof table.tools[tool].run !== 'function') {
      fireFail('no-table')
      return unsupported(tool, 'not-wired', tool + ' 的执行通道还没接通（宿主那张表不在）：请先用面板操作，进展见仓库的 BUG 单。')
    }

    const execLike = { agent: { session: { cwd: cwd, id: sessionId } } }
    let back = null
    try { back = await table.tools[tool].run(execLike, toolArgs) } catch (e) {
      fireFail('backend-threw')
      return unsupported(tool, 'backend-threw', '这次没做成（内部执行抛错，已拦下）：' + String((e && e.message) || e).slice(0, 200))
    }
    const value = pickValue(back)
    if (!value) {
      fireFail('backend-threw')
      return unsupported(tool, 'backend-threw', '这次没做成（工具内部没按约定回包，已拦下），请重试或走面板操作。')
    }
    const ms = Date.now() - t0
    if (value.status === 'ok' || value.status === 'partial') fireOk(ms)
    else fireFail(String(value.reason || 'unsupported'))
    return value
  }

  return { handleDeckExec: handleDeckExec }
}
