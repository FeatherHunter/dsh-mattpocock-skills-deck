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
#     pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt -DryRun    # 只读：读表＋验 token
#     pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt             # 全流程：门禁(build+test)→发三包→一次采样
#     pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt -FullPost   # 宣布前：长轮询直到包全可见
#     3) 每趟跑完立刻删掉临时文件：Remove-Item $env:TEMP\dsh-publish-token.txt
#   环境变量入口仍然兼容（-TokenEnv，缺省 NODE_AUTH_TOKEN；为空再试 NPM_TOKEN/NODE_AUTH_TOKEN），
#   但别用内联赋值那种写法，理由同上。脚本只记录 token 的来源（文件路径或变量名），从不打印值。
# 参数：
#     -RepoRoot 缺省＝本脚本上一级；-Registry 缺省 https://registry.npmjs.org/
#     -TokenFile token 文件路径（推荐入口；只取第一行非空内容，首尾空白会去掉）
#     -TokenEnv 缺省 NODE_AUTH_TOKEN（-TokenFile 没给时才用；为空再试 NPM_TOKEN）；-LogPath 缺省 <仓根>\.tmp-publish-token.log
#     -SkipGate 跳过构建与测试门禁（门禁已在别处跑绿时用；本仓 test 较重：verify＋smoke 全套）
#     -Tag       发布到哪个 dist-tag，缺省 latest（所有人都默认拿到的那一个）。
#                发测试版必须显式 -Tag beta：registry 上 tag 只是指向某个版本的别名，
#                包的存储不按 tag 分目录，latest 指到哪，别人装的就是哪一版。
#                本脚本带预发布闸：Tag 不是 latest 时，版本号必须是 X.Y.Z-beta.N 这样的预发布号，
#                否则拒绝（否则一个正式号会被永久压在测试标签下，转正还得再抬号）。
#                注（2026-10-26）：本插件的「检查更新」与 dshmarket 都只读 npm 的 latest 标签——
#                更新包（dsh-plugin-update）的 prerelease 通道只放宽版本形态，取新版仍走 /latest。
#                只发 -Tag beta 时面板与市场不会提示新版；要让默认用户拿到，发布后再补一次：
#                  npm dist-tag add dsh-mattpocock-skills-deck@<版本> latest --registry=https://registry.npmjs.org/
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
  [string]$Tag = 'latest'
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

# ── 阶段 0：取 token（只记来源，不记值） ──────────────────────────────────
# 优先级：-TokenFile > 环境变量（$TokenEnv → NPM_TOKEN → NODE_AUTH_TOKEN）。
# 文件通道排第一是为了让命令行里只有路径：token 值不该出现在命令参数里（#1646 实测会被
# 完整记进会话记录）。文件约定：第一行非空内容就是 token，前后空白与行尾换行去掉。
$token = ''
$tokenFrom = ''
$tokenFilePath = ''
if (-not [string]::IsNullOrWhiteSpace($TokenFile)) {
  try { $tokenFilePath = (Resolve-Path -LiteralPath $TokenFile -ErrorAction Stop).Path }
  catch { Log ('FAIL 读不到 token 文件：' + $TokenFile + '（路径写错、文件不存在或没有读权限；命令行里只该出现路径）'); exit 2 }
  try { $rawTokenFile = [System.IO.File]::ReadAllText($tokenFilePath) }
  catch { Log ('FAIL token 文件读不了：' + $tokenFilePath + '（检查文件权限后重试；命令行里只该出现路径）'); exit 2 }
  $firstTokenLine = @($rawTokenFile -split "`r?`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
  if ($firstTokenLine.Count -gt 0) { $token = $firstTokenLine[0].Trim() }
  if ([string]::IsNullOrWhiteSpace($token)) { Log ('FAIL token 文件里没有内容：' + $tokenFilePath + '（需要在第一行放 token 值）'); exit 2 }
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
  $repoRootPath = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd([char]'\', [char]'/')
  if ($tokenFilePath.StartsWith($repoRootPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    Log ('WARN token 文件在仓库目录里：' + $tokenFilePath + '；跑完立刻删除，不要提交。')
  }
  Log ('TOKEN source=file path=' + $tokenFilePath + '（值不打屏）')
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

function Get-PackageInfo([string]$rel) {
  $dir = Join-Path $RepoRoot $rel
  $pj = Join-Path $dir 'package.json'
  if (-not (Test-Path $pj)) { return $null }
  $j = [System.IO.File]::ReadAllText($pj) | ConvertFrom-Json
  if (-not $j.name -or -not $j.version) { return $null }
  if ($j.private -eq $true) { return $null }
  return [pscustomobject]@{ name = [string]$j.name; version = [string]$j.version; dir = $dir; rel = $rel }
}
function Test-Visible([string]$name, [string]$version) {
  npm @npmBase view ($name + '@' + $version) version --registry=$Registry 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
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
    Push-Location $c.dir
    $pout = npm @npmBase publish --access public --tag $Tag --registry=$Registry 2>&1 | Out-String
    Pop-Location
    $psafe = (Mask $pout).Trim()
    if ($psafe -match 'cannot publish over|previously published|previously staged|E409|409 Conflict') { Log 'PROBE-OK 写权限成立（registry 拒收已存在版本＝写链路通）'; exit 0 }
    if ($psafe -match 'E403|E401|EOTP|one-time pass|2FA|two-factor') { Log 'PROBE-FAIL 无写权限或被 2FA 卡住'; exit 1 }
    Log 'PROBE-FAIL 未知结果（见上屏尾部）'; exit 1
  }
  if ($todo.Count -eq 0) { Log 'DONE 本次没有要发的包'; exit 0 }
  Log ('PLAN 待发 ' + $todo.Count + ' 个：' + (($todo | ForEach-Object { $_.name + '@' + $_.version }) -join ', '))
  # 预发布闸：非 latest 的 tag 只许配预发布号，防止把正式号压在测试标签下。
  foreach ($p in $todo) {
    if ($Tag -ne 'latest' -and ($p.version -notmatch '-')) {
      Log ('FAIL 版本 ' + $p.version + ' 不是预发布号，不能发到 tag ' + $Tag + '：请先把版本号写成 X.Y.Z-beta.N')
      exit 1
    }
  }
  Log ('TAG ' + $Tag + '（latest 是所有人默认拿到的；其他 tag 只有显式安装才拿到，所以测试版发 beta 不会推给其他用户）')
  # ── 真机验证清单闸：本版清单票恰好一张且已关闭（规则见 docs/agents/real-machine-verification.md） ──
  # 只在本仓有 scripts/release-preflight.mts 时生效：五仓同步的 token 协议别处不带这套票务规则。
  $preflight = Join-Path $RepoRoot 'scripts/release-preflight.mts'
  if (-not (Test-Path $preflight)) { Log 'CHECK 跳过（本仓没有 scripts/release-preflight.mts）' }
  else {
    if ($DryRun) { Log 'CHECK 真机验证清单（DryRun 只提示不阻断）' } else { Log 'CHECK 真机验证清单：本版 [真机验证] 清单票恰好一张且已关闭' }
    Push-Location $RepoRoot
    $chkArgs = @('scripts/release-preflight.mts')
    if ($DryRun) { $chkArgs += '--soft' }
    $chkOut = (node @chkArgs 2>&1 | Out-String)
    $chkCode = $LASTEXITCODE
    Pop-Location
    $chkTrim = $chkOut.Trim(); if ($chkTrim.Length -gt 1200) { $chkTrim = $chkTrim.Substring($chkTrim.Length - 1200) }
    if (($chkCode -ne 0) -and (-not $DryRun)) { Log ('CHECK-FAIL 真机验证清单没通过（exit=' + $chkCode + '）：' + $chkTrim); exit 1 }
    if ($chkCode -ne 0) { Log ('CHECK-SOFT 演练模式不阻断：' + $chkTrim) } else { Log ('CHECK-OK ' + $chkTrim) }
  }
  if ($DryRun) { Log 'DRYRUN 只验到这里，不跑门禁不发布'; exit 0 }

  # ── 门禁：构建＋测试（仓根跑一次；较重，可 -SkipGate 跳过） ─────────────
  if (-not $SkipGate) {
    Log 'GATE 构建：npm run build（仓根）'
    Push-Location $RepoRoot; $b = cmd /c 'npm run build 2>&1' | Out-String; $bc = $LASTEXITCODE; Pop-Location
    if ($bc -ne 0) { Log ('GATE-FAIL 构建红 exit=' + $bc); exit 1 }
    Log 'GATE 构建绿'
    Log 'GATE 测试：npm test（仓根，verify＋smoke 较重）'
    Push-Location $RepoRoot; $t = cmd /c 'npm test 2>&1' | Out-String; $tc = $LASTEXITCODE; Pop-Location
    if ($tc -ne 0) { $tt = (Mask $t).Trim(); if ($tt.Length -gt 600) { $tt = $tt.Substring($tt.Length - 600) }; Log ('GATE-FAIL 测试红 exit=' + $tc + ' 尾部=' + $tt); exit 1 }
    Log 'GATE 测试绿'
  } else { Log 'GATE 跳过（-SkipGate）' }

  # ── 发布（依赖先行，失败不停，收尾统一算账） ───────────────────────────
  $done = @(); $staged = @(); $failed = @()
  foreach ($p in $todo) {
    Log ('PKG-BEGIN ' + $p.name + '@' + $p.version)
    Push-Location $p.dir
    $out = npm @npmBase publish --access public --tag $Tag --registry=$Registry 2>&1 | Out-String
    $code = $LASTEXITCODE
    Pop-Location
    $safe = (Mask $out).Trim()
    if ($code -eq 0) {
      $plus = (($safe -split '\r?\n') | Where-Object { $_ -match '^\+\s' } | Select-Object -First 3) -join '; '
      if ($plus -ne '') { Log ('PKG-OK ' + $p.name + '@' + $p.version + ' ' + $plus) } else { Log ('PKG-OK ' + $p.name + '@' + $p.version) }
      $done += ($p.name + '@' + $p.version)
      if (Test-Visible $p.name $p.version) { Log ('VERIFIED ' + $p.name + '@' + $p.version + '（即时可见）') }
      else {
        Push-Location $p.dir
        $rout = npm @npmBase publish --access public --tag $Tag --registry=$Registry 2>&1 | Out-String
        Pop-Location
        if ((Mask $rout) -match 'previously staged version|E409|409 Conflict') {
          Log ('STAGED ' + $p.name + '@' + $p.version + '（已受理、待可见）'); $staged += ($p.name + '@' + $p.version)
        } else { Log ('UNCONFIRMED ' + $p.name + '@' + $p.version + '（已受理但即时不可见；由复核确认）') }
      }
      continue
    }
    if (Test-Visible $p.name $p.version) {
      Log ('PKG-SKIP-staged ' + $p.name + '@' + $p.version + '（registry 已有该版本）'); $done += ($p.name + '@' + $p.version); continue
    }
    if ($safe -match 'previously staged version|E409|409 Conflict') {
      Log ('PKG-SKIP-staged ' + $p.name + '@' + $p.version + '（E409，视为已受理）'); $done += ($p.name + '@' + $p.version); $staged += ($p.name + '@' + $p.version); continue
    }
    if ($safe -match 'EOTP|one-time pass|2FA|two-factor') { Log ('PKG-FAIL ' + $p.name + ' 疑似被 2FA 卡住：换 Automation 或 Granular 写权限 token 再跑。') }
    else { $tail = $safe; if ($tail.Length -gt 800) { $tail = $tail.Substring($tail.Length - 800) }; Log ('PKG-FAIL ' + $p.name + ' exit=' + $code + ' 尾部=' + $tail) }
    $failed += ($p.name + '@' + $p.version)
  }

  # ── 复核：一次采样（缺省）／长轮询（-FullPost，宣布前用） ───────────────
  $recheck = @($todo | Where-Object { ($done -contains ($_.name + '@' + $_.version)) } | ForEach-Object { $_.name })
  if ($recheck.Count -gt 0) {
    if ($FullPost) {
      Log 'STAGE 3/3 长轮询（最多约 10min，直到三包全可见）'
      $ok = $true
      for ($i = 1; $i -le 20; $i++) {
        $miss = @($todo | Where-Object { ($done -contains ($_.name + '@' + $_.version)) -and -not (Test-Visible $_.name $_.version) })
        if ($miss.Count -eq 0) { Log 'POST-OK 三包全可见'; break }
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
  # ── 发布后：真机验证清单票补发布记录、建下一版占位票（失败只记日志，不改本次发布结果） ──
  $postflight = Join-Path $RepoRoot 'scripts/release-postflight.mts'
  if ($done.Count -eq 0) { Log 'POST 跳过（本轮没有成功的包）' }
  elseif (-not (Test-Path $postflight)) { Log 'POST 跳过（本仓没有 scripts/release-postflight.mts）' }
  else {
    Log 'POST 真机验证清单收尾：补发布记录、建下一版占位票'
    Push-Location $RepoRoot
    $pfOut = (node $postflight 2>&1 | Out-String)
    $pfCode = $LASTEXITCODE
    Pop-Location
    $pfTrim = $pfOut.Trim(); if ($pfTrim.Length -gt 1600) { $pfTrim = $pfTrim.Substring($pfTrim.Length - 1600) }
    if ($pfCode -ne 0) { Log ('POST-FAIL 收尾没走完（exit=' + $pfCode + '），不影响本次发布；下次发布前检查会拦缺票：' + $pfTrim) }
    else { Log ('POST-OK ' + $pfTrim) }
  }
  if ($failed.Count -gt 0) { Log ('FAIL 本轮失败 ' + $failed.Count + ' 个：' + ($failed -join ', ')); exit 1 }
  Log ('DONE 已发 ' + $done.Count + ' 个：' + ($done -join ', '))
  Write-Host '发布侧到此结束（三包全绿即交付）：安装一律用户侧做（市场升级/软件内升级/自装）。'
} finally {
  try { if (Test-Path $tempNpmrc) { Remove-Item $tempNpmrc -Force -ErrorAction SilentlyContinue } } catch { }
  try {
    if ($null -eq $hadNodeToken) { Remove-Item Env:\NODE_AUTH_TOKEN -ErrorAction SilentlyContinue }
    else { $env:NODE_AUTH_TOKEN = $hadNodeToken }
  } catch { }
}
