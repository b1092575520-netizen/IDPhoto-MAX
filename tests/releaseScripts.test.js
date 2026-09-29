"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("release verification covers tests, syntax, versions, and Photoshop execution locality", () => {
  const script = read("scripts/verify-release.ps1");

  assert.match(script, /npm\.cmd/);
  assert.match(script, /node\.exe/);
  assert.match(script, /manifest\.version/);
  assert.match(script, /photoshopExecution\.js/);
  assert.match(script, /IDPhotoSubjectDetectionService/);
  assert.match(script, /print-dsrx1\.ps1/);
  assert.match(script, /ASCII-only/);
});

test("the release package contains runtime files and the one-click Windows installer", () => {
  const script = read("scripts/package-plugin.ps1");

  assert.match(script, /verify-release\.ps1/);
  assert.match(script, /Compress-Archive/);
  assert.match(script, /install-plugin\.ps1/);
  assert.match(script, /install-plugin\.cmd/);
  assert.match(script, /bridge/);
  assert.doesNotMatch(script, /Copy-Item[^\n]+tests/);
  assert.doesNotMatch(script, /Copy-Item[^\n]+_reference/);
});

test("the installer deploys into Photoshop's logged UXP External discovery folder and supports a no-write dry run", () => {
  const script = read("scripts/install-plugin.ps1");

  assert.match(script, /minVersion/);
  assert.doesNotMatch(script, /host\[0\]/);
  assert.match(script, /CommonProgramFiles/);
  assert.match(script, /Adobe\\UXP\\Plugins\\External/);
  assert.match(script, /legacyTarget/);
  assert.match(script, /\[switch\]\$DryRun/);
  assert.match(script, /Adobe UXP Developer Tool/);
  assert.match(script, /existing Adobe registration path was preserved/);
  assert.doesNotMatch(script, /Resolve-DuplicatePluginInstallations/);
  assert.match(script, /IDPhotoMAX\.PrintJob/);
  assert.match(script, /\.idprint/);
  assert.match(script, /print-dsrx1\.ps1/);
  assert.match(script, /-ValidateOnly/);
});

test("the Windows EXE builder embeds the verified package and emits a SHA256 file", () => {
  const builder = read("scripts/build-installer-exe.ps1");
  const launcher = read("scripts/installer/IDPhotoMaxInstaller.cs");

  assert.match(builder, /package-plugin\.ps1/);
  assert.match(builder, /target:winexe/);
  assert.match(builder, /IDPhotoMax\.Payload\.zip/);
  assert.match(builder, /Get-FileHash -Algorithm SHA256/);
  assert.match(launcher, /GetManifestResourceStream/);
  assert.match(launcher, /install-plugin\.ps1/);
  assert.match(launcher, /--dry-run/);
  assert.match(launcher, /-DryRun/);
  assert.match(launcher, /Directory\.Delete\(tempRoot, true\)/);
});

test("installer preserves the registered versioned path and rejects missing or unsafe registration", () => {
  const tempBase = path.resolve(root, ".tmp");
  fs.mkdirSync(tempBase, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(tempBase, "installer-duplicates-"));
  const scriptFile = path.join(fixture, "check.ps1");
  fs.writeFileSync(scriptFile, `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $env:IDPHOTO_REPO 'scripts/install-plugin.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw $errors }
$fn = $ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-RegisteredPluginTarget'}, $true)
if (-not $fn) { throw 'Registered path resolver missing' }
Invoke-Expression $fn.Extent.Text
$systemRoot = Join-Path $env:IDPHOTO_FIXTURE 'Plugins'
$discovery = Join-Path $systemRoot 'External'
$canonical = Join-Path $discovery 'target.plugin'
$expected = Join-Path $discovery 'target.plugin_0.5.2'
$reg = Join-Path $env:IDPHOTO_FIXTURE 'PS.json'
New-Item -ItemType Directory -Path $canonical -Force | Out-Null
Set-Content (Join-Path $canonical 'sentinel.txt') 'unregistered copy'
$path = '$systemPlugins' + [IO.Path]::DirectorySeparatorChar + 'External' + [IO.Path]::DirectorySeparatorChar + 'target.plugin_0.5.2'
$valid = @{pluginId='target.plugin';path=$path;status='enabled';versionString='0.5.2'}
@{plugins=@($valid, @{pluginId='other.plugin';path='unrelated'})} | ConvertTo-Json | Set-Content $reg
$before = Get-Content $reg -Raw
$actual = Get-RegisteredPluginTarget $reg $systemRoot 'target.plugin'
if ($actual -ne $expected) { throw 'Did not select the Adobe-registered directory' }
if (Test-Path $expected) { throw 'Read-only resolution created a folder' }
if ((Get-Content $reg -Raw) -ne $before) { throw 'Registration was modified' }
if (-not (Test-Path (Join-Path $canonical 'sentinel.txt'))) { throw 'Unregistered folder changed' }
foreach ($bad in @(@{plugins=@()}, @{plugins=@($valid,$valid)}, @{plugins=@(@{pluginId='target.plugin';path=($path + '/../../outside')})}, @{plugins=@(@{pluginId='target.plugin';path='C:/outside'})})) {
  $bad | ConvertTo-Json -Depth 5 | Set-Content $reg
  $rejected = $false
  try { Get-RegisteredPluginTarget $reg $systemRoot 'target.plugin' | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Unsafe or ambiguous registration was accepted' }
}
$rejected = $false
try { Get-RegisteredPluginTarget ($reg + '.absent') $systemRoot 'target.plugin' | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Missing registration was accepted' }

`);
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile], {
      encoding: "utf8", env: { ...process.env, IDPHOTO_REPO: root, IDPHOTO_FIXTURE: fixture }
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    if (!path.resolve(fixture).startsWith(tempBase + path.sep)) throw Error("Unsafe test cleanup path");
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("installer preserves correct read-only associations and repairs missing or stale defaults", () => {
  const script = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $env:IDPHOTO_REPO 'scripts/install-plugin.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw $errors }
$fn = $ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Set-RegistryDefaultIfNeeded'}, $true)
if (-not $fn) { throw 'Registry update helper missing' }
Invoke-Expression $fn.Extent.Text
# A correctly configured association may be readable but deny all writes.
& {
  function Test-Path { param($LiteralPath) return $true }
  function Get-Item {
    param($LiteralPath)
    $item = New-Object PSObject
    $item | Add-Member ScriptMethod GetValue { param($name) return 'expected' }
    $item | Add-Member ScriptMethod Close {}
    return $item
  }
  function New-Item { throw 'Unexpected key creation' }
  function Set-Item { throw 'Unexpected registry write' }
  Set-RegistryDefaultIfNeeded 'read-only-correct-key' 'expected'
}
# Real registry provider verifies missing parents, stale values, and retry.
$base = 'Registry::HKEY_CURRENT_USER\\Software\\IDPhotoMAX-InstallerTest-' + [Guid]::NewGuid().ToString('N')
try {
  $leaf = $base + '\\shell\\open\\command'
  Set-RegistryDefaultIfNeeded $leaf 'first'
  if ((Get-Item $leaf).GetValue('') -cne 'first') { throw 'Missing default not created' }
  Set-RegistryDefaultIfNeeded $leaf 'second'
  Set-RegistryDefaultIfNeeded $leaf 'second'
  if ((Get-Item $leaf).GetValue('') -cne 'second') { throw 'Stale default not repaired' }
} finally {
  if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force }
}
& {
  function Test-Path { param($LiteralPath) return $false }
  function New-Item { throw 'simulated-access-denied' }
  $rejected = $false
  try { Set-RegistryDefaultIfNeeded 'denied-new-key' 'expected' }
  catch { $rejected = $_.Exception.Message -eq 'simulated-access-denied' }
  if (-not $rejected) { throw 'Write failure was swallowed' }
}
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8", env: { ...process.env, IDPHOTO_REPO: root }
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
