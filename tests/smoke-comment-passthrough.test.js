// smoke-comment-passthrough.test.js — #255 宿主透传冒烟（wf.commentIssue）
// 注入假 trackerRegistry（getTrackerRegistry 优先消费 ctx.get('trackerRegistry')），
// 断言：select→describe→tracker.comment 全链路转发、参数无损、错误 kind 直透（G5 无能力表）。
// 用法: node tests/smoke-comment-passthrough.test.js
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- ESM 语法门禁 ----
try {
  esbuild.transformSync(readFileSync('package/lib/index.js', 'utf8'), { loader: 'js', format: 'esm' })
  check(true, 'ESM 语法编译 OK')
} catch (e) {
  check(false, 'ESM 语法编译: ' + e.message)
}

// ---- 假 registry：github 后端带 comment 捕获器；bad2 后端无 comment 方法（unsupported 桩语义）----
const calls = []
const ghTracker = {
  id: 'github',
  comment: async (repoRef, key, body, opCtx) => { calls.push({ repoRef, key, body }); return { ok: true, data: { id: '42', author: { login: 'tester' }, body } } },
}
const badTracker = { id: 'gitlab-x' }
let commentResult = null // 可注入失败场景
const fakeRegistry = {
  select: async () => ({ backendId: 'github', source: 'explicit' }),
  describe: (_handle, backendId) => ({ backend: backendId, refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck' }),
  get: (id) => id === 'github' ? ghTracker : badTracker,
}

let registered = null
const subprocess = { async resolveExecutable() { return 'gh' }, spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {} } } }
const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
const services = {
  subprocess, timer, fs: fsSvc,
  trackerRegistry: fakeRegistry,
  connection: { rpc: { handle: (path, fn, opts) => { registered = { path, fn, opts } } } },
}
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

const modRaw = await import('../package/lib/index.js')
const mod = modRaw.default ?? modRaw
;(mod.apply ?? mod.default?.apply)(ctx)

const unwrap = (r) => (r && r.ok === true && 'value' in r ? r.value : r) // dispatch 传输信封：{ok:true,value:handler结果}
if (registered && typeof registered.fn === 'function') {
  // 1) 校验：缺 body → parse
  const bad = unwrap(await registered.fn('commentIssue', { number: 255 }))
  check(!!bad && bad.ok === false && bad.error && bad.error.kind === 'parse', '缺 body → {ok:false,kind:parse}')

  // 2) 校验：缺 number → parse
  const badN = unwrap(await registered.fn('commentIssue', { body: 'hi' }))
  check(!!badN && badN.ok === false && badN.error && badN.error.kind === 'parse', '缺 number → {ok:false,kind:parse}')

  // 3) happy path：select→describe→tracker.comment 参数无损
  const good = unwrap(await registered.fn('commentIssue', { number: 255, body: 'hello #255', cwd: 'D:/work/repo' }))
  check(!!good && good.ok === true, '透传成功 ok=true')
  check(calls.length >= 1 && String(calls[0].key) === '255', 'tracker.comment 收到 key=255')
  check(calls.length >= 1 && calls[0].body === 'hello #255', 'body 原文透传')
  check(calls.length >= 1 && !!calls[0].repoRef && calls[0].repoRef.refId === 'FeatherHunter/dsh-mattpocock-skills-deck', 'repoRef.refId 来自 registry.describe')

  // 4) 错误直透：comment 返回 auth → 端点原样返回（UI 分流数据源）
  ghTracker.comment = async () => ({ ok: false, error: { kind: 'auth', message: 'not logged in' } })
  const authed = unwrap(await registered.fn('commentIssue', { number: 255, body: 'x' }))
  check(!!authed && authed.ok === false && authed.error && authed.error.kind === 'auth', 'TrackerError{kind:auth} 直透')

  // 5) 未实现 comment 的后端 → unsupported（诚实失败，非假装成功）
  fakeRegistry.select = async () => ({ backendId: 'gitlab-x', source: 'explicit' })
  const unsup = unwrap(await registered.fn('commentIssue', { number: 255, body: 'y' }))
  check(!!unsup && unsup.ok === false && unsup.error && unsup.error.kind === 'unsupported', '后端无 comment 方法 → kind:unsupported')

  // 6) select 失败 / 无后端 → unsupported
  fakeRegistry.select = async () => null
  const nosel = unwrap(await registered.fn('commentIssue', { number: 255, body: 'z' }))
  check(!!nosel && nosel.ok === false && nosel.error && nosel.error.kind === 'unsupported', 'selection 为空 → kind:unsupported')
} else {
  check(false, 'dispatch fn 未注册')
}

console.log(failures ? `\n评论透传冒烟失败 ${failures} 项` : '\n评论透传冒烟全部通过')
process.exit(failures ? 1 : 0)