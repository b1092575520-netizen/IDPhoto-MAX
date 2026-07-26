"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadSettingsProfile = require("./helpers/loadSettingsProfile");

const storePath = path.join(__dirname, "..", "src", "core", "cropStrategyStore.js");

function loadStore(savedValue, onSet) {
  const values = new Map();
  if (savedValue !== null && savedValue !== undefined) {
    values.set("idphoto-max-crop-strategy", savedValue);
  }
  const context = {
    window: {
      localStorage: {
        getItem(key) {
          return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
          values.set(key, String(value));
          if (onSet) {
            onSet(value, key);
          }
        }
      }
    }
  };
  vm.createContext(context);
  loadSettingsProfile(context);
  vm.runInContext(fs.readFileSync(storePath, "utf8"), context, { filename: storePath });
  return { store: context.window.IDPhotoCropStrategyStore, values };
}

test("legacy generative strategy migrates to content-aware", () => {
  const { store } = loadStore("generative");

  assert.equal(store.load(), "content-aware");
  assert.equal(store.normalize("generative"), "content-aware");
});

test("saving the legacy generative strategy persists content-aware", () => {
  let savedValue = "";
  const { store } = loadStore(null, (value, key) => {
    if (key === "idphoto-max-profile-v1") {
      savedValue = JSON.parse(value).cropStrategy;
    }
  });

  const result = store.save("generative");

  assert.equal(result.strategy, "content-aware");
  assert.equal(savedValue, "content-aware");
});

test("existing direct-crop defaults migrate once to the automatic strategy", () => {
  const { store, values } = loadStore("crop");

  assert.equal(store.load(), "auto");
  assert.equal(JSON.parse(values.get("idphoto-max-profile-v1")).cropStrategy, "auto");
  assert.equal(values.get("idphoto-max-crop-strategy"), "crop");
});

test("the settings UI does not advertise unavailable generative expansion", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.doesNotMatch(html, /value="generative"/);
  assert.doesNotMatch(html, /generativeExpandService\.js/);

  const cropService = fs.readFileSync(path.join(__dirname, "..", "src", "photoshop", "cropService.js"), "utf8");
  assert.doesNotMatch(cropService, /IDPhotoGenerativeExpandService|generative-expand/);
});

test("the retired crop-strategy settings strip is not rendered", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.doesNotMatch(html, /cropStrategyGroup/);
  assert.doesNotMatch(html, /裁剪与扩图策略/);
});
