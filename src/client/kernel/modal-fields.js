/**
 * kernel/modal-fields.js 鈥?寮圭獥琛ㄥ崟閲岄偅涓€涓插瓧娈电殑娓叉煋锛?698 鐢?slotRenderer-modal-view.js 鎷嗗嚭锛夈€? *
 * 涓轰粈涔堟媶锛氶偅涓枃浠跺湪銆屽竷灞€灏忓崱鎼繘寮圭獥搴т綅銆嶄箣鍚庡埌浜?404 琛岋紝瓒呬簡 350 琛屼笂闄愶紙闂ㄧ
 *   tests/verify-file-granularity.js 鏄浂澧為暱鍩虹嚎锛屼笉璁哥暀瓒呮爣鏂囦欢锛夈€傛惉鍑烘潵鐨勮繖涓€鍧椾笌寮圭獥鐨? *   鍏朵綑閮ㄥ垎鍑犱箮娌℃湁鍏崇郴 鈥斺€?瀹冨彧绠°€屾妸 schema 閲屾瘡涓瓧娈电敾鎴愪竴琛屾帶浠躲€嶏紝璋佹潵鐢汇€佷粈涔堟椂鍊欑敾瀹冧笉鍏冲績銆? *
 * 濂戠害锛氬唴鏍告ā鍧楋紙scripts/build.mjs 鐨?KERNEL_MODULES 鐧昏锛宮arker kernel:modalFields 鎷煎洖
 *   src/client/index.js 鐨?apply 闂寘鍐呭師浣嶏級锛涚函鍑芥暟锛屼笉璇讳細璇濈姸鎬併€佷笉纰伴棴鍖呴噷鐨勪笢瑗匡紝
 *   闇€瑕佺殑涓€鍒囬兘浠?ctx 浼犺繘鏉ャ€備互鍚庤皝鏀瑰畠锛氭敼寮圭獥瀛楁闀夸粈涔堟牱锛堝崟閫夈€佸閫夈€佹枃鏈銆佽矾寰勯€夋嫨銆侀瑙堣锛夌殑浜恒€? *
 * @param {Array<Object>} curSchema 褰撳墠杩欎竴姝ョ殑瀛楁澹版槑锛坵izard 鍙栧綋鍓嶆锛屾櫘閫氳〃鍗曞彇鍏ㄩ儴锛? * @param {Object} ctx 娓叉煋杩欎釜瀛楁鎵€闇€鐨勫叏閮ㄨ緭鍏ワ細
 *   m 寮圭獥鐘舵€侊紙璇?m.pending 鍐冲畾鎺т欢鏄惁绂佺敤锛夈€乮sWizard銆乻tepIndex銆乿als 鍙楁帶鍊笺€乻etVals 鍐欏€笺€? *   onPick 璺緞閫夋嫨鍣ㄧ殑鐐瑰嚮澶勭悊銆乭 鍒涘缓鍏冪礌鐨勫嚱鏁? * @returns {Array} 涓€缁?React 鍏冪礌锛屼緵寮圭獥姝ｆ枃鐩存帴閾哄紑
 */
export const modalFormFields = function (curSchema, ctx) {
  const m = ctx.m, isWizard = ctx.isWizard, stepIndex = ctx.stepIndex, vals = ctx.vals, setVals = ctx.setVals, onPick = ctx.onPick, h = ctx.h
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
  return fields
}
