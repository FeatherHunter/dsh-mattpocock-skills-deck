// verify-config-store-migration.ts — 配置迁移门禁（#1012 落地）
// 盯四件事（宿主适配器 + 内存假文件系统，不碰真实磁盘）：
//   M1 老 `.json` 能读：只有老文件时照读，from 记 json（调用方决定何时迁移）。
//   M2 新老并存时以新为准：from 记 yaml，并带一条迁移遗留警告（调用方用已有事件记日志）。
//   M3 写新删老：写成功后老文件被删掉；删不掉只警告，不影响主流程。
//   M4 版本过高：读成功标只读，写明确拒绝；两个文件都没有时回 missing（界面引导去选）。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-config-store-migration.ts
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : '')))
  if (!ok) failed = true
}

const MISSING = () => {
  const e = new Error('not found')
  e.code = 'ENOENT'
  return e
}

/** 内存假文件系统：键是适配器拼出来的绝对路径原文，值是文件内容。 */
function makeMemFs(seed) {
  const files = new Map(Object.entries(seed || {}))
  const calls = { read: [], wrote: [], rm: [] }
  return {
    files,
    calls,
    io: {
      async readText(p) { calls.read.push(p); if (!files.has(p)) throw MISSING(); return files.get(p) },
      async writeText(p, text) { calls.wrote.push(p); files.set(p, String(text)) },
      async rm(p) { calls.rm.push(p); if (!files.has(p)) throw MISSING(); files.delete(p) },
      async mkdir() {},
    },
  }
}

async function main() {
  console.log('配置迁移门禁（#1012：老文件能读能迁，新老并存以新为准）')
  const adapter = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const { readWorkspaceConfig, writeWorkspaceConfig, readLocalSettings, writeLocalSettings, readLabelColors, writeLabelColors } = adapter

  const ROOT_DIR = 'D:\\ws\\demo'
  const YAML_P = ROOT_DIR + '/docs/agents/workspace.yaml'
  const JSON_P = ROOT_DIR + '/docs/agents/workspace.json'
  const yamlText = '# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。\nversion: 2\nbackendId: github\npickedAt: 1\nsource: user\nlayout: multi\n'
  const jsonText = JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 9, source: 'user' })

  // —— M1：只有老文件 ——
  {
    const mem = makeMemFs({ [JSON_P]: jsonText })
    const r = await readWorkspaceConfig(ROOT_DIR, mem.io)
    check(r.ok === true && r.from === 'json' && r.value.backendId === 'markdown', 'M1 只有老文件时照读（from=json）', JSON.stringify(r))
  }

  // —— M2：新老并存 ——
  {
    const mem = makeMemFs({ [YAML_P]: yamlText, [JSON_P]: jsonText })
    const r = await readWorkspaceConfig(ROOT_DIR, mem.io)
    check(r.ok === true && r.from === 'yaml' && r.value.backendId === 'github', 'M2 并存时以新为准', JSON.stringify(r))
    check(r.ok === true && r.legacyPresent === true && (r.warnings || []).join().indexOf('legacy-present') >= 0, 'M2 并存时带迁移遗留警告（调用方记日志用）', JSON.stringify(r.warnings))
  }

  // —— M3：写新删老 ——
  {
    const mem = makeMemFs({ [JSON_P]: jsonText })
    const w = await writeWorkspaceConfig(ROOT_DIR, { version: 2, backendId: 'github', pickedAt: 5, source: 'migrated', layout: 'single' }, mem.io)
    check(w.ok === true && w.from === 'yaml', 'M3 写新文件成功', JSON.stringify(w))
    check(!mem.files.has(JSON_P), 'M3 写成功后老文件被删掉', JSON.stringify([...mem.files.keys()]))
    check((mem.files.get(YAML_P) || '').indexOf('source: migrated') >= 0, 'M3 新文件内容是 YAML', (mem.files.get(YAML_P) || '').slice(0, 120))
    const r = await readWorkspaceConfig(ROOT_DIR, mem.io)
    check(r.ok === true && r.from === 'yaml' && r.value.source === 'migrated', 'M3 写完读回是新值', JSON.stringify(r))
  }
  {
    // 删不掉只警告：rm 恒抛权限错，主流程照样成功。
    const mem = makeMemFs({ [JSON_P]: jsonText })
    const strictIo = Object.assign({}, mem.io, {
      async rm(p) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e },
    })
    const w = await writeWorkspaceConfig(ROOT_DIR, { version: 2, backendId: 'github', pickedAt: 5, source: 'user', layout: 'multi' }, strictIo)
    check(w.ok === true && (w.warnings || []).join().indexOf('legacy-delete-failed') >= 0, 'M3 老文件删不掉只警告、不影响主流程', JSON.stringify(w))
  }

  // —— M4：版本与缺席 ——
  {
    const mem = makeMemFs({ [YAML_P]: 'version: 9\nbackendId: github\npickedAt: 1\nsource: user\nlayout: multi\n' })
    const r = await readWorkspaceConfig(ROOT_DIR, mem.io)
    check(r.ok === true && r.readonly === true, 'M4 高版本读成功但标只读', JSON.stringify(r))
    const w = await writeWorkspaceConfig(ROOT_DIR, { version: 9, backendId: 'github', pickedAt: 1, source: 'user', layout: 'multi' }, mem.io)
    check(w.ok === false && w.reason === 'version-newer', 'M4 高版本拒绝写', JSON.stringify(w))
    const mem2 = makeMemFs({})
    const r2 = await readWorkspaceConfig(ROOT_DIR, mem2.io)
    check(r2.ok === false && r2.reason === 'missing' && /还没选后端/.test(r2.message), 'M4 两个都没有时回 missing（界面引导去选）', JSON.stringify(r2))
  }
  {
    // 新文件坏了、老文件好的：先用老的顶着并警告，不崩。
    const mem = makeMemFs({ [YAML_P]: 'version: [unclosed\n', [JSON_P]: jsonText })
    const r = await readWorkspaceConfig(ROOT_DIR, mem.io)
    check(r.ok === true && r.from === 'json' && (r.warnings || []).join().indexOf('yaml-unreadable') >= 0, 'M4 新坏老好时用老的顶着并警告', JSON.stringify(r))
  }

  // —— 本机设置与配色：读写往返 ——
  {
    const mem = makeMemFs({})
    const r0 = await readLocalSettings('C:\\Users\\demo', mem.io)
    check(r0.ok === false && r0.reason === 'missing', '设置文件不在回 missing（不算错）', JSON.stringify(r0))
    // #1612：工作区每条记录归一是四格（statusBar/deckTools 两个文字开关 + 两个旧布尔开关），往返逐字一致。
    const value = {
      version: 1,
      ui: { stateFilter: 'open', sortKey: 'updatedAt', sortDir: 'desc', labelClicks: {} },
      workspaces: { 'D:\\ws\\demo': { statusBar: 'hide', deckTools: 'on', noRepoDismissed: false, subwsMarkAutoShown: false } },
      debug: { enabled: true, sampleRate: 0.5 },
      templates: {},
    }
    const w = await writeLocalSettings(value, 'C:\\Users\\demo', mem.io)
    check(w.ok === true, '设置能写', JSON.stringify(w))
    check(mem.files.has('C:\\Users\\demo/.dsh/mattskillsdeck/settings.yaml'), '设置落在用户主目录下那一层', JSON.stringify([...mem.files.keys()]))
    const r = await readLocalSettings('C:\\Users\\demo', mem.io)
    check(r.ok === true && JSON.stringify(r.value) === JSON.stringify(value), '设置读写往返一致', JSON.stringify(r.value))
    // #1612：只带 bannerFolded 的旧文件读得进来（不判 unknown-keys），只换算「展开」那一种旧值，
    //   写完的一份里不再有旧字段。
    const legacyValue = {
      version: 1,
      ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} },
      workspaces: { 'D:\\ws\\demo': { bannerFolded: false, noRepoDismissed: false, subwsMarkAutoShown: false } },
      debug: { enabled: false, sampleRate: 1 },
      templates: {},
    }
    const wl = await writeLocalSettings(legacyValue, 'C:\\Users\\demo', mem.io)
    check(wl.ok === true, '旧字段的文件也能写（读得进 bannerFolded，只换算展开那一种旧值）', JSON.stringify(wl))
    const rl = await readLocalSettings('C:\\Users\\demo', mem.io)
    const upgraded = rl.ok ? rl.value.workspaces['D:\\ws\\demo'] : null
    check(!!upgraded && upgraded.statusBar === 'show' && upgraded.deckTools === 'on' && upgraded.bannerFolded === undefined,
      '旧 bannerFolded: false（展开）换算成 statusBar: show；deckTools 按缺省 on；旧字段不再出现', JSON.stringify(upgraded))
  }
  {
    const mem = makeMemFs({ [ROOT_DIR + '/docs/agents/label-colors.json']: JSON.stringify({ bug: 'd73a4a' }) })
    const r = await readLabelColors(ROOT_DIR, mem.io)
    check(r.ok === true && r.from === 'json', '配色老文件能读', JSON.stringify(r))
    const w = await writeLabelColors(ROOT_DIR, { version: 1, colors: { bug: 'd73a4a' } }, mem.io)
    check(w.ok === true && !mem.files.has(ROOT_DIR + '/docs/agents/label-colors.json'), '配色写新删老', JSON.stringify(w))
    const back = await readLabelColors(ROOT_DIR, mem.io)
    check(back.ok === true && back.from === 'yaml', '配色写完读回是新文件', JSON.stringify(back))
  }

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
