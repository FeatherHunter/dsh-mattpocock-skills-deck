// verify-config-store-comments.js — 配置注释门禁（#1012 落地）
// 规则（维护者原话：每个字段都有我们定义好的注释，注释与字段定义同一个源）：
//   写出来的每个字段前面都有我们定义的注释，且注释文字与核里那份常量逐字一致；
//   两个文件的头一句都是「本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。」
// 用法：node tests/verify-config-store-comments.js（在仓库根目录）
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg, detail) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : '')))
  if (!ok) failed = true
}

/** 注释行必须紧挨在字段行前面（中间不许夹别的行；比对时忽略缩进，注释文字逐字一致）。 */
function commentBefore(text, comment, keyLine) {
  const lines = text.split('\n')
  const ki = lines.findIndex((l) => l.trim() === keyLine.trim())
  if (ki < 0) return false
  for (let i = ki - 1; i >= 0; i--) {
    if (lines[i].trim() === comment.trim()) return true
    if (lines[i].trim().startsWith('#')) continue
    return false
  }
  return false
}

async function main() {
  console.log('配置注释门禁（#1012：字段注释由程序生成且与 schema 同源）')
  const core = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
  const { stringifyConfig } = core

  const HEADER = '# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。'

  // —— 工作区：骨架逐字一致本身就是最强的注释断言 ——
  const wsExpected = `# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。
# 这份文件随仓库走：提交之后就团队共享，改动会影响所有人。
version: 2
# 这条工作区用哪个后端
backendId: github
# 这次选择发生的时间（毫秒）
pickedAt: 1791524461229
# 这条选择是谁做的：user=人在面板里亲手选的；migrated=从老版本机记忆搬来的；detected=插件按声明文件或自动识别生成的
source: user
# 面板布局：single=单栏；multi=多栏
layout: multi
`
  const wsOut = stringifyConfig({ version: 2, backendId: 'github', pickedAt: 1791524461229, source: 'user', layout: 'multi' }, 'workspace')
  check(wsOut.ok === true && wsOut.text === wsExpected, '工作区骨架逐字一致（含全部注释）', wsOut.ok ? wsOut.text : wsOut.message)

  // —— 设置：每个字段的注释都在字段前面 ——
  const stOut = stringifyConfig({
    version: 1,
    ui: { stateFilter: 'open', sortKey: 'updatedAt', sortDir: 'desc', labelClicks: {} },
    workspaces: { 'D:\\ws\\demo': { bannerFolded: true, noRepoDismissed: true, subwsMarkAutoShown: true } },
    debug: { enabled: false, sampleRate: 1 },
    templates: {},
  }, 'settings')
  check(stOut.ok === true, '设置能拼', stOut.ok ? '' : stOut.message)
  if (stOut.ok) {
    const t = stOut.text
    check(t.split('\n')[0] === HEADER, '设置文件头第一句是注释生成规则', t.split('\n')[0])
    check(commentBefore(t, '# 界面偏好（本机全工作区默认生效）', 'ui:'), 'ui 节有注释', '')
    check(commentBefore(t, '# 主列表的状态过滤与排序', '  stateFilter: open'), 'stateFilter 有注释', '')
    check(t.indexOf('labelClicks') < 0, '写出去的一份里不写 labelClicks（维护者 2026-10-12 拍板：这项不落盘）', t)
    check(commentBefore(t, '# 按工作区区分的观看状态（键 = 工作区根目录）', 'workspaces:'), 'workspaces 节有注释', '')
    check(commentBefore(t, '# 状态栏横幅与胶囊是否收起', '    bannerFolded: true'), 'bannerFolded 有注释', '')
    check(commentBefore(t, '# 无仓库红卡是否已收起', '    noRepoDismissed: true'), 'noRepoDismissed 有注释', '')
    check(commentBefore(t, '# 红文件夹标志的说明浮层是否已自动展开过', '    subwsMarkAutoShown: true'), 'subwsMarkAutoShown 有注释', '')
    check(commentBefore(t, '# 本地诊断日志开关', 'debug:'), 'debug 节有注释', '')
    check(commentBefore(t, '# 动作模板（空 = 用默认文本）', 'templates: {}'), 'templates 有注释', '')
  }

  // —— 配色：头句与版本注释 ——
  const lbOut = stringifyConfig({ bug: 'd73a4a' }, 'label-colors')
  check(lbOut.ok === true, '配色能拼', lbOut.ok ? '' : lbOut.message)
  if (lbOut.ok) {
    const t = lbOut.text
    check(t.split('\n')[0] === HEADER, '配色文件头第一句是注释生成规则', t.split('\n')[0])
    check(commentBefore(t, '# 这一份数据的版本号（核不认识的新版本只读不写）', 'version: 1'), '配色 version 有注释', t)
    check(t.indexOf('bug: d73a4a') >= 0, '配色标签行在', t)
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 配置注释门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
