#!/usr/bin/env node
/**
 * verify-1449-layout-single-source.ts —— 布局答案只留一处、只走一条读取路径（#1449）。
 *
 * 依据：#1449 拍板（2026-10-24）：工作区 YAML 是第一优先级，没必要的情况下不要另外两处存储；
 *   文件写不进去就如实提示没有写入权限，不再留本机备份；接受删掉浏览器本地表后、快照到达前按「未答过」处理。
 *
 * 钉四件事：
 *   ① 写入只落工作区文件：本机记忆（choices.json）不再有布局读写口，写失败也不留第二份；
 *   ② 快照读同一份文件：写进去的布局，快照原样读回来；文件里没有就是「还没答过」；
 *   ③ 读取路径只剩一条：内核注入读会话选择 → 快照回包，浏览器本地表与迁移码全仓不再出现；
 *   ④ 双产物同口径：构建出来的两个 client.js 里没有旧表键，客户端仍按「含空值」合并快照回包。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1449-layout-single-source.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let passed = 0
let failed = 0
const check = (ok: boolean, msg: string) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const readSrc = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const makeFs = () => ({
  async resolve(p: unknown, opts?: { cwd?: string }) { const base = (opts && opts.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel },
  async readText(t: unknown) { return fs.readFileSync(String(t).replace(/\//g, path.sep), 'utf8') },
  async writeText(t: unknown, c: unknown) { const real = String(t).replace(/\//g, path.sep); fs.mkdirSync(path.dirname(real), { recursive: true }); fs.writeFileSync(real, String(c), 'utf8') },
  async mkdir(t: unknown) { fs.mkdirSync(String(t).replace(/\//g, path.sep), { recursive: true }) },
})
type StubFs = ReturnType<typeof makeFs>

const { createWorkspaceCwd } = await imp('src/host/workspaceCwd.js')
const { createChoiceStore, choicesDirectory, CHOICES_FILE_NAME } = await imp('src/host/choiceStore.ts')
const { createSessionSnapshot } = await imp('src/refresh/rooms/host/session-snapshot-cache.js')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'v1449layout-home-'))
const store = createChoiceStore({ homeDir: home, isKnownBackend: () => true })
const choicesPath = path.join(choicesDirectory(home), CHOICES_FILE_NAME)
const choicesDoc = () => fs.existsSync(choicesPath) ? JSON.parse(fs.readFileSync(choicesPath, 'utf8')) : { version: 1, workspaces: {}, layouts: {} }
const mkWs = () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'v1449layout-ws-'))
  fs.mkdirSync(path.join(ws, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\npickedAt: 1758500000000\nsource: user\n', 'utf8')
  return ws
}
const yamlOf = (ws: string) => fs.readFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'utf8')
const mkApi = (fsSvc: StubFs) => createWorkspaceCwd({
  ctx: { get: () => undefined }, DEFAULT_CWD: '',
  getPlatform: async () => ({ fs: fsSvc, path: path, getHome: async () => home }),
  getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
  getWorkspaceStore: async () => ({ invalidate: () => {} }),
  getChoiceStore: async () => store,
  canonicalKey: async (c: unknown) => c, setCache: () => {}, timer: { timeout: () => null },
  detectionExec: async () => ({}), logCtx: null,
})
const mkSnapDeps = (fsSvc: StubFs) => ({
  canonicalKey: async (c: unknown) => c,
  // 这一档只量「布局从哪来」：让 selection 为空，快照走「还没选后端」那条本地拼装路（不联网、不碰后端）。
  selectEarly: async () => null,
  isComposerSelection: () => false,
  getTrackerRegistry: async () => ({ get: () => ({}), describe: () => null, modules: () => [] }),
  getPlatform: async () => ({ fs: fsSvc, path: path }),
  ctx: { get: (n: unknown) => n === 'fs' ? fsSvc : undefined },
  getCache: () => ({ ts: 0, snapshot: null }),
  setCache: () => {}, CACHE_MS: 60000, cacheSnapshotIsCurrent: async () => true,
  upcaseSnapStates: (s: unknown) => s, computeLevels: () => ({}), groupTickets: () => ({}),
  getRepoRoot: async (c: unknown) => c, getRepoKey: async () => ({ owner: 'o', name: 'n' }),
  readDiskCache: async () => null, writeDiskCache: async () => {},
  adoptSnapshot: (s: unknown) => s, detectionExec: async () => ({}),
  getGhPath: () => null, getGhLastError: () => null, errText: (e: unknown) => String(((e as any) && (e as any).message) || e),
  DEFAULT_CWD: '', logCtx: null, envelope: null, send: null,
})

console.log('== ① 写入只落工作区文件，本机记忆不再存布局 ==')
const ws = mkWs()
const api = mkApi(makeFs())
const w = await api.handleSetupLayout({ cwd: ws, layout: 'multi' })
check(w.ok === true && w.workspaceFile === 'written', '写布局回执说写进了工作区文件 —— 实得 ' + JSON.stringify(w))
check(yamlOf(ws).includes('layout: multi'), '文件里真出现 layout: multi')
check(typeof (store as any).getLayout === 'undefined' && typeof (store as any).rememberLayout === 'undefined', '本机记忆没有布局读写口（旧 API 已删）')
check(Object.keys(choicesDoc().layouts || {}).length === 0, '写成功后 choices.json 里没有多出一份布局复印件')

console.log('')
console.log('== ② 快照读同一份文件：写进去的读得回来，没有就是没答过 ==')
const out: any = await createSessionSnapshot(mkSnapDeps(makeFs())).handleSnapshot({ cwd: ws })
check(out && out.setupLayout && out.setupLayout.layout === 'multi', '快照读到同一份文件里的布局（写→读闭环）—— 实得 ' + JSON.stringify(out && out.setupLayout))
fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), yamlOf(ws).replace(/layout: multi\n?/, ''), 'utf8')
const out2: any = await createSessionSnapshot(mkSnapDeps(makeFs())).handleSnapshot({ cwd: ws })
check((out2 && out2.setupLayout) == null, '文件里没有布局时快照回空（不回退任何第二份存储）—— 实得 ' + JSON.stringify(out2 && out2.setupLayout))

console.log('')
console.log('== ③ 读取路径只剩一条：会话选择 → 快照回包 ==')
const prompts = readSrc('src/client/kernel/prompts.ts')
check(prompts.includes('snap.setupLayout'), '内核读布局先看快照回包')
check(prompts.includes('st.setupLayout'), '内核仍认本次会话的选择（当场改的立刻生效）')
check(!prompts.includes('getCachedSetupLayout'), '内核不再声明浏览器本地表的读取口')
const status = readSrc('src/client/statusbar/StatusBackend.ts')
check(status.includes('snapshot.setupLayout') || status.includes('snapshot && s.snapshot.setupLayout'), '状态栏读布局看快照回包')
check(!status.includes('getCachedSetupLayout') && !status.includes('setCachedSetupLayout'), '状态栏不再读写浏览器本地表')
const prefs = readSrc('src/client/kernel/store-prefs.ts')
check(!prefs.includes('SETUP_LAYOUT_BY_CWD_KEY') && !prefs.includes('dsws.setupLayoutByCwd'), '偏好模块里那张布局表已整段删除')
check(!prefs.includes('migrateCachedChoiceToKey'), '按根键迁移旧布局的迁移码已删')
const sync = readSrc('src/refresh/rooms/client/snapshot-sync.ts')
const probe = readSrc('src/refresh/rooms/client/probe-scope-selection.ts')
check(sync.includes('snap.setupLayout !== undefined') && sync.includes('st.snapshot'), '304 回包按「含空值」合并进会话快照（null 也能清空旧答案）')
check(probe.includes('snap.setupLayout !== undefined') && probe.includes('st.snapshot'), '正常回包与迟到回包同样把布局合并进会话快照')
const storeSrc = readSrc('src/host/choiceStore.ts')
check(!/function\s+(getLayout|rememberLayout)\b/.test(storeSrc), '宿主状态文件不再提供布局读写函数')

console.log('')
console.log('== ④ 双产物同口径：旧表键不在，客户端仍按含空值合并 ==')
for (const rel of ['client.js', 'package/lib/client.js']) {
  const bundle = readSrc(rel)
  check(!bundle.includes('dsws.setupLayoutByCwd') && !bundle.includes('getCachedSetupLayout'), rel + ' 里没有浏览器本地表的旧读取口')
  check(bundle.includes('snap.setupLayout !== void 0'), rel + ' 里客户端仍按「含空值」合并快照里的布局')
}

console.log('')
console.log('== ⑤ 全仓手写源码：旧的三处存储痕迹清零 ==')
const banned = ['dsws.setupLayoutByCwd', 'SETUP_LAYOUT_BY_CWD_KEY', 'getCachedSetupLayout', 'setCachedSetupLayout', 'migrateCachedChoiceToKey', 'rememberLayout']
const offenders: string[] = []
const walk = (dir: string) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) { walk(full); continue }
    if (!/\.(ts|mts)$/.test(ent.name)) continue
    const text = fs.readFileSync(full, 'utf8')
    for (const word of banned) if (text.includes(word)) offenders.push(path.relative(ROOT, full) + ' → ' + word)
  }
}
walk(path.join(ROOT, 'src'))
check(offenders.length === 0, 'src 下不再出现旧布局读写口（' + (offenders.length ? offenders.join('；') : '零处') + '）')

fs.rmSync(home, { recursive: true, force: true })
console.log('')
console.log(failed ? '存在失败 — 布局答案还没收成单一真源（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 布局答案单一真源（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
