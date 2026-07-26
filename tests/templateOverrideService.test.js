"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const modulePath = path.join(__dirname, "..", "src", "core", "templateOverrideService.js");

function loadService() {
  const storedOverrides = { one: { infoBar: { x: 33 } } };
  const context = {
    window: {
      IDPhotoDebugSettingsStore: {
        getOverride(templateId) {
          return storedOverrides[templateId] || null;
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(modulePath, "utf8"), context, { filename: modulePath });
  return { service: context.window.IDPhotoTemplateOverrideService, storedOverrides };
}

test("clearing all runtime overrides reveals the restored persistent values", () => {
  const loaded = loadService();
  loaded.service.applyRuntimeOverride("one", { infoBar: { x: 88 } });
  assert.equal(loaded.service.getOverride("one").infoBar.x, 88);

  loaded.storedOverrides.one = { infoBar: { x: 44 } };
  loaded.service.clearAllRuntimeOverrides();

  assert.equal(loaded.service.getOverride("one").infoBar.x, 44);
});
