# ============================================================
# publish-login-window.ps1 —— npm 登录加发布窗口（Agent 启动，人只扫码）
#
# 效果验收：人只做两件事——在黑窗口里按回车、在浏览器里完成二次验证。
# 人不敲命令、不复制命令、不复制窗口内容。Agent 只读状态文件加云端复查。
#
# 设计约束（来自 handoff 实测，照抄即用）：
#   1. 网页审批流要求【真实窗口加本人点】：Agent 后台直接跑会报 EOTP，
#      隔空传验证码必过期——发布动作必须发生在人看得见的窗口、由本人点。
#   2. Agent 直接起的窗口开在人看不见的会话（实测 MainWindowHandle=0）——必须用
#      计划任务的交互模式（schtasks /IT）把窗口送到人的桌面。
#   3. 系统代码页可能为 65001：本脚本必须 UTF-8(BOM) 保存、脚本内显式设输出编码；脚本路径避开中文。
#
# 用法（由 Agent 执行，人不敲）：
#   schtasks /create /tn "DSHPublish" /tr "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File <本脚本绝对路径> -PackageDir <包目录>" /sc once /st 23:59 /it /f
#   schtasks /run /tn "DSHPublish"
#   人：看窗口 → 按回车开浏览器 → 二次验证 → 回车
#   收尾：schtasks /delete /tn "DSHPublish" /f
#
# 引号坑（实测踩过）：任务命令里嵌套带引号路径会报 ERROR: Invalid argument/option。
#   三条路径都不含空格时直接去掉所有内层引号即过；含空格先用 -Preview 试出能建任务的写法再真发。
#
# 参数：
#   -PackageDir  待发布包目录（必填）
#   -Registry    npm 官方源（缺省 https://registry.npmjs.org）
#   -Preview     预览模式：只显示横幅与目录，不执行登录与发布
# ============================================================
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageDir,
    [string]$Registry = 'https://registry.npmjs.org',
    [switch]$Preview
)

$Host.UI.RawUI.WindowTitle = 'DSH npm 发布窗口'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ── 结果落盘：转录日志加权威状态文件都写进包目录 ──
# Agent 只认状态文件，不靠人口述窗口内容。窗口看着像成了、云端却没有的那次事故，
# 就是靠云端复查而不是人口述才发现的。
$PublishLog = Join-Path $PackageDir ('.tmp-publish-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$PublishStatus = Join-Path $PackageDir '.tmp-publish-status.json'
try {
    Remove-Item $PublishStatus -Force -ErrorAction SilentlyContinue
    Start-Transcript -Path $PublishLog -Force | Out-Null
    Write-Host ('转录文件: ' + $PublishLog)
} catch {
    Write-Host ('（转录没开起来，不影响发布：' + $_.Exception.Message + '）')
}

function Write-PublishStatus([int]$ExitCode, [string]$Phase) {
    $ver = ''
    $name = ''
    try {
        # 中文包清单必须用 .NET 方法读（能识别 UTF-8），Get-Content 无 -Encoding 会按系统
        # ANSI 解码致乱码并使 ConvertFrom-Json 失败（2026-09-29 实测，见 publish-all-window）。
        $pkgRaw = [System.IO.File]::ReadAllText((Join-Path $PackageDir 'package.json')) | ConvertFrom-Json
        if ($pkgRaw.version) { $ver = [string]$pkgRaw.version }
        if ($pkgRaw.name) { $name = [string]$pkgRaw.name }
    } catch { $ver = 'unknown' }
    if ($ver -eq '') {
        try { $ver = (& npm pkg get version 2>$null | Out-String).Trim().Trim('"') } catch { $ver = 'unknown' }
    }
    try {
        $status = [ordered]@{
            exitCode = $ExitCode
            phase    = $Phase
            name     = $name
            version  = $ver
            dir      = $PackageDir
            log      = $PublishLog
            at       = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        } | ConvertTo-Json
        Set-Content -Path $PublishStatus -Value $status -Encoding UTF8
        Write-Host ('状态文件: ' + $PublishStatus)
    } catch {
        Write-Host ('（状态文件没写成：' + $_.Exception.Message + '）')
    }
}

Write-Host ''
Write-Host '============================================================'
Write-Host '  DSH npm 发布窗口（Agent 已启动，由你完成二次验证）'
Write-Host '============================================================'
Write-Host '  1. 看到授权链接后按回车 → 浏览器打开授权页'
Write-Host '  2. 在浏览器完成登录加二次验证确认'
Write-Host '  3. 回到本窗口再按回车'
Write-Host '  成功标志: + <包名>@<版本>'
Write-Host '  你不用敲命令、不用复制窗口内容，Agent 会自己读状态文件。'
Write-Host '============================================================'
Write-Host ''
Write-Host ('发布目录: ' + $PackageDir)
Write-Host ('官方源: ' + $Registry)
Write-Host ''

if ($Preview) {
    Write-Host '[预览模式] 不执行登录与发布，仅验证窗口与编码。'
    Read-Host '按回车关闭窗口'
    exit 0
}

Set-Location -Path $PackageDir

# ── 登录门禁：npm 10 未登录时 publish 不给授权链接、直接报需登录 ──
# 必须先走网页登录拿到令牌，之后发布才走浏览器审批流。
$whoami = npm whoami --registry=$Registry 2>$null
if ($LASTEXITCODE -ne 0 -or -not $whoami) {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host '  未检测到登录（未登录时发布会直接报需登录）'
    Write-Host '  接下来走【网页登录】：浏览器打开授权页 → 登录加二次验证 → 自动继续'
    Write-Host '============================================================'
    Write-Host ''
    Read-Host '按回车打开浏览器登录'
    npm login --auth-type=web --registry=$Registry
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '登录失败（Agent 会读状态文件定位，不用你复制窗口内容）'
        Write-PublishStatus 1 'login'
        try { Stop-Transcript | Out-Null } catch { }
        Read-Host '按回车关闭窗口'
        exit 1
    }
    Write-Host '登录成功，继续发布...'
    Write-Host ''
}

Write-Host '发布开始。若出现授权链接 → 按回车 → 浏览器完成二次验证 → 回车。'
npm publish --registry=$Registry --auth-type=web
$publishExit = $LASTEXITCODE

Write-Host ''
Write-Host '============================================================'
Write-Host ('发布命令已结束，退出码: ' + $publishExit)
if ($publishExit -eq 0) {
    Write-Host '  上方出现 "+ <包名>@<版本>" 即为发布成功'
    Write-Host '  （Agent 还会自己去官方源查一遍版本表，以那边为准）'
} else {
    Write-Host '  发布失败（Agent 会读状态文件定位，不用你复制窗口内容）'
}
Write-Host '============================================================'

# 权威判据落盘：Agent 读这一份，不必等人口述窗口内容。
Write-PublishStatus $publishExit 'publish'
try { Stop-Transcript | Out-Null } catch { }

Read-Host '按回车关闭窗口'
