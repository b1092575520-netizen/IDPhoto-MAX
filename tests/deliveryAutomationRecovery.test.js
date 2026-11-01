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
  const remote = new Map(), events = [];
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
      if (name === "code-response.json" && options.ended) {
        // What the delivery manager answered for 17eb3b7d (10-28): accepted, not confirmed, order cancelled.
        const confirmation = JSON.parse(await (await this.getEntry("code-request.json")).read());
        const payload = await (await this.getEntry("request.json")).read();
        return { read: async () => JSON.stringify({ version: 2, requestId: confirmation.requestId, accepted: true, confirmed: false,
          status: options.ended, contextKey: "", taskId: JSON.parse(payload).taskId, manifestFingerprint: window.IDPhotoDeliveryProtocol.sha256(payload),
          deliveryId: "", code: "", errorCode: "STATE_UNCONFIRMED", error: "本次取件码待核对；本次交付状态尚未完成取件码核对。" }) };
      }
      if (name === "code-response.json" && options.receipt !== false) {
        const confirmation = JSON.parse(await (await this.getEntry("code-request.json")).read());
        const payload = await (await this.getEntry("request.json")).read();
        const request = JSON.parse(payload);
        if (options.automaticRemote && !remote.has(request.taskId)) remote.set(request.taskId, {
          taskId: request.taskId, known: true, blocked: false, originalCodeActive: true, status: "preparing",
          code: options.nextCode || "A7K3P9", deliveryId: request.targetDeliveryId || "remote-" + request.taskId,
          contextKey: "c".repeat(64), groupVersion: 1, originalMemberId: "member-A",
          taskFiles: [{ id: "file-" + request.taskId, filename: request.files[0].filename || "photo.jpg" }]
        });
        const summary = remote.get(request.taskId);
        return { read: async () => JSON.stringify({ version: 2, requestId: confirmation.requestId,
          confirmed: true, contextKey: "c".repeat(64), status: "preparing", accepted: true,
          taskId: request.taskId, manifestFingerprint: window.IDPhotoDeliveryProtocol.sha256(payload),
          deliveryId: request.targetDeliveryId || "remote-" + request.taskId, code: summary ? summary.code : "A7K3P9",
          entryLinkCode: summary ? summary.code : "A7K3P9", entryLink: "https://mp.weixin.qq.com/a/~testCustomer~~" }) };
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
      if (options.automaticRemote && this.name === "complete.json" && remote.has(folder.name)) {
        const request = JSON.parse(await (await folder.getEntry("request.json")).read());
        if (request.targetDeliveryId && !options.holdPublish) remote.get(folder.name).status = "ready";
      }
      if (options.automaticRemote && folder.name === "automation-requests") {
        const request = JSON.parse(this.value), responseFolder = await childForTest(folder.parent, "automation-responses");
        events.push({ at: clock, action: "query", ids: request.taskIds });
        const items = request.taskIds.map(taskId => remote.get(taskId) || { taskId, known: false, blocked: false });
        await (await responseFolder.createFile(this.name, { overwrite: true })).write(JSON.stringify({
          version: 1, protocol: request.protocol, operationId: request.operationId, requestId: request.requestId,
          sourceIdentity: request.sourceIdentity, consumerId: request.consumerId,
          fingerprint: window.IDPhotoDeliveryProtocol.sha256(this.value), ok: true, data: { items }
        }));
      }
    }
    async delete() { this.parent.children.delete(this.name); files.delete(this.nativePath); }
  }
  const dataRoot = new Entry("local");
  async function childForTest(folder, name) { try { return await folder.getEntry(name); } catch (_) { return folder.createFolder(name); } }
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
      renders.push({ documentId: document.id, code: values.pickupCode, entryLink: values.entryLink }); return { ok: true, createdCount: 1 };
    } },
    IDPhotoExportService: { exportSingleJpg: async (document, settings) => { exports.push(settings); return { ok: true }; } },
    IDPhotoPrintService: { lastDeniedAt: () => options.deniedAt || 0, printOneCopy: async document => {
      prints.push(document.id); events.push({ at: clock, action: "permission", cancelled: Boolean(options.cancelPrint) });
      return options.cancelPrint ? { ok: false, cancelled: true } : { ok: true, printed: true };
    } }
  };
  class Clock extends Date { constructor(...values) { super(...(values.length ? values : [clock])); } static now() { return clock; } }
  const context = vm.createContext({ window, console, Date: Clock,
    setTimeout: callback => { clock += 1000; if (options.onSleep) options.onSleep(window.IDPhotoDeliveryService); callback(); },
    require: name => { assert.equal(name, "uxp"); return { storage: { localFileSystem: filesystem, formats: { binary: "binary", utf8: "utf8" } },
      shell: { openPath: async jobPath => {
        assert.ok(options.automaticRemote, "only the isolated bridge double can launch");
        const jobs = await dataRoot.getEntry("print-jobs"), file = await jobs.getEntry(jobPath.split("/").pop());
        const job = JSON.parse(await file.read());
        prints.push(job.jobId); events.push({ at: clock, action: "permission", jobId: job.jobId, cancelled: Boolean(options.cancelPrint) });
        if (options.cancelPrint) throw Error("Permission denied");
        const response = await jobs.createFile(file.name.replace(/\.idprint$/, ".result.json"), { overwrite: true });
        await response.write(JSON.stringify({ schemaVersion: 1, jobId: job.jobId, ok: true, printed: true,
          printerName: "DS-RX1", paperName: "(6x4)", copies: 1 }));
        return "";
      } }
    }; } });
  const run = name => vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", name + ".js"), "utf8"), context);
  for (const name of ["core/sourceEligibilityService", "core/deliveryIdentity", "core/deliveryProtocol", "core/deliveryAutomationStore", "core/deliverySpecifications", "core/layoutWorkflow"]) run(name);
  window.IDPhotoDeliveryProtocol.id = () => id(++serial);
  const reload = () => { run("photoshop/deliveryAutomationService"); run("photoshop/deliveryService"); };
  reload();
  if (options.automaticRemote) run("photoshop/printService");
  async function json(folder, name) { return JSON.parse(await (await folder.getEntry(name)).read()); }
  return { options, memory, files, tokens, renders, prints, opened, saves, exports, closed, source, reload, json, window, remote, events,
    advance: amount => { clock += amount; }, now: () => clock,
    get service() { return window.IDPhotoDeliveryService; }, get automation() { return window.IDPhotoDeliveryAutomationService; },
    printOptions: { templateNames: [template.name], exportJpg: true, nasArchive: true, quickPrint: true,
      skipPrint: false, closeAfterPrint: false, rowGap: 10, colGap: 10, delivery: true },
    runPrint: async (original, extra = {}) => window.IDPhotoLayoutWorkflow.create().run({ templateNames: [template.name], exportJpg: true,
      nasArchive: true, quickPrint: true, rowGap: 10, colGap: 10, delivery: true,
      sourceDocument: original.document, docInfo: original.info, ...extra }) };
}

async function earlyScenario(options = {}, extra = {}) {
  const h = harness({ automaticRemote: true, ...options }), original = h.source();
  original.info.sourceVariant.backgroundColor = "red";
  assert.equal((await h.runPrint(original)).ok, true);
  const red = h.service.latest();
  original.info.sourceVariant.backgroundColor = "white";
  const clickedAt = h.now(), result = await h.runPrint(original, extra), white = h.service.latest();
  return { h, original, red, white, result, clickedAt };
}
function ready(h, red) { h.remote.get(red.id).status = "ready"; }
async function finishEarly(h, task) {
  const before = { opens: h.opened.length, renders: h.renders.length, saves: h.saves.length, exports: h.exports.length, permissions: h.prints.length };
  const started = h.now();
  assert.equal(await h.service.primeRecovery(), task.id);
  assert.equal(await h.service.recoverNext(task.id), null);
  assert.deepEqual({ opens: h.opened.length, renders: h.renders.length, saves: h.saves.length, exports: h.exports.length, permissions: h.prints.length }, before,
    "file-only recovery never opens, renders, saves through Photoshop, archives or launches the print bridge");
  assert.equal((await h.json(task.folder, "complete.json")).processingComplete, true);
  assert.equal(h.automation.store().tasks().find(x => x.id === task.id).state, "completed");
  console.log("[0.6.30 evidence]", JSON.stringify({ scenario: h.options.evidenceCase || "edge", task: task.id, uploadStartedAt: started, completedAt: h.now(),
    uploadElapsedMs: h.now() - started, clock: "simulated", permissions: h.events.filter(x => x.action === "permission") }));
}

// REP-01: production HandoffAutomation returns TASK_PENDING after receive but
// before createBatch. An exposed manifest can also still be entirely unknown.
async function receivingWhite(kind) {
  const scenario = await earlyScenario();
  const { h, red, white } = scenario;
  ready(h, red);
  // The real manager leaves the parent's nonce-bound receipt on disk while
  // this child's code lookup is slow; preserve that independently in the double.
  const receipt = await (await red.folder.getEntry("code-response.json")).read();
  await (await red.folder.createFile("code-response.json")).write(receipt);
  h.options.receipt = false;
  assert.equal(await h.service.primeRecovery(), null);
  await white.folder.getEntry("request.json");
  if (kind === "TASK_PENDING") h.remote.set(white.id, { taskId: white.id, known: true, blocked: true, retryable: true,
    errorCode: "TASK_PENDING", error: "原任务尚在取码，恢复连接后继续原任务。", status: "", code: "", deliveryId: "", contextKey: red.contextKey });
  else assert.equal(h.remote.has(white.id), false);
  return scenario;
}
function backgroundCounts(h) {
  return { opens: h.opened.length, renders: h.renders.length, saves: h.saves.length, exports: h.exports.length, permissions: h.prints.length };
}
for (const kind of ["unknown", "TASK_PENDING"]) {
  test("REP-01 R-01/R-06/R-07: same and different specifications print during " + kind, async () => {
    const { h, original, red, white } = await receivingWhite(kind);
    const payload = await (await white.folder.getEntry("request.json")).read();
    const photo = new Uint8Array(await (await white.folder.getEntry("photo.jpg")).read()).slice();
    const started = h.now();
    // Slow createBatch/code confirmation does not become a foreground wait.
    for (let n = 0; n < 3; n++) {
      h.advance(120000);
      const click = h.now(), repeat = await h.runPrint(original);
      assert.equal(repeat.ok, true, repeat.failures.map(x => x.error.message).join(";"));
      assert.ok(h.now() - click < 6000, "no code-confirmation timeout on reprint");
      assert.equal(h.service.latest().id, white.id);
    }
    original.info.sourceVariant.backgroundColor = "blue";
    const click = h.now(), result = await h.runPrint(original), blue = h.service.latest();
    assert.equal(result.ok, true, result.failures.map(x => x.error.message).join(";"));
    assert.ok(h.now() - click < 6000, "no code-confirmation wait for a new specification");
    assert.equal(h.prints.length, 6); assert.equal(h.automation.store().tasks().length, 3);
    for (const render of h.renders) {
      assert.equal(render.code, red.code); assert.equal(render.entryLink.link, h.renders[0].entryLink.link);
    }
    assert.equal(await (await white.folder.getEntry("request.json")).read(), payload);
    assert.deepEqual(new Uint8Array(await (await white.folder.getEntry("photo.jpg")).read()), photo);
    const before = backgroundCounts(h);
    // Force the later child to be picked first: even then it cannot expose a
    // concurrent append while white is unknown, taking code, or publishing.
    h.advance(1000); h.automation.store().markTask(white.id, { state: "retryable" });
    h.reload();
    assert.equal(await h.service.primeRecovery(), null);
    await assert.rejects(blue.folder.getEntry("request.json"));
    h.remote.delete(white.id); h.options.receipt = true; h.options.holdPublish = true;
    await finishEarly(h, white);
    assert.equal(h.remote.get(white.id).status, "preparing");
    assert.equal(await h.service.primeRecovery(), null, "local completion is not remote publication");
    await assert.rejects(blue.folder.getEntry("request.json"));
    Object.assign(h.remote.get(white.id), { blocked: true, errorCode: "TASK_PENDING", pendingBatch: "owned-upload" });
    assert.equal(await h.service.primeRecovery(), null, "production owned pending batch waits without a failure notice");
    await assert.rejects(blue.folder.getEntry("request.json"));
    Object.assign(h.remote.get(white.id), { blocked: false, errorCode: "", pendingBatch: null });
    ready(h, white); h.options.holdPublish = false;
    await finishEarly(h, blue);
    assert.deepEqual(backgroundCounts(h), before);
    const requests = await Promise.all([red, white, blue].map(t => h.json(t.folder, "request.json")));
    assert.equal(requests[1].targetDeliveryId, red.deliveryId);
    assert.equal(requests[2].targetDeliveryId, red.deliveryId);
    assert.deepEqual(requests.map(r => r.files[0].background), ["red", "white", "blue"]);
    assert.equal(new Set(requests.map(r => r.taskId)).size, 3);
    console.log("[REP-01 slow code]", JSON.stringify({ kind, started, completed: h.now(), permissions: h.events.filter(e => e.action === "permission"), before, after: backgroundCounts(h) }));
  });
}

test("REP-01 red-white-blue consecutive clicks queue exactly one of each, R-01/R-08", async () => {
  const { h, red, white, original } = await receivingWhite("unknown");
  original.info.sourceVariant.backgroundColor = "blue";
  const result = await h.runPrint(original), blue = h.service.latest();
  assert.equal(result.ok, true, result.failures.map(x => x.error.message).join(";"));
  assert.equal(h.prints.length, 3);
  const before = backgroundCounts(h);
  h.options.receipt = true; h.reload(); await finishEarly(h, white); await finishEarly(h, blue);
  assert.equal(await h.service.primeRecovery(), null);
  assert.deepEqual(backgroundCounts(h), before);
  assert.equal(h.remote.size, 3);
  assert.equal((await h.json(blue.folder, "request.json")).targetDeliveryId, red.deliveryId);
});

test("REP-01 R-08: failed foreground click never leaves a Photoshop recovery job", async () => {
  const { h, red, white, original } = await receivingWhite("unknown");
  original.info.sourceVariant.backgroundColor = "blue"; h.remote.delete(red.id);
  assert.equal((await h.runPrint(original)).ok, false); const blue = h.service.latest();
  const before = backgroundCounts(h);
  // The parent recovers later. No late render/archive or 'can print' offer.
  h.remote.set(red.id, { taskId: red.id, known: true, blocked: false, originalCodeActive: true, status: "ready",
    code: red.code, deliveryId: red.deliveryId, contextKey: red.contextKey, groupVersion: 1, originalMemberId: "member-A" });
  h.options.receipt = true; h.reload(); await finishEarly(h, white);
  assert.equal(await h.service.primeRecovery(), null);
  assert.deepEqual(backgroundCounts(h), before);
  assert.ok(["stopped", "blocked"].includes(h.automation.store().tasks().find(t => t.id === blue.id).state));
  await assert.rejects(blue.folder.getEntry("request.json"));
  assert.equal((await h.runPrint(original)).ok, true, "staff may explicitly click again after recovery");
});

for (const stage of ["ratio", "render"]) {
  test("REP-01 failed later click at " + stage + " retains bytes without a late Photoshop redo", async () => {
    const h = harness({ automaticRemote: true }), original = h.source();
    original.info.sourceVariant.backgroundColor = "red"; await h.runPrint(original); ready(h, h.service.latest());
    original.info.sourceVariant.backgroundColor = "blue";
    if (stage === "ratio") h.window.IDPhotoRatioChecker.checkDocumentRatio = () => { throw Error("ratio failure"); };
    else h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw Error("render failure"); };
    assert.equal((await h.runPrint(original)).ok, false); const task = h.service.latest();
    const before = backgroundCounts(h); h.reload();
    assert.equal(await h.service.primeRecovery(), null);
    assert.deepEqual(backgroundCounts(h), before);
    assert.equal(h.automation.store().tasks().find(t => t.id === task.id).state, stage === "ratio" ? "stopped" : "blocked");
    if (stage === "render") {
      await task.folder.getEntry("photo.jpg"); await task.folder.getEntry("request.json");
      assert.equal((await h.runPrint(original)).ok, false, "exposed identity cannot be bypassed with a duplicate order");
    }
  });
}

for (const fault of ["unknown", "offline", "consumer", "source", "cancelled", "withdrawn", "conflict", "code", "context", "delivery", "child-conflict"]) {
  test("REP-01 fallback rejects real invalidity: " + fault, async () => {
    const { h, red, white, original } = await receivingWhite("TASK_PENDING");
    const parent = h.remote.get(red.id);
    if (fault === "unknown") h.remote.delete(red.id);
    if (fault === "offline") h.options.connection = false;
    if (fault === "consumer" || fault === "source") {
      const binding = await h.json(white.folder, "automation-connection.json");
      binding[fault === "consumer" ? "consumerId" : "sourceIdentity"] = "other";
      await (await white.folder.getEntry("automation-connection.json")).write(JSON.stringify(binding));
    }
    if (["cancelled", "withdrawn"].includes(fault)) { parent.status = fault; parent.originalCodeActive = false; }
    if (fault === "conflict") { parent.blocked = true; parent.errorCode = "CONFLICT"; }
    if (fault === "child-conflict") h.remote.get(white.id).errorCode = "CONFLICT";
    if (fault === "code") parent.code = "N7EW8A";
    if (fault === "context") parent.contextKey = "d".repeat(64);
    if (fault === "delivery") parent.deliveryId = "another";
    assert.equal((await h.runPrint(original)).ok, false);
    original.info.sourceVariant.backgroundColor = "blue";
    assert.equal((await h.runPrint(original)).ok, false);
    assert.equal(h.prints.length, 2);
    const before = backgroundCounts(h); h.reload();
    for (let n = 0; n < 3; n++) {
      const id = await h.service.primeRecovery();
      if (typeof id === "string") await h.service.recoverNext(id);
    }
    assert.deepEqual(backgroundCounts(h), before);
  });
}

// REP-02: promoted from the independent ended-history.cjs, with both an old
// specification and a new color, code/identity assertions, and reloads.
for (const [early, ended] of [[true, "withdrawn"], [false, "withdrawn"], [true, "ready"]]) {
  for (const color of ["white", "blue"]) {
    test("REP-02 ended history: early=" + early + ", remote=" + ended + ", click=" + color, async () => {
      let h, original, red, white;
      if (early) {
        ({ h, original, red, white } = await earlyScenario());
        ready(h, red); await finishEarly(h, white);
      } else {
        h = harness({ automaticRemote: true }); original = h.source();
        original.info.sourceVariant.backgroundColor = "red";
        assert.equal((await h.runPrint(original)).ok, true); red = h.service.latest(); ready(h, red);
        original.info.sourceVariant.backgroundColor = "white";
        assert.equal((await h.runPrint(original)).ok, true); white = h.service.latest(); ready(h, white);
      }
      assert.ok(h.automation.store().tasks().every(t => t.state === "completed"));
      for (const item of h.remote.values()) Object.assign(item, {
        status: ended, blocked: ended === "withdrawn", originalCodeActive: ended !== "withdrawn", errorCode: ""
      });
      const oldSummaries = JSON.stringify([...h.remote.values()]);
      h.options.nextCode = ended === "withdrawn" ? "N7EW8A" : red.code;
      original.info.sourceVariant.backgroundColor = color;
      let newDelivery;
      for (let n = 0; n < 2; n++) {
        h.reload(); const count = h.prints.length, result = await h.runPrint(original), task = h.service.latest();
        assert.equal(result.ok, true, result.failures.map(x => x.error.message).join(";"));
        assert.equal(h.prints.length - count, 1);
        assert.equal(task.code, h.options.nextCode);
        if (n === 0) {
          const request = await h.json(task.folder, "request.json");
          if (ended === "withdrawn") {
            assert.equal(request.targetDeliveryId, undefined, "new order never revives the withdrawn code");
            assert.notEqual(task.deliveryId, red.deliveryId);
          } else assert.equal(request.targetDeliveryId, red.deliveryId, "published history uses normal append/replace");
          newDelivery = task.deliveryId;
        } else {
          if (ended === "withdrawn") {
            assert.equal(task.preparingTarget.deliveryId, newDelivery);
            ready(h, { id: task.preparingTarget.taskId }); await finishEarly(h, task);
          } else assert.equal((await h.json(task.folder, "request.json")).targetDeliveryId, newDelivery);
        }
      }
      assert.equal(JSON.stringify([h.remote.get(red.id), h.remote.get(white.id)]), oldSummaries);
      assert.equal(await h.service.primeRecovery(), null);
    });
  }
}

for (const window of ["unknown", "TASK_PENDING", "local-completed"]) {
  for (const ended of ["withdrawn", "cancelled"]) {
    test("REP-02 in-flight " + window + " still rejects ended original " + ended, async () => {
      const { h, original, red, white } = await receivingWhite(window === "TASK_PENDING" ? window : "unknown");
      if (window === "local-completed") {
        h.options.receipt = true; h.options.holdPublish = true; await finishEarly(h, white);
        assert.equal(h.remote.get(white.id).status, "preparing");
        // Local completion is not authority even if receiver state is lost.
        h.remote.delete(white.id); h.options.receipt = false;
      }
      Object.assign(h.remote.get(red.id), { status: ended, blocked: true, errorCode: "", originalCodeActive: false });
      h.reload(); original.info.sourceVariant.backgroundColor = "blue";
      const result = await h.runPrint(original);
      assert.equal(result.ok, false);
      assert.match(result.failures[0].error.message, /纸上印的取件码.*请重排/);
      assert.equal(h.prints.length, 2);
      const before = backgroundCounts(h); h.reload();
      for (let n = 0; n < 2; n++) {
        const id = await h.service.primeRecovery();
        if (typeof id === "string") await h.service.recoverNext(id);
      }
      assert.deepEqual(backgroundCounts(h), before);
    });
  }
}

test("0.6.30 #1 red then white immediately: same dedicated code, one permission, file-only upload", async () => {
  const { h, red, white, result } = await earlyScenario({ evidenceCase: "#1" });
  assert.equal(result.ok, true, result.failures.map(x => x.error.message).join(";"));
  assert.equal(h.prints.length, 2);
  assert.equal(h.renders[1].code, h.renders[0].code);
  assert.equal(h.renders[1].entryLink.link, h.renders[0].entryLink.link);
  assert.ok(h.renders[1].entryLink.link);
  assert.match(result.successResults[0].result.deliveryResult.message, /取件码 A7K3P9 · 这张电子版稍后自动补上/);
  await white.folder.getEntry("layout.jpg"); await white.folder.getEntry("info.jpg");
  await assert.rejects(white.folder.getEntry("complete.json"));
  ready(h, red); h.advance(5000);
  await finishEarly(h, white);
  assert.equal((await h.json(white.folder, "request.json")).targetDeliveryId, red.deliveryId);
  assert.equal((await h.json(white.folder, "complete.json")).artifacts.length, 2);
});

test("0.6.30 #2 denied white permission stops the order across restart", async () => {
  const h = harness({ automaticRemote: true, evidenceCase: "#2" }), original = h.source();
  original.info.sourceVariant.backgroundColor = "red"; assert.equal((await h.runPrint(original)).ok, true);
  const red = h.service.latest(); h.options.cancelPrint = true;
  original.info.sourceVariant.backgroundColor = "white";
  assert.equal((await h.runPrint(original)).cancelled, true);
  const white = h.service.latest();
  assert.equal(h.automation.store().tasks().find(x => x.id === white.id).error, "店员取消了这单");
  ready(h, red); h.reload(); assert.equal(await h.service.primeRecovery(), null);
  await assert.rejects(white.folder.getEntry("request.json"));
  assert.equal(h.remote.size, 1); assert.equal(h.prints.length, 2);
  console.log("[0.6.30 evidence #2]", JSON.stringify(h.events));
});

test("0.6.30 #3 an unrelated denial does not delay file-only upload", async () => {
  const h = harness({ automaticRemote: true, evidenceCase: "#3" });
  h.options.cancelPrint = true; await h.runPrint(h.source(2), { delivery: false });
  assert.equal(h.window.IDPhotoPrintService.lastDeniedAt(), h.now());
  h.options.cancelPrint = false;
  const original = h.source(); original.info.sourceVariant.backgroundColor = "red";
  assert.equal((await h.runPrint(original)).ok, true); const red = h.service.latest();
  original.info.sourceVariant.backgroundColor = "white";
  assert.equal((await h.runPrint(original)).ok, true); const white = h.service.latest();
  assert.ok(h.now() - h.window.IDPhotoPrintService.lastDeniedAt() < 600000);
  ready(h, red); await finishEarly(h, white);
});

test("0.6.30 #4 repeated white click prints twice and uploads one photo", async () => {
  const { h, original, red, white, result } = await earlyScenario({ evidenceCase: "#4" });
  assert.equal(result.ok, true);
  const again = await h.runPrint(original);
  assert.equal(again.ok, true, again.failures.map(x => x.error.message).join(";"));
  assert.equal(h.prints.length, 3); assert.equal(h.automation.store().tasks().length, 2);
  assert.equal(h.renders[2].code, h.renders[1].code);
  assert.equal(h.renders[2].entryLink.link, h.renders[1].entryLink.link);
  ready(h, red); await finishEarly(h, white);
  assert.equal(await h.service.primeRecovery(), null); assert.equal(h.remote.size, 2);
});

test("0.6.30 #5 cancelling the parent after early print never silently changes the printed code", async () => {
  const { h, original, red, white, result } = await earlyScenario({ evidenceCase: "#5" }); assert.equal(result.ok, true);
  h.remote.get(red.id).status = "cancelled"; h.remote.get(red.id).originalCodeActive = false;
  const notice = await h.service.primeRecovery();
  assert.match(notice.text, /纸上印的取件码 A7K3P9.*请重排/);
  assert.equal(h.automation.store().tasks().find(x => x.id === white.id).state, "stopped");
  await assert.rejects(white.folder.getEntry("request.json")); assert.equal(h.prints.length, 2);
  console.log("[0.6.30 evidence #5]", JSON.stringify({ clock: "simulated", permissions: h.events.filter(x => x.action === "permission"),
    at: h.now(), upload: "stopped: original code invalid, no manifest handed off" }));
  h.options.nextCode = "N7EW8A";
  const reprint = await h.runPrint(original);
  assert.equal(reprint.ok, true, "the requested reprint must not be blocked by the invalid early task");
  assert.equal(h.service.latest().code, "N7EW8A");
});

test("0.6.30 #6 same background different size also prints before ready", async () => {
  const h = harness({ automaticRemote: true, evidenceCase: "#6" }), original = h.source();
  assert.equal((await h.runPrint(original)).ok, true); const first = h.service.latest();
  const secondTemplate = { ...template, name: "Another size", id: "another", widthPx: 700 };
  h.window.IDPhotoTemplates.getTemplateByName = () => secondTemplate;
  assert.equal((await h.runPrint(original, { templateNames: [secondTemplate.name] })).ok, true);
  const second = h.service.latest(); ready(h, first); await finishEarly(h, second);
  assert.equal(h.prints.length, 2); assert.equal(h.renders[0].code, h.renders[1].code);
});

test("0.6.30 #7 restart before and after manifest handoff preserves bytes and exactly one completion", async () => {
  const { h, red, white, result } = await earlyScenario({ evidenceCase: "#7" }); assert.equal(result.ok, true);
  const before = new Uint8Array(await (await white.folder.getEntry("photo.jpg")).read()).slice();
  h.reload(); assert.equal(await h.service.primeRecovery(), null, "parent still preparing");
  ready(h, red); h.options.receipt = false;
  assert.equal(await h.service.primeRecovery(), null);
  const payload = await (await white.folder.getEntry("request.json")).read();
  h.reload(); h.options.receipt = true; await finishEarly(h, white);
  assert.deepEqual(new Uint8Array(await (await white.folder.getEntry("photo.jpg")).read()), before);
  assert.equal(await (await white.folder.getEntry("request.json")).read(), payload);
  h.reload(); assert.equal(await h.service.primeRecovery(), null);
});

test("0.6.30 unprinted local pending task is stopped before a fresh click; unknown backend cannot authorize early print", async () => {
  const h = harness({ connection: false, automaticRemote: true }), original = h.source();
  await h.runPrint(original); const old = h.service.latest();
  h.options.connection = true;
  const result = await h.runPrint(original); assert.equal(result.ok, true);
  assert.equal(h.automation.store().tasks().find(x => x.id === old.id).error, "店员已重新排");
  assert.equal(h.automation.store().tasks().length, 2);
  await assert.rejects(old.folder.getEntry("request.json"));
  assert.equal(h.remote.size, 1);
});

test("0.6.30 accepted pending task is reused for the next click instead of duplicated", async () => {
  const h = harness({ automaticRemote: true }), original = h.source();
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw Error("transform failed"); };
  await h.runPrint(original); const old = h.service.latest();
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async (_d, _b, _s, v) => { h.renders.push({ code: v.pickupCode }); return { ok: true }; };
  const result = await h.runPrint(original); assert.equal(result.ok, true);
  assert.equal(h.automation.store().tasks().length, 1); assert.equal(h.prints.length, 1);
  await finishEarly(h, old); assert.equal(h.remote.size, 1);
});

test("0.6.30 #8 ordinary mode, first coded order and multi-size preserve the normal output dimensions", async () => {
  const h = harness({ automaticRemote: true }), original = h.source();
  assert.equal((await h.runPrint(original, { delivery: false })).ok, true);
  assert.equal(h.automation.store().tasks().length, 0); assert.equal(h.remote.size, 0);
  assert.equal((await h.runPrint(original)).ok, true); const first = h.service.latest();
  assert.equal((await h.json(first.folder, "request.json")).files[0].width, template.widthPx);
  assert.equal((await h.json(first.folder, "request.json")).files[0].height, template.heightPx);
  assert.equal((await h.json(first.folder, "complete.json")).artifacts[0].width, 3600);
  assert.equal((await h.json(first.folder, "complete.json")).artifacts[0].height, 2400);
  const multi = harness({ automaticRemote: true }), source = multi.source();
  const second = { ...template, id: "small-two", name: "Small two", widthPx: 700 };
  multi.window.IDPhotoTemplates.getTemplateByName = name => name === second.name ? second : template;
  const result = await multi.runPrint(source, { templateNames: [template.name, second.name] });
  assert.equal(result.ok, true); assert.equal(multi.prints.length, 2);
  assert.equal(multi.renders[0].code, multi.renders[1].code);
  assert.equal(multi.renders[0].entryLink.link, multi.renders[1].entryLink.link);
  console.log("[0.6.30 evidence #8]", JSON.stringify({ clock: "simulated", ordinaryAndFirst: h.events, multi: multi.events }));
});

test("0.6.30 a pending click that failed before JPEG creation can be superseded safely", async () => {
  const h = harness({ automaticRemote: true }), original = h.source();
  const check = h.window.IDPhotoRatioChecker.checkDocumentRatio;
  h.window.IDPhotoRatioChecker.checkDocumentRatio = () => { throw Error("ratio unavailable"); };
  assert.equal((await h.runPrint(original)).ok, false); const old = h.service.latest();
  await assert.rejects(old.folder.getEntry("photo-prepared.json"));
  h.window.IDPhotoRatioChecker.checkDocumentRatio = check;
  assert.equal((await h.runPrint(original)).ok, true);
  assert.equal(h.automation.store().tasks().find(x => x.id === old.id).error, "店员已重新排");
});

test("0.6.30 cancelled parent before the click creates a new order with a new code", async () => {
  const h = harness({ automaticRemote: true }), original = h.source();
  original.info.sourceVariant.backgroundColor = "red"; await h.runPrint(original); const first = h.service.latest();
  h.remote.get(first.id).status = "withdrawn"; h.remote.get(first.id).originalCodeActive = false;
  h.options.nextCode = "N7EW8A"; original.info.sourceVariant.backgroundColor = "white";
  const result = await h.runPrint(original); assert.equal(result.ok, true);
  const next = h.service.latest(); assert.equal(next.code, "N7EW8A");
  assert.equal((await h.json(next.folder, "request.json")).targetDeliveryId, undefined);
});

test("0.6.30 several backgrounds can print while the first and earlier uploads are still preparing", async () => {
  const { h, red, original, white, result } = await earlyScenario(); assert.equal(result.ok, true);
  original.info.sourceVariant.backgroundColor = "blue";
  assert.equal((await h.runPrint(original)).ok, true); const blue = h.service.latest();
  assert.equal(h.prints.length, 3); assert.equal(h.automation.store().tasks().length, 3);
  ready(h, red); await finishEarly(h, white); await finishEarly(h, blue);
  assert.equal((await h.json(blue.folder, "request.json")).files[0].background, "blue");
  assert.equal(h.remote.size, 3);
});

test("0.6.30 unknown or disconnected target never prints a locally remembered code", async () => {
  for (const reason of ["unknown", "offline"]) {
    const h = harness({ automaticRemote: true }), original = h.source();
    original.info.sourceVariant.backgroundColor = "red"; await h.runPrint(original); const first = h.service.latest();
    if (reason === "unknown") h.remote.delete(first.id); else h.options.connection = false;
    original.info.sourceVariant.backgroundColor = "white";
    const result = await h.runPrint(original); assert.equal(result.ok, false, reason);
    assert.equal(h.prints.length, 1, reason); assert.equal(h.renders.length, 1, reason);
    await assert.rejects(h.service.latest().folder.getEntry("early-print.json"));
  }
});

test("0.6.30 damaged artifacts, markers, source bindings and changed codes stop file-only recovery", async () => {
  for (const fault of ["artifact", "marker", "connection", "code", "legacy", "interrupted-print"]) {
    const { h, red, white, result } = await earlyScenario(); assert.equal(result.ok, true);
    ready(h, red);
    if (fault === "artifact") await (await white.folder.getEntry("layout.jpg")).write(new Uint8Array([1, 2, 3]).buffer);
    if (["marker", "legacy", "interrupted-print"].includes(fault)) {
      const value = await h.json(white.folder, "early-print.json");
      if (fault === "marker") value.contextFingerprint = "f".repeat(64);
      if (fault === "legacy") value.version = 1;
      if (fault === "interrupted-print") value.outputState = "prepared";
      await (await white.folder.getEntry("early-print.json")).write(JSON.stringify(value));
    }
    if (fault === "connection") {
      const value = await h.json(white.folder, "automation-connection.json"); value.sourceIdentity = "another-directory";
      await (await white.folder.getEntry("automation-connection.json")).write(JSON.stringify(value));
    }
    if (fault === "code") h.remote.get(red.id).code = "N7EW8A";
    h.reload(); const before = h.prints.length, renders = h.renders.length;
    const notice = await h.service.primeRecovery(); assert.equal(notice.canPrint, false, fault);
    assert.equal(h.prints.length, before); assert.equal(h.renders.length, renders); assert.equal(h.opened.length, 0);
    await assert.rejects(white.folder.getEntry("request.json"));
    assert.equal(h.automation.store().tasks().find(x => x.id === white.id).state, fault === "code" ? "stopped" : "blocked", fault);
  }
});

test("0.6.30 duplicate cancellation keeps the previously printed photo queued, first cancellation allows another click", async () => {
  const { h, red, original, white, result } = await earlyScenario(); assert.equal(result.ok, true);
  h.options.cancelPrint = true;
  assert.equal((await h.runPrint(original)).cancelled, true);
  assert.equal(h.automation.store().tasks().find(x => x.id === white.id).state, "retryable");
  h.options.cancelPrint = false; ready(h, red); await finishEarly(h, white);
  const second = harness({ automaticRemote: true }), source = second.source();
  source.info.sourceVariant.backgroundColor = "red"; await second.runPrint(source); const parent = second.service.latest();
  source.info.sourceVariant.backgroundColor = "white"; second.options.cancelPrint = true; await second.runPrint(source);
  second.options.cancelPrint = false; assert.equal((await second.runPrint(source)).ok, true);
  ready(second, parent); await finishEarly(second, second.service.latest());
});

test("0.6.30 a receipt for another code never supplies the early print's dedicated link", async () => {
  const h = harness({ automaticRemote: true }), original = h.source();
  original.info.sourceVariant.backgroundColor = "red"; await h.runPrint(original); const red = h.service.latest();
  h.remote.get(red.id).code = "N7EW8A";
  // A real manager's confirmedCode refuses an old binding; the helper must not
  // carry A7K3P9's link forward merely because it is present in a local file.
  const get = red.folder.getEntry.bind(red.folder);
  red.folder.getEntry = async name => name === "code-response.json" ? { read: async () => JSON.stringify({
    version: 2, taskId: red.id, requestId: red.confirmationId, manifestFingerprint: red.fingerprint,
    accepted: true, confirmed: true, status: "preparing", code: "A7K3P9", entryLinkCode: "A7K3P9",
    entryLink: "https://mp.weixin.qq.com/a/~wrongCustomer~~", contextKey: red.contextKey, deliveryId: red.deliveryId
  }) } : get(name);
  original.info.sourceVariant.backgroundColor = "white"; assert.equal((await h.runPrint(original)).ok, true);
  assert.equal(h.renders[1].code, "N7EW8A"); assert.equal(h.renders[1].entryLink.link, "");
  assert.match(h.renders[1].entryLink.reason, /核对/);
});

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

test("a reprint failure is reported after it happens, but an old one no longer greets every startup", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  h.window.IDPhotoPrintService.printOneCopy = async () => ({ ok: false, printed: false, message: "DS-RX1 unavailable" });
  await assert.rejects(h.service.printRecovered(task.id), /DS-RX1 unavailable/);
  h.advance(29 * 60 * 1000); h.reload();
  assert.match((await h.service.recoveredNotice()).text, /DS-RX1 unavailable/);
  h.advance(2 * 60 * 1000); h.reload();
  assert.equal(await h.service.recoveredNotice(), null);
  await assert.rejects(h.service.printRecovered(task.id), /避免重复|已开始/, "an old failed reprint still cannot print twice");
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
  // A record from 0.6.10 has no confirmation time, so the code is asked for again.
  const saved = await h.json(task.folder, "automatic-recovery.json");
  delete saved.confirmedAt;
  task.folder.children.get("automatic-recovery.json").value = JSON.stringify(saved);
  h.options.receipt = false; h.reload();
  await assert.rejects(h.service.printRecovered(task.id), error => /超时/.test(error.message) && !/cannot restart/.test(error.message));
  assert.equal(h.automation.store().tasks().find(item => item.id === task.id).state, "completed");
  assert.equal(h.prints.length, 0);
  const notice = await h.service.recoveredNotice();
  assert.equal(notice.canPrint, false); assert.match(notice.text, /^没打印：/);
});

test("a recovered print reuses the code its recovery confirmed minutes ago instead of waiting on the delivery manager", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  assert.ok(Number.isFinite((await h.json(task.folder, "automatic-recovery.json")).confirmedAt));
  h.options.receipt = false; h.reload();
  const printed = await h.service.printRecovered(task.id);
  assert.equal(printed.id, task.id); assert.equal(h.prints.length, 1);
});

// 10-18: a sheet that failed while drawing its info bar had saved and printed nothing,
// yet its output marker locked that photo for good. It is now redone in the background.
const abortRecords = async folder => (await folder.getEntries()).filter(entry => /^output-aborted-.+\.json$/.test(entry.name));
test("a sheet that fails while drawing the info bar is redone in the background and then offered for printing", async () => {
  const h = harness(), original = h.source(), render = h.window.IDPhotoInfoBarRenderer.renderInfoBar;
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw new Error("Photoshop 命令失败：transform"); };
  const result = await h.runPrint(original);
  assert.equal(result.ok, false); assert.equal(result.failures[0].error.autoRedo, true);
  const task = h.service.latest();
  await assert.rejects(task.folder.getEntry("output-started.json"));
  const records = await abortRecords(task.folder);
  assert.equal(records.length, 1);
  const record = JSON.parse(await records[0].read());
  assert.equal(record.taskId, task.id); assert.equal(record.marker, "output-started.json"); assert.match(record.reason, /transform/);
  assert.equal(h.automation.store().tasks()[0].state, "retryable");
  assert.equal(h.prints.length, 0); assert.equal(h.exports.length, 0);
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = render;
  assert.equal(await h.service.primeRecovery(), task.id);
  const notice = await h.service.recoverNext(task.id);
  assert.equal(notice.canPrint, true, JSON.stringify(notice)); assert.match(notice.text, /已补好/);
  assert.equal(h.prints.length, 0, "the background never prints by itself");
  await h.service.printRecovered(task.id);
  assert.equal(h.prints.length, 1);
});

test("a drawing that keeps failing stops after two background redos and stays locked", async () => {
  const h = harness(), original = h.source();
  let attempts = 0;
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { attempts++; throw new Error("Photoshop 命令失败：transform"); };
  await h.runPrint(original);
  const task = h.service.latest();
  for (let n = 0; n < 2; n++) {
    assert.equal(await h.service.primeRecovery(), task.id);
    assert.equal((await h.service.recoverNext(task.id)).canPrint, false);
  }
  assert.equal(attempts, 3);
  assert.equal((await abortRecords(task.folder)).length, 2);
  await task.folder.getEntry("output-started.json");
  const parked = await h.service.primeRecovery();
  assert.equal(parked.id, task.id);
  assert.equal(h.automation.store().tasks()[0].state, "blocked");
  h.reload();
  const again = await h.service.primeRecovery();
  assert.ok(again === null || again.id === task.id);
  assert.equal(h.automation.store().tasks()[0].state, "blocked");
  assert.equal(attempts, 3); assert.equal(h.prints.length, 0);
});

test("a task locked only by its marker goes back to the queue once an abort record replaces the marker", async () => {
  const h = harness({ receipt: false }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /超时/);
  const task = h.service.latest();
  const marker = await task.folder.createFile("output-started.json", { overwrite: false });
  await marker.write("{}");
  h.options.receipt = true; h.reload();
  assert.match((await h.service.primeRecovery()).text, /输出痕迹/);
  assert.equal(h.automation.store().tasks()[0].state, "blocked");
  await marker.delete();
  h.reload();
  await h.service.primeRecovery();
  assert.equal(h.automation.store().tasks()[0].state, "blocked", "no abort record, no release");
  await (await task.folder.createFile("output-aborted-" + id(77) + ".json", { overwrite: false }))
    .write(JSON.stringify({ version: 1, taskId: task.id, stage: "info-bar", reason: "repaired from the log" }));
  h.reload();
  assert.equal(await h.service.primeRecovery(), task.id);
  assert.ok(await h.service.recoverNext(task.id));
  assert.equal(h.renders.length, 1, "the electronic delivery draws its own info bar once"); assert.equal(h.prints.length, 0);
  await task.folder.getEntry("complete.json");
});

// 10-18 at the counter: Esc on a running order made the background start it again twice,
// "阻止" did not stop it, and a "可以打印" stayed after the sheet was printed from the panel.
test("Esc during a layout parks the order: no background redo, and the same photo can be laid out again", async () => {
  const h = harness(), original = h.source();
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw new Error("user cancelled"); };
  const result = await h.runPrint(original);
  assert.equal(result.cancelled, true);
  const first = h.automation.store().tasks()[0];
  assert.equal(first.state, "stopped"); assert.equal(first.error, "店员取消了这单");
  assert.equal(await h.service.primeRecovery(), null, "a cancelled order is not redone in the background");
  assert.equal((await abortRecords(h.service.latest().folder)).length, 0, "Esc is not a failed drawing");
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async (document, bar, settings, values) => {
    h.renders.push({ documentId: document.id, code: values.pickupCode }); return { ok: true, createdCount: 1 };
  };
  // The test double cannot answer the delivery-manager lookup a repeat order makes; what
  // matters is that the cancelled order no longer refuses the photo as "unfinished".
  const again = await h.runPrint(original);
  assert.equal(again.failures.some(f => /未完成任务/.test(f.error && f.error.message)), false);
  assert.equal(h.automation.store().tasks().length, 2, "a new order was started for the same photo");
});

test("Esc in the panel stops the run at its next step and parks the order", async () => {
  const h = harness(), original = h.source();
  const place = h.window.IDPhotoLayerService.placePhotoCopies;
  h.window.IDPhotoLayerService.placePhotoCopies = async (...values) => { assert.equal(h.window.IDPhotoLayoutWorkflow.stopAll(), true); return place(...values); };
  const result = await h.runPrint(original);
  assert.equal(result.cancelled, true); assert.equal(h.renders.length, 0); assert.equal(h.prints.length, 0);
  assert.equal(h.automation.store().tasks()[0].state, "stopped");
  assert.equal(h.window.IDPhotoLayoutWorkflow.stopAll(), false, "nothing left running");
});

test("Esc during a background redo parks it instead of starting it again", async () => {
  const h = harness(), original = h.source();
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw new Error("Photoshop 命令失败：transform"); };
  await h.runPrint(original);
  const task = h.service.latest();
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw new Error("user cancelled"); };
  assert.equal(await h.service.primeRecovery(), task.id);
  assert.equal((await h.service.recoverNext(task.id)).canPrint, false);
  assert.equal(h.automation.store().tasks()[0].state, "stopped");
  assert.equal(await h.service.primeRecovery(), null);
});

test("after 阻止 the background waits ten minutes, and an order it finished meanwhile offers no print", async () => {
  const h = harness(), original = h.source();
  let denied = 0;
  h.window.IDPhotoPrintService.lastDeniedAt = () => denied;
  const render = h.window.IDPhotoInfoBarRenderer.renderInfoBar;
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw new Error("Photoshop 命令失败：transform"); };
  await h.runPrint(original);
  const task = h.service.latest();
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async (...values) => { denied = h.now(); return render(...values); };
  assert.equal(await h.service.primeRecovery(), task.id);
  const notice = await h.service.recoverNext(task.id);
  assert.equal(notice.canPrint, false); assert.match(notice.text, /阻止/);
  assert.equal((await h.json(task.folder, "automatic-recovery.json")).printAvailable, false);
  const second = h.source(2);
  h.window.IDPhotoInfoBarRenderer.renderInfoBar = async () => { throw new Error("Photoshop 命令失败：transform"); };
  await h.runPrint(second);
  const waiting = h.service.latest();
  assert.equal(await h.service.primeRecovery(), null, "paused right after 阻止");
  h.advance(10 * 60 * 1000);
  assert.equal(await h.service.primeRecovery(), waiting.id);
});

test("a background '可以打印' is retired once the same code and size is printed from the panel", async () => {
  const h = harness({ connection: false }), { task } = await recoveredPrint(h);
  assert.equal((await h.service.recoveredNotice()).canPrint, true);
  h.service.notePrinted("A7K3P9", "another-size");
  assert.equal((await h.service.recoveredNotice()).canPrint, true, "another size of the same customer is still owed");
  h.advance(60000);
  h.service.notePrinted("A7K3P9", template.id);
  assert.equal(await h.service.recoveredNotice(), null);
  const saved = await h.json(task.folder, "automatic-recovery.json");
  assert.equal(saved.printAvailable, false); assert.equal(saved.printState, "printed-from-panel");
  await assert.rejects(h.service.printRecovered(task.id));
  assert.equal(h.prints.length, 0);
});

test("an order cancelled in the delivery manager stops automatic recovery instead of asking every minute (10-28)", async () => {
  const h = harness({ receipt: false }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /超时/);
  const task = h.service.latest();
  h.options.receipt = true; h.options.ended = "cancelled"; h.reload();
  assert.equal(await h.service.primeRecovery(), null, "parked quietly, no recovery notice");
  const record = h.automation.store().tasks().find(item => item.id === task.id);
  assert.equal(record.state, "stopped"); assert.match(record.error, /已取消或撤回/);
  const asked = (await h.json(task.folder, "code-request.json")).requestId;
  h.reload();
  assert.equal(await h.service.primeRecovery(), null);
  assert.equal((await h.json(task.folder, "code-request.json")).requestId, asked, "no new code request after a restart");
  assert.equal(h.automation.plan(original.info, "electronic", null, false).existing, null, "the same photo can be laid out again");
  assert.equal(h.opened.length, 0); assert.equal(h.renders.length, 0); assert.equal(h.prints.length, 0);
});

test("a withdrawal recorded in receipt.json stops recovery before another code request is written", async () => {
  const h = harness({ receipt: false }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}), /超时/);
  const task = h.service.latest(), payload = await (await task.folder.getEntry("request.json")).read();
  await (await task.folder.createFile("receipt.json", { overwrite: true })).write(JSON.stringify({ version: 2, taskId: task.id,
    manifestFingerprint: h.window.IDPhotoDeliveryProtocol.sha256(payload), accepted: true, confirmed: false, status: "withdrawn",
    deliveryId: "remote-" + task.id, code: "", completed: false, error: "" }));
  h.reload();
  const before = (await h.json(task.folder, "code-request.json")).requestId;
  assert.equal(await h.service.primeRecovery(), null);
  assert.equal((await h.json(task.folder, "code-request.json")).requestId, before);
  assert.equal(h.automation.store().tasks().find(item => item.id === task.id).state, "stopped");
});

test("a cancel answered while waiting ends the wait at once and parks the order", async () => {
  const h = harness({ ended: "withdrawn" }), original = h.source();
  await assert.rejects(h.service.electronic(original.document, original.info, {}),
    error => /已取消或撤回/.test(error.message) && error.retryable === false && !/待核对/.test(error.message));
  const record = h.automation.store().tasks().find(item => item.id === h.service.latest().id);
  assert.equal(record.state, "stopped");
});
