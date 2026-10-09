// tests/verify-951-short-core.js —— #951 短等待核心门禁（948 图第二批）
// 用法：在插件根目录执行 node tests/verify-951-short-core.js，可独立运行。
//
// 盯住 #951 验收 5 条（原文见票正文，大白话复述）：
//   1. 等待时按钮里转圈加整颗禁用，连点第二下什么都不发生。
//   2. 成功变对勾、失败变叉号、部分成功变三角，三只图标互相一样大，也和原来的图标一样大。
//   3. 成功绿闪失败红闪最多半秒自己退；开了减少动态的人只看图标加文字，不闪不抖不弹。
//   4. 转圈和备用过程（圆点/呼吸）同一时刻只开一个（备用只落在无转圈的按钮上，映射里过程主力也是单值）。
//   5. 成功绿用代码真实值；失败红按路径占位（横幅 bad 那一档 #f87171 系），不对全局硬定一个值，
//      更不许引入原型占位红 #f85149。
// 颜色口径（对照代码定的，不编）：按钮成功闪跟提示条 ok 同色（#4ade80 系，与 flash(st,msg,'ok')
//   走同一套绿）；失败闪跟横幅 bad 同色（#f87171 系）；部分成功跟提示条 warn 同色（#fbbf24 系）。
//   #3fb950 留给已关闭与已完成状态（列表行现有用处），按钮闪光不用它。#955 落地前再逐处复核。
// 落点：发评论 IssueDetailComments.js、改标签 labels/LabelColorDialog.js、存设置 SettingsPage.js、
//   复制链接 ListTabRow.js、拉列表 ListTab.js（加载态已有转圈）与刷新按钮（Dock 头部按 #195
//   故意可重按，只给转圈不给禁用；ChecksTab 那颗给转圈加禁用）。
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

console.log('948 第二批门禁：短等待核心过程与结果（#951）')
const styles = read('src/client/views/feedback/feedback-styles.js') + '\n' + read('src/client/kernel/styles.js')
const comments = read('src/client/views/IssueDetailComments.js')
const labelDialog = read('src/client/views/labels/LabelColorDialog.js')
const settings = read('src/client/views/SettingsPage.js')
const listRow = read('src/client/views/ListTabRow.js')
const listTab = read('src/client/views/ListTab.js')
const dock = read('src/client/panel/Dock.js')
const checks = read('src/client/views/ChecksTab.js')
const apiIo = read('src/client/kernel/api-io.js')

// —— 1. 发评论：转圈加禁用，连点第二下无事 ——
check(comments.includes('dsws-spinner') && comments.includes('cmtSending'), '发评论等待时按钮里有转圈')
check(comments.includes('disabled') && comments.includes('cmtSending'), '发评论等待时按钮禁用')
check(/if\s*\(\s*st\.cmtSending\s*\)\s*return/.test(comments), '发评论连点第二下直接返回（无事发生）')
// —— 1b. 改标签：保存等待时禁用（已有，锁住不许退化） ——
check(labelDialog.includes('!canSave') && labelDialog.includes('lc.saving'), '改标签保存等待时按钮禁用（busy 进 canSave）')
check(labelDialog.includes('dsws-spinner'), '改标签保存等待时有转圈')
// —— 1c. 存设置：开关与四键等待时禁用（已有，锁住） ——
check(settings.includes('dbgPending') && settings.includes('disabled'), '存设置开关切换中禁用')
check(settings.includes('dbgBusy') && settings.includes('disabled'), '存设置四键忙时禁用')
check(settings.includes('dbgFlash') && settings.includes('dsws-fb-okflash') && settings.includes('dsws-fb-warnflash'), '存设置开关落定后行内闪光（成功绿失败琥珀，半秒自退）')
// —— 1d. 拉列表：加载态行形骨架占位（#953 接管：遮罩里的转圈换成行形骨架条，遮罩本身与出现规则不动；同一时刻只用一个主力过程） ——
check(listTab.includes('dsws-fb-skel') && listTab.includes('dsws-loading-shade'), '拉列表加载态行形骨架占位（遮罩里是行形条）')
check(checks.includes('st.refreshing') && checks.includes('dsws-spin'), '列表页刷新按钮等待时转圈')
check(checks.includes('disabled: st.refreshing') || checks.includes('disabled:st.refreshing'), '列表页刷新按钮等待时禁用')
check(dock.includes("s.refreshing ? ' dsws-spin'"), '头部刷新按钮等待时转圈（#195 故意可重按，不禁用，见 probe-auto.js）')

// —— 2. 对勾叉号三角同尺寸替换 ——
check(comments.includes("n: 'check'") && comments.includes("n: 'x'"), '发评论按钮有成功对勾与失败叉号')
check(labelDialog.includes('saveResult') && labelDialog.includes("? 'alert' : 'x'") && labelDialog.includes('n: saveResult'), '改标签保存按钮按落定结果换叉号三角（全成功自动关，只剩失败与部分成功）')
check(listRow.includes('copyFlash') && listRow.includes("n: 'check'") && listRow.includes("n: 'x'"), '复制按钮按真实结果换对勾叉号')
const copyFnBody = (apiIo.split('export const copyText')[1] || '').split('export const ')[0] || ''
check(/return\s+(navigator\.clipboard|Promise\.resolve)/.test(copyFnBody), '复制函数返回真实结果（按钮换图标有据可依）')

// —— 3. 绿闪红闪半秒自退，减少动态下降级 ——
check(styles.includes('dsws-fb-okflash') && styles.includes('dsws-fb-errflash'), '成功闪与失败闪的类存在')
check(styles.includes('dsws-fb-okflash .45s') && styles.includes('dsws-fb-errflash .45s'), '闪光动画不超过半秒（两类闪光均 .45s）')
check(styles.includes('forwards'), '闪光收尾回到原样（forwards 退场）')
check(styles.includes('dsws-fb-shake'), '失败抖动类存在（小幅一次）')
check(/prefers-reduced-motion[\s\S]{0,400}dsws-fb-shake/.test(styles), '减少动态下抖动与闪光降级（媒体查询兜底含新类）')

// —— 4. 转圈与备用过程互斥，同一按钮同一时刻只有一个主力过程 ——
//   （#952 起呼吸有了备用归宿：评论分页加载中按钮；圆点归宿是弹窗提交等待中。
//   再断言“仓库没有呼吸”就是错门禁，改断互斥本身：备用只出现在无转圈的按钮上。）
//   判据按行：同一物理行里转圈（busy/spinner）与备用（dots/breath）永不同时出现。
const noDualProcess = function (src) {
  return String(src).split('\n').every(function (ln) {
    const hasBusy = ln.indexOf('dsws-fb-busy') !== -1 || ln.indexOf('dsws-spinner') !== -1
    const hasAlt = ln.indexOf('dsws-fb-dots') !== -1 || ln.indexOf('dsws-fb-breath') !== -1
    return !(hasBusy && hasAlt)
  })
}
check(noDualProcess(comments) && noDualProcess(labelDialog) && noDualProcess(settings) && noDualProcess(listRow) && noDualProcess(listTab) && noDualProcess(read('src/client/kernel/slotRenderer-modal-view.js')), '备用过程（圆点/呼吸）永不与转圈同处一行（同一按钮只开一个主力）')
check(listRow.includes('copyFlash') && !/copySending/.test(listRow), '复制是瞬间动作，不套转圈（过程唯一）')

// —— 5. 颜色按路径取真值，不设全局硬值，不引入占位红 ——
const srcAll = [styles, comments, labelDialog, settings, listRow].join('\n')
check(!srcAll.includes('#f85149'), '五处落点不引入原型占位红 #f85149')
check(styles.includes('74,222,128') && styles.includes('248,113,113'), '闪光复用提示 ok 与横幅 bad 同色系（按路径取色）')
check(!/errflash[^;]*#[0-9a-fA-F]{6}(?!.*f87171)/.test(styles.replace(/\s+/g, '')), '失败闪不另起新红值')

if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
console.log('\n全部通过 · 948 第二批门禁（#951，共 ' + total + ' 项）')
