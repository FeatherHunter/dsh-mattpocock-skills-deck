/**
 * platform/index.js — 平台抽象层（次缝）接口。
 *
 * ⌈ 占位 ⌉ 实现归子图「定稿平台抽象层（全 deck OS 可插拔）」（#113）。本 MAP 只确立结构：
 * 接口 + 每 OS 一个子目录（darwin/ win32/ linux/），后端访问 OS 只经本层，
 * 从而结构性消灭「getHome 只认 Windows」「路径硬编码反斜杠」（#110 / PR #106）这类 bug。
 *
 * 第一性原理：**静态 import + `process.platform` 查表**，绝不用变量路径动态 import
 * （那会让 esbuild 无法静态分析、打包产物缺文件）。
 */

import darwin from './darwin/index.js'
import win32 from './win32/index.js'
import linux from './linux/index.js'

export const OS_KINDS = Object.freeze({ DARWIN: 'darwin', WIN32: 'win32', LINUX: 'linux' })

/** 平台实现注册表（静态 import，运行时按 platform 查表）。 */
const REGISTRY = Object.freeze({ darwin, win32, linux })

/**
 * 平台抽象接口（各 OS 子目录实现）。
 * @typedef {Object} Platform
 * @property {() => string} os
 * @property {(name: string) => string|undefined} env  getHome / HOME 优先级（#110 根治点）
 * @property {{ join: (...p: string[]) => string }} path
 * @property {Object} fs  DSH 沙箱文件系统（读穿透、写有栅栏）
 * @property {(bin: string) => Promise<string|null>} resolveExecutable
 */

/**
 * 按 `process.platform` 选取对应 OS 实现并返回。
 * @param {Object} ctx
 * @returns {Promise<Platform>}
 */
export async function createPlatform(ctx) {
  const os = (process && process.platform) || OS_KINDS.WIN32
  const impl = REGISTRY[os]
  if (!impl) throw new Error('platform unsupported: ' + os)
  return impl(ctx)
}

export default createPlatform
