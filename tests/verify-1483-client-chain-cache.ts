// tests/verify-1483-client-chain-cache.ts —— #1483：客户端读到别的会话写下的链快照时，先秒显再补问一次
//
// 背景：客户端链快照按「工作区 + 后端 + 语言」共享（#324/#653：子目录会话要秒显根会话的链）。
//   缓存条目现在记着「这份是哪个会话求出来的」。同一个会话照旧命中即返回、不联网；
//   不同会话（含旧版本没记会话号的条目）先把旧快照显示出来，再向宿主补问一次（不带 force），
//   宿主命中缓存时会按本会话重算依赖沙箱许可的那几行。补问回来的快照就地更新会话与缓存条目。
//
// 本文件的判据：
//   A 同会话命中 → 不发请求
//   B 跨会话命中 → 先返回旧快照；随后补问一次，请求带当前会话号、不带 force；回来后会话状态与缓存条目都换成新快照
//   C 旧条目没有会话号 → 也补问一次（不知道是谁量的，按可能不同处理）
//   D 同一会话同一把键只补问一次（面板轮询不反复触发）
//   E 没有缓存时正常发请求：带会话号，落缓存时记下产出会话号
//   G 交替会话：共享条目被另一个会话回写后，本会话再命中要按新产出者再补问一次（守卫不能只认本会话）
//   H 补问绕开在途搭车：同键上已经挂着别的会话的一趟请求时，补问仍要自己发一次（否则写进别人的会话状态）
//   I 拿不到会话号的调用方不补问：只秒显共享快照、不发请求（#669「打开检查页不联网」的契约靠这里保住）
//
// 运行：node tests/verify-1483-client-chain-cache.ts
// 门禁归属: src/refresh/rooms/client/probe-chain-subscription.ts, src/refresh/rooms/client/snapshot-cache-store.ts
import fs from 'node:fs'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

type AnyObj = { [key: string]: any }
let failed = false
const ok = (cond: boolean, msg: string, detail?: unknown): void => {
  if (cond) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail === undefined ? '' : ' — ' + String(detail).slice(0, 400))) }
}

const readSource = (rel: string): string => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
// 这个客户端文件是「拼进浏览器闭包」的片段：没有自己的 import/export，跨文件名字靠 declare。
// 去掉行首 export、剥掉类型后，用沙箱把闭包里的名字补上，就与浏览器里那份拼接结果同形。
const asSnippet = (source: string): string => stripTypeScriptTypes(source.replace(/^export /gm, ''), { mode: 'strip' })
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function makeWorld(): AnyObj {
  const entries = new Map<string, AnyObj>()
  const requests: AnyObj[] = []
  const setCalls: AnyObj[] = []
  const keyOf = (ws: string, bid: string, lang: string): string => String(ws) + '|' + String(bid) + '|' + String(lang)
  const replyFor = (tag: string): AnyObj => ({
    ok: true,
    backendId: 'markdown',
    chain: [],
    resolved: {},
    snapshot: null,
    backendChain: null,
    fullChain: [],
    fullSnapshot: { steps: [{ id: 'md:scratchWritable', status: 'done', show: null }], currentIndex: null, doneCount: 1, applicableCount: 1, totalCount: 1, chainState: 'allDone', version: '1' },
    chainSource: 'background',
    tag: tag,
  })
  // H 用：挂住 host.call，让同一个键上先有一趟请求在飞。
  const hang: AnyObj = { promise: null }
  const sandbox: AnyObj = {
    promptLang: () => 'zh',
    wsKeyOf: (cwd: string) => String(cwd || ''),
    getChainCacheKey: keyOf,
    isEnabled: () => false,
    log: () => undefined,
    dswsLogHash: (s: unknown) => String(s || ''),
    dswsLogTrunc: (s: unknown) => String(s || ''),
    userHintOf: (selection: AnyObj) => (selection && selection.backendId) || undefined,
    nowStr: () => '00:00:00',
    emit: () => undefined,
    host: {
      call: (method: string, args: AnyObj) => {
        requests.push({ method: method, args: args })
        if (hang.promise) return hang.promise
        return Promise.resolve(replyFor('fresh-' + requests.length))
      },
    },
    getCachedChain: (ws: string, bid: string, lang: string) => {
      const e = entries.get(keyOf(ws, bid, lang))
      return e ? e.snapshot : null
    },
    getCachedChainEntry: (ws: string, bid: string, lang: string) => entries.get(keyOf(ws, bid, lang)) || null,
    setCachedChain: (ws: string, bid: string, lang: string, snap: AnyObj, sessionId?: string) => {
      const ent: AnyObj = { snapshot: snap, ts: 1 }
      if (sessionId !== undefined && sessionId !== null) ent.sessionId = String(sessionId)
      entries.set(keyOf(ws, bid, lang), ent)
      setCalls.push({ ws: ws, bid: bid, lang: lang, snap: snap, sessionId: sessionId })
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(asSnippet(readSource('src/refresh/rooms/client/probe-chain-subscription.ts')) + '\nglobalThis.loadChain = loadChain;', sandbox)
  return { entries, requests, setCalls, keyOf, loadChain: (sandbox as AnyObj).loadChain, replyFor, hang }
}

async function main(): Promise<void> {
  const oldSnap = (tag: string): AnyObj => ({ steps: [{ id: 'md:scratchWritable', status: 'done', tag: tag }] })
  const mkState = (sessionId: string): AnyObj => ({ cwd: '/ws', sessionId: sessionId, selection: { backendId: 'markdown' } })

  // A. 同会话命中不发请求
  {
    const w = makeWorld()
    w.entries.set(w.keyOf('/ws', 'markdown', 'zh'), { snapshot: oldSnap('old'), ts: 1, sessionId: 's1' })
    const st = mkState('s1')
    const got = await w.loadChain(st, false, 'enter-workspace')
    await flush()
    ok(w.requests.length === 0, 'A 同会话命中不发请求', w.requests.length)
    ok(got === w.entries.get(w.keyOf('/ws', 'markdown', 'zh')).snapshot, 'A 同会话命中直接返回缓存快照')
    ok(st.chainSnapshot === got, 'A 会话状态拿到缓存快照')
  }

  // B. 跨会话：先秒显旧快照，再补问一次（带当前会话号、不带 force），回来后替换
  {
    const w = makeWorld()
    w.entries.set(w.keyOf('/ws', 'markdown', 'zh'), { snapshot: oldSnap('old'), ts: 1, sessionId: 's1' })
    const st = mkState('s2')
    const before = w.entries.get(w.keyOf('/ws', 'markdown', 'zh'))
    const got = await w.loadChain(st, false, 'enter-workspace')
    ok(got === before.snapshot, 'B 跨会话命中返回旧快照（先秒显）')
    await flush()
    ok(w.requests.length === 1, 'B 随后补问了一次宿主', w.requests.length)
    const req = w.requests[0] || { args: {} }
    ok(req.args.sessionId === 's2', 'B 补问请求带当前会话号', req.args.sessionId)
    ok(req.args.force === undefined, 'B 补问不 force（让宿主自己按退避裁定）', req.args.force)
    ok(st.chainSnapshot !== got, 'B 补问回来后会话状态换成新快照')
    ok(w.entries.get(w.keyOf('/ws', 'markdown', 'zh')).sessionId === 's2', 'B 缓存条目记下当前会话号', w.entries.get(w.keyOf('/ws', 'markdown', 'zh')).sessionId)
    // D. 同一会话同一把键不再重复补问
    await w.loadChain(st, false, 'enter-workspace')
    await flush()
    ok(w.requests.length === 1, 'D 同一会话同一把键只补问一次', w.requests.length)
  }

  // G. 交替会话：条目被 s2 回写后，s1 再命中也必须补问（守卫按产出者记，不只看本会话）
  {
    const w = makeWorld()
    w.entries.set(w.keyOf('/ws', 'markdown', 'zh'), { snapshot: oldSnap('old'), ts: 1, sessionId: 's1' })
    const st1 = mkState('s1')
    const st2 = mkState('s2')
    await w.loadChain(st1, false, 'enter-workspace')
    await w.loadChain(st2, false, 'enter-workspace')
    await flush()
    ok(w.requests.length === 1, 'G s2 跨会话命中后补问一次', w.requests.length)
    ok(w.entries.get(w.keyOf('/ws', 'markdown', 'zh')).sessionId === 's2', 'G 共享条目的产出者变成 s2')
    // s1 再命中：这次条目产出者是 s2，虽然 s1 之前补问过（守卫键里的产出者变了），必须再补问一次
    await w.loadChain(st1, false, 'enter-workspace')
    await flush()
    ok(w.requests.length === 2, 'G 产出者换人后 s1 再补问一次（不会永久停在别人的判定上）', w.requests.length)
    ok(w.requests[1].args.sessionId === 's1', 'G 第二次补问带的是 s1', w.requests[1].args.sessionId)
    ok(w.entries.get(w.keyOf('/ws', 'markdown', 'zh')).sessionId === 's1', 'G 共享条目产出者回到 s1')
  }

  // H. 补问绕开在途搭车：同键上挂着别人那趟请求时，补问仍要自己发一次
  {
    const w = makeWorld()
    w.entries.set(w.keyOf('/ws', 'markdown', 'zh'), { snapshot: oldSnap('old'), ts: 1, sessionId: 's1' })
    w.hang.promise = new Promise((resolve) => { w.hang.release = resolve })
    const st1 = mkState('s1')
    const st2 = mkState('s2')
    // 先让 s2 跨会话命中（不 await：命中那一步是同步完成的，补问已经排进微任务）
    const p2 = w.loadChain(st2, false, 'enter-workspace')
    // 紧接着把缓存条目删掉，并让 s1 发一趟没有缓存可走的请求 —— 同键上从此挂着一趟在飞的请求
    w.entries.delete(w.keyOf('/ws', 'markdown', 'zh'))
    const p1 = w.loadChain(st1, false, 'enter-workspace')
    await flush()
    ok(w.requests.length === 2, 'H 补问没有被在途请求吞掉（自己又发了一次）', w.requests.length)
    ok(w.requests[1] && w.requests[1].args.sessionId === 's2', 'H 补问请求带的是 s2 的会话号', w.requests[1] && w.requests[1].args.sessionId)
    w.hang.release(w.replyFor('fresh-h'))
    await Promise.all([p1, p2, flush()])
  }

  // C. 旧条目没有会话号：也要补问一次
  {
    const w = makeWorld()
    w.entries.set(w.keyOf('/ws', 'markdown', 'zh'), { snapshot: oldSnap('legacy'), ts: 1 })
    const st = mkState('s3')
    await w.loadChain(st, false, 'enter-workspace')
    await flush()
    ok(w.requests.length === 1, 'C 旧条目（没有会话号）也补问一次', w.requests.length)
    ok(st.chainSnapshot === w.entries.get(w.keyOf('/ws', 'markdown', 'zh')).snapshot, 'C 补问后会话状态与缓存条目都换成新快照')
  }

  // E. 没有缓存：正常请求，带会话号；落缓存时记下产出会话号
  {
    const w = makeWorld()
    const st = mkState('s4')
    await w.loadChain(st, false, 'enter-workspace')
    ok(w.requests.length === 1, 'E 没有缓存时正常发一次请求', w.requests.length)
    ok(w.requests[0].args.sessionId === 's4', 'E 请求带当前会话号', w.requests[0].args.sessionId)
    const lastSet = w.setCalls[w.setCalls.length - 1] || {}
    ok(lastSet.sessionId === 's4', 'E 落缓存时记下产出会话号', lastSet.sessionId)
    ok(st.chainSnapshot && st.chainSnapshot.fullSnapshot === undefined, 'E 会话状态装的是 fullSnapshot 那一份')
  }

  // I. 调用方没有会话号：只秒显共享快照，不补问（否则 #669「打开检查页不联网」当场破）
  {
    const w = makeWorld()
    w.entries.set(w.keyOf('/ws', 'markdown', 'zh'), { snapshot: oldSnap('shared'), ts: 1, sessionId: 's1' })
    const st: AnyObj = { cwd: '/ws', selection: { backendId: 'markdown' } }
    const got = await w.loadChain(st, false, 'enter-workspace')
    await flush()
    ok(w.requests.length === 0, 'I 没有会话号时命中缓存不发请求', w.requests.length)
    ok(got === w.entries.get(w.keyOf('/ws', 'markdown', 'zh')).snapshot && st.chainSnapshot === got, 'I 没有会话号时照旧秒显共享快照')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
