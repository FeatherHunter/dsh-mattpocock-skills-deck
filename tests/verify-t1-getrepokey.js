// verify-t1-getrepokey.js — #41 T1 修复验证：getRepoKey 显式解析 origin
// 多远程下（旧实现 → `gh repo view` 命中 upstream；新实现 → `git remote get-url origin` 命中 Fork）
// 用法：node tests/verify-t1-getrepokey.js
// 依赖：node + 本机 git（PATH）。不依赖 gh（gh 走 mock，可控返回 upstream 模拟 gh 旧 bug）
//
// #656 收编说明（2026-09-19）：
//   ① 本用例此前不在 npm run verify 链上，长期没人跑，加载宿主的老写法已经失效（老写法用 new Function
//      捕获外层 harness.handle，而宿主早改成在 apply 内部自带同名 harness 收注册、再经 /api/dsws 分发）。
//      现在改走宿主的正规分发通道（与 verify-t1-initpublish.js 同一做法），并把本文件挂进 verify 链。
//   ② 场景 6（cwd 是子目录）是本仓库里唯一一条按「会话所选目录在仓库子目录里」跑的用例：#652 起
//      工作区身份要锚到工作区根，场景 6 就是这条规则的回归点——cwd 在子目录里，照样命中仓库根那个仓库。

const fsx = require('fs')
const fsp = fsx.promises
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const os = require('os')

// ---------- mock subprocess：git 走真二进制；gh 走 mock（cwd 含 .git 才返回成功） ----------
const ghCalls = []
/** 这条命令是不是被 mock 的那条 gh：宿主在不同链上写的是 'gh'，解析出来的可能是 MOCK_GH 或真路径。 */
function isGhArgv(arg0) {
  const s = String(arg0 || '')
  return s === 'MOCK_GH' || /(^|[\\/])gh(\.exe)?$/i.test(s)
}
/** mock gh 的回包：三条形状（退出码 / 标准输出 / 标准错误）。 */
function mockGhResult(exitCode, text, errText) {
  return {
    done: Promise.resolve({ exitCode, signal: null }),
    collected: {
      stdout: { readFrom: () => ({ text: text || '' }) },
      stderr: { readFrom: () => ({ text: errText || '' }) },
    },
    terminate: () => { },
  }
}
/**
 * mock gh 按参数分岔答复。
 * 为什么必须分岔：快照这条路早就不止 `gh repo view` 一条命令了——它还会走 `gh auth status`（登录预检）、
 * `gh api graphql`（地图详情）、`gh api repos/<owner>/<repo>/issues|pulls`（REST 兜底）、`gh api user`。
 * 老写法对每条命令都回同一段仓库名字，那些 JSON 分支解析必炸，整条快照就成了失败包、`repo` 也跟着没了
 * （本文件长期不在 verify 链上，所以一直没被发现）。
 * 这里只需要形状正确：本用例断言的是「仓库是谁」，不是票面内容，所以除 `repo view` 外内容一律为空。
 */
function ghAnswer(args) {
  const a = (args || []).join(' ')
  if (a.indexOf('auth status') === 0) return 'Logged in to github.com\n'
  if (a.indexOf('repo view') === 0) return 'upstream-org/upstream-repo\n'
  if (a.indexOf('api graphql') === 0) return JSON.stringify({ data: {} })
  if (a.indexOf('api user') === 0) return JSON.stringify({ login: 'mock-user' })
  if (/^api repos\/[^\/\s]+\/[^\/\s]+$/.test(a)) return '{}'
  return '[]'
}
const subprocess = {
  async resolveExecutable(name) {
    if (name === 'gh') return 'MOCK_GH'
    // PATH 分隔符与可执行后缀都按平台取：原来写死 ";" 与 PATHEXT，只有 Windows 找得到；
    // Linux/macOS 的 PATH 是冒号分隔，这些门禁在 CI 上会全场景报「找不到 git」。
    // （#600 附带的 CI 修复：verify-t1-initpublish.js 就是这么在 ubuntu/macos 上必红的。）
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    const exts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map(function (x) { return x.toLowerCase() })
      : ['']
    for (const d of dirs) for (const ext of exts) { try { fsx.accessSync(path.join(d, name + ext.toLowerCase())); return path.join(d, name + ext.toLowerCase()) } catch (e) { } }
    throw new Error('executable not found: ' + name)
  },
  spawn(spec) {
    const argv = spec.argv
    if (isGhArgv(argv[0])) {
      ghCalls.push({ argv: argv.slice(1), cwd: spec.cwd })
      // mock gh 行为：cwd 必须是 git 仓库才返回成功（否则 fail like real gh "fatal: not a git repository"）
      const cwd = spec.cwd || ''
      const isGitRepo = fsx.existsSync(path.join(cwd, '.git')) ||
        (cwd && spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).status === 0)
      if (!isGitRepo) return mockGhResult(128, '', 'fatal: not a git repository')
      return mockGhResult(0, ghAnswer(argv.slice(1)), '')
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

// 加载宿主并拿到分发函数（与 verify-t1-initpublish.js 同一条路）：
//   宿主在 apply 内部自带 harness，把各端点收进内部表，再经 connection.fetch.register('/api/dsws') 对外分发。
//   这里就是给宿主一个假的 connection、把那条路由接下来，然后按信封形状调它。
//   注意端点名的写法：注册时 `wf.snapshot` 会去掉 `wf.` 前缀存成 `snapshot`（见 src/host/index.js 的 harness shim），
//   所以下面调的是 `snapshot`，不是 `wf.snapshot`。
async function loadPlugin(services) {
  const modRaw = await import('../package/lib/index.js')
  const mod = modRaw.default ?? modRaw
  let route = null
  const connection = {
    fetch: { register: (r) => { if (r && r.path === '/api/dsws') route = r; return () => {} } },
  }
  const ctx = {
    get: n => (n === 'connection' ? connection : services[n]),
    effect: fn => { const d = fn(); return typeof d === 'function' ? d : () => { } },
  }
  ;(mod.apply ?? mod.default?.apply)(ctx)
  const t0 = Date.now()
  while (!route && Date.now() - t0 < 3000) await new Promise(function (r) { setTimeout(r, 20) })
  if (!route || typeof route.fetch !== 'function') throw new Error('宿主未注册 /api/dsws 路由（请先运行 node scripts/build.mjs）')
  // 分发回的是 { ok:true, value } 信封：处理器原本的返回值装在 value 里，这里拆开再返回。
  return async (endpoint, args) => {
    const res = await route.fetch({
      method: 'POST',
      url: 'http://127.0.0.1:1/api/dsws',
      json: async () => ({ type: 'client-request', rpcId: 't1-' + endpoint, method: 'dsws', payload: { method: endpoint, payload: args } }),
    })
    const env = (await res.json()).result
    if (env && typeof env.value === 'object' && env.value !== null && 'ok' in env.value) return env.value
    return env
  }
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
  // 宿主的磁盘快照缓存落在「进程当前目录/.dsh-mattskillsdeck-cache」下，是按仓库名共用的，跨运行会留着。
  // 本用例的临时仓库都叫 ForkOwner/ForkRepo 这类固定名字，若不隔离，上一次运行留下的缓存会被回放，
  // 断言到的就不是这一次算出来的东西（实测：快照回包里的工作区根是上一次运行的临时路径）。
  // 所以先切到一个一次性的临时目录，宿主的缓存读写都落在里面，跑完清掉。
  const originalCwd = process.cwd()
  const isolationRoot = fsx.mkdtempSync(path.join(os.tmpdir(), 't1-isolated-'))
  process.chdir(isolationRoot)
  const done = (code) => {
    try { process.chdir(originalCwd); fsx.rmSync(isolationRoot, { recursive: true, force: true }) } catch (e) { }
    process.exit(code)
  }
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
  const h1 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap1 = await h1('snapshot', { cwd: forkDir })
  expect('场景1 · snapshot.repo 命中 Fork（HTTPS）', snap1.repo && snap1.repo.owner === 'ForkOwner' && snap1.repo.name === 'ForkRepo', JSON.stringify(snap1.repo))
  expect('场景1 · snapshot.repo 不是 mock 上游（Tier 1 命中证据）', !(snap1.repo && snap1.repo.owner === 'upstream-org'), JSON.stringify(snap1.repo))

  // ============ 场景 2：单 origin（SSH）→ 命中 origin ============
  console.log('--- 场景 2：单 origin SSH ---')
  const singleDir = await setupGitRepo([{ name: 'origin', url: 'git@github.com:SingleOwner/SingleRepo.git' }])
  const h2 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap2 = await h2('snapshot', { cwd: singleDir })
  expect('场景2 · snapshot.repo 命中 SSH origin', snap2.repo && snap2.repo.owner === 'SingleOwner' && snap2.repo.name === 'SingleRepo', JSON.stringify(snap2.repo))

  // ============ 场景 3：SSH origin + HTTPS upstream → 命中 SSH Fork ============
  console.log('--- 场景 3：SSH origin + HTTPS upstream ---')
  const sshDir = await setupGitRepo([
    { name: 'origin', url: 'git@github.com:SSHOwner/SSHRepo.git' },
    { name: 'upstream', url: 'https://github.com/UpstreamOwner/UpstreamRepo.git' },
  ])
  const h3 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap3 = await h3('snapshot', { cwd: sshDir })
  expect('场景3 · snapshot.repo 命中 SSH Fork', snap3.repo && snap3.repo.owner === 'SSHOwner' && snap3.repo.name === 'SSHRepo', JSON.stringify(snap3.repo))

  // ============ 场景 4：origin 缺失（仅 upstream）→ Tier 1/2 失败 → Tier 3 gh mock 返回 upstream ============
  console.log('--- 场景 4：origin 缺失 → 降级到 gh mock ---')
  const noOriginDir = await setupGitRepo([{ name: 'upstream', url: 'https://github.com/OnlyUpstream/OnlyUpstreamRepo.git' }])
  const h4 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap4 = await h4('snapshot', { cwd: noOriginDir })
  expect('场景4 · snapshot.repo 降级到 gh mock（upstream）', snap4.repo && snap4.repo.owner === 'upstream-org' && snap4.repo.name === 'upstream-repo', JSON.stringify(snap4.repo))

  // ============ 场景 5：缓存按 cwd 隔离 — Tier 1 命中后 repoKeys[cwd] 缓存 ============
  console.log('--- 场景 5：同 cwd 第二次 → repoKeys 缓存命中 ---')
  ghCalls.length = 0
  const snap5 = await h1('snapshot', { cwd: forkDir })
  expect('场景5 · snapshot.repo 仍是 Fork（缓存）', snap5.repo && snap5.repo.owner === 'ForkOwner' && snap5.repo.name === 'ForkRepo', JSON.stringify(snap5.repo))

  // ============ 场景 6：嵌套仓库（cwd=子目录）→ 归到仓库根，getRepoKey 命中 Fork ============
  // #652 起这条不只是「git 会往上找」：工作区身份本身要锚到工作区根（自带 .git 或自带主锚文件的最近一层），
  // 所以父仓库的子目录会话算出来的仓库身份仍是 ForkOwner/ForkRepo。这条在本仓库里独一份，进门禁就是为了它。
  console.log('--- 场景 6：cwd=子目录，归到仓库根 ---')
  const subDir = path.join(forkDir, 'sub', 'nested')
  fsx.mkdirSync(subDir, { recursive: true })
  const h6 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  const snap6 = await h6('snapshot', { cwd: subDir })
  expect('场景6 · cwd 在子目录里，snapshot.repo 仍命中 Fork（工作区身份归到仓库根）', snap6.repo && snap6.repo.owner === 'ForkOwner' && snap6.repo.name === 'ForkRepo', JSON.stringify(snap6.repo))
  expect('场景6 · 回包里带着工作区根，且就是仓库根这一条（客户端靠它分桶）', snap6.workspaceRoot && path.resolve(snap6.workspaceRoot).toLowerCase() === path.resolve(forkDir).toLowerCase(), String(snap6.workspaceRoot))

  // ============ 场景 7：非 Git 目录 → repo=null（Tier 3 gh 也 fail：mock 在非 git dir 返回 exit 128） ============
  console.log('--- 场景 7：非 git 目录 → repo=null ---')
  const tmpDir = fsx.mkdtempSync(path.join(os.tmpdir(), 't1-nongit-'))
  const h7 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const snap7 = await h7('snapshot', { cwd: tmpDir })
  expect('场景7 · 非 git 目录 → repo=null', snap7.repo === null, JSON.stringify(snap7.repo))

  // ============ 场景 8：fork 上游与 origin 同名 ============
  console.log('--- 场景 8：origin = upstream（同 owner/name）→ Tier 1 命中 Fork = upstream ---')
  const sameDir = await setupGitRepo([
    { name: 'origin', url: 'https://github.com/SameOwner/SameRepo.git' },
    { name: 'upstream', url: 'https://github.com/SameOwner/SameRepo.git' },
  ])
  const h8 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  const snap8 = await h8('snapshot', { cwd: sameDir })
  expect('场景8 · 同名退化 → snapshot.repo = SameOwner/SameRepo', snap8.repo && snap8.repo.owner === 'SameOwner' && snap8.repo.name === 'SameRepo', JSON.stringify(snap8.repo))

  // ============ 场景 9：origin 非 GitHub（GitLab）→ Tier 1 的 GitHub 解析不认它 ============
  // #656 收编时对齐（2026-09-19）：这条原来断言「GitHub 的 gh 兜底把它当成 upstream-org」。
  // 那是插件还没有 GitLab 后端时的行为；现在 gitlab.com 的远端会被 GitLab 后端认出来（detect 得 gitlab），
  // 快照走 GitLab 自己那条链，本机没有 glab 时如实报环境问题。所以这条改成断言当前的真结论：
  //   Tier 1 的 GitHub 解析不认这个远端（不再把它当 GitHub），且后端判断交给 GitLab。
  console.log('--- 场景 9：origin 非 GitHub（gitlab.com）→ GitHub 解析不认它 ---')
  const gitlabDir = await setupGitRepo([{ name: 'origin', url: 'https://gitlab.com/GLabOwner/GLabRepo.git' }])
  const h9 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  const det9 = await h9('detect', { cwd: gitlabDir })
  expect('场景9 · gitlab.com 远端被认出是 GitLab 后端（不再被当成 GitHub）', det9.ok === true && det9.selection && det9.selection.backendId === 'gitlab', JSON.stringify(det9.selection))
  const snap9 = await h9('snapshot', { cwd: gitlabDir })
  expect('场景9 · 这条路走 GitLab 自己的链，不会掉头回去用 gh 造一个 GitHub 身份', !(snap9.repo && snap9.repo.owner === 'upstream-org'), JSON.stringify(snap9.repo))

  // ============ 场景 10：.git/config 缺 origin（且一个远端都没有）→ 得不出后端，repo 如实为 null ============
  // #656 收编时对齐（2026-09-19）：这条原来断言「Tier 1/2 都失败后由 gh mock 兜底拿到 upstream-org」。
  // 现在「这个目录是什么后端」由探测链先判：没有 GitHub 远端、没有主锚文件 → 得不出后端（fallback），
  // 快照如实回 repo=null。硬拿 gh 在当前目录兜一个仓库身份，正是当年 #41 要修的那类串仓库问题。
  console.log('--- 场景 10：没有远端 → 得不出后端 → repo=null ---')
  const tmp10 = fsx.mkdtempSync(path.join(os.tmpdir(), 't10-'))
  if (spawnSync('git', ['init', '-q', tmp10]).status !== 0) throw new Error('git init 失败')
  spawnSync('git', ['-C', tmp10, 'config', 'user.email', 't@t'])
  spawnSync('git', ['-C', tmp10, 'config', 'user.name', 't'])
  spawnSync('git', ['-C', tmp10, 'commit', '--allow-empty', '-q', '-m', 'init'])
  // 不加 remote；.git/config 不会有 [remote "origin"]
  const h10 = await loadPlugin({ subprocess, timer, fs: fsSvc, skills: makeSkills() })
  ghCalls.length = 0
  const det10 = await h10('detect', { cwd: tmp10 })
  const snap10 = await h10('snapshot', { cwd: tmp10 })
  expect('场景10 · 没有远端、没有主锚 → detect 得不出后端（fallback）', det10.ok === true && det10.selection && det10.selection.backendId === null && det10.selection.source === 'fallback', JSON.stringify(det10.selection))
  expect('场景10 · snapshot.repo 如实为 null（不拿 gh 兜一个身份出来）', snap10.repo === null, JSON.stringify(snap10.repo))

  const failed = checks.filter(c => !c.pass)
  console.log('')
  console.log('TOTAL', checks.length, 'PASS', checks.length - failed.length, 'FAIL', failed.length)
  done(failed.length ? 1 : 0)
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2) })

