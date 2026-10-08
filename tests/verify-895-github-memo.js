// verify-895-github-memo.js —— #895 回归门禁：github 房读放大的名册定向刷新。
// 用法：在插件根目录执行 node tests/verify-895-github-memo.js，可独立运行。
//
// 这一段盯三件事（脚本化 gh + 计数执行层，真后端模块）：
//   ① 第二次补边不再整仓拉取：定向重读脏票，整仓列表只在第一次出现。
//   ② 同调用内成环照拒（名册路径不断环检查）。
//   ③ 名册缺席时一切照旧（老行为：每次整仓拉取，不崩）。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('#895 回归门禁：github 房名册定向刷新（脚本化 gh 计数）')
  const transports = require('./deck-tools-matrix-transports.js')
  const scopeMod = await imp('src/shared/deck-tools/call-scope.js')
  const registryMod = await imp('src/host/tracker/registryCore.js')
  const githubModule = (await imp('src/host/tracker/backends/github/index.js')).githubModule

  const sink = []
  const gh = transports.makeScriptedGh(sink)
  const argvCount = { n: 0 }
  const ghCtxBase = {
    cwd: '/ws/github',
    platform: { resolveExecutable: async (n) => (n === 'gh' ? '/usr/local/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd, args, opts) => { argvCount.n += 1; await sleep(5); return gh.exec(cmd, args, opts) },
    isEnabled: () => false, logEvent: () => {},
  }
  const registry = registryMod.createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  registry.register(githubModule)
  registry.bind({ cwd: '/ws/github', refId: 'acme/demo' }, 'github')
  const tracker = registry.get('github')
  const repo = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
  const ids = []
  for (let i = 0; i < 8; i++) {
    const r = await tracker.create(repo, { title: '票' + i }, Object.assign({}, ghCtxBase))
    if (!r.ok) { check(false, '种子票建成（第 ' + i + ' 张失败：' + JSON.stringify(r.error) + '）'); return }
    ids.push(String(r.data.key))
  }
  check(ids.length === 8, '种子 8 票建成')
  const memoCtx = () => Object.assign({}, ghCtxBase, { memo: scopeMod.createCallMemo() })

  // ── ① 两次补边：第二次不再整仓拉取 ──
  {
    const ctx = memoCtx()
    const before = argvCount.n
    const fullLists = () => sink.slice(before).filter((l) => l.indexOf('first=100') >= 0).length
    const r1 = await tracker.setBlockedBy(repo, ids[0], [ids[1]], {}, ctx)
    check(r1.ok === true, '第一次补边成功')
    const listsAfterFirst = fullLists()
    check(listsAfterFirst > 0, '第一次用了整仓拉取建名册（整仓行 ' + listsAfterFirst + ' 条）')
    const mark = argvCount.n
    const r2 = await tracker.setBlockedBy(repo, ids[2], [ids[3]], {}, ctx)
    check(r2.ok === true, '第二次补边成功')
    const listsAfterSecond = sink.slice(mark).filter((l) => l.indexOf('first=100') >= 0).length
    check(listsAfterSecond === 0, '第二次零整仓拉取（实 ' + listsAfterSecond + ' 条，定向重读脏票）')
    check(argvCount.n - mark < mark - before, '第二次出站少于第一次（' + (argvCount.n - mark) + ' < ' + (mark - before) + '）')
  }

  // ── ② 名册路径不断环检查 ──
  {
    const ctx = memoCtx()
    await tracker.setBlockedBy(repo, ids[4], [ids[5]], {}, ctx)
    const bad = await tracker.setBlockedBy(repo, ids[5], [ids[4]], {}, ctx)
    check(bad.ok !== true && /cycle/i.test(String((bad.error && bad.error.message) || '')), '反向边被拒且说清成环')
  }

  // ── ③ 名册缺席照旧 ──
  {
    const before = argvCount.n
    const r = await tracker.setBlockedBy(repo, ids[6], [ids[7]], {}, Object.assign({}, ghCtxBase))
    check(r.ok === true, '无名册补边成功（老行为）')
    check(argvCount.n - before > 0, '无名册照常发请求')
  }

  console.log('\n共 ' + total + ' 条，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exitCode = 1 })
