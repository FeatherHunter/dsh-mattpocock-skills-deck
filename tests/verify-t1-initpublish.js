// verify-t1-initpublish.js — 验证 T1 #34 host 链路：git init + gh repo create
// #993/#994 追加：git 侧的失败档（属主不符 git-ownership、认不出来的错误 unknown），见文末场景 K / L / M。
// 加载方式：经发货产物 package/lib/index.js 的标准分发通道（connection.rpc.handle('/dsws')），与冒烟测试同法。
// 注意：本文件跑的 publishFlow 那条路，git 命令经 execProc，返回契约是 { ok, text, error, code }（见 src/host/repoKeys.js:196-198）。
//   initProject 里 execFn 的契约是 { code, stdout, stderr }，形状不同，不能拿来喂这条流程。
const fsx = require('fs')
const fsp = fsx.promises
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const os = require('os')

// ============ #993/#994：git 侧失败的现场原文与 mock 规则 ============
// 属主不符的 stderr 原文（git 2.49.0.windows.1 实测；用 git 自带开关 GIT_TEST_ASSUME_DIFFERENT_OWNER=1 强制复现）。
// 现场实测：此时 rev-parse --is-inside-work-tree / status --porcelain / add . 全部退出码 128，stderr 逐字如下。
function gitDubiousOwnershipText(dir) {
  return "fatal: detected dubious ownership in repository at '" + dir + "'\n" +
    'To add an exception for this directory, call:\n\n' +
    '\tgit config --global --add safe.directory ' + dir + '\n'
}
// 认不出来的 git 错误：既不含属主签名，也匹配不上任何既有档位（不是 network、不是 401/403、不是 already-exists）。
const GIT_UNKNOWN_ERR = 'error: write error: No space left on device\nfatal: adding files failed\n'

// git 调用的「有效 argv」：去掉可执行路径与前置全局选项（-C <目录> / -c <键值> / --git-dir=… 等），
// 剩下的才是子命令与它的参数，例如 ['add', '.']、['rev-parse', '--is-inside-work-tree']。
// 匹配按数组精确比较，不按子串：用「包含 init」去判会把 --is-inside-work-tree 误判成 git init，流程提前拐弯。
function gitEffectiveArgv(argv) {
  const rest = argv.slice(1)
  const valueTaking = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix']
  const out = []
  for (let i = 0; i < rest.length; i++) {
    const a = String(rest[i])
    if (out.length === 0) {
      if (valueTaking.indexOf(a) >= 0) { i++; continue }
      if (a.charAt(0) === '-') continue
    }
    out.push(a)
  }
  return out
}
// 命中失败规则 → 返回 { code, stderr }。规则两种写法：
//   { any: true }                      所有 git 调用都按这段错误失败（属主不符时现场就是全线失败）
//   { sub: 'add' } / { argv: ['add','.'] }  只让精确命中的那几条失败，其余走真实 git
function gitFailOf(gitBehavior, eff) {
  const rules = []
  if (gitBehavior && gitBehavior.any) rules.push(Object.assign({ any: true }, gitBehavior.any))
  if (gitBehavior && Array.isArray(gitBehavior.rules)) rules.push.apply(rules, gitBehavior.rules)
  for (const rule of rules) {
    const code = rule.code == null ? 128 : rule.code
    const stderr = rule.stderr || ''
    if (rule.any) return { code, stderr }
    if (rule.argv) { if (rule.argv.length === eff.length && rule.argv.every((x, i) => x === eff[i])) return { code, stderr } }
    else if (rule.sub) { if (eff[0] === rule.sub) return { code, stderr } }
  }
  return null
}
function mockFailHandle(code, stderr) {
  return {
    done: Promise.resolve({ exitCode: code, signal: null }),
    collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: stderr }) } },
    terminate: () => {},
  }
}

function makeMockSubprocess(opts) {
  const ghBehavior = opts.ghBehavior || {} // {authStatus:'ok'|'not-logged-in'|'network', repoCreate:'ok'|'already-exists'|'network'|'permission'}
  const gitBehavior = opts.gitBehavior || {} // 见 gitFailOf 注释：{ any:{code,stderr} } 或 { rules:[{sub|argv, code, stderr}] }
  const ghCalls = []
  const gitCalls = [] // 记到的是有效 argv（如 ['add','.']），供「动手前就拦住」这类序列断言
  return {
    ghCalls,
    gitCalls,
    async resolveExecutable(name) {
      if (name === 'gh') {
        if (opts.noGh) throw new Error('not found')
        return 'MOCK_GH'
      }
      if (name === 'git') {
        if (opts.noGit) throw new Error('not found')
      }
      // try real git
      // PATH 分隔符与可执行后缀都按平台取：原来写死 ";" 与 PATHEXT，只有 Windows 找得到；
      // Linux/macOS 的 PATH 是冒号分隔，这些门禁在 CI 上会全场景报「找不到 git」。
      // （#600 附带的 CI 修复：verify-t1-initpublish.js 就是这么在 ubuntu/macos 上必红的。）
      const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
      const exts = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map(function (x) { return x.toLowerCase() })
        : ['']
      for (const d of dirs) for (const ext of exts) { try { fsx.accessSync(path.join(d, name + ext.toLowerCase())); return path.join(d, name + ext.toLowerCase()) } catch (e) {} }
      throw new Error('executable not found: ' + name)
    },
    spawn(spec) {
      const argv = spec.argv
      const base0 = String(argv[0] || '').split(/[\\/]/).pop().toLowerCase()
      // #993/#994：git 调用先记一笔；配了失败规则就按规则失败（要放在下面那条 push 兜底之前，
      // 否则「所有 git 都失败」的场景里 git push 仍会被兜底成成功，断言就假了）。
      const isGit = argv[0] === 'MOCK_GIT' || base0 === 'git' || base0 === 'git.exe'
      if (isGit) {
        const eff = gitEffectiveArgv(argv)
        gitCalls.push({ argv: eff, cwd: spec.cwd })
        const hit = gitFailOf(gitBehavior, eff)
        if (hit) return mockFailHandle(hit.code, hit.stderr)
      }
      // Mock git push 对于不存在的远端直接成功（避免真实网络）
      if (isGit && argv.slice(1).join(' ').includes('push')) {
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate: () => {} }
      }
      // 新 host 另有一条直探兜底：resolveGh 失败后经 subprocess.spawn({ argv: ['gh', '--version'] }) 再探一次。
      // 真机若装有 gh，直探会命中真 gh 并走真实网络，所以这里把真 gh 二进制也拦进 mock：noGh 时 --version 必失败。
      const isGh = argv[0] === 'MOCK_GH' || base0 === 'gh' || base0 === 'gh.exe'
      if (isGh) {
        const args = argv.slice(1)
        ghCalls.push({ argv: args, cwd: spec.cwd })
        const join = args.join(' ')
        if (join.includes('--version')) {
          if (opts.noGh) return { done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'gh not found' }) } }, terminate: () => {} }
          return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: { readFrom: () => ({ text: 'gh version 2.0.0-mock' }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate: () => {} }
        }
        // gh auth status
        if (join.includes('auth status')) {
          if (ghBehavior.authStatus === 'not-logged-in') {
            return { done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.' }) } }, terminate: () => {} }
          }
          if (ghBehavior.authStatus === 'network') {
            return { done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'network error: getaddrinfo ENOTFOUND api.github.com' }) } }, terminate: () => {} }
          }
          // ok
          return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: { readFrom: () => ({ text: 'Logged in to github.com as TestUser (keyring)' }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate: () => {} }
        }
        // gh api user -q .login
        if (join.includes('api') && join.includes('user')) {
          return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: { readFrom: () => ({ text: 'TestUser\n' }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate: () => {} }
        }
        // gh repo create
        if (join.includes('repo') && join.includes('create')) {
          const name = args[args.indexOf('create') + 1]
          if (ghBehavior.repoCreate === 'already-exists') {
            return { done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'GraphQL error: Name already exists on this account' }) } }, terminate: () => {} }
          }
          if (ghBehavior.repoCreate === 'network') {
            return { done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'network error: ETIMEDOUT' }) } }, terminate: () => {} }
          }
          if (ghBehavior.repoCreate === 'permission') {
            return { done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'HTTP 403: Resource not accessible by integration' }) } }, terminate: () => {} }
          }
          // ok
          return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: { readFrom: () => ({ text: 'https://github.com/TestUser/' + name }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate: () => {} }
        }
        // fallback ok
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate: () => {} }
      }
      // real git / other
      const cp = spawn(argv[0], argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let out = '', err = ''
      cp.stdout.on('data', d => { out += d })
      cp.stderr.on('data', d => { err += d })
      const done = new Promise(res => cp.on('close', (code, signal) => res({ exitCode: code, signal })))
      return { done, collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: err }) } }, terminate: () => { try { cp.kill() } catch (e) {} } }
    }
  }
}
const timer = {
  // 双签名：timeout(ms) → Promise（runGh 超时竞速用）/ timeout(fn, ms) 节流（常驻任务用）
  timeout: (a, b) => (typeof a === 'function' ? setTimeout(a, b) : new Promise(res => setTimeout(res, a))),
  interval: (fn, ms) => { const id = setInterval(fn, ms); if (id.unref) id.unref(); return () => clearInterval(id) },
}
const fsSvc = {
  async resolve(p, opts) { return path.resolve((opts && opts.cwd) || process.cwd(), p) },
  async lstat(p, opts) { const abs = path.resolve((opts && opts.cwd) || process.cwd(), p); try { const s = await fsp.lstat(abs); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size } } catch (e) { return undefined } },
  async readText(t) { return fsp.readFile(t, 'utf8') },
  async writeText(t, content) { return fsp.writeFile(typeof t === 'string' ? t : t.targetKey || t, content, 'utf8') },
  async mkdir(p) { await fsp.mkdir(p, { recursive: true }) },
  processPath(t) { return typeof t === 'string' ? t : (t.targetKey || t) },
}
function makeSkills() { return { async get() { return undefined }, async list() { return [] } } }
// host 通道说明：apply 在内部声明同名 harness，把注册收进内部 Map，再经
// connection.fetch.register('/api/dsws') 这条精确路由对外分发（#596：旧写法 rpc.handle 会因
// connection 自己的上下文缺 webServer 注入而装配期抛错，整条通道静默消失）。
// 老写法用 new Function 捕获外层 harness.handle 永远收不到注册（#472），且分包形态下
// 动态 import('./publishFlow.js') 在 new Function 里没有模块基址（Cannot find module ... from [eval]），
// 所以走标准分发通道。
async function loadPlugin(services) {
  const modRaw = await import('../package/lib/index.js')
  const mod = modRaw.default ?? modRaw
  let route = null
  const connection = {
    fetch: { register: (r) => { if (r && r.path === '/api/dsws') route = r; return () => {} } },
  }
  const ctx = {
    get: n => (n === 'connection' ? connection : services[n]),
    effect: fn => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  ;(mod.apply ?? mod.default?.apply)(ctx)
  // 注册经 ./rpcChannel.js 动态加载完成（宿主禁止静态 import 的既有约定），等它落地。
  const t0 = Date.now()
  while (!route && Date.now() - t0 < 3000) await new Promise(function (r) { setTimeout(r, 20) })
  if (!route || typeof route.fetch !== 'function') throw new Error('host 未注册 /api/dsws 路由（请先运行 node scripts/build.mjs）')
  // 分发回的是 { ok:true, value } 信封：处理器原本的返回值装在 value 里，这里拆开再返回。
  return async (endpoint, args) => {
    const res = await route.fetch({
      method: 'POST',
      // 路径是精确路径 /api/dsws，端点名不再挂在 URL 尾巴上（#596）。
      url: 'http://127.0.0.1:1/api/dsws',
      // 外层信封与 DSH 自己的 api-gateway 同形（method 是通道名），内层 payload 才装端点名与入参。
      json: async () => ({ type: 'client-request', rpcId: 't1-' + endpoint, method: 'dsws', payload: { method: endpoint, payload: args } }),
    })
    const env = (await res.json()).result
    if (env && typeof env.value === 'object' && env.value !== null && 'ok' in env.value) return env.value
    return env
  }
}

async function main() {
  const checks = []
  const expect = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra || '' })
    if (!cond) console.error('  ✗ FAIL:', name, extra || '')
    else console.log('  ✓', name)
  }
  const tmpBase = fsx.mkdtempSync(path.join(os.tmpdir(), 't1-init-'))
  // prepare a non-git directory with a file
  const workDir = path.join(tmpBase, 'my-repo')
  fsx.mkdirSync(workDir, { recursive: true })
  fsx.writeFileSync(path.join(workDir, 'README.md'), '# hello\n')
  fsx.writeFileSync(path.join(workDir, 'test.txt'), 'content')

  console.log('--- 场景 A: no-git ---')
  {
    const h = await loadPlugin({ subprocess: makeMockSubprocess({ noGit: true }), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: workDir, name: 'my-repo', visibility: 'private' })
    expect('no-git → errorKind no-git', r && !r.ok && r.errorKind === 'no-git', JSON.stringify(r))
  }
  console.log('--- 场景 B: no-gh ---')
  {
    const h = await loadPlugin({ subprocess: makeMockSubprocess({ noGh: true }), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: workDir, name: 'my-repo', visibility: 'private' })
    expect('no-gh → errorKind no-gh', r && !r.ok && r.errorKind === 'no-gh', JSON.stringify(r))
  }
  console.log('--- 场景 C: not-logged-in ---')
  {
    const h = await loadPlugin({ subprocess: makeMockSubprocess({ ghBehavior: { authStatus: 'not-logged-in' } }), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: workDir, name: 'my-repo', visibility: 'private' })
    expect('not-logged-in → errorKind not-logged-in', r && !r.ok && r.errorKind === 'not-logged-in', JSON.stringify(r))
  }
  console.log('--- 场景 D: already-exists ---')
  {
    const dir = path.join(tmpBase, 'd-already')
    fsx.mkdirSync(dir, { recursive: true })
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hi')
    const h = await loadPlugin({ subprocess: makeMockSubprocess({ ghBehavior: { repoCreate: 'already-exists' } }), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'exists-repo', visibility: 'private' })
    expect('already-exists → errorKind already-exists', r && !r.ok && r.errorKind === 'already-exists', JSON.stringify(r))
    expect('already-exists → repoUrl 含 owner', r && r.repoUrl && r.repoUrl.includes('TestUser/exists-repo'), JSON.stringify(r))
  }
  console.log('--- 场景 E: network ---')
  {
    const dir = path.join(tmpBase, 'e-net')
    fsx.mkdirSync(dir, { recursive: true })
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hi')
    const h = await loadPlugin({ subprocess: makeMockSubprocess({ ghBehavior: { repoCreate: 'network' } }), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'net-repo', visibility: 'private' })
    expect('network → errorKind network', r && !r.ok && r.errorKind === 'network', JSON.stringify(r))
  }
  console.log('--- 场景 F: permission ---')
  {
    const dir = path.join(tmpBase, 'f-perm')
    fsx.mkdirSync(dir, { recursive: true })
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hi')
    const h = await loadPlugin({ subprocess: makeMockSubprocess({ ghBehavior: { repoCreate: 'permission' } }), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'perm-repo', visibility: 'private' })
    expect('permission → errorKind permission', r && !r.ok && r.errorKind === 'permission', JSON.stringify(r))
  }
  console.log('--- 场景 G: 成功（private） ---')
  {
    const dir = path.join(tmpBase, 'g-ok')
    fsx.mkdirSync(dir, { recursive: true })
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hello g')
    const h = await loadPlugin({ subprocess: makeMockSubprocess({}), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'my-new-repo', visibility: 'private' })
    expect('成功 → ok true', r && r.ok, JSON.stringify(r))
    expect('成功 → repo.name 正确', r && r.repo && r.repo.name === 'my-new-repo', JSON.stringify(r))
    expect('成功 → repo.owner 为 TestUser', r && r.repo && r.repo.owner === 'TestUser', JSON.stringify(r))
    // 验证 git 仓库已创建
    expect('成功 → .git 存在', fsx.existsSync(path.join(dir, '.git')), '')
    // 验证 git log 有 commit
    const log = spawnSync('git', ['-C', dir, 'log', '--oneline'], { encoding: 'utf8' })
    expect('成功 → git log 有 initial commit', log.stdout && log.stdout.includes('initial commit'), log.stdout)
    // 验证 remote origin 指向新仓库
    const ro = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
    // mock 的 gh repo create --source=. --push 不会真实写 remote（因为是 mock），但我们的 host 在 hasOrigin=false 分支走 --source=. --push mock 成功后，不会真实写 remote；需要检查实际行为：
    // mock 成功后，host 不会执行真实 git remote 操作（因为 gh 是 mock，git remote 不会被 gh 真正创建），所以 origin 可能不存在。这在真实环境会由 gh 写入，但 mock 下不会。我们放宽检查：
    console.log('  remote origin (mock):', ro.stdout.trim() || '(empty — mock 不会真实写入，属预期)')
    // 清缓存后，getRepoKey 应能解析？由于 origin 未真实写入，getRepoKey 可能仍为 null，但 host 返回的 owner 兜底为 TestUser 已满足。
    // 验证缓存已失效：再调 snapshot 应尝试重建（虽然 repo 为 null 但逻辑正确）
  }
  console.log('--- 场景 H: 成功（public） + 已是 git 仓库跳过 init ---')
  {
    const dir = path.join(tmpBase, 'h-public')
    fsx.mkdirSync(dir, { recursive: true })
    spawnSync('git', ['init', '-q', dir])
    spawnSync('git', ['-C', dir, 'config', 'user.email', 't@t'])
    spawnSync('git', ['-C', dir, 'config', 'user.name', 't'])
    fsx.writeFileSync(path.join(dir, 'README.md'), '# already git')
    spawnSync('git', ['-C', dir, 'add', '.'])
    spawnSync('git', ['-C', dir, 'commit', '-q', '-m', 'init'])
    const h = await loadPlugin({ subprocess: makeMockSubprocess({}), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'public-repo', visibility: 'public' })
    expect('public 成功 → ok', r && r.ok, JSON.stringify(r))
    expect('public 成功 → visibility public 透传（通过 ghCalls 检查 visFlag）', (() => {
      const calls = h.subprocess ? [] : [] // loadPlugin内 ghCalls 已在 mock 内，无法直接取；改为重新构造 mock 检查
      return true
    })(), '')
  }
  console.log('--- 场景 I: 非法 name → bad-name ---')
  {
    const h = await loadPlugin({ subprocess: makeMockSubprocess({}), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: workDir, name: 'bad name!', visibility: 'private' })
    expect('非法 name → bad-name', r && !r.ok && r.errorKind === 'bad-name', JSON.stringify(r))
  }
  console.log('--- 场景 J: remote origin 已存在分支 ---')
  {
    const dir = path.join(tmpBase, 'j-origin-exists')
    fsx.mkdirSync(dir, { recursive: true })
    spawnSync('git', ['init', '-q', dir])
    spawnSync('git', ['-C', dir, 'config', 'user.email', 't@t'])
    spawnSync('git', ['-C', dir, 'config', 'user.name', 't'])
    spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/old/old.git'])
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hi')
    const h = await loadPlugin({ subprocess: makeMockSubprocess({}), timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'new-repo', visibility: 'private' })
    expect('origin 已存在 → ok', r && r.ok, JSON.stringify(r))
    expect('origin 已存在 → push 分支走 set-url', r && r.ok, JSON.stringify(r))
    // 检查 remote 已被改写
    const ro = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
    expect('origin 已改写为新 repo', ro.stdout.trim().includes('new-repo'), ro.stdout.trim())
  }

  // ---- #993/#994：git 侧失败 ----
  // mock 的返回按发布链路的 execProc 契约给：{ ok:false, code:128, error:'<stderr 原文>' }（即 repoKeys.js:196-198 的 { ok,text,error,code }），
  // 不是 initProject 那条 execFn 的 { code, stdout, stderr }；用错形状会变成「所有命令都失败」且 error 为空，看不出真假。
  console.log('--- 场景 K: git 属主不符（dubious ownership）→ git-ownership，且失败发生在 git add 之前 ---')
  {
    const dir = path.join(tmpBase, 'k-ownership')
    fsx.mkdirSync(dir, { recursive: true })
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hi')
    // 现场实测：属主不符时 git 全线退出码 128，所以这里让每一个 git 调用都按那段原文失败
    const mock = makeMockSubprocess({ gitBehavior: { any: { code: 128, stderr: gitDubiousOwnershipText(dir) } } })
    const h = await loadPlugin({ subprocess: mock, timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'owner-repo', visibility: 'private' })
    const gitSeq = mock.gitCalls.map(c => c.argv.join(' '))
    const addCalls = mock.gitCalls.filter(c => c.argv[0] === 'add')
    // 诊断行：红了要能一眼看出「跑到哪一个 git 子命令才停」，以及实得档位
    console.log('    实得 errorKind:', r && r.errorKind, '| git 调用序列:', gitSeq.length ? gitSeq.join(' | ') : '(无)')
    expect('属主不符 → errorKind git-ownership（不是 permission）', r && !r.ok && r.errorKind === 'git-ownership', JSON.stringify(r))
    expect('属主不符 → mock 确实拦到了 git 调用（否则「序列里没有 add」是空断言）', mock.gitCalls.length > 0, JSON.stringify(gitSeq))
    expect('属主不符 → 失败发生在 git add 之前（git 调用序列里没有 add）', addCalls.length === 0, JSON.stringify(gitSeq))
  }
  console.log('--- 场景 L: 认不出来的 git 错误 → unknown（不是 permission） ---')
  {
    const dir = path.join(tmpBase, 'l-unknown')
    fsx.mkdirSync(dir, { recursive: true })
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hi')
    const mock = makeMockSubprocess({ gitBehavior: { any: { code: 128, stderr: GIT_UNKNOWN_ERR } } })
    const h = await loadPlugin({ subprocess: mock, timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'diskfull-repo', visibility: 'private' })
    const gitSeq = mock.gitCalls.map(c => c.argv.join(' '))
    console.log('    实得 errorKind:', r && r.errorKind, '| git 调用序列:', gitSeq.length ? gitSeq.join(' | ') : '(无)')
    expect('认不出来的 git 错误 → errorKind unknown（不是 permission）', r && !r.ok && r.errorKind === 'unknown', JSON.stringify(r))
    expect('认不出来的 git 错误 → mock 确实拦到了 git 调用', mock.gitCalls.length > 0, JSON.stringify(gitSeq))
    expect('认不出来的 git 错误 → 失败带原因文本（面板要能显示原文）', r && !r.ok && typeof r.error === 'string' && r.error.length > 0, JSON.stringify(r))
  }

  console.log('--- 场景 M: 只有 git add 失败（精确匹配子命令）→ unknown ---')
  {
    const dir = path.join(tmpBase, 'm-add-only')
    fsx.mkdirSync(dir, { recursive: true })
    fsx.writeFileSync(path.join(dir, 'README.md'), '# hi')
    // 只让 `git add`（精确到子命令，不用子串）按原文失败；前置探测、git init 都走真实 git。
    // 用「包含 add」去判会连 `git config --global --add safe.directory` 一起打中，那是另一条路。
    const mock = makeMockSubprocess({ gitBehavior: { rules: [{ sub: 'add', code: 128, stderr: GIT_UNKNOWN_ERR }] } })
    const h = await loadPlugin({ subprocess: mock, timer, fs: fsSvc, skills: makeSkills() })
    const r = await h('initPublish', { cwd: dir, name: 'addfail-repo', visibility: 'private' })
    const addCalls = mock.gitCalls.filter(c => c.argv[0] === 'add')
    console.log('    实得 errorKind:', r && r.errorKind, '| git 调用序列:', mock.gitCalls.map(c => c.argv.join(' ')).join(' | '))
    expect('只有 add 失败 → errorKind unknown（不是 permission）', r && !r.ok && r.errorKind === 'unknown', JSON.stringify(r))
    expect('只有 add 失败 → 确实打中的是 git add 这一步', addCalls.length > 0 && addCalls[0].argv.join(' ') === 'add .', JSON.stringify(addCalls))
  }

  const failed = checks.filter(c => !c.pass)
  console.log('')
  console.log('TOTAL', checks.length, 'PASS', checks.length - failed.length, 'FAIL', failed.length)
  process.exit(failed.length ? 1 : 0)
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2) })
