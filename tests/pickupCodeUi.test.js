"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element(attributes = {}) {
  const listeners = {}, classes = new Set(), label = { textContent: "" };
  return {
    textContent: "", style: {}, label, attributes,
    getAttribute: key => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
    classList: { toggle: (key, value) => value ? classes.add(key) : classes.delete(key), contains: key => classes.has(key) },
    querySelector: () => label,
    addEventListener: (type, callback) => { listeners[type] = callback; },
    fire: (type = "click", event = {}) => listeners[type] && listeners[type](event)
  };
}

function harness(options = {}) {
  const memory = options.memory || new Map(), runs = [], alerts = [];
  const buttons = Object.fromEntries(["runButton", "deliverLayoutButton", "electronicDeliveryButton", "runVisualAcceptance", "statusText"]
    .map(id => [id, element()]));
  const toggle = element({ "data-key": "pickupCodeMode" }), size = element({ "data-template": "模板一" });
  let shortcuts, electronicCalls = 0;
  const source = { id: 10 }, template = { id: "one", name: "模板一", infoBar: {} };
  const document = {
    readyState: "complete", addEventListener() {},
    querySelector: selector => selector.startsWith("#") ? buttons[selector.slice(1).split(" ")[0]] || null :
      selector.includes('[data-key="pickupCodeMode"]') ? toggle : null,
    querySelectorAll: selector => selector === ".size-btn" ? [size] : selector === ".toggle-btn[data-key]" ? [toggle] : []
  };
  const window = {
    addEventListener() {},
    localStorage: { getItem: key => memory.get(key), setItem: (key, value) => { if (options.writeFail) throw Error("disk"); memory.set(key, value); } },
    IDPhotoTemplates: { getAllTemplates: () => [template], getTemplateByName: () => template, getTemplateById: () => template },
    IDPhotoShortcutService: { register: value => { shortcuts = value; } },
    IDPhotoDocumentService: { ensureActiveDocument: async () => ({ ok: true, document: { id: 10, name: "test.jpg" } }), getActiveDocument: () => source },
    IDPhotoSettingsStore: { load: () => ({}) },
    IDPhotoPhotoshopExecution: { getPhotoshop: () => ({ app: { showAlert: async message => {
      alerts.push(message);
      if (options.alertWait) await options.alertWait;
    } } }) },
    IDPhotoLayoutWorkflow: { create: () => ({ run: async run => {
      runs.push(run);
      const error = Object.assign(Error("后台未确认取件码"), { code: "PICKUP_CODE_REQUIRED" });
      if (options.throwFailure) throw error;
      const failed = options.fail;
      return { successes: failed ? [] : ["模板一"], failures: failed ? [{ templateName: "模板一", error }] : [],
        successResults: [], exportFailures: [], printFailures: [], printedResults: [], closedAfterPrintResults: [],
        closeAfterPrintFailures: [], duplicateExports: [], replacedExports: [] };
    } }) },
    IDPhotoDeliveryService: { electronic: async () => {
      electronicCalls++;
      if (options.electronicFailure) throw Object.assign(Error("后台未确认取件码"), { code: "PICKUP_CODE_REQUIRED" });
      return { code: "A2B3C4", status: { info: "saved" } };
    } }
  };
  const context = vm.createContext({ window, document, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout });
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const modules = ["core/pickupCodeModeStore", "core/templateSelectionService", "main"];
  for (const module of modules) {
    assert.ok(html.includes('src="' + "src/" + module + '.js"'), "runtime module must ship in index.html");
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/" + module + ".js"), "utf8"), context);
  }
  return { options, memory, runs, alerts, buttons, toggle, size, shortcuts, get electronicCalls() { return electronicCalls; },
    select: () => shortcuts.selectTemplate("模板一") };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test("ordinary button, double click and shortcut honor the persisted pickup switch; visual acceptance bypasses it", async () => {
  const h = harness();
  h.select(); h.buttons.runButton.fire(); await flush();
  assert.equal(h.runs.at(-1).delivery, false);
  h.toggle.fire();
  assert.equal(h.toggle.attributes["aria-pressed"], "true");
  assert.equal(h.toggle.label.textContent, "开");
  h.select(); h.buttons.runButton.fire(); await flush();
  assert.equal(h.runs.at(-1).delivery, true);
  h.select(); await h.shortcuts.execute();
  assert.equal(h.runs.at(-1).delivery, true);
  h.size.fire("dblclick", { preventDefault() {}, stopPropagation() {} }); await flush();
  assert.equal(h.runs.at(-1).delivery, true);
  h.buttons.runVisualAcceptance.fire(); await flush();
  assert.equal(h.runs.at(-1).delivery, false);
  assert.equal(h.runs.at(-1).skipExport, true);
  assert.equal(h.runs.at(-1).skipPrint, true);
  const reloaded = harness({ memory: h.memory });
  assert.equal(reloaded.toggle.label.textContent, "开");
  reloaded.toggle.fire();
  reloaded.select(); await reloaded.shortcuts.execute();
  assert.equal(reloaded.runs.at(-1).delivery, false);
});

test("explicit layout and electronic delivery still require pickup confirmation with the switch off", async () => {
  const h = harness({ electronicFailure: true });
  h.select(); h.buttons.deliverLayoutButton.fire(); await flush();
  assert.equal(h.runs.at(-1).delivery, true);
  await h.buttons.electronicDeliveryButton.fire();
  assert.equal(h.electronicCalls, 1);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /未输出成品、未提交打印/);
  assert.doesNotMatch(h.buttons.statusText.textContent, /电子成片已交接/);
});

for (const throwFailure of [false, true]) {
  test("pickup failure shows one native alert and retains selection for correction: throw=" + throwFailure, async () => {
    let dismiss;
    const h = harness({ fail: true, throwFailure, alertWait: new Promise(resolve => { dismiss = resolve; }) });
    h.toggle.fire(); h.select();
    const running = h.shortcuts.execute();
    await flush();
    assert.equal(h.alerts.length, 1);
    h.toggle.fire();
    assert.equal(h.toggle.label.textContent, "开", "mode cannot change while an operation/alert is active");
    await h.shortcuts.execute();
    assert.equal(h.runs.length, 1, "a second run cannot enter while the alert owns the operation");
    dismiss(); await running;
    assert.equal(h.size.classList.contains("active"), true);
    h.options.fail = false; h.options.throwFailure = false; h.options.alertWait = null;
    h.toggle.fire();
    await h.shortcuts.execute();
    assert.equal(h.runs.length, 2);
    assert.equal(h.runs[1].delivery, false);
  });
}

test("a preference write failure cannot make the UI claim the mode changed", () => {
  const h = harness({ writeFail: true });
  h.toggle.fire();
  assert.equal(h.toggle.label.textContent, "关");
  assert.equal(h.toggle.attributes["aria-pressed"], "false");
  assert.match(h.buttons.statusText.textContent, /模式未改变/);
});
