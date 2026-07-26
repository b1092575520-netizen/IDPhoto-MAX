"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ratioCheckerPath = path.join(__dirname, "..", "src", "core", "ratioChecker.js");

function loadRatioChecker() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(ratioCheckerPath, "utf8"), context, { filename: ratioCheckerPath });
  return context.window.IDPhotoRatioChecker;
}

test("a portrait wedding source is measured after a 90-degree orientation correction", () => {
  const checker = loadRatioChecker();
  const result = checker.checkDocumentRatio(
    { widthPx: 700, heightPx: 1060 },
    { id: "wedding", widthCm: 5.3, heightCm: 3.5 }
  );

  assert.equal(result.rotationDegrees, 90);
  assert.equal(result.effectiveWidthPx, 1060);
  assert.equal(result.effectiveHeightPx, 700);
  assert.equal(result.ok, true);
});

test("portrait sources are not auto-rotated for ordinary portrait templates", () => {
  const checker = loadRatioChecker();
  const result = checker.checkDocumentRatio(
    { widthPx: 700, heightPx: 980 },
    { id: "standard-two-inch", widthCm: 3.5, heightCm: 4.9 }
  );

  assert.equal(result.rotationDegrees, 0);
  assert.equal(result.effectiveWidthPx, 700);
  assert.equal(result.effectiveHeightPx, 980);
});
