/**
 * tests/lib/deck-decide-stub.js —— deck 工具门禁专用的「判定出口」桩
 *
 * 为什么门禁必须给这个依赖
 *   2026-10-11 起（提交 24a4bf33，#1003 单出口），工具壳把「这个工作区用哪个后端」整段交给装配方
 *   递进来的判定出口（`src/deck/shell/call-shell.ts:176-180`）：拿不到它就直接回三态 unsupported
 *   （原因码 backend-threw、散列 missing-decideBackend），一句话都不往后做。
 *   生产装配总是给（`src/deck/registration/host-assemble.ts:116` 的 `decideBackend`），
 *   而门禁夹具各有各的依赖对象、当初没给，于是十几条夹具里工具全回「判定出口这次没装上」——
 *   夹具红着，红的却不是它要守的那件事。这个文件把桩收在一处，供各夹具共用。
 *
 * 为什么桩要读「当下的绑定」而不是写死一个后端 id
 *   壳传进来的只有工作区目录；而门禁里「这个工作区选了谁」的唯一真源是注册表的绑定。
 *   有的夹具中途会把同一个工作区改绑到另一个桩（正向对照那一段），写死 id 会让那一段取到错的桩。
 *   所以这里照生产判定的第一层取 id（`src/tracker/detection/backendDecision.ts:170-178` 的
 *   `registry.bound`）；取不到再退一步问 `select`（与生产判定的自动识别那一层同路）。
 *
 * 为什么回 canWrite: true
 *   壳在 `shell.js:246` 要求「结论必须来自你亲手选过这个工作区」，否则读写都不做。
 *   门禁夹具的桩注册表本身就是「这个工作区已经选好了」的替身，所以按已选定回。
 *   没有绑定时才回没有后端——那种夹具测的是「没后端」这条路，别在这里替它编一个后端。
 *
 * 用法（两种模块形态都能取）
 *   CJS 夹具：const { makeDecideStub } = require('./lib/deck-decide-stub.js')
 *   ESM 夹具：import { makeDecideStub } from './lib/deck-decide-stub.js'
 *   接法：const deps = { ... , decideBackend: makeDecideStub(registry) }
 */
'use strict'

/**
 * 造一个判定出口桩。registry 是夹具自己那份注册表（真的或桩的都要有 bound 或 select）。
 * 返回的函数形状与生产一致：收工作区目录，回 { backendId, source, ref, pending, canWrite }。
 */
function makeDecideStub(registry) {
  return async function decideBackendStub(cwd) {
    const handle = { cwd: cwd }
    let id
    try {
      id = (registry && typeof registry.bound === 'function') ? registry.bound(handle) : undefined
    } catch (e) {
      id = undefined
    }
    // 已绑定（含「显式无后端」的 null）：绑定是唯一真源，照实回。
    if (typeof id === 'string' && id) return { backendId: id, source: 'explicit', canWrite: true }
    if (id === null) return { backendId: null, source: 'fallback' }
    // 没有绑定：问一次选择（夹具的桩注册表多半在这一层直接给答案）。
    try {
      const sel = (registry && typeof registry.select === 'function') ? await registry.select(handle, { cwd: cwd }) : null
      if (sel && sel.backendId) {
        return { backendId: sel.backendId, source: sel.source || 'matches', ref: sel.ref || null, pending: sel.pending, canWrite: sel.canWrite === true }
      }
      if (sel && sel.pending) return { backendId: null, source: 'fallback', pending: true }
    } catch (e) {
      // 选择抛错：按没有后端回，落点由门禁自己断言（这里不替它决定成败）。
    }
    return { backendId: null, source: 'fallback' }
  }
}

module.exports = { makeDecideStub }
