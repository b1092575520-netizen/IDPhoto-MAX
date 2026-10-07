"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load() {
  const context = { window: {}, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(context);
  for (const file of ["src/core/templateRegistry.js", "src/core/classicStripLayout.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  return context.window;
}

const settings = { shopName: "福清印象照相馆", shopPhone: "13003825982（微信同号）", shopTip: "[请妥善保管此单据]" };

function planFor(window, id) {
  const templates = window.IDPhotoTemplates, template = templates.getTemplateById(id);
  const bar = templates.forDelivery(template, false).infoBar, slot = template.photoSlots[0];
  return window.IDPhotoClassicStripLayout.plan(bar, settings, { dateText: "2026.10.7" }, slot.width / slot.height);
}

test("the one-inch strip keeps the approved sizes: 13/12/11/10 pt beside a 430 px portrait", () => {
  const plan = planFor(load(), "one-inch");
  assert.deepEqual(JSON.parse(JSON.stringify(plan.items.map(item => [item.key, item.fontSize]))),
    [["shopName", 13], ["date", 12], ["phone", 11], ["tip", 10]]);
  assert.equal(plan.regions[0].height, 430);
  assert.equal(plan.items[2].text, "Tel:13003825982（微信同号）");
});

test("every template gets a readable strip and keeps all four pieces of shop information", () => {
  const window = load();
  const expectedLines = { "standard-two-inch": 2, "visa-two-inch": 2, brazil: 3, graduation: 3, "us-visa": 3 };
  for (const template of window.IDPhotoTemplates.getAllTemplates()) {
    const plan = planFor(window, template.id), text = plan.items.map(item => item.text).join(" ");
    assert.equal(plan.items.length, expectedLines[template.id] || 4, template.id);
    assert.ok(plan.items.every(item => item.fontSize >= 7), template.id + " smallest font");
    for (const piece of ["福清印象照相馆", "2026.10.7", "13003825982", "[请妥善保管此单据]"])
      assert.ok(text.includes(piece), template.id + " " + piece);
    assert.doesNotMatch(text, /取件码/);
    assert.equal(plan.vertical, template.infoBar.orientation === "vertical", template.id);
  }
});

test("every cut strip fits the bag: no edge longer than 8 cm, and it never leaves its free area", () => {
  const window = load();
  for (const template of window.IDPhotoTemplates.getAllTemplates()) {
    const bar = window.IDPhotoTemplates.forDelivery(template, false).infoBar;
    const plan = planFor(window, template.id), strip = plan.strip;
    assert.ok(strip.width <= 1889 && strip.height <= 1889, template.id + " " + JSON.stringify(strip));
    assert.ok(strip.x === bar.x && strip.y === bar.y && strip.width <= bar.width && strip.height <= bar.height, template.id);
  }
});

test("the US visa 5×5 strip stands upright on the left of the corner, 5 cm long, shrunk evenly", () => {
  const window = load();
  const plan = planFor(window, "us-visa");
  assert.equal(plan.vertical, true);
  assert.equal(plan.items.length, 3, "four lines would drop below the 7 pt floor; date and tip share a line");
  assert.deepEqual(JSON.parse(JSON.stringify(plan.strip)), { x: 2420, y: 1200, width: 360, height: 1181 });
  const fullSize = { shopName: 13, dateTip: 12, phone: 11 };
  const ratios = plan.items.map(item => item.fontSize / fullSize[item.key]);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.02, "every line keeps the one-inch proportions");
});

test("a missing phone number is shown as not filled in rather than invented", () => {
  const window = load(), template = window.IDPhotoTemplates.getTemplateById("one-inch");
  const plan = window.IDPhotoClassicStripLayout.plan(window.IDPhotoTemplates.forDelivery(template, false).infoBar, {}, { dateText: "2026.10.7" }, 0.71);
  assert.equal(plan.items.find(item => item.key === "phone").text, "Tel:电话未填写");
});
