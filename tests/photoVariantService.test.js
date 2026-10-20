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

// 10-20: a tight crop where long dark hair and clothes cover the sides (1M9A5780 had 51% white).
function croppedPortrait({ background, hair = [20, 18, 16], shirt = [30, 30, 32], hairRows = [6, 26], shirtFrom = 26, cornerColour }) {
  const size = 32, data = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let colour = background;
    const face = x >= 11 && x < 21 && y >= 6;
    if (y >= shirtFrom) colour = shirt;
    else if (y >= hairRows[0] && y < hairRows[1] && (x < 4 || x >= 28)) colour = hair;
    else if (face) colour = [214, 170, 150];
    else if (y >= 3 && y < 6 && x >= 9 && x < 23) colour = hair;
    if (cornerColour && y < 4 && (x < 4 || x >= 28)) colour = cornerColour;
    data.set(colour, (y * size + x) * 3);
  }
  return { width: size, height: size, components: 3, data };
}

test("long hair and dark clothes no longer hide a white, blue or red background", () => {
  const { service } = loadVariantService();
  for (const [name, colour] of [["white", [236, 236, 234]], ["blue", [60, 140, 220]], ["red", [190, 30, 40]]]) {
    assert.equal(service.analyzeSample(croppedPortrait({ background: colour })).backgroundColor, name, name);
  }
});

test("the relaxed reading never guesses: mixed colours or different top corners stay unknown", () => {
  const { service } = loadVariantService();
  // A white shirt filling the lower border competes with the blue background.
  assert.equal(service.analyzeSample(croppedPortrait({ background: [60, 140, 220], shirt: [240, 240, 240], shirtFrom: 18 })).backgroundColor, "unknown");
  // The top corners show something else (a lamp, a wall): no answer.
  assert.equal(service.analyzeSample(croppedPortrait({ background: [236, 236, 234], cornerColour: [120, 110, 90] })).backgroundColor, "unknown");
});
