// verify-update-migration.js — 更新能力委托门禁（#586 起迁移门禁，#875 改为薄接线委托门禁，#880 收尾本地旧包）
//
// 这道门禁回答一个问题：更新能力是不是全权委托给了已安装的更新包，本仓还有没有自己的更新实现。规则：
//   0) 版本一致：根清单与发布清单用同一范围依赖更新包（当前 0.17 范围）；锁文件版本＝已安装版本＝派生文件头版本一致；
//      锁文件里不再有本地旧包的登记，工作区放行名单里不再有更新包条目。
//   1) 旧实现已删：旧三件套、旧派生目录、旧共享核心、update-core 源码树、本地旧包目录都不存在；
//      退役的四道旧门禁已从校验链移除。
//   2) 接线只走包：五个电话名从已安装包的 phoneNames 读出来，宿主接线把第五个（日志直追加）也暴露出来。
// 约束：全程假零件与假网络，不真跑安装命令、不直连官方源。
// 用法：node tests/verify-update-migration.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

const GONE = [
  'src/host/update.js', 'src/host/updateReader.js', 'src/host/updateStore.js',
  'src/host/updatePkg', 'src/shared/update', 'update-core',
  'packages/dsh-plugin-update', 'package/shared/update',
  'tests/verify-update-freshness.js', 'tests/verify-update-regression.js',
  'tests/verify-update-routes.js', 'tests/verify-update-install.js',
]
const PHONE_NAMES = { updateStatus: 'wf.updateStatus', updateCheck: 'wf.updateCheck', updateInstall: 'wf.updateInstall', updateChangelog: 'wf.updateChangelog', logAppend: 'wf.logAppend' }

async function main() {
  console.log('更新能力委托门禁（#875+#880：旧实现已删 + 接线只走包 + 版本一致）')

  // ---- 0) 版本一致 ----
  const pj = JSON.parse(read('package.json'))
  const expectedRange = pj.dependencies && pj.dependencies['dsh-plugin-update']
  check(typeof expectedRange === 'string' && /^\^0\.\d+\.\d+$/.test(expectedRange), '清单依赖更新包是 0.x 范围（实际 ' + expectedRange + '）')
  const pubPj = JSON.parse(read('package/package.json'))
  check(pubPj.dependencies && pubPj.dependencies['dsh-plugin-update'] === expectedRange, '发布清单依赖与根清单同范围（' + expectedRange + '）')
  const installed = JSON.parse(read('node_modules/dsh-plugin-update/package.json')).version
  const rangeMatch = (expectedRange.match(/^\^0\.(\d+)\.(\d+)$/) || [])
  const rangeMinor = rangeMatch[1]
  const rangePatch = rangeMatch[2]
  const instMatch = (String(installed).match(/^0\.(\d+)\.(\d+)$/) || [])
  // 同代 = 同 minor；补丁号只许比范围新不许比它旧（caret 范围本来就这么允，锁版本只会往前进）。
  // 上一版这里把范围的补丁写死成 .0，补丁一升级（0.17.0→0.17.1）门禁自己先红，与被测行为无关。
  check(typeof rangeMinor === 'string' && instMatch[1] === rangeMinor && Number(instMatch[2]) >= Number(rangePatch), '已安装更新包与清单范围同代（范围 ' + expectedRange + '，实际 ' + installed + '）')
  const lock = read('pnpm-lock.yaml')
  check(lock.includes('dsh-plugin-update@' + installed), '锁文件含已安装版本 ' + installed)
  check(!lock.includes('packages/dsh-plugin-update:'), '锁文件无本地旧包登记')
  const workspace = read('pnpm-workspace.yaml')
  check(workspace.includes('dsh-plugin-update@' + installed), '工作区放行名单含当前版本（未过观察期需放行）')
  check(!workspace.includes('dsh-plugin-update@0.1.') && !workspace.includes('dsh-plugin-update@0.2.'), '工作区放行名单无旧版本幽灵条目')
  const derivedHead = read('scripts/generated/updateClient.derived.js').split('\n').slice(0, 5).join('\n')
  check(derivedHead.includes(installed), '派生文件头版本号与已安装版本一致')

  // ---- 1) 旧实现已删 ----
  for (const rel of GONE) check(!exists(rel), '旧文件已删：' + rel)
  const chain = pj.scripts.verify
  for (const name of ['verify-update-freshness', 'verify-update-regression', 'verify-update-routes', 'verify-update-install']) {
    check(!chain.includes(name), '退役门禁已移除出校验链：' + name)
  }

  // ---- 2) 接线只走包 ----
  const pkg = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'host.js')).href)
  const holder = pkg.createHostUpdate({ ctx: null, logCtx: null }, { pluginId: 'dsh-mattpocock-skills-deck', prefix: 'wf' })
  check(JSON.stringify(holder.phoneNames) === JSON.stringify(PHONE_NAMES), '五个电话名从包读出且与旧字面一致（0.17 新增 wf.logAppend）')
  const wired = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'updateFromPackage.js')).href)
  const handlers = wired.createUpdatePhoneHandlers({ ctx: null, logCtx: null })
  check(typeof handlers.handleLogAppend === 'function', '宿主接线暴露第五个电话 handleLogAppend（只按键从包处理器表里取，不另拼名）')

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁异常：' + ((e && e.message) || e)); process.exit(1) })
