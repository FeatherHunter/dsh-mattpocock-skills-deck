/**
 * client/kernel/actions.js — 动作分发器（UI 层执行器，契约层形状的唯一消费者）。
 *
 * 第一性原理（#217 定版）：
 *  - 契约层定义「动作是什么」（type+payload 形状，见 src/shared/tracker/chain.js ACTION_TYPE）；
 *    UI 层定义「动作怎么做」（本文件的 dispatcher）；
 *    后端层声明「这个检查项挂哪个动作」（检查项 onPass/onFail.actions）。
 *  - 执行器归属 UI：inject() / window.open / host.call / 表单渲染均为 client 能力（UI 明确知道自己有哪些功能）。
 *  - 诚实失败：遇枚举外 type → 返回 {ok:false, error:{kind:'unsupported'}}，不静默吞；
 *    动作不承诺修复，检查才判定状态——动作回调不直接改链状态，必须走重求值（refresh）。
 */

import { ACTION_TYPE } from '../../shared/tracker/chain.js'

/**
 * @typedef {Object} ActionContext
 * @property {(text:string, opts?:Object)=>void} inject 注入提示词到输入框（宿主或编辑器）
 * @property {(url:string, target?:string)=>void} openUrl 打开链接
 * @property {(method:string, params?:unknown)=>Promise<any>} hostCall host RPC（wf.*）
 * @property {(schema:import('../../shared/tracker/chain.js').FieldSchema[], onSubmit:(values:Record<string,unknown>)=>void)=>void} renderForm 表单渲染器（由调用方提供 UI）
 * @property {()=>void} refresh 触发链重求值（通常为 host 侧 loadSnapshot / refreshAll）
 * @property {(key:string, params?:Record<string,string>)=>string} [tr] i18n（可选）
 */

/**
 * @typedef {{ok: true, action: import('../../shared/tracker/chain.js').Action} | {ok:false, error:{kind:string, message:string}, action: import('../../shared/tracker/chain.js').Action}} ActionResult
 */

/**
 * 创建动作分发器。
 * @param {ActionContext} ctx
 * @returns {{dispatch:(action: import('../../shared/tracker/chain.js').Action)=>Promise<ActionResult>, dispatchAll:(actions: import('../../shared/tracker/chain.js').Action[])=>Promise<ActionResult[]>}}
 */
export function createActionDispatcher(ctx) {
  if (!ctx || typeof ctx !== 'object') throw new Error('ActionContext required')

  async function dispatch(action) {
    if (!action || typeof action.type !== 'string') {
      return { ok: false, error: { kind: 'parse', message: 'action.type missing' }, action }
    }
    const t = action.type
    try {
      if (t === ACTION_TYPE.INJECT_PROMPT) {
        if (typeof action.prompt !== 'string' || !action.prompt) {
          return { ok: false, error: { kind: 'parse', message: 'inject-prompt needs prompt:string' }, action }
        }
        if (typeof ctx.inject !== 'function') {
          return { ok: false, error: { kind: 'unsupported', message: 'inject not available in this context' }, action }
        }
        // 约定：inject(prompt, args)；prompt 模板由 host 侧 prompt registry 提供（如 hint prompt:installSkills）
        await ctx.inject(action.prompt, action.args || {})
        return { ok: true, action }
      }
      if (t === ACTION_TYPE.OPEN_URL) {
        if (typeof action.url !== 'string' || !action.url) {
          return { ok: false, error: { kind: 'parse', message: 'open-url needs url:string' }, action }
        }
        if (typeof ctx.openUrl === 'function') ctx.openUrl(action.url, '_blank')
        else if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(action.url, '_blank')
        else return { ok: false, error: { kind: 'unsupported', message: 'openUrl not available' }, action }
        return { ok: true, action }
      }
      if (t === ACTION_TYPE.RPC) {
        if (typeof action.method !== 'string' || !action.method) {
          return { ok: false, error: { kind: 'parse', message: 'rpc needs method:string' }, action }
        }
        if (typeof ctx.hostCall !== 'function') {
          return { ok: false, error: { kind: 'unsupported', message: 'hostCall not available' }, action }
        }
        await ctx.hostCall(action.method, action.params)
        return { ok: true, action }
      }
      if (t === ACTION_TYPE.FORM) {
        if (!Array.isArray(action.schema)) {
          return { ok: false, error: { kind: 'parse', message: 'form needs schema:FieldSchema[]' }, action }
        }
        if (!action.submitAction || typeof action.submitAction.type !== 'string') {
          return { ok: false, error: { kind: 'parse', message: 'form needs submitAction:Action' }, action }
        }
        if (typeof ctx.renderForm !== 'function') {
          return { ok: false, error: { kind: 'unsupported', message: 'renderForm not available' }, action }
        }
        // 表单渲染为异步交互：此处只触发渲染，提交时再 dispatch submitAction
        await ctx.renderForm(action.schema, async (values) => {
          // 将表单值合并进 submitAction.params（高质量：保留原 params，不覆盖）
          const merged = Object.assign({}, action.submitAction)
          if (values && typeof values === 'object') {
            merged.params = Object.assign({}, merged.params || {}, values)
          }
          await dispatch(merged)
        })
        return { ok: true, action }
      }
      if (t === ACTION_TYPE.REFRESH) {
        if (typeof ctx.refresh !== 'function') {
          return { ok: false, error: { kind: 'unsupported', message: 'refresh not available' }, action }
        }
        await ctx.refresh(action.target || 'chain')
        return { ok: true, action }
      }
      // 枚举外 → 诚实 unsupported（G5 同款，不捏造）
      return { ok: false, error: { kind: 'unsupported', message: 'unknown action type: ' + t }, action }
    } catch (e) {
      return { ok: false, error: { kind: 'network', message: String((e && e.message) || e).slice(0, 600) }, action }
    }
  }

  async function dispatchAll(actions) {
    if (!Array.isArray(actions)) return []
    const out = []
    for (const a of actions) out.push(await dispatch(a))
    return out
  }

  return { dispatch, dispatchAll }
}

export const ACTIONS_VERSION = 1
