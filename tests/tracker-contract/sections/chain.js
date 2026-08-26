/**
 * tests/tracker-contract/sections/chain.js — 链条契约测试（#217，高质量门禁）。
 */

import { validateCheckItem, validateChain, evaluateChain, chainProgress, capsuleSummary, CHECK_STATE, ACTION_TYPE } from '../../../src/shared/tracker/chain.js'

function assert(name, cond, detail) { return { name, ok: !!cond, detail: detail || '' } }

function mkItem(id, check, onPass, onFail) {
  return {
    id,
    check,
    onPass: onPass || { show: { i18nKey: 'ok.'+id, fallback: 'ok' }, actions: [] },
    onFail: onFail || { show: { i18nKey: 'fail.'+id, fallback: 'fail '+id }, actions: [{ type: ACTION_TYPE.REFRESH, target: 'chain' }] },
  }
}

function runChainTests() {
  const out = []
  // 1) 校验：合法项应无错
  {
    const item = mkItem('t1', { kind:'primitive', primitive:'commandExists', command:'gh' })
    const e = validateCheckItem(item)
    out.push(assert('chain · validate 合法项无错', e.length===0, e.join(';')))
  }
  {
    const item = { check:{kind:'primitive', primitive:'commandExists', command:'gh'}, onPass:{show:null, actions:[]}, onFail:{show:null, actions:[]} }
    const e = validateCheckItem(item)
    out.push(assert('chain · validate 缺 id 必错', e.length>0, e.join(';')))
  }
  {
    const chain = [mkItem('dup', {kind:'primitive', primitive:'env', key:'HOME'}), mkItem('dup', {kind:'primitive', primitive:'env', key:'HOME'})]
    const e = validateChain(chain)
    out.push(assert('chain · validate 重复 id 必错', e.some(s=>s.includes('duplicate')), e.join(';')))
  }
  {
    const item = mkItem('bad-act', {kind:'primitive', primitive:'env', key:'HOME'}, null, { show:{fallback:'x'}, actions:[{type:'unknown-type'}] })
    const e = validateCheckItem(item)
    // B10 fix: 未知类型 = 诚实 unsupported，不判错（留给 UI dispatcher 诚实失败），故校验应通过
    out.push(assert('chain · validate 未知 action type 不判错（留给 dispatcher unsupported）', e.length===0, e.join(';')))
  }
  {
    const item = mkItem('form-bad', {kind:'primitive', primitive:'env', key:'HOME'}, null, { show:{fallback:'x'}, actions:[{type:'form', schema:[{name:'a', type:'text', labelKey:'l'}]}] })
    const e = validateCheckItem(item)
    out.push(assert('chain · validate form 缺 submitAction 必错', e.some(s=>s.includes('submitAction')), e.join(';')))
  }
  {
    const item = mkItem('form-ok', {kind:'primitive', primitive:'env', key:'HOME'}, null, { show:{fallback:'x'}, actions:[{type:'form', schema:[{name:'a', type:'text', labelKey:'l'}], submitAction:{type:'rpc', method:'wf.test'}}] })
    const e = validateCheckItem(item)
    out.push(assert('chain · validate form 合法无错', e.length===0, e.join(';')))
  }
  // 2) 求值：空链
  {
    const snap = evaluateChain([], {})
    out.push(assert('chain · 空链 allDone', snap.chainState==='empty' && snap.totalCount===0, JSON.stringify(snap)))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'env', key:'HOME'})]
    const snap = evaluateChain(chain, { a:'pass' })
    out.push(assert('chain · 单项 pass → done/allDone', snap.steps[0].status===CHECK_STATE.DONE && snap.chainState==='allDone', JSON.stringify(snap.steps[0])))
    out.push(assert('chain · progress 单项 pass 100%', chainProgress(snap).percent===100, JSON.stringify(chainProgress(snap))))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'commandExists', command:'gh'}, null, { show:{fallback:'gh missing'}, actions:[{type:'inject-prompt', prompt:'ghAuthLogin'}] })]
    const snap = evaluateChain(chain, { a:'fail' })
    out.push(assert('chain · 单项 fail 有动作 → current', snap.steps[0].status===CHECK_STATE.CURRENT && snap.currentIndex===0, JSON.stringify(snap.steps[0])))
    out.push(assert('chain · capsule current', capsuleSummary(snap).kind==='current', JSON.stringify(capsuleSummary(snap))))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'env', key:'HOME'}, null, { show:{fallback:'no env'}, actions:[] })]
    const snap = evaluateChain(chain, { a:'fail' })
    out.push(assert('chain · 单项 fail 无动作 → fail', snap.steps[0].status===CHECK_STATE.FAIL, JSON.stringify(snap.steps[0])))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'commandExists', command:'gh'})]
    const snap = evaluateChain(chain, { a:null })
    out.push(assert('chain · 单项 pending → pending/pending', snap.steps[0].status===CHECK_STATE.PENDING && snap.chainState==='pending', JSON.stringify(snap.steps[0])))
  }
  {
    const chain = [mkItem('a', {kind:'backend', id:'gh:installed', backendId:'github'})]
    const snap = evaluateChain(chain, { a:'na' })
    out.push(assert('chain · 旧 na 输入现归 pending（2026-08-27 已删 na）', snap.steps[0].status===CHECK_STATE.PENDING, JSON.stringify(snap)))
    out.push(assert('chain · 删 na 后无 NA 状态', snap.steps[0].status!==CHECK_STATE.NA, JSON.stringify(snap)))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'commandExists', command:'gh'}), mkItem('b', {kind:'primitive', primitive:'env', key:'HOME'})]
    const snap = evaluateChain(chain, { a:'fail', b:'pass' })
    out.push(assert('chain · 前 fail 后 pass 后 pending（被阻塞）', snap.steps[0].status===CHECK_STATE.CURRENT && snap.steps[1].status===CHECK_STATE.PENDING && snap.steps[1].blockedBy==='a', JSON.stringify(snap.steps)))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'commandExists', command:'gh'}), mkItem('b', {kind:'primitive', primitive:'env', key:'HOME'})]
    const snap = evaluateChain(chain, { a:'pass', b:'fail' })
    out.push(assert('chain · 前 pass 后 fail 后 current', snap.steps[0].status===CHECK_STATE.DONE && snap.steps[1].status===CHECK_STATE.CURRENT && snap.currentIndex===1, JSON.stringify(snap.steps)))
  }
  {
    const chain = [
      mkItem('a', {kind:'primitive', primitive:'commandExists', command:'gh'}),
      mkItem('b', {kind:'backend', id:'gh:installed'}),
      mkItem('c', {kind:'primitive', primitive:'env', key:'HOME'}),
    ]
    const snap = evaluateChain(chain, { a:'pass', b:'pending', c:'fail' })
    out.push(assert('chain · 刪 na 後 pending 阻塞', snap.steps[1].status===CHECK_STATE.PENDING && snap.steps[2].status===CHECK_STATE.PENDING, JSON.stringify(snap.steps.map(s=>s.status))))
    out.push(assert('chain · 删 na 后 applicableCount=total', snap.applicableCount===3, JSON.stringify(snap)))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'env', key:'HOME'}), mkItem('b', {kind:'primitive', primitive:'env', key:'HOME'})]
    const snap = evaluateChain(chain, { a:true, b:false })
    out.push(assert('chain · boolean true→done false→current', snap.steps[0].status===CHECK_STATE.DONE && snap.steps[1].status===CHECK_STATE.CURRENT, JSON.stringify(snap.steps.map(s=>s.status))))
  }
  {
    const chain = [
      mkItem('a', {kind:'primitive', primitive:'env', key:'HOME'}, null, { show:{fallback:'need input'}, actions:[{type:'form', schema:[{name:'token', type:'text', labelKey:'form.token'}], submitAction:{type:'rpc', method:'wf.saveToken'}}] }),
      mkItem('b', {kind:'backend', id:'repo'}, null, { show:{fallback:'open repo'}, actions:[{type:'open-url', url:'https://github.com/o/r'}] }),
      mkItem('c', {kind:'preflight', id:'ghAuth'}, null, { show:{fallback:'login'}, actions:[{type:'inject-prompt', prompt:'ghAuthLogin'}] }),
    ]
    const e = validateChain(chain)
    out.push(assert('chain · 五种 action 全合法', e.length===0, e.join(';')))
  }
  {
    const chain = [mkItem('a', {kind:'primitive', primitive:'env', key:'HOME'}, {show:{i18nKey:'ok.a', fallback:'ok'}, actions:[]}, {show:{i18nKey:'fail.a', fallback:'fail'}, actions:[{type:'refresh', target:'chain'}]})]
    const snapPass = evaluateChain(chain, {a:'pass'})
    const snapFail = evaluateChain(chain, {a:'fail'})
    out.push(assert('chain · onPass show 透传', snapPass.steps[0].show.i18nKey==='ok.a', JSON.stringify(snapPass.steps[0].show)))
    out.push(assert('chain · onFail show 透传', snapFail.steps[0].show.i18nKey==='fail.a', JSON.stringify(snapFail.steps[0].show)))
  }
  return out
}

export async function run() {
  return runChainTests()
}

const chainSection = { name: 'chain', run }
export default chainSection