// verify-log-fields.js —— #494 第三件事：日志门禁之字段白名单（#489 附录第 4 节断言一）。
// 用法：在插件根目录执行 node tests/verify-log-fields.js，可独立运行。
// 断言文字：扫描全部埋点调用，每个事件只含第 1 节允许字段；出现工作区原始路径、
// 仓库地址原文、令牌原文、模板正文、快照全文即红。
// 做法：从宿主与客户端源码里找出全部日志调用，逐个事件收拢实际字段键，
// 与下面这张允许表逐项比对；未知事件名、未知字段键都算失败并打印清单。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志字段白名单门禁（#494：43 事件逐个只记已知安全字段，未知字段默认不记）')

// 允许表：事件名对应它能记的全部字段键，之外的键一律不许出现。
// 键名取自实现原文，语义与 #489 附录 1.4、1.5 节对照表一致。
// 其中 error.normalize 的 httpCode 只在归一出状态码时才带，其余两键常带。
const ALLOWED = {
  'snapshot.request': ['cwdHash', 'backend', 'force'],
  'snapshot.cache.hit': ['kind', 'ageMs'],
  'snapshot.cache.miss': ['reason'],
  'repo.resolve.tier': ['tier', 'ok', 'latencyMs'],
  'gh.exec': ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode'],
  'gh.timeout': ['argv0', 'timeoutMs'],
  'gh.resolve.fail': ['hasDSH_GH_PATH', 'errorHash'],
  'graphql.fallback': ['scope', 'reason'],
  'issues.fallback': ['from', 'to', 'reason'],
  'snapshot.built': ['maps', 'issues', 'labels', 'fallback', 'latencyMs'],
  'probe.eval': ['repoKeyHash', 'since', 'count', 'changed'],
  'panelSync.eval': ['repoKeyHash', 'baseline', 'dirty', 'failures'],
  'panelSync.dirty': ['cwdHash', 'ageMs'],
  'registry.select': ['cwdHash', 'backendId', 'source', 'latencyMs'],
  'registry.stub': ['op', 'backendId'],
  'detection.detect': ['cwdHash', 'explicit', 'matches', 'pending', 'selection'],
  'workspaceStore.hit': ['keyHash', 'fresh', 'ttlMs'],
  'chain.cache.hit': ['keyHash', 'lang', 'ageMs'],
  'chain.predicate': ['id', 'status', 'latencyMs'],
  'skill.probe': ['name', 'level', 'via'],
  'skill.pending.cap': ['name', 'attempts', 'max'],
  'workspaceKey.canonical': ['rawHash', 'normalizedHash', 'fallback'],
  'platform.resolve': ['name', 'ok', 'latencyMs'],
  'naming.sweep': ['trigger', 'count'],
  'host.call': ['method', 'latencyMs', 'ok', 'kind'],
  'host.call.fail': ['method', 'kind', 'errorHash'],
  'snapshot.hydrate': ['cwdHash', 'fresh', 'latencyMs', 'source'],
  'snapshot.fanout': ['sessionIdHash', 'stale', 'force'],
  'dedup.hit': ['scope', 'keyHash'],
  'backend.switch': ['from', 'to', 'cwdHash'],
  'naming.guard': ['sidHash', 'outcome', 'hintHash'],
  'naming.lock': ['sidHash', 'reason'],
  'settings.save': ['openIn', 'tplChangedCount'],
  'panel.open': ['mode', 'hasCache', 'snapFresh'],
  'statusbar.hydrate': ['cwdSource'],
  'statusbar.fallback': ['reason'],
  'dock.rehydrate': ['sidHash', 'cwdChanged', 'polluted'],
  'storage.fail': ['key', 'op'],
  'chain.derive.error': ['stepId', 'errorHash'],
  'fallback.chain': ['in', 'out', 'latencyMs'],
  'error.normalize': ['rawKind', 'mappedKind', 'httpCode'],
  'timer.schedule': ['name', 'intervalMs'],
  'privacy.scrub': ['field', 'rule', 'hit'],
}
// 房内三点六个事件的精确字段形状（#494 房内落点，附录 1.4 原文）：
// gh.exec 五键、gh.timeout 两键、gh.resolve.fail 两键，
// graphql.fallback 与 issues.fallback 各自两键与三键，error.normalize 两键加可选状态码。
const ROOM_SHAPES = {
  'gh.exec': ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode'],
  'gh.timeout': ['argv0', 'timeoutMs'],
  'gh.resolve.fail': ['hasDSH_GH_PATH', 'errorHash'],
  'graphql.fallback': ['scope', 'reason'],
  'issues.fallback': ['from', 'to', 'reason'],
  'error.normalize': ['rawKind', 'mappedKind'],
}

function listJsFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.js')) out.push(p)
    }
  }
  walk(dir)
  return out
}

// 取对象字面量最外层全部键：跳过字符串与模板里的冒号，跳过三元问号冒号。
function topKeys(objText) {
  const keys = []
  let depth = 0
  let ternary = 0
  let instr = null
  let esc = false
  let buf = ''
  for (let i = 0; i < objText.length; i++) {
    const c = objText[i]
    if (instr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === instr) instr = null
      continue
    }
    if (c === '"' || c === "'" || c === '\u0060') { instr = c; continue }
    if (c === '{') { depth += 1; continue }
    if (c === '}') {
      depth -= 1
      if (depth === 0) break
      if (depth === 1) ternary = 0
      continue
    }
    if (depth !== 1) continue
    if (c === '?') { ternary += 1; continue }
    if (c === ':' && ternary > 0) { ternary -= 1; buf = ''; continue }
    if (c === ':' && ternary === 0) {
      const m = buf.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)
      if (m) keys.push(m[1])
      buf = ''
      continue
    }
    if (c === ',' || c === ';') { buf = ''; continue }
    buf += c
  }
  return keys
}

// 调用点之后第一段字段对象体的起点：
// 直接对象取第一个大括号；包在取值函数里的取 return 后面的大括号。
function fieldsObjectStart(rest) {
  const lazy = rest.match(/function\s*\([^)]*\)\s*\{\s*return\s*\{/)
  if (lazy) return rest.indexOf('{', lazy.index + lazy[0].length - 1)
  const i = rest.search(/\{/)
  return i
}

function collectCalls() {
  const found = {}
  const rooms = ['github' + path.sep + 'client.js', 'github' + path.sep + 'issues.js', 'github' + path.sep + 'errors.js']
  const files = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
  const mainRe = /(?:^|[^A-Za-z0-9_$])(?:log|fire|rlog|logEvent|backendLogEvent|roomLogEvent)\s*\(\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*)?['"](error|warn|info|debug)['"]\s*,\s*['"]([a-z][a-zA-Z0-9.]*?)['"]\s*,/g
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const rel = path.relative(ROOT, f)
    const isRoom = rooms.some((r) => rel.endsWith(r))
    const patterns = [mainRe]
    if (isRoom) patterns.push(/(?:^|[^A-Za-z0-9_$])f\s*\(\s*['"](error|warn|info|debug)['"]\s*,\s*['"]([a-z][a-zA-Z0-9.]*?)['"]\s*,/g)
    for (const re of patterns) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) {
        const name = m[2]
        const after = text.slice(m.index + m[0].length)
        // 只看紧跟调用的头 120 字：直接对象、取值函数或变量三选一，不向后跨行借对象。
        const head120 = after.slice(0, 120)
        let keys = []
        const lazyHead = head120.match(/^\s*function\s*\([^)]*\)\s*\{\s*return\s*\{/)
        if (lazyHead) {
          const start = after.indexOf('{', lazyHead.index + lazyHead[0].length - 1)
          if (start >= 0) keys = topKeys(after.slice(start))
        } else if (/^\s*\{/.test(head120)) {
          keys = topKeys(after.slice(after.search(/\{/)))
        } else {
          // 字段先装进变量再传入：回头找该变量的对象字面量，并收拢后续逐个点赋的键。
          // 只有裸变量名（后面紧跟逗号或右括号）才走这条路，其余形状直接记空键。
          const varName = (head120.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[,)]/) || [])[1]
          if (varName) {
            const before = text.slice(0, m.index)
            const decls = Array.from(before.matchAll(new RegExp('(?:const|let|var)?\\s*' + varName + '\\s*=\\s*\\{', 'g')))
            if (decls.length) {
              const d = decls[decls.length - 1]
              keys = topKeys(before.slice(d.index + d[0].length - 1))
            }
            const scope = text.slice(m.index, m.index + 2500)
            for (const pm of scope.matchAll(new RegExp(varName + '\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*=', 'g'))) {
              if (!keys.includes(pm[1])) keys.push(pm[1])
            }
          }
        }
        if (!found[name]) found[name] = { keys: {}, sites: [] }
        for (const k of keys) found[name].keys[k] = (found[name].keys[k] || 0) + 1
        found[name].sites.push(rel + '（第 ' + (text.slice(0, m.index).split('\n').length) + ' 行）')
      }
    }
  }
  return found
}

const found = collectCalls()
const names = Object.keys(found).sort()

// 一、全部 43 个事件都有埋点落点，退役的 2 个不在源码里。
for (const name of Object.keys(ALLOWED).sort()) {
  check(!!found[name], '事件有埋点落点 ' + name + (found[name] ? '（' + found[name].sites.length + ' 处）' : '（全仓未找到）'))
}
for (const name of names) {
  if (!ALLOWED[name]) check(false, '未知事件名须先更新附录与本门禁 ' + name + ' @ ' + found[name].sites.slice(0, 3).join('、'))
}
check(!found['issuePath.push'] && !found['issuePath.record'], '已退役两事件无埋点残留（issuePath.push、issuePath.record 只在附录追溯）')

// 二、每个事件的实际字段键都在允许表内（只许少记、不过多记）。
for (const name of Object.keys(ALLOWED).sort()) {
  if (!found[name]) continue
  const allowed = ALLOWED[name]
  const actual = Object.keys(found[name].keys).sort()
  const extra = actual.filter((k) => !allowed.includes(k))
  check(extra.length === 0, '事件只含允许字段 ' + name + '（实得 ' + (actual.join('、') || '空') + '）' + (extra.length ? ' —— 多出：' + extra.join('、') : ''))
}

// 三、房内三点六个事件字段形状一字不差（附录 1.4 原文）。
for (const name of Object.keys(ROOM_SHAPES).sort()) {
  if (!found[name]) continue
  const want = ROOM_SHAPES[name].slice().sort()
  if (name === 'error.normalize') {
    const actual = Object.keys(found[name].keys).sort()
    const ok = ROOM_SHAPES[name].every((k) => actual.includes(k)) && actual.every((k) => k === 'httpCode' || ROOM_SHAPES[name].includes(k))
    check(ok, '房内事件字段形状 ' + name + '（实得 ' + actual.join('、') + '，httpCode 仅归一出状态码时带）')
    continue
  }
  const actual = Object.keys(found[name].keys).sort()
  check(JSON.stringify(actual) === JSON.stringify(want), '房内事件字段形状 ' + name + '（实得 ' + (actual.join('、') || '空') + '，应得 ' + want.join('、') + '）')
}

// 四、全局禁令抽查：全部事件的字段键并集里没有原文类键。
const allKeys = {}
for (const name of names) for (const k of Object.keys(found[name].keys)) allKeys[k] = true
// 原文类键精确名单：与这些一字相同的键名不许出现在任何事件里
// （是否配备用路径这类布尔键、带 Hash 后缀的散列键不在此列）。
const RAW_KEYS = ['token', 'password', 'passwd', 'pwd', 'secret', 'authorization', 'bearer', 'url', 'path', 'cwd', 'message', 'error', 'err', 'stack', 'text', 'title', 'body', 'content', 'template', 'snapshot', 'stdout', 'stderr', 'args', 'argv', 'query', 'cookie', 'session', 'hint', 'repo', 'owner']
const rawLike = Object.keys(allKeys).filter((k) => RAW_KEYS.includes(k))
check(rawLike.length === 0, '字段键无原文类键（令牌、路径、地址、文本原文都不许作键名）' + (rawLike.length ? ' —— 命中：' + rawLike.join('、') : '（共 ' + Object.keys(allKeys).length + ' 个键）'))

console.log(failed ? '\n存在失败 — verify-log-fields 未通过' : '\n全部通过 — 字段白名单门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
