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

test("placePhotoCopies composites all slots into one pixel layer via photoshop.imaging and disposes buffers", async () => {
  const srcW = 3, srcH = 2, srcC = 3;
  // Asymmetric 3x2 pixels (row-major):
  // (0,0)=[10,1,1] (1,0)=[20,2,2] (2,0)=[30,3,3]
  // (0,1)=[40,4,4] (1,1)=[50,5,5] (2,1)=[60,6,6]
  const srcPixels = new Uint8Array([
    10, 1, 1, 20, 2, 2, 30, 3, 3,
    40, 4, 4, 50, 5, 5, 60, 6, 6
  ]);
  const disposed = [];
  const getCalls = [];
  const putCalls = [];
  const createdLayers = [];
  let dupCalls = 0;

  const targetDocument = {
    id: 2,
    width: 20,
    height: 20,
    layers: [],
    activeLayers: [],
    async activate() {},
    async createLayer(kind, opts) {
      assert.equal(kind, "pixel");
      const layer = makeLayer(99, 0, 0, 1, 1);
      layer.name = opts && opts.name;
      createdLayers.push(layer);
      this.layers.unshift(layer);
      return layer;
    }
  };
  const sourceDocument = {
    id: 1,
    width: srcW,
    height: srcH,
    layers: [makeLayer(1, 0, 0, srcW, srcH)],
    async duplicateLayers() {
      dupCalls += 1;
      return [];
    }
  };

  const service = loadLayerService({
    app: { activeDocument: targetDocument },
    core: { async executeAsModal(cb) { await cb(); } },
    action: { async batchPlay() {} },
    imaging: {
      async getPixels(opts) {
        getCalls.push(opts);
        return {
          imageData: {
            width: srcW,
            height: srcH,
            components: srcC,
            async getData() { return srcPixels; },
            dispose() { disposed.push("src"); }
          }
        };
      },
      async createImageDataFromBuffer(buffer, opts) {
        return {
          width: opts.width,
          height: opts.height,
          components: opts.components,
          colorProfile: opts.colorProfile,
          _buffer: new Uint8Array(buffer),
          dispose() { disposed.push("out"); }
        };
      },
      async putPixels(opts) {
        putCalls.push(opts);
      }
    }
  });

  // Four slots covering 0, 90 (CW), -90 (CCW), and 180 degrees.
  const layoutPlan = {
    canvas: { widthPx: 20, heightPx: 20 },
    positions: [
      { x: 2, y: 1, width: 3, height: 2, rotate: 0 },
      { x: 6, y: 1, width: 2, height: 3, rotate: 90 },
      { x: 9, y: 1, width: 2, height: 3, rotate: -90 },
      { x: 12, y: 1, width: 3, height: 2, rotate: 180 }
    ]
  };

  const result = await service.placePhotoCopies(
    sourceDocument,
    targetDocument,
    layoutPlan,
    { name: "1寸", widthPx: srcW, heightPx: srcH }
  );

  assert.equal(result.pixelComposite, true);
  assert.equal(result.placedCount, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(result.sourceSize)), { width: srcW, height: srcH });
  assert.equal(dupCalls, 0);
  assert.equal(getCalls.length, 1);
  assert.equal(getCalls[0].colorProfile, "sRGB IEC61966-2.1");
  assert.equal(getCalls[0].applyAlpha, false);
  assert.equal(createdLayers.length, 1);
  assert.equal(putCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(putCalls[0].targetBounds)), { left: 2, top: 1 });
  assert.equal(putCalls[0].imageData.width, 13);
  assert.equal(putCalls[0].imageData.height, 3);
  assert.equal(putCalls[0].imageData.colorProfile, "sRGB IEC61966-2.1");
  assert.deepEqual(disposed, ["src", "out"]);

  const buf = putCalls[0].imageData._buffer;
  const pxAt = (canvasX, canvasY) => {
    const off = ((canvasY - 1) * 13 + (canvasX - 2)) * 3;
    return [buf[off], buf[off + 1], buf[off + 2]];
  };
  // White canvas fill in gap (canvasX=5, canvasY=1)
  assert.deepEqual(pxAt(5, 1), [255, 255, 255]);
  // 0 deg at (2,1): top-left = (0,0), bottom-right = (2,1)
  assert.deepEqual(pxAt(2, 1), [10, 1, 1]);
  assert.deepEqual(pxAt(4, 2), [60, 6, 6]);
  // 90 deg CW at (6,1), 2x3: (0,0) -> (dx=srcH-1=1, dy=0) => (7,1); (2,0) -> (dx=1, dy=2) => (7,3); (0,1) -> (dx=0, dy=0) => (6,1)
  assert.deepEqual(pxAt(7, 1), [10, 1, 1]);
  assert.deepEqual(pxAt(7, 3), [30, 3, 3]);
  assert.deepEqual(pxAt(6, 1), [40, 4, 4]);
  // -90 deg CCW at (9,1), 2x3: (0,0) -> (dx=0, dy=srcW-1=2) => (9,3); (2,0) -> (dx=0, dy=0) => (9,1); (2,1) -> (dx=1, dy=0) => (10,1)
  assert.deepEqual(pxAt(9, 3), [10, 1, 1]);
  assert.deepEqual(pxAt(9, 1), [30, 3, 3]);
  assert.deepEqual(pxAt(10, 1), [60, 6, 6]);
  // 180 deg at (12,1), 3x2: (0,0) -> (2,1) => (14,2); (2,1) -> (0,0) => (12,1)
  assert.deepEqual(pxAt(14, 2), [10, 1, 1]);
  assert.deepEqual(pxAt(12, 1), [60, 6, 6]);
});

test("stampPhotoIntoBuffer alpha-blends 4-channel RGBA onto background RGB", () => {
  const service = loadLayerService({ action: { async batchPlay() {} } });
  const out = new Uint8Array(2 * 1 * 3);
  out.fill(255);
  // Pixel 0: alpha=0 (transparent -> background); Pixel 1: red with alpha=128 (~50% blend with white)
  const srcRgba = new Uint8Array([
    10, 20, 30, 0,
    255, 0, 0, 128
  ]);
  service.stampPhotoIntoBuffer(out, 2, 1, 0, 0, srcRgba, 2, 1, 4, { x: 0, y: 0, rotate: 0 });
  assert.deepEqual(Array.from(out.slice(0, 3)), [255, 255, 255]);
  assert.equal(out[3], 255);
  assert.equal(out[4], Math.round((0 * 128 + 255 * 127) / 255));
  assert.equal(out[5], Math.round((0 * 128 + 255 * 127) / 255));
});

test("placePhotoCopies falls back to DOM layers when separateLayers is true or putPixels fails (deleting orphan pixel layer)", async () => {
  const srcW = 10, srcH = 10;
  let getPixelCalls = 0;
  let deletedOrphan = 0;
  let modalDepth = 0;
  let failDelete = false;
  let nextId = 50;
  const runModal = async (cb) => {
    modalDepth += 1;
    try {
      await cb();
    } finally {
      modalDepth -= 1;
    }
  };

  const makeTarget = () => ({
    id: 2,
    width: 100,
    height: 100,
    layers: [],
    activeLayers: [],
    async activate() {},
    async createLayer(_kind, opts) {
      assert.ok(modalDepth > 0, "createLayer must run inside executeAsModal");
      const layer = {
        id: nextId++,
        name: opts && opts.name,
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
        async delete() {
          assert.ok(modalDepth > 0, "delete must run inside executeAsModal");
          if (failDelete) throw new Error("delete blocked");
          deletedOrphan += 1;
          const idx = target.layers.indexOf(this);
          if (idx >= 0) target.layers.splice(idx, 1);
        }
      };
      this.layers.unshift(layer);
      return layer;
    }
  });

  // Case 1: separateLayers: true skips imaging
  let target = makeTarget();
  const makeSource = () => ({
    id: 1,
    width: srcW,
    height: srcH,
    layers: [makeLayer(1, 0, 0, srcW, srcH)],
    async duplicateLayers(_layers, dest) {
      const copy = makeLayer(nextId++, 0, 0, srcW, srcH);
      dest.layers.unshift(copy);
      return [copy];
    }
  });
  const serviceSeparate = loadLayerService({
    app: { activeDocument: target },
    core: { executeAsModal: runModal },
    action: { async batchPlay() {} },
    imaging: {
      async getPixels() { getPixelCalls += 1; throw new Error("should not run"); },
      async createImageDataFromBuffer() { return {}; },
      async putPixels() {}
    }
  });
  const domRes = await serviceSeparate.placePhotoCopies(
    makeSource(),
    target,
    { canvas: { widthPx: 100, heightPx: 100 }, positions: [{ x: 10, y: 10, width: 10, height: 10, rotate: 0 }] },
    { name: "1寸", widthPx: srcW, heightPx: srcH },
    { separateLayers: true }
  );
  assert.equal(getPixelCalls, 0);
  assert.equal(domRes.pixelComposite, undefined);
  assert.equal(domRes.placedCount, 1);

  // Case 2: imaging.putPixels throws -> deletes orphan pixel layer & falls back to DOM
  target = makeTarget();
  const disposed = [];
  const serviceFallback = loadLayerService({
    app: { activeDocument: target },
    core: { executeAsModal: runModal },
    action: { async batchPlay() {} },
    imaging: {
      async getPixels() {
        return {
          imageData: {
            width: srcW,
            height: srcH,
            components: 3,
            async getData() { return new Uint8Array(srcW * srcH * 3); },
            dispose() { disposed.push("src"); }
          }
        };
      },
      async createImageDataFromBuffer(_b, opts) {
        return { width: opts.width, height: opts.height, components: 3, dispose() { disposed.push("out"); } };
      },
      async putPixels() {
        throw new Error("putPixels transient failure");
      }
    }
  });
  const fallbackRes = await serviceFallback.placePhotoCopies(
    makeSource(),
    target,
    { canvas: { widthPx: 100, heightPx: 100 }, positions: [{ x: 10, y: 10, width: 10, height: 10, rotate: 0 }] },
    { name: "1寸", widthPx: srcW, heightPx: srcH }
  );
  assert.equal(deletedOrphan, 1);
  assert.deepEqual(disposed, ["src", "out"]);
  assert.equal(fallbackRes.placedCount, 1);
  assert.equal(fallbackRes.pixelComposite, undefined);
  assert.equal(target.layers.length, 1);
  assert.equal(target.layers[0].name, "1寸_照片_1");

  // Case 3: orphan cleanup throws inside executeAsModal -> refuse silent DOM stacking
  target = makeTarget();
  failDelete = true;
  await assert.rejects(
    serviceFallback.placePhotoCopies(
      makeSource(),
      target,
      { canvas: { widthPx: 100, heightPx: 100 }, positions: [{ x: 10, y: 10, width: 10, height: 10, rotate: 0 }] },
      { name: "1寸", widthPx: srcW, heightPx: srcH }
    ),
    /残留空图层清理失败/
  );
  assert.equal(target.layers.filter((l) => l.name === "1寸_照片_1").length, 0);
});

test("normalizeRightAngle rejects non-integer or invalid angles while keeping optional undefined/null at 0", () => {
  const service = loadLayerService({ action: { async batchPlay() {} } });
  for (const [input, expected] of [
    [undefined, 0],
    [null, 0],
    ["", 0],
    [0, 0],
    [90, 90],
    [-90, 270],
    [180, 180],
    [270, 270],
    [89.6, null],
    [90.1, null],
    [0.4, null],
    ["invalid", null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null]
  ]) {
    assert.equal(service.normalizeRightAngle(input), expected, "angle=" + String(input));
  }
});
