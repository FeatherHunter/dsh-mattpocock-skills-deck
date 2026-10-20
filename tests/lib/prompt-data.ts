/**
 * tests/lib/prompt-data.ts —— 门禁要拼客户端闭包、或直接 import 提示词数据时，先确保生成物在盘上（#1292 立）。
 *
 * 为什么需要这个文件
 *   #1292 把提示词正文的真源从 src/client/kernel/prompts.ts 搬到了 config/prompts/ 下的 YAML，
 *   客户端闭包里那三个运行时数据名（PROMPT_TEMPLATE_DATA / PROMPT_FRAGMENT_DATA / LANGUAGES_YAML）
 *   改由生成物 src/client/kernel/prompt-data.ts 提供。生成物不入库（同 src/shared/time-config 的先例），
 *   干净检出时盘上没有它；而门禁有两种吃法，两种都依赖它先在：
 *     · 沙箱求值：把生成物拼在 prompts.js 前面一起求值，顺序与 scripts/build.mts 的 KERNEL_MODULES 一致
 *       （promptData → prompts → promptsSetup → promptsBackend）；缺了它，prompts.js 一求值就
 *       ReferenceError，整扇门禁一条断言都跑不到。
 *     · 直接 import：先把生成物的三个名字挂到 globalThis，再 import prompts.ts（它的数据名是
 *       「闭包由构建提供」的 declare，单独 import 时并不存在）。
 *   这件事原先在五份门禁里各写了一遍（verify-655 / 665 / 685 / 686 / setup-describe），改生成方式要改五处，
 *   漏一处就会在干净检出上红。收在这里之后，门禁只从这一个入口取。
 *
 * 两个入口
 *   ensurePromptData(root?)        生成物在不在；不在就跑一次同一个生成器，返回仓库相对路径
 *   promptDataSpliceable(root?)    取「可以直接拼进沙箱」的那段文本（与构建同一份转译口径）
 *
 * 不负责的事：生成物里的内容对不对（键齐不齐、正文一字不差、use 有没有混进来）是
 *   tests/verify-prompt-config.ts 的事，这里只管「它在不在」。生成器自己也是唯一真源：
 *   这里只调用 scripts/generate-prompt-config.mts，不另写一遍读 YAML 的逻辑。
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// tests/lib/ → 仓库根。调用方传 root 时以调用方为准（有几份门禁自己算了一份 root）。
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..')
const PROMPT_DATA_REL = path.join('src', 'client', 'kernel', 'prompt-data.ts')

/**
 * 生成物在不在；不在就跑一次生成器。
 *
 * 为什么允许「现场生成」而不是直接判红：生成物是构建期产物，干净检出（或刚清过仓库内临时产物）时
 * 本来就不该有；门禁要验的是「生成物与 YAML 对得上」以后的行为，不是「你有没有先跑过构建」。
 * 这与 scripts/build.mts 的做法一致：构建期也是先生成再拼装。
 */
function ensurePromptData(root?: string): string {
  const base = root ? path.resolve(root) : DEFAULT_ROOT
  const abs = path.join(base, PROMPT_DATA_REL)
  if (!fs.existsSync(abs)) {
    const r = spawnSync(process.execPath, [path.join(base, 'scripts', 'generate-prompt-config.mts')], { encoding: 'utf8' })
    if (r.status !== 0) {
      throw new Error('提示词数据生成失败（config/prompts/ 下的 YAML → src/client/kernel/prompt-data.ts）：先跑 node scripts/generate-prompt-config.mts 把生成物做出来。\n' + String(r.stdout || '') + String(r.stderr || ''))
    }
  }
  return PROMPT_DATA_REL
}

/**
 * 取「能直接拼进沙箱」的生成物文本：走 tests/lib/source-text.ts 的 spliceableJs，
 * 与构建同一份转译口径（行首 export 已去掉），不要在这里另写转译参数。
 */
function promptDataSpliceable(root?: string): string {
  const { spliceableJs } = require('./source-text.ts')
  return spliceableJs(ensurePromptData(root))
}

module.exports = { ensurePromptData, promptDataSpliceable, PROMPT_DATA_REL }
