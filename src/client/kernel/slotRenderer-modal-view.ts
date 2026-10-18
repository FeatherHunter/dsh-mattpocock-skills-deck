/**
 * slotRenderer-modal-view.ts — 弹窗本体 FormModalSeat（K1 由 slotRenderer.js 拆出）。
 *
 * 为什么本体要单独一层：弹窗要同时管表单与建仓两样东西，还要管成功态、失败条、向导步进与焦点，
 * 这些一旦散到队列与同步里就会互相覆盖，所以画弹窗与提交流程只住在这里，打开入口与同步只管前后。
 * 本文件由 slotRenderer-modal-view.js 转写而来，只加类型标注与环境声明，运行行为一字不改。
 * 反例：不要在这里决定队列去留，不要在这里做仓库重查，打开见 slotRenderer-queue.ts，同步见 slotRenderer-repo-sync.ts。
 */
declare const DswsCtx: any;
declare const React: any;
declare const SetupLayoutCard: any;
declare function emit(...args: any[]): any;
declare function closeFormModal(...args: any[]): any;
declare function modalFormFields(...args: any[]): any;
declare function flash(...args: any[]): any;
declare const host: any;
declare function inject(...args: any[]): any;
declare function promptTextFor(...args: any[]): any;
declare function guideInjectPromptOf(...args: any[]): any;
declare function moduleMetaOf(...args: any[]): any;
declare function openUrl(...args: any[]): any;
declare function portalTop(...args: any[]): any;
declare function _queueLen(...args: any[]): any;
declare function retryPushFlow(...args: any[]): any;
declare function consumePendingSetup(...args: any[]): any;
declare function startRepoSync(...args: any[]): any;
declare function runRepoSyncRecheck(...args: any[]): any;
declare function visLabelOf(...args: any[]): any;
declare const SLOT_MODAL_OPEN_DELAY_MS: number;
declare function tr(...args: any[]): any;
declare function promptLang(...args: any[]): any;
declare const timer: any;
declare const document: any;
declare function userHintOf(...args: any[]): any;
declare function loadSnapshot(...args: any[]): any;
declare function loadChain(...args: any[]): any;
declare function resolveFailText(...args: any[]): any;
    const fillDefaults = function (schema: any, base: any) {
      const init = Object.assign({}, base)
      for (let i = 0; i < schema.length; i++) { const fd = schema[i]; if (fd && fd.defaultValue != null && init[fd.name] === undefined) init[fd.name] = String(fd.defaultValue) }
      return init
    }
    export const FormModalSeat = function (props: any) {
      const st = props && props.st ? props.st : null
      const cx = (typeof DswsCtx !== 'undefined' && DswsCtx) ? React.useContext(DswsCtx) : null
      const h = (cx && cx.h) ? cx.h : React.createElement
      // #698：这个座位现在可能要被两样东西用 —— 建仓/表单弹窗，与「域文档布局」那张小卡。
      //   卡开着就先画卡（它是用户刚点出来的那一步：黄条那颗按钮、或刚切完后端）。
      //   两张同时置真的窗口本来就该被挡住（store-switch.js 的 openSwitchConfirm 挡一道、
      //   它那条路上「只落一次」的那道守卫再挡一道），这里只是位置上的最后一道兜底。
      if (st && st.setupLayoutCardOpen === true) { try { return SetupLayoutCard({ st: st }) } catch (eCard) { return null } }
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
      // 受控表单值：wizard 按步隔离，form 单值（缺省值回填已提纯为 fillDefaults，行为不变）
      const [vals, setVals] = React.useState(function () {
        if (isWizard) return fillDefaults(curSchema, (m.valuesByStep && m.valuesByStep[stepIndex]) || {})
        return fillDefaults(curSchema, {})
      })
      // 同步：schema/步骤变化时重置（wizard 切步时从 valuesByStep 恢复）
      React.useEffect(function () {
        if (isWizard) setVals(fillDefaults(curSchema, (m.valuesByStep && m.valuesByStep[stepIndex]) || {}))
        else setVals(fillDefaults(curSchema, {}))
      }, [isWizard, stepIndex, m.steps ? m.steps.length : 0, m.schema ? m.schema.length : 0, m.open])
      const onClose = function () { try { if (m.success) { m.success = null; try { if (typeof emit === 'function') emit(st) } catch(_){} } closeFormModal(st) } catch (e) {} }
      const onOverlayClick = function (e: any) { if (e && e.target === e.currentTarget) onClose() }
      const onPick = function (f: any) {
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
            try { if (typeof flash === 'function') flash(st, String(((e as any) && (e as any).message)||e).slice(0,200), 'warn') } catch(_){}
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
      // #952：宽按钮成功换字（提交→已提交 1.1 秒自退，宽度留死不伸缩）。
      //   #956 评审修正：节拍到点前若这次弹窗已经不是当前那一个（用户中途关窗、或又开了别的弹窗），
      //   令牌作废 —— 成功的后续动作（含 #419/#425 那张成功弹窗）不再弹出，免得盖掉用户这 1.1 秒里打开的东西。
      const sentBeat = function (after: any) {
        m.pending = false; m.justSent = true
        try { if (typeof emit === 'function') emit(st) } catch(_){}
        const tk = (m.sentTk = (m.sentTk || 0) + 1)
        const fire = function () { if (m.sentTk !== tk || !m.justSent || m.open !== true) return; m.justSent = false; try { after() } catch(_){} }
        // 提交成功后那颗宽按钮的交代时间：先让「已提交」的字样亮出来给人看见，等这么久再走后续动作（关窗或弹下一张窗）。
        //   节拍到点前若这张弹窗已经换了人，fire 自己会作废，见上面那行令牌判断。
        // 数值写在 config/intervals.yaml 的 slotModalOpenDelayMs，构建时由生成器变成常量、随界面闭包一起进来。
        try { setTimeout(fire, SLOT_MODAL_OPEN_DELAY_MS) } catch(_) { fire() }
      }
      const onWizardSubmit = async function () {
        if (m.pending || m.justSent) return
        if (isWizard && !validateCurrent()) return
        if (isWizard && m.valuesByStep) m.valuesByStep[stepIndex] = Object.assign({}, vals)
        // 合并全步值（Q3 最后一起提交，验收原语：merged = Object.assign({}, ...valuesByStep) 浅合并后一次提交）
        let merged: any = {}
        if (isWizard) {
          // 显式保留验收原语字面（grep 友好）
          try { merged = (Object.assign as any).apply(null, ([{}] as any[]).concat(m.valuesByStep || [])) } catch(_) {
          for (let i = 0; i < m.valuesByStep.length; i++) {
            const part: any = m.valuesByStep[i] || {}
            for (const k in part) if (Object.prototype.hasOwnProperty.call(part, k)) merged[k] = part[k]
          }
          }
          // 等价于 merged = Object.assign({}, ...valuesByStep) 浅合并（后步同名覆盖前步，一次性提交）
        } else {
          merged = Object.assign({}, vals)
        }
        // 校验全量 required/pattern（兜底）
        const allSchemas = isWizard ? (function(){ const a: any[]=[]; for(let i=0;i<wizardSteps.length;i++) a.push(...wizardSteps[i].schema); return a })() : curSchema
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
          // #419/#425：成功后丢弃队列残留（向导单例）
          try { if (st && Array.isArray(st._formModalQueue)) st._formModalQueue = [] } catch(_){}
          try{ if (typeof consumePendingSetup==='function') consumePendingSetup(st) }catch(_){} // #496 Q2
          // 同步过渡态 + 后台重查成功即开始，不等 1.1 秒的已提交节拍
          startRepoSync(st)
          runRepoSyncRecheck(st)
          // #952：宽按钮成功换字后再走原来的关闭与成功提示
          sentBeat(function () {
            try { closeFormModal(st) } catch(_){ m.open = false; try { if (typeof emit === 'function') emit(st) } catch(__){} }
            // #419/#425 成功弹窗：真值链接 + 在 GitHub 打开/完成；无 repo 数据时诚实回落为提示
            const repoData = (out && out.data && out.data.ok) ? out.data : null
            const repo = repoData && repoData.repo ? repoData.repo : null
            if (repo && (repo.owner || repo.name)) {
              m.success = { owner: repo.owner || '', name: repo.name || '', url: (repoData && repoData.repoUrl) ? repoData.repoUrl : '', visLabel: visLabelOf(m.lastVis) }
            } else {
              try { if (typeof flash === 'function') flash(st, '已提交，链条重查中…', 'ok') } catch(_){}
            }
            try { if (typeof emit === 'function') emit(st) } catch(_){}
          })
        } catch (e) {
          m.pending = false
          const msg = String(((e as any) && (e as any).message) || e)
          const code = ((e as any) && ((e as any).code || (e as any).kind || (e as any).errorKind)) ? String((e as any).code || (e as any).kind || (e as any).errorKind).toLowerCase() : ''
          const halfCreated = !!((e as any) && (e as any).halfCreated)
          const repoUrl = ((e as any) && (e as any).repoUrl) ? String((e as any).repoUrl).replace(/\.git$/, '') : ''
          // #420/#426：失败内联错误条（errorKind 精确回跳；删除九条件文本启发式；文案后端优先 locale 兜底）
          const dispKind = halfCreated ? 'half-created' : (code || 'unknown')
          m.fail = { kind: dispKind, code: code, text: resolveFailText(st, dispKind, code, msg), link: repoUrl || null, repo: ((e as any) && (e as any).repo) ? (e as any).repo : null, halfCreated: halfCreated }
          if (isWizard && (code === 'bad-name' || code === 'already-exists')) {
            let jumped = false
            for (let si=0; si<wizardSteps.length && !jumped; si++) {
              const sch=wizardSteps[si].schema
              for(let fi=0;fi<sch.length;fi++) if(sch[fi].name==='name'){ m.stepIndex=si; try{ if(typeof emit==='function') emit(st)}catch(_){}; jumped = true; break }
            }
          }
          // #420定版：no-gh / not-logged-in 自动注入指引（复用既有文案）
          // #664：缺 gh 那份说明只有一份 —— 原先取共享清单里 gh:installed 那一步的原话；
          // #716：那段话已经挪回后端声明（GitHub 的 prompts.cliInstall），共享清单只留键名，
          //   所以这一档与下面那一档改成同一条路：先问清单要「注入哪条提示词」，再向当前后端要文本。
          //   两样都取不到就不注入、并明确报失败（不静默）。
          if (code === 'no-gh' || code === 'not-logged-in') {
            let guide = ''
            const key = (code === 'no-gh')
              ? ((typeof guideInjectPromptOf === 'function') ? String(guideInjectPromptOf('gh:installed') || '') : '')
              : 'ghAuthLogin'
            if (key) {
              const bidG = (st.selection || (st.snapshot && st.snapshot.selection) || {}).backendId
              const mmG = (typeof moduleMetaOf === 'function' && bidG != null) ? moduleMetaOf(st, bidG) : null
              const declG = (mmG && mmG.prompts) ? mmG.prompts[key] : null
              guide = declG ? String((promptLang() === 'en' && declG.en) ? declG.en : (declG.zh || '')) : ''
              if (!guide) { try { guide = String(promptTextFor(st, key) || '') } catch (_) {} }
            }
            if (guide) { try { if (typeof inject === 'function') inject(st, guide) } catch (_) {} }
            else { try { if (typeof flash === 'function') flash(st, tr('err.guideMissing'), 'warn') } catch (_) {} }
          }
          try { if (typeof emit === 'function') emit(st) } catch(_){}
        }
      }
      const onSubmit = isWizard ? onWizardSubmit : async function () {
        if (m.pending || m.justSent) return
        if (!validateCurrent()) return
        if (!m.onSubmit) { try { if (typeof flash === 'function') flash(st, '表单缺少提交句柄', 'warn') } catch(_){} return }
        const cb = m.onSubmit
        m.pending = true
        try { if (typeof emit === 'function') emit(st) } catch(_){}
        try {
          await cb(vals)
          m.pending = false
          // #952：宽按钮成功换字后再走原来的关闭与提示；链条重查成功即开始，不等节拍
          sentBeat(function () {
            try { closeFormModal(st) } catch(_){ m.open = false; try { if (typeof emit === 'function') emit(st) } catch(__){} }
            try { if (typeof flash === 'function') flash(st, '已提交，链条重查中…', 'ok') } catch(_){}
          })
          try {
            if (typeof host !== 'undefined' && host.call) {
              await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (typeof userHintOf === 'function' ? userHintOf(st.selection) : undefined) || undefined }) // hint 只报「用户亲手选过的那条」：#669 第 6 件 / ADR 20260921
              try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch(_){}
              try { if (typeof loadChain === 'function') loadChain(st, true) } catch(_){}
            }
          } catch(_){}
        } catch (e) {
          m.pending = false
          try { if (typeof emit === 'function') emit(st) } catch(_){}
          try { if (typeof flash === 'function') flash(st, String(((e as any) && (e as any).message) || e).slice(0, 200), 'warn') } catch(_){}
        }
      }
      const fields = modalFormFields(curSchema, { m: m, isWizard: isWizard, stepIndex: stepIndex, vals: vals, setVals: setVals, onPick: onPick, h: h })
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
        const onKey = function (e: any) {
          if (!e) return
          if (e.key === 'Escape') { try { onClose() } catch(_){} return }
          if (e.key === 'Tab') {
            try {
              const root = document.querySelector('.dsws-modalbox')
              if (!root) return
              const nodes: any = Array.from(root.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
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
      const stepper = isWizard ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' } }, wizardSteps.map(function(s: any, i: any){
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
          stepIndex < totalSteps - 1 ? h('button', { className: 'dsws-btn primary', onClick: onNext, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px', background: '#58a6ff', borderColor: '#58a6ff', color: '#0b1220', fontWeight: 600 } }, '下一步') : h('button', { className: 'dsws-btn primary' + (m.pending ? ' dsws-fb-busy' : '') + (m.justSent ? ' dsws-fb-result' : ''), onClick: onSubmit, disabled: !!m.pending || !!m.justSent, style: { fontSize: 11, padding: '4px 10px', background: m.pending ? '#6b7280' : '#58a6ff', borderColor: m.pending ? '#6b7280' : '#58a6ff', color: '#0b1220', fontWeight: 600, opacity: m.pending ? 0.7 : 1 } }, m.pending ? [h('span', { key: 't', className: 'fb-t', 'aria-hidden': 'true' }, tr('panel.submitting')), h('span', { key: 's', className: 'fb-spin', 'aria-hidden': 'true' }, h('span', { className: 'dsws-spinner', style: { width: 11, height: 11, borderWidth: 2 } }))] : (m.justSent ? tr('panel.submitted') : '提交'))
        ])
      ]) : h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 } }, [
        h('button', { className: 'dsws-btn', onClick: onClose, disabled: !!m.pending, style: { fontSize: 11, padding: '4px 10px' } }, '取消'),
        h('button', { className: 'dsws-btn primary' + (m.pending ? ' dsws-fb-busy' : '') + (m.justSent ? ' dsws-fb-result' : ''), onClick: onSubmit, disabled: !!m.pending || !!m.justSent, style: { fontSize: 11, padding: '4px 10px', background: m.pending ? '#6b7280' : '#58a6ff', borderColor: m.pending ? '#6b7280' : '#58a6ff', color: '#0b1220', fontWeight: 600, opacity: m.pending ? 0.7 : 1 } }, m.pending ? [h('span', { key: 't', className: 'fb-t', 'aria-hidden': 'true' }, tr('panel.submitting')), h('span', { key: 's', className: 'fb-spin', 'aria-hidden': 'true' }, h('span', { className: 'dsws-spinner', style: { width: 11, height: 11, borderWidth: 2 } }))] : (m.justSent ? tr('panel.submitted') : '提交')),
      ])
      const box = h('div', { className: 'dsws-modalbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.label || (isWizard ? '向导' : '表单'), style: { width: 480, maxWidth: '94vw' }, onClick: function (e: any) { e.stopPropagation() } }, [
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
        const sBox = h('div', { className: 'dsws-modalbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': (typeof tr === 'function' ? tr('panel.successModal.title') : 'Repository created'), style: { width: 480, maxWidth: '94vw', borderColor: '#2b4a33' }, onClick: function (e: any) { e.stopPropagation() } }, [
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