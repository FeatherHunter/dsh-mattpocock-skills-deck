/**
 * tests/verify-multi-effort-panel.ts — 面板层的多 effort 门禁（2026-09-09 定版）
 *
 * 与 verify-multi-effort.js（宿主数据层）互补。本文件跑的是**面板源码里原文截出来的真函数**：
 *  ① ListTabRow 的 findMap：两张地图编号相同时，每张票各自解析到自己 effort 的地图；
 *  ② ListTabRow 的 listIssueRow：effort 徽标已先整体隐藏（#1511 起编号写成「#目录/01」，徽标里的目录名与编号重复），多 effort 时也不再渲染。
 * 快照由真后端 + 真编排器生成（不是手写 JSON），所以「点第二张地图打开第二张」这条
 * 在客户端一侧是可执行的断言，而不是照着源码另写一份仿品。
 *
 * 2026-10-12：原来还有两节拿正则和字符串匹配去核对 MapDetail / IssueDetail / ListTab / store-snapshot
 * 的源码文本里写着哪一行调用、有哪个筛选字段，已按维护者口径删掉（断的是代码写法，等价重构就会红）。
 *
 * 运行：node tests/verify-multi-effort-panel.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头（本文件是 ESM，用 import 取具名导出）。
import { compileFn } from './lib/eval-probe.js'
// 取源走共用入口（tests/lib/source-text.ts）：按构建唯一口径把真源转成可拼接的 JavaScript，
// 不再直读旁边那份 .js 产物 —— 产物可能没重建，门禁量到的会不是真正拼进产物的源码。
import { spliceableJs } from './lib/source-text.ts'
// 身份函数是全标注 TypeScript，沙箱跑裸 JS：转译口径取仓库唯一那一份
// （scripts/lib/transpile-unit.mts，手法照 tests/verify-deck-tools-row-zero-dep.ts）。
import esbuild from 'esbuild'
// #1511：编号写成「#目录/编号」的真实现住在 kernel/ticket-label.ts。本门禁按文本/模块单独加载视图叶子，
// 构建时那个闭包里才有的名字在这里不存在，所以补上真身 —— 不另抄一份规则，否则门禁会跟着实现一起漂。
;(globalThis as any).ticketLabelOf = (await import('../src/client/kernel/ticket-label.js')).ticketLabelOf

const ROOT = resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ---------- 真后端 + 真编排器造快照 ----------
const plat = {
  path: path.posix,
  fs: {
    async resolve(p) { return p },
    async readText(t) { return fs.readFileSync(t, 'utf8') },
    async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t) { try { return fs.statSync(t) } catch { return null } },
    async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
    async stat(t) { try { return fs.statSync(t) } catch { return null } },
  },
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-multi-effort-panel-'))
for (const [eff, mapTitle, ticket] of [['alpha', 'Alpha Map', 'Alpha First'], ['beta', 'Beta Map', 'Beta First']]) {
  const dir = path.join(tmp, '.scratch', eff)
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), `# ${mapTitle}\n\nStatus: ready-for-agent\nLabels: wayfinder:map\n\n## Destination\n\n${mapTitle} destination\n`, 'utf8')
  fs.writeFileSync(path.join(dir, 'issues', '01-ticket.md'), `# ${ticket}\n\nStatus: ready-for-agent\nType: task\nLabels: wayfinder:task\n\n## What to build\n\n${ticket} body\n`, 'utf8')
}
const ctx = { platform: plat, fs: plat.fs, cwd: tmp, get(name) { if (name === 'fs') return plat.fs; return undefined } }
const { createMarkdownBackend } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/rooms/markdown/index.ts')).href)
const { createSnapshotComposer } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/snapshot.js')).href)
const { effortOf } = await import(pathToFileURL(resolve(ROOT, 'src/tracker/kernel/identity-keys.ts')).href)
const backend = createMarkdownBackend(ctx)
const composer = createSnapshotComposer({ get: (id) => (id === 'markdown' ? backend : undefined) })
const composed = await composer.composeSnapshot('markdown', { backend: 'markdown', refId: tmp, name: path.basename(tmp), url: '' }, ctx, { force: true })
if (!composed.ok) { console.log('  FAIL 快照编排失败'); process.exit(1) }
const inner = composed.snapshot
;(inner.maps || []).forEach((m) => {
  if (m.key != null && m.number == null) { const n = parseInt(m.key, 10); if (!isNaN(n)) m.number = n }
  ;(m.tickets || []).forEach((t) => { if (t.key != null && t.number == null) { const n = parseInt(t.key, 10); if (!isNaN(n)) t.number = n } })
})
const snapshot = { ok: true, maps: inner.maps, issues: [], labels: inner.labels || [], selection: { backendId: 'markdown' } }

// ---------- 从面板真源里原文截出函数 ----------
// 视图与内核这两片都已有同名 .ts 真源（旁边 .js 是构建产物），所以走共用入口按构建口径转译；
// 参数继续写 .js 说明符，由共用入口按「同名 .ts 优先」解析到真源。
const rowSrc = spliceableJs('src/client/views/ListTabRow.js')
const derivedSrc = spliceableJs('src/client/kernel/store-derived.js')
const constantsSrc = fs.readFileSync(path.join(ROOT, 'src/tracker/kernel/identity-keys.ts'), 'utf8')

function extractConst(src, name) {
  const key = 'const ' + name + ' ='
  const i = src.indexOf(key)
  if (i < 0) throw new Error('源码缺 ' + name)
  const brace = src.indexOf('{', i)
  let depth = 0
  let inStr = null
  for (let k = brace; k < src.length; k++) {
    const c = src[k]
    if (inStr) { if (c === '\\') { k++; continue } if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(i, k + 1) }
  }
  throw new Error('截取失败 ' + name)
}
const tu = await import(pathToFileURL(resolve(ROOT, 'scripts/lib/transpile-unit.mts')).href)
const identitySrc = ['effortOf', 'idOfParts', 'idOf', 'refKeyOf'].map((n) => {
  const m = new RegExp('export function ' + n + '\\([\\s\\S]*?\\n\\}').exec(constantsSrc)
  if (!m) throw new Error('identity-keys.ts 缺 ' + n)
  return esbuild.transformSync(m[0].replace(/^export /, ''), tu.TRANSPILE_OPTIONS).code
}).join('\n')

// ---------- ① 共享的按身份找地图（面板各处都调它，只此一份实现） ----------
const findMapByIdentitySrc = extractConst(derivedSrc, 'findMapByIdentity')
const findGroupByIdentitySrc = extractConst(derivedSrc, 'findGroupByIdentity')
{
  // 把按身份找地图那段源码拼起来当函数体造函数（没有参数名），所以走 compileFn。
  const findMap = compileFn([], identitySrc + '\n' + findMapByIdentitySrc + '\nreturn findMapByIdentity')()
  const tickets = snapshot.maps.flatMap((m) => m.tickets || [])
  check(tickets.length === 2, `快照里两张子票（实际 ${tickets.length}）`)
  // 每张地图行都要解析到自己，不串到同号的另一张
  for (const m of snapshot.maps) {
    const hit = findMap(snapshot.maps, m.number, effortOf(m))
    check(!!hit && effortOf(hit) === effortOf(m), `地图行 ${effortOf(m)}#${m.key} 解析到 ${hit ? effortOf(hit) : '（无）'} 的地图`)
  }
  const alphaMap = snapshot.maps.find((m) => effortOf(m) === 'alpha')
  const betaMap = snapshot.maps.find((m) => effortOf(m) === 'beta')
  check(findMap(snapshot.maps, 0, 'beta') === betaMap, '按 (0, beta) 命中 Beta 地图')
  check(findMap(snapshot.maps, 0, 'alpha') === alphaMap, '按 (0, alpha) 命中 Alpha 地图')
  check(findMap(snapshot.maps, 0, 'beta') !== findMap(snapshot.maps, 0, 'alpha'), '同号不同 effort 不再是同一张地图')
  check(findMap(snapshot.maps, 0, undefined) === null, '新快照不给 effort → 老实返回空，不猜第一张')
  check(findMap(snapshot.maps, 0, 'gamma') === null, '不存在的工作单元 → 返回空')
  check(findMap([{ number: 0, key: '00', title: 'Old' }], 0, 'beta') !== null, '老快照（无工作单元标识）仍按编号回落')
  // 分组版（Dock/Overlay/SkillsTab 用的那个）：包一层 { m: 地图 }
  // 同上（分组版也是几段源码拼成函数体、没有参数名），所以走 compileFn。
  const findGroup = compileFn([], identitySrc + '\n' + findMapByIdentitySrc + '\n' + findGroupByIdentitySrc + '\nreturn findGroupByIdentity')()
  const groups = snapshot.maps.map((m) => ({ m }))
  check(findGroup(groups, 0, 'beta') === groups.find((g) => effortOf(g.m) === 'beta'), '分组版按 (0, beta) 命中 Beta 分组')
}

// ---------- ② 地图详情的分流（已删）----------
// 原来这一节读 MapDetail.js / IssueDetail.js / ListTabRow.js 的源码文本，用正则断言里面写着
// 「findMapByIdentity(st.snapshot && st.snapshot.maps, t.number, effortOf(t))」这一整行调用长什么样。
// 断的是代码写法，改个变量名、换个取 snapshot 的方式就会红，已按维护者口径删掉。
// 这些视图确实要调共享函数这件事，由下面第 ③ 节从真源码截出 findMapByIdentity 跑真数据来看着。

// ---------- ③ listIssueRow：effort 徽标已隐藏、编号仍带目录 ----------
{
  const rowFnSrc = extractConst(rowSrc, 'listIssueRow')
  const h = (type, props, children) => ({ type, props: props || {}, children: children === undefined ? [] : (Array.isArray(children) ? children : [children]) })
  const stubs = {
    Ic: () => null, tr: (k) => String(k), Tip: (p) => (p && p.children) || null,
    actionColorOf: () => '#ffffff', rowActionKind: () => 'execute', mkRowAction: () => null, issueUrlFor: () => '', openInNewSession: () => {},
    copyText: () => {}, setActiveMap: () => {}, setActiveIssue: () => {}, showPop: () => {}, inject: () => {},
    promptText: () => '', inspectPrompt: () => '', completePrompt: () => '', authorColor: () => '#000000',
    hexA: () => 'rgba(0,0,0,0)', darken: () => null, isLightHex: () => true,
    // #845：listIssueRow 现在会调 truthLines.js 的 truthWriteWindowOpen（真源在 src/client/views/shared/truthLines.js:106），
    //   门禁手工列的闭包桩没跟上，一跑到那一行就 ReferenceError。产品不坏，缺的是这一个桩。
    truthWriteWindowOpen: () => false,
    // #956 评审后：行内小药丸改调共享层的 chipProps / chipKeyDown（闭包里的自由变量，拼接期在），
    //   夹具本该按闭包环境提供它们 —— 缺这两个桩，一跑到小药丸那一行就 ReferenceError。
    chipProps: (p) => Object.assign({ tabIndex: 0, role: 'button' }, p || {}),
    chipKeyDown: () => {},
  }
  const names = Object.keys(stubs)
  // 行渲染函数的函数体是几段源码拼的，自由变量由 h / st / names 三组参数名显式传入，所以走 compileFn。
  // #1302 之后 listIssueRow 会读 LIST_ROW_SHAPE（行形状真源），拼函数体时要把这段常量一起带上。
  const listIssueRow = compileFn(['h', 'st', ...names], identitySrc + '\n' + findMapByIdentitySrc + '\n' + extractConst(rowSrc, 'LIST_ROW_SHAPE') + '\n' + rowFnSrc + '\nreturn listIssueRow')(h, { snapshot }, ...names.map((n) => stubs[n]))
  const ticket = snapshot.maps.flatMap((m) => m.tickets || []).find((t) => effortOf(t) === 'beta')
  const walkAll = (tree) => {
    const flat = []
    const walk = (node) => {
      if (node === null || node === undefined) return
      if (typeof node === 'string' || typeof node === 'number') { flat.push({ text: String(node) }); return }
      if (typeof node !== 'object') return
      flat.push(node)
      ;(node.children || []).forEach(walk)
    }
    walk(tree)
    return flat
  }
  const flat = walkAll(listIssueRow(h, { snapshot }, ticket, true, false, {}, {}, true))
  // 2026-10-26 维护者要求：effort 徽标先整体隐藏（代码保留），所以多 effort 上下文里也不再有 dsws-eff。
  const hasEffortBadge = (nodes) => nodes.some((n) => n.props && typeof n.props.className === 'string' && n.props.className.indexOf('dsws-eff') >= 0)
  check(!hasEffortBadge(flat), '多 effort 上下文也不再渲染 effort 徽标（徽标已先整体隐藏，代码保留）')
  // 徽标藏起来之后，目录名只能靠编号带出来：这一条守住 #1511 的显示规则不被顺手改掉。
  const texts = flat.filter((n) => n.text).map((n) => n.text)
  check(texts.indexOf('#beta/01') >= 0, `编号仍然带着目录 #beta/01（实际文本片段：${texts.join('|').slice(0, 120)}）`)
  const flat2 = walkAll(listIssueRow(h, { snapshot }, ticket, true, false, {}, {}, false))
  check(!hasEffortBadge(flat2), '单 effort 上下文不渲染徽标（界面与原来一致）')
}

// ---------- ④ 阻断表按 effort 作用域 + 列表接线（筛选 chips / KPI 跟随） ----------
{
  const mapBlockOfSrc = extractConst(derivedSrc, 'mapBlockOf')
  // #1431 起阻断表内部多调了同文件的规范键（normIdentityKey：纯数字去前导零，非数字原样保留），
  // 拼函数体时把它一起带上，否则一跑就 ReferenceError；断言口径不变（仍只看跨 effort 不串）。
  const normKeySrc = extractConst(derivedSrc, 'normIdentityKey')
  // 阻断表那段同样是几段源码拼成函数体、没有参数名，所以走 compileFn。
  const mapBlockOf = compileFn([], identitySrc + '\n' + normKeySrc + '\n' + mapBlockOfSrc + '\nreturn mapBlockOf')()
  // alpha#01 的阻塞者写的是 #02，但 alpha 里没有 02；beta 里的 02 是 open —— 不许跨 effort 认领
  const cross = { maps: [
    { key: '00', number: 0, effortId: 'alpha', title: 'Alpha Map', tickets: [
      { key: '01', number: 1, effortId: 'alpha', state: 'OPEN', blockedBy: [{ key: '02', title: '', state: 'OPEN' }] },
    ] },
    { key: '00', number: 0, effortId: 'beta', title: 'Beta Map', tickets: [
      { key: '02', number: 2, effortId: 'beta', state: 'OPEN', blockedBy: [] },
    ] },
  ] }
  const crossBlock = mapBlockOf(cross)
  check(Object.keys(crossBlock).length === 0, '跨 effort 同号票不算阻塞者（阻断表为空）')
  const same = { maps: [
    { key: '00', number: 0, effortId: 'alpha', title: 'Alpha Map', tickets: [
      { key: '01', number: 1, effortId: 'alpha', state: 'OPEN', blockedBy: [{ key: '02', title: '', state: 'OPEN' }] },
      { key: '02', number: 2, effortId: 'alpha', state: 'OPEN', blockedBy: [] },
    ] },
  ] }
  const sameBlock = mapBlockOf(same)
  check(!!sameBlock['\u0000'.replace('\u0000', 'alpha\u000001')] || !!sameBlock[Object.keys(sameBlock)[0]], '同 effort 内的 open 阻塞者算数')
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) { console.log('\n存在失败 — verify-multi-effort-panel 未通过'); process.exit(1) }
console.log('\n全部通过 — 面板层多 effort 成立（同号各自定位、编号带目录可辨工作单元、单 effort 界面不变）')
