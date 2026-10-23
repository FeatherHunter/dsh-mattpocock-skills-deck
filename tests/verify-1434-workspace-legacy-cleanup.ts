#!/usr/bin/env node
/**
 * verify-1434-workspace-legacy-cleanup.ts —— #1434：写新工作区文件成功后删掉老文件。
 *
 * 钉三件事：① 新文件写成功且读回一致后，老 docs/agents/workspace.json 必须被删掉，
 * 回执带 legacyDeleted:true 且警告为空；② 老文件本来就不在（删时报文件不存在）算删掉，
 * 同样回成功；③ 删不掉（例如没许可）不能推翻写的成功，回执照回 ok:true，但 legacyDeleted
 * 为 false、警告里有一条 legacy-delete-failed，并记一条 host.call.fail 日志；
 * ④ 写完读回不一致按写失败回 ok:false，且不删老文件。
 *
 * 读链不动（新优先的顺序已有门禁守住），本门禁只守写路径。
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1434-workspace-legacy-cleanup.ts
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

const LEGACY_REL = 'docs/agents/workspace.json'
const YAML_REL = 'docs/agents/workspace.yaml'

/** 文件通道：读写走真盘（与 verify-1003-workspace-write-robust 同一缝），rm 按计划表行为。 */
const makeFs = (rmPlan: 'ok' | 'missing' | 'denied') => {
  const rmCalls: string[] = []
  const toReal = (t: unknown) => String(t).replace(/\//g, path.sep)
  return {
    rmCalls: rmCalls,
    async resolve(p: unknown, opts?: { cwd?: string }) { const base = (opts && opts.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel },
    async readText(t: unknown) { return fs.readFileSync(toReal(t), 'utf8') },
    async writeText(t: unknown, c: unknown) { const real = toReal(t); fs.mkdirSync(path.dirname(real), { recursive: true }); fs.writeFileSync(real, String(c), 'utf8') },
    async mkdir(t: unknown) { fs.mkdirSync(toReal(t), { recursive: true }) },
    async rm(t: unknown) {
      rmCalls.push(String(t))
      if (rmPlan === 'missing') throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
      if (rmPlan === 'denied') throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      fs.rmSync(toReal(t), { force: true })
    },
  }
}

const mkApi = (f: ReturnType<typeof makeFs>, logs: { level: string; event: string; fields: any }[]) => createWorkspaceCwd({
  ctx: { get: () => undefined }, DEFAULT_CWD: '',
  getPlatform: async () => ({ fs: f, path: path, getHome: async () => os.tmpdir() }),
  getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
  getWorkspaceStore: async () => ({ invalidate: () => {} }),
  getChoiceStore: async () => ({ rememberWorkspace: async () => ({ ok: true, rev: 1 }), getWorkspace: async () => ({ ok: true, found: false }) }),
  canonicalKey: async (c: unknown) => c, setCache: () => {}, timer: { timeout: () => null },
  detectionExec: async () => ({}),
  logCtx: { fire: (level: string, event: string, fields: any) => { logs.push({ level: level, event: event, fields: fields }) }, isEnabled: () => true },
})

const freshWs = () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'v1434-ws-'))
  fs.mkdirSync(path.join(ws, 'docs', 'agents'), { recursive: true })
  return ws
}

console.log('== ① 写成功后老文件被删掉，回执如实带 legacyDeleted 与空警告 ==')
{
  const ws = freshWs()
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.json'), '{"version":1,"backendId":"markdown","pickedAt":1758500000000,"source":"user"}', 'utf8')
  const logs: { level: string; event: string; fields: any }[] = []
  const f = makeFs('ok')
  const api = mkApi(f, logs)
  const out: any = await api.handleBind({ cwd: ws, backendId: 'github' })
  check(out && out.ok === true, '绑定成功（删老文件不挡主流程）—— 实得 ok=' + (out && out.ok))
  check(out && out.workspaceFile && out.workspaceFile.legacyDeleted === true, '回执 legacyDeleted 为 true —— 实得 ' + JSON.stringify(out && out.workspaceFile))
  check(out && out.workspaceFile && Array.isArray(out.workspaceFile.warnings) && out.workspaceFile.warnings.length === 0, '警告为空 —— 实得 ' + JSON.stringify(out && out.workspaceFile && out.workspaceFile.warnings))
  check(f.rmCalls.length === 1 && f.rmCalls[0].replace(/\\/g, '/').endsWith('/' + LEGACY_REL), '删的正是老文件那一条路径 —— 实得 ' + JSON.stringify(f.rmCalls))
  check(!fs.existsSync(path.join(ws, 'docs', 'agents', 'workspace.json')), '真盘上老文件确实不在了')
  check(fs.existsSync(path.join(ws, YAML_REL)) && /backendId: github/.test(fs.readFileSync(path.join(ws, YAML_REL), 'utf8')), '新文件里是这次选的后端')
}

console.log('')
console.log('== ② 老文件本来就不在：删时报不存在算删掉，照回成功 ==')
{
  const ws = freshWs()
  const logs: { level: string; event: string; fields: any }[] = []
  const f = makeFs('missing')
  const api = mkApi(f, logs)
  const out: any = await api.handleBind({ cwd: ws, backendId: 'github' })
  check(out && out.ok === true, '绑定成功 —— 实得 ok=' + (out && out.ok))
  check(out && out.workspaceFile && out.workspaceFile.legacyDeleted === true, '文件本来就不在也算删掉（legacyDeleted 为 true）—— 实得 ' + JSON.stringify(out && out.workspaceFile))
  check(out && out.workspaceFile && Array.isArray(out.workspaceFile.warnings) && out.workspaceFile.warnings.length === 0, '警告为空（文件不在不是故障）—— 实得 ' + JSON.stringify(out && out.workspaceFile && out.workspaceFile.warnings))
}

console.log('')
console.log('== ③ 删不掉（没许可）：主流程照回成功，但如实带 legacyDeleted:false、警告与日志 ==')
{
  const ws = freshWs()
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.json'), '{"version":1,"backendId":"markdown","pickedAt":1758500000000,"source":"user"}', 'utf8')
  const logs: { level: string; event: string; fields: any }[] = []
  const f = makeFs('denied')
  const api = mkApi(f, logs)
  const out: any = await api.handleBind({ cwd: ws, backendId: 'github' })
  check(out && out.ok === true, '删失败不能推翻写的成功（ok 仍为 true）—— 实得 ok=' + (out && out.ok))
  check(out && out.workspaceFile && out.workspaceFile.legacyDeleted === false, '回执 legacyDeleted 为 false —— 实得 ' + JSON.stringify(out && out.workspaceFile))
  check(out && out.workspaceFile && Array.isArray(out.workspaceFile.warnings) && out.workspaceFile.warnings.length === 1 && /legacy-delete-failed/.test(out.workspaceFile.warnings[0]), '警告里有一条 legacy-delete-failed —— 实得 ' + JSON.stringify(out && out.workspaceFile && out.workspaceFile.warnings))
  const failLog = logs.find((l) => l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.bind.workspaceFile' && l.fields.errorKind === 'legacy-delete-failed')
  check(!!failLog, '记了一条 host.call.fail 日志（method 对、errorKind=legacy-delete-failed）—— 实得 ' + JSON.stringify(logs.filter((l) => l.event === 'host.call.fail').map((l) => l.fields)))
  check(fs.existsSync(path.join(ws, 'docs', 'agents', 'workspace.json')), '删失败时老文件原样保留（不强删、不清空）')
}


console.log('')
console.log('== ④ 写完读回不一致：按写失败回，不删老文件 ==')
{
  const ws = freshWs()
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.json'), '{"version":1,"backendId":"markdown","pickedAt":1758500000000,"source":"user"}', 'utf8')
  const logs: { level: string; event: string; fields: any }[] = []
  const base = makeFs('ok')
  const tampered = { ...base, async readText(t: unknown) { return String(await base.readText(t)) + '\n#tamper' } }
  const api = mkApi(tampered, logs)
  const out: any = await api.handleBind({ cwd: ws, backendId: 'github' })
  check(out && out.ok === false, '读回不一致按写失败回（ok 为 false）—— 实得 ok=' + (out && out.ok))
  check(base.rmCalls.length === 0, '写失败时不删老文件（rm 一次都没调）—— 实得 ' + JSON.stringify(base.rmCalls))
  check(fs.existsSync(path.join(ws, 'docs', 'agents', 'workspace.json')), '老文件原样保留')
}

console.log('')
console.log(failed ? '存在失败 — 写后删老文件没守住（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 写成功删老文件、删失败如实回（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
