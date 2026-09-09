// packages/dsh-log/tests/eventList.test.mjs —— 事件清单格式与通用检查器单测（#561 附单测）。
// 用法：先 node packages/dsh-log/build.mjs，再 node --test packages/dsh-log/tests/。
// 只用 Node 自带测试能力（node:test），不引入新的测试框架。
// 覆盖：空模板合法、白名单通过与揪出、未知事件、计数对不上、非法形状中文报错、
// 路径形式被拦下（包不读盘）、默认 wf 配置 eventList 为 null（主路径零变化）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const configUrl = pathToFileURL(path.join(PKG_DIR, 'dist', 'config.js')).href + '?x=' + Date.now()
const config = await import(configUrl)
const { parseEventListManifest, checkEventFields, checkEventCounts, resolveHostLogConfig } = config
const host = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'host.js')).href + '?x=' + Date.now())

// 一份手写小清单：两常驻、一按需、一自监控，计数自报一致。
function makeSample() {
  return {
    version: 1,
    pluginId: 'wf',
    counts: { resident: 2, ondemand: 1, selfmon: 1 },
    events: {
      'snapshot.built': {
        level: 'info',
        kind: 'resident',
        fields: ['maps', 'issues', 'labels', 'fallback', 'latencyMs']
      },
      'gh.exec': {
        level: 'info',
        kind: 'resident',
        fields: ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode'],
        codes: ['H_CWD', 'B_TOKEN'],
        rules: ['R_TOKEN_BEARER', 'R_GH_TOKEN']
      },
      'chain.cache.miss': {
        level: 'debug',
        kind: 'ondemand',
        fields: ['keyHash', 'lang', 'reason'],
        guard: '按事件，有穿透才记'
      },
      'log.persist.fail': {
        level: 'warn',
        kind: 'selfmon',
        fields: ['op', 'reason', 'dirHash'],
        codes: ['H_CWD']
      }
    }
  }
}

describe('事件清单格式与通用检查器（#561）', () => {
  it('空模板合法：读包内模板，验形通过，计数全零一致', () => {
    const raw = readFileSync(path.join(PKG_DIR, 'event-list.template.json'), 'utf8')
    const manifest = parseEventListManifest(JSON.parse(raw))
    assert.equal(manifest.version, 1)
    assert.deepEqual(Object.keys(manifest.events), [])
    assert.deepEqual(checkEventCounts(manifest), { ok: true, problems: [] })
  })

  it('白名单通过：清单里的事件配清单里的字段，全过', () => {
    const manifest = parseEventListManifest(makeSample())
    const got = checkEventFields(manifest, 'gh.exec', ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode'])
    assert.deepEqual(got, { ok: true, unknownEvent: false, unknownFields: [] })
  })

  it('白名单揪出未知字段：把名单带回，不误伤已知字段', () => {
    const manifest = parseEventListManifest(makeSample())
    const got = checkEventFields(manifest, 'gh.exec', ['argv0', 'token'])
    assert.equal(got.ok, false)
    assert.equal(got.unknownEvent, false)
    assert.deepEqual(got.unknownFields, ['token'])
  })

  it('未知事件名算不通过：拼错名或漏登记都拦下', () => {
    const manifest = parseEventListManifest(makeSample())
    const got = checkEventFields(manifest, 'gh.exec2', ['argv0'])
    assert.deepEqual(got, { ok: false, unknownEvent: true, unknownFields: [] })
  })

  it('计数检查通过：三类实际条数与自报一致', () => {
    const manifest = parseEventListManifest(makeSample())
    assert.deepEqual(checkEventCounts(manifest), { ok: true, problems: [] })
  })

  it('计数对不上被揪出：增删事件不同步改 counts 就红', () => {
    const sample = makeSample()
    sample.counts.resident = 1
    const manifest = parseEventListManifest(sample)
    const got = checkEventCounts(manifest)
    assert.equal(got.ok, false)
    assert.equal(got.problems.length, 1)
    assert.match(got.problems[0], /resident/)
  })

  it('非法形状直接报中文错：级别写错', () => {
    const sample = makeSample()
    sample.events['gh.exec'].level = 'fatal'
    assert.throws(() => parseEventListManifest(sample), /level 只许/)
  })

  it('非法形状直接报中文错：条目多出不认识的键（多半是拼写错误）', () => {
    const sample = makeSample()
    sample.events['gh.exec'].fileds = sample.events['gh.exec'].fields
    assert.throws(() => parseEventListManifest(sample), /不认识的键 fileds/)
  })

  it('路径形式被拦下：包不读盘，调用方自己读成对象再传', () => {
    assert.throws(() => parseEventListManifest('event-list.json'), /自己读成对象再传入/)
  })

  it('默认 wf 配置 eventList 为 null：主路径零变化', () => {
    const resolved = resolveHostLogConfig({ pluginId: 'wf' })
    assert.equal(resolved.eventList, null)
    assert.equal(resolved.prefix, 'wf')
    assert.equal(resolved.logDirName, 'logs')
  })

  it('合法对象进建库配置即收下可用：存下后检查器照跑', () => {
    const resolved = resolveHostLogConfig({ pluginId: 'wf', eventList: makeSample() })
    assert.equal(resolved.eventList.pluginId, 'wf')
    const got = checkEventFields(resolved.eventList, 'snapshot.built', ['maps', 'oops'])
    assert.deepEqual(got.unknownFields, ['oops'])
  })

  it('非法对象进建库配置当场抛：不让坏清单溜进运行期', () => {
    const bad = makeSample()
    bad.events['gh.exec'].kind = 'always'
    assert.throws(() => resolveHostLogConfig({ pluginId: 'wf', eventList: bad }), /kind 只许/)
  })

  it('数组形式进建库配置同样被拦下：只收对象，与坏对象同口径', () => {
    assert.throws(() => resolveHostLogConfig({ pluginId: 'wf', eventList: [] }), /只收对象形式/)
  })

  it('宿主入口同样导出检查器：dsh-log/host 可达', () => {
    assert.equal(typeof host.parseEventListManifest, 'function')
    assert.equal(typeof host.checkEventFields, 'function')
    assert.equal(typeof host.checkEventCounts, 'function')
    assert.deepEqual(checkEventCounts(host.parseEventListManifest(makeSample())), { ok: true, problems: [] })
  })
})
