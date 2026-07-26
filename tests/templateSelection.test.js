"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const servicePath = path.join(__dirname, "..", "src", "core", "templateSelectionService.js");

function loadService() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(servicePath, "utf8"), context, { filename: servicePath });
  return context.window.IDPhotoTemplateSelectionService;
}

test("plain clicks toggle multiple templates in click order", () => {
  const service = loadService();
  let selected = [];

  selected = service.toggle(selected, "one-inch");
  selected = service.toggle(selected, "standard-two-inch");

  assert.deepEqual(Array.from(selected), ["one-inch", "standard-two-inch"]);
  assert.deepEqual(Array.from(service.toggle(selected, "one-inch")), ["standard-two-inch"]);
});

test("double click keeps the existing selection and includes its button", () => {
  const service = loadService();

  assert.deepEqual(
    Array.from(service.forDoubleClick(["one-inch", "standard-two-inch"], "standard-two-inch")),
    ["one-inch", "standard-two-inch"]
  );
  assert.deepEqual(
    Array.from(service.forDoubleClick(["one-inch"], "standard-two-inch")),
    ["one-inch", "standard-two-inch"]
  );
});

test("double activation deduplicates click detail 2 and dblclick events", () => {
  const service = loadService();

  assert.equal(service.isRepeatedDoubleActivation(null, 1000), false);
  assert.equal(service.isRepeatedDoubleActivation(1000, 1200), true);
  assert.equal(service.isRepeatedDoubleActivation(1000, 1800), false);
});

test("completed layout clears all selected templates", () => {
  const service = loadService();

  assert.deepEqual(Array.from(service.clear(["one-inch", "standard-two-inch"])), []);
});

test("the plugin starts without a preselected template", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");

  assert.doesNotMatch(html, /class="[^"]*\bsize-btn\b[^"]*\bactive\b/);
  assert.match(main, /selectedTemplate:\s*null/);
  assert.match(main, /selectedTemplates:\s*\[\]/);
  assert.match(main, /selectedTemplateIds:\s*\[\]/);
  assert.match(main, /lastTemplateRangeAnchor:\s*null/);
  assert.match(main, /lastClickedTemplateId:\s*null/);
});

test("the selection service loads before main without a delayed click timer", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");

  assert.ok(html.indexOf("src/core/templateSelectionService.js") < html.indexOf("src/main.js"));
  assert.doesNotMatch(main, /templateClickTimer/);
  assert.match(main, /isRepeatedDoubleActivation\(button\.__idPhotoClickAt, now\)/);
  assert.match(main, /if \(modifiers\.detail > 1 \|\| isRepeatedClick\) \{\s*handleTemplateDoubleClick\(button, event\);/);
  assert.match(main, /applySelectedTemplateIds\(window\.IDPhotoTemplateSelectionService\.clear\(\), null, null, true\)/);
});
