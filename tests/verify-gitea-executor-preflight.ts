#!/usr/bin/env node
// tests/verify-gitea-executor-preflight.ts —— 门禁：Gitea 房 preflight 的执行器判定（票 #21）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-gitea-executor-preflight.ts
//
// 规格（父票 #19）定的判定顺序：先探 gt（resolveExecutable → `gt api /version` → 服务器 ≥ 28），
// 探不上统一落回 tea 沿用原三步探活；gt 与 tea 都没装时回 ENV 失败，文案指引装 gt 并说明
// 「仅当服务器低于 Gitea 28 才需要 tea」。选中的执行器还要写进 prompts.commandVocabulary.cli。
//
// 门禁盯六件事（全部只测外部行为，假 platform + 假 exec，与 verify-gitea-chain-predicates 同一接缝）：
//   ① gt 已装且服务器 ≥ 28 → 选中 gt，结果带 executor:'gt'、无 fallbackReason，词表 cli 变 'gt'；
//   ② gt 未装 → 落回 tea，executor:'tea' + fallbackReason:'gt not found'，tea 三步照跑，cli 变回 'tea'；
//   ③ gt 探测失败（/version 非零退出 / 输出认不出）→ 落回 tea，reason 写明探到哪一步失败；
//   ④ 服务器 < 28（1.27.2，#20 真机同款）→ 落回 tea，reason:'server version below 28'；
//   ⑤ 双缺 → ENV 失败，message 含 gt 安装指引与「低于 28 才需要 tea」的边界说明；
//   ⑥ gt 探测失败且 tea 也探活失败 → kind 与原文不变，message 前缀写清为什么落回 tea。
// 另附一条回归：直接调 teaPreflight 的行为与票 #21 之前一致（chain-predicates 门禁仍依赖它）。
// 门禁归属: src/tracker/rooms/gitea/preflight.ts
// 门禁归属: src/tracker/rooms/gitea/room/prompts.ts
// 门禁归属: src/tracker/rooms/gitea/index.ts
// 门禁归属: src/tracker/contract/results.ts
const nodePath = require('path')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total += 1
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

async function main() {
const mod = await import(url('src/tracker/rooms/gitea/preflight.ts'))
const promptMod = await import(url('src/tracker/rooms/gitea/room/prompts.ts'))

/** 假平台：resolveExecutable 按名字查这张表，表里没有的名字一律 null（没装）。 */
function makePlatform(map) {
  return {
    async resolveExecutable(name) { return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null },
  }
}
/** 假执行器：记下每次调用，按 (cmd, args[0]) 查回包；handler 抛异常也照记照抛。 */
function makeExec(handler) {
  const calls = []
  const exec = async function (cmd, args, opts) {
    calls.push({ cmd: cmd, args: args, opts: opts })
    return handler(cmd, args, opts)
  }
  return { exec: exec, calls: calls }
}
/** tea 探活会成功的那一份回包：login list 两行（有登录项）、issues ls 一行。 */
function teaOkHandler(cmd) {
  if (cmd === 'tea') return Promise.resolve({ code: 0, stdout: 'user https://gitea.example token\nuser https://gitea.example token\n', stderr: '' })
  return Promise.resolve({ code: 0, stdout: '', stderr: '' })
}
/** 组一次 preflight 入参：句柄带 cwd（触发第三步可达探活），ctx 带 platform 与 exec。 */
function runPreflight(preflightFn, platform, execBag) {
  const handle = { cwd: 'D:/demo-gitea' }
  const ctx = { platform: platform, exec: execBag.exec }
  return preflightFn(handle, ctx)
}
/** gt 版本应答的那一份回包：code 0 + 单键 JSON（#20 真机实测的形状）。 */
function gtVersionHandler(version) {
  return function (cmd) {
    if (cmd === 'gt') return Promise.resolve({ code: 0, stdout: JSON.stringify({ version: version }), stderr: '' })
    return teaOkHandler(cmd)
  }
}

title('① gt 已装且服务器 ≥ 28 → 选中 gt，词表 cli 变 gt')
{
  const platform = makePlatform({ gt: 'C:/bin/gt', tea: null })
  const bag = makeExec(gtVersionHandler('1.30.1'))
  const r = await runPreflight(mod.giteaPreflight, platform, bag)
  must(r.ok === true, 'gt 可用时 preflight 通过')
  must(r.executor === 'gt', '结果带 executor:gt', JSON.stringify(r.executor))
  must(!('fallbackReason' in r), '选中 gt 时不写 fallbackReason')
  must(promptMod.prompts.commandVocabulary.cli === 'gt', '词表 cli 注入成 gt', JSON.stringify(promptMod.prompts.commandVocabulary.cli))
  must(bag.calls.some((c) => c.cmd === 'gt' && c.args.join(' ') === 'api /version'), '真的跑了 gt api /version')
  // 边界：正好 1.28.0 也算「≥ 28」。
  const edge = makeExec(gtVersionHandler('1.28.0'))
  const rEdge = await runPreflight(mod.giteaPreflight, makePlatform({ gt: 'C:/bin/gt', tea: null }), edge)
  must(rEdge.ok === true && rEdge.executor === 'gt', '1.28.0 正好踩线也选中 gt')
}

title('② gt 未装 → 落回 tea，reason 与词表都跟着变')
{
  promptMod.setSelectedExecutor('gt') // 先故意置成 gt，验证落回会把它改回 tea
  const platform = makePlatform({ tea: 'C:/bin/tea' })
  const bag = makeExec(teaOkHandler)
  const r = await runPreflight(mod.giteaPreflight, platform, bag)
  must(r.ok === true, 'gt 缺但 tea 可用时 preflight 通过')
  must(r.executor === 'tea', '结果带 executor:tea', JSON.stringify(r.executor))
  must(r.fallbackReason === 'gt not found', 'fallbackReason 写明 gt 未装', JSON.stringify(r.fallbackReason))
  must(promptMod.prompts.commandVocabulary.cli === 'tea', '词表 cli 落回 tea', JSON.stringify(promptMod.prompts.commandVocabulary.cli))
  must(bag.calls.some((c) => c.cmd === 'tea' && c.args[0] === 'login'), '落回后 tea 三步探活照跑')
}

title('③ gt 探测失败（非零退出 / 输出认不出）→ 落回 tea 且 reason 写到点')
{
  const platform = makePlatform({ gt: 'C:/bin/gt', tea: 'C:/bin/tea' })
  const bad = makeExec(function (cmd) {
    if (cmd === 'gt') return Promise.resolve({ code: 1, stdout: '', stderr: 'connection refused' })
    return teaOkHandler(cmd)
  })
  const r1 = await runPreflight(mod.giteaPreflight, platform, bad)
  must(r1.ok === true && r1.executor === 'tea', '探测失败落回 tea', JSON.stringify({ ok: r1.ok, executor: r1.executor }))
  must(String(r1.fallbackReason || '').indexOf('gt api /version failed') === 0, 'reason 写明 /version 失败', JSON.stringify(r1.fallbackReason))

  const weird = makeExec(function (cmd) {
    if (cmd === 'gt') return Promise.resolve({ code: 0, stdout: 'not a version at all', stderr: '' })
    return teaOkHandler(cmd)
  })
  const r2 = await runPreflight(mod.giteaPreflight, platform, weird)
  must(r2.fallbackReason === 'unrecognized version output', '输出认不出按规格落回', JSON.stringify(r2.fallbackReason))
}

title('④ 服务器 < 28（1.27.2）→ 落回 tea')
{
  const platform = makePlatform({ gt: 'C:/bin/gt', tea: 'C:/bin/tea' })
  const bag = makeExec(gtVersionHandler('1.27.2'))
  const r = await runPreflight(mod.giteaPreflight, platform, bag)
  must(r.ok === true && r.executor === 'tea', '低版本服务器落回 tea')
  must(r.fallbackReason === 'server version below 28', 'reason 写明版本不够', JSON.stringify(r.fallbackReason))
}

title('⑤ gt 与 tea 都没装 → ENV 失败 + 规格定的组合文案')
{
  const platform = makePlatform({})
  const bag = makeExec(teaOkHandler)
  const r = await runPreflight(mod.giteaPreflight, platform, bag)
  must(r.ok === false, '双缺时 preflight 失败')
  must(r.error && r.error.kind === 'env', '失败档位是 ENV', JSON.stringify(r.error && r.error.kind))
  must(String(r.error && r.error.message).indexOf('https://gitea.com/gitea/cli') >= 0, '文案含 gt 安装指引', JSON.stringify(r.error && r.error.message))
  must(String(r.error && r.error.message).indexOf('低于 28') >= 0, '文案说明 tea 只在服务器低于 28 时才需要')
}

title('⑥ gt 探测失败且 tea 探活也失败 → 档位原文不变，message 前缀写落回原因')
{
  const platform = makePlatform({ gt: 'C:/bin/gt', tea: 'C:/bin/tea' })
  const bag = makeExec(function (cmd) {
    if (cmd === 'gt') return Promise.resolve({ code: 0, stdout: JSON.stringify({ version: '1.27.2' }), stderr: '' })
    return Promise.resolve({ code: 7, stdout: '', stderr: ' tea: token expired' })
  })
  const r = await runPreflight(mod.giteaPreflight, platform, bag)
  must(r.ok === false, 'tea 探活失败时整体失败')
  must(String(r.error && r.error.message).indexOf('gt 不可用（server version below 28）') === 0, 'message 前缀写落回原因', JSON.stringify(r.error && r.error.message))
  must(String(r.error && r.error.message).indexOf('token expired') > 0, 'tea 失败原文还在 message 里')
  must(r.error && r.error.raw && String(r.error.raw).indexOf('token expired') >= 0, 'raw 原文原样保留')
}

title('⑦ 回归：teaPreflight 直调行为与票 #21 之前一致')
{
  const platform = makePlatform({ tea: 'C:/bin/tea' })
  const bag = makeExec(teaOkHandler)
  const r = await runPreflight(mod.teaPreflight, platform, bag)
  must(r.ok === true, 'tea 三步探活通过')
  must(!('executor' in r) && !('fallbackReason' in r), 'teaPreflight 自身不写执行器字段')
  const missing = await runPreflight(mod.teaPreflight, makePlatform({}), makeExec(teaOkHandler))
  must(missing.ok === false && missing.error && missing.error.message === 'tea not found' && missing.error.kind === 'env', '没装 tea 仍是 ENV tea not found', JSON.stringify(missing.error))
}

  console.log('\n共 ' + total + ' 条不变式' + (broken.length ? '，红 ' + broken.length + ' 条' : '，全绿'))
  if (broken.length) {
    console.error(broken.map((b) => 'BROKEN: ' + b).join('\n'))
    process.exit(1)
  }
}

main().catch(function (e) { console.error(e); process.exit(1) })

