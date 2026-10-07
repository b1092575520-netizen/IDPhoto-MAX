"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const memory = new Map();
  let clock = 100000, failWrite = false;
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => {
    if (failWrite) throw Error("storage unavailable");
    memory.set(key, value);
  } };
  const context = vm.createContext({ window: { localStorage: storage } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core/deliveryAutomationStore.js"), "utf8"), context);
  const api = context.window.IDPhotoDeliveryAutomationStore;
  return { memory, api, store: () => api.create({ storage, now: () => clock }),
    advance: value => { clock += value; }, clock: value => { clock = value; },
    failWrite: value => { failWrite = value; } };
}
const id = n => n.toString(16).padStart(32, "0");
const input = (n, sourceKey = "source-A", specKey = "25x35:white") => ({
  id: id(n), token: "token-" + n, sourceKey, specKey, mode: "layout", name: "original.jpg"
});
const plain = value => JSON.parse(JSON.stringify(value));

test("same source/specification recovers the original pending task while other customers continue", () => {
  const env = setup(), store = env.store();
  const original = store.registerTask(input(1));
  assert.equal(store.registerTask(input(2)).id, original.id);
  store.markTask(id(1), { state: "retryable", error: "network unavailable" });
  assert.equal(env.store().registerTask(input(3)).id, original.id);
  store.registerTask(input(4, "source-B"));
  store.registerTask(input(5, "source-A", "25x35:blue"));
  assert.equal(store.pendingTasks().length, 3);
  assert.deepEqual(plain(store.pendingTasks().map(item => item.token)), ["token-1", "token-4", "token-5"]);
});

test("source bindings and per-specification history survive reload without filename matching", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  store.rememberSource("source-A", { taskId: id(1), token: "token-1", code: "A7K3P9", target: { deliveryId: "delivery-A" } });
  store.registerTask(input(2, "source-A", "25x35:blue"));
  const reloaded = env.store().source("source-A");
  assert.equal(reloaded.taskId, id(1));
  assert.equal(reloaded.specs.length, 2);
  assert.equal(env.store().source("another-source-with-same-name"), null);
  reloaded.target.deliveryId = "forged";
  assert.equal(store.source("source-A").target.deliveryId, "delivery-A");
  assert.throws(() => store.rememberSource("source-A", { taskId: id(2), token: "token-1" }), /binding conflict/);
});

test("failed writes do not advance a task, change a source, or reopen a group", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  const before = env.memory.get(env.api.KEY);
  env.failWrite(true);
  assert.throws(() => store.markTask(id(1), { state: "completed", code: "A7K3P9" }), /storage unavailable/);
  assert.throws(() => store.rememberSource("source-A", { taskId: id(1), token: "token-1" }), /storage unavailable/);
  assert.throws(() => store.setGroup({ on: true, sessionId: id(90) }), /storage unavailable/);
  assert.equal(env.memory.get(env.api.KEY), before);
  assert.equal(store.tasks()[0].state, "pending");
  assert.equal(store.source("source-A"), null);
  assert.equal(store.group().on, false);
});

test("damaged or unreadable indexes fail closed and preserve the original storage", () => {
  const env = setup();
  for (const value of ["", "{broken", JSON.stringify({ version: 2, tasks: [], sources: [] })]) {
    env.memory.set(env.api.KEY, value);
    assert.throws(() => env.store(), /damaged/);
    assert.equal(env.memory.get(env.api.KEY), value);
  }
  assert.throws(() => env.api.create({ storage: { getItem: () => { throw Error("access denied"); }, setItem() {} } }), /access denied/);
});

test("invalid task state and identity changes are rejected before persistence", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  const before = env.memory.get(env.api.KEY);
  assert.throws(() => store.markTask(id(1), { state: "made-up" }), /state/);
  assert.throws(() => store.markTask(id(1), { sourceKey: "source-B" }), /identity/);
  assert.throws(() => store.registerTask({ ...input(1), token: "different-directory" }), /identity conflict/);
  assert.throws(() => store.markTask(id(1), { code: "111111" }), /pickup code/);
  assert.equal(env.memory.get(env.api.KEY), before);
});

test("legacy, stopped, and blocked tasks remain visible but never auto resume", () => {
  const env = setup(), store = env.store();
  store.registerTask({ id: id(1), token: "old-token", legacy: true });
  store.registerTask(input(2));
  store.markTask(id(2), { state: "stopped" });
  store.registerTask(input(3, "source-B"));
  store.markTask(id(3), { state: "blocked", error: "withdrawn delivery" });
  assert.equal(env.store().tasks().length, 3);
  assert.equal(store.pendingTasks().length, 0);
  assert.throws(() => store.markTask(id(1), { state: "retryable" }), /manual recovery/);
  store.forgetSource("source-A");
  assert.equal(store.tasks().length, 3);
});

test("completed means reliable completion only; group picker requires ready confirmation and deduplicates delivery", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  store.markTask(id(1), { state: "completed", code: "A7K3P9", target: { deliveryId: "delivery-A", status: "preparing" } });
  assert.equal(store.recentCompleted().length, 0);
  store.markTask(id(1), { target: { deliveryId: "delivery-A", status: "ready" } });
  env.advance(10);
  store.registerTask(input(2, "source-B"));
  store.markTask(id(2), { state: "completed", code: "B7K3P9", target: { deliveryId: "delivery-B", status: "ready" } });
  env.advance(10);
  store.registerTask(input(3, "source-A", "25x35:blue"));
  store.markTask(id(3), { state: "completed", code: "A7K3P9", target: { deliveryId: "delivery-A", status: "ready" } });
  assert.deepEqual(plain(store.recentCompleted().map(item => item.id)), [id(1), id(2)]);
  assert.throws(() => store.markTask(id(1), { state: "pending" }), /cannot restart/);
  env.advance(env.api.RECENT_MS);
  assert.equal(store.recentCompleted().length, 1);
  env.advance(1);
  assert.equal(store.recentCompleted().length, 0);
});

test("group idle expiry uses real elapsed time across reload and background updates do not renew it", () => {
  const env = setup(), store = env.store();
  const opened = store.setGroup({ on: true, sessionId: id(90), code: "A7K3P9", members: ["source-A"] });
  env.advance(env.api.IDLE_MS - 1);
  store.setGroup({ on: true, sessionId: id(90), target: { deliveryId: "delivery-A" } });
  assert.equal(env.store().group().lastLayoutAt, opened.lastLayoutAt);
  assert.equal(store.group().on, true);
  env.advance(1);
  const expired = env.store().group();
  assert.equal(expired.on, false);
  assert.equal(expired.expired, true);
  assert.equal(expired.code, "");
  assert.deepEqual(plain(expired.members), []);
  assert.equal(store.touchGroup().on, false);
});

test("new layout renews group idle time; turning off and clock reversal close it reliably", () => {
  const env = setup(), store = env.store();
  store.setGroup({ on: true, sessionId: id(90) });
  env.advance(19 * 60 * 1000);
  const touched = store.touchGroup();
  env.advance(19 * 60 * 1000);
  assert.equal(env.store().group().on, true);
  store.setGroup({ on: false });
  assert.equal(store.group().expired, false);
  store.setGroup({ on: true, sessionId: id(91) });
  env.clock(touched.lastLayoutAt - 1);
  assert.equal(store.group().on, false);
  assert.equal(store.group().expired, true);
});

test("an expiry storage failure reports failure instead of reusing the stale group", () => {
  const env = setup(), store = env.store();
  store.setGroup({ on: true, sessionId: id(90), code: "A7K3P9" });
  env.advance(env.api.IDLE_MS);
  env.failWrite(true);
  assert.throws(() => store.group(), /storage unavailable/);
  env.failWrite(false);
  assert.equal(store.group().on, false);
});

test("multiple store instances preserve each other's mutations", () => {
  const env = setup(), first = env.store(), second = env.store();
  first.registerTask(input(1));
  second.registerTask(input(2, "source-B"));
  first.markTask(id(1), { state: "retryable" });
  assert.equal(second.tasks().length, 2);
  assert.equal(second.tasks()[0].state, "retryable");
});

test("group limit, duplicate members and oversized target reject the whole mutation", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  store.setGroup({ on: true, sessionId: id(90), members: ["source-A"] });
  const before = env.memory.get(env.api.KEY);
  assert.throws(() => store.setGroup({ on: true, sessionId: id(90), members: Array.from({ length: 9 }, (_, n) => "source-" + n) }), /capacity/);
  assert.throws(() => store.setGroup({ on: true, sessionId: id(90), members: ["source-A", "source-A"] }), /Duplicate/);
  assert.throws(() => store.markTask(id(1), { target: { metadata: "x".repeat(17000) } }), /too large/);
  assert.equal(env.memory.get(env.api.KEY), before);
});

test("lossy target values and circular data are rejected without stripping recovery fields", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  const before = env.memory.get(env.api.KEY);
  assert.throws(() => store.markTask(id(1), { target: { checksum: undefined } }), /target/);
  assert.throws(() => store.rememberSource("source-A", { taskId: id(1), token: "token-1", target: { groupVersion: NaN } }), /target/);
  const circular = {};
  circular.parent = circular;
  assert.throws(() => store.markTask(id(1), { target: circular }), /too deep/);
  assert.equal(env.memory.get(env.api.KEY), before);
});

test("a later corrupted index or mismatched original token is never overwritten", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  store.rememberSource("source-A", { taskId: id(1), token: "token-1" });
  const broken = JSON.parse(env.memory.get(env.api.KEY));
  broken.sources[0].token = "unrelated-directory";
  const raw = JSON.stringify(broken);
  env.memory.set(env.api.KEY, raw);
  assert.throws(() => store.registerTask(input(2, "source-B")), /binding is damaged/);
  assert.throws(() => store.source("source-A"), /binding is damaged/);
  assert.equal(env.memory.get(env.api.KEY), raw);
});

test("task capacity refuses new work and retains all existing recovery tokens", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  const full = JSON.parse(env.memory.get(env.api.KEY));
  const original = full.tasks[0];
  full.tasks = Array.from({ length: 8192 }, (_, n) => ({ ...original,
    id: id(n + 1), token: "token-" + (n + 1), sourceKey: "source-" + n }));
  const raw = JSON.stringify(full);
  env.memory.set(env.api.KEY, raw);
  assert.throws(() => store.registerTask(input(8193, "source-new")), /capacity/);
  assert.equal(env.memory.get(env.api.KEY), raw);
  assert.equal(store.tasks().length, 8192);
});

test("unresolved merge intent survives group closing, reload and idle expiry", () => {
  const env = setup(), store = env.store();
  const intent = { operationId: id(7), taskIds: [id(1), id(2)], sourceRootToken: "original-root", contextKey: "original-context" };
  store.setGroup({ on: true, sessionId: id(90) });
  store.setMergeIntent(intent);
  store.setGroup({ on: false });
  assert.deepEqual(plain(env.store().mergeIntent()), intent);
  store.setGroup({ on: true, sessionId: id(91) });
  env.advance(env.api.IDLE_MS);
  assert.equal(store.group().on, false);
  assert.deepEqual(plain(store.mergeIntent()), intent);
  assert.throws(() => store.setMergeIntent({ ...intent, operationId: id(8) }), /cannot change/);
  assert.throws(() => store.setMergeIntent({ ...intent, taskIds: [id(1), id(3)] }), /cannot change/);
  assert.deepEqual(plain(store.mergeIntent()), intent);
});

test("merge-intent persistence failure retains the original intent until explicit confirmed resolution", () => {
  const env = setup(), store = env.store();
  const intent = { operationId: id(7), taskIds: [id(1)], sourceRootToken: "root-token", contextKey: "context" };
  env.failWrite(true);
  assert.throws(() => store.setMergeIntent(intent), /storage unavailable/);
  assert.equal(store.mergeIntent(), null);
  env.failWrite(false);
  store.setMergeIntent(intent);
  env.failWrite(true);
  assert.throws(() => store.setMergeIntent(null), /storage unavailable/);
  assert.deepEqual(plain(store.mergeIntent()), intent);
  env.failWrite(false);
  store.setMergeIntent(null);
  assert.equal(env.store().mergeIntent(), null);
});

test("an existing pre-intent index loads without rewriting it, while corrupt intents fail closed", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  const old = JSON.parse(env.memory.get(env.api.KEY));
  delete old.mergeIntent;
  const raw = JSON.stringify(old);
  env.memory.set(env.api.KEY, raw);
  assert.equal(env.store().mergeIntent(), null);
  assert.equal(env.memory.get(env.api.KEY), raw);
  old.mergeIntent = { operationId: id(7), taskIds: [id(1), id(1)], sourceRootToken: "root", contextKey: "ctx" };
  const broken = JSON.stringify(old);
  env.memory.set(env.api.KEY, broken);
  assert.throws(() => env.store(), /Duplicate/);
  assert.equal(env.memory.get(env.api.KEY), broken);
});

test("group sessions distinguish immediate reopen and reject stale updates from the previous session", () => {
  const env = setup(), store = env.store();
  const first = store.setGroup({ on: true, sessionId: id(90) });
  store.setGroup({ on: false });
  const second = store.setGroup({ on: true, sessionId: id(91) });
  assert.equal(first.openedAt, second.openedAt);
  assert.notEqual(first.sessionId, second.sessionId);
  const before = env.memory.get(env.api.KEY);
  assert.throws(() => store.setGroup({ on: true, sessionId: first.sessionId, code: "A7K3P9" }), /session has changed/);
  assert.equal(env.memory.get(env.api.KEY), before);
  assert.throws(() => store.setGroup({ on: true }), /task ID/);
  assert.equal(store.group().sessionId, second.sessionId);
});

test("active legacy groups without a stable session are durably closed rather than revived", () => {
  const env = setup(), store = env.store();
  store.setGroup({ on: true, sessionId: id(90), code: "A7K3P9", members: ["source-A"] });
  const legacy = JSON.parse(env.memory.get(env.api.KEY));
  delete legacy.group.sessionId;
  env.memory.set(env.api.KEY, JSON.stringify(legacy));
  const recovered = env.store().group();
  assert.equal(recovered.on, false);
  assert.equal(recovered.sessionId, "");
  assert.equal(recovered.expired, true);
  assert.equal(JSON.parse(env.memory.get(env.api.KEY)).group.on, false);
});

test("legacy group migration failure preserves the previous index and refuses a usable session", () => {
  const env = setup(), store = env.store();
  store.setGroup({ on: true, sessionId: id(90) });
  const legacy = JSON.parse(env.memory.get(env.api.KEY));
  delete legacy.group.sessionId;
  const raw = JSON.stringify(legacy);
  env.memory.set(env.api.KEY, raw);
  env.failWrite(true);
  assert.throws(() => env.store(), /storage unavailable/);
  assert.equal(env.memory.get(env.api.KEY), raw);
  env.failWrite(false);
  assert.equal(env.store().group().on, false);
});

test("the first confirmed code remains immutable while a task's displayed current code changes", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1));
  assert.equal(store.tasks()[0].bindingCode, "");
  store.markTask(id(1), { code: "A7K3P9" });
  store.markTask(id(1), { code: "B7K3P9" });
  store.markTask(id(1), { code: "" });
  const saved = env.store().tasks()[0];
  assert.equal(saved.bindingCode, "A7K3P9");
  assert.equal(saved.code, "");
  assert.throws(() => store.markTask(id(1), { bindingCode: "B7K3P9" }), /identity cannot change/);
});

test("a pre-binding index preserves its recorded code without rewriting the raw recovery evidence", () => {
  const env = setup(), store = env.store();
  store.registerTask(input(1)); store.markTask(id(1), { code: "A7K3P9" });
  const old = JSON.parse(env.memory.get(env.api.KEY)); delete old.tasks[0].bindingCode;
  const bytes = JSON.stringify(old); env.memory.set(env.api.KEY, bytes);
  assert.equal(env.store().tasks()[0].bindingCode, "A7K3P9");
  assert.equal(env.memory.get(env.api.KEY), bytes);
});

test("an active-session update cannot reopen a closed or expired group", () => {
  for (const close of [true, false]) {
    const env = setup(), store = env.store();
    const group = store.setGroup({ on: true, sessionId: id(99) });
    if (close) store.setGroup({ on: false }); else env.advance(env.api.IDLE_MS);
    const result = store.setGroup({ on: true, sessionId: group.sessionId, requireActive: true, code: "A7K3P9" });
    assert.equal(result.on, false); assert.equal(env.store().group().on, false);
  }
});
