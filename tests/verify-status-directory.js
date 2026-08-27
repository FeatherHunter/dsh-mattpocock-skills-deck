// verify-status-directory.js — #229 验收：wf.status 检查链目录视图（9→N / 物理隔离 / pending 计数口径）
// 直测 package/lib/tracker/statusDerive.js（生产同构真源）+ pkg 入口 wf.status 集成探针。
// 用法: node tests/verify-status-directory.js  （需先 node scripts/build.mjs）
import path from 'node:path'
import os from 'node:os'

let failures = 0
const check = (ok, msg, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || extra === undefined ? '' : ' :: ' + String(extra).slice(0, 400)))
  if (!ok) failures++
}

const LEVELS = ['ok', 'warn', 'bad', 'pending']

// ---------- 可控 fake platform ----------
function makePlatform({ files = {}, home = 'C:/home-fake', execs = {} } = {}) {
  const resolve1 = (p, opts) => path.resolve((opts && opts.cwd) || process.cwd(), p)
  return {
    getHome: async () => home,
    path,
    resolveExecutable: async (cmd) => execs[cmd] || null,
    env: { get: () => undefined },
    fs: {
      resolve: async (p, opts) => resolve1(p, opts),
      exists: async (abs) => Object.prototype.hasOwnProperty.call(files, abs),
      readText: async (abs) => {
        if (!Object.prototype.hasOwnProperty.call(files, abs)) throw new Error('not found: ' + abs)
        return files[abs]
      },
      lstat: async (abs) => (Object.prototype.hasOwnProperty.call(files, abs) ? { type: 'file' } : undefined),
    },
  }
}

function rel(root, p) { return path.join(root, p) }

async function main() {
  const sdModUrl = new URL('../package/lib/tracker/statusDerive.js', import.meta.url)
  const sd = await import(sdModUrl.href)
  check(typeof sd.deriveStatusView === 'function', 'statusDerive 可从 pkg 树导入')

  // ---------- 场景 1：markdown 工作区物理隔离 ----------
  {
    const cwd = os.tmpdir()
    const plat = makePlatform({
      files: {
        [rel(cwd, 'docs/agents/issue-tracker.md')]: '# tracker\n\ntracker: markdown',
        [rel(cwd, '.scratch/map.md')]: '# Map\n\n- wayfinder 工作',
        [rel('C:/home-fake', '.agents/skills/wayfinder/SKILL.md')]: '---\nname: wayfinder\n---',
      },
      home: 'C:/home-fake',
    })
    const r = await sd.deriveStatusView({ cwd, lang: 'zh', platform: plat, selection: { backendId: 'markdown', source: 'explicit' } })
    const keys = r.checks.map(function (c) { return c.key })
    check(r.view === 'directory', '场景1 view=directory')
    check(r.checks.length === 8, '场景1 行数 N=8（2 门 + 4 通用环境 + 2 markdown），实际 ' + r.checks.length, keys.join(','))
    check(!keys.some(function (k) { return k.indexOf('gh:') === 0 }), '场景1 无任何 gh:* 行（物理隔离·无红 gh 项）')
    check(!keys.some(function (k) { return k.indexOf('glab:') === 0 }), '场景1 无 glab 行')
    check(keys[0] === 'selection:backendSelected' && r.checks[0].level === 'ok', '场景1 开门首步=已选后端')
    check(r.checks.every(function (c) { return LEVELS.indexOf(c.level) >= 0 }), '场景1 全部行 level 枚举合法')
    const pendKeys = r.checks.filter(function (c) { return c.level === 'pending' }).map(function (c) { return c.key })
    const expectedActive = r.checks.filter(function (c) { return c.level !== 'pending' })
    check(r.total === expectedActive.length && r.ready === expectedActive.filter(function (c) { return c.ok }).length, '场景1 ready/total 只统计非 pending（口径一致）')
    const parseRow = r.checks.find(function (c) { return c.key === 'md:parseOk' })
    check(parseRow && parseRow.level === 'ok', '场景1 md:parseOk 通过')
    // 英文名一致性
    const rEn = await sd.deriveStatusView({ cwd, lang: 'en', platform: plat, selection: { backendId: 'markdown', source: 'explicit' } })
    const zhName = parseRow.name
    const enName = rEn.checks.find(function (c) { return c.key === 'md:parseOk' }).name
    check(zhName && enName && zhName !== enName && /[\u4e00-\u9fff]/.test(zhName), '场景1 双语行名 zh/en 同步（zh=' + zhName + ', en=' + enName + ')')
  }

  // ---------- 场景 2：github 工作区语义等价（委托注入）+ 计数与 sections ----------
  {
    const cwd = os.tmpdir()
    const plat = makePlatform({
      files: { [rel(cwd, 'docs/agents/issue-tracker.md')]: 'x' },
      execs: { gh: 'C:/bin/gh.exe' },
    })
    const legacy = {
      c1: { ok: true, level: 'ok', detail: 'owner/repo', hint: '', repo: { owner: 'owner', name: 'repo' } },
      c4: { ok: false, level: 'bad', detail: 'gh not found', hint: '请安装 GitHub CLI — 面板所有数据都依赖 gh' },
      c5: { ok: false, level: 'bad', detail: '未登录 GitHub：运行 gh auth login', hint: 'prompt:ghAuthLogin' },
      c6: { ok: false, level: 'bad', detail: 'API 请求失败（network）', hint: '' },
    }
    const r = await sd.deriveStatusView({
      cwd, lang: 'zh', platform: plat,
      selection: { backendId: 'github', source: 'explicit' },
      delegates: { github: async () => legacy, skillProbe: async (n) => (n === 'wayfinder' ? { ok: true, level: 'ok', detail: '已安装', hint: '' } : { ok: false, level: 'bad', detail: '未安装', hint: 'prompt:installSkills' }) },
    })
    const keys = r.checks.map(function (c) { return c.key })
    check(r.checks.length === 10, '场景2 行数 10（6 通用 + 4 github 迁移项），实际 ' + r.checks.length, keys.join(','))
    check(r.view === 'directory' && r.repoRef && r.repoRef.owner === 'owner', '场景2 repoRef 由 gh:remote 委托透传')
    const byKey = {}
    r.checks.forEach(function (c) { byKey[c.key] = c })
    check(byKey['gh:remote'].id === 1 && byKey['gh:installed'].id === 4 && byKey['gh:authed'].id === 5 && byKey['gh:repoAccess'].id === 6, '场景2 legacy 数字 id 桥（1/4/5/6）')
    check(byKey['skill:wayfinder'].id === 7 && byKey['skill:ask-matt'].id === 8, '场景2 技能行 legacy id（7/8）')
    check(!keys.includes('gh:labels'), '场景2 gh:labels 不进环境面板（仓库就绪链专属）')
    check(!keys.includes('selection:backendSelected') === false, '场景2 开门选择行存在')
    check(byKey['gh:remote'].level === 'ok' && byKey['gh:installed'].level === 'bad' && byKey['gh:authed'].hint === 'prompt:ghAuthLogin', '场景2 委托结果逐行映射（level/hint 保真）')
    const act = r.checks.filter(function (c) { return c.level !== 'pending' })
    check(r.total === act.length && r.ready === act.filter(function (c) { return c.level === 'ok' }).length, '场景2 ready/total 与行级口径一致（ready=' + r.ready + '/total=' + r.total + '）')
    check(r.sections.gate.length === 2 && r.sections.env.length === 4 && r.sections.backend.length === 4, '场景2 分区计数 2/4/4')
    // 每 ok 与 level 一致（旧契约不变量）
    check(r.checks.every(function (c) { return c.ok === (c.level === 'ok') }), '场景2 ok 字段与 level 一致（legacy 形状契约）')
    // detail 字段存在（旧 UI 直接渲染）
    check(r.checks.every(function (c) { return typeof c.detail === 'string' && typeof c.hint === 'string' && typeof c.name === 'string' }), '场景2 每行含 name/detail/hint 字符串')
  }

  // ---------- 场景 3：github 但委托未注入 → gh 行诚实 pending 且剔除出分母 ----------
  {
    const cwd = os.tmpdir()
    const plat = makePlatform({ files: {} })
    const r = await sd.deriveStatusView({ cwd, lang: 'zh', platform: plat, selection: { backendId: 'github' }, delegates: {} })
    const ghRows = r.checks.filter(function (c) { return c.key.indexOf('gh:') === 0 })
    check(ghRows.length === 4 && ghRows.every(function (c) { return c.level === 'pending' }), '场景3 未接入委托 → gh 四行 pending（不猜不误报）')
    check(r.total === r.checks.filter(function (c) { return c.level !== 'pending' }).length, '场景3 total 剔除 pending（na 口径：不计入分子分母）')
  }

  // ---------- 场景 4：selection pending → 「探测中」warn，无后端分区行 ----------
  {
    const cwd = os.tmpdir()
    const plat = makePlatform({ files: {} })
    const r = await sd.deriveStatusView({ cwd, lang: 'en', platform: plat, selection: { pending: true, backendId: null } })
    const first = r.checks[0]
    check(first.key === 'selection:backendSelected' && first.level === 'warn', '场景4 pending 选择 → warn 行')
    check(/Detecting/i.test(first.detail), '场景4 pending 文案为探测中（en）')
    check(r.checks.every(function (c) { return c.group !== 'backend' }), '场景4 未定后端时后端分区行为空（不猜后端）')
  }

  // ---------- 场景 5：集成探针 —— pkg 入口 wf.status 真实返回目录视图 ----------
  try {
    const entryUrl = new URL('../package/lib/index.js', import.meta.url)
    const modRaw = await import(entryUrl.href)
    const plugin = modRaw.default ?? modRaw
    let rpcHandler = null
    const fsp = (await import('node:fs')).promises
    const services = {}
    services.subprocess = { resolveExecutable: async () => null, spawn: () => ({ stdout: { on() {} }, stderr: { on() {} }, on() {}, terminate() {} }) }
    services.timer = { timeout: (fn) => setTimeout(fn, 10), interval: (fn) => { const i = setInterval(fn, 60000); return () => clearInterval(i) } }
    services.fs = {
      resolve: (p, o) => Promise.resolve(path.resolve((o && o.cwd) || process.cwd(), p)),
      lstat: async (p, o) => { try { const s = await fsp.lstat(path.resolve((o && o.cwd) || process.cwd(), p)); return { type: s.isDirectory() ? 'dir' : 'file' } } catch { return undefined } },
      readText: (p) => fsp.readFile(p, 'utf8'),
    }
    services.connection = { rpc: { handle: (p2, fn) => { rpcHandler = fn } } }
    const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }
    await plugin.apply(ctx)
    check(typeof rpcHandler === 'function', '场景5 /dsws 通道已注册')
    const res = await rpcHandler('status', { cwd: process.cwd(), lang: 'zh', force: true })
    const inner = res && res.value ? res.value : res
    check(inner && inner.ok === true && Array.isArray(inner.checks), '场景5 wf.status 返回检查数组')
    check(inner.view === 'directory', '场景5 pkg 主线走目录视图（view=directory），实际 ' + inner.view)
    check(inner.checks.every(function (c) { return typeof c.key === 'string' && LEVELS.indexOf(c.level) >= 0 }), '场景5 集成行形态合法（key+level）')
  } catch (e) {
    check(false, '场景5 集成探针异常', e.message)
  }

  console.log(failures ? ('\n#229 目录视图验收失败 ' + failures + ' 项') : '\n#229 目录视图验收全部通过')
  process.exit(failures ? 1 : 0)
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1) })
