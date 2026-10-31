// tests/verify-1223-catalog-runtime-parity.ts —— #1223：目录的 GitHub 后端段 = 模块检查表，迁移表编号 = 键
//
// 背景：检查目录（src/shared/tracker/check-catalog-dirs.ts）是「有哪些检查项」的唯一真源；GitHub 房
//   的模块检查表（src/tracker/rooms/github/room/checks.ts）是目录在该后端的投影；迁移表 MIGRATION_MAP 把
//   旧盘点清单的编号对到目录下标上。2026-10-27 之前，目录里多留了一项已退役的旧标签检查、运行期靠
//   一条过滤把多出来的行藏掉、迁移表 GitHub 段整体错位一格——三处各说各话，门禁照样全绿。
//
// 2026-10-27 当天稍晚，模块检查表改成由目录派生，下面断言 A 因此由构造保证成立；保留它是回归锁：
//   谁把派生换回手抄副本（哪怕值抄得一模一样），对象身份比较都会红。断言 B 守另一种漂移：编号对不上键。
//
// 门禁归属: src/shared/tracker/check-catalog-dirs.ts
// 门禁归属: src/tracker/rooms/github/room/checks.ts
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-1223-catalog-runtime-parity.ts
import assert from 'node:assert/strict'
import { ALL_CATALOGS, backendItemsOf, MIGRATION_MAP } from '../src/shared/tracker/check-catalog-dirs.js'
import { GITHUB_CHECKS } from '../src/tracker/rooms/github/room/checks.js'

type ItemLike = { id: string; label?: string; origin?: string; check?: unknown }
let groups = 0
const ok = (name: string): void => { groups += 1; console.log('  PASS ' + name) }

function main(): void {
  // —— 断言 A：模块检查表 = 目录 GitHub 后端段（同一批对象、同一顺序） ——
  // 比对象身份而不是比值：手抄副本只要值抄对了就能骗过值比较；派生关系被换掉必须红。
  const catalogItems: readonly ItemLike[] = backendItemsOf('github')
  const moduleChecks: readonly ItemLike[] = GITHUB_CHECKS
  assert(catalogItems.length > 0, '目录里 GitHub 后端段非空（空目录会让本断言假绿）')
  assert.strictEqual(moduleChecks.length, catalogItems.length, '模块检查表行数与目录 GitHub 后端段一致')
  catalogItems.forEach((item, index) => {
    assert.strictEqual(
      moduleChecks[index],
      item,
      `模块检查表第 ${index + 1} 行必须引用目录里的同一个对象（派生，不是副本；id=${item.id}）`,
    )
  })
  ok('目录 GitHub 后端段与模块检查表逐项对齐（同一批对象、同一顺序）')

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
