#!/usr/bin/env node
/**
 * verify-1433-snapshot-layout-file.ts —— 快照里的布局答案以工作区文件为准（#1433，#1449 收紧）。
 *
 * 依据：#1433 拍板（工作区文件是布局的唯一真源）与验收第 1–4 条；
 * #1449 再收紧：本机记忆不再有布局读写口，快照读不到文件就是「还没答过」，不回退任何记忆。
 *
 * 钉五件事：① 内存命中：文件里 single 压过缓存里的 multi；
 *   ② 文件里没有布局时回空（不退回本机记忆，也不留缓存里上一次的旧答案）；
 *   ③ 磁盘回放：盘里是 multi、文件里是 single，照样回 single；
 *   ④ 拿不到文件通道时回空、不断言崩；
 *   ⑤ 静态面：读函数只认工作区文件；304 回包无条件带布局（含 null）、旧的「没答案就留旧值」条件已删。
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

const mkWs = (layoutLine: string | null) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'v1433layout-ws-'))
  fs.mkdirSync(path.join(ws, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\npickedAt: 1758500000000\nsource: user\n' + (layoutLine ? ('layout: ' + layoutLine + '\n') : ''), 'utf8')
  return ws
}
const mkDeps = (fsSvc: StubFs, cached: any, disk: any) => ({
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
  DEFAULT_CWD: '', logCtx: null, envelope: null, send: null,
})

console.log('== ① 内存命中：文件里 single 压过缓存里的 multi ==')
{
  const ws = mkWs('single')
  const out: any = await createSessionSnapshot(mkDeps(makeFs(), { layout: 'multi', pickedAt: 111 }, null)).handleSnapshot({ cwd: ws })
  check(out && out.setupLayout && out.setupLayout.layout === 'single', '手改文件后快照回 single（不拿缓存里落后的值顶替）—— 实得 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== ② 文件里没有布局时回空，不留缓存旧答案 ==')
{
  const ws = mkWs(null)
  const out: any = await createSessionSnapshot(mkDeps(makeFs(), { layout: 'multi', pickedAt: 111 }, null)).handleSnapshot({ cwd: ws })
  check((out && out.setupLayout) == null, '快照里不留上一次的值（回空表示还没答过）—— 实得 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== ③ 磁盘回放：盘里 multi、文件里 single 照样回 single ==')
{
  const ws = mkWs('single')
  const disk = { selection: { backendId: 'github', rev: 0 }, generatedMs: Date.now(), setupLayout: { layout: 'multi', pickedAt: 111 } }
  const out: any = await createSessionSnapshot(mkDeps(makeFs(), null, disk)).handleSnapshot({ cwd: ws })
  check(out && out.setupLayout && out.setupLayout.layout === 'single', '盘缓存也按这一轮的文件盖 —— 实得 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== ④ 拿不到文件通道时回空、不崩 ==')
{
  const ws = mkWs('single')
  const deps: any = mkDeps(makeFs(), { layout: 'single', pickedAt: 111 }, null)
  deps.getPlatform = async () => ({}); deps.ctx = { get: () => undefined }
  const out: any = await createSessionSnapshot(deps).handleSnapshot({ cwd: ws })
  check((out && out.setupLayout) == null, '无通道时回空（不回退本机记忆）—— 实得 ' + JSON.stringify(out && out.setupLayout))
}
console.log('')
console.log('== ⑤ 静态面：读函数只认工作区文件、304 无条件带布局 ==')
{
  const text = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/session-snapshot-cache.ts'), 'utf8')
  check(text.includes('WORKSPACE_FILE_REL'), '读函数认工作区文件的位置（接线仍在）')
  check(!/getChoiceStore\s*\(/.test(text) && !/getLayout\s*\(/.test(text), '读函数不再查本机记忆里的布局')
  check(text.includes('_pair.setupLayout = _layEarly'), '304 回包无条件带布局（含 null，客户端才能清空旧答案）')
  check(!text.includes('sameLayout || !_layEarly'), '旧的「没答案就留旧值」条件已删')
}

console.log('')
console.log(failed ? '存在失败 — 快照布局以文件为准这条没守住（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 快照布局读文件（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
