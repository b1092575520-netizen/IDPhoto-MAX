"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(memory, failWrite = false) {
  const context = vm.createContext({ window: { localStorage: {
    getItem: key => memory.get(key),
    setItem: (key, value) => { if (failWrite) throw Error("storage unavailable"); memory.set(key, value); }
  } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/pickupCodeModeStore.js"), "utf8"), context);
  return context.window.IDPhotoPickupCodeModeStore;
}

test("pickup mode starts off, persists explicit choices, and leaves other settings alone", () => {
  const memory = new Map([["idphoto-max-quick-print-mode", "remember"]]);
  const store = load(memory);
  assert.equal(store.load(), false);
  store.setEnabled(true);
  assert.equal(load(memory).load(), true);
  store.setEnabled(false);
  assert.equal(load(memory).load(), false);
  assert.equal(memory.get("idphoto-max-quick-print-mode"), "remember");
});

test("an unreadable or invalid preference uses ordinary mode; a failed write is reported", () => {
  const memory = new Map(), store = load(memory);
  memory.set(store.KEY, "garbage");
  assert.equal(store.load(), false);
  assert.throws(() => load(memory, true).setEnabled(true), /storage unavailable/);
});
