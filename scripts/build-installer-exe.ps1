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

$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "manifest.json") | ConvertFrom-Json
$releaseName = "IDPhoto-MAX-Setup-v$($manifest.version)"
$exePath = Join-Path $OutputDirectory "$releaseName.exe"
$hashPath = "$exePath.sha256"
$sourcePath = Join-Path $ProjectRoot "scripts\installer\IDPhotoMaxInstaller.cs"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("IDPhotoMAX-Build-" + [guid]::NewGuid().ToString("N"))

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

if (-not (Test-Path -LiteralPath $compiler)) {
  throw "64-bit .NET Framework C# compiler was not found: $compiler"
}
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Installer source was not found: $sourcePath"
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
  & (Join-Path $PSScriptRoot "package-plugin.ps1") -ProjectRoot $ProjectRoot -OutputDirectory $tempRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Plugin package build failed"
  }

  $payloadPath = Join-Path $tempRoot "idphoto-max-v$($manifest.version).zip"
  if (-not (Test-Path -LiteralPath $payloadPath)) {
    throw "Plugin payload was not created: $payloadPath"
  }

  if (Test-Path -LiteralPath $exePath) {
    Remove-Item -LiteralPath $exePath -Force
  }
  if (Test-Path -LiteralPath $hashPath) {
    Remove-Item -LiteralPath $hashPath -Force
  }

  & $compiler /nologo /target:winexe /platform:anycpu /optimize+ `
    "/out:$exePath" `
    "/resource:$payloadPath,IDPhotoMax.Payload.zip" `
    /reference:System.Windows.Forms.dll `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll `
    $sourcePath
  if ($LASTEXITCODE -ne 0) {
    throw "Installer EXE compilation failed"
  }

  $hash = Get-ReleaseSha256 -Path $exePath
  Set-Content -LiteralPath $hashPath -Encoding ASCII -Value (
    "{0}  {1}" -f $hash.ToLowerInvariant(), (Split-Path -Leaf $exePath)
  )

  Write-Host "Installer created: $exePath"
  Write-Host "SHA256: $($hash.ToLowerInvariant())"
} finally {
  $tempFull = [System.IO.Path]::GetFullPath($tempRoot)
  $systemTempFull = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (
    (Test-Path -LiteralPath $tempRoot) -and
    $tempFull.StartsWith($systemTempFull, [System.StringComparison]::OrdinalIgnoreCase) -and
    (Split-Path -Leaf $tempFull).StartsWith("IDPhotoMAX-Build-", [System.StringComparison]::Ordinal)
  ) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
