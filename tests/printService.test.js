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
  assert.equal(result.printed, false);
  assert.equal(result.reason, "bridge-timeout");
  assert.equal(loaded.openedPaths.length, 1);
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
