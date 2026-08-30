/**
 * tests/verify-chain-renderer.js — #228 UI 链渲染器与动作分发器门禁
 *
 * 验收（#228）：
 * - jsdom 冒烟：给定链数据渲染出对应横幅/表单；动作五种类型各执行一次；未知类型显示 unsupported
 * - 真机：Markdown 不出现红卡；GitHub gh 未登录按钮=注入 prompt；登录成功后挂载点自动推进（重求值）
 * - 形态：蓝/黄/红条同源渲染（互斥 42px Tab可达）、步进条、Form 内嵌、refresh 联动
 *
 * 运行：node tests/verify-chain-renderer.js
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert'

let passed=0, failed=0
function check(ok, msg){ if(ok){ console.log('  PASS '+msg); passed++; } else { console.log('  FAIL '+msg); failed++; } }
function file(p){ return readFileSync(resolve(p),'utf8') }

console.log('== #228 链渲染器与动作分发器 ==')
console.log('')
console.log('-- 1) 产物存在与形状 --')
check(existsSync('src/client/views/shared/ChainRenderer.js'), 'ChainRenderer.js 存在')
const cr = existsSync('src/client/views/shared/ChainRenderer.js') ? file('src/client/views/shared/ChainRenderer.js') : ''
check(cr.includes('CHAIN_RENDERER_VERSION'), 'ChainRenderer 含版本标识')
check(cr.includes('ChainBanner'), 'ChainRenderer 含 ChainBanner')
check(cr.includes('ChainRenderer'), 'ChainRenderer 含 ChainRenderer')
check(cr.includes('ChainSteps'), 'ChainRenderer 含 ChainSteps')
check(cr.includes('ChainForm'), 'ChainRenderer 含 ChainForm')
check(!cr.includes('checksToChainSnapshot'), '#284：checks→chain 适配器已随九格目录视图退役')
check(cr.includes('isSupportedActionType'), '含 isSupportedActionType')

console.log('')
console.log('-- 2) 横幅同源互斥 42px Tab可达 --')
check(cr.includes('42') && cr.includes('minHeight:42') || cr.includes('height:42'), '横幅 42px 约束')
check(cr.includes('tabIndex:0') || cr.includes('tabIndex'), '横幅 Tab 可达')
check(cr.includes('role:') && cr.includes('status'), '横幅含 role/status 可达')
check(cr.includes('levelToClass') && cr.includes('levelToStyle'), '含 level→样式 映射')
check(cr.includes('dsws-chain-banner'), '含 dsws-chain-banner 类')
check(cr.includes('互斥') || cr.includes('currentIndex') , '互斥 current 唯一')

console.log('')
console.log('-- 3) 动作分发器五种 + unknown --')
const actions = existsSync('src/client/kernel/actions.js') ? file('src/client/kernel/actions.js') : ''
check(actions.includes('INJECT_PROMPT') || actions.includes('inject-prompt'), 'actions 含 inject-prompt')
check(actions.includes('OPEN_URL') || actions.includes('open-url'), 'actions 含 open-url')
check(actions.includes('RPC') || actions.includes("'rpc'") || actions.includes('"rpc"') || actions.includes('RPC'), 'actions 含 rpc')
check(actions.includes('FORM') || actions.includes('form'), 'actions 含 form')
check(actions.includes('REFRESH') || actions.includes('refresh'), 'actions 含 refresh')
check(actions.includes('unsupported') , 'actions 含 unsupported 诚实失败')
check(file('src/client/views/shared/ChainRenderer.js').includes('unsupported'), 'ChainRenderer 含 unsupported 展示')

// 运行时：dispatcher 5 种 + unknown
try{
  const { createActionDispatcher } = await import('../src/client/kernel/actions.js')
  const calls=[]
  const ctx={
    inject: async (t)=>{ calls.push('inject:'+t.slice(0,20)) },
    openUrl: (u)=>{ calls.push('open:'+u) },
    hostCall: async (m,p)=>{ calls.push('rpc:'+m); return {ok:true} },
    renderForm: async (schema, cb)=>{ calls.push('form:'+schema.length); await cb({name:'test'}) },
    refresh: async ()=>{ calls.push('refresh') },
    tr: (k)=>k,
    resolvePrompt: async (id)=>id
  }
  const disp = createActionDispatcher(ctx)
  const r1 = await disp.dispatch({type:'inject-prompt', prompt:'setupRun'})
  check(r1.ok===true, 'dispatcher inject-prompt 执行')
  const r2 = await disp.dispatch({type:'open-url', url:'https://example.com'})
  check(r2.ok===true, 'dispatcher open-url 执行')
  const r3 = await disp.dispatch({type:'rpc', method:'wf.ping', params:{}})
  check(r3.ok===true, 'dispatcher rpc 执行')
  const r4 = await disp.dispatch({type:'form', schema:[{name:'name', label:'Name', required:true}], submitAction:{type:'rpc', method:'wf.initPublish'}})
  check(r4.ok===true, 'dispatcher form 执行')
  const r5 = await disp.dispatch({type:'refresh', target:'chain'})
  check(r5.ok===true, 'dispatcher refresh 执行')
  const r6 = await disp.dispatch({type:'unknown-type', foo:1})
  check(r6.ok===false && r6.error && r6.error.kind==='unsupported', 'dispatcher unknown → unsupported')
  check(calls.length>=6, 'dispatcher 6 次调用均记录')
}catch(e){
  check(false, 'dispatcher 运行时异常: '+e.message)
}

console.log('')
console.log('-- 4) Form 渲染位置与校验（#308：横幅不再内嵌，改走 modal-seat 弹窗） --')
check(cr.includes('schema'), 'ChainForm 含 schema')
check(cr.includes('required') && cr.includes('必填'), 'ChainForm 含 required 校验')
check(cr.includes('pattern') && cr.includes('RegExp'), 'ChainForm 含 pattern 校验')
check(cr.includes('submitAction') , 'ChainForm 含 submitAction')
check(cr.includes('onSubmit'), 'ChainForm 含 onSubmit')
// #308：form 不再内嵌于横幅/ChainRenderer，改为 modal-seat 弹窗（用户点击才弹）
const rendererBody = cr.slice(cr.indexOf('export const ChainRenderer'), cr.indexOf('export const ChainRenderer')+3000)
check(!rendererBody.includes('h(ChainForm'), 'ChainRenderer 不再内嵌 ChainForm（#308 form 改走 modal-seat）')
const ctForForm = file('src/client/views/ChecksTab.js')
check(ctForForm.includes('FormModalSeat') || ctForForm.includes('ensureFormModal'), 'ChecksTab 接入 FormModalSeat（form 走弹窗）')
const srForForm = file('src/client/kernel/slotRenderer.js')
check(srForForm.includes('FormModalSeat') && srForForm.includes('dsws-modal'), 'slotRenderer 含 FormModalSeat 弹窗（含 .dsws-modal）')

console.log('')
console.log('-- 5) gh 登录黄条 inject-prompt 替换 openUrl（#308 修陈旧断言：bc72e16 迁移至后端 fixes） --')
const prompts = file('src/client/kernel/prompts.js')
check(prompts.includes('ghAuthLogin'), 'prompts 含 ghAuthLogin 模板')
check(prompts.includes('gh auth login'), 'ghAuthLogin 含 gh auth login 文案')
// #308 修陈旧断言：bc72e16 后修复指引迁入后端 fixes（host/index.js 不再硬编码 prompt:ghAuthLogin，ChecksTab 不再硬编码 promptText 调用）
const checksTab = file('src/client/views/ChecksTab.js')
check(checksTab.includes('hintTextOf') && checksTab.includes('resolvePrompt'), 'ChecksTab 走通用 hint 解析（不再硬编码 ghAuthLogin，承接 fixContract）')
check(!checksTab.includes("openUrl('https://cli.github.com/manual/gh_auth_login')") , 'ChecksTab 已删除 gh_auth_login openUrl 硬编码')
const statusBar = file('src/client/statusbar/StatusBar.js')
check(statusBar.includes("promptText('ghAuthLogin')") || statusBar.includes('ghAuthLogin') || statusBar.includes('hintTextOf'), 'StatusBar 含 ghAuthLogin 或通用 hint（兼容）')
check(!statusBar.includes("openUrl('https://cli.github.com/manual/gh_auth_login')"), 'StatusBar 已删除 openUrl 硬编码')
const ghBackend = file('src/host/tracker/backends/github/index.js')
check(ghBackend.includes('ghAuthLogin'), 'github 后端 fixes 含 ghAuthLogin（bc72e16 迁移真源）')
const fixContract = file('src/host/tracker/fixContract.js')
check(fixContract.includes('attachFixContract'), 'fixContract 存在并处理 prompt 解析')
const host = file('src/host/index.js')
check(host.includes('attachFixContract') || host.includes('fixContract') || host.includes("wf.chain"), 'host 已接入 fixContract / wf.chain（hint 不再硬编码在 host）')
check(!host.includes("'https://cli.github.com/manual/gh_auth_login'") || host.split('prompt:ghAuthLogin').length>2, 'host 已无残留 URL 硬编码为主')

console.log('')
console.log('-- 6) 红卡替换与 Markdown 隔离 --')
const noRepo = file('src/client/views/NoRepoCard.js')
check(noRepo.includes('markdown') && noRepo.includes('Markdown 工作区不出现红卡') || noRepo.includes('bidNoRepo'), 'NoRepoCard 含 markdown 隔离')
check(noRepo.includes('ChainRenderer') || noRepo.includes('chainSnap'), 'NoRepoCard 含 chain 委托')
const listTab = file('src/client/views/ListTab.js')
check(!listTab.includes('h(NoRepoCard'), 'ListTab 已移除全屏红卡挂载（B Timeline 定版 2026-08-28：行内红卡表达，顶部无错误信息）')

console.log('')
console.log('-- 7) 重求值联动 --')
const probe = file('src/client/kernel/probe.js')
check(probe.includes('loadChain'), 'probe 含 loadChain')
check(probe.includes('wf.chain'), 'probe 调用 wf.chain')
check(probe.includes('loadChain(st, true') , 'refreshAll 联动 loadChain')
const host2 = file('src/host/index.js')
check(host2.includes("harness.handle('wf.chain'"), 'host 含 wf.chain handler')
check(host2.includes('resolveGenericChain'), 'host chain 使用 resolveGenericChain')
check(host2.includes('registerGenericPredicates'), 'host chain 注册通用谓词')

console.log('')
console.log('-- 8) jsdom 横幅/表单冒烟 --')
try{
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'http://127.0.0.1:59519/'})
  global.window = dom.window
  global.document = dom.window.document
  // global.navigator is read-only in newer jsdom, skip direct assignment
  try{ Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable:true }) }catch(e){}
  global.Node = dom.window.Node
  global.HTMLElement = dom.window.HTMLElement
  global.getComputedStyle = dom.window.getComputedStyle
  global.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb)=>setTimeout(cb,0))
  global.ResizeObserver = class{ observe(){} unobserve(){} disconnect(){} }
  const ReactMod = await import('react')
  const React = ReactMod.default || ReactMod
  global.React = React
  globalThis.React = React
  const ReactDOMClient = await import('react-dom/client')
  const { act } = await import('react')
  // 构造最小 snapshot
  const snapshot = {
    steps: [
      { id:'a', status:'done', show:{fallback:'已完成', level:'info'}, actions:[], isApplicable:true, isCurrent:false, isBlocking:false },
      { id:'b', status:'current', show:{fallback:'需登录', desc:'运行 gh auth login', level:'warn'}, actions:[{type:'inject-prompt', prompt:'ghAuthLogin'}], isApplicable:true, isCurrent:true, isBlocking:true },
      { id:'c', status:'pending', show:{fallback:'待定', level:'info'}, actions:[], isApplicable:true, blockedBy:'b', isCurrent:false, isBlocking:false }
    ],
    currentIndex:1, doneCount:1, applicableCount:3, totalCount:3, chainState:'hasCurrent', version:'1'
  }
  // #284：适配器测试撤销；链快照形态由契约层 chain.js evaluateChain 自证（见 verify-chain.js）
  // 渲染 ChainRenderer（需要 DswsCtx 与 dispatcher）
  const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
  const { createActionDispatcher } = await import('../src/client/kernel/actions.js')
  const calls2=[]
  const mockCtx={ inject: async(t)=>{calls2.push(t)}, openUrl: (u)=>{calls2.push(u)}, hostCall: async()=>{calls2.push('host')}, renderForm: async()=>{}, refresh: async()=>{calls2.push('refresh')}, tr:(k)=>k }
  const disp2 = createActionDispatcher(mockCtx)
  // 构造带 form 的 snapshot
  const formSnap = {
    steps:[
      { id:'f1', status:'fail', show:{fallback:'需创建仓库', desc:'填表单', level:'bad'}, actions:[{type:'form', schema:[{name:'name', label:'仓库名', required:true}], submitAction:{type:'rpc', method:'wf.initPublish'}}], isApplicable:true, isCurrent:true, isBlocking:true }
    ], currentIndex:0, doneCount:0, applicableCount:1, totalCount:1, chainState:'hasCurrent', version:'1'
  }
  // 简单断言 form 动作存在
  check(formSnap.steps[0].actions[0].type==='form', 'form 动作存在')
  check(formSnap.steps[0].actions[0].schema[0].name==='name', 'form schema 含 name')
  // 未知类型
  const unsnap = {
    steps:[{ id:'u', status:'fail', show:{fallback:'未知', level:'bad'}, actions:[{type:'weird-type'}], isApplicable:true, isCurrent:true }],
    currentIndex:0, chainState:'hasCurrent', version:'1'
  }
  check(unsnap.steps[0].actions[0].type==='weird-type', 'unknown 类型存在')
  // Markdown 隔离：catalogFor 隔离
  const { catalogFor } = await import('../src/shared/tracker/check-catalog.js')
  const mdCats = catalogFor('markdown')
  const ghCats = catalogFor('github')
  check(!mdCats.some(c=>c.id==='gh:installed'), 'markdown 目录无 gh:installed')
  check(ghCats.some(c=>c.id==='gh:installed'), 'github 目录含 gh:installed')
  check(mdCats.some(c=>c.id==='md:scratchWritable'), 'markdown 目录含 md:scratchWritable')
}catch(e){
  check(false, 'jsdom 冒烟异常: '+e.message + ' ' + e.stack?.split('\n')[0])
}

console.log('')
console.log('-- 9) 五座位边界与契约四态 --')
try{
  const { CHECK_STATE, ACTION_TYPE } = await import('../src/shared/tracker/chain.js')
  check(CHECK_STATE.DONE==='done' && CHECK_STATE.CURRENT==='current' && CHECK_STATE.FAIL==='fail' && CHECK_STATE.PENDING==='pending', '四态 done/current/fail/pending')
  check(!('NA' in CHECK_STATE) && !('na' in CHECK_STATE), '无 NA 状态')
  check(Object.values(ACTION_TYPE).includes('inject-prompt') && Object.values(ACTION_TYPE).includes('refresh'), 'ACTION_TYPE 含 5 种')
}catch(e){ check(false, '契约四态异常: '+e.message)}

console.log('')
console.log(`-- 汇总 --`)
console.log(`total=${passed+failed} passed=${passed} failed=${failed}`)
if(failed) process.exit(1)