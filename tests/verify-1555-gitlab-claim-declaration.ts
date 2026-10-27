/**
 * tests/verify-1555-gitlab-claim-declaration.ts —— GitLab 认领的声明判据必须与判定层同一把尺子（#1555）。
 *
 * 病根：GitLab 后端的 matches 在旧写法里拿整篇 docs/agents/issue-tracker.md 做 /gitlab/i 扫描，
 * 于是「声明用 GitHub / Local Markdown、正文里只是提到 GitLab」也被认成 GitLab 工作区。
 * 真机上因此出现过：工作区文件明明选了 markdown（面板绿色芯片），自动识别却同时看见 markdown 与 gitlab，
 * 详情/评论开会话时判 multi-match，整批子票读不到（#1555 的截图）。
 *
 * 修法口径（与判定层一致，不做第二套解析）：声明文件用 parseIssueTracker 结构化解析 ——
 * 只有它说「这里声明的是 GitLab」才认；正文里出现 gitlab 字样本身不算声明（旧文档无标题时按它的
 * low 兜底，与判定层同答案）。
 *
 * 本门禁钉住：
 *   ① 提及不是声明：GitHub / Local Markdown 的声明文件里提到 GitLab，matches 必须是 false；
 *   ② 声明仍是声明：标题写着 GitLab 的文件（无论有无远端）照旧认领；
 *   ③ 与判定层同答案：同一个文档，matches 的声明判据与 parseIssueTracker 的结论一致；
 *   ④ 现场事实照旧：.git/config 的 GitLab 远端、git remote 兜底都还认；
 *   ⑤ 单一实现：判定层旧路径的 parseIssueTracker 与内核里那份是同一个函数（不是两份拷贝）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1555-gitlab-claim-declaration.ts
 *
 * 门禁归属: src/tracker/kernel/issue-tracker-declaration.ts
 * 门禁归属: src/tracker/rooms/gitlab
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitlabBackend } from '../src/tracker/rooms/gitlab/index.ts'
import {
  parseIssueTracker,
  normalizeTrackerText,
} from '../src/tracker/kernel/issue-tracker-declaration.ts'
import { parseIssueTracker as parseFromDetection } from '../src/tracker/detection/parseIssueTracker.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

function newWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claim-1555-'))
}
function put(ws: string, rel: string, text: string): void {
  const full = path.join(ws, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text, 'utf8')
}

/** 假文件服务：真服务规矩同款，readText 只认 resolve 给出的 target。 */
function makeFs() {
  const TARGET_PREFIX = 'dsh-target:'
  return {
    async resolve(rel: unknown, opts?: { cwd?: string }) {
      return TARGET_PREFIX + path.join((opts && opts.cwd) || '', String(rel))
    },
    async readText(target: unknown) {
      if (typeof target !== 'string' || target.indexOf(TARGET_PREFIX) !== 0) {
        throw new TypeError('readText 要的是 resolve() 给出的 target')
      }
      return fs.readFileSync(target.slice(TARGET_PREFIX.length), 'utf8')
    },
  }
}

/** 递给 matches 的上下文：文件服务走假的那一个，exec 兜底给一个「什么都没说」的执行器。 */
function ctxOf(ws: string, exec?: (cmd: string, args: string[], opts?: unknown) => Promise<unknown>) {
  const fsLike = makeFs()
  return {
    cwd: ws,
    fs: fsLike,
    platform: { fs: fsLike },
    exec: exec || (async () => ({ stdout: '', stderr: '', code: 0 })),
  }
}

async function claimedByDoc(doc: string, config?: string): Promise<boolean> {
  const ws = newWorkspace()
  if (config) put(ws, '.git/config', config)
  put(ws, 'docs/agents/issue-tracker.md', doc)
  return (await gitlabBackend.matches({ cwd: ws } as never, ctxOf(ws) as never)) as boolean
}

const GITHUB_CONFIG = '[remote "origin"]\n\turl = https://github.com/acme/demo.git\n'
const GITLAB_CONFIG = '[remote "origin"]\n\turl = git@gitlab.com:acme/demo.git\n'
const DECL_GITHUB_WITH_MENTION = '# Issue tracker: GitHub\n\n本仓库用 GitHub 管票；GitLab 上的旧 MR 不参与分诊，仅存档。\n'
const DECL_LOCAL_WITH_MENTION = '# Issue tracker: Local Markdown\n\n议题放 .scratch/。历史资料里提到过 GitLab，但这里不用它。\n'
const DECL_GITLAB = '# Issue tracker: GitLab\n\nIssues live as GitLab issues.\n'
const DECL_GITLAB_TEMPLATE = fs.readFileSync(path.join(ROOT, 'package/bundled-skills/setup-matt-pocock-skills/issue-tracker-gitlab.md'), 'utf8')
const DECL_NO_TITLE_WITH_GITLAB = '以前这里用 GitLab 管票，后来迁到别处了。\n'

async function main() {
  console.log('GitLab 认领的声明判据（#1555：提及不是声明，与判定层同一把尺子）')

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ① 提及不是声明：声明别的后端、正文提到 GitLab → 不认领 ==')

  check((await claimedByDoc(DECL_GITHUB_WITH_MENTION, GITHUB_CONFIG)) === false, '声明 GitHub、正文提到 GitLab、远端是 GitHub → GitLab 不认领')
  check((await claimedByDoc(DECL_LOCAL_WITH_MENTION)) === false, '声明 Local Markdown、正文提到 GitLab → GitLab 不认领')
  check((await claimedByDoc(DECL_GITHUB_WITH_MENTION)) === false, '只有声明 GitHub 提到 GitLab、没有任何远端 → 也不认领（旧写法在这里会认领）')

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ② 声明仍是声明：标题写着 GitLab 的文件照旧认领 ==')

  check((await claimedByDoc(DECL_GITLAB)) === true, '标题 # Issue tracker: GitLab → 认领（声明层仍然算数）')
  check((await claimedByDoc(DECL_GITLAB_TEMPLATE)) === true, '随包的 GitLab 模板（标题+正文）→ 认领')
  check((await claimedByDoc(DECL_GITLAB, GITLAB_CONFIG)) === true, '声明 GitLab 且远端也是 GitLab → 认领')

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ③ 与判定层同答案：同一个文档，matches 与 parseIssueTracker 一致 ==')

  // ③ 与 #1572 不变式共用这一份文档清单：同一批文档只写一遍，避免两处清单慢慢漂开。
  const parityDocs: Array<[string, string]> = [
    ['GitHub + 正文提及', DECL_GITHUB_WITH_MENTION],
    ['Local Markdown + 正文提及', DECL_LOCAL_WITH_MENTION],
    ['标题 GitLab', DECL_GITLAB],
    ['随包 GitLab 模板', DECL_GITLAB_TEMPLATE],
  ]
  for (const [label, doc] of parityDocs) {
    const parsed = parseIssueTracker(normalizeTrackerText(doc))
    const declaredByTitle = !!(parsed && parsed.confidence === 'high' && parsed.explicitBackendId === 'gitlab')
    const got = await claimedByDoc(doc)
    check(got === declaredByTitle, '「' + label + '」matches=' + got + ' 与解析器的高置信结论=' + declaredByTitle + ' 一致')
  }
  // 无标题的旧文档：判定层会按 low 兜底认出 GitLab，但认领（matches）不拿 low 去制造多命中 ——
  // 正文里只要有一句 gitlab 就参与身份认领，正是 #1555 真机上多命中的来源。
  {
    const parsed = parseIssueTracker(normalizeTrackerText(DECL_NO_TITLE_WITH_GITLAB))
    check(!!(parsed && parsed.confidence === 'low' && parsed.explicitBackendId === 'gitlab'), '无标题旧文档：解析器照旧给 low 的 gitlab（判定层用得到）')
    check((await claimedByDoc(DECL_NO_TITLE_WITH_GITLAB)) === false, '无标题旧文档：认领不拿 low 兜底当身份（否则正文提一句就多命中）')
  }
  // #1572 加的一条不变式：认领一旦为真，判定层对同一份文档必须是高置信 ——
  // 两层可以「判定认低置信线索、认领不认」，但不能反过来让认领比判定更宽。
  // 同时数一遍真被认领的文档数：这份清单里至少要有两份认领为真，否则循环一行断言都不跑，
  // 门禁就成了永远变绿的摆设。
  let claimedCount = 0
  for (const [label, doc] of parityDocs.concat([['无标题旧文档', DECL_NO_TITLE_WITH_GITLAB]] as Array<[string, string]>)) {
    if ((await claimedByDoc(doc)) !== true) continue
    claimedCount += 1
    const parsed = parseIssueTracker(normalizeTrackerText(doc))
    check(!!(parsed && parsed.confidence === 'high'), '认领为真 ⇒ 判定层高置信（' + label + '，#1572）')
  }
  check(claimedCount >= 2, '#1572 不变式不是空转：清单里至少两份文档真被认领', 'claimed=' + claimedCount)

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ④ 现场事实照旧：远端地址与 git remote 兜底 ==')

  {
    const ws = newWorkspace()
    put(ws, '.git/config', GITLAB_CONFIG)
    put(ws, 'docs/agents/issue-tracker.md', DECL_GITHUB_WITH_MENTION)
    const hit = await gitlabBackend.matches({ cwd: ws } as never, ctxOf(ws) as never)
    check(hit === true, '.git/config 的远端确实是 GitLab → 认领（现场事实优先于声明）')
  }
  {
    const ws = newWorkspace()
    const hit = await gitlabBackend.matches({ cwd: ws } as never, ctxOf(ws, async () => ({ stdout: 'git@gitlab.com:acme/demo.git\n', stderr: '', code: 0 })) as never)
    check(hit === true, '两处文件都不在、git remote 回 GitLab 地址 → 认领（兜底还在）')
  }
  {
    const ws = newWorkspace()
    put(ws, '.git/config', '[branch "ticket/1187-gitlab-chain-predicates"]\n\tremote = origin\n' + GITHUB_CONFIG)
    put(ws, 'docs/agents/issue-tracker.md', '# Issue tracker: GitHub\n')
    const hit = await gitlabBackend.matches({ cwd: ws } as never, ctxOf(ws) as never)
    check(hit === false, '分支名带 gitlab 但远端是 GitHub → 不认领（#1533 的修复不许退回去）')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n== ⑤ 单一实现：判定层旧路径与内核里那份是同一个函数 ==')

  check(parseFromDetection === parseIssueTracker, 'detection/parseIssueTracker 转出的是内核里同一个函数（不是第二份拷贝）')
  check(typeof normalizeTrackerText === 'function' && normalizeTrackerText('a\\nb\\nc') === 'a\nb\nc', 'normalizeTrackerText 跟随搬去内核，字面换行还原行为不变')

  // ── 本门禁必须在 verify 链里（不挂进链就等于没跑；#1125 起问规划函数）──
  {
    const mine = planGates(ROOT).filter((s: { file: string }) => s.file.indexOf('verify-1555-gitlab-claim-declaration') >= 0)
    check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
  }

  console.log('\nverify-1555-gitlab-claim-declaration: ' + (failed ? '有失败项' : '全部通过'))
  if (failed) process.exit(1)
  console.log('GITLAB CLAIM DECLARATION OK')
}

main().catch((e) => {
  console.log('  FAIL 门禁抛错：' + String((e && (e as Error).message) || e))
  process.exit(1)
})
