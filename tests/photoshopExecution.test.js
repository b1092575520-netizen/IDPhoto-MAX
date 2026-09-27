"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const executionPath = path.join(__dirname, "..", "src", "photoshop", "photoshopExecution.js");

function loadExecution(photoshop) {
  const context = {
    require(name) {
      assert.equal(name, "photoshop");
      return photoshop;
    },
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(executionPath, "utf8"), context, { filename: executionPath });
  return context.window.IDPhotoPhotoshopExecution;
}

test("batchPlay applies one consistent non-dialog execution policy", async () => {
  const calls = [];
  const execution = loadExecution({
    action: {
      async batchPlay(commands, options) {
        calls.push({ commands, options });
        return [{ ok: true }];
      }
    },
    core: {}
  });

  const result = await execution.batchPlay([{ _obj: "test" }]);

  assert.equal(result[0].ok, true);
  assert.equal(calls[0].options.synchronousExecution, false);
  assert.equal(calls[0].options.modalBehavior, "execute");
});

test('new document resolution never accepts a stale DOM return or ambiguous document ownership',()=>{
  const old={id:1,name:'customer',width:1653,height:555}, created={id:2,name:'info-task',width:1653,height:555};
  const app={documents:[old,created]},execution=loadExecution({app});
  assert.equal(execution.resolveCreatedDocument([1],{name:'info-task',width:1653,height:555}),created);
  assert.throws(()=>execution.resolveCreatedDocument([1,2],created),/唯一/);
  app.documents.push({id:3,...{name:'other',width:1,height:1}});
  assert.throws(()=>execution.resolveCreatedDocument([1],created),/唯一/);
  app.documents=[old,created];assert.throws(()=>execution.resolveCreatedDocument([1],{name:'info-task',width:200,height:555}),/尺寸/);
  assert.equal(old.name,'customer');
});

test("batchPlay lets a Photoshop module request synchronous execution explicitly", async () => {
  let receivedOptions;
  const execution = loadExecution({
    action: {
      async batchPlay(_commands, options) {
        receivedOptions = options;
        return [];
      }
    },
    core: {}
  });

  await execution.batchPlay([], { synchronousExecution: true });

  assert.equal(receivedOptions.synchronousExecution, true);
  assert.equal(receivedOptions.modalBehavior, "execute");
});

test("executeAsModal owns the command label and unsupported-runtime error", async () => {
  const calls = [];
  const execution = loadExecution({
    action: {},
    core: {
      async executeAsModal(callback, options) {
        calls.push(options.commandName);
        return await callback({ marker: "context" });
      }
    }
  });

  const result = await execution.executeAsModal((context) => context.marker, "测试命令");
  assert.equal(result, "context");
  assert.deepEqual(calls, ["测试命令"]);

  const unsupported = loadExecution({ action: {}, core: {} });
  await assert.rejects(() => unsupported.executeAsModal(async () => {}, "测试命令"), /executeAsModal/);
});

test("Photoshop error descriptors reject the operation even when the promise resolves", async () => {
  for (const result of [-25920, -128]) {
    const execution = loadExecution({ action: { async batchPlay() {
      return [{ _obj: "set" }, { _obj: "error", result, message: "host command failed" }];
    } } });
    await assert.rejects(execution.batchPlay([{ _obj: "set" }, { _obj: "crop" }]), error => {
      assert.equal(error.number, result);
      assert.equal(error.commandIndex, 1);
      assert.match(error.message, /host command failed/);
      return true;
    });
  }
});

test("document activation uses the real app.activeDocument API without an activate method", async () => {
  const original = { id: 1 };
  const target = { id: 2 };
  const app = { activeDocument: original };
  const execution = loadExecution({ app });
  await execution.activateDocument(target);
  assert.equal(app.activeDocument, target);
});

test("modal cancellation remains detectable when the host throws an untyped error", async () => {
  const execution = loadExecution({ core: { async executeAsModal(callback) { return callback({ isCancelled: true }); } } });
  await assert.rejects(execution.executeAsModal(async () => { throw new Error("cancelled by host"); }), error => execution.isCancellation(error));
});
