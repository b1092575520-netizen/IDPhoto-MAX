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
          if (layerIndex === 0) throw new Error('Photoshop: move to front is unavailable for the first layer');
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

for (const template of loadTemplates().getAllTemplates()) {
  test(template.id + ' renders only compact bounded text and the matching pickup code', async () => {
    const harness=makeRendererHarness();
    await harness.renderer.renderInfoBar(harness.targetDocument,template.infoBar,
      {shopName:'福清印象照相馆',shopPhone:'电话未填写'},
      {dateText:'2026.09.27',pickupCode:'A2B3C4',template,sourceDocument:harness.sourceDocument});
    const text=harness.textCommands.map(c=>c.using.textKey);
    assert.ok(text.includes('取件码：A2B3C4'));
    assert.equal(text.length,template.infoBar.texts.length);
    for(const layer of harness.targetDocument.layers.filter(l=>l.kind==='text')) {
      const b=layer.bounds,r=template.infoBar;
      assert.ok(b.left>=r.x && b.top>=r.y && b.right<=r.x+r.width+1 && b.bottom<=r.y+r.height+1,template.id+' overflow');
    }
  });
}
test('invalid or missing code renders pending; never use an archive marker or invent contact data',async()=>{
  for(const pickupCode of ['', '123456', 'ABCDEF', 'I2B3C4', 'A2B3C4-stale']) {
    const template=loadTemplates().getTemplateById('one-inch'),harness=makeRendererHarness();
    await harness.renderer.renderInfoBar(harness.targetDocument,template.infoBar,{},
      {pickupCode,template,sourceDocument:harness.sourceDocument});
    assert.ok(harness.textCommands.some(c=>c.using.textKey==='取件码：待补码'));
    assert.ok(harness.textCommands.some(c=>c.using.textKey==='电话未填写'));
  }
});

test("debug mode gives compact code/contact layers savable DEBUG names", async () => {
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
    ["DEBUG_text_pickupCode", "DEBUG_text_shopContact"]
  );
});

test("a saved free-transform target is reapplied to the next text layer", async () => {
  const templates = loadTemplates();
  const template = templates.getTemplateById("standard-two-inch");
  const harness = makeRendererHarness();
  template.infoBar.textLayers = {
    shopContact: { x: 3300, y: 280, width: 480, height: 120, fontSize: 6.4 }
  };

  await harness.renderer.renderInfoBar(
    harness.targetDocument,
    template.infoBar,
    { shopName: "\u798f\u6e05\u5370\u8c61\u7167\u76f8\u9986", shopPhone: "13003825982" },
    { dateText: "2026. 1.", template, sourceDocument: harness.sourceDocument }
  );

  const phoneLayer = harness.targetDocument.layers.find((layer) => layer.name === "shopContact");
  assert.deepEqual(phoneLayer.bounds, { left: 3300, top: 280, right: 3780, bottom: 400 });
});
