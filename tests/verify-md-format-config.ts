// verify-md-format-config.ts —— Markdown 后端格式映射门禁（#1480 T1 立，父票 #1480）。
// 门禁归属: src/tracker/rooms/markdown/format/original-skills.yaml
// 门禁归属: src/tracker/rooms/markdown/format/generated.ts
// 门禁归属: scripts/generate-md-format-config.mts
// 门禁归属: scripts/lib/md-format-config.mts
// 门禁归属: package/bundled-skills/
// 门禁归属: tests/bundled-skills-upstream-hashes.json
//
// 这扇门禁守五件事（先说清楚，后面每条判据才有人看得懂）：
//   ① 生成新鲜度：生成器 --check 必须是绿的（改了 YAML 忘了跑生成器，在这里红）。
//   ② 映射自校验：映射文档本身没有未知键、缺项、引用不存在的原文 id 或隐藏注释。
//   ③ 原文锚点：映射里写的目录、标题、字段行、状态词，必须能在对应随包原文里逐字找到；
//      pin 必须与 tests/bundled-skills-upstream-hashes.json 一致，引用的原文文件必须在该清单里。
//      —— 原文升级后映射没跟着改，就在这一节红；这是本门禁存在的首要理由。
//   ④ 坏数据演练：在内存里造八类坏映射（不写盘，跑完就丢），确认校验器每一项都真的会报错——
//      校验器变哑了，②③的绿就没有意义。
//   ⑤ 生成物与真源一致：内存渲染结果与盘上生成物逐字相等；生成物当模块载入后与 YAML 解析结果深层相等。
//
// 跑法（在插件根目录执行）：
//   node --import ./scripts/ts-hook.mts tests/verify-md-format-config.ts
//   链上跑不用手写 --import：scripts/verify-chain.ts 与 scripts/verify-parallel.mts 会自动挂钩子。
//
// 将来原文升级时的处理顺序见 original-skills.yaml 末尾的 upgrade.checklist。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MD_FORMAT_OUT_REL,
  MD_FORMAT_REL,
  UPSTREAM_HASH_REL,
  readMdFormatConfig,
  readMdFormatText,
  renderMdFormatData,
  validateMdFormatConfig,
} from '../scripts/lib/md-format-config.mts'

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENERATOR_REL: string = 'scripts/generate-md-format-config.mts'
const BUNDLED_PREFIX: string = 'package/bundled-skills/'

const failures: string[] = []
let checks: number = 0

function check(ok: boolean, message: string): void {
  checks += 1
  if (!ok) failures.push(message)
}

function textOf(rel: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
  } catch {
    return ''
  }
}

/** 把对象引用的原文文本拼起来（只看它声明引用的那几份，不从别的原文里借证据）。 */
function sourceTexts(cfg: Record<string, any>, objectKey: string): string {
  const obj: Record<string, any> = cfg.objects[objectKey]
  const ids: string[] = Array.isArray(obj.source) ? obj.source : [obj.source]
  return ids.map((id: string) => textOf(cfg.sources[id].file)).join('\n')
}

async function main(): Promise<void> {
  // ---- ① 生成新鲜度 ----
  const gen = spawnSync(process.execPath, [path.join(ROOT, GENERATOR_REL), '--check'], { encoding: 'utf8' })
  check(gen.status === 0, '① 生成器 --check 失败：' + String((gen.stdout || '') + (gen.stderr || '')).trim())

  // ---- ② 映射自校验 ----
  const cfg: Record<string, any> = readMdFormatConfig(ROOT)
  const problems: string[] = validateMdFormatConfig(cfg)
  check(problems.length === 0, '② 映射自校验报出问题：' + problems.join('；'))

  // ---- ③ 原文锚点 ----
  const manifestRaw: string = textOf(UPSTREAM_HASH_REL)
  check(manifestRaw.length > 0, '③ 读不到 ' + UPSTREAM_HASH_REL)
  let manifest: Record<string, any> = {}
  try {
    manifest = JSON.parse(manifestRaw)
  } catch {
    check(false, '③ ' + UPSTREAM_HASH_REL + ' 不是合法 JSON')
  }
  check(manifest.pin === cfg.upstream.pin, '③ 映射 pin（' + String(cfg.upstream.pin) + '）与哈希清单 pin（' + String(manifest.pin) + '）不一致：原文升级后要一起改')
  check(textOf(cfg.upstream['verify-gate']).length > 0, '③ 映射写的原文门禁文件不存在：' + String(cfg.upstream['verify-gate']))
  const manifestFiles: Record<string, any> = manifest.files && typeof manifest.files === 'object' ? manifest.files : {}
  for (const [id, src] of Object.entries(cfg.sources as Record<string, any>)) {
    const rel: string = String(src.file)
    check(textOf(rel).length > 0, '③ 原文文件不存在：sources.' + id + ' → ' + rel)
    check(rel.startsWith(BUNDLED_PREFIX), '③ 原文必须来自随包目录 ' + BUNDLED_PREFIX + '，sources.' + id + ' 写的是 ' + rel)
    const manifestKey: string = rel.slice(BUNDLED_PREFIX.length)
    check(Object.prototype.hasOwnProperty.call(manifestFiles, manifestKey), '③ 原文文件不在哈希清单里：' + manifestKey + '（上游新增/改名后要重新同步清单）')
  }

  for (const objectKey of Object.keys(cfg.objects as Record<string, any>)) {
    const obj: Record<string, any> = cfg.objects[objectKey]
    const source: string = sourceTexts(cfg, objectKey)
    check(source.length > 0, '③ objects.' + objectKey + ' 的原文一份都读不到')
    const anchors: string[] = Array.isArray(obj.anchors) ? obj.anchors : []
    for (const anchor of anchors) {
      check(source.includes(anchor), '③ objects.' + objectKey + '.anchors 在原文里找不到「' + anchor + '」：原文变了或映射写错了')
    }
    if (Array.isArray(obj.sections)) {
      for (const section of obj.sections) {
        check(source.includes('## ' + section), '③ objects.' + objectKey + ' 的段落标题「## ' + section + '」在原文里找不到')
      }
    }
    if (Array.isArray(obj.fields)) {
      for (const field of obj.fields) {
        const shape: string = String(field['line-shape'])
        const prefix: string = shape.includes(' <') ? shape.slice(0, shape.indexOf(' <')) : shape
        check(source.includes(prefix), '③ objects.' + objectKey + ' 的字段行「' + prefix + '」在原文里找不到')
      }
    }
    if (Array.isArray(obj['top-lines'])) {
      for (const line of obj['top-lines']) {
        const label: string = String(line.label)
        check(source.includes(label + ':'), '③ objects.' + objectKey + ' 的顶部字段行「' + label + ':」在原文里找不到')
        if (Array.isArray(line.values)) {
          for (const value of line.values) {
            check(source.includes(value), '③ objects.' + objectKey + '.top-lines「' + label + '」的取值「' + String(value) + '」在原文里找不到')
          }
        }
      }
    }
  }
  // 状态词是两套原文的用词：triage 角色在 triage-labels.md，wayfinder 在 issue-tracker-local.md。
  const triageText: string = textOf('package/bundled-skills/setup-matt-pocock-skills/triage-labels.md')
  if (triageText.length > 0) {
    for (const role of cfg.status['triage-roles']) {
      check(triageText.includes(role), '③ status.triage-roles 的「' + String(role) + '」在 triage-labels.md 里找不到')
    }
  }
  const wayfindingText: string = textOf(cfg.sources['issue-tracker-local'].file)
  for (const value of cfg.status.wayfinder) {
    check(wayfindingText.includes(value), '③ status.wayfinder 的「' + String(value) + '」在 issue-tracker-local.md 里找不到')
  }

  // ---- ④ 坏数据演练：校验器必须真会红 ----
  const drills: Array<{ name: string; mutate: (d: Record<string, any>) => void }> = [
    { name: '规格段落清空', mutate: (d) => { d.objects.spec.sections = [] } },
    { name: '对象路径写到 .scratch 外', mutate: (d) => { d.objects['implementation-ticket'].path = 'docs/tickets/<NN>.md' } },
    { name: '隐藏注释重名', mutate: (d) => { d['hidden-comments'].entries.push({ ...d['hidden-comments'].entries[0] }) } },
    { name: '隐藏注释没写理由', mutate: (d) => { d['hidden-comments'].entries[0].why = '短' } },
    { name: 'triage 与 wayfinder 状态词混用', mutate: (d) => { d.status['triage-roles'].push('claimed') } },
    { name: '顶层有未知键', mutate: (d) => { d['unknown-key'] = 1 } },
    { name: 'pin 格式不对', mutate: (d) => { d.upstream.pin = '1.3.1' } },
    { name: 'reuse 指向不存在的对象', mutate: (d) => { d.objects.map.reuse = 'not-a-real-key' } },
  ]
  for (const drill of drills) {
    const copy: Record<string, any> = JSON.parse(JSON.stringify(cfg))
    drill.mutate(copy)
    const found: string[] = validateMdFormatConfig(copy)
    check(found.length > 0, '④ 坏数据演练「' + drill.name + '」没有被校验器抓到：校验器变哑了')
  }

  // ---- ⑤ 生成物与真源一致 ----
  const rendered: string = renderMdFormatData(cfg) + '\n'
  const onDisk: string = textOf(MD_FORMAT_OUT_REL)
  check(onDisk.length > 0, '⑤ 生成物不存在：' + MD_FORMAT_OUT_REL + '（跑 node scripts/generate-md-format-config.mts）')
  check(onDisk === rendered, '⑤ 生成物与 ' + MD_FORMAT_REL + ' 不一致：跑 node scripts/generate-md-format-config.mts 重算')
  try {
    const mod: any = await import(pathToFileURL(path.join(ROOT, MD_FORMAT_OUT_REL)).href)
    check(JSON.stringify(mod.MD_FORMAT) === JSON.stringify(cfg), '⑤ 生成物载入后的常量与 YAML 解析结果不相等')
  } catch (err) {
    check(false, '⑤ 生成物载入失败：' + (err as Error).message)
  }

  // ---- 汇总 ----
  if (failures.length > 0) {
    for (const message of failures) console.log('FAIL ' + message)
    console.log('FAIL verify-md-format-config：' + failures.length + ' 项不通过（共 ' + checks + ' 项判据）')
    process.exit(1)
  }
  console.log('PASS verify-md-format-config：' + checks + ' 项判据全过（生成新鲜度 / 映射自校验 / 原文锚点 / 坏数据演练 / 生成物一致）')
}

main().catch((err: unknown) => {
  console.log('FAIL verify-md-format-config 执行中断：' + (err as Error).message)
  process.exit(1)
})
