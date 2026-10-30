// tests/verify-1668-detail-top-gate.ts —— #1668 门禁：票详情顶栏动作的可用性判据（已关闭/已合并这一支）
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1668
// 门禁归属: src/client/kernel/detail-top-gate.ts
// 判据（第一性原理，规格 #1667）：
// 1. 票自身的状态由 prStateKind 这一份判据读（closed / merged 都算关闭；容器「完成」不是关闭）。
// 2. 不是 open 就不能点，原因写「已关闭」；这一条不看数据来自详情还是列表兜底快照。
// 3. 打开的票今天一律能点；「被未完成票阻塞」是 #1669 的分支，本票不判，但入参与出参字段先留好。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1668-detail-top-gate.ts
// 说明：状态判据走真实现（detail-top-gate 读的是同闭包全局量；手写桩一旦与真源分叉，门禁就测了个假环境）。
const stateKindMod = await import('../src/client/views/shared/stateKind.js')
globalThis.prStateKind = stateKindMod.prStateKind
const { detailTopGate } = await import('../src/client/kernel/detail-top-gate.js')

let failures = 0
let total = 0
const check = (ok: any, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// A 组：打开 → 能点，原因「无」，没有阻塞票号
{
  const g = detailTopGate({ number: 7, key: '07', title: '打开的票', state: 'OPEN', labels: [] }, [])
  check(g.clickable === true, '打开的票：能点')
  check(g.reason === 'none', '打开的票：原因记为「无」')
  check(Array.isArray(g.blockedNumbers) && g.blockedNumbers.length === 0, '打开的票：阻塞票号为空数组')
}
// B 组：关闭 → 不能点，原因「已关闭」
{
  const g = detailTopGate({ number: 7, key: '07', title: '关闭的票', state: 'CLOSED', labels: [] }, [])
  check(g.clickable === false, '已关闭的票：不能点')
  check(g.reason === 'closed', '已关闭的票：原因记为「已关闭」')
  check(Array.isArray(g.blockedNumbers) && g.blockedNumbers.length === 0, '已关闭的票：不给出阻塞票号')
}
// C 组：带合并时间的合并票 → 同样算关闭（两种来源都由 prStateKind 收成 merged）
{
  const g = detailTopGate({ number: 8, key: '08', title: '已合并', state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z' }, [])
  check(g.clickable === false && g.reason === 'closed', '带合并时间的合并票：不能点，原因「已关闭」')
}
// D 组：只剩列表兜底快照（没有详情回包）时，同一条判据照样生效
{
  const snapshotRow = { number: 7, key: '07', title: '关闭的票', state: 'CLOSED', labels: [], url: 'D:\\ws\\issues\\07-x.md' }
  const g = detailTopGate(snapshotRow, undefined)
  check(g.clickable === false && g.reason === 'closed', '详情缺失、只剩列表快照：仍是不能点、原因「已关闭」')
}
// E 组：容器「完成」不是关闭 —— 票本身打开就仍能点
{
  const g = detailTopGate({ number: 7, key: '07', title: '子票', state: 'OPEN', labels: [], container: { state: 'COMPLETE' } }, [])
  check(g.clickable === true && g.reason === 'none', '容器已完成但票本身打开：仍能点（容器三态不参与本判据）')
}
// F 组：打开且阻塞清单为空或整块缺失 → 能点（本票不判阻塞；#1669 再扩这一支）
{
  const g1 = detailTopGate({ number: 7, key: '07', state: 'OPEN' }, [])
  const g2 = detailTopGate({ number: 7, key: '07', state: 'OPEN' }, undefined)
  check(g1.clickable === true && g1.reason === 'none', '打开 + 阻塞清单为空：能点')
  check(g2.clickable === true && g2.reason === 'none', '打开 + 阻塞清单整块缺失：能点（当没有阻塞）')
}
// G 组：小写 / 前后空白的关闭态也认（prStateKind 的口径，不在这里另写一份）
{
  const g = detailTopGate({ number: 9, state: '  closed ' }, [])
  check(g.clickable === false && g.reason === 'closed', '小写并带空白的关闭态：不能点')
}

console.log(failures ? `\n#1668 判据门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1668 判据门禁全部通过（共 ${total} 条）`)
// 失败才 process.exit(1)。通过时让进程自然退出：Node 24.19 在 Windows 上
// import 完本模块立刻 process.exit(0) 会撞 libuv 断言（uv_async_send 打在正在关闭
// 的句柄上，exit code 0xC0000409），断言虽全过但进程被判红。自然退出避开这个竞态。
if (failures) process.exit(1)
