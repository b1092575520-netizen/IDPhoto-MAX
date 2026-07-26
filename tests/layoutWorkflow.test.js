"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const workflowPath = path.join(__dirname, "..", "src", "core", "layoutWorkflow.js");

function loadWorkflow(options = {}) {
  const calls = [];
  let cropIndex = 0;
  let canvasIndex = 0;
  const templates = options.templates || [
    { id: "one", name: "模板一", shortName: "一", widthPx: 600, heightPx: 600, infoBar: { kind: "bottom" } },
    { id: "two", name: "模板二", shortName: "二", widthPx: 600, heightPx: 800, infoBar: null }
  ];
  const processedDocuments = [];
  const targetDocuments = [];

  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {
      IDPhotoTemplateOverrideService: {
        getEffectiveTemplateByName(name) {
          return templates.find((template) => template.name === name) || null;
        }
      },
      IDPhotoRatioChecker: {
        checkDocumentRatio(_docInfo, template) {
          calls.push("ratio:" + template.id);
          return { canCheck: true, ok: true, errorPercent: 0 };
        }
      },
      IDPhotoCropService: {
        async prepareSinglePhoto(_sourceDocument, _docInfo, template) {
          const document = { name: "processed-" + (++cropIndex) };
          processedDocuments.push(document);
          calls.push("crop:" + template.id);
          return { document, message: "processed" };
        }
      },
      IDPhotoCanvasService: {
        async createSixInchCanvas(name) {
          const document = {
            name: "target-" + (++canvasIndex),
            async activate() {
              calls.push("activate:" + this.name);
            }
          };
          targetDocuments.push(document);
          calls.push("canvas:" + name);
          return { document, message: "canvas" };
        }
      },
      IDPhotoLayoutEngine: {
        createLayoutPlan({ template }) {
          calls.push("plan:" + template.id);
          return { positions: [{ x: 0, y: 0 }], infoBar: template.infoBar };
        }
      },
      IDPhotoLayerService: {
        async placePhotoCopies(_processed, _target, _plan, template) {
          calls.push("place:" + template.id);
          if (options.failLayoutTemplateId === template.id) {
            throw new Error("layout failed for " + template.id);
          }
          return { placedCount: 1 };
        }
      },
      IDPhotoInfoBarRenderer: {
        async renderInfoBar(_target, _infoBar, _settings, renderOptions) {
          calls.push("info:" + renderOptions.template.id);
          return { ok: true, createdCount: 1 };
        }
      },
      IDPhotoSourceEligibilityService: {
        getInfoBarDecision() {
          return { leaveBlank: false };
        }
      },
      IDPhotoSettingsStore: {
        load() {
          return { shopName: "测试店" };
        }
      },
      IDPhotoDateService: {
        makeDocumentName(name) {
          return "排版_" + name;
        },
        formatDisplayDate() {
          return "2026.07.16";
        }
      },
      IDPhotoExportService: {
        async exportSingleJpg(_processed, exportOptions) {
          calls.push("export:" + exportOptions.template.id);
          if (options.failExport) {
            throw new Error("export failed");
          }
          return { ok: true, message: "exported" };
        }
      },
      IDPhotoPrintService: {
        async printOneCopy(_targetDocument) {
          calls.push("print");
          if (options.throwPrint) {
            throw new Error("printer offline");
          }
          if (options.failPrint) {
            return { ok: false, blocked: true, message: "wrong printer" };
          }
          return { ok: true, printed: true, printerName: "DS-RX1", message: "printed" };
        }
      },
      IDPhotoDocumentService: {
        async closeWithoutSaving(document) {
          calls.push("close:" + document.name);
        },
        async cleanupTempSourceLayer() {
          calls.push("cleanup-layer");
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(workflowPath, "utf8"), context, { filename: workflowPath });
  return {
    workflow: context.window.IDPhotoLayoutWorkflow.create(),
    calls,
    templates,
    processedDocuments,
    targetDocuments
  };
}

test("the layout task owns a successful template transaction and closes its processed photo", async () => {
  const loaded = loadWorkflow();
  const result = await loaded.workflow.run({
    templateNames: ["模板一"],
    sourceDocument: { name: "source" },
    docInfo: { name: "source.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: {} },
    cropStrategy: "auto",
    exportJpg: true,
    nasArchive: false
  });

  assert.deepEqual(Array.from(result.successes), ["模板一"]);
  assert.equal(result.failures.length, 0);
  assert.match(loaded.calls.join("|"), /ratio:one\|crop:one/);
  assert.ok(loaded.calls.includes("close:processed-1"));
  assert.ok(!loaded.calls.includes("close:target-1"));
});

test("a failed layout closes both documents and the task continues with later templates", async () => {
  const loaded = loadWorkflow({ failLayoutTemplateId: "one" });
  const result = await loaded.workflow.run({
    templateNames: ["模板一", "模板二"],
    sourceDocument: { name: "source" },
    docInfo: { name: "source.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: {} },
    cropStrategy: "auto",
    exportJpg: false,
    nasArchive: false
  });

  assert.deepEqual(Array.from(result.successes), ["模板二"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].templateName, "模板一");
  assert.ok(loaded.calls.includes("close:target-1"));
  assert.ok(loaded.calls.includes("close:processed-1"));
  assert.ok(loaded.calls.includes("place:two"));
  assert.ok(loaded.calls.includes("close:processed-2"));
});

test("an export failure remains a successful layout result", async () => {
  const loaded = loadWorkflow({ failExport: true });
  const result = await loaded.workflow.run({
    templateNames: ["模板一"],
    sourceDocument: { name: "source" },
    docInfo: { name: "source.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: {} },
    cropStrategy: "auto",
    exportJpg: true,
    nasArchive: false
  });

  assert.deepEqual(Array.from(result.successes), ["模板一"]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.exportFailures.length, 1);
  assert.equal(result.successResults[0].result.exportResult.ok, false);
  assert.ok(loaded.calls.includes("close:processed-1"));
});

test("visual acceptance never calls JPG or NAS export", async () => {
  const loaded = loadWorkflow();
  const result = await loaded.workflow.run({
    templateNames: ["模板一"],
    sourceDocument: { name: "source" },
    docInfo: { name: "source.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: {} },
    cropStrategy: "auto",
    exportJpg: true,
    nasArchive: true,
    tryExportSingle: true,
    skipExport: true,
    quickPrint: true,
    skipPrint: true
  });

  assert.deepEqual(Array.from(result.successes), ["模板一"]);
  assert.ok(!loaded.calls.some((call) => call.startsWith("export:")));
  assert.ok(!loaded.calls.includes("print"));
  assert.equal(result.successResults[0].result.exportResult.skipped, true);
  assert.match(result.successResults[0].result.exportResult.message, /不写入 JPG 或 NAS/);
});

test("quick print submits each successful layout once and keeps the final document open", async () => {
  const loaded = loadWorkflow();
  const result = await loaded.workflow.run({
    templateNames: ["模板一", "模板二"],
    sourceDocument: { name: "source" },
    docInfo: { name: "source.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: {} },
    cropStrategy: "auto",
    quickPrint: true
  });

  assert.equal(loaded.calls.filter((call) => call === "print").length, 2);
  assert.equal(result.printFailures.length, 0);
  assert.equal(result.printedResults.length, 2);
  assert.ok(!loaded.calls.includes("close:target-1"));
  assert.ok(!loaded.calls.includes("close:target-2"));
});

test("a blocked DS-RX1 print remains a successful layout and later templates continue", async () => {
  const loaded = loadWorkflow({ failPrint: true });
  const result = await loaded.workflow.run({
    templateNames: ["模板一", "模板二"],
    sourceDocument: { name: "source" },
    docInfo: { name: "source.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: {} },
    cropStrategy: "auto",
    quickPrint: true
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.printFailures.length, 2);
  assert.equal(result.successes.length, 2);
  assert.equal(loaded.calls.filter((call) => call === "print").length, 2);
});

test("a DS-RX1 driver error is isolated from layout and JPG export", async () => {
  const loaded = loadWorkflow({ throwPrint: true });
  const result = await loaded.workflow.run({
    templateNames: ["模板一"],
    sourceDocument: { name: "source" },
    docInfo: { name: "source.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: {} },
    cropStrategy: "auto",
    quickPrint: true,
    exportJpg: true
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.printFailures.length, 1);
  assert.equal(result.exportFailures.length, 0);
  assert.ok(loaded.calls.includes("export:one"));
  assert.ok(loaded.calls.includes("close:processed-1"));
  assert.ok(!loaded.calls.includes("close:target-1"));
});
