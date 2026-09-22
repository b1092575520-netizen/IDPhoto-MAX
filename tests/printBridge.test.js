"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const bridgePath = path.join(__dirname, "..", "bridge", "print-dsrx1.ps1");

test("attribute-only bridge hides new and replaced indexes without changing bytes or accepting photos", { skip: process.platform !== "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "idphoto-hidden-index-"));
  const indexPath = path.join(directory, ".idphoto-jpg-index.json");
  const runner = path.join(directory, "verify.ps1");
  fs.writeFileSync(runner, `param([string]$IndexPath)
if (-not ((Get-Item -LiteralPath $IndexPath -Force).Attributes -band [System.IO.FileAttributes]::Hidden)) { throw 'not hidden' }
`);
  function run(operation, target, id) {
    const jobPath = path.join(directory, id + ".idprint");
    fs.writeFileSync(jobPath, JSON.stringify({ schemaVersion: 1, jobId: id, operation, indexPath: target }));
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", bridgePath, jobPath], { encoding: "utf8" });
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, id + ".result.json"), "utf8"));
    assert.equal(receipt.printed, false);
    return { result, receipt };
  }
  try {
    for (const revision of [1, 2, 3]) {
      const content = JSON.stringify({ version: 1, entries: {}, revision });
      const stagedPath = path.join(directory, `.idphoto-jpg-index.json.stage-${revision}.tmp`);
      fs.writeFileSync(stagedPath, content);
      const { result, receipt } = run("commit-archive-index", stagedPath, "commit-" + revision);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(receipt.hidden, true);
      assert.equal(fs.existsSync(stagedPath), false);
      assert.equal(fs.readFileSync(indexPath, "utf8"), content);
      const check = spawnSync("powershell.exe", ["-NoProfile", "-File", runner, indexPath], { encoding: "utf8" });
      assert.equal(check.status, 0, check.stdout + check.stderr);
    }
    assert.equal(run("hide-archive-index", indexPath, "hide-existing").receipt.hidden, true);
    const beforeInvalid = fs.readFileSync(indexPath, 'utf8');
    const badStage = path.join(directory, '.idphoto-jpg-index.json.stage-bad.tmp');
    fs.writeFileSync(badStage, JSON.stringify({ version: 2 }));
    assert.equal(run('commit-archive-index', badStage, 'reject-content').receipt.reason, 'invalid-index-content');
    assert.equal(fs.readFileSync(indexPath, 'utf8'), beforeInvalid);
    const photo = path.join(directory, "photo.jpg");
    fs.writeFileSync(photo, "untouched");
    assert.equal(run("hide-archive-index", photo, "reject-photo").receipt.reason, "invalid-index-path");
    assert.equal(run("unsupported", indexPath, "reject-operation").receipt.reason, "invalid-operation");
    assert.equal(fs.readFileSync(photo, "utf8"), "untouched");
  } finally {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
});

test("the Windows bridge validates the fixed printer, paper, copies, and image dimensions", () => {
  const script = fs.readFileSync(bridgePath, "utf8");

  assert.match(script, /\$ExpectedPrinterName\s*=\s*"DS-RX1"/);
  assert.match(script, /\$ExpectedPaperName\s*=\s*"\(6x4\)"/);
  assert.match(script, /expectedWidthPx[^\r\n]+3600/i);
  assert.match(script, /expectedHeightPx[^\r\n]+2400/i);
  assert.match(script, /copies[^\r\n]+1/i);
  assert.match(script, /-ceq\s+\$ExpectedPrinterName/);
  assert.match(script, /PaperName[^\r\n]+-ceq\s+\$ExpectedPaperName/);
});

test("the Windows bridge prints silently once and exposes a no-print validation mode", () => {
  const script = fs.readFileSync(bridgePath, "utf8");

  assert.match(script, /\[switch\]\$ValidateOnly/);
  assert.match(script, /\[switch\]\$RenderOnly/);
  assert.match(script, /StandardPrintController/);
  assert.equal((script.match(/\.Print\(\)/g) || []).length, 1);
  assert.doesNotMatch(script, /retry|重试/i);
  assert.match(script, /result\.json/);
});

test("the bridge uses an unambiguous integer DrawImage overload", () => {
  const script = fs.readFileSync(bridgePath, "utf8");

  assert.match(script, /System\.Drawing\.Rectangle\(/);
  assert.doesNotMatch(script, /System\.Drawing\.RectangleF/);
  assert.match(script, /function Draw-ImageActualSize/);
});

test("the bridge centers the image at its actual 600 PPI size instead of fitting it to the page", () => {
  const script = fs.readFileSync(bridgePath, "utf8");

  assert.match(script, /\$ExpectedPpi\s*=\s*600/);
  assert.match(script, /\$targetWidth\s*=.*\$SourceImage\.Width.*\$ExpectedPpi.*100/);
  assert.match(script, /\$targetHeight\s*=.*\$SourceImage\.Height.*\$ExpectedPpi.*100/);
  assert.match(script, /\$offsetX\s*=.*\$PageWidth\s*-\s*\$targetWidth/);
  assert.match(script, /\$offsetY\s*=.*\$PageHeight\s*-\s*\$targetHeight/);
  assert.match(script, /System\.Drawing\.Rectangle\(\$offsetX,\s*\$offsetY,\s*\$targetWidth,\s*\$targetHeight\)/);
  assert.doesNotMatch(script, /System\.Drawing\.Rectangle\(0,\s*0,\s*\$PageWidth,\s*\$PageHeight\)/);
});

test("combined request commits a hidden index even when the print is rejected, without submitting", { skip: process.platform !== "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "idphoto-combined-"));
  const stagedPath = path.join(directory, '.idphoto-jpg-index.json.stage-1.tmp');
  const jobPath = path.join(directory, 'combined-job.idprint');
  fs.writeFileSync(stagedPath, JSON.stringify({ version: 1, entries: { test: { identityMarker: 'test' } } }));
  fs.writeFileSync(jobPath, JSON.stringify({ schemaVersion: 1, jobId: 'combined-job', printerName: 'INVALID-NO-PRINT', archiveIndex: { operation: 'commit-archive-index', indexPath: stagedPath } }));
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bridgePath, jobPath], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'combined-job.result.json'), 'utf8'));
    assert.equal(receipt.reason, 'wrong-printer');
    assert.equal(receipt.printed, false);
    assert.equal(receipt.archiveIndexResult.hidden, true);
    assert.equal(receipt.archiveIndexResult.ok, true);
    assert.equal(fs.existsSync(stagedPath), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, '.idphoto-jpg-index.json'), 'utf8')).version, 1);
  } finally {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
});

test("bridge claims allow one submission and publish complete JSON using the real filesystem", { skip: process.platform !== "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "idphoto-bridge-invariants-"));
  const script = fs.readFileSync(bridgePath, "utf8");
  const prefix = script.slice(0, script.search(/^try \{\r?\n  Add-Type/m));
  const runner = path.join(directory, "probe.ps1");
  fs.writeFileSync(runner, prefix + `
$claimPath = Join-Path $JobPath 'job.submitted'
if (-not (Try-ClaimPrintJob $claimPath)) { throw 'first claim failed' }
if (Try-ClaimPrintJob $claimPath) { throw 'duplicate claim accepted' }
$jsonPath = Join-Path $JobPath 'probe.json'
Write-JsonUtf8NoBom $jsonPath @{ counter = 1 }
Write-JsonUtf8NoBom $jsonPath @{ counter = 2 }
if ((Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json).counter -ne 2) { throw 'invalid JSON replacement' }
if (@(Get-ChildItem -LiteralPath $JobPath -Filter '*.tmp').Count) { throw 'staging residue' }
Write-Output 'PROBE_PASS_NO_PRINT'
`);
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner, "-JobPath", directory], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PROBE_PASS_NO_PRINT/);
  } finally {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
});

test("invalid jobs receive a result before any printer lookup or submission", { skip: process.platform !== "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "idphoto-invalid-job-"));
  const jobPath = path.join(directory, "invalid.idprint");
  fs.writeFileSync(jobPath, JSON.stringify({ schemaVersion: 99, jobId: "test-invalid" }));
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", bridgePath, jobPath], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, "invalid.result.json"), "utf8"));
    assert.equal(receipt.jobId, "test-invalid");
    assert.equal(receipt.reason, "invalid-schema");
    assert.equal(receipt.printed, false);
  } finally {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
});
