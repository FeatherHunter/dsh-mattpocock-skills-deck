// verify-config-store-package.js — 发布包 YAML 门禁（#1012 落地）
// 规则（维护者拍板：发布包要真的拿得到 YAML 解析，三者对齐，用门禁钉住）：
//   P1 仓库 package.json 的生产依赖里有 yaml，发布包 package/package.json 的生产依赖里也有，
//      主版本号一致；两份文件的版本号都没动（本票不发版）。
//   P2 装好的包里能解析：node_modules/yaml 可加载，且用它能解析一份 YAML。
//   P3 核产物随包发布：package/package.json 的 files 白名单含 shared（产物能进包）。
//   P4 宿主适配器可加载：src/host/configStore.js 能 import，六个冻结函数都在。
// 用法：node tests/verify-config-store-package.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg, detail) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : '')))
  if (!ok) failed = true
}

async function main() {
  console.log('发布包 YAML 门禁（#1012：装好的包里能解析）')

  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const shipPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package', 'package.json'), 'utf8'))

  // —— P1：两份依赖对齐 ——
  const rootYaml = (rootPkg.dependencies || {}).yaml
  const shipYaml = (shipPkg.dependencies || {}).yaml
  check(typeof rootYaml === 'string' && rootYaml, '仓库 package.json 生产依赖里有 yaml', rootYaml)
  check(typeof shipYaml === 'string' && shipYaml, '发布包 package.json 生产依赖里有 yaml', shipYaml)
  const majorOf = (s) => String(s || '').replace(/^[\^~>=< ]+/, '').split('.')[0]
  check(!!rootYaml && !!shipYaml && majorOf(rootYaml) === majorOf(shipYaml), '两处 yaml 主版本一致（' + rootYaml + ' / ' + shipYaml + '）', '')
  check(rootPkg.version === '1.8.0-rc.7' && shipPkg.version === '1.8.0-rc.7', '两份版本号都没动（本票不发版）', rootPkg.version + ' / ' + shipPkg.version)

  // —— P2：装好的包里能解析 ——
  try {
    const yaml = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'yaml', 'index.js')).href).catch(() => null)
    const mod = yaml || require('yaml')
    const parsed = mod.parse('version: 2\nbackendId: github\n')
    check(parsed && parsed.backendId === 'github', '装好的 yaml 能解析', JSON.stringify(parsed))
  } catch (e) {
    check(false, '装好的 yaml 能解析：' + (e && e.message))
  }

  // —— P3：产物随包发布 ——
  const files = shipPkg.files || []
  check(files.indexOf('shared') >= 0, '发布包 files 白名单含 shared（核产物能进包）', JSON.stringify(files))
  check(fs.existsSync(path.join(ROOT, 'src', 'shared', 'config-store', 'config-store.js')), '核产物在 shared 下已生成', '')
  check(fs.existsSync(path.join(ROOT, 'src', 'host', 'configStore.js')), '宿主适配器在', '')

  // —— P4：适配器可加载，六个冻结函数都在 ——
  try {
    const adapter = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.js')).href)
    for (const name of ['readWorkspaceConfig', 'writeWorkspaceConfig', 'readLocalSettings', 'writeLocalSettings', 'readLabelColors', 'writeLabelColors']) {
      check(typeof adapter[name] === 'function', '冻结函数在：' + name)
    }
  } catch (e) {
    check(false, '宿主适配器可加载：' + (e && e.message))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 发布包 YAML 门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
