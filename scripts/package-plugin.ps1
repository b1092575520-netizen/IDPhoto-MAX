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
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath
Set-Content -LiteralPath $hashPath -Encoding ASCII -Value ("{0}  {1}" -f $hash.Hash.ToLowerInvariant(), (Split-Path -Leaf $zipPath))

Write-Host "Release package created: $zipPath"
Write-Host "SHA256: $($hash.Hash.ToLowerInvariant())"
