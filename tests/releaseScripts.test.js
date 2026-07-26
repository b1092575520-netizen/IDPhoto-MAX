"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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
  assert.match(script, /unsigned local development install/);
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
