"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const id = n => n.toString(16).padStart(32, "0");
const plain = value => JSON.parse(JSON.stringify(value));
const template = { id: "one-inch", name: "One inch", widthPx: 295, heightPx: 413 };
const photo = { path: "photo.jpg", role: "photo", sha256: "a".repeat(64), sizeBytes: 1500, width: 295, height: 413 };
function info(sourceKey, backgroundColor = "white") {
  return { id: 17, name: "same-filename.jpg", sourceKey, widthPx: 295, heightPx: 413,
    sourceVariant: { backgroundColor } };
}

function harness(options = {}) {
  let clock = 100000, serial = 10000;
  const memory = new Map(), snapshots = new Map(), requests = [];
  let window;
  class Entry {
    constructor(name, parent, folder = true) {
      this.name = name; this.parent = parent; this.isFolder = folder;
      this.nativePath = parent ? parent.nativePath + "/" + name : name;
      this.children = new Map(); this.value = "";
    }
    async getEntry(name) {
      if (!this.children.has(name)) throw Error("Missing " + name);
      return this.children.get(name);
    }
    async createFolder(name) {
      if (this.children.has(name)) throw Error("Folder exists");
      const value = new Entry(name, this); this.children.set(name, value); return value;
    }
    async createFile(name, settings = {}) {
      if (this.children.has(name) && !settings.overwrite) throw Error("File exists");
      const value = new Entry(name, this, false); this.children.set(name, value); return value;
    }
    async read() { return this.value; }
    async write(value) { this.value = value; }
    async moveTo(folder, settings) {
      if (folder.children.has(settings.newName) && !settings.overwrite) throw Error("Destination exists");
      this.parent.children.delete(this.name); this.parent = folder; this.name = settings.newName;
      this.nativePath = folder.nativePath + "/" + this.name; folder.children.set(this.name, this);
      if (folder.name === "automation-requests") await respond(this.value);
    }
  }
  const root = new Entry("handoff-root");
  const connected = { requestId: id(999), sourceIdentity: "original-directory", consumerId: "original-consumer",
    automationProtocol: options.oldCapability ? undefined : "pickup-automation-1" };
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  window = { localStorage: storage,
    IDPhotoDeliveryIdentity: {
      getSourceIdentity: value => value.sourceKey || "",
      makeVariantKey: value => value.backgroundColor === "unknown" ? "" : value.widthPx + "x" + value.heightPx + ":" + value.backgroundColor
    },
    IDPhotoDeliveryService: {
      root: async () => root, connection: async () => {
        if (options.connectionWait) await options.connectionWait();
        return connected;
      },
      previewTask: async taskId => "data:image/jpeg;base64," + taskId
    }
  };
  class Clock extends Date { static now() { return clock; } }
  const filesystem = { getEntryForPersistentToken: async token => {
    assert.equal(token, "root-token"); return root;
  }, createPersistentToken: async entry => {
    assert.equal(entry, root); return "root-token";
  } };
  const context = vm.createContext({ window, console, Date: Clock,
    setTimeout: callback => { clock += 1000; callback(); },
    require: name => {
      assert.equal(name, "uxp"); return { storage: { localFileSystem: filesystem, formats: { utf8: "utf8" } } };
    } });
  const load = () => vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/photoshop/deliveryAutomationService.js"), "utf8"), context);
  for (const module of ["core/deliveryProtocol", "core/deliveryAutomationStore"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", module + ".js"), "utf8"), context);
  window.IDPhotoDeliveryProtocol.id = () => id(++serial);
  load();
  async function respond(payload) {
    const request = JSON.parse(payload); requests.push(request);
    let data;
    if (request.action === "queryTasks") {
      data = { items: request.taskIds.map(taskId => snapshots.get(taskId) || { taskId, known: false, blocked: false }) };
      data.items = data.items.map(item => {
        if (!Array.isArray(item.aliases)) return item;
        const binding = (request.bindings || []).find(value => value.taskId === item.taskId);
        return { ...item, originalCodeActive: Boolean(binding && item.aliases.includes(binding.code)) };
      });
    } else if (request.action === "mergeGroup") {
      if (options.dropMergeResponse) return;
      const primaryId = options.primaryTaskId || request.taskIds[0];
      const primary = snapshots.get(primaryId);
      for (const taskId of request.taskIds) snapshots.set(taskId, { ...snapshots.get(taskId),
        deliveryId: primary.deliveryId, code: primary.code, groupVersion: primary.groupVersion + 1 });
      data = { status: "complete", primaryId: primary.deliveryId };
    } else throw Error("Unexpected bridge action " + request.action);
    const response = { version: 1, protocol: request.protocol, operationId: request.operationId,
      requestId: request.requestId, sourceIdentity: request.sourceIdentity, consumerId: request.consumerId,
      fingerprint: window.IDPhotoDeliveryProtocol.sha256(payload), ok: true, data };
    if (options.corruptResponse === "nonce") response.requestId = id(12345);
    if (options.corruptResponse === "fingerprint") response.fingerprint = "f".repeat(64);
    if (options.corruptResponse === "consumer") response.consumerId = "other-consumer";
    let folder;
    try { folder = await root.getEntry("automation-responses"); } catch (_) { folder = await root.createFolder("automation-responses"); }
    await (await folder.createFile(request.operationId + ".json", { overwrite: true })).write(JSON.stringify(response));
  }
  function prior(n, sourceKey, backgroundColor = "white", patch = {}) {
    const service = window.IDPhotoDeliveryAutomationService, store = service.store();
    const specKey = window.IDPhotoDeliveryIdentity.makeVariantKey({ widthPx: 295, heightPx: 413, backgroundColor });
    const task = store.registerTask({ id: id(n), token: "token-" + n, sourceKey, specKey, mode: "print", name: "same-filename.jpg" });
    const snapshot = { taskId: task.id, known: true, blocked: false, status: "ready", originalCodeActive: true,
      deliveryId: "delivery-" + n, contextKey: "context-A", groupVersion: 4, code: "A7K3P9",
      originalMemberId: "member-" + n, taskFiles: [{ id: "file-" + n, filename: "original-" + n + ".jpg" }], ...patch };
    snapshots.set(task.id, snapshot);
    store.markTask(task.id, { state: "completed", code: snapshot.code, target: snapshot });
    store.rememberSource(sourceKey, { taskId: task.id, token: task.token, code: snapshot.code, target: snapshot });
    return task;
  }
  function next(n, documentInfo) {
    const automation = window.IDPhotoDeliveryAutomationService.plan(documentInfo, "print", template);
    const task = { id: id(n), outputId: id(n + 100), mode: "print", template, docInfo: documentInfo,
      automation, sourceRootToken: "root-token", consumerId: connected.consumerId,
      sourceIdentity: connected.sourceIdentity, contextFingerprint: "c".repeat(64) };
    window.IDPhotoDeliveryAutomationService.created(task, "token-" + n);
    return task;
  }
  return { options, memory, snapshots, requests, root, connected, prior, next, reload: load,
    identity: window.IDPhotoDeliveryIdentity,
    advance: amount => { clock += amount; }, get service() { return window.IDPhotoDeliveryAutomationService; } };
}

test("an exact legacy capture key is retained across the identity upgrade, and multiple matches stop", () => {
  const h = harness();
  h.prior(1, "old-capture-key");
  h.identity.matchesSourceIdentity = (key, value) => key === "old-capture-key" && value.sourceKey === "new-capture-key";
  const plan = h.service.plan(info("new-capture-key"), "print", template);
  assert.equal(plan.sourceKey, "old-capture-key");
  assert.equal(plan.kind, "same");
  assert.deepEqual(plain(plan.previousTaskIds), [id(1)]);
  h.prior(2, "another-old-key");
  h.identity.matchesSourceIdentity = () => true;
  assert.throws(() => h.service.plan(info("new-capture-key"), "print", template), /多份历史记录/);
});

test("different reliable originals sharing a filename never borrow a previous delivery or member", async () => {
  const h = harness(); h.prior(1, "source-A");
  for (const [n, source] of [[2, "source-B"], [3, "source-C"]]) {
    const task = h.next(n, info(source));
    const request = await h.service.resolve(task, photo);
    assert.equal(task.automation.kind, "new");
    assert.equal(request.taskId, task.id);
    assert.equal(request.targetDeliveryId, undefined);
    assert.equal(request.files[0].memberId, undefined);
    assert.equal(request.files[0].replaceFileId, undefined);
  }
  assert.equal(h.requests.length, 0);
});

test("same original and specification replace only the verified current file with its original name", async () => {
  const h = harness(); h.prior(1, "source-A");
  const task = h.next(2, info("source-A"));
  const request = await h.service.resolve(task, { ...photo, sha256: "b".repeat(64) });
  assert.equal(request.targetDeliveryId, "delivery-1");
  assert.equal(request.targetGroupVersion, 4);
  assert.equal(request.newMember, false);
  assert.equal(request.files[0].memberId, "member-1");
  assert.equal(request.files[0].replaceFileId, "file-1");
  assert.equal(request.files[0].filename, "original-1.jpg");
  assert.equal(request.files[0].sha256, "b".repeat(64));
});

test("a different background appends to the same verified member without replacing the original", async () => {
  const h = harness(); h.prior(1, "source-A");
  const request = await h.service.resolve(h.next(2, info("source-A", "blue")), photo);
  assert.equal(request.targetDeliveryId, "delivery-1");
  assert.equal(request.newMember, false);
  assert.equal(request.files[0].memberId, "member-1");
  assert.equal(request.files[0].background, "blue");
  assert.equal(request.files[0].replaceFileId, undefined);
});

test("retired original codes create a fresh delivery without reviving the old file or member", async () => {
  const h = harness(); h.prior(1, "source-A", "white", { originalCodeActive: false });
  const request = await h.service.resolve(h.next(2, info("source-A")), photo);
  assert.equal(request.targetDeliveryId, undefined);
  assert.equal(request.files[0].memberId, undefined);
  assert.equal(request.files[0].replaceFileId, undefined);
});

test("a trusted withdrawn or cancelled predecessor starts fresh but frozen records remain protected", async () => {
  for (const status of ["withdrawn", "cancelled"]) {
    const h = harness(); h.prior(1, "source-A", "white", { status, blocked: true, originalCodeActive: false });
    const request = await h.service.resolve(h.next(2, info("source-A")), photo);
    assert.equal(request.targetDeliveryId, undefined);
    assert.equal(request.files[0].replaceFileId, undefined);
  }
  const frozen = harness(); frozen.prior(1, "source-A", "white", { status: "frozen", blocked: true, error: "Shared group frozen" });
  await assert.rejects(frozen.service.resolve(frozen.next(2, info("source-A")), photo), /frozen|核对|冲突/i);
});

test("unknown or blocked predecessor never silently guesses a new customer", async () => {
  for (const patch of [{ known: false }, { blocked: true, error: "Version conflict", retryable: false }]) {
    const h = harness(); h.prior(1, "source-A", "white", patch);
    await assert.rejects(h.service.resolve(h.next(2, info("source-A")), photo), /原交付|Version conflict/);
  }
});

test("same-specification replacement refuses ambiguous file ownership", async () => {
  const h = harness(); h.prior(1, "source-A", "white", { taskFiles: [{ id: "file-a" }, { id: "file-b" }] });
  await assert.rejects(h.service.resolve(h.next(2, info("source-A")), photo), /唯一确认/);
});

test("nonce, fingerprint and consumer mismatches cannot authorize an automation result", async () => {
  for (const corruptResponse of ["nonce", "fingerprint", "consumer"]) {
    const h = harness({ corruptResponse }); h.prior(1, "source-A");
    await assert.rejects(h.service.resolve(h.next(2, info("source-A")), photo), error => error.retryable === true && /超时/.test(error.message));
    assert.equal(h.requests.filter(request => request.action === "queryTasks").length, 1);
  }
});

test("an old backend capability refuses even a fresh automatic task before a manifest is accepted", async () => {
  const h = harness({ oldCapability: true });
  await assert.rejects(h.service.resolve(h.next(2, info("new-source")), photo), /支持自动交付|配套后台/);
  assert.equal(h.requests.length, 0);
});

test("the most recent matching specification remains replaceable beyond a 32-task query window", async () => {
  const h = harness(); h.prior(1, "source-A");
  for (let n = 2; n <= 34; n++) {
    h.prior(n, "source-A", "blue", { deliveryId: "delivery-1", originalMemberId: "member-1" });
    h.advance(1);
  }
  const request = await h.service.resolve(h.next(35, info("source-A")), photo);
  assert.equal(request.targetDeliveryId, "delivery-1");
  assert.equal(request.files[0].replaceFileId, "file-1");
});

test("companion merge reuses the earliest original customer's code and exact current versions", async () => {
  const h = harness({ primaryTaskId: id(1) }); h.prior(1, "source-A");
  h.advance(1000); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  const group = await h.service.openGroup([id(2), id(1)]);
  assert.equal(group.on, true);
  assert.equal(group.code, "A7K3P9");
  const merge = h.requests.find(request => request.action === "mergeGroup");
  assert.equal(merge.confirmSharing, true);
  assert.deepEqual(plain(merge.expected.map(item => item.version)), [4, 4]);
  assert.equal(h.service.store().mergeIntent(), null);
});

function holdRequest(h, action) {
  const prototype = Object.getPrototypeOf(h.root), original = prototype.moveTo;
  let release, entered, held = false;
  const wait = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  prototype.moveTo = async function (folder, settings) {
    if (!held && folder.name === "automation-requests" && JSON.parse(this.value).action === action) {
      held = true; entered(); await wait;
    }
    return original.call(this, folder, settings);
  };
  return { reached, release };
}

test("a merge result arriving after explicit companion close reconciles without reopening", async () => {
  const h = harness(); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  await h.service.openGroup([]);
  const sessionId = h.service.store().group().sessionId, gate = holdRequest(h, "mergeGroup");
  const pending = h.service.openGroup([id(1), id(2)]);
  await gate.reached;
  const savedSession = h.service.store().mergeIntent().sessionId;
  h.service.store().setGroup({ on: false }); gate.release();
  const result = await pending;
  assert.equal(result.on, false); assert.equal(h.service.store().group().on, false);
  assert.equal(savedSession, sessionId);
  assert.equal(h.service.store().mergeIntent(), null);
});

test("a merge result after twenty minutes of idle time reconciles without activating an expired session", async () => {
  const h = harness(); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  const gate = holdRequest(h, "mergeGroup"), pending = h.service.openGroup([id(1), id(2)]);
  await gate.reached;
  h.advance(20 * 60 * 1000); gate.release();
  const result = await pending;
  assert.equal(result.on, false); assert.equal(result.expired, true);
  assert.equal(h.service.store().mergeIntent(), null);
});

test("a single selected customer cannot reactivate a companion closed during its initial query", async () => {
  const h = harness(); h.prior(1, "source-A");
  const gate = holdRequest(h, "queryTasks"), pending = h.service.openGroup([id(1)]);
  await gate.reached;
  const activeBeforeClose = h.service.store().group().on;
  h.service.store().setGroup({ on: false }); gate.release();
  assert.equal((await pending).on, false);
  assert.equal(activeBeforeClose, true);
  assert.equal(h.requests.filter(request => request.action === "mergeGroup").length, 0);
});

test("opening records its activation before waiting for a connection and respects a close after reload", async () => {
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; });
  const h = harness({ connectionWait: async () => { entered(); await wait; } }); h.prior(1, "source-A");
  const pending = h.service.openGroup([id(1)]);
  await reached;
  const activation = h.service.store().group();
  h.reload();
  h.service.store().setGroup({ on: false }); release();
  assert.equal((await pending).on, false);
  assert.equal(activation.on, true); assert.ok(activation.sessionId);
});

test("opening an already active empty companion preserves the same activation session", async () => {
  const h = harness(), first = await h.service.openGroup([]), second = await h.service.openGroup([]);
  assert.equal(second.sessionId, first.sessionId); assert.equal(second.on, true);
});

test("a closed merge intent remains closed when its original operation is reconciled after reload", async () => {
  const h = harness({ dropMergeResponse: true }); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  await assert.rejects(h.service.openGroup([id(1), id(2)]), /超时/);
  const original = h.service.store().mergeIntent();
  h.service.store().setGroup({ on: false }); h.reload(); h.options.dropMergeResponse = false;
  const result = await h.service.openGroup(original.taskIds);
  assert.equal(result.on, false); assert.equal(h.service.store().mergeIntent(), null);
  assert.ok(original.sessionId);
  assert.ok(h.requests.filter(request => request.action === "mergeGroup").every(request => request.operationId === original.operationId));
});

test("a legacy merge intent without an activation session can reconcile but never activate companions", async () => {
  const h = harness({ dropMergeResponse: true }); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  await assert.rejects(h.service.openGroup([id(1), id(2)]), /超时/);
  h.service.store().setGroup({ on: false });
  const [key, text] = [...h.memory.entries()][0], value = JSON.parse(text);
  delete value.mergeIntent.sessionId; h.memory.set(key, JSON.stringify(value));
  h.reload(); h.options.dropMergeResponse = false;
  const result = await h.service.openGroup([id(1), id(2)]);
  assert.equal(result.on, false); assert.equal(h.service.store().mergeIntent(), null);
});

test("a late merge cannot overwrite another active companion session opened after its close", async () => {
  const h = harness(); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  const gate = holdRequest(h, "mergeGroup"), pending = h.service.openGroup([id(1), id(2)]);
  await gate.reached;
  h.service.store().setGroup({ on: false });
  const replacement = h.service.store().setGroup({ on: true, sessionId: id(8888), members: [], code: "", target: null });
  gate.release(); const result = await pending;
  assert.equal(result.on, true); assert.equal(result.sessionId, replacement.sessionId);
  assert.equal(result.code, ""); assert.deepEqual(plain(result.members), []);
  assert.equal(h.service.store().mergeIntent(), null);
});

test("a timed-out merge persists one intent across reload and protects its sources without blocking an independent customer", async () => {
  const h = harness({ dropMergeResponse: true }); h.prior(1, "source-A");
  h.advance(1000); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  await assert.rejects(h.service.openGroup([id(2), id(1)]), /超时/);
  const merge = h.requests.find(request => request.action === "mergeGroup");
  const saved = h.service.store().mergeIntent();
  assert.equal(saved.operationId, merge.operationId);
  assert.deepEqual(new Set(plain(saved.taskIds)), new Set([id(1), id(2)]));
  h.reload();
  assert.equal(h.service.store().mergeIntent().operationId, merge.operationId);
  h.service.store().setGroup({ on: false });
  await assert.rejects(h.service.resolve(h.next(4, info("source-A")), photo), /同行|合并|核对|未决/);
  const separate = await h.service.resolve(h.next(3, info("source-C")), photo);
  assert.equal(separate.targetDeliveryId, undefined);
  await assert.rejects(h.service.openGroup([]), /同行|合并|核对|未决/);
  assert.equal(h.requests.filter(request => request.action === "mergeGroup").length, 1);
});

test("an unresolved active companion merge keeps a new original pending without creating an independent delivery", async () => {
  const h = harness({ dropMergeResponse: true }); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  await assert.rejects(h.service.openGroup([id(1), id(2)]), /超时/);
  assert.equal(h.service.store().group().on, true);
  const task = h.next(3, info("source-C")), requestsBefore = h.requests.length;
  await assert.rejects(h.service.resolve(task, photo), error => error.retryable === true && /同行|合并|核对|未决/.test(error.message));
  assert.equal(h.requests.length, requestsBefore);
  assert.equal(h.service.store().tasks().find(item => item.id === task.id).state, "pending");
  assert.equal(h.service.store().mergeIntent().sessionId, task.automation.groupSessionId);
});

test("an original accepted while a companion merge is waiting still restores to its merged root after close", async () => {
  const h = harness(); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  const gate = holdRequest(h, "mergeGroup"), pending = h.service.openGroup([id(1), id(2)]);
  await gate.reached;
  const task = h.next(3, info("source-C"));
  assert.deepEqual(plain(task.automation.groupTaskIds), [id(1), id(2)]);
  await assert.rejects(h.service.resolve(task, photo), error => error.retryable === true);
  h.service.store().setGroup({ on: false }); gate.release();
  assert.equal((await pending).on, false);
  const request = await h.service.resolve(task, photo);
  assert.equal(request.targetDeliveryId, "delivery-1"); assert.equal(request.newMember, true);
  assert.equal(h.service.store().group().on, false);
});

test("a confirmed merge preserves new originals registered in the same active session while awaiting its result", async () => {
  const h = harness(); h.prior(1, "source-A"); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  const gate = holdRequest(h, "mergeGroup"), pending = h.service.openGroup([id(1), id(2)]);
  await gate.reached;
  const task = h.next(3, info("source-C")), sessionId = h.service.store().group().sessionId;
  gate.release(); const group = await pending;
  assert.equal(group.on, true); assert.equal(group.sessionId, sessionId);
  assert.deepEqual(plain(group.members), [id(1), id(2), task.id]);
  assert.equal(group.code, "A7K3P9");
});

test("retrying the same timed-out merge reuses its operation and clears intent only after confirmed convergence", async () => {
  const h = harness({ dropMergeResponse: true, primaryTaskId: id(1) }); h.prior(1, "source-A");
  h.advance(1000); h.prior(2, "source-B", "white", { code: "B7K3P9" });
  await assert.rejects(h.service.openGroup([id(2), id(1)]), /超时/);
  const original = h.service.store().mergeIntent().operationId;
  h.reload(); h.options.dropMergeResponse = false;
  const result = await h.service.openGroup([id(2), id(1)]);
  assert.equal(result.on, true);
  assert.equal(result.code, "A7K3P9");
  const attempts = h.requests.filter(request => request.action === "mergeGroup");
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(request => request.operationId === original));
  assert.notEqual(attempts[0].requestId, attempts[1].requestId);
  assert.equal(h.service.store().mergeIntent(), null);
});

test("a previous task without a code is queried without a fabricated code binding", async () => {
  const h = harness();
  const original = h.service.store().registerTask({ id: id(1), token: "token-1", sourceKey: "source-A",
    specKey: "295x413:white", mode: "print", name: "same-filename.jpg" });
  h.snapshots.set(original.id, { taskId: original.id, known: true, blocked: true,
    status: "preparing", error: "Original task pending", retryable: true });
  await assert.rejects(h.service.resolve(h.next(2, info("source-A", "blue")), photo), error => error.retryable === true);
  assert.deepEqual(plain(h.requests[0].bindings), []);
});

test("a companion group's first pending task remains its anchor before code confirmation", async () => {
  const h = harness(); await h.service.openGroup([]);
  const first = h.next(1, info("source-A"));
  assert.deepEqual(plain(h.service.store().group().members), [first.id]);
  const second = h.next(2, info("source-B"));
  assert.deepEqual(plain(second.automation.groupTaskIds), [first.id]);
});

test("a previously standalone task's delayed confirmation cannot join a later companion group", async () => {
  const h = harness(); const old = h.next(1, info("source-A"));
  await h.service.openGroup([]);
  Object.assign(old, { code: "A7K3P9", deliveryId: "standalone-delivery", contextKey: "context-A" });
  h.service.confirmed(old);
  const group = h.service.store().group();
  assert.deepEqual(plain(group.members), []);
  assert.equal(group.code, "");
  assert.equal(h.service.store().source("source-A").code, "A7K3P9");
});

test("delayed confirmation from a closed group cannot change a new group opened in the same millisecond", async () => {
  const h = harness(); await h.service.openGroup([]);
  const first = h.next(1, info("source-A"));
  const before = h.service.store().group();
  h.service.store().setGroup({ on: false });
  await h.service.openGroup([]);
  const after = h.service.store().group();
  assert.equal(before.openedAt, after.openedAt);
  assert.notEqual(before.sessionId, after.sessionId);
  Object.assign(first, { code: "A7K3P9", deliveryId: "old-group-delivery", contextKey: "context-A" });
  h.service.confirmed(first);
  const group = h.service.store().group();
  assert.deepEqual(plain(group.members), []);
  assert.equal(group.code, "");
  assert.equal(group.sessionId, after.sessionId);
});

test("the recent companion picker drops cancelled, retired and unverified deliveries after refreshing", async () => {
  const h = harness();
  for (let n = 1; n <= 5; n++) { h.prior(n, "source-" + n); h.advance(1000); }
  h.snapshots.set(id(1), { ...h.snapshots.get(id(1)), status: "cancelled", originalCodeActive: false });
  h.snapshots.set(id(2), { ...h.snapshots.get(id(2)), originalCodeActive: false });
  h.snapshots.set(id(3), { ...h.snapshots.get(id(3)), blocked: true, error: "Version conflict" });
  h.snapshots.set(id(4), { taskId: id(4), known: false });
  const recent = await h.service.recent();
  assert.deepEqual(plain(recent.map(item => item.id)), [id(5)]);
  assert.equal(h.service.store().tasks().length, 5);
  assert.ok(h.service.store().tasks().every(item => item.state === "completed"));
});

test("a retired original alias cannot be revived by repeated metadata refreshes to a different primary code", async () => {
  const h = harness(), original = h.prior(1, "source-A");
  h.snapshots.set(original.id, { ...h.snapshots.get(original.id), code: "B7K3P9", aliases: ["B7K3P9"] });
  assert.deepEqual(plain(await h.service.recent()), []);
  assert.deepEqual(plain(await h.service.recent()), []);
  const saved = h.service.store().tasks().find(item => item.id === original.id);
  assert.equal(saved.code, "B7K3P9"); assert.equal(saved.bindingCode, "A7K3P9");
  assert.ok(h.requests.slice(0, 2).every(request => request.bindings[0].code === "A7K3P9"));
  const request = await h.service.resolve(h.next(2, info("source-A")), photo);
  assert.equal(request.targetDeliveryId, undefined); assert.equal(request.files[0].replaceFileId, undefined);
});

test("repeated code confirmation retains the immutable original binding code", () => {
  const h = harness(), original = h.prior(1, "source-A");
  const task = { id: original.id, code: "B7K3P9", deliveryId: "new-primary", contextKey: "context-A",
    automation: { sourceKey: "source-A", groupSessionId: "" } };
  h.service.confirmed(task); h.service.confirmed(task);
  const saved = h.service.store().tasks().find(item => item.id === original.id);
  assert.equal(saved.code, "B7K3P9"); assert.equal(saved.bindingCode, "A7K3P9");
});
