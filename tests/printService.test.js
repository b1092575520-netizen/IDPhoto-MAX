"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const servicePath = path.join(__dirname, "..", "src", "photoshop", "printService.js");

function makeFolder(name, nativePath) {
  const entries = new Map();
  return {
    name,
    nativePath,
    entries,
    async getEntry(entryName) {
      if (!entries.has(entryName)) {
        throw new Error("entry not found");
      }
      return entries.get(entryName);
    },
    async createFolder(entryName) {
      const folder = makeFolder(entryName, nativePath + "\\" + entryName);
      entries.set(entryName, folder);
      return folder;
    },
    async createFile(entryName, options) {
      if (entries.has(entryName) && !(options && options.overwrite)) {
        throw new Error("entry already exists");
      }
      const file = {
        name: entryName,
        nativePath: nativePath + "\\" + entryName,
        data: "",
        deleted: false,
        async write(value) {
          this.data = String(value);
        },
        async read() {
          return this.data;
        },
        async delete() {
          this.deleted = true;
          entries.delete(entryName);
        }
      };
      entries.set(entryName, file);
      return file;
    }
  };
}

function loadService(options = {}) {
  const root = makeFolder("data", "C:\\PluginData");
  const openedPaths = [];
  const savedJpegs = [];
  let writtenJob = null;
  const shell = {
    async openPath(nativePath) {
      openedPaths.push(nativePath);
      const jobs = root.entries.get("print-jobs");
      const jobFile = Array.from(jobs.entries.values()).find((entry) => entry.name.endsWith(".idprint"));
      writtenJob = JSON.parse(jobFile.data);
      if (options.launchError) {
        return options.launchError;
      }
      if (!options.noResult) {
        const resultName = jobFile.name.replace(/\.idprint$/, ".result.json");
        const resultFile = await jobs.createFile(resultName, { overwrite: true });
        await resultFile.write(JSON.stringify(Object.assign({
          schemaVersion: 1,
          jobId: writtenJob.jobId
        }, options.bridgeResult || {
          schemaVersion: 1,
          ok: true,
          printed: true,
          printerName: "DS-RX1",
          paperName: "(6x4)",
          copies: 1,
          message: "printed"
        })));
        if (options.partialResult) {
          let reads = 0;
          resultFile.read = async () => ++reads === 1 ? "{partial" : resultFile.data;
        }
      }
      return "";
    }
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback) {
      callback();
      return 1;
    },
    require(name) {
      assert.equal(name, "uxp");
      return {
        storage: {
          localFileSystem: {
            async getDataFolder() {
              return root;
            }
          },
          formats: { utf8: "utf8" }
        },
        shell
      };
    },
    window: {
      IDPhotoPhotoshopExecution: {
        async executeAsModal(callback, commandName) {
          assert.equal(commandName, "导出 DS-RX1 打印临时图");
          return await callback();
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(servicePath, "utf8"), context, { filename: servicePath });
  const documentRef = {
    width: 3600,
    height: 2400,
    saveAs: {
      async jpg(file, settings, asCopy) {
        savedJpegs.push({ file, settings, asCopy });
      }
    }
  };
  return {
    service: context.window.IDPhotoPrintService,
    root,
    openedPaths,
    savedJpegs,
    documentRef,
    getWrittenJob() {
      return writtenJob;
    }
  };
}

test("quick print exports a JPEG copy and opens one fixed DS-RX1 bridge job", async () => {
  const loaded = loadService();

  const result = await loaded.service.printOneCopy(loaded.documentRef);
  const job = loaded.getWrittenJob();

  assert.equal(result.ok, true);
  assert.equal(result.printed, true);
  assert.equal(result.printerName, "DS-RX1");
  assert.equal(result.paperName, "(6x4)");
  assert.equal(result.copies, 1);
  assert.equal(loaded.savedJpegs.length, 1);
  assert.equal(loaded.savedJpegs[0].settings.quality, 12);
  assert.equal(loaded.savedJpegs[0].asCopy, true);
  assert.match(loaded.savedJpegs[0].file.name, /^idphoto-[a-z0-9-]+\.jpg$/);
  assert.equal(loaded.openedPaths.length, 1);
  assert.match(loaded.openedPaths[0], /\.idprint$/);
  assert.equal(job.schemaVersion, 1);
  assert.equal(job.printerName, "DS-RX1");
  assert.equal(job.paperName, "(6x4)");
  assert.equal(job.copies, 1);
  assert.equal(job.expectedWidthPx, 3600);
  assert.equal(job.expectedHeightPx, 2400);
  assert.match(job.imagePath, /\.jpg$/);
});

test("quick print reports a bridge rejection without claiming a print", async () => {
  const loaded = loadService({
    bridgeResult: {
      schemaVersion: 1,
      ok: false,
      printed: false,
      reason: "paper-not-found",
      message: "未找到精确纸张 (6x4)"
    }
  });

  const result = await loaded.service.printOneCopy(loaded.documentRef);

  assert.equal(result.ok, false);
  assert.equal(result.printed, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "paper-not-found");
  assert.match(result.message, /\(6x4\)/);
});

test("quick print fails closed when the Windows bridge cannot be launched", async () => {
  const loaded = loadService({ launchError: "No application is associated with .idprint" });

  const result = await loaded.service.printOneCopy(loaded.documentRef);

  assert.equal(result.ok, false);
  assert.equal(result.printed, false);
  assert.equal(result.reason, "bridge-launch-failed");
  assert.match(result.message, /打印桥/);
});

test("quick print times out without retrying or claiming a print", async () => {
  const loaded = loadService({ noResult: true });

  const result = await loaded.service.printOneCopy(loaded.documentRef, { timeoutMs: 0 });

  assert.equal(result.ok, false);
  assert.equal(result.printed, null);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.blocked, false);
  assert.match(result.message, /队列/);
  assert.equal(result.reason, "bridge-timeout");
  assert.equal(loaded.openedPaths.length, 1);
});

test("hiding archive index uses an attribute-only job and requires a matching no-print receipt", async () => {
  const loaded = loadService({ bridgeResult: { operation: "hide-archive-index", ok: true, hidden: true, printed: false } });
  await loaded.service.hideArchiveIndex({ name: ".idphoto-jpg-index.json", nativePath: "C:\\Photos\\.idphoto-jpg-index.json" });
  assert.equal(loaded.getWrittenJob().operation, "hide-archive-index");
  assert.equal(loaded.getWrittenJob().printerName, undefined);
  assert.equal(loaded.savedJpegs.length, 0);
  assert.equal(loaded.root.entries.get("print-jobs").entries.size, 0);
  const wrongReceipt = loadService();
  await assert.rejects(wrongReceipt.service.hideArchiveIndex({ name: ".idphoto-jpg-index.json", nativePath: "C:\\Photos\\.idphoto-jpg-index.json" }), /未确认/);
  await assert.rejects(loaded.service.hideArchiveIndex({ name: "photo.jpg", nativePath: "C:\\Photos\\photo.jpg" }), /无效/);
  const commit = loadService({ bridgeResult: { operation: "commit-archive-index", ok: true, hidden: true, printed: false } });
  await commit.service.commitArchiveIndex({ name: ".idphoto-jpg-index.json.stage-1.tmp", nativePath: "C:\\Photos\\.idphoto-jpg-index.json.stage-1.tmp" });
  assert.equal(commit.getWrittenJob().operation, "commit-archive-index");
  assert.equal(commit.savedJpegs.length, 0);
});

test("one shell launch carries both print and archive, retaining separate results even if printing fails", async () => {
  const archiveIndex = { operation: "commit-archive-index", indexPath: "C:\\Archive\\.idphoto-jpg-index.json.stage-1.tmp" };
  for (const printOk of [true, false]) {
    const loaded = loadService({ bridgeResult: {
      ok: printOk, printed: printOk, printerName: "DS-RX1", paperName: "(6x4)", copies: 1,
      archiveIndexResult: { ok: true, hidden: true, operation: "commit-archive-index" }
    } });
    const result = await loaded.service.printOneCopy(loaded.documentRef, { archiveIndex });
    assert.deepEqual(loaded.getWrittenJob().archiveIndex, archiveIndex);
    assert.equal(loaded.openedPaths.length, 1);
    assert.equal(result.archiveIndexResult.ok, true);
    assert.equal(result.printed, printOk);
  }
});

test("failure before bridge launch cleans the unsubmitted image and job", async () => {
  const loaded = loadService();
  loaded.documentRef.saveAs.jpg = async () => { throw new Error("disk full"); };
  const result = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(result.ok, false);
  assert.equal(loaded.openedPaths.length, 0);
  assert.equal(loaded.root.entries.get("print-jobs").entries.size, 0);
});

test("an in-progress result file is read again without launching another print", async () => {
  const loaded = loadService({ partialResult: true });
  const result = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(result.printed, true);
  assert.equal(loaded.openedPaths.length, 1);
});

test("failure after submission is reported as unknown, preserving evidence", async () => {
  const loaded = loadService({ bridgeResult: { ok: false, printed: null, outcomeUnknown: true, message: "spooler failed" } });
  const result = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(result.printed, null);
  assert.equal(result.outcomeUnknown, true);
  assert.ok(loaded.root.entries.get("print-jobs").entries.size > 0);
});

test("cancelling print image export is preserved as cancellation and leaves no job", async () => {
  const loaded = loadService();
  loaded.documentRef.saveAs.jpg = async () => { throw Object.assign(new Error("cancelled"), { number: -128 }); };
  const result = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(result.cancelled, true);
  assert.equal(loaded.openedPaths.length, 0);
  assert.equal(loaded.root.entries.get("print-jobs").entries.size, 0);
});

test("quick print rejects a missing layout document before creating a job", async () => {
  const loaded = loadService();

  const result = await loaded.service.printOneCopy(null);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing-document");
  assert.equal(loaded.openedPaths.length, 0);
});

test("the print service never reads or rewrites Photoshop print settings", () => {
  const source = fs.readFileSync(servicePath, "utf8");

  assert.doesNotMatch(source, /printSettings|printOneCopy\s*\"|PRINTER_PROFILE|captureCurrentPrinterProfile/);
  assert.doesNotMatch(source, /batchPlay/);
});
