// verify-log-switch-single-source.ts —— 调试日志开关只有一处真源（#1432）
// 用法：node --import ./scripts/ts-hook.mts tests/verify-log-switch-single-source.ts（在插件根目录）
//
// 为什么要有这扇门禁：插件调试日志的开关从前有两处真源 —— 本机设置文件（settings.yaml）里的 debug.enabled
// 与缓存目录里的 log-switch.json。两份对不上时，界面显示开着、详细日志却从不落盘。现在只留设置文件一处：
// 宿主开机直接读它，缓存目录那份单独开关文件整条删除，开机顺手清掉遗留文件。这扇门禁守的就是「只有一处」：
// 静态面看代码里还有没有第二处读写，行为面看宿主开关来源真的按设置文件的四个状态回值、清理真的会删且删失败不挡开机。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed += 1 }

function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

// src/ 下所有文件：静态面「第二处真源」扫的是整个 src/，不是挑几个文件看。
function walkSrc(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) walkSrc(abs, out)
    else out.push(abs)
  }
  return out
}

console.log('调试日志开关只有一处真源（#1432：只认 settings.yaml 的 debug.enabled，不再读写缓存目录里的开关文件）')

async function main() {
  // ── 静态面 ──────────────────────────────────────────────────────────────
  const lfp = readSrc('src/host/logFromPackage.ts')
  const settingsPhones = readSrc('src/host/settingsPhones.ts')
  const hostIndex = readSrc('src/host/index.ts')
  // #1143 起旧实现三件套已删（src/host/logStore.ts 不存在），唯一真相是 dsh-log 包：不再读已删文件。

  // ① 开关来源真的递进了日志包的建库调用（只写注释不算）。
  check(/storeDeps\.switchSource\s*=\s*input\.switchSource/.test(lfp), 'logFromPackage 把 switchSource 装进递给日志包的那份依赖（storeDeps.switchSource = input.switchSource）')
  check(/createHostLog\(\s*storeDeps/.test(lfp), '建库调用用的正是那份装了 switchSource 的依赖（createHostLog(storeDeps, …)）')
  check(/switchSource\?:\s*LogSwitchSource/.test(lfp), '建库入参类型里写明了可选的 switchSource')
  check(/interface LogSwitchSource[\s\S]{0,200}get:\s*\(\)\s*=>/.test(lfp) && /set\?:\s*\(enabled: boolean\)\s*=>/.test(lfp), '开关来源的契约形状与日志包约定一致（get 必填、set 可选）')

  // ② 宿主开关来源复用既有的本机设置读取链路，只读 debug.enabled。
  check(/function readDebugSwitchEnabled\s*\(/.test(settingsPhones), 'settingsPhones 提供 readDebugSwitchEnabled（宿主开机来问这一格）')
  check(/readLocalSettings\(home, buildIo\(\)\)/.test(settingsPhones), '它走既有的 configStore.readLocalSettings 与 buildIo，不另写一份 YAML 读取')
  check(/raw\.value\.debug/.test(settingsPhones) && /debug\.enabled/.test(settingsPhones), '它只读文件里 debug.enabled 这一格')
  check(!/log-switch\.json/.test(settingsPhones), '开关来源里没有出现旧开关文件名（不再存第二份）')
  check(/_settings\(\)/.test(hostIndex) && /readDebugSwitchEnabled/.test(hostIndex), 'index.ts 的 _log() 从 settingsPhones 拿开关来源')
  // #1143 起旧回退实现已删，同一份 switchSource 只给包：文件里不再有 switchSource 是正常的，只断言至少出现一次。
  check((hostIndex.match(/switchSource:/g) || []).length >= 1, 'index.ts 把 switchSource 只给包（旧回退实现已删，文件里不再有 switchSource 是正常的）')

  // ③ src/ 生产代码不再读写旧开关文件：只有 logFromPackage 里那一条「开机清理」还认得这个文件名。
  const all = walkSrc(path.join(ROOT, 'src'), [])
  const offenders = []
  for (const abs of all) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/')
    const text = fs.readFileSync(abs, 'utf8')
    if (text.indexOf('log-switch.json') >= 0 && rel !== 'src/host/logFromPackage.ts') offenders.push(rel)
  }
  check(offenders.length === 0, 'src/ 下除 logFromPackage 的清理逻辑外，没有别的生产代码读写旧开关文件（越界文件：' + (offenders.join('、') || '无') + '）')
  const legacyLines = lfp.split('\n').filter((l) => l.indexOf('log-switch.json') >= 0)
  const legacyOk = legacyLines.length >= 1 && legacyLines.every((l) => {
    const t = l.trim()
    return l.indexOf('LEGACY_SWITCH_FILE_NAME') >= 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0 || t.indexOf('//') === 0
  })
  check(legacyOk, 'logFromPackage 里的旧文件名只出现在迁移清理的代码与注释里（别处不再出现）')

  // ④ 旧回退实现已删（#1143）：src/host/index.ts 不再引用 logStore（读 index.ts 文本确认无 logStore 引用）。
  check(!/logStore/.test(hostIndex), '旧回退实现已删，index.ts 不再引用 logStore（唯一真相是 dsh-log 包）')

  // ⑤ 开机清理逻辑存在，且失败不抛（只记一条既有口径的 warn）。
  check(/function removeLegacySwitchFile\s*\(/.test(lfp), 'logFromPackage 里有开机清理遗留开关文件的函数')
  check(/store\.log\('warn', 'log\.persist\.fail'/.test(lfp) && /'remove-switch-file'/.test(lfp), '清理失败只记一条 warn（沿用 log.persist.fail 事件，op 记为 remove-switch-file）')
  const cleanupStart = lfp.indexOf('async function removeLegacySwitchFile')
  const cleanupFn = cleanupStart >= 0 ? lfp.slice(cleanupStart, lfp.indexOf('export async function createLogFromPackage')) : ''
  check(cleanupFn.length > 0 && cleanupFn.indexOf('throw') < 0, '清理函数里没有往外抛错，删不掉也不挡开机')

  // ── 行为面：宿主开关来源按设置文件的四个状态回值（临时主目录、真文件）──────
  const settingsPhonesUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'settingsPhones.ts')).href
  const storeUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'logFromPackage.ts')).href
  const settingsMod = await import(settingsPhonesUrl)
  const logFromPackageMod = await import(storeUrl)
  const cm = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.ts')).href)

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-log-switch-'))
  const settingsFileOf = (home) => path.join(home, '.dsh', 'mattskillsdeck', 'settings.yaml')
  function makeHome(name, yaml) {
    const home = path.join(tmpRoot, name)
    fs.mkdirSync(path.dirname(settingsFileOf(home)), { recursive: true })
    if (yaml !== null) fs.writeFileSync(settingsFileOf(home), yaml)
    return home
  }
  function makePhones(home) {
    const events = []
    const phones = settingsMod.createSettingsPhones({
      getPlatform: async () => ({ getHome: async () => home }),
      readLocalSettings: cm.readLocalSettings,
      writeLocalSettings: cm.writeLocalSettings,
      logCtx: { fire: (level, event, fields) => events.push({ level, event, fields }) },
    })
    return { phones, events }
  }
  function settingsYaml(on) {
    return 'version: 1\ndebug:\n  enabled: ' + String(on) + '\n  sampleRate: 1\n'
  }
  const cases = [
    ['里 debug.enabled 写成 true', settingsYaml(true), true],
    ['里 debug.enabled 写成 false', settingsYaml(false), false],
    ['还没建（缺文件）', null, null],
    ['内容坏了（坏 yaml）', 'version: 1\ndebug: [这一行不是合法的设置文档\n', null],
  ]
  for (const item of cases) {
    const label = item[0]
    const home = makeHome('case-' + total, item[1])
    const made = makePhones(home)
    let got = 'throw'
    try { got = await made.phones.readDebugSwitchEnabled() } catch (e) { got = 'throw' }
    check(got === item[2] && got !== 'throw', '设置文件' + label + ' → readDebugSwitchEnabled 回 ' + String(item[2]) + '（实得 ' + String(got) + '，不抛）')
    const wantEvent = item[2] === null ? 'host.call.fail' : 'host.call'
    check(made.events.length === 1 && made.events[0].event === wantEvent && !!made.events[0].fields && made.events[0].fields.method === 'wf.logGetSwitch', '设置文件' + label + ' → 记一条既有口径的开关日志（' + wantEvent + '，电话名 wf.logGetSwitch）')
  }

  // ── 行为面：开机清理遗留开关文件（临时缓存目录、真文件）────────────────
  function makeFs() {
    const texts = new Map()
    return {
      async resolve(p) { return { __target: String(p) } },
      async readText(t) {
        const k = t && t.__target ? t.__target : String(t)
        if (!texts.has(k)) throw new Error('文件不存在：' + k)
        return texts.get(k)
      },
      async writeText(t, text) { texts.set(t && t.__target ? t.__target : String(t), String(text)) },
      // 给门禁自己看的落盘现场：断言「调试行真的写进了日志文件」时要用。
      snapshot() { return texts },
    }
  }
  const timer = { timeout(fn, ms) { if (typeof fn === 'number') return new Promise((r) => setTimeout(() => r({ exitCode: -1 }), fn)); return setTimeout(fn, ms) } }
  const platform = { os: 'test-os', path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } }, fs: { async resolve(p) { return { __target: String(p) } }, async mkdir() {}, async listDir() { return [] } } }
  const cacheDir = path.join(tmpRoot, 'cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const legacy = path.join(cacheDir, 'log-switch.json')
  const baseDeps = (fileService) => ({ fs: fileService || makeFs(), timer, getCacheDir: async () => cacheDir, getPlatform: async () => platform, DEFAULT_CWD: '/work' })
  const fsA = makeFs()
  fs.writeFileSync(legacy, '{"enabled":true}')
  const storeA = await logFromPackageMod.createLogFromPackage(Object.assign(baseDeps(fsA), { switchSource: { get: async () => true } }))
  check(!!storeA && typeof storeA.log === 'function', '接上开关来源时日志库照样建得起来')
  check(!fs.existsSync(legacy), '开机清理把缓存目录里的遗留开关文件删掉了')
  // 原来那个故障就在这里：面板显示开着，但宿主开机读的是缓存目录里的旧文件（已被删掉），调试级一直不放行。
  const stateA = await storeA.loadSwitch()
  check(!!stateA && stateA.enabled === true, '开关来源回 true 时开机读出来的开关是开的（0.4.0 起生效；0.3.x 会去读已被删的旧文件而回关）')
  check(storeA.isEnabled('debug', 'gate.probe') === true, '开关开着时调试级真的放行（原故障：面板显示开着、调试行却从不落盘）')
  storeA.log('debug', 'gate.probe.line', {})
  await storeA.flushNow()
  const logKeysA = Array.from(fsA.snapshot().keys()).filter((k) => String(k).indexOf('/logs/') >= 0)
  check(logKeysA.length > 0 && String(fsA.snapshot().get(logKeysA[logKeysA.length - 1])).indexOf('gate.probe.line') >= 0, '调试行真的写进了日志文件（原故障的回归断言）')
  await storeA.setSwitch(false)
  check(storeA.isEnabled('debug', 'gate.probe') === false, '拨开关关掉后调试级立刻不放行（内存跟随，不必等重启）')
  check(!fs.existsSync(legacy), '拨开关不再另写一份缓存目录开关文件')

  fs.writeFileSync(legacy, '{"enabled":false}')
  let thrown = null
  let storeB = null
  try {
    storeB = await logFromPackageMod.createLogFromPackage(Object.assign(baseDeps(), {
      switchSource: { get: async () => false },
      fsPort: { unlink: async () => { const e = new Error('拒绝访问'); e.code = 'EACCES'; throw e } },
    }))
  } catch (e) { thrown = e }
  check(thrown === null, '清理删文件失败时不往外抛（开机不被打断）')
  check(!!storeB && typeof storeB.log === 'function', '清理失败时日志库仍然建好了（不挡开机）')
  check(fs.existsSync(legacy), '删不掉的文件保持原样，清理不做别的破坏动作')

  fs.writeFileSync(legacy, '{"enabled":true}')
  await logFromPackageMod.createLogFromPackage(baseDeps())
  check(fs.existsSync(legacy), '没递开关来源时不清理遗留文件（老调用方那份状态不动）')

  fs.rmSync(tmpRoot, { recursive: true, force: true })

  console.log(failed ? '\n存在失败：' + failed + ' 条' : '\n全部通过')
  printGateResult('verify-log-switch-single-source', total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('  FAIL 门禁执行异常：' + (e && e.message ? e.message : String(e)))
  printGateResult('verify-log-switch-single-source', total, 1)
  process.exit(1)
})
