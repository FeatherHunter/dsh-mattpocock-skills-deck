#!/usr/bin/env node
/**
 * 构建包装：先调用仓库原有的构建脚本，再给客户端产物补上发布身份横幅。
 *
 * 为什么需要这一层：base 的 freeze 从客户端产物里读第一处 legal comment 横幅（感叹号开头），
 * 并要求它等于 package.json 的名称与版本；本插件的客户端产物里第一处这样的横幅
 * 来自内联的 dsh-featherhunter-plugin-base，于是 freeze 认错了包。构建脚本本身由
 * 本仓维护，但阶段 A 约定不改 scripts/**，所以把「补横幅」这一步放在 verify/ 里。
 *
 * 提交号也必须与冻结时的 HEAD 一致。构建缓存只按输入内容判断，缓存命中时产物里的
 * DSW_BUILD_COMMIT 可能仍是上一次构建的提交；这里先按正常方式构建，发现提交号不一致
 * 就用 --force 重建一次，而不是改写产物里的提交号冒充新构建。
 *
 * 用法（工作目录必须是 package/）：
 *   node ../verify/build.mjs --pkg-only
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const cwd = process.cwd()
const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
const clientPath = resolve(cwd, 'lib', 'client.js')
const args = process.argv.slice(2)

function runBuild(extra) {
  const result = spawnSync(process.execPath, [resolve(cwd, '..', 'scripts', 'build.mts'), ...args, ...extra], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) {
    console.error('[verify-build] 无法启动构建脚本：' + result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error('[verify-build] 构建失败，退出码 ' + String(result.status))
    process.exit(result.status === null ? 1 : result.status)
  }
}

function headCommit() {
  const fromEnv = String(process.env.DSW_BUILD_COMMIT || '').trim()
  if (/^[0-9a-f]{40}$/.test(fromEnv)) return fromEnv
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  const value = String((result && result.stdout) || '').trim()
  return /^[0-9a-f]{40}$/.test(value) ? value : null
}

function embeddedCommit(text) {
  const match = /DSW_BUILD_COMMIT\s*=\s*"([0-9a-f]{40})"/.exec(text)
  return match === null ? null : match[1]
}

runBuild([])
let text = readFileSync(clientPath, 'utf8')
const expectedCommit = headCommit()
const foundCommit = embeddedCommit(text)
if (expectedCommit !== null && foundCommit !== null && foundCommit !== expectedCommit) {
  console.log('[verify-build] 产物里的构建提交 ' + foundCommit + ' 与本次 HEAD ' + expectedCommit + ' 不一致，强制重建一次')
  runBuild(['--force'])
  text = readFileSync(clientPath, 'utf8')
}

const banner = '/*! ' + pkg.name + ' v' + pkg.version + ' */'
const firstBanner = /\/\*!\s*([^\s*]+)\s+v([^\s*]+)\s*\*\//.exec(text)
if (firstBanner === null || firstBanner[0].indexOf(pkg.name + ' v' + pkg.version) === -1) {
  if (!text.startsWith(banner + '\n')) {
    text = banner + '\n' + text
    writeFileSync(clientPath, text, 'utf8')
    console.log('[verify-build] 已在 lib/client.js 首行写入身份横幅：' + banner)
  }
} else {
  console.log('[verify-build] 身份横幅已存在：' + banner)
}
console.log('[verify-build] 构建提交 ' + String(embeddedCommit(text)) + '，包 ' + pkg.name + '@' + pkg.version)
