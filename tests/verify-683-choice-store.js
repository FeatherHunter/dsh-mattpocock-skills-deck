#!/usr/bin/env node
/**
 * verify-683-choice-store.js —— F1「用户选的后端按工作区存一份在宿主侧」的门禁（#683）
 *
 * 这份门禁量的是 ADR `docs/adr/20260921-persist-user-choice-host-side.md` 第 8 节里
 * 属于「宿主侧那个状态文件」自己的那几条：R2（修订号由宿主发号）、R5b（只认注册表认得的后端）、
 * R5c（文件坏与单条坏分开处理）、R7/R8（原子落盘、上限淘汰）、R9（并发串行）、
 * R6 的存储形状（布局与后端记录同一种形状）、R7 的「只存散列、不落明文路径」。
 *
 * 分两组：
 *   A 行为层：真跑 src/host/choiceStore.js —— 真 node:fs 写进一个临时主目录（不碰真主目录）。
 *   B 反证：把真源改坏（去掉原子写、去掉散列、去掉守卫、去掉队列、去掉淘汰），
 *     把改坏的那一份**真的求值出来跑**，上面该红的那几条必须当场变红 —— 只比字符串不等、
 *     却仍跑真源，等于这道反证是假的（#669 那道门禁整改过一次，这里照它的写法）。
 *
 * 日志点为什么不在这份门禁里：那几条事件（读到没有、写失败、文件坏、被更旧的顶回、淘汰）
 * 要跟 research/489-appendix.md 第 1 章的对照表、tests/verify-log-count.js 与
 * tests/verify-log-fields.js 同一个提交改完才不许红 —— 所以它们随「接上判定链」那一步一起落地，
 * 那一步的主门禁里量（见 #683 的落地清单）。
 *
 * 用法：node tests/verify-683-choice-store.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as realFs from 'node:fs/promises'

const ROOT = path.resolve(import.meta.dirname, '..')
const MODULE_REL = 'src/host/choiceStore.js'
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmpDirs = []
const makeHome = function () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-choice-store-')); tmpDirs.push(d); return d }
const KEY = 'd:\\3DeepSeekHarness\\agents\\shujucangkuguanliyuan'
const OTHER_KEY = 'd:\\dsh-plugin\\demo-test-09200013'

if (!fs.existsSync(path.join(ROOT, MODULE_REL))) {
  console.log('  FAIL 模块存在（' + MODULE_REL + ' 还没写出来）')
  console.log('\n存在失败 — verify-683-choice-store 未通过')
  process.exit(1)
}
const src = fs.readFileSync(path.join(ROOT, MODULE_REL), 'utf8')
const mod = await import(url(MODULE_REL))
const { createChoiceStore, choicesFilePath, hashWorkspaceKey, LAYOUT_VALUES, DEFAULT_MAX_WORKSPACES } = mod

console.log('选择状态文件门禁（#683 F1：原子落盘、只存散列、上限淘汰、并发串行、坏文件不采纳也不写）')

// 记录型文件服务：把真 node:fs 包一层，既落真盘又能看调用序列；overrides 用来制造失败与延迟。
const wrapFs = function (calls, overrides) {
  const out = {}
  for (const name of ['mkdir', 'readFile', 'rename', 'stat', 'unlink', 'writeFile']) {
    out[name] = async function (...args) {
      calls.push({ name: name, args: args })
      if (overrides && overrides[name]) return overrides[name](...args)
      return realFs[name](...args)
    }
  }
  return out
}
const makeStore = function (home, extra) {
  return createChoiceStore(Object.assign({ homeDir: home, isKnownBackend: () => true }, extra || {}))
}

// ── A 行为层 ───────────────────────────────────────────────────────────────────────
console.log('')
console.log('== A 行为层：真模块 + 真落盘（临时主目录）==')
{
  const home = makeHome()
  const st = makeStore(home)
  const file = choicesFilePath(home)

  const fresh = await st.read()
  check(fresh.ok === true && fresh.missing === true, '文件还不存在时读到的就是「没有」（missing）—— 这一档允许按 R1 的迁移分支写第一笔')
  check(file === path.join(home, '.dsh', 'mattskillsdeck', 'choices.json'), '文件落在用户主目录下的 .dsh/mattskillsdeck/choices.json —— 实得 ' + file)

  // R2：修订号由宿主发号，每接受一次用户选择 +1
  const r1 = await st.rememberWorkspace(KEY, 'github')
  const r2 = await st.rememberWorkspace(KEY, 'markdown')
  check(r1.ok === true && r1.rev === 1, '第一次记住 → rev=1（宿主发号）—— 实得 ' + JSON.stringify(r1))
  check(r2.ok === true && r2.rev === 2, '同一个工作区再记一次 → rev=2 —— 实得 ' + JSON.stringify(r2))
  const got = await st.getWorkspace(KEY)
  check(got.ok === true && got.found === true && got.backendId === 'markdown' && got.rev === 2, '读回来是最后那一条后端与它的 rev —— 实得 ' + JSON.stringify(got))
  const miss = await st.getWorkspace(OTHER_KEY)
  check(miss.ok === true && miss.found === false, '没记过的工作区读回来是「没有」（不当成有）—— 实得 ' + JSON.stringify(miss))

  // R7：文件里只存散列，不落明文路径
  const text = fs.readFileSync(file, 'utf8')
  check(!text.includes('shujucangkuguanliyuan') && !text.includes('3DeepSeekHarness') && !text.includes('demo-test'), '文件里没有工作区路径原文（只存散列）—— 文件内容：' + text.replace(/\s+/g, ' ').slice(0, 160))
  check(text.includes(hashWorkspaceKey(KEY)), '文件里的键就是这条工作区那把键的散列 —— 期望 ' + hashWorkspaceKey(KEY))
  check(hashWorkspaceKey(KEY) === hashWorkspaceKey(KEY) && hashWorkspaceKey('d:\\a\\b') !== hashWorkspaceKey('d:/a/b'), '散列函数吃的就是给它的那一整串（不再做任何规整：反斜杠与正斜杠是两把键）—— 这正是客户端只许送 cwd、不许参与算键的理由')
  check(JSON.parse(text).workspaces[hashWorkspaceKey(KEY)].source === 'user' && JSON.parse(text).version === 1, '记录形状带 source=user，文件带 version=1（R2 定的形状）')

  // R7：原子落盘 —— 先写临时文件、再改名；写完不残留
  const calls = []
  const st2 = makeStore(home, { fs: wrapFs(calls) })
  const r3 = await st2.rememberWorkspace(KEY, 'github')
  const wrote = calls.filter((c) => c.name === 'writeFile')[0]
  const renamed = calls.filter((c) => c.name === 'rename')[0]
  check(r3.ok === true && !!wrote && String(wrote.args[0]).endsWith('.tmp') && wrote.args[2] && wrote.args[2].flag === 'wx', '先写临时文件（名字以 .tmp 结尾、用 wx 独占标志）—— 实得 ' + JSON.stringify(wrote && wrote.args.slice(1)))
  check(!!renamed && String(renamed.args[0]).endsWith('.tmp') && renamed.args[1] === file, '再把它改名成正式文件（改名是最后一步）—— 实得 ' + JSON.stringify(renamed && renamed.args))
  check(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length === 0, '写完之后目录里没有残留的临时文件')

  // R7：崩在「改名前」—— 旧文件必须仍在且可解析、内容一字不变
  const before = fs.readFileSync(file, 'utf8')
  const st3 = makeStore(home, { fs: wrapFs([], { rename: async () => { throw new Error('boom') } }) })
  const r4 = await st3.rememberWorkspace(KEY, 'gitlab')
  const after = fs.readFileSync(file, 'utf8')
  check(r4.ok === false, '改名那一步失败时，如实回一个失败（不假装写成功）—— 实得 ' + JSON.stringify(r4))
  check(after === before && JSON.parse(after).workspaces[hashWorkspaceKey(KEY)].backendId === 'github', '改名失败之后，旧文件仍在、可解析、内容一字不变 —— 实得 ' + after.replace(/\s+/g, ' ').slice(0, 160))
  check(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length === 0, '失败之后临时文件也被收拾干净')

  // R5c：文件存在但读不出来 —— 这一轮不采纳、也不写
  const brokenHome = makeHome()
  const brokenFile = choicesFilePath(brokenHome)
  fs.mkdirSync(path.dirname(brokenFile), { recursive: true })
  fs.writeFileSync(brokenFile, '{"version":1,"workspaces":{"abc":', 'utf8')
  const stB = makeStore(brokenHome)
  const readB = await stB.read()
  check(readB.ok === false && readB.unreadable === true, '半截文件读出来是「这次读不到」（不是「没有」）—— 实得 ' + JSON.stringify(readB))
  const writeB = await stB.rememberWorkspace(KEY, 'github')
  check(writeB.ok === false, '文件坏的那一轮，写也不许发生（不许把半截文件覆盖成一个「只有这一条」的新文件）—— 实得 ' + JSON.stringify(writeB))
  check(fs.readFileSync(brokenFile, 'utf8') === '{"version":1,"workspaces":{"abc":', '坏文件一字不动地留在原地')
  check((await stB.getWorkspace(KEY)).found === false, '文件坏时按「没有这条」回答（不采纳任何 hint）')

  // R5c：形状不对也当「这次读不到」
  const shapeHome = makeHome()
  const shapeFile = choicesFilePath(shapeHome)
  fs.mkdirSync(path.dirname(shapeFile), { recursive: true })
  for (const [tag, body] of [['版本号不认识', '{"version":2,"workspaces":{},"layouts":{}}'], ['工作区那栏不是对象', '{"version":1,"workspaces":[],"layouts":{}}'], ['根不是对象', '[1,2,3]']]) {
    fs.writeFileSync(shapeFile, body, 'utf8')
    const r = await makeStore(shapeHome).read()
    check(r.ok === false && r.unreadable === true, '形状不对（' + tag + '）当「这次读不到」—— 实得 ' + JSON.stringify(r))
  }

  // R5c：单条坏 —— 坏的单独丢掉，好的照常命中
  const mixHome = makeHome()
  const mixFile = choicesFilePath(mixHome)
  fs.mkdirSync(path.dirname(mixFile), { recursive: true })
  const goodEntry = { backendId: 'github', rev: 3, pickedAt: 1758500000000, source: 'user' }
  const mix = { version: 1, workspaces: {}, layouts: {} }
  mix.workspaces[hashWorkspaceKey(KEY)] = goodEntry
  mix.workspaces[hashWorkspaceKey(OTHER_KEY)] = { backendId: 'markdown', rev: '2', pickedAt: 1, source: 'user' }
  mix.workspaces['not-a-hash'] = { backendId: 'github', rev: 1, pickedAt: 1, source: 'user' }
  mix.workspaces[hashWorkspaceKey('d:\\x\\y')] = { backendId: 'github', rev: 1, pickedAt: Number.NaN, source: 'user' }
  mix.layouts[hashWorkspaceKey(KEY)] = { layout: 'multi', pickedAt: 1758500000000 }
  mix.layouts[hashWorkspaceKey('d:\\z')] = { layout: '不认识', pickedAt: 1 }
  fs.writeFileSync(mixFile, JSON.stringify(mix), 'utf8')
  const stMix = makeStore(mixHome)
  const mixRead = await stMix.read()
  check(mixRead.ok === true && mixRead.dropped === 4, '坏条目单独丢掉、好的那些照常留下（丢掉 4 条：后端那栏的 rev 不是整数、键不是散列、时间不是有限数，布局那栏的值不认）—— 实得 dropped=' + mixRead.dropped)
  const kept = await stMix.getWorkspace(KEY)
  check(kept.found === true && kept.rev === 3, '好的那条照常命中 —— 实得 ' + JSON.stringify(kept))
  check((await stMix.getLayout(KEY)).layout === 'multi', '布局那一栏同样的校验与命中（值只认 single/multi）')

  // R5b：注册表不认的后端与 null 不许进文件
  const guardHome = makeHome()
  const guardFile = choicesFilePath(guardHome)
  const stG = createChoiceStore({ homeDir: guardHome, isKnownBackend: (id) => id === 'github' })
  const nullWrite = await stG.rememberWorkspace(KEY, null)
  check(nullWrite.ok === false, 'backendId 为 null 不许写（退役的「无后端」逃生舱不许借这条路复活）—— 实得 ' + JSON.stringify(nullWrite))
  const unknownWrite = await stG.rememberWorkspace(KEY, 'gitlab')
  check(unknownWrite.ok === false, '注册表不认的后端不许写 —— 实得 ' + JSON.stringify(unknownWrite))
  check(!fs.existsSync(guardFile), '两条都被挡下之后，文件根本没被建出来')
  const okWrite = await stG.rememberWorkspace(KEY, 'github')
  check(okWrite.ok === true && okWrite.rev === 1, '注册表认得的那条照常写进去 —— 实得 ' + JSON.stringify(okWrite))
  const noGuard = createChoiceStore({ homeDir: makeHome() })
  check((await noGuard.rememberWorkspace(KEY, 'github')).ok === false, '没给注册表守卫时拒绝写入（R5b 是硬规则，缺守卫按失败处理，不许默认放行）')

  // R8：条数上限，淘汰最旧的（按 pickedAt）
  const capHome = makeHome()
  let clock = 1000
  const stC = makeStore(capHome, { maxWorkspaces: 3, now: () => (clock += 1000) })
  const keys = ['d:\\w\\1', 'd:\\w\\2', 'd:\\w\\3', 'd:\\w\\4']
  for (const k of keys) await stC.rememberWorkspace(k, 'github')
  const capRead = await stC.read()
  const leftKeys = Object.keys(capRead.data.workspaces)
  check(leftKeys.length === 3, '最多保留 3 条（注入的上限）—— 实得 ' + leftKeys.length + ' 条')
  check(leftKeys.indexOf(hashWorkspaceKey('d:\\w\\1')) < 0 && leftKeys.indexOf(hashWorkspaceKey('d:\\w\\4')) >= 0, '淘汰的是最旧的那条（w\\1 走了、w\\4 还在）')
  check(leftKeys.indexOf(hashWorkspaceKey('d:\\w\\4')) >= 0 && (await stC.getWorkspace('d:\\w\\4')).found === true, '淘汰只影响最旧的那些工作区，其余照常命中')

  // R8：体积上限（文件体积超了就继续从最旧的开始丢，刚写的那一条保住）
  const byteHome = makeHome()
  let clock2 = 5000
  const stY = makeStore(byteHome, { maxFileBytes: 260, now: () => (clock2 += 1000) })
  await stY.rememberWorkspace('d:\\y\\1', 'github')
  await stY.rememberWorkspace('d:\\y\\2', 'github')
  await stY.rememberWorkspace('d:\\y\\3', 'github')
  const byteRead = await stY.read()
  const byteLeft = Object.keys(byteRead.data.workspaces)
  check(fs.statSync(choicesFilePath(byteHome)).size <= 260, '文件体积没超过上限（实得 ' + fs.statSync(choicesFilePath(byteHome)).size + ' 字节，上限 260）')
  check(byteLeft.length >= 1 && byteLeft.indexOf(hashWorkspaceKey('d:\\y\\3')) >= 0, '刚写的那一条一定还在（体积上限先丢最旧的，不许把用户刚选的那一下丢掉）—— 实得 ' + byteLeft.length + ' 条')

  // R9：两个窗口同时写 —— 进程内排队串行，修订号不许丢
  const raceHome = makeHome()
  const raceCalls = []
  const stR = makeStore(raceHome, { fs: wrapFs(raceCalls, { readFile: async (...a) => { await sleep(20); return realFs.readFile(...a) } }) })
  const both = await Promise.all([stR.rememberWorkspace(KEY, 'github'), stR.rememberWorkspace(KEY, 'markdown')])
  check(both[0].rev === 1 && both[1].rev === 2, '两个并发写入被排成一队：第一次 rev=1、第二次 rev=2（不丢更新）—— 实得 ' + JSON.stringify(both.map((r) => r.rev)))
  check((await stR.getWorkspace(KEY)).rev === 2, '落盘之后文件里就是最后那一次的 rev —— 实得 ' + JSON.stringify(await stR.getWorkspace(KEY)))

  // R6：布局与后端记录同一种形状（带 pickedAt），取值只认 single/multi
  const layoutHome = makeHome()
  const stL = makeStore(layoutHome)
  const lw = await stL.rememberLayout(KEY, 'single')
  check(lw.ok === true && typeof lw.pickedAt === 'number', '布局写下去时也带 pickedAt（两个壳各答一个样时才有仲裁依据）—— 实得 ' + JSON.stringify(lw))
  const lg = await stL.getLayout(KEY)
  check(lg.ok === true && lg.found === true && lg.layout === 'single', '布局读得回来 —— 实得 ' + JSON.stringify(lg))
  check(JSON.stringify(LAYOUT_VALUES) === JSON.stringify(['single', 'multi']), '布局取值只有 single 与 multi 两种')
  check((await stL.rememberLayout(KEY, '不认识')).ok === false, '不认识的布局取值不许写进去')
  check(JSON.parse(fs.readFileSync(choicesFilePath(layoutHome), 'utf8')).layouts[hashWorkspaceKey(KEY)].layout === 'single', '布局那一栏存的就是 {layout, pickedAt} 这个形状')

  // 拿不到用户主目录时：不抛错，读当没有、写如实回失败
  const stNoHome = createChoiceStore({ getHome: async () => null, isKnownBackend: () => true })
  const noHomeRead = await stNoHome.read()
  const noHomeWrite = await stNoHome.rememberWorkspace(KEY, 'github')
  check(noHomeRead.ok === false && noHomeRead.reason === 'no-home', '拿不到用户主目录时读不抛错（如实说是这一档）—— 实得 ' + JSON.stringify(noHomeRead))
  check(noHomeWrite.ok === false && noHomeWrite.reason === 'no-home', '拿不到用户主目录时写如实回失败（不假装成功）—— 实得 ' + JSON.stringify(noHomeWrite))

  check(typeof DEFAULT_MAX_WORKSPACES === 'number' && DEFAULT_MAX_WORKSPACES > 0, '默认的条数上限是一个正数（' + DEFAULT_MAX_WORKSPACES + ' 条）')
}

// ── B 反证：把真源改坏，上面该红的必须当场红 ──────────────────────────────────────────────
console.log('')
console.log('== B 反证：把实现做坏，对应的那几条必须当场红 ==')
const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-choice-broken-'))
tmpDirs.push(brokenDir)
const loadBroken = async function (tag, from, to) {
  if (!src.includes(from)) return { bad: '这道反证的改法在真源里找不到落点（源文本已变）：' + String(from).split('\n')[0].slice(0, 80) }
  const file = path.join(brokenDir, tag + '.mjs')
  fs.writeFileSync(file, src.replace(from, to), 'utf8')
  return { mod: await import(pathToFileURL(file).href) }
}

// B1 去掉原子写（临时文件 + 改名）→ 直接写目标文件
{
  const b = await loadBroken('no-atomic',
    "      await fsPort.writeFile(tmp, body, { mode: 0o600, flag: 'wx' })\n      await fsPort.rename(tmp, paths.file)",
    "      await fsPort.writeFile(paths.file, body, { mode: 0o600 })")
  check(!b.bad, '反证 B1 的改法能在真源里落地（去掉临时文件加改名）' + (b.bad ? ' —— ' + b.bad : ''))
  if (b.mod) {
    const home = makeHome()
    const st0 = b.mod.createChoiceStore({ homeDir: home, isKnownBackend: () => true })
    await st0.rememberWorkspace(KEY, 'github')
    const before = fs.readFileSync(b.mod.choicesFilePath(home), 'utf8')
    const calls = []
    const st1 = b.mod.createChoiceStore({ homeDir: home, isKnownBackend: () => true, fs: wrapFs(calls, { rename: async () => { throw new Error('boom') } }) })
    await st1.rememberWorkspace(KEY, 'gitlab')
    const after = fs.readFileSync(b.mod.choicesFilePath(home), 'utf8')
    check(!calls.some((c) => c.name === 'rename'), '反证 B1 成立：去掉原子写之后，调用序列里再也没有「改名」这一步 —— 实得 ' + calls.map((c) => c.name).join('、'))
    check(after !== before, '反证 B1 成立：改名失败也不再保护旧文件（直接写目标，旧内容被改写）—— 说明 A 组那条「旧文件一字不变」量的就是原子写这一步')
  }
}

// B2 去掉散列（键直接用明文）→ 文件里出现路径原文
{
  const b = await loadBroken('no-hash',
    'return hashWorkspaceKey(canonicalKey)',
    'return String(canonicalKey)')
  check(!b.bad, '反证 B2 的改法能在真源里落地（键不再散列）' + (b.bad ? ' —— ' + b.bad : ''))
  if (b.mod) {
    const home = makeHome()
    const st = b.mod.createChoiceStore({ homeDir: home, isKnownBackend: () => true })
    await st.rememberWorkspace(KEY, 'github')
    const text = fs.readFileSync(b.mod.choicesFilePath(home), 'utf8')
    check(text.includes('shujucangkuguanliyuan'), '反证 B2 成立：不再散列之后，工作区路径原文原样落进文件 —— 说明 A 组那条「文件里没有路径原文」量的就是散列这一步')
  }
}

// B3 去掉 R5b 守卫 → 退出的后端与 null 也写进去了
{
  const b = await loadBroken('no-guard',
    "      if (backendId === null || backendId === undefined || String(backendId) === '') return { ok: false, reason: 'reject-null', rev: 0 }\n      if (typeof isKnownBackend !== 'function') return { ok: false, reason: 'no-registry-guard', rev: 0 }\n      let known = false\n      try { known = !!(await isKnownBackend(String(backendId))) } catch (e) { known = false }\n      if (!known) return { ok: false, reason: 'reject-unknown-backend', rev: 0 }",
    '      /* 反证 B3：守卫整段摘掉 */')
  check(!b.bad, '反证 B3 的改法能在真源里落地（守卫整段摘掉）' + (b.bad ? ' —— ' + b.bad : ''))
  if (b.mod) {
    const home = makeHome()
    const st = b.mod.createChoiceStore({ homeDir: home, isKnownBackend: (id) => id === 'github' })
    const r = await st.rememberWorkspace(KEY, 'gitlab')
    check(r.ok === true, '反证 B3 成立：守卫摘掉之后，注册表不认的后端（gitlab）也写进去了 —— 实得 ' + JSON.stringify(r))
  }
}

// B4 去掉 R9 的排队 → 两个并发各读到同一份旧状态，修订号撞在一起
{
  const b = await loadBroken('no-queue',
    'const next = queue.then(task, task)',
    'const next = Promise.resolve().then(task)')
  check(!b.bad, '反证 B4 的改法能在真源里落地（去掉进程内排队）' + (b.bad ? ' —— ' + b.bad : ''))
  if (b.mod) {
    const home = makeHome()
    const calls = []
    const st = b.mod.createChoiceStore({ homeDir: home, isKnownBackend: () => true, fs: wrapFs(calls, { readFile: async (...a) => { await sleep(20); return realFs.readFile(...a) } }) })
    const both = await Promise.all([st.rememberWorkspace(KEY, 'github'), st.rememberWorkspace(KEY, 'markdown')])
    // 不排队时这一对拿不到「先 1 后 2」：常见两种坏法 —— 两次都读到旧状态、都发到 rev=1（丢一次更新），
    // 或两次的临时文件互相踩到、有一次直接写失败。这里只断言「串行才有的那个结果消失了」，不锁死某一种坏法。
    check(!(both[0].ok === true && both[0].rev === 1 && both[1].ok === true && both[1].rev === 2), '反证 B4 成立：不排队之后，两次并发拿不到「先 rev=1、再 rev=2」这个结果 —— 实得 ' + JSON.stringify(both))
  }
}

// B5 去掉 R8 的淘汰 → 条数无上限
{
  const b = await loadBroken('no-evict',
    '    dropped += boundCount(data.workspaces, maxWorkspaces, protectKey)\n    dropped += boundCount(data.layouts, maxLayouts, null)\n    dropped += boundBytes(data, protectKey)',
    '    /* 反证 B5：淘汰整段摘掉 */')
  check(!b.bad, '反证 B5 的改法能在真源里落地（淘汰整段摘掉）' + (b.bad ? ' —— ' + b.bad : ''))
  if (b.mod) {
    const home = makeHome()
    let clock = 1000
    const st = b.mod.createChoiceStore({ homeDir: home, isKnownBackend: () => true, maxWorkspaces: 3, now: () => (clock += 1000) })
    for (const k of ['d:\\w\\1', 'd:\\w\\2', 'd:\\w\\3', 'd:\\w\\4']) await st.rememberWorkspace(k, 'github')
    const left = Object.keys((await st.read()).data.workspaces).length
    check(left === 4, '反证 B5 成立：淘汰摘掉之后，超过上限也照旧全留着 —— 实得 ' + left + ' 条（上限设的是 3）')
  }
}

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {} }
console.log('')
console.log(failed ? '存在失败 — verify-683-choice-store 未通过（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 选择状态文件门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
