// verify-config-store-core.js — 配置读写核行为门禁（#1012 落地）
// 盯六件事（纯函数，不碰文件系统，行为逐条钉死）：
//   C1 往返：三份文件的定案骨架写出来再读回去，值不变。
//   C2 精确类型：YAML 会把 `yes`/`on`/`no` 读成文字、把 `1.10` 读成数字、把前导零读成八进制，
//      字段要什么类型、解析出来就必须是什么类型，对不上的按坏形状回。
//   C3 未知键：白名单之外的名字一律按未知键回，并点名是哪些。
//   C4 硬限制：超大文件、超多别名都不崩，按档位回。
//   C5 版本：高于认识的只读不写（读成功标只读，写明确拒绝）；老 JSON（版本 1）直接可读。
//   C6 标签形状：直接写颜色与 {color, description} 两种都认，其它形状拒；`__proto__` 拒。
// 用法：node tests/verify-config-store-core.js（在仓库根目录）
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : '')))
  if (!ok) failed = true
}

async function main() {
  console.log('配置读写核行为门禁（#1012：解析校验拼装六件事）')
  // 文本出入口住宿主适配器（冻结名 parseConfig / stringifyConfig，唯一入口）；
  // 三份 schema 的校验与模板住核单元里，行为从门面统一钉。
  const core = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const { parseConfig, stringifyConfig } = core

  // —— C1：往返 ——
  {
    const ws = { version: 2, backendId: 'github', pickedAt: 1791524461229, source: 'user', layout: 'multi' }
    const out = stringifyConfig(ws, 'workspace')
    check(out.ok === true, 'C1 工作区能拼', out.ok ? '' : out.message)
    const back = out.ok ? parseConfig(out.text, 'workspace') : null
    check(!!back && back.ok === true && JSON.stringify(back.value) === JSON.stringify(ws), 'C1 工作区往返值不变', JSON.stringify(back))
    const st = {
      version: 1,
      ui: { stateFilter: 'open', sortKey: 'updatedAt', sortDir: 'desc', labelClicks: { bug: 3 } },
      workspaces: { 'D:\\ws\\demo': { bannerFolded: true, noRepoDismissed: false, subwsMarkAutoShown: true } },
      debug: { enabled: false, sampleRate: 1 },
      templates: { execute: 'hi' },
    }
    const stOut = stringifyConfig(st, 'settings')
    check(stOut.ok === true, 'C1 设置能拼', stOut.ok ? '' : stOut.message)
    const stBack = stOut.ok ? parseConfig(stOut.text, 'settings') : null
    check(!!stBack && stBack.ok === true && JSON.stringify(stBack.value) === JSON.stringify(st), 'C1 设置往返值不变', JSON.stringify(stBack))
    const lb = { version: 1, colors: { bug: 'd73a4a', 'wayfinder:map': { color: '8b5cf6', description: '地图票' }, '还没配色': '' } }
    const lbOut = stringifyConfig(lb, 'label-colors')
    check(lbOut.ok === true, 'C1 配色能拼', lbOut.ok ? '' : lbOut.message)
    const lbBack = lbOut.ok ? parseConfig(lbOut.text, 'label-colors') : null
    check(!!lbBack && lbBack.ok === true && JSON.stringify(lbBack.value) === JSON.stringify(lb), 'C1 配色往返值不变', JSON.stringify(lbBack))
    //  hostile 语料（对抗审查补）：换行、引号、冒号、前导空格、emoji、反斜杠、怪标签名，往返必须一致。
    const hostile = {
      version: 1,
      ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} },
      workspaces: {},
      debug: { enabled: false, sampleRate: 1 },
      templates: { nl: '第一行\n第二行', quote: '他说 "你好"', colon: 'key: value 冒号', leadSpace: '  前导空格', unicode: '标签🏷️混合中文', backslash: 'C:\\path\\x', single: "it's", empty: '' },
    }
    const hOut = stringifyConfig(hostile, 'settings')
    const hBack = hOut.ok ? parseConfig(hOut.text, 'settings') : null
    check(!!hBack && hBack.ok === true && JSON.stringify(hBack.value.templates) === JSON.stringify(hostile.templates), 'C1 刁钻模板文字往返一致', JSON.stringify(hBack && hBack.value.templates))
    const hostileTags = { 'bug:fix': 'd73a4a', ' leading': 'ffffff', 'a"b': '000000', 'C:\\x': '123456', no: '654321', 123: 'abcdef' }
    const htOut = stringifyConfig({ version: 1, colors: hostileTags }, 'label-colors')
    const htBack = htOut.ok ? parseConfig(htOut.text, 'label-colors') : null
    check(!!htBack && htBack.ok === true && JSON.stringify(htBack.value.colors) === JSON.stringify(hostileTags), 'C1 刁钻标签名往返一致', htOut.ok ? htOut.text : '')
  }

  // —— C2：精确类型（YAML 隐式类型的坑） ——
  {
    const boolTrap = parseConfig('version: 1\nui: {}\nworkspaces: {}\ndebug: {enabled: yes, sampleRate: 1}\ntemplates: {}\n', 'settings')
    check(boolTrap.ok === false && boolTrap.reason === 'bad-shape', 'C2 `enabled: yes`（文字）按坏形状回', JSON.stringify(boolTrap))
    const onTrap = parseConfig('version: 1\nui: {}\nworkspaces: {D:\\x: {bannerFolded: on}}\ndebug: {enabled: false, sampleRate: 1}\ntemplates: {}\n', 'settings')
    check(onTrap.ok === false && onTrap.reason === 'bad-shape', 'C2 `bannerFolded: on`（文字）按坏形状回', JSON.stringify(onTrap))
    const numTrap = parseConfig('version: 1.10\nbackendId: github\npickedAt: 1\nsource: user\nlayout: multi\n', 'workspace')
    check(numTrap.ok === false && numTrap.reason === 'bad-shape', 'C2 `version: 1.10`（数字 1.1）按坏形状回', JSON.stringify(numTrap))
    const octTrap = parseConfig('version: 2\nbackendId: github\npickedAt: 0777\nsource: user\nlayout: multi\n', 'workspace')
    check(octTrap.ok === true && octTrap.value.pickedAt === 777, 'C2 `pickedAt: 0777` 读成 777 照收（精确类型只认整数，非负即合法）', JSON.stringify(octTrap))
    const strTrap = parseConfig('version: 2\nbackendId: no\npickedAt: 1\nsource: user\nlayout: multi\n', 'workspace')
    check(strTrap.ok === true && strTrap.value.backendId === 'no', 'C2 `backendId: no` 是合法文字照收（core 模式下它就是字符串）', JSON.stringify(strTrap))
    const emptyId = parseConfig('version: 2\nbackendId: "  "\npickedAt: 1\nsource: user\nlayout: multi\n', 'workspace')
    check(emptyId.ok === false && emptyId.reason === 'bad-shape', 'C2 空 backendId 按坏形状回', JSON.stringify(emptyId))
  }

  // —— C3：未知键 ——
  {
    const u1 = parseConfig('version: 2\nbackendId: github\npickedAt: 1\nsource: user\nlayout: multi\nnick: x\n', 'workspace')
    check(u1.ok === false && u1.reason === 'unknown-keys' && (u1.keys || []).join() === 'nick', 'C3 工作区多出来的名字按未知键回并点名', JSON.stringify(u1))
    const u2 = parseConfig('version: 1\nui: {stateFilter: open,xxx: 1}\nworkspaces: {}\ndebug: {enabled: false, sampleRate: 1}\ntemplates: {}\n', 'settings')
    check(u2.ok === false && u2.reason === 'unknown-keys', 'C3 设置 ui 节多出来的名字按未知键回', JSON.stringify(u2))
    const w1 = stringifyConfig({ version: 2, backendId: 'github', pickedAt: 1, source: 'user', layout: 'multi', extra: 1 }, 'workspace')
    check(w1.ok === false && w1.reason === 'unknown-keys', 'C3 写时多出来的名字拒绝写（不静默丢）', JSON.stringify(w1))
  }

  // —— C4：硬限制（上限数字住门面唯一一处，这里从行为上钉住） ——
  {
    const big = parseConfig('version: 1\n' + 'k: v\n'.repeat(20000), 'settings')
    check(big.ok === false && big.reason === 'oversize', 'C4 超大文件按档位回', JSON.stringify(big).slice(0, 200))
    const bomb = 'version: 1\nx: &a [1]\n' + Array.from({ length: 60 }, (_, i) => 'k' + i + ': *a\n').join('')
    const bombR = parseConfig(bomb, 'settings')
    check(bombR.ok === false && bombR.reason === 'aliases', 'C4 别名炸弹按档位回', JSON.stringify(bombR).slice(0, 200))
    check(parseConfig('', 'workspace').ok === false, 'C4 空白文件不崩', '')
    check(parseConfig('{oops', 'workspace').ok === false, 'C4 坏文本不崩', '')
    // 重复键必须拒（对抗审查补：这是解析库的默认行为，升级解析库时若默认变了，这里会红）。
    const dup = parseConfig('version: 2\nbackendId: a\nbackendId: b\npickedAt: 1\nsource: user\nlayout: multi\n', 'workspace')
    check(dup.ok === false, 'C4 重复键拒绝', JSON.stringify(dup))
  }

  // —— C5：版本（只读不写 + 老格式） ——
  {
    const legacy = parseConfig(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'user' }), 'workspace')
    check(legacy.ok === true && legacy.value.backendId === 'github' && legacy.readonly === false, 'C5 老 JSON（版本 1）直接可读', JSON.stringify(legacy))
    const legacyAuto = parseConfig(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'auto' }), 'workspace')
    check(legacyAuto.ok === true, 'C5 老文件里的 auto 来源读时照认（写时不再产出）', JSON.stringify(legacyAuto))
    const newer = parseConfig('version: 9\nbackendId: github\npickedAt: 1\nsource: user\nlayout: multi\n', 'workspace')
    check(newer.ok === true && newer.readonly === true && (newer.warnings || []).join().indexOf('version-newer') >= 0, 'C5 高版本读成功但标只读', JSON.stringify(newer))
    const noWrite = stringifyConfig({ version: 9, backendId: 'github', pickedAt: 1, source: 'user', layout: 'multi' }, 'workspace')
    check(noWrite.ok === false && noWrite.reason === 'version-newer' && /升级插件/.test(noWrite.message), 'C5 高版本拒绝写并有明确回执', JSON.stringify(noWrite))
    const v2auto = parseConfig('version: 2\nbackendId: github\npickedAt: 1\nsource: auto\nlayout: multi\n', 'workspace')
    check(v2auto.ok === false && v2auto.reason === 'bad-shape', 'C5 版本 2 里不再认 auto（旧的自动结论不许钉成新文件）', JSON.stringify(v2auto))
  }

  // —— C6：标签形状 ——
  {
    const bad = parseConfig('version: 1\nbug: 123\n', 'label-colors')
    check(bad.ok === false && bad.reason === 'bad-shape', 'C6 数字颜色按坏形状回', JSON.stringify(bad))
    const proto = parseConfig('version: 1\n__proto__: {color: x}\n', 'label-colors')
    check(proto.ok === false, 'C6 `__proto__` 当标签名拒绝', JSON.stringify(proto))
    const noVer = parseConfig('bug: d73a4a\n', 'label-colors')
    check(noVer.ok === true && noVer.value.version === 1, 'C6 没版本的老文件照读（当版本 1）', JSON.stringify(noVer))
  }

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
