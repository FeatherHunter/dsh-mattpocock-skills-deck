// freeze-candidate —— 一条命令把「候选包」冻结成可复核的东西：构建 → 打包 → 逐文件 SHA256 清单
// → 装进隔离 home → 核对安装目录与界面加载的版本串。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/freeze-candidate.mts
//         [--out <目录>]            候选清单与 tgz 的落点，默认 <工作根>/pkg
//         [--home <隔离home>]       装候选的隔离 home，默认 <工作根>/homes/candidate
//         [--name dsh-mattpocock-skills-deck] [--profile web]
//         [--install-method extract|cli|none]  默认 extract（见下）
//         [--skip-build]            复用已有构建产物（不相信构建缓存时别加）
//         [--allow-dirty]           工作树有未提交改动也继续冻结（清单里如实记录）
//         [--no-ui]                 不启动界面核对版本串
//         [--ticket 1645]           记录这张候选属于哪张票
//         [--timeout 600000]
//
// 输出：一段 JSON 摘要（清单路径、版本、提交、tgz 哈希、文件数、清单摘要、安装与界面核对结论）。
// 完整清单写在 <out>/candidate.json，逐文件哈希在里面。
//
// 两条设计决定，都有实测依据：
//   1. 默认用「解 tgz 覆盖隔离 home 的插件目录」的方式安装。真机 profile 的 pnpm 记录着安装时
//      用的 store 在哪块盘，home 换到另一块盘时 dsh plugin add 会被 pnpm 拒绝（跨盘不能硬链接）。
//      默认解包法不依赖 pnpm 与网络，任何盘都能用，并且会逐文件核对解出来的内容与清单一致。
//      要验证真实安装命令时用 --install-method cli，命令会先判断是否同盘，不同盘直接说清楚原因。
//   2. 「同一提交重复运行得到相同清单」是被比较出来的，不是口头保证：再次运行时如果读到同一提交的
//      旧清单，会对比清单摘要；不一致就报错并列出哪些文件变了。

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, printJson, runCli, exists, readJson, writeJson, ensureDir, formatMs, info, assert, sha256Text } from '../lib/util.mts'
import { repo, workRoot, assertWritableTarget, realDshHome } from '../lib/paths.mts'
import {
  buildPackage,
  findInstalledPackage,
  gitState,
  installCandidateByCli,
  installCandidateByExtract,
  manifestDigest,
  packCandidate,
  readPackageVersion,
  readRecordedStoreDir,
  sameVolume,
  type CandidateFile,
} from '../lib/candidate.mts'
import { copyWebProfile } from '../lib/home.mts'
import { startInstance, stopInstance } from '../lib/launch.mts'
import { launchBrowser, newPage, openApp, screenshot } from '../lib/browser.mts'

interface FrozenManifest {
  schemaVersion: 1
  generatedAt: string
  tool: string
  ticket: string | null
  candidateName: string
  version: string
  git: { commit: string; branch: string; clean: boolean; dirtyFiles: string[] }
  build: { skipped: boolean; command: string; exitCode: number | null; elapsedMs: number }
  package: {
    tgzPath: string
    tgzBytes: number
    tgzSha256: string
    filename: string
    npmShasum: string
    npmIntegrity: string
    npmPackSourceDir: string
    npmPackCommand: string
    fileCount: number
    files: CandidateFile[]
    manifestDigest: string
  }
  install: Record<string, any> | null
  ui: Record<string, any> | null
  reproducible: { previousManifestDigest: string | null; sameAsPrevious: boolean | null; previousCommit: string | null } | null
}

/** 列出两份文件清单的差异，供「重复运行结果不一致」时报错用。 */
function diffFiles(previous: CandidateFile[], current: CandidateFile[]): string[] {
  const before = new Map(previous.map((item) => [item.path, item.sha256]))
  const after = new Map(current.map((item) => [item.path, item.sha256]))
  const out: string[] = []
  for (const [file, hash] of after) {
    if (!before.has(file)) out.push('新增：' + file)
    else if (before.get(file) !== hash) out.push('内容变了：' + file)
  }
  for (const file of before.keys()) {
    if (!after.has(file)) out.push('删除了：' + file)
  }
  return out.slice(0, 30)
}

/**
 * 从页面已加载的资源里找插件 client 包，重新取一次内容并读界面版本串。
 *
 * 注意宿主是把多个插件的 client.js 合成一次请求发出来的（地址形如 /plugins/??a/client.js,b/client.js），
 * 取回来的内容比插件自己的 lib/client.js 大得多，所以不能拿整段内容的哈希去和安装目录比；
 * 这里比的是「这段加载出来的内容里，我们这一版的版本常量是不是期望值」，并确认内容里确实带上了本插件名。
 */
async function readUiVersion(page: any, pluginName: string, timeoutMs: number): Promise<{
  clientUrl: string
  bundleBytes: number
  bundleSha256: string
  versionConstant: string | null
  versionConstantCount: number
  includesPluginId: boolean
}> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const entry = await page.evaluate((name: string) => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const hit = resources.find((item) => item.name.includes(name + '/client.js'))
      return hit ? hit.name : null
    }, pluginName)
    if (entry) {
      const text = await page.evaluate(async (url: string) => {
        const response = await fetch(url)
        return await response.text()
      }, entry)
      const match = /DSW_VERSION\s*=\s*"([^"]+)"/.exec(text)
      const count = (text.match(/DSW_VERSION\s*=\s*"[^"]+"/g) || []).length
      return {
        clientUrl: String(entry),
        bundleBytes: Buffer.byteLength(text, 'utf8'),
        bundleSha256: sha256Text(text),
        versionConstant: match ? match[1] : null,
        versionConstantCount: count,
        includesPluginId: text.indexOf(pluginName) >= 0,
      }
    }
    await page.waitForTimeout(300)
  }
  throw new Error('界面加载的资源里没有找到 ' + pluginName + '/client.js；页面可能没进到插件加载阶段（看 <out>/evidence 里的截图与页面诊断）。')
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const repository = repo()
  const out = path.resolve(args.get('out') || path.join(workRoot(), 'pkg'))
  const pluginName = args.get('name') || 'dsh-mattpocock-skills-deck'
  const profile = args.get('profile') || 'web'
  const installMethod = (args.get('install-method') || 'extract') as 'extract' | 'cli' | 'none'
  assert(['extract', 'cli', 'none'].includes(installMethod), '--install-method 只能是 extract、cli 或 none')
  const home = path.resolve(args.get('home') || path.join(workRoot(), 'homes', 'candidate'))
  assertWritableTarget(out)
  assertWritableTarget(path.join(workRoot(), 'homes'))
  assertWritableTarget(home)
  ensureDir(out)
  const timeoutMs = args.get('timeout') ? Number(args.get('timeout')) : undefined

  // 1. 记下这次冻结的身份：提交、分支、工作树状态。工作树不干净时默认拒绝冻结，
  //    因为「同提交同清单」的前提是源码没有在冻结之后被静默改动。
  const git = gitState(repository)
  const clean = git.dirtyFiles.length === 0
  if (!clean && !args.has('allow-dirty')) {
    throw new Error(
      '工作树里有未提交的改动，冻结出的清单无法代表这个提交：\n  ' +
        git.dirtyFiles.join('\n  ') +
        '\n先提交再冻结，或加 --allow-dirty 把改动如实记进清单。',
    )
  }

  // 2. 构建（除非明确要求复用现有产物）与打包。
  let build: FrozenManifest['build']
  const buildStarted = Date.now()
  if (args.has('skip-build')) {
    build = { skipped: true, command: 'node scripts/build.mts --pkg-only', exitCode: null, elapsedMs: 0 }
  } else {
    const result = buildPackage({ repo: repository, timeoutMs })
    build = {
      skipped: false,
      command: [result.argv[0], path.relative(repository, result.argv[1]), result.argv[2]].join(' '),
      exitCode: result.exitCode,
      elapsedMs: result.elapsedMs,
    }
    info('构建完成，用时 ' + formatMs(result.elapsedMs))
  }

  const packageDir = path.join(repository, 'package')
  const version = readPackageVersion(packageDir)
  const pack = packCandidate({ packageDir, destinationDir: out, timeoutMs })
  const digest = manifestDigest({ version, commit: git.commit, files: pack.files })

  // 3. 与上一次同提交的清单对比：不一致就说明「同一提交重复运行得到相同清单」不成立，直接报错。
  const manifestPath = path.join(out, 'candidate.json')
  let previous: FrozenManifest | null = null
  if (exists(manifestPath)) {
    try {
      previous = readJson<FrozenManifest>(manifestPath)
    } catch {
      previous = null
    }
  }
  let reproducible: FrozenManifest['reproducible'] = null
  if (previous) {
    const previousDigest = previous.package && previous.package.manifestDigest ? previous.package.manifestDigest : null
    const previousCommit = previous.git ? previous.git.commit : null
    if (previousCommit === git.commit && previousDigest) {
      if (previousDigest !== digest) {
        const changes = diffFiles((previous.package && previous.package.files) || [], pack.files)
        throw new Error(
          '同一提交(' + git.commit.slice(0, 12) + ')重复冻结得到了不同的清单，说明构建或打包不稳定：\n  ' +
            changes.join('\n  '),
        )
      }
      reproducible = { previousManifestDigest: previousDigest, sameAsPrevious: true, previousCommit }
      info('与上次同提交的清单一致（摘要 ' + digest.slice(0, 12) + '）')
    } else {
      reproducible = { previousManifestDigest: previousDigest, sameAsPrevious: null, previousCommit }
    }
  }

  // 4. 装进隔离 home。
  let install: Record<string, any> | null = null
  if (installMethod !== 'none') {
    if (!exists(path.join(home, 'profiles', profile))) {
      copyWebProfile({ home, sourceHome: args.get('source') || realDshHome(), profile })
    }
    if (installMethod === 'cli') {
      const recordedStoreDir = readRecordedStoreDir(home, profile)
      if (recordedStoreDir && !sameVolume(home, recordedStoreDir)) {
        throw new Error(
          '隔离 home 与真机 profile 记录的 pnpm store 不在同一块盘，dsh plugin add 会被 pnpm 拒绝：\n' +
            '  home: ' + home + '\n  store: ' + recordedStoreDir +
            '\n用 --install-method extract（默认），或把 home 放到与 store 同一块盘。',
        )
      }
      const cliResult = installCandidateByCli({ home, profile, tgzPath: pack.tgzPath, timeoutMs })
      const installed = findInstalledPackage(home, profile, pluginName)
      assert(installed, 'dsh plugin add 说成功了，但在隔离 home 里找不到插件目录：' + home)
      const expectedClientSha = pack.files.find((item) => item.path === 'lib/client.js')
      const clientMatches = Boolean(expectedClientSha && expectedClientSha.sha256 === installed.clientSha256)
      install = {
        method: 'cli',
        home,
        profile,
        pluginDir: installed.dir,
        elapsedMs: cliResult.elapsedMs,
        packageVersion: installed.version,
        clientJsSha256: installed.clientSha256,
        clientMatchesBuilt: clientMatches,
        versionConstant: installed.versionConstant,
        recordedStoreDir,
        command: cliResult.argv,
      }
      assert(clientMatches, '安装后的 lib/client.js 与构建产物的哈希不一致，说明装进去的不是这次冻结的包')
    } else {
      const extractResult = installCandidateByExtract({ home, profile, name: pluginName, tgzPath: pack.tgzPath, manifest: pack.files })
      const installed = findInstalledPackage(home, profile, pluginName)
      assert(installed, '解包安装后找不到插件目录：' + home)
      install = {
        method: 'extract',
        home,
        profile,
        pluginDir: installed.dir,
        files: extractResult.files,
        bytes: extractResult.bytes,
        manifestMatched: extractResult.manifestMatched,
        mismatches: extractResult.mismatches,
        packageVersion: installed.version,
        clientJsSha256: installed.clientSha256,
        versionConstant: installed.versionConstant,
      }
      assert(extractResult.manifestMatched, '解包安装后的文件与清单不一致：' + extractResult.mismatches.join('、'))
    }
    // 安装结果必须自证身份：包版本与界面版本常量都要指向这一版。
    assert(install.packageVersion === version, '装进隔离 home 的包版本是 ' + install.packageVersion + '，不是这次冻结的 ' + version)
    const expectedConstant = 'v' + version
    assert(
      install.versionConstant === expectedConstant,
      '安装目录 lib/client.js 里的界面版本常量是 ' + String(install.versionConstant) + '，期望 ' + expectedConstant,
    )
  }

  // 5. 界面核对：起实例、打开页面、找到插件 client 包、读它真正加载出来的版本串。
  let ui: Record<string, any> | null = null
  const uiEnabled = !args.has('no-ui') && installMethod !== 'none'
  if (uiEnabled) {
    const runDir = path.join(out, 'run-ui')
    const evidenceDir = path.join(out, 'evidence')
    ensureDir(evidenceDir)
    const instance = await startInstance({ home, dir: runDir, profile, port: 0 })
    let browser: any = null
    try {
      browser = await launchBrowser()
      const created = await newPage(browser)
      const opened = {
        browser,
        context: created.context,
        page: created.page,
        tokenUrl: instance.tokenUrl,
        consoleLines: created.consoleLines,
        pageErrors: created.pageErrors,
        close: async () => {
          await created.context.close().catch(() => undefined)
        },
      }
      await openApp(opened, 60000)
      const observed = await readUiVersion(created.page, pluginName, 45000)
      const screenshotPath = path.join(evidenceDir, 'ui-loaded.png')
      await screenshot(created.page, screenshotPath)
      const probe = {
        checkedAt: new Date().toISOString(),
        home,
        instance: { pid: instance.pid, port: instance.port, readyMs: instance.readyMs, tokenUrl: instance.tokenUrl },
        expectedVersion: version,
        expectedConstant: 'v' + version,
        observed,
        matchesExpectedConstant: observed.versionConstant === 'v' + version,
        pageErrors: created.pageErrors.slice(0, 20),
        consoleErrors: created.consoleLines.slice(0, 20),
        screenshot: screenshotPath,
      }
      writeJson(path.join(evidenceDir, 'ui-probe.json'), probe)
      ui = {
        checked: true,
        versionConstant: observed.versionConstant,
        expectedConstant: 'v' + version,
        matchesExpectedConstant: probe.matchesExpectedConstant,
        clientUrl: observed.clientUrl,
        bundleBytes: observed.bundleBytes,
        bundleSha256: observed.bundleSha256,
        bundleIncludesPluginId: observed.includesPluginId,
        pageErrors: probe.pageErrors.length,
        probePath: path.join(evidenceDir, 'ui-probe.json'),
        screenshotPath,
      }
      assert(observed.versionConstant === 'v' + version, '界面加载的插件 client 版本串是 ' + String(observed.versionConstant) + '，期望 v' + version)
      assert(observed.includesPluginId, '界面加载的合并脚本里找不到插件名 ' + pluginName + '，无法确认加载的是本插件')
    } finally {
      await (browser ? browser.close().catch(() => undefined) : Promise.resolve())
      await stopInstance(runDir).catch(() => undefined)
    }
  }

  // 6. 写清单，stdout 只回摘要（逐文件清单在文件里，不刷屏）。
  const manifest: FrozenManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tool: 'scripts/real-machine/commands/freeze-candidate.mts',
    ticket: args.get('ticket') || null,
    candidateName: pluginName,
    version,
    git: { commit: git.commit, branch: git.branch, clean, dirtyFiles: git.dirtyFiles },
    build,
    package: {
      tgzPath: pack.tgzPath,
      tgzBytes: pack.tgzBytes,
      tgzSha256: pack.tgzSha256,
      filename: pack.filename,
      npmShasum: pack.npmShasum,
      npmIntegrity: pack.npmIntegrity,
      npmPackSourceDir: packageDir,
      npmPackCommand: 'npm pack --json --pack-destination ' + out,
      fileCount: pack.files.length,
      files: pack.files,
      manifestDigest: digest,
    },
    install,
    ui,
    reproducible,
  }
  writeJson(manifestPath, manifest)

  printJson({
    ok: true,
    manifestPath,
    candidateName: pluginName,
    version,
    commit: git.commit,
    branch: git.branch,
    clean,
    dirtyFileCount: git.dirtyFiles.length,
    tgzPath: pack.tgzPath,
    tgzBytes: pack.tgzBytes,
    tgzSha256: pack.tgzSha256,
    fileCount: pack.files.length,
    manifestDigest: digest,
    buildElapsedMs: build.skipped ? 0 : build.elapsedMs,
    totalElapsedMs: Date.now() - buildStarted,
    install,
    ui,
    reproducible,
  })
})
