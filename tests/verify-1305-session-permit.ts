// tests/verify-1305-session-permit.ts —— #1305 门禁：往工作区文件里写东西，要先拿到「这一次请求的会话」的许可。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1305-session-permit.ts，可独立运行。
//
// 盯什么：
//   A 同一个工作区有两个活会话、电话不带会话号 → 如实失败，失败原因分到「没拿到会话许可」这一档；
//   B 同场景电话带上会话号 → 写得进，标签配色文件那一步也拿得到政策；
//   C 只有一个活会话、电话不带 → 旧行为不变（仍然成功，向后兼容）；
//   D/E/F 零会话、不存在的会话号、只有子代理会话 → 一律不写、不借用别人的许可；
//   G 布局电话带会话号写得进，不带时如实回「只记在本机」；H 旧选择迁移带会话号能落进文件；
//   I host.start 启动头带上这一份插件的版本号，读不到就不写这一格。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)
const mkTemp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'wf1305-'))
const wsFile = (dir: string): string => path.join(dir, 'docs', 'agents', 'workspace.yaml')

// 假文件服务：没有政策时像真宿主一样拒写（错误文案里的 denied 是敏档判据），有政策才落盘。
function makePlatform(seen: { writes: number }) {
  return {
    path: path.posix,
    os: 'win32',
    fs: {
      async resolve(p: unknown, o: unknown) { const cwd = (o && (o as any).cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return cwd ? String(cwd).replace(/\\/g, '/') + '/' + rel : rel },
      async readText(t: unknown) { return fs.readFileSync(t as string, 'utf8') },
      async writeText(t: unknown, c: unknown, _a?: unknown, _b?: unknown, policy?: unknown) {
        if (!policy) throw new Error('file access denied under read-only mode')
        seen.writes += 1
        fs.mkdirSync(path.dirname(t as string), { recursive: true })
        fs.writeFileSync(t as string, String(c), 'utf8')
      },
      async mkdir(d: unknown) { fs.mkdirSync(d as string, { recursive: true }) },
    },
  }
}

function session(id: string, cwd: string, extra?: any) { return Object.assign({ id: id, header: { cwd: cwd } }, extra || {}) }

async function main() {
  console.log('#1305 写工作区文件与「这一次请求的会话」')
  const { createWorkspaceCwd } = await imp('src/host/workspaceCwd.js')

  function mkApi(dir: string, sessions: any[], memory?: any) {
    const seen = { writes: 0 }
    const events: any[] = []
    const policyCalls: any[] = []
    const placed: any[] = []
    const memoryRec = memory || null
    const api = createWorkspaceCwd({
      ctx: {
        get: (key: string) => key === 'sessions'
          ? { list: () => sessions, get: (id: string) => sessions.find((s: any) => s.id === id) || null }
          : (key === 'sandboxPolicy' ? { resolve: (arg: any) => { policyCalls.push(arg); return arg && arg.session ? { mode: 'workspace-write', roots: [arg.session.header && arg.session.header.cwd] } : undefined } } : undefined),
      },
      DEFAULT_CWD: dir,
      getPlatform: async () => makePlatform(seen),
      getTrackerRegistry: async () => ({
        has: (id: string) => id === 'github' || id === 'markdown',
        get: (id: string) => id === 'github' ? { ensureLabelColorsFile: async (_ref: unknown, octx: any) => { placed.push({ hasPolicy: !!(octx && octx.sandboxPolicy), sessionId: octx && octx.sessionId }); return { ok: true, placed: false, reason: 'test' } } } : null,
        describe: (_h: unknown, id: string) => ({ backend: id, refId: '', name: id, url: '' }),
      }),
      getWorkspaceStore: async () => ({ invalidate: () => {} }),
      getChoiceStore: async () => ({ rememberWorkspace: async () => ({ ok: true, rev: 1 }), rememberLayout: async () => ({ ok: true, pickedAt: 5 }), getWorkspace: async () => memoryRec, getLayout: async () => ({ found: false }) }),
      getDecisionFn: async () => null,
      canonicalKey: async (raw: string) => raw,
      setCache: () => {},
      timer: { timeout: () => null },
      detectionExec: async () => ({}),
      logCtx: { fire: (level: string, event: string, fields: any) => { events.push({ level: level, event: event, fields: fields }) }, isEnabled: () => true },
    })
    return { api: api, seen: seen, events: events, policyCalls: policyCalls, placed: placed }
  }

  // A：两个活会话、不带会话号 —— 不能猜是哪一个，如实失败并分到「没拿到会话许可」这一档
  {
    const dir = mkTemp()
    const h = mkApi(dir, [session('s1', dir), session('s2', dir)])
    const r = await h.api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === false && r.kind === 'workspace-file-failed', 'A 两个活会话、不带会话号：如实回失败（不再回 ok）', JSON.stringify({ ok: r.ok, kind: r.kind }))
    check(r.errorKind === 'no-session-permit', 'A 失败原因分到「没拿到会话许可」这一档（不是磁盘只读）', String(r.errorKind))
    check(/没拿到这次请求的会话号/.test(String(r.error)), 'A 失败提示说清为什么：宿主不知道这次写入算哪个会话的', String(r.error))
    check(!fs.existsSync(wsFile(dir)), 'A 确实一个字都没写进工作区文件')
    check(!h.placed.length, 'A 写文件都没成，就不往下走配色那一步')
    check(h.events.some((e) => e.event === 'host.call.fail' && e.fields && e.fields.method === 'wf.bind' && e.fields.errorKind === 'no-session-permit'), 'A 日志里记下这一趟失败与原因档（可事后排查）')
  }
  // B：同两个会话、带上会话号 —— 写得进；配色文件那一步也拿得到本次政策
  {
    const dir = mkTemp()
    const h = mkApi(dir, [session('s1', dir), session('s2', dir)])
    const r = await h.api.handleBind({ cwd: dir, backendId: 'github', sessionId: 's1' })
    const body = fs.existsSync(wsFile(dir)) ? fs.readFileSync(wsFile(dir), 'utf8') : ''
    check(r.ok === true && r.workspaceFile && r.workspaceFile.ok === true, 'B 带会话号：这次选择生效，回包说写进了工作区文件', JSON.stringify({ ok: r.ok, workspaceFile: r.workspaceFile }))
    check(body.includes('backendId: github'), 'B 文件里确实是这次选的后端', body.slice(0, 200))
    check(r.labelColorsFile && r.labelColorsFile.ok === true && h.placed.length === 1 && h.placed[0].hasPolicy === true && h.placed[0].sessionId === 's1', 'B 标签配色文件那一步拿到的政策就是这次会话的（不是空政策）', JSON.stringify(h.placed))
  }
  // C：只有一个活会话、不带会话号 —— 旧行为不变（仍用那唯一一个会话的政策）
  {
    const dir = mkTemp()
    const h = mkApi(dir, [session('only', dir)])
    const r = await h.api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === true && fs.existsSync(wsFile(dir)), 'C 只有一个活会话时不带会话号仍成功（老场景不受影响）', JSON.stringify({ ok: r.ok }))
  }
  // D：一个活会话都没有 —— 不拿部署默认政策硬写
  {
    const dir = mkTemp()
    const h = mkApi(dir, [])
    const r = await h.api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === false && r.errorKind === 'no-session-permit' && !fs.existsSync(wsFile(dir)), 'D 零活会话：如实失败，不写文件', JSON.stringify({ ok: r.ok, errorKind: r.errorKind }))
  }
  // E：给了会话号但宿主不认识它 —— 不能拿别的会话顶替
  {
    const dir = mkTemp()
    const h = mkApi(dir, [session('s1', dir), session('s2', dir)])
    const r = await h.api.handleBind({ cwd: dir, backendId: 'github', sessionId: 'gone' })
    check(r.ok === false && r.errorKind === 'no-session-permit' && !fs.existsSync(wsFile(dir)), 'E 不存在的会话号不会被别的会话顶替：如实失败', JSON.stringify({ ok: r.ok, errorKind: r.errorKind }))
  }
  // F：工作区名下只有子代理会话 —— 它的权限来自父会话，不能替用户这一趟借写入许可
  {
    const dir = mkTemp()
    const h = mkApi(dir, [session('a1', dir, { header: { cwd: dir, origin: 'subagent' } })])
    const r = await h.api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === false && r.errorKind === 'no-session-permit' && !fs.existsSync(wsFile(dir)), 'F 只有子代理会话时按「没有可用会话」处理，不借它的许可', JSON.stringify({ ok: r.ok, errorKind: r.errorKind }))
    const r2 = await h.api.handleBind({ cwd: dir, backendId: 'github', sessionId: 'a1' })
    check(r2.ok === true, 'F（对照）调用方明确指定那个会话号时就按它算，不拦（拦的是「宿主自己猜」）', JSON.stringify({ ok: r2.ok }))
  }
  // G：布局电话 —— 带会话号写得进；不带时如实回「只记在本机」，不谎报成功
  {
    const dir = mkTemp()
    const h = mkApi(dir, [session('s1', dir), session('s2', dir)])
    await h.api.handleBind({ cwd: dir, backendId: 'github', sessionId: 's1' })
    const g1 = await h.api.handleSetupLayout({ cwd: dir, layout: 'multi', sessionId: 's1' })
    const body = fs.readFileSync(wsFile(dir), 'utf8')
    check(g1.ok === true && g1.workspaceFile === 'written' && /layout: multi/.test(body), 'G 布局电话带会话号：写进工作区文件', JSON.stringify(g1))
    const g2 = await h.api.handleSetupLayout({ cwd: dir, layout: 'single' })
    check(g2.ok === false && g2.workspaceFile === 'no-permit' && /本机/.test(String(g2.error)), 'G 不带会话号写不进时如实回失败：说清只记在本机、换机器会再问一次', JSON.stringify(g2))
  }
  // H：旧选择迁移（wf.selection 捎带）—— 带会话号才落得进文件
  {
    const dirOk = mkTemp()
    const hOk = mkApi(dirOk, [session('s1', dirOk), session('s2', dirOk)], { found: true, backendId: 'github' })
    await hOk.api.handleSelection({ cwd: dirOk, sessionId: 's1' })
    await new Promise((r) => setTimeout(r, 120))
    check(fs.existsSync(wsFile(dirOk)) && /backendId: github/.test(fs.readFileSync(wsFile(dirOk), 'utf8')), 'H 迁移带会话号：本机记忆里的旧选择能写进工作区文件')
    const dirNo = mkTemp()
    const hNo = mkApi(dirNo, [session('s1', dirNo), session('s2', dirNo)], { found: true, backendId: 'github' })
    await hNo.api.handleSelection({ cwd: dirNo })
    await new Promise((r) => setTimeout(r, 120))
    check(!fs.existsSync(wsFile(dirNo)), 'H（对照）不带会话号两个活会话时迁移写不进去，不硬写')
  }
  // I：host.start 启动头带上插件版本号；读不到就不写这一格
  {
    const rc: any = await imp('src/host/rpcChannel.js')
    const ver = String(rc.readServingPackageVersion() || '')
    const pkgVer = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '')
    check(ver.length > 0 && ver === pkgVer, 'I 版本号只有一个出口，读到的就是这份插件清单里的版本（' + pkgVer + '）', ver)
    const { createLogFromPackage } = await imp('src/host/logFromPackage.js')
    const { createNodeFileService, createNodeTimer } = await import('dsh-log/node')
    const readHeader = async (cache: string) => {
      const logDir = path.join(cache, 'logs')
      const files = fs.readdirSync(logDir).filter((f: string) => /\.log$/.test(f))
      const lines = fs.readFileSync(path.join(logDir, files[0]), 'utf8').split(/\r?\n/).filter(Boolean).map((l: string) => JSON.parse(l))
      return lines.filter((l: any) => l.event === 'host.start')[0]
    }
    const cacheWith = mkTemp()
    const store = await createLogFromPackage({ fs: createNodeFileService(), timer: createNodeTimer(), getCacheDir: async () => cacheWith, getPlatform: async () => ({ os: 'win32', path: path.posix, fs: createNodeFileService() }), DEFAULT_CWD: cacheWith, pluginVersion: ver })
    await store.writeStartupHeader(); await store.synced()
    const hs = await readHeader(cacheWith)
    check(!!hs && hs.fields && hs.fields.pluginVersion === ver, 'I host.start 带上来这一份插件的版本号', JSON.stringify(hs && hs.fields))
    const cacheWithout = mkTemp()
    const store2 = await createLogFromPackage({ fs: createNodeFileService(), timer: createNodeTimer(), getCacheDir: async () => cacheWithout, getPlatform: async () => ({ os: 'win32', path: path.posix, fs: createNodeFileService() }), DEFAULT_CWD: cacheWithout })
    await store2.writeStartupHeader(); await store2.synced()
    const hs2 = await readHeader(cacheWithout)
    check(!!hs2 && hs2.fields && !Object.prototype.hasOwnProperty.call(hs2.fields, 'pluginVersion'), 'I（对照）读不到版本号时这一格不写，绝不编', JSON.stringify(hs2 && hs2.fields))
  }

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
