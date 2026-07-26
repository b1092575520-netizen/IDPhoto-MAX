"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");

const registryPath = path.join(__dirname, "..", "src", "core", "templateRegistry.js");
const rendererPath = path.join(__dirname, "..", "src", "photoshop", "infoBarRenderer.js");

function loadTemplates() {
  const context = { console: { log() {} }, window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(registryPath, "utf8"), context, { filename: registryPath });
  return context.window.IDPhotoTemplates;
}

function makeRendererHarness(options) {
  let nextLayerId = 1;
  let createdTextLayer = null;
  let activateCount = 0;
  let knownLayerSnapshotCount = 0;
  const textKnownLayerIds = [];
  const textCommands = [];
  const duplicateCalls = [];
  const moveCounts = new Map();
  const targetDocument = {
    layers: [],
    async activate() {
      activateCount += 1;
    }
  };
  const sourceLayer = {
    id: 900,
    bounds: { left: 0, top: 0, right: 950, bottom: 950 }
  };
  const sourceDocument = {
    layers: [sourceLayer],
    activeLayers: [sourceLayer]
  };

  const layerService = {
    async duplicateLayerToDocument(sourceDocument, sourceLayer, destinationDocument) {
      duplicateCalls.push({ sourceDocument, sourceLayer, destinationDocument });
      const layer = {
        id: nextLayerId++,
        bounds: { left: 0, top: 0, right: 950, bottom: 950 },
        async resize(percent) {
          this.bounds.right = this.bounds.left + (950 * percent) / 100;
          this.bounds.bottom = this.bounds.top + (950 * percent) / 100;
        }
      };
      if (sourceDocument === destinationDocument) {
        const sourceIndex = destinationDocument.layers.indexOf(sourceLayer);
        destinationDocument.layers.splice(sourceIndex < 0 ? 0 : sourceIndex, 0, layer);
      } else {
        destinationDocument.layers.unshift(layer);
      }
      destinationDocument.activeLayers = [layer];
      return layer;
    },
    findLayerByName(layers, name) {
      return (layers || []).find((layer) => layer.name === name) || null;
    },
    getLayerBounds(layer) {
      return layer.bounds;
    },
    getDocumentLayerIds() {
      knownLayerSnapshotCount += 1;
      return {};
    },
    async moveLayerTo(layer, x, y) {
      const count = (moveCounts.get(layer.id) || 0) + 1;
      moveCounts.set(layer.id, count);
      if (options && options.maxTextMoves && layer.kind === "text" && count > options.maxTextMoves) {
        throw new Error("Photoshop rejected an extra text-layer move");
      }
      const width = layer.bounds.right - layer.bounds.left;
      const height = layer.bounds.bottom - layer.bounds.top;
      layer.bounds = { left: x, top: y, right: x + width, bottom: y + height };
      return layer.bounds;
    },
    async runNewLayerOperation(_document, operation, _label, knownLayerIds) {
      textKnownLayerIds.push(knownLayerIds);
      createdTextLayer = null;
      await operation();
      return createdTextLayer;
    }
  };

  const photoshop = {
    app: { activeDocument: targetDocument },
    core: {
      async executeAsModal(callback) {
        await callback();
      }
    },
    action: {
      async batchPlay(commands) {
        const command = commands[0];
        if (command && command._obj === "move" && command._target[0]._id) {
          const layerIndex = targetDocument.layers.findIndex((layer) => layer.id === command._target[0]._id);
          const [layer] = targetDocument.layers.splice(layerIndex, 1);
          targetDocument.layers.unshift(layer);
          targetDocument.activeLayers = [layer];
          return [];
        }
        if (command && command._obj === "make" && command._target[0]._ref === "textLayer") {
          textCommands.push(command);
          const point = command.using.textClickPoint;
          const x = point.horizontal._value;
          const y = point.vertical._value;
          createdTextLayer = {
            id: nextLayerId++,
            kind: "text",
            bounds: { left: x, top: y, right: x + 240, bottom: y + 60 },
            async resize(widthPercent, heightPercent) {
              this.bounds.right = this.bounds.left + ((this.bounds.right - this.bounds.left) * widthPercent) / 100;
              this.bounds.bottom = this.bounds.top + ((this.bounds.bottom - this.bounds.top) * heightPercent) / 100;
            }
          };
          const activeIndex = targetDocument.layers.indexOf(targetDocument.activeLayers[0]);
          targetDocument.layers.splice(activeIndex < 0 ? 0 : activeIndex, 0, createdTextLayer);
          targetDocument.activeLayers = [createdTextLayer];
        }
        return [];
      }
    }
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.equal(name, "photoshop");
      return photoshop;
    },
    window: { IDPhotoLayerService: layerService }
  };
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: rendererPath });

  return {
    renderer: context.window.IDPhotoInfoBarRenderer,
    sourceDocument,
    targetDocument,
    get activateCount() {
      return activateCount;
    },
    get knownLayerSnapshotCount() {
      return knownLayerSnapshotCount;
    },
    get textKnownLayerIds() {
      return textKnownLayerIds;
    },
    get textCommands() {
      return textCommands;
    },
    get duplicateCalls() {
      return duplicateCalls;
    }
  };
}

test("information bar text creation reuses one target layer id snapshot", async () => {
  const templates = loadTemplates();
  const template = templates.getTemplateByName("香港台湾 3.0x4.0");
  const harness = makeRendererHarness();

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "测试照相馆", shopPhone: "13000000000", shopTip: "请妥善保存" },
    { dateText: "2026.07.13", template, sourceDocument: harness.sourceDocument }
  );

  assert.equal(harness.knownLayerSnapshotCount, 1);
  assert.ok(harness.textKnownLayerIds.length > 1);
  assert.ok(harness.textKnownLayerIds.every((knownIds) => knownIds === harness.textKnownLayerIds[0]));
});

test("information bar avatar reuses a named photo layer from the target canvas", async () => {
  const templates = loadTemplates();
  const template = templates.getTemplateByName("1寸 2.7x3.8");
  const harness = makeRendererHarness();
  const placedPhoto = {
    id: 700,
    name: template.name + "_照片_1",
    bounds: { left: 0, top: 0, right: template.widthPx, bottom: template.heightPx }
  };
  const activeBackground = {
    id: 701,
    name: "信息条背景",
    bounds: { left: 0, top: 1950, right: 3592, bottom: 2400 }
  };
  harness.targetDocument.layers.unshift(activeBackground, placedPhoto);
  harness.targetDocument.activeLayers = [activeBackground];

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "测试照相馆", shopPhone: "13000000000", shopTip: "请妥善保存" },
    {
      dateText: "2026.07.13",
      template,
      sourceDocument: harness.targetDocument,
      sourceLayerName: placedPhoto.name
    }
  );

  assert.equal(harness.duplicateCalls[0].sourceDocument, harness.targetDocument);
  assert.equal(harness.duplicateCalls[0].sourceLayer, placedPhoto);
  assert.equal(harness.duplicateCalls[0].destinationDocument, harness.targetDocument);
  const backgroundIndex = harness.targetDocument.layers.indexOf(activeBackground);
  const avatarIndex = harness.targetDocument.layers.findIndex((layer) => layer.name === "信息条小头像");
  const textLayers = harness.targetDocument.layers.filter((layer) => layer.kind === "text");
  assert.ok(avatarIndex < backgroundIndex);
  assert.ok(textLayers.every((layer) => harness.targetDocument.layers.indexOf(layer) < backgroundIndex));
});

for (const templateName of ["香港台湾 3.0x4.0", "阿根廷 4.0x4.0"]) {
  test(`${templateName} keeps its configured horizontal text positions`, async () => {
    const templates = loadTemplates();
    const template = templates.getTemplateByName(templateName);
    const harness = makeRendererHarness({ maxTextMoves: 2 });

    await harness.renderer.renderInfoBar(
      harness.targetDocument,
      template.infoBar,
      { shopName: "测试照相馆", shopPhone: "13000000000", shopTip: "请妥善保存" },
      { dateText: "2026.07.13", template, sourceDocument: harness.sourceDocument }
    );

    assert.equal(harness.activateCount, 0);
  });
}

const referenceTextLayouts = {
  "standard-two-inch": [
    { name: "shopNameDate", x: 3490, y: 280, size: 83.3, orientation: "vertical" },
    { name: "phone", x: 3428, y: 281, size: 96, orientation: "vertical" }
  ],
  "visa-two-inch": [
    { name: "shopNameDate", x: 201, y: 2191, size: 11.2, orientation: "horizontal" },
    { name: "phone", x: 197, y: 2288, size: 8.4, orientation: "horizontal" }
  ],
  "small-two-inch": [
    { name: "shopNameDate", x: 3400, y: 382, size: 108.3, orientation: "vertical" },
    { name: "phone", x: 3306, y: 386, size: 70, orientation: "vertical" }
  ],
  "hongkong-taiwan": [
    { name: "shopName", x: 289, y: 2037, size: 100, orientation: "horizontal" },
    { name: "date", x: 289, y: 2151, size: 91.7, orientation: "horizontal" },
    { name: "phone", x: 289, y: 2244, size: 70, orientation: "horizontal" }
  ],
  brazil: [
    { name: "shopNameDate", x: 3048, y: 339, size: 83.3, orientation: "vertical" },
    { name: "phone", x: 2965, y: 340, size: 53.3, orientation: "vertical" }
  ],
  argentina: [
    { name: "shopName", x: 469, y: 1986, size: 100, orientation: "horizontal" },
    { name: "date", x: 468, y: 2090, size: 91.7, orientation: "horizontal" },
    { name: "phone", x: 469, y: 2188, size: 83.3, orientation: "horizontal" },
    { name: "tip", x: 469, y: 2279, size: 75, orientation: "horizontal" }
  ],
  graduation: [
    { name: "shopNameDate", x: 3076, y: 346, size: 83.3, orientation: "vertical" },
    { name: "phone", x: 3003, y: 347, size: 53.3, orientation: "vertical" }
  ],
  wedding: [
    { name: "shopName", x: 411, y: 1764, size: 6.6, orientation: "horizontal" },
    { name: "date", x: 411, y: 1843, size: 5.4, orientation: "horizontal" },
    { name: "phone", x: 411, y: 1915, size: 6.5, orientation: "horizontal" }
  ]
};

const referenceInfoBarBounds = {
  "standard-two-inch": { x: 3400, y: 0, width: 200, height: 2400 },
  "visa-two-inch": { x: 0, y: 2174, width: 3600, height: 226 },
  "small-two-inch": { x: 3239, y: 0, width: 361, height: 2400 },
  "hongkong-taiwan": { x: 0, y: 1950, width: 3592, height: 450 },
  brazil: { x: 2916, y: 0, width: 284, height: 2400 },
  argentina: { x: 0, y: 1945, width: 3600, height: 455 },
  graduation: { x: 2943, y: 0, width: 273, height: 2400 },
  wedding: { x: 0, y: 1739, width: 3592, height: 273 }
};

for (const [templateId, expectedLayout] of Object.entries(referenceTextLayouts)) {
  test(`${templateId} matches the approved information-bar text layout`, async () => {
    const templates = loadTemplates();
    const template = templates.getTemplateById(templateId);
    const harness = makeRendererHarness();

    assert.deepEqual(
      JSON.parse(JSON.stringify({
        x: template.infoBar.x,
        y: template.infoBar.y,
        width: template.infoBar.width,
        height: template.infoBar.height
      })),
      referenceInfoBarBounds[templateId]
    );

    await harness.renderer.renderInfoBar(
      harness.targetDocument,
      template.infoBar,
      { shopName: "\u798f\u6e05\u5370\u8c61\u7167\u76f8\u9986", shopPhone: "13003825982\uff08\u5fae\u4fe1\u540c\u53f7\uff09", shopTip: "[\u8bf7\u59a5\u5584\u4fdd\u7ba1\u6b64\u5355\u636e]" },
      { dateText: "2026. 1.", template, sourceDocument: harness.sourceDocument }
    );

    const actualLayout = harness.textCommands.map((command) => ({
      name: command.using.name,
      x: command.using.textClickPoint.horizontal._value,
      y: command.using.textClickPoint.vertical._value,
      size: command.using.textStyleRange[0].textStyle.size._value,
      orientation: command.using.orientation._value
    }));
    assert.deepEqual(actualLayout, expectedLayout);

    const combinedCommand = harness.textCommands.find((command) => command.using.name === "shopNameDate");
    if (combinedCommand) {
      assert.equal(
        combinedCommand.using.textKey,
        "\u798f\u6e05\u5370\u8c61\u7167\u76f8\u9986" + (templateId === "visa-two-inch" ? "  " : "") + "2026. 1."
      );
    }
  });
}

test("the two user-approved information-bar templates keep their existing sizes", () => {
  const templates = loadTemplates();
  const oneInch = templates.getTemplateById("one-inch");
  const usVisa51 = templates.getTemplateById("us-visa-51");

  assert.deepEqual(
    Array.from(oneInch.infoBar.texts, (item) => item.fontSize),
    [13, 12, 11, 10]
  );
  assert.deepEqual(Array.from(usVisa51.infoBar.texts.keys), ["shopName", "date", "phone"]);
  assert.deepEqual(JSON.parse(JSON.stringify(usVisa51.infoBar.texts.fontSizes)), { shopName: 11, date: 10, phone: 9 });
});

test("debug mode gives the combined shop-name/date layer a savable DEBUG name", async () => {
  const templates = loadTemplates();
  const template = templates.getTemplateById("standard-two-inch");
  const harness = makeRendererHarness();

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "\u798f\u6e05\u5370\u8c61\u7167\u76f8\u9986", shopPhone: "13003825982" },
    { dateText: "2026. 1.", template, sourceDocument: harness.sourceDocument, debugMode: true }
  );

  assert.deepEqual(
    harness.textCommands.map((command) => command.using.name),
    ["DEBUG_text_shopNameDate", "DEBUG_text_phone"]
  );
});

test("a saved free-transform target is reapplied to the next text layer", async () => {
  const templates = loadTemplates();
  const template = templates.getTemplateById("standard-two-inch");
  const harness = makeRendererHarness();
  template.infoBar.textLayers = {
    phone: { x: 3300, y: 280, width: 480, height: 120, fontSize: 6.4 }
  };

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "\u798f\u6e05\u5370\u8c61\u7167\u76f8\u9986", shopPhone: "13003825982" },
    { dateText: "2026. 1.", template, sourceDocument: harness.sourceDocument }
  );

  const phoneLayer = harness.targetDocument.layers.find((layer) => layer.name === "phone");
  assert.deepEqual(phoneLayer.bounds, { left: 3300, top: 280, right: 3780, bottom: 400 });
});
