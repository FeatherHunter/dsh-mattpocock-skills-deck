// verify-log-switch-526.js —— #526 开关写失败分类行门禁（TDD 红灯先行）。
// 用法：node tests/verify-log-switch-526.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）。
// 背景：设置页点调试开关只弹“开关保存失败”提示，失败到底是哪一类（宿主不可用、
//   宿主拒收、调用抛错）没有任何日志行留下，事后导出日志也看不出原因。
// 要求：写开关函数的三条失败路各落一条告警级分类行，复用现成常驻事件
//   host.call.fail（不新增事件名、不碰 54 总数），字段只用白名单三键
//  （method、kind、errorHash），告警级始终落盘、不依赖调试开关。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('开关写失败分类行门禁（#526：三类失败各留一条可区分的告警行）')

const LOG_SRC = path.join(ROOT, 'src', 'client', 'kernel', 'log.js')
const src = fs.readFileSync(LOG_SRC, 'utf8')

// ---- 运行夹具：与 verify-log-client.js 同构（去行首 export 载入，配假宿主与假存储） ----
function makeLocalStorage(preset) {
  const map = new Map(Object.entries(preset || {}))
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    _map: map,
  }
}
function makeTimer() {
  const calls = []
  return { calls, timeout(fn, ms) { calls.push(ms); return calls.length } }
}
function loadLog(options) {
  const opts = options || {}
  const body = src.split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
  const factory = new Function(
    'host', 'timer', 'localStorage', 'broadcastLogSwitch',
    body + '\nreturn { isEnabled, log, logSwitch, logQueue, setLogSwitch };'
  )
  return factory(opts.host, opts.timer, opts.localStorage, opts.broadcastLogSwitch)
}
const failLines = (mod) => mod.logQueue.filter((e) => e.level === 'warn' && e.event === 'host.call.fail' &&
  e.fields && e.fields.method === 'wf.logSetSwitch')
const isHash8 = (s) => typeof s === 'string' && /^[0-9a-f]{8}$/.test(s)
// ---- 手动计时器：只记录不执行，由测试手动触发超时 ----
function makeManualTimer() {
  const fns = []
  return { fns, timeout(fn, ms) { fns.push({ fn, ms }); return fns.length } }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

async function main() {
  // ---- 宿主不可用：无 host.call，留宿主不可用分类行，旧值保持关闭 ----
  {
    const mod = loadLog({ localStorage: makeLocalStorage(), timer: makeTimer() })
    const res = await mod.setLogSwitch(true, 1)
    check(res.ok === false && mod.logSwitch.enabled === false, '无宿主返回失败且保持旧值（关）')
    const lines = failLines(mod)
    check(lines.length === 1, '无宿主留一条开关写失败行（实得 ' + lines.length + ' 条）')
    check(lines.length === 1 && lines[0].fields.kind === 'set-switch-host-unavailable', '无宿主行分类为宿主不可用')
    check(lines.length === 1 && isHash8(lines[0].fields.errorHash), '无宿主行错误散列为 8 位十六进制')
  }

  // ---- 宿主拒收：回包 ok 非成功，留拒收分类行，旧值保持关闭 ----
  {
    const mod = loadLog({
      localStorage: makeLocalStorage(), timer: makeTimer(),
      host: { call() { return Promise.resolve({ ok: false }) } },
    })
    const res = await mod.setLogSwitch(true, 1)
    check(res.ok === false && mod.logSwitch.enabled === false, '宿主拒收返回失败且保持旧值（关）')
    const lines = failLines(mod)
    check(lines.length === 1, '宿主拒收留一条开关写失败行（实得 ' + lines.length + ' 条）')
    check(lines.length === 1 && lines[0].fields.kind === 'set-switch-host-rejected', '拒收行分类为宿主拒收')
    check(lines.length === 1 && isHash8(lines[0].fields.errorHash), '拒收行错误散列为 8 位十六进制')
  }

  // ---- 调用抛错：未知端点，留未知端点 subclass 行 ----
  {
    const mod = loadLog({
      localStorage: makeLocalStorage(), timer: makeTimer(),
      host: { call() { return Promise.reject(new Error('unknown endpoint: logSetSwitch')) } },
    })
    const res = await mod.setLogSwitch(true, 1)
    check(res.ok === false && mod.logSwitch.enabled === false, '抛错返回失败且保持旧值（关）')
    const lines = failLines(mod)
    check(lines.length === 1, '抛错留一条开关写失败行（实得 ' + lines.length + ' 条）')
    check(lines.length === 1 && lines[0].fields.kind === 'set-switch-throw-unknown-endpoint', '未知端点行分类可区分')
    check(lines.length === 1 && isHash8(lines[0].fields.errorHash), '抛错行错误散列为 8 位十六进制')
  }

  // ---- 调用抛错：连接不可用，留连接 subclass 行 ----
  {
    const mod = loadLog({
      localStorage: makeLocalStorage(), timer: makeTimer(),
      host: { call() { return Promise.reject(new Error('connection 服务不可用')) } },
    })
    await mod.setLogSwitch(true, 1)
    const lines = failLines(mod)
    check(lines.length === 1 && lines[0].fields.kind === 'set-switch-throw-connection', '连接失败行分类可区分')
  }

  // ---- 调用抛错：其他错误，留通用抛错行 ----
  {
    const mod = loadLog({
      localStorage: makeLocalStorage(), timer: makeTimer(),
      host: { call() { return Promise.reject(new Error('boom')) } },
    })
    await mod.setLogSwitch(true, 1)
    const lines = failLines(mod)
    check(lines.length === 1 && lines[0].fields.kind === 'set-switch-throw', '通用抛错行分类可区分')
  }

  // ---- 调用抛错：无理由拒收（undefined），不抛错、仍留通用行 ----
  {
    const mod = loadLog({
      localStorage: makeLocalStorage(), timer: makeTimer(),
      host: { call() { return Promise.reject() } },
    })
    const res = await mod.setLogSwitch(true, 1)
    check(res.ok === false && mod.logSwitch.enabled === false, '无理由抛错返回失败且保持旧值（关）')
    const lines = failLines(mod)
    check(lines.length === 1 && lines[0].fields.kind === 'set-switch-throw', '无理由抛错仍留通用行且不断言崩')
  }

  // ---- 调用 hang 住：超时放行，界面不再灰掉，留超时分类行 ----
  {
    const timer = makeManualTimer()
    const mod = loadLog({
      localStorage: makeLocalStorage(), timer,
      host: { call() { return new Promise(() => {}) } },
    })
    const p = mod.setLogSwitch(true, 1)
    check(timer.fns.length === 2, '写开关设超时（看门狗之外另有一计时，实得 ' + timer.fns.length + ' 个）')
    timer.fns.forEach((t) => t.fn())
    const res = await p
    check(res.ok === false && res.error === 'switch-timeout' && mod.logSwitch.enabled === false, '超时放行并保持旧值（关）')
    const lines = failLines(mod)
    check(lines.length === 1 && lines[0].fields.kind === 'set-switch-timeout', '超时留一条超时分类行')
    check(lines.length === 1 && isHash8(lines[0].fields.errorHash), '超时行错误散列为 8 位十六进制')
  }

  // ---- 迟到回包：超时后才到的成功按代际丢弃，不覆盖状态、不记新行 ----
  {
    const timer = makeManualTimer()
    let resolveCall = null
    const host = { call() { return new Promise((res) => { resolveCall = res }) } }
    const mod = loadLog({ localStorage: makeLocalStorage(), timer, host, broadcastLogSwitch() {} })
    const pA = mod.setLogSwitch(true, 1)
    timer.fns.forEach((t) => t.fn())
    const resA = await pA
    check(resA.ok === false && resA.error === 'switch-timeout', '先超时放行')
    resolveCall({ ok: true, enabled: true })
    await tick()
    await tick()
    check(mod.logSwitch.enabled === false, '迟到成功不覆盖状态（仍关）')
    check(failLines(mod).length === 1, '迟到成功不记新行（仍只有超时行）')
    const pB = mod.setLogSwitch(true, 1)
    resolveCall({ ok: true, enabled: true })
    const resB = await pB
    check(resB.ok === true && mod.logSwitch.enabled === true, '新调用成功仍可打开')
  }

  // ---- 成功路：不记失败行，行为零变化 ----
  {
    let broadcast = 0
    const mod = loadLog({
      localStorage: makeLocalStorage(), timer: makeTimer(),
      host: { call() { return Promise.resolve({ ok: true, enabled: true }) } },
      broadcastLogSwitch() { broadcast += 1 },
    })
    const res = await mod.setLogSwitch(true, 1)
    check(res.ok === true && mod.logSwitch.enabled === true, '成功仍正常打开')
    check(failLines(mod).length === 0, '成功不记失败行')
    check(broadcast === 1, '成功仍广播一次')
  }

  // ---- 渲染路径禁令：本次改动不新增对象转文本 ----
  {
    const stringifyHits = src.split('\n').filter((l) => l.includes('JSON.stringify'))
    check(stringifyHits.length === 2, '对象转文本仍只在两处（本次未新增）')
  }

  console.log(failed ? '\n存在失败 — verify-log-switch-526 未通过' : '\n全部通过 — 开关写失败分类行门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.log('  FAIL 夹具抛错：' + ((e && e.message) || e)); process.exit(1) })
