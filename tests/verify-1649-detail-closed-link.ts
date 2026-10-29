// tests/verify-1649-detail-closed-link.ts —— #1649 门禁：详情缓存给已关闭票补上取址
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1649
// 门禁归属: src/client/kernel/link.ts
// 门禁归属: src/client/kernel/api-io.ts
// 判据（第一性原理）：
// 1. 已关闭容器里的已关闭子票，在快照里只剩瘦身行（thinTickets 只有六样字段，没有 url），
//    Markdown 后端又没有 issueUrlTemplate，issueUrlFor 只能回空串；rowActionText 于是把注入
//    文本第二行写成 `#编号`（用户看到的 `#3`）。
// 2. 详情页本来已经拉过这张票的详情，回包里有 url（fetchIssueDetail 按 (effortId, 编号) 写进
//    st.issueCache）。取址应该用这份权威数据兜底，而不是把它丢掉。
// 3. 边界：快照里已有的 url 仍优先；effort 不同的详情缓存不得串号；没有详情缓存时仍诚实回空串。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1649-detail-closed-link.ts
// 说明：身份算法走真实现（link.js 读的是同闭包全局量；手写桩一旦与真源分叉，门禁就测了个假环境）。
const identityMod = await import('../src/tracker/kernel/identity-keys.js')
const { effortOf, idOfParts, idOf } = identityMod
globalThis.effortOf = effortOf
globalThis.idOfParts = idOfParts
globalThis.idOf = idOf
const linkMod = await import('../src/client/kernel/link.js')
const { issueUrlFor } = linkMod

let failures = 0
let total = 0
const check = (ok: any, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

const MD_SPEC = 'D:\\ws\\spec.md'
const MD_TICKET = 'D:\\ws\\issues\\03-门禁回归与验收-双页对齐-既有门禁全绿.md'
const DETAIL = { number: 3, key: '03', title: '03', state: 'CLOSED', url: MD_TICKET }

// 真实形状：已关闭规格容器（tickets 为空）+ 该容器里的已关闭子票只出现在 thinTickets（无 url）
function stClosedContainer(): any {
  return {
    snapshot: {
      issues: [],
      maps: [{ key: '00', number: 0, type: 'spec', state: 'CLOSED', title: 'spec', url: MD_SPEC, tickets: [] }],
      thinTickets: [{ key: '03', number: 3, effortId: '', type: 'spec-ticket', state: 'CLOSED', title: '03' }],
    },
  }
}
// 按 fetchIssueDetail 的写法挂详情缓存：键 = idOfParts(effortId, Number(编号))
function withDetail(st: any, data: any, effortId: string): any {
  st.issueCache = {}
  st.issueCache[idOfParts(effortId, Number(data.number))] = { ts: Date.now(), data }
  st.issueDetail = data
  return st
}

// C1：快照里没有地址、详情缓存里有 → 回详情里的完整路径（修复前这里是空串，正是用户看到的 #3 的来源）
{
  const st = withDetail(stClosedContainer(), DETAIL, '')
  check(issueUrlFor(st, 3, '') === MD_TICKET, '已关闭子票：快照无 url 时用详情缓存的票文件路径兜底')
}
// C2：不传 effort 也要能取到（单工作单元后端 effort 为空串；键要按编号归一到数字再拼）
{
  const st = withDetail(stClosedContainer(), DETAIL, '')
  check(issueUrlFor(st, '03') === MD_TICKET, '不传 effort、编号带前导零时同样回详情缓存里的路径')
}
// C3：快照命中的 url 仍优先于详情缓存（不改变既有优先级）
{
  const st = withDetail(stClosedContainer(), DETAIL, '')
  st.snapshot.issues = [{ key: '03', number: 3, url: 'D:\\ws\\issues\\03-snapshot.md' }]
  check(issueUrlFor(st, 3, '') === 'D:\\ws\\issues\\03-snapshot.md', '快照里已有的 url 仍优先于详情缓存')
}
// C4：effort 不同不得串号（同一编号在别的 effort 里的详情缓存不能拿来用）
{
  const st = withDetail(stClosedContainer(), DETAIL, 'effort-a')
  check(issueUrlFor(st, 3, 'effort-b') === '', 'effort 不同的详情缓存不串号（仍诚实回空串）')
}
// C5：没有详情缓存 → 仍回空串（Markdown 没有 url 模板；保留旧行为，不编造地址）
{
  const st = stClosedContainer()
  check(issueUrlFor(st, 3, '') === '', '没有详情缓存时仍回空串（不编造地址）')
}

console.log(failures ? `\n#1649 门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1649 门禁全部通过（共 ${total} 条）`)
// 失败才 process.exit(1)。通过时让进程自然退出：Node 24.19 在 Windows 上
// import 完本模块立刻 process.exit(0) 会撞 libuv 断言（uv_async_send 打在正在关闭
// 的句柄上，exit code 0xC0000409），断言虽全过但进程被判红。自然退出避开这个竞态。
if (failures) process.exit(1)
