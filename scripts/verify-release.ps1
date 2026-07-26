param(
  [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

if (-not $ProjectRoot) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)

function Assert-ReleaseCondition {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Invoke-NativeCheck {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit $LASTEXITCODE): $Command $($Arguments -join ' ')"
  }
}

Push-Location $ProjectRoot
try {
  Write-Host "[1/6] Running automated tests"
  Invoke-NativeCheck "npm.cmd" @("test")

  Write-Host "[2/6] Checking JavaScript syntax"
  $javascriptFiles = Get-ChildItem -Path @("src", "tests") -Recurse -File -Filter "*.js"
  foreach ($file in $javascriptFiles) {
    Invoke-NativeCheck "node.exe" @("--check", $file.FullName)
  }

  Write-Host "[3/6] Validating manifest and version documents"
  $manifestPath = Join-Path $ProjectRoot "manifest.json"
  $manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
  $packageJson = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json
  Assert-ReleaseCondition ($manifest.manifestVersion -eq 5) "manifestVersion must be 5"
  Assert-ReleaseCondition ($manifest.id -eq "com.fuqingyinxiang.idphoto.panel") "Unexpected plugin id"
  Assert-ReleaseCondition ($manifest.version -match '^\d+\.\d+\.\d+$') "Invalid manifest version"
  Assert-ReleaseCondition ($packageJson.version -eq $manifest.version) "package.json version does not match manifest"
  Assert-ReleaseCondition (Test-Path -LiteralPath (Join-Path $ProjectRoot $manifest.main)) "manifest.main does not exist"

  $readme = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "README.md")
  $changelog = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "CHANGELOG.md")
  $progress = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "DEV_PROGRESS.md")
  Assert-ReleaseCondition ($readme -match [regex]::Escape("v$($manifest.version)")) "README version does not match manifest"
  Assert-ReleaseCondition ($changelog -match "(?m)^## $([regex]::Escape($manifest.version))$") "CHANGELOG version does not match manifest"
  Assert-ReleaseCondition ($progress -match [regex]::Escape("v$($manifest.version)")) "DEV_PROGRESS version does not match manifest"

  Write-Host "[4/6] Checking release UI surface"
  $html = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "index.html")
  $main = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "src\main.js")
  Assert-ReleaseCondition ($html -notmatch 'id="buildText"|build:\s*\d{4}-\d{2}-\d{2}') "Internal build marker must not ship in the UI"
  Assert-ReleaseCondition ($main -notmatch 'BUILD_TIME|\[idphoto-build\]') "Internal build marker must not ship in runtime code"

  Write-Host "[5/6] Validating Photoshop execution seam and retired features"
  $sourceFiles = Get-ChildItem -Path "src" -Recurse -File -Filter "*.js"
  $directExecution = $sourceFiles |
    Where-Object { $_.FullName -notlike "*\photoshopExecution.js" } |
    Select-String -Pattern 'action\.batchPlay|core\.executeAsModal'
  Assert-ReleaseCondition (-not $directExecution) "Direct Photoshop execution found outside photoshopExecution"
  $retiredSubjectDetection = @($sourceFiles) + @(Get-Item "index.html") |
    Select-String -Pattern 'IDPhotoSubjectDetectionService|subjectDetectionService|autoCutout'
  Assert-ReleaseCondition (-not $retiredSubjectDetection) "Retired subject-detection call found"
  $debugMarkers = @($sourceFiles) + @(Get-ChildItem -Path "tests" -Recurse -File -Filter "*.js") |
    Select-String -SimpleMatch '[DEBUG-'
  Assert-ReleaseCondition (-not $debugMarkers) "Unreleased [DEBUG- marker found"

  Write-Host "[6/6] Validating release files"
  @(
    "manifest.json",
    "index.html",
    "styles.css",
    "src\main.js",
    "bridge\print-dsrx1.ps1",
    "scripts\install-plugin.ps1",
    "scripts\install-plugin.cmd"
  ) | ForEach-Object {
    Assert-ReleaseCondition (Test-Path -LiteralPath (Join-Path $ProjectRoot $_)) "Missing release file: $_"
  }
  $bridgePath = Join-Path $ProjectRoot "bridge\print-dsrx1.ps1"
  $bridgeScript = Get-Content -Raw -Encoding UTF8 $bridgePath
  Assert-ReleaseCondition ($bridgeScript -notmatch '[^\x00-\x7F]') "PowerShell 5.1 bridge must remain ASCII-only"
  Assert-ReleaseCondition ($bridgeScript -notmatch '\[DEBUG-') "Unreleased bridge debug marker found"
  [void][scriptblock]::Create($bridgeScript)

  Write-Host "Release verification passed: IDPhoto MAX v$($manifest.version)"
} finally {
  Pop-Location
}
