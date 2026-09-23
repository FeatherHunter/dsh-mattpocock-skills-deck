// verify-686-accept.js —— #686 真机验收在开发层能封顶的部分
//
// 只读真源、不改产品代码。断言分六组：
//   一、三个后端真实科目互不串味（读各自 index.js 真文本，用真渲染函数跑，中英各一次）；
//   二、按钮与读数在元素级就是两种东西（读数 div、动作 button，按钮在 flex:1 占位之后）；
//   三、算不出时只显示名字（null 兜底，不拼数字）；
//   四、三态不显示（无后端 / 未初始化 / 无科目，外加空值不崩）；
//   五、常驻日志点只有两个短枚举（落点、字段、双产物、附录对照表）；
//   六、总纲里没有具体跟踪器命令（开口只属于各后端自己的科目）。
// 用法: node tests/verify-686-accept.js
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 与 scripts/build.mjs 同一条拼接思路：去掉每行行首 export，把声明体拼成真模块再跑。
function spliceToFile (files, exportsList, tmpName) {
  let out = ''
  for (const rel of files) out += read(rel).split(/\r?\n/).map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n') + '\n'
  out += '\nexport { ' + exportsList.join(', ') + ' }\n'
  const tmp = path.join(__dirname, tmpName)
  fs.writeFileSync(tmp, out, 'utf8')
  return tmp
}

// 从后端 index.js 真源里按 key 抠出 prompts 块的 {zh,en}（处理 \' 与 \n 转义）。
function promptsOf (src, key) {
  const i = src.indexOf(key + ': {')
  if (i < 0) throw new Error('no block ' + key)
  const seg = src.slice(i, i + 6000)
  const pick = (lang) => {
    const m = seg.match(new RegExp(lang + ": '((?:[^'\\\\]|\\\\.)*)'"))
    if (!m) throw new Error('no ' + lang + ' in ' + key)
    return m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }
  return { zh: pick('zh'), en: pick('en') }
}

async function main () {
  console.log('验收门禁（#686：真文本串味 · 元素差异 · 兜底 · 三态 · 日志字段 · 总纲无命令）')

  // ─────────── 一、三个后端真实科目互不串味 ───────────
  const ghSrc = read(path.join('src', 'host', 'tracker', 'backends', 'github', 'index.js'))
  const glSrc = read(path.join('src', 'host', 'tracker', 'backends', 'gitlab', 'index.js'))
  const mdSrc = read(path.join('src', 'host', 'tracker', 'backends', 'markdown', 'index.js'))
  const ghM = { id: 'github', prompts: { healthCheck: promptsOf(ghSrc, 'healthCheck'), subIssue: promptsOf(ghSrc, 'subIssue'), bodyFormat: promptsOf(ghSrc, 'bodyFormat') } }
  const glM = { id: 'gitlab', prompts: { healthCheck: promptsOf(glSrc, 'healthCheck'), subIssue: promptsOf(glSrc, 'subIssue'), bodyFormat: promptsOf(glSrc, 'bodyFormat') } }
  const mdM = { id: 'markdown', prompts: { healthCheck: promptsOf(mdSrc, 'healthCheck'), subIssue: promptsOf(mdSrc, 'subIssue'), bodyFormat: promptsOf(mdSrc, 'bodyFormat') } }
  check(!!ghM.prompts.healthCheck.zh && !!glM.prompts.healthCheck.zh && !!mdM.prompts.healthCheck.zh, '三房真实科目都从真源抠出来了（不是手抄的）')

  const tmpP = spliceToFile(
    [path.join('src', 'client', 'kernel', 'locale-panel.js'), path.join('src', 'client', 'kernel', 'locale-flow.js'), path.join('src', 'client', 'kernel', 'prompts.js')],
    ['promptTextFor'],
    'tmp-686-accept.mjs'
  )
  let mod
  try {
    mod = await import('file:///' + tmpP.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmpP) } catch (e) {}
  }
  const all = [ghM, glM, mdM]
  const stOf = (id) => ({ selection: { backendId: id }, backendModules: all, snapshot: { selection: { backendId: id }, repository: { refId: 'x/y' }, backendModules: all } })
  // 三个后端各自「只有它自己那一份科目会说」的一句话，用来认出渲染出来的正文里带的是谁的那份文本。
  // 旧表里的三条期望已经过期（提交 8a78970「提示词里不再写死 GitHub：能做的改走工具」改的正是这些文案）：
  //   GitHub 那份从「点名 gh issue list」改成「查数与动手都走工具」，所以 gh issue list 在真源里已经
  //   一个字都不剩 —— 而那正是那次改动的目的（本条门禁第六组自己也断言总纲里不许出现具体跟踪器命令）；
  //   GitLab 中文那句加了一个「也」字（解析率也还没用真仓库量过）。
  // 现在这三条按真源里的原话取，仍然只认「这段文本里带着自家科目的原话」这一件事。
  const MARK = {
    github: { zh: '这条后端查数与动手都走工具', en: 'On this backend, counting and acting both go through the tools' },
    gitlab: { zh: '解析率也还没用真仓库量过', en: 'has not been measured' },
    markdown: { zh: 'map.md', en: 'map.md' },
  }
  const ALLOWED_LEFT = ['owner', 'repo', 'child', 'map', 'id', 'blocker', 'blocker_id']
  for (const lang of ['zh', 'en']) {
    globalThis.localeSvc = { getSnapshot: () => ({ active: lang }), subscribe: () => {} }
    for (const id of ['github', 'gitlab', 'markdown']) {
      const t = mod.promptTextFor(stOf(id), 'healthCheck')
      check(t.indexOf(MARK[id][lang]) >= 0, lang + '·' + id + ' 渲染出自家标记（' + MARK[id][lang] + '）')
      for (const other of ['github', 'gitlab', 'markdown']) {
        if (other === id) continue
        check(t.indexOf(MARK[other][lang]) < 0, lang + '·' + id + ' 没串进 ' + other + ' 的标记')
      }
      const left = (t.match(/\{[a-zA-Z_]+\}/g) || []).map((s) => s.slice(1, -1))
      check(left.every((k) => ALLOWED_LEFT.indexOf(k) >= 0), lang + '·' + id + ' 无多余占位符漏进会话' + (left.filter((k) => ALLOWED_LEFT.indexOf(k) < 0).length ? '（漏了 ' + left.join('、') + '）' : ''))
    }
  }

  // ─────────── 二、按钮与读数在元素级就是两种东西 ───────────
  const listTab = read(path.join('src', 'client', 'views', 'ListTab.js'))
  check(listTab.indexOf("const kpi = (num, lab, icon, color) => h('div'") >= 0, '三枚读数是 div（读数）')
  const btnAt = listTab.indexOf('healthCheckVisible(st)')
  check(btnAt > 0 && listTab.indexOf("h('button', {", btnAt) > btnAt, '体检是 button（动作），与读数不是同一种元素')
  const flexAt = listTab.indexOf('style: { flex: 1 } }),')
  check(flexAt > 0 && btnAt > flexAt, '按钮在 flex:1 占位之后（贴右边缘）')
  check(listTab.indexOf("tr('list.kpi.takeable')") < btnAt, '三枚读数在按钮之前（读数靠左、动作靠右）')

  // ─────────── 三、算不出时只显示名字 ───────────
  check(listTab.indexOf("(nHc == null ? '' : ' ' + nHc)") >= 0, '件数为 null 时不拼数字（绝不显示 0）')
  check(listTab.indexOf("tr('list.healthCheck') + (nHc == null") >= 0, '名字照常显示（退化成纯文字按钮）')

  // ─────────── 四、三态不显示 ───────────
  const tmpHc = spliceToFile(
    [path.join('src', 'client', 'kernel', 'health-check.js')],
    ['healthCheckCountOf', 'healthCheckVisible'],
    'tmp-686-hc.mjs'
  )
  let hc
  try {
    hc = await import('file:///' + tmpHc.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmpHc) } catch (e) {}
  }
  const repo = { refId: 'owner/name' }
  const mods = [
    { id: 'github', prompts: { healthCheck: { zh: '甲', en: 'A' } } },
    { id: 'markdown', prompts: {} },
  ]
  check(hc.healthCheckVisible({ backendModules: mods, snapshot: { selection: { backendId: 'github' }, repository: repo } }) === true, '三条都满足时显示')
  check(hc.healthCheckVisible({ backendModules: mods, snapshot: { selection: null, repository: repo } }) === false, '没绑定后端 → 整颗不显示')
  check(hc.healthCheckVisible({ backendModules: mods, snapshot: { selection: { backendId: 'github' } } }) === false, '工作区未初始化 → 整颗不显示')
  check(hc.healthCheckVisible({ backendModules: mods, snapshot: { selection: { backendId: 'markdown' }, repository: repo } }) === false, '后端无科目 → 整颗不显示')
  check(hc.healthCheckVisible(null) === false && hc.healthCheckCountOf(null) === null, '空值不崩（不显示、算不出回 null）')
  check(listTab.indexOf('if (!healthCheckVisible(st)) return null') >= 0, '视图里是整颗不渲染（不是灰按钮）')

  // ─────────── 五、常驻日志点只有两个短枚举 ───────────
  const hcSrc = read(path.join('src', 'client', 'kernel', 'health-check.js'))
  check(hcSrc.indexOf("log('info', 'healthCheck.inject'") >= 0, '日志点落在内核文件')
  check(hcSrc.indexOf('{ backend: backend, outcome:') >= 0, '字段只有 backend 与 outcome')
  check(hcSrc.indexOf('healthCheck.inject', hcSrc.indexOf('healthCheckLogEvent')) >= 0, '事件名由模块常量报出')
  for (const prod of ['client.js', path.join('package', 'lib', 'client.js')]) {
    check(read(prod).indexOf("'healthCheck.inject'") >= 0, prod + ' 带上这条常驻记录')
  }
  check(read(path.join('research', '489-appendix.md')).indexOf('healthCheck.inject') >= 0, '附录对照表里有这一条')

  // ─────────── 六、总纲里没有具体跟踪器命令 ───────────
  const pSrc = read(path.join('src', 'client', 'kernel', 'prompts.js'))
  const hci = pSrc.indexOf('"healthCheck"')
  const hcSeg = pSrc.slice(hci, hci + 8000)
  const zhM = hcSeg.match(/zh: '((?:[^'\\]|\\.)*)'/)
  const enM = hcSeg.match(/', en: '((?:[^'\\]|\\.)*)'/)
  check(!!zhM && !!enM, '总纲中英两份都抠出来了')
  for (const [nm, s] of [['zh', zhM[1]], ['en', enM[1]]]) {
    check(s.indexOf('gh issue') < 0 && s.indexOf('gh api') < 0 && s.indexOf('glab') < 0, '总纲' + nm + ' 无具体跟踪器命令（开口只属于各后端科目）')
    check(s.indexOf('http://') < 0 && s.indexOf('https://') < 0, '总纲' + nm + ' 无裸 API 地址')
  }

  console.log(failed ? '\n存在失败 — verify-686-accept 未通过（共 ' + total + ' 项）' : '\n全部通过 — 验收门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
