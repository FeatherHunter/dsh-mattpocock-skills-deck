// smoke-comment-passthrough.test.ts — #255 宿主透传冒烟（wf.commentIssue）
// 注入假 trackerRegistry（getTrackerRegistry 优先消费 ctx.get('trackerRegistry')），
// 断言：写会话 → 裁决 → tracker.comment 全链路转发、参数无损、错误 kind 直透（G5 无能力表）。
// #1445 起评论写入不再由宿主自己 select/describe/直调房间，而是开一个写会话交给管线：
//   · 假注册表要带上 modules() 与每个后端的预算声明（openTracker 要按后端取花钱口径，缺了就回 pending）；
//   · 假 selection 带 canWrite:true（写操作的写权限由判定出口回答，这里模拟「用户在工作区里选过」）；
//   · 选后端失败那条从 unsupported 变成 env —— 会话开不成属于环境没就绪，不是「这台后端不支持评论」。
// 用法: node --import ./scripts/ts-hook.mts tests/smoke-comment-passthrough.test.ts
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

let failures = 0
const check = (ok: unknown, msg: string): void => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- ESM 语法门禁 ----
try {
  esbuild.transformSync(readFileSync('package/lib/index.js', 'utf8'), { loader: 'js', format: 'esm' })
  check(true, 'ESM 语法编译 OK')
} catch (e) {
  check(false, 'ESM 语法编译: ' + e.message)
}

// ---- 假 registry：github 后端带 comment 捕获器；gitlab-x 后端无 comment 方法（unsupported 桩语义）----
// calls 收 tracker.comment 实收参数，用来事后核对「原样透传」；字段类型按断言实际用到的形状标。
const calls: Array<{ repoRef: { refId: string }; key: unknown; body: string }> = []
// 两条同步定位口（describe）房间实例必须有：写会话靠它把仓库身份补齐，缺了就回「refId missing」。
const ghTracker: { id: string; describe: (...args: unknown[]) => unknown; comment: (...args: unknown[]) => Promise<unknown> } = {
  id: 'github',
  describe: () => ({ backend: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck' }),
  comment: async (repoRef, key, body, opCtx) => { calls.push({ repoRef: repoRef as { refId: string }, key, body: body as string }); return { ok: true, data: { id: '42', author: { login: 'tester' }, body } } },
}
const badTracker = { id: 'gitlab-x', describe: () => ({ backend: 'gitlab-x', refId: 'grp/proj', name: 'proj', url: '' }) }
// 预算声明（#1441 起后端必填）：github 双桶；没有 comment 的 gitlab-x 用离网口径（这台后端不花额度）。
const githubBudget = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
const offNetworkBudget = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }
const fakeRegistry = {
  // #1555：判定出口按注册表契约问 has；伪造表要照契约补上，否则“装没装”一问就判没装。
  has: (id) => id === 'github' || id === 'gitlab-x',
  // canWrite:true = 用户在这个工作区里显式选过后端；写会话要拿它过写权限硬顶。
  select: async () => ({ backendId: 'github', source: 'explicit', canWrite: true, reason: '工作区文件里人显式选过' }),
  describe: (_handle, backendId) => ({ backend: backendId, refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck' }),
  get: (id) => id === 'github' ? ghTracker : badTracker,
  // 会话要按后端编号取预算声明：缺 modules 或某一格没预算，openTracker 会回 pending（不再走向下转发）。
  modules: () => [
    { id: 'github', budget: githubBudget },
    { id: 'gitlab-x', budget: offNetworkBudget },
  ],
}

let registered = null
let route = null
const subprocess = { async resolveExecutable() { return 'gh' }, spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {} } } }
const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
const services = {
  subprocess, timer, fs: fsSvc,
  trackerRegistry: fakeRegistry,
  // #596：宿主改经 connection.fetch.register 注册一条精确路由 /api/dsws，端点名与入参装在请求体里。
  //   旧写法 connection.rpc.handle 已不成立 —— 那时 registered 永远是 null，
  //   本冒烟会静止在「未注册」分支里空过，所以必须跟着换。
  connection: { fetch: { register: (r) => { route = r; return () => {} } } },
}
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

const modRaw = await import('../package/lib/index.js')
const mod = modRaw.default ?? modRaw
;(mod.apply ?? mod.default?.apply)(ctx)

// 通道注册经 ./rpcChannel.js 动态加载完成（宿主禁止静态 import 的既有约定），等它落地再发调用。
async function waitRoute(): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < 3000) {
    if (route && typeof route.fetch === 'function') return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return false
}
// 按客户端真实形状发一次调用：POST 到 /api/dsws，体是 DSH 的 client-request 信封，
// 内层 payload 装 { method: 端点名, payload: 入参 }；从回包里取出端点原始返回值。
async function callHandler(endpoint: string, args: Record<string, unknown>): Promise<unknown> {
  if (!(await waitRoute())) throw new Error('通道未注册：connection.fetch.register 没被调用')
  const res = await route.fetch({
    method: 'POST',
    url: 'http://127.0.0.1/api/dsws',
    json: async () => ({ type: 'client-request', rpcId: 'comment-' + endpoint, method: 'dsws', payload: { method: endpoint, payload: args } }),
  })
  const env = await res.json()
  if (!env || env.type !== 'server-response') throw new Error('回包不是 server-response 信封：' + JSON.stringify(env))
  return env.result && env.result.value
}

// 回包既可能是 {ok:true,value:...} 的传输信封，也可能是端点原始返回值；两种形状字段不同，
// 所以这里按联合类型标注，断言处自己按字段收窄（本文件不被 tsc 检查，标注只为读起来清楚）。
type EndpointReply = { ok?: boolean; value?: unknown; error?: { kind?: string; message?: string } } | null | undefined
const unwrap = (r: EndpointReply): EndpointReply => (r && r.ok === true && 'value' in r ? (r.value as EndpointReply) : r) // dispatch 传输信封：{ok:true,value:handler结果}
if (await waitRoute()) {
  check(!!route && route.path === '/api/dsws', '通道注册在 /api/dsws（客户端请求路径与宿主注册路径同源）')
  // 1) 校验：缺 body → parse
  // 每次调用都带 cwd：#1003 空目录闸之后，宿主电话要求调用方给出工作区目录
  //（`src/refresh/rooms/host/comment-thread-fetch.js`：没给就按「工作区还没就绪」直接拒绝，连参数校验都走不到），
  // 而这条冒烟测的是参数校验与透传，不是空目录那一支，所以按「工作区已就绪」发。
  const bad = unwrap(await callHandler('commentIssue', { number: 255, cwd: 'D:/work/repo' }))
  check(!!bad && bad.ok === false && bad.error && bad.error.kind === 'parse', '缺 body → {ok:false,kind:parse}')

  // 2) 校验：缺 number → parse
  const badN = unwrap(await callHandler('commentIssue', { body: 'hi', cwd: 'D:/work/repo' }))
  check(!!badN && badN.ok === false && badN.error && badN.error.kind === 'parse', '缺 number → {ok:false,kind:parse}')

  // 3) happy path：写会话 → 管线 → tracker.comment 参数无损
  const good = unwrap(await callHandler('commentIssue', { number: 255, body: 'hello #255', cwd: 'D:/work/repo' }))
  check(!!good && good.ok === true, '透传成功 ok=true')
  check(calls.length >= 1 && String(calls[0].key) === '255', 'tracker.comment 收到 key=255')
  check(calls.length >= 1 && calls[0].body === 'hello #255', 'body 原文透传')
  check(calls.length >= 1 && !!calls[0].repoRef && calls[0].repoRef.refId === 'FeatherHunter/dsh-mattpocock-skills-deck', 'repoRef.refId 由写会话按注册表 describe 补齐')

  // 4) 错误直透：comment 返回 auth → 端点原样返回（UI 分流数据源）
  ghTracker.comment = async () => ({ ok: false, error: { kind: 'auth', message: 'not logged in' } })
  const authed = unwrap(await callHandler('commentIssue', { number: 255, body: 'x', cwd: 'D:/work/repo' }))
  check(!!authed && authed.ok === false && authed.error && authed.error.kind === 'auth', 'TrackerError{kind:auth} 直透')

  // 5) 未实现 comment 的后端 → unsupported（诚实失败，非假装成功）
  fakeRegistry.select = async () => ({ backendId: 'gitlab-x', source: 'explicit', canWrite: true, reason: '工作区文件里人显式选过' })
  const unsup = unwrap(await callHandler('commentIssue', { number: 255, body: 'y', cwd: 'D:/work/repo' }))
  check(!!unsup && unsup.ok === false && unsup.error && unsup.error.kind === 'unsupported', '后端无 comment 方法 → kind:unsupported')

  // 6) 选不出后端 → 写会话开不成 → env（环境没就绪，不是后端不支持）
  fakeRegistry.select = async () => null
  const nosel = unwrap(await callHandler('commentIssue', { number: 255, body: 'z', cwd: 'D:/work/repo' }))
  check(!!nosel && nosel.ok === false && nosel.error && nosel.error.kind === 'env', 'selection 为空 → kind:env（写会话没开成）')
  check(!!nosel && !!nosel.error && /写会话没开成/.test(String(nosel.error.message || '')), '那一句文案说清是写会话没开成')
} else {
  check(false, 'dispatch fn 未注册')
}

console.log(failures ? `\n评论透传冒烟失败 ${failures} 项` : '\n评论透传冒烟全部通过')
process.exit(failures ? 1 : 0)
