#!/usr/bin/env node
/**
 * verify-1003-workspace-write-robust.js —— 「写工作区文件尽量写成、写不成如实报因」的门禁（#1003 契约）。
 *
 * 维护者 2026-10-12 的口径：首要要求是尽量百分百写成，四种失败原因是失败时的如实报因，不是接受失败。
 * 所以这里钉两件事：① 第一次写失败会重试一次（第二次成功就算成）；② 真写不成时，原因分档如实回
 *   （拿不到写许可 / 只读 / 目录不存在 / 其他），判不出来归「其他」，绝不编一个具体原因。
 *
 * 用法：node tests/verify-1003-workspace-write-robust.ts
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

const { createWorkspaceCwd } = await imp('src/host/workspaceCwd.js')

/** 造一个文件通道：writeText 按计划表行为（'ok' / 'throw:CODE'），其余方法落到真盘。 */
const makeFs = (plan: string[]) => {
  let calls = 0
  return {
    calls: () => calls,
    async resolve(p: unknown, opts?: { cwd?: string }) { const base = (opts && opts.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel },
    async readText(t: unknown) { return fs.readFileSync(String(t).replace(/\//g, path.sep), 'utf8') },
    async writeText(t: unknown, c: unknown) {
      calls += 1
      const step = plan[Math.min(calls - 1, plan.length - 1)]
      if (step !== 'ok') { const code = String(step).replace('throw:', ''); throw Object.assign(new Error(code + ': 这次写不进去'), { code: code }) }
      const real = String(t).replace(/\//g, path.sep); fs.mkdirSync(path.dirname(real), { recursive: true }); fs.writeFileSync(real, String(c), 'utf8')
    },
    async mkdir(t: unknown) { fs.mkdirSync(String(t).replace(/\//g, path.sep), { recursive: true }) },
  }
}
type StubFs = ReturnType<typeof makeFs>

const mkCase = async (plan: string[]) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003w-home-'))
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'v1003w-ws-'))
  const f = makeFs(plan)
  const api = createWorkspaceCwd({
    ctx: { get: () => undefined }, DEFAULT_CWD: '',
    getPlatform: async () => ({ fs: f as StubFs, path: path, getHome: async () => home }),
    getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
    getWorkspaceStore: async () => ({ invalidate: () => {} }),
    getChoiceStore: async () => ({ rememberWorkspace: async () => ({ ok: true, rev: 1 }), getWorkspace: async () => ({ ok: true, found: false }) }),
    canonicalKey: async (c: unknown) => c, setCache: () => {}, timer: { timeout: () => null },
    detectionExec: async () => ({}), logCtx: null,
  })
  const out = await api.handleBind({ cwd: ws, backendId: 'github' })
  const yaml = path.join(ws, 'docs', 'agents', 'workspace.yaml')
  const written = fs.existsSync(yaml) ? fs.readFileSync(yaml, 'utf8') : ''
  return { out: out, wf: out && out.workspaceFile, f: f, written: written }
}

console.log('== ① 第一次失败会重试一次（第二次成功就算写成）==')
{
  const c = await mkCase(['throw:EACCES', 'ok'])
  check(c.f.calls() === 2, '确实重试了一次（写被调了两次）—— 实得 ' + c.f.calls() + ' 次')
  check(c.wf && c.wf.ok === true && c.wf.placed === true, '重试后写成，回执如实说写进去了 —— 实得 ' + JSON.stringify(c.wf))
  check(/^backendId: github$/m.test(c.written), '重试之后文件里真的有那条记录')
}

console.log('')
console.log('== ② 真写不成时，原因分档如实回 ==')
for (const [code, want] of [['EACCES', 'no-permit'], ['EPERM', 'no-permit'], ['EROFS', 'readonly'], ['ENOENT', 'no-dir'], ['EUNKNOWN', 'other']]) {
  const c = await mkCase(['throw:' + code])
  const got = c.wf && c.wf.error && c.wf.error.reason
  check(got === want, code + ' → 原因档是 ' + want + '（判不出来归 other，不编具体原因）—— 实得 ' + got)
  check(c.wf && c.wf.ok === false && c.written === '', code + '：这一趟确实没写进文件（回执不谎报成功）')
}

console.log('')
console.log(failed ? '存在失败 — 写工作区文件的加固与报因没守住（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 写成优先、写不成如实报因（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
