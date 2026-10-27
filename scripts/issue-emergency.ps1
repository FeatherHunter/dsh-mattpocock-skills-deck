# scripts/issue-emergency.ps1 —— deck 工具不可用时的票面应急助手
#
# 为什么存在：deck 工具本身坏掉、或 GitHub 通路抖得厉害时，票面操作仍要能完成，而且不能因为
# 「请求超时了但写入其实已经落盘」而重复评论、重复关闭。这个脚本把四个动作都做成幂等的：
# 先读回现状，目标状态已达成就不再写；写之后一定读回核对。
#
# 定位：应急路径，不是日常做法。正常读写票一律走 deck_issue_* 工具。
# 发布：不进 package 发布清单（build.mts 的 SHIPPED_SCRIPTS 只含两个脚本），只在本机用。
#
# 用法：
#   pwsh -NoProfile -File scripts/issue-emergency.ps1 -Ticket 1553 -Action read
#   pwsh -NoProfile -File scripts/issue-emergency.ps1 -Ticket 1553 -Action close
#   pwsh -NoProfile -File scripts/issue-emergency.ps1 -Ticket 1553 -Action unlabel -Value needs-info
#   pwsh -NoProfile -File scripts/issue-emergency.ps1 -Ticket 1553 -Action body -File .\new-body.md
#   pwsh -NoProfile -File scripts/issue-emergency.ps1 -Ticket 1553 -Action close -DryRun
#
# 退出码：0 = 目标状态已达成（可能是本次写成的，也可能是本来就达成）；1 = 失败。

param(
  [Parameter(Mandatory = $true)][int]$Ticket,
  [Parameter(Mandatory = $true)][ValidateSet("read", "close", "unlabel", "body")][string]$Action,
  [string]$Value = "",
  [string]$File = "",
  [string]$Repo = "",
  [int]$Retries = 3,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# 只匹配真实见过的传输层错误（裸 EOF 已经涵盖 unexpected EOF）。HTTP 状态码错误不在这里重试：
# 写操作重发可能重复落盘，失败后由各个动作读回现状，判断是不是其实已经达成。
$TransientPattern = "TLS handshake timeout|EOF|connect(ion)? refused|proxyconnect|i/o timeout"

function Write-Info([string]$Text) { Write-Output ("[issue-emergency] " + $Text) }
function Write-Fail([string]$Text) { [Console]::Error.WriteLine("[issue-emergency] 失败：" + $Text) }

function Resolve-Repo([string]$Given) {
  if ($Given) { return $Given }
  $url = (& git remote get-url origin 2>$null)
  if ($LASTEXITCODE -eq 0 -and $url) {
    $m = [regex]::Match($url, "github\.com[:/](?<owner>[^/]+)/(?<repo>[^/\.]+)")
    if ($m.Success) { return ($m.Groups["owner"].Value + "/" + $m.Groups["repo"].Value) }
  }
  throw "拿不到仓库身份：请在仓库目录里运行，或用 -Repo owner/name 指定。"
}

function Invoke-Gh([string[]]$GhArgs, [string]$StdinText, [string]$What) {
  # $Retries 是首次失败后最多再试几次，所以总尝试次数是 $Retries + 1；间隔 2/4/8 秒封顶。
  $attempt = 0
  $lastText = ""
  while ($true) {
    $attempt++
    if ($null -ne $StdinText) { $out = ($StdinText | & gh @GhArgs 2>&1) } else { $out = (& gh @GhArgs 2>&1) }
    $code = $LASTEXITCODE
    $text = ($out | Out-String).Trim()
    if ($code -eq 0) { return @{ ok = $true; text = $text; attempts = $attempt } }
    $lastText = $text
    if ($text -match $TransientPattern -and $attempt -le $Retries) {
      $delay = [Math]::Min(8, [Math]::Pow(2, $attempt))
      Write-Info ($What + " 第 " + $attempt + " 次失败（传输层），" + $delay + " 秒后重试")
      Start-Sleep -Seconds $delay
      continue
    }
    break
  }
  return @{ ok = $false; text = $lastText; attempts = $attempt }
}

function Get-Issue {
  $r = Invoke-Gh @("api", $script:BasePath) $null "读回票面"
  if (-not $r.ok) { Write-Fail ("读回票面没成功（attempts=" + $r.attempts + "）：" + $r.text); exit 1 }
  $script:LastReadAttempts = $r.attempts
  try { return ($r.text | ConvertFrom-Json) } catch {
    # gh 偶尔把提示打到 stderr；读回时只取 JSON 本体，避免一行提示把整段解析带崩。
    $m = [regex]::Match($r.text, '(?s){.*}')
    if ($m.Success) { try { return ($m.Value | ConvertFrom-Json) } catch { } }
    Write-Fail ("读回票面的 JSON 解析失败：" + $r.text); exit 1
  }
}

function Patch-Json([string]$Json, [string]$What) {
  return Invoke-Gh @("api", "-X", "PATCH", $script:BasePath, "--input", "-") $Json $What
}

# 写在请求返回失败之后：再读一次现状，若目标状态其实已经达成（典型是请求超时但写入已落盘），
# 就按成功收尾；否则才报失败。这一步是为了不再出现「超时后重发，结果重复评论／重复关闭」。
function Confirm-After-Error($Result, [string]$What, [scriptblock]$Achieved, [string]$AchievedText) {
  $issue = Get-Issue
  if (& $Achieved $issue) {
    Write-Info ($AchievedText + "（写入请求返回失败，但读回已达成，可能第一次请求已经落盘；attempts=" + $Result.attempts + "）。")
    exit 0
  }
  Write-Fail ($What + "没成功（attempts=" + $Result.attempts + "）：" + $Result.text)
  exit 1
}

function Show-Issue($Issue) {
  $labels = @($Issue.labels | ForEach-Object { $_.name }) -join ","
  Write-Info ("票 #" + $Ticket + "：" + $Issue.state + " | 标签 " + $(if ($labels) { $labels } else { "（无）" }) + " | 更新于 " + $Issue.updated_at)
  Write-Info ("标题：" + $Issue.title)
}

# 仓库身份与两段固定路径。
$script:Repo = Resolve-Repo $Repo
$script:BasePath = "/repos/" + $script:Repo + "/issues/" + $Ticket

[Console]::Error.WriteLine("[issue-emergency] 应急路径，正常请用 deck 工具。")

# -DryRun 一个网络请求都不发，只把将要执行的命令打出来，供人核对。
if ($DryRun) {
  switch ($Action) {
    "read"    { Write-Output ("[dry-run] gh api " + $script:BasePath) }
    "close"   { Write-Output ('[dry-run] ''{"state":"closed"}'' | gh api -X PATCH ' + $script:BasePath + ' --input -') }
    "unlabel" {
      if (-not $Value) { Write-Fail "-Action unlabel 需要 -Value <标签名>"; exit 1 }
      Write-Output ("[dry-run] gh api -X DELETE " + $script:BasePath + "/labels/" + $Value)
    }
    "body"    {
      if (-not $File) { Write-Fail "-Action body 需要 -File <正文文件路径>"; exit 1 }
      Write-Output ('[dry-run] ''{"body":"（正文文件里的内容）"}'' （正文取自 ' + $File + '） | gh api -X PATCH ' + $script:BasePath + ' --input -')
    }
  }
  Write-Info "dry-run 结束：没有发出任何写操作。"
  exit 0
}

switch ($Action) {
  "read" {
    $issue = Get-Issue
    Show-Issue $issue
    Write-Info ("读回成功（attempts=" + $script:LastReadAttempts + "）。")
    exit 0
  }

  "close" {
    $issue = Get-Issue
    if ($issue.state -eq "closed") {
      Write-Info ("已达成、未写：票本来就是 closed，不重发关闭（读回 attempts=" + $script:LastReadAttempts + "）。")
      exit 0
    }
    $json = @{ state = "closed" } | ConvertTo-Json -Compress
    $r = Patch-Json $json "关闭票"
    if (-not $r.ok) { Confirm-After-Error $r "关闭" { param($i) $i.state -eq "closed" } "读回确认票已是 closed" }
    $after = Get-Issue
    if ($after.state -eq "closed") { Write-Info ("已关闭并读回核对通过（attempts=" + $r.attempts + "）。"); exit 0 }
    Write-Fail ("关闭请求返回成功，但读回仍是 " + $after.state + "，请人工核对。")
    exit 1
  }

  "unlabel" {
    if (-not $Value) { Write-Fail "-Action unlabel 需要 -Value <标签名>"; exit 1 }
    $issue = Get-Issue
    $labels = @($issue.labels | ForEach-Object { $_.name })
    if ($labels -notcontains $Value) {
      Write-Info ("已达成、未写：标签 " + $Value + " 本来就不在票上（读回 attempts=" + $script:LastReadAttempts + "）。")
      exit 0
    }
    $r = Invoke-Gh @("api", "-X", "DELETE", ($script:BasePath + "/labels/" + $Value)) $null "摘标签"
    if (-not $r.ok) { Confirm-After-Error $r ("摘标签 " + $Value) { param($i) (@($i.labels | ForEach-Object { $_.name }) -notcontains $Value) } "读回确认标签已不在票上" }
    $after = Get-Issue
    $afterLabels = @($after.labels | ForEach-Object { $_.name })
    if ($afterLabels -notcontains $Value) { Write-Info ("标签已摘掉并读回核对通过（attempts=" + $r.attempts + "）。"); exit 0 }
    Write-Fail ("摘标签请求返回成功，但读回标签里仍有 " + $Value + "，请人工核对。")
    exit 1
  }

  "body" {
    if (-not $File) { Write-Fail "-Action body 需要 -File <正文文件路径>"; exit 1 }
    if (-not (Test-Path -LiteralPath $File)) { Write-Fail ("正文文件不存在：" + $File); exit 1 }
    $newBody = (Get-Content -LiteralPath $File -Raw)
    $newBody = $newBody -replace "`r`n", "`n"
    $issue = Get-Issue
    $oldBody = ([string]$issue.body) -replace "`r`n", "`n"
    if ($oldBody.TrimEnd() -eq $newBody.TrimEnd()) {
      Write-Info ("已达成、未写：正文与文件一致（首尾空白不计，读回 attempts=" + $script:LastReadAttempts + "）。")
      exit 0
    }
    $json = @{ body = $newBody } | ConvertTo-Json -Compress
    $r = Patch-Json $json "改正文"
    if (-not $r.ok) { Confirm-After-Error $r "改正文" { param($i) ((([string]$i.body) -replace "`r`n", "`n").TrimEnd() -eq $newBody.TrimEnd()) } "读回确认正文已是新内容" }
    $after = Get-Issue
    $afterBody = ([string]$after.body) -replace "`r`n", "`n"
    if ($afterBody.TrimEnd() -eq $newBody.TrimEnd()) { Write-Info ("正文已写入并读回核对通过（首尾空白不计，attempts=" + $r.attempts + "）。"); exit 0 }
    Write-Fail ("正文写入后读回与文件不一致：长度 " + $afterBody.Length + " vs " + $newBody.Length + "，请人工核对。")
    exit 1
  }
}
