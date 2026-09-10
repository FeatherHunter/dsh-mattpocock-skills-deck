/**
 * tests/verify-multi-effort-panel.js — 面板层的多 effort 门禁（2026-09-09 定版）
 *
 * 与 verify-multi-effort.js（宿主数据层）互补。本文件跑的是**面板源码里原文截出来的真函数**：
 *  ① ListTabRow 的 findMap：两张地图编号相同时，每张票各自解析到自己 effort 的地图；
 *  ② 地图详情/列表行/子票分流都调共享的按身份找地图函数（只此一份实现）；
 *  ③ ListTabRow 的 listIssueRow：多 effort 时行上渲染 effort 徽标（写着 effort 名），单 effort 不渲染。
 * 快照由真后端 + 真编排器生成（不是手写 JSON），所以「点第二张地图打开第二张」这条
 * 在客户端一侧是可执行的断言，而不是照着源码另写一份仿品。
 *
 * 运行：node tests/verify-multi-effort-panel.js
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

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
const { createMarkdownBackend } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/backends/markdown/index.js')).href)
const { createSnapshotComposer } = await import(pathToFileURL(resolve(ROOT, 'src/host/tracker/snapshot.js')).href)
const { effortOf } = await import(pathToFileURL(resolve(ROOT, 'src/shared/tracker/constants.js')).href)
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

// ---------- 从面板源码里原文截出函数 ----------
const rowSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTabRow.js'), 'utf8')
const derivedSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/store-derived.js'), 'utf8')
const mapSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/MapDetail.js'), 'utf8')
const constantsSrc = fs.readFileSync(path.join(ROOT, 'src/shared/tracker/constants.js'), 'utf8')

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
const identitySrc = ['effortOf', 'idOfParts', 'idOf'].map((n) => {
  const m = new RegExp('export function ' + n + '\\([\\s\\S]*?\\n\\}').exec(constantsSrc)
  if (!m) throw new Error('constants.js 缺 ' + n)
  return m[0].replace(/^export /, '')
}).join('\n')

// ---------- ① 共享的按身份找地图（面板各处都调它，只此一份实现） ----------
const findMapByIdentitySrc = extractConst(derivedSrc, 'findMapByIdentity')
const findGroupByIdentitySrc = extractConst(derivedSrc, 'findGroupByIdentity')
{
  const findMap = new Function(identitySrc + '\n' + findMapByIdentitySrc + '\nreturn findMapByIdentity')()
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
  // 分组版（Dock/Overlay/SkillsTab 用的那个）：包一层 { m: 地图 }
  const findGroup = new Function(identitySrc + '\n' + findMapByIdentitySrc + '\n' + findGroupByIdentitySrc + '\nreturn findGroupByIdentity')()
  const groups = snapshot.maps.map((m) => ({ m }))
  check(findGroup(groups, 0, 'beta') === groups.find((g) => effortOf(g.m) === 'beta'), '分组版按 (0, beta) 命中 Beta 分组')
}

// ---------- ② 地图详情的分流（源码里已改调共享函数，这里核对它确实这么接的） ----------
{
  check(/findMapByIdentity\(st\.snapshot && st\.snapshot\.maps, t\.number, effortOf\(t\)\)/.test(mapSrc), 'MapDetail 分流调共享函数并带上 effort')
  const issueSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/IssueDetail.js'), 'utf8')
  check(/findMapByIdentity\(st\.snapshot && st\.snapshot\.maps, x\.number, eid\)/.test(issueSrc), 'IssueDetail 子票分流调共享函数并带上 effort')
  const rowSrc2 = rowSrc
  check(/findMapByIdentity\(st\.snapshot && st\.snapshot\.maps, x\.number, effortOf\(x\)\)/.test(rowSrc2), '列表行找所属地图调共享函数并带上 effort')
}

// ---------- ③ listIssueRow：行上渲染 effort 徽标 ----------
{
  const rowFnSrc = extractConst(rowSrc, 'listIssueRow')
  const h = (type, props, children) => ({ type, props: props || {}, children: children === undefined ? [] : (Array.isArray(children) ? children : [children]) })
  const stubs = {
    Ic: () => null, tr: (k) => String(k), Tip: (p) => (p && p.children) || null,
    actionColorOf: () => '#ffffff', mkRowAction: () => null, issueUrlFor: () => '', openInNewSession: () => {},
    copyText: () => {}, setActiveMap: () => {}, setActiveIssue: () => {}, showPop: () => {}, inject: () => {},
    promptText: () => '', inspectPrompt: () => '', completePrompt: () => '', authorColor: () => '#000000',
    hexA: () => 'rgba(0,0,0,0)', darken: () => null, isLightHex: () => true,
  }
  const names = Object.keys(stubs)
  const listIssueRow = new Function('h', 'st', ...names, identitySrc + '\n' + findMapByIdentitySrc + '\n' + rowFnSrc + '\nreturn listIssueRow')(h, { snapshot }, ...names.map((n) => stubs[n]))
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
  const badge = flat.find((n) => n.props && typeof n.props.className === 'string' && n.props.className.indexOf('dsws-eff') >= 0)
  check(!!badge, '行上渲染了 effort 徽标（className 含 dsws-eff）')
  const texts = flat.filter((n) => n.text).map((n) => n.text)
  check(texts.indexOf('beta') >= 0, `徽标里写着 effort 名 beta（实际文本片段：${texts.join('|').slice(0, 90)}）`)
  const flat2 = walkAll(listIssueRow(h, { snapshot }, ticket, true, false, {}, {}, false))
  check(!flat2.some((n) => n.props && typeof n.props.className === 'string' && n.props.className.indexOf('dsws-eff') >= 0), '单 effort 上下文不渲染徽标（界面不变）')
}

// ---------- ④ 阻断表按 effort 作用域 + 列表接线（筛选 chips / KPI 跟随） ----------
{
  const mapBlockOfSrc = extractConst(derivedSrc, 'mapBlockOf')
  const mapBlockOf = new Function(identitySrc + '\n' + mapBlockOfSrc + '\nreturn mapBlockOf')()
  // alpha#01 的阻塞者写的是 #02，但 alpha 里没有 02；beta 里的 02 是 open —— 不许跨 effort 认领
  const cross = { maps: [
    { key: '00', number: 0, effortId: 'alpha', title: 'Alpha Map', tickets: [
      { key: '01', number: 1, effortId: 'alpha', state: 'OPEN', blockedBy: ['02'] },
    ] },
    { key: '00', number: 0, effortId: 'beta', title: 'Beta Map', tickets: [
      { key: '02', number: 2, effortId: 'beta', state: 'OPEN', blockedBy: [] },
    ] },
  ] }
  const crossBlock = mapBlockOf(cross)
  check(Object.keys(crossBlock).length === 0, '跨 effort 同号票不算阻塞者（阻断表为空）')
  const same = { maps: [
    { key: '00', number: 0, effortId: 'alpha', title: 'Alpha Map', tickets: [
      { key: '01', number: 1, effortId: 'alpha', state: 'OPEN', blockedBy: ['02'] },
      { key: '02', number: 2, effortId: 'alpha', state: 'OPEN', blockedBy: [] },
    ] },
  ] }
  const sameBlock = mapBlockOf(same)
  check(!!sameBlock['\u0000'.replace('\u0000', 'alpha\u000001')] || !!sameBlock[Object.keys(sameBlock)[0]], '同 effort 内的 open 阻塞者算数')
  // 列表接线（静态核对，防以后改回去）
  const listSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTab.js'), 'utf8')
  check(listSrc.includes('effortNamesOf(st)'), '列表的 effort 名单来自共享函数')
  check(listSrc.includes('mapBlockOf(st.snapshot)'), '列表的阻断表来自共享函数')
  check(listSrc.includes('st.effFilters') && listSrc.includes('kpiOpenScoped'), '列表有 effort 筛选与跟随筛选的 KPI')
  const storeSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/store-snapshot.js'), 'utf8')
  check(storeSrc.includes('effFilters: []'), 'store 里有会话私有的 effort 筛选状态')
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) { console.log('\n存在失败 — verify-multi-effort-panel 未通过'); process.exit(1) }
console.log('\n全部通过 — 面板层多 effort 成立（同号各自定位、行上可辨 effort、单 effort 界面不变）')
