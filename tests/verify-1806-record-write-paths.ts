#!/usr/bin/env node
/**
 * verify-1806-record-write-paths.ts — 工作区身份记录的三条写入路径验收门禁（#1806 第 2 步）
 *
 * 背景：判定层（#1806 第 1 步）已经改成「工作区根 = 逐层向上第一个自带 .git 或自带插件工作区记录
 * 的目录」。记录得有人写。本门禁守的就是「谁在什么时候、往哪个目录、写下一份什么内容的记录」，
 * 以及写完之后判定层是否立刻按新事实回答。三条写入路径各守一组：
 *
 *   A. 记录本身的格式：拼出来的文本能读回同一组值；坏输入一律拒绝，绝不写出半份文件。
 *   B. 初始化流程补写（wf.ensureWorkspaceRecord）：写在判定层给出的工作区根上（会话开在子目录里也写根，
 *      不写子目录）；目录自己就是 git 根时也写一份（.git 只证明是工作区，不证明初始化提示发出过）；
 *      已有记录时幂等不重写；写不进去时如实回失败、不假装成功。
 *   C. 人显式「标为独立工作区」（wf.markWorkspaceRoot）：不看判定层，就写在指定的那一层；
 *      写完之后判定层马上把它认成记录根、并把它的子目录归到它下面。
 *   D. 在面板里选定后端（wf.bind）：那条路本来就会把 docs/agents/workspace.yaml 写到工作区根，
 *      后端记录本身就是判定层认的记录；父层后来才出现 .git 也不改变这个结论（谁近听谁）。
 *   E. 初始化流程的接线：prompts-setup.ts 在初始化文案真的交到会话之后（注入成功，或 injectNow:false
 *      下把文案交给调用方）才发出补写电话；注入抛错、还在等布局卡、没有目录、没有宿主通道时都不发。
 *   F. 静态接线：宿主入口注册了四条电话、workspaceCwd 把沙箱政策函数递给写记录叶子、叶子不反向引用宿主文件。
 *   G. 判定依据查询（#1806 第 3 步）：根是谁、凭什么、外面还套着谁、这一层有没有历史遗留的说明文件；
 *      历史遗留（有说明文件、没有任何记录）才给「标为独立」入口；记录根且外面还有工作区才给「并入上级」入口。
 *   H. 「并入上级」与「标为独立」的写侧（#1806 第 3 步）：并入写的是从属记录、不删旧记录；
 *      标独立会删掉从属记录让原记录重新生效；删不掉时如实报失败，不假装成功。
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
    // #1806 第 3 步：「标为独立」要删掉从属记录，内存文件服务也得会删（删不存在的按 ENOENT 抛）。
    async unlink(t: any) {
      const k = key(targetPath(t))
      if (!files.has(k)) throw Object.assign(new Error('ENOENT: no such file or directory, unlink ' + k), { code: 'ENOENT' })
      files.delete(k)
    },
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
    async unlink(t: any) { await fsp.unlink(targetPath(t)) },
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

    // A2 起是从属记录（#1806 第 3 步）：它只表示「这一层归上面的工作区」，内容格式与身份记录同一套约定。
    must(store.WORKSPACE_MEMBER_REL === 'docs/agents/workspace-member.yaml',
      '从属记录的路径只有一处定义（共享 config-store 的常量），别处不再写第二份字面量', String(store.WORKSPACE_MEMBER_REL))
    must(store.WORKSPACE_TRACKER_DOC_REL === 'docs/agents/issue-tracker.md',
      '人写的说明文件路径同样只有一处定义（判定不读它，界面只用它判断历史遗留）', String(store.WORKSPACE_TRACKER_DOC_REL))
    const member = store.stringifyMemberRecord({ version: 1, kind: 'workspace-member', writtenAt: 1767283200000, source: 'user' })
    must(member.ok === true && typeof member.text === 'string', '一条合法的从属记录能拼成文本', JSON.stringify(member).slice(0, 200))
    const memberTxt = (member.ok ? member.text : '') as string
    must(memberTxt.indexOf('kind: workspace-member') >= 0 && memberTxt.indexOf('source: user') >= 0,
      '从属记录的文本写着身份类型 workspace-member、来源是人的动作（user）', JSON.stringify(memberTxt))
    must(memberTxt.indexOf('# 从属记录') === 0 && memberTxt.indexOf('归上面的工作区') >= 0 && memberTxt.indexOf('kind: workspace-member') > 0,
      '从属记录开头有一段给人看的头注释，先说这份文件是什么意思，再说机器字段', JSON.stringify(memberTxt.slice(0, 80)))
    const memberBack = store.parseMemberRecord(memberTxt)
    must(memberBack.ok === true && memberBack.value.kind === 'workspace-member' && memberBack.value.source === 'user' && memberBack.value.writtenAt === 1767283200000,
      '从属记录拼出来的文本能原样读回同一组值', JSON.stringify(memberBack))
    must(store.stringifyMemberRecord({ version: 1, kind: 'workspace-root', writtenAt: 1, source: 'user' }).ok === false,
      '从属记录的身份类型只能是 workspace-member（写成 workspace-root 会把「归上级」说成「独立」）', '居然接受了')
    must(store.stringifyMemberRecord({ version: 1, kind: 'workspace-member', writtenAt: 1, source: 'setup' }).ok === false,
      '从属记录只由人的显式动作写（source 只认 user），初始化流程不替人做这个决定', '居然接受了 setup')
  }

  // ── B) 初始化流程补写 ─────────────────────────────────────────────────────
  title('B) 初始化流程补写（wf.ensureWorkspaceRecord）：写到判定层给出的工作区根上')
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
    // B2：这个目录在某个工作区里面 → 记录写到判定层给出的根，不写进子目录
    {
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: () => 'C:/dsws-1806/parent' }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: 'C:/dsws-1806/parent/child' })
      must(out.ok === true && out.placed === true && out.reason === 'created' && out.root === 'C:/dsws-1806/parent' && out.dir === 'C:/dsws-1806/parent/child',
        '会话开在子目录里：记录写到判定层给出的工作区根（初始化文案是为上面那个工作区给出的），回执同时说清会话目录与记录落到哪一层', JSON.stringify(out))
      must(!!mem.read('C:/dsws-1806/parent/' + IDENTITY_REL), '记录落在工作区根上', '根上没有文件')
      must(mem.read('C:/dsws-1806/parent/child/' + IDENTITY_REL) === null,
        '子目录里一份都不落盘（写了就把「仓库的一部分」变成「独立工作区」，正是 #1806 要避免的事）', '子目录里有文件')
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
    // B4：目录自己就是 git 根 → 也留一份初始化凭据
    {
      const dir = 'C:/dsws-1806/b4'
      mem.seed(dir + '/.git', 'gitdir: somewhere')
      const h = rec.createWorkspaceRecords(makeDeps({ canonical: () => dir }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: dir })
      must(out.ok === true && out.placed === true && out.reason === 'created',
        '目录自己就是 git 根时也写：.git 只证明这是工作区，不证明初始化提示发出过（ADR 20261102 §5 否掉了「.git 或说明文件算已初始化」）', JSON.stringify(out))
      must(!!mem.read(dir + '/' + IDENTITY_REL), 'git 根上也留下了一份初始化凭据', '没有文件')
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

    // #1806 第 3 步：一个「并入过上级」的目录再点「标为独立工作区」，要一次做完两步 ——
    //   写身份记录（已有就不重写）＋删掉从属记录。删掉从属记录之后，原来的记录才重新生效。
    const joined = mkdir('c/joined')
    fsx.mkdirSync(nodePath.join(joined, 'docs', 'agents'), { recursive: true })
    const memberPath = nodePath.join(joined, 'docs', 'agents', 'workspace-member.yaml')
    fsx.writeFileSync(memberPath, 'version: 1\nkind: workspace-member\nwrittenAt: 1\nsource: user\n', 'utf8')
    const promoted = await h.handleMarkWorkspaceRoot({ cwd: joined })
    must(promoted.ok === true && promoted.placed === true && promoted.reason === 'promoted',
      '从「并入」状态点「标为独立工作区」：写身份记录并删掉从属记录，回包说明这次是「提升」', JSON.stringify(promoted))
    must(!fsx.existsSync(memberPath), '从属记录真的被删掉了（它还在的话，判定会继续往上，归属与刚点的动作对不上）')
    must(fsx.existsSync(nodePath.join(joined, 'docs', 'agents', 'workspace-root.yaml')), '身份记录同时落下（一次动作两步都做完）')
    wm.forgetWorkspaceRootCache()
    const promotedRoot = await wm.resolveWorkspaceRoot(nodePath.normalize(joined), { platform: PLATFORM, getFs: () => realFs })
    must(promotedRoot.root === nodePath.normalize(joined) && promotedRoot.source === 'record',
      '提升之后判定层马上把它认成独立工作区根', JSON.stringify(promotedRoot))
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
    must(indexSrc.indexOf("harness.handle('wf.workspaceFacts'") >= 0 && indexSrc.indexOf("harness.handle('wf.joinParentWorkspace'") >= 0,
      '宿主入口把第 3 步两条电话也注册了（查判定依据、并入上级）', '缺注册')
    must(/resolveFacts:\s*function/.test(indexSrc),
      '宿主把「查判定依据」接给写记录叶子：叶子里不自己再探一遍文件', '没找到 resolveFacts 注入')
    const markSrc = sourceText('src/client/views/SubworkspaceMark.ts')
    must(markSrc.indexOf("host.call('wf.workspaceFacts'") >= 0,
      '面板的归属标志向宿主查判定依据（根是谁、凭什么、外面还有谁都不自己猜）', '没找到调用')
    const settingsSrc = sourceText('src/client/views/SettingsWorkspaces.ts')
    must(settingsSrc.indexOf("host.call('wf.workspaceFacts'") >= 0
      && settingsSrc.indexOf("'wf.markWorkspaceRoot'") >= 0
      && settingsSrc.indexOf("'wf.joinParentWorkspace'") >= 0
      && /host\.call\(\s*method/.test(settingsSrc),
      '设置页查到事实后，两个纠正按钮分别调「标为独立工作区」与「并入上级」两条电话', '缺调用')
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
  // ── G) 判定依据查询（#1806 第 3 步）──────────────────────────────────────
  title('G) 判定依据查询（inspectWorkspaceFacts）：根是谁、凭什么、外面还套着谁、这一层有什么')
  {
    // 判定层在 Windows 上把盘符路径折成小写、分隔符沿用平台原生写法；断言跟着用同一把尺子。
    const K = (x: string): string => nodePath.normalize(x).toLowerCase()
    const factsDeps = (fsSvc: any) => ({ getPlatform: async () => PLATFORM, getFs: () => fsSvc, getDefaultCwd: () => '' })

    // G1：历史遗留 —— 子目录里有手写的说明文件、没有任何工作区记录，上级自带 .git
    {
      const mem = makeMemFs()
      mem.seed('C:/g1/parent/.git', 'gitdir: somewhere')
      mem.seed('C:/g1/parent/child/docs/agents/issue-tracker.md', '# Issue tracker: 我们自己的写法')
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g1/parent/child', factsDeps(mem.fs))
      must(f.root === K('C:/g1/parent') && f.source === 'git', '根是上级那个自带 .git 的目录（说明文件不再参与判定）', JSON.stringify({ root: f.root, source: f.source }))
      must(f.layer.hasTrackerDoc === true && f.layer.hasGit === false, '这一层的事实里：有手写说明文件、没有 .git', JSON.stringify(f.layer))
      must(f.canMarkIndependent === true, '历史遗留（有说明文件、没有任何记录）才给「标为独立工作区」入口', JSON.stringify({ canMarkIndependent: f.canMarkIndependent, layer: f.layer }))
      must(f.outer === null, '上级那个目录外面没有别的工作区时不编「位于 X 内」', JSON.stringify(f.outer))
      must(f.noRecord === false, '找到 .git 根时不算「没有任何记录」', String(f.noRecord))
    }
    // G2：自己有一份后端记录（workspace.yaml），外面还套着自带 .git 的父目录
    {
      const mem = makeMemFs()
      mem.seed('C:/g2/.git', 'gitdir: somewhere')
      mem.seed('C:/g2/inner/docs/agents/workspace.yaml', 'version: 2\nbackendId: markdown\n')
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g2/inner', factsDeps(mem.fs))
      must(f.root === K('C:/g2/inner') && f.source === 'record', '自己带记录就停在自己这一层（谁近听谁）', JSON.stringify({ root: f.root, source: f.source }))
      must(f.layer.hasBackendRecord === true && f.canMerge === true, '记录根、自己不带 .git、外面还有工作区：才给「并入上级」入口', JSON.stringify({ canMerge: f.canMerge, layer: f.layer }))
      must(!!f.outer && f.outer.root === K('C:/g2') && f.outer.source === 'git', '「位于 X 内」里的 X 是外面那个自带 .git 的工作区', JSON.stringify(f.outer))
    }
    // G3：从属记录 —— 这一层明确说自己不算工作区，判定继续往上
    {
      const mem = makeMemFs()
      mem.seed('C:/g3/.git', 'gitdir: somewhere')
      mem.seed('C:/g3/proj/docs/agents/workspace-member.yaml', 'kind: workspace-member')
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g3/proj', factsDeps(mem.fs))
      must(f.root === K('C:/g3') && f.source === 'git', '从属记录遮住这一层：根继续往上，落到 .git 那一层', JSON.stringify({ root: f.root, source: f.source }))
      must(f.layer.hasMemberRecord === true, '事实里说清这一层有从属记录', JSON.stringify(f.layer))
      must(f.canMerge === false && f.canMarkIndependent === false, '已经有从属记录时，并入与「标为独立」两个入口都不出现', JSON.stringify({ canMerge: f.canMerge, canMarkIndependent: f.canMarkIndependent }))
      // #1806 第 5 步真机复核发现：并进上级后设置页没有任何撤销入口，而并入时的提示承诺「以后还能改回来」。
      must(f.canUnjoin === true, '已经并入上级（有从属记录、根在上面、自己不自带 .git）时给撤销入口', JSON.stringify({ canUnjoin: f.canUnjoin, root: f.root, layer: f.layer }))
    }
    // G3b：这一层既有从属记录又自带 .git —— .git 永远是边界，不能撤销并入
    {
      const mem = makeMemFs()
      mem.seed('C:/g3b/proj/.git', 'gitdir: somewhere')
      mem.seed('C:/g3b/proj/docs/agents/workspace-member.yaml', 'kind: workspace-member')
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g3b/proj', factsDeps(mem.fs))
      must(f.root === K('C:/g3b/proj') && f.source === 'git', '自己自带 .git 时根就是它自己，从属记录不把仓库降级成子目录', JSON.stringify({ root: f.root, source: f.source }))
      must(f.canUnjoin === false, '自带 .git 的目录不给撤销并入入口（它本来就是独立的仓库边界）', String(f.canUnjoin))
    }
    // G4：一路没有任何标记
    {
      const mem = makeMemFs()
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g4/plain', factsDeps(mem.fs))
      must(f.source === 'self' && f.noRecord === true && f.root === K('C:/g4/plain'),
        '一路没有任何标记：根就是所选目录自己，事实里标「没有任何记录」', JSON.stringify({ root: f.root, source: f.source, noRecord: f.noRecord }))
      must(f.outer === null && f.canMerge === false && f.canMarkIndependent === false && f.canUnjoin === false, '无记录情形不给纠正入口（没有可并的上级，也没有说明文件可标，更没有并入过）', JSON.stringify({ outer: f.outer }))
    }
    // G5：自己自带 .git、外面没有工作区
    {
      const mem = makeMemFs()
      mem.seed('C:/g5/.git', 'gitdir: somewhere')
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g5', factsDeps(mem.fs))
      must(f.source === 'git' && f.outer === null, '自带 .git 的根外面没有工作区时 outer 为 null（普通仓库不多说一句）', JSON.stringify({ source: f.source, outer: f.outer }))
      must(f.canMerge === false && f.canUnjoin === false, '自带 .git 的目录不能并入上级、也没有撤销并入（仓库边界不让人合并）', JSON.stringify({ canMerge: f.canMerge, canUnjoin: f.canUnjoin }))
    }
    // G6：只有身份记录的根
    {
      const mem = makeMemFs()
      mem.seed('C:/g6/docs/agents/workspace-root.yaml', 'kind: workspace-root')
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g6', factsDeps(mem.fs))
      must(f.source === 'record' && f.layer.hasIdentityRecord === true && f.outer === null && f.canMerge === false,
        '只有身份记录、外面没有工作区：不出现「并入上级」（没有可并的上级）', JSON.stringify({ source: f.source, outer: f.outer, canMerge: f.canMerge }))
    }
    // G7：连文件服务都没有 → 只说「没查清」，不给任何纠正入口
    {
      wm.forgetWorkspaceRootCache()
      const f = await wm.inspectWorkspaceFacts('C:/g7/plain', { getPlatform: async () => PLATFORM, getFs: () => null, getDefaultCwd: () => '' })
      must(f.probe === false && f.canMerge === false && f.canMarkIndependent === false && f.canUnjoin === false,
        '没有文件服务／探测能力时：probe 为假，三个纠正入口都不出现（不知道就别让人点）', JSON.stringify({ probe: f.probe, source: f.source }))
    }
    // G8：空路径与相对路径原样回答，不去猜一个目录
    {
      const empty = await wm.inspectWorkspaceFacts('', factsDeps(makeMemFs().fs))
      must(empty.source === 'empty' && empty.root === '', '空路径：source 是 empty，不猜默认目录', JSON.stringify(empty))
      wm.forgetWorkspaceRootCache()
      // 相对路径先由文件服务/主目录拼成绝对路径（与 canonicalWorkspaceKey 同一把尺子）；
      // 这里两样都拿不到，才落到「说不清是哪一层」这一档。
      const relF = await wm.inspectWorkspaceFacts('some/relative/dir', { getPlatform: async () => ({ os: PLATFORM.os, path: PLATFORM.path }), getFs: () => null, getDefaultCwd: () => '' })
      must(relF.source === 'relative', '相对路径：source 是 relative（连是哪一层都说不清，不给依据）', JSON.stringify({ source: relF.source, root: relF.root }))
    }
  }

  // ── H) 「并入上级」与「标为独立工作区」的写侧 ─────────────────────────────
  title('H) 「并入上级」与「标为独立工作区」（#1806 第 3 步）：写从属记录、可逆、删不掉就如实失败')
  {
    const MEMBER_REL = 'docs/agents/workspace-member.yaml'
    const mkDeps = (opts: any) => ({
      ctx: { get: () => null },
      getPlatform: async () => (opts && opts.fs ? { fs: opts.fs } : {}),
      getWorkspaceStore: async () => ({ invalidate() {} }),
      setCache: () => {},
      canonicalKey: async (raw: string) => raw,
      resolveSandboxPolicy: () => ({ policy: 'test-policy' }),
      invalidateRootCache: () => { wm.forgetWorkspaceRootCache() },
      logCtx: null,
      resolveFacts: opts && opts.resolveFacts,
    })
    const factsOf = (over: any) => Object.assign({
      cwd: 'C:/h/proj', root: 'C:/h/proj', source: 'record', cache: 'miss', probe: true,
      outer: { root: 'C:/h', source: 'git' },
      layer: { hasGit: false, hasBackendRecord: false, hasIdentityRecord: true, hasMemberRecord: false, hasTrackerDoc: false },
      rootLayer: null, noRecord: false, canMerge: true, canMarkIndependent: false,
    }, over || {})

    // H1～H3：只读的事实电话
    {
      const h = rec.createWorkspaceRecords(mkDeps({}))
      const empty = await h.handleWorkspaceFacts({})
      must(empty.ok === false && empty.error && empty.error.reason === 'empty-cwd', '事实电话：没有目录就回参数错，不去猜', JSON.stringify(empty))
    }
    {
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => { throw new Error('probe failed') } }))
      const out = await h.handleWorkspaceFacts({ cwd: 'C:/h/proj' })
      must(out.ok === false && out.error && out.error.kind === 'env' && out.error.reason === 'root-unknown',
        '事实电话：判定这一步出错时如实回「没查清」，不编一份依据', JSON.stringify(out))
    }
    {
      const facts = factsOf({})
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => facts }))
      const out = await h.handleWorkspaceFacts({ cwd: 'C:/h/proj' })
      must(out.ok === true && out.facts === facts, '事实电话：把判定层算出来的事实原样交回，界面不再自己猜', JSON.stringify(out).slice(0, 200))
    }

    // H4～H10：「并入上级」的守卫与成功路径
    {
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => factsOf({}) }))
      const relPath = await h.handleJoinParentWorkspace({ cwd: 'relative/proj' })
      must(relPath.ok === false && relPath.error && relPath.error.reason === 'not-absolute',
        '并入上级：相对路径拒绝（连是哪一层都答不出来，写下去可能落在插件当前目录上）', JSON.stringify(relPath))
    }
    {
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => { throw new Error('probe failed') } }))
      const out = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      must(out.ok === false && out.error && out.error.reason === 'root-unknown',
        '并入上级：判定出错时失败关闭，一份记录都不写', JSON.stringify(out))
    }
    {
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => factsOf({ root: 'C:/h', source: 'git' }) }))
      const out = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      must(out.ok === true && out.placed === false && out.reason === 'inside-workspace',
        '并入上级：这一层已经属于某个工作区时，明说「已经在里面」而不是再写一份', JSON.stringify(out))
    }
    {
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => factsOf({ layer: { hasGit: true } }) }))
      const out = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      must(out.ok === false && out.error && out.error.kind === 'state' && out.error.reason === 'git-root',
        '并入上级：自带 .git 的目录拒绝（仓库边界不能并进上级）', JSON.stringify(out))
    }
    {
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => factsOf({ layer: { hasMemberRecord: true } }) }))
      const out = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      must(out.ok === true && out.placed === false && out.reason === 'exists',
        '并入上级：已经有从属记录时幂等返回「已有」，不重写', JSON.stringify(out))
    }
    {
      const h = rec.createWorkspaceRecords(mkDeps({ resolveFacts: async () => factsOf({ outer: null }) }))
      const out = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      must(out.ok === false && out.error && out.error.kind === 'state' && out.error.reason === 'no-parent',
        '并入上级：外面没有另一个工作区时明说「没有可并入的上级」', JSON.stringify(out))
    }
    {
      const mem = makeMemFs()
      const cleared: any[] = []
      const h = rec.createWorkspaceRecords(Object.assign(mkDeps({ fs: mem.fs, resolveFacts: async () => factsOf({}) }), {
        getWorkspaceStore: async () => ({ invalidate(v: any) { cleared.push(v) } }),
      }))
      const out = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      const written = mem.read('C:/h/proj/' + MEMBER_REL)
      must(out.ok === true && out.placed === true && out.reason === 'created',
        '并入上级：写下一份从属记录，回包说明这次写了', JSON.stringify(out))
      must(!!written && written.indexOf('kind: workspace-member') >= 0 && written.indexOf('source: user') >= 0,
        '从属记录的内容：身份类型 workspace-member、来源是人的动作（user）', JSON.stringify(written))
      must(written.indexOf('workspace-root') < 0, '从属记录不是身份记录：它不声称「这一层是独立工作区」', JSON.stringify(written))
      must(cleared.length === 1, '写完清掉这一层的工作区缓存（画面立刻按新归属说话）', JSON.stringify(cleared))
      const again = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      must(again.ok === true && again.placed === false && again.reason === 'exists', '重复点「并入上级」：幂等返回已有，不重写', JSON.stringify(again))
    }
    {
      const mem = makeMemFs()
      const badFs: any = Object.assign({}, mem.fs)
      badFs.writeText = async (t: any) => { await mem.fs.writeText(t, 'got-mangled') }
      const h = rec.createWorkspaceRecords(mkDeps({ fs: badFs, resolveFacts: async () => factsOf({}) }))
      const out = await h.handleJoinParentWorkspace({ cwd: 'C:/h/proj' })
      must(out.ok === false && out.error && out.error.reason === 'read-back-mismatch',
        '并入上级：写完读回来不一致时这次写入不算数（不拿一份坏记录当成功）', JSON.stringify(out))
    }

    // H11～H12：「标为独立工作区」删从属记录（可逆）
    {
      const mem = makeMemFs()
      mem.seed('C:/h/promote/' + MEMBER_REL, 'kind: workspace-member')
      const h = rec.createWorkspaceRecords(mkDeps({ fs: mem.fs, resolveFacts: async () => factsOf({ cwd: 'C:/h/promote', root: 'C:/h/promote' }) }))
      const out = await h.handleMarkWorkspaceRoot({ cwd: 'C:/h/promote' })
      must(out.ok === true && out.placed === true && out.reason === 'promoted',
        '从「并入」状态标为独立：写身份记录并删从属记录，回包说明是「提升」', JSON.stringify(out))
      must(mem.read('C:/h/promote/' + MEMBER_REL) === null, '从属记录真的删掉了（删不掉的话归属还会继续往上）')
      must((mem.read('C:/h/promote/docs/agents/workspace-root.yaml') || '').indexOf('source: user') >= 0, '身份记录同时落下，来源是人的动作')
    }
    {
      const mem = makeMemFs()
      mem.seed('C:/h/nounlink/' + MEMBER_REL, 'kind: workspace-member')
      const fsNoUnlink: any = Object.assign({}, mem.fs)
      delete fsNoUnlink.unlink
      const h = rec.createWorkspaceRecords(mkDeps({ fs: fsNoUnlink, resolveFacts: async () => factsOf({ cwd: 'C:/h/nounlink', root: 'C:/h/nounlink' }) }))
      const out = await h.handleMarkWorkspaceRoot({ cwd: 'C:/h/nounlink' })
      must(out.ok === false && out.error && out.error.reason === 'member-delete-failed',
        '删不掉从属记录时如实报失败（身份记录可能已写，但界面看到的归属会与动作对不上，不能说成功）', JSON.stringify(out))
      must(mem.read('C:/h/nounlink/' + MEMBER_REL) !== null, '删不掉时从属记录确实还在（如实反映现场，不粉饰）')
    }
  }

  // ── I) 真文件服务的契约（#1806 第 5 步真机复核发现的两个写侧缺陷）──────────────
  title('I) 真文件服务的契约：lstat 对不存在的路径 resolve undefined、平台文件服务没有删除能力')
  {
    const IDENTITY_REL = 'docs/agents/workspace-root.yaml'
    const MEMBER_REL = 'docs/agents/workspace-member.yaml'
    // 真机实测（2026-11-03，web profile）：DSH 平台文件服务的 lstat 对不存在的路径 resolve undefined，
    // 不抛异常；平台服务（plat.fs）也没有 unlink / rm / delete / remove / trash / rename 任何一个。
    // 下面这组假文件服务按这两条真实契约回答，专门守住「单测全绿、真机不写」这类偏差。
    const makeRealContractMemFs = () => {
      const mem = makeMemFs()
      const origLstat = mem.fs.lstat
      mem.fs.lstat = async function (p: any) { try { return await origLstat(p) } catch (e) { return undefined } }
      return mem
    }
    const mkDeps = (opts: any) => ({
      ctx: { get: () => null },
      getPlatform: async () => (opts && opts.fs ? { fs: opts.fs } : {}),
      getWorkspaceStore: async () => ({ invalidate() {} }),
      setCache: () => {},
      canonicalKey: async (raw: string) => raw,
      resolveSandboxPolicy: () => ({ policy: 'test-policy' }),
      invalidateRootCache: () => {},
      logCtx: null,
      resolveFacts: opts && opts.resolveFacts,
    })
    const factsFor = (cwd: string) => ({
      cwd: cwd, root: cwd, source: 'record', cache: 'miss', probe: true,
      outer: { root: nodePath.dirname(cwd), source: 'git' },
      layer: { hasGit: false, hasBackendRecord: false, hasIdentityRecord: false, hasMemberRecord: false, hasTrackerDoc: true },
      rootLayer: null, noRecord: true, canMerge: true, canMarkIndependent: true,
    })
    // I1：「不在」要被当成不在 —— 原来的写法（调用没抛错就算在）把每个路径都判成存在，
    //     初始化补写永远 placed:false，人点「标为独立工作区」也永远什么都不写。
    {
      const mem = makeRealContractMemFs()
      const h = rec.createWorkspaceRecords(mkDeps({ fs: mem.fs, resolveFacts: async () => factsFor('C:/i/write') }))
      const out = await h.handleEnsureWorkspaceRecord({ cwd: 'C:/i/write' })
      const written = mem.read('C:/i/write/' + IDENTITY_REL)
      must(out.ok === true && out.placed === true,
        '真机契约下初始化补写真的会写一份身份记录（缺失不再被当成存在）', JSON.stringify(out))
      must(!!written && written.indexOf('kind: workspace-root') >= 0,
        '写下去的内容是一份身份记录，来源是初始化流程', JSON.stringify(written === null ? null : written.slice(0, 120)))
      const again = await h.handleEnsureWorkspaceRecord({ cwd: 'C:/i/write' })
      must(again.ok === true && again.placed === false && again.reason === 'exists',
        '已经有记录时仍然幂等返回「已有」，不重写', JSON.stringify(again))
    }
    {
      const mem = makeRealContractMemFs()
      const h = rec.createWorkspaceRecords(mkDeps({ fs: mem.fs, resolveFacts: async () => factsFor('C:/i/mark') }))
      const out = await h.handleMarkWorkspaceRoot({ cwd: 'C:/i/mark' })
      must(out.ok === true && out.placed === true,
        '真机契约下人点「标为独立工作区」真的会落一份身份记录（这正是 #1806 第 5 步真机复核点不动的原因）', JSON.stringify(out))
      must((mem.read('C:/i/mark/' + IDENTITY_REL) || '').indexOf('source: user') >= 0,
        '身份记录的来源是人的动作（user）', JSON.stringify(mem.read('C:/i/mark/' + IDENTITY_REL)))
    }
    // I2：平台文件服务没有删除能力时，退到 Node 的文件系统把从属记录删掉。
    {
      const realNoUnlink: any = Object.assign({}, realFs)
      delete realNoUnlink.unlink
      const child = nodePath.join(TMP, 'i-promote')
      fsx.mkdirSync(nodePath.join(child, 'docs', 'agents'), { recursive: true })
      fsx.writeFileSync(nodePath.join(child, MEMBER_REL), 'kind: workspace-member\n', 'utf8')
      fsx.writeFileSync(nodePath.join(child, IDENTITY_REL), 'kind: workspace-root\n', 'utf8')
      const h = rec.createWorkspaceRecords(mkDeps({ fs: realNoUnlink, resolveFacts: async () => factsFor(child) }))
      const out = await h.handleMarkWorkspaceRoot({ cwd: child })
      must(out.ok === true && out.reason === 'promoted',
        '文件服务不会删时：靠 Node 的文件系统把从属记录删掉，回包说明是「提升」', JSON.stringify(out))
      must(fsx.existsSync(nodePath.join(child, MEMBER_REL)) === false,
        '从属记录真的删掉了（删不掉「并入上级」就永远撤不回来）')
      must(fsx.existsSync(nodePath.join(child, IDENTITY_REL)) === true, '删从属记录不动原来的身份记录')
    }
    // I3：所有删除通道都失败时如实报失败，并以探测结果裁决（不假装成功）。
    {
      const realNoUnlink: any = Object.assign({}, realFs)
      delete realNoUnlink.unlink
      const child = nodePath.join(TMP, 'i-stuck')
      fsx.mkdirSync(nodePath.join(child, MEMBER_REL), { recursive: true })   // 用目录占住从属记录的位置：unlink 删不掉目录
      fsx.writeFileSync(nodePath.join(child, IDENTITY_REL), 'kind: workspace-root\n', 'utf8')
      const h = rec.createWorkspaceRecords(mkDeps({ fs: realNoUnlink, resolveFacts: async () => factsFor(child) }))
      const out = await h.handleMarkWorkspaceRoot({ cwd: child })
      must(out.ok === false && out.error && out.error.reason === 'member-delete-failed',
        '所有删除通道都失败时如实报失败（身份记录可能已写，但归属还与动作对不上，不能说成功）', JSON.stringify(out))
      must(fsx.existsSync(nodePath.join(child, MEMBER_REL)) === true, '删不掉时从属记录确实还在（如实反映现场）')
    }
  }

  const okAll = broken.length === 0
  console.log(okAll ? ('全部 ' + total + ' 条判据都守住了') : ('有 ' + broken.length + ' 条判据没守住：'))
  if (!okAll) { for (const b of broken) console.log('  - ' + b); cleanup(); process.exit(1) }
  cleanup()
}

main().catch((e) => { console.error(e && e.stack || e); cleanup(); process.exit(1) })
