// tests/tracker-contract/sections/idempotency-counterproof.js —— #711 的反证现场实验（不是门禁用例，不进 verify 链）。
//
// 它只做一件事：把「按锚回查」这一步**做坏**（改成只在进程内的内存表里查），
// 然后原样跑一遍 tests/tracker-contract/sections/idempotency.js 的第三段判据。
// 期望：那一段必须变红 —— 逮不住就说明这段判据形同虚设。
//
// 用法：node tests/tracker-contract/sections/idempotency-counterproof.js
//
// 为什么单独一条而不是塞进门禁：门禁每次都要跑，这里要**故意**让一片红出来给人看，
// 它自己的成功判据恰恰是「那几条断言失败了」。

import { createRegistry } from '../../../src/host/tracker/registryCore.js'
import { anchorLineFor, idempotencyKeyOf } from '../../../src/shared/refresh/idempotency.js'

// ── 坏实现：锚照样写进票面，但「回查」查的是自己实例里的一张临时表（不看票面）──
function makeBrokenBackend(store) {
  const memoryOnly = new Map()
  return {
    id: 'anchor-fake',
    list: async () => ({ ok: true, data: [] }),
    create: async (repo, input) => {
      const key = input && input.idempotencyKey ? String(input.idempotencyKey) : ''
      if (key && memoryOnly.has(key)) {
        const t = memoryOnly.get(key)
        return { ok: true, data: { key: t.key, title: t.title, state: 'open', body: t.body } }
      }
      const t = { key: String(store.tickets.length + 1).padStart(2, '0'), title: String(input.title || ''), body: key ? anchorLineFor(key) + String(input.body || '') : String(input.body || '') }
      store.tickets.push(t)
      if (key) memoryOnly.set(key, t)
      void idempotencyKeyOf(t.body) // 票面上确实写着锚，只是没人去读它
      return { ok: true, data: { key: t.key, title: t.title, state: 'open', body: t.body } }
    },
  }
}

function makeBrokenFake(id, share) {
  const s = share || { id: id || 'anchor-fake', store: { tickets: [] } }
  return { id: s.id, label: '坏假身（回查只认内存）', matches: async () => false, create: () => makeBrokenBackend(s.store), _share: s }
}

const base = { backend: 'anchor-fake', refId: 'acme/demo', name: 'demo', url: '' }
const ctx = { cwd: '/ws/fake' }
const share = { id: 'anchor-fake', store: { tickets: [] } }

// 第一次提交（一个实例）
const reg1 = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
const d1 = reg1.register(makeBrokenFake('anchor-fake', share))
const r1 = await reg1.get('anchor-fake').create(base, { title: '第一张', idempotencyKey: 'KEY-A' }, ctx)
d1.dispose()

// 第二次提交：全部进程内状态都是新的（新注册表、新实例）
const reg2 = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
const d2 = reg2.register(makeBrokenFake('anchor-fake', share))
const r2 = await reg2.get('anchor-fake').create(base, { title: '第一张', idempotencyKey: 'KEY-A' }, ctx)
d2.dispose()

const sameKey = r1.ok && r2.ok && r1.data.key === r2.data.key
const oneTicket = share.store.tickets.length === 1

console.log('idempotency-counterproof：把「按锚回查」做坏（只在实例内存里查）之后：')
console.log('  第一次 key = ' + (r1.data && r1.data.key) + '，第二次 key = ' + (r2.data && r2.data.key))
console.log('  返回同一个 key ？' + (sameKey ? '是' : '否'))
console.log('  只多出一张票 ？' + (oneTicket ? '是' : '否') + '（票数 ' + share.store.tickets.length + '）')
console.log('')
console.log('  断言「同一个锚提交两次：总共只建出一张票」' + (oneTicket ? ' 通过' : ' 失败 ✗'))
console.log('  断言「同一个锚提交两次：返回的是同一个 key」' + (sameKey ? ' 通过' : ' 失败 ✗'))
console.log('')
if (sameKey && oneTicket) {
  console.log('结论：坏实现也让判据全绿 —— 这一段判据是假的，必须重写。')
  process.exit(1)
}
console.log('结论：判据逮住了这个坏实现（上面两条断言变红），这一段判据有效。')
process.exit(0)
