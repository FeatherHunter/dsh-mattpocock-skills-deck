// src/deck/shell/workspace-anchor.ts —— 工作区配置文件（宿主侧门面：把核接进来）
//
// 本件在 #1039 拆层后只剩三件事：
//   一、把核（src/shared/config-store/workspace.ts）的编解码器接给纯规则侧；
//   二、把路径、版本、来源这几枚常量的**取值**留在这里（它们是对外契约的一部分，
//       调用方照旧从这里 import，行为与拆分前逐字相同）；
//   三、把纯侧的两个翻译函数转发出去。
//
// 为什么翻译本体要搬去纯侧：那两段代码只做字符串 ⇄ 字段表的换算，不碰文件、不碰平台、不碰注册表
// ——「一段文本写了什么」与「谁去读这段文本」是两件事。拆开以后，前半段可以拿字符串直接测，
// 不必造一个真的工作区目录。
//
// 同层引用核是门禁基线里记名的一条例外（理由与归属见 tests/same-layer-baseline.json）：
// 垫片不调核就得另写一份 YAML 解析，那就真成两套实现，违背 #1012 的首要交付。
// 本文件只做字符串：不碰 fs / 平台 / 注册表；读文件与「后端认不认得」由调用方做。
// 只认人亲手选的：历史上 source 不是 'user' 的一律不认（派生结论不许钉成意图，
// 与选择记忆 H 同一条铁律）；切核后新增 migrated（迁移来的）与 detected（生成来的），
// auto 只在读老文件时认（历史文件里有），新文件不再产出。
import {
  parseWorkspaceText,
  stringifyWorkspace,
  WORKSPACE_YAML_REL,
  WORKSPACE_JSON_REL,
  WORKSPACE_KNOWN_VERSION,
} from '../../shared/config-store/src/workspace.js'
import {
  parseWorkspaceFile as parseWith,
  stringifyWorkspaceFile as stringifyWith,
} from '../rules/workspace-file.js'
import type { WorkspaceChoice, WorkspaceChoiceInput, WorkspaceCodec } from '../rules/workspace-file.js'

export type { WorkspaceChoice, WorkspaceChoiceInput } from '../rules/workspace-file.js'

export const WORKSPACE_FILE_REL = WORKSPACE_YAML_REL
/** 老文件位置：只做兼容读（读到就由调用方的迁移逻辑搬走），新写入一律走新路径。 */
export const WORKSPACE_FILE_LEGACY_REL = WORKSPACE_JSON_REL
export const WORKSPACE_FILE_VERSION = WORKSPACE_KNOWN_VERSION
export const WORKSPACE_FILE_SOURCE = 'user'
export { WORKSPACE_FILE_SOURCE_AUTO } from '../rules/workspace-file.js'

/**
 * 核的编解码器：核里那两个函数今天都是宽松入参（吃 any、按运行时形状自己判），
 * 类型上按纯侧的契约收口一次即可 —— 这里是唯一一处「纯侧的类型」与「核的实现」对上号的地方。
 * 这一层校验不改变行为：形状不对时核自己会回 ok:false 或只读，与拆分前一样。
 */
const CODEC: WorkspaceCodec = {
  parse: (text) => parseWorkspaceText(text) as ReturnType<WorkspaceCodec['parse']>,
  encode: (fields) => stringifyWorkspace(fields) as ReturnType<WorkspaceCodec['encode']>,
}

/**
 * 工作区文件文本 → 人选后端候选。形状不对一律 null（调用方按「没有这层」继续往下走，不报错）。
 * 老 JSON（v1 四字段）与新 YAML（v2）都认：JSON 是 YAML 的子集，直接可读。
 * 版本高于认识的也按 null 回（旧版本读不懂新字段，只能当没有这层，往声明与记忆回落；
 * 要读新内容请调核，核会标只读）。
 * 已知性（注册表认不认得这个 id）不在这里判：调用方手里有注册表，各自按既有形状核验。
 */
export function parseWorkspaceFile(text: string): WorkspaceChoice | null {
  return parseWith(text, CODEC)
}

/**
 * 人选 → 落盘文本（一律新格式 v2 YAML，注释由程序生成）。
 * 只装：版本、后端、档案时间、来源、有布局才加布局；不装路径、令牌、登录态。
 * version 缺席默认当前版（从核取，不写死）；pickedAt 缺席沿旧例默认 0；source 缺席默认人选。
 * 写不出（形状不对、高版本）直接抛错，由调用方的 try 接住并如实回报，不静默。
 */
export function stringifyWorkspaceFile(input: WorkspaceChoiceInput): string {
  return stringifyWith(input, CODEC, WORKSPACE_KNOWN_VERSION, WORKSPACE_FILE_SOURCE)
}
