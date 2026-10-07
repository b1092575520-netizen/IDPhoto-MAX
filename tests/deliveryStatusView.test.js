"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const listeners = {}, classes = new Set();
  return {
    textContent: "", style: {}, disabled: false,
    classList: { toggle: (key, value) => value ? classes.add(key) : classes.delete(key), contains: key => classes.has(key) },
    addEventListener: (type, callback) => { listeners[type] = callback; },
    fire: type => listeners[type || "click"] && listeners[type || "click"]()
  };
}

function load() {
  const ids = ["deliveryPlanHint", "deliveryRecoveryBar", "deliveryRecoveryText", "deliveryRecoveryPrint", "multiDeliveryButton"];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const root = { querySelector: selector => nodes[selector.slice(1)] || null };
  const window = {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ui/deliveryStatusView.js"), "utf8"), vm.createContext({ window, Promise }));
  return { view: window.IDPhotoDeliveryStatusView.create({ root }), nodes };
}

test("the plan hint says whether a code is new or reused, and hides when unknown", () => {
  const { view, nodes } = load();
  view.showPlan({ kind: "new" });
  assert.equal(nodes.deliveryPlanHint.textContent, "新顾客 · 将取新码");
  assert.equal(nodes.deliveryPlanHint.style.display, "block");
  view.showPlan({ kind: "same", code: "A7K3P9" });
  assert.match(nodes.deliveryPlanHint.textContent, /沿用 A7K3P9，替换照片/);
  assert.equal(nodes.deliveryPlanHint.classList.contains("same"), true);
  view.showPlan(null);
  assert.equal(nodes.deliveryPlanHint.style.display, "none");
});

test("a recovered task only prints after the operator clicks print", async () => {
  const { view, nodes } = load();
  let printed = 0;
  view.showRecovery({ text: "A7K3P9 已补好，可以打印", canPrint: true }, async () => { printed++; });
  assert.equal(nodes.deliveryRecoveryBar.style.display, "flex");
  assert.equal(printed, 0);
  nodes.deliveryRecoveryPrint.fire();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(printed, 1);
  view.showRecovery({ text: "取码仍在重试", canPrint: false });
  assert.equal(nodes.deliveryRecoveryPrint.style.display, "none");
  nodes.deliveryRecoveryPrint.fire();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(printed, 1, "a bar without a print action cannot print");
  view.showRecovery(null);
  assert.equal(nodes.deliveryRecoveryBar.style.display, "none");
});

test("the draft count appears on the multi-spec button and clears at zero", () => {
  const { view, nodes } = load();
  view.showDraftCount(2);
  assert.equal(nodes.multiDeliveryButton.textContent, "多规格 / 同行共领 · 暂存 2");
  view.showDraftCount(0);
  assert.equal(nodes.multiDeliveryButton.textContent, "多规格 / 同行共领");
});
