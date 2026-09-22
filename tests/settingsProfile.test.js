"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const profilePath = path.join(__dirname, "..", "src", "core", "settingsProfile.js");

function loadProfile(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  const context = {
    console: { warn() {}, error() {} },
    window: {
      localStorage: {
        getItem(key) {
          return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
          values.set(key, value);
        },
        removeItem(key) {
          values.delete(key);
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(profilePath, "utf8"), context, { filename: profilePath });
  return { profile: context.window.IDPhotoSettingsProfile, values, context };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("legacy settings migrate into one versioned profile without losing approved values", () => {
  const loaded = loadProfile({
    "idphoto-max-settings": JSON.stringify({ shopName: "旧店名", shopPhone: "123", shopTip: "旧提示" }),
    "idphoto-max-crop-strategy": "content-aware",
    "idphoto-max-crop-strategy-auto-v1": "done",
    "idphoto-max-shop-cameras": JSON.stringify([{ make: "Canon", model: "R6", serialNumber: "ABC123" }]),
    "idphoto-max-debug-mode": "on",
    "idphoto-max-template-debug-overrides": JSON.stringify({ argentina: { avatar: { x: 10 } } }),
    "idphoto-max-nas-folder-label": "\\\\NAS\\照片"
  });

  const result = plain(loaded.profile.load());

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.shop.shopName, "旧店名");
  assert.equal(result.cropStrategy, "content-aware");
  assert.equal(result.cameras[0].serialNumber, "ABC123");
  assert.equal(result.debug.enabled, true);
  assert.equal(result.debug.overrides.argentina.avatar.x, 10);
  assert.equal(result.nas.label, "\\\\NAS\\照片");
  assert.ok(loaded.values.has("idphoto-max-profile-v1"));
});

test("updating one profile section preserves every other section", () => {
  const loaded = loadProfile();
  loaded.profile.update("cameras", [{ serialNumber: "CAMERA-1" }]);
  loaded.profile.update("shop", { shopName: "新店名" });

  const result = plain(loaded.profile.load());
  assert.equal(result.shop.shopName, "新店名");
  assert.equal(result.shop.shopPhone, "13003825982（微信同号）");
  assert.equal(result.cameras[0].serialNumber, "CAMERA-1");
  assert.equal(result.cropStrategy, "auto");
});

test("a backup round-trip restores the profile and rejects malformed input", () => {
  const loaded = loadProfile();
  loaded.profile.update("shop", { shopName: "备份店名" });
  loaded.profile.update("cropStrategy", "crop");

  const backup = loaded.profile.exportJson();
  loaded.profile.update("shop", { shopName: "后来修改" });
  const restored = plain(loaded.profile.importJson(backup));

  assert.equal(restored.shop.shopName, "备份店名");
  assert.equal(restored.cropStrategy, "crop");
  assert.throws(() => loaded.profile.importJson("{bad json"), /设置备份/);
});

test("unavailable storage cannot report a successful settings save", () => {
  const loaded = loadProfile();
  loaded.context.window.localStorage = null;
  assert.throws(() => loaded.profile.save(loaded.profile.defaults()), /保存失败/);
});

test("corrupt or future settings are not silently overwritten by defaults or migration", () => {
  for (const raw of ["{broken", JSON.stringify({ schemaVersion: 99, shop: { shopName: "future" } })]) {
    const loaded = loadProfile({ "idphoto-max-profile-v1": raw });
    assert.throws(() => loaded.profile.update("shop", { shopName: "new" }), /设置/);
    assert.equal(loaded.values.get("idphoto-max-profile-v1"), raw);
  }
});
