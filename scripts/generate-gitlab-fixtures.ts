/**
 * scripts/generate-gitlab-fixtures.ts —— 采一次 GitLab 房的真样本，写成固件（#1179）
 *
 * 干什么：照 `tests/tracker-contract/gitlab-endpoints.ts` 那张表，把本房真的会发出去的每一条请求
 * 都对着一台真的 GitLab 发一次，把**原样回包**落成 `raw-<端点名>.json`，再用本房自己的
 * `normalizeIssue` 把它变成 `normalized-*.json`。产出目录默认 `tests/tracker-contract/fixtures/gitlab-real/`，
 * 布局与已有的 `github-real` / `markdown-real` 一致（raw + normalized + metadata.json）。
 *
 * 为什么要有它（#1179 的由来）：本房对远端行为的认识全部来自官方文档，一次 `glab` 都没真跑过。
 * 契约测试把 `ctx.exec` 换成脚本化桩，桩照「我以为 GitLab 会这么回」写，实现照同一个信念写 ——
 * 信念错了两边一起错，断言照样全绿。这份固件就是把那个信念换成真回话。
 *
 * 用法：
 *   node --import ./scripts/ts-hook.mjs scripts/generate-gitlab-fixtures.ts
 *   node --import ./scripts/ts-hook.mjs scripts/generate-gitlab-fixtures.ts --repo 组/项目 --out 别的目录
 *
 * 要求（两样缺一样就一条都不写，见下面 preflight）：
 *   一、本机装了 `glab` 且在 PATH 里能找到（或设了 GLAB_PATH）；
 *   二、这台机器已经 `glab auth login` 过，并且那个账号在目标项目上有权限。
 *
 * 采样本会在目标项目里建两三个带 `dsh-1179-sample` 前缀的工单、一个同名标签、一条平级链接与一条评论。
 * 请把它指到一个**专门用来做这件事的沙箱项目**上，别指到有真人用的项目。
 *
 * 脱敏：回包里的邮箱、令牌一类字段一律替换成占位符（规则写在 metadata.desensitization 里），
 * 写完还会再自查一遍有没有 `glpat-` 之类的令牌形状，命中就删掉整份产出并以非零退出码收场。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { GITLAB_ENDPOINTS } from '../tests/tracker-contract/gitlab-endpoints.ts'
import { normalizeIssue } from '../src/tracker/rooms/gitlab/normalize.ts'

const repoDefault = 'FeatherHunter/dsh-gitlab-sandbox'
const outDefault = 'tests/tracker-contract/fixtures/gitlab-real'
/** 样本工单与标签都带这个前缀，一眼看得出是采样留下的东西，也方便重跑时认领已有的那一份。 */
const SAMPLE_PREFIX = 'dsh-1179-sample'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const repo = arg('--repo', repoDefault)
const outDir = path.resolve(arg('--out', outDefault))
const projectId = encodeURIComponent(repo)

/** 跑一次 glab，把 stdout 原样带回来。参数走数组：集中扫描器把拼串的命令行判成注入形状，别那么写。 */
function glabRun(args: string[]): string {
  const bin = process.env.GLAB_PATH || 'glab'
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const detail = String(r.stderr || '').trim() || '退出码 ' + r.status
    throw new Error('glab ' + args.join(' ') + ' 失败：' + detail)
  }
  return r.stdout
}

/** 跑一次 `glab api` 并把回包解析成 JSON；空回包回 null（DELETE 成功就是 204 没有正文）。 */
function glabApi(request: string, method: string, fields: readonly string[]): unknown {
  const args = ['api', request]
  if (method !== 'GET') args.push('--method', method)
  for (const f of fields) args.push('-f', f)
  const out = glabRun(args)
  const text = out.trim()
  if (!text) return null
  return JSON.parse(text)
}

/** 把表里的占位符换成这次采样认出来的真实值。 */
function fill(request: string, ctx: { [key: string]: string }): string {
  return request.replace(/\{([a-z_]+)\}/g, (whole, key: string) => {
    const value = ctx[key]
    if (value === undefined) throw new Error('采样上下文里没有 ' + key + '，这条请求没法拼：' + request)
    return value
  })
}

const DESENSITIZATION_RULES = [
  '回包里任何键名叫 email / public_email / commit_email 的字段，值一律换成 "<已隐去>"',
  '回包里任何键名叫 token / private_token / access_token / refresh_token 的字段，值一律换成 "<已隐去>"',
  '回包里的项目路径与用户名原样保留（与 github-real 的做法一致：固件要能看出它采自哪个项目）',
]

/** 按上面那三条规则复制一份回包。 */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: { [key: string]: unknown } = {}
    for (const [k, v] of Object.entries(value as { [key: string]: unknown })) {
      if (/^(email|public_email|commit_email|token|private_token|access_token|refresh_token)$/.test(k)) {
        out[k] = '<已隐去>'
        continue
      }
      out[k] = redact(v)
    }
    return out
  }
  return value
}

/** 写一份 JSON 固件；目录不存在就建。 */
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/** 在一张票的清单里按标题找那一张（重跑时认领上次留下的样本，不重复建）。 */
function findIssueByTitle(title: string): { iid: number } | null {
  const rows = glabApi('projects/' + projectId + '/issues?per_page=100', 'GET', []) as unknown
  if (!Array.isArray(rows)) return null
  for (const row of rows as { [k: string]: unknown }[]) {
    if (String(row['title'] || '') === title) return { iid: Number(row['iid']) }
  }
  return null
}

/** 找到就回它，没找到就建一张。 */
function ensureIssue(title: string, description: string): { iid: number } {
  const found = findIssueByTitle(title)
  if (found) return found
  const created = glabApi('projects/' + projectId + '/issues', 'POST', [
    'title=' + title,
    'description=' + description,
  ]) as { [k: string]: unknown }
  return { iid: Number(created['iid']) }
}

/** 找到就回它的 id，没找到就建一个。 */
function ensureLabel(name: string): { id: number } {
  const rows = glabApi('projects/' + projectId + '/labels?per_page=100', 'GET', []) as unknown
  if (Array.isArray(rows)) {
    for (const row of rows as { [k: string]: unknown }[]) {
      if (String(row['name'] || '') === name) return { id: Number(row['id']) }
    }
  }
  const created = glabApi('projects/' + projectId + '/labels', 'POST', [
    'name=' + name,
    'color=#428BCA',
  ]) as { [k: string]: unknown }
  return { id: Number(created['id']) }
}

/** 把一条平级链接的编号找出来（创建那条接口不回它，只能回读列表里那一行的 issue_link_id）。 */
function findLinkId(childIid: number, targetIid: number): string | null {
  const rows = glabApi('projects/' + projectId + '/issues/' + childIid + '/links', 'GET', []) as unknown
  if (!Array.isArray(rows)) return null
  for (const row of rows as { [k: string]: unknown }[]) {
    if (Number(row['iid']) === targetIid) return String(row['issue_link_id'])
  }
  return null
}

async function main(): Promise<void> {
  // —— 一、先确认这台机器真能发请求；不能就一条都不写 ——
  try {
    glabRun(['--version'])
  } catch {
    throw new Error('本机找不到 glab（或 GLAB_PATH 指错了）。先装 GitLab CLI 并 `glab auth login`，再跑这个脚本。')
  }
  let me: { [k: string]: unknown }
  try {
    me = glabApi('user', 'GET', []) as { [k: string]: unknown }
  } catch (e) {
    throw new Error('`glab api user` 没成功，说明这台机器还没登录（或令牌已失效）：' + String(e))
  }
  if (!me || typeof me['username'] !== 'string') {
    throw new Error('`glab api user` 回来了，但看不出登录名（回包形状不对），不敢往下走。')
  }

  // —— 二、把这次采样的上下文凑齐（样本工单、标签、链接、评论） ——
  const mapIssue = ensureIssue(SAMPLE_PREFIX + '-map', '采样用的地图工单（#1179）。可以删。')
  const childIssue = ensureIssue(SAMPLE_PREFIX + '-child', '采样用的子工单（#1179）。可以删。')
  const label = ensureLabel(SAMPLE_PREFIX)

  const linksBefore = glabApi('projects/' + projectId + '/issues/' + childIssue.iid + '/links', 'GET', []) as unknown
  const alreadyLinked = Array.isArray(linksBefore)
    ? (linksBefore as { [k: string]: unknown }[]).some((r) => Number(r['iid']) === mapIssue.iid)
    : false
  if (!alreadyLinked) {
    // 照本房写路径的约定发起：POST 到**子票**的 links 资源，link_type 用 relates_to。
    glabApi('projects/' + projectId + '/issues/' + childIssue.iid + '/links', 'POST', [
      'target_project_id=' + projectId,
      'target_issue_iid=' + String(mapIssue.iid),
      'link_type=relates_to',
    ])
  }

  const notes = glabApi('projects/' + projectId + '/issues/' + mapIssue.iid + '/notes', 'GET', []) as unknown
  const hasNote = Array.isArray(notes) && (notes as { [k: string]: unknown }[]).some((n) => String(n['body'] || '').includes(SAMPLE_PREFIX))
  if (!hasNote) {
    glabApi('projects/' + projectId + '/issues/' + mapIssue.iid + '/notes', 'POST', [
      'body=' + SAMPLE_PREFIX + ' 采样留下的一条评论（#1179）。可以删。',
    ])
  }

  const ctx: { [key: string]: string } = {
    id: projectId,
    iid: String(mapIssue.iid),
    child: String(childIssue.iid),
    label_id: String(label.id),
    username: String(me['username']),
    page: '1',
  }

  // —— 三、照表逐条采 ——
  const raw: { [id: string]: unknown } = {}
  const sampled: string[] = []
  for (const ep of GITLAB_ENDPOINTS) {
    if (!ep.request) {
      console.log('  跳过 ' + ep.id + '：' + (ep.skipReason || '（没写理由）'))
      continue
    }
    const request = fill(ep.request, ctx)
    const fields = (ep.fields || []).map((f) => fill(f, ctx))
    const body = glabApi(request, ep.method, fields)
    raw[ep.id] = redact(body)
    sampled.push(ep.id)
    console.log('  采到 ' + ep.method + ' ' + request + '  →  ' + ep.id)
    // 关系那一组要按顺序来：先建、再回读明细、最后删。明细的编号只有建完才知道。
    if (ep.id === 'link-create') {
      const linkId = findLinkId(childIssue.iid, mapIssue.iid)
      if (!linkId) throw new Error('刚建完链接却回读不到它的编号，后面两条链接请求没法采。')
      ctx['link_id'] = linkId
    }
  }

  // —— 四、归一化产物：用本房自己的 normalizeIssue，不是另写一套 ——
  const issueRaw = raw['issue-get-with-labels']
  if (!issueRaw || typeof issueRaw !== 'object') {
    throw new Error('没采到单张工单的原样回包，归一化产物无从生成。')
  }
  const listRaw = raw['issues-list']
  const normalizedOne = redact(normalizeIssue(issueRaw))
  const normalizedList = Array.isArray(listRaw) ? redact((listRaw as unknown[]).map((r) => normalizeIssue(r))) : []

  // —— 五、落盘（先全部凑齐再写，避免半份产出） ——
  const files: { file: string; value: unknown }[] = []
  for (const id of sampled) files.push({ file: 'raw-' + id + '.json', value: raw[id] })
  files.push({ file: 'normalized-' + mapIssue.iid + '.json', value: normalizedOne })
  files.push({ file: 'normalized-list.json', value: normalizedList })

  const allText = JSON.stringify(files.map((f) => f.value))
  if (/glpat-|ghp_[A-Za-z0-9_]+|github_pat_/.test(allText)) {
    throw new Error('脱敏自查没过：产出里出现了令牌形状的字符串，已中止，一个字都没写。')
  }

  const metadata = {
    source:
      'glab api 逐条采 ' +
      sampled.length +
      ' 条（表见 tests/tracker-contract/gitlab-endpoints.ts）：' +
      sampled.join('、'),
    repo,
    refId: repo,
    sampledAt: new Date().toISOString(),
    sampledBy: 'scripts/generate-gitlab-fixtures.ts',
    host: (() => {
      try {
        const r = glabRun(['auth', 'status']) + glabRun(['config', 'get', 'host'])
        return String(r).trim().split('\n')[0] || '(没读出来)'
      } catch {
        return '(没读出来)'
      }
    })(),
    sampleIssues: { map: mapIssue.iid, child: childIssue.iid },
    desensitization: { rules: DESENSITIZATION_RULES, applied: true },
    fields: {
      raw: sampled.map((id) => 'raw-' + id + '.json'),
      normalized: ['normalized-' + mapIssue.iid + '.json', 'normalized-list.json'],
      notes: '每个端点一份原样回包；normalized-* 是用本房自己的 normalizeIssue 转出来的，与契约测试播放器认的格式一致。',
    },
    notes:
      '这份固件由 ' +
      repo +
      ' 上真实采样得来。重跑会认领同名样本工单，不重复建；链接那一条采完会把它删掉，下次重跑会再建。',
  }
  files.push({ file: 'metadata.json', value: metadata })

  fs.rmSync(outDir, { recursive: true, force: true })
  for (const f of files) writeJson(path.join(outDir, f.file), f.value)

  console.log('\n写出 ' + files.length + ' 个文件到 ' + path.relative(process.cwd(), outDir))
  console.log('采自 ' + repo + '，' + sampled.length + ' 个端点，' + metadata.sampledAt)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
