// tests/verify-issue527-ws-overview.js — #527 回归守卫：工作区后端总览的行内不能出现收起按钮
// 用法：node tests/verify-issue527-ws-overview.js（在插件根目录；无需网络）
// 背景：总览是只读的，每一行只留后端名字加来源徽标。之前有一处放错位置的调用，
// 在每一行末尾又放了一个本该只出现在横幅上的折叠按钮，点它只会折叠横幅，
// 跟总览这一行的内容没有关系。本门禁钉住三条验收判据：行内无按钮、顶部总览开关还在、横幅折叠不受影响。
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }
const check = function (cond, name) { if (cond) ok(name); else bad(name) }

const wsFile = fs.readFileSync(path.join(root, 'src/client/views/SettingsWorkspaces.js'), 'utf8')
const prefsFile = fs.readFileSync(path.join(root, 'src/client/kernel/store-prefs.js'), 'utf8')
const statusFile = fs.readFileSync(path.join(root, 'src/client/statusbar/StatusBar.js'), 'utf8')

// 判据 1：总览展开后，每一行只有后端名加来源徽标，行末尾没有收起或展开按钮。
check(wsFile.indexOf('setBannerFolded') < 0, '总览文件不再调用横幅折叠的写入函数')
check(wsFile.indexOf('isBannerFolded') < 0, '总览文件不再读取横幅折叠状态')
check(wsFile.indexOf('banner.fold') < 0 && wsFile.indexOf('banner.expand') < 0, '总览文件不再引用横幅折叠的文案')
check(wsFile.indexOf('dsws-cfg-btn') < 0, '总览文件的每一行不再放置行内按钮')
check(wsFile.indexOf('labelOf') >= 0 && wsFile.indexOf('srcLabel') >= 0, '总览文件的每一行保留后端名字加来源徽标')

// 判据 2：总览顶部的那条点击展开或收起还在，能正常展开和收起整个总览。
check(wsFile.indexOf('<details') >= 0 || wsFile.indexOf("'details'") >= 0, '总览仍然用可折叠容器承载全部行')
check(wsFile.indexOf('wsToggleHint') >= 0, '总览顶部保留点击展开或收起的提示')
check(wsFile.indexOf('wsRefresh') >= 0, '总览顶部的刷新入口不受影响')

// 判据 3：横幅上的折叠和展开功能不受影响。
check(prefsFile.indexOf('isBannerFolded') >= 0 && prefsFile.indexOf('setBannerFolded') >= 0, '横幅折叠的读写函数仍在偏好存储里')
check(statusFile.indexOf('setBannerFolded') >= 0 && statusFile.indexOf('isBannerFolded') >= 0, '状态栏横幅仍在使用折叠读写函数')

console.log(failed ? '\n[issue527-ws-overview] FAIL (' + passed + ' passed)' : '\n全部通过 · 总览行内无收起按钮门禁生效 (' + passed + ')')
process.exit(failed ? 1 : 0)
