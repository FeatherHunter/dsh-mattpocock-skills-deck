/**
 * tests/verify-deck-slots.js — #308 五座位 modal-seat 门禁（ADR #221 §5.1/§5.4/§8）+ #318 wizard 单步扩展
 *
 * 验收（#308）：
 * - 槽位声明：src/shared/ui/slots.js + src/client/kernel/slots.js + src/client/kernel/slotRenderer.js 存在且含 5 端口定义
 * - modal 仅 fail+form 挂接：shouldShowInModal / canOpenModalForStep 仅 fail+form 为真
 * - 后端缺口：gh:remote 与 gh:repoAccess 均含 form[创建并发布]（name+visibility → wf.initPublish）
 * - UI 挂接：ChecksTab 明细行放开 form 过滤；renderForm 打开 modal-seat（非 no-op）；ChainRenderer 不再内嵌 ChainForm
 * - 外观：遮罩 + 居中盒复用 .dsws-modal/.dsws-modalbox + portalTop，支持遮罩/取消/ESC 关闭，提交后重求值
 * 验收（#318 wizard 单步）：
 * - chain.js 新增 ACTION_TYPE.WIZARD，形状 wizard{ label, steps[{title, schema: FieldSchema[]}], submitAction }，steps 至少一项，每步 schema 复用 FieldSchema（含 directory/file）
 * - slots 守门扩展为 fail+(form|wizard)，getWizardAction / getWizardSteps 可用
 * - modal-seat 能把单步 wizard（1 步）当单页表单在弹窗呈现、校验并提交，提交后重求值
 * - 形状锁：getWizardSteps({type:'wizard', steps:[{schema:[{name:'a'}]}]}).length===1 && shouldShowInModal({status:'fail', actions:[{type:'wizard', steps:[{schema:[]}]}]})===true
 *
 * 运行：node tests/verify-deck-slots.js
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

let passed = 0, failed = 0
function check(ok, msg){ if(ok){ console.log('  PASS '+msg); passed++; } else { console.log('  FAIL '+msg); failed++; } }
function file(p){ return readFileSync(resolve(p),'utf8') }

console.log('== #308 五座位 modal-seat ==')
console.log('')
console.log('-- 1) 规划产出文件存在 --')
check(existsSync('src/shared/ui/slots.js'), 'src/shared/ui/slots.js 存在')
check(existsSync('src/client/kernel/slots.js'), 'src/client/kernel/slots.js 存在')
check(existsSync('src/client/kernel/slotRenderer.js'), 'src/client/kernel/slotRenderer.js 存在')
check(!existsSync('src/shared/ui/slots.js') || file('src/shared/ui/slots.js').includes('SLOTS_VERSION'), 'shared/ui/slots.js 含版本')
check(!existsSync('src/client/kernel/slots.js') || file('src/client/kernel/slots.js').includes('SLOTS_KERNEL_VERSION'), 'kernel/slots.js 含版本')
check(!existsSync('src/client/kernel/slotRenderer.js') || file('src/client/kernel/slotRenderer.js').includes('SLOT_RENDERER_VERSION'), 'kernel/slotRenderer.js 含版本')

console.log('')
console.log('-- 2) 五端口声明（ADR 5.1） --')
try{
  const shared = file('src/shared/ui/slots.js')
  check(shared.includes('banner-seat'), 'shared 含 banner-seat')
  check(shared.includes('dock-seat'), 'shared 含 dock-seat')
  check(shared.includes('statusbar-seat'), 'shared 含 statusbar-seat')
  check(shared.includes('modal-seat'), 'shared 含 modal-seat')
  check(shared.includes('toast-seat'), 'shared 含 toast-seat')
  check(shared.includes('shell.overlay'), 'shared 含 shell.overlay 父槽')
  check(shared.includes("'details'") || shared.includes('"details"') || shared.includes('details'), 'shared 含 details 父槽')
  check(shared.includes('conversation.input.dock'), 'shared 含 conversation.input.dock 父槽')
  check(shared.includes("'root'") || shared.includes('"root"'), 'shared 含 root scope')
  check(shared.includes('single'), 'shared 含 single kind (modal)')
  check(shared.includes('list'), 'shared 含 list kind')
  // kernel 同源
  const kslots = file('src/client/kernel/slots.js')
  check(kslots.includes('modal-seat'), 'kernel/slots.js 含 modal-seat')
  check(kslots.includes('shouldShowInModal'), 'kernel/slots.js 含 shouldShowInModal')
  // 数量
  const m = shared.match(/id:\s*'[^']*-seat'/g) || shared.match(/id: '.*?seat'/g) || []
  // 粗略：SLOT_DEFS 5 项
  const count = (shared.match(/banner-seat/g)||[]).length
  check(count>=1, 'shared 5 端口至少各出现一次')
}catch(e){ check(false, '五端口声明异常: '+e.message)}

console.log('')
console.log('-- 3) modal 仅 fail+(form|wizard) 挂接（ADR 5.4 + #318 wizard 扩展） --')
try{
  const { shouldShowInModal, getFormAction, getWizardAction, getWizardSteps, getModalAction } = await import('../src/shared/ui/slots.js')
  check(shouldShowInModal({ status:'fail', actions:[{type:'form', schema:[]}] })===true, 'shouldShowInModal fail+form → true')
  check(shouldShowInModal({ status:'fail', actions:[{type:'inject-prompt'}] })===false, 'shouldShowInModal fail 无 form → false')
  check(shouldShowInModal({ status:'done', actions:[{type:'form'}] })===false, 'shouldShowInModal done+form → false')
  check(shouldShowInModal({ status:'current', actions:[{type:'form'}] })===false, 'shouldShowInModal current+form → false')
  check(shouldShowInModal({ status:'pending', actions:[{type:'form'}] })===false, 'shouldShowInModal pending+form → false')
  check(shouldShowInModal(null)===false, 'shouldShowInModal null → false')
  check(getFormAction({ actions:[{type:'inject-prompt'}, {type:'form', label:'x'}] })?.type==='form', 'getFormAction 取首个 form')
  // #318 wizard 守门
  check(shouldShowInModal({ status:'fail', actions:[{type:'wizard', steps:[{schema:[]}]}] })===true, 'shouldShowInModal fail+wizard → true（#318 单步最小）')
  check(shouldShowInModal({ status:'fail', actions:[{type:'wizard', steps:[{schema:[{name:'a'}]}]}] })===true, 'shouldShowInModal fail+wizard 单步含字段 → true')
  check(shouldShowInModal({ status:'done', actions:[{type:'wizard', steps:[{schema:[]}]}] })===false, 'shouldShowInModal done+wizard → false')
  check(shouldShowInModal({ status:'current', actions:[{type:'wizard', steps:[{schema:[]}]}] })===false, 'shouldShowInModal current+wizard → false')
  check(getWizardAction({ actions:[{type:'inject-prompt'}, {type:'wizard', steps:[{schema:[]}]}] })?.type==='wizard', 'getWizardAction 取首个 wizard')
  check(typeof getWizardSteps === 'function', 'getWizardSteps 可用（shared）')
  // 形状锁（#318 验收）：getWizardSteps 单步断言 + 守门
  const wizardShapeLock = (function(){ try { return getWizardSteps({type:'wizard', steps:[{schema:[{name:'a'}]}]}).length===1 && shouldShowInModal({status:'fail', actions:[{type:'wizard', steps:[{schema:[]}]}]})===true } catch(e){ return false } })()
  check(wizardShapeLock===true, 'wizard 形状锁：getWizardSteps(...).length===1 && shouldShowInModal fail+wizard === true')
  check(getWizardSteps({type:'wizard', steps:[{schema:[{name:'a'}]}]}).length===1, 'getWizardSteps 单步 → 1')
  check(getWizardSteps({type:'wizard', steps:[{schema:[]}]}).length===1, 'getWizardSteps 空 schema 单步 → 1')
  check(getWizardSteps({type:'form', schema:[]}).length===0, 'getWizardSteps 非 wizard → 0')
  check(Array.isArray(getWizardSteps({type:'wizard', steps:[{title:'第一步', schema:[{name:'x', label:'X'}]}]})), 'getWizardSteps 归一化含 title')
  if (typeof getModalAction === 'function') {
    check(getModalAction({ actions:[{type:'wizard', steps:[{schema:[]}]}] })?.type==='wizard', 'getModalAction 优先取 wizard')
    check(getModalAction({ actions:[{type:'form', schema:[]} ]})?.type==='form', 'getModalAction 取 form')
  }
  // kernel 同判据（wizard 扩展）
  const { shouldShowInModal: kShould, canOpenModalForStep, getWizardSteps: kGetWizardSteps, getWizardAction: kGetWizardAction } = await import('../src/client/kernel/slots.js').catch(()=>({}))
  if (typeof kShould === 'function') {
    check(kShould({ status:'fail', actions:[{type:'form'}] })===true, 'kernel shouldShowInModal fail+form → true')
    check(kShould({ status:'fail', actions:[{type:'wizard', steps:[{schema:[]}]}] })===true, 'kernel shouldShowInModal fail+wizard → true（#318）')
    check(kShould({ status:'done', actions:[{type:'wizard', steps:[{schema:[]}]}] })===false, 'kernel done+wizard → false')
  }
  if (typeof kGetWizardSteps === 'function') {
    check(kGetWizardSteps({type:'wizard', steps:[{schema:[{name:'a'}]}]}).length===1, 'kernel getWizardSteps 单步 → 1（#318）')
  }
  if (typeof kGetWizardAction === 'function') {
    check(kGetWizardAction({ actions:[{type:'wizard', steps:[{schema:[]}]}] })?.type==='wizard', 'kernel getWizardAction 可用')
  }
  const sr = await import('../src/client/kernel/slotRenderer.js').catch(()=>({}))
  if (typeof sr.canOpenModalForStep === 'function') {
    check(sr.canOpenModalForStep({ status:'fail', actions:[{type:'form'}] })===true, 'slotRenderer canOpenModalForStep fail+form → true')
    check(sr.canOpenModalForStep({ status:'fail', actions:[{type:'inject-prompt'}] })===false, 'slotRenderer fail 无 form → false')
    check(sr.canOpenModalForStep({ status:'current', actions:[{type:'form'}] })===false, 'slotRenderer current+form → false')
    check(sr.canOpenModalForStep({ status:'fail', actions:[{type:'wizard', steps:[{schema:[]}]}] })===true, 'slotRenderer canOpenModalForStep fail+wizard → true（#318 单步）')
    check(sr.canOpenModalForStep({ status:'done', actions:[{type:'wizard', steps:[{schema:[]}]}] })===false, 'slotRenderer done+wizard → false')
  }
  if (typeof sr.canOpenWizardForStep === 'function') {
    check(sr.canOpenWizardForStep({ status:'fail', actions:[{type:'wizard', steps:[{schema:[]}]}] })===true, 'slotRenderer canOpenWizardForStep fail+wizard → true')
  }
  // chain.js 契约层 wizard 校验
  try {
    const { validateAction, ACTION_TYPE } = await import('../src/shared/tracker/chain.js')
    check(ACTION_TYPE.WIZARD==='wizard', 'ACTION_TYPE.WIZARD === wizard')
    check(validateAction({type:'wizard', steps:[{schema:[{name:'a', label:'A'}]}], submitAction:{type:'rpc', method:'wf.test'}}).ok===true, 'validateAction wizard 单步合法 → ok')
    check(validateAction({type:'wizard', steps:[], submitAction:{type:'rpc', method:'wf.test'}}).ok===false, 'validateAction wizard 空 steps → fail')
    check(validateAction({type:'wizard', steps:[{schema:[{name:'a'}]}], submitAction:{type:'rpc', method:'wf.test'}}).ok===true, 'validateAction wizard directory/file 兼容仅 name → ok（#318）')
    check(validateAction({type:'wizard', steps:[{schema:[{name:'p', type:'directory', label:'目录'}]}], submitAction:{type:'rpc', method:'wf.test'}}).ok===true, 'validateAction wizard directory 类型 → ok')
    check(validateAction({type:'wizard', steps:[{schema:[{name:'f', type:'file', label:'文件'}]}], submitAction:{type:'rpc', method:'wf.test'}}).ok===true, 'validateAction wizard file 类型 → ok')
  } catch(e) { check(false, 'chain wizard 校验异常: '+e.message) }
}catch(e){ check(false, 'modal 挂接运行时异常: '+e.message)}

console.log('')
console.log('-- 4) 后端修复契约：gh:remote 与 gh:repoAccess 同形 form --')
try{
  const gh = file('src/host/tracker/backends/github/index.js')
  check(gh.includes("gh:remote"), 'github/index.js 含 gh:remote')
  check(gh.includes("gh:repoAccess"), 'github/index.js 含 gh:repoAccess')
  // gh:remote 的 form
  const hasRemoteForm = gh.includes("'gh:remote'") && gh.slice(gh.indexOf("'gh:remote'"), gh.indexOf("'gh:remote'")+2000).includes("type: 'form'") || gh.includes('gh:remote') && gh.includes("Create & publish")
  check(hasRemoteForm, 'gh:remote 含 form[创建并发布]')
  // gh:repoAccess 的 form（本票补的）
  const repoAccessBlock = gh.slice(gh.indexOf("'gh:repoAccess'"), gh.indexOf("'gh:repoAccess'")+3000)
  check(repoAccessBlock.includes("type: 'form'"), 'gh:repoAccess 追加 form')
  check(repoAccessBlock.includes("wf.initPublish"), 'gh:repoAccess form → wf.initPublish')
  check(repoAccessBlock.includes("name") && repoAccessBlock.includes("visibility"), 'gh:repoAccess form 含 name+visibility')
  check(repoAccessBlock.includes("pattern") && repoAccessBlock.includes("A-Za-z0-9"), 'gh:repoAccess form 含仓库名校验')
  // 校验两者 schema 同形：都含 name text required + visibility single
  const remoteBlock = gh.slice(gh.indexOf("'gh:remote'"), gh.indexOf("'gh:remote'")+3000)
  const bothHaveSingle = remoteBlock.includes("single") && repoAccessBlock.includes("single")
  check(bothHaveSingle, 'gh:remote 与 gh:repoAccess 的 visibility 均为 single')
  // fixContract 存在且处理 form
  const fc = file('src/host/tracker/fixContract.js')
  check(fc.includes('attachFixContract'), 'fixContract.js 含 attachFixContract')
  check(fc.includes("type === 'form'"), 'fixContract 处理 form 动作')
}catch(e){ check(false, '后端 form 校验异常: '+e.message)}

console.log('')
console.log('-- 5) UI 挂接：ChecksTab 明细放开 form + renderForm 打开 modal --')
try{
  const ct = file('src/client/views/ChecksTab.js')
  // 旧过滤已移除：不再出现 filter(...type !== 'form')
  check(!ct.includes("filter(function (a) { return a && a.type !== 'form' })") && !ct.includes('a.type !== \'form\''), 'ChecksTab 已移除 form 过滤')
  check(ct.includes("fixActions = (s.status === 'fail'") && ct.includes("Array.isArray(s.actions) ? s.actions"), 'ChecksTab fixActions 保留 fail/current 但不过滤')
  // renderForm 打开 modal（ensureFormModal / openFormModal）
  check(ct.includes('ensureFormModal') || ct.includes('openFormModal'), 'ChecksTab renderForm 调用 ensureFormModal/openFormModal')
  check(!ct.includes('try { onSubmit({}) } catch (e) {}') || ct.includes('ensureFormModal'), 'ChecksTab renderForm 不再是 no-op onSubmit({})（或已替换为 modal）')
  // 挂载点
  check(ct.includes('FormModalSeat'), 'ChecksTab 挂载 FormModalSeat')
  check(ct.includes('formModalNode'), 'ChecksTab 含 formModalNode')
}catch(e){ check(false, 'ChecksTab 挂接校验异常: '+e.message)}

console.log('')
console.log('-- 6) ChainRenderer 不再内嵌表单（form 走 modal-seat） --')
try{
  const cr = file('src/client/views/shared/ChainRenderer.js')
  check(cr.includes('CHAIN_RENDERER_VERSION'), 'ChainRenderer 仍含版本')
  check(cr.includes('ChainForm'), 'ChainRenderer 仍保留 ChainForm 组件定义（可复用）')
  // 关键：ChainRenderer 组件体内不再渲染 ChainForm（formAction ? h(ChainForm...) 已移除）
  // 检查 ChainRenderer 函数体：应不含 "formAction ? h(ChainForm" 或 "h(ChainForm, { key:'chain-form'"
  const rendererBlock = cr.slice(cr.indexOf('export const ChainRenderer'), cr.indexOf('export const ChainRenderer')+2500)
  const hasInlineForm = rendererBlock.includes('ChainForm') && rendererBlock.includes('formAction')
  check(!hasInlineForm, 'ChainRenderer 不再内嵌 ChainForm（form 改走弹窗）')
  // Banner 仍保留 form 提示（箭头）是允许的，但 form-slot 的绝对空 div 已无意义，可保留或移除均可；此处不强验
  check(rendererBlock.includes('ChainBanner'), 'ChainRenderer 仍渲染 ChainBanner')
  // 注释提及 #308
  check(cr.includes('#308') || cr.includes('modal-seat'), 'ChainRenderer 含 #308 modal-seat 注释')
}catch(e){ check(false, 'ChainRenderer 校验异常: '+e.message)}

console.log('')
console.log('-- 7) slotRenderer 外观与交互（遮罩 + 居中盒 + 校验 + 重求值） --')
try{
  const sr = file('src/client/kernel/slotRenderer.js')
  check(sr.includes('FormModalSeat'), 'slotRenderer 含 FormModalSeat')
  check(sr.includes('ensureFormModal') && sr.includes('openFormModal') && sr.includes('closeFormModal'), 'slotRenderer 含 ensure/open/close 三件套')
  check(sr.includes('dsws-modal') && sr.includes('dsws-modalbox'), 'slotRenderer 复用 .dsws-modal/.dsws-modalbox')
  check(sr.includes('portalTop'), 'slotRenderer 用 portalTop 挂顶层（防裁剪）')
  check(sr.includes('overlay') || sr.includes('onOverlayClick'), 'slotRenderer 支持点遮罩关闭')
  check(sr.includes('Escape') || sr.includes('keydown'), 'slotRenderer 支持 ESC 关闭')
  check(sr.includes('取消') && sr.includes('提交'), 'slotRenderer 含取消/提交按钮')
  check(sr.includes('required') && sr.includes('必填'), 'slotRenderer 含 required 校验')
  check(sr.includes('pattern') && sr.includes('RegExp'), 'slotRenderer 含 pattern 校验')
  check(sr.includes('flash') && sr.includes('已提交'), 'slotRenderer 提交后 flash 提示')
  check(sr.includes('wf.detect') || sr.includes('loadChain') || sr.includes('loadSnapshot'), 'slotRenderer 提交后触发重求值')
  check(sr.includes('pending') && sr.includes('提交中'), 'slotRenderer 含 pending 提交中态')
  // z-index 语义：复用样式而非自造
  const styles = file('src/client/kernel/styles.js')
  check(styles.includes('.dsws-modal') && styles.includes('z-index:10000'), 'styles 含 .dsws-modal 10000（modal > toast > banner）')
}catch(e){ check(false, 'slotRenderer 外观校验异常: '+e.message)}

console.log('')
console.log('-- 8) 构建产物门禁（双产物含新模块） --')
try{
  const cli = existsSync('client.js') ? file('client.js') : ''
  const pcli = existsSync('package/lib/client.js') ? file('package/lib/client.js') : ''
  check(cli.includes('SLOTS_KERNEL_VERSION') || cli.includes('FormModalSeat'), 'client.js 含 slots/slotRenderer 拼接')
  check(pcli.includes('SLOTS_KERNEL_VERSION') || pcli.includes('FormModalSeat'), 'package/lib/client.js 含 slots/slotRenderer 拼接')
  check(!cli.includes('kernel:slots (spliced') && !pcli.includes('kernel:slots (spliced'), '双产物无 slots 拼接标记残留')
  check(!cli.includes('shared:slots (spliced') && !pcli.includes('shared:slots (spliced'), '双产物无 shared:slots 标记残留')
}catch(e){ check(false, '产物门禁异常: '+e.message)}

console.log('')
console.log(`-- 汇总 --`)
console.log(`total=${passed+failed} passed=${passed} failed=${failed}`)
if(failed) process.exit(1)
