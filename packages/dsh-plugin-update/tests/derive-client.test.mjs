// packages/dsh-plugin-update/tests/derive-client.test.mjs —— 集成工具自查（#586 方案 A）。
//
// 这个工具是给「第二个插件照文档三步接入」用的参考实现，所以它自己必须先被验过：
//   1) 真的能跑起来，生成出文件；
//   2) 生成的文件真的能当模块用，导出的四个常量取值正确（前缀写它自己的，不是 wf）；
//   3) 前缀换个值，取值跟着换（证明取值只有一个来源，不是写死的）；
//   4) 参数不对时明确报错，不静默生成一个错文件（尤其 --out 与 --prefix 必填）；
//   5) 生成内容里不留下模块级的 export 块（那个块拼进插件闭包会变语法错误）。
//
// 用法：node --test packages/dsh-plugin-update/tests/derive-client.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(PKG_DIR, 'derive-client-values.mjs')
const MANIFEST = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
// 生成物写在包内 tests/.tmp/ 下：路径确定、与外层仓库同级，避免依赖系统临时目录
// （用过 os.tmpdir()，在非 ASCII 用户名的 Windows 上出现过「文件已生成但 import 找不到」的怪象）。
const TMP_ROOT = join(PKG_DIR, 'tests', '.tmp')

function runTool(args, options = {}) {
  try {
    return execFileSync(process.execPath, [TOOL].concat(args), { encoding: 'utf8', ...options })
  } catch (error) {
    // 把子进程的话带出来，否则只看到 execFileSync 的报错，不知道工具说了什么
    throw new Error('工具执行失败：args=' + JSON.stringify(args) +
      ' status=' + error.status +
      ' stdout=' + JSON.stringify(String(error.stdout || '').slice(0, 300)) +
      ' stderr=' + JSON.stringify(String(error.stderr || '').slice(0, 500)))
  }
}

let tmpSeq = 0
function withTempDir(run) {
  tmpSeq += 1
  const dir = join(TMP_ROOT, 'case-' + tmpSeq)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const result = run(dir)
    if (result && typeof result.then === 'function') {
      // 异步用例：等它跑完再清理，否则文件可能在断点前就被删了
      return result.finally(() => rmSync(dir, { recursive: true, force: true }))
    }
    rmSync(dir, { recursive: true, force: true })
    return result
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

/** 从生成的文件里取导出值（用真模块加载，不用正则猜）。 */
async function loadDerived(file) {
  return await import(pathToFileURL(file).href + '?t=' + Date.now())
}

test('生成的文件能当模块用，取值随传入的前缀', async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, 'derived.mjs')
    runTool(['--prefix', 'notes', '--out', out, '--package', 'my-notes-plugin'])
    const mod = await loadDerived(out)
    assert.equal(mod.UPD_STATUS, 'notes.updateStatus')
    assert.equal(mod.UPD_CHECK, 'notes.updateCheck')
    assert.equal(mod.UPD_INSTALL, 'notes.updateInstall')
    assert.equal(mod.UPD_POLL, 1000)
    assert.equal(mod.UPD_POLL_MIN, 250)
  })
})

test('换个前缀取值跟着换（取值只有一个来源，不是写死的）', async () => {
  await withTempDir(async (dir) => {
    const a = join(dir, 'a.mjs')
    const b = join(dir, 'b.mjs')
    const outA = runTool(['--prefix', 'notes', '--out', a])
    const outB = runTool(['--prefix', 'other', '--out', b])
    assert.ok(existsSync(a), 'a.mjs 应已生成；工具输出=' + JSON.stringify(outA) + ' 目录=' + dir)
    assert.ok(existsSync(b), 'b.mjs 应已生成；工具输出=' + JSON.stringify(outB) + ' 目录=' + dir)
    const [modA, modB] = [await loadDerived(a), await loadDerived(b)]
    assert.equal(modA.UPD_STATUS, 'notes.updateStatus')
    assert.equal(modB.UPD_STATUS, 'other.updateStatus')
    assert.notEqual(modA.UPD_STATUS, modB.UPD_STATUS)
  })
})

test('封面注释带生成来源与版本，便于以后认账', async () => {
  await withTempDir((dir) => {
    const out = join(dir, 'derived.mjs')
    runTool(['--prefix', 'notes', '--out', out, '--package', 'my-notes-plugin'])
    const text = readFileSync(out, 'utf8')
    assert.match(text, new RegExp(MANIFEST.name + '@' + MANIFEST.version.replace(/\./g, '\\.')))
    assert.match(text, /--prefix notes/)
    assert.match(text, /my-notes-plugin/)
  })
})

test('生成内容里没有模块级 export 块（拼进插件闭包不会变语法错误）', async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, 'derived.mjs')
    runTool(['--prefix', 'notes', '--out', out])
    const text = readFileSync(out, 'utf8')
    assert.equal(/export\s*\{/.test(text), false, '不应出现 export { ... } 块')
    // 逐条 export const 是可以的（拼进闭包前会被去掉行首 export）
    assert.match(text, /export const UPD_STATUS/)
  })
})

test('--out 必填：不给就报错，不往别处写', () => {
  assert.throws(() => runTool(['--prefix', 'notes'], { stdio: 'pipe' }), /--out/)
})

test('--prefix 必填：不给就报错', () => {
  assert.throws(() => runTool(['--out', 'x.mjs'], { stdio: 'pipe' }), /--prefix/)
})

test('前缀含点或非法字符时拦下（点留作前缀与动作名的分隔符）', () => {
  assert.throws(() => runTool(['--prefix', 'my.notes', '--out', 'x.mjs'], { stdio: 'pipe' }), /不能含点/)
  assert.throws(() => runTool(['--prefix', 'my notes', '--out', 'x.mjs'], { stdio: 'pipe' }), /只允许/)
})

test('--dry-run 只打印不写文件', async () => {
  await withTempDir((dir) => {
    const out = join(dir, 'never-written.mjs')
    const printed = runTool(['--prefix', 'notes', '--out', out, '--dry-run'])
    assert.match(printed, /export const UPD_STATUS/)
    assert.throws(() => readFileSync(out, 'utf8'), /ENOENT/)
  })
})

test('工具自身随包发布（files 白名单含它），否则消费方拿不到', () => {
  assert.ok(MANIFEST.files.includes('derive-client-values.mjs'), 'package.json#files 应包含 derive-client-values.mjs')
})

test('包内不自带 esbuild：工具从消费方仓库借，不把构建依赖塞进运行期依赖', () => {
  assert.equal(MANIFEST.dependencies, undefined, '运行期依赖应为空（零运行时依赖）')
})

// 与本仓当前插件的派生结果对齐：同一套取值真源，两处派生出同样的常量名与默认值。
test('与本仓当前插件派生的取值同源（同样四个常量名、同样默认值）', () => {
  const pluginDerived = readFileSync(resolve(PKG_DIR, '..', '..', 'scripts', 'generated', 'updateClient.derived.js'), 'utf8')
  for (const name of ['UPD_STATUS', 'UPD_CHECK', 'UPD_INSTALL', 'UPD_POLL']) {
    assert.match(pluginDerived, new RegExp('export const ' + name + ' '), '本仓派生文件应有 ' + name)
  }
  assert.match(pluginDerived, /CLIENT_POLL\.defaultMs/, '本仓派生文件的轮询间隔也应取自 CLIENT_POLL')
})
