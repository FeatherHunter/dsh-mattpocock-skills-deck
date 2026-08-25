/**
 * examples/demo-mini/index.js — demo-mini 后端（第三方扩展范式的可复制样板）
 *
 * 定版 7 行（#147）：
 * - 身份：示例性 demo-mini（对外 acme.demo 占位）不默认装配、不进 src/host/tracker/backends/
 * - 目录：examples/demo-mini/ + fixtures/demo-real/（不在 files 白名单，零发包）
 * - ops：list/get/create/getDependencies 4 项，余下 9 项 Proxy 补 unsupported
 * - matches：platform.fs 探 cwd/.demo/config.json 或 .scratch/map.md 存在性，boolean，超时 3000ms
 * - describe：不覆写，复用 registry.describe 骨架
 * - 验证：强验证 runContractTests+runPlayback 织入 verify-tracker-contract.js
 *
 * 接入（照抄）：
 *   import { demoModule } from '../../examples/demo-mini/index.js'
 *   import { createRegistry } from '../../src/host/tracker/registry.js'
 *   const registry = createRegistry(backendCtx)
 *   const disp = registry.register(demoModule) // + ctx.effect(() => disp.dispose())
 *
 * 或 DSH 插件：
 *   export async function apply(ctx) {
 *     const registry = ctx.get('trackerRegistry')
 *     const disp = registry.register(demoModule)
 *     ctx.effect(() => disp.dispose())
 *   }
 */

import { ERROR_KIND } from '../../src/shared/tracker/constants.js'
import { normalizeIssue } from './normalize.js'
import { demoMatches } from './matches.js'

function nowIso() {
  return new Date().toISOString()
}

function toOpResult(ok, data, error) {
  if (ok) return { ok: true, data }
  return { ok: false, error }
}

/**
 * 创建 demo-mini Tracker（4 ops + 内存 Map 存储）
 * @param {import('../../src/host/tracker/contract.js').BackendContext} ctx
 * @returns {import('../../src/host/tracker/contract.js').Tracker}
 */
export function createDemoBackend(ctx) {
  // 内存存储：key -> raw（normalize 前的中间态）
  const store = new Map()
  let nextId = 3

  // 预置两条演示数据（覆盖 blocking 投影）
  const seed1 = {
    key: '1',
    title: 'Demo issue 1',
    state: 'open',
    body: 'demo body 1',
    url: '',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [{ name: 'bug', color: 'd73a4a', description: 'bug label' }],
    assignees: [{ login: 'alice', name: 'Alice', avatarUrl: '' }],
    comments: [{ id: 'c1', author: { login: 'alice' }, authorAssociation: 'OWNER', body: 'first comment', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
    blockedBy: [{ key: '2', title: 'Demo issue 2', state: 'open' }],
    reason: '',
  }
  const seed2 = {
    key: '2',
    title: 'Demo issue 2',
    state: 'open',
    body: 'demo body 2',
    url: '',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
    comments: [],
    blockedBy: [],
    reason: '',
  }
  store.set('1', seed1)
  store.set('2', seed2)

  return {
    id: 'demo-mini',

    // list：返回全部 Issue（过滤器本 demo 忽略，保持契约 minimal）
    async list(repo, filter, opCtx) {
      try {
        const all = Array.from(store.values()).map(normalizeIssue)
        return toOpResult(true, all)
      } catch (e) {
        return toOpResult(false, null, { kind: ERROR_KIND.PARSE, message: String(e && e.message || e) })
      }
    },

    // get：按 key 取单条
    async get(repo, key, opts, opCtx) {
      try {
        const raw = store.get(String(key))
        if (!raw) return toOpResult(false, null, { kind: ERROR_KIND.NOTFOUND, message: `demo-mini issue ${key} not found` })
        return toOpResult(true, normalizeIssue(raw))
      } catch (e) {
        return toOpResult(false, null, { kind: ERROR_KIND.PARSE, message: String(e && e.message || e) })
      }
    },

    // create：新建 issue（富输入：title/body/type/parentKey/labels/assignees）
    async create(repo, input, opCtx) {
      try {
        if (!input || typeof input.title !== 'string' || !input.title.trim()) {
          return toOpResult(false, null, { kind: ERROR_KIND.PARSE, message: 'title is required' })
        }
        const key = String(nextId++)
        const raw = {
          key,
          title: input.title,
          state: 'open',
          body: typeof input.body === 'string' ? input.body : '',
          url: '',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          closedAt: null,
          parentKey: input.parentKey !== undefined ? input.parentKey : null,
          labels: Array.isArray(input.labels) ? input.labels.map(l => typeof l === 'string' ? { name: l, color: '' } : { name: l.name, color: l.color || '' }).filter(l => l.name) : [],
          assignees: Array.isArray(input.assignees) ? input.assignees.map(a => typeof a === 'string' ? { login: a } : { login: a.login }).filter(a => a.login) : [],
          comments: [],
          blockedBy: [],
          reason: '',
          type: input.type || 'issue',
        }
        store.set(key, raw)
        return toOpResult(true, normalizeIssue(raw))
      } catch (e) {
        return toOpResult(false, null, { kind: ERROR_KIND.PARSE, message: String(e && e.message || e) })
      }
    },

    // getDependencies：blockedBy 唯一真源 + blocking 反向投影
    async getDependencies(repo, key, opts, opCtx) {
      try {
        const raw = store.get(String(key))
        if (!raw) return toOpResult(false, null, { kind: ERROR_KIND.NOTFOUND, message: `demo-mini issue ${key} not found` })
        const issue = normalizeIssue(raw)
        const blockedBy = Array.isArray(issue.blockedBy) ? issue.blockedBy : []
        // blocking：扫描全表，谁的 blockedBy 包含本 key
        const blocking = []
        for (const other of store.values()) {
          const o = normalizeIssue(other)
          if (Array.isArray(o.blockedBy) && o.blockedBy.some(r => String(r.key) === String(key))) {
            blocking.push({ key: o.key, title: o.title, state: o.state, type: o.type })
          }
        }
        return toOpResult(true, { blockedBy, blocking })
      } catch (e) {
        return toOpResult(false, null, { kind: ERROR_KIND.PARSE, message: String(e && e.message || e) })
      }
    },
  }
}

/**
 * BackendModule（供 registry.register 用）
 * - DSH 插件 manifest 预留：dsh.contributes.trackers [{id:'demo-mini', module:'examples/demo-mini'}]
 * - Disposable 按代隔离，on('bind') stale 语义由 registry 保证
 */
export const demoModule = {
  id: 'demo-mini',
  label: 'Demo Mini',
  presentation: { color: '#8250df' },
  create: createDemoBackend,
  matches: demoMatches,
}

// 对外占位 id（文档用）：acme.demo（publisher.name 形态）
export const demoModuleAcme = {
  id: 'acme.demo',
  label: 'Acme Demo',
  presentation: { color: '#8250df' },
  create: createDemoBackend,
  matches: demoMatches,
}

export default demoModule
