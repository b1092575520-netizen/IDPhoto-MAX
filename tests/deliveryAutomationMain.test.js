"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(options = {}) {
  const status = { textContent: "" }, scheduled = [], recoveries = [], prints = [], views = [];
  const document = {
    readyState: "complete", addEventListener() {},
    querySelector: selector => selector === "#statusText" ? status : null,
    querySelectorAll: () => []
  };
  const window = {
    addEventListener() {}, localStorage: { getItem: () => null, setItem() {} },
    IDPhotoPickupCodeModeStore: { load: () => true },
    IDPhotoDeliveryStatusView: { create: () => ({
      enableGroup() {}, showGroup() {}, showPlan() {},
      showRecovery: (notice, onPrint) => views.push({ notice, onPrint })
    }) },
    IDPhotoDeliveryAutomationService: {
      store: () => ({ group: () => ({ on: false }), mergeIntent: () => options.merge ? { taskIds: ["A", "B"] } : null }),
      openGroup: async () => { throw Error("同行合并仍待核对"); }
    },
    IDPhotoDeliveryService: {
      primeRecovery: async () => options.pending || null,
      recoverNext: async id => { recoveries.push(id); return { id, code: "A7K3P9", canPrint: true, text: "A7K3P9 已补好，可以打印" }; },
      recoveredNotice: async () => options.notice || null,
      printRecovered: async id => {
        prints.push(id);
        if (options.printWait) await options.printWait;
        if (options.printError) throw Error("打印状态未确认，请核对 DS-RX1");
      }
    }
  };
  const context = vm.createContext({ window, document, console: { log() {}, warn() {}, error() {} },
    setTimeout: callback => { scheduled.push(callback); }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8"), context);
  return { options, status, recoveries, prints, views, tick: async () => {
    assert.ok(scheduled.length, "the production main loop must schedule itself");
    await scheduled.shift()();
  } };
}

test("an unresolved companion merge cannot block automatic recovery of an independent original", async () => {
  const h = harness({ merge: true, pending: "C" });
  await h.tick();
  assert.deepEqual(h.recoveries, ["C"]);
  assert.equal(h.views.at(-1).notice.id, "C");
  assert.equal(h.views.at(-1).notice.canPrint, true);
  assert.deepEqual(h.prints, []);
});

test("a rejected recovered print keeps a diagnostic and does not display a success message", async () => {
  const h = harness({ notice: { id: "C", canPrint: true, text: "C ready" }, printError: true });
  await h.tick();
  await h.views.at(-1).onPrint();
  assert.deepEqual(h.prints, ["C"]);
  assert.equal(h.views.at(-1).notice.id, "C");
  assert.equal(h.views.at(-1).notice.canPrint, false);
  assert.match(h.status.textContent, /DS-RX1/);
  assert.doesNotMatch(h.status.textContent, /已提交/);
});

test("the main operation lock owns a recovered print through its awaited result", async () => {
  let release;
  const h = harness({ notice: { id: "C", canPrint: true, text: "C ready" }, printWait: new Promise(resolve => { release = resolve; }) });
  await h.tick();
  const onPrint = h.views.at(-1).onPrint, first = onPrint();
  await onPrint();
  await h.tick();
  assert.deepEqual(h.prints, ["C"]);
  release(); await first;
  assert.equal(h.views.at(-1).notice, null);
  assert.match(h.status.textContent, /已提交/);
});
