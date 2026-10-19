/**
 * kernel/modal-fields.ts — 弹窗表单里那一串字段的渲染（#698 由 slotRenderer-modal-view.ts 拆出）。
 *
 * 为什么拆：那个文件在布局小卡搬进弹窗座位之后到了 404 行，超了 350 行上限
 *   （门禁 tests/verify-file-granularity.ts 是零增长基线，不许留超标文件）。搬出来的这一块与弹窗的
 *   其余部分几乎没有关系 —— 它只管把 schema 里每个字段画成一行控件，谁来画、什么时候画它不关心。
 * 契约：内核模块（scripts/build.mts 的 KERNEL_MODULES 登记，marker kernel:modalFields 拼回
 *   src/client/index.ts 的 apply 闭包内原位）；纯函数，不读会话状态、不碰闭包里的东西，
 *   需要的一切都以 ctx 传进来。以后谁改它：改弹窗字段长什么样（单选、多选、文本框、路径选择、预览行）的人。
 * 本文件由 modal-fields.js 转写而来，只加类型标注，运行行为一字不改。
 * 反例：不要在这里读弹窗开关或提交状态，不要在这里直接调 emit 或 host。
 */
export const modalFormFields = function (curSchema: any, ctx: any): any {
  const m: any = ctx.m, isWizard: any = ctx.isWizard, stepIndex: any = ctx.stepIndex, vals: any = ctx.vals, setVals: any = ctx.setVals, onPick: any = ctx.onPick, h: any = ctx.h
      const fields: any = curSchema.map(function (f: any, idx: any): any {
        const id: string = 'modal-form-' + String(f.name || idx) + (isWizard ? '-s' + stepIndex : '')
        const rawLabel: any = (f && (f.label || f.labelKey)) || (f && f.name) || String(idx)
        const label: string = typeof rawLabel === 'object' && rawLabel !== null ? (rawLabel.zh || rawLabel.en || String(rawLabel)) : String(rawLabel)
        const placeholder: string = (function(): string {
          const ph: any = (f && (f.placeholder || f.placeholderKey)) || ''
          return typeof ph === 'object' && ph !== null ? (ph.zh || ph.en || String(ph)) : String(ph)
        })()
        const isSingle: any = f && f.type === 'single'
        const isMulti: any = f && f.type === 'multi'
        const isDirectory: any = f && f.type === 'directory'
        const isFile: any = f && f.type === 'file'
        const isPicker: any = isDirectory || isFile
        if (isPicker) {
          return h('div', { key: f.name || idx, style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 } }, [
            h('label', { htmlFor: id, style: { fontSize: 11, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 } }, [ h('span', null, label), f && f.required ? h('span', { style: { color: '#f87171' } }, '*') : null ]),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
              h('input', { id: id, type: 'text', value: String(vals[f.name] || ''), placeholder: placeholder || (isDirectory ? '请选择目录或手动输入' : '请选择文件或手动输入'), disabled: !!m.pending, onChange: function (e: any): void { const nxt: any = Object.assign({}, vals); nxt[f.name] = e.target.value; setVals(nxt) }, style: { flex: 1, minWidth: 0, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)' } }),
              h('button', { type: 'button', className: 'dsws-btn', disabled: !!m.pending, onClick: onPick(f), style: { fontSize: 11, padding: '4px 10px', flex: 'none' } }, isDirectory ? '浏览目录…' : '浏览文件…')
            ]),
          ])
        }
        return h('div', { key: f.name || idx, style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 } }, [
          h('label', { htmlFor: id, style: { fontSize: 11, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 } }, [ h('span', null, label), f && f.required ? h('span', { style: { color: '#f87171' } }, '*') : null ]),
          isSingle ? h('div', { style: { display: 'flex', gap: 8 } }, (f.options || []).map(function (opt: any): any {
            const active: boolean = String(vals[f.name] || '') === String(opt)
            return h('label', { key: opt, role: 'radio', tabIndex: m.pending ? -1 : 0, 'aria-checked': active ? 'true' : 'false', 'aria-label': String(opt), onClick: function(): void { if(m.pending) return; const nxt: any = Object.assign({}, vals); nxt[f.name] = String(opt); setVals(nxt); if(isWizard && m.valuesByStep && m.valuesByStep[stepIndex]) m.valuesByStep[stepIndex] = Object.assign({}, nxt); }, onKeyDown: function(e: any): void { const k: any = e && e.key; if(k===' '||k==='Enter'||k==='Spacebar'||k==='Space'){ try{ if(e.preventDefault) e.preventDefault() }catch(_){} if(m.pending) return; const nxt: any = Object.assign({}, vals); nxt[f.name] = String(opt); setVals(nxt); if(isWizard && m.valuesByStep && m.valuesByStep[stepIndex]) m.valuesByStep[stepIndex] = Object.assign({}, nxt); } }, style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 8px', border: '1px solid ' + (active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-border-l1,#2a2d35)'), borderRadius: 10, background: active ? 'rgba(192,132,252,.08)' : 'var(--dsw-alias-bg-layer-2,#16181d)', color: active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: m.pending ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', transition: 'border-color .12s,background .12s', opacity: m.pending ? 0.6 : 1 } }, [
              h('span', { style: { width: 13, height: 13, borderRadius: '50%', border: '1.5px solid ' + (active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-border-l2,#3a3f4a)'), flex: 'none', display: 'grid', placeItems: 'center' } }, active ? h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: 'var(--dsw-alias-interactive-bg-primary,#c084fc)' } }) : null),
              h('span', null, String(opt)),
              (f.optionSubs && f.optionSubs[opt]) ? h('span', { style: { fontSize: 11, color: (active ? 'var(--dsw-alias-interactive-bg-primary,#c084fc)' : 'var(--dsw-alias-label-caption,#8b8b95)'), fontWeight: 400, whiteSpace: 'nowrap' } }, typeof f.optionSubs[opt] === 'object' ? (f.optionSubs[opt].zh || f.optionSubs[opt].en || String(f.optionSubs[opt])) : String(f.optionSubs[opt])) : null,
            ])
          })) : isMulti ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, (f.options || []).map(function (opt: any): any {
            const checked: boolean = Array.isArray(vals[f.name]) ? vals[f.name].indexOf(opt) >= 0 : false
            return h('label', { key: opt, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, border: '1px solid #2a2d35', borderRadius: 6, padding: '2px 6px', cursor: m.pending ? 'not-allowed' : 'pointer', background: checked ? 'rgba(88,166,255,.12)' : 'transparent', opacity: m.pending ? 0.6 : 1 } }, [
              h('input', { type: 'checkbox', checked: checked, disabled: !!m.pending, onChange: function (e: any): void { const arr: any[] = Array.isArray(vals[f.name]) ? vals[f.name].slice() : []; if (e.target.checked) { if (arr.indexOf(opt) < 0) arr.push(opt) } else { const p: number = arr.indexOf(opt); if (p >= 0) arr.splice(p, 1) } const nxt: any = Object.assign({}, vals); nxt[f.name] = arr; setVals(nxt) } }),
              h('span', null, opt)
            ])
          })) : h('input', { id: id, type: f && f.type === 'number' ? 'number' : f && f.type === 'date' ? 'date' : 'text', value: String(vals[f.name] || ''), placeholder: placeholder, disabled: !!m.pending, onChange: function (e: any): void { const nxt: any = Object.assign({}, vals); nxt[f.name] = e.target.value; setVals(nxt) }, style: { fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)' } }),
          (f && typeof f.preview === 'string' && f.preview) ? h('div', { style: { fontSize: 12, fontWeight: 500, color: '#58a6ff', marginTop: 2, wordBreak: 'break-all', letterSpacing: '.01em', lineHeight: 1.5 } }, [
            h('span', null, String(f.preview).replace(/\{owner\}/g, 'owner').replace(/\{name\}/g, String(vals[f.name] || '').trim() || '...')),
          ]) : null,
        ])
      })
  return fields
}
