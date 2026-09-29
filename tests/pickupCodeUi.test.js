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
    fire(type = "click", event = {}) { return listeners[type] ? listeners[type](event) : type === "click" && this.onclick ? this.onclick(event) : undefined; }
  };
}

function harness(options = {}) {
  const memory = options.memory || new Map(), runs = [], alerts = [];
  const buttons = Object.fromEntries(["runButton", "deliverLayoutButton", "electronicDeliveryButton", "runVisualAcceptance", "statusText",
    "historicalDeliveryPanel", "historicalDeliveryPhoto", "confirmHistoricalDelivery", "existingHistoricalDelivery", "cancelHistoricalDelivery",
    "reviewPendingDelivery", "pendingDeliveryPanel", "pendingDeliveryDescription", "retryPendingDelivery",
    "deferPendingDelivery", "closePendingDelivery", "checkDeliveryConnection", "deliveryConnectionStatus", "stopDeliveryWait"]
    .map(id => [id, element()]));
  const toggle = element({ "data-key": "pickupCodeMode" }), size = element({ "data-template": "模板一" });
  let shortcuts, electronicCalls = 0, retryCalls = [], deferCalls = [];
  const source = { id: 10 }, template = { id: "one", name: "模板一", infoBar: {} };
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  const photo = { id: 10, name: "test.jpg", sourceMetadata: { serialNumber: "SHOP", captureDate: date } };
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
    IDPhotoDocumentService: { ensureActiveDocument: async () => ({ ok: true, document: photo }), getActiveDocument: () => source },
    IDPhotoSettingsProfile: { load: () => ({ cameras: [{ serialNumber: "SHOP" }] }) },
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
    IDPhotoDeliveryService: {
      pending: async () => options.pending || null,
      retryPending: async id => {
        retryCalls.push(id);
        if(options.retryWait)await options.retryWait;
        if(!options.pending || options.pending.id !== id)throw Error("原任务已改变");
        options.pending=null;return {completionWritten:true};
      },
      deferPending: async id => { deferCalls.push(id);if(!options.pending||options.pending.id!==id)throw Error("原任务已改变");options.pending=null; },
      connection: async () => ({}),
      stopWaiting: () => false,
      electronic: async () => {
      electronicCalls++;
      if (options.electronicFailure) throw Object.assign(Error("后台未确认取件码"), { code: "PICKUP_CODE_REQUIRED" });
      return { code: "A2B3C4", status: { info: "saved" } };
    } }
  };
  let tick = Date.now();
  class Clock extends Date { static now() { return tick; } }
  const context = vm.createContext({ window, document, Date: Clock, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout });
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const modules = ["core/sourceEligibilityService", "core/pickupCodeModeStore", "core/templateSelectionService", "main"];
  for (const module of modules) {
    assert.ok(html.includes('src="' + "src/" + module + '.js"'), "runtime module must ship in index.html");
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/" + module + ".js"), "utf8"), context);
  }
  return { options, memory, runs, alerts, buttons, toggle, size, shortcuts, photo, date, retryCalls, deferCalls, get electronicCalls() { return electronicCalls; },
    advance: () => { tick += 1000; }, select: () => shortcuts.selectTemplate("模板一") };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test("pending recovery binds the reviewed original task and requires a separate explicit new-customer action", async () => {
  let release;
  const h=harness({pending:{id:"old-task",name:"原照片",mode:"print",outputOptions:{quickPrint:true}},
    retryWait:new Promise(resolve=>{release=resolve;})});
  await h.buttons.reviewPendingDelivery.fire();
  assert.match(h.buttons.pendingDeliveryDescription.textContent,/原照片/);
  assert.match(h.buttons.pendingDeliveryDescription.textContent,/原快速打印开启/);
  h.photo.id=99;h.photo.name="current-other.jpg";
  const running=h.buttons.retryPendingDelivery.fire();await flush();
  await h.buttons.retryPendingDelivery.fire();
  assert.deepEqual(h.retryCalls,["old-task"]);
  assert.equal(h.runs.length,0,"retry cannot route current active photo through ordinary layout");
  release();await running;
  assert.deepEqual(h.deferCalls,[]);
  h.options.pending={id:"next-old",name:"待核对照片",mode:"electronic",outputOptions:{}};
  await h.buttons.reviewPendingDelivery.fire();
  await h.buttons.closePendingDelivery.fire();
  assert.equal(h.options.pending.id,"next-old","closing the panel cannot discard a logical task");
  await h.buttons.reviewPendingDelivery.fire();
  await h.buttons.deferPendingDelivery.fire();
  assert.deepEqual(h.deferCalls,["next-old"]);
  assert.equal(h.runs.length,0,"new customer confirmation alone does not start a delivery");
});

for (const entry of ["button", "doubleClick", "shortcut"]) {
  test("mode stays on across new/external/historical/unknown/next new photos: " + entry, async () => {
    const h = harness();
    h.toggle.fire();
    for (const [metadata, expected] of [
      [{ serialNumber: "SHOP", captureDate: h.date }, true],
      [{ serialNumber: "EXTERNAL", captureDate: h.date }, false],
      [{ serialNumber: "SHOP", captureDate: "2000-01-02" }, false],
      [{ serialNumber: "SHOP" }, false],
      [{}, false],
      [{ serialNumber: "SHOP", captureDate: h.date }, true]
    ]) {
      h.photo.sourceMetadata = metadata;
      h.advance();
      const previousRuns = h.runs.length;
      h.select();
      if (entry === "shortcut") await h.shortcuts.execute();
      else if (entry === "button") h.buttons.runButton.fire();
      else h.size.fire("dblclick", { preventDefault() {}, stopPropagation() {} });
      await flush();
      assert.equal(h.runs.length, previousRuns + 1);
      assert.equal(h.runs.at(-1).delivery, expected);
      assert.equal(h.toggle.label.textContent, "开");
      assert.equal(h.alerts.length, 0);
    }
  });
}

test("an exported photo stays ordinary and an explicit delivery never silently downgrades", async () => {
  const h = harness();
  h.toggle.fire();
  h.photo.name = "证件照排版_旧照片.jpg";
  h.select(); await h.shortcuts.execute();
  assert.equal(h.runs.at(-1).delivery, false);
  h.options.fail = true;
  h.select(); h.buttons.deliverLayoutButton.fire(); await flush();
  h.buttons.confirmHistoricalDelivery.fire(); await flush();
  assert.equal(h.runs.at(-1).delivery, true);
  assert.equal(h.alerts.length, 1);
});

test("historical confirmation is explicit, cancellable and limited to this photo", async () => {
  const h = harness();
  h.toggle.fire();
  h.photo.sourceMetadata.captureDate = "2000-01-02";
  h.select(); h.buttons.deliverLayoutButton.fire(); await flush();
  assert.equal(h.runs.length, 0, "no delivery before explicit confirmation");
  h.buttons.cancelHistoricalDelivery.fire(); await flush();
  assert.equal(h.runs.length, 0);
  h.select(); h.buttons.deliverLayoutButton.fire(); await flush();
  h.buttons.confirmHistoricalDelivery.fire(); await flush();
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].deliveryIntent.type, "historical-shop");
  assert.equal(h.runs[0].deliveryIntent.sourceDocumentId, "10");
  h.photo.name = "next-historical.jpg";
  h.select(); await h.shortcuts.execute();
  assert.equal(h.runs[1].delivery, false);
  assert.equal(h.runs[1].deliveryIntent, null);
  assert.equal(h.toggle.label.textContent, "开");
});

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
