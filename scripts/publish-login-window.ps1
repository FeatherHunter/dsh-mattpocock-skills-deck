# ============================================================
# publish-login-window.ps1 - npm login + publish (two steps)
#   UTF-8(BOM) required - Chinese comments break under GBK
# ============================================================
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageDir,
    [switch]$Preview
)

$Host.UI.RawUI.WindowTitle = 'DSH npm publish window'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ''
Write-Host '============================================================'
Write-Host '  DSH npm login + publish window'
Write-Host '============================================================'
Write-Host ('PackageDir: ' + $PackageDir)
Write-Host ''

Write-Host '--- Step 1: check login ---'
npm whoami --registry=https://registry.npmjs.org 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host 'Already logged in. Skip login.'
} else {
    Write-Host 'Not logged in. Starting npm login (web approval flow):'
    Write-Host '  1. Press ENTER when you see Auth URL -> browser opens'
    Write-Host '  2. Login + 2FA confirm in browser'
    Write-Host '  3. Press ENTER again in this window'
    Read-Host 'Press ENTER to start npm login'
    npm login --registry=https://registry.npmjs.org
    Write-Host ('login exit code: ' + $LASTEXITCODE)
    npm whoami --registry=https://registry.npmjs.org 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'LOGIN FAILED. Please copy window content to Agent.'
        Read-Host 'Press ENTER to close'
        exit 1
    }
    Write-Host 'Login OK!'
}

Write-Host ''
Write-Host '--- Step 2: npm publish ---'
if ($Preview) {
    Write-Host '[Preview] not publishing.'
    Read-Host 'Press ENTER to close'
    exit 0
}

Set-Location -Path $PackageDir
Write-Host 'npm publish started. If Auth URL appears -> ENTER -> browser -> 2FA -> ENTER.'
npm publish --registry=https://registry.npmjs.org

Write-Host ''
Write-Host '============================================================'
Write-Host ('publish exit code: ' + $LASTEXITCODE)
if ($LASTEXITCODE -eq 0) {
    # 第一性原理：SUCCESS 文不再硬编码，动态读 package.json（兼容 Set-Location 后 $PackageDir 仍有效，回退读当前目录）
    $pkgInfo = $null
    try { $pkgInfo = Get-Content (Join-Path $PackageDir 'package.json') -Raw | ConvertFrom-Json } catch {}
    if (-not $pkgInfo) { try { $pkgInfo = Get-Content './package.json' -Raw | ConvertFrom-Json } catch {} }
    if ($pkgInfo -and $pkgInfo.name -and $pkgInfo.version) { Write-Host ("  SUCCESS: + $($pkgInfo.name)@$($pkgInfo.version)") } else { Write-Host '  SUCCESS: publish exit 0 (check + <package>@<version> above)' }
} else {
    Write-Host '  FAILED - please copy window content to Agent'
}
Write-Host '============================================================'
Read-Host 'Press ENTER to close'