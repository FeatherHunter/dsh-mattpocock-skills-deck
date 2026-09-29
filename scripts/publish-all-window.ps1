# ============================================================
# publish-all-window.ps1 —— 全链发布窗口（底座库加主插件，人只扫码）
#
# 效果验收：人只做两件事——在黑窗口里按回车、在浏览器里完成二次验证。
# 人不敲命令、不复制命令、不复制窗口内容。Agent 只读状态文件加云端复查。
#
# 发什么（依赖先行，写死顺序不猜测）：
#   1. packages/dsh-log（底座库：日志能力）
#   2. packages/dsh-plugin-update（底座库：更新能力）
#   3. package（主插件 dsh-mattpocock-skills-deck，含 25 个捆绑技能）
# 技能随主插件一起发，不单独发。
#
# 设计约束（来自 handoff 实测，照抄即用）：
#   1. 网页审批流要求【真实窗口加本人点】：Agent 后台直接跑会报 EOTP，
#      隔空传验证码必过期——发布动作必须发生在人看得见的窗口、由本人点。
#   2. Agent 直接起的窗口开在人看不见的会话（实测 MainWindowHandle=0）——必须用
#      计划任务的交互模式（schtasks /IT）把窗口送到人的桌面。
#   3. 系统代码页可能为 65001：本脚本必须 UTF-8(BOM) 保存、脚本内显式设输出编码；脚本路径避开中文。
#
# 用法（由 Agent 执行，人不敲）：
#   schtasks /create /tn "DSHPublishAll" /tr "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File <本脚本绝对路径>" /sc once /st 23:59 /it /f
#   schtasks /run /tn "DSHPublishAll"
#   人：看窗口 → 按回车开浏览器 → 二次验证 → 回车 → 等到每家都出现 + <包名>@<版本> → 回车关窗
#   收尾：schtasks /delete /tn "DSHPublishAll" /f
#
# 引号坑（实测踩过）：任务命令里嵌套带引号路径会报 ERROR: Invalid argument/option。
#   路径不含空格时直接去掉所有内层引号即过；含空格先用 -Preview 试出能建任务的写法再真发。
#
# 状态文件（Agent 只认这些，不靠人口述）：
#   每个包目录各写一份 .tmp-publish-status.json（退出码、阶段、包名、版本、目录）。
#   全链汇总写一份 <仓库根>/.tmp-publish-all-status.json（每个包的结论）。
#   整窗转录写 <仓库根>/.tmp-publish-all-<时间>.log（辅助定位）。
#   Agent 轮询这些文件加官方源复查；人说成功失败都不算数，以文件加云端为准。
#
# 参数：
#   -RepoRoot  仓库根（缺省＝本脚本上一级）
#   -Registry  npm 官方源（缺省 https://registry.npmjs.org）
#   -Preview   预览模式：只显示待发清单，不执行登录与发布
# ============================================================
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$Registry = 'https://registry.npmjs.org',
    [switch]$Preview
)

$Host.UI.RawUI.WindowTitle = 'DSH npm 全链发布窗口'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

# 依赖先行，顺序写死。
$Order = @(
    'packages/dsh-log',
    'packages/dsh-plugin-update',
    'package'
)

$AllLog = Join-Path $RepoRoot ('.tmp-publish-all-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$AllStatusPath = Join-Path $RepoRoot '.tmp-publish-all-status.json'
try {
    Remove-Item $AllStatusPath -Force -ErrorAction SilentlyContinue
    Start-Transcript -Path $AllLog -Force | Out-Null
    Write-Host ('转录文件: ' + $AllLog)
} catch {
    Write-Host ('（转录没开起来，不影响发布：' + $_.Exception.Message + '）')
}

function Get-PackageInfo([string]$RelDir) {
    $dir = Join-Path $RepoRoot $RelDir
    $pj = Join-Path $dir 'package.json'
    if (-not (Test-Path $pj)) { return $null }
    try {
        $j = Get-Content $pj -Raw | ConvertFrom-Json
    } catch { return $null }
    if (-not $j.name -or -not $j.version) { return $null }
    if ($j.private -eq $true) { return $null }
    return [pscustomobject]@{ name = [string]$j.name; version = [string]$j.version; dir = $dir; rel = $RelDir }
}

function Test-Published([string]$Name, [string]$Version) {
    npm view ($Name + '@' + $Version) version --registry=$Registry 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Write-PackageStatus([string]$Dir, [int]$ExitCode, [string]$Phase, [string]$Name, [string]$Version) {
    try {
        $status = [ordered]@{
            exitCode = $ExitCode
            phase    = $Phase
            name     = $Name
            version  = $Version
            dir      = $Dir
            log      = $AllLog
            at       = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        } | ConvertTo-Json
        Set-Content -Path (Join-Path $Dir '.tmp-publish-status.json') -Value $status -Encoding UTF8
    } catch {
        Write-Host ('（状态文件没写成 ' + $Dir + '：' + $_.Exception.Message + '）')
    }
}

function Write-AllStatus($Results) {
    try {
        $summary = [ordered]@{
            at       = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
            registry = $Registry
            log      = $AllLog
            results  = $Results
        } | ConvertTo-Json -Depth 5
        Set-Content -Path $AllStatusPath -Value $summary -Encoding UTF8
        Write-Host ('全链状态文件: ' + $AllStatusPath)
    } catch {
        Write-Host ('（全链状态文件没写成：' + $_.Exception.Message + '）')
    }
}

Write-Host ''
Write-Host '============================================================'
Write-Host '  DSH npm 全链发布窗口（Agent 已启动，由你完成二次验证）'
Write-Host '============================================================'
Write-Host '  1. 看到授权链接后按回车 → 浏览器打开授权页'
Write-Host '  2. 在浏览器完成登录加二次验证确认'
Write-Host '  3. 回到本窗口再按回车'
Write-Host '  成功标志: 每个包各出现一行 + <包名>@<版本>'
Write-Host '  你不用敲命令、不用复制窗口内容，Agent 会自己读状态文件。'
Write-Host '============================================================'
Write-Host ''
Write-Host ('仓库根: ' + $RepoRoot)
Write-Host ('官方源: ' + $Registry)
Write-Host ''

# ── 读表：云端已有＝跳过，只有云端没有的才发 ──
$all = @()
foreach ($rel in $Order) {
    $info = Get-PackageInfo $rel
    if ($null -eq $info) {
        Write-Host ('SKIP ' + $rel + '（无包清单或私有，跳过）')
        continue
    }
    $all += $info
}
if ($all.Count -eq 0) { Write-Host 'FAIL 没有匹配的包'; try { Stop-Transcript | Out-Null } catch { }; Read-Host '按回车关闭窗口'; exit 1 }

$todo = @()
foreach ($p in $all) {
    if (Test-Published $p.name $p.version) {
        Write-Host ('SKIP ' + $p.name + '@' + $p.version + ' 云端已有')
        Write-PackageStatus $p.dir 0 'skip' $p.name $p.version
    } else {
        Write-Host ('TODO ' + $p.name + '@' + $p.version + ' 云端没有')
        $todo += $p
    }
}
if ($todo.Count -eq 0) {
    Write-Host 'DONE 本次没有要发的包'
    Write-AllStatus @($all | ForEach-Object { [ordered]@{ name = $_.name; version = $_.version; result = 'skip' } })
    try { Stop-Transcript | Out-Null } catch { }
    Read-Host '按回车关闭窗口'
    exit 0
}
Write-Host ('PLAN 待发 ' + $todo.Count + ' 个：' + (($todo | ForEach-Object { $_.name + '@' + $_.version }) -join ', '))

if ($Preview) {
    Write-Host '[预览模式] 不执行登录与发布，仅验证窗口、编码与待发清单。'
    Write-AllStatus @($todo | ForEach-Object { [ordered]@{ name = $_.name; version = $_.version; result = 'preview' } })
    try { Stop-Transcript | Out-Null } catch { }
    Read-Host '按回车关闭窗口'
    exit 0
}

# ── 登录检查：只登一次，后面多包共用 ──
Write-Host ''
Write-Host '--- 登录检查 ---'
npm whoami --registry=$Registry
if ($LASTEXITCODE -ne 0) {
    Write-Host '未登录：下面走【网页登录】，浏览器打开授权页 → 登录加二次验证 → 自动继续'
    Read-Host '按回车打开浏览器登录'
    npm login --auth-type=web --registry=$Registry
    if ($LASTEXITCODE -ne 0) {
        Write-Host '登录失败（Agent 会读状态文件定位，不用你复制窗口内容）'
        $res = @($todo | ForEach-Object { [ordered]@{ name = $_.name; version = $_.version; result = 'login-fail' } })
        Write-AllStatus $res
        try { Stop-Transcript | Out-Null } catch { }
        Read-Host '按回车关闭窗口'
        exit 1
    }
    Write-Host '登录成功，继续发布...'
}

# ── 按依赖顺序发布 ──
$results = @()
foreach ($p in $todo) {
    Write-Host ''
    Write-Host ('PKG-BEGIN ' + $p.name + '@' + $p.version)
    Write-Host '  若出现授权链接 → 按回车 → 浏览器完成二次验证 → 回车。'
    Push-Location $p.dir
    $pubOut = npm publish --access public --registry=$Registry --auth-type=web 2>&1 | Tee-Object -Variable pubOutRaw | Out-String
    $code = $LASTEXITCODE
    Pop-Location
    $pubText = if ($pubOut) { [string]$pubOut } else { '' }
    if ($code -ne 0 -and ($pubText -match 'previously staged version' -or $pubText -match 'E409' -or $pubText -match '409 Conflict')) {
        Write-Host ('PKG-SKIP-staged ' + $p.name + '@' + $p.version + '（云端已暂存该版本，视为已发）')
        Write-PackageStatus $p.dir 0 'staged' $p.name $p.version
        $results += [ordered]@{ name = $p.name; version = $p.version; result = 'staged' }
        continue
    }
    if ($code -ne 0) {
        Write-Host ('PKG-FAIL ' + $p.name + ' exit=' + $code + '（Agent 会读状态文件定位，不用你复制窗口内容）')
        Write-PackageStatus $p.dir $code 'publish' $p.name $p.version
        $results += [ordered]@{ name = $p.name; version = $p.version; result = 'fail'; exitCode = $code }
        Write-AllStatus $results
        try { Stop-Transcript | Out-Null } catch { }
        Read-Host '按回车关闭窗口'
        exit 1
    }
    Write-Host ('PKG-OK ' + $p.name + '@' + $p.version)
    Write-PackageStatus $p.dir 0 'publish' $p.name $p.version
    $results += [ordered]@{ name = $p.name; version = $p.version; result = 'ok' }
}

Write-Host ''
Write-Host '============================================================'
Write-Host ('全链发布结束，已发 ' + $results.Count + ' 个')
Write-Host 'Agent 会自己去官方源查版本表复核，以那边为准。'
Write-Host '============================================================'
Write-AllStatus $results
try { Stop-Transcript | Out-Null } catch { }

Read-Host '按回车关闭窗口'
