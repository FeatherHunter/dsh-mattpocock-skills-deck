// tests/verify-link-capabilities.ts —— 门禁：三个后端的链接能力，新名字与老名字必须同值、值本身要对
//
// 门禁归属: src/tracker/rooms/github/index.ts
// 门禁归属: src/tracker/rooms/markdown/index.ts
// 门禁归属: src/tracker/rooms/gitlab/index.ts
// 门禁归属: src/tracker/registry/views.ts
//
// 为什么要有这条（#1133 交付后补的那道门禁）：
//   三个房间把三个链接能力挂了两套名字（新名字与后端无关：issueAddress / repoSearchAddress /
//   issueRefPattern；老名字是网址口吻：issueUrl / searchUrl / linkPattern），这套「别名窗口」
//   期间唯一的语义是——两组名字指向**同一份实现**，而且值本身是对的。
//   可今天没有任何东西在守它：
//     · tests/verify-contract-types.js 只把模块对象的键名与快照逐字比（键在不在），不看键上挂的值；
//     · tests/tracker-contract/sections/registry.js 全程用自造假模块，真房间的新名字一次都没被读过；
//     · tests/contract-probe-github.ts 只证明形状装得进契约类型；
//     · tests/verify-golden-receipts.ts 只看九个工具的输出。
//   于是把 issueAddress 与 repoSearchAddress 的值对调，上面四道全绿——这条门禁就是堵这个洞。
//
// 到期怎么处理（写清省得下一个人猜）：
//   这张票的窗口关闭时（三个房间、客户端与宿主都不再读老名字），与老名字一起删的还有**本文件**。
//   它不是长期设施，是别名窗口的看守；删的时候连本文件在 package.json 的 verify 名单里的那一项、
//   以及 tests/gate-map.json 里对应的归属一起摘掉（跑 node scripts/gate-map.mjs 重新生成）。
//
// 本文件有意**不**引入任何新的生产代码（没有共享词汇表之类的抽象）：窗口是临时的，
//   为一个临时窗口建永久结构不划算；这条门禁自己把三个能力写全，加第四个能力时跟着加一段即可。
//
// 用法（手工跑要自己挂装载钩子；npm test / verify:parallel / verify-all 三个入口自动挂）：
//   node --import ./scripts/ts-hook.mjs tests/verify-link-capabilities.ts
import { createRegistry } from '../src/tracker/registry/core.js'
import { githubModule } from '../src/tracker/rooms/github/index.js'
import { markdownModule } from '../src/tracker/rooms/markdown/index.js'
import { gitlabBackend } from '../src/tracker/rooms/gitlab/index.js'

let failed = false
const messages: string[] = []
/** 一条判据：失败时把「哪个房间、哪个名字、期望什么、实际什么」一次说清，看的人不用回头读本文件。 */
const check = (ok: boolean, msg: string) => { if (!ok) { failed = true; messages.push(msg) } }

/** 三个链接能力：新名字 → 老名字；形状决定怎么校验值（函数口按参数个数，文化口按类型）。 */
const CAPABILITIES = [
  { name: 'issueAddress', legacy: 'issueUrl', shape: 'fn', arity: 2 },
  { name: 'repoSearchAddress', legacy: 'searchUrl', shape: 'fn', arity: 1 },
  { name: 'issueRefPattern', legacy: 'linkPattern', shape: 'pattern', arity: 0 },
] as const

/**
 * 三个后端各自的实况。handle 是宿主交给房间的形状（票地址那一路读 handle.refId）；
 * want 是契约要求的地址（本地 Markdown 给的是票文件路径，不预先钉死，只要求认得票号）。
 */
const ROOMS = [
  {
    id: 'github',
    mod: githubModule,
    handle: { refId: 'FeatherHunter/dsh-mattpocock-skills-deck' },
    key: '1133',
    name: 'deck',
    want: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1133',
    text: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1133',
  },
  {
    id: 'gitlab',
    mod: gitlabBackend,
    handle: { refId: 'group/proj' },
    key: '7',
    name: 'deck',
    want: 'https://gitlab.com/group/proj/-/issues/7',
    text: 'https://gitlab.com/group/proj/-/issues/7',
  },
  {
    id: 'markdown',
    mod: markdownModule,
    handle: { cwd: '.scratch', refId: '' },
    key: '42',
    name: 'deck',
    want: '', // 本地这家的地址是票文件路径，随工作区变；下面只断言「认得票号」
    text: '票 42 已记下 #42',
  },
] as const

let assertions = 0
/** 逐条判据都要真正跑过：一个判据都没跑（比如房间没注册上、循环空转）也算失败。 */
const NEEDED = ROOMS.length * (CAPABILITIES.length * 2 + 8)

/**
 * 从注册表门面读一个能力：这里是宿主与 deck 工具真正走的那条路
 * （core.ts 的 issueAddress / repoSearchAddress / issueRefPattern），不是直接读模块对象。
 * 只写本文件用得到的那几个成员：测试不复制生产类型的全套形状，避免两处各写一份。
 */
type Facade = {
  register: (mod: Record<string, unknown>) => void
  issueAddress: (backendId: string, handle: unknown, key: string) => string
  repoSearchAddress: (backendId: string, name: string) => string
  issueRefPattern: (backendId: string) => unknown
}
const asModule = (m: unknown) => m as Record<string, unknown>

for (const room of ROOMS) {
  const reg = createRegistry({}) as unknown as Facade
  reg.register(asModule(room.mod))

  // 一、两套名字必须在，且指向同一份实现（老名字不是空壳，新名字也不是另抄的第二份）
  for (const cap of CAPABILITIES) {
    const n = (room.mod as Record<string, unknown>)[cap.name]
    const legacy = (room.mod as Record<string, unknown>)[cap.legacy]
    assertions += 2
    check(n !== undefined, `${room.id}：模块对象上没有新名字 ${cap.name}（别名窗口内六个名字都要在）`)
    check(legacy !== undefined, `${room.id}：模块对象上没有老名字 ${cap.legacy}（老名字要留一轮，别提前删）`)
    check(n === legacy, `${room.id}：${cap.name} 与老名字 ${cap.legacy} 不是同一份实现（一个是空壳，或另抄了一份）`)
    check(
      cap.shape === 'fn'
        ? typeof n === 'function' && (n as (...a: unknown[]) => unknown).length === cap.arity
        : n instanceof RegExp || typeof n === 'string',
      `${room.id}：${cap.name} 的形状不对（函数口要 ${cap.arity} 个参数；认票口要是 RegExp 或源码串）`,
    )
  }

  // 二、值本身对不对：走注册表门面，按契约要求逐个验
  assertions += 4
  const address = reg.issueAddress(room.id, room.handle, room.key)
  const search = reg.repoSearchAddress(room.id, room.name)
  const pattern = reg.issueRefPattern(room.id)
  check(typeof address === 'string' && address.length > 0, `${room.id}：注册表给不出票地址（拿到 ${JSON.stringify(address)}）`)
  if (room.want) check(address === room.want, `${room.id}：票地址与契约要求不一致（拿到 ${address}，要求 ${room.want}）`)
  check(
    room.want === '' ? search === '' : search.includes(room.name),
    `${room.id}：搜索地址不对（拿到 ${JSON.stringify(search)}，本地那家按契约应当诚实回空串）`,
  )
  const matched = pattern ? [...String(room.text).matchAll(pattern as RegExp)].map((m) => m[1]) : []
  check(matched.includes(room.key), `${room.id}：认票口认不出票号 ${room.key}（拿到 ${JSON.stringify(pattern)}，认到 ${JSON.stringify(matched)}）`)

  // 三、老名字那条兜底路：把新名字摘掉、只留老名字，注册表要照样给出同样的答案。
  //     新名字摘掉之后仍有答案，才叫「老名字兜底」；摘掉就空，说明老名字是摆设。
  assertions += 4
  const legacyOnly = asModule(room.mod)
  for (const cap of CAPABILITIES) delete legacyOnly[cap.name]
  const regLegacy = createRegistry({}) as unknown as Facade
  regLegacy.register(legacyOnly)
  const address2 = regLegacy.issueAddress(room.id, room.handle, room.key)
  const search2 = regLegacy.repoSearchAddress(room.id, room.name)
  const pattern2 = regLegacy.issueRefPattern(room.id)
  const matched2 = pattern2 ? [...String(room.text).matchAll(pattern2 as RegExp)].map((m) => m[1]) : []
  check(address2 !== '' && address2 === address, `${room.id}：只有老名字时票地址与走新名字时不一致（老名字 ${address2}，新名字 ${address}）`)
  check(search2 === search, `${room.id}：只有老名字时搜索地址与走新名字时不一致（老名字 ${JSON.stringify(search2)}，新名字 ${JSON.stringify(search)}）`)
  check(matched2.includes(room.key), `${room.id}：只有老名字时认票口认不出票号 ${room.key}（认到 ${JSON.stringify(matched2)}）`)
  check(pattern2 !== null, `${room.id}：只有老名字时注册表给不出认票口（老名字兜底没生效）`)
}

// 四、上面每一段都必须真的跑过。一个判据都没跑或跑漏了，这里要报出来，
//     否则「房间没注册上」这种情况会让整条门禁在零断言下变绿。
check(assertions >= NEEDED, `判据跑漏了：只跑了 ${assertions} 条，至少要 ${NEEDED} 条（房间没注册上或者代码提前退出）`)

console.log('链接能力的新名字与老名字门禁（#1133 起，三个后端）')
if (failed) {
  for (const m of messages) console.log('  FAIL ' + m)
  console.log(`\n有 ${messages.length} 条不成立（共 ${assertions} 条判据）`)
  process.exit(1)
}
console.log(`  全部通过 — ${assertions} 条判据：三个房间的六个名字同值、值正确、老名字兜底可用`)
