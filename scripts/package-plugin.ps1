param(
  [string]$ProjectRoot = "",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

if (-not $ProjectRoot) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $ProjectRoot "dist"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

function Get-ReleaseSha256 {
  param([string]$Path)
  if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
  }
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha256.Dispose()
  }
}

& (Join-Path $PSScriptRoot "verify-release.ps1") -ProjectRoot $ProjectRoot
if ($LASTEXITCODE -ne 0) {
  throw "Release verification failed"
}

$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "manifest.json") | ConvertFrom-Json
$releaseName = "idphoto-max-v$($manifest.version)"
$stageRoot = Join-Path $OutputDirectory $releaseName
$zipPath = Join-Path $OutputDirectory "$releaseName.zip"
$hashPath = "$zipPath.sha256"

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputFull = [System.IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\') + '\'
$stageFull = [System.IO.Path]::GetFullPath($stageRoot)
if (-not $stageFull.StartsWith($outputFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean a staging path outside the output directory: $stageFull"
}

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path -LiteralPath $hashPath) {
  Remove-Item -LiteralPath $hashPath -Force
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
@("manifest.json", "index.html", "styles.css", "README.md", "CHANGELOG.md") | ForEach-Object {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot $_) -Destination $stageRoot -Force
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot "src") -Destination $stageRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "bridge") -Destination $stageRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "scripts\install-plugin.ps1") -Destination $stageRoot -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "scripts\install-plugin.cmd") -Destination $stageRoot -Force

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
$hash = Get-ReleaseSha256 -Path $zipPath
Set-Content -LiteralPath $hashPath -Encoding ASCII -Value ("{0}  {1}" -f $hash.ToLowerInvariant(), (Split-Path -Leaf $zipPath))

Write-Host "Release package created: $zipPath"
Write-Host "SHA256: $($hash.ToLowerInvariant())"
