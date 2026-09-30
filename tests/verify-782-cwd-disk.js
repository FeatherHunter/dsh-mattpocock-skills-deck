#!/usr/bin/env node
// tests/verify-782-cwd-disk.js —— #782 门禁：落盘补问按号只读一条，不列全量。
//
// 为什么有这条门禁：#730 在宿主电话里加了一步「内存答不出就去落盘问目录」，实现经
//   会话查询服务的按号过滤，而那条查询内部先列一遍全部落盘会话头（真机 4187 个）；
//   客户端在会话没有目录时要等这条电话回来才加载面板数据，于是这一步成了面板打开的
//   秒级等待（重启后 47 次成功里 12 次超 1 秒、9 次超 5 秒、最大 39.9 秒）。
//   本门禁只锁三件事：① 按号直读（持久化服务的按号打开，一次定位加读一个文件）；
//   ② 有服务在时不许再列全量（给了过滤服务也不许调它）；③ 这一步的日志点与缓存单飞。
//   反证：把直读改回过滤、本文件必须变红（A4、H 组）；把缓存或单飞拆掉，本文件必须变红
//   （D、E 组）；把日志点拆掉，本文件必须变红（F 组与计数门禁）。
//
// 用法：node tests/verify-782-cwd-disk.js（插件根目录，可独立运行）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const ok = (cond, msg) => { total += 1; if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '')

async function main() {
  console.log('== #782 落盘补问按号直读门禁 ==')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'sessionLifecycle.js')).href)

  // 造一部宿主：内存里没有这个会话；持久化服务与查询服务按需挂上；日志收进数组。
  const makeHost = (opts) => {
    const o = opts || {}
    const logs = []
    const opens = []
    const filters = []
    let closed = 0
    const persistence = o.noPersistence ? undefined : {
      open: async (id, access) => {
        opens.push({ id: id, access: access })
        if (o.openThrow) throw o.openThrow
        if (o.openMissing) return { header: { id: id }, close: async () => { closed += 1 } }
        if (o.openNoCwd) return { header: { id: id }, close: async () => { closed += 1 } }
        if (o.openNoClose) return { header: { id: id, cwd: 'D:\\ilife' } }
        return { header: { id: id, cwd: o.cwd === undefined ? 'D:\\ilife' : o.cwd }, close: async () => { closed += 1 } }
      },
    }
    const querySvc = o.noQuery ? undefined : {
      filterSessions: async (f) => { filters.push(f); return o.queryRecords === undefined ? [] : o.queryRecords },
    }
    const life = mod.createSessionLifecycle({
      ctx: {
        get: (k) => {
          if (k === 'sessions') return { get: () => (o.live === undefined ? null : o.live) }
          if (k === 'sessionPersistence') return persistence
          if (k === 'sessionQuery') return querySvc
          return undefined
        },
      },
      DEFAULT_CWD: 'D:\\',
      errText: (e) => String((e && e.message) || e),
      getDetectionService: async () => null,
      getTrackerRegistry: async () => null,
      getPlatform: async () => null,
      canonicalKey: async (raw) => raw,
      logCtx: { fire: (level, event, fields) => { logs.push({ level: level, event: event, fields: fields }) } },
    })
    return { life: life, logs: logs, opens: opens, filters: filters, closed: () => closed }
  }
  const diskLogs = (logs) => logs.filter((l) => l.event === 'cwd.persisted')

  // A 组：按号直读命中。
  {
    const h = makeHost({})
    const r = await h.life.handleCwd({ sessionId: 's-ghost' })
    ok(r && r.ok === true && r.cwd === 'D:\\ilife', 'A1 按号直读命中：答得出目录（实得 ' + JSON.stringify(r && r.cwd) + '）')
    ok(h.opens.length === 1 && h.opens[0].id === 's-ghost' && h.opens[0].access === 'read', 'A2 按号打开：问的正是客户端报上来的那个号，只读不写')
    ok(h.filters.length === 0, 'A3 有直读服务时不列全量：一次也不调按号过滤（实调 ' + h.filters.length + ' 次）')
    ok(h.closed() === 1, 'A4 读完关句柄（不泄漏，共关 ' + h.closed() + ' 次）')
    const dl = diskLogs(h.logs)
    ok(dl.length === 1 && dl[0].level === 'info' && dl[0].fields.hit === true && dl[0].fields.via === 'persist-open' && dl[0].fields.outcome === 'hit' && typeof dl[0].fields.latencyMs === 'number', 'A5 日志点：问一次盘记一行常驻信息（hit/via/outcome/latencyMs 四键，无路径原文）')
    ok(Object.keys(dl[0].fields).sort().join(',') === 'hit,latencyMs,outcome,via', 'A6 日志字段不多记（实得 ' + Object.keys(dl[0].fields).sort().join('、') + '）')
  }

  // B 组：未命中与异常如实失败（不造事实，不抛错）。
  {
    const notFound = new Error('session "s-x" not found'); notFound.name = 'SessionPersistenceNotFoundError'
    const h1 = makeHost({ openThrow: notFound })
    const r1 = await h1.life.handleCwd({ sessionId: 's-x' })
    ok(r1 && r1.ok === false && r1.kind === 'not-found', 'B1 盘上没有这个会话：照旧如实报找不到（不猜）')
    ok(diskLogs(h1.logs).length === 1 && diskLogs(h1.logs)[0].fields.outcome === 'not-found' && diskLogs(h1.logs)[0].fields.hit === false, 'B2 未命中也记一行（outcome:not-found，hit:false）')
    const h2 = makeHost({ openThrow: new Error('disk io fail') })
    const r2 = await h2.life.handleCwd({ sessionId: 's-x' })
    ok(r2 && r2.ok === false && r2.kind === 'not-found', 'B3 打开抛错：照旧如实报找不到（不把异常当答案）')
    ok(diskLogs(h2.logs).length === 1 && diskLogs(h2.logs)[0].fields.outcome === 'error', 'B4 异常记 error 档（与未找到分开，排查分得清）')
    const h3 = makeHost({ openNoCwd: true })
    const r3 = await h3.life.handleCwd({ sessionId: 's-x' })
    ok(r3 && r3.ok === false && r3.kind === 'not-found', 'B5 头里没有目录：照旧如实报找不到（不造事实）')
    const h4 = makeHost({ openNoClose: true })
    const r4 = await h4.life.handleCwd({ sessionId: 's-x' })
    ok(r4 && r4.ok === true && r4.cwd === 'D:\\ilife', 'B6 句柄没有关闭方法：照样答得出（关闭缺席不坏事）')
    // 句柄关闭时抛错：关闭失败不许影响答复（finally 里吞掉）。
    const throwingClose = mod.createSessionLifecycle({
      ctx: {
        get: (k) => {
          if (k === 'sessions') return { get: () => null }
          if (k === 'sessionPersistence') return { open: async (id) => ({ header: { id: id, cwd: 'D:\\ilife' }, close: async () => { throw new Error('close boom') } }) }
          return undefined
        },
      },
      DEFAULT_CWD: 'D:\\',
      errText: (e) => String((e && e.message) || e),
      getDetectionService: async () => null,
      getTrackerRegistry: async () => null,
      getPlatform: async () => null,
      canonicalKey: async (raw) => raw,
      logCtx: { fire: () => {} },
    })
    const r5 = await throwingClose.handleCwd({ sessionId: 's-x' })
    ok(r5 && r5.ok === true && r5.cwd === 'D:\\ilife', 'B7 关闭时抛错：照样答得出（关不掉不坏事）')
  }

  // C 组：老服务兼容（持久化服务缺席才回退旧路）。
  {
    const h = makeHost({ noPersistence: true, queryRecords: [{ header: { id: 's-old', cwd: 'D:\\legacy' } }] })
    const r = await h.life.handleCwd({ sessionId: 's-old' })
    ok(r && r.ok === true && r.cwd === 'D:\\legacy', 'C1 无直读服务时回退旧路：仍答得出（老 DSH 不回归）')
    ok(h.filters.length === 1 && diskLogs(h.logs)[0].fields.via === 'query-filter', 'C2 回退记 via:query-filter（日志里分得清走的哪条路）')
    const h2 = makeHost({ noPersistence: true, noQuery: true })
    const r2 = await h2.life.handleCwd({ sessionId: 's-x' })
    ok(r2 && r2.ok === false && r2.kind === 'not-found', 'C3 两服务都没有：照旧如实报找不到')
    ok(diskLogs(h2.logs)[0].fields.via === 'unavailable' && diskLogs(h2.logs)[0].fields.outcome === 'no-service', 'C4 双缺记 via:unavailable/outcome:no-service')
  }

  // D 组：缓存（命中常驻内存，同号第二次不读盘）。
  {
    const h = makeHost({})
    await h.life.handleCwd({ sessionId: 's-c' })
    await h.life.handleCwd({ sessionId: 's-c' })
    await h.life.handleCwd({ sessionId: 's-c' })
    ok(h.opens.length === 1, 'D1 同号连问三次只读一次盘（实读 ' + h.opens.length + ' 次）')
    const vias = diskLogs(h.logs).map((l) => l.fields.via)
    ok(vias.join(',') === 'persist-open,cache,cache', 'D2 第二次起记 via:cache（实得 ' + vias.join('、') + '）')
    const hBound = makeHost({})
    for (let i = 0; i < 2001; i += 1) await hBound.life.handleCwd({ sessionId: 's-b' + i })
    const before = hBound.opens.length
    await hBound.life.handleCwd({ sessionId: 's-b0' })
    ok(before === 2001 && hBound.opens.length === 2002, 'D3 缓存有界（2000 条 FIFO）：最早那条被淘汰后重读（实读 ' + hBound.opens.length + ' 次）')
  }

  // E 组：单飞（同号并发共用同一趟读取）。
  {
    const h = makeHost({})
    const rs = await Promise.all([
      h.life.handleCwd({ sessionId: 's-f' }),
      h.life.handleCwd({ sessionId: 's-f' }),
      h.life.handleCwd({ sessionId: 's-f' }),
      h.life.handleCwd({ sessionId: 's-f' }),
      h.life.handleCwd({ sessionId: 's-f' }),
    ])
    ok(rs.every((r) => r && r.ok === true && r.cwd === 'D:\\ilife'), 'E1 五路并发都答得出')
    ok(h.opens.length === 1, 'E2 五路并发只读一次盘（实读 ' + h.opens.length + ' 次，并发不再互相拖）')
  }

  // F 组：内存答得出时不记这一行（热路径零额外代价）。
  {
    const logs = []
    const life = mod.createSessionLifecycle({
      ctx: {
        get: (k) => {
          if (k === 'sessions') return { get: () => ({ header: { cwd: 'D:\\memory' } }) }
          return undefined
        },
      },
      DEFAULT_CWD: 'D:\\',
      errText: (e) => String((e && e.message) || e),
      getDetectionService: async () => null,
      getTrackerRegistry: async () => null,
      getPlatform: async () => null,
      canonicalKey: async (raw) => raw,
      logCtx: { fire: (l, e, f) => { logs.push({ l: l, e: e }) } },
    })
    const r = await life.handleCwd({ sessionId: 's-live' })
    ok(r && r.ok === true && r.cwd === 'D:\\memory', 'F1 内存答得出：照旧走内存')
    ok(logs.filter((l) => l.e === 'cwd.persisted').length === 0, 'F2 内存命中不记落盘行（热路径不付这笔钱）')
  }

  // G 组：结构锚点（取法不分叉，直读不断）。
  {
    const src = stripComments(read(path.join('src', 'host', 'sessionLifecycle.js')))
    ok(src.indexOf("ctx.get('sessionPersistence')") >= 0, 'G1 落盘那一问首选持久化服务（按号打开）')
    ok(/\.open\(\s*\w+\s*,\s*['"]read['"]/.test(src), 'G2 打开方式是只读（不拿写所有权，不激活会话）')
    ok(/resolveSessionCwd\(\s*\{\s*header\s*:/.test(src), 'G3 句柄的头仍走共用取法（不另写一套读法）')
    ok(/resolveSessionCwd\(rec\)/.test(src), 'G4 旧路回退仍走共用取法（两条路同一个字段）')
    ok(src.indexOf('diskCache') >= 0 && src.indexOf('diskInflight') >= 0, 'G5 缓存与单飞结构在（拆掉 D/E 组变红）')
    ok(src.indexOf("'cwd.persisted'") >= 0, 'G6 日志点结构在（拆掉 F 组与计数门禁变红）')
    ok(src.indexOf('filterSessions') >= 0, 'G7 旧路回退留守（老 DSH 不断链）')
  }

  // H 组：性能结构（有直读服务时，给了过滤服务也不许用它列全量）。
  {
    const h = makeHost({ queryRecords: [{ header: { id: 's-ghost', cwd: 'D:\\slow' } }] })
    const r = await h.life.handleCwd({ sessionId: 's-ghost' })
    ok(r && r.ok === true && r.cwd === 'D:\\ilife', 'H1 直读优先：过滤服务里有旧值也不用它（实得 ' + JSON.stringify(r && r.cwd) + '）')
    ok(h.filters.length === 0, 'H2 全量列举零调用（这就是省掉的那 4187 个头）')
  }

  console.log(failed ? '\n存在失败 — verify-782-cwd-disk 未通过' : '\n全部通过 — ' + total + ' 项断言（落盘补问按号直读）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(2) })
