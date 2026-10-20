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
      if (options.launchThrow) {
        throw new Error(options.launchThrow);
      }
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

test("blocking the permission prompt prints nothing, says so in Chinese and leaves no job behind", async () => {
  const loaded = loadService({ launchThrow: "User denied." });
  const result = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(result.ok, false);
  assert.equal(result.printed, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "permission-denied");
  assert.match(result.message, /没有打印/);
  assert.match(result.message, /阻止/);
  assert.doesNotMatch(result.message, /denied|User|队列/i, "no English error text and no queue check when nothing was sent");
  assert.equal(loaded.root.entries.get("print-jobs").entries.size, 0, "unlaunched job and image are cleaned");
});

test("blocking the prompt for an archive record fails in Chinese and removes the job", async () => {
  const loaded = loadService({ launchThrow: "User denied." });
  await assert.rejects(loaded.service.hideArchiveIndex({ name: ".idphoto-jpg-index.json", nativePath: "C:\Photos\.idphoto-jpg-index.json" }),
    error => /阻止/.test(error.message) && !/denied/i.test(error.message));
  assert.equal(loaded.root.entries.get("print-jobs").entries.size, 0);
});

test("other launch exceptions keep the unknown-outcome evidence", async () => {
  const loaded = loadService({ launchThrow: "shell crashed" });
  const result = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.printed, null);
});

test("bridge reasons are shown in Chinese, including a missing temporary image", async () => {
  for (const reason of ["image-not-found", "job-not-found", "something-new"]) {
    const loaded = loadService({ bridgeResult: { schemaVersion: 1, ok: false, printed: false, reason,
      message: "The temporary print JPG was not found; no print job was submitted" } });
    const result = await loaded.service.printOneCopy(loaded.documentRef);
    assert.equal(result.printed, false);
    assert.match(result.message, /没有打印/);
    assert.doesNotMatch(result.message, /temporary|submitted/);
  }
});

test("a temporary print JPG Photoshop never wrote is exported once more, and never launched empty", async () => {
  const healed = loadService();
  let saves = 0;
  healed.documentRef.saveAs.jpg = async (file) => {
    saves++;
    if (saves === 1) healed.root.entries.get("print-jobs").entries.delete(file.name);
    else healed.root.entries.get("print-jobs").entries.set(file.name, file);
  };
  assert.equal((await healed.service.printOneCopy(healed.documentRef)).printed, true);
  assert.equal(saves, 2); assert.equal(healed.openedPaths.length, 1);

  const missing = loadService();
  missing.documentRef.saveAs.jpg = async (file) => { missing.root.entries.get("print-jobs").entries.delete(file.name); };
  const result = await missing.service.printOneCopy(missing.documentRef);
  assert.equal(result.printed, false); assert.equal(result.reason, "image-not-found");
  assert.match(result.message, /没有打印/);
  assert.equal(missing.openedPaths.length, 0);
  assert.equal(Array.from(missing.root.entries.get("print-jobs").entries.keys()).some(name => name.endsWith(".idprint")), false);
});

test("archive records and the index travel with the print, or in one archive-only launch", async () => {
  const records = [
    { operation: "commit-archive-record", file: { name: ".idphoto-output-" + "a".repeat(32) + ".json." + "b".repeat(32) + ".tmp", nativePath: "C:\A\o.tmp" } },
    { operation: "commit-archive-index", file: { name: ".idphoto-jpg-index.json.x1-y.tmp", nativePath: "C:\A\i.tmp" } }];
  const printing = loadService();
  await printing.service.printOneCopy(printing.documentRef, { archiveOperations: records.map(item => printing.service.archiveRequest(item.file, item.operation)) });
  assert.deepEqual(printing.getWrittenJob().archiveOperations.map(item => item.operation), ["commit-archive-record", "commit-archive-index"]);
  assert.equal(printing.getWrittenJob().archiveIndex, undefined);

  const archiving = loadService({ bridgeResult: { ok: true, printed: false, results: [
    { operation: "commit-archive-record", ok: true, hidden: true }, { operation: "commit-archive-index", ok: true, hidden: true }] } });
  const receipt = await archiving.service.runArchiveOperations(records);
  assert.equal(receipt.ok, true); assert.equal(archiving.openedPaths.length, 1);
  assert.equal(archiving.getWrittenJob().operations.length, 2);

  const partial = loadService({ bridgeResult: { ok: false, printed: false, failedIndex: 1, message: "conflict",
    results: [{ operation: "commit-archive-record", ok: true, hidden: true }] } });
  await assert.rejects(partial.service.runArchiveOperations(records), /未确认存档记录.*conflict/);
  await assert.rejects(partial.service.runArchiveOperations([{ operation: "commit-archive-record", file: { name: "photo.jpg", nativePath: "C:\photo.jpg" } }]), /无效/);
  const denied = loadService({ launchThrow: "User denied." });
  await assert.rejects(denied.service.runArchiveOperations(records), /阻止/);
});

// 10-20: after one answered job the bridge is resident; the next job is handed over with a
// "<job>.go" trigger instead of launching PowerShell (and its permission prompt) again.
function residentBridge(loaded, answer) {
  const jobs = loaded.root.entries.get("print-jobs");
  const createFile = jobs.createFile.bind(jobs);
  const triggers = [];
  jobs.createFile = async (name, options) => {
    const file = await createFile(name, options);
    if (name.endsWith(".go")) {
      triggers.push(name);
      if (answer) {
        const base = name.replace(/\.go$/, "");
        const job = JSON.parse(jobs.entries.get(base + ".idprint").data);
        assert.equal(job.resident, true);
        await (await createFile(base + ".idprint.claim")).write("");
        await (await createFile(base + ".result.json", { overwrite: true })).write(JSON.stringify({ schemaVersion: 1, jobId: job.jobId,
          ok: true, printed: true, printerName: "DS-RX1", paperName: "(6x4)", copies: 1, message: "printed" }));
      }
    }
    return file;
  };
  return { jobs, triggers };
}

test("a later print goes to the resident bridge without launching it again, and leaves no files", async () => {
  const loaded = loadService();
  assert.equal((await loaded.service.printOneCopy(loaded.documentRef)).printed, true);
  assert.equal(loaded.getWrittenJob().resident, true, "the first job asks the bridge to stay");
  const { jobs, triggers } = residentBridge(loaded, true);
  const second = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(second.printed, true);
  assert.equal(loaded.openedPaths.length, 1, "no second launch");
  assert.equal(triggers.length, 1);
  assert.deepEqual(Array.from(jobs.entries.keys()), [], "job, image, trigger, claim and result cleaned");
});

test("when the resident bridge does not claim the job it is launched as before", async () => {
  const loaded = loadService();
  await loaded.service.printOneCopy(loaded.documentRef);
  const { jobs, triggers } = residentBridge(loaded, false);
  const second = await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(second.printed, true);
  assert.equal(triggers.length, 1);
  assert.equal(loaded.openedPaths.length, 2, "fell back to launching the bridge");
  assert.equal(Array.from(jobs.entries.keys()).some(name => name.endsWith(".go")), false, "unanswered trigger removed");
  // The bridge is trusted again only after it answers: the third job is handed over first.
  await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(triggers.length, 2);
});

test("a fresh plugin session launches the bridge directly instead of waiting on a trigger", async () => {
  const loaded = loadService();
  const jobs = await loaded.root.createFolder("print-jobs");
  const created = [];
  const createFile = jobs.createFile.bind(jobs);
  jobs.createFile = async (name, options) => { created.push(name); return createFile(name, options); };
  await loaded.service.printOneCopy(loaded.documentRef);
  assert.equal(created.some(name => name.endsWith(".go")), false);
  assert.equal(loaded.openedPaths.length, 1);
});
