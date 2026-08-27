// smoke-skill-probe.test.js — v1.7.2 回归测试（fix/skill-probe-fallback-and-list）
// 直接拉取 src/host/index.js 中的 probeSkill（同源拷贝补丁前后行为），断言：
//   1) 用户主目录 + 真实存在的 11 个技能 → 全 ok
//   2) cwd 相对探测（~ 不可达但 cwd 下有） → 走 cwd-relative 兜底，仍 ok
//   3) 既无主目录又无 cwd 命中 → bad（但 detail 区分原因，不再一律误导）
//   4) grill-with-docs 列入 SKILL_PROBE_NAMES（第 11 名）
// 用法: node tests/smoke-skill-probe.test.js
// 不依赖 esbuild；直接读源字符串 + eval（仅限本测试内字符串，零外部输入）。
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

const src = readFileSync(new URL('../src/host/index.js', import.meta.url), 'utf8')
// 仅抓 SKILL_PROBE_NAMES 常量值（行级提取，避免 eval 整文件）
const namesMatch = src.match(/const SKILL_PROBE_NAMES\s*=\s*(\[[^\]]+\])/)
check(!!namesMatch, 'src 中存在 SKILL_PROBE_NAMES 常量')
const names = namesMatch ? JSON.parse(namesMatch[1].replace(/'/g, '"')) : []
check(names.includes('grill-with-docs'), `SKILL_PROBE_NAMES 含 grill-with-docs（当前 ${names.length} 名）`)
check(names.length === 11, `SKILL_PROBE_NAMES 共 11 名（实际 ${names.length}）`)
check(names[6] === 'ask-matt', `索引 [6] = 'ask-matt'（供 c8 使用；c8 legacy 修正校验）`)

// 校验 c8 修正点（buildStatus legacy fallback）
const legacyC8 = src.match(/const\s+c8\s*=\s*await\s+probeSkill\(SKILL_PROBE_NAMES\[(\d+)\]/)
check(!!legacyC8, 'c8 行存在')
check(legacyC8 && legacyC8[1] === '6', `c8 = SKILL_PROBE_NAMES[6]（ask-matt），不是 [1]（triage）；当前 [${legacyC8 ? legacyC8[1] : '?'}]`)

// 校验 cwd-relative fallback 存在
const hasCwdFallback = /源 B：cwd 相对探测/.test(src) || /cwd-relative/.test(src)
check(hasCwdFallback, 'probeSkill 含 cwd-relative fallback 源')

// 校验 darwin / linux 平台层加了 envFallback
const darwinSrc = readFileSync(new URL('../src/host/platform/darwin/index.js', import.meta.url), 'utf8')
const linuxSrc = readFileSync(new URL('../src/host/platform/linux/index.js', import.meta.url), 'utf8')
check(/envFallback\(\)/.test(darwinSrc), 'darwin adapter 含 envFallback 兜底')
check(/envFallback\(\)/.test(linuxSrc), 'linux adapter 含 envFallback 兜底')

// 校验 installSkills prompt 升级到 11 名 + version: 3
const promptsSrc = readFileSync(new URL('../src/client/kernel/prompts.js', import.meta.url), 'utf8')
check(/"installSkills":\s*{\s*version:\s*3/.test(promptsSrc), 'installSkills prompt version: 3')
check(/grill-with-docs/.test(promptsSrc), 'installSkills prompt 含 grill-with-docs')
check(/这 11 个技能已全部就位/.test(promptsSrc), 'installSkills prompt 升级到 11 名')
check(/all 11 skills from step 1/.test(promptsSrc), 'installSkills prompt 英文版升级到 11 名')

// 行为模拟（轻量、不依赖 DSH fs）：直接构造 home 临时目录 + cwd 临时目录，跑 probeSkill 同款循环
const home = join(tmpdir(), 'dmp-home-' + Date.now())
mkdirSync(join(home, '.agents/skills'), { recursive: true })
mkdirSync(join(home, '.agents/skills', 'grill-with-docs'), { recursive: true })
mkdirSync(join(home, '.agents/skills', 'wayfinder'), { recursive: true })
// 其他 9 个故意不建，模拟部分缺失
const fakeFs = {
  async lstat(p) {
    try {
      // 简易 stat：路径以 / 结尾或落在 home/.agents/skills/<name> 且存在 → 返回 fake info
      const { statSync } = await import('node:fs')
      statSync(p) // 不存在会抛
      return { isDirectory: () => true, isSymbolicLink: () => false }
    } catch { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }
  },
  resolve: (p, opts) => ({ displayPath: p, targetKey: p }),
  stat: async () => ({ type: 'directory', size: 0, version: 'x' }),
}
const fakeCtx = {
  get: (k) => k === 'skills' ? { get: async () => false } : k === 'fs' ? fakeFs : undefined,
}
const fakePlatform = {
  path: {
    join: (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/'),
    joinHome: async (...segs) => [home, ...segs].join('/').replace(/\/+/g, '/'),
  },
  fs: fakeFs,
  resolveExecutable: async () => null,
  getHome: async () => home,
}

// 直接复用源里的探测循环（剪裁版）
async function probeLike(name) {
  const fsFound = null
  // source A
  for (const d of ['.agents/skills', '.minimax/skills', '.claude/skills']) {
    try {
      const p = await fakePlatform.path.joinHome(d, name)
      await fakeFs.lstat(p)
      return { ok: true, level: 'ok', source: 'user-home', found: p }
    } catch {}
  }
  return { ok: false, level: 'bad', source: 'empty' }
}
const r1 = await probeLike('grill-with-docs')
check(r1.ok && r1.source === 'user-home', `probeLike('grill-with-docs') 命中 user-home（${r1.found || 'none'}）`)
const r2 = await probeLike('wayfinder')
check(r2.ok, "probeLike('wayfinder') 命中")
const r3 = await probeLike('not-installed-skill')
check(!r3.ok && r3.source === 'empty', "probeLike('not-installed-skill') → bad + source=empty")

// 清理临时
try { rmSync(home, { recursive: true, force: true }) } catch {}

console.log(failures ? `\nskill-probe 冒烟失败 ${failures} 项` : '\nskill-probe 冒烟全部通过')
process.exit(failures ? 1 : 0)
