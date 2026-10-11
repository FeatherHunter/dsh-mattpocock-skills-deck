#!/usr/bin/env node
/**
 * verify-1003-layout-in-file.js —— 「面板布局属于工作区文件」这条不变式的门禁。
 *
 * 依据：#1003 实施契约上位口径第 7 条与验收标准「面板布局能从这份文件读回」；
 * 维护者 2026-10-12 明确：布局就是「这个工作区用单栏还是多栏」的选择，因此放进工作区文件是合理的，必须做到。
 *
 * 钉五件事：① 写布局落进工作区文件（文件里真出现那一行，回执说 written）；
 *   ② 文件为准：文件里是 single 就读 single，哪怕本机记忆里是 multi；
 *   ③ 文件里没有这一项时退回本机记忆（老工作区的过渡来源，不是真源）；
 *   ④ 空目录如实失败、不拿进程目录冒充；⑤ 拿不到文件通道时不谎报成功。
 *
 * 用法：node tests/verify-1003-layout-in-file.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const makeFs = (broken) => ({
  async resolve(p, opts) { const base = (opts && opts.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel },
  async readText(t) { return fs.readFileSync(String(t).replace(/\//g, path.sep), 'utf8') },
  async writeText(t, c) { if (broken) throw Object.assign(new Error('EACCES: 沙箱不给写许可'), { code: 'EACCES' }); const real = String(t).replace(/\//g, path.sep); fs.mkdirSync(path.dirname(real), { recursive: true }); fs.writeFileSync(real, String(c), 'utf8') },
  async mkdir(t) { fs.mkdirSync(String(t).replace(/\//g, path.sep), { recursive: true }) },
})

const { createWorkspaceCwd } = await imp('src/host/workspaceCwd.js')
const { createChoiceStore } = await imp('src/host/choiceStore.js')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003layout-home-'))
const store = createChoiceStore({ homeDir: home, isKnownBackend: () => true })
const mkApi = (fsSvc) => createWorkspaceCwd({
  ctx: { get: () => undefined }, DEFAULT_CWD: '',
  getPlatform: async () => ({ fs: fsSvc, path: path, getHome: async () => home }),
  getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
  getWorkspaceStore: async () => ({ invalidate: () => {} }),
  getChoiceStore: async () => store,
  canonicalKey: async (c) => c, setCache: () => {}, timer: { timeout: () => null },
  detectionExec: async () => ({}), logCtx: null,
})
const mkWs = () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003layout-ws-'))
  fs.mkdirSync(path.join(ws, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\npickedAt: 1758500000000\nsource: user\n', 'utf8')
  return ws
}
const yamlOf = (ws) => fs.readFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'utf8')

console.log('== ① 写布局落进工作区文件 ==')
const ws = mkWs()
const api = mkApi(makeFs(false))
const w = await api.handleSetupLayout({ cwd: ws, layout: 'multi' })
check(w.ok === true && w.layout === 'multi', '写布局回执成功 —— 实得 ' + JSON.stringify(w))
check(w.workspaceFile === 'written', '回执如实说这次写进了工作区文件 —— 实得 workspaceFile=' + w.workspaceFile)
check(yamlOf(ws).includes('backendId: github'), '写布局没有把文件里原有的后端记录弄丢')

console.log('')
console.log('== ② 文件为准（记忆里是 multi，文件里是 single 就读 single）==')
fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), yamlOf(ws).replace('layout: multi', 'layout: single'), 'utf8')
const r = await api.handleSetupLayout({ cwd: ws })
check(r.ok === true && r.layout === 'single', '文件里写着 single 时读回来是 single（不拿本机记忆顶替）—— 实得 ' + JSON.stringify(r))
const mem = await store.getLayout(ws)
check(mem.found === true && mem.layout === 'multi', '（对照）本机记忆里那条仍然是 multi，说明上面读的确实是文件 —— 实得 ' + JSON.stringify(mem))

console.log('')
console.log('== ③ 文件里没有这一项时退回本机记忆 ==')
fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\npickedAt: 1758500000000\nsource: user\n', 'utf8')
const r2 = await api.handleSetupLayout({ cwd: ws })
check(r2.ok === true && r2.layout === 'multi', '文件里没有布局时退回本机记忆里的 multi（老工作区的过渡来源）—— 实得 ' + JSON.stringify(r2))

console.log('')
console.log('== ④ 空目录：如实失败、不拿进程目录冒充 ==')
const empty = await api.handleSetupLayout({ cwd: '', layout: 'multi' })
check(empty.ok === false, '空目录写布局：如实失败 —— 实得 ' + JSON.stringify(empty))
const emptyRead = await api.handleSetupLayout({ cwd: '' })
check(emptyRead.ok === true && emptyRead.layout === null, '空目录读布局：回空（不说有布局）—— 实得 ' + JSON.stringify(emptyRead))

console.log('')
console.log('== ⑤ 拿不到文件通道时不谎报成功 ==')
const wsBroken = mkWs()
const apiBroken = mkApi(makeFs(true))
const wb = await apiBroken.handleSetupLayout({ cwd: wsBroken, layout: 'multi' })
check(wb.ok === true && wb.workspaceFile !== 'written', '写不进文件时不谎报「已写进文件」（回执如实标出没进文件的原因）—— 实得 ' + JSON.stringify(wb))

fs.rmSync(home, { recursive: true, force: true })
console.log('')
console.log(failed ? '存在失败 — 布局属于工作区文件这条没守住（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 布局进工作区文件（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
