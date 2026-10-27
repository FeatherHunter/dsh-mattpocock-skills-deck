// verify-config-store-package.ts — 发布包 YAML 门禁（#1012 落地）
// 2026-10-17 从 .js 转成 TypeScript：只改文件名、用法这行与几处类型标注，判据与断言一条没动。
// 规则（维护者拍板：发布包要真的拿得到 YAML 解析，三者对齐，用门禁钉住）：
//   P1 仓库 package.json 的生产依赖里有 yaml，发布包 package/package.json 的生产依赖里也有，
//      主版本号一致；两份文件的版本号一致且为当前候选版（发版推进时同步改这里的两处字面）。
//   P2 装好的包里能解析：node_modules/yaml 可加载，且用它能解析一份 YAML。
//   P3 核产物随包发布：package/package.json 的 files 白名单含 shared（产物能进包）。
//   P4 宿主适配器可加载：src/host/configStore.ts 能 import，八个冻结函数都在（两个文本出入口 + 六个文件读写）。
//      （2026-10-18 #1247：真源转成 TypeScript，路径跟到 .ts；import 走文件 URL，
//       本仓 Node 下限原生剥类型，直读 .ts 与原来读 .js 语义一致。）
// 用法：node --import ./scripts/ts-hook.mts tests/verify-config-store-package.ts（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok: boolean, msg: string, detail?: unknown) => {
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
  const majorOf = (s: unknown) => String(s || '').replace(/^[\^~>=< ]+/, '').split('.')[0]
  check(!!rootYaml && !!shipYaml && majorOf(rootYaml) === majorOf(shipYaml), '两处 yaml 主版本一致（' + rootYaml + ' / ' + shipYaml + '）', '')
  check(rootPkg.version === '1.9.0-beta.28' && shipPkg.version === '1.9.0-beta.28', '两份版本号一致且为当前候选版', rootPkg.version + ' / ' + shipPkg.version)

  // —— P2：装好的包里能解析 ——
  try {
    const yaml = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'yaml', 'index.js')).href).catch(() => null)
    const mod = yaml || require('yaml')
    const parsed = mod.parse('version: 2\nbackendId: github\n')
    check(parsed && parsed.backendId === 'github', '装好的 yaml 能解析', JSON.stringify(parsed))
  } catch (e: any) {
    check(false, '装好的 yaml 能解析：' + (e && e.message))
  }

  // —— P3：产物随包发布 ——
  const files = shipPkg.files || []
  check(files.indexOf('shared') >= 0, '发布包 files 白名单含 shared（核产物能进包）', JSON.stringify(files))
  for (const name of ['ports.js', 'workspace.js', 'settings.js', 'labels.js']) {
    check(fs.existsSync(path.join(ROOT, '.build', 'shared', 'config-store', name)), '核产物在 .build/shared/config-store/ 下已生成：' + name, '')
  }
  // 老单体产物（config-store.js）在源码树和产物位都不该存在——两处一起查，才不管它想住哪。
  check(!fs.existsSync(path.join(ROOT, '.build', 'shared', 'config-store', 'config-store.js')), '老单体产物已拆掉（不留双份实现）', '')
  check(fs.existsSync(path.join(ROOT, 'src', 'host', 'configStore.ts')), '宿主适配器在', '')

  // —— P4：适配器可加载，冻结函数都在（文本出入口两个 + 文件读写六个） ——
  try {
    const adapter = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'configStore.ts')).href)
    for (const name of ['parseConfig', 'stringifyConfig', 'readWorkspaceConfig', 'writeWorkspaceConfig', 'readLocalSettings', 'writeLocalSettings', 'readLabelColors', 'writeLabelColors']) {
      check(typeof adapter[name] === 'function', '冻结函数在：' + name)
    }
  } catch (e: any) {
    check(false, '宿主适配器可加载：' + (e && e.message))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 发布包 YAML 门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
