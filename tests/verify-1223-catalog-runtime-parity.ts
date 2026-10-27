// tests/verify-1223-catalog-runtime-parity.ts —— #1223：检查目录、模块检查表、迁移表编号三处不许各说各话
//
// 背景：检查目录（src/shared/tracker/check-catalog-dirs.ts）是「有哪些检查项」的唯一真源；GitHub 房
//   的模块检查表（src/tracker/rooms/github/checks.ts）是目录在该后端的投影；迁移表 MIGRATION_MAP 把
//   旧盘点清单的编号对到目录下标上。2026-10-27 之前，目录里多留了一项已退役的旧标签检查、运行期靠
//   一条过滤把多出来的行藏掉、迁移表 GitHub 段整体错位一格——三处各说各话，门禁照样全绿。
//
// 本文件的两条静态断言（#1223 验收）：
//   A 目录后端段与模块检查表逐项对齐（id/label/check 三样都比）。2026-10-27 同日后手把模块检查表改成了
//      由目录派生（src/tracker/rooms/github/checks.ts），所以这条现在由构造保证成立；保留它是回归锁：
//      若有人把派生换回手抄副本并让它漂移，这里会红。B 守的是另一种漂移（编号对不上键）。
//   B 迁移表解析后的编号与键一致：MIGRATION_MAP 每个「目录名[下标]」指到的目录项 id 必须就是它自己的键。
//
// 门禁归属: src/shared/tracker/check-catalog-dirs.ts
// 门禁归属: src/tracker/rooms/github/checks.ts
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-1223-catalog-runtime-parity.ts
import assert from 'node:assert/strict'
import { ALL_CATALOGS, catalogFor, MIGRATION_MAP } from '../src/shared/tracker/check-catalog-dirs.js'
import { GITHUB_CHECKS } from '../src/tracker/rooms/github/checks.js'

type ItemLike = { id: string; label?: string; check?: unknown }
let groups = 0
const ok = (name: string): void => { groups += 1; console.log('  PASS ' + name) }

function main(): void {
  // —— 断言 A：目录后端段 = 模块检查表（id 顺序、label、check 三样都逐字比） ——
  // 模块表由目录派生后，这一条是回归锁：防的是「有人把派生换回手抄副本并让它漂移」。
  const githubBackend: readonly ItemLike[] = catalogFor('github').filter((c) => c.scope === 'backend')
  const moduleChecks: readonly ItemLike[] = GITHUB_CHECKS
  assert(githubBackend.length > 0, '目录里 GitHub 后端段非空（空目录会让本断言假绿）')
  assert.deepStrictEqual(
    githubBackend.map((c) => ({ id: c.id, label: c.label, check: c.check })),
    moduleChecks.map((c) => ({ id: c.id, label: c.label, check: c.check })),
    '目录与模块检查表的 id/label/check 逐字一致（模块表应由目录派生，不许再手抄一份）',
  )
  ok('目录 GitHub 后端段与模块检查表逐字对齐（派生后保留作回归锁）')

  // —— 断言 B：迁移表每一项都解析回它自己的那个目录项 ——
  // 目录表从真源导出的 ALL_CATALOGS 取（键名小写），不在这里手抄一份；将来加第五个目录时不会静默漏判。
  const entries = Object.entries(MIGRATION_MAP as Record<string, string>)
  assert(entries.length > 0, '迁移表非空（空表会让逐条断言假绿）')
  for (const [key, ref] of entries) {
    const m = /^(GENERIC|GITHUB|GITLAB|MARKDOWN)_CATALOG\[(\d+)\]$/.exec(ref)
    assert(m, `迁移表 ${key} 的编号写成「目录名[下标]」（实得 ${ref}）`)
    const list = (ALL_CATALOGS as Record<string, readonly ItemLike[]>)[m[1].toLowerCase()]
    assert(list, `迁移表 ${key} 指向的目录 ${m[1]} 存在`)
    const item = list[Number(m[2])]
    assert(item, `迁移表 ${key} 的编号 ${ref} 指向的目录项存在`)
    assert.strictEqual(item.id, key, `迁移表 ${key} 指到的目录项 id 是 ${key}（实得 ${item.id}）`)
  }
  ok(`迁移表 ${entries.length} 项都能解析回自己的目录项（编号与键一致）`)

  console.log('\n全部通过：' + groups + ' 组检查')
}

try {
  main()
} catch (e) {
  console.error('FAIL', e)
  process.exit(1)
}
