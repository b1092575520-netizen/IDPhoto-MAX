"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const loadPhotoshopExecution = require("./helpers/loadPhotoshopExecution");

const documentServicePath = path.join(__dirname, "..", "src", "photoshop", "documentService.js");

function loadDocumentService(photoshop, sourceEligibilityService) {
  const context = {
    console: {
      log() {},
      warn() {},
      error() {}
    },
    require(name) {
      assert.equal(name, "photoshop");
      return photoshop;
    },
    window: {
      IDPhotoSourceEligibilityService: sourceEligibilityService
    }
  };
  vm.createContext(context);
  loadPhotoshopExecution(context);
  vm.runInContext(fs.readFileSync(documentServicePath, "utf8"), context, {
    filename: documentServicePath
  });
  return context.window.IDPhotoDocumentService;
}

test("closeWithoutSaving closes through the shared document interface", async () => {
  let modalCalls = 0;
  const calls = [];
  const documentRef = {
    async activate() {
      calls.push("activate");
    },
    async close(argument) {
      calls.push("close:" + argument);
    }
  };
  const service = loadDocumentService({
    constants: { SaveOptions: { DONOTSAVECHANGES: "discard" } },
    action: {
      async batchPlay() {
        throw new Error("batchPlay should not be needed");
      }
    },
    core: {
      async executeAsModal(callback) {
        modalCalls += 1;
        await callback();
      }
    }
  });

  const result = await service.closeWithoutSaving(documentRef);

  assert.equal(result.closed, true);
  assert.equal(modalCalls, 1);
  assert.deepEqual(calls, ["activate", "close:discard"]);
});

test("active document info does not query Photoshop when no document is open", async () => {
  const batchPlayCalls = [];
  const service = loadDocumentService({
    app: { documents: [] },
    action: {
      async batchPlay(commands) {
        batchPlayCalls.push(commands);
        throw new Error("Photoshop would display the unavailable get-command dialog");
      }
    }
  });

  const info = await service.getActiveDocumentInfo();

  assert.equal(info, null);
  assert.equal(batchPlayCalls.length, 0);
});

test("active document info keeps the batchPlay fallback for an open document", async () => {
  const activeDocument = {
    id: 9,
    title: "fallback.JPG",
    width: 0,
    height: 0,
    resolution: 0
  };
  const batchPlayCalls = [];
  const service = loadDocumentService({
    app: { documents: [activeDocument], activeDocument },
    action: {
      async batchPlay(commands) {
        batchPlayCalls.push(commands);
        if (commands[0]._target[0]._property === "XMPMetadataAsUTF8") {
          return [{ XMPMetadataAsUTF8: "" }];
        }
        return [{ documentID: 9, title: "fallback.JPG", width: 3000, height: 2000, resolution: 300 }];
      }
    }
  });

  const info = await service.getActiveDocumentInfo();

  assert.equal(info.widthPx, 3000);
  assert.equal(info.heightPx, 2000);
  assert.equal(batchPlayCalls.length, 2);
});

test("active document info includes parsed source-camera XMP metadata", async () => {
  const activeDocument = {
    id: 7,
    title: "1M9A3399.JPG",
    width: 6960,
    height: 4640,
    resolution: 350
  };
  const service = loadDocumentService(
    {
      app: { documents: [activeDocument], activeDocument },
      action: {
        async batchPlay(commands) {
          assert.equal(commands[0]._target[0]._property, "XMPMetadataAsUTF8");
          return [{ XMPMetadataAsUTF8: '<rdf:Description tiff:Make="Canon" aux:SerialNumber="0123456789" />' }];
        }
      }
    },
    {
      parseXmp(raw) {
        assert.match(raw, /0123456789/);
        return { make: "Canon", model: "", serialNumber: "0123456789", hasXmp: true };
      }
    }
  );

  const info = await service.getActiveDocumentInfo();

  assert.equal(info.name, "1M9A3399.JPG");
  assert.deepEqual(JSON.parse(JSON.stringify(info.sourceMetadata)), {
    make: "Canon",
    model: "",
    serialNumber: "0123456789",
    hasXmp: true
  });
});

test("metadata read is pinned to the original document even if the active tab changes", async () => {
  const original = { id: 7, title: "old.JPG", width: 1000, height: 1400, resolution: 300 };
  const app = { documents: [original], activeDocument: original };
  const service = loadDocumentService({
    app,
    action: { async batchPlay(commands) {
      app.activeDocument = { id: 8, title: "new.JPG" };
      assert.equal(commands[0]._target[1]._id, 7);
      return [{ XMPMetadataAsUTF8: "old-camera-metadata" }];
    } }
  }, { parseXmp(raw) { return { raw }; } });
  const result = await service.getActiveDocumentInfo();
  assert.equal(result.id, 7);
  assert.equal(result.sourceMetadata.raw, "old-camera-metadata");
});

test("close fallback targets its document ID even when another document becomes active", async () => {
  const document = { id: 7 };
  const app = { activeDocument: { id: 8 } };
  const service = loadDocumentService({
    app,
    core: { async executeAsModal(fn) { return fn(); } },
    action: { async batchPlay(commands) {
      app.activeDocument = { id: 8 };
      assert.equal(commands[0]._obj, "close");
      assert.equal(commands[0]._target[0]._id, 7);
      return [{}];
    } }
  });
  assert.equal((await service.closeWithoutSaving(document)).closed, true);
});

test("native closeWithoutSaving uses the original object without a generic close command", async () => {
  let closed = false;
  const document = { id: 7, closeWithoutSaving() { closed = true; } };
  const service = loadDocumentService({ core: { async executeAsModal(fn) { return fn(); } } });
  assert.equal((await service.closeWithoutSaving(document)).closed, true);
  assert.equal(closed, true);
});
