"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadSettingsProfile = require("./helpers/loadSettingsProfile");

const storePath = path.join(__dirname, "..", "src", "core", "debugSettingsStore.js");

function loadStore() {
  const values = new Map();
  const context = {
    window: {
      localStorage: {
        getItem(key) {
          return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
          values.set(key, String(value));
        }
      }
    }
  };
  vm.createContext(context);
  loadSettingsProfile(context);
  vm.runInContext(fs.readFileSync(storePath, "utf8"), context, { filename: storePath });
  return context.window.IDPhotoDebugSettingsStore;
}

test("a transformed vertical text layer keeps Photoshop's real point size", () => {
  const store = loadStore();
  const rect = store.makeLayerRect({
    rect: { x: 120, y: 300, width: 90, height: 960 },
    fontSize: 10
  });

  assert.deepEqual(JSON.parse(JSON.stringify(rect)), {
    x: 120,
    y: 300,
    width: 90,
    height: 960,
    fontSize: 10
  });
});

test("transformed bounds remain usable when Photoshop does not expose a point size", () => {
  const store = loadStore();
  const rect = store.makeLayerRect({ rect: { x: 20, y: 40, width: 480, height: 120 } });

  assert.deepEqual(JSON.parse(JSON.stringify(rect)), {
    x: 20,
    y: 40,
    width: 480,
    height: 120
  });
});
