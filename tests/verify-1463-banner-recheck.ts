// verify-1463-banner-recheck.ts — #1463 点「重新检查」必须有反应：带令牌、有转圈、失败留痕
// 背景：pending 中性条的主按钮走 recheckNow（bannerChain.ts），从前三个后台请求全是静默 fire-and-forget：
//   wf.detect 那一行没带 user-recheck（与文件头上「必须带令牌」自相矛盾）、从不置 refreshing（胶囊转圈都不转）、
//   失败处全是空 catch（日志里查不到）。登录态若真仍未确认，重算回来还是 pending，界面纹丝不动＝「完全没反应」。
// 修法：detect 补 trigger；点下置 refreshing+emit、全部落定后清掉；detect 失败记一行 warn。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1463-banner-recheck.ts
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spliceableJs } from './lib/source-text.ts'
import { compileFn } from './lib/eval-probe.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function loadBannerChain(opts) {
  const failDetect = !!(opts && opts.failDetect)
  const guide = await import(pathToFileURL(resolve(ROOT, 'src/shared/tracker/guide-steps.ts')).href)
  const body = spliceableJs('src/client/statusbar/bannerChain.js')
  const seen = { injected: [], logged: [], emits: 0, detectCalls: [], chainCalls: [], snapReloads: 0, flashed: [] }
  const stepsOf = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
  const sandbox = {
    guideStepsFor: guide.guideStepsFor,
    guideStepDone: guide.guideStepDone,
    guideBannerOf: guide.guideBannerOf,
    guideMissingOf: guide.guideMissingOf,
    currentBackendId: (st) => (st && st.selection && st.selection.backendId != null) ? st.selection.backendId : null,
    chainSteps: stepsOf,
    chainStep: (st, id) => stepsOf(st).find((x) => String(x.id) === String(id)) || null,
    checkShowTitle: () => '',
    installSkillsParams: () => ({}),
    promptText: (id) => 'PROMPT:' + id,
    promptTextFor: (st, id) => 'PROMPT:' + id,
    moduleMetaOf: () => null,
    promptLang: () => 'en',
    onStatusSetupInit: () => 'askLayout',
    createActionDispatcher: () => ({ dispatch: () => {} }),
    inject: (st, text) => { seen.injected.push(String(text)) },
    openUrl: () => {},
    host: { call: (method, args) => {
      if (method === 'wf.detect') {
        seen.detectCalls.push(args || {})
        if (failDetect) return Promise.reject(new Error('net down'))
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true })
    } },
    openFormModal: () => {},
    chainEventRefresh: (st, why) => { seen.chainCalls.push(String(why)); return Promise.resolve(null) },
    loadChain: (st, force, why) => { seen.chainCalls.push(String(why)); return Promise.resolve(null) },
    loadSnapshot: () => { seen.snapReloads += 1; return Promise.resolve(null) },
    flash: (st, msg, kind) => { seen.flashed.push({ msg: String(msg), kind: String(kind) }) },
    openStatusGate: () => {},
    emit: (st) => { seen.emits += 1 },
    log: (level, event, fields) => { seen.logged.push({ level, event, fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
  }
  const names = Object.keys(sandbox)
  const factory = compileFn(names, body + '\n;return { guideBannerStep: guideBannerStep, runGuideMissing: runGuideMissing }')
  return { mod: factory(...names.map((n) => sandbox[n])), seen }
}

const mk = (chain) => ({ cwd: '/w/demo', selection: { backendId: 'github' }, chainSnapshot: { steps: Object.keys(chain).map((id) => ({ id, status: chain[id] })) } })

async function main() {
  console.log('== 1. pending 主按钮：detect 带 user-recheck 令牌 ==')
  {
    const { mod, seen } = await loadBannerChain()
    const st = mk({ 'gh:installed': 'done', 'gh:authed': 'pending' })
    const step = mod.guideBannerStep(st, false)
    ok(!!step && step.id === 'gh:authed', 'pending 选中的仍是登录那一步')
    ok(mod.runGuideMissing(st, step) === 'action', 'pending 按钮走重查那一路')
    ok(seen.detectCalls.length === 1, 'wf.detect 只打一次（实打 ' + seen.detectCalls.length + ' 次）')
    ok(seen.detectCalls[0] && seen.detectCalls[0].trigger === 'user-recheck', 'wf.detect 带 trigger=user-recheck 上报（实得 ' + JSON.stringify(seen.detectCalls[0]) + '）')
    ok(seen.chainCalls.length === 1 && seen.chainCalls[0] === 'user-recheck', '链重查带 user-recheck（实得 ' + JSON.stringify(seen.chainCalls) + '）')
    ok(seen.snapReloads === 1, '快照重取一次')
  }

  console.log('== 2. 点下去有转圈、落定后收掉（refreshing 起落 + emit） ==')
  {
    const { mod, seen } = await loadBannerChain()
    const st = mk({ 'gh:installed': 'done', 'gh:authed': 'pending' })
    const step = mod.guideBannerStep(st, false)
    mod.runGuideMissing(st, step)
    ok(st.refreshing === true, '点下后 refreshing 为 true（有转圈的依据）')
    ok(seen.emits >= 1, '点下后至少 emit 一次（界面重渲染，实 ' + seen.emits + ' 次）')
    await sleep(60)
    ok(st.refreshing === false, '全部落定后 refreshing 收回 false（不卡转圈）')
    ok(seen.emits >= 2, '落定后又 emit（转圈收掉看得见，累计 ' + seen.emits + ' 次）')
  }

  console.log('== 3. detect 失败：不吞错，留一行 warn ==')
  {
    const { mod, seen } = await loadBannerChain({ failDetect: true })
    const st = mk({ 'gh:installed': 'done', 'gh:authed': 'pending' })
    const step = mod.guideBannerStep(st, false)
    mod.runGuideMissing(st, step)
    await sleep(60)
    ok(st.refreshing === false, '失败了转圈也要收掉（实 ' + String(st.refreshing) + '）')
    const w = seen.logged.find((l) => l.level === 'warn' && l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.detect')
    ok(!!w, 'detect 失败记一行 warn host.call.fail（日志里查得到这次点击）')
  }

  if (failed) { console.log('\n1463 RECHECK TESTS FAILED'); process.exitCode = 1; return }
  console.log('\n1463 RECHECK TESTS PASSED')
}

main().catch((e) => { console.log('FAIL 沙箱求值失败：' + String((e && e.message) || e)); process.exitCode = 1 })
