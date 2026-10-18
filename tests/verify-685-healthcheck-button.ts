// verify-685-healthcheck-button.js —— #685 验收门禁：KPI 那一行右边缘那颗「体检」按钮
//
// 跑的是真源码（不是重新实现一遍）：把 src/client/kernel/ 下的真函数拼成真模块跑（与
// scripts/build.mjs 同一条拼接思路）。
// 断言分五组：
//   一、游离票件数派生：三条结构事实（未关闭 + 不是地图 + 不在任何地图的子票里）逐条判，
//       算不出来时回 null 而不是 0（#681 定版：绝不显示 0）；
//   二、件数与列表一致：同一份快照下，这个数 = 列表里「独立票」的行数；
//   三、显隐门：没绑定后端 / 工作区没初始化 / 当前后端没声明体检科目，三种都整颗不显示；
//   四、点击动作：开新会话并带过去当前后端的体检提示词，成功与失败各记一条常驻日志
//       （healthCheck.inject，字段只两个短枚举）；
//   五、提示词真的通到底：用真注册表与真的按后端渲染函数跑一遍，当前后端那份科目文本被填进去、
//       没有空占位符漏进会话。
// 用法: node tests/verify-685-healthcheck-button.js
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 取源走共用入口（#1207 立的 tests/lib/source-text.ts）：locale-panel 已从 .js 转成 .ts，
// 直接读 .js 会读到构建产物（或读不到），而且朴素拼文本过不了转译（类型标注与 satisfies 会把 eval 噎死）。
// 共用入口先按全仓唯一口径转译再给可拼接文本；没转的文件走同一条，原样返回。
// 另外从同一入口拿 sourceText：下面「失败那一档确实存在」量的是 health-check 源码里那个三元分支，
// #1251 转成 .ts 之后同名 .js 是 esbuild 产物（双引号），必须读真源才能按原判据断言。
const { spliceableJs, sourceText } = require('./lib/source-text.ts')
// 中央时间真值：locale-flow.js 的界面文案改成按中央参数现算（提交 2d0a3f85）之后，拼出来的模块里会用到
// SETTINGS_DEBUG_PUSH_WAIT_MS 等常量；模块级 import 在拼接文本里非法，改成先把 values.js 的数值导出
// 整批挂到 globalThis（裸标识符回落全局），以后再有新常量也不会当场 ReferenceError。
const centralTime = require('../src/shared/time-config/values.js')
for (const [k, v] of Object.entries(centralTime)) {
  if (typeof v === 'number' && globalThis[k] === undefined) globalThis[k] = v
}

// 与 scripts/build.mjs 同一条拼接思路：可拼接的 JavaScript 文本按顺序拼在一起，
// 只在最后把要用的那几个名字导出来。这样跑的是真实现，不是另写一份。
function spliceToFile(files: string[], exportsList: string[], tmpName: string): string {
  let out = ''
  for (const rel of files) out += spliceableJs(rel) + '\n'
  out += '\nexport { ' + exportsList.join(', ') + ' }\n'
  const tmp = path.join(__dirname, tmpName)
  fs.writeFileSync(tmp, out, 'utf8')
  return tmp
}

async function main() {
  console.log('体检按钮验收门禁（#685：件数派生 · 显隐门 · 开新会话注入 · 常驻日志点 · 中英词条）')

  // ─────────── 一、游离票件数派生 ───────────
  const tmpHc = spliceToFile(
    [path.join('src', 'client', 'kernel', 'health-check.js')],
    ['healthCheckCountOf', 'healthCheckVisible', 'healthCheckSubjectOf', 'healthCheckLogEvent', 'openHealthCheck'],
    'tmp-685-hc.mjs'
  )
  let hc: any
  try {
    hc = await import('file:///' + tmpHc.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmpHc) } catch (e) {}
  }
  const snapOf = (issues: any) => ({ snapshot: { issues: issues } })
  const orphanField = (st: any) => hc.healthCheckCountOf(st)
  check(orphanField(null) === null, '空 st 算不出来时回 null（不是 0）')
  check(orphanField({}) === null, '快照都没有时回 null')
  check(orphanField({ snapshot: {} }) === null, '快照里没有 issues 一项时回 null')
  check(orphanField({ snapshot: { issues: [] } }) === 0, '明明取到了快照、一张都没有时才是 0')

  // 三条结构事实逐条判：每一类都放一张「边界票」，只有真正游离的那几张被数进去
  const edge = snapOf([
    { key: '1', number: 1, state: 'OPEN', labels: [] },                                        // 游离
    { key: '2', number: 2, state: 'CLOSED', labels: [] },                                      // 已关闭 → 不算
    { key: '3', number: 3, state: 'OPEN', type: 'map', labels: [] },                           // 地图（按 type）→ 不算
    { key: '4', number: 4, state: 'OPEN', labels: [{ name: 'wayfinder:map' }] },                // 地图（按标签）→ 不算
    { key: '5', number: 5, state: 'OPEN', labels: [{ name: 'ready-for-human' }] },              // 带标签但仍是游离（不按标签排除）
    { key: '6', number: 6, state: 'OPEN', labels: [{ name: 'wontfix' }] },                      // 同上
    { key: '7', number: 7, state: 'open', labels: [] },                                        // 小写 open 同样算未关闭
    { state: 'OPEN', labels: [] },                                                              // 缺编号的坏行：口径与列表一致（列表也是「state 不是 CLOSED 就上表」），照样数进去
    null,                                                                                      // 坏行不崩
  ])
  check(hc.healthCheckCountOf(edge) === 5, '三条结构事实逐条判：只数真正游离的那 5 张（实得 ' + hc.healthCheckCountOf(edge) + '）')
  check(hc.healthCheckSubjectOf(edge) === 5, '件数取数接口与派生同口径（healthCheckSubjectOf）')

  // ─────────── 二、件数与列表一致 ───────────
  // 宿主交给界面的 issues 是扁平的（地图容器 + 地图下所有子票 + 未挂图的票拼在一起，见
  // src/host/sessionSnapshot.ts），所以「独立票」必须靠「在不在 maps[].tickets 里」判，
  // 不能假设 issues 里只有未挂图的票（#686 真机验收发现的那处）。
  const realish = {
    snapshot: {
      maps: [
        { number: 682, title: '地图', tickets: [{ key: '684', number: 684, parentKey: '682', state: 'OPEN', labels: [] }] },
      ],
      issues: [
        { key: '682', number: 682, parentKey: null, state: 'OPEN', type: 'map', labels: [{ name: 'wayfinder:map' }] },
        { key: '677', number: 677, parentKey: null, state: 'OPEN', labels: [{ name: 'needs-triage' }] },
        { key: '674', number: 674, parentKey: null, state: 'OPEN', labels: [{ name: 'ready-for-human' }] },
        { key: '640', number: 640, parentKey: null, state: 'OPEN', labels: [{ name: 'ready-for-agent' }] },
        { key: '578', number: 578, parentKey: null, state: 'OPEN', labels: [] },
        { key: '600', number: 600, parentKey: null, state: 'CLOSED', labels: [] },
      ],
    },
  }
  const isMapRow = (x: any) => x.type === 'map' || (x.labels || []).some((l: any) => l && l.name === 'wayfinder:map')
  const inAnyMap: Record<string, boolean> = {}
  ;(realish.snapshot.maps || []).forEach((m: any) => (m.tickets || []).forEach((t: any) => { inAnyMap[String(t.key)] = true }))
  const standaloneRows = realish.snapshot.issues.filter((x: any) => String(x.state).toUpperCase() !== 'CLOSED' && !isMapRow(x) && !inAnyMap[String(x.key)])
  check(hc.healthCheckCountOf(realish) === standaloneRows.length,
    '件数与列表里「独立票」的行数一致（件数 ' + hc.healthCheckCountOf(realish) + ' vs 行数 ' + standaloneRows.length + '）')
  check(hc.healthCheckCountOf(realish) === 4, '地图节点与已挂图的子票都不计进件数（那两张即便出现在扁平行集里也不数）')

  // #686 真机验收发现的偏差：宿主交给界面的 issues 是**扁平的** —— src/host/sessionSnapshot.ts 把
  //   「地图容器 + 地图下所有子票 + 未挂图的票」拼成一个数组再交给界面，所以挂在地图下的票也在 issues 里。
  //   这些行只能靠「在不在 maps[].tickets 里」排除；只数 issues 会把它们当游离算进去（真机 17 vs 应得 11）。
  const flattened = {
    snapshot: {
      maps: [
        { number: 682, title: '地图', tickets: [{ key: '686', number: 686, parentKey: '682', state: 'OPEN', labels: [] }] },
        { number: 660, title: '地图', tickets: [{ key: '669', number: 669, parentKey: '660', state: 'OPEN', labels: [] }] },
      ],
      issues: [
        { key: '682', number: 682, state: 'OPEN', type: 'map', labels: [{ name: 'wayfinder:map' }] },
        { key: '660', number: 660, state: 'OPEN', type: 'map', labels: [{ name: 'wayfinder:map' }] },
        { key: '686', number: 686, parentKey: '682', state: 'OPEN', labels: [] },
        { key: '669', number: 669, parentKey: '660', state: 'OPEN', labels: [] },
        { key: '427', number: 427, parentKey: null, state: 'OPEN', labels: [] },
        { key: '428', number: 428, parentKey: null, state: 'OPEN', labels: [] },
        { key: '502', number: 502, parentKey: null, state: 'OPEN', labels: [{ name: 'wayfinder:grilling' }] },
      ],
    },
  }
  const nonMapOpenRows = flattened.snapshot.issues.filter((x: any) => String(x.state).toUpperCase() !== 'CLOSED' && !isMapRow(x)).length
  check(nonMapOpenRows === 5, '对照量成立：扁平行集里非地图的开放行确实是 5 行（实得 ' + nonMapOpenRows + '）')
  check(hc.healthCheckCountOf(flattened) === 3,
    '扁平行集里已挂图的子票不算游离（应得 3，实得 ' + hc.healthCheckCountOf(flattened) + '；只数 issues 会得 5）')
  // 破链票（父票指向已删地图）：不在任何地图的子票里，按 #678 口径仍算游离
  check(hc.healthCheckCountOf({ snapshot: { maps: [], issues: [{ key: '900', number: 900, parentKey: 'ghost', state: 'OPEN', labels: [] }] } }) === 1,
    '破链票（父票指向已删地图）仍算游离')
  // effort 维度：两个工作单元里同号的两张票各算各的，不许互相抵消
  const twoEfforts = {
    snapshot: {
      maps: [{ key: '01', effortId: 'a', title: '地图', tickets: [{ key: '01', effortId: 'a', state: 'OPEN', labels: [] }] }],
      issues: [
        { key: '01', effortId: 'a', state: 'OPEN', labels: [] },
        { key: '01', effortId: 'b', state: 'OPEN', labels: [] },
      ],
    },
  }
  check(hc.healthCheckCountOf(twoEfforts) === 1, '同号不同工作单元不互相抵消（b 里那张算游离，实得 ' + hc.healthCheckCountOf(twoEfforts) + '）')
  check(hc.healthCheckCountOf({ snapshot: { issues: [{ key: '1', number: 1, state: 'OPEN', labels: [] }] } }) === 1,
    '快照里没有 maps 一项时不抛错、按「没有地图」算（1）')

  // ─────────── 三、显隐门 ───────────
  const backendModules = [
    { id: 'github', prompts: { healthCheck: { zh: '科目甲', en: 'subject A' }, bodyFormat: { zh: '格式', en: 'fmt' } } },
    { id: 'markdown', prompts: { bodyFormat: { zh: '格式', en: 'fmt' } } },
  ]
  const repo = { refId: 'owner/name' }
  const base = { backendModules: backendModules, snapshot: { selection: { backendId: 'github' }, repository: repo, backendModules: backendModules } }
  check(hc.healthCheckVisible(base) === true, '三条都满足时显示')
  check(hc.healthCheckVisible({ backendModules: backendModules, snapshot: { selection: { backendId: '' }, repository: repo } }) === false, '没绑定后端 → 整颗不显示')
  check(hc.healthCheckVisible({ backendModules: backendModules, snapshot: { selection: null, repository: repo } }) === false, '快照里没有选中项 → 整颗不显示')
  check(hc.healthCheckVisible({ backendModules: backendModules, snapshot: { selection: { backendId: 'github' } } }) === false, '工作区还没初始化（没有远端关联）→ 整颗不显示')
  check(hc.healthCheckVisible({ backendModules: backendModules, snapshot: { selection: { backendId: 'markdown' }, repository: repo } }) === false, '当前后端没声明体检科目 → 整颗不显示')
  check(hc.healthCheckVisible({ backendModules: [], snapshot: { selection: { backendId: 'github' }, repository: repo } }) === false, '后端模块还没带过来 → 整颗不显示')
  check(hc.healthCheckVisible(null) === false, '空 st 不崩且不显示')
  check(hc.healthCheckVisible({ backendModules: backendModules, snapshot: { selection: { backendId: 'github' }, repository: repo, backendModules: backendModules } }) === true,
    '后端模块只从快照里带过来时也认（st.backendModules 为空）')

  // ─────────── 四、点击动作与常驻日志 ───────────
  // 真词条文件也一起拼进去：注入成功时用到 tr('list.healthCheckTitle')，那份文案只在词条真源里有。
  const tmpOpen = spliceToFile(
    [path.join('src', 'client', 'kernel', 'locale-panel.js'), path.join('src', 'client', 'kernel', 'locale-flow.js'), path.join('src', 'client', 'kernel', 'prompts.js'), path.join('src', 'client', 'kernel', 'health-check.js')],
    ['L_PANEL', 'L_FLOW', 'promptTextFor', 'healthCheckCountOf', 'healthCheckVisible', 'healthCheckLogEvent', 'openHealthCheck'],
    'tmp-685-open.mjs'
  )
  let mod: any
  try {
    mod = await import('file:///' + tmpOpen.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmpOpen) } catch (e) {}
  }
  const L: any = { zh: Object.assign({}, mod.L_PANEL.zh, mod.L_FLOW.zh), en: Object.assign({}, mod.L_PANEL.en, mod.L_FLOW.en) }
  let lang = 'zh'
  const opened: any[] = []
  const logged: any[] = []
  ;(globalThis as any).localeSvc = { getSnapshot: () => ({ active: lang }), subscribe: () => {} }
  ;(globalThis as any).tr = function (k: any, p: any) { const d = L[lang] || L.zh; let s = (d && d[k] !== undefined) ? d[k] : k; if (p) s = String(s).replace(/\{(\w+)\}/g, (m: any, n: any) => (p[n] === undefined ? m : String(p[n]))); return s }
  ;(globalThis as any).log = function (level: any, event: any, fields: any) { logged.push({ level: level, event: event, fields: fields }) }
  ;(globalThis as any).openTextInNewSession = function (st: any, text: any, title: any) { opened.push({ text: text, title: title }); return true }
  ;(globalThis as any).inject = function (st: any, text: any) { opened.push({ text: text, title: null, viaInject: true }) }

  const ghSubject = { zh: '科目甲：把游离的开放票找出来', en: 'subject A: find the orphaned open tickets' }
  const stOk = {
    backendModules: [{ id: 'github', prompts: { healthCheck: ghSubject, bodyFormat: { zh: '写回方式', en: 'write back' } } }],
    snapshot: { selection: { backendId: 'github' }, repository: repo, backendModules: [{ id: 'github', prompts: { healthCheck: ghSubject, bodyFormat: { zh: '写回方式', en: 'write back' } } }] },
  }
  const okFlag = mod.openHealthCheck(stOk)
  check(okFlag === true, '点击动作：取到了提示词 → 返回真')
  check(opened.length === 1, '点击动作：开了且只开了一次新会话（实得 ' + opened.length + ' 次）')
  check(!!opened[0] && opened[0].text && opened[0].text.indexOf('体检') >= 0, '带过去的是体检提示词正文（长度 ' + ((opened[0] && opened[0].text || '').length) + '）')
  check(!!opened[0] && String(opened[0].title).length > 0 && String(opened[0].title).indexOf('menu') < 0, '新会话标题走词条，不是键名本身（实得「' + (opened[0] && opened[0].title) + '」）')
  check(logged.length === 1 && logged[0].event === 'healthCheck.inject', '成功时记一条 healthCheck.inject（实得 ' + (logged[0] && logged[0].event) + '）')
  check(!!logged[0] && logged[0].fields && logged[0].fields.backend === 'github', '日志记下是哪个后端（实得 ' + (logged[0] && logged[0].fields && logged[0].fields.backend) + '）')
  check(!!logged[0] && logged[0].fields && logged[0].fields.outcome === 'ok', '成功那一次记成 ok')
  check(!!logged[0] && Object.keys(logged[0].fields).length === 2, '日志只带两个字段，不记提示词正文（实得 ' + Object.keys((logged[0] && logged[0].fields) || {}).join('、') + '）')
  check(hc.healthCheckLogEvent === 'healthCheck.inject', '事件名由模块自己报出来（而不是散在界面里写字符串）')

  // 当前后端没声明体检科目：注入出去的仍是完整总纲（只是少了后端那一节），算一次有效注入，
  // 而且正文里不许留占位符 —— 界面那颗按钮在「后端没有科目」时根本点不到，这条路不是正常的点击路。
  opened.length = 0; logged.length = 0
  const stNoSubject = { backendModules: [{ id: 'gitlab', prompts: {} }], snapshot: { selection: { backendId: 'gitlab' }, repository: repo, backendModules: [{ id: 'gitlab', prompts: {} }] } }
  const noSubjectFlag = mod.openHealthCheck(stNoSubject)
  check(noSubjectFlag === true, '当前后端没有科目时仍是完整总纲（注入成功）')
  check(logged.length === 1 && logged[0].fields.outcome === 'ok', '这种情况记 ok，不是 fail')
  const noSubjectText = (opened[0] && opened[0].text) || ''
  const noSubjectLeft = (noSubjectText.match(/\{[a-zA-Z]+\}/g) || [])
  check(noSubjectText.length > 200 && noSubjectLeft.length === 0, '总纲完整且不留占位符（长度 ' + noSubjectText.length + '，漏 ' + noSubjectLeft.length + ' 个）')
  check(!!logged[0] && logged[0].fields.backend === 'gitlab', '这一条也记下是哪个后端')
  opened.length = 0; logged.length = 0
  // 反向：渲染抛错时按失败记账（那两次调用都包着 catch，点一下绝不把面板带崩）
  // 读 .ts 真源：判据是「源码里存在 outcome 取 fail 的那一档」，不是构建产物里被改写后的样子。
  check(sourceText('src/client/kernel/health-check.js').indexOf("outcome: (injected ? 'ok' : 'fail')") >= 0, '失败那一档确实存在（渲染抛错时记 fail）')
  check(hc.healthCheckCountOf(null) === null && hc.healthCheckVisible(undefined) === false, '传入空值不抛（面板点一下不会崩）')

  // 中英各跑一次，证明标题确实走词条、随语言变
  opened.length = 0; logged.length = 0
  lang = 'zh'; mod.openHealthCheck(stOk)
  const zhTitle = opened[0] && opened[0].title
  opened.length = 0
  lang = 'en'; mod.openHealthCheck(stOk)
  const enTitle = opened[0] && opened[0].title
  check(zhTitle === L.zh['list.healthCheckTitle'] && enTitle === L.en['list.healthCheckTitle'] && zhTitle !== enTitle,
    '悬浮提示/标题中英成对且随语言变（zh「' + zhTitle + '」/ en「' + enTitle + '」）')
  const zhBtn = L.zh['list.healthCheck'], enBtn = L.en['list.healthCheck']
  check(zhBtn === '体检' && enBtn === 'Health check', '按钮名中英各一份（zh「' + zhBtn + '」/ en「' + enBtn + '」）')
  lang = 'zh'; opened.length = 0; logged.length = 0

  // ─────────── 五、提示词真的通到底 ───────────
  // 用真注册表 + 真的按后端渲染函数：{subject}（后端自己的科目）必须被填掉，
  // 嵌套引用（GitHub 那份科目里引用 {subIssue}）也不许原样漏进会话。
  // #725：正文格式契约整节删除后，体检总纲里不再有 {bodyFormat} 这个占位符（这里补一条反向断言防它回来）。
  const ghModules = [{
    id: 'github',
    prompts: {
      healthCheck: { zh: 'GitHub 的科目：把游离票挂到合适的地图下，建边方式见下：{subIssue}', en: 'GitHub subject: attach orphaned tickets, wiring: {subIssue}' },
      subIssue: { zh: '用原生子议题边把它挂上去', en: 'wire it with a native sub-issue edge' },
    },
  }]
  const stFull = { backendModules: ghModules, snapshot: { selection: { backendId: 'github' }, repository: repo, backendModules: ghModules } }
  const rendered = mod.promptTextFor(stFull, 'healthCheck')
  check(rendered.length > 200, '渲染出来的体检提示词是一整段（实得 ' + rendered.length + ' 字符）')
  check(rendered.indexOf('GitHub 的科目') >= 0, '{subject} 被后端自己那份科目填掉')
  check(rendered.indexOf('原生子议题边') >= 0, '后端科目里嵌套引用的 {subIssue} 也被填掉（#684 修的那处）')
  check(rendered.indexOf('{bodyFormat}') < 0, '体检总纲里没有 {bodyFormat}（#725 起正文格式契约已整节删除）')
  const leftover = (rendered.match(/\{[a-zA-Z]+\}/g) || [])
  check(leftover.length === 0, '没有占位符漏进会话' + (leftover.length ? '（漏了 ' + leftover.join('、') + '）' : ''))
  const renderedEn = (function () { lang = 'en'; const s = mod.promptTextFor(stFull, 'healthCheck'); lang = 'zh'; return s })()
  check(renderedEn.indexOf('GitHub subject') >= 0 && renderedEn.indexOf('GitHub 的科目') < 0, '英文那一次取英文，两句不混')

  console.log(failed ? '\n存在失败 — verify-685-healthcheck-button 未通过（共 ' + total + ' 项）' : '\n全部通过 — 体检按钮验收门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
