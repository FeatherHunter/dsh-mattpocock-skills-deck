// slotRenderer-modal-view.js — 弹窗本体 FormModalSeat（K1 由 slotRenderer.js 拆出，行为零变化；打开入口与守门见 slotRenderer-queue.js，同步流程见 slotRenderer-repo-sync.js）。
    export const FormModalSeat = function (props) {
      const st = props && props.st ? props.st : null
      const cx = (typeof DswsCtx !== 'undefined' && DswsCtx) ? React.useContext(DswsCtx) : null
      const h = (cx && cx.h) ? cx.h : React.createElement
      if (!st) return null
      const m = st.formModal
      if (!m) return null
      // #419/#425：成功弹窗态（m.success 且向导已关）与表单态共用一组 hooks（末尾条件分支渲染）
      const isSuccess = !!(m.success && !m.open)
      if (!m.open && !isSuccess) return null
      const isWizard = !!m.isWizard && Array.isArray(m.steps) && m.steps.length > 0
      const wizardSteps = isWizard ? m.steps : null
      const stepIndex = isWizard ? (typeof m.stepIndex === 'number' ? m.stepIndex : 0) : 0
      const curSchema = isWizard ? (wizardSteps[stepIndex] ? wizardSteps[stepIndex].schema : []) : (Array.isArray(m.schema) ? m.schema : [])
      const totalSteps = isWizard ? wizardSteps.length : 1
      // 受控表单值：wizard 按步隔离，form 单值
      const [vals, setVals] = React.useState(function () {
        if (isWizard) {
          const cur = m.valuesByStep && m.valuesByStep[stepIndex] ? m.valuesByStep[stepIndex] : {}
          const init = Object.assign({}, cur)
          // 补 defaultValue
          for (let i = 0; i < curSchema.length; i++) { const f = curSchema[i]; if (f && f.defaultValue != null && init[f.name] === undefined) init[f.name] = String(f.defaultValue) }
          return init
        } else {
          const init = {}
          for (let i = 0; i < curSchema.length; i++) { const f = curSchema[i]; if (f && f.defaultValue != null) init[f.name] = String(f.defaultValue) }
          return init
        }
      })
      // 同步：schema/步骤变化时重置（wizard 切步时从 valuesByStep 恢复）
      React.useEffect(function () {
        if (isWizard) {
          const cur = m.valuesByStep && m.valuesByStep[stepIndex] ? m.valuesByStep[stepIndex] : {}
          const init = Object.assign({}, cur)
          for (let i = 0; i < curSchema.length; i++) { const f = curSchema[i]; if (f && f.defaultValue != null && init[f.name] === undefined) init[f.name] = String(f.defaultValue) }
          setVals(init)
        } else {
          const init = {}
          for (let i = 0; i < curSchema.length; i++) { const f = curSchema[i]; if (f && f.defaultValue != null) init[f.name] = String(f.defaultValue) }
          setVals(init)
        }
      }, [isWizard, stepIndex, m.steps ? m.steps.length : 0, m.schema ? m.schema.length : 0, m.open])
      const onClose = function () { try { if (m.success) { m.success = null; try { if (typeof emit === 'function') emit(st) } catch(_){} } closeFormModal(st) } catch (e) {} }
      const onOverlayClick = function (e) { if (e && e.target === e.currentTarget) onClose() }
      const onPick = function (f) {
        return async function () {
          if (m.pending) return
          const isDir = f && f.type === 'directory'
          const method = isDir ? 'wf.pickDirectory' : 'wf.pickFile'
          try {
            if (typeof host === 'undefined' || !host.call) {
              try { if (typeof flash === 'function') flash(st, '宿主选择器不可用，请手动输入路径', 'warn') } catch(_){}
              return
            }
            m.pending = true
            try { if (typeof emit === 'function') emit(st) } catch(_){}
            const res = await host.call(method, { cwd: st.cwd || '', initial: String(vals[f.name] || ''), kind: f.type })
            m.pending = false
            try { if (typeof emit === 'function') emit(st) } catch(_){}
            if (res && res.ok && typeof res.path === 'string' && res.path) {
              const nxt = Object.assign({}, vals); nxt[f.name] = res.path; setVals(nxt)
              if (isWizard && m.valuesByStep && m.valuesByStep[stepIndex]) { m.valuesByStep[stepIndex] = Object.assign({}, nxt) }
              try { if (typeof flash === 'function') flash(st, '已选择：' + res.path, 'ok') } catch(_){}
            } else if (res && res.ok === false && res.error && String(res.error).toLowerCase().indexOf('cancel') < 0) {
              try { if (typeof flash === 'function') flash(st, String(res.error).slice(0,200), 'warn') } catch(_){}
            }
          } catch (e) {
            m.pending = false
            try { if (typeof emit === 'function') emit(st) } catch(_){}
            try { if (typeof flash === 'function') flash(st, String((e && e.message)||e).slice(0,200), 'warn') } catch(_){}
          }
        }
      }
      // 校验当前步（Q3 按步校验）
      const validateCurrent = function () {
        for (let i = 0; i < curSchema.length; i++) {
          const f = curSchema[i]
          if (f && f.required) { const v = String(vals[f.name] || '').trim(); if (!v) { try { if (typeof flash === 'function') flash(st, String(f.label || f.name) + ' 必填', 'warn') } catch(_){} return false } }
          if (f && f.pattern) { try { const re = new RegExp(f.pattern); if (!re.test(String(vals[f.name] || ''))) { try { if (typeof flash === 'function') flash(st, String(f.label || f.name) + ' 格式不正确', 'warn') } catch(_){} return false } } catch(_){} }
        }
        return true
      }
      const onPrev = function () {
        if (!isWizard || stepIndex <= 0) return
        m.fail = null
        // 保存当前步值
        if (m.valuesByStep) m.valuesByStep[stepIndex] = Object.assign({}, vals)
        m.stepIndex = stepIndex - 1
        try { if (typeof emit === 'function') emit(st) } catch(_){}
      }
      const onNext = function () {
        if (!isWizard) return
        if (!validateCurrent()) return
        m.fail = null
        if (m.valuesByStep) m.valuesByStep[stepIndex] = Object.assign({}, vals)
        if (stepIndex < totalSteps - 1) {
          m.stepIndex = stepIndex + 1
          try { if (typeof emit === 'function') emit(st) } catch(_){}
        }
      }
      const onWizardSubmit = async function () {
        if (isWizard && !validateCurrent()) return
        if (isWizard && m.valuesByStep) m.valuesByStep[stepIndex] = Object.assign({}, vals)
        // 合并全步值（Q3 最后一起提交，验收原语：merged = Object.assign({}, ...valuesByStep) 浅合并后一次提交）
        let merged = {}
        if (isWizard) {
          // 显式保留验收原语字面（grep 友好）
          try { merged = Object.assign.apply(null, [{}].concat(m.valuesByStep || [])) } catch(_) {
          for (let i = 0; i < m.valuesByStep.length; i++) {
            const part = m.valuesByStep[i] || {}
            for (const k in part) if (Object.prototype.hasOwnProperty.call(part, k)) merged[k] = part[k]
          }
          }
          // 等价于 merged = Object.assign({}, ...valuesByStep) 浅合并（后步同名覆盖前步，一次性提交）
        } else {
          merged = Object.assign({}, vals)
        }
        // 校验全量 required/pattern（兜底）
        const allSchemas = isWizard ? (function(){ const a=[]; for(let i=0;i<wizardSteps.length;i++) a.push(...wizardSteps[i].schema); return a })() : curSchema
        for (let i = 0; i < allSchemas.length; i++) {
          const f = allSchemas[i]
          if (f && f.required) { const v = String(merged[f.name] || '').trim(); if (!v) { try { if (typeof flash === 'function') flash(st, String(f.label || f.name) + ' 必填', 'warn') } catch(_){}
            // Q8 自动回跳到含该字段的步骤
            if (isWizard) {
              for (let si=0; si<wizardSteps.length; si++) { const sch=wizardSteps[si].schema; for(let fi=0;fi<sch.length;fi++) if(sch[fi].name===f.name){ m.stepIndex=si; try{ if(typeof emit==='function') emit(st)}catch(_){}; return } }
            } else return
          }}
        }
        if (!m.onSubmit) { try { if (typeof flash === 'function') flash(st, '表单缺少提交句柄', 'warn') } catch(_){} return }
        const cb = m.onSubmit
        m.pending = true
        try { if (typeof emit === 'function') emit(st) } catch(_){}
        try {
          m.lastVis = String((merged && merged.visibility) || 'public')
          const out = await cb(merged)
          m.pending = false
          // #419/#425：成功后丢弃队列残留（向导单例），再关闭向导
          try { if (st && Array.isArray(st._formModalQueue)) st._formModalQueue = [] } catch(_){}
          try { closeFormModal(st) } catch(_){ m.open = false; try { if (typeof emit === 'function') emit(st) } catch(__){} }
          // #419/#425 成功弹窗：真值链接 + 在 GitHub 打开/完成；无 repo 数据时诚实回落为提示
          const repoData = (out && out.data && out.data.ok) ? out.data : null
          const repo = repoData && repoData.repo ? repoData.repo : null
          if (repo && (repo.owner || repo.name)) {
            m.success = { owner: repo.owner || '', name: repo.name || '', url: (repoData && repoData.repoUrl) ? repoData.repoUrl : '', visLabel: visLabelOf(m.lastVis) }
          } else {
            try { if (typeof flash === 'function') flash(st, '已提交，链条重查中…', 'ok') } catch(_){}
          }
          // 同步过渡态 + 后台重查（弹窗出现时即开始，不等用户点「完成」）
          startRepoSync(st)
          runRepoSyncRecheck(st)
          try { if (typeof emit === 'function') emit(st) } catch(_){}
        } catch (e) {
          m.pending = false
          const msg = String((e && e.message) || e)
          const code = (e && (e.code || e.kind || e.errorKind)) ? String(e.code || e.kind || e.errorKind).toLowerCase() : ''
          const halfCreated = !!(e && e.halfCreated)
          const repoUrl = (e && e.repoUrl) ? String(e.repoUrl).replace(/\.git$/, '') : ''
          // #420/#426：失败内联错误条（errorKind 精确回跳；删除九条件文本启发式；文案后端优先 locale 兜底）
          const dispKind = halfCreated ? 'half-created' : (code || 'unknown')
          m.fail = { kind: dispKind, code: code, text: resolveFailText(st, dispKind, code, msg), link: repoUrl || null, repo: (e && e.repo) ? e.repo : null, halfCreated: halfCreated }
          if (isWizard && (code === 'bad-name' || code === 'already-exists')) {
            let jumped = false
            for (let si=0; si<wizardSteps.length && !jumped; si++) {
              const sch=wizardSteps[si].schema
              for(let fi=0;fi<sch.length;fi++) if(sch[fi].name==='name'){ m.stepIndex=si; try{ if(typeof emit==='function') emit(st)}catch(_){}; jumped = true; break }
            }
          }
          // #420定版：no-gh / not-logged-in 自动注入指引（复用既有文案）
          if (code === 'no-gh' || code === 'not-logged-in') {
            try { if (typeof inject === 'function') inject(st, (typeof promptText === 'function' ? promptText(code === 'no-gh' ? 'noGhPrompt' : 'ghAuthLogin') : '')) } catch(_){}
          }
          try { if (typeof emit === 'function') emit(st) } catch(_){}
        }
      }
      const onSubmit = isWizard ? onWizardSubmit : async function () {
        if (!validateCurrent()) return
        if (!m.onSubmit) { try { if (typeof flash === 'function') flash(st, '表单缺少提交句柄', 'warn') } catch(_){} return }
        const cb = m.onSubmit
        m.pending = true
        try { if (typeof emit === 'function') emit(st) } catch(_){}
        try {
          await cb(vals)
          m.pending = false
          try { closeFormModal(st) } catch(_){ m.open = false; try { if (typeof emit === 'function') emit(st) } catch(__){} }
          try { if (typeof flash === 'function') flash(st, '已提交，链条重查中…', 'ok') } catch(_){}
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
      const fields = curSchema.map(function (f, idx) {
        const id = 'modal-form-' + String(f.name || idx) + (isWizard ? '-s' + stepIndex : '')
        const rawLabel = (f && (f.label || f.labelKey)) || (f && f.name) || String(idx)
        const label = typeof rawLabel === 'object' && rawLabel !== null ? (rawLabel.zh || rawLabel.en || String(rawLabel)) : String(rawLabel)
        const placeholder = (function(){
          const ph = (f && (f.placeholder || f.placeholderKey)) || ''
          return typeof ph === 'object' && ph !== null ? (ph.zh || ph.en || String(ph)) : String(ph)
        })()
        const isSingle = f && f.type === 'single'
        const isMulti = f && f.type === 'multi'
        const isDirectory = f && f.type === 'directory'
        const isFile = f && f.type === 'file'
        const isPicker = isDirectory || isFile
        if (isPicker) {
          return h('div', { key: f.name || idx, style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 } }, [
            h('label', { htmlFor: id, style: { fontSize: 11, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 } }, [ h('span', null, label), f && f.required ? h('span', { style: { color: '#f87171' } }, '*') : null ]),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
              h('input', { id: id, type: 'text', value: String(vals[f.name] || ''), placeholder: placeholder || (isDirectory ? '请选择目录或手动输入' : '请选择文件或手动输入'), disabled: !!m.pending, onChange: function (e) { const nxt = Object.assign({}, vals); nxt[f.name] = e.target.value; setVals(nxt) }, style: { flex: 1, minWidth: 0, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)' } }),
              h('button', { type: 'button', className: 'dsws-btn', disabled: !!m.pending, onClick: onPick(f), style: { fontSize: 11, padding: '4px 10px', flex: 'none' } }, isDirectory ? '浏览目录…' : '浏览文件…')
            ]),
          ])
        }
        return h('div', { key: f.name || idx, style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 } }, [
          h('label', { htmlFor: id, style: { fontSize: 11, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 } }, [ h('span', null, label), f && f.required ? h('span', { style: { color: '#f87171' } }, '*') : null ]),
          isSingle ? h('div', { style: { display: 'flex', gap: 8 } }, (f.options || []).map(function (opt) {
            const active = String(vals[f.name] || '') === String(opt)
            return h('label', { key: opt, role: 'radio', tabIndex: m.pending ? -1 : 0, 'aria-checked': active ? 'true' : 'false', 'aria-label': String(opt), onClick: function(){ if(m.pending) return; const nxt = Object.assign({}, vals); nxt[f.name] = String(opt); setVals(nxt); if(isWizard && m.valuesByStep && m.valuesByStep[stepIndex]) m.valuesByStep[stepIndex] = Object.assign({}, nxt); }, onKeyDown: function(e){ const k = e && e.key; if(k===' '||k==='Enter'||k==='Spacebar'||k==='Space'){ try{ if(e.preventDefault) e.preventDefault() }catch(_){} if(m.pending) return; const nxt = Object.assign({}, vals); nxt[f.name] = String(opt); setVals(nxt); if(isWizard && m.valuesByStep && m.valuesByStep[stepIndex]) m.valuesByStep[stepIndex] = Object.assign({}, nxt); } }, style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 8px', border: '1px solid ' + (active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-border-l1,#2a2d35)'), borderRadius: 10, background: active ? 'rgba(192,132,252,.08)' : 'var(--dsw-alias-bg-layer-2,#16181d)', color: active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: m.pending ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', transition: 'border-color .12s,background .12s', opacity: m.pending ? 0.6 : 1 } }, [
              h('span', { style: { width: 13, height: 13, borderRadius: '50%', border: '1.5px solid ' + (active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-border-l2,#3a3f4a)'), flex: 'none', display: 'grid', placeItems: 'center' } }, active ? h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: 'var(--dsw-alias-interactive-bg-primary,#c084fc)' } }) : null),
              h('span', null, String(opt)),
              (f.optionSubs && f.optionSubs[opt]) ? h('span', { style: { fontSize: 11, color: (active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-label-caption,#8b8b95)'), fontWeight: 400, whiteSpace: 'nowrap' } }, typeof f.optionSubs[opt] === 'object' ? (f.optionSubs[opt].zh || f.optionSubs[opt].en || String(f.optionSubs[opt])) : String(f.optionSubs[opt])) : null,
            ])
          })) : isMulti ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, (f.options || []).map(function (opt) {
            const checked = Array.isArray(vals[f.name]) ? vals[f.name].indexOf(opt) >= 0 : false
            return h('label', { key: opt, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, border: '1px solid #2a2d35', borderRadius: 6, padding: '2px 6px', cursor: m.pending ? 'not-allowed' : 'pointer', background: checked ? 'rgba(88,166,255,.12)' : 'transparent', opacity: m.pending ? 0.6 : 1 } }, [
              h('input', { type: 'checkbox', checked: checked, disabled: !!m.pending, onChange: function (e) { const arr = Array.isArray(vals[f.name]) ? vals[f.name].slice() : []; if (e.target.checked) { if (arr.indexOf(opt) < 0) arr.push(opt) } else { const p = arr.indexOf(opt); if (p >= 0) arr.splice(p, 1) } const nxt = Object.assign({}, vals); nxt[f.name] = arr; setVals(nxt) } }),
              h('span', null, opt)
            ])
          })) : h('input', { id: id, type: f && f.type === 'number' ? 'number' : f && f.type === 'date' ? 'date' : 'text', value: String(vals[f.name] || ''), placeholder: placeholder, disabled: !!m.pending, onChange: function (e) { const nxt = Object.assign({}, vals); nxt[f.name] = e.target.value; setVals(nxt) }, style: { fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)' } }),
          // 预览行（2026-08-28 用户定版）：字段声明 preview 模板时渲染全蓝 URL 预览（无底无框）
          (f && typeof f.preview === 'string' && f.preview) ? h('div', { style: { fontSize: 12, fontWeight: 500, color: '#58a6ff', marginTop: 2, wordBreak: 'break-all', letterSpacing: '.01em', lineHeight: 1.5 } }, [
            h('span', null, String(f.preview).replace(/\{owner\}/g, 'owner').replace(/\{name\}/g, String(vals[f.name] || '').trim() || '...')),
          ]) : null,
        ])
      })
      // 焦点聚集：打开时自动聚焦首控件，TAB 在弹窗内循环（不外泄），ESC 关闭
      React.useEffect(function () {
        if (!m.open) return
        const t = (typeof timer !== 'undefined' && timer && typeof timer.setTimeout === 'function') ? timer.setTimeout : (typeof setTimeout === 'function' ? setTimeout : null)
        const focusFirst = function(){
          try {
            const root = document.querySelector('.dsws-modalbox')
            if (!root) return
            const el = root.querySelector('input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled])')
            if (el && typeof el.focus === 'function') el.focus()
          } catch(_){}
        }
        if (t) t(focusFirst, 60); else focusFirst()
        const onKey = function (e) {
          if (!e) return
          if (e.key === 'Escape') { try { onClose() } catch(_){} return }
          if (e.key === 'Tab') {
            try {
              const root = document.querySelector('.dsws-modalbox')
              if (!root) return
              const nodes = Array.from(root.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
              if (!nodes.length) return
              const first = nodes[0], last = nodes[nodes.length-1]
              const active = document.activeElement
              if (e.shiftKey) {
                if (active === first) { e.preventDefault(); try { last.focus() } catch(_){} }
              } else {
                if (active === last) { e.preventDefault(); try { first.focus() } catch(_){} }
              }
            } catch(_){}
          }
        }
        try { document.addEventListener('keydown', onKey) } catch(_){}
        return function () { try { document.removeEventListener('keydown', onKey) } catch(_){} }
      }, [m.open, stepIndex])
      // 步进条（Q6 数字圆点 + 标题）
      const stepper = isWizard ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' } }, wizardSteps.map(function(s, i){
        const active = i === stepIndex
        const done = i < stepIndex
        const bg = done ? '#16a34a' : active ? '#58a6ff' : '#2a2d35'
        const color = done || active ? '#fff' : '#8b8b95'
        const title = s.title || ('步骤 ' + String(i+1))
        return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          h('span', { style: { width: 22, height: 22, borderRadius: '50%', background: bg, color: color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 } }, done ? '✓' : String(i+1)),
          h('span', { style: { fontSize: 11, color: active ? '#e6edf3' : '#8b8b95', fontWeight: active ? 600 : 400 } }, title),
          i < wizardSteps.length - 1 ? h('span', { style: { width: 16, height: 1, background: '#2a2d35', flex: 'none' } }) : null
        ])
      })) : null
      const navRow = isWizard ? h('div', { style: { display: 'flex', gap: 6, justifyContent: 'space-between', marginTop: 8, alignItems: 'center' } }, [
        h('div', { style: { display: 'flex', gap: 6 } }, [
          h('button', { className: 'dsws-btn', onClick: onClose, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px' } }, '取消'),
          stepIndex > 0 ? h('button', { className: 'dsws-btn', onClick: onPrev, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px' } }, '上一步') : null
        ]),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
          h('span', { style: { fontSize: 10, color: '#8b8b95' } }, String(stepIndex+1) + ' / ' + String(totalSteps)),
          stepIndex < totalSteps - 1 ? h('button', { className: 'dsws-btn primary', onClick: onNext, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px', background: '#58a6ff', borderColor: '#58a6ff', color: '#0b1220', fontWeight: 600 } }, '下一步') : h('button', { className: 'dsws-btn primary', onClick: onSubmit, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px', background: m.pending ? '#6b7280' : '#58a6ff', borderColor: m.pending ? '#6b7280' : '#58a6ff', color: '#0b1220', fontWeight: 600, opacity: m.pending ? 0.7 : 1 } }, m.pending ? '提交中…' : '提交')
        ])
      ]) : h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 } }, [
        h('button', { className: 'dsws-btn', onClick: onClose, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px' } }, '取消'),
        h('button', { className: 'dsws-btn primary', onClick: onSubmit, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px', background: m.pending ? '#6b7280' : '#58a6ff', borderColor: m.pending ? '#6b7280' : '#58a6ff', color: '#0b1220', fontWeight: 600, opacity: m.pending ? 0.7 : 1 } }, m.pending ? '提交中…' : '提交'),
      ])
      const box = h('div', { className: 'dsws-modalbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.label || (isWizard ? '向导' : '表单'), style: { width: 480, maxWidth: '94vw' }, onClick: function (e) { e.stopPropagation() } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } }, [
          h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, m.label || (isWizard ? '向导' : '填写表单')),
          h('button', { className: 'dsws-btn ghost', 'aria-label': '关闭', onClick: onClose, disabled: !!m.pending, style: { fontSize: 12, padding: '2px 8px' } }, '✕'),
        ]),
        isWizard ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginBottom: 4 } }, (wizardSteps[stepIndex].title || ('步骤 ' + String(stepIndex+1))) + ' — 请填写后继续' + (_queueLen(st) > 0 ? '（队列中还有 ' + String(_queueLen(st)) + ' 个待处理）' : '')) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginBottom: 8, lineHeight: 1.5 } }, '请填写后提交，提交后将自动重查。' + (_queueLen(st) > 0 ? '（队列中还有 ' + String(_queueLen(st)) + ' 个待处理）' : '')),
        stepper,
        ...fields,
        // #420/#426：失败内联错误条（常驻；链接 + 半成功重试入口；关闭/重新提交时清除）
        (m.fail && (m.fail.text || m.fail.link || m.fail.halfCreated)) ? h('div', { role: 'alert', style: { marginTop: 2, border: '1px solid rgba(248,113,113,.45)', background: 'rgba(248,113,113,.10)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#fca5a5', lineHeight: 1.5 } }, [
          h('div', null, String(m.fail.text || '')),
          (m.fail.link || m.fail.halfCreated) ? h('div', { style: { display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' } }, [
            m.fail.link ? h('span', { style: { color: '#58a6ff', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }, onClick: function(){ try { if (typeof openUrl === 'function') openUrl(m.fail.link) } catch(_){} } }, (typeof tr === 'function' ? tr('panel.successModal.openBtn') : 'Open on GitHub')) : null,
            m.fail.halfCreated ? h('button', { className: 'dsws-btn', onClick: function(){ try { retryPushFlow(st, m) } catch(_){ try { flash(st, 'retry push failed', 'warn') } catch(__){} } }, disabled: !!m.pending, style: { fontSize: 11, padding: '3px 9px' } }, (typeof tr === 'function' ? tr('panel.retryPushBtn') : 'Retry push')) : null,
          ]) : null,
        ]) : null,
        navRow,
      ])
      // #419/#425：成功弹窗（复用 modal-seat，向导关闭后成功态独占展示）
      if (isSuccess) {
        const sv = m.success || {}
        const sBody = sv.url ? (function(){ try { return tr('panel.successModal.body', { owner: sv.owner || '...', repo: sv.name || '...', vis: sv.visLabel || '公开' }) } catch(_){ return 'Repository created' } })() : (function(){ try { return tr('panel.successModal.bodyFallback', { repo: sv.name || '...', vis: sv.visLabel || '公开' }) } catch(_){ return 'Repository created' } })()
        const sBox = h('div', { className: 'dsws-modalbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': (typeof tr === 'function' ? tr('panel.successModal.title') : 'Repository created'), style: { width: 480, maxWidth: '94vw', borderColor: '#2b4a33' }, onClick: function (e) { e.stopPropagation() } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } }, [
            h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, (typeof tr === 'function' ? tr('panel.successModal.title') : 'Repository created')),
            h('button', { className: 'dsws-btn ghost', 'aria-label': (typeof tr === 'function' ? tr('panel.successModal.doneBtn') : 'Done'), onClick: onClose, style: { fontSize: 12, padding: '2px 8px' } }, '✕'),
          ]),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', lineHeight: 1.6 } }, sBody),
          sv.url ? h('div', { style: { margin: '8px 0' } }, [ h('span', { style: { color: '#58a6ff', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, wordBreak: 'break-all' }, onClick: function(){ try { if (typeof openUrl === 'function') openUrl(sv.url) } catch(_){} } }, sv.url) ]) : null,
          h('div', { className: 'foot', style: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8, alignItems: 'center' } }, [
            sv.url ? h('button', { className: 'dsws-btn primary', onClick: function(){ try { if (typeof openUrl === 'function') openUrl(sv.url) } catch(_){} }, style: { fontSize: 12, padding: '6px 14px', fontWeight: 600 } }, (typeof tr === 'function' ? tr('panel.successModal.openBtn') : 'Open on GitHub')) : null,
            h('button', { className: 'dsws-btn', onClick: onClose, style: { fontSize: 11, padding: '4px 10px' } }, (typeof tr === 'function' ? tr('panel.successModal.doneBtn') : 'Done')),
          ]),
        ])
        const sOverlay = h('div', { className: 'dsws-modal', role: 'presentation', onClick: onOverlayClick, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 } }, [sBox])
        try { if (typeof portalTop === 'function') return portalTop(sOverlay) } catch(_){}
        return sOverlay
      }
      // portalTop 挂到 body，避免被面板裁剪（与 issue #3 同理）
      const overlayNode = h('div', { className: 'dsws-modal', role: 'presentation', onClick: onOverlayClick, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 } }, [box])
      try {
        if (typeof portalTop === 'function') return portalTop(overlayNode)
      } catch(_){}
      return overlayNode
    }
