// verify-686-accept.js —— #686 真机验收在开发层能封顶的部分
//
// 只读真源、不改产品代码。断言分两组：
//   一、三个后端真实科目互不串味（读各自 index.ts 真文本，用真渲染函数跑，中英各一次）；
//   二、三态不显示（无后端 / 未初始化 / 无科目，外加空值不崩）。
// 用法: node tests/verify-686-accept.ts
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
const { spliceableJs } = require('./lib/source-text.ts')
// #1292：提示词数据生成物在不在、不在怎么生成，收在共用入口里（五份沙箱门禁共用）。
const { ensurePromptData } = require('./lib/prompt-data.ts')
// 中央时间真值：locale-flow.js 的界面文案改成按中央参数现算（提交 2d0a3f85）之后，拼出来的模块里会用到
// SETTINGS_DEBUG_PUSH_WAIT_MS 等常量；模块级 import 在拼接文本里非法，改成先把 values.js 的数值导出
// 整批挂到 globalThis（裸标识符回落全局），以后再有新常量也不会当场 ReferenceError。
const centralTime = require('../src/shared/time-config/values.js')
for (const [k, v] of Object.entries(centralTime)) {
  if (typeof v === 'number' && globalThis[k] === undefined) globalThis[k] = v
}

// 与 scripts/build.mts 同一条拼接思路：可拼接的 JavaScript 文本拼成真模块再跑。
function spliceToFile (files: string[], exportsList: string[], tmpName: string): string {
  let out = ''
  for (const rel of files) out += spliceableJs(rel) + '\n'
  out += '\nexport { ' + exportsList.join(', ') + ' }\n'
  const tmp = path.join(__dirname, tmpName)
  fs.writeFileSync(tmp, out, 'utf8')
  return tmp
}
// #1292：提示词正文的真源搬到 config/prompts/ 下的 YAML，客户端闭包里的数据由生成物
//   src/client/kernel/prompt-data.ts 提供（生成、不入库）；组装提示词的那几个函数拆到了
//   src/client/kernel/prompts-backend.ts。下面第一组要把 promptTextFor 拼进沙箱跑，所以拼的顺序照
//   scripts/build.mts 的 KERNEL_MODULES 来：先生成物，再 prompts.js，再 prompts-backend.js。
//   生成物不在盘上时现场生成一份 —— 这件事收在 tests/lib/prompt-data.ts，五份要拼闭包的沙箱门禁共用那一处。

// 从后端 index.js 真源里按 key 抠出 prompts 块的 {zh,en}（处理 \' 与 \n 转义）。
function promptsOf (src: string, key: string): { zh: string, en: string } {
  const i = src.indexOf(key + ': {')
  if (i < 0) throw new Error('no block ' + key)
  const seg = src.slice(i, i + 6000)
  const pick = (lang: string): string => {
    const m = seg.match(new RegExp(lang + ": '((?:[^'\\\\]|\\\\.)*)'"))
    if (!m) throw new Error('no ' + lang + ' in ' + key)
    return m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }
  return { zh: pick('zh'), en: pick('en') }
}

async function main () {
  console.log('验收门禁（#686：真文本串味 · 兜底 · 三态）')

  // ─────────── 一、三个后端真实科目互不串味 ───────────
  const ghSrc = read(path.join('src', 'tracker', 'rooms', 'github', 'index.ts'))
  const glSrc = read(path.join('src', 'tracker', 'rooms', 'gitlab', 'index.ts'))
  const mdSrc = read(path.join('src', 'tracker', 'rooms', 'markdown', 'index.ts'))
  // #725：三后端各自的 prompts.bodyFormat 整节删除，这里不再从后端抠那一条。
  const ghM: any = { id: 'github', prompts: { healthCheck: promptsOf(ghSrc, 'healthCheck'), subIssue: promptsOf(ghSrc, 'subIssue') } }
  const glM: any = { id: 'gitlab', prompts: { healthCheck: promptsOf(glSrc, 'healthCheck'), subIssue: promptsOf(glSrc, 'subIssue') } }
  const mdM: any = { id: 'markdown', prompts: { healthCheck: promptsOf(mdSrc, 'healthCheck'), subIssue: promptsOf(mdSrc, 'subIssue') } }
  check(!!ghM.prompts.healthCheck.zh && !!glM.prompts.healthCheck.zh && !!mdM.prompts.healthCheck.zh, '三房真实科目都从真源抠出来了（不是手抄的）')

  const tmpP = spliceToFile(
    [ensurePromptData(), path.join('src', 'client', 'kernel', 'locale-panel.js'), path.join('src', 'client', 'kernel', 'locale-flow.js'), path.join('src', 'client', 'kernel', 'prompts.js'), path.join('src', 'client', 'kernel', 'prompts-backend.js')],
    ['promptTextFor'],
    'tmp-686-accept.mjs'
  )
  let mod: any
  try {
    mod = await import('file:///' + tmpP.replace(/\\/g, '/'))
  } finally {
    try { fs.unlinkSync(tmpP) } catch (e) {}
  }
  const all = [ghM, glM, mdM]
  const stOf = (id: string) => ({ selection: { backendId: id }, backendModules: all, snapshot: { selection: { backendId: id }, repository: { refId: 'x/y' }, backendModules: all } })
  // 三个后端各自「只有它自己那一份科目会说」的一句话，用来认出渲染出来的正文里带的是谁的那份文本。
  // 旧表里的三条期望已经过期（提交 8a78970「提示词里不再写死 GitHub：能做的改走工具」改的正是这些文案）：
  //   GitHub 那份从「点名 gh issue list」改成「查数与动手都走工具」，所以 gh issue list 在真源里已经
  //   一个字都不剩 —— 而那正是那次改动的目的（本条门禁第六组自己也断言总纲里不许出现具体跟踪器命令）；
  //   GitLab 中文那句加了一个「也」字（解析率也还没用真仓库量过）。
  // 现在这三条按真源里的原话取，仍然只认「这段文本里带着自家科目的原话」这一件事。
  const MARK: Record<string, { zh: string, en: string }> = {
    github: { zh: '这条后端查数与动手都走工具', en: 'On this backend, counting and acting both go through the tools' },
    gitlab: { zh: '解析率也还没用真仓库量过', en: 'has not been measured' },
    markdown: { zh: 'map.md', en: 'map.md' },
  }
  const ALLOWED_LEFT = ['owner', 'repo', 'child', 'map', 'id', 'blocker', 'blocker_id']
  for (const lang of ['zh', 'en']) {
    ;(globalThis as any).localeSvc = { getSnapshot: () => ({ active: lang }), subscribe: () => {} }
    for (const id of ['github', 'gitlab', 'markdown']) {
      const t = mod.promptTextFor(stOf(id), 'healthCheck')
      check(t.indexOf(MARK[id][lang]) >= 0, lang + '·' + id + ' 渲染出自家标记（' + MARK[id][lang] + '）')
      for (const other of ['github', 'gitlab', 'markdown']) {
        if (other === id) continue
        check(t.indexOf(MARK[other][lang]) < 0, lang + '·' + id + ' 没串进 ' + other + ' 的标记')
      }
      const left = (t.match(/\{[a-zA-Z_]+\}/g) || []).map((s: string) => s.slice(1, -1))
      check(left.every((k: string) => ALLOWED_LEFT.indexOf(k) >= 0), lang + '·' + id + ' 无多余占位符漏进会话' + (left.filter((k: string) => ALLOWED_LEFT.indexOf(k) < 0).length ? '（漏了 ' + left.join('、') + '）' : ''))
    }
  }

  // ─────────── 二、三态不显示 ───────────
  const tmpHc = spliceToFile(
    [path.join('src', 'client', 'kernel', 'health-check.js')],
    ['healthCheckCountOf', 'healthCheckVisible'],
    'tmp-686-hc.mjs'
  )
  let hc: any
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

  console.log(failed ? '\n存在失败 — verify-686-accept 未通过（共 ' + total + ' 项）' : '\n全部通过 — 验收门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
