/**
 * client/kernel/slotRenderer.js — 槽位渲染器（ADR #221 §5.4 + 本票 #308 modal-seat 落地）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的拼接标记处。
 * 零 import 语法（防 D7 vm.Script 阻塞）。
 *
 * 职责：把 ChainSnapshot 的 form 动作渲染到 modal-seat（主区居中遮罩弹窗，复用 .dsws-modal/.dsws-modalbox + Overlay 门控 Modal 先例）。
 * 形态：Service 包一层——不直接注册官方 slots 的 children，本文件只提供纯渲染逻辑与开关，
 *       由调用方（ChecksTab 的 dispatcher renderForm）在需要的时机打开 modal，走重求值闭环。
 *
 * 内容复用 ChainForm 的字段渲染/校验/提交逻辑（本文件内复刻，避免双份真源，见 ChainRenderer.js 同源注释）。
 * z 序：modal > toast > banner（ADR 5.2），本 modal 用 .dsws-modal 的 10000，已高于 banner。
 */

    export const SLOT_RENDERER_VERSION = 1

    // 动作类型内联（与 chain.js / actions.js 同值，零 import）
    const SR_ACTION_TYPE = Object.freeze({ FORM: 'form', INJECT_PROMPT: 'inject-prompt', RPC: 'rpc', REFRESH: 'refresh', OPEN_URL: 'open-url' })

    // 确保 st 上有 formModal 槽位状态（per-store，非全局；与 gateModalOpen 同模式）
    export function ensureFormModal(st) {
      if (!st) return null
      if (!st.formModal) st.formModal = { open: false, schema: [], submitAction: null, onSubmit: null, label: '', stepId: '', pending: false }
      return st.formModal
    }

    export function openFormModal(st, formAction, onSubmit) {
      if (!st) return
      const m = ensureFormModal(st)
      const action = formAction || {}
      m.open = true
      m.schema = Array.isArray(action.schema) ? action.schema : (Array.isArray(action.fields) ? action.fields : [])
      // submitAction 取 submitAction || submit || form.submit 兼容
      m.submitAction = action.submitAction || action.submit || (action.form && action.form.submit) || null
      m.onSubmit = typeof onSubmit === 'function' ? onSubmit : null
      m.label = (action.label && typeof action.label === 'string') ? action.label : (action.label ? String(action.label) : (action.type === 'form' ? '填写表单' : ''))
      m.stepId = action._stepId || ''
      m.pending = false
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_) {} }
    }

    export function closeFormModal(st) {
      if (!st || !st.formModal) return
      st.formModal.open = false
      st.formModal.pending = false
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_) {} }
    }

    // 对外便捷：给 dispatcher 用的一级 renderForm 实现（直接打开 modal-seat）
    export function createModalRenderForm(st) {
      return function (schema, onSubmit) {
        // actions.js 调用的 schema 为数组，onSubmit(values) 负责合并到 submitAction 并 dispatch
        // 此处把 action 形状拼回 formAction 以复用 openFormModal 的字段
        const fakeAction = { type: SR_ACTION_TYPE.FORM, schema: schema, submitAction: null, label: '' }
        // onSubmit 闭包已捕获原 action.submitAction（在 actions.js 内），我们直接透传
        // 为让 Modal 能拿到 schema 与 onSubmit，单独存 schema/onSubmit，submitAction 由闭包持有
        const m = ensureFormModal(st)
        m.open = true
        m.schema = Array.isArray(schema) ? schema : []
        m.submitAction = null
        m.onSubmit = typeof onSubmit === 'function' ? onSubmit : null
        m.label = '填写表单'
        m.pending = false
        try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_) {} }
      }
    }

    // 纯函数：校验 modal 是否应只在 fail+form 时打开（诚实守门，供测试/门禁调用）
    export function canOpenModalForStep(step) {
      if (!step || typeof step !== 'object') return false
      if (step.status !== 'fail') return false
      const acts = step.actions
      if (!Array.isArray(acts)) return false
      for (let i = 0; i < acts.length; i++) { const a = acts[i]; if (a && a.type === SR_ACTION_TYPE.FORM) return true }
      return false
    }

    // 弹窗组件：读取 st.formModal，渲染遮罩 + 居中盒 + 表单
    export const FormModalSeat = function (props) {
      const st = props && props.st ? props.st : null
      const cx = (typeof DswsCtx !== 'undefined' && DswsCtx) ? React.useContext(DswsCtx) : null
      const h = (cx && cx.h) ? cx.h : React.createElement
      if (!st) return null
      const m = st.formModal
      if (!m || !m.open) return null
      const schema = Array.isArray(m.schema) ? m.schema : []
      // 受控表单值（useState 必须在组件顶层无条件调用；空 schema 时兜底空对象）
      const [vals, setVals] = React.useState(function () {
        const init = {}
        for (let i = 0; i < schema.length; i++) { const f = schema[i]; if (f && f.defaultValue != null) init[f.name] = String(f.defaultValue) }
        return init
      })
      // 同步：schema 变化时重置（仅 open 期间首次）
      React.useEffect(function () {
        const init = {}
        for (let i = 0; i < schema.length; i++) { const f = schema[i]; if (f && f.defaultValue != null) init[f.name] = String(f.defaultValue) }
        setVals(init)
      }, [m.schema && m.schema.length, m.open])
      const onClose = function () { try { closeFormModal(st) } catch (e) {} }
      const onOverlayClick = function (e) { if (e && e.target === e.currentTarget) onClose() }
      const onSubmit = async function () {
        // 校验 required + pattern（与 ChainForm 同口径）
        for (let i = 0; i < schema.length; i++) {
          const f = schema[i]
          if (f && f.required) { const v = String(vals[f.name] || '').trim(); if (!v) { try { if (typeof flash === 'function') flash(st, String(f.label || f.name) + ' 必填', 'warn') } catch(_){} return } }
          if (f && f.pattern) { try { const re = new RegExp(f.pattern); if (!re.test(String(vals[f.name] || ''))) { try { if (typeof flash === 'function') flash(st, String(f.label || f.name) + ' 格式不正确', 'warn') } catch(_){} return } } catch(_){} }
        }
        if (!m.onSubmit) { try { if (typeof flash === 'function') flash(st, '表单缺少提交句柄', 'warn') } catch(_){} return }
        const cb = m.onSubmit
        m.pending = true
        try { if (typeof emit === 'function') emit(st) } catch(_){}
        try {
          await cb(vals)
          // 提交成功：关弹窗并走宿主重求值（cb 内部已调 dispatch(merged)，其内会触发 refresh 或由调用方处理）
          m.pending = false
          m.open = false
          try { if (typeof emit === 'function') emit(st) } catch(_){}
          try { if (typeof flash === 'function') flash(st, '已提交，链条重查中…', 'ok') } catch(_){}
          // 主动触发一次重求值兜底（若 cb 的 dispatcher 未自带 refresh）
          try {
            if (typeof host !== 'undefined' && host.call) {
              await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (st.selection && st.selection.backendId) || undefined })
              try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch(_){}
              try { if (typeof loadChain === 'function') loadChain(st, true) } catch(_){}
            }
          } catch(_){}
        } catch (e) {
          m.pending = false
          try { if (typeof emit === 'function') emit(st) } catch(_){}
          try { if (typeof flash === 'function') flash(st, String((e && e.message) || e).slice(0, 200), 'warn') } catch(_){}
        }
      }
      const fields = schema.map(function (f, idx) {
        const id = 'modal-form-' + String(f.name || idx)
        const label = (f && (f.label || f.labelKey)) || (f && f.name) || String(idx)
        const placeholder = (f && (f.placeholder || f.placeholderKey)) || ''
        const isSingle = f && f.type === 'single'
        const isMulti = f && f.type === 'multi'
        return h('div', { key: f.name || idx, style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 } }, [
          h('label', { htmlFor: id, style: { fontSize: 11, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 } }, [ h('span', null, label), f && f.required ? h('span', { style: { color: '#f87171' } }, '*') : null ]),
          isSingle ? h('select', { id: id, value: String(vals[f.name] || ''), disabled: !!m.pending, onChange: function (e) { const nxt = Object.assign({}, vals); nxt[f.name] = e.target.value; setVals(nxt) }, style: { fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #2a2d35', background: '#10131a', color: '#e6edf3' } }, [
            h('option', { value: '' }, placeholder || '请选择'),
            ...((f.options || []).map(function (opt) { return h('option', { key: opt, value: opt }, opt) }))
          ]) : isMulti ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, (f.options || []).map(function (opt) {
            const checked = Array.isArray(vals[f.name]) ? vals[f.name].indexOf(opt) >= 0 : false
            return h('label', { key: opt, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, border: '1px solid #2a2d35', borderRadius: 6, padding: '2px 6px', cursor: m.pending ? 'not-allowed' : 'pointer', background: checked ? 'rgba(88,166,255,.12)' : 'transparent', opacity: m.pending ? 0.6 : 1 } }, [
              h('input', { type: 'checkbox', checked: checked, disabled: !!m.pending, onChange: function (e) { const arr = Array.isArray(vals[f.name]) ? vals[f.name].slice() : []; if (e.target.checked) { if (arr.indexOf(opt) < 0) arr.push(opt) } else { const p = arr.indexOf(opt); if (p >= 0) arr.splice(p, 1) } const nxt = Object.assign({}, vals); nxt[f.name] = arr; setVals(nxt) } }),
              h('span', null, opt)
            ])
          })) : h('input', { id: id, type: f && f.type === 'number' ? 'number' : f && f.type === 'date' ? 'date' : 'text', value: String(vals[f.name] || ''), placeholder: placeholder, disabled: !!m.pending, onChange: function (e) { const nxt = Object.assign({}, vals); nxt[f.name] = e.target.value; setVals(nxt) }, style: { fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #2a2d35', background: '#10131a', color: '#e6edf3' } }),
        ])
      })
      // ESC 关闭
      React.useEffect(function () {
        const onKey = function (e) { if (e && e.key === 'Escape') onClose() }
        try { document.addEventListener('keydown', onKey) } catch(_){}
        return function () { try { document.removeEventListener('keydown', onKey) } catch(_){} }
      }, [])
      const box = h('div', { className: 'dsws-modalbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.label || '表单', style: { width: 460, maxWidth: '94vw' }, onClick: function (e) { e.stopPropagation() } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } }, [
          h('div', { style: { fontSize: 13, fontWeight: 600, color: '#e6edf3' } }, m.label || '填写表单'),
          h('button', { className: 'dsws-btn ghost', 'aria-label': '关闭', onClick: onClose, disabled: !!m.pending, style: { fontSize: 12, padding: '2px 8px' } }, '✕'),
        ]),
        h('div', { style: { fontSize: 11, color: '#8b8b95', marginBottom: 8, lineHeight: 1.5 } }, '请填写后提交，提交后将自动重查。'),
        ...fields,
        h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 } }, [
          h('button', { className: 'dsws-btn', onClick: onClose, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px' } }, '取消'),
          h('button', { className: 'dsws-btn primary', onClick: onSubmit, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px', background: m.pending ? '#6b7280' : '#58a6ff', borderColor: m.pending ? '#6b7280' : '#58a6ff', color: '#0b1220', fontWeight: 600, opacity: m.pending ? 0.7 : 1 } }, m.pending ? '提交中…' : '提交'),
        ]),
      ])
      // portalTop 挂到 body，避免被面板裁剪（与 issue #3 同理）
      const overlayNode = h('div', { className: 'dsws-modal', role: 'presentation', onClick: onOverlayClick, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 } }, [box])
      try {
        if (typeof portalTop === 'function') return portalTop(overlayNode)
      } catch(_){}
      return overlayNode
    }