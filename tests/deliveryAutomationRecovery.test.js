"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const id = n => n.toString(16).padStart(32, "0");
const template = { id: "one-inch", name: "One inch", widthPx: 600, heightPx: 800,
  infoBar: { x: 0, y: 100, width: 1653, height: 555, avatar: { x: 20, y: 120 }, texts: [{ x: 100, y: 140 }] } };
function harness(options = {}) {
  const files = new Map(), tokens = new Map(), memory = new Map(), closed = [], renders = [], prints = [], opened = [], saves = [], exports = [];
  let clock = Date.UTC(2026, 9, 7, 4, 0), sequence = 0, serial = 10000, active = null, modalDepth = 0, window;
  class Entry {
    constructor(name, parent, folder = true) {
      this.name = name; this.parent = parent; this.isFolder = folder;
      this.nativePath = parent ? parent.nativePath + "/" + name : name; this.children = new Map();
    }
    async createFolder(name) {
      if (this.children.has(name)) throw Error("Folder exists");
      const entry = new Entry(name, this); this.children.set(name, entry); return entry;
    }
    async getEntries() { return [...this.children.values()]; }
    async createFile(name, settings = {}) {
      if (this.children.has(name) && !settings.overwrite) throw Error("File exists");
      const entry = new Entry(name, this, false); this.children.set(name, entry); return entry;
    }
    async getEntry(name) {
      if (name === "connection-response.json" || name === "code-response.json") assert.equal(modalDepth, 0);
      if (name === "connection-response.json" && options.connection !== false) {
        const request = JSON.parse(await (await this.getEntry("connection-request.json")).read());
        return { read: async () => JSON.stringify({ version: 1, requestId: request.requestId,
          protocol: request.protocol, sourceRoot: this.nativePath, consumerId: "consumer-A", sourceIdentity: "source-directory-A",
          state: "running", ready: true, automationProtocol: "pickup-automation-1" }) };
      }
      if (name === "code-response.json" && options.receipt !== false) {
        const confirmation = JSON.parse(await (await this.getEntry("code-request.json")).read());
        const payload = await (await this.getEntry("request.json")).read();
        const request = JSON.parse(payload);
        return { read: async () => JSON.stringify({ version: 2, requestId: confirmation.requestId,
          confirmed: true, contextKey: "c".repeat(64), status: "preparing", accepted: true,
          taskId: request.taskId, manifestFingerprint: window.IDPhotoDeliveryProtocol.sha256(payload),
          deliveryId: request.targetDeliveryId || "remote-" + request.taskId, code: "A7K3P9" }) };
      }
      if (!this.children.has(name)) throw Error("Missing " + name);
      return this.children.get(name);
    }
    async write(value) {
      if (options.failNoticeWrite && this.name.startsWith("automatic-recovery.json.")) throw Error("notice disk unavailable");
      this.value = value; files.set(this.nativePath, value);
    }
    async read() { return this.value; }
    async moveTo(folder, settings) {
      if (folder.children.has(settings.newName) && !settings.overwrite) throw Error("Destination exists");
      files.delete(this.nativePath); this.parent.children.delete(this.name);
      this.name = settings.newName; this.parent = folder; this.nativePath = folder.nativePath + "/" + this.name;
      folder.children.set(this.name, this); files.set(this.nativePath, this.value);
    }
    async delete() { this.parent.children.delete(this.name); files.delete(this.nativePath); }
  }
  const dataRoot = new Entry("local");
  function bytes(n) { return new Uint8Array([255, 216, 3, 4, n, 6, 255, 217]).buffer; }
  function doc(width, height, content = bytes(9)) {
    const document = { id: ++sequence, width, height, content, name: "owned-" + sequence,
      activate: async () => { active = document; },
      saveAs: { jpg: async file => { saves.push(file.nativePath); await file.write(new Uint8Array([...new Uint8Array(content), width >> 8, width & 255, height >> 8, height & 255]).buffer); } },
      crop: async () => {}, duplicate: async () => doc(width, height, content) };
    return document;
  }
  const app = { documents: [], open: async file => {
    const content = await file.read(); opened.push({ path: file.nativePath, bytes: new Uint8Array(content).slice() });
    const raw = new Uint8Array(content), n = raw.length;
    const document = doc(raw[n-4]*256+raw[n-3], raw[n-2]*256+raw[n-1], content); app.documents.push(document); active = document; return document;
  } };
  app.documents.add = async settings => { const document = doc(settings.width, settings.height); document.name = settings.name; app.documents.push(document); return document; };
  function source(n = 1) {
    const document = doc(3000, 4000, bytes(n)); app.documents.push(document); active = document;
    return { document, info: { id: document.id, name: "same-original.jpg", widthPx: 3000, heightPx: 4000,
      sourceMetadata: { serialNumber: "SHOP-0589", captureDate: "2026:10:07 12:34:56", captureSubsecond: String(n), originalDocumentId: id(n) },
      sourceVariant: { backgroundColor: "white" } } };
  }
  const filesystem = { getDataFolder: async () => dataRoot,
    createPersistentToken: async entry => { tokens.set(entry.nativePath, entry); return entry.nativePath; },
    getEntryForPersistentToken: async token => {
      if (!tokens.has(token)) throw Error("Original token unavailable"); return tokens.get(token);
    } };
  window = { localStorage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) },
    IDPhotoSettingsProfile: { load: () => ({ cameras: [{ serialNumber: "SHOP-0589" }] }) },
    IDPhotoSettingsStore: { load: () => ({}) },
    IDPhotoDateService: { formatDisplayDate: () => "2026.10.7" },
    IDPhotoPathService: { getDateFolders: () => ({ year: "2026", month: "2026-10", day: "2026-10-07" }) },
    IDPhotoVariantService: { analyzeDocument: async () => ({ backgroundColor: "white" }) },
    IDPhotoTemplates: { getTemplateById: () => template, getTemplateByName: () => template },
    IDPhotoPhotoshopExecution: {
      executeAsModal: async callback => { modalDepth++; try { return await callback(); } finally { modalDepth--; } },
      activateDocument: async document => { active = document; }, getPhotoshop: () => ({ app }),
      resolveCreatedDocument: (existing, settings) => {
        const created = app.documents.filter(document => !existing.includes(document.id));
        assert.equal(created.length, 1); assert.equal(created[0].name, settings.name); return created[0];
      }
    },
    IDPhotoDocumentService: { getActiveDocument: () => active, closeWithoutSaving: async document => {
      closed.push(document.id); const index = app.documents.indexOf(document); if (index >= 0) app.documents.splice(index, 1);
    } },
    IDPhotoCropService: { prepareSinglePhoto: async (document, documentInfo, shape, ratio, settings) => ({
      document: doc(settings.preservePixels ? document.width : shape.widthPx, settings.preservePixels ? document.height : shape.heightPx, document.content),
      highResolutionDocument: settings.keepHighResolution ? doc(document.width, document.height, document.content) : null
    }) },
    IDPhotoRatioChecker: { checkDocumentRatio: () => ({ canCheck: true, ok: true, errorPercent: 0 }) },
    IDPhotoCanvasService: { createSixInchCanvas: async () => ({ document: doc(3600, 2400) }) },
    IDPhotoLayoutEngine: { createLayoutPlan: () => ({ positions: [{ x: 0, y: 0 }], infoBar: template.infoBar }) },
    IDPhotoLayerService: { placePhotoCopies: async () => ({ placedCount: 1 }) },
    IDPhotoInfoBarRenderer: { renderInfoBar: async (document, bar, settings, values) => {
      renders.push({ documentId: document.id, code: values.pickupCode }); return { ok: true, createdCount: 1 };
    } },
    IDPhotoExportService: { exportSingleJpg: async (document, settings) => { exports.push(settings); return { ok: true }; } },
    IDPhotoPrintService: { printOneCopy: async document => { prints.push(document.id); return { ok: true, printed: true }; } }
  };
  class Clock extends Date { constructor(...values) { super(...(values.length ? values : [clock])); } static now() { return clock; } }
  const context = vm.createContext({ window, console, Date: Clock,
    setTimeout: callback => { clock += 1000; if (options.onSleep) options.onSleep(window.IDPhotoDeliveryService); callback(); },
    require: name => { assert.equal(name, "uxp"); return { storage: { localFileSystem: filesystem, formats: { binary: "binary", utf8: "utf8" } } }; } });
  const run = name => vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", name + ".js"), "utf8"), context);
  for (const name of ["core/sourceEligibilityService", "core/deliveryIdentity", "core/deliveryProtocol", "core/deliveryAutomationStore", "core/deliverySpecifications", "core/layoutWorkflow"]) run(name);
  window.IDPhotoDeliveryProtocol.id = () => id(++serial);
  const reload = () => { run("photoshop/deliveryAutomationService"); run("photoshop/deliveryService"); };
  reload();
  async function json(folder, name) { return JSON.parse(await (await folder.getEntry(name)).read()); }
  return { options, memory, files, tokens, renders, prints, opened, saves, exports, closed, source, reload, json, window,
    get service() { return window.IDPhotoDeliveryService; }, get automation() { return window.IDPhotoDeliveryAutomationService; },
    printOptions: { templateNames: [template.name], exportJpg: true, nasArchive: true, quickPrint: true,
      skipPrint: false, closeAfterPrint: false, rowGap: 10, colGap: 10, delivery: true },
    runPrint: async original => window.IDPhotoLayoutWorkflow.create().run({ templateNames: [template.name], exportJpg: true,
      nasArchive: true, quickPrint: true, rowGap: 10, colGap: 10, delivery: true,
      sourceDocument: original.document, docInfo: original.info }) };
}

test("offline electronic work saves immutable context and photo before handshake; reconnect resumes the same task and bytes", async () => {
  const h = harness({ connection: false }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /交接|连通/);
  const task = h.service.latest(), record = h.automation.store().tasks()[0];
  const prepared = await h.json(task.folder, "photo-prepared.json"), context = await h.json(task.folder, "context.json");
  assert.equal(context.id, record.id); assert.equal(prepared.taskId, record.id);
  const before = new Uint8Array(await (await task.folder.getEntry("photo.jpg")).read()).slice();
  assert.equal(h.renders.length, 0); assert.equal(h.prints.length, 0);
  await assert.rejects(task.folder.getEntry("request.json"));
  h.options.connection = true; h.reload();
  assert.equal(await h.service.primeRecovery(), record.id);
  const notice = await h.service.recoverNext(record.id);
  assert.equal(notice.id, record.id); assert.equal(notice.canPrint, false);
  assert.equal(h.automation.store().tasks().length, 1);
  assert.deepEqual(new Uint8Array(await (await task.folder.getEntry("photo.jpg")).read()), before);
  assert.deepEqual(h.opened[0].bytes, before);
  assert.equal(h.saves.filter(value => value.endsWith("/photo.jpg")).length, 1);
  assert.equal(h.renders.length, 1); assert.equal(h.prints.length, 0);
  assert.equal(h.closed.includes(original.document.id), false);
  assert.equal(await h.service.primeRecovery(), null);
});

test("unfinished offline work does not block another reliable original or replace its saved pixels", async () => {
  const h = harness({ connection: false }), first = h.source(1), second = h.source(2);
  await assert.rejects(h.service.electronic(first.document, first.info, {}));
  const firstTask = h.service.latest();
  await assert.rejects(h.service.electronic(second.document, second.info, {}));
  const secondTask = h.service.latest();
  assert.notEqual(firstTask.id, secondTask.id);
  assert.equal(h.automation.store().pendingTasks().length, 2);
  assert.notDeepEqual(new Uint8Array(await (await firstTask.folder.getEntry("photo.jpg")).read()),
    new Uint8Array(await (await secondTask.folder.getEntry("photo.jpg")).read()));
  h.options.connection = true; h.reload();
  const recovered = [];
  for (let n = 0; n < 2; n++) { const id = await h.service.primeRecovery(); recovered.push((await h.service.recoverNext(id)).id); }
  assert.deepEqual(new Set(recovered), new Set([firstTask.id, secondTask.id]));
  assert.equal(h.prints.length, 0);
});

test("operator stopping a code wait persists across reload and excludes the task from automatic output", async () => {
  const h = harness({ receipt: false, onSleep: service => service.stopWaiting() }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /停止/);
  const task = h.service.latest();
  assert.equal(h.automation.store().tasks()[0].state, "stopped");
  h.options.onSleep = null; h.options.receipt = true; h.reload();
  assert.equal(await h.service.primeRecovery(), null);
  assert.equal(await h.service.recoverNext(task.id), null);
  assert.equal(h.renders.length, 0); assert.equal(h.prints.length, 0);
  await assert.rejects(task.folder.getEntry("complete.json"));
});

test("automatic code polling keeps one nonce within its window and defers Photoshop work until confirmed", async () => {
  const h = harness({ receipt: false }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /超时/);
  const task = h.service.latest(), payload = await (await task.folder.getEntry("request.json")).read();
  h.reload();
  assert.equal(await h.service.primeRecovery(), null);
  const attempt = await h.json(task.folder, "code-request.json");
  assert.equal(await h.service.primeRecovery(), null);
  assert.equal((await h.json(task.folder, "code-request.json")).requestId, attempt.requestId);
  assert.equal(h.opened.length, 0); assert.equal(h.renders.length, 0);
  h.options.receipt = true;
  assert.equal(await h.service.primeRecovery(), task.id);
  assert.equal(h.opened.length, 0);
  assert.equal((await h.service.recoverNext(task.id)).id, task.id);
  assert.equal(await (await task.folder.getEntry("request.json")).read(), payload);
  assert.equal(h.automation.store().tasks().length, 1);
  assert.equal(h.prints.length, 0);
});

test("an output-started marker protects an interrupted task from repeated rendering or printing", async () => {
  const h = harness({ receipt: false }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /超时/);
  const task = h.service.latest();
  await (await task.folder.createFile("output-started.json", { overwrite: false })).write("{}");
  h.options.receipt = true; h.reload();
  const result = await h.service.primeRecovery();
  assert.equal(result.id, task.id); assert.match(result.text, /输出痕迹/);
  assert.equal(h.automation.store().tasks()[0].state, "blocked");
  assert.equal(await h.service.recoverNext(task.id), null);
  assert.equal(h.renders.length, 0); assert.equal(h.prints.length, 0);
});

test("a persisted complete signal reconciles a stale pending index after reload without outputting again", async () => {
  const h = harness(), original = h.source();
  const task = await h.service.electronic(original.document, original.info, {});
  const key = "idphoto-delivery-automation-v1", stale = JSON.parse(h.memory.get(key));
  stale.tasks[0].state = "pending"; stale.tasks[0].completedAt = 0; h.memory.set(key, JSON.stringify(stale));
  h.reload();
  assert.equal(await h.service.primeRecovery(), null);
  assert.equal(h.automation.store().tasks()[0].state, "completed");
  assert.equal(h.automation.store().tasks()[0].code, "A7K3P9");
  assert.equal(h.renders.length, 1); assert.equal(h.prints.length, 0);
  assert.equal((await h.json(task.folder, "complete.json")).processingComplete, true);
});

async function recoveredPrint(h, ordinal = 1) {
  const original = h.source(ordinal);
  const initial = await h.runPrint(original);
  assert.equal(initial.ok, false); assert.equal(h.prints.length, 0);
  const task = h.service.latest(); h.options.connection = true; h.reload();
  assert.equal(await h.service.primeRecovery(), task.id);
  const notice = await h.service.recoverNext(task.id);
  assert.equal(notice.canPrint, true, JSON.stringify(notice)); assert.equal(h.prints.length, 0);
  assert.equal(h.exports[0].archiveIndexExecutor, undefined);
  assert.equal(h.service.latest().retryResult.successResults[0].result.printResult.skipped, true);
  assert.equal(h.service.latest().retryResult.printedResults.length, 0);
  return { task, original, notice };
}

test("recovered printing persists a notification and prints once only after an explicit click", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  const saved = await h.json(task.folder, "automatic-recovery.json");
  assert.equal(saved.printAvailable, true); assert.equal(h.renders.length, 1);
  h.reload();
  const notice = await h.service.recoveredNotice();
  assert.equal(notice.id, task.id); assert.equal(notice.canPrint, true); assert.equal(h.prints.length, 0);
  const printed = await h.service.printRecovered(task.id);
  assert.equal(printed.id, task.id); assert.equal(h.prints.length, 1);
  assert.equal((await h.json(task.folder, "automatic-recovery.json")).printAvailable, false);
  await assert.rejects(h.service.printRecovered(task.id), /避免重复|已开始/);
  h.reload(); assert.equal(await h.service.recoveredNotice(), null);
  assert.equal(h.prints.length, 1);
});

test("simultaneous explicit recovery-print clicks have one durable output owner", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  const outcomes = await Promise.allSettled([h.service.printRecovered(task.id), h.service.printRecovered(task.id)]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(h.prints.length, 1);
});

test("tampered recovery notification fingerprints cannot expose a print action", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  const value = await h.json(task.folder, "automatic-recovery.json"); value.manifestFingerprint = "f".repeat(64);
  await (await task.folder.getEntry("automatic-recovery.json")).write(JSON.stringify(value));
  h.reload();
  const diagnostic = await h.service.recoveredNotice();
  assert.equal(diagnostic.canPrint, false); assert.match(diagnostic.text, /不匹配|变化|绑定/);
  await assert.rejects(h.service.printRecovered(task.id), /不匹配|变化|绑定/);
  assert.equal(h.prints.length, 0);
});

test("delayed storage reads cannot let a second print begin after the first operation releases its owner", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalGet = task.folder.getEntry.bind(task.folder); let noticeReads = 0;
  task.folder.getEntry = async name => {
    const file = await originalGet(name);
    if (name === "automatic-recovery.json") return { read: async options => {
      const value = await file.read(options);
      if (++noticeReads === 2) await gate;
      return value;
    } };
    return file;
  };
  const first = h.service.printRecovered(task.id);
  const second = h.service.printRecovered(task.id).then(value => ({ value }), error => ({ error }));
  assert.equal((await first).id, task.id);
  release();
  assert.match((await second).error.message, /处理中|重复/);
  assert.equal(h.prints.length, 1);
});

test("a workflow printer failure rejects success and persists an unconfirmed state without automatic retries", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  let attempts = 0;
  h.window.IDPhotoPrintService.printOneCopy = async () => { attempts++; return { ok: false, printed: false, message: "DS-RX1 unavailable" }; };
  await assert.rejects(h.service.printRecovered(task.id), /DS-RX1 unavailable/);
  assert.equal(attempts, 1);
  const value = await h.json(task.folder, "automatic-recovery.json");
  assert.equal(value.printAvailable, false); assert.equal(value.printState, "unconfirmed");
  assert.match(value.printError, /DS-RX1 unavailable/);
  h.reload();
  const diagnostic = await h.service.recoveredNotice();
  assert.equal(diagnostic.canPrint, false); assert.match(diagnostic.text, /DS-RX1 unavailable/);
  await assert.rejects(h.service.printRecovered(task.id), /避免重复|已开始/);
  assert.equal(await h.service.primeRecovery(), null); assert.equal(attempts, 1);
});

test("a skipped printer result is not reported as a submitted print", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  h.window.IDPhotoPrintService.printOneCopy = async () => ({ ok: true, skipped: true, printed: false, message: "Skipped" });
  await assert.rejects(h.service.printRecovered(task.id), /未确认提交/);
  assert.equal((await h.json(task.folder, "automatic-recovery.json")).printAvailable, false);
  assert.equal((await h.service.recoveredNotice()).canPrint, false);
});

test("a bad old notice token does not hide another customer's valid recovered print notice", async () => {
  const h = harness({ connection: false }), first = await recoveredPrint(h);
  h.options.connection = false;
  const second = await recoveredPrint(h, 2);
  const old = h.automation.store().tasks().find(record => record.id === first.task.id);
  h.tokens.delete(old.token); h.reload();
  const notice = await h.service.recoveredNotice();
  assert.equal(notice.id, second.task.id); assert.equal(notice.canPrint, true);
  const retained = h.automation.store().tasks().find(record => record.id === first.task.id);
  assert.equal(retained.state, "completed"); assert.match(retained.error, /printNoticeBlocked/);
  assert.equal(h.prints.length, 0);
});

test("a corrupt old notice is isolated while later valid notices remain actionable", async () => {
  const h = harness({ connection: false }), first = await recoveredPrint(h);
  h.options.connection = false;
  const second = await recoveredPrint(h, 2);
  await (await first.task.folder.getEntry("automatic-recovery.json")).write("{broken");
  const notice = await h.service.recoveredNotice();
  assert.equal(notice.id, second.task.id); assert.equal(notice.canPrint, true);
  assert.equal(h.automation.store().tasks().find(record => record.id === first.task.id).state, "completed");
  assert.equal(h.prints.length, 0);
});

test("every damaged notice retains a diagnostic before the next valid customer is offered", async () => {
  const h = harness({ connection: false }), first = await recoveredPrint(h);
  h.options.connection = false;
  const second = await recoveredPrint(h, 2);
  h.options.connection = false;
  const third = await recoveredPrint(h, 3);
  await (await first.task.folder.getEntry("automatic-recovery.json")).write("{broken");
  const old = h.automation.store().tasks().find(record => record.id === second.task.id);
  h.tokens.delete(old.token); h.reload();
  const notice = await h.service.recoveredNotice();
  assert.equal(notice.id, third.task.id); assert.equal(notice.canPrint, true);
  for (const id of [first.task.id, second.task.id]) {
    const retained = h.automation.store().tasks().find(record => record.id === id);
    assert.equal(retained.state, "completed"); assert.match(retained.error, /printNoticeBlocked/);
  }
  assert.equal(h.prints.length, 0);
});

test("an unavailable old task directory is retained and isolated so another pending original can recover", async () => {
  const h = harness({ connection: false }), first = h.source(1), second = h.source(2);
  await assert.rejects(h.service.electronic(first.document, first.info, {}));
  const old = h.service.latest();
  await assert.rejects(h.service.electronic(second.document, second.info, {}));
  const next = h.service.latest();
  const original = h.automation.store().tasks().find(task => task.id === old.id);
  h.tokens.delete(original.token);
  h.options.connection = true; h.reload();
  const diagnostic = await h.service.primeRecovery();
  assert.equal(diagnostic.id, old.id); assert.equal(diagnostic.canPrint, false);
  assert.equal(h.automation.store().tasks().find(task => task.id === old.id).state, "blocked");
  assert.equal(await h.service.primeRecovery(), next.id);
  assert.equal((await h.service.recoverNext(next.id)).id, next.id);
  assert.equal(h.automation.store().tasks().length, 2);
  assert.equal(h.prints.length, 0);
});

test("an interrupted recovered print remains visible as unconfirmed and cannot be resubmitted", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  const value = await h.json(task.folder, "automatic-recovery.json");
  Object.assign(value, { printAvailable: false, printStarted: new Date().toISOString(), printState: "started" });
  await (await task.folder.getEntry("automatic-recovery.json")).write(JSON.stringify(value));
  h.reload();
  const notice = await h.service.recoveredNotice();
  assert.equal(notice.id, task.id); assert.equal(notice.canPrint, false);
  assert.match(notice.text, /未确认|人工核对/);
  assert.match(h.automation.store().tasks()[0].error, /printNoticeBlocked/);
  await assert.rejects(h.service.printRecovered(task.id), /重复|已开始/);
  value.printAvailable = true;
  await (await task.folder.getEntry("automatic-recovery.json")).write(JSON.stringify(value));
  await assert.rejects(h.service.printRecovered(task.id), /重复|已开始/);
  assert.equal(h.prints.length, 0);
});

function rejectReceipt(h, task, payload) {
  return JSON.stringify({ version: 2, taskId: task.id, manifestFingerprint: h.window.IDPhotoDeliveryProtocol.sha256(payload),
    accepted: false, confirmed: false, status: "rejected", deliveryId: "", code: "", completed: false,
    error: "历史补交须明确确认本次照片和未有交付，不能沿用其他照片的确认。" });
}

test("a manifest the delivery manager rejected is parked and never asked for a code again", async () => {
  const h = harness({ receipt: false }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /超时/);
  const task = h.service.latest(), payload = await (await task.folder.getEntry("request.json")).read();
  await (await task.folder.createFile("receipt.json", { overwrite: true })).write(rejectReceipt(h, task, payload));
  h.reload();
  const before = (await h.json(task.folder, "code-request.json")).requestId;
  assert.equal(await h.service.primeRecovery(), null);
  assert.equal((await h.json(task.folder, "code-request.json")).requestId, before, "no new request for a rejected manifest");
  const record = h.automation.store().tasks().find(item => item.id === task.id);
  assert.equal(record.state, "blocked"); assert.match(record.error, /拒收/);
  h.options.receipt = true;
  assert.equal(await h.service.primeRecovery(), null, "a parked task is not picked up again");
  assert.equal(h.opened.length, 0); assert.equal(h.renders.length, 0); assert.equal(h.prints.length, 0);
});

test("a rejection written while waiting ends the wait at once with the real reason", async () => {
  let sleeps = 0;
  const h = harness({ receipt: false, onSleep: service => {
    sleeps++;
    const task = service.latest && service.latest();
    if (!task || !task.folder || !task.folder.children.has("request.json") || task.folder.children.has("receipt.json")) return;
    task.folder.createFile("receipt.json");
    task.folder.children.get("receipt.json").value = rejectReceipt(h, task, task.folder.children.get("request.json").value);
  } }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}),
    error => /交付管理拒收了这单/.test(error.message) && error.retryable === false);
  assert.ok(sleeps < 10, "did not wait out the 60-second window: " + sleeps);
  const record = h.automation.store().tasks().find(item => item.id === h.service.latest().id);
  assert.equal(record.state, "blocked");
});

test("a failed recovery print reports the real cause instead of a completed-task refusal", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  h.options.receipt = false; h.reload();
  await assert.rejects(h.service.printRecovered(task.id), error => /超时/.test(error.message) && !/cannot restart/.test(error.message));
  assert.equal(h.automation.store().tasks().find(item => item.id === task.id).state, "completed");
  assert.equal(h.prints.length, 0);
  const notice = await h.service.recoveredNotice();
  assert.equal(notice.canPrint, false); assert.match(notice.text, /^没打印：/);
});
