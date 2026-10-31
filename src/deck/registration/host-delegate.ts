// src/deck/registration/host-delegate.ts —— 宿主代执行电话 wf.deckExec（#758）
// （旧 src/host/platform/deckExec.js，#1019 机械搬家只挪位置不改行为。）
//
// 这一条电话只做一件事：替 agent 层把九个 deck 工具真正跑一次，
// 跑的还是宿主里那同一张表、同一份闸、同一个账本，不另起一本账。
// 行模块能直发这条电话之前，九个工具在对话里只能回诚实占位；
// 有了它，行模块把参数递过来，拿回去的是真结果。
//
// 住在平台区的原因与装配点一样：宿主层的文件之间不许互相引用，
// 平台区是被排除的位置，新电话住这里不新增宿主层引用边。
// 由入口动态引入接线，依赖全部显式传入。
// 日志沿用既有的 host.call / host.call.fail，不新增事件名（#1030 Q6）。
// 工具永不抛：入参不对、表没装好、后端炸了，一律回做不到的三态，不把异常抛给调用方。
// 本文件自己没有超时数字（#1030 Q3 定案）：超时是谁发起谁计时，代执行只是被调的执行点，
// 自己再计时等于两层时钟打架；超时仍由注册侧那份 AGENT_TOOL_TIMEOUT_MS 与行模块三路等待承担
// （2026-10-14 该值由 120 秒放宽到 5 分钟，见票 #1040；这里只报它的名字，不再抄数字，免得跟着漂）。

import { DECK_TOOL_ORDER } from '../tools/tool-order.js'
import { isDeckWriteTool } from '../../refresh/kernel/write-event-detection.js'

/** 未知形状的对象（回包、表、会话线索都先按这形接住，守卫逐格验，不猜）。 */
type UnknownRecord = Record<string, unknown>;
/** 宿主日志口：成功与部分成功记 host.call 带耗时，失败记 host.call.fail 带原因散列。 */
interface DeckExecLogCtx { fire(level: string, event: string, fields: UnknownRecord): void }
/** 代执行电话的依赖：取表函数与日志口，全由宿主入口显式传入。 */
export interface DeckExecDeps { getTable?: unknown; logCtx?: DeckExecLogCtx | null; noteWriteFailure?: ((info: UnknownRecord) => unknown) | null }
/** 做不到的三态：成功、部分成功、做不到都在值里表达，永不抛异常。 */
export interface DeckExecResult { status: string; text: string; reason?: string }
/** 宿主装好的工具表（子集）：这次只要同名 run，拿不到即表没装好。 */
interface DeckExecTable { tools?: UnknownRecord }
/** 把错误原因收成 8 位散列：原因只记指纹不记原文，令牌与路径原文永不落盘。 */
function hash8(text: unknown): string {
  let h = 5381
  const t = String(text || '')
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

function isRecord(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) }

/** 从工具跑完的回包里取出要交回的那一份（三态那一份）；形状不对即后端没按约定回包。 */
function pickValue(back: unknown): DeckExecResult | null {
  const direct = (back as { value?: unknown } | null | undefined) && (back as { value?: unknown }).value !== undefined ? (back as { value?: unknown }).value : back
  const rec = direct as DeckExecResult | null | undefined;
  if (rec && typeof rec.status === 'string' && typeof rec.text === 'string') return rec
  return null
}

function unsupported(tool: unknown, reason: string, text: string): DeckExecResult {
  return { status: 'unsupported', reason: reason, text: text }
}

/**
 * 造宿主代执行电话（依赖全部显式传入：getTable 取宿主装好的那张表，logCtx 落既有日志）。
 * handleDeckExec 收行模块递来的工具名、参数、会话线索，回三态那一份，永不抛。
 */
export function createDeckExec(deps: unknown): { handleDeckExec: (args: unknown) => Promise<DeckExecResult> } {
  const d = (deps || {}) as DeckExecDeps;
  const getTable = d.getTable as (() => Promise<unknown>) | undefined;
  const logCtx = d.logCtx || null
  // #1693：写工具失败记进宿主通知事件库（没注入就静默跳过）。这里不 await、不抛，写失败的历史坏了不能影响代执行的失败回执。
  const noteWriteFailure = typeof d.noteWriteFailure === 'function' ? d.noteWriteFailure : null
  function recordWriteFailure(tool: unknown, failCwd: unknown, status: string, reason: unknown): void {
    if (!noteWriteFailure || !isDeckWriteTool(tool)) return
    try { Promise.resolve(noteWriteFailure({ tool: tool, cwd: failCwd, status: status, reason: String(reason || '') })).catch(function () {}) } catch (e) {}
  }

  function fireOk(ms: number): void {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: 'wf.deckExec', latencyMs: ms, ok: true, kind: 'deck-tool' }) } catch (e) {}
  }
  function fireFail(reason: unknown): void {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'host.call.fail', { method: 'wf.deckExec', kind: 'deck-tool', errorHash: hash8(reason) }) } catch (e2) {}
  }

  async function handleDeckExec(args: unknown): Promise<DeckExecResult> {
    const t0 = Date.now()
    const a = (args && typeof args === 'object' ? args : {}) as UnknownRecord;
    const tool = typeof a.tool === 'string' ? a.tool : ''
    const toolArgs = a.args !== undefined ? a.args : {}
    const hint = (a.session && typeof a.session === 'object' ? a.session : {}) as UnknownRecord;
    const cwd = typeof hint.cwd === 'string' ? hint.cwd.trim() : ''
    const sessionId = typeof hint.sessionId === 'string' ? hint.sessionId : (typeof hint.id === 'string' ? hint.id : '')

    if ((DECK_TOOL_ORDER as readonly string[]).indexOf(tool) < 0) {
      fireFail('bad-tool:' + tool)
      return unsupported(tool || 'deck', 'bad-args', '工具名不对，我没法做：请按十个 deck 工具的名字重调一次。')
    }
    if (toolArgs === null || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
      fireFail('bad-args')
      return unsupported(tool, 'bad-args', '参数不是一个对象，我没法做：请按这个工具的参数说明重调一次。')
    }
    if (!cwd) {
      fireFail('no-session')
      return unsupported(tool, 'no-session-context', '这次没拿到当前会话的工作区目录，所以我不动任何票。请换一个会话再来。')
    }

    let table: unknown = null
    try { table = typeof getTable === 'function' ? await getTable() : null } catch (e) { table = null }
    const tableObj = table as DeckExecTable | null;
    const entry = (tableObj && tableObj.tools ? tableObj.tools[tool] : undefined) as { run?: (exec: unknown, args: unknown) => Promise<unknown> } | undefined;
    if (!table || !tableObj || !tableObj.tools || typeof entry !== 'object' || !entry || typeof entry.run !== 'function') {
      fireFail('no-table')
      return unsupported(tool, 'not-wired', tool + ' 的执行通道还没接通（宿主那张表不在）：请先用面板操作，进展见仓库的 BUG 单。')
    }
    const execLike = { agent: { session: { cwd: cwd, id: sessionId } } }
    let back: unknown = null
    try { back = await entry.run(execLike, toolArgs) } catch (e) {
      fireFail('backend-threw')
      recordWriteFailure(tool, cwd, 'backend-threw', ((e as { message?: unknown } | null)?.message) || e)
      return unsupported(tool, 'backend-threw', '这次没做成（内部执行抛错，已拦下）：' + String(((e as { message?: unknown } | null)?.message) || e).slice(0, 200))
    }
    const value = pickValue(back)
    if (!value) {
      fireFail('backend-threw')
      recordWriteFailure(tool, cwd, 'bad-reply', '没按约定回包')
      return unsupported(tool, 'backend-threw', '这次没做成（工具内部没按约定回包，已拦下），请重试或走面板操作。')
    }
    const ms = Date.now() - t0
    if (value.status === 'ok' || value.status === 'partial') fireOk(ms)
    else { fireFail(String(value.reason || 'unsupported')); recordWriteFailure(tool, cwd, String(value.status || 'unsupported'), value.reason) }
    return value
  }

  return { handleDeckExec: handleDeckExec }
}
