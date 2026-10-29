// two-instance-smoke —— 从零跑一次双实例冒烟：证明这套工具在一个从没跑过真机验证的工作区里，
// 只靠仓库里的命令就能复制隔离 home、造两种后端的工作区、起两个实例、在浏览器里核对、收证据、停实例。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/two-instance-smoke.mts
//         [--batch <批次目录>]        默认 <工作根>/batches/smoke-<时间戳>
//         [--source-home <DSH_HOME>]  复制来源，默认当前用户真实 DSH home
//         [--template <目录>]         改用候选 home 模板复制（冻结过的模板）
//         [--name dsh-mattpocock-skills-deck] [--profile web]
//         [--source-repo <仓库>]      GitHub 工作区取哪个仓库的提交，默认本仓库
//         [--commit <提交>]           默认取源仓库当前 HEAD
//         [--timeout 120000]          单个实例启动超时
//
// 这个命令的每一步都用仓库里的库函数完成，不依赖上一步留下的文本约定，也不写死任何版本号：
// 版本身份检查改成「两个实例装的是同一版插件」，具体版本号写进证据，过时不会误红。
//
// 输出：一段 JSON 摘要；详细证据在 <批次>/evidence/（evidence.json 带每个文件的 SHA256）。
// 两个实例在结束前都会被停掉；失败也会停（finally）。GitHub 工作区是源仓库的 git worktree，
// 批次目录删掉之后记得在源仓库跑一次 git worktree prune 清掉登记。

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, printJson, runCli, ensureDir, exists, stamp, info, formatMs, assert, dirStats, writeJson } from '../lib/util.mts'
import { repo, workRoot, assertWritableTarget, realDshHome } from '../lib/paths.mts'
import { copyWebProfile } from '../lib/home.mts'
import { seedWorkspaceRegistry } from '../lib/home.mts'
import { createGithubWorkspace, createMarkdownWorkspace, writeWorkspaceManifest } from '../lib/workspaces.mts'
import { probeSettingsIsolation } from '../lib/isolation.mts'
import { startInstance, stopInstance, type Instance } from '../lib/launch.mts'
import { launchBrowser, newPage, openApp, sessionList, workspaceMenuTitles } from '../lib/browser.mts'
import { createEvidence } from '../lib/evidence.mts'
import { findLogFile, readLogEvents, summarizeLogEvents } from '../lib/logs.mts'
import { findInstalledPackage } from '../lib/candidate.mts'

interface InstanceReport {
  name: string
  instance: Instance | null
  home: string
  homeCopy: { files: number; bytes: number; copyMs: number }
  workspace: { dir: string; title: string; kind: string; backendId: string }
  pluginVersion: string | null
  logFile: string | null
  logEvents: number
  logEventNames: string[]
  workspaceTitles: string[]
  sessionCwd: string
  screenshotPath: string
  pageErrors: string[]
  consoleLines: string[]
  startReadyMs: number
  browserOpenMs: number
  stopped: boolean
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const repository = repo()
  const batch = path.resolve(args.get('batch') || path.join(workRoot(), 'batches', 'smoke-' + stamp()))
  assertWritableTarget(batch)
  ensureDir(batch)
  const profile = args.get('profile') || 'web'
  const pluginName = args.get('name') || 'dsh-mattpocock-skills-deck'
  const sourceHome = args.get('source-home') || realDshHome()
  const template = args.get('template')
  const timeoutMs = args.get('timeout') ? Number(args.get('timeout')) : 120000
  const sourceRepo = path.resolve(args.get('source-repo') || repository)
  const commit = args.get('commit') || ''
  const startedAt = Date.now()
  assert(!template || exists(template), '给定 --template 目录不存在：' + template)

  const evidence = createEvidence(batch, {
    ticket: '1645',
    purpose: '从零双实例冒烟：隔离 home、两种工作区后端、端口/日志/设置互不串味',
    pluginName,
    profile,
    sourceHome: template ? template : sourceHome,
  })
  const check = (name: string, ok: boolean, detail = ''): boolean => {
    evidence.check(name, ok, detail)
    return ok
  }

  // 1. 复制两份隔离 home。
  const copyStarted = Date.now()
  const homeA = path.join(batch, 'home-a')
  const homeB = path.join(batch, 'home-b')
  const copyA = copyWebProfile({ home: homeA, template, sourceHome: template ? undefined : sourceHome, profile, force: true })
  const copyB = copyWebProfile({ home: homeB, template, sourceHome: template ? undefined : sourceHome, profile, force: true })
  const copyMs = Date.now() - copyStarted
  check('隔离 home A 已复制', copyA.files > 0, copyA.files + ' 个文件 / ' + copyA.bytes + ' 字节')
  check('隔离 home B 已复制', copyB.files > 0, copyB.files + ' 个文件 / ' + copyB.bytes + ' 字节')
  const homeStatsA = copyA
  const homeStatsB = copyB
  info('两份 home 复制完成，共 ' + formatMs(copyMs))

  // 2. 造两种后端的工作区：A 用 GitHub 后端（源仓库的冻结提交），B 用 Markdown 后端（长名字夹具）。
  const workspacesDir = path.join(batch, 'workspaces')
  ensureDir(workspacesDir)
  const workspaceA = await createGithubWorkspace({
    dir: path.join(workspacesDir, 'ws-github'),
    sourceRepo,
    commit: commit || undefined,
    force: true,
  })
  const workspaceB = await createMarkdownWorkspace({ dir: path.join(workspacesDir, 'ws-markdown'), force: true })
  writeWorkspaceManifest(batch, [workspaceA, workspaceB])
  check('GitHub 后端工作区已生成', exists(path.join(workspaceA.dir, '.git')), workspaceA.dir)
  check('Markdown 后端工作区已生成', exists(path.join(workspaceB.dir, '.scratch')), workspaceB.dir)

  // 3. 把工作区登记进各自的 home（无头环境点不了原生目录选择器，所以直接写 storage）。
  seedWorkspaceRegistry(homeA, [{ path: workspaceA.dir, title: workspaceA.title }], { defaultPath: workspaceA.dir })
  seedWorkspaceRegistry(homeB, [{ path: workspaceB.dir, title: workspaceB.title }], { defaultPath: workspaceB.dir })
  check('home A 的工作区登记已写入', true, workspaceA.title)
  check('home B 的工作区登记已写入', true, workspaceB.title)

  // 4. 隔离探针：证明 USERPROFILE 重定向生效，且真实用户设置文件在冒烟前后哈希不变。
  const isolation = await probeSettingsIsolation({ batchDir: batch })
  evidence.addJson('isolation-probe', isolation, '隔离探针结论：重定向生效、真实设置未被写')
  check('设置隔离探针通过', isolation.ok, isolation.reason || 'USERPROFILE 重定向生效')
  check('真实用户设置文件未被改动', isolation.realUnchanged !== false, isolation.realSettingsPath || '')

  const reports: InstanceReport[] = []
  let browser: any = null
  try {
    // 5. 起两个实例（各自端口 0、各自启动目录）。
    const startedA = Date.now()
    const instances = await Promise.all([
      startInstance({ home: homeA, dir: path.join(batch, 'run-a'), profile, port: 0, timeoutMs }),
      startInstance({ home: homeB, dir: path.join(batch, 'run-b'), profile, port: 0, timeoutMs }),
    ])
    const [instanceA, instanceB] = instances
    check('两个实例的端口不同', instanceA.port !== instanceB.port, instanceA.port + ' vs ' + instanceB.port)

    // 6. 一个浏览器、两个独立上下文：分别打开、读菜单与会话 cwd、截图。
    browser = await launchBrowser()
    const specs = [
      { name: 'A', instance: instanceA, home: homeA, copy: homeStatsA, workspace: workspaceA, expectCwd: workspaceA.dir },
      { name: 'B', instance: instanceB, home: homeB, copy: homeStatsB, workspace: workspaceB, expectCwd: workspaceB.dir },
    ]
    for (const spec of specs) {
      const created = await newPage(browser)
      const opened = {
        browser,
        context: created.context,
        page: created.page,
        tokenUrl: spec.instance.tokenUrl,
        consoleLines: created.consoleLines,
        pageErrors: created.pageErrors,
        close: async () => {
          await created.context.close().catch(() => undefined)
        },
      }
      const browserStarted = Date.now()
      await openApp(opened, Math.max(timeoutMs, 60000))
      const browserOpenMs = Date.now() - browserStarted
      const titles = await workspaceMenuTitles(opened.page)
      const listResponse = await sessionList(opened.page)
      const items = listResponse && listResponse.body && listResponse.body.result && listResponse.body.result.value && listResponse.body.result.value.items
      const cwd = items && items[0] ? String(items[0].cwd || '') : ''
      const shot = await evidence.addScreenshot(opened.page, 'browser-' + spec.name.toLowerCase(), {
        note: '实例 ' + spec.name + ' 打开后的界面',
      })
      const screenshotPath = path.join(batch, shot.file)

      const installed = findInstalledPackage(spec.home, profile, pluginName)
      let logFile: string | null = null
      let logEvents = 0
      let logEventNames: string[] = []
      try {
        logFile = findLogFile(spec.instance.dir)
        const read = readLogEvents(logFile)
        logEvents = read.events.length
        logEventNames = Object.keys(summarizeLogEvents(read.events).byEvent).slice(0, 30)
        evidence.addLogSlice('log-' + spec.name.toLowerCase(), logFile, read.events.slice(0, 200).map((event) => JSON.stringify(event)))
      } catch {
        logFile = null
      }

      const report: InstanceReport = {
        name: spec.name,
        instance: spec.instance,
        home: spec.home,
        homeCopy: { files: spec.copy.files, bytes: spec.copy.bytes, copyMs: spec.copy.copyMs },
        workspace: { dir: spec.workspace.dir, title: spec.workspace.title, kind: spec.workspace.kind, backendId: spec.workspace.backendId },
        pluginVersion: installed ? installed.version : null,
        logFile,
        logEvents,
        logEventNames,
        workspaceTitles: titles,
        sessionCwd: cwd,
        screenshotPath,
        pageErrors: opened.pageErrors.slice(0, 10),
        consoleLines: opened.consoleLines.slice(0, 20),
        startReadyMs: spec.instance.readyMs,
        browserOpenMs,
        stopped: false,
      }
      reports.push(report)
      evidence.addJson('instance-' + spec.name.toLowerCase(), report, '实例 ' + spec.name + ' 的运行事实')

      check('实例 ' + spec.name + ' 的工作区菜单包含自己的标题', titles.some((title) => title.indexOf(spec.workspace.title) >= 0), '菜单：' + titles.join('、'))
      check(
        '实例 ' + spec.name + ' 的会话 cwd 指向自己的工作区',
        cwd.toLowerCase().indexOf(spec.expectCwd.toLowerCase()) >= 0,
        'cwd：' + cwd,
      )
      check('实例 ' + spec.name + ' 页面没有脚本异常', opened.pageErrors.length === 0, opened.pageErrors.slice(0, 3).join('\n') || '没有')
      check('实例 ' + spec.name + ' 插件日志可读', logEvents > 0, String(logFile) + '（' + logEvents + ' 条事件）')
      await opened.close()
    }

    const reportA = reports[0]
    const reportB = reports[1]
    check('两个实例的插件版本一致', Boolean(reportA.pluginVersion) && reportA.pluginVersion === reportB.pluginVersion, reportA.pluginVersion + ' / ' + reportB.pluginVersion)
    check(
      '两个实例的插件日志目录不同',
      Boolean(reportA.logFile) && Boolean(reportB.logFile) && path.dirname(String(reportA.logFile)) !== path.dirname(String(reportB.logFile)),
      String(reportA.logFile) + ' vs ' + String(reportB.logFile),
    )
    check(
      '两个实例的启动目录不同',
      Boolean(reportA.instance) && Boolean(reportB.instance) && reportA.instance!.dir !== reportB.instance!.dir,
      String(reportA.instance ? reportA.instance.dir : '') + ' vs ' + String(reportB.instance ? reportB.instance.dir : ''),
    )
  } finally {
    // 7. 不管成功失败都停实例、收浏览器，避免留下后台进程。
    if (browser) await browser.close().catch(() => undefined)
    for (const report of reports) {
      if (!report.instance) continue
      try {
        await stopInstance(report.instance.dir)
        report.stopped = true
      } catch {
        report.stopped = false
      }
    }
    // 起过但没来得及进 reports 的实例也要停：按批次下的 run-* 目录兜底。
    for (const name of ['run-a', 'run-b']) {
      const dir = path.join(batch, name)
      const instanceFile = path.join(dir, 'instance.json')
      if (!exists(instanceFile)) continue
      try {
        await stopInstance(dir)
      } catch {
        // 已经停掉就忽略
      }
    }
  }

  // 8. 汇总、写证据清单。
  const summary = {
    generatedAt: new Date().toISOString(),
    batch,
    profile,
    pluginName,
    sourceHome: template ? 'template:' + template : sourceHome,
    sourceRepo,
    elapsedMs: Date.now() - startedAt,
    copyMs,
    ports: reports.map((report) => (report.instance ? report.instance.port : null)),
    instances: reports.map((report) => ({
      name: report.name,
      home: report.home,
      workspace: report.workspace,
      pluginVersion: report.pluginVersion,
      logFile: report.logFile,
      logEvents: report.logEvents,
      startReadyMs: report.startReadyMs,
      browserOpenMs: report.browserOpenMs,
      sessionCwd: report.sessionCwd,
      workspaceTitles: report.workspaceTitles,
      stopped: report.stopped,
    })),
    isolation: {
      ok: isolation.ok,
      realSettingsPath: isolation.realSettingsPath,
      realUnchanged: isolation.realUnchanged,
      realSettingsHashBefore: isolation.realHashBefore,
      realSettingsHashAfter: isolation.realHashAfter,
    },
    workspaces: [
      { kind: workspaceA.kind, dir: workspaceA.dir, title: workspaceA.title, backendId: workspaceA.backendId },
      { kind: workspaceB.kind, dir: workspaceB.dir, title: workspaceB.title, backendId: workspaceB.backendId },
    ],
    checks: evidence.checks(),
    batchStats: dirStats(batch),
  }
  writeJson(path.join(batch, 'smoke-summary.json'), summary)
  const finished = evidence.finish(summary, { extra: { summaryPath: path.join(batch, 'smoke-summary.json') } })

  const failed = summary.checks.filter((entry) => !entry.ok)
  printJson({
    ok: failed.length === 0,
    batch,
    manifestPath: finished.manifestPath,
    elapsedMs: summary.elapsedMs,
    copyMs,
    ports: summary.ports,
    pluginVersions: reports.map((report) => report.pluginVersion),
    logEvents: reports.map((report) => report.logEvents),
    isolationOk: isolation.ok,
    realSettingsUnchanged: isolation.realUnchanged,
    failedChecks: failed,
    checksPassed: summary.checks.length - failed.length,
    checksTotal: summary.checks.length,
  })
  if (failed.length > 0) throw new Error('双实例冒烟有 ' + failed.length + ' 条检查未通过，详见 ' + finished.manifestPath)
})
