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
          if (options.cropError) throw options.cropError;
          if (options.returnOriginal) return { document: { id: _sourceDocument.id } };
          const document = { name: "processed-" + (++cropIndex) };
          processedDocuments.push(document);
          calls.push("crop:" + template.id);
          return { document, message: "processed", highResolutionDocument: options.delivery ? {name:'high-resolution-'+cropIndex} : null };
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
        getInfoBarDecision(_metadata, documentName) {
          calls.push("eligibility:" + (documentName || ""));
          return options.leaveInfoBarBlank ? { leaveBlank: true, reason: "historical-source" } : { leaveBlank: false };
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
          if (options.inspectExport) options.inspectExport(exportOptions);
          if (options.failExport) {
            throw new Error("export failed");
          }
          if (options.combinedIndex) {
            try {
              await exportOptions.archiveIndexExecutor({ nativePath: "C:\\Archive\\.idphoto-jpg-index.json.stage-1.tmp" }, options.combinedIndex);
            } catch (error) {
              return { ok: true, indexUnavailable: true, message: error.message };
            }
          }
          return { ok: true, message: "exported" };
        }
      },
      IDPhotoPrintService: {
        async printOneCopy(_targetDocument, printOptions) {
          calls.push("print");
          if (options.inspectPrint) options.inspectPrint(printOptions);
          if (options.cancelPrint) return { ok: false, cancelled: true };
          if (options.throwPrint) {
            throw new Error("printer offline");
          }
          if (options.failPrint) {
            return { ok: false, blocked: true, message: "wrong printer" };
          }
          return { ok: true, printed: true, printerName: "DS-RX1", message: "printed",
            archiveIndexResult: options.combinedIndex ? { ok: true, hidden: true, operation: options.combinedIndex } : undefined };
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
  if (options.delivery) context.window.IDPhotoDeliveryService = options.delivery;
  if (options.analyzeDocument) context.window.IDPhotoVariantService = { analyzeDocument: options.analyzeDocument };
  vm.runInContext(fs.readFileSync(workflowPath, "utf8"), context, { filename: workflowPath });
  return {
    workflow: context.window.IDPhotoLayoutWorkflow.create(),
    calls,
    templates,
    processedDocuments,
    targetDocuments
  };
}

test('delivery outage never prevents one valid print and never submits completion without a saved photo',async()=>{
  for(const errorStage of ['begin','prepare','complete']) {
    let completed=0;
    const delivery={begin:async()=>{if(errorStage==='begin')throw Error('offline');return {id:'task',fingerprint:''};},prepare:async task=>{if(errorStage==='prepare')throw Error('offline');task.fingerprint='saved-photo';return '';},complete:async task=>{completed++;assert.equal(task.fingerprint,'saved-photo');throw Error('completion unavailable');}};
    const loaded=loadWorkflow({delivery});
    const result=await loaded.workflow.run({templateNames:['模板一'],sourceDocument:{id:101},docInfo:{id:101,name:'original',sourceMetadata:{}},delivery:true,quickPrint:true,skipExport:true});
    assert.equal(result.ok,true);assert.equal(loaded.calls.filter(c=>c==='print').length,1);
    assert.equal(completed,errorStage==='complete'?1:0);
    assert.equal(result.successResults[0].result.deliveryResult.ok,false);
    if(errorStage!=='begin')assert.ok(loaded.calls.includes('close:high-resolution-1'));
  }
});

test('multi-template delivery fails before creating a task; ordinary layout never invokes delivery',async()=>{
  let begins=0;const loaded=loadWorkflow({delivery:{begin:async()=>{begins++;throw Error('must not run');}}});
  await assert.rejects(loaded.workflow.run({templateNames:['模板一','模板二'],delivery:true}),/一次选一张/);
  assert.equal(begins,0);
  const result=await loaded.workflow.run({templateNames:['模板一'],sourceDocument:{id:101},docInfo:{id:101,sourceMetadata:{}},delivery:false,skipExport:true,skipPrint:true});
  assert.equal(result.ok,true);assert.equal(begins,0);
});

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

test("cancellation stops later templates before they can export or print", async () => {
  const loaded = loadWorkflow({ cropError: Object.assign(new Error("cancelled"), { number: -128 }) });
  const result = await loaded.workflow.run({ templateNames: ["模板一", "模板二"], sourceDocument: { id: 1 }, docInfo: { id: 1 }, exportJpg: true, quickPrint: true });
  assert.equal(result.cancelled, true);
  assert.equal(result.failures.length, 1);
  assert.equal(loaded.calls.some(call => /two|export:|print/.test(call)), false);
});

test("workflow rejects a processed document wrapper sharing the original ID without cleanup", async () => {
  const loaded = loadWorkflow({ returnOriginal: true });
  const result = await loaded.workflow.run({ templateNames: ["模板一"], sourceDocument: { id: 1 }, docInfo: { id: 1 } });
  assert.equal(result.failures.length, 1);
  assert.equal(loaded.calls.some(call => /close:|canvas:/.test(call)), false);
});

test("all templates share one original analysis taken before the first crop", async () => {
  const original = { id: 123, name: "source" };
  const identity = { backgroundColor: "red", personFingerprint: "0123456789abcdef" };
  let analyses = 0;
  let exports = 0;
  const loaded = loadWorkflow({
    async analyzeDocument(document) {
      analyses++;
      assert.equal(document, original);
      assert.equal(loaded.calls.filter(call => call.startsWith("crop:")).length, 0);
      return identity;
    },
    inspectExport(options) {
      exports++;
      assert.equal(options.docInfo.sourceVariant, identity);
    }
  });
  const docInfo = { id: 123, name: "source.jpg" };
  await loaded.workflow.run({ sourceDocument: original, docInfo, templateNames: ["模板一", "模板二"], exportJpg: true });
  assert.equal(analyses, 1);
  assert.equal(exports, 2);
  assert.equal(docInfo.sourceVariant, undefined, "do not retain stale analysis in UI state");
});

test("a source-document mismatch stops before crop, export and print", async () => {
  const loaded = loadWorkflow();
  await assert.rejects(loaded.workflow.run({ sourceDocument: { id: 2 }, docInfo: { id: 1 }, templateNames: ["模板一"], exportJpg: true, quickPrint: true }), /活动文档/);
  assert.equal(loaded.calls.length, 0);
});

test("historical source leaves every information bar blank while preserving layout", async () => {
  const loaded = loadWorkflow({ leaveInfoBarBlank: true });
  const result = await loaded.workflow.run({
    templateNames: ["模板一"],
    sourceDocument: { name: "source" },
    docInfo: { name: "2026-08-25_1寸_638x898_红_A7K3M9.jpg", widthPx: 1200, heightPx: 1600, sourceMetadata: { historical: true } },
    cropStrategy: "auto",
    exportJpg: true,
    nasArchive: true
  });

  assert.deepEqual(Array.from(result.successes), ["模板一"]);
  assert.ok(loaded.calls.includes("eligibility:2026-08-25_1寸_638x898_红_A7K3M9.jpg"));
  assert.ok(!loaded.calls.includes("info:one"));
  assert.equal(result.successResults[0].result.infoResult.createdCount, 0);
  assert.equal(result.successResults[0].result.infoResult.sourceNotOwned, true);
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

test("archive commit and duplicate hide piggyback on exactly one print request per layout", async () => {
  for (const operation of ["commit-archive-index", "hide-archive-index"]) {
    const loaded = loadWorkflow({ combinedIndex: operation, inspectPrint(options) {
      assert.equal(options.archiveIndex.operation, operation);
      assert.match(options.archiveIndex.indexPath, /Archive/);
    } });
    const result = await loaded.workflow.run({ templateNames: ["模板一", "模板二"], sourceDocument: { name: "source" }, docInfo: { name: "source.jpg" }, quickPrint: true, exportJpg: true });
    assert.equal(loaded.calls.filter(call => call === "print").length, 2);
    assert.equal(result.printedResults.length, 2);
    assert.equal(result.successResults.some(entry => entry.result.exportResult.indexUnavailable), false);
  }
});

test("a failed combined launch never falls back to a second permission request", async () => {
  const loaded = loadWorkflow({ combinedIndex: "commit-archive-index", failPrint: true });
  const result = await loaded.workflow.run({ templateNames: ["模板一"], sourceDocument: { name: "source" }, docInfo: { name: "source.jpg" }, quickPrint: true, exportJpg: true });
  assert.equal(loaded.calls.filter(call => call === "print").length, 1);
  assert.equal(result.successResults[0].result.exportResult.indexUnavailable, true);
  assert.equal(result.printedResults.length, 0);
});

test("cancelling combined print stops later templates and cleans only the processed copy", async () => {
  const loaded = loadWorkflow({ combinedIndex: "commit-archive-index", cancelPrint: true });
  const result = await loaded.workflow.run({ templateNames: ["模板一", "模板二"], sourceDocument: { name: "source" }, docInfo: { name: "source.jpg" }, quickPrint: true, exportJpg: true });
  assert.equal(result.cancelled, true);
  assert.equal(loaded.calls.filter(call => call === "print").length, 1);
  assert.equal(loaded.calls.includes("crop:two"), false);
  assert.equal(loaded.calls.filter(call => call === "close:processed-1").length, 1);
  assert.equal(loaded.calls.includes("close:target-1"), false);
});
