"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");

function loadVariantService(failRead = false) {
  let inModal = false;
  let disposed = false;
  const context = {
    window: {},
    require(name) {
      assert.equal(name, "photoshop");
      return {
        core: { async executeAsModal(callback) {
          inModal = true;
          try { return await callback(); } finally { inModal = false; }
        } },
        imaging: { async getPixels(options) {
          assert.equal(inModal, true);
          assert.equal(options.documentID, 17);
          return { imageData: {
            width: 32, height: 32, components: 3,
            async getData() {
              assert.equal(inModal, true);
              if (failRead) throw new Error("pixels unavailable");
              return new Uint8Array(32 * 32 * 3).fill(255);
            },
            dispose() { disposed = true; }
          } };
        } }
      };
    }
  };
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/photoVariantService.js"), "utf8"), context);
  return { service: context.window.IDPhotoVariantService, disposed: () => disposed };
}

test("original pixel analysis uses the supplied document ID inside modal scope and disposes data", async () => {
  const loaded = loadVariantService();
  assert.equal((await loaded.service.analyzeDocument({ id: 17 })).backgroundColor, "white");
  assert.equal(loaded.disposed(), true);
});

test("failed pixel reads dispose image data and propagate the failure", async () => {
  const loaded = loadVariantService(true);
  await assert.rejects(loaded.service.analyzeDocument({ id: 17 }), /pixels unavailable/);
  assert.equal(loaded.disposed(), true);
});

test("flat or incomplete samples cannot manufacture matching person identities", () => {
  const service = loadVariantService().service;
  const sample = (value) => ({ width: 32, height: 32, components: 3, data: new Uint8Array(32 * 32 * 3).fill(value) });
  const first = service.analyzeSample(sample(200));
  const second = service.analyzeSample(sample(255));
  assert.equal(service.compareIdentity(first, second).kind, "ambiguous");
  assert.equal(service.serializeIdentity(first), "");
  assert.throws(() => service.analyzeSample({ width: 32, height: 32, components: 3, data: [255] }), /不完整/);
});
