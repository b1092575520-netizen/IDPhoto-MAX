"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadTemplateModules() {
  const context = {
    console: {
      log() {},
      warn() {},
      error() {}
    },
    window: {}
  };
  vm.createContext(context);
  for (const relativePath of ["src/core/templateRegistry.js", "src/core/layoutEngine.js"]) {
    const filePath = path.join(__dirname, "..", relativePath);
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
      filename: filePath
    });
  }
  return context.window;
}

test("all reference templates have unique in-bounds slots", () => {
  const modules = loadTemplateModules();
  const templates = modules.IDPhotoTemplates.getAllTemplates();

  assert.equal(templates.length, 11);

  for (const template of templates) {
    const plan = modules.IDPhotoLayoutEngine.createLayoutPlan({
      template,
      rowGap: 10,
      colGap: 10
    });
    const slotKeys = plan.positions.map((position) =>
      [position.x, position.y, position.width, position.height, position.rotate].join(":")
    );

    assert.equal(plan.positions.length, template.photoSlots.length, template.id);
    assert.equal(new Set(slotKeys).size, plan.positions.length, template.id);
    for (const position of plan.positions) {
      assert.ok(position.x >= 0 && position.y >= 0, template.id);
      assert.ok(position.x + position.width <= plan.canvas.widthPx, template.id);
      assert.ok(position.y + position.height <= plan.canvas.heightPx, template.id);
    }
  }
});

test("approved debug adjustments are built into the default info-bar templates", () => {
  const modules = loadTemplateModules();
  const expected = {
    "standard-two-inch": { info: [3400, 0, 200, 2400], avatar: [3429, 50, 143, 201], textKeys: ["shopNameDate", "phone"] },
    "visa-two-inch": { info: [0, 2174, 3600, 226], avatar: [25, 2189, 141, 181], textKeys: ["shopNameDate", "phone"] },
    brazil: { info: [2916, 0, 284, 2400], avatar: [2950, 56, 210, 263], textKeys: ["shopNameDate", "phone"] },
    "us-visa-51": { info: [0, 1268, 3590, 369], avatar: [34, 1312, 280, 280], textKeys: ["shopName", "date", "phone"] },
    graduation: { info: [2943, 0, 273, 2400], avatar: [2978, 53, 205, 281], textKeys: ["shopNameDate", "phone"] },
    wedding: { info: [0, 1739, 3592, 273], avatar: [24, 1759, 342, 225], textKeys: ["shopName", "date", "phone"] },
    "small-two-inch": { info: [3239, 0, 361, 2400], avatar: [3293, 48, 214, 312], textKeys: ["shopNameDate", "phone"] },
    "hongkong-taiwan": { info: [0, 1950, 3592, 450], avatar: [24, 2017, 235, 313], textKeys: ["shopName", "date", "phone"] },
    argentina: { info: [0, 1945, 3600, 455], avatar: [70, 2016, 342, 342], textKeys: ["shopName", "date", "phone", "tip"] }
  };

  Object.keys(expected).forEach((templateId) => {
    const template = modules.IDPhotoTemplates.getTemplateById(templateId);
    const value = expected[templateId];
    assert.deepEqual(
      [template.infoBar.x, template.infoBar.y, template.infoBar.width, template.infoBar.height],
      value.info,
      templateId
    );
    assert.deepEqual(
      [template.infoBar.avatar.x, template.infoBar.avatar.y, template.infoBar.avatar.width, template.infoBar.avatar.height],
      value.avatar,
      templateId
    );
    assert.deepEqual(Object.keys(template.infoBar.textLayers || {}).filter((key) => value.textKeys.includes(key)), value.textKeys, templateId);
  });
});
