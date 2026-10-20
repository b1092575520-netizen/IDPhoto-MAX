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
  const memory = options.memory || new Map(), runs = [], alerts = [], automaticTicks = [];
  const buttons = Object.fromEntries(["runButton", "runVisualAcceptance", "statusText", "stopDeliveryWait", "deliveryPlanHint",
    "backgroundPicker", "backgroundRed", "backgroundBlue", "backgroundWhite", "backgroundPlain"]
    .map(id => [id, element()]));
  const documentListeners = {};
  const toggle = element({ "data-key": "pickupCodeMode" }), size = element({ "data-template": "模板一" });
  let shortcuts, electronicCalls = 0, electronicIntents = [], retryCalls = [], deferCalls = [];
  const source = { id: 10 }, template = { id: "one", name: "模板一", infoBar: {} };
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  const photo = { id: 10, name: "test.jpg", sourceMetadata: { serialNumber: "SHOP", captureDate: date } };
  const document = {
    readyState: "complete", addEventListener: (type, callback) => { (documentListeners[type] = documentListeners[type] || []).push(callback); },
    querySelector: selector => selector.startsWith("#") ? buttons[selector.slice(1).split(" ")[0]] || null :
      selector.includes('[data-key="pickupCodeMode"]') ? toggle : null,
    querySelectorAll: selector => selector === ".size-btn" ? [size] : selector === ".toggle-btn[data-key]" ? [toggle] : []
  };
  const window = {
    addEventListener() {},
    localStorage: { getItem: key => memory.get(key), setItem: (key, value) => { if (options.writeFail) throw Error("disk"); memory.set(key, value); } },
    IDPhotoTemplates: { getAllTemplates: () => [template], getTemplateByName: () => template, getTemplateById: () => template },
    IDPhotoShortcutService: { register: value => { shortcuts = value; } },
    IDPhotoDocumentService: { ensureActiveDocument: async () => ({ ok: true, document: photo }), getActiveDocument: () => source,
      getActiveDocumentInfo: async () => photo },
    IDPhotoSettingsProfile: { load: () => ({ cameras: options.cameras || [{ serialNumber: "SHOP" }] }) },
    IDPhotoSettingsStore: { load: () => ({}) },
    IDPhotoPhotoshopExecution: { getPhotoshop: () => ({ app: { showAlert: async message => {
      alerts.push(message);
      if (options.alertWait) await options.alertWait;
    } } }) },
    IDPhotoLayoutWorkflow: { stopAll: () => false, create: () => ({ run: async run => {
      runs.push(run);
      const error = options.failureError || Object.assign(Error("后台未确认取件码"), { code: "PICKUP_CODE_REQUIRED" });
      if (options.throwFailure) throw error;
      const failed = options.fail;
      return { successes: failed ? options.doneSizes || [] : ["模板一"], failures: failed ? [{ templateName: "模板一", error }] : [],
        successResults: [], exportFailures: [], printFailures: [], printedResults: [], closedAfterPrintResults: [],
        closeAfterPrintFailures: [], duplicateExports: [], replacedExports: [] };
    } }) },
    IDPhotoDeliveryService: {
      primeRecovery: async () => null,
      recoveredNotice: async () => null,
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
      electronic: async (sourceDocument, info, settings, intent) => {
      electronicCalls++;
      electronicIntents.push(intent || null);
      if (options.electronicFailure) throw Object.assign(Error("后台未确认取件码"), { code: "PICKUP_CODE_REQUIRED" });
      return { code: "A2B3C4", status: { info: "saved" } };
    } }
  };
  let tick = Date.now();
  class Clock extends Date { static now() { return tick; } }
  const context = vm.createContext({ window, document, Date: Clock, console: { log() {}, warn() {}, error() {} },
    setTimeout: options.automatic ? (callback, delay) => { automaticTicks.push(callback); } : setTimeout, clearTimeout });
  if (options.realIdentity) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/deliveryIdentity.js"), "utf8"), context);
  }
  if (options.automatic) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ui/deliveryStatusView.js"), "utf8"), context);
    window.IDPhotoVariantService = { analyzeDocument: async () => ({ backgroundColor: options.backgroundColor || "white" }) };
    window.IDPhotoDeliveryAutomationService = {
      store: () => ({ group: () => ({ on: false }), mergeIntent: () => null, source: () => null }),
      plan: () => ({ kind: "new" })
    };
  }
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const modules = ["core/sourceEligibilityService", "core/pickupCodeModeStore", "core/templateSelectionService", "main"];
  for (const module of modules) {
    assert.ok(html.includes('src="' + "src/" + module + '.js"'), "runtime module must ship in index.html");
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/" + module + ".js"), "utf8"), context);
  }
  return { options, memory, runs, alerts, buttons, toggle, size, shortcuts, photo, date, retryCalls, deferCalls, get electronicCalls() { return electronicCalls; }, electronicIntents,
    tick: async () => { assert.ok(automaticTicks.length, "automatic plan tick is scheduled"); await automaticTicks.shift()(); },
    advance: () => { tick += 1000; }, select: () => shortcuts.selectTemplate("模板一"),
    key: key => (documentListeners.keydown || []).forEach(callback => callback({ key, target: {}, preventDefault() {} })) };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

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

test("an exported photo stays ordinary", async () => {
  const h = harness({ electronicFailure: true });
  h.toggle.fire();
  h.photo.name = "证件照排版_旧照片.jpg";
  h.select(); await h.shortcuts.execute();
  assert.equal(h.runs.at(-1).delivery, false);
  assert.equal(h.runs.at(-1).deliveryIntent, null);
  assert.equal(h.alerts.length, 0);
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

test("pickup mode routes an unsaved subsecond camera photo to delivery and retains concrete plain reasons", async () => {
  const h = harness({ realIdentity: true });h.toggle.fire();
  h.photo.sourceMetadata = { serialNumber: "SHOP", captureDate: h.date + "T12:34:56", captureSubsecond: "53" };
  h.select();await h.shortcuts.execute();
  assert.equal(h.runs.at(-1).delivery, true);
  assert.equal(h.runs.at(-1).forceBlankInfoBar, false);
  h.advance();h.photo.sourceMetadata.captureSubsecond = "";h.select();await h.shortcuts.execute();
  assert.equal(h.runs.at(-1).delivery, false);
  assert.equal(h.runs.at(-1).forceBlankInfoBar, true);
  assert.match(h.buttons.statusText.textContent, /这张照片读不到拍摄编号，本次只排版、不出取件码/);
  h.advance();h.photo.sourceMetadata.serialNumber = "EXTERNAL";h.select();await h.shortcuts.execute();
  assert.equal(h.runs.at(-1).delivery, false);
  assert.match(h.buttons.statusText.textContent, /外来相片/);
});

for (const [reason, text] of Object.entries({
  "plugin-export": "排版成品不出码，请打开相机原片",
  "historical-source": "不是今天拍的，不出码",
  "missing-serial": "读不到相机序列号，不出码",
  "no-registered-camera": "未登记本店相机，不出码",
  "external-camera": "外来照片，不出码",
  "unverified-capture-date": "读不到拍摄日期，不出码",
  "missing-source-identity": "读不到拍摄编号，不出码"
})) {
  test("plain card gives the same specific reason before and during layout: " + reason, async () => {
    const h = harness({ realIdentity: true, automatic: true,
      cameras: reason === "no-registered-camera" ? [] : [{ serialNumber: "SHOP" }] });
    h.photo.sourceMetadata = { serialNumber: "SHOP", captureDate: h.date + "T12:34:56", captureSubsecond: "53" };
    if (reason === "plugin-export") h.photo.name = "签证2寸_827x1063_白_UIN75V.jpg";
    if (reason === "historical-source") h.photo.sourceMetadata.captureDate = "2000-01-02T12:34:56";
    if (reason === "missing-serial") h.photo.sourceMetadata.serialNumber = "";
    if (reason === "external-camera") h.photo.sourceMetadata.serialNumber = "EXTERNAL";
    if (reason === "unverified-capture-date") h.photo.sourceMetadata.captureDate = "";
    if (reason === "missing-source-identity") h.photo.sourceMetadata.captureSubsecond = "";
    h.toggle.fire(); h.select(); await h.tick();
    assert.equal(h.runs.length, 0, "preflight runs before layout");
    assert.equal(h.buttons.deliveryPlanHint.textContent, "只排版 · " + text);
    assert.equal(h.buttons.deliveryPlanHint.style.display, "block");
    await h.shortcuts.execute();
    assert.equal(h.buttons.deliveryPlanHint.textContent, "只排版 · " + text);
    assert.equal(h.runs.at(-1).delivery, false);
    assert.equal(h.electronicCalls, 0);
    assert.equal(h.alerts.length, 0);
    if (reason === "plugin-export") assert.match(h.buttons.statusText.textContent,
      /排版成品：仅排版，不显示信息条且不保存；要出码请打开相机原片/);
    h.toggle.fire(); h.select(); await h.tick();
    assert.equal(h.buttons.deliveryPlanHint.style.display, "none", "mode off still hides the card");
  });
}

// 10-20: a shop photo whose background cannot be read asks for it on the panel instead of
// silently printing without a code.
async function askedForBackground(answer) {
  const h = harness({ realIdentity: true, automatic: true, backgroundColor: "unknown" });
  h.photo.sourceMetadata = { serialNumber: "SHOP", captureDate: h.date + "T12:34:56", captureSubsecond: "53" };
  h.toggle.fire(); h.select(); await h.tick();
  assert.equal(h.buttons.deliveryPlanHint.textContent, "认不出底色 · 排版时点一下红、蓝或白底");
  const running = h.shortcuts.execute();
  for (let i = 0; i < 20 && h.buttons.backgroundPicker.style.display !== "block"; i++) await flush();
  assert.equal(h.buttons.backgroundPicker.style.display, "block", "the picker opens");
  assert.equal(h.runs.length, 0, "nothing is laid out while the operator decides");
  assert.match(h.buttons.statusText.textContent, /认不出底色：请在面板上点/);
  if (answer === "escape") h.key("Escape"); else h.buttons[answer].fire();
  await running;
  assert.equal(h.buttons.backgroundPicker.style.display, "none", "the picker closes");
  assert.equal(h.alerts.length, 0);
  return h;
}

for (const [button, colour] of [["backgroundRed", "red"], ["backgroundBlue", "blue"], ["backgroundWhite", "white"]]) {
  test("an unreadable background picked as " + colour + " still gets a pickup code", async () => {
    const h = await askedForBackground(button);
    assert.equal(h.runs.length, 1);
    assert.equal(h.runs[0].delivery, true);
    assert.equal(h.runs[0].docInfo.sourceVariant.backgroundColor, colour);
    assert.equal(h.runs[0].docInfo.sourceVariant.backgroundPicked, true);
  });
}

test("an unreadable background with 只排版 prints without a code", async () => {
  const h = await askedForBackground("backgroundPlain");
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].delivery, false);
  assert.equal(h.buttons.deliveryPlanHint.textContent, "只排版 · 认不出底色，不出码");
  assert.match(h.buttons.statusText.textContent, /认不出底色，按你的选择只排版/);
});

test("Esc on the background question makes nothing and the next Esc stays harmless", async () => {
  const h = await askedForBackground("escape");
  assert.equal(h.runs.length, 0);
  assert.match(h.buttons.statusText.textContent, /没选底色，这次没排版/);
  h.key("Escape");
  assert.equal(h.runs.length, 0);
});

test("pickup alerts say what actually happened: auto-continue, no code, or which sizes already came out", async () => {
  const cases = [
    [{ causeCode: "AUTO_TARGET_PREPARING" }, /稍后自动补上/, /不用重新排/],
    [{ causeCode: "AUTO_TASK_PENDING" }, /稍后自动补上/, /不用重新排/],
    [{}, /取件码没拿到，这次没出片/, /自动再试/],
    [{}, /取件码没拿到，后面的尺寸没出/, /已出好：模板一；这个尺寸和后面的没出/, ["模板一"]]
  ];
  for (const [extra, title, body, doneSizes] of cases) {
    const failureError = Object.assign(Error("后台未确认取件码"), { code: "PICKUP_CODE_REQUIRED" }, extra);
    const h = harness({ fail: true, failureError, doneSizes });
    h.toggle.fire(); h.select(); await h.shortcuts.execute();
    assert.equal(h.alerts.length, 1);
    assert.match(h.alerts[0], title);
    assert.match(h.alerts[0], body);
    assert.doesNotMatch(h.alerts[0], /未完成交付|继续原任务|多规格草稿/, "never points at removed panel entries");
  }
});

test("the panel no longer offers electronic, current-customer or pending-delivery entries", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  for (const id of ["electronicDeliveryButton", "reviewCurrentCustomer", "reviewPendingDelivery", "historicalDeliveryPanel",
    "currentCustomerPanel", "pendingDeliveryPanel"]) assert.equal(html.includes('id="' + id + '"'), false, id);
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  for (const id of ["electronicDeliveryButton", "reviewCurrentCustomer", "reviewPendingDelivery", "confirmDeliverySource"])
    assert.equal(main.includes(id), false, id);
});
