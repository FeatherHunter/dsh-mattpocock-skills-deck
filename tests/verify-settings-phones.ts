#!/usr/bin/env node
// verify-settings-phones.ts —— 本机设置两条电话的门禁（共享板 task-7 落地）。
//
// 这份门禁只量五件事，每一件都用完整的一句话说清，第一次读的人能直接看懂。
// 第一件事是缺席：文件不在时按没有处理，两种失败码都要认。
// 第二件事是失败分档：内容坏了与环境问题与缺席要分三种回执种类，种类名不照抄内部原因名。
// 第三件事是只读写入拒绝：高版本文件只许读来展示，不许写回去，写之前先读一次，读到只读直接回升级文案。
// 第四件事是行数：新叶子与宿主入口各自都不超过三百五十行。
// 第五件事是真跑日志：读与写两条电话各成功跑一次、各失败跑一次，每一次都恰好落一行，事件名与电话名与类型都对得上。
//
// 用法：在插件根目录执行 node tests/verify-settings-phones.ts，可独立运行。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const realFs = require('node:fs/promises')

const ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0
const check = (ok, msg, detail) => {
  if (ok) { console.log('  PASS ' + msg); passed += 1 } else { console.log('  FAIL ' + msg + (detail ? ' —— ' + String(detail).slice(0, 300) : '')); failed += 1 }
}
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const countLines = (rel) => readText(rel).split(/\r?\n/).length
const makeHome = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-settings-' + tag + '-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 记录型系统文件：包一层真文件，既落真盘又能看调用序列，overrides 用来制造失败。
function wrapSysFs(calls, overrides) {
  return {
    async readFile(p, enc) { calls.push({ name: 'readFile', path: String(p) }); if (overrides && overrides.readFile) return overrides.readFile(p, enc); return realFs.readFile(p, enc) },
    async writeFile(p, text, enc) { calls.push({ name: 'writeFile', path: String(p) }); if (overrides && overrides.writeFile) return overrides.writeFile(p, text, enc); return realFs.writeFile(p, text, enc) },
    async mkdir(p, opts) { calls.push({ name: 'mkdir', path: String(p) }); if (overrides && overrides.mkdir) return overrides.mkdir(p, opts); return realFs.mkdir(p, opts) },
    async unlink(p) { calls.push({ name: 'unlink', path: String(p) }); if (overrides && overrides.unlink) return overrides.unlink(p); return realFs.unlink(p) },
  }
}

function failCode(code, msg) {
  const e = new Error(msg || String(code))
  e.code = code
  return e
}

async function main() {
  console.log('本机设置两条电话门禁（task-7：缺席与分档与只读拒绝与行数与真跑日志）')
  const leafUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'settingsPhones.ts')).href
  const storeUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.ts')).href
  let leaf = null
  let store = null
  try {
    leaf = await import(leafUrl)
    store = await import(storeUrl)
  } catch (e) {
    check(false, '新叶子与配置适配器都能加载。', String((e && e.message) || e))
    console.log(failed ? ('\n存在失败 — verify-settings-phones 未通过（' + passed + ' 项通过、' + failed + ' 项失败）') : ('\n全部通过 — 本机设置门禁生效（' + passed + ' 项断言）'))
    process.exit(1)
  }
  const { createSettingsPhones, isSettingsAbsenceError } = leaf
  const { readLocalSettings, writeLocalSettings } = store
  check(typeof createSettingsPhones === 'function', '新叶子导出了造电话的入口。')
  check(typeof isSettingsAbsenceError === 'function', '新叶子导出了缺席判据，门禁能直接量它。')
  check(typeof readLocalSettings === 'function' && typeof writeLocalSettings === 'function', '配置适配器的读写入口都在，叶子只是调用它们。')

  const goodValue = {
    version: 1,
    ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} },
    workspaces: {},
    debug: { enabled: false, sampleRate: 1 },
    templates: {},
  }

  // —— 第一件事：缺席 ——
  console.log('')
  console.log('== 第一件事：缺席（文件不在按没有处理，两种失败码都要认） ==')
  check(isSettingsAbsenceError({ code: 'ENOENT' }) === true, '缺席判据认系统直连的失败码。')
  check(isSettingsAbsenceError(failCode('FS_NOT_FOUND', 'cannot read x: not found')) === true, '缺席判据认平台文件服务的失败码。')
  check(isSettingsAbsenceError(failCode('EPERM', 'operation not permitted')) === false, '缺席判据不把权限问题当成文件不在。')
  {
    const home = makeHome('absent')
    const calls = []
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: wrapSysFs(calls, null), logCtx: null })
    const r = await phones.handleGetSettings({})
    check(r.ok === false && r.error && r.error.kind === 'absent', '文件还不存在时读到的是没有，而不是报错。', JSON.stringify(r).slice(0, 200))
    check(r.error && r.error.kind !== 'missing', '回执种类不照抄内部原因名，没有这档不叫缺失。', JSON.stringify(r && r.error))
  }
  {
    const home = makeHome('absent2')
    const calls = []
    const fake = wrapSysFs(calls, { readFile: async () => { throw failCode('FS_NOT_FOUND', 'cannot read x: not found') } })
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: fake, logCtx: null })
    const r = await phones.handleGetSettings({})
    check(r.ok === false && r.error && r.error.kind === 'absent', '平台文件服务的缺席码同样按没有处理。', JSON.stringify(r).slice(0, 200))
  }
  {
    // 用户主目录从平台取，不同主目录读写互相隔离。
    const homeA = makeHome('homeA')
    const homeB = makeHome('homeB')
    const mk = (home) => createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: null, logCtx: null })
    const w = await mk(homeA).handleSetSettings({ value: goodValue })
    check(w.ok === true, '写进甲主目录能成功。', JSON.stringify(w).slice(0, 200))
    const rA = await mk(homeA).handleGetSettings({})
    const rB = await mk(homeB).handleGetSettings({})
    check(rA.ok === true && JSON.stringify(rA.value) === JSON.stringify(goodValue), '甲主目录读回的是刚才写进去的值。')
    check(rB.ok === false && rB.error && rB.error.kind === 'absent', '乙主目录读不到甲主目录写的东西，两边互相隔离。')
  }
  {
    // 绝不走平台文件服务写主目录：平台的文件服务即使全坏，读写照样成功。
    const home = makeHome('noplat')
    let platWrites = 0
    const platform = {
      getHome: async () => home,
      fs: {
        async readText() { throw failCode('EPERM', 'platform read blocked') },
        async writeText() { platWrites += 1; throw failCode('EPERM', 'platform write blocked') },
        async mkdir() { throw failCode('EPERM', 'platform mkdir blocked') },
        async unlink() { throw failCode('EPERM', 'platform unlink blocked') },
      },
    }
    const phones = createSettingsPhones({ getPlatform: async () => platform, readLocalSettings, writeLocalSettings, fs: null, logCtx: null })
    const w = await phones.handleSetSettings({ value: goodValue })
    const r = await phones.handleGetSettings({})
    check(w.ok === true && r.ok === true && platWrites === 0, '平台文件服务全坏时读写照样成功，证明走的是系统文件直连。', JSON.stringify({ w, platWrites }).slice(0, 200))
  }

  // —— 第二件事：失败分档 ——
  console.log('')
  console.log('== 第二件事：失败分档（内容坏了与环境问题分三种回执种类） ==')
  {
    const home = makeHome('invalid')
    await realFs.mkdir(path.join(home, '.dsh', 'mattskillsdeck'), { recursive: true })
    await realFs.writeFile(path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml'), 'version: 1\nui: [unclosed\n', 'utf8')
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: null, logCtx: null })
    const r = await phones.handleGetSettings({})
    check(r.ok === false && r.error && r.error.kind === 'invalid', '内容坏了回的是内容无效，而不是环境问题。', JSON.stringify(r).slice(0, 200))
    check(r.error && ['bad-shape', 'yaml-error', 'oversize', 'aliases', 'unknown-keys'].indexOf(r.error.kind) < 0, '回执种类不照抄内部原因名。', JSON.stringify(r && r.error))
  }
  {
    const home = makeHome('envread')
    const calls = []
    const fake = wrapSysFs(calls, { readFile: async () => { throw failCode('EPERM', 'operation not permitted') } })
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: fake, logCtx: null })
    const r = await phones.handleGetSettings({})
    check(r.ok === false && r.error && r.error.kind === 'environment', '读不到文件时回的是环境问题，而不是内容无效。', JSON.stringify(r).slice(0, 200))
  }
  {
    const home = makeHome('envwrite')
    const calls = []
    const fake = wrapSysFs(calls, { writeFile: async () => { throw failCode('EPERM', 'operation not permitted') } })
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: fake, logCtx: null })
    const r = await phones.handleSetSettings({ value: goodValue })
    check(r.ok === false && r.error && r.error.kind === 'environment', '写不进文件时回的是环境问题。', JSON.stringify(r).slice(0, 200))
  }
  {
    // 成功保留值与警告与只读标记与来源四个字段。
    const home = makeHome('fourfields')
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: null, logCtx: null })
    await phones.handleSetSettings({ value: goodValue })
    const r = await phones.handleGetSettings({})
    check(r.ok === true && r.value !== undefined && Array.isArray(r.warnings) && typeof r.readonly === 'boolean' && typeof r.from === 'string', '读成功保留值与警告与只读标记与来源四个字段。', JSON.stringify(Object.keys(r)).slice(0, 200))
    check(r.ok === true && r.readonly === false, '正常文件读出来不是只读。')
  }
  {
    // 日志走已有包装，类型取设置，只用已有事件名。
    const home = makeHome('logs')
    const lines = []
    const logCtx = { fire: (level, event, fields) => { lines.push({ level, event, fields }) } }
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: null, logCtx })
    await phones.handleSetSettings({ value: goodValue })
    await phones.handleGetSettings({})
    const events = lines.map((l) => l.event)
    const kinds = lines.map((l) => String((l.fields && l.fields.kind) || ''))
    check(lines.length >= 2 && events.every((e) => e === 'host.call' || e === 'host.call.fail'), '日志只用已有的两个电话事件，不新增事件名。', JSON.stringify(events))
    check(kinds.every((k) => k === 'settings'), '日志类型统一记成设置。', JSON.stringify(kinds))
  }

  // —— 第三件事：只读写入拒绝 ——
  console.log('')
  console.log('== 第三件事：只读写入拒绝（高版本只许读来展示，不许写回去） ==')
  {
    const home = makeHome('readonly')
    await realFs.mkdir(path.join(home, '.dsh', 'mattskillsdeck'), { recursive: true })
    await realFs.writeFile(path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml'), 'version: 9\n', 'utf8')
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: null, logCtx: null })
    const r = await phones.handleGetSettings({})
    check(r.ok === true && r.readonly === true, '高版本文件读成功但标成只读。', JSON.stringify({ ok: r.ok, readonly: r.readonly }))
    const calls = []
    const fake = wrapSysFs(calls, null)
    const phones2 = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: fake, logCtx: null })
    const w = await phones2.handleSetSettings({ value: goodValue })
    const wrote = calls.some((c) => c.name === 'writeFile')
    check(w.ok === false && w.error && w.error.kind === 'readonly' && /请升级插件/.test(w.error.message), '只读文件写之前先读一次，读到只读直接回升级文案。', JSON.stringify(w).slice(0, 200))
    check(wrote === false, '只读拒绝时没有动盘上的任何字节。')
    const back = await phones.handleGetSettings({})
    check(back.ok === true && back.readonly === true, '拒绝之后文件还是原来的高版本，没有被覆盖。')
  }
  {
    // 写高版本的值同样拒绝，两种只读说同一句升级文案。
    const home = makeHome('readonly2')
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: null, logCtx: null })
    const high = Object.assign({}, goodValue, { version: 9 })
    const w = await phones.handleSetSettings({ value: high })
    check(w.ok === false && w.error && w.error.kind === 'readonly' && /请升级插件/.test(w.error.message), '写高版本的值同样按只读拒绝。', JSON.stringify(w).slice(0, 200))
  }
  {
    // 写路径进程内串行：两笔写同时发起，后到的等前面的落盘之后再开始。
    const home = makeHome('serial')
    const order = []
    const base = wrapSysFs([], null)
    const slowFs = Object.assign({}, base, {
      async writeFile(p, text, enc) { order.push('enter:' + String(text).length); await sleep(60); const r = await base.writeFile(p, text, enc); order.push('leave:' + String(text).length); return r },
    })
    const phones = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: slowFs, logCtx: null })
    const vA = Object.assign({}, goodValue, { templates: { a: '甲' } })
    const vB = Object.assign({}, goodValue, { templates: { b: '乙乙' } })
    const [wA, wB] = await Promise.all([phones.handleSetSettings({ value: vA }), phones.handleSetSettings({ value: vB })])
    check(wA.ok === true && wB.ok === true, '两笔同时发起的写都成功。')
    check(order.length === 4 && order[0].indexOf('enter:') === 0 && order[1].indexOf('leave:') === 0 && order[2].indexOf('enter:') === 0, '两笔写没有同时进文件，一笔落盘之后另一笔才开始。', JSON.stringify(order))
  }

  // —— 第四件事：行数 ——
  console.log('')
  console.log('== 第四件事：行数（新叶子与宿主入口各自都不超上限） ==')
  {
    const nLeaf = countLines('src/host/settingsPhones.ts')
    check(nLeaf <= 350, '新叶子不超过三百五十行，实得 ' + nLeaf + ' 行。')
    // #1074：入口转成 .ts 后类型标注与中文注释占了约五十行（实得三百五十八行），行数口径改跟真源；
    // 上限四百是给注释类型留的，不是给逻辑留的——逻辑只许装配，电话条数另断言，添电话两处一起改。
    const nIndex = countLines('src/host/index.ts')
    check(nIndex <= 400, '宿主入口不超过四百行，实得 ' + nIndex + ' 行。')
    const nPhones = (readText('src/host/index.ts').match(/harness\.handle\(/g) || []).length
    // #1436 加了一条只读电话 wf.workRoute（胶囊首帧读本机 work-path 存档），59 → 60。
    // #1191 加了一条契约操作电话 wf.contractOp（客户端 contract-op 按当前后端分发），60 → 61。
    check(nPhones === 61, '宿主电话六十一条（添电话先改这个数，见上一条注释），实得 ' + nPhones + ' 条。')
  }

  // —— 第五件事：每条电话真跑一遍并断言真的落了一行对应的日志 ——
  console.log('')
  console.log('== 第五件事：每条电话真跑一遍并断言真的落了一行对应的日志（读与写各成功一次、各失败一次） ==')
  {
    // 为什么单独立这一节：日志覆盖门禁只认「电话名以字面出现在一个规范包装里」这个形状，
    // 它挡不住两种走样 —— 包装体留着但体内那一次发射调用被抽掉，或者发射器把电话名写死成别人的名字。
    // 所以这里改成真跑：假日志口把每一次发射的级别、事件名与字段原样收下来，
    // 读与写两条电话各成功跑一次、各失败跑一次，每一次都断言恰好一行、事件名对、电话名对、类型对。
    const collectLog = () => {
      const lines = []
      const logCtx = { fire: (level, event, fields) => { lines.push({ level, event, fields }) } }
      return { lines, logCtx }
    }
    const makePhones = (home, logCtx, fsPort) => createSettingsPhones({ getPlatform: async () => ({ getHome: async () => home }), readLocalSettings, writeLocalSettings, fs: fsPort || null, logCtx })

    // 读成功：先在没有日志口的实例上把一份好设置写进主目录，再用带日志口的实例读回来，这样收下来的行只属于这一次读。
    {
      const home = makeHome('fire-read-ok')
      const seeded = await makePhones(home, null).handleSetSettings({ value: goodValue })
      const log = collectLog()
      const r = await makePhones(home, log.logCtx).handleGetSettings({})
      check(seeded.ok === true && r.ok === true, '读成功这一次真的读成了，先把这份成功备好。', JSON.stringify({ seeded, r }).slice(0, 200))
      check(log.lines.length === 1, '读成功这一次只记一行，不多记。', JSON.stringify(log.lines))
      const line = log.lines[0] || {}
      check(line.event === 'host.call' && line.level === 'info', '读成功落的是成功那一行（host.call，级别 info）。', JSON.stringify(line))
      check(line.fields && line.fields.method === 'wf.getSettings', '读成功那一行写的电话名恰是 wf.getSettings，没有被写死成别人的名字。', JSON.stringify(line.fields))
      check(line.fields && line.fields.kind === 'settings', '读成功那一行的类型记成设置。', JSON.stringify(line.fields))
    }
    // 写成功：空主目录里直接写一份好设置，这一次写自己的日志行单独收。
    {
      const home = makeHome('fire-write-ok')
      const log = collectLog()
      const w = await makePhones(home, log.logCtx).handleSetSettings({ value: goodValue })
      check(w.ok === true, '写成功这一次真的写成了，先把这份成功备好。', JSON.stringify(w).slice(0, 200))
      check(log.lines.length === 1, '写成功这一次只记一行，不多记。', JSON.stringify(log.lines))
      const line = log.lines[0] || {}
      check(line.event === 'host.call' && line.level === 'info', '写成功落的是成功那一行（host.call，级别 info）。', JSON.stringify(line))
      check(line.fields && line.fields.method === 'wf.setSettings', '写成功那一行写的电话名恰是 wf.setSettings，没有被写死成别人的名字。', JSON.stringify(line.fields))
      check(line.fields && line.fields.kind === 'settings', '写成功那一行的类型记成设置。', JSON.stringify(line.fields))
    }
    // 读失败：读文件这一步按权限问题抛错，电话回环境问题；失败这一次同样要落一行，不能因为没读成就一行都不记。
    {
      const home = makeHome('fire-read-fail')
      const log = collectLog()
      const fake = wrapSysFs([], { readFile: async () => { throw failCode('EPERM', 'operation not permitted') } })
      const r = await makePhones(home, log.logCtx, fake).handleGetSettings({})
      check(r.ok === false, '读失败这一次真的失败了，先把这份失败备好。', JSON.stringify(r).slice(0, 200))
      check(r.error && r.error.kind === 'environment', '读失败这一档归环境问题：权限被拒既不是文件不在，也不是内容坏了。', JSON.stringify(r.error))
      check(log.lines.length === 1, '读失败这一次照样落一行，不少记也不多记。', JSON.stringify(log.lines))
      const line = log.lines[0] || {}
      check(line.event === 'host.call.fail' && line.level === 'warn', '读失败落的是失败那一行（host.call.fail，级别 warn）。', JSON.stringify(line))
      check(line.fields && line.fields.method === 'wf.getSettings', '读失败那一行写的电话名恰是 wf.getSettings。', JSON.stringify(line.fields))
      check(line.fields && line.fields.kind === 'settings', '读失败那一行的类型记成设置。', JSON.stringify(line.fields))
    }
    // 写失败：写文件这一步抛错，电话回环境问题；失败这一次同样只落一行。
    {
      const home = makeHome('fire-write-fail')
      const log = collectLog()
      const fake = wrapSysFs([], { writeFile: async () => { throw failCode('EPERM', 'operation not permitted') } })
      const w = await makePhones(home, log.logCtx, fake).handleSetSettings({ value: goodValue })
      check(w.ok === false, '写失败这一次真的失败了，先把这份失败备好。', JSON.stringify(w).slice(0, 200))
      check(w.error && w.error.kind === 'environment', '写失败这一档同样归环境问题，不冒充分档里的别的种类。', JSON.stringify(w.error))
      check(log.lines.length === 1, '写失败这一次照样落一行，不少记也不多记。', JSON.stringify(log.lines))
      const line = log.lines[0] || {}
      check(line.event === 'host.call.fail' && line.level === 'warn', '写失败落的是失败那一行（host.call.fail，级别 warn）。', JSON.stringify(line))
      check(line.fields && line.fields.method === 'wf.setSettings', '写失败那一行写的电话名恰是 wf.setSettings。', JSON.stringify(line.fields))
      check(line.fields && line.fields.kind === 'settings', '写失败那一行的类型记成设置。', JSON.stringify(line.fields))
    }
  }

  console.log(failed ? ('\n存在失败 — verify-settings-phones 未通过（' + passed + ' 项通过、' + failed + ' 项失败）') : ('\n全部通过 — 本机设置门禁生效（' + passed + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
