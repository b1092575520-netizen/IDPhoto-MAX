param(
  [string]$PackageRoot = "",
  [switch]$DryRun,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

if (-not $PackageRoot) {
  $PackageRoot = $PSScriptRoot
}
$PackageRoot = [System.IO.Path]::GetFullPath($PackageRoot)
$manifestPath = Join-Path $PackageRoot "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Incomplete package: manifest.json was not found"
}
$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
$minimumMajor = [int]([regex]::Match([string]$manifest.host.minVersion, '^\d+').Value)
$bridgeSource = Join-Path $PackageRoot "bridge\print-dsrx1.ps1"
$bridgeRoot = Join-Path $env:ProgramData "IDPhotoMAX"
$bridgeTarget = Join-Path $bridgeRoot "print-dsrx1.ps1"
$uxpPluginsRoot = Join-Path ${env:CommonProgramFiles} "Adobe\UXP\Plugins\External"
$uxpRegistration = Join-Path ${env:CommonProgramFiles} 'Adobe\UXP\PluginsInfo\v1\PS.json'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RegisteredPluginTarget {
  param([string]$RegistrationPath, [string]$SystemPluginsRoot, [string]$PluginId)
  if (-not (Test-Path -LiteralPath $RegistrationPath -PathType Leaf)) {
    throw 'Adobe plugin registration was not found. Install the CCX through Adobe before using this updater.'
  }
  $registration = Get-Content -LiteralPath $RegistrationPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $matches = @($registration.plugins | Where-Object { $_.pluginId -eq $PluginId })
  if ($matches.Count -ne 1) { throw 'Expected one Adobe registration for this plugin; no installation folders were changed.' }
  $registeredPath = [string]$matches[0].path
  if ($registeredPath -notmatch '^\$systemPlugins[\\/]+External[\\/]+') {
    throw 'Unsupported registered plugin location; refusing to invent a replacement path.'
  }
  $externalRoot = [IO.Path]::GetFullPath((Join-Path $SystemPluginsRoot 'External')).TrimEnd('\') + '\'
  $target = [IO.Path]::GetFullPath($registeredPath.Replace('$systemPlugins', $SystemPluginsRoot))
  if (-not $target.StartsWith($externalRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetDirectoryName($target).TrimEnd('\') -ne $externalRoot.TrimEnd('\')) {
    throw 'Registered plugin path escapes the expected Adobe External folder.'
  }
  return $target
}

function Find-CompatiblePhotoshopHosts {
  $adobeRoot = Join-Path $env:ProgramFiles "Adobe"
  if (-not (Test-Path -LiteralPath $adobeRoot)) {
    return @()
  }
  return @(Get-ChildItem -LiteralPath $adobeRoot -Directory -Filter "Adobe Photoshop *" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '\(Beta\)' } |
    ForEach-Object {
      $photoshopExe = Join-Path $_.FullName "Photoshop.exe"
      if (Test-Path -LiteralPath $photoshopExe) {
        $versionText = (Get-Item -LiteralPath $photoshopExe).VersionInfo.ProductVersion
        $majorMatch = [regex]::Match([string]$versionText, '^\d+')
        if ($majorMatch.Success -and [int]$majorMatch.Value -ge $minimumMajor) {
          $_
        }
      }
    })
}

function Show-DeveloperToolFallback {
  $developerTool = Join-Path $env:ProgramFiles "Adobe\Adobe UXP Developer Tools\Adobe UXP Developer Tools.exe"
  Write-Host "No files were deployed. You can select this manifest in Adobe UXP Developer Tool: $manifestPath"
  if (Test-Path -LiteralPath $developerTool) {
    Write-Host "Adobe UXP Developer Tool detected: $developerTool"
  } else {
    Write-Host "Adobe UXP Developer Tool was not found. Install it, then load manifest.json."
  }
}

$uxpTarget = Get-RegisteredPluginTarget -RegistrationPath $uxpRegistration -SystemPluginsRoot (Split-Path $uxpPluginsRoot -Parent) -PluginId $manifest.id

$hosts = Find-CompatiblePhotoshopHosts
if (-not $hosts.Count) {
  Show-DeveloperToolFallback
  throw "Photoshop $minimumMajor or newer was not found"
}

if (-not $DryRun -and -not (Test-IsAdministrator)) {
  if ($Elevated) {
    Show-DeveloperToolFallback
    throw "Administrator elevation failed"
  }
  Write-Host "Requesting administrator access to deploy the UXP plugin and DS-RX1 bridge..."
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $PSCommandPath + '"'),
    "-PackageRoot", ('"' + $PackageRoot + '"'),
    "-Elevated"
  )
  try {
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    exit $process.ExitCode
  } catch {
    Show-DeveloperToolFallback
    throw "Administrator access was cancelled; the plugin was not installed"
  }
}

$runtimeFiles = @("manifest.json", "index.html", "styles.css", "src", "bridge\print-dsrx1.ps1")
foreach ($requiredFile in $runtimeFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot $requiredFile))) {
    throw "Incomplete package: missing $requiredFile"
  }
}

if ($DryRun) {
  Write-Host "[DryRun] Would validate and deploy the DS-RX1 bridge to: $bridgeTarget"
  Write-Host "[DryRun] Would register .idprint as IDPhotoMAX.PrintJob"
} else {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bridgeSource -ValidateOnly
  if ($LASTEXITCODE -ne 0) {
    throw "DS-RX1 bridge validation failed; no plugin files or file association were changed"
  }
  New-Item -ItemType Directory -Path $bridgeRoot -Force | Out-Null
  Copy-Item -LiteralPath $bridgeSource -Destination $bridgeTarget -Force

  $extensionKey = "Registry::HKEY_LOCAL_MACHINE\Software\Classes\.idprint"
  $programKey = "Registry::HKEY_LOCAL_MACHINE\Software\Classes\IDPhotoMAX.PrintJob"
  $commandKey = Join-Path $programKey "shell\open\command"
  $associationCommand = '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $bridgeTarget + '" "%1"'
  New-Item -Path $extensionKey -Force | Out-Null
  Set-Item -Path $extensionKey -Value "IDPhotoMAX.PrintJob"
  New-Item -Path $programKey -Force | Out-Null
  Set-Item -Path $programKey -Value "IDPhoto MAX DS-RX1 Print Job"
  New-Item -Path $commandKey -Force | Out-Null
  Set-Item -Path $commandKey -Value $associationCommand
  Write-Host "DS-RX1 bridge deployed to: $bridgeTarget"
  Write-Host ".idprint association registered as IDPhotoMAX.PrintJob"
}

$uxpPluginsRootFull = [System.IO.Path]::GetFullPath($uxpPluginsRoot).TrimEnd('\') + '\'
$uxpTargetFull = [System.IO.Path]::GetFullPath($uxpTarget)
if (-not $uxpTargetFull.StartsWith($uxpPluginsRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to deploy outside the Adobe UXP External folder: $uxpTargetFull"
}

if ($DryRun) {
  Write-Host "[DryRun] Would deploy v$($manifest.version) to UXP discovery folder: $uxpTargetFull"
} else {
  New-Item -ItemType Directory -Path $uxpPluginsRoot -Force | Out-Null
  if (Test-Path -LiteralPath $uxpTarget) {
    Remove-Item -LiteralPath $uxpTarget -Recurse -Force
  }
  New-Item -ItemType Directory -Path $uxpTarget -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $PackageRoot "manifest.json") -Destination $uxpTarget -Force
  Copy-Item -LiteralPath (Join-Path $PackageRoot "index.html") -Destination $uxpTarget -Force
  Copy-Item -LiteralPath (Join-Path $PackageRoot "styles.css") -Destination $uxpTarget -Force
  Copy-Item -LiteralPath (Join-Path $PackageRoot "src") -Destination $uxpTarget -Recurse -Force
  Write-Host "UXP plugin deployed to: $uxpTarget"
}


foreach ($photoshopHost in $hosts) {
  $legacyRoot = Join-Path $photoshopHost.FullName "Plug-ins"
  $legacyTarget = Join-Path $legacyRoot $manifest.id
  $legacyRootFull = [System.IO.Path]::GetFullPath($legacyRoot).TrimEnd('\') + '\'
  $legacyTargetFull = [System.IO.Path]::GetFullPath($legacyTarget)
  if (-not $legacyTargetFull.StartsWith($legacyRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean outside Photoshop Plug-ins: $legacyTargetFull"
  }
  if ($DryRun) {
    Write-Host "[DryRun] Would remove obsolete non-UXP install if present: $legacyTargetFull"
  } elseif (Test-Path -LiteralPath $legacyTarget) {
    Remove-Item -LiteralPath $legacyTarget -Recurse -Force
    Write-Host "Removed obsolete non-UXP install: $legacyTarget"
  }
}

if ($DryRun) {
  Write-Host "DryRun passed: package is complete and the system was not modified."
  exit 0
}

Write-Host "IDPhoto MAX v$($manifest.version) was deployed."
Write-Host "Quit Photoshop completely, reopen it, then open IDPhoto MAX from the Plugins menu."
Write-Host "The existing Adobe registration path was preserved. This updater does not register new plugins."
