"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element(tag) {
  const listeners = {}, classes = new Set(), children = [], attributes = {};
  const node = {
    tagName: tag || "div", textContent: "", style: {}, disabled: false, checked: false, children,
    get firstChild() { return children[0] || null; },
    classList: { toggle: (key, value) => value ? classes.add(key) : classes.delete(key), contains: key => classes.has(key) },
    setAttribute: (key, value) => { attributes[key] = String(value); },
    getAttribute: key => attributes[key],
    appendChild: child => { children.push(child); return child; },
    removeChild: child => { children.splice(children.indexOf(child), 1); return child; },
    querySelector: selector => selector === ".toggle-state" ? node.label : null,
    querySelectorAll: () => children.flatMap(row => row.children.filter(child => child.tagName === "input")),
    addEventListener: (type, callback) => { listeners[type] = callback; },
    fire: type => listeners[type || "click"] && listeners[type || "click"]()
  };
  return node;
}

function load() {
  const ids = ["deliveryPlanHint", "deliveryRecoveryBar", "deliveryRecoveryText", "deliveryRecoveryPrint",
    "groupToggle", "groupStatus", "groupPicker", "groupPickerList", "groupPickerConfirm", "groupPickerSkip"];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  nodes.groupToggle.label = element("span");
  const root = { querySelector: selector => nodes[selector.slice(1)] || null, createElement: tag => element(tag) };
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

test("the 同行 switch stays hidden until the delivery logic enables it, and only changes through showGroup", async () => {
  const { view, nodes } = load();
  assert.equal(nodes.groupToggle.style.display, undefined);
  nodes.groupToggle.fire();
  const wanted = [];
  view.enableGroup(async wantOn => { wanted.push(wantOn); });
  assert.equal(nodes.groupToggle.style.display, "flex");
  nodes.groupToggle.fire();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(wanted, [true]);
  assert.equal(nodes.groupToggle.classList.contains("active"), false, "the switch waits for the real state");
  view.showGroup({ on: true, count: 3, code: "A7K3P9" });
  assert.equal(nodes.groupToggle.label.textContent, "开");
  assert.equal(nodes.groupStatus.textContent, "同行中 · 已 3 人 · 码 A7K3P9");
  nodes.groupToggle.fire();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(wanted, [true, false]);
  view.showGroup(null);
  assert.equal(nodes.groupStatus.style.display, "none");
  view.showPlan({ kind: "group", code: "A7K3P9" });
  assert.equal(nodes.deliveryPlanHint.textContent, "同行 · 并入 A7K3P9");
});

test("the recent-customer picker returns only the ticked customers, or none", () => {
  const { view, nodes } = load();
  const chosen = [];
  view.showGroupPicker([{ id: "a", name: "1M9A5480.JPG", time: "10:32", code: "K9F4T6" }, { id: "b", name: "1M9A5481.JPG", time: "10:40" }],
    ids => chosen.push(JSON.parse(JSON.stringify(ids))));
  assert.equal(nodes.groupPicker.style.display, "block");
  assert.equal(nodes.groupPickerList.children.length, 2);
  assert.match(nodes.groupPickerList.children[0].children.at(-1).textContent, /10:32 · 1M9A5480\.JPG · 码 K9F4T6/);
  nodes.groupPickerList.children[0].children[0].checked = true;
  nodes.groupPickerConfirm.fire();
  assert.deepEqual(chosen, [["a"]]);
  assert.equal(nodes.groupPicker.style.display, "none");
  nodes.groupPickerConfirm.fire();
  assert.equal(chosen.length, 1, "a closed picker cannot answer twice");
  view.showGroupPicker([{ id: "c", name: "x" }], ids => chosen.push(JSON.parse(JSON.stringify(ids))));
  nodes.groupPickerSkip.fire();
  assert.deepEqual(chosen[1], []);
});
