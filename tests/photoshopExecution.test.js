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
