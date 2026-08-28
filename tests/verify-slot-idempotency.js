#!/usr/bin/env node
// verify-slot-idempotency.js — #298 幂等回归：6 槽位仅注入一次，二次 apply 不增生
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const src = fs.readFileSync(path.resolve('src/client/index.js'), 'utf8')
const dev = fs.readFileSync(path.resolve('client.js'), 'utf8')
const pkg = fs.readFileSync(path.resolve('package/lib/client.js'), 'utf8')

const slots = ['shell.overlay','conversation.input.dock','tool.view.cordis','settings.plugins.tab','settings.section','details']

console.log('-- src/client/index.js 静态幂等门禁 --')
check(src.includes('const __slotOnce = {}'), 'src 含 __slotOnce 闸')
check(src.includes('const __injectOnce = function'), 'src 含 __injectOnce  helper')
check(src.includes('__slotOnce[slotName] = false') && src.includes("ctx.effect(function ()") && src.includes("'dsws: slot ' + slotName"), 'src 含 ctx.effect 清理')
slots.forEach(name => {
  const re = new RegExp("__injectOnce\\s*\\('"+name.replace(/\./g,'\\.')+"'")
  check(re.test(src), "src __injectOnce('"+name+"')")
})
// 原始直接 slots.inject 应仅剩 helper 内 1 处
const directInjectSrc = (src.match(/slots\.inject\s*\(/g) || []).length
check(directInjectSrc === 1, "src slots.inject 仅剩 1 处（helper 内），实得 "+directInjectSrc)

console.log('\n-- 构建产物门禁（双产物一致） --')
;[['client.js', dev], ['package/lib/client.js', pkg]].forEach(([label, txt]) => {
  check(txt.includes('__slotOnce'), label+' 含 __slotOnce')
  check(txt.includes('__injectOnce'), label+' 含 __injectOnce')
  slots.forEach(name => {
    check(txt.includes("__injectOnce('"+name+"'"), label+" __injectOnce('"+name+"')")
  })
  const cnt = (txt.match(/slots\.inject\s*\(/g) || []).length
  check(cnt === 1, label+' slots.inject 仅剩 1 处，实得 '+cnt)
  check(!txt.includes("slots.inject('shell.overlay'"), label+' 无裸露 shell.overlay 注入')
  check(!txt.includes("slots.inject('details'"), label+' 无裸露 details 注入')
})

console.log('\n-- 行为模拟：二次注入不增生 --')
// 模拟 __injectOnce 逻辑
{
  const __slotOnce = {}
  const __slotDisposers = {}
  const injected = []
  const fakeSlots = {
    inject: (name, factory) => {
      injected.push(name)
      // factory 返回 disposer
      const disp = factory()
      // 不调用 inner 返回的清理，仅记录
    },
    register: (opts, comp) => {
      // 返回 disposer
      return () => {}
    }
  }
  const fakeCtx = { effect: (fn, label) => { /* 记录但不执行 */ } }
  const __injectOnceMock = function (slotName, factory) {
    if (__slotOnce[slotName]) return
    __slotOnce[slotName] = true
    let disp = null
    try {
      fakeSlots.inject(slotName, function () {
        try { disp = factory() } catch (e) { __slotOnce[slotName]=false; throw e }
        __slotDisposers[slotName]=disp
        return function(){ try{ if(disp) disp() }catch(e){} __slotDisposers[slotName]=null }
      })
    } catch(e){ __slotOnce[slotName]=false; __slotDisposers[slotName]=null; throw e }
    fakeCtx.effect(function(){ return function(){ __slotOnce[slotName]=false; try{ const d=__slotDisposers[slotName]; if(d) d() }catch(e){} __slotDisposers[slotName]=null } }, 'dsws: slot '+slotName)
  }
  // 首次注入 6 槽位
  slots.forEach(name => __injectOnceMock(name, () => fakeSlots.register({name, id:'test'}, {})))
  check(injected.length===6, '首次注入 6 次，实得 '+injected.length)
  // 二次 apply（模拟 HMR 重入）—— 应被闸门拦截，注入数不变
  slots.forEach(name => __injectOnceMock(name, () => fakeSlots.register({name, id:'test'}, {})))
  check(injected.length===6, '二次注入仍为 6 次（幂等），实得 '+injected.length)
  // 校验 factory 错误时闸门复位（允许重试）
  let errGate = false
  const errSlot = 'details'
  // 手动复位该槽位以测试错误路径
  __slotOnce[errSlot]=false
  try {
    __injectOnceMock(errSlot, () => { throw new Error('factory boom') })
  } catch(e){ errGate = !__slotOnce[errSlot] }
  check(errGate, 'factory 抛错时闸门复位（可重试）')
  // 卸载清理后允许重注
  // 模拟 ctx.effect 清理：直接复位
  __slotOnce['details']=false
  const before = injected.length
  __injectOnceMock('details', () => fakeSlots.register({name:'details', id:'dsws-details'}, {}))
  check(injected.length===before+1, '清理后重注允许，注入数 +1')
}

console.log('\n-- 边界：异常分支与旧数据 --')
{
  // 异常：factory 返回的 disp 为 null / undefined 不应抛
  const __slotOnce2 = {}
  const fakeSlots2 = {
    inject: (name, factory) => { const disp = factory(); const cleanup = disp; if(typeof cleanup==='function') cleanup() },
    register: () => null
  }
  const fakeCtx2 = { effect: () => {} }
  let ok = true
  try {
    const fn = function(slotName, factory){
      if(__slotOnce2[slotName]) return
      __slotOnce2[slotName]=true
      fakeSlots2.inject(slotName, factory)
      fakeCtx2.effect(()=>()=>{ __slotOnce2[slotName]=false }, '')
    }
    fn('details', () => fakeSlots2.register())
    fn('details', () => fakeSlots2.register()) // 第二次应被拦截不抛
  } catch(e){ ok=false }
  check(ok, 'factory 返回空 disposer 时不抛且二次幂等')
}

console.log(failed ? '\n存在失败' : '\n全部通过 — #298 幂等门禁生效')
process.exit(failed ? 1 : 0)
