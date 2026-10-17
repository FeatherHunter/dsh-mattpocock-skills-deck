#!/usr/bin/env node
// tests/verify-issue529-checks-i18n.js — #529 回归守卫：语言切换后环境检查面板即时重取
// 用法：node tests/verify-issue529-checks-i18n.js（在插件根目录；无需网络）
// 本门禁只留行为断言：把检查页里那条「快照语言与当前语言不一致」的守卫原文抠出来当场跑。
const fs = require('fs')
const path = require('path')
// 本文件选 compileFn 手法：这段把检查页里抠出来的一行守卫原文当函数体造函数，依赖由 deps 逐个按参数名传进去。
const { compileFn } = require('./lib/eval-probe.js')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }
const check = function (cond, name) { if (cond) ok(name); else bad(name) }
const read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8') }

// 2026-10-17（转 .ts 前先修）：ChecksTab 的真源是 .ts、同名 .js 是 esbuild 产物，产物会折行，
//   从产物里抠那一行守卫会抠不到（或抠到被折过的半行）。走共用取源入口拿真源，取到的行与原意一致。
const { sourceText } = require('./lib/source-text.ts')
const checksTab = sourceText('src/client/views/ChecksTab.js')

// 判据 4b：语言切换即时重取（面板开着切语言，说明行不许停留在旧语言）。
//   判据不认字面、认行为：从前这里按字面找 `loadChain(st, true)`，而调用现在多了第三个参数
//   「为什么重取」（#709 的事件原因：'action-done'），字面对不上就误报；真行为一直没变。
//   改法是把检查页里那**一份真实调用**抠出来当场跑：喂「快照还是上一门语言」的现场，看它发不发一次 force 重取；
//   再喂「语言没变」「还没有快照」两种现场，确认它不乱重取（这比字面断言更强，不只是「字符串还在」）。
const reloadsOnLanguage = function (st, curLang) {
  const line = (checksTab.split(/\r?\n/).filter(function (l) { return l.indexOf('chainLangLoaded !== curLang') >= 0 })[0] || '').trim()
  if (!line) return { noGuard: true, reloads: [] }
  const seen = []
  const push = function (force, why) { seen.push({ force: force, why: why }); return Promise.resolve(null) }
  const deps = {
    st: st, curLang: curLang,
    loadChain: function (s, force, why) { return push(force, why) },
    chainEventRefresh: function (s, why) { return push(true, why) },
    CHAIN_EVENT_REASONS: { enterWorkspace: 'enter-workspace', userRecheck: 'user-recheck', actionDone: 'action-done', writeDone: 'write-done' },
    promptLang: function () { return curLang },
  }
  try {
    const names = Object.keys(deps)
    // 本处走 compileFn：参数名与取值都来自同一个 deps，展开传法与原来一致。
    compileFn(names, line).apply(null, names.map(function (k) { return deps[k] }))
  } catch (e) { return { threw: String(e && e.message), reloads: seen } }
  return { reloads: seen }
}
const langChanged = reloadsOnLanguage({ chainSnapshot: { steps: [] }, chainLangLoaded: 'zh' }, 'en')
const langSame = reloadsOnLanguage({ chainSnapshot: { steps: [] }, chainLangLoaded: 'zh' }, 'zh')
const langNotLoadedYet = reloadsOnLanguage({ chainSnapshot: null, chainLangLoaded: undefined }, 'zh')
check(!langChanged.noGuard, '在检查页里找得到「快照语言与当前语言不一致」那条守卫（语言变了要能察觉）')
check(!langChanged.threw && langChanged.reloads.length === 1 && langChanged.reloads[0].force === true,
  '语言变了就真的重取一次链、而且是 force（实得 ' + JSON.stringify(langChanged) + '）')
check(!langSame.threw && langSame.reloads.length === 0, '语言没变就不重取（不许每次渲染都白跑一趟）（实得 ' + JSON.stringify(langSame.reloads) + '）')
check(!langNotLoadedYet.threw && langNotLoadedYet.reloads.length === 0, '还没有链快照时不误判成「语言变了」（实得 ' + JSON.stringify(langNotLoadedYet.reloads) + '）')

console.log(failed ? '\n[issue529-checks-i18n] FAIL (' + passed + ' passed)' : '\n全部通过 · 环境检查语言切换即时重取门禁生效 (' + passed + ')')
process.exit(failed ? 1 : 0)
