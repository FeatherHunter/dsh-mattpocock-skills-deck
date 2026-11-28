// verify-gitea-read-log.ts —— 双轴评审收编门禁：Gitea 房的 read.degraded 出口收进登记清单。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-gitea-read-log.ts（verify:parallel 的
// behavior 段按 verify-stages.json 的目录约定自动跑这一扇）。
// 断言三件事：
//   1. src/tracker/rooms/gitea/support/read-log.ts 里两张登记表非空、冻结、值形状是「操作名」与「操作名:这一步」；
//   2. Gitea 房源码里 emitReadDegraded 的每个调用点都从登记表取值：字面量 op ∈ READ_DEGRADED_OPS、
//      字面量 reason ∈ READ_DEGRADED_REASONS，出现自由串即红；
//   3. 房里不再有别的 read.degraded 手写出口（backend:'gitea' 的字段对象只允许出现在 read-log.ts 一处）。
//
// 票 #18 起再加一段运行时段（静态段管「取值合不合法」，运行时段管「识别这一趟真会落几行、落什么」）：
//   4. matches 的每个分支落对该落的那一行（没问成的文件线索、exec 兜底问没问、回来什么结论），
//      并且「无文件服务」按 #17 之后的正常兜底分支记，不再当识别失败；
//   5. 落下来的是全仓登记的 read.degraded、本房四格字段、op = matches、reason 在登记表内；
//   6. exec 兜底按契约看回包分档（src/tracker/contract/contexts.ts 的 exec 返回回包、不抛异常）：
//      非零退出或带 error 记 exec-fail，那是「这一问没问成」；只有正常回包才可能记 exec-miss。
//      用 throw 造 exec-fail 是「不守契约的实现」那一支，两条都要盖；
//   7. 日志始终是旁路：没 logEvent、或写日志抛错时，识别结论不受影响。
import { READ_DEGRADED_OPS, READ_DEGRADED_REASONS } from '../src/tracker/rooms/gitea/support/read-log.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
// 运行时段直接调真模块的 matches（同 #1130 的夹具口径：import 写 .ts，钩子负责装载）。
import { giteaBackend } from '../src/tracker/rooms/gitea/index.ts'

import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GITEA = path.join(ROOT, 'src', 'tracker', 'rooms', 'gitea')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('Gitea 房 read.degraded 登记清单门禁（双轴评审收编：op/reason 只许取登记值）')

// 1. 登记表本身
check(Object.isFrozen(READ_DEGRADED_OPS), 'READ_DEGRADED_OPS 冻结（Object.freeze），防止运行时被塞进自由值')
check(Object.isFrozen(READ_DEGRADED_REASONS), 'READ_DEGRADED_REASONS 冻结（Object.freeze），防止运行时被塞进自由值')
check(READ_DEGRADED_OPS.length > 0, 'READ_DEGRADED_OPS 非空：' + READ_DEGRADED_OPS.join(' / '))
check(READ_DEGRADED_REASONS.length > 0, 'READ_DEGRADED_REASONS 非空：' + READ_DEGRADED_REASONS.join(' / '))
check(READ_DEGRADED_REASONS.every((r) => /^[a-zA-Z]+(:[a-zA-Z-]+)?$/.test(r)), 'READ_DEGRADED_REASONS 每条都是「操作名:这一步」形状')

// 2. 调用点取值全部在表内
function walk(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}
const files = walk(GITEA).filter((p) => path.basename(p) !== 'read-log.ts')
let calls = 0
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file)
  const re = /emitReadDegraded\s*\(([^)]*)\)/g
  let m
  while ((m = re.exec(text)) !== null) {
    calls += 1
    const args = m[1]
    // 取前两个实参（effective 之后是 op、reason）：按顶层逗号切分。
    const parts = []
    let depth = 0
    let cur = ''
    for (const ch of args) {
      if (ch === '(' || ch === '[' || ch === '{') depth += 1
      if (ch === ')' || ch === ']' || ch === '}') depth -= 1
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
    }
    parts.push(cur.trim())
    const op = parts[1]
    const reason = parts[2]
    const opLit = /^'([^']+)'$/.exec(op || '')
    const reasonLit = /^'([^']+)'$/.exec(reason || '')
    if (opLit) check(READ_DEGRADED_OPS.includes(opLit[1]), rel + ' 的 op 字面量 ' + opLit[1] + ' 在登记表内')
    if (reasonLit) check(READ_DEGRADED_REASONS.includes(reasonLit[1]), rel + ' 的 reason 字面量 ' + reasonLit[1] + ' 在登记表内')
    // 非字面量时只认登记常量本体：READ_DEGRADED_* 两表，或本身就是表内取值的 LIST_TRUNCATED_REASON。
    const isRegisteredIdent = (x) => /^(READ_DEGRADED_OPS|READ_DEGRADED_REASONS|LIST_TRUNCATED_REASON)/.test(x || '')
    if (!opLit) check(isRegisteredIdent(op), rel + ' 的 op 取自登记常量（' + op + '）')
    if (!reasonLit) check(isRegisteredIdent(reason), rel + ' 的 reason 取自登记常量（' + reason + '）')
  }
}
check(calls >= 11, 'Gitea 房共找到 ' + calls + ' 个 emitReadDegraded 调用点（至少 11 个：list 截断 / listSubIssues 截断 / setBlockedBy 环检放行 / matches 的 8 个分支）')

// 3. 手写出口只许一处：backend:'gitea' 只出现在 read-log.ts
const offenders = files.filter((f) => fs.readFileSync(f, 'utf8').includes("backend: 'gitea'"))
check(offenders.length === 0, "backend:'gitea' 的手写字段对象只在 support/read-log.ts 一处" + (offenders.length ? '（越界：' + offenders.map((f) => path.relative(ROOT, f)).join(', ') + '）' : ''))


// ══════════════════════════════════════════════════════════════════════════
// 运行时段（票 #18）：识别这一趟到底落几行、落的是哪一行
//
// 这一段的判据不是「代码里写了日志」，而是「跑一趟 matches，日志板上真能读出轨迹」：
// 四条线索里哪条没问成、exec 兜底问没问、回来什么结论、各花多久。夹具照 #1130 的规矩来：
// 文件服务交出的是不透明 target，读文本只认 target，不认路径。
// ══════════════════════════════════════════════════════════════════════════
console.log('\n== #18 gitea matches 识别这一趟的日志轨迹 ==')

function newWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gt-18-'))
}
function put(ws, rel, text) {
  const full = path.posix.join(ws, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text, 'utf8')
}

/** 不透明 target 的前缀：只有 resolve 发出来的才带它，readText 靠它认出来源（同 #1130）。 */
const TARGET_PREFIX = 'dsh-target:'

function makeFs(calls) {
  return {
    async resolve(rel, opts) {
      const full = path.posix.join((opts && opts.cwd) || '', rel)
      calls.resolve.push(full)
      return TARGET_PREFIX + full
    },
    async readText(target) {
      if (typeof target !== 'string' || target.indexOf(TARGET_PREFIX) !== 0) {
        throw new TypeError('readText 要的是 resolve() 给出的 target，不是路径：' + String(target))
      }
      const full = target.slice(TARGET_PREFIX.length)
      calls.readText.push(full)
      return fs.readFileSync(full, 'utf8')
    },
  }
}

/** 递给 matches 的操作上下文：带一块记日志的板子，把这一趟落了哪些事件留下来。 */
function ctxOf(ws, opts) {
  const logged = []
  const ctx = {
    cwd: ws,
    opId: 'op-18',
    isEnabled: () => true,
    logEvent: (level, event, fields) => { logged.push({ level, event, fields }) },
  }
  const fsLike = opts && 'fs' in opts ? opts.fs : makeFs({ resolve: [], readText: [] })
  ctx.fs = fsLike
  ctx.platform = opts && 'platform' in opts ? opts.platform : { fs: fsLike }
  ctx.exec = opts && 'exec' in opts ? opts.exec : async () => ({ stdout: '', stderr: '', code: 0 })
  return { ctx, logged }
}

async function run(ws, extra, opts) {
  const { ctx, logged } = ctxOf(ws, opts)
  const handle = Object.assign({ cwd: ws }, extra || {})
  const hit = await giteaBackend.matches(handle, ctx)
  return { hit, logged }
}

const GITEA_CONFIG = '[remote "origin"]\n\turl = https://gitea.example.com/acme/demo.git\n'
const GITHUB_CONFIG = '[remote "origin"]\n\turl = git@github.com:acme/demo.git\n'
const DECL_GITEA = '# Issue tracker: Gitea\n\nIssues live as Gitea issues.\n'
const DECL_GITHUB = '# Issue tracker: GitHub\n\nIssues live as GitHub issues.\n'
const reasonsOf = (r) => r.logged.map((l) => l.fields.reason)
const okExec = async () => ({ stdout: 'git@github.com:acme/demo.git\n', stderr: '', code: 0 })

// ① 认出来了就不再多记：refId、.git/config、声明文件三条成功线索各走一遍。
{
  const r = await run(newWorkspace(), { refId: 'gitea.example.com/acme/demo' })
  check(r.hit === true && r.logged.length === 0, 'refId 显式带 gitea → true，且一行日志都不落（认出来不是降级）')
}
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITEA_CONFIG)
  let execCalls = 0
  const r = await run(ws, null, { exec: async () => { execCalls += 1; return { stdout: '', stderr: '', code: 0 } } })
  check(r.hit === true, '.git/config 的远端地址指向 gitea → true')
  check(r.logged.length === 0, '.git/config 这一条线索就读成了 → 不落 read.degraded（读成功不记）')
  check(execCalls === 0, '认出之后不再问 exec 兜底（兜底是最后一步，不是每趟都跑）')
}
{
  const ws = newWorkspace()
  put(ws, 'docs/agents/issue-tracker.md', DECL_GITEA)
  let execCalls = 0
  const r = await run(ws, null, { exec: async () => { execCalls += 1; return { stdout: '', stderr: '', code: 0 } } })
  check(r.hit === true, 'issue-tracker.md 高置信声明 Gitea → true')
  check(execCalls === 0, '声明这一条线索读成就返回：不跑兜底')
  check(
    r.logged.length === 1 && r.logged[0].fields.reason === 'matches:git-config',
    '这一趟只有 .git/config 没问成那一行（声明读成了、不记），没有第二行',
  )
}

// ② 文件线索读成了、只是写着别家：那是正常否定，不记；但 exec 兜底真跑了，它跑没跑只能靠日志回答。
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITHUB_CONFIG)
  put(ws, 'docs/agents/issue-tracker.md', DECL_GITHUB)
  const r = await run(ws, null, { exec: okExec })
  check(r.hit === false, 'GitHub 工作区 → false')
  check(r.logged.length === 1, '文件线索都读成了（不记），只有 exec 兜底那一行（实际 ' + r.logged.length + ' 行）')
  check(reasonsOf(r)[0] === 'matches:exec-miss', '那一行说清兜底问了、回来的是别家地址（matches:exec-miss）')
}

// ③ 两条文件线索都没问成：各记一行，再说兜底。
{
  const ws = newWorkspace()
  const r = await run(ws)
  check(r.hit === false, '空工作区 → false，不抛')
  const reasons = reasonsOf(r)
  check(reasons.length === 3, '空工作区 + 兜底空答案 → 记三行（实际 ' + reasons.length + ' 行）')
  check(reasons[0] === 'matches:git-config', '第一行说清 .git/config 没问成')
  check(reasons[1] === 'matches:tracker-doc', '第二行说清 issue-tracker.md 没问成')
  check(reasons[2] === 'matches:exec-miss', '第三行说清 exec 兜底问了、回来不指向 gitea')
}

// ④ #17 之后没有文件服务是正常兜底分支：跳两条线索、继续问 exec，日志要能读出这件事。
{
  const r = await run(newWorkspace(), null, {
    fs: null,
    platform: null,
    exec: async () => ({ stdout: 'https://gitea.example.com/acme/demo.git\n', stderr: '', code: 0 }),
  })
  check(r.hit === true, '无文件服务、只有 exec 且回来是 gitea 地址 → true（#17 的兜底仍然可达）')
  const reasons = reasonsOf(r)
  check(reasons.length === 2 && reasons[0] === 'matches:fs-skipped', '先记一行「因无文件服务跳过两条文件线索」（matches:fs-skipped）')
  check(reasons[1] === 'matches:exec-hit', '再记一行「exec 兜底被调用、认出 gitea」（matches:exec-hit）')
}
{
  const r = await run(newWorkspace(), null, { fs: null, platform: null, exec: okExec })
  const reasons = reasonsOf(r)
  check(r.hit === false, '无文件服务、exec 回的是别家地址 → false')
  check(reasons.length === 2 && reasons[0] === 'matches:fs-skipped' && reasons[1] === 'matches:exec-miss', '两行：跳过文件线索 + 兜底问了没认出（不是「问了没问」分不清）')
}
{
  const r = await run(newWorkspace(), null, {
    fs: null,
    platform: null,
    exec: async () => { throw new Error('git 不在') },
  })
  const reasons = reasonsOf(r)
  check(r.hit === false, '无文件服务、兜底命令抛错 → false，不把异常漏给调用方')
  check(reasons.length === 2 && reasons[1] === 'matches:exec-fail', '第二行说清兜底这一问本身失败（matches:exec-fail），不冒充正常否定')
}
{
  // 真实形状：exec 契约返回回包而不抛异常，git 在、但目录不是仓库时是 code 128 + stderr fatal。
  // 只看「有没有抛错」会把这一档误记成 exec-miss（问了、回来别家地址），那是另一种结论。
  const r = await run(newWorkspace(), null, {
    fs: null,
    platform: null,
    exec: async () => ({ stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n', code: 128 }),
  })
  const reasons = reasonsOf(r)
  check(r.hit === false, '兜底回包非零退出（真实形状，不抛异常）→ false')
  check(reasons.length === 2 && reasons[1] === 'matches:exec-fail', '回包 code 128 记 matches:exec-fail，不冒充「问了、回来别家地址」')
}
{
  // 另一头：进程正常退出、只是没给出地址（空输出），这才是「问了、回来别家地址」。
  const r = await run(newWorkspace(), null, {
    fs: null,
    platform: null,
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
  })
  const reasons = reasonsOf(r)
  check(r.hit === false && reasons.length === 2 && reasons[1] === 'matches:exec-miss', '兜底 code 0、输出空 → matches:exec-miss（正常否定，不是失败）')
}
{
  const r = await run(newWorkspace(), null, { fs: null, platform: null, exec: null })
  const reasons = reasonsOf(r)
  check(r.hit === false, '无文件服务、也没有 exec → false')
  check(reasons.length === 2 && reasons[1] === 'matches:exec-unavailable', '第二行说清兜底根本没发出（matches:exec-unavailable），与问了没认出分开')
}

// ⑤ 文件服务在、但没长 readText：同上按「文件线索跳过」走兜底（#17 的形状判据）。
{
  const partial = { resolve: async () => 'x' }
  const r = await run(newWorkspace(), null, {
    fs: partial,
    platform: { fs: partial },
    exec: async () => ({ stdout: 'git@gitea.example.com:acme/demo.git\n', stderr: '', code: 0 }),
  })
  check(r.hit === true, '文件服务缺 readText → 跳过文件线索、exec 兜底照样认出 gitea')
  check(reasonsOf(r)[0] === 'matches:fs-skipped', '缺 readText 也按 matches:fs-skipped 记（同一档兜底分支）')
}

// ⑥ 文件线索都在、兜底抛错：前两行 + 兜底失败那一行。
{
  const ws = newWorkspace()
  const r = await run(ws, null, { exec: async () => { throw new Error('目录不是仓库') } })
  const reasons = reasonsOf(r)
  check(reasons.length === 3 && reasons[2] === 'matches:exec-fail', '两处文件都没有 + 兜底抛错 → 三行，末行是 matches:exec-fail')
}

// ⑦ 整趟抛了别的错：落 matches:unknown，结论照旧 false。
{
  const badHandle = { get cwd() { throw new Error('拿不到目录') } }
  const { ctx, logged } = ctxOf(newWorkspace())
  const hit = await giteaBackend.matches(badHandle, ctx)
  check(hit === false, '识别中途抛了别的错 → false，不把异常漏出去')
  check(logged.length === 1 && logged[0].fields.reason === 'matches:unknown', '这一档落 matches:unknown（记不下来源的那一档，不许当默认值乱用）')
}

// ⑧ 落下来的每一行都必须长成本房登记的样子。
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITHUB_CONFIG)
  put(ws, 'docs/agents/issue-tracker.md', DECL_GITHUB)
  const r = await run(ws, null, { exec: okExec })
  const plain = await run(newWorkspace())
  const all = r.logged.concat(plain.logged)
  check(all.length === 4, '两趟合计四行可供对账（实际 ' + all.length + ' 行）')
  check(all.every((l) => l.level === 'warn' && l.event === 'read.degraded'), '事件与档位：read.degraded / warn（沿用全仓登记，不新开事件）')
  check(all.every((l) => Object.keys(l.fields).sort().join(',') === 'backend,elapsedMs,op,reason'), '字段恰好是本房登记的四格 backend/elapsedMs/op/reason，没多没少')
  check(all.every((l) => l.fields.backend === 'gitea' && l.fields.op === 'matches'), 'backend 恒为 gitea、op 恒为 matches')
  check(all.every((l) => READ_DEGRADED_REASONS.indexOf(l.fields.reason) >= 0), '每一行的 reason 都在本房 READ_DEGRADED_REASONS 登记表里')
  check(all.every((l) => typeof l.fields.elapsedMs === 'number' && Number.isInteger(l.fields.elapsedMs) && l.fields.elapsedMs >= 0), 'elapsedMs 是非负整数（这一笔花了多久）')
}

// ⑨ 两种「没真花时间」的档位记 0；exec 那一档的耗时要真的量到。
{
  const r = await run(newWorkspace(), null, { fs: null, platform: null, exec: null })
  check(r.logged.every((l) => l.fields.elapsedMs === 0), '跳过文件线索、兜底没发出这两档没有真读东西，耗时记 0')
}
{
  const r = await run(newWorkspace(), null, {
    fs: null,
    platform: null,
    exec: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return { stdout: 'git@gitea.example.com:acme/demo.git\n', stderr: '', code: 0 }
    },
  })
  const hitLine = r.logged.find((l) => l.fields.reason === 'matches:exec-hit')
  check(hitLine && hitLine.fields.elapsedMs >= 20, 'exec 兜底那一行量到的是命令耗时（>= 20ms；实际 ' + (hitLine ? hitLine.fields.elapsedMs : '缺失') + 'ms）')
}

// ⑩ 日志始终是旁路：写不出去、或压根没有 logEvent 时，识别结论都不受影响。
{
  // 这一趟必须真的走到 emit（无文件服务 + exec 认出来），否则「logEvent 抛错」这条断言只是空转：
  // 用 .git/config 命中做夹具的话，第一次 emit 之前就已经 return true 了，logEvent 根本没被调用。
  let attempts = 0
  const ctx = {
    cwd: newWorkspace(),
    opId: 'op-18',
    fs: null,
    platform: null,
    exec: async () => ({ stdout: 'git@gitea.example.com:acme/demo.git\n', stderr: '', code: 0 }),
    logEvent: () => { attempts += 1; throw new Error('日志写不出去') },
  }
  const hit = await giteaBackend.matches({ cwd: ctx.cwd }, ctx)
  check(hit === true, 'logEvent 抛错时，识别结论照旧 true（读路径不许因为日志而失败）')
  check(attempts >= 2, '这一趟确实试着落过日志（fs-skipped 与 exec-hit 各一次），不是空转（实际 ' + attempts + ' 次）')
}
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITEA_CONFIG)
  const fsLike = makeFs({ resolve: [], readText: [] })
  const ctx = { cwd: ws, fs: fsLike, platform: { fs: fsLike } }
  const hit = await giteaBackend.matches({ cwd: ws }, ctx)
  check(hit === true, '上下文没有 logEvent 时，识别照旧能判定（宿主兜底那条路）')
}
{
  const hit = await giteaBackend.matches({ cwd: newWorkspace() }, { exec: async () => ({ stdout: 'git@gitea.example.com:acme/demo.git\n', stderr: '', code: 0 }) })
  check(hit === true, '没有 logEvent、没有文件服务，exec 兜底认出 gitea 也照旧 true')
}

if (failed) { console.log('FAIL：' + total + ' 项里有失败项'); process.exit(1) }
console.log('PASS：' + total + ' 项全过')
