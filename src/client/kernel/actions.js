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

// 动作类型闭包常量（与 src/shared/tracker/chain.js 的 ACTION_TYPE 同值；本文件为 UI 执行器，
// 遵守「零 import 语法」约定——防 D7 dev host vm.Script 阻塞；枚举若变更须同步（契约校验兜底））
const ACTION_TYPE = Object.freeze({ INJECT_PROMPT: 'inject-prompt', OPEN_URL: 'open-url', RPC: 'rpc', FORM: 'form', REFRESH: 'refresh', WIZARD: 'wizard' })

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
        // B4 fix: 优先经 ctx.resolvePrompt 解析完整引导文案（host prompt registry），无则回落直接注入 prompt 名
        let promptText = action.prompt
        let promptArgs = action.args || {}
        if (typeof ctx.resolvePrompt === 'function') {
          try {
            const resolved = await ctx.resolvePrompt(action.prompt, promptArgs)
            if (typeof resolved === 'string' && resolved) promptText = resolved
            else if (resolved && typeof resolved.text === 'string') {
              promptText = resolved.text
              if (resolved.args) promptArgs = resolved.args
            }
          } catch {}
        } else if (typeof ctx.tr === 'function' && action.prompt.startsWith('prompt:')) {
          try { promptText = ctx.tr(action.prompt, promptArgs) } catch {}
        }
        await ctx.inject(promptText, promptArgs)
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
        const method = action.method || action.endpoint
        if (typeof method !== 'string' || !method) {
          return { ok: false, error: { kind: 'parse', message: 'rpc needs method:string' }, action }
        }
        if (typeof ctx.hostCall !== 'function') {
          return { ok: false, error: { kind: 'unsupported', message: 'hostCall not available' }, action }
        }
        const params = action.params !== undefined ? action.params : action.args
        const res = await ctx.hostCall(method, params)
        // 承载宿主业务失败（wf.initPublish 的已分档错误：already-exists/bad-name/network 等）——宿主内返回 {ok:false, errorKind, error} 经外层 ok:true 透传，需在此翻译为诚实失败以便上层走 catch 回跳
        if (res && typeof res === 'object' && res.ok === false) {
          const kind = res.errorKind || (res.error && res.error.kind) || res.kind || 'internal'
          const msg = res.error ? (typeof res.error === 'string' ? res.error : (res.error.message || String(res.error))) : (res.message || 'RPC 业务失败：' + method)
          const err = new Error(String(msg).slice(0,600))
          err.code = kind; err.kind = kind; err.errorKind = kind
          // 保留 repoUrl 等上下文供上层展示（如已存在时“去查看”链接）
          if (res.repoUrl) err.repoUrl = res.repoUrl
          if (res.error && res.error.repoUrl) err.repoUrl = res.error.repoUrl
          return { ok: false, error: { kind: kind, message: String(msg).slice(0,600) }, action }
        }
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
          const merged = Object.assign({}, action.submitAction)
          if (values && typeof values === 'object') {
            // B3 fix: 按 submitAction 类型决定合并目标（inject-prompt 用 args，其余用 params），兼容别名
            if (merged.type === ACTION_TYPE.INJECT_PROMPT) {
              merged.args = Object.assign({}, merged.args || merged.params || {}, values)
              if (merged.params && !merged.args) merged.args = merged.params
            } else {
              // rpc/form/refresh 等：优先 params，兼容 args 别名
              const base = merged.params !== undefined ? merged.params : merged.args
              if (merged.type === ACTION_TYPE.RPC) {
                // 保持与 RPC 别名一致
                merged.params = Object.assign({}, base || {}, values)
                if (action.submitAction.args) merged.args = merged.params
              } else {
                merged.params = Object.assign({}, base || {}, values)
              }
            }
          }
          const res = await dispatch(merged)
          // 显式透传失败（防静默吞，保留 kind 供上层回跳）
          if (!res.ok) { const err = new Error(res.error.message); err.code = res.error.kind; err.kind = res.error.kind; err.errorKind = res.error.kind; throw err }
        })
        return { ok: true, action }
      }
      if (t === ACTION_TYPE.WIZARD) {
        const steps = action.steps
        if (!Array.isArray(steps) || steps.length === 0) {
          return { ok: false, error: { kind: 'parse', message: 'wizard needs steps: {title, schema}[]' }, action }
        }
        if (!action.submitAction || typeof action.submitAction.type !== 'string') {
          // 兼容 submit 别名
          const alt = action.submit || (action.form && action.form.submit)
          if (!alt || typeof alt.type !== 'string') {
            return { ok: false, error: { kind: 'parse', message: 'wizard needs submitAction:Action' }, action }
          }
          action.submitAction = alt
        }
        if (typeof ctx.renderForm !== 'function') {
          return { ok: false, error: { kind: 'unsupported', message: 'renderForm not available' }, action }
        }
        // 单步 wizard 当单页表单：与 form 同形态，仅改用 steps 载荷；提交时合并全步值后走 submitAction（label 透传，空时由 slotRenderer 回落为“向导”，保持 locale 封顶）
        const wizardPayload = { type: 'wizard', steps: steps, label: action.label, submitAction: action.submitAction }
        await ctx.renderForm(wizardPayload, async (values) => {
          const merged = Object.assign({}, action.submitAction)
          if (values && typeof values === 'object') {
            if (merged.type === ACTION_TYPE.INJECT_PROMPT) {
              merged.args = Object.assign({}, merged.args || merged.params || {}, values)
              if (merged.params && !merged.args) merged.args = merged.params
            } else {
              const base = merged.params !== undefined ? merged.params : merged.args
              if (merged.type === ACTION_TYPE.RPC) {
                merged.params = Object.assign({}, base || {}, values)
                if (action.submitAction.args) merged.args = merged.params
              } else {
                merged.params = Object.assign({}, base || {}, values)
              }
            }
          }
          const res = await dispatch(merged)
          if (!res.ok) { const err = new Error(res.error.message); err.code = res.error.kind; err.kind = res.error.kind; err.errorKind = res.error.kind; throw err }
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