"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const servicePath = path.join(__dirname, "..", "src", "core", "settingsBackupService.js");

function loadService(localFileSystem, settingsProfile) {
  const context = {
    require(name) {
      assert.equal(name, "uxp");
      return { storage: { localFileSystem, formats: { utf8: "utf8" } } };
    },
    window: { IDPhotoSettingsProfile: settingsProfile }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(servicePath, "utf8"), context, { filename: servicePath });
  return context.window.IDPhotoSettingsBackupService;
}

test("settings backup writes the versioned profile without a NAS persistent token", async () => {
  let written = "";
  const file = {
    name: "settings.json",
    async write(value) {
      written = value;
    }
  };
  const service = loadService(
    {
      async getFileForSaving() {
        return file;
      }
    },
    {
      exportJson() {
        return JSON.stringify({ schemaVersion: 1, shop: { shopName: "测试店" }, nas: { label: "NAS" } });
      }
    }
  );

  const result = await service.exportBackup();

  assert.equal(result.ok, true);
  assert.equal(result.fileName, "settings.json");
  assert.match(written, /"schemaVersion":1/);
  assert.doesNotMatch(written, /persistentToken|nas-folder-token/);
});

test("settings restore reads one JSON file through the profile seam", async () => {
  let imported = "";
  const service = loadService(
    {
      async getFileForOpening() {
        return {
          name: "backup.json",
          async read() {
            return '{"schemaVersion":1,"shop":{"shopName":"恢复店名"}}';
          }
        };
      }
    },
    {
      importJson(raw) {
        imported = raw;
        return { shop: { shopName: "恢复店名" } };
      }
    }
  );

  const result = await service.importBackup();

  assert.equal(result.ok, true);
  assert.match(imported, /恢复店名/);
  assert.equal(result.profile.shop.shopName, "恢复店名");
});
