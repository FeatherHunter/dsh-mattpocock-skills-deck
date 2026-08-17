// verify-status.js — dsh-waystation host.js wf.status 模块验证（ticket #344）
// 可复现版：性质断言 + 现场动态比对，不绑死本机现场状态。
// 用法: node tests/verify-status.js <仓库根目录>
// 依赖: node + 本机可用的 gh（PATH 或 DSH_GH_PATH 兜底）
const fsx = require('fs')
const fsp = fsx.promises
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const os = require('os')

const REPO_CWD = process.argv[2] || process.cwd()
const HOST_JS = path.join(__dirname, '..', 'host.js')

// ---------- mock 服务（subprocess/fs 真实现；skills 可注入） ----------
const subprocess = {
  async resolveExecutable(name) {
    const dirs = (process.env.PATH || '').split(';').filter(Boolean)
    const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    const cands = []
    for (const d of dirs) { for (const ext of exts) cands.push(path.join(d, name + ext.toLowerCase())); cands.push(path.join(d, name)) }
    for (const c of cands) { try { fsx.accessSync(c); return c } catch (e) { /* 继续 */ } }
    throw new Error('executable not found: ' + name)
  },
  spawn(spec) {
    const cp = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = '', err = ''
    cp.stdout.on('data', d => { out += d })
    cp.stderr.on('data', d => { err += d })
    const done = new Promise(res => cp.on('close', (code, signal) => res({ exitCode: code, signal })))
    return { done, collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: err }) } }, terminate: () => { try { cp.kill() } catch (e) { /* ignore */ } } }
  },
}
const timer = {
  timeout: ms => new Promise(res => setTimeout(res, ms)),
  interval: (fn, ms) => { const id = setInterval(fn, ms); if (id.unref) id.unref(); return () => clearInterval(id) },
}
const fsSvc = {
  async resolve(p, opts) { return path.resolve((opts && opts.cwd) || process.cwd(), p) },
  async lstat(p, opts) {
    const abs = path.resolve((opts && opts.cwd) || process.cwd(), p)
    try { const s = await fsp.lstat(abs); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size } } catch (e) { return undefined }
  },
  async readText(t) { return fsp.readFile(t, 'utf8') },
  processPath(t) { return t },
}
function makeSkills(catalog) {
  return { async get(name) { return catalog[name] ? { name } : undefined }, async list() { return Object.keys(catalog).map(name => ({ name })) } }
}
function loadPlugin(services) {
  const handlers = {}
  const harness = { handle: (name, fn) => { handlers[name] = fn } }
  const ctx = { get: n => services[n], effect: fn => { const d = fn(); return typeof d === 'function' ? d : () => {} } }
  const fn = new Function('harness', 'ctx', fsx.readFileSync(HOST_JS, 'utf8'))
  const plugin = fn(harness, ctx)
  plugin.apply(ctx)
  return handlers
}

async function main() {
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (!cond) console.error('  ✗ FAIL:', name, extra || '')
    else console.log('  ✓', name)
  }

  const h = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills({}) })

  // —— 性质断言：当前仓库 ——
  const s = await h['wf.status']({ cwd: REPO_CWD })
  expect('9 项检测齐全', s.ok === true && s.total === 9 && s.checks.length === 9, 'total=' + s.total)
  expect('每项含 ok/level/detail/hint 且 ok 与 level 一致', s.checks.every(c => 'ok' in c && 'level' in c && 'detail' in c && 'hint' in c && c.ok === (c.level === 'ok')))
  expect('ready 与 ok 计数一致', s.ready === s.checks.filter(c => c.ok).length, 'ready=' + s.ready)
  expect('level 仅 ok/warn/bad', s.checks.every(c => c.level === 'ok' || c.level === 'warn' || c.level === 'bad'))
  const c1 = s.checks[0], c4 = s.checks[3]
  expect('检查1 仓库定位：ok（detail=owner/repo）或 warn/bad（detail 非空）', (c1.level === 'ok' && /\//.test(c1.detail)) || (c1.level !== 'ok' && c1.detail.length > 0), JSON.stringify(c1))
  expect('检查4 gh CLI：ok（detail=可执行路径）或 bad（hint 给出修复方向）', (c4.level === 'ok' && c4.detail.length > 0) || (c4.level === 'bad' && c4.hint.length > 0), JSON.stringify(c4))
  expect('检查7/8 技能：bad/warn 时 hint 非空（给修复指引）', s.checks.slice(6).every(c => c.level === 'ok' || (c.hint && c.hint.length > 0)), JSON.stringify(s.checks.slice(6).map(c => c.level)))
  expect('repo 字段与检查1一致', (s.repo === null) === (c1.level === 'bad' || c1.level === 'warn') || (c1.level === 'ok' && s.repo !== null && c1.detail.indexOf(s.repo.owner) === 0), JSON.stringify({ repo: s.repo, c1: c1.detail }))

  // —— 会话挂载技能 → 检查7/8 必须 ok ——
  const hB = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills({ wayfinder: {}, 'ask-matt': {} }) })
  const sB = await hB['wf.status']({ cwd: REPO_CWD })
  expect('会话挂载后 7/8 变 ok', sB.checks[6].level === 'ok' && sB.checks[7].level === 'ok', sB.checks[6].level + ',' + sB.checks[7].level)
  expect('会话挂载后 ready 提升', sB.ready >= s.ready, sB.ready + '>=' + s.ready)

  // —— 临时未初始化目录：1-3 必须非 ok（cwd 相关），4-6 独立判定 ——
  // 缓存命中必须在「同实例换 cwd」之前测（换 cwd 会替换缓存条目）
  const sD = await h['wf.status']({ cwd: REPO_CWD })
  expect('30s 缓存命中（同 cwd 连续调用同一对象）', sD === s)

  const tmp = fsx.mkdtempSync(path.join(os.tmpdir(), 'wfst-verify-'))
  const sC = await h['wf.status']({ cwd: tmp })
  expect('临时目录：检查1 非 ok（非 git 仓库）', sC.checks[0].level !== 'ok', sC.checks[0].level)
  expect('临时目录：检查2 非 ok（无 issue-tracker.md）', sC.checks[1].level !== 'ok', sC.checks[1].level)
  expect('临时目录：检查3 非 ok（tracker 无法判定）', sC.checks[2].level !== 'ok', sC.checks[2].level)
  expect('临时目录：检查4 独立判定（与 cwd 无关）', sC.checks[3].level === s.checks[3].level, sC.checks[3].level + ' vs ' + s.checks[3].level)
  expect('临时目录：检查5 独立判定', sC.checks[4].level === s.checks[4].level, sC.checks[4].level + ' vs ' + s.checks[4].level)
  expect('临时目录：检查6 独立判定', sC.checks[5].level === s.checks[5].level, sC.checks[5].level + ' vs ' + s.checks[5].level)
  expect('临时目录 repo=null', sC.repo === null)

  // —— B1 回归（#455）：仓库子目录打开面板不误报「没有初始化」——
  //   前提：git 根存在 docs/agents/issue-tracker.md（setup 已跑）；子目录本身无该文件
  //   断言：cwd=子目录 时检查2（setup）必须 ok（针对 git 根检测）——旧实现按 cwd 查会误报 bad
  const gitRootRes = spawnSync('git', ['-C', REPO_CWD, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const gitRoot = (gitRootRes.status === 0 && gitRootRes.stdout.trim() && !/fatal/i.test(gitRootRes.stdout)) ? gitRootRes.stdout.trim() : null
  const subdirCandidates = gitRoot ? [path.join(gitRoot, 'docs'), path.join(gitRoot, 'src'), path.join(gitRoot, 'tests'), path.join(gitRoot, 'scripts')] : []
  const b1Subdir = subdirCandidates.find(function (d) { return fsx.existsSync(d) })
  if (b1Subdir && fsx.existsSync(path.join(gitRoot, 'docs', 'agents', 'issue-tracker.md'))) {
    const sSub = await h['wf.status']({ cwd: b1Subdir })
    expect('B1 子目录：检查2 ok（git 根检测到 issue-tracker.md）', sSub.checks[1].level === 'ok', sSub.checks[1].level + ' @ ' + b1Subdir)
    expect('B1 子目录：检查3 ok（git 根读到 tracker 内容）', sSub.checks[2].level === 'ok', sSub.checks[2].level + ' @ ' + b1Subdir)
  } else {
    console.log('  （跳过 B1 子目录断言：git 根无 docs/agents/issue-tracker.md 或无候选子目录）')
  }

  // —— 缓存按 cwd 区分（#344 缺陷回归） ——
  const sF = await h['wf.status']({ cwd: tmp })
  expect('不同 cwd 不命中缓存（临时目录判定不串场）', sF !== s && sF.checks[0].level !== 'ok' && sF.repo === null, sF.checks[0].level + ' repo=' + JSON.stringify(sF.repo))
  const sG = await h['wf.status']({ cwd: REPO_CWD })
  const sH = await h['wf.status']({ cwd: REPO_CWD })
  expect('切回原 cwd 后重建并再次命中缓存', sG !== sF && sG.ok === true && sH === sG)
  const sE = await h['wf.status']({ cwd: REPO_CWD, force: true })
  expect('force 强制重查（新对象）', sE !== sG && sE.ok === true)

  // —— 运行时可复现结果展示（人工可核对） ——
  console.log('--- 当前仓库现场判定（人工核对） ---')
  s.checks.forEach(c => console.log('   ', c.id, c.name, c.level, '|', c.detail, c.hint ? '→ ' + c.hint : ''))
  console.log('--- 临时目录现场判定（人工核对） ---')
  sC.checks.forEach(c => console.log('   ', c.id, c.name, c.level, '|', c.detail))

  const failed = checks.filter(c => !c.pass)
  console.log('')
  console.log('TOTAL', checks.length, 'PASS', checks.length - failed.length, 'FAIL', failed.length)
  process.exit(failed.length ? 1 : 0)
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2) })
