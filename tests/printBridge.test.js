"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const bridgePath = path.join(__dirname, "..", "bridge", "print-dsrx1.ps1");

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
