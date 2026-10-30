// tests/verify-1668-detail-top-gate.ts —— #1668/#1669 门禁：票详情顶栏动作的可用性判据
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1668
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1669
// 门禁归属: src/client/kernel/detail-top-gate.ts
// 判据（第一性原理，规格 #1667）：
// 1. 票自身的状态由 prStateKind 这一份判据读（closed / merged 都算关闭；容器「完成」不是关闭）。
// 2. 不是 open 就不能点，原因写「已关闭」；这一条不看数据来自详情还是列表兜底快照。
// 3. 票打开时再看详情回包的 blockedBy.nodes（#1669）：只有明确读到「还没关闭」的阻塞票才算阻塞；
//    阻塞票已关闭 / 已合并 / 状态认不出 / 票号不成，都按未知处理、不参与置灰。存在至少一张
//    没关闭的阻塞票 → 不能点、原因「被阻塞」、票号去重后升序。两条同时命中仍取「已关闭」。
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

// H 组（#1669）：打开 + 一张明确没关闭的阻塞票 → 不能点，原因「被阻塞」，点名该票号
{
  const g = detailTopGate({ number: 7, key: '07', title: '打开的票', state: 'OPEN', labels: [] }, [{ number: 11, title: '还没做完', state: 'OPEN' }])
  check(g.clickable === false, '打开 + 一张未关闭的阻塞票：不能点')
  check(g.reason === 'blocked', '打开 + 一张未关闭的阻塞票：原因记为「被阻塞」')
  check(Array.isArray(g.blockedNumbers) && g.blockedNumbers.join(',') === '11', '打开 + 一张未关闭的阻塞票：点名该票号')
}

// I 组（#1669）：多张未关闭的阻塞票、乱序且含重复票号 → 去重后升序点名
{
  const g = detailTopGate({ number: 7, state: 'OPEN' }, [
    { number: 30, state: 'OPEN' },
    { number: 5, state: 'open' },
    { number: 30, state: 'OPEN' },
    { number: 12, state: ' Open ' },
  ])
  check(g.clickable === false && g.reason === 'blocked', '多张未关闭的阻塞票：不能点、原因「被阻塞」')
  check(g.blockedNumbers.join(',') === '5,12,30', '多张未关闭的阻塞票：票号去重并按编号升序（' + g.blockedNumbers.join(',') + '）')
}
// J 组（#1669）：阻塞票已完成（closed / merged / 带合并时间）→ 回到可点
{
  const g1 = detailTopGate({ number: 7, state: 'OPEN' }, [{ number: 3, state: 'CLOSED' }, { number: 4, state: 'MERGED' }])
  check(g1.clickable === true && g1.reason === 'none', '阻塞票状态是 closed / merged：能点（已完成不阻塞）')
  const g2 = detailTopGate({ number: 7, state: 'OPEN' }, [{ number: 3, state: 'open', mergedAt: '2026-10-01T00:00:00Z' }])
  check(g2.clickable === true && g2.reason === 'none', '阻塞票状态还写 open、但带合并时间：能点（合并时间说明已完成）')
  check(g2.blockedNumbers.length === 0, '阻塞票已完成时不点名任何票号')
}
// K 组（#1669）：一张未关闭、一张已完成 → 只点名没关闭那张
{
  const g = detailTopGate({ number: 7, state: 'OPEN' }, [{ number: 12, state: 'CLOSED' }, { number: 9, state: 'OPEN' }])
  check(g.clickable === false && g.reason === 'blocked' && g.blockedNumbers.join(',') === '9', '一张未关闭一张已完成：只点名没关闭的 #9')
}
// L 组（#1669）：阻塞票状态字段缺失、空串或认不出 → 未知，保持可点
{
  const g1 = detailTopGate({ number: 7, state: 'OPEN' }, [{ number: 3 }, { number: 4, state: '' }, { number: 5, state: 'doing' }])
  check(g1.clickable === true && g1.reason === 'none', '阻塞票状态缺失 / 空串 / 认不出：保持能点（未知不置灰）')
  check(g1.blockedNumbers.length === 0, '未知的阻塞票不点名')
}
// M 组（#1669）：大小写混排的宿主回包（OPEN / CLOSED / Merged）都按同一个口径读
{
  const g = detailTopGate({ number: 7, state: 'OPEN' }, [{ number: 21, state: 'OPEN' }, { number: 22, state: 'CLOSED' }, { number: 23, state: 'Merged' }])
  check(g.blockedNumbers.join(',') === '21', '大写 OPEN 算未关闭、大写 CLOSED 与大写 Merged 算已完成')
}
// N 组（#1669）：票已关闭 + 有未关闭阻塞 → 原因仍取「已关闭」，且不点名阻塞票
{
  const g = detailTopGate({ number: 7, state: 'CLOSED' }, [{ number: 3, state: 'OPEN' }])
  check(g.clickable === false && g.reason === 'closed', '票已关闭且有未关闭阻塞票：原因仍取「已关闭」')
  check(g.blockedNumbers.length === 0, '票已关闭时不给阻塞票号（两条同时命中只说已关闭）')
}
// O 组（#1669）：阻塞票号不成（0 / 负数 / 小数 / 字符串）→ 不能点出「#哪一张」，按未知处理
{
  const g = detailTopGate({ number: 7, state: 'OPEN' }, [{ number: 0, state: 'OPEN' }, { number: -3, state: 'OPEN' }, { number: 2.5, state: 'OPEN' }, { number: '12', state: 'OPEN' }, {}, null])
  check(g.clickable === true && g.reason === 'none', '阻塞票号不是可用正整数：保持能点')
}
// P 组（#1669）：阻塞清单不是数组（宿主换了形状 / 传了对象）→ 当作没有，保持能点
{
  const g = detailTopGate({ number: 7, state: 'OPEN' }, { nodes: [{ number: 3, state: 'OPEN' }] } as any)
  check(g.clickable === true && g.reason === 'none', '阻塞清单不是数组：当作没有阻塞、保持能点')
}

console.log(failures ? `\n#1668/#1669 判据门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1668/#1669 判据门禁全部通过（共 ${total} 条）`)
// 失败才 process.exit(1)。通过时让进程自然退出：Node 24.19 在 Windows 上
// import 完本模块立刻 process.exit(0) 会撞 libuv 断言（uv_async_send 打在正在关闭
// 的句柄上，exit code 0xC0000409），断言虽全过但进程被判红。自然退出避开这个竞态。
if (failures) process.exit(1)
