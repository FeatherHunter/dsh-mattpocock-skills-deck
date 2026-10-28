#!/usr/bin/env node
// tests/verify-1625-wf-selection-outlet.ts —— 门禁：wf.selection 真能答出「这个工作区选了谁」（#1625）
//
// 守的是什么：宿主的唯一判定出口（src/tracker/detection/backendDecision.ts）算出了结论，
// 映射函数由 #1003 的装配约定挂在 decideBackend 函数自己身上；但 workspaceCwd.handleSelection 读的是
// 装配结果对象上的那一格，于是 wf.selection 恒回 { backendId: null, source: 'fallback' }：界面把已经
// 选了后端的工作区当成没选，断网时本应出现的黄条「登录状态暂时确认不了」显示不出来，只看到蓝条
// 「该工作区还没有设置」（#1474 的真机现场就是被这一跳挡住的）。
//
// 本门禁量三件事：
//   A 装配：真 platformChannel 的 getDecisionFn()，判定函数与挂在它身上的映射函数都在
//   B 映射：拿真判定出口对真工作区文件算出的结论过一遍映射，后端名能带回来
//   C 接线：真 platformChannel + 真 createWorkspaceCwd 走一遍 handleSelection，回包里的后端名就是
//      工作区文件里那个人选的；同一处再对一个没有这份文件的空目录问一次，答案必须是没有后端
//      （证明 C 组的答案不是写死的）
//
// 门禁归属: src/host/platformChannel.ts
// 门禁归属: src/host/workspaceCwd.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1625-wf-selection-outlet.ts
import fs from 'node:fs'
import nodePath from 'node:path'
import nodeOs from 'node:os'
import { createPlatformChannel } from '../src/host/platformChannel.js'
import { createWorkspaceCwd } from '../src/host/workspaceCwd.js'
import { createRegistry } from '../src/tracker/registry/core.ts'

const ROOT = nodePath.resolve(import.meta.dirname, '..')

let failed = false
let total = 0
const check = function (cond: unknown, msg: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('  PASS ' + msg); return }
  failed = true
  console.log('  FAIL ' + msg + (detail === undefined ? '' : ' — ' + String(detail).slice(0, 400)))
}

// ── 一份假传输底座：不起真进程，只把 handle 的形状给全（与 verify-927 同一份写法）──
function mkSubprocess() {
  return {
    spawn: function () {
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: 'gh version 2.0.0\n' }) }, stderr: { readFrom: () => ({ text: '' }) } },
        terminate: function () {},
      }
    },
  }
}
const neverTimer = { timeout: function () { return new Promise(function () {}) } }

const PLATFORM = { os: process.platform === 'win32' ? 'win32' : (process.platform === 'darwin' ? 'darwin' : 'linux'), path: nodePath, async getHome() { return nodeOs.homedir() } }
const targetOf = function (t: unknown): string {
  return (t && typeof t === 'object') ? String((t as { path?: string; targetKey?: string }).path || (t as { targetKey?: string }).targetKey || '') : String(t)
}
// 真读盘的文件服务：形状照 DSH 文件服务（resolve 出来的是目标，readText / stat / listDir 收目标）。
// 判定本身的文件读取走这条道，所以这里不是假的判定，只是一条薄壳。
function makeFs() {
  return {
    async resolve(p: string, opts?: { cwd?: string }) {
      const abs = nodePath.isAbsolute(String(p)) ? String(p) : nodePath.resolve((opts && opts.cwd) || ROOT, String(p))
      return { path: abs, rel: String(p), cwd: String((opts && opts.cwd) || '') }
    },
    async readText(t: unknown) { return fs.readFileSync(targetOf(t), 'utf8') },
    async writeText(t: unknown, content: string) { const p = targetOf(t); fs.mkdirSync(nodePath.dirname(p), { recursive: true }); fs.writeFileSync(p, String(content), 'utf8') },
    async mkdir() { return undefined },
    async lstat(t: unknown) { return fs.promises.lstat(targetOf(t)) },
    async stat(t: unknown) { return fs.promises.stat(targetOf(t)) },
    async listDir(t: unknown) { return fs.promises.readdir(targetOf(t)) },
  }
}

// 真注册表 + 两个离网假后端：本门禁只验「人选了谁被读回来」，不真跑后端。
function makeRegistry() {
  const reg = createRegistry()
  const budget = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }
  reg.register({ id: 'github', label: 'GitHub', budget: budget, create: () => ({}), matches: async () => false })
  reg.register({ id: 'markdown', label: '本地 Markdown', budget: budget, create: () => ({}), matches: async () => false })
  return reg
}

const tmpDirs: string[] = []
function mkWorkspace(withFile: boolean): string {
  const base = fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'v1625-'))
  tmpDirs.push(base)
  if (withFile) {
    fs.mkdirSync(nodePath.join(base, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(nodePath.join(base, 'docs', 'agents', 'workspace.yaml'), 'version: 2\nbackendId: github\npickedAt: 1793197238188\nsource: user\n', 'utf8')
  }
  return base
}

const main = async function (): Promise<void> {
  const fsSvc = makeFs()
  const reg = makeRegistry()
  // 真 platformChannel：只给最小依赖（与 verify-927 那扇门禁同一份构造），判定出口由它自己装载。
  const pc = createPlatformChannel({
    ctx: {}, subprocess: mkSubprocess(), timer: neverTimer, fs: null, DEFAULT_CWD: '.', TIMEOUT_MS: 5000,
    getMattSkillProbeNames: async () => [], probeSkill: async () => null, logCtx: null,
  })
  const mod = await pc.getDecisionFn()

  console.log('\nA) 装配：getDecisionFn 交出来的判定函数，与挂在它身上的映射函数')
  check(!!mod && typeof mod.decideBackend === 'function', 'A1 装配结果里带着判定函数 decideBackend', 'typeof=' + typeof (mod && mod.decideBackend))
  const fnAny = (mod && mod.decideBackend) as unknown as { selectionFromOutlet?: unknown }
  check(typeof fnAny.selectionFromOutlet === 'function', 'A2 判定函数身上带着映射函数 selectionFromOutlet（wf.selection 读的就是它；只认装配结果对象上的那一格会读空）', 'typeof=' + typeof (fnAny && fnAny.selectionFromOutlet))

  const wsDir = mkWorkspace(true)
  console.log('\nB) 映射：真判定出口对这份工作区文件的结论，过一遍映射后后端名还在')
  const decision = await mod.decideBackend(wsDir, { registry: reg, platform: PLATFORM, fs: fsSvc, caller: 'verify-1625' })
  const rawBackend = decision && (decision as { backendId?: unknown }).backendId
  check(rawBackend === 'github', 'B1 判定出口对 docs/agents/workspace.yaml 给出的结论是 github', JSON.stringify(decision))
  const mapper = (typeof fnAny.selectionFromOutlet === 'function') ? fnAny.selectionFromOutlet as (o: unknown, d: unknown) => unknown : null
  const mapped = mapper ? mapper(decision, function () { return null }) : null
  check(!!mapped && (mapped as { backendId?: unknown }).backendId === 'github', 'B2 同一份结论过映射后带回 github（映射函数确实接上了，不是空转）', JSON.stringify(mapped))

  console.log('\nC) 接线：真 platformChannel + 真 createWorkspaceCwd 走一遍 wf.selection')
  const wsApi = createWorkspaceCwd({
    ctx: { get: function (k: string) { return k === 'fs' ? fsSvc : undefined } },
    DEFAULT_CWD: '',
    getPlatform: async () => PLATFORM,
    getTrackerRegistry: async () => reg,
    getWorkspaceStore: async () => ({ invalidate() {} }),
    getChoiceStore: async () => ({ async getWorkspace() { return { ok: true, found: false } }, async rememberWorkspace() { return { ok: true } } }),
    getDecisionFn: pc.getDecisionFn,
    canonicalKey: async (r: unknown) => String(r),
    setCache: function () {},
    logCtx: { fire: function () {}, isEnabled: function () { return false } },
    timer: { timeout: function () { return 0 } },
    detectionExec: async () => ({ ok: false }),
  })
  const res = await wsApi.handleSelection({ cwd: wsDir })
  check(res.ok === true && res.selection && res.selection.backendId === 'github', 'C1 wf.selection 对这个工作区回的是文件里那个人选 github（修前回 fallback，界面就当成没选）', JSON.stringify(res))

  const emptyDir = mkWorkspace(false)
  const res2 = await wsApi.handleSelection({ cwd: emptyDir })
  check(res2.ok === true && res2.selection && res2.selection.backendId === null, 'C2 一个没有这份文件的空目录问同一条电话：回没有后端（证明 C1 的答案来自那份文件，不是写死的）', JSON.stringify(res2))

  console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全绿'))
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {} }
  process.exit(failed ? 1 : 0)
}
main().catch(function (e: unknown): void { console.error(e); process.exit(1) })
