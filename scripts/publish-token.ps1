# dsh-mattpocock-skills-deck token 全自动发布（Windows，无人值守）。
#
# 与旧 scripts\publish-all-window.ps1 共存：旧走 schtasks 交互窗口＋人浏览器 2FA；
# 本走写权限 token，全程无需人点，Agent 可直接驱动。
# 发什么（依赖先行，顺序写死，与旧窗口一致）：
#   1. package（主插件，含捆绑技能；技能随主插件一起发，不单独发）
# 更新包 dsh-plugin-update 已搬到独立仓库维护，本仓只从 npm 取用，不再从这里发（#878）。
# 日志包 dsh-log 已搬到独立仓库维护，本仓只从 npm 取用，不再从这里发（#892）。
# private 包自动跳过（根 package.json 为 private 开发壳，不发）。
#
# 跑法（pwsh 7）—— token 放临时文件，命令行里只出现文件路径（#1646）：
#   token 以命令行参数或 `$env:NODE_AUTH_TOKEN='值'` 这种内联赋值出现时，整条命令会被原样
#   记进会话记录与进程参数（#1646 实测泄露）。所以给人 / 给 Agent 的标准姿势是：
#     1) 人把写权限 token 写进一个只给本人可读的临时文件，第一行放 token 值（不要加注释）；
#        例：$env:TEMP\dsh-publish-token.txt。这个文件不要放在仓库目录里。
#     2) 下面命令里只出现这个路径，token 值不经过命令行，也不会被记进会话记录：
#     pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt -Probe     # 写权限探针（约 5 秒，无副作用）
#     pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt -DryRun    # 只读：读表＋验 token（不查 dist-tag）
#     pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt             # 全流程：门禁(build 一次＋verify:parallel)→逐文件对账→发布→核对 tag→一次采样
#     pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt -FullPost   # 宣布前：长轮询直到包全可见
#     3) 每趟跑完立刻删掉临时文件：Remove-Item -LiteralPath $env:TEMP\dsh-publish-token.txt -Force
#   怎么收紧文件权限、怎么把值写进文件，见 docs/releases/RELEASE-RUNBOOK.md 第 12 节。
#   环境变量入口仍然兼容（-TokenEnv，缺省 NODE_AUTH_TOKEN；为空再试 NPM_TOKEN/NODE_AUTH_TOKEN），
#   但别用内联赋值那种写法，理由同上。脚本只记录 token 的来源（文件路径或变量名），从不打印值。
# 参数：
#     -RepoRoot 缺省＝本脚本上一级；-Registry 缺省 https://registry.npmjs.org/
#     -TokenFile token 文件路径（推荐入口；只取第一行非空内容，首尾空白会去掉）
#     -TokenEnv 缺省 NODE_AUTH_TOKEN（-TokenFile 没给时才用；为空再试 NPM_TOKEN）；-LogPath 缺省 <仓根>\.tmp-publish-token.log
#     -SkipGate 跳过构建与测试门禁（门禁已在别处跑绿时用；本仓 test 较重：verify＋smoke 全套）
#     -Tag       显式指定发布到哪个 dist-tag；缺省留空＝按版本形态自动决定（#1648）。
#                预发布版本（版本号里带「-」）发 beta，发布后再把 latest 也指过去；稳定版本发 latest，
#                beta 保持发布前的指向不动。registry 上 tag 只是指向某个版本的别名，包的存储不按 tag 分目录，
#                latest 指到哪，别人装的就是哪一版。
#                注（2026-10-26）：本插件的「检查更新」与 dshmarket 都只读 npm 的 latest 标签，
#                所以预发布通道也必须让 latest 指向新版本（这一步由本脚本在 publish 之后自动补）。
#                显式 -Tag 与自动推导不一致时脚本会拒绝：一个沿 latest、一个沿 beta，正是 #1648 要防的
#                「latest 与 beta 指向不一致」。
#     -Candidate 候选清单 JSON 路径（#1766）。传了才做候选审计与发布字节对账：读候选冻结那一步写出的
#                validity / sourceStable / git.commit / package.fileDigest，让 preflight 查清单票里的验证身份行
#                与差异审计，发布前再把主包指纹与候选包指纹对账。不传则按旧口径发布，只打一行 CANDIDATE-SKIP。
#
# 发布自证（#1648，机器判据，不再靠人翻日志）：
#   - 字节对账：门禁跑完先给每个待发包拍一次「逐文件清单 + 每文件 sha256」（npm pack 后用 release-integrity
#     解包计算，不比对整个 tarball 的哈希——打包元数据不稳定）。真正发布前，在包里补跑它自己的
#     prepublishOnly（npm publish 会跑、npm pack 不会跑，漏掉这一步拍到的就不是要发的字节），再拍一次清单，
#     与门禁产物逐文件比对；对不上就在发布前退出，并打印第一处差异。发布后从 registry 拉回刚发布的 tarball，
#     再拍一次、再比对（此时已知无法撤回，但必须让人看到）。
#   - dist-tag：发布前按版本形态与当前指向算出「发完应该变成什么」，发布后读回核对；不符即报错。
#   - 证据：每个实际发布包的清单统计（文件数、字节数、清单指纹）与最终 tag 指向整理成 JSON 交给
#     scripts/release-postflight.mts，发布记录评论里不再只有「发了」两个字（见 #1648 的验收判据）。
#   - 本仓有 scripts/release-integrity.mts 才启用；五仓同步的 token 协议别处没有这套脚本时记 BYTES-SKIP，
#     行为退回旧口径（-Tag 缺省 latest）并继续发布，不阻断。
#   - 候选对账（#1766）：传 -Candidate <候选清单.json> 时，先调 scripts/release-candidate-check.mts validate
#     校验候选清单（字段规则在 scripts/lib/release-candidate-audit.mts，PowerShell 不再自己写一遍），
#     再让 preflight 查清单票里的验证身份行、候选提交祖先与差异审计；发布前拍好逐文件清单后，
#     调同一个脚本的 match 把主包清单指纹与候选包指纹对账：一致记 CANDIDATE-SAME；不一致但清单票
#     有差异审计记 CANDIDATE-DIFF-AUDITED；不一致且没有审计就停下（CANDIDATE-DIFF）。
#     没传 -Candidate 记 CANDIDATE-SKIP，按旧口径发布。
#
# 快协议（受理≠可见，两者解耦）：publish exit 0（+包名@版本回执）或 E409 previously-staged
# 即证明 registry 收下，此时记 DONE（附 STAGED-待可见），不再盲等；可见性只一次采样，
# 长轮询仅 -FullPost 跑。发布侧到三包全绿即交付：安装一律用户侧做（市场升级/软件内升级/自装）。
# 退出码：0=DONE（全部受理；个别 STAGED-待可见会在行里点名）·1=失败（看 FAIL 行）·2=用法错误（缺 token/读不到 token 文件/无探针靶）。
# TOKEN-PROTOCOL v3（2026-10-02）：探针→发布→快分辨→一次采样。改动本协议时五仓同步，行首标记对齐。
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$Registry = 'https://registry.npmjs.org/',
  [string]$TokenEnv = 'NODE_AUTH_TOKEN',
  [string]$TokenFile = '',
  [string]$LogPath = '',
  [switch]$DryRun,
  [switch]$Probe,
  [switch]$FullPost,
  [switch]$SkipGate,
  [string]$Tag = '',
  [string]$Candidate = ''
)
$ErrorActionPreference = 'Continue'
if ($LogPath -eq '') { $LogPath = Join-Path $RepoRoot '.tmp-publish-token.log' }

# 依赖先行，顺序写死（与旧 publish-all-window.ps1 一致）。
$Order = @('package')

function Log([string]$line) {
  $text = '[' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '] ' + $line
  Write-Host $text
  Add-Content -Path $LogPath -Value $text -Encoding utf8
}
function Mask([string]$s) {
  if ($null -eq $s) { return '' }
  return ($s -replace 'npm_[A-Za-z0-9_-]{6,}', 'npm_***')
}
# 回显路径前先隐去令牌串：本 issue 的误操作形态就是把 token 值当成 -TokenFile 的值传进来，
# 那种串一旦原样打进日志就等于又泄露一次。长于 32 个字符的连续字母数字串（token 的典型形态）
# 整段打码；真路径的每一段一般没这么长，仍能看清是哪个文件出了错。
function ShowPath([string]$p) {
  if ([string]::IsNullOrEmpty($p)) { return '' }
  return ((Mask $p) -replace '[A-Za-z0-9_-]{32,}', '***')
}

# ── 候选清单（#1766）：先确认这次要发的字节绑在一个允许发布的候选上 ──────────────
# 候选清单由候选冻结那一步写出，字段见 docs/agents/real-machine-verification.md。这里只做「能不能拿它发布」
# 的格式与状态检查；候选提交是不是发布提交的祖先、清单票有没有差异审计，交给 preflight 读票面判断。
# 只在传了 -Candidate 时生效；没传就按旧口径发布，发布循环前打一行 CANDIDATE-SKIP 说明跳过了对账。
$candidateCommit = ''
$candidateDigest = ''
$candidatePathResolved = ''
if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
  try { $candidatePathResolved = (Resolve-Path -LiteralPath $Candidate -ErrorAction Stop).Path }
  catch { Log ('CANDIDATE-FAIL 读不到候选清单：' + (ShowPath $Candidate) + '（路径写错、文件不存在或没有读权限）'); exit 1 }
  $candidateCheck = Invoke-CandidateCheck @('validate', '--candidate', $candidatePathResolved)
  Write-ToolOutput $candidateCheck.out
  if ($candidateCheck.code -ne 0) {
    Log ('CANDIDATE-FAIL 候选清单没通过校验（见上面的 CANDIDATE-FAIL / CANDIDATE-ENV 行）：' + (ShowPath $candidatePathResolved))
    exit 1
  }
  $candidateValidLine = @($candidateCheck.out -split '\r?\n' | Where-Object { $_ -match '^CANDIDATE-VALID ' } | Select-Object -Last 1)
  if ($candidateValidLine.Count -eq 0) {
    Log 'CANDIDATE-FAIL 候选校验没有返回 CANDIDATE-VALID 行，无法确认候选身份'
    exit 1
  }
  if ($candidateValidLine[0] -match 'commit=([0-9a-f]{40})') { $candidateCommit = $Matches[1] } else { $candidateCommit = '' }
  if ($candidateValidLine[0] -match 'fileDigest=([0-9a-f]{64})') { $candidateDigest = $Matches[1] } else { $candidateDigest = '' }
  if ($candidateCommit -eq '' -or $candidateDigest -eq '') {
    Log ('CANDIDATE-FAIL 候选校验输出里缺 commit 或 fileDigest：' + $candidateValidLine[0])
    exit 1
  }
  Log ('CANDIDATE ' + (ShowPath $candidatePathResolved) + ' commit=' + $candidateCommit + ' fileDigest=' + $candidateDigest)
}
$candidateAuditOk = $false

# ── 阶段 0：取 token（只记来源，不记值） ──────────────────────────────────
# 优先级：-TokenFile > 环境变量（$TokenEnv → NPM_TOKEN → NODE_AUTH_TOKEN）。
# 文件通道排第一是为了让命令行里只有路径：token 值不该出现在命令参数里（#1646 实测会被
# 完整记进会话记录）。文件约定：第一行非空内容就是 token，前后空白与行尾换行去掉。
$token = ''
$tokenFrom = ''
$tokenFilePath = ''
if (-not [string]::IsNullOrWhiteSpace($TokenFile)) {
  try { $tokenFilePath = (Resolve-Path -LiteralPath $TokenFile -ErrorAction Stop).Path }
  catch { Log ('FAIL 读不到 token 文件：' + (ShowPath $TokenFile) + '（路径写错、文件不存在或没有读权限；命令行里只该出现路径）'); exit 2 }
  try { $rawTokenFile = [System.IO.File]::ReadAllText($tokenFilePath) }
  catch { Log ('FAIL token 文件读不了：' + (ShowPath $tokenFilePath) + '（检查文件权限后重试；命令行里只该出现路径）'); exit 2 }
  $tokenLines = @($rawTokenFile -split "`r?`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
  if ($tokenLines.Count -gt 0) { $token = $tokenLines[0].Trim() }
  if ([string]::IsNullOrWhiteSpace($token)) { Log ('FAIL token 文件里没有内容：' + (ShowPath $tokenFilePath) + '（需要在第一行放 token 值）'); exit 2 }
  $tokenFrom = 'file'
}
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = [Environment]::GetEnvironmentVariable($TokenEnv)
  $tokenFrom = $TokenEnv
  if ([string]::IsNullOrWhiteSpace($token) -and $TokenEnv -ne 'NPM_TOKEN') {
    $token = [Environment]::GetEnvironmentVariable('NPM_TOKEN')
    if (-not [string]::IsNullOrWhiteSpace($token)) { $tokenFrom = 'NPM_TOKEN' }
  }
  if ([string]::IsNullOrWhiteSpace($token) -and $TokenEnv -ne 'NODE_AUTH_TOKEN') {
    $token = $env:NODE_AUTH_TOKEN
    if (-not [string]::IsNullOrWhiteSpace($token)) { $tokenFrom = 'NODE_AUTH_TOKEN' }
  }
}
if ([string]::IsNullOrWhiteSpace($token)) {
  Log ('FAIL 缺 token：给 -TokenFile <路径>（推荐，命令行里只出现路径），或设置环境变量 ' + $TokenEnv + '（也试过 NPM_TOKEN/NODE_AUTH_TOKEN）；本脚本不会打印 token 的任何片段。')
  exit 2
}
if ($tokenFrom -eq 'file') {
  # 文件放在仓库目录里会被 git 看见，也有被误提交的风险；这里只提醒，不阻断（发布流程不动这个文件）。
  $repoRootPath = ''
  try { $repoRootPath = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop).Path.TrimEnd([char]'\', [char]'/') } catch { $repoRootPath = '' }
  if ($repoRootPath -ne '' -and $tokenFilePath.StartsWith($repoRootPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    Log ('WARN token 文件在仓库目录里：' + (ShowPath $tokenFilePath) + '；只提醒不阻断，但跑完立刻删除，不要提交。')
  }
  Log ('TOKEN source=file path=' + (ShowPath $tokenFilePath) + '（值不打屏）')
} else {
  Log ('TOKEN source=env name=' + $tokenFrom + '（值不打屏）')
}
# 本进程内统一用 NODE_AUTH_TOKEN 做 ${} 代入：先存下原值，finally 原样恢复。
# （-TokenEnv 指向谁就用谁；杜绝“日志写用 A、实际代入用 B”的双 token 错位。）
$hadNodeToken = [Environment]::GetEnvironmentVariable('NODE_AUTH_TOKEN')
$env:NODE_AUTH_TOKEN = $token
$regHost = ($Registry -replace '^https?://', '') -replace '/$', ''
$tempNpmrc = Join-Path ([System.IO.Path]::GetTempPath()) ('pub-token-' + $PID + '.npmrc')
Set-Content -Path $tempNpmrc -Value ("registry=" + $Registry + "`n//" + $regHost + "/:_authToken=`${NODE_AUTH_TOKEN}`n") -Encoding utf8 -NoNewline
$npmBase = @('--userconfig=' + $tempNpmrc)

# 发布自证脚本（#1648）：本仓有就用，五仓同步的 token 协议别处没有就退回旧口径。
$integrityScript = Join-Path $RepoRoot 'scripts/release-integrity.mts'
$hasIntegrity = Test-Path $integrityScript
$evidenceDir = ''
if (-not $hasIntegrity) {
  Log 'BYTES-SKIP 本仓没有 scripts/release-integrity.mts：本次不拍逐文件清单、不核对 tag 策略（五仓同步的旧口径）。'
  if ([string]::IsNullOrWhiteSpace($Tag)) { $Tag = 'latest' }
}

function Get-PackageInfo([string]$rel) {
  $dir = Join-Path $RepoRoot $rel
  $pj = Join-Path $dir 'package.json'
  if (-not (Test-Path $pj)) { return $null }
  $j = [System.IO.File]::ReadAllText($pj) | ConvertFrom-Json
  if (-not $j.name -or -not $j.version) { return $null }
  if ($j.private -eq $true) { return $null }
  # 发布前补跑 prepublishOnly 时要用它：这条是 npm publish 会执行、npm pack 不会执行的脚本，
  # 少了这一下，发布前拍到的清单与真正发出去的字节可能不是一回事（#1648）。
  $prepublishOnly = ''
  if ($null -ne $j.scripts -and $null -ne $j.scripts.prepublishOnly) { $prepublishOnly = [string]$j.scripts.prepublishOnly }
  return [pscustomobject]@{ name = [string]$j.name; version = [string]$j.version; dir = $dir; rel = $rel; prepublishOnly = $prepublishOnly }
}
function Test-Visible([string]$name, [string]$version) {
  npm @npmBase view ($name + '@' + $version) version --registry=$Registry 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# ── #1648 发布自证用的助手（只有本仓有 scripts/release-integrity.mts 时才被调用） ────────────
function Get-SafeName([string]$name) { return ($name -replace '[^A-Za-z0-9._-]', '_') }
# 调 release-integrity 子命令：统一在仓根跑、统一捕获输出与退出码。npm 调用一律留在本脚本里，
# 不塞给它：Windows 上 npm 是 .cmd，从 Node 里 spawn 要绕一层 shell 引号，容易冒出与发布无关的怪问题。
function Invoke-Integrity([string[]]$arguments) {
  Push-Location $RepoRoot
  $out = (node @arguments 2>&1 | Out-String)
  $code = $LASTEXITCODE
  Pop-Location
  return [pscustomobject]@{ code = $code; out = $out.Trim() }
}
# 读 npm 的 dist-tags（发布前后各读一次），返回 @{latest=...; beta=...}。
# 除「这个包还没发布过」（E404）以外的失败必须停下来：读不到当前指向就没法判断发完该指到哪。
function Get-DistTags([string]$name) {
  $out = (npm @npmBase view $name dist-tags --json --registry=$Registry 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    if (($out -match 'E404') -or ($out -match '404 Not Found') -or ($out -match 'is not in this registry')) { return @{} }
    Log ('TAG-READ-FAIL 读 ' + $name + ' 的 dist-tags 失败 exit=' + $code + '：' + (Mask $out).Trim())
    return $null
  }
  # npm 有时会把警告混进同一股输出（本脚本把 stderr 也并了进来），所以只取第一个 '{' 到最后一个 '}' 那一段再解析；
  # 连这段都没有就说明确实不是 JSON，按读取失败处理，不猜。
  $jsonText = $out.Trim()
  $jsonStart = $jsonText.IndexOf('{')
  $jsonEnd = $jsonText.LastIndexOf('}')
  if ($jsonStart -ge 0 -and $jsonEnd -gt $jsonStart) { $jsonText = $jsonText.Substring($jsonStart, $jsonEnd - $jsonStart + 1) }
  try { $j = ($jsonText | ConvertFrom-Json) } catch { Log ('TAG-READ-FAIL ' + $name + ' 的 dist-tags 输出不是合法 JSON：' + (Mask $out).Trim()); return $null }
  $tags = @{}
  if ($null -ne $j.latest -and [string]$j.latest -ne '') { $tags['latest'] = [string]$j.latest }
  if ($null -ne $j.beta -and [string]$j.beta -ne '') { $tags['beta'] = [string]$j.beta }
  return $tags
}
function Write-JsonFile([string]$path, $value) {
  $value | ConvertTo-Json -Depth 8 | Set-Content -Path $path -Encoding utf8
}
function Format-ManifestSummary($manifest) {
  if ($null -eq $manifest) { return '(无清单)' }
  return ('files=' + [string]$manifest.fileCount + ' bytes=' + [string]$manifest.totalBytes + ' digest=' + [string]$manifest.digest)
}
# 把子命令的多行输出逐行转进发布日志（空行丢掉）。抽出来是因为发布前后共有四处要做同一件事，
# 以前每处抄一遍循环，改日志格式时容易漏掉其中一处。
function Write-ToolOutput([string]$text) {
  foreach ($line in ($text -split '\r?\n')) { if ($line.Trim() -ne '') { Log $line.Trim() } }
}
# 打一个包并找出 tarball：target 可以是目录（打当前目录的包），也可以是「包名@版本」（从 registry 拉回已发布的包）。
# 每次先把目标目录清空，避免上一次留下的 .tgz 被当成这一次的产物。
function Get-NpmPack([string]$target, [string]$destination) {
  if (Test-Path $destination) { Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  if (Test-Path -LiteralPath $target -PathType Container) {
    Push-Location $target
    $out = (npm @npmBase pack --pack-destination $destination 2>&1 | Out-String)
    $code = $LASTEXITCODE
    Pop-Location
  } else {
    $out = (npm @npmBase pack $target --pack-destination $destination --registry=$Registry 2>&1 | Out-String)
    $code = $LASTEXITCODE
  }
  $tarball = Get-ChildItem -LiteralPath $destination -Filter *.tgz -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $tarballPath = ''
  if ($null -ne $tarball) { $tarballPath = $tarball.FullName }
  return [pscustomobject]@{ code = $code; out = (Mask $out).Trim(); tarball = $tarballPath }
}
# 读 tarball 的逐文件清单：成功时同时返回清单对象（从脚本写出的 JSON 文件读回来），失败返回 null。
function Get-FileManifest([string]$tarball, [string]$outPath, [string]$name, [string]$version) {
  $r = Invoke-Integrity @('scripts/release-integrity.mts', 'manifest', '--tarball', $tarball, '--out', $outPath, '--name', $name, '--version', $version)
  $manifest = $null
  if ($r.code -eq 0) {
    try { $manifest = [System.IO.File]::ReadAllText($outPath) | ConvertFrom-Json } catch { $manifest = $null }
  }
  return [pscustomobject]@{ code = $r.code; out = $r.out; manifest = $manifest }
}
function Compare-FileManifests([string]$expected, [string]$actual) {
  return (Invoke-Integrity @('scripts/release-integrity.mts', 'compare', '--expected', $expected, '--actual', $actual))
}
# 候选清单校验与发布字节对账（#1766）：规则在 scripts/lib/release-candidate-audit.mts，
# 这里只负责在仓根调 CLI、把输出转进日志。PowerShell 不再自己写一遍字段校验与指纹比较，
# 两处规则就不会在改一边时漂掉。
function Invoke-CandidateCheck([string[]]$arguments) {
  Push-Location $RepoRoot
  $out = (node --import ./scripts/ts-hook.mts scripts/release-candidate-check.mts @arguments 2>&1 | Out-String)
  $code = $LASTEXITCODE
  Pop-Location
  return [pscustomobject]@{ code = $code; out = (Mask $out).Trim() }
}

try {
  # ── 阶段 1：读表 ──────────────────────────────────────────────────────
  Log ('STAGE 1/3 读表 Registry=' + $Registry)
  $all = @()
  foreach ($rel in $Order) {
    $p = Get-PackageInfo $rel
    if ($null -eq $p) { Log ('SKIP-dir ' + $rel + '（无 package.json 或 private）'); continue }
    $all += $p
  }
  # 未知包预警（顺序写死，新包不会自动进发布；与其静默漏发，不如显眼报错）。
  foreach ($d in (Get-ChildItem (Join-Path $RepoRoot 'packages') -Directory -ErrorAction SilentlyContinue)) {
    $pj = Join-Path $d.FullName 'package.json'
    if (-not (Test-Path $pj)) { continue }
    $rel = 'packages/' + $d.Name
    if ($Order -notcontains $rel) {
      try { $jj = [System.IO.File]::ReadAllText($pj) | ConvertFrom-Json } catch { continue }
      if ($jj.private -eq $true) { continue }
      Log ('WARN 未知包目录 ' + $rel + '（' + [string]$jj.name + '@' + [string]$jj.version + '，非 private）：不在发布顺序里，本次不会发；要发就先把它加进 $Order。')
    }
  }
  if ($all.Count -eq 0) { Log 'FAIL 没有可发的包'; exit 1 }
  $todo = @()
  foreach ($p in $all) {
    if (Test-Visible $p.name $p.version) { Log ('SKIP ' + $p.name + '@' + $p.version + ' 云端已有') }
    else { Log ('TODO ' + $p.name + '@' + $p.version + ' 云端没有'); $todo += $p }
  }

  # ── 阶段 2：验 token ──────────────────────────────────────────────────
  $who = npm @npmBase whoami --registry=$Registry 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Log ('FAIL token 校验没过：' + (Mask $who).Trim()); exit 1 }
  Log ('TOKEN-OK whoami=' + (Mask $who).Trim())

  if ($Probe) {
    $cand = @($all | Where-Object { -not ($todo -contains $_) } | Select-Object -First 1)
    if ($cand.Count -eq 0) { Log 'PROBE-SKIP 没有云端已有版本可重发（全是 TODO）：先发一版，或等首发后复核。'; exit 2 }
    $c = $cand[0]
    Log ('PROBE 重发 ' + $c.name + '@' + $c.version + '（云端已有，期望 E409；无副作用）')
    $probeTag = 'latest'
    if (-not [string]::IsNullOrWhiteSpace($Tag)) { $probeTag = $Tag }
    Push-Location $c.dir
    $pout = npm @npmBase publish --access public --tag $probeTag --registry=$Registry 2>&1 | Out-String
    Pop-Location
    $psafe = (Mask $pout).Trim()
    if ($psafe -match 'cannot publish over|previously published|previously staged|E409|409 Conflict') { Log 'PROBE-OK 写权限成立（registry 拒收已存在版本＝写链路通）'; exit 0 }
    if ($psafe -match 'E403|E401|EOTP|one-time pass|2FA|two-factor') { Log 'PROBE-FAIL 无写权限或被 2FA 卡住'; exit 1 }
    Log 'PROBE-FAIL 未知结果（见上屏尾部）'; exit 1
  }
  if ($todo.Count -eq 0) { Log 'DONE 本次没有要发的包'; exit 0 }
  Log ('PLAN 待发 ' + $todo.Count + ' 个：' + (($todo | ForEach-Object { $_.name + '@' + $_.version }) -join ', '))
  # 预发布闸（旧口径；有发布自证脚本时由它读当前 dist-tag 统一判定，见下面的 TAG-PLAN 段）：
  # 非 latest 的 tag 只许配预发布号，防止把正式号压在测试标签下。
  if (-not $hasIntegrity) {
    foreach ($p in $todo) {
      if ($Tag -ne 'latest' -and ($p.version -notmatch '-')) {
        Log ('FAIL 版本 ' + $p.version + ' 不是预发布号，不能发到 tag ' + $Tag + '：请先把版本号写成 X.Y.Z-beta.N')
        exit 1
      }
    }
    Log ('TAG ' + $Tag + '（latest 是所有人默认拿到的；其他 tag 只有显式安装才拿到，所以测试版发 beta 不会推给其他用户）')
  } else {
    Log 'TAG 待定：发布自证脚本会在发布前读当前 dist-tag，按版本形态决定发到 beta 还是 latest（TAG-PLAN 行）'
  }
  # ── 真机验证清单闸：本版清单票恰好一张且已关闭（规则见 docs/agents/real-machine-verification.md） ──
  # 只在本仓有 scripts/release-preflight.mts 时生效：五仓同步的 token 协议别处不带这套票务规则。
  $preflight = Join-Path $RepoRoot 'scripts/release-preflight.mts'
  if (-not (Test-Path $preflight)) { Log 'CHECK 跳过（本仓没有 scripts/release-preflight.mts）' }
  else {
    if ($DryRun) { Log 'CHECK 真机验证清单（DryRun 只提示不阻断）' } else { Log 'CHECK 真机验证清单：本版 [真机验证] 清单票恰好一张且已关闭' }
    Push-Location $RepoRoot
    $chkArgs = @('scripts/release-preflight.mts')
    if ($DryRun) { $chkArgs += '--soft' }
    if ($candidatePathResolved -ne '') { $chkArgs += @('--candidate', $candidatePathResolved) }
    $chkOut = (node @chkArgs 2>&1 | Out-String)
    $chkCode = $LASTEXITCODE
    Pop-Location
    # 这一行只会在候选审计通过、且候选提交与发布提交不同但票面有差异审计时出现；
    # 记下来给后面的发布字节对账用：指纹不同但有它，说明差异已经在清单票里说清了。
    if ($chkOut -match 'PREFLIGHT-CANDIDATE-AUDIT') { $candidateAuditOk = $true }
    $chkTrim = $chkOut.Trim(); if ($chkTrim.Length -gt 1200) { $chkTrim = $chkTrim.Substring($chkTrim.Length - 1200) }
    if (($chkCode -ne 0) -and (-not $DryRun)) { Log ('CHECK-FAIL 真机验证清单没通过（exit=' + $chkCode + '）：' + $chkTrim); exit 1 }
    if ($chkCode -ne 0) { Log ('CHECK-SOFT 演练模式不阻断：' + $chkTrim) } else { Log ('CHECK-OK ' + $chkTrim) }
  }
  if ($candidatePathResolved -eq '') { Log 'CANDIDATE-SKIP 未给 -Candidate：跳过候选包对账' }
  if ($DryRun) {
    if ($candidatePathResolved -ne '') {
      Log ('CANDIDATE-PLAN 候选已校验（commit=' + $candidateCommit + ' fileDigest=' + $candidateDigest + '）；DryRun 不跑对账，真实发布时才会比对要发的字节')
    }
    Log 'DRYRUN 只验到这里，不跑门禁不发布'
    exit 0
  }

  # ── #1648 发布自证（一）：发布前读当前 dist-tag，算好发完应该指向哪里 ─────────────────
  # 每包一份计划：预发布版本发 beta 后还要把 latest 指过去；稳定版本只动 latest、beta 保持原样。
  # 计划在门禁之前算：策略不允许这次发布时（比如版本比 latest 旧、beta 指着正式号），
  # 没必要先白跑一遍一分钟的门禁再停。
  $releaseVersion = [string]$todo[0].version
  $mainPkg = @($all | Where-Object { $_.rel -eq 'package' } | Select-Object -First 1)
  if ($mainPkg.Count -gt 0) { $releaseVersion = [string]$mainPkg[0].version }
  $tagPlans = @{}
  $gateManifests = @{}
  $evidencePackages = @()
  $evidenceTags = @{}
  if ($hasIntegrity) {
    $evidenceDir = Join-Path ([System.IO.Path]::GetTempPath()) ('pub-evidence-' + $PID)
    New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
    foreach ($p in $todo) {
      $safeName = Get-SafeName $p.name
      $before = Get-DistTags $p.name
      if ($null -eq $before) { Log ('TAG-READ-FAIL ' + $p.name + ' 读不到当前 dist-tag，发布前停下（读不到就不知道该指到哪）。'); exit 1 }
      $beforeFile = Join-Path $evidenceDir ('tags-before-' + $safeName + '.json')
      Write-JsonFile $beforeFile $before
      $planFile = Join-Path $evidenceDir ('tags-plan-' + $safeName + '.json')
      $planRun = Invoke-Integrity @('scripts/release-integrity.mts', 'tags-plan', '--version', $p.version, '--before', $beforeFile, '--out', $planFile)
      Write-ToolOutput $planRun.out
      if ($planRun.code -ne 0) { Log ('TAG-PLAN-FAIL ' + $p.name + '@' + $p.version + ' 的发布前指向或版本顺序不允许这次发布，见上。'); exit 1 }
      $plan = [System.IO.File]::ReadAllText($planFile) | ConvertFrom-Json
      if (-not [string]::IsNullOrWhiteSpace($Tag) -and $Tag -ne [string]$plan.publishTag) {
        Log ('FAIL 显式 -Tag ' + $Tag + ' 与按版本形态推导出的发布 tag ' + [string]$plan.publishTag + ' 不一致：去掉 -Tag 让脚本自己定，或先确认这次要动的是哪个通道。'); exit 1
      }
      $tagPlans[$p.name] = $plan
    }
  } else { Log 'TAG 跳过核对（没有 scripts/release-integrity.mts，按 -Tag 旧口径发布）' }

  # ── 门禁：只构建一次，然后跑唯一裁决入口（#1648） ─────────────────────────────
  # 不再跑会重复构建的整条 npm test：npm run verify:parallel 已经盖住主链与五条冒烟，
  # 是仓里写死的唯一裁决入口（见 AGENTS.md「跑门禁：先挑档位」）。任何红立即非零退出。
  if (-not $SkipGate) {
    Log 'GATE 构建：npm run build（仓根，只构建这一次）'
    Push-Location $RepoRoot; $b = cmd /c 'npm run build 2>&1' | Out-String; $bc = $LASTEXITCODE; Pop-Location
    if ($bc -ne 0) { $bt = (Mask $b).Trim(); if ($bt.Length -gt 600) { $bt = $bt.Substring($bt.Length - 600) }; Log ('GATE-FAIL 构建红 exit=' + $bc + ' 尾部=' + $bt); exit 1 }
    Log 'GATE 构建绿'
    Log 'GATE 裁决：npm run verify:parallel（唯一裁决入口，含五条冒烟）'
    Push-Location $RepoRoot; $t = cmd /c 'npm run verify:parallel 2>&1' | Out-String; $tc = $LASTEXITCODE; Pop-Location
    if ($tc -ne 0) { $tt = (Mask $t).Trim(); if ($tt.Length -gt 600) { $tt = $tt.Substring($tt.Length - 600) }; Log ('GATE-FAIL 裁决红 exit=' + $tc + ' 尾部=' + $tt); exit 1 }
    Log 'GATE 裁决绿'
  } else { Log 'GATE 跳过（-SkipGate）' }

  # ── 门禁快照：给每个待发包拍一次「门禁验过的字节」的逐文件清单 ────────────────────
  # 这里只跑 npm pack（不跑 prepublishOnly）：门禁刚构建完，包目录就是门禁验过的那份产物。
  if ($hasIntegrity) {
    if ($SkipGate) {
      Log 'BYTES-SKIP 门禁被 -SkipGate 跳过，没有门禁快照：发布前只能与发布前清单对账'
    } else {
      foreach ($p in $todo) {
        $safeName = Get-SafeName $p.name
        $gateDir = Join-Path $evidenceDir ('gate-' + $safeName)
        $gatePack = Get-NpmPack $p.dir $gateDir
        if ($gatePack.code -ne 0 -or $gatePack.tarball -eq '') { Log ('PACK-FAIL 门禁快照：给 ' + $p.name + '@' + $p.version + ' 打包失败 exit=' + $gatePack.code + ' 尾部=' + $gatePack.out); exit 1 }
        $gateManifestPath = Join-Path $evidenceDir ('gate-' + $safeName + '.json')
        $gateMf = Get-FileManifest $gatePack.tarball $gateManifestPath $p.name $p.version
        if ($gateMf.code -ne 0 -or $null -eq $gateMf.manifest) { Log ('PACK-FAIL 门禁快照：读 ' + $p.name + ' 的逐文件清单失败：' + $gateMf.out); exit 1 }
        $gateManifests[$p.name] = [pscustomobject]@{ path = $gateManifestPath; manifest = $gateMf.manifest }
        Log ('GATE-SNAPSHOT ' + $p.name + '@' + $p.version + ' ' + (Format-ManifestSummary $gateMf.manifest))
      }
    }
  }

  # ── 发布（依赖先行，失败不停，收尾统一算账） ───────────────────────────
  # 每个包在真正 publish 之前先拍「这次要发的字节」：补跑包里自己的 prepublishOnly（npm publish 会跑它、
  # npm pack 不会跑，漏掉这一步拍到的清单就不是 publish 真正要发的字节），再 npm pack 解包算 sha256，
  # 与门禁快照逐文件比对。对不上就停在这里——发布之后才发现差字节，registry 不支持撤回。
  $done = @(); $staged = @(); $failed = @()
  foreach ($p in $todo) {
    Log ('PKG-BEGIN ' + $p.name + '@' + $p.version)
    $safeName = Get-SafeName $p.name
    $plan = $null
    if ($hasIntegrity -and $tagPlans.ContainsKey($p.name)) { $plan = $tagPlans[$p.name] }
    $publishTag = $Tag
    if ($null -ne $plan) { $publishTag = [string]$plan.publishTag }
    $preManifestPath = ''
    $preManifest = $null
    if ($hasIntegrity) {
      if (-not [string]::IsNullOrWhiteSpace([string]$p.prepublishOnly)) {
        Log ('PACK 发布前补跑包内 prepublishOnly：' + [string]$p.prepublishOnly)
        Push-Location $p.dir
        $prepOut = (cmd /c 'npm run prepublishOnly 2>&1' | Out-String)
        $prepCode = $LASTEXITCODE
        Pop-Location
        if ($prepCode -ne 0) {
          $prepTrim = (Mask $prepOut).Trim(); if ($prepTrim.Length -gt 800) { $prepTrim = $prepTrim.Substring($prepTrim.Length - 800) }
          Log ('PRE-PACK-FAIL ' + $p.name + ' 的 prepublishOnly 红了 exit=' + $prepCode + '，不发布：' + $prepTrim)
          exit 1
        }
      }
      $preDir = Join-Path $evidenceDir ('pre-' + $safeName)
      $prePack = Get-NpmPack $p.dir $preDir
      if ($prePack.code -ne 0 -or $prePack.tarball -eq '') { Log ('PRE-PACK-FAIL ' + $p.name + ' 发布前打包失败 exit=' + $prePack.code + ' 尾部=' + $prePack.out); exit 1 }
      $preManifestPath = Join-Path $evidenceDir ('pre-' + $safeName + '.json')
      $preMf = Get-FileManifest $prePack.tarball $preManifestPath $p.name $p.version
      if ($preMf.code -ne 0 -or $null -eq $preMf.manifest) { Log ('PRE-PACK-FAIL ' + $p.name + ' 读发布前逐文件清单失败：' + $preMf.out); exit 1 }
      $preManifest = $preMf.manifest
      if ($gateManifests.ContainsKey($p.name)) {
        $cmp = Compare-FileManifests $gateManifests[$p.name].path $preManifestPath
        Write-ToolOutput $cmp.out
        if ($cmp.code -ne 0) {
          Log ('PRE-PACK-DIFF ' + $p.name + '@' + $p.version + ' 要发的字节与门禁验过的字节不一致，发布前停下（上面 COMPARE-DIFF 是第一处差异）')
          exit 1
        }
        Log ('PRE-PACK-SAME ' + $p.name + '@' + $p.version + ' ' + (Format-ManifestSummary $preManifest))
      } else { Log ('BYTES-SKIP ' + $p.name + ' 没有门禁快照可比（-SkipGate），只留发布前清单') }
      # 候选包对账（#1766）：候选清单只描述主包（package）的字节，所以只比主包。
      # 一致说明要发的就是候选包；不同时，只有清单票写了差异审计（preflight 打出 PREFLIGHT-CANDIDATE-AUDIT）
      # 才继续，否则停下——发布之后 registry 不支持撤回。
      if ($candidatePathResolved -ne '' -and $p.rel -eq 'package') {
        $matchArgs = @('match', '--candidate', $candidatePathResolved, '--manifest', $preManifestPath)
        if ($candidateAuditOk) { $matchArgs += '--audit-covered' }
        $candidateMatch = Invoke-CandidateCheck $matchArgs
        Write-ToolOutput $candidateMatch.out
        if ($candidateMatch.code -ne 0) {
          Log ('CANDIDATE-FAIL ' + $p.name + '@' + $p.version + ' 的候选包对账没通过（见上面的 CANDIDATE-DIFF 或 CANDIDATE-ENV 行），发布前停下')
          exit 1
        }
      }
    }

    Push-Location $p.dir
    $out = npm @npmBase publish --access public --tag $publishTag --registry=$Registry 2>&1 | Out-String
    $code = $LASTEXITCODE
    Pop-Location
    $safe = (Mask $out).Trim()
    $accepted = $false
    if ($code -eq 0) {
      $plus = (($safe -split '\r?\n') | Where-Object { $_ -match '^\+\s' } | Select-Object -First 3) -join '; '
      if ($plus -ne '') { Log ('PKG-OK ' + $p.name + '@' + $p.version + ' ' + $plus) } else { Log ('PKG-OK ' + $p.name + '@' + $p.version) }
      $done += ($p.name + '@' + $p.version); $accepted = $true
      if (Test-Visible $p.name $p.version) { Log ('VERIFIED ' + $p.name + '@' + $p.version + '（即时可见）') }
      else {
        Push-Location $p.dir
        $rout = npm @npmBase publish --access public --tag $publishTag --registry=$Registry 2>&1 | Out-String
        Pop-Location
        if ((Mask $rout) -match 'previously staged version|E409|409 Conflict') {
          Log ('STAGED ' + $p.name + '@' + $p.version + '（已受理、待可见）'); $staged += ($p.name + '@' + $p.version)
        } else { Log ('UNCONFIRMED ' + $p.name + '@' + $p.version + '（已受理但即时不可见；由复核确认）') }
      }
    } elseif (Test-Visible $p.name $p.version) {
      Log ('PKG-SKIP-staged ' + $p.name + '@' + $p.version + '（registry 已有该版本）'); $done += ($p.name + '@' + $p.version); $accepted = $true
    } elseif ($safe -match 'previously staged version|E409|409 Conflict') {
      Log ('PKG-SKIP-staged ' + $p.name + '@' + $p.version + '（E409，视为已受理）'); $done += ($p.name + '@' + $p.version); $staged += ($p.name + '@' + $p.version); $accepted = $true
    } else {
      if ($safe -match 'EOTP|one-time pass|2FA|two-factor') { Log ('PKG-FAIL ' + $p.name + ' 疑似被 2FA 卡住：换 Automation 或 Granular 写权限 token 再跑。') }
      else { $tail = $safe; if ($tail.Length -gt 800) { $tail = $tail.Substring($tail.Length - 800) }; Log ('PKG-FAIL ' + $p.name + ' exit=' + $code + ' 尾部=' + $tail) }
      $failed += ($p.name + '@' + $p.version)
    }
    if (-not $accepted) { continue }
    if (-not $hasIntegrity) { continue }

    # ── 发布后自证（一）：从 registry 拉回刚发布的 tarball，与发布前清单逐文件比对 ──
    $fetchDir = Join-Path $evidenceDir ('fetch-' + $safeName)
    $fetchPack = $null
    for ($attempt = 1; $attempt -le 12; $attempt++) {
      $packNow = Get-NpmPack ($p.name + '@' + $p.version) $fetchDir
      if ($packNow.tarball -ne '') { $fetchPack = $packNow; break }
      if ($attempt -lt 12) {
        Log ('FETCH-WAIT ' + $p.name + '@' + $p.version + ' 还拉不到（多数是复制延迟），5 秒后重试 ' + $attempt + '/12')
        Start-Sleep -Seconds 5
      }
    }
    if ($null -eq $fetchPack) {
      Log ('FETCH-FAIL ' + $p.name + '@' + $p.version + ' 发布后 12 次都拉不回 tarball：无法证明发出去的字节就是验过的字节，收尾按失败算（registry 已收下，无法撤回，需要人工核对）')
      $failed += ($p.name + '@' + $p.version)
      continue
    }
    $fetchManifestPath = Join-Path $evidenceDir ('fetch-' + $safeName + '.json')
    $fetchMf = Get-FileManifest $fetchPack.tarball $fetchManifestPath $p.name $p.version
    if ($fetchMf.code -ne 0 -or $null -eq $fetchMf.manifest) {
      Log ('BYTES-FAIL ' + $p.name + ' 读拉回来的 tarball 清单失败：' + $fetchMf.out + '（registry 已收下，无法撤回；必须人工核对）')
      $failed += ($p.name + '@' + $p.version)
      continue
    }
    if ($null -ne $preManifest) {
      $cmp = Compare-FileManifests $preManifestPath $fetchManifestPath
      Write-ToolOutput $cmp.out
      if ($cmp.code -ne 0) {
        Log ('BYTES-DIFF ' + $p.name + '@' + $p.version + ' registry 上拉回来的包与发布前的逐文件清单不一致（上面 COMPARE-DIFF 是第一处差异；已发布，无法撤回，必须人工核对）')
        $failed += ($p.name + '@' + $p.version)
        continue
      }
      Log ('BYTES-SAME ' + $p.name + '@' + $p.version + ' ' + (Format-ManifestSummary $fetchMf.manifest))
      $evidencePackages += [pscustomobject]@{
        name = $p.name; version = $p.version; fileCount = [int]$fetchMf.manifest.fileCount
        totalBytes = [int]$fetchMf.manifest.totalBytes; digest = [string]$fetchMf.manifest.digest
      }
    }

    # ── 发布后自证（二）：预发布版本补 latest，然后读回核对最终指向 ──────────────
    if ($null -eq $plan) { continue }
    if ($plan.addLatest -eq $true) {
      $tagAdded = $false
      for ($attempt = 1; $attempt -le 6; $attempt++) {
        $tagOut = (npm @npmBase dist-tag add ($p.name + '@' + $p.version) latest --registry=$Registry 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0) { $tagAdded = $true; break }
        if ($attempt -lt 6) {
          Log ('TAG-WAIT ' + $p.name + ' 补 latest 还没成功，5 秒后重试 ' + $attempt + '/6')
          Start-Sleep -Seconds 5
        } else { Log ('TAG-ADD-FAIL ' + $p.name + ' 补 latest 失败 exit=' + $LASTEXITCODE + '：' + (Mask $tagOut).Trim()) }
      }
      if (-not $tagAdded) {
        Log ('TAG-VERIFY-FAIL ' + $p.name + ' 预发布版本必须让 latest 与 beta 都指向 ' + $p.version + '，补 latest 这一步没成功')
        $failed += ($p.name + '@' + $p.version)
        continue
      }
    }
    $afterTags = Get-DistTags $p.name
    if ($null -eq $afterTags) {
      Log ('TAG-VERIFY-FAIL ' + $p.name + ' 发布后读不到 dist-tag，无法核对最终指向')
      $failed += ($p.name + '@' + $p.version)
      continue
    }
    $afterFile = Join-Path $evidenceDir ('tags-after-' + $safeName + '.json')
    Write-JsonFile $afterFile $afterTags
    $verifyRun = Invoke-Integrity @('scripts/release-integrity.mts', 'tags-verify', '--version', $p.version, '--plan', (Join-Path $evidenceDir ('tags-plan-' + $safeName + '.json')), '--after', $afterFile)
    Write-ToolOutput $verifyRun.out
    if ($verifyRun.code -ne 0) {
      Log ('TAG-VERIFY-FAIL ' + $p.name + ' 发布后的 dist-tag 指向不符合策略（见上面 TAG-VERIFY-FAIL 行）')
      $failed += ($p.name + '@' + $p.version)
      continue
    }
    if ($afterTags.ContainsKey('latest')) { $evidenceTags['latest'] = [string]$afterTags['latest'] }
    if ($afterTags.ContainsKey('beta')) { $evidenceTags['beta'] = [string]$afterTags['beta'] }
  }

  # ── 复核：一次采样（缺省）／长轮询（-FullPost，宣布前用） ───────────────
  $recheck = @($todo | Where-Object { ($done -contains ($_.name + '@' + $_.version)) } | ForEach-Object { $_.name })
  if ($recheck.Count -gt 0) {
    if ($FullPost) {
      Log 'STAGE 3/3 长轮询（最多约 10min，直到待发各包全可见）'
      $ok = $true
      for ($i = 1; $i -le 20; $i++) {
        $miss = @($todo | Where-Object { ($done -contains ($_.name + '@' + $_.version)) -and -not (Test-Visible $_.name $_.version) })
        if ($miss.Count -eq 0) { Log 'POST-OK 待发各包全可见'; break }
        if ($i -eq 20) { Log ('POST-FAIL 仍不可见：' + (($miss | ForEach-Object { $_.name + '@' + $_.version }) -join ', ') + '（多为复制延迟，不重发）'); $ok = $false; break }
        Log ('WAIT ' + $i + '/20 暂不可见 ' + $miss.Count + ' 个，30s 后重试')
        Start-Sleep -Seconds 30
      }
      if (-not $ok) { exit 1 }
    } else {
      $vis = @(); $pend = @()
      foreach ($n in $recheck) {
        $pv = ($todo | Where-Object { $_.name -eq $n } | Select-Object -First 1).version
        if (Test-Visible $n $pv) { $vis += ($n + '@' + $pv) } else { $pend += ($n + '@' + $pv) }
      }
      Log ('STAGE 3/3 一次采样：可见 ' + $vis.Count + '/' + $recheck.Count)
      if ($pend.Count -gt 0) { Log ('STAGED-PENDING ' + $pend.Count + ' 个（已受理、待可见）：' + ($pend -join ', ') + '；宣布前跑 -FullPost 复核到全绿') }
    }
  } else { Log 'STAGE 3/3 跳过（本轮无走完的包）' }
  # ── 发布自证（三）：把清单摘要与最终 tag 指向整理成证据文件，交给发布记录评论 ────
  # 证据只收「发布→拉回→比对」走完的包：没走完的包本来就要按失败算，不能拿它进发布记录。
  $evidenceFile = ''
  if ($hasIntegrity -and $evidencePackages.Count -gt 0) {
    $evidenceFile = Join-Path $evidenceDir 'evidence.json'
    $evidenceTagsObject = [pscustomobject]@{
      latest = $(if ($evidenceTags.ContainsKey('latest')) { [string]$evidenceTags['latest'] } else { '' })
      beta = $(if ($evidenceTags.ContainsKey('beta')) { [string]$evidenceTags['beta'] } else { '' })
    }
    $evidence = [pscustomobject]@{
      version = $releaseVersion
      packages = @($evidencePackages)
      tags = $evidenceTagsObject
    }
    Write-JsonFile $evidenceFile $evidence
    Log ('BYTES-EVIDENCE ' + $evidenceFile + '：' + (($evidencePackages | ForEach-Object { $_.name + '@' + $_.version + ' ' + (Format-ManifestSummary $_) }) -join '；'))
  } elseif ($hasIntegrity) { Log 'BYTES-EVIDENCE 无（本轮没有走完「发布→拉回→比对」的包）' }

  # ── 发布后：真机验证清单票补发布记录、建下一版占位票（失败只记日志，不改本次发布结果） ──
  $postflight = Join-Path $RepoRoot 'scripts/release-postflight.mts'
  if ($done.Count -eq 0) { Log 'POST 跳过（本轮没有成功的包）' }
  elseif (-not (Test-Path $postflight)) { Log 'POST 跳过（本仓没有 scripts/release-postflight.mts）' }
  else {
    Log 'POST 真机验证清单收尾：补发布记录、建下一版占位票'
    $pfArgs = @($postflight)
    if ($releaseVersion -ne '') { $pfArgs += @('--version', $releaseVersion) }
    if ($evidenceFile -ne '') { $pfArgs += @('--evidence', $evidenceFile) }
    Push-Location $RepoRoot
    $pfOut = (node @pfArgs 2>&1 | Out-String)
    $pfCode = $LASTEXITCODE
    Pop-Location
    $pfTrim = $pfOut.Trim(); if ($pfTrim.Length -gt 1600) { $pfTrim = $pfTrim.Substring($pfTrim.Length - 1600) }
    if ($pfCode -ne 0) { Log ('POST-FAIL 收尾没走完（exit=' + $pfCode + '），不影响本次发布；下次发布前检查会拦缺票：' + $pfTrim) }
    else { Log ('POST-OK ' + $pfTrim) }
  }
  if ($failed.Count -gt 0) { Log ('FAIL 本轮失败 ' + $failed.Count + ' 个：' + ($failed -join ', ')); exit 1 }
  Log ('DONE 已发 ' + $done.Count + ' 个：' + ($done -join ', '))
  Write-Host '发布侧到此结束（待发包全部通过即交付）：安装一律用户侧做（市场升级/软件内升级/自装）。'
} finally {
  try { if ($evidenceDir -ne '' -and (Test-Path $evidenceDir)) { Remove-Item -LiteralPath $evidenceDir -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
  try { if (Test-Path $tempNpmrc) { Remove-Item $tempNpmrc -Force -ErrorAction SilentlyContinue } } catch { }
  try {
    if ($null -eq $hadNodeToken) { Remove-Item Env:\NODE_AUTH_TOKEN -ErrorAction SilentlyContinue }
    else { $env:NODE_AUTH_TOKEN = $hadNodeToken }
  } catch { }
}
