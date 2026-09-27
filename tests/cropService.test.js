"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");

const cropServicePath = path.join(__dirname, "..", "src", "photoshop", "cropService.js");
const smartCropPlannerPath = path.join(__dirname, "..", "src", "core", "smartCropPlanner.js");

function loadCropService(photoshop, documentService, contentAwareService, subjectDetectionService) {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.equal(name, "photoshop");
      return photoshop;
    },
    window: {
      IDPhotoDocumentService: documentService,
      IDPhotoContentAwareService: contentAwareService,
      IDPhotoSubjectDetectionService: subjectDetectionService
    }
  };
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(smartCropPlannerPath, "utf8"), context, { filename: smartCropPlannerPath });
  vm.runInContext(fs.readFileSync(cropServicePath, "utf8"), context, { filename: cropServicePath });
  return context.window.IDPhotoCropService;
}

test('delivery copy is captured after composite/crop but before print resize; electronic path never resizes', async () => {
  for (const electronic of [false, true]) {
    const events=[];
    const high={id:3,width:2400,height:3200};
    const processed={id:2,async activate(){},async duplicate(){events.push('high');return high;},async resizeImage(){events.push('resize');}};
    const original={id:1,async duplicate(){events.push('duplicate');return processed;}};
    const service=loadCropService({core:{async executeAsModal(fn){return fn();}}},{async prepareCompositeSourceLayer(){events.push('composite');return {};},async closeWithoutSaving(){}});
    const result=await service.prepareSinglePhoto(original,{name:'source',widthPx:2400,heightPx:3200},{name:'print',widthPx:600,heightPx:800},{ok:true},{keepHighResolution:!electronic,preservePixels:electronic});
    assert.deepEqual(events,electronic?['duplicate','composite']:['duplicate','composite','high','resize']);
    assert.equal(result.highResolutionDocument,electronic?null:high);
  }
});

test('an aliased high-resolution result never closes or resizes the original',async()=>{
  const closed=[];let resized=false;
  const original={id:1,async duplicate(){return processed;}};
  const processed={id:2,async activate(){},async duplicate(){return original;},async resizeImage(){resized=true;}};
  const service=loadCropService({core:{async executeAsModal(fn){return fn();}}},{async prepareCompositeSourceLayer(){return {};},async closeWithoutSaving(d){closed.push(d.id);}});
  await assert.rejects(service.prepareSinglePhoto(original,{name:'source',widthPx:2400,heightPx:3200},{name:'print',widthPx:600,heightPx:800},{ok:true},{keepHighResolution:true}),/高清副本身份/);
  assert.deepEqual(closed,[2]);assert.equal(resized,false);
});

test("a duplicate that aliases the original is never flattened, resized or closed", async () => {
  for (const sameObject of [true, false]) {
    const calls = [];
    const original = { id: 1, async duplicate() { return sameObject ? original : { id: 1 }; } };
    const service = loadCropService({ core: { async executeAsModal(fn) { return await fn(); } } }, {
      async prepareCompositeSourceLayer() { calls.push("flatten"); return {}; },
      async closeWithoutSaving() { calls.push("close"); }
    });
    await assert.rejects(service.prepareSinglePhoto(original, { name: "original.jpg", widthPx: 600, heightPx: 800 },
      { name: "1寸", widthPx: 600, heightPx: 800 }, { ok: true }), /原片/);
    assert.deepEqual(calls, []);
  }
});

test("cancelling crop closes only the temporary document without a fallback crop", async () => {
  const closed = [];
  const cancellation = Object.assign(new Error("cancelled"), { number: -128 });
  let fallbackCalls = 0;
  const processed = { id: 2, async activate() {}, async crop() { throw cancellation; } };
  const original = { id: 1, async duplicate() { return processed; } };
  const service = loadCropService({
    core: { async executeAsModal(fn) { return fn(); } },
    action: { async batchPlay() { fallbackCalls++; return []; } }
  }, {
    async prepareCompositeSourceLayer() { return {}; },
    async closeWithoutSaving(doc) { closed.push(doc.id); }
  });
  await assert.rejects(service.prepareSinglePhoto(original, { name: "original", widthPx: 1200, heightPx: 1600 },
    { name: "photo", widthPx: 600, heightPx: 800 }, { ok: false }, { strategy: "crop" }), error => error.number === -128);
  assert.deepEqual(closed, [2]);
  assert.equal(fallbackCalls, 0);
});

test("prepareSinglePhoto sends a rectangle object to the Photoshop DOM crop", async () => {
  let cropBounds = null;
  let batchPlayCount = 0;
  const processedDocument = {
    async activate() {},
    async crop(bounds) {
      if (Array.isArray(bounds)) {
        throw new Error("Rectangle does not contain key: left");
      }
      cropBounds = bounds;
    },
    async resizeImage() {}
  };
  const sourceDocument = {
    async duplicate() {
      return processedDocument;
    }
  };
  const service = loadCropService(
    {
      core: {
        async executeAsModal(callback) {
          await callback();
        }
      },
      action: {
        async batchPlay() {
          batchPlayCount += 1;
        }
      }
    },
    {
      async prepareCompositeSourceLayer() {
        return { method: "flatten", layer: { id: 1 }, temporaryLayer: false };
      },
      async closeWithoutSaving() {}
    }
  );

  const result = await service.prepareSinglePhoto(
    sourceDocument,
    { name: "source.jpg", widthPx: 1000, heightPx: 1000 },
    { name: "标准2寸", widthPx: 350, heightPx: 490 },
    { ok: false },
    { strategy: "crop" }
  );

  assert.equal(result.cropMode, "dom");
  assert.equal(batchPlayCount, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(cropBounds)), {
    left: 143,
    top: 0,
    right: 857,
    bottom: 1000
  });
});

test("prepareSinglePhoto rotates a portrait wedding source before resizing it", async () => {
  const events = [];
  const processedDocument = {
    async activate() {},
    async rotateCanvas(degrees) {
      events.push(["rotate", degrees]);
    },
    async crop() {
      events.push(["crop"]);
    },
    async resizeImage(width, height) {
      events.push(["resize", width, height]);
    }
  };
  const sourceDocument = {
    async duplicate() {
      return processedDocument;
    }
  };
  const service = loadCropService(
    {
      core: {
        async executeAsModal(callback) {
          await callback();
        }
      },
      action: {
        async batchPlay() {}
      }
    },
    {
      async prepareCompositeSourceLayer() {
        return { method: "flatten", layer: { id: 1 }, temporaryLayer: false };
      },
      async closeWithoutSaving() {}
    }
  );

  const result = await service.prepareSinglePhoto(
    sourceDocument,
    { name: "wedding.jpg", widthPx: 700, heightPx: 1060 },
    { id: "wedding", name: "结婚照", widthPx: 1252, heightPx: 829 },
    {
      ok: true,
      rotationDegrees: 90,
      effectiveWidthPx: 1060,
      effectiveHeightPx: 700
    },
    { strategy: "auto" }
  );

  assert.deepEqual(events, [
    ["rotate", 90],
    ["resize", 1252, 829]
  ]);
  assert.equal(result.rotationDegrees, 90);
  assert.equal(result.rotationMode, "dom");
});

test("the Photoshop document-rotation fallback explicitly targets the active document", async () => {
  let rotateCommand = null;
  const service = loadCropService(
    {
      core: {},
      action: {
        async batchPlay(commands) {
          rotateCommand = commands[0];
          if (!rotateCommand._target) {
            throw new Error("命令‘旋转’当前不可用");
          }
        }
      }
    },
    {}
  );

  const mode = await service.rotateDocumentWithDomOrBatchPlay({}, 90);

  assert.equal(mode, "batchPlay");
  assert.deepEqual(JSON.parse(JSON.stringify(rotateCommand._target)), [
    { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
  ]);
});

test("automatic mismatch without a detected subject crops instead of blindly expanding", async () => {
  let cropCount = 0;
  let expansionOptions = null;
  const processedDocument = {
    async activate() {},
    async crop() {
      cropCount += 1;
    },
    async resizeImage() {}
  };
  const service = loadCropService(
    {
      core: {
        async executeAsModal(callback) {
          await callback();
        }
      },
      action: {
        async batchPlay() {}
      }
    },
    {
      async prepareCompositeSourceLayer() {
        return { method: "flatten", layer: { id: 1 }, temporaryLayer: false };
      },
      async closeWithoutSaving() {}
    },
    {
      async expandToRatio(_documentRef, options) {
        expansionOptions = options;
        return { ok: true };
      }
    }
  );
  const sourceDocument = {
    async duplicate() {
      return processedDocument;
    }
  };

  const result = await service.prepareSinglePhoto(
    sourceDocument,
    { name: "portrait.jpg", widthPx: 1000, heightPx: 1000 },
    { id: "standard-two-inch", name: "标准2寸", widthPx: 350, heightPx: 490 },
    { ok: false, rotationDegrees: 0, effectiveWidthPx: 1000, effectiveHeightPx: 1000 },
    { strategy: "auto" }
  );

  assert.equal(result.cropMode, "dom");
  assert.equal(cropCount, 1);
  assert.equal(expansionOptions, null);
});

test("automatic mismatch handling crops modest top and bottom background instead of expanding", async () => {
  let cropBounds = null;
  let expansionCount = 0;
  const processedDocument = {
    async activate() {},
    async crop(bounds) {
      cropBounds = bounds;
    },
    async resizeImage() {}
  };
  const service = loadCropService(
    {
      core: {
        async executeAsModal(callback) {
          await callback();
        }
      },
      action: {
        async batchPlay() {}
      }
    },
    {
      async prepareCompositeSourceLayer() {
        return { method: "flatten", layer: { id: 1 }, temporaryLayer: false };
      },
      async closeWithoutSaving() {}
    },
    {
      async expandToRatio() {
        expansionCount += 1;
        return { ok: true };
      }
    },
    {
      async getSubjectBounds() {
        return { left: 480, top: 100, right: 1520, bottom: 2960 };
      }
    }
  );
  const sourceDocument = {
    async duplicate() {
      return processedDocument;
    }
  };

  const result = await service.prepareSinglePhoto(
    sourceDocument,
    { name: "portrait.jpg", widthPx: 2000, heightPx: 3000 },
    { id: "standard-two-inch", name: "标准2寸", widthPx: 350, heightPx: 490 },
    { ok: false, rotationDegrees: 0, effectiveWidthPx: 2000, effectiveHeightPx: 3000 },
    { strategy: "auto" }
  );

  assert.equal(expansionCount, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(cropBounds)), {
    left: 0,
    top: 0,
    right: 2000,
    bottom: 2800
  });
  assert.equal(result.cropMode, "dom");
  assert.match(result.strategyUsed, /自动裁切/);
});

test("automatic one-inch mode crops the empty sides without Select Subject or expansion", async () => {
  let cropBounds = null;
  let expansionCount = 0;
  let subjectDetectionCount = 0;
  const processedDocument = {
    async activate() {},
    async crop(bounds) { cropBounds = bounds; },
    async resizeImage() {}
  };
  const service = loadCropService(
    {
      core: { async executeAsModal(callback) { await callback(); } },
      action: { async batchPlay() {} }
    },
    {
      async prepareCompositeSourceLayer() {
        return { method: "flatten", layer: { id: 1 }, temporaryLayer: false };
      },
      async closeWithoutSaving() {}
    },
    {
      async expandToRatio() {
        expansionCount += 1;
        return { ok: true };
      }
    },
    {
      async getSubjectBounds() {
        subjectDetectionCount += 1;
        return { left: 1800, top: 280, right: 5200, bottom: 4640 };
      }
    }
  );
  const sourceDocument = { async duplicate() { return processedDocument; } };

  const result = await service.prepareSinglePhoto(
    sourceDocument,
    { name: "1M9A3408.JPG", widthPx: 6960, heightPx: 4640 },
    { id: "one-inch", name: "1寸", widthPx: 638, heightPx: 898 },
    { ok: false, effectiveWidthPx: 6960, effectiveHeightPx: 4640 },
    { strategy: "auto" }
  );

  assert.equal(expansionCount, 0);
  assert.equal(subjectDetectionCount, 0);
  assert.equal(result.cropMode, "dom");
  assert.equal(cropBounds.top, 0);
  assert.equal(cropBounds.bottom, 4640);
  assert.equal(cropBounds.left, Math.round((6960 - 3297) / 2));
});

for (const template of [
  { id: "argentina", name: "阿根廷", widthPx: 945, heightPx: 945 },
  { id: "us-visa", name: "美签5.0", widthPx: 1181, heightPx: 1181 },
  { id: "us-visa-51", name: "美签5.1", widthPx: 1205, heightPx: 1205 }
]) {
  test(`automatic square mode expands ${template.name} instead of cropping it`, async () => {
    let cropCount = 0;
    let expansionOptions = null;
    const processedDocument = {
      async activate() {},
      async crop() { cropCount += 1; },
      async resizeImage() {}
    };
    const service = loadCropService(
      {
        core: { async executeAsModal(callback) { await callback(); } },
        action: { async batchPlay() {} }
      },
      {
        async prepareCompositeSourceLayer() {
          return { method: "flatten", layer: { id: 1 }, temporaryLayer: false };
        },
        async closeWithoutSaving() {}
      },
      {
        async expandToRatio(_documentRef, options) {
          expansionOptions = options;
          return { ok: true };
        }
      }
    );
    const sourceDocument = { async duplicate() { return processedDocument; } };

    const result = await service.prepareSinglePhoto(
      sourceDocument,
      { name: "portrait.jpg", widthPx: 2000, heightPx: 3000 },
      template,
      { ok: false, effectiveWidthPx: 2000, effectiveHeightPx: 3000 },
      { strategy: "auto" }
    );

    assert.equal(cropCount, 0);
    assert.equal(expansionOptions.targetRatio, 1);
    assert.equal(result.cropMode, "content-aware-expand");
    assert.match(result.strategyUsed, /正方形模板/);
  });
}

test("manual content-aware mode still expands a modest mismatch", async () => {
  let cropCount = 0;
  let expansionCount = 0;
  const processedDocument = {
    async activate() {},
    async crop() {
      cropCount += 1;
    },
    async resizeImage() {}
  };
  const service = loadCropService(
    {
      core: {
        async executeAsModal(callback) {
          await callback();
        }
      },
      action: { async batchPlay() {} }
    },
    {
      async prepareCompositeSourceLayer() {
        return { method: "flatten", layer: { id: 1 }, temporaryLayer: false };
      },
      async closeWithoutSaving() {}
    },
    {
      async expandToRatio() {
        expansionCount += 1;
        return { ok: true };
      }
    }
  );
  const sourceDocument = { async duplicate() { return processedDocument; } };

  const result = await service.prepareSinglePhoto(
    sourceDocument,
    { name: "portrait.jpg", widthPx: 2000, heightPx: 3000 },
    { id: "standard-two-inch", name: "标准2寸", widthPx: 350, heightPx: 490 },
    { ok: false, effectiveWidthPx: 2000, effectiveHeightPx: 3000 },
    { strategy: "content-aware" }
  );

  assert.equal(expansionCount, 1);
  assert.equal(cropCount, 0);
  assert.equal(result.cropMode, "content-aware-expand");
});
