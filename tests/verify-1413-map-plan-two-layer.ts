// tests/verify-1413-map-plan-two-layer.ts —— #1413 T3：地图骨架工具的子票改用两层词表
// 门禁归属: src/deck/tools/map-plan-create.ts
// 门禁归属: src/deck/rules/object-kind.ts
// 门禁归属: src/deck/rules/minimal-spec.ts
//
// 这份门禁只回答一个问题：一次 deck_map_plan_create 用 kind + label 建出的混合骨架，
// 落到真实本地 Markdown 后端上，是不是按位置表落盘、读回来能不能逐张核对上？
// 给人读的口径在规格 #1403 与 T3 票面 #1413，这里给机器盯。
//
// 五段：
//   一、正例：地图 + 四种地图工单 + 缺陷票 + 普通票，一次建成；
//   二、盘上：地图五节与 ## 进度；每张子票的父票注释都指地图；类型标签与 Type 行按位置表；
//   三、读回：地图读得回来是地图、子票读得回来父票是地图、阻塞边落在了票面上；幂等重跑不再建票；
//   四、拒绝例：缺 kind、旧值、在地图骨架里要 map/spec、label 误用与非法值，文案点明合法值，盘上一张不动。
//
// 用真闸 + 真账本 + 真注册表 + 本地 Markdown 房间（与 verify-1403 / verify-1106 同一套夹具写法）。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1413-map-plan-two-layer.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chooseWorkspace, makeDecideStub } from './lib/deck-decide-stub.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't3-map-plan-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return String(p).replace(/\\/g, '/') },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    root, rootPosix, issuesDir: path.join(dir, 'issues'),
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('#1413 地图骨架：子票用 kind + label，按位置表落盘、读回与拒绝例')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const kindRules = await imp('src/deck/rules/object-kind.ts')

  const ws = makeWorkspace()
  const clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  chooseWorkspace(ws.rootPosix, 'markdown')
  // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const planStore = (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(String(id)) || null }, save(id: string, s: unknown) { t.set(String(id), s) } } })()
  const deps = {
    gate, registry, budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx, handleFor: () => handle,
    decideBackend: makeDecideStub(registry),
    log: { fire: () => {} },
    now: () => clock,
    invalidate: () => {},
    workRouteNote: async () => null,
    workRouteRead: () => null,
    workRouteRelease: async () => null,
    planStore,
  }
  const exec = { agent: { session: { id: 's-1413', cwd: ws.rootPosix } } }
  const tools: Record<string, any> = {}
  for (const [file, factory, name] of [
    ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
    ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ] as Array<[string, string, string]>) tools[name] = (await imp(file))[factory](deps)
  const run = async (name: string, args: unknown) => {
    let r: any = null
    let threw = ''
    try { r = await tools[name].run(exec, args) } catch (e) { threw = String((e && (e as Error).message) || e) }
    return { r, threw }
  }
  const fileOf = (key: string): string => {
    const names = fs.readdirSync(ws.issuesDir).filter((n) => n.startsWith(key + '-'))
    if (names.length !== 1) throw new Error('票 ' + key + ' 的文件找到 ' + names.length + ' 个')
    return fs.readFileSync(path.join(ws.issuesDir, names[0]), 'utf8')
  }
  const countFiles = () => fs.readdirSync(ws.issuesDir).length
  const typeLines = (text: string) => (text.match(/^Type[：:].*$/gm) || [])
  // Labels 行按后端写的分隔符拆开，交给共享位置表判断「哪一枚是类型标签」，不在门禁里再抄一份类型标签清单。
  const labelsOf = (text: string): string[] => {
    const line = (text.match(/^Labels[：:].*$/m) || [''])[0] || ''
    return line.replace(/^Labels[：:]\s*/, '').split(/\s*[,，]\s*/).map((s) => s.trim()).filter(Boolean)
  }
  const typeLabelCount = (text: string) => labelsOf(text).filter((n) => kindRules.isTypeLabel(n)).length
  const hasProgress = (text: string) => /^##\s*进度\s*$/m.test(text)
  const parentComment = (key: string) => new RegExp('^<!-- parentKey: ' + key + ' -->', 'm')

  // ── 一、正例：一次建出混合骨架 ──
  console.log('— 一、正例：地图 + 四种地图工单 + 缺陷票 + 普通票，一次建成')
  const children = [
    { key: 'research', title: '调研票：摸清后端', kind: 'map-ticket', label: 'wayfinder:research' },
    { key: 'prototype', title: '原型票：先做一版', kind: 'map-ticket', label: 'wayfinder:prototype' },
    { key: 'grilling', title: '追问票：把决定问出来', kind: 'map-ticket', label: 'wayfinder:grilling' },
    { key: 'task', title: '工单票：拆成可做的活', kind: 'map-ticket', label: 'wayfinder:task' },
    { key: 'bug', title: '缺陷票：修一条回归', kind: 'bug' },
    { key: 'issue', title: '普通票：顺手记一笔', kind: 'issue', labels: ['docs', 'wayfinder:research'] },
  ]
  const edges = [{ from: 'bug', to: 'research', type: 'blocked-by' }]
  const body = '# 两层地图骨架\n\n## Destination\n\n把两层词表落到地图工具上\n\n## Notes\n\n保留这句原有的话。\n'
  const built = await run('deck_map_plan_create', { planId: 'plan-1413', title: '两层地图骨架', body, children, edges })
  const mapKey = String((built.r && built.r.data && built.r.data.mapKey) || '')
  check(!built.threw && built.r && built.r.status === 'ok', '整张骨架一次建成、回 ok（实得 ' + (built.threw || (built.r && built.r.status + ' ' + JSON.stringify(built.r && built.r.text || '').slice(0, 200))) + '）')
  check(!!mapKey && built.r.data && typeof built.r.data.counts === 'object', '回执带地图票号与计数（mapKey=' + mapKey + '）')
  const counts = built.r && built.r.data && built.r.data.counts
  check(counts && counts.planned === 7 && counts.actual === 7 && counts.ok === true, '逐项计数对上：计划 7 张（含地图）、实际 7 张（实得 ' + JSON.stringify(counts) + '）')
  check((built.r.data.builtKeys || []).length === 6, '六张子票都建成了（实得 ' + JSON.stringify(built.r.data.builtKeys) + '）')
  const notes = (built.r && built.r.notes) || []
  check(notes.some((n: string) => n.indexOf('建后读回核对通过') >= 0), '回执备注写明建后读回核对通过（notes=' + JSON.stringify(notes).slice(0, 300) + '）')
  check(!notes.some((n: string) => n.indexOf('逐项校验没对上') >= 0), '逐项校验没有报「没对上」')

  // planKey → 真票号，从回执的 items 取（建票明细里有 planKey）。
  const childKeyOf = new Map<string, string>()
  for (const it of ((built.r && built.r.items) || []) as any[]) {
    if (it && it.role === 'child' && it.status === 'ok' && it.planKey) childKeyOf.set(String(it.planKey), String(it.key))
  }
  check(childKeyOf.size === 6, '回执明细里六张子票都有 planKey → 票号（实得 ' + JSON.stringify(Array.from(childKeyOf)) + '）')
  const keyOf = (planKey: string) => childKeyOf.get(planKey) || ''

  // ── 二、盘上：地图与六张子票 ──
  console.log('— 二、盘上：地图五节与 ## 进度；子票父票、类型标签、Type 行按位置表')
  if (mapKey) {
    const text = fileOf(mapKey)
    const heads = ['## Destination', '## Notes', '## Decisions so far', '## Not yet specified', '## Out of scope']
    const positions = heads.map((h) => text.indexOf(h))
    check(positions.every((i) => i >= 0), '地图五节都在（缺的：' + heads.filter((h, i) => positions[i] < 0).join('、') + '）')
    check(hasProgress(text) && text.indexOf('## 进度') > Math.max.apply(null, positions), '地图补了 ## 进度，且排在五节之后')
    check(text.indexOf('保留这句原有的话。') >= 0, '地图正文里原有的内容一个字没动')
    check(text.indexOf('把两层词表落到地图工具上') >= 0, '地图原有的 Destination 内容保留')
    check(typeLines(text).length === 0, '地图不写 Type 行（尤其没有 Type: map）')
    check(!/DSH-ISSUE-KIND/.test(text), '地图不写正文文件头标记')
    check(typeLabelCount(text) === 1 && labelsOf(text).indexOf('wayfinder:map') >= 0, '地图只有一枚类型标签 wayfinder:map（实得 ' + JSON.stringify(labelsOf(text)) + '）')
    check(text.indexOf('<!-- parentKey:') < 0, '地图没有父票注释')
  }

  const MAP_TICKETS = [
    ['research', 'wayfinder:research', 'research'],
    ['prototype', 'wayfinder:prototype', 'prototype'],
    ['grilling', 'wayfinder:grilling', 'grilling'],
    ['task', 'wayfinder:task', 'task'],
  ] as Array<[string, string, string]>
  if (mapKey) {
    for (const pair of MAP_TICKETS) {
      const planKey = pair[0], label = pair[1], bare = pair[2]
      const key = keyOf(planKey)
      if (!key) { check(false, '地图工单 ' + planKey + ' 没有建成，后面几项没法核'); continue }
      const text = fileOf(key)
      check(parentComment(mapKey).test(text), label + ' 的文件头父票注释就是地图 ' + mapKey)
      check(new RegExp('^Type: ' + bare + '$', 'm').test(text), label + ' 的 Type 行是去前缀的 ' + bare + '（实得 ' + JSON.stringify(typeLines(text)) + '）')
      check(typeLabelCount(text) === 1 && labelsOf(text).indexOf(label) >= 0, label + ' 只有选中的这一枚类型标签，不补第二枚（实得 ' + JSON.stringify(labelsOf(text)) + '）')
      check(!/DSH-ISSUE-KIND/.test(text), label + ' 不写正文文件头标记')
      check(hasProgress(text), label + ' 的正文补了 ## 进度')
    }
    const bugKey = keyOf('bug')
    if (bugKey) {
      const text = fileOf(bugKey)
      check(parentComment(mapKey).test(text), '缺陷票的文件头父票注释是地图')
      check(labelsOf(text).indexOf('bug') >= 0 && labelsOf(text).indexOf('needs-triage') >= 0, '缺陷票的标签是 bug + needs-triage（实得 ' + JSON.stringify(labelsOf(text)) + '）')
      check(typeLabelCount(text) === 1 && labelsOf(text).filter((n) => kindRules.isTypeLabel(n))[0] === 'bug', '缺陷票只有一枚类型标签 bug')
      check(typeLines(text).length === 0, '缺陷票不写 Type 行')
      check(hasProgress(text), '缺陷票的正文补了 ## 进度')
    }
    const issueKey = keyOf('issue')
    if (issueKey) {
      const text = fileOf(issueKey)
      check(parentComment(mapKey).test(text), '普通票的文件头父票注释是地图')
      check(labelsOf(text).indexOf('docs') >= 0, '普通票保留调用方给的 docs 标签')
      check(typeLabelCount(text) === 1 && labelsOf(text).indexOf('wayfinder:research') >= 0, '普通票原样保留调用方给的类型标签（labels 原样传递，实得 ' + JSON.stringify(labelsOf(text)) + '）')
      check(typeLines(text).length === 0, '普通票不写 Type 行')
      check(hasProgress(text), '普通票的正文补了 ## 进度')
    }
  }

  // ── 三、读回：地图与子票的父子关系、阻塞边、幂等重跑 ──
  console.log('— 三、读回：地图仍是地图、子票父票是地图、阻塞边落盘；同 planId 重跑不再建票')
  if (mapKey) {
    const gotMap = await run('deck_issue_get', { key: mapKey, blocking: false })
    const mapTicket = gotMap.r && gotMap.r.data ? (gotMap.r.data.ticket || gotMap.r.data.issue) : null
    check(gotMap.r && gotMap.r.status === 'ok' && mapTicket && mapTicket.type === 'map', '地图读回来仍是 map（实得 ' + (mapTicket && mapTicket.type) + '）')
    check(mapTicket && (mapTicket.parentKey === null || mapTicket.parentKey === undefined), '地图读回来没有父票（实得 ' + (mapTicket && mapTicket.parentKey) + '）')
    const bugKey = keyOf('bug'), researchKey = keyOf('research')
    if (bugKey) {
      const gotBug = await run('deck_issue_get', { key: bugKey, blocking: true })
      const rel = gotBug.r && gotBug.r.data ? gotBug.r.data.relations : null
      const norm = (k: unknown) => String(k).replace(/^0+(?=\d)/, '')
      check(rel && String(rel.parentKey || '') === mapKey, '缺陷票读回来父票是地图 ' + mapKey + '（实得 ' + (rel && rel.parentKey) + '）')
      const blocked = (rel && Array.isArray(rel.blockedBy) ? rel.blockedBy : []).map((x: any) => norm(x && typeof x === 'object' && 'key' in x ? x.key : x))
      check(blocked.join(',') === norm(researchKey), '阻塞边落在缺陷票上：它被调研票阻塞（实得 ' + JSON.stringify(blocked) + '）')
    }
  }
  const beforeRerun = countFiles()
  const rerun = await run('deck_map_plan_create', { planId: 'plan-1413', title: '两层地图骨架', body, children, edges })
  check(!rerun.threw && rerun.r && rerun.r.status === 'ok', '同 planId 重跑回 ok（实得 ' + (rerun.threw || (rerun.r && rerun.r.status)) + '）')
  check((rerun.r.data.skippedKeys || []).length === 6 && (rerun.r.data.builtKeys || []).length === 6, '重跑把六张子票都按已建跳过（skipped=' + JSON.stringify(rerun.r.data.skippedKeys) + '）')
  check(countFiles() === beforeRerun, '重跑一张票都没多建（' + beforeRerun + ' → ' + countFiles() + '）')
  check((rerun.r.notes || []).some((n: string) => n.indexOf('上次已经建好了') >= 0), '重跑备注说明地图上次已经建好')
  check((rerun.r.notes || []).some((n: string) => n.indexOf('建后读回核对通过') >= 0), '重跑也逐张核对了一遍')

  // ── 四、拒绝例：全部在碰后端之前挡下 ──
  console.log('— 四、拒绝例：缺 kind、旧值、在地图骨架里要 map/spec、label 误用与非法值')
  const filesBefore = countFiles()
  const refusals: Array<[string, unknown[], RegExp]> = [
    ['缺 kind', [{ key: 'a', title: '没写位置' }], /kind[\s\S]*map-ticket[\s\S]*bug[\s\S]*issue/],
    ['旧的 task', [{ key: 'a', title: '旧值任务', kind: 'task' }], /map-ticket[\s\S]*label/],
    ['旧的 ticket', [{ key: 'a', title: '旧值实施', kind: 'ticket' }], /spec-ticket|deck_issue_create/],
    ['kind=map（地图本体由工具建）', [{ key: 'a', title: '把地图塞进 children', kind: 'map' }], /地图本体|工具自己建/],
    ['kind=spec（规格走建票工具）', [{ key: 'a', title: '把规格塞进 children', kind: 'spec' }], /deck_issue_create|规格/],
    ['地图工单缺 label', [{ key: 'a', title: '缺标签', kind: 'map-ticket' }], /label[\s\S]*wayfinder:research/],
    ['非地图工单传 label', [{ key: 'a', title: '缺陷带标签', kind: 'bug', label: 'wayfinder:task' }], /map-ticket/],
    ['地图工单 label 非法', [{ key: 'a', title: '标签非法', kind: 'map-ticket', label: 'wayfinder:map' }], /wayfinder/],
    ['labels 里塞类型标签', [{ key: 'a', title: '标签塞类型', kind: 'bug', labels: ['bug'] }], /类型标签/],
  ]
  let seen = 0
  for (const [name, kids, want] of refusals) {
    const { r, threw } = await run('deck_map_plan_create', { planId: 'refuse-' + seen, title: '拒绝例地图', children: kids })
    seen += 1
    const text = String((r && r.text) || '')
    const ok = !threw && r && r.status === 'unsupported' && r.reason === 'bad-args' && want.test(text)
    check(ok, '拒绝：' + name + (ok ? '' : '（实得 ' + (threw || (r && (r.status + '/' + r.reason + ' ' + text.slice(0, 200)))) + '）'))
  }
  check(seen === refusals.length, '拒绝例都跑过了（' + seen + ' 条）')
  check(countFiles() === filesBefore, '拒绝例一张票都没建（盘上仍是 ' + filesBefore + ' 张）')

  ws.cleanup()
  console.log('共 ' + total + ' 项' + (failed ? '，有失败' : '，全部通过'))
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1 })
