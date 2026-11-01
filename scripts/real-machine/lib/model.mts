// model.mts —— 批次实例的模型配置与凭据注入：让真机测试实例默认使用 MiniMax CN。
//
// 这个文件只做三件事：
//   1. 把「用哪个模型、密钥从哪个环境变量读」写成一份选择（带环境变量覆盖）；
//   2. 把这份选择写进批次 home 里复制出来的 profile（只改 `agent-default-model` 与 `llm-pi-ai` 两条，别的不动）；
//   3. 从批次 home、真实 home 的 `.credentials.yaml` 或当前进程环境里找密钥值，交给启动器注入子进程。
//
// 安全边界：密钥值只允许停留在本文件的返回值与子进程环境里。任何回执、日志、instance.json、
// 计划模式输出都不带值，只带变量名与来源。真实 home 只读，不写。
// 另外，profile 的 `cordis.patch.yml` 是 YAML 数组，元素形如 `{id, name, config}`；写回时会用
// `yaml.stringify` 重新序列化，因此原文件里这一份 profile 的注释不会保留。批次 home 本来就是一次性副本，
// 这个代价可以接受；不想自动写时，调用方传 `model: false`。

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'
import { realDshHome } from './paths.mts'
import { ensureDir, exists, isDir, writeText } from './util.mts'

/** 一条模型选择：默认模型是 MiniMax CN 的 Minimax-M3.1-Flash，与桌面 profile 里的样板一致。 */
export interface ModelSelection {
  /** DSH 的 provider 名字，例如 minimax-cn。 */
  provider: string
  /** provider 下的模型 id，例如 Minimax-M3.1-Flash。 */
  model: string
  /** 从这个环境变量读密钥值；变量名会写进 profile 的 apiKeyEnv。 */
  apiKeyEnv: string
  /** 模型上下文窗口，写进 llm-pi-ai 的模型条目。 */
  contextWindow: number
  /** 单次最多生成多少 token，写进 llm-pi-ai 的模型条目。 */
  maxTokens: number
  /** 模型接受的输入类型；桌面样板是文本加图片。 */
  input: string[]
}

/** 默认选择：不使用 deepseek-account 的登录态，而是用 API key 直连 MiniMax CN。 */
export const DEFAULT_MODEL_SELECTION: ModelSelection = Object.freeze({
  provider: 'minimax-cn',
  model: 'Minimax-M3.1-Flash',
  apiKeyEnv: 'MINIMAX_CN_API_KEY',
  contextWindow: 1000000,
  maxTokens: 120000,
  input: ['text', 'image'],
})

/**
 * 读模型选择。优先级：三个环境变量分别覆盖默认值中的对应项。
 * DSH_REAL_MACHINE_MODEL 可以是单纯的模型 id，也可以是 `provider/model`；后者会同时改 provider。
 */
export function resolveModelSelection(env: Record<string, string | undefined> = process.env): ModelSelection {
  const provider = nonEmpty(env.DSH_REAL_MACHINE_MODEL_PROVIDER) || DEFAULT_MODEL_SELECTION.provider
  const rawModel = nonEmpty(env.DSH_REAL_MACHINE_MODEL)
  const model = rawModel && rawModel.indexOf('/') >= 0 ? rawModel.slice(rawModel.indexOf('/') + 1) : rawModel
  const modelProvider = rawModel && rawModel.indexOf('/') >= 0 ? rawModel.slice(0, rawModel.indexOf('/')) : provider
  const apiKeyEnv = nonEmpty(env.DSH_REAL_MACHINE_MODEL_KEY_ENV) || DEFAULT_MODEL_SELECTION.apiKeyEnv
  return {
    provider: nonEmpty(modelProvider) || DEFAULT_MODEL_SELECTION.provider,
    model: nonEmpty(model) || DEFAULT_MODEL_SELECTION.model,
    apiKeyEnv: nonEmpty(apiKeyEnv) || DEFAULT_MODEL_SELECTION.apiKeyEnv,
    contextWindow: DEFAULT_MODEL_SELECTION.contextWindow,
    maxTokens: DEFAULT_MODEL_SELECTION.maxTokens,
    input: DEFAULT_MODEL_SELECTION.input.slice(),
  }
}

/** profile 里的模型配置落在哪个文件；文件名是 DSH 自己认的 `cordis.patch.yml`。 */
export function profileModelFile(profileDir: string): string {
  return path.join(profileDir, 'cordis.patch.yml')
}

/** profile 里当前实际写着的模型配置。`configured` 表示两条配置都齐、并且方向一致。 */
export interface ProfileModelConfig {
  profileFile: string
  fileExists: boolean
  /** agent-default-model 与 llm-pi-ai 两条都在，且 provider/model/apiKeyEnv 与期望选择一致。 */
  configured: boolean
  /** agent-default-model 里写的 provider。 */
  provider: string | null
  /** agent-default-model 里写的 model。 */
  model: string | null
  /** llm-pi-ai 里该 provider 的 apiKeyEnv。 */
  apiKeyEnv: string | null
  /** agent-default-model 里若还留着 reasoningEffort，启动器会删掉它；这里报出来方便排查。 */
  reasoningEffort: string | null
  /** llm-pi-ai 条目在不在。 */
  pluginPresent: boolean
  /** llm-pi-ai 的 models 数组里有没有这个模型 id。 */
  modelPresent: boolean
  /** 没配齐时的一句话原因；configured 为 true 时是空串。 */
  reason: string
}

/** 读 profile 的模型配置；文件或条目缺失都只是「没配置」，不抛错。YAML 解析失败才抛错。 */
export function inspectProfileModel(profileDir: string, selection: ModelSelection = resolveModelSelection()): ProfileModelConfig {
  const profileFile = profileModelFile(profileDir)
  const fileExists = exists(profileFile)
  if (!fileExists) {
    return {
      profileFile,
      fileExists: false,
      configured: false,
      provider: null,
      model: null,
      apiKeyEnv: null,
      reasoningEffort: null,
      pluginPresent: false,
      modelPresent: false,
      reason: 'profile 里没有 cordis.patch.yml：还没有写入模型配置。',
    }
  }
  const entries = readPatchEntries(profileFile)
  const agent = findEntry(entries, 'agent-default-model')
  const agentConfig = agent ? asRecord(agent.config) : null
  const provider = agentConfig && typeof agentConfig.provider === 'string' ? agentConfig.provider : null
  const model = agentConfig && typeof agentConfig.model === 'string' ? agentConfig.model : null
  const reasoningEffort = agentConfig && typeof agentConfig.reasoningEffort === 'string' ? agentConfig.reasoningEffort : null
  const llm = findEntry(entries, 'llm-pi-ai')
  const providers = llm && asRecord(llm.config) ? asRecord((llm.config as Record<string, unknown>).providers) : null
  const providerConfig = providers ? asRecord(providers[selection.provider]) : null
  const apiKeyEnv = providerConfig && typeof providerConfig.apiKeyEnv === 'string' ? providerConfig.apiKeyEnv : null
  const models = providerConfig && Array.isArray(providerConfig.models) ? providerConfig.models : []
  const modelPresent = models.some((item) => asRecord(item) !== null && (item as Record<string, unknown>).id === selection.model)
  const problems: string[] = []
  if (!agent) problems.push('缺少 agent-default-model 条目')
  else if (provider !== selection.provider || model !== selection.model) {
    problems.push('agent-default-model 现在指向 ' + String(provider || '（空）') + '/' + String(model || '（空）') + '，不是期望的 ' + selection.provider + '/' + selection.model)
  }
  if (!llm) problems.push('缺少 llm-pi-ai 条目')
  else if (!providerConfig) problems.push('llm-pi-ai 里没有 providers.' + selection.provider)
  else if (apiKeyEnv !== selection.apiKeyEnv) problems.push('llm-pi-ai 的 apiKeyEnv 是 ' + String(apiKeyEnv || '（空）') + '，不是 ' + selection.apiKeyEnv)
  if (!modelPresent) problems.push('llm-pi-ai 的模型列表里没有 ' + selection.model)
  return {
    profileFile,
    fileExists,
    configured: problems.length === 0,
    provider,
    model,
    apiKeyEnv,
    reasoningEffort,
    pluginPresent: Boolean(llm),
    modelPresent,
    reason: problems.length === 0 ? '' : problems.join('；') + '。',
  }
}

/**
 * 把模型选择写进 profile：agent-default-model 设 provider/model，并删掉 reasoningEffort；
 * llm-pi-ai 合并 providers.<provider> 的 apiKeyEnv 与模型条目。其它条目、其它 provider、其它模型都原样保留。
 * 已经配齐时不做任何写盘，避免每次启动都重写文件。
 */
export function configureProfileModel(profileDir: string, selection: ModelSelection = resolveModelSelection()): ProfileModelConfig {
  if (!isDir(profileDir)) throw new Error('要写模型配置的 profile 目录不存在：「' + profileDir + '」。')
  const current = inspectProfileModel(profileDir, selection)
  if (current.configured) return current
  const profileFile = profileModelFile(profileDir)
  const entries = current.fileExists ? readPatchEntries(profileFile) : []

  const agent = ensureEntry(entries, 'agent-default-model', '@deepseek-ai/dsh-agent-default-model')
  const agentConfig = asRecord(agent.config) || {}
  agent.config = agentConfig
  agentConfig.provider = selection.provider
  agentConfig.model = selection.model
  delete agentConfig.reasoningEffort

  const llm = ensureEntry(entries, 'llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai')
  const llmConfig = asRecord(llm.config) || {}
  llm.config = llmConfig
  const providers = asRecord(llmConfig.providers) || {}
  llmConfig.providers = providers
  const providerConfig = asRecord(providers[selection.provider]) || {}
  providers[selection.provider] = providerConfig
  providerConfig.apiKeyEnv = selection.apiKeyEnv
  const models = Array.isArray(providerConfig.models) ? providerConfig.models : []
  providerConfig.models = models
  let modelEntry = models.find((item) => asRecord(item) !== null && (item as Record<string, unknown>).id === selection.model)
  if (!asRecord(modelEntry)) {
    modelEntry = {}
    models.push(modelEntry)
  }
  const modelRecord = modelEntry as Record<string, unknown>
  modelRecord.id = selection.model
  modelRecord.name = selection.model
  modelRecord.contextWindow = selection.contextWindow
  modelRecord.maxTokens = selection.maxTokens
  modelRecord.input = selection.input.slice()

  ensureDir(profileDir)
  const header = '# 由真机验证工具维护：批次实例默认模型 ' + selection.provider + '/' + selection.model + '，密钥从环境变量 ' + selection.apiKeyEnv + ' 读取（值不写在这里）。\n'
  writeText(profileFile, header + yaml.stringify(entries, { lineWidth: 0 }))
  return inspectProfileModel(profileDir, selection)
}

/** 密钥值的来源：批次 home 的存储、真实 home 的存储、当前进程环境，或没有。 */
export type ModelCredentialSource = 'batch-home-store' | 'real-home-store' | 'process-env' | 'missing'

/**
 * 找到的密钥。`value` 只能交给子进程环境，禁止写日志、回执、instance.json 或任何输出。
 * 没找到时 value 是 null，error 说清找过哪些地方（不包含任何值）。
 */
export interface ModelCredential {
  envName: string
  source: ModelCredentialSource
  value: string | null
  /** 值来自哪个文件；来自进程环境时是 null。 */
  file: string | null
  /** 没找到或文件读不懂时的一句话原因。 */
  error: string
}

/**
 * 按顺序找密钥：批次 home 的 .credentials.yaml → 真实 home 的 .credentials.yaml → 当前进程环境。
 * 前两处读 `refs.<变量名>`。真实 home 只读，不写；错误信息不回显文件内容。
 */
export function resolveModelCredential(options: {
  home?: string
  realHome?: string
  envName: string
  env?: Record<string, string | undefined>
}): ModelCredential {
  const env = options.env || process.env
  const envName = options.envName
  const errors: string[] = []
  const candidates: Array<{ source: ModelCredentialSource; file: string }> = []
  const home = options.home ? path.resolve(options.home) : ''
  const realHome = options.realHome ? path.resolve(options.realHome) : realDshHome()
  if (home) candidates.push({ source: 'batch-home-store', file: path.join(home, '.credentials.yaml') })
  if (realHome && (!home || path.resolve(realHome) !== home)) candidates.push({ source: 'real-home-store', file: path.join(realHome, '.credentials.yaml') })
  for (const candidate of candidates) {
    const found = readCredentialStore(candidate.file, envName)
    if (found.error) errors.push(found.error)
    if (found.value) return { envName, source: candidate.source, value: found.value, file: candidate.file, error: '' }
  }
  const fromEnv = env[envName]
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return { envName, source: 'process-env', value: fromEnv.trim(), file: null, error: '' }
  }
  errors.push('当前进程环境里也没有 ' + envName + '。')
  return {
    envName,
    source: 'missing',
    value: null,
    file: null,
    error: '没有找到模型密钥 ' + envName + '：' + errors.join('') + '批次 home、真实 home 的 .credentials.yaml 与当前进程环境都查过了。',
  }
}

/** 计划、回执与前置巡检里出现的模型报告：只报名字与来源，绝不带密钥值。 */
export interface LaunchModelReport {
  /** 调用方是否要求自动配置模型；false 表示本次启动明确跳过。 */
  enabled: boolean
  provider: string | null
  model: string | null
  /** 密钥变量名，例如 MINIMAX_CN_API_KEY。 */
  apiKeyEnv: string | null
  /** profile 里的两条配置是否已经齐了。 */
  profileConfigured: boolean
  configuredProvider: string | null
  configuredModel: string | null
  configuredApiKeyEnv: string | null
  /** profile 没配齐时的一句话原因；配齐时是空串。 */
  profileReason: string
  /** 密钥来源；没有找到时是 'missing'。 */
  credentialSource: ModelCredentialSource
  credentialAvailable: boolean
  /** 密钥来自哪个文件；来自进程环境时是 null。 */
  credentialFile: string | null
  /** 没有密钥时的一句话原因；有密钥时是空串。 */
  error: string
}

/** 一次启动前的模型检查结果：报告给人看，密钥值只交给启动器。 */
export interface LaunchModelInspection {
  selection: ModelSelection | null
  profile: ProfileModelConfig | null
  credential: ModelCredential | null
  report: LaunchModelReport
}

/** 不做模型配置时使用的一份空报告，字段齐全，调用方不用判空。 */
export function disabledModelReport(): LaunchModelReport {
  return {
    enabled: false,
    provider: null,
    model: null,
    apiKeyEnv: null,
    profileConfigured: false,
    configuredProvider: null,
    configuredModel: null,
    configuredApiKeyEnv: null,
    profileReason: '调用方明确跳过了模型配置。',
    credentialSource: 'missing',
    credentialAvailable: false,
    credentialFile: null,
    error: '',
  }
}

/** 读一份启动前的模型状态，不写盘。 */
export function inspectLaunchModel(options: {
  home: string
  profile: string
  selection?: ModelSelection | false
}): LaunchModelInspection {
  if (options.selection === false) {
    return { selection: null, profile: null, credential: null, report: disabledModelReport() }
  }
  const selection = options.selection || resolveModelSelection()
  const profileDir = path.join(path.resolve(options.home), 'profiles', options.profile)
  if (!isDir(profileDir)) throw new Error('home「' + path.resolve(options.home) + '」里没有 profiles/' + options.profile + '：先跑 copy-home 生成批次 home。')
  const profile = inspectProfileModel(profileDir, selection)
  const credential = resolveModelCredential({ home: options.home, envName: selection.apiKeyEnv })
  return { selection, profile, credential, report: modelReport(selection, profile, credential) }
}

/** 确保 profile 已写入模型配置，再返回一次完整状态；启动器在用之前调用它。 */
export function ensureLaunchModel(options: {
  home: string
  profile: string
  selection?: ModelSelection | false
}): LaunchModelInspection {
  if (options.selection === false) return inspectLaunchModel(options)
  const selection = options.selection || resolveModelSelection()
  const profileDir = path.join(path.resolve(options.home), 'profiles', options.profile)
  if (!isDir(profileDir)) throw new Error('home「' + path.resolve(options.home) + '」里没有 profiles/' + options.profile + '：先跑 copy-home 生成批次 home。')
  const current = inspectProfileModel(profileDir, selection)
  if (!current.configured) configureProfileModel(profileDir, selection)
  return inspectLaunchModel({ home: options.home, profile: options.profile, selection })
}

/** 由三份输入拼出面向人的报告；密钥值不进这个函数的结果。 */
function modelReport(selection: ModelSelection, profile: ProfileModelConfig, credential: ModelCredential): LaunchModelReport {
  return {
    enabled: true,
    provider: selection.provider,
    model: selection.model,
    apiKeyEnv: selection.apiKeyEnv,
    profileConfigured: profile.configured,
    configuredProvider: profile.provider,
    configuredModel: profile.model,
    configuredApiKeyEnv: profile.apiKeyEnv,
    profileReason: profile.reason,
    credentialSource: credential.source,
    credentialAvailable: Boolean(credential.value),
    credentialFile: credential.file,
    error: credential.error,
  }
}

/** 读 profile 的 `cordis.patch.yml`，顶层必须是 YAML 数组；条目里非对象的项原样保留。 */
function readPatchEntries(file: string): Array<Record<string, unknown>> {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error('读不了 profile 的 cordis.patch.yml「' + file + '」：' + (error instanceof Error ? error.message : String(error)))
  }
  let parsed: unknown
  try {
    parsed = yaml.parse(text)
  } catch {
    throw new Error('读不懂 profile 的 cordis.patch.yml「' + file + '」：它不是合法的 YAML。可以删掉这个文件重新跑 copy-home，或加 --no-model 跳过模型配置。')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('profile 的 cordis.patch.yml「' + file + '」顶层应当是一个 YAML 数组（每一项是一个插件条目的 patch）。')
  }
  return parsed as Array<Record<string, unknown>>
}

function findEntry(entries: Array<Record<string, unknown>>, id: string): Record<string, unknown> | null {
  for (const entry of entries) {
    const record = asRecord(entry)
    if (record && record.id === id) return record
  }
  return null
}

function ensureEntry(entries: Array<Record<string, unknown>>, id: string, name: string): Record<string, unknown> {
  const found = findEntry(entries, id)
  if (found) {
    if (typeof found.name !== 'string' || !found.name) found.name = name
    return found
  }
  const entry: Record<string, unknown> = { id, name, config: {} }
  entries.push(entry)
  return entry
}

/** 判断一个值是不是「普通对象」，YAML 解析出来的 map 与手写的对象都算。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** 读 YAML 的 refs.<变量名>；文件不存在或没有这个键都只是「没有」，读不懂才给 error。 */
function readCredentialStore(file: string, envName: string): { value: string | null; error: string } {
  if (!exists(file)) return { value: null, error: '' }
  let parsed: unknown
  try {
    parsed = yaml.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { value: null, error: '凭证文件「' + file + '」不是合法的 YAML，已跳过（没有回显文件内容）。' }
  }
  const record = asRecord(parsed)
  const refs = record ? asRecord(record.refs) : null
  if (!refs) return { value: null, error: '' }
  const value = refs[envName]
  if (typeof value !== 'string' || !value.trim()) return { value: null, error: '' }
  return { value: value.trim(), error: '' }
}

function nonEmpty(value: string | undefined): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** 把密钥来源翻成一句人话；只报来源，永远不输出值。 */
export function credentialSourceLabel(source: ModelCredentialSource): string {
  if (source === 'batch-home-store') return '批次 home 的 .credentials.yaml'
  if (source === 'real-home-store') return '真实 home 的 .credentials.yaml'
  if (source === 'process-env') return '当前进程环境'
  return '没有找到'
}
