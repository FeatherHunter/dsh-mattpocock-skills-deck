// verify-t1-getrepokey.js — #41 T1 修复验证：getRepoKey 显式解析 origin
// 多远程下（旧实现 → `gh repo view` 命中 upstream；新实现 → `git remote get-url origin` 命中 Fork）
// 用法：node tests/verify-t1-getrepokey.js
// 依赖：node + 本机 git（PATH）。不依赖 gh（gh 走 mock，可控返回 upstream 模拟 gh 旧 bug）

const fsx = require('fs')
const fsp = fsx.promises
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const os = require('os')

const HOST_JS = path.join(__dirname, '..', 'host.js')

// ---------- mock subprocess：git 走真二进制；gh 走 mock（cwd 含 .git 才返回 upstream） ----------
const ghCalls = []
const subprocess = {
  async resolveExecutable(name) {
    if (name === 'gh') return 'MOCK_GH'
    const dirs = (process.env.PATH || '').split(';').filter(Boolean)
    const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    for (const d of dirs) for (const ext of exts) { try { fsx.accessSync(path.join(d, name + ext.toLowerCase())); return path.join(d, name + ext.toLowerCase()) } catch (e) { } }
    throw new Error('executable not found: ' + name)
  },
  spawn(spec) {
    const argv = spec.argv
    if (argv[0] === 'MOCK_GH') {
      ghCalls.push({ argv: argv.slice(1), cwd: spec.cwd })
      // mock gh 行为：cwd 必须是 git 仓库才返回成功（否则 fail like real gh "fatal: not a git repository"）
      const cwd = spec.cwd || ''
      const isGitRepo = fsx.existsSync(path.join(cwd, '.git')) ||
        (cwd && spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).status === 0)
      if (!isGitRepo) {
        return { done: Promise.resolve({ exitCode: 128, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'fatal: not a git repository' }) } }, terminate: () => { } }
      }
      // git 仓库：返回 plain text "upstream-org/upstream-repo"（模拟 gh -q .nameWithOwner 提取后的输出，模拟旧 bug 必选 upstream）
      const text = 'upstream-org/upstream-repo\n'
      return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: { readFrom: () => ({ text }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate: () => { } }
    }
    const cp = spawn(argv[0], argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = '', err = ''
    cp.stdout.on('data', d => { out += d })
    cp.stderr.on('data', d => { err += d })
    const done = new Promise(res => cp.on('close', (code, signal) => res({ exitCode: code, signal })))
    return { done, collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: err }) } }, terminate: () => { try { cp.kill() } catch (e) { } } }
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
  async writeText(t, content) { return fsp.writeFile(typeof t === 'string' ? t : t.targetKey || t, content, 'utf8') },
  async mkdir(p) { await fsp.mkdir(p, { recursive: true }) },
  processPath(t) { return typeof t === 'string' ? t : (t.targetKey || t) },
}
function makeSkills() { return { async get() { return undefined }, async list() { return [] } } }
function loadPlugin(services) {
  const handlers = {}
  const harness = { handle: (name, fn) => { handlers[name] = fn } }
  const ctx = { get: n => services[n], effect: fn => { const d = fn(); return typeof d === 'function' ? d : () => { } } }
  const fn = new Function('harness', 'ctx', fsx.readFileSync(HOST_JS, 'utf8'))
  const plugin = fn(harness, ctx)
  plugin.apply(ctx)
  return handlers
}

async function setupGitRepo(remoteSpecs) {
  // remoteSpecs = [{name, url}, ...]
  const tmp = fsx.mkdtempSync(path.join(os.tmpdir(), 't1-'))
  if (spawnSync('git', ['init', '-q', tmp]).status !== 0) throw new Error('git init 失败')
  for (const r of remoteSpecs) spawnSync('git', ['-C', tmp, 'remote', 'add', r.name, r.url])
  spawnSync('git', ['-C', tmp, 'config', 'user.email', 't@t'])
  spawnSync('git', ['-C', tmp, 'config', 'user.name', 't'])
  spawnSync('git', ['-C', tmp, 'commit', '--allow-empty', '-q', '-m', 'init'])
  return tmp
}

async function main() {
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (!cond) console.error('  ✗ FAIL:', name, extra || '')
    else console.log('  ✓', name)
  }

  // ============ 场景 1：Fork（HTTPS origin + upstream）→ getRepoKey 命中 Fork ============
  console.log('--- 场景 1：Fork repo（HTTPS origin + upstream）---')
  const forkDir = await setupGitRepo([
    { name: 'origin', url: 'https://github.com/ForkOwner/ForkRepo.git' },
    { name: 'upstream', url: 'https://github.com/UpstreamOwner/UpstreamRepo.git' },
  ])
  const h1 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap1 = await h1['wf.snapshot']({ cwd: forkDir })
  expect('场景1 · snapshot.repo 命中 Fork（HTTPS）', snap1.repo && snap1.repo.owner === 'ForkOwner' && snap1.repo.name === 'ForkRepo', JSON.stringify(snap1.repo))
  expect('场景1 · snapshot.repo 不是 mock 上游（Tier 1 命中证据）', !(snap1.repo && snap1.repo.owner === 'upstream-org'), JSON.stringify(snap1.repo))

  // ============ 场景 2：单 origin（SSH）→ 命中 origin ============
  console.log('--- 场景 2：单 origin SSH ---')
  const singleDir = await setupGitRepo([{ name: 'origin', url: 'git@github.com:SingleOwner/SingleRepo.git' }])
  const h2 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap2 = await h2['wf.snapshot']({ cwd: singleDir })
  expect('场景2 · snapshot.repo 命中 SSH origin', snap2.repo && snap2.repo.owner === 'SingleOwner' && snap2.repo.name === 'SingleRepo', JSON.stringify(snap2.repo))

  // ============ 场景 3：SSH origin + HTTPS upstream → 命中 SSH Fork ============
  console.log('--- 场景 3：SSH origin + HTTPS upstream ---')
  const sshDir = await setupGitRepo([
    { name: 'origin', url: 'git@github.com:SSHOwner/SSHRepo.git' },
    { name: 'upstream', url: 'https://github.com/UpstreamOwner/UpstreamRepo.git' },
  ])
  const h3 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap3 = await h3['wf.snapshot']({ cwd: sshDir })
  expect('场景3 · snapshot.repo 命中 SSH Fork', snap3.repo && snap3.repo.owner === 'SSHOwner' && snap3.repo.name === 'SSHRepo', JSON.stringify(snap3.repo))

  // ============ 场景 4：origin 缺失（仅 upstream）→ Tier 1/2 失败 → Tier 3 gh mock 返回 upstream ============
  console.log('--- 场景 4：origin 缺失 → 降级到 gh mock ---')
  const noOriginDir = await setupGitRepo([{ name: 'upstream', url: 'https://github.com/OnlyUpstream/OnlyUpstreamRepo.git' }])
  const h4 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap4 = await h4['wf.snapshot']({ cwd: noOriginDir })
  expect('场景4 · snapshot.repo 降级到 gh mock（upstream）', snap4.repo && snap4.repo.owner === 'upstream-org' && snap4.repo.name === 'upstream-repo', JSON.stringify(snap4.repo))

  // ============ 场景 5：缓存按 cwd 隔离 — Tier 1 命中后 repoKeys[cwd] 缓存 ============
  console.log('--- 场景 5：同 cwd 第二次 → repoKeys 缓存命中 ---')
  ghCalls.length = 0
  const snap5 = await h1['wf.snapshot']({ cwd: forkDir })
  expect('场景5 · snapshot.repo 仍是 Fork（缓存）', snap5.repo && snap5.repo.owner === 'ForkOwner' && snap5.repo.name === 'ForkRepo', JSON.stringify(snap5.repo))

  // ============ 场景 6：嵌套仓库（cwd=子目录）→ getRepoRoot 上溯到 repo root ============
  console.log('--- 场景 6：cwd=子目录，git 上溯到 repo root ---')
  const subDir = path.join(forkDir, 'sub', 'nested')
  fsx.mkdirSync(subDir, { recursive: true })
  const h6 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  const snap6 = await h6['wf.snapshot']({ cwd: subDir })
  expect('场景6 · getRepoRoot 上溯，snapshot.repo 命中 Fork', snap6.repo && snap6.repo.owner === 'ForkOwner' && snap6.repo.name === 'ForkRepo', JSON.stringify(snap6.repo))

  // ============ 场景 7：非 Git 目录 → repo=null（Tier 3 gh 也 fail：mock 在非 git dir 返回 exit 128） ============
  console.log('--- 场景 7：非 git 目录 → repo=null ---')
  const tmpDir = fsx.mkdtempSync(path.join(os.tmpdir(), 't1-nongit-'))
  const h7 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap7 = await h7['wf.snapshot']({ cwd: tmpDir })
  expect('场景7 · 非 git 目录 → repo=null', snap7.repo === null, JSON.stringify(snap7.repo))

  // ============ 场景 8：fork 上游与 origin 同名 ============
  console.log('--- 场景 8：origin = upstream（同 owner/name）→ Tier 1 命中 Fork = upstream ---')
  const sameDir = await setupGitRepo([
    { name: 'origin', url: 'https://github.com/SameOwner/SameRepo.git' },
    { name: 'upstream', url: 'https://github.com/SameOwner/SameRepo.git' },
  ])
  const h8 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  const snap8 = await h8['wf.snapshot']({ cwd: sameDir })
  expect('场景8 · 同名退化 → snapshot.repo = SameOwner/SameRepo', snap8.repo && snap8.repo.owner === 'SameOwner' && snap8.repo.name === 'SameRepo', JSON.stringify(snap8.repo))

  // ============ 场景 9：origin 非 GitHub（GitLab）→ Tier 1 解析失败 → Tier 3 gh mock ============
  console.log('--- 场景 9：origin 非 GitHub（gitlab.com）→ Tier 1 失败 → gh mock ---')
  const gitlabDir = await setupGitRepo([{ name: 'origin', url: 'https://gitlab.com/GLabOwner/GLabRepo.git' }])
  const h9 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  const snap9 = await h9['wf.snapshot']({ cwd: gitlabDir })
  expect('场景9 · GitLab origin → gh mock 兜底（upstream）', snap9.repo && snap9.repo.owner === 'upstream-org' && snap9.repo.name === 'upstream-repo', JSON.stringify(snap9.repo))

  // ============ 场景 10：fork 仓库 .git/config 缺 origin（边界）→ Tier 1 失败 + Tier 2 失败 → Tier 3 ============
  console.log('--- 场景 10：origin 在 .git/config 缺失（仅在 fs 层）→ Tier 2 失败 → Tier 3 ---')
  const tmp10 = fsx.mkdtempSync(path.join(os.tmpdir(), 't10-'))
  if (spawnSync('git', ['init', '-q', tmp10]).status !== 0) throw new Error('git init 失败')
  spawnSync('git', ['-C', tmp10, 'config', 'user.email', 't@t'])
  spawnSync('git', ['-C', tmp10, 'config', 'user.name', 't'])
  spawnSync('git', ['-C', tmp10, 'commit', '--allow-empty', '-q', '-m', 'init'])
  // 不加 remote；.git/config 不会有 [remote "origin"]
  const h10 = loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap10 = await h10['wf.snapshot']({ cwd: tmp10 })
  expect('场景10 · .git/config 缺 origin → Tier 2 失败 → Tier 3 gh mock 命中', snap10.repo && snap10.repo.owner === 'upstream-org' && snap10.repo.name === 'upstream-repo', JSON.stringify(snap10.repo))

  const failed = checks.filter(c => !c.pass)
  console.log('')
  console.log('TOTAL', checks.length, 'PASS', checks.length - failed.length, 'FAIL', failed.length)
  process.exit(failed.length ? 1 : 0)
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2) })