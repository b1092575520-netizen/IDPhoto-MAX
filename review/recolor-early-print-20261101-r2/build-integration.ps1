param([string]$DesktopRoot='D:\software\yx Applets')
$ErrorActionPreference='Stop'
$fixtureBuild=Join-Path $PSScriptRoot 'integration-helper'
if(Test-Path -LiteralPath $fixtureBuild){throw 'Use a new helper directory; preserve previous evidence'}
New-Item -ItemType Directory -Path $fixtureBuild | Out-Null
$refs='C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8'
$probeSources=@(Get-ChildItem -LiteralPath (Join-Path $DesktopRoot 'desktop\PhotoImporter') -Filter '*.cs' | ForEach-Object FullName)
$probeSources+=@('Stage4R2Probe.cs','Stage6DraftProbe.cs','PluginAutomationProbe.cs') | ForEach-Object {Join-Path $DesktopRoot ('tests\desktop\'+$_)}
$probeExe=Join-Path $fixtureBuild 'PluginAutomationProbe.exe'
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /codepage:65001 /noconfig /nostdlib+ /target:exe /main:PluginAutomationProbe "/out:$probeExe" "/reference:$refs\mscorlib.dll" "/reference:$refs\System.dll" "/reference:$refs\System.Core.dll" "/reference:$refs\System.Drawing.dll" "/reference:$refs\System.Windows.Forms.dll" "/reference:$refs\System.Net.Http.dll" "/reference:$refs\System.Web.Extensions.dll" "/reference:$refs\System.Security.dll" $probeSources
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
Copy-Item -LiteralPath (Join-Path $DesktopRoot 'desktop\PhotoImporter\App.config') -Destination ($probeExe+'.config')
$probeSources | ForEach-Object {Get-FileHash -Algorithm SHA256 -LiteralPath $_} | Select-Object Path,Hash | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $fixtureBuild 'source-hashes.json')
Add-Type -AssemblyName System.Drawing
$images=Join-Path $fixtureBuild 'images'
New-Item -ItemType Directory -Path $images | Out-Null
foreach($size in @(@(80,100),@(3600,2400),@(200,60))){
  $bitmap=New-Object System.Drawing.Bitmap($size[0],$size[1])
  try {
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    try {$graphics.Clear([System.Drawing.Color]::White)} finally {$graphics.Dispose()}
    $bitmap.Save((Join-Path $images ($size[0].ToString()+'x'+$size[1].ToString()+'.jpg')),[System.Drawing.Imaging.ImageFormat]::Jpeg)
  } finally {$bitmap.Dispose()}
}
Write-Output $probeExe
