#!/usr/bin/env node
/**
 * verify-1433-snapshot-layout-file.ts —— 快照里的布局答案以工作区文件为准（#1433）。
 *
 * 依据：#1433 拍板（工作区文件是布局的唯一真源）与验收第 1–4 条。
 * 电话读（wf.setupLayout）此前已做到文件优先（verify-1003-layout-in-file 钉着），
 * 快照这条路此前只读本机记忆：手改文件后，落后的那扇窗永远停在老答案上。
 *
 * 钉五件事：① 内存命中：文件里 single 压过记忆里的 multi 与缓存里的 multi；
 *   ② 文件里没有布局时退回本机记忆（老工作区的过渡来源）；
 *   ③ 文件与记忆都没有时抹掉缓存里的旧答案（不留上一次的值）；
 *   ④ 磁盘回放：盘里是 multi、文件里是 single，照样回 single；
 *   ⑤ 拿不到文件通道时退回记忆、不断言崩。
 * 另加两条静态：读函数走 WORKSPACE_FILE_REL（文件优先的接线仍在）；
 *   旧的「没答案就留旧值」条件（sameLayout || !_layEarly）已删。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1433-snapshot-layout-file.ts
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

const norm = (p: unknown) => String(p || '').replace(/\\/g, '/')
const makeFs = () => ({
  async resolve(p: unknown, opts?: { cwd?: string }) { const base = (opts && opts.cwd) || ''; return norm(base) + '/' + norm(p) },
  async readText(t: unknown) { return fs.readFileSync(String(t).replace(/\//g, path.sep), 'utf8') },
  async writeText() { throw new Error('readonly') },
  async mkdir(t: unknown) { fs.mkdirSync(String(t).replace(/\//g, path.sep), { recursive: true }) },
})
type StubFs = ReturnType<typeof makeFs>

const { createSessionSnapshot } = await imp('src/refresh/rooms/host/session-snapshot-cache.js')
const { createChoiceStore } = await imp('src/host/choiceStore.ts')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'v1433layout-home-'))
const mkWs = (layoutLine: string | null) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'v1433layout-ws-'))
  fs.mkdirSync(path.join(ws, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\npickedAt: 1758500000000\nsource: user\n' + (layoutLine ? ('layout: ' + layoutLine + '\n') : ''), 'utf8')
  return ws
}
const mkDeps = (store: any, fsSvc: StubFs, cached: any, disk: any) => ({
  canonicalKey: async (c: unknown) => c,
  selectEarly: async () => ({ backendId: 'github', rev: 0 }),
  isComposerSelection: () => false,
  getTrackerRegistry: async () => ({ get: () => ({}), describe: () => null, modules: () => [] }),
  getPlatform: async () => ({ fs: fsSvc, path: path }),
  ctx: { get: (n: unknown) => n === 'fs' ? fsSvc : undefined },
  getCache: () => (cached ? { ts: Date.now(), snapshot: { selection: { backendId: 'github', rev: 0 }, setupLayout: cached } } : { ts: 0, snapshot: null }),
  setCache: () => {}, CACHE_MS: 60000, cacheSnapshotIsCurrent: async () => true,
  upcaseSnapStates: (s: unknown) => s, computeLevels: () => ({}), groupTickets: () => ({}),
  getRepoRoot: async (c: unknown) => c, getRepoKey: async () => ({ owner: 'o', name: 'n' }),
  readDiskCache: async () => disk, writeDiskCache: async () => {},
  adoptSnapshot: (s: unknown) => s, detectionExec: async () => ({}),
  getGhPath: () => null, getGhLastError: () => null, errText: (e: unknown) => String(((e as any) && (e as any).message) || e),
  DEFAULT_CWD: '', logCtx: null, getChoiceStore: async () => store, envelope: null, send: null,
})
const mkStore = () => createChoiceStore({ homeDir: home, isKnownBackend: () => true })

console.log('== \u2460 \u5185\u5b58\u547d\u4e2d\uff1a\u6587\u4ef6\u91cc single \u538b\u8fc7\u8bb0\u5fc6\u4e0e\u7f13\u5b58\u91cc\u7684 multi ==')
{
  const store = mkStore(); const ws = mkWs('single'); await store.rememberLayout(ws, 'multi')
  const out: any = await createSessionSnapshot(mkDeps(store, makeFs(), { layout: 'multi', pickedAt: 111 }, null)).handleSnapshot({ cwd: ws })
  check(out && out.setupLayout && out.setupLayout.layout === 'single', '\u624b\u6539\u6587\u4ef6\u540e\u5feb\u7167\u56de single（\u4e0d\u62ff\u843d\u540e\u8bb0\u5fc6\u9876\u66ff\uFF09—— \u5b9e\u5f97 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== \u2461 \u6587\u4ef6\u91cc\u6ca1\u6709\u5e03\u5c40\u65f6\u9000\u56de\u672c\u673a\u8bb0\u5fc6 ==')
{
  const store = mkStore(); const ws = mkWs(null); await store.rememberLayout(ws, 'multi')
  const out: any = await createSessionSnapshot(mkDeps(store, makeFs(), { layout: 'single', pickedAt: 111 }, null)).handleSnapshot({ cwd: ws })
  check(out && out.setupLayout && out.setupLayout.layout === 'multi', '\u9000\u56de\u8bb0\u5fc6\u91cc\u7684 multi（\u8001\u5de5\u4f5c\u533a\u7684\u8fc7\u6e21\u6765\u6e90\uFF09—— \u5b9e\u5f97 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== \u2462 \u6587\u4ef6\u4e0e\u8bb0\u5fc6\u90fd\u6ca1\u6709\u65f6\u62b9\u6389\u7f13\u5b58\u65e7\u7b54\u6848 ==')
{
  const store = mkStore(); const ws = mkWs(null)
  const out: any = await createSessionSnapshot(mkDeps(store, makeFs(), { layout: 'multi', pickedAt: 111 }, null)).handleSnapshot({ cwd: ws })
  check((out && out.setupLayout) == null, '\u5feb\u7167\u91cc\u4e0d\u7559\u4e0a\u4e00\u6b21\u7684\u503c—— \u5b9e\u5f97 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== \u2463 \u78c1\u76d8\u56de\u653e\uff1a\u76d8\u91cc multi、\u6587\u4ef6\u91cc single \u7167\u6837\u56de single ==')
{
  const store = mkStore(); const ws = mkWs('single'); await store.rememberLayout(ws, 'multi')
  const disk = { selection: { backendId: 'github', rev: 0 }, generatedMs: Date.now(), setupLayout: { layout: 'multi', pickedAt: 111 } }
  const out: any = await createSessionSnapshot(mkDeps(store, makeFs(), null, disk)).handleSnapshot({ cwd: ws })
  check(out && out.setupLayout && out.setupLayout.layout === 'single', '\u76d8\u7f13\u5b58\u4e5f\u6309\u8fd9\u4e00\u8f6e\u7684\u6587\u4ef6\u76d6—— \u5b9e\u5f97 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== \u2464 \u62ff\u4e0d\u5230\u6587\u4ef6\u901a\u9053\u65f6\u9000\u56de\u8bb0\u5fc6\u3001\u4e0d\u5d29 ==')
{
  const store = mkStore(); const ws = mkWs('single'); await store.rememberLayout(ws, 'multi')
  const deps: any = mkDeps(store, makeFs(), { layout: 'single', pickedAt: 111 }, null)
  deps.getPlatform = async () => ({}); deps.ctx = { get: () => undefined }
  const out: any = await createSessionSnapshot(deps).handleSnapshot({ cwd: ws })
  check(out && out.setupLayout && out.setupLayout.layout === 'multi', '\u65e0\u901a\u9053\u65f6\u7528\u8bb0\u5fc6\u7684 multi \u9876\u4e00\u4e0b—— \u5b9e\u5f97 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== \u9759\u6001\u9762\uFF1A\u8bfb\u51fd\u6570\u8d70\u6587\u4ef6\u3001\u65e7\u6761\u4ef6\u5df2\u5220 ==')
{
  const text = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/session-snapshot-cache.ts'), 'utf8')
  check(text.includes('WORKSPACE_FILE_REL'), '\u8bfb\u51fd\u6570\u8ba4\u5de5\u4f5c\u533a\u6587\u4ef6\u7684\u4f4d\u7f6e\uFF08\u63a5\u7ebf仍\u5728\uFF09')
  check(!text.includes('sameLayout || !_layEarly'), '\u65e7\u7684\u201c\u6ca1\u7b54\u6848\u5c31\u7559\u65e7\u503c\u201d\u6761\u4ef6\u5df2\u5220')
}

fs.rmSync(home, { recursive: true, force: true })
console.log('')
console.log(failed ? '\u5b58\u5728\u5931\u8d25 — \u5feb\u7167\u5e03\u5c40\u4ee5\u6587\u4ef6\u4e3a\u51c6\u8fd9\u6761\u6ca1\u5b88\u4f4f\uFF08' + passed + ' \u9879\u901a\u8fc7\u3001' + failed + ' \u9879\u5931\u8d25\uFF09' : '\u5168\u90e8\u901a\u8fc7 — \u5feb\u7167\u5e03\u5c40\u8bfb\u6587\u4ef6\uFF08' + passed + ' \u9879\u65ad\u8a00\uFF09')
process.exit(failed ? 1 : 0)
