// verify-update-migration.js — 更新能力委托门禁（#586 起迁移门禁，#875 改为薄接线委托门禁，#880 收尾本地旧包与残留字面）
//
// 这道门禁回答一个问题：更新能力是不是全权委托给了已安装的更新包，
// 本仓还有没有自己的更新实现。规则：
//   0) 版本一致：根清单与发布清单用同一范围依赖更新包（当前 0.8 范围）；锁文件版本＝已安装版本＝派生文件头版本一致；
//      锁文件里不再有本地旧包的登记，工作区放行名单里不再有更新包条目。
//   1) 旧实现已删：旧三件套、旧派生目录、旧共享核心、update-core 源码树、本地旧包目录都不存在；
//      发布包里的旧共享残留也不存在；退役的四道旧门禁已从校验链移除。
//   2) 接线只走包：宿主接线按包名引用已安装包，不引用本地旧文件；四个电话名从包的 phoneNames 读；
//      宿主入口无旧实现回退分支；面板取值全部来自派生常量。
//   3) 无本地执行器：src 里不再出现旧核心的安装配方与执行器名字。
//   4) 日志事件无新增：更新侧唯一的自有常驻事件仍是装完身份证验明正身那一条。
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
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

const GONE = [
  'src/host/update.js', 'src/host/updateReader.js', 'src/host/updateStore.js',
  'src/host/updatePkg', 'src/shared/update', 'update-core',
  'packages/dsh-plugin-update', 'package/shared/update',
  'tests/verify-update-freshness.js', 'tests/verify-update-regression.js',
  'tests/verify-update-routes.js', 'tests/verify-update-install.js',
]
const PHONE_NAMES = { updateStatus: 'wf.updateStatus', updateCheck: 'wf.updateCheck', updateInstall: 'wf.updateInstall', updateChangelog: 'wf.updateChangelog' }

async function main() {
  console.log('更新能力委托门禁（#875+#880：旧实现已删 + 接线只走包 + 版本一致 + 残留清零）')

  // ---- 0) 版本一致 ----
  const pj = JSON.parse(read('package.json'))
  const expectedRange = pj.dependencies && pj.dependencies['dsh-plugin-update']
  check(typeof expectedRange === 'string' && /^\^0\.\d+\.0$/.test(expectedRange), '清单依赖更新包是 0.x 范围（实际 ' + expectedRange + '）')
  const pubPj = JSON.parse(read('package/package.json'))
  check(pubPj.dependencies && pubPj.dependencies['dsh-plugin-update'] === expectedRange, '发布清单依赖与根清单同范围（' + expectedRange + '）')
  const installed = JSON.parse(read('node_modules/dsh-plugin-update/package.json')).version
  const rangeMinor = (expectedRange.match(/^\^0\.(\d+)\.0$/) || [])[1]
  check(typeof rangeMinor === 'string' && new RegExp('^0\\.' + rangeMinor + '\\.\\d+$').test(installed), '已安装更新包与清单范围同代（范围 ' + expectedRange + '，实际 ' + installed + '）')
  const lock = read('pnpm-lock.yaml')
  check(lock.includes('dsh-plugin-update@' + installed), '锁文件含已安装版本 ' + installed)
  check(!lock.includes('packages/dsh-plugin-update:'), '锁文件无本地旧包登记')
  const workspace = read('pnpm-workspace.yaml')
  check(workspace.includes('dsh-plugin-update@' + installed), '工作区放行名单含当前版本（未过观察期需放行）')
  check(!workspace.includes('dsh-plugin-update@0.1.') && !workspace.includes('dsh-plugin-update@0.2.'), '工作区放行名单无旧版本幽灵条目')
  const derivedHead = read('scripts/generated/updateClient.derived.js').split('\n').slice(0, 5).join('\n')
  check(derivedHead.includes(installed), '派生文件头版本号与已安装版本一致')
  const deriveSrc = read('scripts/derive-update-from-package.mjs')
  check(!deriveSrc.includes('只做共存') && !deriveSrc.includes('另开票'), '派生注释无共存旧话')
  const agents = read('AGENTS.md')
  check(!agents.includes('packages/dsh-plugin-update'), '发布顺序文档不点名本地更新包')

  // ---- 1) 旧实现已删 ----
  for (const rel of GONE) check(!exists(rel), '旧文件已删：' + rel)
  const chain = pj.scripts.verify
  for (const name of ['verify-update-freshness', 'verify-update-regression', 'verify-update-routes', 'verify-update-install']) {
    check(!chain.includes(name), '退役门禁已移除出校验链：' + name)
  }

  // ---- 2) 接线只走包 ----
  const wiring = strip(read('src/host/updateFromPackage.js'))
  check(wiring.includes("from 'dsh-plugin-update'"), '接线按包名引用已安装包')
  for (const frag of ['./update.js', './updateReader.js', './updateStore.js', 'updatePkg', 'shared/update', 'update-core']) {
    check(!wiring.includes(frag), '接线不引用本地旧文件：' + frag)
  }
  const pkg = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'host.js')).href)
  const holder = pkg.createHostUpdate({ ctx: null, logCtx: null }, { pluginId: 'dsh-mattpocock-skills-deck', prefix: 'wf' })
  check(JSON.stringify(holder.phoneNames) === JSON.stringify(PHONE_NAMES), '四个电话名从包读出且与旧字面一致')
  const indexSrc = strip(read('src/host/index.js'))
  check(!indexSrc.includes("import('./update.js')"), '宿主入口无旧实现回退分支')
  for (const name of Object.values(PHONE_NAMES)) {
    check(indexSrc.includes("harness.handle('" + name + "'"), '宿主注册电话 ' + name)
  }

  // ---- 3) 无本地执行器 ----
  const walk = (dir, out) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full, out) }
      else if (name.endsWith('.js')) out.push(full)
    }
    return out
  }
  let execHits = []
  for (const full of walk(path.join(ROOT, 'src'), [])) {
    const src = strip(fs.readFileSync(full, 'utf8'))
    if (/\binstallRecipe\b|\bcreateUpdateExecutor\b|\bcreateUpdateDiskPorts\b/.test(src)) execHits.push(path.relative(ROOT, full))
  }
  check(execHits.length === 0, 'src 里无本地安装配方与执行器' + (execHits.length ? '（命中 ' + execHits.join('、') + '）' : ''))

  // ---- 4) 日志事件无新增 ----
  const evtHits = []
  for (const full of walk(path.join(ROOT, 'src'), [])) {
    const src = strip(fs.readFileSync(full, 'utf8'))
    const m = src.match(/'update\.install\.[A-Za-z]+'/g) || []
    for (const e of m) if (e !== "'update.install.manifestSync'") evtHits.push(path.relative(ROOT, full) + ':' + e)
  }
  check(evtHits.length === 0, '更新侧自有常驻事件仅身份证验明正身一条' + (evtHits.length ? '（多出 ' + evtHits.join('、') + '）' : ''))

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁异常：' + ((e && e.message) || e)); process.exit(1) })
