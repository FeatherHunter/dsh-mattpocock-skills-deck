// slotRenderer-queue.js — 队列与开关 + 打开入口与守门（K1 由 slotRenderer.js 拆出，行为零变化）。
// 含 SLOT_RENDERER_VERSION、SR_ACTION_TYPE、ensureFormModal、openFormModal、closeFormModal，
// createModalRenderForm（openFormModal 别名）、canOpenModalForStep、canOpenWizardForStep；弹窗本体见 slotRenderer-modal-view.js，仓库同步见 slotRenderer-repo-sync.js。

    export const SLOT_RENDERER_VERSION = 1

    // 动作类型内联（与 chain.js / actions.js 同值，零 import；2026-08-28 新增 wizard）
    const SR_ACTION_TYPE = Object.freeze({ FORM: 'form', INJECT_PROMPT: 'inject-prompt', RPC: 'rpc', REFRESH: 'refresh', OPEN_URL: 'open-url', WIZARD: 'wizard' })

    // 确保 st 上有 formModal 槽位状态（per-store，非全局；与 gateModalOpen 同模式）
    // 新增：st._formModalQueue 用于顺序队列（A 方案），保证单例一次一个但可排队
    // 扩展：支持 wizard（isWizard + steps + stepIndex + valuesByStep）
    export function ensureFormModal(st) {
      if (!st) return null
      if (!st.formModal) st.formModal = { open: false, schema: [], submitAction: null, onSubmit: null, label: '', stepId: '', pending: false, isWizard: false, steps: null, stepIndex: 0, valuesByStep: null, fail: null, success: null }
      if (!st._formModalQueue) st._formModalQueue = []
      return st.formModal
    }

    function _queueLen(st) {
      return st && Array.isArray(st._formModalQueue) ? st._formModalQueue.length : 0
    }

    function _normSteps(raw) {
      if (!Array.isArray(raw) || !raw.length) return []
      const out = []
      for (let i = 0; i < raw.length; i++) {
        const s = raw[i] || {}
        const schema = Array.isArray(s.schema) ? s.schema : (Array.isArray(s.fields) ? s.fields : [])
        const title = typeof s.title === 'string' ? s.title : (typeof s.label === 'string' ? s.label : '')
        out.push({ title: title, schema: schema })
      }
      return out
    }

    export function openFormModal(st, formAction, onSubmit) {
      if (!st) return
      const m = ensureFormModal(st)
      const action = formAction || {}
      const isWizard = action.type === 'wizard'
      // 若当前已有弹窗在展示或提交中，则排队（顺序队列 A，wizard 占 1 位）
      // #419/#425 向导单例：打开期间再次触发直接忽略（去抖不入队），杜绝队列 80ms 重开的“回退到第一步”同形路径；form 保持原队列语义
      if (m.open) {
        if (isWizard) return
        if (!st._formModalQueue) st._formModalQueue = []
        st._formModalQueue.push({ formAction: action, onSubmit: typeof onSubmit === 'function' ? onSubmit : null })
        try { if (typeof flash === 'function') flash(st, '已加入队列（' + String(_queueLen(st)) + ' 个待处理）', 'info') } catch(_){}
        return
      }
      if (isWizard) {
        const steps = _normSteps(action.steps)
        if (!steps.length) return
        m.isWizard = true
        m.steps = steps
        m.stepIndex = 0
        m.valuesByStep = []
        for (let i = 0; i < steps.length; i++) {
          const init = {}
          const sch = steps[i].schema
          for (let j = 0; j < sch.length; j++) { const f = sch[j]; if (f && f.defaultValue != null) init[f.name] = String(f.defaultValue) }
          m.valuesByStep.push(init)
        }
        m.schema = []
        m.submitAction = action.submitAction || action.submit || (action.form && action.form.submit) || null
        let lbl = action.label
        if (lbl && typeof lbl === 'object' && !Array.isArray(lbl)) lbl = lbl.zh || lbl.en || lbl.fallback || String(lbl)
        m.label = lbl && typeof lbl === 'string' ? lbl : (action.label ? String(action.label) : '向导')
        m.stepId = action._stepId || ''
        m.pending = false
      } else {
        m.isWizard = false
        m.steps = null
        m.stepIndex = 0
        m.valuesByStep = null
        m.open = true
        m.schema = Array.isArray(action.schema) ? action.schema : (Array.isArray(action.fields) ? action.fields : [])
        m.submitAction = action.submitAction || action.submit || (action.form && action.form.submit) || null
        m.onSubmit = typeof onSubmit === 'function' ? onSubmit : null
        let lbl = action.label
        if (lbl && typeof lbl === 'object' && !Array.isArray(lbl)) lbl = lbl.zh || lbl.en || lbl.fallback || String(lbl)
        m.label = lbl && typeof lbl === 'string' ? lbl : (action.label ? String(action.label) : (action.type === 'form' ? '填写表单' : ''))
        m.stepId = action._stepId || ''
        m.pending = false
        try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_) {} }
        return
      }
      m.open = true
      m.onSubmit = typeof onSubmit === 'function' ? onSubmit : null
      m.pending = false
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_) {} }
    }

    export function closeFormModal(st) {
      if (!st || !st.formModal) return
      const hadQueue = st._formModalQueue && st._formModalQueue.length > 0
      st.formModal.open = false
      st.formModal.pending = false
      st.formModal.fail = null
      // wizard 状态保留至下一次 open 时重置，关闭时不清 isWizard 以便队列消费时重建
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_) {} }
      // 顺序队列：关闭后若有排队，下一帧自动弹出下一个（保持单例一次一个但不丢请求，wizard 占 1 位）
      if (hadQueue) {
        const next = st._formModalQueue.shift()
        try {
          if (typeof timer !== 'undefined' && timer && typeof timer.setTimeout === 'function') {
            timer.setTimeout(function(){ try { openFormModal(st, next.formAction, next.onSubmit) } catch(_){} }, 80)
          } else if (typeof setTimeout === 'function') {
            setTimeout(function(){ try { openFormModal(st, next.formAction, next.onSubmit) } catch(_){} }, 80)
          } else {
            openFormModal(st, next.formAction, next.onSubmit)
          }
        } catch(_){ try { openFormModal(st, next.formAction, next.onSubmit) } catch(__){} }
      }
    }

    // 对外便捷：给 dispatcher 用的一级 renderForm 实现（直接打开 modal-seat）
    // 按你的要求：以后只用 openFormModal，本函数保留为 createModalRenderForm 的别名，避免旧调用回退到 no-op
    // 支持 form 与 wizard：若 schema 含 steps 则按 wizard 处理
    export function createModalRenderForm(st) {
      return function (schema, onSubmit) {
        // 兼容：若 schema 是 wizard 形状（{steps}），则按 wizard；否则按 form
        if (schema && typeof schema === 'object' && !Array.isArray(schema) && Array.isArray(schema.steps)) {
          openFormModal(st, { type: 'wizard', steps: schema.steps, label: schema.label || '向导', submitAction: schema.submitAction }, onSubmit)
          return
        }
        const fakeAction = { type: SR_ACTION_TYPE.FORM, schema: schema, submitAction: null, label: '填写表单' }
        openFormModal(st, fakeAction, onSubmit)
      }
    }

    // 纯函数：校验 modal 是否应只在 fail+(form|wizard) 时打开（诚实守门，供测试/门禁调用）
    export function canOpenModalForStep(step) {
      if (!step || typeof step !== 'object') return false
      if (step.status !== 'fail') return false
      const acts = step.actions
      if (!Array.isArray(acts)) return false
      for (let i = 0; i < acts.length; i++) { const a = acts[i]; if (a && (a.type === SR_ACTION_TYPE.FORM || a.type === SR_ACTION_TYPE.WIZARD)) return true }
      return false
    }

    export function canOpenWizardForStep(step) {
      if (!step || typeof step !== 'object') return false
      if (step.status !== 'fail') return false
      const acts = step.actions
      if (!Array.isArray(acts)) return false
      for (let i = 0; i < acts.length; i++) { const a = acts[i]; if (a && a.type === SR_ACTION_TYPE.WIZARD) return true }
      return false
    }
