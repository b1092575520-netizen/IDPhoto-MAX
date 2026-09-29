"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");

const layerServicePath = path.join(__dirname, "..", "src", "photoshop", "layerService.js");

function makeLayer(id, left, top, width, height) {
  return {
    id,
    name: "layer-" + id,
    bounds: {
      left,
      top,
      right: left + width,
      bottom: top + height
    },
    async translate(deltaX, deltaY) {
      this.bounds.left += deltaX;
      this.bounds.right += deltaX;
      this.bounds.top += deltaY;
      this.bounds.bottom += deltaY;
    }
  };
}

function findLayer(layers, id) {
  for (const layer of layers || []) {
    if (layer.id === id) {
      return layer;
    }
    const child = findLayer(layer.layers, id);
    if (child) {
      return child;
    }
  }
  return null;
}

function loadLayerService(photoshop) {
  const context = {
    console: {
      log() {},
      warn() {},
      error() {}
    },
    require(name) {
      assert.equal(name, "photoshop");
      return photoshop;
    },
    window: {}
  };
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(layerServicePath, "utf8"), context, {
    filename: layerServicePath
  });
  return context.window.IDPhotoLayerService;
}

test("debug bounds include the combined shop-name/date text layer", () => {
  const combined = makeLayer(1, 100, 200, 300, 80);
  combined.name = "DEBUG_text_shopNameDate";
  const service = loadLayerService({ action: { async batchPlay() {} } });
  const result = service.getDebugInfoBarLayerBounds({ layers: [combined] });

  assert.deepEqual(JSON.parse(JSON.stringify(result.text.shopNameDate.rect)), {
    x: 100,
    y: 200,
    width: 300,
    height: 80
  });
});

test("duplicateLayerToDocument rejects when no new target layer exists", async () => {
  const existingLayer = makeLayer(1, 0, 0, 100, 100);
  const targetDocument = {
    layers: [existingLayer],
    activeLayers: [existingLayer],
    async activate() {}
  };
  const sourceLayer = makeLayer(10, 0, 0, 100, 100);
  const sourceDocument = {
    async duplicateLayers() {
      return [];
    }
  };
  const service = loadLayerService({
    action: { async batchPlay() {} }
  });

  await assert.rejects(
    service.duplicateLayerToDocument(sourceDocument, sourceLayer, targetDocument),
    /无法确认唯一新图层/
  );
  assert.equal(targetDocument.layers.length, 1);
});

test("placePhotoCopies creates one unique layer for each slot", async () => {
  let nextId = 100;
  let sourceDuplicateCount = 0;
  let localDuplicateCount = 0;
  const existingLayer = makeLayer(1, 0, 0, 3600, 2400);
  const targetDocument = {
    layers: [existingLayer],
    activeLayers: [existingLayer],
    async activate() {},
    async duplicateLayers(layers, target) {
      localDuplicateCount += 1;
      const source = layers[0];
      const duplicated = makeLayer(
        nextId++,
        source.bounds.left,
        source.bounds.top,
        source.bounds.right - source.bounds.left,
        source.bounds.bottom - source.bounds.top
      );
      target.layers.unshift(duplicated);
      target.activeLayers = [duplicated];
      return [duplicated];
    }
  };
  const sourceLayer = makeLayer(10, 0, 0, 200, 300);
  const sourceDocument = {
    width: 200,
    height: 300,
    layers: [sourceLayer],
    async duplicateLayers(_layers, target) {
      sourceDuplicateCount += 1;
      const duplicated = makeLayer(nextId++, 0, 0, 200, 300);
      target.layers.unshift(duplicated);
      target.activeLayers = [duplicated];
      return [duplicated];
    }
  };
  const service = loadLayerService({
    action: { async batchPlay() {} },
    core: {
      async executeAsModal(callback) {
        await callback();
      }
    }
  });

  const result = await service.placePhotoCopies(
    sourceDocument,
    targetDocument,
    {
      positions: [
        { x: 10, y: 20, rotate: 0 },
        { x: 250, y: 20, rotate: 0 }
      ]
    },
    {
      name: "test-template",
      widthPx: 200,
      heightPx: 300
    }
  );

  assert.equal(result.placedCount, 2);
  assert.equal(sourceDuplicateCount, 1);
  assert.equal(localDuplicateCount, 1);
  assert.equal(new Set(targetDocument.layers.map((layer) => layer.id)).size, 3);
  assert.deepEqual(
    targetDocument.layers.slice(0, 2).map((layer) => [layer.bounds.left, layer.bounds.top]),
    [
      [250, 20],
      [10, 20]
    ]
  );
});

test("placePhotoCopies snapshots existing target layer ids only once", async () => {
  let nextId = 100;
  let targetLayerReadCount = 0;
  const targetLayers = [makeLayer(1, 0, 0, 3600, 2400)];
  const targetDocument = {
    get layers() {
      targetLayerReadCount += 1;
      return targetLayers;
    },
    activeLayers: [targetLayers[0]],
    async activate() {},
    async duplicateLayers(layers) {
      const source = layers[0];
      const duplicated = makeLayer(
        nextId++,
        source.bounds.left,
        source.bounds.top,
        source.bounds.right - source.bounds.left,
        source.bounds.bottom - source.bounds.top
      );
      targetLayers.unshift(duplicated);
      this.activeLayers = [duplicated];
      return [duplicated];
    }
  };
  const sourceLayer = makeLayer(10, 0, 0, 200, 300);
  const sourceDocument = {
    width: 200,
    height: 300,
    layers: [sourceLayer],
    async duplicateLayers() {
      const duplicated = makeLayer(nextId++, 0, 0, 200, 300);
      targetLayers.unshift(duplicated);
      targetDocument.activeLayers = [duplicated];
      return [duplicated];
    }
  };
  const service = loadLayerService({
    action: { async batchPlay() {} },
    core: {
      async executeAsModal(callback) {
        await callback();
      }
    }
  });

  await service.placePhotoCopies(
    sourceDocument,
    targetDocument,
    {
      positions: [
        { x: 10, y: 20, rotate: 0 },
        { x: 250, y: 20, rotate: 0 },
        { x: 490, y: 20, rotate: 0 }
      ]
    },
    {
      name: "test-template",
      widthPx: 200,
      heightPx: 300
    }
  );

  assert.equal(targetLayerReadCount, 4);
});

test("moveLayerTo skips Photoshop work when the layer is already positioned", async () => {
  let translateCount = 0;
  const layer = makeLayer(6, 100, 60, 100, 100);
  layer.translate = async function () {
    translateCount += 1;
  };
  const service = loadLayerService({ action: { async batchPlay() {} } });

  const bounds = await service.moveLayerTo(layer, 100, 60, "already-positioned");

  assert.equal(translateCount, 0);
  assert.equal(bounds.left, 100);
  assert.equal(bounds.top, 60);
});
test("moving an earlier text layer selects that layer before Photoshop transforms", async () => {
  const earlier=makeLayer(1,10,20,100,30),latest=makeLayer(2,50,80,100,30);
  const doc={layers:[latest,earlier],activeLayers:[latest]};
  earlier.translate=async function(x,y){
    const selected=doc.activeLayers[0];
    selected.bounds.left+=x;selected.bounds.right+=x;
    selected.bounds.top+=y;selected.bounds.bottom+=y;
  };
  const service=loadLayerService({app:{activeDocument:doc},action:{async batchPlay(){throw Error('unexpected fallback');}}});
  await service.moveLayerTo(earlier,10,120,'earlier text');
  assert.equal(earlier.bounds.top,120);assert.equal(latest.bounds.top,80);
});

test("duplicateLayerToDocument does not reactivate the active target document", async () => {
  let activateCount = 0;
  const existingLayer = makeLayer(1, 0, 0, 100, 100);
  const targetDocument = {
    id: 20,
    layers: [existingLayer],
    activeLayers: [existingLayer],
    async activate() {
      activateCount += 1;
    }
  };
  const sourceLayer = makeLayer(10, 0, 0, 100, 100);
  const sourceDocument = {
    async duplicateLayers(_layers, target) {
      target.layers.unshift(makeLayer(2, 0, 0, 100, 100));
    }
  };
  const service = loadLayerService({
    app: { activeDocument: targetDocument },
    action: { async batchPlay() {} }
  });

  await service.duplicateLayerToDocument(sourceDocument, sourceLayer, targetDocument);

  assert.equal(activateCount, 0);
});

test("moveLayerTo recalculates batchPlay offset after a partial DOM move", async () => {
  const layer = makeLayer(7, 0, 0, 100, 100);
  layer.translate = async function (deltaX, deltaY) {
    this.bounds.left += deltaX / 2;
    this.bounds.right += deltaX / 2;
    this.bounds.top += deltaY / 2;
    this.bounds.bottom += deltaY / 2;
  };
  const layers = [layer];
  const service = loadLayerService({
    action: {
      async batchPlay(commands) {
        const command = commands[0];
        const target = findLayer(layers, command._target[0]._id);
        const deltaX = command.to.horizontal._value;
        const deltaY = command.to.vertical._value;
        await target.translate(deltaX * 2, deltaY * 2);
      }
    }
  });

  const bounds = await service.moveLayerTo(layer, 100, 60, "partial");

  assert.equal(bounds.left, 100);
  assert.equal(bounds.top, 60);
});

test("moveLayerTo rejects when the final bounds miss the target", async () => {
  const layer = makeLayer(8, 0, 0, 100, 100);
  layer.translate = async function (deltaX, deltaY) {
    this.bounds.left += deltaX / 2;
    this.bounds.right += deltaX / 2;
    this.bounds.top += deltaY / 2;
    this.bounds.bottom += deltaY / 2;
  };
  const service = loadLayerService({
    action: {
      async batchPlay() {}
    }
  });

  await assert.rejects(service.moveLayerTo(layer, 100, 60, "missed"), /图层未到达目标位置/);
});
