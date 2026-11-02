#!/usr/bin/env node
/**
 * verify-1806-record-write-paths.ts — 工作区身份记录的三条写入路径验收门禁（#1806 第 2 步）
 *
 * 背景：判定层（#1806 第 1 步）已经改成「工作区根 = 逐层向上第一个自带 .git 或自带插件工作区记录
 * 的目录」。记录得有人写。本门禁守的就是「谁在什么时候、往哪个目录、写下一份什么内容的记录」，
 * 以及写完之后判定层是否立刻按新事实回答。三条写入路径各守一组：
 *
 *   A. 记录本身的格式：拼出来的文本能读回同一组值；坏输入一律拒绝，绝不写出半份文件。
 *   B. 初始化流程补写（wf.ensureWorkspaceRecord）：只在「这个目录自己就是工作区根」时写；
 *      已经在某个工作区里面、自带 .git、已有记录时都不写；写不进去时如实回失败、不假装成功。
 *   C. 人显式「标为独立工作区」（wf.markWorkspaceRoot）：不看判定层，就写在指定的那一层；
 *      写完之后判定层马上把它认成记录根、并把它的子目录归到它下面。
 *   D. 在面板里选定后端（wf.bind）：那条路本来就会把 docs/agents/workspace.yaml 写到工作区根，
 *      后端记录本身就是判定层认的记录；父层后来才出现 .git 也不改变这个结论（谁近听谁）。
 *   E. 初始化流程的接线：prompts-setup.ts 在初始化文案真的交到会话之后（注入成功，或 injectNow:false
 *      下把文案交给调用方）才发出补写电话；注入抛错、还在等布局卡、没有目录、没有宿主通道时都不发。
 *   F. 静态接线：宿主入口注册了两条电话、workspaceCwd 把沙箱政策函数递给写记录叶子、叶子不反向引用宿主文件。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1806-record-write-paths.ts
 */
import fsx from 'node:fs'
import nodePath from 'node:path'
import nodeOs from 'node:os'
import { pathToFileURL } from 'node:url'
// 按文本求值统一走共用入口（理由与用法见 tests/lib/eval-probe.ts 文件头）。
import { compileFn } from './lib/eval-probe.js'
// 取源码原文 / 可求值文本走共用入口（#1207 立），不要各写各的。
import { sourceText, spliceableJs } from './lib/source-text.ts'

const fsp = fsx.promises
const ROOT = nodePath.resolve(import.meta.dirname, '..')
const url = (rel: string): string => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken: string[] = []
/** 一条判据 = 一句不变式；失败时把那句话原样打出来，读者不用回头猜这条在守什么。 */
function must(cond: unknown, invariant: string, detail?: string) {
  total++
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t: string) { console.log('\n' + t) }

const OS = process.platform === 'win32' ? 'win32' : (process.platform === 'darwin' ? 'darwin' : 'linux')
const PLATFORM = { os: OS, path: nodePath, async getHome() { return nodeOs.homedir() } }
const targetPath = (t: any): string => (t && typeof t === 'object') ? String(t.path || t.targetKey || '') : String(t)

/** 内存文件服务：只做文件服务该做的四件事（resolve / readText / writeText / lstat），不做任何判定。 */
function makeMemFs() {
  const files = new Map<string, string>()
  const key = (p: any): string => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const fsSvc = {
    async resolve(rel: string, opts?: { cwd?: string }) {
      const abs = nodePath.isAbsolute(String(rel)) ? String(rel) : nodePath.resolve(String((opts && opts.cwd) || process.cwd()), String(rel))
      return { path: abs, targetKey: abs }
    },
    async readText(t: any) {
      const p = key(targetPath(t))
      if (!files.has(p)) throw Object.assign(new Error('ENOENT: no such file or directory, open ' + p), { code: 'ENOENT' })
      return files.get(p) as string
    },
    async writeText(t: any, content: string) { files.set(key(targetPath(t)), String(content)) },
    async lstat(p: any) {
      const k = key(String(p))
      if (files.has(k)) return {}
      // 路径下还有文件时，它本身就是一个目录：真文件服务 lstat 目录会成功，这里照样算存在。
      for (const f of files.keys()) if (f.startsWith(k + '/')) return {}
      throw Object.assign(new Error('ENOENT: no such file or directory, lstat ' + String(p)), { code: 'ENOENT' })
    },
  }
  return {
    fs: fsSvc,
    /** 直接预置一份文件（造「已有记录」「已有 .git」这类前置条件用）。 */
    seed(abs: string, content: string) { files.set(key(abs), content) },
    read(abs: string): string | null { const k = key(abs); return files.has(k) ? (files.get(k) as string) : null },
  }
}

/** 真读盘的文件服务：写的时候自动建父目录（DSH 的 writeText 契约是「传 resolve 出来的 target」，父目录由它自己建）。 */
function makeRealFs() {
  return {
    async resolve(rel: string, opts?: { cwd?: string }) {
      const abs = nodePath.isAbsolute(String(rel)) ? String(rel) : nodePath.resolve(String((opts && opts.cwd) || process.cwd()), String(rel))
      return { path: abs, targetKey: abs }
    },
    async readText(t: any) { return fsp.readFile(targetPath(t), 'utf8') },
    async writeText(t: any, content: string) { const p = targetPath(t); await fsp.mkdir(nodePath.dirname(p), { recursive: true }); await fsp.writeFile(p, String(content), 'utf8') },
    async lstat(p: any) { return fsp.lstat(String(p)) },
    async stat(t: any) { return fsp.stat(targetPath(t)) },
    async listDir(t: any) { return fsp.readdir(targetPath(t)) },
  }
}

let TMP = ''
function cleanup() { try { if (TMP) fsx.rmSync(TMP, { recursive: true, force: true }) } catch (e) {} }

async function main() {
  const wm = await import(url('src/host/workspaceKey.ts'))
  const rec = await import(url('src/host/workspaceRecords.ts'))
  const store = await import(url('src/shared/config-store/src/workspace.ts'))
  const realFs = makeRealFs()
  TMP = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'dsws-1806-write-'))
  /** 造一条真目录（父目录一起建）。 */
  const mkdir = (rel: string): string => { const p = nodePath.join(TMP, rel); fsx.mkdirSync(p, { recursive: true }); return p }

  // ── A) 记录格式 ───────────────────────────────────────────────────────────
  title('A) 工作区身份记录的格式（拼装与解析来回一遍）')
  {
    const text = store.stringifyIdentityRecord({ version: 1, kind: 'workspace-root', writtenAt: 1767225600000, source: 'setup' })
    must(text.ok === true && typeof text.text === 'string', '一条合法的身份记录能拼成文本', JSON.stringify(text).slice(0, 200))
    const txt = (text.ok ? text.text : '') as string
    must(txt.indexOf('kind: workspace-root') >= 0 && txt.indexOf('source: setup') >= 0 && txt.indexOf('version: 1') >= 0 && txt.indexOf('writtenAt: 1767225600000') >= 0,
      '拼出来的文本带着四样东西：版本、身份类型、写下时间、谁写的', JSON.stringify(txt))
    must(txt.indexOf('# 工作区身份记录') === 0, '文本开头有一段给人看的头注释，说明这份文件由插件写、删掉就回上级', JSON.stringify(txt.slice(0, 40)))
    const back = store.parseIdentityRecord(txt)
    must(back.ok === true && back.value.kind === 'workspace-root' && back.value.source === 'setup' && back.value.writtenAt === 1767225600000,
      '拼出来的文本能原样读回同一组值', JSON.stringify(back))
    const badSource = store.stringifyIdentityRecord({ version: 1, kind: 'workspace-root', writtenAt: 1, source: 'someone-else' })
    must(badSource.ok === false, '谁写的这一项只认 setup 与 user 两种，别的一律拒绝', JSON.stringify(badSource))
    const badKind = store.stringifyIdentityRecord({ version: 1, kind: 'not-a-workspace', writtenAt: 1, source: 'user' })
    must(badKind.ok === false, '身份类型只能是 workspace-root，别的一律拒绝（这份文件只表示「这一层是工作区」）', JSON.stringify(badKind))
    const badParse = store.parseIdentityRecord('version: 1\nkind: workspace-root\n')
    must(badParse.ok === false, '读回时缺项（没有 writtenAt / source）判读不懂，不猜默认值', JSON.stringify(badParse))
  }

  // ── B) 初始化流程补写 ─────────────────────────────────────────────────────
  title('B) 初始化流程补写（wf.ensureWorkspaceRecord）：只在「这个目录自己就是工作区根」时写')
  {
    const mem = makeMemFs()
    let rootInvalidated = 0
    let setCacheCalled = 0
    const invalidated: any[] = []
    const makeDeps = (opts: any) => ({
      ctx: { get: () => null },
      getPlatform: async () => (opts && opts.noPlatform ? {} : { fs: (opts && opts.fs) || mem.fs }),
      getWorkspaceStore: async () => ({ invalidate(v: any) { invalidated.push(v) } }),
      setCache: () => { setCacheCalled++ },
      canonicalKey: async (raw: string) => (opts && opts.canonical) ? opts.canonical(raw) : raw,
      resolveSandboxPolicy: () => ({ policy: 'test-policy' }),
      invalidateRootCache: () => { rootInvalidated++ },
      logCtx: { fire: () => {}, isEnabled: () => false },
    })
    const IDENTITY_REL = 'docs/agents/workspace-root.yaml'

    // B1：根就是自己、没有 .git → 写一份，读回四行内容，缓存都清掉
    {
      const dir = 'C:/dsws-1806/b1'
      const h = rec.createWorkspaceRecords(makeDeps({}))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: dir, sessionId: 's1' })
      const written = mem.read(dir + '/' + IDENTITY_REL)
      must(out.ok === true && out.placed === true && out.reason === 'created', '没有标记的目录：初始化走完时补写一份身份记录', JSON.stringify(out))
      must(!!written && written.indexOf('kind: workspace-root') >= 0 && written.indexOf('source: setup') >= 0,
        '补写下来的内容：身份类型是 workspace-root、来源写明是初始化流程（setup）', JSON.stringify(written))
      must(invalidated.length === 1 && String(invalidated[0].cwd).length > 0 && setCacheCalled === 1 && rootInvalidated === 1,
        '写完要清三样旧账：工作区快照缓存、面板缓存、根判定缓存（否则面板最多 30 秒还在说旧话）',
        'invalidate=' + invalidated.length + ' setCache=' + setCacheCalled + ' root=' + rootInvalidated)
    }
    // B2：这个目录已经在某个工作区里面 → 不写
    {
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: () => 'C:/dsws-1806/parent' }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: 'C:/dsws-1806/parent/child' })
      must(out.ok === true && out.placed === false && out.reason === 'inside-workspace' && out.root === 'C:/dsws-1806/parent',
        '已经在上级工作区里面的目录：不写记录（写了就把「仓库的一部分」变成了「独立工作区」，正是 #1806 要避免的事）', JSON.stringify(out))
      must(mem.read('C:/dsws-1806/parent/child/' + IDENTITY_REL) === null, '不写就是真的一份都没落盘', '有文件')
    }
    // B3：已经有记录 → 幂等，不重写
    {
      const dir = 'C:/dsws-1806/b3'
      mem.seed(dir + '/' + IDENTITY_REL, 'version: 1\nkind: workspace-root\nwrittenAt: 111\nsource: user\n')
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: () => dir }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: dir })
      must(out.ok === true && out.placed === false && out.reason === 'exists', '已经有一份记录时：不重写（重复初始化不该把「第一次成为工作区的时间」刷掉）', JSON.stringify(out))
      must((mem.read(dir + '/' + IDENTITY_REL) || '').indexOf('writtenAt: 111') >= 0, '已有记录的内容一个字没动', JSON.stringify(mem.read(dir + '/' + IDENTITY_REL)))
    }
    // B4：自带 .git → 不写
    {
      const dir = 'C:/dsws-1806/b4'
      mem.seed(dir + '/.git', 'gitdir: somewhere')
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: () => dir }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: dir })
      must(out.ok === true && out.placed === false && out.reason === 'git-root', '自带 .git 的目录：它已经是工作区，再写一份记录是多余的', JSON.stringify(out))
      must(mem.read(dir + '/' + IDENTITY_REL) === null, '这一条也没落盘', '有文件')
    }
    // B5：没有文件通道 → 如实回失败
    {
      const h = rec.createWorkspaceRecords(makeDeps({ noPlatform: true }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: 'C:/dsws-1806/b5' })
      must(out.ok === false && out.error && out.error.kind === 'env' && out.error.reason === 'no-channel',
        '拿不到文件通道时如实回失败（不假装写成了）', JSON.stringify(out))
    }
    // B6：写被拒（沙箱不给许可）→ 原因分档
    {
      const denyFs: any = Object.assign({}, mem.fs)
      denyFs.writeText = async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) }
      const h = rec.createWorkspaceRecords(makeDeps({ fs: denyFs }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: 'C:/dsws-1806/b6' })
      must(out.ok === false && out.error && out.error.kind === 'env' && out.error.reason === 'no-permit',
        '写被拒绝时把原因归到「没有许可」这一档，回包说清是写不进去，而不是判定失败', JSON.stringify(out))
    }
    // B7：写完读回来的内容不一致 → 这次写入不算数
    {
      const badFs: any = Object.assign({}, mem.fs)
      badFs.writeText = async (t: any) => { await mem.fs.writeText(t, 'got-mangled') }
      const h = rec.createWorkspaceRecords(makeDeps({ fs: badFs }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: 'C:/dsws-1806/b7' })
      must(out.ok === false && out.error && out.error.reason === 'read-back-mismatch',
        '写完读回来与写下去的不一致时，这次写入不算数（宁可下次再写，不拿一份坏记录当成功）', JSON.stringify(out))
    }
    // B8：cwd 空 → 参数错
    {
      const h = rec.createWorkspaceRecords(makeDeps({}))
      const out = await h.handleEnsureWorkspaceRecord({})
      must(out.ok === false && out.error && out.error.kind === 'args' && out.error.reason === 'empty-cwd',
        '没有目录可写时回参数错，不去猜一个默认目录', JSON.stringify(out))
    }
    // B9：判定这一步出错 → 失败关闭，一份都不写
    {
      const badDir = 'C:/dsws-1806/b9'
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: async () => { throw new Error('root probe failed') } }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: badDir })
      must(out.ok === false && out.placed === false && out.reason === 'root-unknown' && out.error && out.error.reason === 'root-unknown',
        '判定这一步出错时：失败关闭（不把「不知道是不是子目录」当成「可以写」），如实回没写成', JSON.stringify(out))
      must(mem.read(badDir + '/' + IDENTITY_REL) === null, '失败关闭时真的一份都没落盘', '有文件')
    }
    // B10：记录位置已经有一份空文件 → 判定层算「有记录」，写侧也必须算「已有」
    {
      const dir = 'C:/dsws-1806/b10'
      mem.seed(dir + '/' + IDENTITY_REL, '')
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: () => dir }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: dir })
      must(out.ok === true && out.placed === false && out.reason === 'exists',
        '记录位置已经有一个空文件时：判定层算它「有记录」，写侧也按「已有」处理，不覆盖（两边口径必须一样）', JSON.stringify(out))
      must(mem.read(dir + '/' + IDENTITY_REL) === '', '空文件还是一个字节都没动', JSON.stringify(mem.read(dir + '/' + IDENTITY_REL)))
    }
    // B11：记录位置是个目录 → 同样算「已有」
    {
      const dir = 'C:/dsws-1806/b11'
      mem.seed(dir + '/' + IDENTITY_REL + '/inner.txt', 'x')
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: () => dir }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: dir })
      must(out.ok === true && out.placed === false && out.reason === 'exists',
        '记录位置是个目录时：判定层算它「有记录」，写侧也按「已有」处理（不去覆盖一个目录）', JSON.stringify(out))
    }
    // B12：清缓存用的是判定层归好的根（规整写法），不是调用方传进来的原始字符串
    {
      const dir = 'C:/dsws-1806/b12'
      const raw = 'C:\\dsws-1806\\b12\\'
      const cleared: any[] = []
      const h = rec.createWorkspaceRecords(Object.assign(makeDeps({ canonical: () => dir }), {
        getWorkspaceStore: async () => ({ invalidate(v: any) { cleared.push(v) } }),
      }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: raw })
      must(out.ok === true && out.placed === true, '原始写法带尾斜杠与反斜杠时也能写成', JSON.stringify(out))
      must(cleared.length === 1 && String(cleared[0].cwd) === dir,
        '清缓存用的是判定层归好的根：缓存按规整根存，用原始字符串去清会清不中', JSON.stringify(cleared))
    }
  }

  // ── C) 人显式「标为独立工作区」 ──────────────────────────────────────────
  title('C) 人显式「标为独立工作区」（wf.markWorkspaceRoot）：写在这一层本身，写完判定层立刻认它')
  {
    const plain = mkdir('c/plain')
    const child = nodePath.join(plain, 'child')
    fsx.mkdirSync(child, { recursive: true })
    let canonicalAsked = 0
    const h = rec.createWorkspaceRecords({
      ctx: { get: () => null },
      getPlatform: async () => ({ fs: realFs }),
      getWorkspaceStore: async () => ({ invalidate() {} }),
      setCache: () => {},
      canonicalKey: async (raw: string) => { canonicalAsked++; return 'C:/somewhere/else' },
      resolveSandboxPolicy: () => ({}),
      invalidateRootCache: () => { wm.forgetWorkspaceRootCache() },
      logCtx: null,
    })
    const out = await h.handleMarkWorkspaceRoot({ cwd: plain })
    must(out.ok === true && out.placed === true && out.reason === 'created', '把一条目录标为独立工作区：记录写在指定的这一层', JSON.stringify(out))
    must(canonicalAsked === 0, '这条动作不经过判定层：人指定的就是这一层，哪怕它现在正属于某个上级工作区', '判定被问了 ' + canonicalAsked + ' 次')
    const recPath = nodePath.join(plain, 'docs', 'agents', 'workspace-root.yaml')
    const written = fsx.existsSync(recPath) ? fsx.readFileSync(recPath, 'utf8') : ''
    must(written.indexOf('source: user') >= 0, '这份记录的来源写明是人显式标的（user），不是初始化流程补的', JSON.stringify(written))
    const asRoot = await wm.resolveWorkspaceRoot(plain, { platform: PLATFORM, getFs: () => realFs })
    must(asRoot.root === nodePath.normalize(plain) && asRoot.source === 'record',
      '写完之后判定层立刻把这一层认成工作区根（来源写明是插件记录）', JSON.stringify(asRoot))
    const childAs = await wm.resolveWorkspaceRoot(nodePath.normalize(child), { platform: PLATFORM, getFs: () => realFs })
    must(childAs.root === nodePath.normalize(plain) && childAs.source === 'record',
      '它的子目录归到它下面（这正是面板要显示的那句「当前目录是它的子目录」）', JSON.stringify(childAs))
    // 再标一次：幂等
    const again = await h.handleMarkWorkspaceRoot({ cwd: plain })
    must(again.ok === true && again.placed === false && again.reason === 'exists', '重复点同一条「标为独立」：已有记录，不重写', JSON.stringify(again))
    // 相对路径拒绝
    const rel = await h.handleMarkWorkspaceRoot({ cwd: 'some/relative/path' })
    must(rel.ok === false && rel.error && rel.error.reason === 'not-absolute', '相对路径拒绝：连「是哪一层」都答不出来的路径不许写记录', JSON.stringify(rel))
  }

  // ── D) 在面板里选定后端 ──────────────────────────────────────────────────
  title('D) 在面板里选定后端（wf.bind）：写下的后端记录本身就是判定层认的记录')
  {
    const dir = mkdir('d/plain')
    const child = nodePath.join(dir, 'child')
    fsx.mkdirSync(child, { recursive: true })
    const registry = (await import(url('src/tracker/registry/core.ts'))).createRegistry()
    const offNet = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }
    registry.register({ id: 'github', label: 'GitHub', budget: offNet, create: () => ({}), matches: async () => false })
    registry.register({ id: 'markdown', label: '本地 Markdown', budget: offNet, create: () => ({}), matches: async () => false })
    const outlet: any = await import(url('src/tracker/detection/backendDecision.ts'))
    const canon = (raw: string): Promise<string> => wm.canonicalWorkspaceKey(raw, { getPlatform: async () => PLATFORM, getFs: () => realFs, getDefaultCwd: () => TMP })
    const wsCwd = (await import(url('src/host/workspaceCwd.js'))).createWorkspaceCwd({
      ctx: { get: (name: string) => (name === 'fs' ? realFs : undefined) },
      DEFAULT_CWD: TMP,
      getPlatform: async () => Object.assign({}, PLATFORM, { fs: realFs }),
      getTrackerRegistry: async () => registry,
      getWorkspaceStore: async () => ({ invalidate() {} }),
      getDecisionFn: async () => ({ decideBackend: outlet.decideBackend, selectionFromOutlet: outlet.selectionFromOutlet }),
      canonicalKey: canon,
      setCache: () => {},
      logCtx: { fire: () => {}, isEnabled: () => false },
      timer: { timeout: () => 0 },
      detectionExec: async () => ({ ok: false }),
    })
    const bindOut = await wsCwd.handleBind({ cwd: nodePath.normalize(dir), backendId: 'markdown' })
    const wsYaml = nodePath.join(dir, 'docs', 'agents', 'workspace.yaml')
    must(bindOut.ok === true && bindOut.workspaceFile && bindOut.workspaceFile.ok === true && fsx.existsSync(wsYaml),
      '在面板里选定后端：选择写进这一层的工作区文件（写不进去就等于这次选择没生效）', JSON.stringify(bindOut).slice(0, 240))
    wm.forgetWorkspaceRootCache()
    const afterBind = await wm.resolveWorkspaceRoot(nodePath.normalize(child), { platform: PLATFORM, getFs: () => realFs })
    must(afterBind.root === nodePath.normalize(dir) && afterBind.source === 'record',
      '绑定之后，这个目录就是判定层认的工作区根，它的子目录归它下面', JSON.stringify(afterBind))
    // 父层后来才出现 .git：谁近听谁，结论不变
    fsx.mkdirSync(nodePath.join(TMP, 'd', '.git'), { recursive: true })
    wm.forgetWorkspaceRootCache()
    const afterParentGit = await wm.resolveWorkspaceRoot(nodePath.normalize(child), { platform: PLATFORM, getFs: () => realFs })
    must(afterParentGit.root === nodePath.normalize(dir) && afterParentGit.source === 'record',
      '父层后来出现了 .git：记录比它近，结论不变（谁近听谁是这条规则的关键）', JSON.stringify(afterParentGit))
  }

  // ── E) 初始化流程的接线 ──────────────────────────────────────────────────
  title('E) 初始化流程（prompts-setup.ts）：初始化文案真的交出去之后才发补写电话')
  {
    const src = spliceableJs('src/client/kernel/prompts-setup.ts')
    const calls: Array<{ method: string; args: any }> = []
    const injected: string[] = []
    const hostStub = { call: function (method: string, args: any) { calls.push({ method: method, args: args }); return Promise.resolve({ ok: true, placed: true }) } }
    const build = (hostValue: any, blocked: boolean) => compileFn(
      ['readSetupLayout', 'setupBlockedByGuide', 'snapshotSetupLayoutForCard', 'setupOrRepoPrompt', 'setupRunPrompt',
        'SETUP_LAYOUT_DEFAULT', 'inject', 'isEnabled', 'host', 'emit', 'log', 'console'],
      src + '\n;return { injectSetupDecision: injectSetupDecision }'
    )(
      function () { return null },                 // 布局还没答过 → 允许开卡那一步按 opts 决定
      function () { return blocked },              // 引导链的「仓库那一步」过没过
      function () {},
      function () { return { kind: 'setup', text: 'INIT TEXT', layout: 'single' } },
      function () { return 'INIT TEXT' },
      'single',
      function (st: any, text: any) { injected.push(String(text)) },
      function () { return false },
      hostValue,
      function () {},
      function () {},
      { log: function () {}, warn: function () {}, error: function () {} }
    )
    const st = { cwd: 'C:/dsws-1806/client-proj', sessionId: 'sess-1' }
    // E1：检查页那颗按钮（injectNow:false）也补写
    {
      calls.length = 0; injected.length = 0
      const mod = build(hostStub, false)
      mod.injectSetupDecision(st, 'github', { injectNow: false })
      await Promise.resolve()
      must(calls.length === 1 && calls[0].method === 'wf.ensureWorkspaceRecord' && calls[0].args.cwd === st.cwd && calls[0].args.sessionId === st.sessionId,
        '检查页「执行初始化」这条路（injectNow:false）：给出初始化文案时也发补写电话，带目录与会话号', JSON.stringify(calls))
      must(injected.length === 0, '检查页那条路本来就不由这个函数注入（injectNow:false 只回答「给哪一段」），补写电话也不替它注入', JSON.stringify(injected))
    }
    // E2：黄条那条（injectNow:true）同样补写
    {
      calls.length = 0; injected.length = 0
      const mod = build(hostStub, false)
      mod.injectSetupDecision(st, 'github', { injectNow: true })
      await Promise.resolve()
      must(calls.length === 1 && calls[0].method === 'wf.ensureWorkspaceRecord' && calls[0].args.cwd === st.cwd,
        '状态栏黄条「初始化」这条路（injectNow:true）：文案交出去之后补写记录', JSON.stringify(calls))
      must(injected.length === 1 && injected[0] === 'INIT TEXT', '这条路由这个函数自己注入，文案原样进了会话', JSON.stringify(injected))
    }
    // E6：注入这一步抛错 → 一个字都没给出去，不补写记录
    {
      calls.length = 0; injected.length = 0
      const throwInject = compileFn(
        ['readSetupLayout', 'setupBlockedByGuide', 'snapshotSetupLayoutForCard', 'setupOrRepoPrompt', 'setupRunPrompt',
          'SETUP_LAYOUT_DEFAULT', 'inject', 'isEnabled', 'host', 'emit', 'log', 'console'],
        src + '\n;return { injectSetupDecision: injectSetupDecision }'
      )(
        function () { return null },
        function () { return false },
        function () {},
        function () { return { kind: 'setup', text: 'INIT TEXT', layout: 'single' } },
        function () { return 'INIT TEXT' },
        'single',
        function () { throw new Error('inject unavailable') },
        function () { return false },
        hostStub,
        function () {},
        function () {},
        { log: function () {}, warn: function () {}, error: function () {} }
      )
      let threw = false
      try { throwInject.injectSetupDecision(st, 'github', { injectNow: true }) } catch (e) { threw = true }
      await Promise.resolve()
      must(threw === false && injected.length === 0 && calls.length === 0,
        '注入这一步抛错时：文案没给出去，就不补写记录（写了等于替用户宣布这个目录是工作区）', JSON.stringify({ threw: threw, calls: calls }))
    }
    // E3：开卡那一步（askLayout）不发
    {
      calls.length = 0
      const mod = build(hostStub, false)
      const out = mod.injectSetupDecision(st, 'github', { askLayout: true, allowCard: true })
      await Promise.resolve()
      must(out === 'askLayout' && calls.length === 0, '还在等用户答布局卡的那一步（askLayout）：一个字都还没给，不补写记录', JSON.stringify({ out: out, calls: calls }))
    }
    // E4：没有宿主通道 → 不抛错、不挡注入
    {
      calls.length = 0; injected.length = 0
      const mod = build(undefined, false)
      let threw = false
      try { mod.injectSetupDecision(st, 'github', { injectNow: true }) } catch (e) { threw = true }
      await Promise.resolve()
      must(threw === false && injected.length === 1, '没有宿主通道时安静跳过（初始化文案照给），不抛错也不挡注入', 'threw=' + threw)
    }
    // E5：没有目录 → 不发
    {
      calls.length = 0
      const mod = build(hostStub, false)
      mod.injectSetupDecision({ sessionId: 'sess-2' }, 'github', { injectNow: true })
      await Promise.resolve()
      must(calls.length === 0, '会话状态里没有目录时：不去猜一个目录写记录', JSON.stringify(calls))
    }
  }

  // ── F) 静态接线 ──────────────────────────────────────────────────────────
  title('F) 静态接线：三条路都接上了，写记录叶子不反向引用宿主文件')
  {
    const setupSrc = sourceText('src/client/kernel/prompts-setup.ts')
    must(setupSrc.indexOf("host.call('wf.ensureWorkspaceRecord'") >= 0, '初始化流程真的发出了 wf.ensureWorkspaceRecord 这条电话', '没找到调用')
    const indexSrc = sourceText('src/host/index.ts')
    must(indexSrc.indexOf("harness.handle('wf.ensureWorkspaceRecord'") >= 0 && indexSrc.indexOf("harness.handle('wf.markWorkspaceRoot'") >= 0,
      '宿主入口把两条写记录电话都注册了（初始化补写、人显式标独立）', '缺注册')
    const cwdSrc = sourceText('src/host/workspaceCwd.ts')
    must(/resolveSandboxPolicy:\s*resolveSandboxPolicy/.test(cwdSrc),
      'workspaceCwd 把沙箱政策函数递给写记录叶子：写文件与其它写点用同一份政策算法，不另造第二份', '没找到导出')
    const leafSrc = sourceText('src/host/workspaceRecords.ts')
    must(/(^|[^A-Za-z0-9_])from\s+'\.\.\/shared\/config-store\//.test(leafSrc) === true && /from\s+'\.\//.test(leafSrc) === false,
      '写记录叶子是自包含的：只引共享 config-store，不引其它 host 文件（同层互引门禁的用意）', '叶子 import 形状不对')
    must(leafSrc.indexOf('WORKSPACE_IDENTITY_REL') >= 0 && leafSrc.indexOf("'docs/agents/") < 0 && leafSrc.indexOf('\"docs/agents/') < 0,
      '记录路径只有一处定义（共享 config-store 的常量），叶子里不再写第二份字面量', '叶子里出现了路径字面量')
  }

  console.log('')
  const okAll = broken.length === 0
  console.log(okAll ? ('全部 ' + total + ' 条判据都守住了') : ('有 ' + broken.length + ' 条判据没守住：'))
  if (!okAll) { for (const b of broken) console.log('  - ' + b); cleanup(); process.exit(1) }
  cleanup()
}

main().catch((e) => { console.error(e && e.stack || e); cleanup(); process.exit(1) })
