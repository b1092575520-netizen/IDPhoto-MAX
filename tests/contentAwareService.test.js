"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");

const servicePath = path.join(__dirname, "..", "src", "photoshop", "contentAwareService.js");

function loadService(batchPlay) {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.equal(name, "photoshop");
      return { action: { batchPlay } };
    },
    window: {}
  };
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(servicePath, "utf8"), context, { filename: servicePath });
  return context.window.IDPhotoContentAwareService;
}

test("square side expansion overlaps the original image to hide vertical seams", async () => {
  const commands = [];
  const service = loadService(async (batch) => {
    commands.push(batch[0]);
    return [];
  });

  const result = await service.expandToRatio({}, {
    docInfo: { widthPx: 2000, heightPx: 3000 },
    targetRatio: 1,
    bounds: { left: 0, top: 0, right: 2000, bottom: 2000 }
  });
  const rectangles = commands
    .filter((command) => command._obj === "set" && command.to && command.to._obj === "rectangle")
    .map((command) => ({
      left: command.to.left._value,
      top: command.to.top._value,
      right: command.to.right._value,
      bottom: command.to.bottom._value
    }));

  assert.equal(result.blendOverlapPx, 30);
  assert.deepEqual(rectangles, [
    { left: 0, top: 0, right: 530, bottom: 3000 },
    { left: 2470, top: 0, right: 3000, bottom: 3000 }
  ]);
});

test("the reported 1280x1918 portrait gets a scaled overlap on both square side fills", async () => {
  const commands = [];
  const service = loadService(async (batch) => {
    commands.push(batch[0]);
    return [];
  });

  const result = await service.expandToRatio({}, {
    docInfo: { widthPx: 1280, heightPx: 1918 },
    targetRatio: 1,
    bounds: { left: 0, top: 0, right: 1280, bottom: 1280 }
  });
  const rectangles = commands
    .filter((command) => command._obj === "set" && command.to && command.to._obj === "rectangle")
    .map((command) => ({
      left: command.to.left._value,
      top: command.to.top._value,
      right: command.to.right._value,
      bottom: command.to.bottom._value
    }));

  assert.equal(result.blendOverlapPx, 19);
  assert.deepEqual(rectangles, [
    { left: 0, top: 0, right: 338, bottom: 1918 },
    { left: 1580, top: 0, right: 1918, bottom: 1918 }
  ]);
});

test("square top and bottom expansion uses the same overlap policy", async () => {
  const commands = [];
  const service = loadService(async (batch) => {
    commands.push(batch[0]);
    return [];
  });

  const result = await service.expandToRatio({}, {
    docInfo: { widthPx: 3000, heightPx: 2000 },
    targetRatio: 1,
    bounds: { left: 500, top: 0, right: 2500, bottom: 2000 }
  });
  const rectangles = commands
    .filter((command) => command._obj === "set" && command.to && command.to._obj === "rectangle")
    .map((command) => ({
      left: command.to.left._value,
      top: command.to.top._value,
      right: command.to.right._value,
      bottom: command.to.bottom._value
    }));

  assert.equal(result.blendOverlapPx, 30);
  assert.deepEqual(rectangles, [
    { left: 0, top: 0, right: 3000, bottom: 530 },
    { left: 0, top: 2470, right: 3000, bottom: 3000 }
  ]);
});
