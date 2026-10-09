#!/usr/bin/env node
/**
 * verify-964-same-key-ride.js —— 同钥匙搭车门禁（票 #964，只做这一张票）。
 *
 * 治的是什么：同一个工作区用同一个后端看同一种语言时，旧的那一轮还没回来，
 * 新来的那一次不另起一轮，只等旧的那一轮。写过东西之后不搭旧车，旧的那一轮
 * 失败了不搭，旧的那一轮跑了超过三十秒也不搭。短窗里连点几次只算一次合并，
 * 被合并掉的那几次只记合并数，不算失败，也不让退避往后退。钥匙不一样的各跑各的。
 *
 * 钥匙就是三样东西拼起来：工作区键加后端加语言。修订号不一样也算不同车，
 * 免得把旧修订的结果发给新修订。
 *
 * 测法：真跑检查链的入口 handleChain，假后端让每一轮睡一会儿以便并发相遇，
 * 数一共求值了几次、退避记了几次、合并数涨了没有。只看外部行为这三样，
 * 不看里面那张在途表长什么样。
 *
 * 用法：node tests/verify-964-same-key-ride.js
 */
const nodePath = require('path')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total++
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

const OS = process.platform === 'win32' ? 'win32' : (process.platform === 'darwin' ? 'darwin' : 'linux')
const PLATFORM = { os: OS, path: nodePath, async getHome() { return require('os').homedir() } }

function makeChainTable() {
  const m = new Map()
  function touch(k, v) { if (m.has(k)) m.delete(k); m.set(k, v); if (m.size > 20) m.delete(m.keys().next().value) }
  return {
    map: m,
    getChainCache(key) { if (!key) return { ts: 0, key: null, value: null }; const k = String(key); const e = m.get(k); if (e) { m.delete(k); m.set(k, e); return e } return { ts: 0, key: k, value: null } },
    setChainCache(v) { if (!v || !v.key) { m.clear(); return } touch(String(v.key), { ts: v.ts, key: String(v.key), value: v.value }) },
  }
}

// 建一条真链，假后端每一轮睡一会儿，数求值几次与退避记几次。
// opts: { detectMs 睡多久, nowMs 现在几点（可注入的钟）, failFirst 第一轮要不要失败 }
async function makeChain(opts) {
  const o = opts || {}
  const table = makeChainTable()
  let detects = 0
  let backoffNotes = 0
  const fires = []
  const { createDetectChain } = await import(url('src/host/detectChain.js'))
  const failFirst = !!o.failFirst
  let evals = 0
  const dh = createDetectChain({
    canonicalKey: async (raw) => String(raw || ''),
    DEFAULT_CWD: 'D:/repo',
    resetGhCache: () => {},
    getDetectionService: async () => ({
      detect: async () => {
        await new Promise((r) => setTimeout(r, o.detectMs || 80))
        return { selection: { backendId: 'github', source: 'auto' } }
      },
    }),
    getPlatform: async () => { evals++; detects = evals; if (failFirst && evals === 1) throw new Error('假失败第一轮'); return PLATFORM },
    getTrackerRegistry: async () => ({ modules: () => [] }),
    getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
    runGh: async () => ({ ok: false, kind: 'network', error: 'net' }),
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
    probeSkill: async () => ({ ok: false, level: 'bad', detail: 'x', hint: '', repo: null }),
    mdParseOkPredicate: async () => ({ status: 'pending', detail: 'x' }),
    getChainCache: table.getChainCache,
    setChainCache: table.setChainCache,
    getChainBackoff: async () => ({
      verdict: async () => ({ needed: true, reason: 'test-always-due', waitMs: 0, cached: null }),
      note: async () => { backoffNotes++; return { step: 0, allGreen: false, progressed: false } },
    }),
    logCtx: {
      fire: (level, event, fields) => { try { fires.push({ level, event, fields: (typeof fields === 'function') ? fields() : fields }) } catch (e) {} },
      isEnabled: () => false,
    },
    now: o.nowMs,
  })
  return { dh, table, fires, stats: () => ({ detects, backoffNotes }) }
}

async function main() {
  title('一）连点两次只起一轮，第二轮不新起进程')
  {
    const { dh, stats } = await makeChain({ detectMs: 120 })
    const [r1, r2] = await Promise.all([
      dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' }),
      dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' }),
    ])
    must(stats().detects === 1, '同钥匙并发两路只求值一次', 'detects=' + stats().detects)
    must(r1 === r2, '同钥匙并发两路拿到同一份回包', 'same=' + (r1 === r2))
  }

  title('二）写过东西之后不搭旧车')
  {
    const { dh, stats } = await makeChain({ detectMs: 150 })
    if (typeof dh.markChainWrite !== 'function') {
      must(false, '链上有地方能记一次写（写后不搭的挂钩在）', 'markChainWrite missing')
    } else {
      const p1 = dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' })
      await new Promise((r) => setTimeout(r, 20))
      dh.markChainWrite()
      const r2 = await dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' })
      const r1 = await p1
      must(stats().detects === 2, '写之后来的那一次另起一轮（不搭写之前的旧车）', 'detects=' + stats().detects)
      must(r1 !== r2, '写前后的回包不是同一份', 'same=' + (r1 === r2))
    }
  }

  title('三）失败不搭，下一轮重新求值')
  {
    const { dh, stats } = await makeChain({ detectMs: 20, failFirst: true })
    const bad = await dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' })
    must(bad && bad.ok === false, '第一轮假失败如实回失败', 'ok=' + (bad && bad.ok))
    const good = await dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' })
    must(stats().detects === 2, '失败之后下一次另起一轮（不拿旧失败当结果）', 'detects=' + stats().detects)
    must(good && good.ok === true, '第二轮成功回包是成功的', 'ok=' + (good && good.ok))
  }

  title('四）超三十秒不搭旧车')
  {
    let nowMs = Date.now()
    const { dh, stats } = await makeChain({ detectMs: 150, nowMs: () => nowMs })
    if (typeof dh.rideStats !== 'function' && typeof dh.stats !== 'function') {
      must(false, '链上有地方能读合并数（被合并的只计数）', 'rideStats missing')
    }
    const p1 = dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' })
    await new Promise((r) => setTimeout(r, 20))
    nowMs += 31000
    const p2 = dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' })
    await Promise.all([p1, p2])
    must(stats().detects === 2, '旧车跑了超过三十秒，新来的另起一轮', 'detects=' + stats().detects)
  }

  title('五）被合并的记合并数，不触发退避')
  {
    const { dh, stats } = await makeChain({ detectMs: 120 })
    const hasStats = dh && (typeof dh.rideStats === 'function' || typeof dh.stats === 'function')
    must(hasStats, '链上有地方能读合并数（被合并的只计数）', 'rideStats/stats missing')
    if (hasStats) {
      const readMerged = () => {
        try {
          const s = typeof dh.rideStats === 'function' ? dh.rideStats() : dh.stats()
          return Number(s.merged ?? s.coalesced ?? s.rides ?? 0) || 0
        } catch (e) { return 0 }
      }
      const before = readMerged()
      await Promise.all([
        dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' }),
        dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' }),
      ])
      const after = readMerged()
      must(after === before + 1, '连点一次合并数涨一', 'before=' + before + ' after=' + after)
      must(stats().backoffNotes === 1, '合并的两路只让退避记一次（被合并的不算失败）', 'notes=' + stats().backoffNotes)
    }
  }

  title('六）不同钥匙各跑各的')
  {
    const { dh, stats } = await makeChain({ detectMs: 120 })
    const [a, b] = await Promise.all([
      dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' }),
      dh.handleChain({ cwd: 'D:/other', backendId: 'github', lang: 'zh' }),
    ])
    must(stats().detects === 2, '工作区不一样的两路各求值一次', 'detects=' + stats().detects)
    must(a !== b, '不同钥匙的回包不是同一份', 'same=' + (a === b))
    const [c, d] = await Promise.all([
      dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'zh' }),
      dh.handleChain({ cwd: 'D:/repo', backendId: 'github', lang: 'en' }),
    ])
    must(c !== d, '语言不一样的两路各求值一次（回包不是同一份）', 'same=' + (c === d))
  }

  title('七）日志纪律：只复用已有事件名，不新增')
  {
    const src = require('fs').readFileSync(nodePath.join(ROOT, 'src/host/detectChain.js'), 'utf8')
    must(src.indexOf('dedup.hit') >= 0, '在途命中复用已有事件 dedup.hit', 'dedup.hit missing')
    const hits = Array.from(src.matchAll(/fire\s*\(\s*['"](?:info|debug|warn|error)['"]\s*,\s*['"]([^'"]+)['"]/g)).map((m) => m[1])
    const fresh = hits.filter((e) => /ride|merge|coalesc/i.test(e))
    must(fresh.length === 0, '未新增日志事件名（附录第 1 章条数不动）', '新增=' + fresh.join(','))
  }

  console.log('\n共 ' + total + ' 项，' + (broken.length ? ('破 ' + broken.length + ' 项') : '全绿'))
  if (broken.length) process.exit(1)
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.stack) || e)); process.exit(1) })
