#!/usr/bin/env node
/**
 * verify-669-chain-after-pick.js — 「选完后端立刻重取一次链」门禁（2026-09-21）
 *
 * 起因（用户在真机上报）：点完蓝条的「确认并继续」，那条该出现的横幅要等一会儿才出来。
 *   查明之后：这条路（`statusbar/StatusBackend.js` 的 `confirmStatusGate`）绑定成功只重取了快照，
 *   **没有重取链**；链要等「上一轮链探测结束时挂上的 8 秒定时器」到点才更新。
 *   实测：点确认 → 横幅出现 11.4 秒，其中 8.16 秒纯等定时器，1.7 秒是这一轮链探测本身；
 *   只补一次立刻重取 → 1.73 秒。同仓另外两条路本来就是一对（`kernel/store-switch.js`、`views/NoRepoCard.js`），
 *   只有蓝条这条门控路少了后半句。
 *
 * 断两组（都用真身求值，不测 DOM）：
 *   A 行为层：把 StatusBackend.js 取出来在沙箱里求值、调真的 confirmStatusGate，断言
 *     「绑定成功之后确实又发了一次链重取，而且是 force 的那一次」。
 *   B 源码层：那条门控路线里必须有 loadChain 调用；`probe-chain.js` 里那条「晚到的旧结果不许盖回新快照」的守卫在。
 *
 * 用法：node tests/verify-669-chain-after-pick.js
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let passed = 0
let failed = 0
function check (ok, msg) { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const sbSrc = read('src/client/statusbar/StatusBackend.js')
const chainSrc = read('src/client/kernel/probe-chain.js')

console.log('== A 行为层：真的调一次 confirmStatusGate，看它绑完之后有没有重取链 ==')
{
  const body = sbSrc.replace(/^[ \t]*export[ \t]+/gm, '')
  const calls = { chain: [], snapshot: [], bind: [], flashes: [] }
  const sandbox = {
    tr: (k) => String(k),
    emit: () => {},
    firstBackendIdOf: () => 'github',
    setCachedSelection: () => {},
    setPresentationMap: () => {},
    labelOf: (id) => String(id),
    flash: (st, t) => calls.flashes.push(String(t)),
    loadSnapshot: (st, a, b) => calls.snapshot.push({ force: a, mode: b }),
    loadChain: (st, force) => calls.chain.push({ force: force }),
    moduleMetaOf: () => null,
    injectSetupDecision: () => 'setup-card',
    host: { call: (method, params) => { calls.bind.push({ method: method, params: params }); return Promise.resolve({ ok: true }) } },
    console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  const mod = new Function(...names, body + '\n;return { confirmStatusGate: confirmStatusGate }')(...names.map((n) => sandbox[n]))
  const st = { cwd: 'D:\\tmp\\669-demo', selection: null, snapshot: null, gateModalOpen: true, gateModalSource: 'status', gateSelected: 'github' }
  mod.confirmStatusGate(st)
  await new Promise((r) => setTimeout(r, 0))
  check(calls.bind.length === 1 && calls.bind[0].method === 'wf.bind', '照旧打了一通绑定电话（实得 ' + JSON.stringify(calls.bind.map((c) => c.method)) + '）')
  check(calls.snapshot.length === 1, '照旧重取了一次快照（实得 ' + calls.snapshot.length + ' 次）')
  check(calls.chain.length === 1, '绑定成功之后确实又重取了一次链（实得 ' + calls.chain.length + ' 次）')
  check(calls.chain.length === 1 && calls.chain[0].force === true, '而且那一次是 force（绕过缓存，实得 force=' + (calls.chain[0] && calls.chain[0].force) + '）')
  check(calls.chain.length === 1 && calls.chain[0].force === true && calls.snapshot.length === 1, '两条重取都在绑定成功那一支里（不是失败分支）')
}

console.log('')
console.log('== B 源码层：这条路上有那次重取，且旧结果盖不回新快照 ==')
{
  const start = sbSrc.indexOf('export const confirmStatusGate')
  const nextDecl = sbSrc.indexOf('export const ', start + 10)
  const seg = sbSrc.slice(start, nextDecl > 0 ? nextDecl : sbSrc.length)
  check(seg.length > 100 && seg.indexOf('wf.bind') > 0, '取到的是门控确认那一支（' + seg.length + ' 字）')
  const afterSnapshot = seg.indexOf('loadSnapshot(s,true,true)')
  const afterChain = afterSnapshot >= 0 ? seg.indexOf('loadChain(s,true)', afterSnapshot) : -1
  check(afterSnapshot >= 0, '门控确认那条路上仍在重取快照')
  check(afterChain > afterSnapshot, '紧跟快照那次之后又重取了一次链（距离 ' + (afterChain - afterSnapshot) + ' 字）')
  check(sbSrc.indexOf('注入决策') >= 0 || sbSrc.indexOf('一个字都不注入') >= 0, '这次改动没有把「点确认不注入」那条说明碰掉')
  check(chainSrc.indexOf('_chainKeyP') >= 0 && chainSrc.indexOf('currentChainKey') >= 0, 'probe-chain.js 里那条「晚到的旧结果丢弃」的守卫在')
  const guardIdx = chainSrc.indexOf('if (!_chainKeyP.current)')
  const writeIdx = chainSrc.indexOf('st.chainSnapshot = snap')
  check(guardIdx > 0 && writeIdx > guardIdx, '守卫在写快照之前（先判新旧、再决定写不写）')
  check(chainSrc.indexOf('chain.stale.drop') >= 0, '丢弃旧结果时留了一条按需日志（调试开关开着才记）')
}

console.log('')
console.log(failed ? 'FAIL ' + passed + ' 项通过 / ' + failed + ' 项未过' : 'PASS 全部 ' + passed + ' 项检查通过')
process.exit(failed ? 1 : 0)
