#!/usr/bin/env node
/**
 * verify-1003-layout-in-file.js —— 「域文档布局属于工作区文件」这条不变式的门禁。
 *
 * 依据：#1003 实施契约上位口径第 7 条与验收标准「域文档布局能从这份文件读回」；
 * 维护者 2026-10-12 明确：布局就是「这个仓库的域文档布局是单上下文还是多上下文」的选择，因此放进工作区文件是合理的，必须做到。
 * #1449 起口径收紧：工作区文件是布局的唯一真源，本机记忆（H）里不再有布局读写口，老 layouts 栏只原样带过、不再当答案读。
 *
 * 钉五件事：① 写布局落进工作区文件（文件里真出现那一行，回执说 written），且本机记忆里不再记布局；
 *   ② 文件为准：文件里是 single 就读 single；
 *   ③ 文件里没有这一项时回空，不再退回本机记忆（老 layouts 栏即使有值也不读）；
 *   ④ 空目录如实失败、不拿进程目录冒充；⑤ 拿不到文件通道时不谎报成功、也不留本机备份。
 *
 * 用法：node tests/verify-1003-layout-in-file.ts
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

const makeFs = (broken: boolean) => ({
  async resolve(p: unknown, opts?: { cwd?: string }) { const base = (opts && opts.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel },
  async readText(t: unknown) { return fs.readFileSync(String(t).replace(/\//g, path.sep), 'utf8') },
  async writeText(t: unknown, c: unknown) { if (broken) throw Object.assign(new Error('EACCES: 沙箱不给写许可'), { code: 'EACCES' }); const real = String(t).replace(/\//g, path.sep); fs.mkdirSync(path.dirname(real), { recursive: true }); fs.writeFileSync(real, String(c), 'utf8') },
  async mkdir(t: unknown) { fs.mkdirSync(String(t).replace(/\//g, path.sep), { recursive: true }) },
})
type StubFs = ReturnType<typeof makeFs>

const { createWorkspaceCwd } = await imp('src/host/workspaceCwd.js')
const { createChoiceStore, choicesDirectory, CHOICES_FILE_NAME } = await imp('src/host/choiceStore.ts')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003layout-home-'))
const store = createChoiceStore({ homeDir: home, isKnownBackend: () => true })
const choicesDoc = () => JSON.parse(fs.readFileSync(path.join(choicesDirectory(home), CHOICES_FILE_NAME), 'utf8'))
const mkApi = (fsSvc: StubFs, canonicalKey?: (c: unknown) => Promise<unknown>) => createWorkspaceCwd({
  ctx: { get: () => undefined }, DEFAULT_CWD: '',
  getPlatform: async () => ({ fs: fsSvc, path: path, getHome: async () => home }),
  getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
  getWorkspaceStore: async () => ({ invalidate: () => {} }),
  getChoiceStore: async () => store,
  canonicalKey: canonicalKey || (async (c: unknown) => c), setCache: () => {}, timer: { timeout: () => null },
  detectionExec: async () => ({}), logCtx: null,
})
const mkWs = () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003layout-ws-'))
  fs.mkdirSync(path.join(ws, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\npickedAt: 1758500000000\nsource: user\n', 'utf8')
  return ws
}
const yamlOf = (ws: string) => fs.readFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'utf8')

console.log('== ① 写布局落进工作区文件 ==')
const ws = mkWs()
const api = mkApi(makeFs(false))
const w = await api.handleSetupLayout({ cwd: ws, layout: 'multi' })
check(w.ok === true && w.layout === 'multi', '写布局回执成功 —— 实得 ' + JSON.stringify(w))
check(w.workspaceFile === 'written', '回执如实说这次写进了工作区文件 —— 实得 workspaceFile=' + w.workspaceFile)
check(yamlOf(ws).includes('backendId: github'), '写布局没有把文件里原有的后端记录弄丢')
check(yamlOf(ws).includes('layout: multi'), '文件里真出现 layout: multi —— 实得 ' + JSON.stringify(yamlOf(ws)))
check(fs.existsSync(path.join(choicesDirectory(home), CHOICES_FILE_NAME)) === false || Object.keys(choicesDoc().layouts || {}).length === 0, '本机记忆里没有记布局（layouts 栏空着）')

console.log('')
console.log('== ② 文件为准（文件里是 single 就读 single）==')
fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), yamlOf(ws).replace('layout: multi', 'layout: single'), 'utf8')
const r = await api.handleSetupLayout({ cwd: ws })
check(r.ok === true && r.layout === 'single', '文件里写着 single 时读回来是 single —— 实得 ' + JSON.stringify(r))

console.log('')
console.log('== ③ 文件里没有这一项时回空，不再退回本机记忆 ==')
// 老数据：本机记忆里还留着一条带散列键的布局记录（#1449 之前写的）。它不该再被当答案读。
const LEGACY_KEY = '0123456789abcdef01234567'
fs.mkdirSync(path.join(choicesDirectory(home)), { recursive: true })
fs.writeFileSync(path.join(choicesDirectory(home), CHOICES_FILE_NAME), JSON.stringify({ version: 1, workspaces: {}, layouts: { [LEGACY_KEY]: { layout: 'multi', pickedAt: 1758500000000 } } }), 'utf8')
const wsNoLayout = mkWs()
const apiLegacy = mkApi(makeFs(false), async () => LEGACY_KEY)
const r2 = await apiLegacy.handleSetupLayout({ cwd: wsNoLayout })
check(r2.ok === true && r2.layout === null, '文件里没有布局时回空，不读老本机记忆里的 multi —— 实得 ' + JSON.stringify(r2))
check(typeof store.getLayout === 'undefined' && typeof store.rememberLayout === 'undefined', '本机记忆不再提供布局读写口')

console.log('')
console.log('== ④ 空目录：如实失败、不拿进程目录冒充 ==')
const empty = await api.handleSetupLayout({ cwd: '', layout: 'multi' })
check(empty.ok === false, '空目录写布局：如实失败 —— 实得 ' + JSON.stringify(empty))
const emptyRead = await api.handleSetupLayout({ cwd: '' })
check(emptyRead.ok === true && emptyRead.layout === null, '空目录读布局：回空（不说有布局）—— 实得 ' + JSON.stringify(emptyRead))

console.log('')
console.log('== ⑤ 拿不到文件通道时不谎报成功、也不留本机备份 ==')
fs.writeFileSync(path.join(choicesDirectory(home), CHOICES_FILE_NAME), JSON.stringify({ version: 1, workspaces: {}, layouts: {} }), 'utf8')
const wsBroken = mkWs()
const apiBroken = mkApi(makeFs(true))
const wb = await apiBroken.handleSetupLayout({ cwd: wsBroken, layout: 'multi' })
check(wb.ok === false && wb.workspaceFile !== 'written', '写不进文件时不谎报成功（回执如实标出没进文件的原因）—— 实得 ' + JSON.stringify(wb))
check(String(wb.error || '').includes('没有生效'), '失败回执说清「这次选择没有生效」—— 实得 ' + JSON.stringify(wb.error))
const brokenDocKeys = Object.keys((choicesDoc().layouts || {}))
check(brokenDocKeys.length === 0, '失败后本机记忆里也没有留备份（layouts 仍为空）—— 实得 ' + JSON.stringify(brokenDocKeys))

console.log('')
console.log('== ⑥ 不认的布局值不落盘 ==')
const wsBad = mkWs()
const bad = await api.handleSetupLayout({ cwd: wsBad, layout: 'neither' })
check(bad.ok === false && bad.error === 'not-stored', '不认的布局值如实回 not-stored —— 实得 ' + JSON.stringify(bad))
check(!yamlOf(wsBad).includes('layout:'), '不认的值没写进文件')

fs.rmSync(home, { recursive: true, force: true })
console.log('')
console.log(failed ? '存在失败 — 布局属于工作区文件这条没守住（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 布局进工作区文件（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
