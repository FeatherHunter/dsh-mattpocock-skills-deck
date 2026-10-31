// tests/verify-1706-gitlab-project.ts —— #1706「GitLab 沙箱项目与工作区」的自证门禁。
//
// 只走规格 #1703 定下的唯一测试接缝：命令行进程接口。本文件不 import 命令内部函数，也不读命令源码文本；
// 它起子进程跑 scripts/real-machine/commands/gitlab-sandbox.mts 与 make-workspace.mts，读 stdout 的 JSON、
// 退出码、文件副作用与假 glab 的调用记录。整个门禁不访问网络、不需要真 glab、不碰真实 DSH 配置。
//
// 覆盖的验收判据：
//   A. 建项目：先 repo create，再按 URL 编码路径读回 id / path_with_namespace / web_url；本地报 EOF 时也靠读回算成功。
//   B. 重复建同名项目：先读回，不重复建，避免账号里留重复项目。
//   C. 删项目：读回校验批次标记 → 按 id 发 DELETE → 读回 marked_for_deletion_at，才算「已标记删除」。
//   D. 已标记删除的项目再删一次：只读回，不重复 DELETE。
//   E. 删除请求已发出但读回失败：命令退出码 1、stderr 点明项目 id，批次清单保留这个 id（不丢、不假装成功）。
//   F. 没有批次清单/批次标记的项目：拒绝删除，且一次 glab 都不调。
//   G. make-workspace --kind gitlab：本地 git init + origin 指向沙箱项目 + workspace.yaml backendId=gitlab，
//      不调用 glab、不联网；缺 --project 或路径形状不对时拒绝生成。
//
// 跑法：
//   node --import ./scripts/ts-hook.mts tests/verify-1706-gitlab-project.ts
//   node --import ./scripts/ts-hook.mts tests/verify-1706-gitlab-project.ts --negative
// 正例退出码 0；--negative 走负例通道：真的起子进程跑一条会成功的命令，然后故意把期望写错，
// 证明这扇门禁的断言能红（不是删掉断言换来的红）。正例收尾还会起一份 --negative 子门禁自检，
// 这样负例本身也进了每次全链的判据。

import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT, createRealMachineHarness, samePath } from './lib/real-machine-process.ts'
import { printGateResult, scanGateResult } from './lib/gate-result.ts'

const GATE = 'verify-1706-gitlab-project'
const SELF_REL = 'tests/verify-1706-gitlab-project.ts'
const NEGATIVE = process.argv.includes('--negative')

const MARKER = '[dsh-sandbox batch=batch-gl]'

let passed = 0
let failed = 0

/** 一条断言：通过的只留一行；失败的把可定位的现场整段缩进打出来，供人直接照着查。 */
function check(ok: boolean, message: string, detail?: string): void {
  if (ok) {
    passed += 1
    console.log('  PASS ' + message)
    return
  }
  failed += 1
  console.log('  FAIL ' + message)
  if (!detail) return
  const lines = String(detail).split(/\r?\n/)
  const shown = lines.slice(0, 80)
  for (const line of shown) console.log('       | ' + line)
  if (lines.length > shown.length) console.log('       | …（还有 ' + (lines.length - shown.length) + ' 行没打出来）')
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

/** 读一个可能还不存在的 JSON 文件：文件不在或解析失败时返回 null，让断言去报红，而不是让门禁自己崩掉。 */
function readJsonIfExists(harness: ReturnType<typeof createRealMachineHarness>, relPath: string): JsonRecord | null {
  if (!harness.exists(relPath)) return null
  try {
    return asRecord(harness.readJson(relPath))
  } catch {
    return null
  }
}

function projectList(manifest: JsonRecord | null): JsonRecord[] {
  if (!manifest || !Array.isArray(manifest.projects)) return []
  const out: JsonRecord[] = []
  for (const item of manifest.projects as unknown[]) {
    const record = asRecord(item)
    if (record) out.push(record)
  }
  return out
}

function projectById(manifest: JsonRecord | null, id: number): JsonRecord | null {
  for (const record of projectList(manifest)) if (record.id === id) return record
  return null
}

function deleteCalls(calls: ReturnType<ReturnType<typeof createRealMachineHarness>['readGlabCalls']>): number {
  let count = 0
  for (const call of calls) if (JSON.stringify(call.argv).includes('"DELETE"')) count += 1
  return count
}

/** 假 glab 读回的项目对象。字段形状照 gitlab.com 的 projects API：path 是短名，path_with_namespace 是完整路径。 */
function projectJson(options: { id: number; fullPath: string; description: string; name?: string }): JsonRecord {
  const shortName = options.name || options.fullPath.split('/').pop() || options.fullPath
  return {
    id: options.id,
    name: shortName,
    path: shortName,
    path_with_namespace: options.fullPath,
    web_url: 'https://gitlab.com/' + options.fullPath,
    description: options.description,
    visibility: 'private',
    default_branch: 'main',
  }
}

/** 删除后按 id 读回的样子：路径带 -deletion_scheduled- 后缀，多出 marked_for_deletion_at/on。 */
function markedProjectJson(options: { id: number; fullPath: string; description: string }): JsonRecord {
  const shortName = (options.fullPath.split('/').pop() || options.fullPath) + '-deletion_scheduled-' + options.id
  const fullPath = options.fullPath.split('/').slice(0, -1).concat([shortName]).join('/')
  const project = projectJson({ id: options.id, fullPath: fullPath, description: options.description })
  project.name = shortName
  project.path = shortName
  project.marked_for_deletion_at = '2026-10-30T15:56:04Z'
  project.marked_for_deletion_on = '2026-10-30'
  return project
}

/** 负例：起一条真的会成功的命令（本地造 GitLab 工作区，不联网），然后故意把两处期望写错，让断言红。 */
function runNegative(harness: ReturnType<typeof createRealMachineHarness>): void {
  const batch = path.join(harness.workRoot, 'batch-negative')
  const run = harness.runCommand('make-workspace', {
    args: ['--batch', batch, '--kind', 'gitlab', '--name', 'ws-neg', '--project', 'FixtureGroup/dsh-gl-neg'],
  })
  const json = asRecord(run.json)
  check(run.exitCode === 1, '[负例] 故意把一条成功命令的退出码期望成 1：这条断言必须红', harness.formatFailure(run))
  const workspaces = json && Array.isArray(json.workspaces) ? json.workspaces : []
  const record = asRecord(workspaces[0])
  check(
    record !== null && record.backendId === 'github',
    '[负例] 故意把 backendId 期望成 github：这条断言必须红',
    harness.formatFailure(run),
  )
}

async function main(): Promise<void> {
  const harness = createRealMachineHarness({ name: 'verify-1706' })
  try {
    console.log('临时工作根：' + harness.workRoot)

    if (NEGATIVE) {
      runNegative(harness)
    } else {
      const batchGl = path.join(harness.workRoot, 'batch-gl')
      const batchWs = path.join(harness.workRoot, 'batch-ws')
      const batchEmpty = path.join(harness.workRoot, 'batch-empty')
      const project1Path = 'FixtureGroup/dsh-gl-demo'
      const project1 = projectJson({ id: 910001, fullPath: project1Path, description: MARKER + ' DSH GitLab 真机验证沙箱项目' })

      // ── A. 建项目：本地报 EOF 也要先读回，读到就算建成 ─────────────────────────
      harness.writeGlabPlan({
        rules: [
          {
            argvPrefix: ['repo', 'create'],
            exitCode: 1,
            stderr: 'Error creating project: Post "https://gitlab.com/api/v4/projects": unexpected EOF.\n',
          },
          { argvPrefix: ['api', 'projects/FixtureGroup%2Fdsh-gl-demo'], stdout: JSON.stringify(project1) + '\n' },
        ],
        default: { exitCode: 2, stderr: '假 glab：没有为这条调用安排计划\n' },
      })
      const create = harness.runCommand('gitlab-sandbox', {
        args: ['create', '--batch', batchGl, '--path', project1Path],
      })
      check(create.exitCode === 0, 'A1 建项目：本地报 EOF 但读回成功，命令仍然退出 0', harness.formatFailure(create))
      check(create.stdout.trim() !== '' && create.jsonError === '', 'A2 成功时 stdout 是单段可解析的 JSON', harness.formatFailure(create))
      const createJson = asRecord(create.json)
      const created = createJson ? asRecord(createJson.project) : null
      check(created !== null && created.id === 910001, 'A3 读回来的项目 id 写进回执', harness.formatFailure(create))
      check(created !== null && created.pathWithNamespace === project1Path, 'A4 回执里项目完整路径就是建的那个', harness.formatFailure(create))
      check(
        created !== null && created.webUrl === 'https://gitlab.com/' + project1Path,
        'A5 回执里的 web_url 是读回来的项目地址',
        harness.formatFailure(create),
      )
      check(
        created !== null && created.remoteUrl === 'https://gitlab.com/' + project1Path + '.git',
        'A6 回执给了本地 origin 要用的 remoteUrl',
        harness.formatFailure(create),
      )
      check(createJson !== null && createJson.marker === MARKER, 'A7 项目带批次标记（写进 description 的那串）', harness.formatFailure(create))
      check(
        createJson !== null && createJson.recoveredByReadback === true && createJson.createExitCode === 1,
        'A8 回执记下「建项目本地报错、靠读回确认成功」',
        harness.formatFailure(create),
      )
      check(harness.exists('batch-gl/gitlab-projects.json'), 'A9 批次清单落盘：<批次目录>/gitlab-projects.json', harness.listFiles())
      const manifest1 = readJsonIfExists(harness, 'batch-gl/gitlab-projects.json')
      check(manifest1 !== null && manifest1.marker === MARKER, 'A10 批次清单自己带批次标记', JSON.stringify(manifest1, null, 2))
      const record1 = projectById(manifest1, 910001)
      check(
        record1 !== null &&
          record1.pathWithNamespace === project1Path &&
          record1.webUrl === 'https://gitlab.com/' + project1Path,
        'A11 批次清单记下项目 id/path/web_url',
        JSON.stringify(manifest1, null, 2),
      )
      const createCalls = harness.readGlabCalls()
      check(createCalls.length === 2, 'A12 建项目只调了两次 glab：先 repo create、再按路径读回', JSON.stringify(createCalls, null, 2))
      check(
        createCalls.length >= 1 &&
          JSON.stringify(createCalls[0].argv.slice(0, 3)) === JSON.stringify(['repo', 'create', project1Path]),
        'A13 repo create 的第一个参数就是项目完整路径',
        JSON.stringify(createCalls, null, 2),
      )
      check(
        createCalls.length >= 1 &&
          createCalls[0].argv.includes('--private') &&
          createCalls[0].argv.includes('--skipGitInit') &&
          createCalls[0].argv.includes('--readme'),
        'A14 repo create 带 --private、--skipGitInit、--readme 三个参数',
        JSON.stringify(createCalls, null, 2),
      )
      let descriptionArg = ''
      if (createCalls.length >= 1) {
        const at = createCalls[0].argv.indexOf('--description')
        if (at >= 0 && at + 1 < createCalls[0].argv.length) descriptionArg = createCalls[0].argv[at + 1]
      }
      check(descriptionArg.includes(MARKER), 'A15 项目描述里写着批次标记（删除时据此判断不是别的项目）', JSON.stringify(createCalls, null, 2))
      check(
        createCalls.length >= 2 && JSON.stringify(createCalls[1].argv) === JSON.stringify(['api', 'projects/FixtureGroup%2Fdsh-gl-demo']),
        'A16 读回用 URL 编码后的项目路径',
        JSON.stringify(createCalls, null, 2),
      )

      // ── B. 重复建同名项目：先读回，不重复建 ───────────────────────────────────
      harness.writeGlabPlan({
        rules: [{ argvPrefix: ['api', 'projects/910001'], stdout: JSON.stringify(project1) + '\n' }],
        default: { exitCode: 2, stderr: '假 glab：重复建不应该再发其它调用\n' },
      })
      const beforeReuse = harness.readGlabCalls().length
      const reuse = harness.runCommand('gitlab-sandbox', { args: ['create', '--batch', batchGl, '--path', project1Path] })
      check(reuse.exitCode === 0, 'B1 重复建同名项目：读回已存在即成功', harness.formatFailure(reuse))
      const reuseJson = asRecord(reuse.json)
      check(reuseJson !== null && reuseJson.reused === true, 'B2 回执标明复用了批次清单里已有的项目', harness.formatFailure(reuse))
      const reuseCalls = harness.readGlabCalls().slice(beforeReuse)
      check(
        reuseCalls.length === 1 && !JSON.stringify(reuseCalls).includes('"repo","create"'),
        'B3 重复建不调用 repo create（避免账号里留重复项目）',
        JSON.stringify(reuseCalls, null, 2),
      )

      // ── C. 拒绝删除：项目描述里没有本批次标记 ─────────────────────────────────
      const noMarkerProject = projectJson({ id: 910001, fullPath: project1Path, description: '别的项目，没有任何批次标记' })
      harness.writeGlabPlan({
        rules: [
          { argvPrefix: ['api', 'projects/FixtureGroup%2Fdsh-gl-demo'], stdout: JSON.stringify(noMarkerProject) + '\n' },
          { argvPrefix: ['api', '--method', 'DELETE'], stdout: '{"message":"202 Accepted"}\n' },
        ],
        default: { exitCode: 2, stderr: '假 glab：被拒绝的删除不该再发调用\n' },
      })
      const beforeRefuse = harness.readGlabCalls().length
      const refuse = harness.runCommand('gitlab-sandbox', { args: ['delete', '--batch', batchGl, '--id', '910001'] })
      check(refuse.exitCode === 1, 'C1 项目描述里没有本批次标记时，删除被拒绝（退出码 1）', harness.formatFailure(refuse))
      check(refuse.stdout.trim() === '', 'C2 拒绝时 stdout 不输出半截回执', harness.formatFailure(refuse))
      check(
        refuse.stderr.includes('本批次标记') && refuse.stderr.includes('拒绝删除'),
        'C3 stderr 说清为什么拒绝：描述里没有本批次标记',
        harness.formatFailure(refuse),
      )
      const refuseCalls = harness.readGlabCalls().slice(beforeRefuse)
      check(
        refuseCalls.length === 1 && deleteCalls(refuseCalls) === 0,
        'C4 拒绝时连 DELETE 都没发出去（只读回一次）',
        JSON.stringify(refuseCalls, null, 2),
      )

      // ── D. 删项目：读回校验 → DELETE → 读回「已标记删除」 ─────────────────────
      const marked1 = markedProjectJson({ id: 910001, fullPath: project1Path, description: MARKER + ' DSH GitLab 真机验证沙箱项目' })
      harness.writeGlabPlan({
        rules: [
          { argvPrefix: ['api', 'projects/FixtureGroup%2Fdsh-gl-demo'], stdout: JSON.stringify(project1) + '\n' },
          { argvPrefix: ['api', '--method', 'DELETE', 'projects/910001'], stdout: '{"message":"202 Accepted"}\n' },
          { argvPrefix: ['api', 'projects/910001'], stdout: JSON.stringify(marked1) + '\n' },
        ],
        default: { exitCode: 2, stderr: '假 glab：删除流程不该有别的调用\n' },
      })
      const beforeDelete = harness.readGlabCalls().length
      const del = harness.runCommand('gitlab-sandbox', { args: ['delete', '--batch', batchGl, '--id', '910001'] })
      check(del.exitCode === 0, 'D1 删项目：退出码 0', harness.formatFailure(del))
      const delJson = asRecord(del.json)
      check(delJson !== null && delJson.markedForDeletion === true, 'D2 回执明确写了「已标记删除」', harness.formatFailure(del))
      const deleteResponse = delJson ? asRecord(delJson.deleteResponse) : null
      check(
        deleteResponse !== null && deleteResponse.message === '202 Accepted',
        'D3 回执保留 DELETE 的原始响应（202 Accepted）',
        harness.formatFailure(del),
      )
      const delProject = delJson ? asRecord(delJson.project) : null
      check(
        delProject !== null && delProject.status === 'marked-for-deletion' && delProject.markedForDeletionAt === '2026-10-30T15:56:04Z',
        'D4 回执记下读回来的 marked_for_deletion_at',
        harness.formatFailure(del),
      )
      const delCalls = harness.readGlabCalls().slice(beforeDelete)
      check(delCalls.length === 3, 'D5 删除流程正好三次 glab 调用：读回校验 → DELETE → 再读回确认', JSON.stringify(delCalls, null, 2))
      check(
        delCalls.length >= 2 && JSON.stringify(delCalls[1].argv) === JSON.stringify(['api', '--method', 'DELETE', 'projects/910001']),
        'D6 DELETE 按 id 删，不按路径删',
        JSON.stringify(delCalls, null, 2),
      )
      const manifest2 = readJsonIfExists(harness, 'batch-gl/gitlab-projects.json')
      const record2 = projectById(manifest2, 910001)
      check(
        record2 !== null && record2.status === 'marked-for-deletion' && record2.markedForDeletionAt === '2026-10-30T15:56:04Z',
        'D7 批次清单里这个项目的状态改成「已标记删除」',
        JSON.stringify(manifest2, null, 2),
      )

      // ── E. 已标记删除的项目再删一次：只读回，不重复 DELETE ───────────────────
      harness.writeGlabPlan({
        rules: [{ argvPrefix: ['api', 'projects/910001'], stdout: JSON.stringify(marked1) + '\n' }],
        default: { exitCode: 2, stderr: '假 glab：已标记删除的项目不该再发 DELETE\n' },
      })
      const beforeRepeat = harness.readGlabCalls().length
      const repeat = harness.runCommand('gitlab-sandbox', { args: ['delete', '--batch', batchGl, '--id', '910001'] })
      check(repeat.exitCode === 0, 'E1 已标记删除的项目再删一次：幂等退出 0', harness.formatFailure(repeat))
      const repeatJson = asRecord(repeat.json)
      check(repeatJson !== null && repeatJson.alreadyDeleted === true, 'E2 回执标明 alreadyDeleted（没有重复删除）', harness.formatFailure(repeat))
      const repeatCalls = harness.readGlabCalls().slice(beforeRepeat)
      check(
        repeatCalls.length === 1 && deleteCalls(repeatCalls) === 0,
        'E3 重复删除没有再发 DELETE（避免制造噪音）',
        JSON.stringify(repeatCalls, null, 2),
      )

      // ── F. 删除读回失败：保留项目 id，明确报错 ───────────────────────────────
      const project2Path = 'FixtureGroup/dsh-gl-second'
      const project2 = projectJson({ id: 910002, fullPath: project2Path, description: MARKER + ' DSH GitLab 真机验证沙箱项目' })
      harness.writeGlabPlan({
        rules: [
          { argvPrefix: ['repo', 'create', 'FixtureGroup/dsh-gl-second'], stdout: 'Created project ' + project2Path + '\n' },
          { argvPrefix: ['api', 'projects/FixtureGroup%2Fdsh-gl-second'], stdout: JSON.stringify(project2) + '\n' },
        ],
        default: { exitCode: 2, stderr: '假 glab：建第二个项目不该有别的调用\n' },
      })
      const create2 = harness.runCommand('gitlab-sandbox', { args: ['create', '--batch', batchGl, '--path', project2Path] })
      check(create2.exitCode === 0, 'F1 建第二个项目：repo create 正常返回后按路径读回', harness.formatFailure(create2))
      const create2Json = asRecord(create2.json)
      check(
        create2Json !== null && create2Json.recoveredByReadback === false && create2Json.createExitCode === 0,
        'F2 这次不是靠读回救场（recoveredByReadback=false）',
        harness.formatFailure(create2),
      )
      harness.writeGlabPlan({
        rules: [
          { argvPrefix: ['api', 'projects/FixtureGroup%2Fdsh-gl-second'], stdout: JSON.stringify(project2) + '\n' },
          { argvPrefix: ['api', '--method', 'DELETE', 'projects/910002'], stdout: '{"message":"202 Accepted"}\n' },
          {
            argvPrefix: ['api', 'projects/910002'],
            exitCode: 1,
            stderr: 'Get "https://gitlab.com/api/v4/projects/910002": unexpected EOF\n',
          },
        ],
        default: { exitCode: 2, stderr: '假 glab：读回失败之后不该有别的调用\n' },
      })
      const beforeFail = harness.readGlabCalls().length
      const failDel = harness.runCommand('gitlab-sandbox', { args: ['delete', '--batch', batchGl, '--id', '910002'] })
      check(failDel.exitCode === 1, 'F3 删除请求发出后读回失败：命令退出码 1（不假装成功）', harness.formatFailure(failDel))
      check(failDel.stdout.trim() === '', 'F4 失败时 stdout 不输出「已删除」的回执', harness.formatFailure(failDel))
      check(
        failDel.stderr.includes('910002') && failDel.stderr.includes('保留'),
        'F5 stderr 点明项目 id 与「id 保留在批次清单里」',
        harness.formatFailure(failDel),
      )
      const manifest3 = readJsonIfExists(harness, 'batch-gl/gitlab-projects.json')
      const recordFail = projectById(manifest3, 910002)
      check(
        recordFail !== null && recordFail.status === 'delete-failed',
        'F6 批次清单保留 id 910002、状态标成 delete-failed',
        JSON.stringify(manifest3, null, 2),
      )
      const failCalls = harness.readGlabCalls().slice(beforeFail)
      check(failCalls.length === 3 && deleteCalls(failCalls) === 1, 'F7 读回失败时也只发过一次 DELETE', JSON.stringify(failCalls, null, 2))

      // ── G. 没有批次清单的项目：拒绝删除，一次 glab 都不调 ─────────────────────
      const beforeEmpty = harness.readGlabCalls().length
      const refuseEmpty = harness.runCommand('gitlab-sandbox', { args: ['delete', '--batch', batchEmpty, '--id', '9999'] })
      check(
        refuseEmpty.exitCode === 1 && refuseEmpty.stdout.trim() === '',
        'G1 批次清单不存在时拒绝删除（退出码 1、stdout 空）',
        harness.formatFailure(refuseEmpty),
      )
      check(
        refuseEmpty.stderr.includes('没有批次标记') && refuseEmpty.stderr.includes('拒绝删除'),
        'G2 stderr 说清「没有批次标记的项目拒绝删除」',
        harness.formatFailure(refuseEmpty),
      )
      check(harness.readGlabCalls().length === beforeEmpty, 'G3 没有批次标记时一次 glab 都没调（连读回都不做）')

      // ── H. make-workspace --kind gitlab：本地空仓库 + 假 remote，不联网 ───────
      const beforeWs = harness.readGlabCalls().length
      const ws = harness.runCommand('make-workspace', {
        args: ['--batch', batchWs, '--kind', 'gitlab', '--name', 'ws-gl', '--project', project1Path],
      })
      check(ws.exitCode === 0, 'H1 make-workspace --kind gitlab：退出码 0', harness.formatFailure(ws))
      const wsJson = asRecord(ws.json)
      const workspaces = wsJson && Array.isArray(wsJson.workspaces) ? wsJson.workspaces : []
      const wsRecord = asRecord(workspaces[0])
      const wsExtra = wsRecord ? asRecord(wsRecord.extra) : null
      check(wsJson !== null && wsJson.kind === 'gitlab' && wsRecord !== null && wsRecord.backendId === 'gitlab', 'H2 回执里的 kind 与 backendId 都是 gitlab', harness.formatFailure(ws))
      const wsDir = path.join(batchWs, 'workspaces', 'ws-gl')
      check(wsRecord !== null && samePath(String(wsRecord.dir), wsDir), 'H3 工作区目录落在批次目录下的 workspaces/ws-gl', harness.formatFailure(ws))
      const gitTree = harness.runOnPath('git', ['-C', wsDir, 'rev-parse', '--is-inside-work-tree'])
      check(
        gitTree.exitCode === 0 && gitTree.stdout.trim() === 'true',
        'H4 工作区里真的有 git 仓库（.git 存在）',
        harness.formatFailure(gitTree),
      )
      const origin = harness.runOnPath('git', ['-C', wsDir, 'remote', 'get-url', 'origin'])
      check(
        origin.exitCode === 0 && origin.stdout.trim() === 'https://gitlab.com/' + project1Path + '.git',
        'H5 origin 指向沙箱项目地址',
        harness.formatFailure(origin),
      )
      const binding = harness.readText('batch-ws/workspaces/ws-gl/docs/agents/workspace.yaml')
      check(
        /backendId:\s*gitlab/.test(binding) && /version:\s*2/.test(binding),
        'H6 workspace.yaml 写 version: 2 与 backendId: gitlab',
        binding,
      )
      const wsManifest = readJsonIfExists(harness, 'batch-ws/workspaces.json')
      const wsManifestList = wsManifest && Array.isArray(wsManifest.workspaces) ? wsManifest.workspaces : []
      const wsManifestRecord = asRecord(wsManifestList[0])
      check(
        wsManifestRecord !== null && wsManifestRecord.kind === 'gitlab' && wsManifestRecord.backendId === 'gitlab',
        'H7 批次清单 workspaces.json 记下 gitlab 工作区',
        JSON.stringify(wsManifest, null, 2),
      )
      check(
        wsExtra !== null && wsExtra.project === project1Path && wsExtra.remoteUrl === 'https://gitlab.com/' + project1Path + '.git',
        'H8 回执记下 project 与 remoteUrl（会话侧据此核对仓库身份）',
        harness.formatFailure(ws),
      )
      check(harness.readGlabCalls().length === beforeWs, 'H9 造工作区不调用 glab（本地 init + remote add 即可，不联网）')
      const missingProject = harness.runCommand('make-workspace', {
        args: ['--batch', batchWs, '--kind', 'gitlab', '--name', 'ws-bad'],
      })
      check(missingProject.exitCode === 1, 'H10 不给 --project 时拒绝生成（退出码 1）', harness.formatFailure(missingProject))
      check(
        missingProject.stdout.trim() === '' && missingProject.stderr.includes('--project'),
        'H11 stderr 说清缺的是 --project',
        harness.formatFailure(missingProject),
      )
      const badProject = harness.runCommand('make-workspace', {
        args: ['--batch', batchWs, '--kind', 'gitlab', '--name', 'ws-bad', '--project', '没有斜杠'],
      })
      check(
        badProject.exitCode === 1 && badProject.stderr.includes('--project'),
        'H12 项目路径形状不对时也拒绝（必须像 group/project）',
        harness.formatFailure(badProject),
      )

      // ── I. 负例自检：正例跑一趟 --negative 子门禁，证明这扇门禁真的能红 ───────
      const negativeRun = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL, '--negative'], {
        cwd: REPO_ROOT,
        env: Object.assign({}, process.env, { DSH_VERIFY_WORK_ROOT: harness.workRoot }),
        encoding: 'utf8',
        timeout: 120000,
        windowsHide: true,
      })
      const negativeOutput = String(negativeRun.stdout || '') + String(negativeRun.stderr || '')
      const scan = scanGateResult(negativeOutput)
      check(negativeRun.status === 1, 'I1 --negative 子门禁退出码 1（负例必须能红）', negativeOutput)
      check(
        scan.record !== null && scan.record.failed >= 2 && scan.record.assertions >= 2,
        'I2 --negative 的完成记录自报至少 2 条失败断言',
        negativeOutput,
      )
      check(
        negativeOutput.includes('[负例]') && negativeOutput.includes('FAIL '),
        'I3 负例输出里能看到被故意触发的断言与失败行',
        negativeOutput,
      )
    }
  } finally {
    harness.dispose()
  }
}

main()
  .then(() => {
    console.log('')
    console.log('结果：' + passed + ' 条通过，' + failed + ' 条失败')
    printGateResult(GATE, passed + failed, failed)
    process.exitCode = failed > 0 ? 1 : 0
  })
  .catch((error: unknown) => {
    failed += 1
    console.log('  FAIL 门禁自己崩了：' + (error instanceof Error && error.stack ? error.stack : String(error)))
    printGateResult(GATE, passed + failed, failed)
    process.exitCode = 1
  })
