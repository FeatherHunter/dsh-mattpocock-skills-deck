// src/deck/rules/workspace-file.ts —— 工作区配置文件：文本 ⇄ 人选后端（纯规则侧）
//
// 本文件由 src/deck/shell/workspace-anchor.ts 拆出（#1039 按 #1038 定版：翻译劈半，
// 字符串两段归纯侧、读文件动作留宿主侧；契约的原文也说「本文件只做字符串：不碰 fs / 平台 / 注册表」）。
//
// 拆法：这里只做「一段文本 → 人选后端候选」与「人选 → 一段文本」两件事，两处要用到的
// 编解码器（核里的 YAML 解析与拼装）由形参注入 —— 纯规则不 import 任何别的目录，
// 谁把核接进来是宿主侧的事（见 src/deck/shell/workspace-anchor.ts）。
//
// 只认人亲手选的：历史上 `source` 不是 `user` 的一律不认（派生结论不许钉成意图）；切核后新增
// `migrated`（迁移来的）与 `detected`（生成来的），`auto` 只在读老文件时认（历史文件里有），
// 新文件不再产出。
//
// 纯在哪：受形参里的编解码器之外，不取会话、不起进程、不读写文件、不读钟。

/**
 * 核（src/shared/config-store/workspace.ts）里的解码结果：只有 `ok:true` 且**只读**时才谈得上
 * 「这段文本写了什么」；`value` 是解出来的字段表（形状由解码器保证，这里仍当未知值收口）。
 */
export interface WorkspaceDecodeResult {
  ok: boolean
  readonly?: boolean
  value?: unknown
  message?: string
}

/** 核里的编码结果：编码器自己说不行时（形状不对、版本高了）带上原话。 */
export interface WorkspaceEncodeResult {
  ok: boolean
  text?: string
  message?: string
}

/**
 * 要写出去的四个字段在喂给编解码器之前先在这里收口成定型的值。
 * 为什么单独有一层：核的编码器签名要的是「版本是数字、后端 id 是字符串」这种定型输入，
 * 而调用方给的是运行时值（形状不可信）。在这里一次判完，后面拼字段时不必再逐处判。
 */
export interface WorkspaceEncodeFields {
  version: number
  backendId: unknown
  pickedAt: unknown
  source: unknown
  layout?: unknown
}

/**
 * 契约层要的编解码形状（由宿主侧把核接进来，纯侧只照着它调）：
 *   parse  一段文本 → 字段表；坏文本、高版本这些情况由核如实回 `ok:false` 或 `readonly:true`；
 *   encode 字段表 → 一段文本。
 * 两份入参都用「能放进去的那个字段表」而不是 `any`：纯侧要一眼看出自己喂了哪几个键。
 */
export interface WorkspaceCodec {
  parse(text: string): WorkspaceDecodeResult
  encode(fields: WorkspaceEncodeFields): WorkspaceEncodeResult
}

/** 读出来的「工作区这一层」：后端 id、档案时间、来源，有布局才带布局。 */
export interface WorkspaceChoice {
  backendId: string
  pickedAt: number
  source?: unknown
  layout?: string
}

/** 写进去的人选：只装版本、后端、档案时间、来源、布局；路径、令牌、登录态一概不装。 */
export interface WorkspaceChoiceInput {
  version?: unknown
  backendId?: unknown
  pickedAt?: unknown
  source?: unknown
  layout?: unknown
}

/**
 * 写文件时的默认版本。注意：这个字面量与核里的 `WORKSPACE_KNOWN_VERSION` 今天是同一个数（2），
 * 但它不是「从核抄来的常量」—— 它是纯侧对「写出去的那份文件长什么样」这条协议的自述。
 * 真实运行的默认值由宿主侧传进来（那儿从核取值），这样协议升版时改一处、两边不会漂。
 */
export const WORKSPACE_FILE_PROTOCOL_VERSION = 2

/** 读老文件时照认（历史文件里有）；新文件不再产出 auto（机器的猜不许钉成意图）。 */
export const WORKSPACE_FILE_SOURCE_AUTO = 'auto'

/** 拿不准是不是字符串时统一收口成字符串：不是字符串就当空串（调用方各自判空）。 */
function str(v: unknown): string {
  return (typeof v === 'string') ? v : ''
}

/** 按名字取一个未知对象的字段（形状不可信时先收口成对象再读）。 */
function obj(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object') ? v as Record<string, unknown> : {}
}

/** 有限数字才算数（`pickedAt` 是档案时间：NaN、Infinity、字符串都不算）。 */
function finiteNumber(v: unknown): boolean {
  return (typeof v === 'number' && Number.isFinite(v))
}

/**
 * 一段工作区文件文本 → 人选后端候选。形状不对一律 null（调用方按「没有这层」继续往下走，不报错）。
 *
 * 老 JSON（v1 四字段）与新 YAML（v2）都认：JSON 是 YAML 的子集，直接可读。
 * 版本高于认识的也按 null 回（旧版本读不懂新字段，只能当没有这层，往声明与记忆回落；
 * 要读新内容请调核，核会标只读）。坏文本同样回 null，把「解析器抛错」也收进同一档。
 * 已知性（注册表认不认得这个 id）不在这里判：调用方手里有注册表，各自按既有形状核验。
 */
export function parseWorkspaceFile(text: string, codec: WorkspaceCodec): WorkspaceChoice | null {
  let parsed: WorkspaceDecodeResult | null = null
  try {
    parsed = codec.parse(text)
  } catch (e) {
    return null
  }
  if (!parsed || parsed.ok !== true || parsed.readonly === true) return null
  const v = obj(parsed.value)
  const backendId = (typeof v.backendId === 'string') ? v.backendId.trim() : ''
  if (!backendId) return null
  if (!finiteNumber(v.pickedAt)) return null
  const out: WorkspaceChoice = { backendId: backendId, pickedAt: v.pickedAt as number, source: v.source }
  if (typeof v.layout === 'string' && v.layout) out.layout = v.layout
  return out
}

/**
 * 人选 → 落盘文本（一律新格式 v2 YAML，注释由程序生成）。
 * 只装：版本、后端、档案时间、来源、有布局才加布局；不装路径、令牌、登录态。
 * version 缺席默认 `defaultVersion`（宿主侧从核取当前版）；pickedAt 缺席沿旧例默认 0；
 * `source` 缺席默认人选。
 * 写不出（形状不对、高版本）直接抛错，由调用方的 try 接住并如实回报，不静默。
 */
export function stringifyWorkspaceFile(
  input: WorkspaceChoiceInput,
  codec: WorkspaceCodec,
  defaultVersion: number,
  defaultSource: unknown,
): string {
  const src = (input && typeof input === 'object') ? input : {}
  // 版本这一格按「数字才算数」收口：给的不是数字（或干脆没给）就用调用方传进来的当前版，
  // 这样编码器第二步那道「版本必须是 1 或 2」的校验永远不会被一个字符串之类的东西顶掉。
  const version = (typeof src.version === 'number' && Number.isFinite(src.version)) ? src.version : defaultVersion
  const made = codec.encode({
    version: version,
    backendId: (typeof src.backendId === 'string') ? src.backendId.trim() : src.backendId,
    pickedAt: finiteNumber(src.pickedAt) ? src.pickedAt : 0,
    source: (src.source === undefined || src.source === null) ? defaultSource : src.source,
    layout: src.layout,
  })
  if (!made.ok) throw new Error(str(made.message))
  return str(made.text)
}
