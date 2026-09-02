/**
 * views/shared/ChainRenderer.js — 通用链渲染器（#228 D5+D9 落地）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:chainRenderer (spliced by build) ====` 标记处（一源两物）。
 *
 * 生效日期：2026-08-28
 * 效力规则：本文件以 #224 v2 + #226 + #228 规约为基线；与更早方案冲突以本规约为准；
 *           未来任何定版方案若改动本规约，以未来版本为准（见 CONTEXT.md「版本与效力」）。
 *
 * 第一性原理（#217 + #224 D3/D5/D6）：
 *  - 检查项 = {check, onPass:{show,actions}, onFail:{show,actions}} 只驱动 UI，不进数据路径；
 *  - 链条 = 有序检查项，前步通过才进下一步；推进只来自重求值；
 *  - 动作词汇表 v1 五种：inject-prompt / open-url / rpc / form / refresh；未知 = 诚实 unsupported；
 *  - 三段式：开门 > 仓库就绪 > 环境；banner 同源互斥，42px，Tab 可达。
 *
 * 本模块为 UI 层通用渲染器：喂 ChainSnapshot（契约层 chain.js 纯函数产出）→ 吐 DOM；
 * 不识别后端，不分支 backendId；只读 snapshot，不写状态。
 * 形态：banner-seat 单条（current 唯一）+ steps 步进条 + actions 按钮组 + form 内嵌。
 */
    // deps 均在 apply 闭包内解析（React/DswsCtx/createActionDispatcher/host/inject/openUrl 均为闭包自由变量）；此处仅挂形状
    export const CHAIN_RENDERER_VERSION = 1

    // 展示等级 → banner 样式（D9 意图先行 + 既有 UI 约束保留：互斥、42px、Tab 可达）
    function levelToClass(level) {
      const s = String(level || '').trim().toLowerCase()
      if (s === 'bad' || s === 'error') return 'bad'
      if (s === 'warn' || s === 'warning') return 'warn'
      // info / ok → 蓝条（#228 规约 D9 蓝/黄/红同源；info 蓝色，warn 黄，bad 红；保留既有 .dsws-banner.ok 为绿，单独映射 info→蓝色内联）
      return 'info'
    }
    function levelToStyle(level) {
      const k = levelToClass(level)
      if (k === 'warn') return { background: 'rgba(245,158,11,.12)', borderColor: 'rgba(245,158,11,.45)', color: '#f59e0b' }
      if (k === 'bad') return { background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.45)', color: '#f87171' }
      // info 蓝条 42px 满宽（D9）
      return { background: 'rgba(56,139,253,.10)', border: '1px solid rgba(56,139,253,.35)', color: '#58a6ff' }
    }

    // 单个动作按钮（五种类型 + unknown unsupported）
    function ActionButton({ action, dispatcher, st }) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const t = action && action.type
      // 已知类型的按钮文案（i18n 单源，失败也透传 fallback）
      // 按钮文案：label 优先（host 组装时由后端 fixes 解析成双语短词）；无 label 用 UI 通用词（动作类型是契约词汇表，UI 按类型给通用文案合法）
      const labelMap = {
        'inject-prompt': (action.label) || '注入修复指引',
        'open-url': '打开链接',
        'rpc': (action.method || action.endpoint || '执行'),
        'form': (action.label) || '填写表单',
        'refresh': '重查',
      }
      const label = labelMap[t] || ('unsupported: ' + String(t||'unknown'))
      const isUnsupported = !labelMap[t]
      // 可达性：Tab 可达 + Enter/Space
      const onClick = async function() {
        if (isUnsupported) { try{ flash(st, '未知动作类型：' + String(t), 'warn') }catch(e){} return }
        try{
          const res = await dispatcher.dispatch(action)
          if (!res.ok) {
            const kind = res.error && res.error.kind
            if (kind === 'unsupported') { try{ flash(st, '不支持的动作：' + String(t), 'warn') }catch(e){} }
            else { try{ flash(st, String(res.error && res.error.message || '动作失败'), 'warn') }catch(e){} }
          } else {
            // 推进只来自重求值：动作成功后触发 refresh 侧的轮询/快照刷新（由 dispatcher 的 ctx.refresh 接入）
            // 注入类动作不自动 refresh，由用户或轮询驱动；rpc/form/refresh 由 dispatcher 内部已触发 refresh
          }
        }catch(e){
          try{ flash(st, String((e && e.message)||e).slice(0,200), 'warn') }catch(_){}
        }
      }
      if (isUnsupported) {
        return h(Tip, { content: tr('tip.unsupportedAction') }, h('span', { className:'dsws-chain-unsupported', style:{ fontSize:10, color:'#8b8b95', border:'1px dashed rgba(139,139,149,.45)', borderRadius:4, padding:'1px 6px', display:'inline-flex', alignItems:'center' } }, label))
      }
      return h('button', { className:'dsws-btn', tabIndex:0, onClick:onClick, onKeyDown:function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onClick() } }, style:{ fontSize:11, padding:'2px 8px', display:'inline-flex', alignItems:'center', gap:4, flex:'none' } }, label)
    }

    // 内嵌表单渲染器（form 动作：schema → 字段 → 提交 RPC → 重求值）
    function ChainForm({ action, dispatcher, st }) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const schema = action.schema || action.fields || (action.form && action.form.fields) || []
      const [vals, setVals] = React.useState(function(){
        const init = {}
        for (let i=0;i<schema.length;i++){ const f=schema[i]; if(f.defaultValue != null) init[f.name]=String(f.defaultValue) }
        return init
      })
      const submitAction = action.submitAction || action.submit || (action.form && action.form.submit)
      const onSubmit = async function(){
        // 校验 required
        for (let i=0;i<schema.length;i++){
          const f=schema[i]
          if (f.required && !String(vals[f.name]||'').trim()) { try{ flash(st, String(f.label||f.name)+' 必填', 'warn') }catch(e){}; return }
          if (f.pattern) { try{ const re=new RegExp(f.pattern); if(!re.test(String(vals[f.name]||''))){ try{ flash(st, String(f.label||f.name)+' 格式不正确', 'warn') }catch(e){}; return } }catch(e){} }
        }
        if (!submitAction) { try{ flash(st, '表单缺少 submitAction', 'warn') }catch(e){}; return }
        // 合并表单值到 submitAction 的 params/args
        const merged = Object.assign({}, submitAction)
        const base = merged.params !== undefined ? merged.params : merged.args
        if (merged.type === 'inject-prompt') {
          merged.args = Object.assign({}, merged.args || merged.params || {}, vals)
        } else {
          merged.params = Object.assign({}, base || {}, vals)
          if (submitAction.args) merged.args = merged.params
        }
        try{
          const res = await dispatcher.dispatch(merged)
          if (!res.ok) { try{ flash(st, String(res.error.message||'提交失败'), 'warn') }catch(e){} }
          else {
            // 成功后由宿主重求值推进（dispatcher 的 rpc 已触发或 refresh 将触发轮询）
            try{ flash(st, '已提交，链条重查中…', 'ok') }catch(e){}
            // 主动触发一次重求值（接入现有探测/轮询/快照刷新机制：st.refresh 或 host.call('wf.detect', {force:true})）
            try{
              if (dispatcher && dispatcher._refresh) await dispatcher._refresh()
              else if (typeof host !== 'undefined' && host.call) { await host.call('wf.detect', { cwd: st.cwd||'', force:true, backendId:(st.selection&&st.selection.backendId)||undefined }); if(st.cwd) { try{ loadSnapshot(st,true,true) }catch(e){}; try{ loadChain(st,true) }catch(e){} } }
            }catch(e){}
          }
        }catch(e){ try{ flash(st, String((e&&e.message)||e).slice(0,200), 'warn') }catch(_){} }
      }
      const fields = schema.map(function(f, idx){
        const id = 'chain-form-' + String(action.type||'form') + '-' + String(f.name||idx)
        const label = f.label || f.labelKey || f.name
        const placeholder = f.placeholder || f.placeholderKey || ''
        const isSingle = f.type === 'single'
        const isMulti = f.type === 'multi'
        return h('div', { key:f.name||idx, style:{ display:'flex', flexDirection:'column', gap:4, marginBottom:6 } }, [
          h('label', { htmlFor:id, style:{ fontSize:11, color:'#a1a1aa', display:'flex', alignItems:'center', gap:4 } }, [ h('span', null, label), f.required ? h('span', { style:{ color:'#f87171' } }, '*'):null ]),
          isSingle ? h('select', { id:id, value: String(vals[f.name]||''), onChange:function(e){ const nxt = Object.assign({}, vals); nxt[f.name]=e.target.value; setVals(nxt) }, style:{ fontSize:12, padding:'4px 8px', borderRadius:6, border:'1px solid #2a2d35', background:'#10131a', color:'#e6edf3' } }, [
            h('option', { value:'' }, placeholder || '请选择'),
            ...(f.options||[]).map(function(opt){ return h('option', { key:opt, value:opt }, opt) })
          ]) : isMulti ? h('div', { style:{ display:'flex', flexWrap:'wrap', gap:4 } }, (f.options||[]).map(function(opt){
            const checked = Array.isArray(vals[f.name]) ? vals[f.name].indexOf(opt)>=0 : false
            return h('label', { key:opt, style:{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, border:'1px solid #2a2d35', borderRadius:6, padding:'2px 6px', cursor:'pointer', background: checked?'rgba(88,166,255,.12)':'transparent' } }, [
              h('input', { type:'checkbox', checked:checked, onChange:function(e){ const arr = Array.isArray(vals[f.name]) ? vals[f.name].slice() : []; if(e.target.checked){ if(arr.indexOf(opt)<0) arr.push(opt) } else { const p=arr.indexOf(opt); if(p>=0) arr.splice(p,1) } const nxt=Object.assign({}, vals); nxt[f.name]=arr; setVals(nxt) } }),
              h('span', null, opt)
            ])
          })) : h('input', { id:id, type: f.type==='number'?'number': f.type==='date'?'date':'text', value: String(vals[f.name]||''), placeholder:placeholder, onChange:function(e){ const nxt=Object.assign({}, vals); nxt[f.name]=e.target.value; setVals(nxt) }, style:{ fontSize:12, padding:'4px 8px', borderRadius:6, border:'1px solid #2a2d35', background:'#10131a', color:'#e6edf3' } }),
        ])
      })
      return h('div', { className:'dsws-chain-form', style:{ border:'1px solid rgba(255,255,255,.08)', borderRadius:8, padding:'10px 12px', background:'rgba(255,255,255,.02)', marginTop:8 } }, [
        ...fields,
        h('div', { style:{ display:'flex', gap:6, justifyContent:'flex-end', marginTop:6 } }, [
          h('button', { className:'dsws-btn', onClick:function(){ const init={}; for(let i=0;i<schema.length;i++){ const f=schema[i]; if(f.defaultValue!=null) init[f.name]=String(f.defaultValue); else init[f.name]=''} setVals(init) }, style:{ fontSize:11, padding:'2px 8px' } }, '重置'),
          h('button', { className:'dsws-btn primary', onClick:onSubmit, style:{ fontSize:11, padding:'2px 10px', background:'#58a6ff', borderColor:'#58a6ff', color:'#0b1220', fontWeight:600 } }, '提交'),
        ]),
      ])
    }

    // 步进条（每步 done/current/fail/pending；#228 验收：蓝/黄/红条同源渲染，互斥、42px、Tab 可达）
    function ChainSteps({ snapshot }) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      if (!snapshot || !Array.isArray(snapshot.steps) || !snapshot.steps.length) return null
      const steps = snapshot.steps
      return h('div', { className:'dsws-chain-steps', style:{ display:'flex', alignItems:'center', gap:6, padding:'6px 8px', overflowX:'auto', borderBottom:'1px solid rgba(255,255,255,.06)', marginBottom:6 } }, steps.map(function(s, idx){
        const status = s.status
        const isDone = status==='done'
        const isCurrent = s.isCurrent || status==='current'
        const isFail = status==='fail'
        const isPending = status==='pending'
        const bg = isDone ? '#16a34a' : isCurrent ? '#f59e0b' : isFail ? '#ef4444' : '#6b7280'
        const border = isCurrent ? '2px solid #f59e0b' : '1px solid transparent'
        const title = (s.show && (s.show.fallback || s.show.title || s.show.i18nKey)) || s.id
        const detail = (s.show && (s.show.desc || '')) || ''
        return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.milestone', { idx: idx + 1 })), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, title + (detail ? ' — ' + detail : '')), h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px', marginTop: 2 } }, tr('tip.milestoneLocate'))]) }, h('div', { key:s.id||idx, tabIndex:0, style:{ display:'flex', alignItems:'center', gap:6, flex:'none', border:border, borderRadius:20, padding:'2px 8px 2px 4px', background: isCurrent?'rgba(245,158,11,.12)':'rgba(255,255,255,.04)', minHeight:24 } }, [
          h('span', { style:{ width:18, height:18, borderRadius:'50%', background:bg, color:'#fff', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flex:'none' } }, isDone ? '✓' : String(idx+1)),
          h('span', { style:{ fontSize:11, color: isDone?'#4ade80': isFail?'#f87171': isCurrent?'#f59e0b':'#a1a1aa', whiteSpace:'nowrap', maxWidth:120, overflow:'hidden', textOverflow:'ellipsis' } }, title),
        ]))
      }))
    }

    // Banner 座位：current 唯一（互斥 42px，#221 D9 banner-seat 语义，#228 现按现有横幅位置渲染）
    export const ChainBanner = function({ snapshot, dispatcher, st }) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      if (!snapshot || !Array.isArray(snapshot.steps)) return null
      const curIdx = snapshot.currentIndex
      const curStep = (curIdx!=null && snapshot.steps[curIdx]) ? snapshot.steps[curIdx] : null
      // 优先 current（pending/fail 高亮），否则展示第一个 fail（无 current 时）
      let step = curStep
      if (!step) {
        // 空链或全 done：不占位（#218 空链 mounted 语义）
        if (!snapshot.steps.length || snapshot.chainState==='allDone') return null
        step = snapshot.steps.find(function(s){ return s.status==='fail' }) || null
        if (!step) return null
      }
      const show = step.show || {}
      const title = show.fallback || show.title || show.i18nKey || step.id || ''
      const desc = show.desc || ''
      const level = show.level || (step.status==='fail' ? 'bad' : step.status==='pending' ? 'warn' : 'info')
      const styleBase = levelToStyle(level)
      const actions = Array.isArray(step.actions) ? step.actions : []
      // 区分 form 动作单独渲染表单（#228 验收：给定链数据渲染出对应横幅/表单）
      const formActions = actions.filter(function(a){ return a && a.type==='form' })
      const otherActions = actions.filter(function(a){ return !a || a.type!=='form' })
      const unsupported = actions.filter(function(a){ return a && ['inject-prompt','open-url','rpc','form','refresh'].indexOf(String(a.type))<0 })
      return h('div', { className:'dsws-banner dsws-chain-banner dsws-chain-banner--' + levelToClass(level), tabIndex:0, role:'status', 'aria-live':'polite', 'aria-label': title, style: Object.assign({}, styleBase, { display:'flex', alignItems:'center', gap:8, borderRadius:8, padding:'6px 10px', minHeight:42, maxHeight:42, height:42, margin:'6px 0', cursor:'default', flex:'none', overflow:'hidden' }) }, [
        h('span', { style:{ width:8, height:8, borderRadius:'50%', background: levelToClass(level)==='bad'?'#ef4444': levelToClass(level)==='warn'?'#f59e0b':'#58a6ff', display:'inline-block', flex:'none' } }),
        h('span', { style:{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12, fontWeight:600 } }, title + (desc ? ' — ' + String(desc).slice(0,120) : '')),
        ...otherActions.map(function(a, i){ return h(ActionButton, { key:'act-'+i, action:a, dispatcher:dispatcher, st:st }) }),
        ...(unsupported.length ? unsupported.map(function(a,i){ return h(ActionButton, { key:'unsup-'+i, action:a, dispatcher:dispatcher, st:st }) }) : []),
        // 表单动作内嵌（fail+form 场景）
        ...(formActions.length ? [ h('span', { key:'chain-form-hint', style:{ fontSize:10, color:'#8b8b95' } }, '↘') ] : []),
      ].concat(formActions.length ? [ h('div', { key:'chain-form-slot', style:{ position:'absolute' } }, []) ] : []))
    }

    // 完整链渲染器：Banner + Steps（#308 modal-seat：表单不再内嵌，按 ADR 5.4 仅 fail+form 走弹窗；此处移除 ChainForm 内嵌，保留提示）
    export const ChainRenderer = function({ snapshot, dispatcher, st, showSteps = true }) {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      if (!snapshot) return null
      const hasSteps = Array.isArray(snapshot.steps) && snapshot.steps.length>0
      if (!hasSteps) return null
      // #308：form 不再内嵌于横幅/渲染器，改为 modal-seat 弹窗（用户点击才弹）
      return h('div', { className:'dsws-chain-renderer', style:{ display:'flex', flexDirection:'column' } }, [
        // #296 实机反馈：水平步进条与下方垂直明细信息重复，检查页隐藏（组件保留，其他宿主按需开启）
        showSteps ? h(ChainSteps, { snapshot:snapshot }) : null,
        h(ChainBanner, { snapshot:snapshot, dispatcher:dispatcher, st:st }),
        // chainState 调试用（仅开发时可见，生产可隐藏；暂展示 small）
        snapshot.chainState==='allDone' ? h('div', { style:{ fontSize:10, color:'#4ade80', padding:'2px 6px' } }, '✓ 链条已全部通过') : null,
      ])
    }

    // #284：旧 wf.status 9 checks → ChainSnapshot 适配器已随九格目录视图退役（链快照由 host wf.chain 真源产出）。

    // 未知类型 Honest unsupported 校验辅助（供测试/门禁调用）
    export function isSupportedActionType(type) {
      return ['inject-prompt','open-url','rpc','form','refresh'].indexOf(String(type))>=0
    }